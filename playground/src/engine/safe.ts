/**
 * Execution effects (SPEC §9): what happens when the Safe (or MultiSend acting for itself) runs a
 * call. Safe 1.5.0 owner/module/guard managers, SafePolicyGuard configuration entry points,
 * OpenZeppelin ERC-20 v5, WETH9 and MultiSendCallOnly. Every failure throws a Revert carrying the
 * revert data the chain would return.
 */
import { ethers } from 'ethers'

import { opName, type Op } from './access.ts'
import {
  MAX_UINT,
  SENTINEL,
  ZERO,
  addressOf,
  eqAddr,
  formatAsset,
  kindOf,
  shortLabel,
  symbolOf
} from './book.ts'
import {
  ERC20_IFACE,
  GUARD_IFACE,
  MULTISEND_IFACE,
  POLICY_IFACE,
  SAFE_IFACE,
  SELECTORS,
  WETH_IFACE,
  configurationRootOf,
  decodeConfigurations
} from './catalog.ts'
import { confirmPolicy } from './engine.ts'
import { Revert, type Fault } from './errors.ts'
import { describeCall, E, formatTime, genericMessage, T } from './messages.ts'
import type { Effect, RuleSpec, TraceEvent, TraceStatus, World } from './types.ts'

export interface ExecCall {
  to: string
  value: bigint
  data: string
  operation: Op
}

export interface ExecCtx {
  w: World
  trace: TraceEvent[]
  effects: Effect[]
  /** msg.sender of the Safe frame (the account that called execTransaction, or the module). */
  executor: string
  /** Rule lists the tx spec attached to configuration roots, for display in `world.roots`. */
  rootHints: Record<string, RuleSpec[]>
}

// ---------------------------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------------------------

export function balanceOf(w: World, asset: string, holder: string): bigint {
  const book = w.balances[asset === 'ETH' ? 'ETH' : ethers.getAddress(asset)]
  if (!book) return 0n
  const key = Object.keys(book).find((k) => eqAddr(k, holder))
  return key ? BigInt(book[key]) : 0n
}

export function setBalance(w: World, asset: string, holder: string, amount: bigint): void {
  const assetKey = asset === 'ETH' ? 'ETH' : ethers.getAddress(asset)
  const book = (w.balances[assetKey] ??= {})
  const existing = Object.keys(book).find((k) => eqAddr(k, holder))
  if (existing) delete book[existing]
  if (amount !== 0n) book[ethers.getAddress(holder)] = amount.toString()
}

export function allowanceOf(w: World, token: string, owner: string, spender: string): bigint {
  const byToken = w.allowances[ethers.getAddress(token)]
  const ownerKey = byToken && Object.keys(byToken).find((k) => eqAddr(k, owner))
  const byOwner = ownerKey ? byToken[ownerKey] : undefined
  const spenderKey = byOwner && Object.keys(byOwner).find((k) => eqAddr(k, spender))
  return spenderKey ? BigInt(byOwner![spenderKey]) : 0n
}

export function setAllowance(w: World, token: string, owner: string, spender: string, amount: bigint): void {
  const t = ethers.getAddress(token)
  const o = ethers.getAddress(owner)
  const s = ethers.getAddress(spender)
  const byToken = (w.allowances[t] ??= {})
  const byOwner = (byToken[o] ??= {})
  if (amount === 0n) delete byOwner[s]
  else byOwner[s] = amount.toString()
  if (Object.keys(byOwner).length === 0) delete byToken[o]
  if (Object.keys(byToken).length === 0) delete w.allowances[t]
}

function move(w: World, asset: string, from: string, to: string, amount: bigint): void {
  if (amount === 0n || eqAddr(from, to)) return
  setBalance(w, asset, from, balanceOf(w, asset, from) - amount)
  setBalance(w, asset, to, balanceOf(w, asset, to) + amount)
}

// ---------------------------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------------------------

interface Where {
  depth: number
  subTx?: number
}

function event(x: ExecCtx, at: Where, id: string, status: TraceStatus, title: string, extra: { detail?: string; tech?: string; actor?: TraceEvent['actor'] } = {}): void {
  const ev: TraceEvent = { id, depth: at.depth, actor: extra.actor ?? 'Target', status, title }
  if (extra.detail) ev.detail = extra.detail
  if (extra.tech) ev.tech = extra.tech
  if (at.subTx !== undefined) ev.subTx = at.subTx
  x.trace.push(ev)
}

function effect(x: ExecCtx, at: Where, kind: Effect['kind'], title: string, tech?: string, status: TraceStatus = 'pass'): void {
  const e: Effect = { kind, title }
  if (tech) e.tech = tech
  x.effects.push(e)
  event(x, at, 'exec.effect', status, title, { tech })
}

const traced = new WeakSet<Revert>()

function fault(error: string, extra: Omit<Fault, 'error'> = {}): never {
  throw new Revert({ error, ...extra })
}

function emptyRevert(message?: string): never {
  throw new Revert({ error: 'Reverted', message })
}

function isSafe(x: ExecCtx, a: string): boolean {
  return eqAddr(a, x.w.safe.address)
}

function who(x: ExecCtx, a: string): string {
  return shortLabel(x.w, a)
}

/** Can `addr` accept plain ETH? Contracts without receive/fallback cannot. */
function canReceive(x: ExecCtx, addr: string): boolean {
  const kind = kindOf(x.w, addr)
  return !(kind === 'token' || kind === 'multisend' || kind === 'guard' || kind === 'policy' || kind === 'module')
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/** The Safe's `execute(to, value, data, operation)` from its own frame. */
export function executeFromSafe(x: ExecCtx, call: ExecCall, at: Where): void {
  if (call.operation === 1) {
    delegateFromSafe(x, call, at)
  } else {
    callFrom(x, x.w.safe.address, call, at)
  }
}

function callFrom(x: ExecCtx, from: string, call: ExecCall, at: Where): void {
  const what = describeCall(x.w, call.to, call.value, call.data, 0)
  event(x, at, 'exec.call', 'info', T.execCall(what), {
    tech: `CALL ${call.to} value ${call.value} data ${call.data.length > 74 ? call.data.slice(0, 74) + '…' : call.data}`,
    detail: isSafe(x, from) ? undefined : `${who(x, from)} makes this call, not the Safe.`
  })
  try {
    if (call.value > 0n) {
      const have = balanceOf(x.w, 'ETH', from)
      if (have < call.value) {
        emptyRevert(`${who(x, from)} holds ${formatAsset(x.w, 'ETH', have)}, not enough to send ${formatAsset(x.w, 'ETH', call.value)}.`)
      }
      move(x.w, 'ETH', from, call.to, call.value)
      const amount = formatAsset(x.w, 'ETH', call.value)
      if (isSafe(x, from)) effect(x, at, 'balance', E.received(who(x, call.to), amount))
      else effect(x, at, 'balance', E.sent(who(x, from), who(x, call.to), amount))
    }
    dispatchCall(x, from, call, at)
  } catch (e) {
    if (e instanceof Revert && !traced.has(e)) {
      traced.add(e)
      event(x, at, 'exec.revert', 'fail', T.execRevert(who(x, call.to)), {
        detail: e.fault.message ?? genericMessage(e.fault.error),
        tech: revertTech(e.fault)
      })
    }
    throw e
  }
}

function revertTech(f: Fault): string {
  const args = f.args ? `(${Object.values(f.args).join(', ')})` : '()'
  return f.error === 'Reverted' ? 'revert with empty data' : /^GS\d+$/.test(f.error) ? `revert("${f.error}")` : `${f.error}${args}`
}

function dispatchCall(x: ExecCtx, from: string, call: ExecCall, at: Where): void {
  const kind = kindOf(x.w, call.to)
  switch (kind) {
    case 'safe':
      return safeCall(x, from, call, at, from)
    case 'guard':
      return guardCall(x, from, call, at)
    case 'token':
      return tokenCall(x, from, call, at)
    case 'weth':
      return wethCall(x, from, call, at)
    case 'multisend': {
      if (call.data.slice(0, 10) !== SELECTORS.multiSend) emptyRevert('MultiSend only understands multiSend.')
      let packed: string
      try {
        packed = String(MULTISEND_IFACE.decodeFunctionData('multiSend', call.data)[0])
      } catch {
        emptyRevert('The batch data cannot be read.')
      }
      event(x, at, 'exec.call', 'warn', T.execMultiSendCall, { detail: T.execMultiSendCallDetail, actor: 'MultiSend' })
      return runBatch(x, call.to, packed, at)
    }
    case 'policy': {
      if (call.value > 0n) emptyRevert('Policies cannot receive ETH.')
      const sel = call.data.slice(0, 10)
      const known = POLICY_IFACE.fragments.some((f) => f.type === 'function' && (f as ethers.FunctionFragment).selector === sel)
      if (!known) emptyRevert('This policy has no such function.')
      effect(x, at, 'note', E.noEffectOnSafe(who(x, call.to)), undefined, 'info')
      return
    }
    case 'module':
      // The modules are TestModule contracts: one function, no receive, no fallback.
      emptyRevert(`${who(x, call.to)} is a contract with no function for this call.`)
      return
    default:
      // People, services, MysteryContract, Zero and unknown addresses: no code.
      return
  }
}

// ---------------------------------------------------------------------------------------------
// Safe self-calls
// ---------------------------------------------------------------------------------------------

function decodeOrRevert(iface: ethers.Interface, fn: string, data: string): ethers.Result {
  try {
    return iface.decodeFunctionData(fn, data)
  } catch {
    emptyRevert('The call data cannot be read.')
  }
}

function prevOf(list: string[], item: string): string | null {
  const i = list.findIndex((a) => eqAddr(a, item))
  if (i < 0) return null
  return i === 0 ? SENTINEL : list[i - 1]
}

/** Safe code running with `sender` as msg.sender. `from` is the caller frame for ETH. */
function safeCall(x: ExecCtx, _from: string, call: ExecCall, at: Where, sender: string): void {
  const w = x.w
  const len = ethers.dataLength(call.data)
  if (len === 0) return // receive(): accepts ETH
  const sel = len >= 4 ? call.data.slice(0, 10) : null
  const fragment = sel ? SAFE_IFACE.fragments.find((f) => f.type === 'function' && (f as ethers.FunctionFragment).selector === sel) : undefined
  if (!fragment) {
    // fallback() with no fallback handler: non-payable, returns nothing.
    if (call.value > 0n) emptyRevert('The Safe fallback does not accept ETH.')
    effect(x, at, 'note', 'The Safe has no fallback handler, so the call did nothing', 'FallbackManager.fallback: handler == address(0)', 'info')
    return
  }
  const fn = (fragment as ethers.FunctionFragment).name
  if (call.value > 0n) emptyRevert('This Safe function does not accept ETH.')
  const args = decodeOrRevert(SAFE_IFACE, fn, call.data)
  const view = (fragment as ethers.FunctionFragment).constant
  if (view) return
  if (fn === 'approveHash') {
    if (!w.safe.owners.some((o) => eqAddr(o, sender))) fault('GS030')
    effect(x, at, 'note', 'An approved hash was recorded', undefined, 'info')
    return
  }
  if (!eqAddr(sender, w.safe.address)) fault('GS031', { message: 'Only the Safe itself can change its own settings, and this call comes from somewhere else.' })
  const guard = addressOf(w, 'PolicyGuard')
  switch (fn) {
    case 'setGuard':
    case 'setModuleGuard': {
      const g = ethers.getAddress(args[0])
      const isTx = fn === 'setGuard'
      if (!eqAddr(g, ZERO) && !eqAddr(g, guard)) {
        // supportsInterface on an address without it: the call fails or returns nothing to decode.
        emptyRevert(`${who(x, g)} is not a guard contract, so the Safe cannot install it.`)
      }
      const value = eqAddr(g, ZERO) ? null : g
      if (isTx) w.safe.txGuard = value
      else w.safe.moduleGuard = value
      const title = isTx
        ? value ? E.guardSet(who(x, value)) : E.guardRemoved
        : value ? E.moduleGuardSet(who(x, value)) : E.moduleGuardRemoved
      effect(x, at, 'guard', title, `${fn}(${g})`)
      return
    }
    case 'enableModule': {
      const m = ethers.getAddress(args[0])
      if (eqAddr(m, ZERO) || eqAddr(m, SENTINEL)) fault('GS101')
      if (w.safe.modules.some((a) => eqAddr(a, m))) fault('GS102')
      w.safe.modules.unshift(m)
      effect(x, at, 'module', E.moduleEnabled(who(x, m)), `enableModule(${m})`)
      return
    }
    case 'disableModule': {
      const prev = ethers.getAddress(args[0])
      const m = ethers.getAddress(args[1])
      if (eqAddr(m, ZERO) || eqAddr(m, SENTINEL)) fault('GS101')
      const actualPrev = prevOf(w.safe.modules, m)
      if (actualPrev === null || !eqAddr(actualPrev, prev)) fault('GS103')
      w.safe.modules = w.safe.modules.filter((a) => !eqAddr(a, m))
      effect(x, at, 'module', E.moduleDisabled(who(x, m)), `disableModule(${prev}, ${m})`)
      return
    }
    case 'changeThreshold':
      return changeThreshold(x, at, BigInt(args[0]))
    case 'addOwnerWithThreshold': {
      const o = ethers.getAddress(args[0])
      const t = BigInt(args[1])
      if (eqAddr(o, ZERO) || eqAddr(o, SENTINEL) || eqAddr(o, w.safe.address)) fault('GS203')
      if (w.safe.owners.some((a) => eqAddr(a, o))) fault('GS204')
      w.safe.owners.unshift(o)
      effect(x, at, 'owners', E.ownerAdded(who(x, o)), `addOwnerWithThreshold(${o}, ${t})`)
      if (BigInt(w.safe.threshold) !== t) changeThreshold(x, at, t)
      return
    }
    case 'removeOwner': {
      const prev = ethers.getAddress(args[0])
      const o = ethers.getAddress(args[1])
      const t = BigInt(args[2])
      if (BigInt(w.safe.owners.length - 1) < t) fault('GS201')
      if (eqAddr(o, ZERO) || eqAddr(o, SENTINEL)) fault('GS203')
      const actualPrev = prevOf(w.safe.owners, o)
      if (actualPrev === null || !eqAddr(actualPrev, prev)) fault('GS205')
      w.safe.owners = w.safe.owners.filter((a) => !eqAddr(a, o))
      effect(x, at, 'owners', E.ownerRemoved(who(x, o)), `removeOwner(${prev}, ${o}, ${t})`)
      if (BigInt(w.safe.threshold) !== t) changeThreshold(x, at, t)
      return
    }
    case 'swapOwner': {
      const prev = ethers.getAddress(args[0])
      const oldO = ethers.getAddress(args[1])
      const newO = ethers.getAddress(args[2])
      if (eqAddr(newO, ZERO) || eqAddr(newO, SENTINEL) || eqAddr(newO, w.safe.address)) fault('GS203')
      if (w.safe.owners.some((a) => eqAddr(a, newO))) fault('GS204')
      if (eqAddr(oldO, ZERO) || eqAddr(oldO, SENTINEL)) fault('GS203')
      const actualPrev = prevOf(w.safe.owners, oldO)
      if (actualPrev === null || !eqAddr(actualPrev, prev)) fault('GS205')
      w.safe.owners = w.safe.owners.map((a) => (eqAddr(a, oldO) ? newO : a))
      effect(x, at, 'owners', E.ownerRemoved(who(x, oldO)), `swapOwner(${prev}, ${oldO}, ${newO})`)
      effect(x, at, 'owners', E.ownerAdded(who(x, newO)))
      return
    }
    case 'setFallbackHandler': {
      if (eqAddr(args[0], w.safe.address)) fault('GS400')
      effect(x, at, 'note', 'Fallback handler change is not simulated', `setFallbackHandler(${args[0]})`, 'warn')
      return
    }
  }
}

function changeThreshold(x: ExecCtx, at: Where, t: bigint): void {
  const w = x.w
  if (t > BigInt(w.safe.owners.length)) fault('GS201')
  if (t === 0n) fault('GS202')
  const before = w.safe.threshold
  w.safe.threshold = Number(t)
  effect(x, at, 'threshold', E.threshold(before, Number(t)), `changeThreshold(${t})`)
}

// ---------------------------------------------------------------------------------------------
// SafePolicyGuard configuration entry points
// ---------------------------------------------------------------------------------------------

function guardCall(x: ExecCtx, from: string, call: ExecCall, at: Where): void {
  const w = x.w
  if (call.value > 0n) emptyRevert('The Policy Guard does not accept ETH.')
  const sel = ethers.dataLength(call.data) >= 4 ? call.data.slice(0, 10) : null
  const fromSafe = isSafe(x, from)
  const guard = addressOf(w, 'PolicyGuard')
  switch (sel) {
    case SELECTORS.configureImmediately: {
      let configs
      try {
        configs = decodeConfigurations(GUARD_IFACE, 'configureImmediately', call.data)
      } catch {
        emptyRevert('The rule list cannot be read.')
      }
      if (!fromSafe) {
        // Configures the caller's own namespace: validate, then drop.
        const scratch = structuredClone(w)
        for (const c of configs) confirmPolicy(scratch, c, null)
        effect(x, at, 'note', E.noEffectOnSafe(who(x, from)), 'configureImmediately from a non-Safe caller', 'info')
        return
      }
      if (eqAddr(w.safe.txGuard, guard) || eqAddr(w.safe.moduleGuard, guard)) {
        fault('GuardAlreadyEnabled')
      }
      for (const c of configs) confirmWithEffect(x, at, c)
      return
    }
    case SELECTORS.requestConfiguration: {
      const [root] = decodeOrRevert(GUARD_IFACE, 'requestConfiguration', call.data)
      const r = String(root).toLowerCase()
      if (!fromSafe) {
        effect(x, at, 'note', E.noEffectOnSafe(who(x, from)), undefined, 'info')
        return
      }
      const existing = w.roots[r]
      if (existing && !(w.now >= existing.validFrom + w.expiry)) {
        fault('RootAlreadyConfigured', { args: { root: r } })
      }
      const validFrom = w.now + w.delay
      w.roots[r] = { validFrom, configurations: structuredClone(x.rootHints[r] ?? []) }
      effect(x, at, 'root', E.rootRequested(formatTime(validFrom)), `rootConfigured[safe][${r}] = ${validFrom}`)
      return
    }
    case SELECTORS.invalidateRoot: {
      const [root] = decodeOrRevert(GUARD_IFACE, 'invalidateRoot', call.data)
      const r = String(root).toLowerCase()
      if (!fromSafe || !w.roots[r]) fault('RootNotConfigured', { args: { root: r } })
      delete w.roots[r]
      effect(x, at, 'root', E.rootCancelled, `delete rootConfigured[safe][${r}]`)
      return
    }
    case SELECTORS.applyConfiguration: {
      let configs
      try {
        configs = decodeConfigurations(GUARD_IFACE, 'applyConfiguration', call.data)
      } catch {
        emptyRevert('The rule list cannot be read.')
      }
      const r = configurationRootOf(configs)
      const entry = fromSafe ? w.roots[r] : undefined
      if (!entry) fault('RootNotConfigured', { args: { root: r } })
      if (w.now < entry.validFrom) {
        fault('RootConfigurationPending', {
          message: `The waiting period ends at ${formatTime(entry.validFrom)}. Until then the change cannot be applied.`
        })
      }
      if (w.now >= entry.validFrom + w.expiry) {
        fault('RootConfigurationExpired', {
          message: `This rule change could be applied until ${formatTime(entry.validFrom + w.expiry)}. It expired. Request it again.`
        })
      }
      delete w.roots[r]
      effect(x, at, 'root', E.rootApplied(configs.length), `RootApplied(safe, ${r})`)
      for (const c of configs) confirmWithEffect(x, at, c)
      return
    }
  }
  if (sel) {
    const fragment = GUARD_IFACE.fragments.find((f) => f.type === 'function' && (f as ethers.FunctionFragment).selector === sel)
    if (fragment && (fragment as ethers.FunctionFragment).constant) return
  }
  emptyRevert('The Policy Guard has no such function.')
}

function confirmWithEffect(x: ExecCtx, at: Where, c: Parameters<typeof confirmPolicy>[1]): void {
  const local: Effect[] = []
  confirmPolicy(x.w, c, local)
  for (const e of local) effect(x, at, e.kind, e.title, e.tech)
}

// ---------------------------------------------------------------------------------------------
// OpenZeppelin ERC-20 v5
// ---------------------------------------------------------------------------------------------

function tokenCall(x: ExecCtx, from: string, call: ExecCall, at: Where): void {
  const w = x.w
  const token = call.to
  if (call.value > 0n) emptyRevert(`${symbolOf(w, token)} does not accept ETH.`)
  const sel = ethers.dataLength(call.data) >= 4 ? call.data.slice(0, 10) : null
  const fragment = sel ? ERC20_IFACE.fragments.find((f) => f.type === 'function' && (f as ethers.FunctionFragment).selector === sel) : undefined
  if (!fragment) emptyRevert(`${symbolOf(w, token)} has no such function.`)
  const fn = (fragment as ethers.FunctionFragment).name
  const args = decodeOrRevert(ERC20_IFACE, fn, call.data)
  const fmt = (v: bigint) => formatAsset(w, token, v)
  switch (fn) {
    case 'transfer': {
      const to = ethers.getAddress(args[0])
      const amount = BigInt(args[1])
      ozTransfer(x, at, token, from, to, amount)
      effect(x, at, 'balance', isSafe(x, from) ? E.received(who(x, to), fmt(amount)) : E.sent(who(x, from), who(x, to), fmt(amount)), `${symbolOf(w, token)}.transfer(${to}, ${amount})`)
      return
    }
    case 'approve': {
      const spender = ethers.getAddress(args[0])
      const amount = BigInt(args[1])
      if (eqAddr(spender, ZERO)) fault('ERC20InvalidSpender', { args: { spender: ZERO } })
      setAllowance(w, token, from, spender, amount)
      effect(
        x,
        at,
        'allowance',
        amount === 0n ? E.allowanceRemoved(who(x, from), who(x, spender), symbolOf(w, token)) : E.approved(who(x, from), who(x, spender), fmt(amount)),
        `${symbolOf(w, token)}.approve(${spender}, ${amount})`
      )
      return
    }
    case 'transferFrom': {
      const src = ethers.getAddress(args[0])
      const dst = ethers.getAddress(args[1])
      const amount = BigInt(args[2])
      const current = allowanceOf(w, token, src, from)
      if (current < MAX_UINT) {
        if (current < amount) {
          fault('ERC20InsufficientAllowance', {
            args: { spender: from, allowance: current.toString(), needed: amount.toString() },
            message: `${who(x, src)} allowed ${who(x, from)} to take ${fmt(current)}, not ${fmt(amount)}.`
          })
        }
        setAllowance(w, token, src, from, current - amount)
      }
      ozTransfer(x, at, token, src, dst, amount)
      effect(x, at, 'balance', E.moved(who(x, src), who(x, dst), fmt(amount)), `${symbolOf(w, token)}.transferFrom(${src}, ${dst}, ${amount})`)
      return
    }
    default:
      return // views
  }
}

function ozTransfer(x: ExecCtx, _at: Where, token: string, from: string, to: string, amount: bigint): void {
  const w = x.w
  if (eqAddr(from, ZERO)) fault('ERC20InvalidSender', { args: { sender: ZERO } })
  if (eqAddr(to, ZERO)) fault('ERC20InvalidReceiver', { args: { receiver: ZERO } })
  const have = balanceOf(w, token, from)
  if (have < amount) {
    fault('ERC20InsufficientBalance', {
      args: { sender: from, balance: have.toString(), needed: amount.toString() },
      message: `${who(x, from)} holds ${formatAsset(w, token, have)}, not enough to send ${formatAsset(w, token, amount)}.`
    })
  }
  move(w, token, from, to, amount)
}

// ---------------------------------------------------------------------------------------------
// WETH9
// ---------------------------------------------------------------------------------------------

function wethCall(x: ExecCtx, from: string, call: ExecCall, at: Where): void {
  const w = x.w
  const weth = call.to
  const sel = ethers.dataLength(call.data) >= 4 ? call.data.slice(0, 10) : null
  const fragment = sel ? WETH_IFACE.fragments.find((f) => f.type === 'function' && (f as ethers.FunctionFragment).selector === sel) : undefined
  const fn = fragment ? (fragment as ethers.FunctionFragment).name : 'fallback'
  const fmt = (v: bigint) => formatAsset(w, weth, v)
  if (fn === 'deposit' || fn === 'fallback') {
    setBalance(w, weth, from, balanceOf(w, weth, from) + call.value)
    const detail =
      fn === 'fallback' ? 'WETH runs deposit for any call it does not recognise, whatever function the call named.' : undefined
    effect(x, at, 'balance', E.wrapped(who(x, from), fmt(call.value)), `WETH9.${fn === 'fallback' ? 'fallback -> deposit' : 'deposit'}() value ${call.value}`)
    if (detail) event(x, at, 'exec.effect', 'warn', 'WETH ran its fallback, which deposits', { detail })
    return
  }
  if (call.value > 0n) emptyRevert(`WETH ${fn} does not accept ETH.`)
  const args = decodeOrRevert(WETH_IFACE, fn, call.data)
  switch (fn) {
    case 'withdraw': {
      const wad = BigInt(args[0])
      if (balanceOf(w, weth, from) < wad) emptyRevert(`${who(x, from)} holds ${fmt(balanceOf(w, weth, from))}, not ${fmt(wad)}.`)
      setBalance(w, weth, from, balanceOf(w, weth, from) - wad)
      if (!canReceive(x, from)) emptyRevert(`${who(x, from)} cannot receive ETH.`)
      move(w, 'ETH', weth, from, wad)
      effect(x, at, 'balance', E.unwrapped(who(x, from), fmt(wad)), `WETH9.withdraw(${wad})`)
      return
    }
    case 'approve': {
      const guy = ethers.getAddress(args[0])
      const wad = BigInt(args[1])
      setAllowance(w, weth, from, guy, wad)
      effect(x, at, 'allowance', wad === 0n ? E.allowanceRemoved(who(x, from), who(x, guy), 'WETH') : E.approved(who(x, from), who(x, guy), fmt(wad)), `WETH9.approve(${guy}, ${wad})`)
      return
    }
    case 'transfer':
    case 'transferFrom': {
      const src = fn === 'transfer' ? from : ethers.getAddress(args[0])
      const dst = ethers.getAddress(fn === 'transfer' ? args[0] : args[1])
      const wad = BigInt(fn === 'transfer' ? args[1] : args[2])
      if (balanceOf(w, weth, src) < wad) emptyRevert(`${who(x, src)} holds ${fmt(balanceOf(w, weth, src))}, not ${fmt(wad)}.`)
      if (!eqAddr(src, from)) {
        const current = allowanceOf(w, weth, src, from)
        if (current !== MAX_UINT) {
          if (current < wad) emptyRevert(`${who(x, src)} allowed ${who(x, from)} to take ${fmt(current)}, not ${fmt(wad)}.`)
          setAllowance(w, weth, src, from, current - wad)
        }
      }
      move(w, weth, src, dst, wad)
      effect(x, at, 'balance', fn === 'transfer' && isSafe(x, src) ? E.received(who(x, dst), fmt(wad)) : E.moved(who(x, src), who(x, dst), fmt(wad)), `WETH9.${fn}(${dst}, ${wad})`)
      return
    }
    default:
      return
  }
}

// ---------------------------------------------------------------------------------------------
// MultiSendCallOnly
// ---------------------------------------------------------------------------------------------

/** Runs the packed batch with `frame` as address(this): the Safe under DELEGATECALL, MultiSend under CALL. */
function runBatch(x: ExecCtx, frame: string, packed: string, at: Where): void {
  const bytes = ethers.getBytes(packed)
  let i = 0
  let step = 0
  while (i < bytes.length) {
    if (i + 85 > bytes.length) emptyRevert('The batch data is cut short.')
    const op = bytes[i]
    let to = ethers.getAddress(ethers.hexlify(bytes.slice(i + 1, i + 21)))
    if (eqAddr(to, ZERO)) to = frame
    const value = BigInt(ethers.hexlify(bytes.slice(i + 21, i + 53)))
    const lenBig = BigInt(ethers.hexlify(bytes.slice(i + 53, i + 85)))
    if (lenBig > BigInt(bytes.length - i - 85)) emptyRevert('The batch data is cut short.')
    const len = Number(lenBig)
    const data = ethers.hexlify(bytes.slice(i + 85, i + 85 + len))
    const sub: Where = { depth: at.depth + 1, subTx: step }
    if (op !== 0) {
      event(x, sub, 'exec.call', 'info', T.execDelegate(describeCall(x.w, to, value, data, 1)))
      const err = new Revert({ error: 'Reverted', message: 'MultiSend (call only) refuses delegatecalls inside a batch.' })
      traced.add(err)
      event(x, sub, 'exec.revert', 'fail', T.execStepDelegate, { tech: 'MultiSendCallOnly: case 1 { revert(0, 0) }' })
      throw err
    }
    callFrom(x, frame, { to, value, data, operation: 0 }, sub)
    i += 85 + len
    step++
  }
}

// ---------------------------------------------------------------------------------------------
// DELEGATECALL from the Safe
// ---------------------------------------------------------------------------------------------

function delegateFromSafe(x: ExecCtx, call: ExecCall, at: Where): void {
  const w = x.w
  const kind = kindOf(w, call.to)
  event(x, at, 'exec.call', 'info', T.execDelegate(describeCall(w, call.to, call.value, call.data, 1)), {
    tech: `DELEGATECALL ${call.to} data ${call.data.length > 74 ? call.data.slice(0, 74) + '…' : call.data}`
  })
  try {
    if (kind === 'multisend') {
      if (call.data.slice(0, 10) !== SELECTORS.multiSend) emptyRevert('MultiSend only understands multiSend.')
      let packed: string
      try {
        packed = String(MULTISEND_IFACE.decodeFunctionData('multiSend', call.data)[0])
      } catch {
        emptyRevert('The batch data cannot be read.')
      }
      runBatch(x, w.safe.address, packed, at)
      return
    }
    delegateOther(x, call, at, kind)
    const name = shortLabel(w, call.to)
    event(x, at, 'exec.effect', 'warn', T.execUnknownCode(name), { detail: T.execUnknownCodeDetail })
    x.effects.push({ kind: 'note', title: E.delegateNoEffect(name), tech: `DELEGATECALL ${call.to} (${opName(call.operation)})` })
  } catch (e) {
    if (e instanceof Revert && !traced.has(e)) {
      traced.add(e)
      event(x, at, 'exec.revert', 'fail', T.execRevert(who(x, call.to)), {
        detail: e.fault.message ?? genericMessage(e.fault.error),
        tech: revertTech(e.fault)
      })
    }
    throw e
  }
}

/**
 * Foreign code running in the Safe's storage with msg.sender = the executor. Its own storage
 * reads see the Safe's (empty) slots, so balances and allowances there are zero.
 */
function delegateOther(x: ExecCtx, call: ExecCall, at: Where, kind: ReturnType<typeof kindOf>): void {
  const sender = x.executor
  const sel = ethers.dataLength(call.data) >= 4 ? call.data.slice(0, 10) : null
  const find = (iface: ethers.Interface) =>
    sel ? (iface.fragments.find((f) => f.type === 'function' && (f as ethers.FunctionFragment).selector === sel) as ethers.FunctionFragment | undefined) : undefined
  switch (kind) {
    case 'safe':
      return safeCall(x, x.w.safe.address, { ...call, value: 0n }, at, sender)
    case 'token': {
      const f = find(ERC20_IFACE)
      if (!f) emptyRevert('That token has no such function.')
      const args = decodeOrRevert(ERC20_IFACE, f.name, call.data)
      if (f.name === 'transfer') {
        if (eqAddr(args[0], ZERO)) fault('ERC20InvalidReceiver', { args: { receiver: ZERO } })
        if (BigInt(args[1]) > 0n) fault('ERC20InsufficientBalance', { args: { sender, balance: '0', needed: String(args[1]) } })
      } else if (f.name === 'approve') {
        if (eqAddr(args[0], ZERO)) fault('ERC20InvalidSpender', { args: { spender: ZERO } })
      } else if (f.name === 'transferFrom') {
        if (BigInt(args[2]) > 0n) fault('ERC20InsufficientAllowance', { args: { spender: sender, allowance: '0', needed: String(args[2]) } })
        if (eqAddr(args[0], ZERO)) fault('ERC20InvalidSender', { args: { sender: ZERO } })
        if (eqAddr(args[1], ZERO)) fault('ERC20InvalidReceiver', { args: { receiver: ZERO } })
      }
      return
    }
    case 'weth': {
      const f = find(WETH_IFACE)
      if (!f || f.name === 'deposit') return
      const args = decodeOrRevert(WETH_IFACE, f.name, call.data)
      if (f.name === 'withdraw' && BigInt(args[0]) > 0n) emptyRevert()
      if (f.name === 'transfer' && BigInt(args[1]) > 0n) emptyRevert()
      if (f.name === 'transferFrom' && BigInt(args[2]) > 0n) emptyRevert()
      return
    }
    case 'guard': {
      if (sel === SELECTORS.configureImmediately) {
        let configs
        try {
          configs = decodeConfigurations(GUARD_IFACE, 'configureImmediately', call.data)
        } catch {
          emptyRevert()
        }
        const scratch = structuredClone(x.w)
        for (const c of configs) confirmPolicy(scratch, c, null)
        return
      }
      if (sel === SELECTORS.requestConfiguration) return
      if (sel === SELECTORS.invalidateRoot || sel === SELECTORS.applyConfiguration) fault('RootNotConfigured')
      const f = find(GUARD_IFACE)
      if (f && f.constant) return
      emptyRevert('The Policy Guard has no such function.')
      return
    }
    case 'policy': {
      const f = find(POLICY_IFACE)
      if (!f) emptyRevert('This policy has no such function.')
      return
    }
    case 'multisend':
      return
    case 'module':
      emptyRevert(`${who(x, call.to)} has no function for this call.`)
      return
    default:
      // No code: a delegatecall to it does nothing.
      return
  }
}
