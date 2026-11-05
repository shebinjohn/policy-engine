/**
 * Sharp edges: the engine behaviours people get wrong, named at the moment a run hits one.
 * Detection reads the trace (event ids, depth, access keys) and the result, never the copy, so it
 * stays faithful to what the engine decided. At most one edge per run: the most specific wins.
 *
 * Copy voice (Safe Research): short, declarative, no em dashes. Each edge says what people expect,
 * what happened, and why.
 */
import type { RuleSpec, SimResult, SubTxSpec, TraceEvent, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { policyLabel } from './content.ts'
import { entity } from './describe.ts'
import type { StageKey } from './pipeline.ts'

export interface SharpEdge {
  id:
    | 'catch-all-setup'
    | 'module-unguarded'
    | 'spent-undone'
    | 'batch-old-state'
    | 'weth-fallback'
    | 'zero-key'
    | 'selector-zero'
    | 'removed-rule'
    | 'catch-all'
  /** The stage of the top-level decision path it belongs under, or 'end' for the outcome. */
  stage: StageKey | 'end'
  title: string
  text: string
  /** The scenario that teaches it, for a "Learn more" link. */
  scenario?: string
}

const FALLBACK_KEYS = new Set(['0x' + '0'.repeat(64), '0x0000000001' + '0'.repeat(54)])
const isFallbackKey = (a: string | undefined) => !!a && FALLBACK_KEYS.has(a.toLowerCase())

const WETH_FNS = new Set(['deposit', 'withdraw', 'transfer', 'approve', 'transferFrom'])
/** Batch steps that change what later checks would read. */
const STATE_FNS = new Set([
  'changeThreshold',
  'addOwnerWithThreshold',
  'removeOwner',
  'applyConfiguration',
  'enableModule',
  'disableModule'
])

function configurationsOf(tx: TxSpec): RuleSpec[] {
  const out: RuleSpec[] = [...(tx.call?.configurations ?? [])]
  for (const s of tx.call?.batch ?? []) out.push(...(s.call?.configurations ?? []))
  return out
}

/** Would the Policy Guard refuse to set up this one rule on its own? Asks the engine. */
function refusedAlone(rule: RuleSpec): boolean {
  try {
    engine.createWorld({ rules: [rule], guards: { transaction: false, module: false } })
    return false
  } catch {
    return true
  }
}

function callOf(tx: TxSpec, ev: TraceEvent): (TxSpec | SubTxSpec) | undefined {
  if (ev.depth === 0) return tx
  if (ev.subTx === undefined) return undefined
  return tx.call?.batch?.[ev.subTx]
}

function dataOf(world: World, result: SimResult, tx: TxSpec, ev: TraceEvent): string {
  if (ev.depth === 0) return result.encoded.data || '0x'
  const c = callOf(tx, ev)
  if (!c) return '0x'
  try {
    return (
      engine.encode(world, { to: c.to, value: c.value, operation: c.operation, call: c.call, data: c.data }).data ||
      '0x'
    )
  } catch {
    return '0x'
  }
}

export function detectSharpEdge({
  result,
  tx,
  world,
  seenKeys
}: {
  result: SimResult
  tx: TxSpec
  /** The world the transaction ran on. */
  world: World
  /** Access keys that had a rule in any earlier state of this session or scenario. */
  seenKeys?: Set<string>
}): SharpEdge | null {
  const trace = result.trace
  const at0 = (id: string) => trace.find((e) => e.depth === 0 && e.id === id)

  // 1. A policy refused to be set up on a catch-all rule.
  if (trace.some((e) => e.id === 'exec.configure' && e.status === 'fail')) {
    const bad = configurationsOf(tx).find((r) => r.fallback && r.policy && refusedAlone(r))
    if (bad && bad.policy) {
      const label = policyLabel(bad.policy)
      const allowlist = bad.policy === 'ERC20TransferPolicy' || bad.policy === 'ERC20ApprovePolicy'
      return {
        id: 'catch-all-setup',
        stage: 'exec',
        title: allowlist ? 'An allowlist needs a token' : `${label} cannot be a catch-all`,
        text: allowlist
          ? `A catch-all rule names no token and no function, so ${label} cannot know which token it guards. The Policy Guard refused to set it up, and the whole transaction was undone.`
          : `A catch-all rule names no target and no function, and ${label} only fits a specific call. The Policy Guard refused to set it up, and the whole transaction was undone.`,
        scenario: allowlist ? 'allowlist-needs-a-token' : undefined
      }
    }
  }

  // 2. A module transaction with no module guard.
  if (tx.path === 'module' && at0('safe.noGuard')) {
    return {
      id: 'module-unguarded',
      stage: 'auth',
      title: 'Modules skip every rule without the module guard',
      text: 'You might expect the rules to cover every transaction. Only the module guard checks module transactions, and it is not installed, so no rule was read.',
      scenario: 'one-guard-is-no-guard'
    }
  }

  // 3. A one-time permission or signature was marked as used, then the failure undid it.
  if (!result.ok && result.effects.some((e) => e.kind === 'policyState' && e.reverted)) {
    return {
      id: 'spent-undone',
      stage: 'end',
      title: 'A failed transaction spends nothing',
      text: 'The check marked a one-time permission or signature as used. The transaction then failed, so that mark was undone with everything else. It can still be used.',
      scenario: 'failed-batch-keeps-grant'
    }
  }

  // 4. A batch step changed what later steps would be checked against.
  if (tx.call?.fn === 'multiSend' && trace.some((e) => e.id === 'multisend.step')) {
    const steps = tx.call.batch ?? []
    const i = steps.findIndex((s) => s.call && STATE_FNS.has(s.call.fn))
    if (i >= 0 && i < steps.length - 1) {
      return {
        id: 'batch-old-state',
        stage: 'policy',
        title: 'The batch was checked against the Safe before it ran',
        text: `You might expect step ${i + 2} to see what step ${i + 1} changes. Every step is checked before any of them runs, against the Safe as it was before the batch.`,
        scenario: 'batch-sees-old-state'
      }
    }
  }

  const fallback = trace.find((e) => e.id === 'engine.lookup.fallback' && e.status === 'pass')

  // 5. WETH's fallback wrapped ETH under a catch-all.
  if (fallback && result.ok) {
    const c = callOf(tx, fallback)
    if (c && entity(world, c.to).kind === 'weth' && !(c.call && WETH_FNS.has(c.call.fn))) {
      return {
        id: 'weth-fallback',
        stage: fallback.depth === 0 ? 'lookup' : 'policy',
        title: 'WETH wraps whatever it does not recognise',
        text: 'You might expect a call WETH has no function for to fail. WETH runs its fallback for any call it does not know, and the fallback wraps the ETH sent. This call had no rule of its own, so the catch-all let it through.',
        scenario: 'weth-fallback'
      }
    }
  }

  // 6. The zero address shares the catch-all key.
  const zeroKey = trace.find((e) => e.id === 'engine.lookup.exact' && e.status === 'pass' && isFallbackKey(e.access))
  if (zeroKey) {
    return {
      id: 'zero-key',
      stage: zeroKey.depth === 0 ? 'lookup' : 'policy',
      title: 'The zero address shares the catch-all key',
      text: 'You might expect a transfer to the zero address to need a rule of its own. Its key is the catch-all key, so the catch-all rule decided it. Whatever the catch-all allows can burn funds there.',
      scenario: 'deny-beats-catch-all'
    }
  }

  // 7. Data starting with four zero bytes is not an empty call.
  for (const ev of trace) {
    if (!((ev.id === 'engine.lookup.exact' || ev.id === 'engine.lookup.fallback') && ev.status === 'pass')) continue
    const data = dataOf(world, result, tx, ev).toLowerCase()
    if (data.length > 2 && data.startsWith('0x00000000')) {
      return {
        id: 'selector-zero',
        stage: ev.depth === 0 ? 'lookup' : 'policy',
        title: 'Four zero bytes are not an empty call',
        text: 'You might expect data to need a rule of its own. Data that starts with four zero bytes has the same key as an empty call, so it reached the rule for plain transfers. Only Plain ETH Transfer checks that the data is truly empty.',
        scenario: 'plain-eth-transfers'
      }
    }
  }

  if (fallback) {
    // 8. A rule this call used to have was removed, so it fell back to the catch-all.
    const miss = trace.find(
      (e) =>
        e.id === 'engine.lookup.exact' &&
        e.depth === fallback.depth &&
        e.subTx === fallback.subTx &&
        e.status !== 'pass'
    )
    if (miss?.access && seenKeys?.has(miss.access.toLowerCase())) {
      return {
        id: 'removed-rule',
        stage: fallback.depth === 0 ? 'lookup' : 'policy',
        title: 'Removing a rule is not denying',
        text: 'This call had a rule of its own earlier. Removing a rule does not block its calls: they fall back to the catch-all, which decided this one. To refuse them, attach Always Deny instead.',
        scenario: 'removing-is-not-denying'
      }
    }
    // 9. The catch-all decided.
    return {
      id: 'catch-all',
      stage: fallback.depth === 0 ? 'lookup' : 'policy',
      title: 'The catch-all decided',
      text: `You might expect this call to need a rule of its own. It has none, so the catch-all rule decided it${fallback.policy ? ` with ${policyLabel(fallback.policy)}` : ''}. Every call without its own rule gets the same answer.`,
      scenario: 'catch-all-cosigner'
    }
  }
  return null
}

/** Access keys with a rule in any of these worlds, for the "removed rule" edge. */
export function keysOf(worlds: (World | null | undefined)[]): Set<string> {
  const out = new Set<string>()
  for (const w of worlds) if (w) for (const k of Object.keys(w.table)) out.add(k.toLowerCase())
  return out
}
