/**
 * One transaction through Safe.execTransaction (owner path, SPEC §5) or
 * Safe.execTransactionFromModule (module path, SPEC §6), with the SafePolicyGuard hooks.
 * Pure: works on a structuredClone of the world and returns the input world on failure.
 */
import { accessSelector, decodeSelector, type Op } from './access.ts'
import { EngineInputError, eqAddr, resolveAddress, shortLabel } from './book.ts'
import { configurationRootOf, contextFor, encodeTxCall, ruleToConfiguration, toEncodedTx, type EncodedCall } from './catalog.ts'
import { checkTransaction, getPolicy, type EngineCtx, type Matched } from './engine.ts'
import { contextLength } from './policies/common.ts'
import { Revert, toSimError, type Fault } from './errors.ts'
import { describeCall, E, makeMessageFor, T } from './messages.ts'
import { executeFromSafe, type ExecCtx } from './safe.ts'
import type {
  CallSpec,
  ContextSpec,
  Effect,
  EncodedTx,
  ErrorSource,
  RuleSpec,
  SimError,
  SimResult,
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
  return { access: look.access, policy: look.entry.policy, isFallback: look.usedFallback }
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

function byAddress(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}

type SafeSigCheck = { ok: true } | { ok: false; error: 'GS020' | 'GS026'; who: string | null; duplicate?: boolean }

/**
 * Safe.checkNSignatures(executor, txHash, signatures, threshold) over the bytes the harness sends:
 * the sorted owner signatures, then (if any) the context envelope `[payload][len][typeHash]`.
 * Too few owner signatures do not give GS020 once a context makes the blob long enough: the Safe
 * reads the next 65-byte slot out of the context. A co-signature or owner signatures in the
 * context are real signatures over the same hash (gas fields zero); anything else is garbage.
 */
export function checkSafeSignatures(
  w: World,
  sorted: string[],
  context: ContextSpec,
  threshold: number,
  gasZero: boolean
): SafeSigCheck {
  const tail = context === null ? 0 : contextLength(context) + 64
  if (65 * sorted.length + tail < 65 * threshold) return { ok: false, error: 'GS020', who: null }
  const fromContext = (j: number): string | null => {
    if (!gasZero || context === null) return null
    try {
      if (context.type === 'cosignature') return j === 0 ? resolveAddress(w, context.signer) : null
      if (context.type === 'ownerSignatures') {
        const inner = context.signers.map((s) => resolveAddress(w, s)).sort(byAddress)
        return inner[j] ?? null
      }
    } catch {
      return null
    }
    return null
  }
  let last = 0n
  for (let i = 0; i < threshold; i++) {
    const who = i < sorted.length ? sorted[i] : fromContext(i - sorted.length)
    if (who === null) return { ok: false, error: 'GS026', who: null }
    const cur = BigInt(who)
    const isOwner = w.safe.owners.some((o) => eqAddr(o, who))
    if (cur <= last || !isOwner) return { ok: false, error: 'GS026', who, duplicate: isOwner }
    last = cur
  }
  return { ok: true }
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
  const sig = checkSafeSignatures(w, sorted, contextFor(tx), threshold, gasPrice === 0n && safeTxGas === 0n)
  if (!sig.ok) {
    const title =
      sig.error === 'GS020'
        ? T.signaturesTooFew(sorted.length, threshold)
        : sig.who === null
          ? T.signaturesTooFewContext(sorted.length, threshold)
          : sig.duplicate
            ? T.signaturesDuplicate(shortLabel(w, sig.who))
            : T.signaturesBad(shortLabel(w, sig.who))
    ev(run, 'safe.signatures', 'Safe', 'fail', title, {
      detail: sig.error === 'GS026' && sig.who === null ? T.signaturesContextDetail : T.signaturesDetail,
      tech:
        sig.error === 'GS020'
          ? `checkNSignatures: signatures.length < ${threshold} * 65 reverts GS020`
          : 'checkNSignatures: currentOwner <= lastOwner || owners[currentOwner] == address(0) reverts GS026'
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

  const guarded = w.safe.txGuard !== null
  let matched: SimResult['matched'] = undefined

  if (!guarded) {
    ev(run, 'safe.noGuard', 'Safe', 'warn', T.noTxGuard, { detail: T.noTxGuardDetail })
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
      checkTransaction(ectx, run.call, contextFor(tx), 0)
    } catch (e) {
      if (e instanceof Revert) return failResult(run, e.fault, 'guard', matchedFor(run))
      throw e
    }
    matched = matchedFor(run)
  }

  // 4. execute(to, value, data, operation, gas)
  const x: ExecCtx = { w, trace: run.trace, effects: run.effects, executor: sorted[0] ?? w.safe.owners[0], rootHints }
  const swallow = !guarded && (safeTxGas !== 0n || gasPrice !== 0n)
  if (swallow) {
    const inner: ExecCtx = { ...x, w: structuredClone(w), effects: [] }
    try {
      executeFromSafe(inner, run.call, { depth: 0 })
      run.w = inner.w
      run.effects.push(...inner.effects)
    } catch (e) {
      if (!(e instanceof Revert)) throw e
      run.effects.push(...inner.effects.map((ef) => ({ ...ef, reverted: true })))
      ev(run, 'exec.revert', 'Safe', 'warn', T.callFailedNoRevert, {
        detail: 'With a Safe transaction gas limit set, the Safe records the failure and keeps the nonce increment.',
        tech: 'success == false && safeTxGas != 0: ExecutionFailure, no revert'
      })
      ev(run, 'commit', 'Safe', 'warn', 'Only the nonce change is saved')
      run.w.history.push({ at: run.w.now, label: tx.label ?? describeCall(run.input, run.call.to, run.call.value, run.call.data, run.call.operation), ok: false, summary: 'The call failed. Nonce used.' })
      const error = toSimError({ error: 'CallFailed', args: { inner: e.fault.error } }, 'execution', makeMessageFor(run.input))
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

  // 5. checkAfterExecution(txHash, success)
  if (guarded) ev(run, 'guard.after', 'Guard', 'pass', T.afterOk, { tech: 'checkAfterExecution(txHash, true)' })
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
    checkTransaction(ectx, run.call, null, 0)
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

/** Used by `lookup()`: getPolicy without side effects. */
export function lookupCall(world: World, to: string, data: string, op: Op) {
  return getPolicy(world, to, data, op)
}

export type { Matched }
