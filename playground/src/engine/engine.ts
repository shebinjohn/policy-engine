/**
 * PolicyEngine.checkTransaction (contracts/core/PolicyEngine.sol) with the SafePolicyGuard
 * `_allowedCalls` override, getPolicy lookup, and `_confirmPolicy`.
 */
import { ethers } from 'ethers'

import {
  accessSelector,
  decodeSelector,
  fallbackAccess,
  isFallbackAccess,
  opName,
  parseAccess,
  type Op
} from './access.ts'
import { ZERO, addressOf, eqAddr, policyAddress, policyAt } from './book.ts'
import { SELECTORS, type Configuration } from './catalog.ts'
import { Revert, type Fault } from './errors.ts'
import { describeAccess, describeConfigData, describeRule, E, functionTech, policyLabel, T } from './messages.ts'
import { POLICIES, type CheckCtx, type SubCall } from './policies/index.ts'
import type { ContextSpec, Effect, PolicyName, TableEntry, TraceEvent, TraceStatus, World } from './types.ts'

export interface Matched {
  access: string
  policy: PolicyName
  isFallback: boolean
}

export interface LookupResult {
  exact: string
  access: string
  entry: TableEntry | null
  usedFallback: boolean
}

function findEntry(w: World, access: string): TableEntry | undefined {
  return w.table[access.toLowerCase()]
}

/** `PolicyEngine.getPolicy`. Throws Revert(InvalidSelector) for 1-3 bytes of data. */
export function getPolicy(w: World, to: string, data: string, op: Op): LookupResult {
  const sel = decodeSelector(data)
  if (!sel.ok) throw new Revert({ error: 'InvalidSelector' })
  const exact = accessSelector(to, sel.selector, op)
  const hit = findEntry(w, exact)
  if (hit) return { exact, access: exact, entry: hit, usedFallback: false }
  const fb = fallbackAccess(op)
  const fbHit = findEntry(w, fb)
  if (fbHit) return { exact, access: fb, entry: fbHit, usedFallback: true }
  return { exact, access: fb, entry: null, usedFallback: false }
}

function push(
  ctx: { trace: TraceEvent[] },
  depth: number,
  subTx: number | undefined,
  ev: { id: string; actor: TraceEvent['actor']; status: TraceStatus; title: string; detail?: string; tech?: string; policy?: PolicyName; access?: string }
): void {
  const out: TraceEvent = { id: ev.id, depth, actor: ev.actor, status: ev.status, title: ev.title }
  if (ev.detail) out.detail = ev.detail
  if (ev.tech) out.tech = ev.tech
  if (ev.policy) out.policy = ev.policy
  if (ev.access) out.access = ev.access
  if (subTx !== undefined) out.subTx = subTx
  ctx.trace.push(out)
}

export interface EngineCtx {
  w: World
  trace: TraceEvent[]
  effects: Effect[]
  module: string | null
  signedNonce: number
}

const CONFIG_SELECTORS = new Set<string>([
  SELECTORS.requestConfiguration,
  SELECTORS.applyConfiguration,
  SELECTORS.invalidateRoot
])

/**
 * `PolicyEngine.checkTransaction(safe, to, value, data, operation, context)`.
 * Returns the matched entry (null when `_allowedCalls` let it through). Throws Revert on denial.
 */
export function checkTransaction(
  ectx: EngineCtx,
  call: SubCall,
  context: ContextSpec,
  depth: number,
  subTx?: number
): Matched | null {
  const w = ectx.w
  const guard = addressOf(w, 'PolicyGuard')

  // _allowedCalls decodes the selector first: 1-3 bytes revert InvalidSelector here.
  const sel = decodeSelector(call.data)
  if (!sel.ok) {
    const n = ethers.dataLength(call.data)
    push(ectx, depth, subTx, {
      id: 'engine.selector',
      actor: 'Engine',
      status: 'fail',
      title: T.selectorBad(n),
      detail: T.selectorBadDetail,
      tech: `PolicyEngine._decodeSelector: data.length == ${n} reverts InvalidSelector()`
    })
    throw new Revert({ error: 'InvalidSelector' })
  }
  const selector = sel.selector
  {
    const len = ethers.dataLength(call.data)
    let title: string
    let detail: string | undefined
    if (len === 0) {
      title = T.selectorEmpty
      detail = T.selectorEmptyDetail
    } else if (selector === '0x00000000') {
      title = T.selectorZero
      detail = T.selectorEmptyDetail
    } else {
      const fnTech = functionTech(selector)
      title = fnTech === selector ? T.selectorUnknown : T.selectorOk(fnTech.split('(')[0])
    }
    push(ectx, depth, subTx, {
      id: 'engine.selector',
      actor: 'Engine',
      status: 'info',
      title,
      detail,
      tech: `selector ${selector}${len > 0 ? ` (${functionTech(selector)})` : ''}, operation ${opName(call.operation)}`
    })
  }

  const allowed =
    eqAddr(call.to, guard) && call.value === 0n && call.operation === 0 && CONFIG_SELECTORS.has(selector)
  if (allowed) {
    if (ectx.module !== null) {
      push(ectx, depth, subTx, {
        id: 'engine.allowedCall',
        actor: 'Engine',
        status: 'fail',
        title: T.allowedCallModule,
        detail: T.allowedCallModuleDetail,
        tech: 'SafePolicyGuard._allowedCalls is true and $checkingModule != address(0): ModuleConfigurationDenied()'
      })
      throw new Revert({ error: 'ModuleConfigurationDenied' })
    }
    push(ectx, depth, subTx, {
      id: 'engine.allowedCall',
      actor: 'Engine',
      status: 'pass',
      title: T.allowedCall,
      detail: T.allowedCallDetail,
      tech: `SafePolicyGuard._allowedCalls: ${functionTech(selector)} on the guard, value 0, CALL`
    })
    return null
  }

  if (eqAddr(call.to, guard)) {
    push(ectx, depth, subTx, {
      id: 'engine.guardTarget',
      actor: 'Engine',
      status: 'fail',
      title: T.guardTarget,
      detail: T.guardTargetDetail,
      tech: 'require(to != address(this), GuardTargetDenied())'
    })
    throw new Revert({ error: 'GuardTargetDenied' })
  }

  const look = getPolicy(w, call.to, call.data, call.operation)
  const what = describeAccess(w, look.exact)
  if (look.entry && !look.usedFallback) {
    const zeroKey = look.entry.isFallback
    push(ectx, depth, subTx, {
      id: 'engine.lookup.exact',
      actor: 'Engine',
      status: 'pass',
      title: zeroKey ? T.zeroKeyHit(policyLabel(look.entry.policy)) : T.exactHit(what, policyLabel(look.entry.policy)),
      detail: zeroKey ? T.zeroKeyHitDetail : undefined,
      tech: `$policies[safe][${look.exact}] = ${look.entry.policy}`,
      policy: look.entry.policy,
      access: look.exact
    })
  } else {
    push(ectx, depth, subTx, {
      id: 'engine.lookup.exact',
      actor: 'Engine',
      status: 'skip',
      title: T.exactMiss(what),
      tech: `$policies[safe][${look.exact}] = address(0)`,
      access: look.exact
    })
    if (look.entry) {
      push(ectx, depth, subTx, {
        id: 'engine.lookup.fallback',
        actor: 'Engine',
        status: 'pass',
        title: T.fallbackHit,
        detail: T.fallbackHitDetail(policyLabel(look.entry.policy), call.operation === 1 ? 'delegatecalls' : 'calls'),
        tech: `AccessSelector.createFallback(${opName(call.operation)}) = ${look.access} -> ${look.entry.policy}`,
        policy: look.entry.policy,
        access: look.access
      })
    } else {
      push(ectx, depth, subTx, {
        id: 'engine.lookup.none',
        actor: 'Engine',
        status: 'fail',
        title: T.noRule,
        detail: T.noRuleDetail,
        tech: `no entry for ${look.exact} nor fallback ${look.access}: AccessDenied(address(0))`,
        access: look.access
      })
      throw new Revert({ error: 'AccessDenied', policy: null, args: { policy: ZERO } })
    }
  }

  const entry = look.entry
  const impl = POLICIES[entry.policy]
  const pctx: CheckCtx = {
    w,
    trace: ectx.trace,
    effects: ectx.effects,
    module: ectx.module,
    signedNonce: ectx.signedNonce,
    recurse: (sub, subContext, d, i) => {
      checkTransaction(ectx, sub, subContext, d, i)
    }
  }
  let magic: boolean
  try {
    magic = impl.check(pctx, {
      safe: w.safe.address,
      to: call.to,
      value: call.value,
      data: call.data,
      operation: call.operation,
      context,
      access: look.access,
      depth,
      subTx
    })
  } catch (e) {
    if (e instanceof Revert) {
      throw new Revert({
        error: 'PolicyReverted',
        policy: entry.policy,
        reason: e.fault,
        args: { policy: policyAddress(w, entry.policy) }
      })
    }
    throw e
  }
  if (!magic) {
    throw new Revert({ error: 'AccessDenied', policy: entry.policy, args: { policy: policyAddress(w, entry.policy) } })
  }
  return { access: look.access, policy: entry.policy, isFallback: look.usedFallback || entry.isFallback }
}

// ---------------------------------------------------------------------------------------------
// Rule confirmation
// ---------------------------------------------------------------------------------------------

/**
 * `PolicyEngine._confirmPolicy`: set (or delete) the table entry, then call the policy's
 * configure. Throws Revert(PolicyConfigurationFailed) when configure returns false, or the
 * policy's own revert. Mutates `w`.
 */
export function confirmPolicy(w: World, conf: Configuration, effects: Effect[] | null): void {
  const access = accessSelector(conf.target, conf.selector, conf.operation)
  if (eqAddr(conf.policy, ZERO)) {
    const had = w.table[access] !== undefined
    delete w.table[access]
    effects?.push({
      kind: 'rule',
      title: E.ruleRemoved(describeRule(w, access, null)),
      tech: `_updatePolicy(safe, ${access}, address(0))${had ? '' : ' (there was no entry)'}`
    })
    return
  }
  const policy = policyAt(w, conf.policy)
  if (!policy) {
    // configure() on an address without the function: empty return data fails to decode.
    throw new Revert({
      error: 'Reverted',
      message: 'That address is not a policy, so it cannot be configured.'
    })
  }
  const parsed = parseAccess(access)
  w.table[access] = {
    access,
    target: parsed.target,
    selector: parsed.selector,
    operation: opName(parsed.op),
    policy,
    isFallback: isFallbackAccess(access),
    data: conf.data
  }
  let ok: boolean
  try {
    ok = POLICIES[policy].configure(w, access, conf.data)
  } catch (e) {
    if (e instanceof Revert) {
      const f: Fault = { ...e.fault }
      if (!f.message) f.message = configureFailMessage(policy, f.error)
      throw new Revert(f)
    }
    throw e
  }
  if (!ok) {
    throw new Revert({
      error: 'PolicyConfigurationFailed',
      message: `${policyLabel(policy)} cannot be attached to ${describeAccess(w, access)}.`
    })
  }
  effects?.push({
    kind: 'rule',
    title: E.ruleSet(describeRule(w, access, policy, describeConfigData(w, policy, conf.data))),
    tech: `_confirmPolicy(safe, ${conf.target}, ${conf.selector}, ${opName(conf.operation)}, ${policy}, ${conf.data})`
  })
}

function configureFailMessage(policy: PolicyName, error: string): string {
  if (error === 'Reverted') return `${policyLabel(policy)} could not read its settings.`
  if (error === 'InvalidSelector') {
    return policy === 'ERC20ApprovePolicy'
      ? 'The Spender Allowlist can only be attached to approve.'
      : 'The Recipient Allowlist can only be attached to transfer or transferFrom.'
  }
  if (error === 'InvalidOperation') return `${policyLabel(policy)} can only be attached to plain calls, not delegatecalls.`
  if (error === 'InvalidModule') return 'The Module Allowlist needs a module address, not the zero address.'
  return `${policyLabel(policy)} rejected its settings (${error}).`
}
