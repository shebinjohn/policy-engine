/**
 * The simple layer's vocabulary (SIMPLE_LAYER.md §5): contracts, actions and call types in plain
 * words, rulebook rows, and "-ing" phrases for transactions. No selectors, no hex, no gas.
 */
import type { CallSpec, OperationName, SubTxSpec, TableEntry, TxSpec, World } from '../../engine/types.ts'
import { IDEAS } from '../generated/content.ts'
import { policyLabel } from './content.ts'
import { describeTableEntry, entity, fnBySelector, isZero, nameOf, ZERO_SELECTOR } from './describe.ts'
import { formatHuman } from './format.ts'

// ---------------------------------------------------------------------------------------------
// Ideas: order 0 is the home explainer, 1 to 8 the big ideas
// ---------------------------------------------------------------------------------------------

export const EXPLAINER = IDEAS.find((i) => i.order === 0) ?? null
export const BIG_IDEAS = IDEAS.filter((i) => i.order >= 1).sort((a, b) => a.order - b.order)

// ---------------------------------------------------------------------------------------------
// Contracts, actions, call types
// ---------------------------------------------------------------------------------------------

export const ACTION_WORDS: Record<string, string> = {
  transfer: 'Send tokens',
  approve: 'Let someone spend',
  transferFrom: 'Pull tokens',
  deposit: 'Wrap ETH',
  withdraw: 'Unwrap ETH',
  setGuard: 'Change the guard',
  setModuleGuard: 'Change the guard for modules',
  enableModule: 'Switch on a module',
  disableModule: 'Switch off a module',
  changeThreshold: 'Change how many owners sign',
  addOwnerWithThreshold: 'Add an owner',
  removeOwner: 'Remove an owner',
  configureImmediately: 'Change the rulebook',
  requestConfiguration: 'Change the rulebook',
  applyConfiguration: 'Change the rulebook',
  invalidateRoot: 'Change the rulebook',
  multiSend: 'Run a batch'
}

/** "USDC", "Dave", "The Safe", "Batches", "Unknown contract". */
export function contractWord(world: World, target: string): string {
  const e = entity(world, target)
  switch (e.kind) {
    case 'safe':
      return 'The Safe'
    case 'multisend':
      return 'Batches'
    case 'guard':
      return 'Policy Guard'
    case 'person':
      return e.name
    default:
      return nameOf(world, target)
  }
}

export function actionWord(selector: string): string {
  if (selector.toLowerCase() === ZERO_SELECTOR) return 'Send ETH'
  const f = fnBySelector(selector)
  return f ? (ACTION_WORDS[f.name] ?? f.label) : 'Another action'
}

export function callTypeWord(op: OperationName | undefined): string {
  return op === 'DELEGATECALL' ? 'Delegatecall' : 'Normal'
}

export interface SimpleRow {
  key: string
  access: string | null
  isElse: boolean
  contract: string
  action: string
  callType: string
  policy: string
  settings: string
  /** A placeholder "Anything else" row with no rule: blocked. */
  empty?: boolean
  /** A batch row: its call type is part of what a batch is, so it is not worth showing. */
  isBatch?: boolean
  entry?: TableEntry
}

const FALLBACK_CALL = '0x' + '0'.repeat(64)
const FALLBACK_DELEGATE = '0x0000000001' + '0'.repeat(54)

/** The rulebook as rows: specific rules first, then the "Anything else" rows. */
export function rulebookRows(
  world: World,
  opts: { showDelegate?: boolean } = {}
): { rules: SimpleRow[]; anythingElse: SimpleRow[] } {
  const entries = Object.values(world.table)
  const rules: SimpleRow[] = entries
    .filter((e) => !e.isFallback)
    .map((e) => {
      const w = describeTableEntry(world, e)
      return {
        key: e.access,
        access: e.access,
        isElse: false,
        contract: contractWord(world, e.target),
        action: actionWord(e.selector),
        callType: callTypeWord(e.operation),
        policy: w.policy,
        settings: w.config,
        entry: e,
        isBatch: entity(world, e.target).kind === 'multisend'
      }
    })
    .sort((a, b) => a.contract.localeCompare(b.contract) || a.action.localeCompare(b.action))
  const fallbackFor = (op: OperationName) => entries.find((e) => e.isFallback && e.operation === op)
  const anythingElse: SimpleRow[] = []
  for (const op of ['CALL', 'DELEGATECALL'] as OperationName[]) {
    const e = fallbackFor(op)
    if (!e && op === 'DELEGATECALL' && !opts.showDelegate) continue
    const w = e ? describeTableEntry(world, e) : null
    anythingElse.push({
      key: op === 'CALL' ? FALLBACK_CALL : FALLBACK_DELEGATE,
      access: e ? e.access : null,
      isElse: true,
      contract: 'Anything else',
      action: '',
      callType: callTypeWord(op),
      policy: w ? w.policy : 'No rule: blocked',
      settings: w ? w.config : '',
      empty: !e,
      entry: e
    })
  }
  return { rules, anythingElse }
}

// ---------------------------------------------------------------------------------------------
// Transactions in words
// ---------------------------------------------------------------------------------------------

type CallLike = { to: string; value?: string; operation?: OperationName; call?: CallSpec; data?: string }

function sym(world: World, token: string): string {
  const e = entity(world, token)
  return e.symbol ?? nameOf(world, token)
}

/** "sending USDC to Mallory", "adding Dave as an owner", "running unknown code". */
export function gerund(world: World, c: CallLike): string {
  const base = gerundOf(world, c)
  return c.operation === 'DELEGATECALL' && c.call && c.call.fn !== 'multiSend' ? `${base} as a delegatecall` : base
}

function gerundOf(world: World, c: CallLike): string {
  const a = c.call?.args ?? []
  const who = (x: unknown) => nameOf(world, String(x ?? ''))
  if (c.call) {
    switch (c.call.fn) {
      case 'transfer':
        return `sending ${sym(world, c.to)} to ${who(a[0])}`
      case 'approve':
        return Number(a[1] ?? 0) === 0
          ? `taking back ${who(a[0])}'s ${sym(world, c.to)} approval`
          : `letting ${who(a[0])} spend ${sym(world, c.to)}`
      case 'transferFrom':
        return `pulling ${sym(world, c.to)} from ${who(a[0])}`
      case 'deposit':
        return 'wrapping ETH'
      case 'withdraw':
        return 'unwrapping ETH'
      case 'setGuard':
        return isZero(world, a[0]) ? 'turning off the guard' : 'changing the guard'
      case 'setModuleGuard':
        return isZero(world, a[0]) ? 'turning off the guard for modules' : 'changing the guard for modules'
      case 'enableModule':
        return `switching on the ${who(a[0])}`
      case 'disableModule':
        return `switching off the ${who(a[0])}`
      case 'changeThreshold':
        return 'changing how many owners must sign'
      case 'addOwnerWithThreshold':
        return `adding ${who(a[0])} as an owner`
      case 'removeOwner':
        return `removing ${who(a[0])} as an owner`
      case 'multiSend':
        return 'running a batch'
      default:
        return 'changing the rulebook'
    }
  }
  const target = entity(world, c.to)
  if (c.operation === 'DELEGATECALL')
    return target.kind === 'contract' ? 'running unknown code' : `running ${nameOf(world, c.to)}'s code inside the Safe`
  if (target.kind === 'weth' && c.value && Number(c.value) > 0) return 'wrapping ETH'
  if (c.data && c.data !== '0x') return `this call to ${nameOf(world, c.to)}`
  return c.value && Number(c.value) > 0
    ? `sending ETH to ${nameOf(world, c.to)}`
    : `an empty call to ${nameOf(world, c.to)}`
}

/** "Pay Mallory 500 USDC": the sentence for a transaction card when no label is given. */
export function txSentence(world: World, c: CallLike): string {
  const a = c.call?.args ?? []
  const who = (x: unknown) => nameOf(world, String(x ?? ''))
  if (c.call) {
    switch (c.call.fn) {
      case 'transfer':
        return `Send ${formatHuman(String(a[1] ?? '0'))} ${sym(world, c.to)} to ${who(a[0])}`
      case 'approve':
        return Number(a[1] ?? 0) === 0
          ? `Take back ${who(a[0])}'s ${sym(world, c.to)} approval`
          : `Let ${who(a[0])} spend ${formatHuman(String(a[1] ?? '0'))} ${sym(world, c.to)}`
      case 'deposit':
        return `Wrap ${formatHuman(c.value || '0')} ETH`
      case 'multiSend':
        return `Run a batch of ${c.call.batch?.length ?? 0} steps`
      default: {
        const g = gerund(world, c)
        return g.charAt(0).toUpperCase() + g.slice(1)
      }
    }
  }
  if (c.operation === 'DELEGATECALL') return 'Run unknown code'
  if (entity(world, c.to).kind === 'weth' && c.value && Number(c.value) > 0) return `Wrap ${formatHuman(c.value)} ETH`
  return c.value && Number(c.value) > 0
    ? `Send ${formatHuman(c.value)} ETH to ${nameOf(world, c.to)}`
    : `Empty call to ${nameOf(world, c.to)}`
}

/** "Owners sign", "All owners sign, co-signed", "Allowance Module". */
export function whoWord(world: World, tx: TxSpec | SubTxSpec): string {
  const t = tx as TxSpec
  if (t.path === 'module') return nameOf(world, t.module ?? '')
  const parts = ['Owners sign']
  const ctx = t.context ?? (t.call?.batch ?? []).map((s) => s.context).find(Boolean)
  if (ctx?.type === 'ownerSignatures') parts[0] = 'All owners sign'
  if (ctx?.type === 'cosignature') parts.push('co-signed')
  if (ctx?.type === 'attestation') parts.push('Safenet approved')
  return parts.join(', ')
}

export { policyLabel }
