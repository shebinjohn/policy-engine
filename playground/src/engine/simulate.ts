/**
 * One transaction through Safe.execTransaction (owner path, SPEC §5) or
 * Safe.execTransactionFromModule (module path, SPEC §6), with the SafePolicyGuard hooks.
 * Pure: works on a structuredClone of the world and returns the input world on failure.
 */
import { accessSelector, decodeSelector } from './access.ts'
import { ethers } from 'ethers'

import { EngineInputError, RELAYER, ZERO, eqAddr, kindOf, resolveAddress, shortLabel } from './book.ts'
import { SELECTORS, configurationRootOf, encodeSubTx, encodeTxCall, ruleToConfiguration, toEncodedTx, type EncodedCall } from './catalog.ts'
import { checkTransaction, getPolicy, type EngineCtx, type Matched } from './engine.ts'
import { txIdentity } from './policies/common.ts'
import { EMPTY_CONTEXT, buildContext, checkNSignatures, concatCtx, ctxLength, raw, type CtxBytes, type CtxNode } from './context.ts'
import { Revert, toSimError, type Fault } from './errors.ts'
import { describeCall, E, makeMessageFor, T } from './messages.ts'
import { balanceOf, executeFromSafe, type ExecCtx } from './safe.ts'
import type {
  CallSpec,
  Effect,
  EncodedTx,
  ErrorSource,
  RuleSpec,
  SimError,
  SimResult,
  SubTxSpec,
  TraceEvent,
  TraceStatus,
  TxSpec,
  World
} from './types.ts'

interface Run {
  input: World
  w: World
  trace: TraceEvent[]
  effects: Effect[]
  encoded: EncodedTx
  call: EncodedCall
  tx: TxSpec
}

function ev(
  run: Run,
  id: string,
  actor: TraceEvent['actor'],
  status: TraceStatus,
  title: string,
  extra: { detail?: string; tech?: string } = {}
): void {
  const e: TraceEvent = { id, depth: 0, actor, status, title }
  if (extra.detail) e.detail = extra.detail
  if (extra.tech) e.tech = extra.tech
  run.trace.push(e)
}

function collectRootHints(w: World, call: CallSpec | undefined, out: Record<string, RuleSpec[]>): void {
  if (!call) return
  if ((call.fn === 'requestConfiguration' || call.fn === 'invalidateRoot') && call.configurations) {
    try {
      out[configurationRootOf(call.configurations.map((r) => ruleToConfiguration(w, r)))] = call.configurations
    } catch {
      // encoding errors surface from encodeTxCall
    }
  }
  for (const sub of call.batch ?? []) collectRootHints(w, sub.call, out)
}

function matchedFor(run: Run): SimResult['matched'] {
  const top = run.trace.filter((e) => e.depth === 0)
  if (top.some((e) => e.id === 'engine.allowedCall' && e.status === 'pass')) return null
  if (!top.some((e) => e.id.startsWith('engine.lookup.'))) return undefined
  const look = getPolicy(run.input, run.call.to, run.call.data, run.call.operation)
  if (!look.entry) return null
  return { access: look.access, policy: look.entry.policy, isFallback: look.usedFallback || look.entry.isFallback }
}

function failResult(run: Run, fault: Fault, by: ErrorSource, matched: SimResult['matched']): SimResult {
  const error: SimError = toSimError(fault, by, makeMessageFor(run.input))
  const effects = run.effects.map((e) => ({ ...e, reverted: true }))
  ev(run, 'rollback', 'Safe', 'fail', T.rollback, { detail: T.rollbackDetail(effects.map((e) => e.title)) })
  const result: SimResult = { ok: false, error, trace: run.trace, effects, world: run.input, encoded: run.encoded }
  if (matched !== undefined) result.matched = matched
  return result
}

function okResult(run: Run, matched: SimResult['matched']): SimResult {
  ev(run, 'commit', 'Safe', 'pass', T.commit)
  const label = run.tx.label ?? describeCall(run.input, run.call.to, run.call.value, run.call.data, run.call.operation)
  const visible = run.effects.filter((e) => e.kind !== 'nonce' && e.kind !== 'policyState')
  run.w.history.push({
    at: run.w.now,
    label,
    ok: true,
    summary: visible.length > 0 ? visible.map((e) => e.title).join('. ') : 'Executed'
  })
  const result: SimResult = { ok: true, trace: run.trace, effects: run.effects, world: run.w, encoded: run.encoded }
  if (matched !== undefined) result.matched = matched
  return result
}

function bigintOf(v: string | undefined, name: string): bigint {
  if (v === undefined || v === '') return 0n
  try {
    return BigInt(v)
  } catch {
    throw new EngineInputError(`${name} must be a whole number, got "${v}"`)
  }
}

export function simulate(world: World, tx: TxSpec): SimResult {
  const call = encodeTxCall(world, tx)
  const sel = decodeSelector(call.data)
  const encoded = toEncodedTx(call, sel.ok ? accessSelector(call.to, sel.selector, call.operation) : '')
  const run: Run = { input: world, w: structuredClone(world), trace: [], effects: [], encoded, call, tx }
  const rootHints: Record<string, RuleSpec[]> = {}
  collectRootHints(world, tx.call, rootHints)
  return (tx.path ?? 'owner') === 'module' ? moduleTx(run, rootHints) : ownerTx(run, rootHints)
}

/**
 * Does executing `call` run any code? With no gas (gasPrice != 0, safeTxGas 0) only a call or
 * delegatecall to an address without code succeeds; ETH still moves on the 2300 stipend.
 */
const STARVED_GAS = 5000n

function runsCode(w: World, call: EncodedCall): boolean {
  const n = BigInt(call.to)
  if (n > 0n && n <= 0x11n) return true // precompiles cost gas
  const kind = kindOf(w, call.to)
  return !(kind === 'person' || kind === 'service' || kind === 'contract')
}

function isBatch(call: EncodedCall): boolean {
  return call.operation === 1 && call.data.slice(0, 10) === SELECTORS.multiSend
}

function byAddress(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}

const POLICY_CONTEXT_TYPE_HASH = ethers.id('SafePolicyGuard.PolicyContext.v1')
const OWNER_SIG = 'owner-signature'

/**
 * The spec tree a context is built against: every checked (sub-)transaction with its tx hash at
 * the signed nonce (a sub-transaction's zero `to` is the Safe, as MultiSendPolicy resolves it).
 */
function ctxNode(w: World, spec: TxSpec | SubTxSpec, call: { to: string; value: bigint; data: string; operation: 0 | 1 }, nonce: number): CtxNode {
  const node: CtxNode = { hash: txIdentity(w, call, nonce) }
  if (spec.call?.fn === 'multiSend' && spec.call.batch) {
    node.subs = spec.call.batch.map((sub) => {
      const enc = encodeSubTx(w, sub)
      const to = eqAddr(enc.to, ZERO) ? w.safe.address : enc.to
      return ctxNode(w, sub, { to, value: enc.value, data: enc.data, operation: enc.operation === 1 ? 1 : 0 }, nonce)
    })
    node.subContexts = spec.call.batch.map((sub) => sub.context)
  }
  return node
}

/** The policy context payload the owners attach, or null for none (no envelope). */
export function contextBytesFor(w: World, tx: TxSpec, call: EncodedCall, nonce: number): CtxBytes | null {
  const node = ctxNode(w, tx, call, nonce)
  return buildContext(w, tx.context, node, node.hash)
}

/**
 * The Safe `signatures` blob: the owner signatures sorted by address, then, with a context, the
 * SignatureExtension envelope `[payload][uint256 length][bytes32 typeHash]`.
 */
function signatureBlob(signers: string[], payload: CtxBytes | null): CtxBytes {
  const sigs = signers.map((signer) => ({
    hex: ethers.concat([ethers.id(`owner-sig:r:${signer}`), ethers.id(`owner-sig:s:${signer}`), '0x1b']),
    tags: [{ start: 0, end: 65, kind: 'sig' as const, signer, hash: OWNER_SIG, overBatch: false }]
  }))
  if (!payload) return concatCtx(sigs)
  return concatCtx([...sigs, payload, raw(ethers.toBeHex(ctxLength(payload), 32)), raw(POLICY_CONTEXT_TYPE_HASH)])
}

function ownerTx(run: Run, rootHints: Record<string, RuleSpec[]>): SimResult {
  const w = run.w
  const tx = run.tx
  const threshold = w.safe.threshold

  // 1. checkSignatures(executor, txHash, signatures): the first `threshold` 65-byte slots.
  const signers = tx.signers
    ? tx.signers.map((s) => resolveAddress(w, s))
    : w.safe.owners.slice(0, threshold)
  const sorted = [...signers].sort(byAddress)
  const gasPrice = bigintOf(tx.gasPrice, 'gasPrice')
  const safeTxGas = bigintOf(tx.safeTxGas, 'safeTxGas')
  const payload = contextBytesFor(w, tx, run.call, w.safe.nonce)
  const blob = signatureBlob(sorted, payload)
  const topHash = txIdentity(w, run.call, w.safe.nonce)
  const gasZero = gasPrice === 0n && safeTxGas === 0n
  const sig = checkNSignatures(w, blob, threshold, (h) => h === OWNER_SIG || (gasZero && h === topHash), RELAYER)
  if (!sig.ok) {
    const title =
      sig.error === 'GS020'
        ? T.signaturesTooFew(sorted.length, threshold)
        : sig.slot >= sorted.length
          ? T.signaturesTooFewContext(sorted.length, threshold)
          : sig.duplicate
            ? T.signaturesDuplicate(shortLabel(w, sig.who!))
            : T.signaturesBad(shortLabel(w, sig.who ?? sorted[sig.slot]))
    ev(run, 'safe.signatures', 'Safe', 'fail', title, {
      detail: sig.slot >= sorted.length && sig.error !== 'GS020' ? T.signaturesContextDetail : T.signaturesDetail,
      tech:
        sig.error === 'GS020'
          ? `checkNSignatures: signatures.length < ${threshold} * 65 reverts GS020`
          : `checkNSignatures: signature ${sig.slot + 1} reverts ${sig.error}`
    })
    return failResult(run, { error: sig.error }, 'safe', undefined)
  }
  const distinct = new Set(sorted.filter((a) => w.safe.owners.some((o) => eqAddr(o, a))).map((a) => a.toLowerCase())).size
  ev(run, 'safe.signatures', 'Safe', 'pass', T.signaturesOk(Math.max(threshold, distinct), w.safe.owners.length), {
    detail: T.signaturesDetail,
    tech: `checkSignatures: ${threshold} of ${w.safe.owners.length} required`
  })

  // 2. nonce++
  const signedNonce = w.safe.nonce
  w.safe.nonce += 1
  ev(run, 'safe.nonce', 'Safe', 'info', T.nonce(signedNonce, w.safe.nonce), { detail: T.nonceDetail(signedNonce) })
  run.effects.push({ kind: 'nonce', title: E.nonce(signedNonce, w.safe.nonce), tech: `nonce ${signedNonce} -> ${w.safe.nonce}` })

  // Safe 1.5.0 reads the guard once, before the check, and calls checkAfterExecution on it.
  const guardAtStart = w.safe.txGuard
  const guarded = guardAtStart !== null
  let matched: SimResult['matched'] = undefined

  if (!guarded) {
    if (isBatch(run.call)) ev(run, 'safe.noGuard', 'Safe', 'warn', T.noTxGuardBatch, { detail: T.noTxGuardBatchDetail })
    else ev(run, 'safe.noGuard', 'Safe', 'warn', T.noTxGuard, { detail: T.noTxGuardDetail })
    if (gasPrice !== 0n || safeTxGas !== 0n) ev(run, 'safe.noGuard', 'Safe', 'warn', T.gasIgnored)
  } else {
    // 3. SafePolicyGuard.checkTransaction
    if (gasPrice !== 0n) {
      ev(run, 'guard.gasPrice', 'Guard', 'fail', T.gasPriceBad, { detail: T.gasPriceDetail, tech: 'require(gasPrice == 0, NonZeroGasPrice())' })
      return failResult(run, { error: 'NonZeroGasPrice' }, 'guard', undefined)
    }
    ev(run, 'guard.gasPrice', 'Guard', 'pass', T.gasPriceOk, { tech: 'gasPrice == 0' })
    if (safeTxGas !== 0n) {
      ev(run, 'guard.safeTxGas', 'Guard', 'fail', T.safeTxGasBad, { detail: T.safeTxGasDetail, tech: 'require(safeTxGas == 0, NonZeroSafeTxGas())' })
      return failResult(run, { error: 'NonZeroSafeTxGas' }, 'guard', undefined)
    }
    ev(run, 'guard.safeTxGas', 'Guard', 'pass', T.safeTxGasOk, { tech: 'safeTxGas == 0' })
    const ectx: EngineCtx = { w, trace: run.trace, effects: run.effects, module: null, signedNonce }
    try {
      checkTransaction(ectx, run.call, payload ?? EMPTY_CONTEXT, 0)
    } catch (e) {
      if (e instanceof Revert) return failResult(run, e.fault, 'guard', matchedFor(run))
      throw e
    }
    matched = matchedFor(run)
  }

  // 4. execute(to, value, data, operation, gasPrice == 0 ? gasleft() - 2500 : safeTxGas)
  const x: ExecCtx = { w, trace: run.trace, effects: run.effects, executor: RELAYER, rootHints }
  // Without a guard nothing refuses non-zero gas settings. Safe 1.5.0 then gives the call only
  // safeTxGas gas when gasPrice != 0 (Safe.sol 180), does not revert a failed call unless both are
  // zero (Safe.sol 182), and refunds gas to tx.origin when gasPrice != 0 (Safe.sol 196-198).
  const swallow = !guarded && (safeTxGas !== 0n || gasPrice !== 0n)
  // The engine does not meter gas: below STARVED_GAS no code can run (any state change behind the
  // Safe proxy needs more); at or above it the gas is assumed to be enough.
  const callGas = safeTxGas + (run.call.value > 0n && run.call.operation === 0 ? 2300n : 0n)
  const starved = !guarded && gasPrice !== 0n && callGas < STARVED_GAS
  if (swallow) {
    const inner: ExecCtx = { ...x, w: structuredClone(w), effects: [] }
    let failure: Fault | null = null
    if (starved && runsCode(w, run.call)) {
      ev(run, 'exec.call', 'Target', 'info', T.execCall(describeCall(run.input, run.call.to, run.call.value, run.call.data, run.call.operation)))
      ev(run, 'exec.revert', 'Target', 'fail', T.execOutOfGas, { detail: T.execOutOfGasDetail, tech: `execute(..., gas = safeTxGas = ${safeTxGas}): out of gas` })
      failure = { error: 'OutOfGas' }
    } else {
      try {
        executeFromSafe(inner, run.call, { depth: 0 })
      } catch (e) {
        if (!(e instanceof Revert)) throw e
        failure = e.fault
      }
    }
    if (failure === null) {
      run.w = inner.w
      run.effects.push(...inner.effects)
    } else {
      run.effects.push(...inner.effects.map((ef) => ({ ...ef, reverted: true })))
      ev(run, 'exec.revert', 'Safe', 'warn', T.callFailedNoRevert, {
        detail: T.callFailedNoRevertGasDetail,
        tech: 'success == false && (safeTxGas != 0 || gasPrice != 0): ExecutionFailure, no revert'
      })
    }
    // handlePayment: (gasUsed + baseGas) * min(gasPrice, tx.gasprice) wei to tx.origin.
    if (gasPrice !== 0n) {
      if (balanceOf(run.w, 'ETH', w.safe.address) === 0n) {
        ev(run, 'exec.revert', 'Safe', 'fail', T.refundFails, {
          detail: T.refundFailsDetail,
          tech: 'handlePayment: receiver.call{value: payment}("") fails: revert("GS011")'
        })
        return failResult(run, { error: 'GS011' }, 'execution', matched)
      }
      const refund: Effect = { kind: 'note', title: E.gasRefund, tech: T.refundTech }
      run.effects.push(refund)
      ev(run, 'exec.effect', 'Safe', 'warn', E.gasRefund, { detail: T.refundDetail, tech: T.refundTech })
    }
    if (failure !== null) {
      ev(run, 'commit', 'Safe', 'warn', T.commitNonceOnly)
      run.w.history.push({ at: run.w.now, label: tx.label ?? describeCall(run.input, run.call.to, run.call.value, run.call.data, run.call.operation), ok: false, summary: 'The call failed. Nonce used.' })
      const error = toSimError({ error: 'CallFailed', args: { inner: failure.error } }, 'execution', makeMessageFor(run.input))
      return { ok: false, error, trace: run.trace, effects: run.effects, world: run.w, encoded: run.encoded }
    }
  } else {
    try {
      executeFromSafe(x, run.call, { depth: 0 })
    } catch (e) {
      if (e instanceof Revert) return failResult(run, e.fault, 'execution', matched)
      throw e
    }
  }

  // 5. checkAfterExecution(txHash, success) on the guard read before the check.
  if (guarded) {
    const changed = !eqAddr(run.w.safe.txGuard, guardAtStart)
    ev(run, 'guard.after', 'Guard', 'pass', changed ? T.guardCaptured : T.afterOk, {
      detail: changed ? T.guardCapturedDetail : undefined,
      tech: 'checkAfterExecution(txHash, true) on the guard read before execution'
    })
  }
  return okResult(run, matched)
}

function moduleTx(run: Run, rootHints: Record<string, RuleSpec[]>): SimResult {
  const w = run.w
  const tx = run.tx
  const module = resolveAddress(w, tx.module ?? (w.safe.modules[0] ? w.safe.modules[0] : 'AllowanceModule'))
  const name = shortLabel(w, module)
  if (!w.safe.modules.some((m) => eqAddr(m, module))) {
    ev(run, 'safe.module', 'Module', 'fail', T.moduleNotEnabled(name), { tech: 'preModuleExecution: modules[msg.sender] == address(0) reverts GS104' })
    return failResult(run, { error: 'GS104' }, 'safe', undefined)
  }
  ev(run, 'safe.module', 'Module', 'pass', T.moduleEnabled(name), { tech: `execTransactionFromModule from ${module}` })
  if (tx.context !== undefined && tx.context !== null) {
    ev(run, 'safe.context', 'Module', 'warn', T.moduleContextIgnored, { detail: T.moduleContextDetail })
  }
  // preModuleExecution reads the module guard once; postModuleExecution uses the same one.
  const guarded = w.safe.moduleGuard !== null
  let matched: SimResult['matched'] = undefined
  const x: ExecCtx = { w, trace: run.trace, effects: run.effects, executor: module, rootHints }

  if (!guarded) {
    ev(run, 'safe.noGuard', 'Safe', 'warn', T.noModuleGuard, { detail: T.noModuleGuardDetail })
    const inner: ExecCtx = { ...x, w: structuredClone(w), effects: [] }
    try {
      executeFromSafe(inner, run.call, { depth: 0 })
    } catch (e) {
      if (!(e instanceof Revert)) throw e
      run.effects.push(...inner.effects.map((ef) => ({ ...ef, reverted: true })))
      ev(run, 'exec.revert', 'Safe', 'fail', T.callFailedNoRevert, {
        detail: T.callFailedNoRevertDetail,
        tech: 'execTransactionFromModule returns false'
      })
      const error = toSimError({ error: 'CallFailed', args: { inner: e.fault.error } }, 'execution', makeMessageFor(run.input))
      ev(run, 'rollback', 'Safe', 'fail', T.rollback, { detail: T.rollbackDetail(run.effects.map((ef) => ef.title)) })
      return { ok: false, error, trace: run.trace, effects: run.effects, world: run.input, encoded: run.encoded }
    }
    run.w = inner.w
    run.effects.push(...inner.effects)
    return okResult(run, matched)
  }

  // SafePolicyGuard.checkModuleTransaction: module from state, empty context.
  const ectx: EngineCtx = { w, trace: run.trace, effects: run.effects, module, signedNonce: w.safe.nonce - 1 }
  try {
    checkTransaction(ectx, run.call, EMPTY_CONTEXT, 0)
  } catch (e) {
    if (e instanceof Revert) return failResult(run, e.fault, 'guard', matchedFor(run))
    throw e
  }
  matched = matchedFor(run)
  try {
    executeFromSafe(x, run.call, { depth: 0 })
  } catch (e) {
    if (!(e instanceof Revert)) throw e
    ev(run, 'guard.after', 'Guard', 'fail', T.afterModuleFail, {
      detail: T.afterModuleFailDetail,
      tech: 'checkAfterModuleExecution(hash, false) reverts ModuleExecutionFailed()'
    })
    return failResult(run, { error: 'ModuleExecutionFailed', args: { inner: e.fault.error } }, 'guard', matched)
  }
  ev(run, 'guard.after', 'Guard', 'pass', T.afterOk, { tech: 'checkAfterModuleExecution(hash, true)' })
  return okResult(run, matched)
}

export type { Matched }
