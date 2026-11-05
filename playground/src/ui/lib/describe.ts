/**
 * Plain-language descriptions of entities, rules, transactions and expectations. This is where the
 * playground's vocabulary lives: Rule, Catch-all rule, Policy, Owner transaction, Module transaction.
 */
import { AbiCoder } from 'ethers'
import type {
  CallSpec,
  ContextSpec,
  Entity,
  EntityKind,
  Expectation,
  FunctionInfo,
  OperationName,
  PermissionName,
  PolicyConfig,
  PolicyName,
  RuleSpec,
  TableEntry,
  TxSpec,
  World
} from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { errorInfo, policyLabel } from './content.ts'
import { formatHuman, formatUnits, isAddress, joinNames, plural, shortAddress } from './format.ts'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ZERO_SELECTOR = '0x00000000'
export const CONFIG_FNS = ['configureImmediately', 'requestConfiguration', 'applyConfiguration', 'invalidateRoot']
export const MANAGE_FNS = ['requestConfiguration', 'applyConfiguration', 'invalidateRoot']

// ---------------------------------------------------------------------------------------------
// Function catalog
// ---------------------------------------------------------------------------------------------

let catalogCache: FunctionInfo[] | null = null
export function catalog(): FunctionInfo[] {
  if (!catalogCache) {
    try {
      catalogCache = engine.functions()
    } catch {
      catalogCache = []
    }
  }
  return catalogCache
}

export function fnByName(name: string | undefined): FunctionInfo | undefined {
  return name ? catalog().find((f) => f.name === name) : undefined
}

export function fnBySelector(selector: string | undefined): FunctionInfo | undefined {
  if (!selector) return undefined
  const s = selector.toLowerCase()
  return catalog().find((f) => f.selector.toLowerCase() === s)
}

export function fnsFor(kind: EntityKind | undefined): FunctionInfo[] {
  if (!kind) return []
  return catalog().filter((f) => f.on.includes(kind))
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

export function entity(world: World, x: string): Entity {
  try {
    return engine.resolve(world, x)
  } catch {
    const known = world.book.find((e) => e.name === x || e.address.toLowerCase() === x.toLowerCase())
    return known ?? { name: x, label: shortAddress(x), address: x, kind: 'contract' }
  }
}

/** Short display name: "Dave", "USDC", "Allowance Module", "0x1234…abcd". */
export function nameOf(world: World, x: string | undefined): string {
  if (!x) return 'nobody'
  if (x === ZERO_ADDRESS || x === 'Zero') return 'the zero address'
  const e = entity(world, x)
  const inBook = world.book.some((b) => b.address.toLowerCase() === e.address.toLowerCase())
  if (!inBook) return shortAddress(e.address || x)
  if (e.kind === 'person') return e.name
  return e.label || e.name
}

/** The canonical book name for a name or address, or the address itself when it is not in the book. */
export function keyOf(world: World, x: string): string {
  if (!isAddress(x)) return x
  const hit = world.book.find((b) => b.address.toLowerCase() === x.toLowerCase())
  return hit ? hit.name : x
}

export function isZero(world: World, x: unknown): boolean {
  if (typeof x !== 'string') return false
  if (x === 'Zero' || x.toLowerCase() === ZERO_ADDRESS) return true
  return false
}

export function sameAddress(world: World, a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return entity(world, a).address.toLowerCase() === entity(world, b).address.toLowerCase()
}

export function ownerNames(world: World): string[] {
  return world.safe.owners.map((o) => keyOf(world, o))
}

export function moduleNames(world: World): string[] {
  return world.safe.modules.map((m) => keyOf(world, m))
}

/** The engine's default signers: the first `threshold` owners. */
export function defaultSigners(world: World): string[] {
  return ownerNames(world).slice(0, world.safe.threshold)
}

export function opWord(op: OperationName | undefined): string {
  return op === 'DELEGATECALL' ? 'delegatecall' : 'normal call'
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const PERMS: PermissionName[] = ['NONE', 'ONCE', 'ALWAYS']

/** Decode the bytes a rule passed to `configure` back into the friendly config. */
export function decodeConfig(world: World, policy: PolicyName, data: string): PolicyConfig | null {
  if (!data || data === '0x') return {}
  const coder = AbiCoder.defaultAbiCoder()
  try {
    switch (policy) {
      case 'ERC20TransferPolicy':
      case 'ERC20ApprovePolicy': {
        const [list] = coder.decode(['tuple(address,uint8)[]'], data)
        const rows = (list as unknown as [string, bigint][]).map(([a, p]) => ({
          account: keyOf(world, a),
          permission: PERMS[Number(p)] ?? 'NONE'
        }))
        return policy === 'ERC20TransferPolicy' ? { recipients: rows } : { spenders: rows }
      }
      case 'CoSignerPolicy': {
        const [a] = coder.decode(['address'], data)
        return { cosigner: keyOf(world, a as string) }
      }
      case 'IncreasedThresholdPolicy': {
        const [n] = coder.decode(['uint256'], data)
        return { maxAbsent: Number(n) }
      }
      case 'AllowedModulePolicy': {
        const [m, ok] = coder.decode(['address', 'bool'], data)
        return { module: keyOf(world, m as string), allowed: Boolean(ok) }
      }
      case 'OneTimeAllowPolicy': {
        const [b] = coder.decode(['bool'], data)
        return { granted: Boolean(b) }
      }
      default:
        return {}
    }
  } catch {
    return null
  }
}

const permWord = (p: PermissionName) => (p === 'ALWAYS' ? 'always' : p === 'ONCE' ? 'once' : 'not allowed')

/** "Dave always, Erin once". Empty string when the policy has no settings. */
export function describeConfig(
  world: World,
  policy: PolicyName | null,
  config: PolicyConfig | null | undefined
): string {
  if (!policy || !config) return ''
  const c = config as Record<string, unknown>
  switch (policy) {
    case 'ERC20TransferPolicy':
    case 'ERC20ApprovePolicy': {
      const rows = ((c.recipients ?? c.spenders ?? []) as { account: string; permission: PermissionName }[]).filter(
        Boolean
      )
      if (rows.length === 0) return 'nobody listed'
      return rows.map((r) => `${nameOf(world, r.account)} ${permWord(r.permission)}`).join(', ')
    }
    case 'CoSignerPolicy':
      return c.cosigner ? `signed by ${nameOf(world, c.cosigner as string)}` : ''
    case 'IncreasedThresholdPolicy': {
      const owners = world.safe.owners.length
      const maxAbsent = Number(c.maxAbsent ?? 0)
      const required = Math.min(owners, Math.max(world.safe.threshold + 1, owners - maxAbsent))
      return `${required} of ${owners} owners must sign`
    }
    case 'AllowedModulePolicy':
      return c.module ? `${nameOf(world, c.module as string)}${c.allowed === false ? ' not allowed' : ' only'}` : ''
    case 'OneTimeAllowPolicy':
      return c.granted === false ? 'no use granted' : 'one use granted'
    default:
      return ''
  }
}

export interface RuleWords {
  isFallback: boolean
  target: string // "USDC" or "Any target"
  action: string // "Send tokens"
  op: string // "normal call"
  policy: string // "Recipient Allowlist" or "Remove rule"
  config: string // "Dave always"
  removes: boolean
}

export function actionLabel(selector: string): string {
  if (selector.toLowerCase() === ZERO_SELECTOR) return 'Send ETH only (no data)'
  const f = fnBySelector(selector)
  return f ? f.label : `Function ${selector}`
}

const eqHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The rule's settings as they stand now, read from the policy's stored state where it changes on
 * use (spent one-time permissions and grants). Falls back to the configured bytes when the state
 * cannot be read. The state shape is engine-internal, so every read is defensive.
 */
function liveDescription(world: World, entry: TableEntry): string | null {
  try {
    const st = (world.policyState as Record<string, Record<string, unknown>> | undefined)?.[entry.policy]
    if (entry.policy === 'ERC20TransferPolicy' || entry.policy === 'ERC20ApprovePolicy') {
      const table = (st?.recipients ?? st?.spenders) as Record<string, Record<string, number>> | undefined
      const configured = decodeConfig(world, entry.policy, entry.data) as {
        recipients?: { account: string; permission: PermissionName }[]
        spenders?: { account: string; permission: PermissionName }[]
      } | null
      const rows = configured?.recipients ?? configured?.spenders ?? []
      if (!table) return null
      const tokenKey = Object.keys(table).find((k) => eqHex(k, entry.target))
      const live = tokenKey ? table[tokenKey] : {}
      const parts = Object.entries(live).map(
        ([acct, perm]) => `${nameOf(world, acct)} ${perm === 2 ? 'always' : 'once'}`
      )
      for (const r of rows) {
        const addr = entity(world, r.account).address
        if (r.permission === 'ONCE' && !Object.keys(live).some((k) => eqHex(k, addr)))
          parts.push(`${nameOf(world, r.account)} once, used`)
      }
      return parts.length ? parts.join(', ') : 'nobody listed'
    }
    if (entry.policy === 'OneTimeAllowPolicy') {
      const grants = st?.grants as Record<string, unknown> | undefined
      if (!grants) return 'used, no use left'
      return Object.keys(grants).some((k) => eqHex(k, entry.access)) ? 'one use left' : 'used, no use left'
    }
  } catch {
    return null
  }
  return null
}

export function describeTableEntry(world: World, entry: TableEntry): RuleWords {
  const config = decodeConfig(world, entry.policy, entry.data)
  const live = liveDescription(world, entry)
  return {
    isFallback: entry.isFallback,
    target: entry.isFallback ? 'Any target' : nameOf(world, entry.target),
    action: entry.isFallback ? 'Any action' : actionLabel(entry.selector),
    op: opWord(entry.operation),
    policy: policyLabel(entry.policy),
    config: live ?? describeConfig(world, entry.policy, config),
    removes: false
  }
}

function selectorOf(spec: RuleSpec): string {
  const s = spec.selector ?? 'none'
  if (s === 'none') return ZERO_SELECTOR
  if (/^0x[0-9a-fA-F]{8}$/.test(s)) return s
  return fnByName(s)?.selector ?? s
}

export function describeRuleSpec(world: World, spec: RuleSpec): RuleWords {
  const isFallback = Boolean(spec.fallback)
  const op = spec.fallback ?? spec.operation ?? 'CALL'
  let config: PolicyConfig | null | undefined = spec.config
  if (spec.policy && spec.data && !spec.config) config = decodeConfig(world, spec.policy, spec.data)
  return {
    isFallback,
    target: isFallback ? 'Any target' : nameOf(world, spec.target ?? ''),
    action: isFallback ? 'Any action' : actionLabel(selectorOf(spec)),
    op: opWord(op),
    policy: spec.policy ? policyLabel(spec.policy) : 'Remove rule',
    config: describeConfig(world, spec.policy, config),
    removes: spec.policy === null
  }
}

/** One line, e.g. "USDC: Send tokens (normal call) → Recipient Allowlist: Dave always". */
export function ruleLine(w: RuleWords): string {
  const left = w.isFallback ? `Catch-all for every ${w.op}` : `${w.target}: ${w.action} (${w.op})`
  const right = w.removes ? 'remove this rule' : w.config ? `${w.policy}: ${w.config}` : w.policy
  return `${left} → ${right}`
}

/** A RuleSpec that re-creates (or, with policy null, removes) a table entry. */
export function ruleSpecFromEntry(world: World, entry: TableEntry, policy?: PolicyName | null): RuleSpec {
  const p = policy === undefined ? entry.policy : policy
  const base: RuleSpec = entry.isFallback
    ? { fallback: entry.operation, operation: entry.operation, policy: p }
    : {
        target: keyOf(world, entry.target),
        selector: fnBySelector(entry.selector)?.name ?? (entry.selector === ZERO_SELECTOR ? 'none' : entry.selector),
        operation: entry.operation,
        policy: p
      }
  if (p && p === entry.policy) {
    const config = decodeConfig(world, entry.policy, entry.data)
    if (config) base.config = config
    else base.data = entry.data
  }
  return base
}

/** Same key (target, selector, operation) as another rule? */
export function sameRuleKey(world: World, a: RuleSpec, b: RuleSpec): boolean {
  if (Boolean(a.fallback) !== Boolean(b.fallback)) return false
  if (a.fallback) return (a.fallback ?? a.operation) === (b.fallback ?? b.operation)
  return (
    sameAddress(world, a.target, b.target) &&
    selectorOf(a).toLowerCase() === selectorOf(b).toLowerCase() &&
    (a.operation ?? 'CALL') === (b.operation ?? 'CALL')
  )
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

function amountWithSymbol(world: World, token: string, amount: unknown): string {
  const e = entity(world, token)
  const sym = e.symbol ?? e.label ?? e.name
  return `${formatHuman(String(amount ?? '0'))} ${sym}`
}

export interface CallLike {
  to: string
  value?: string
  operation?: OperationName
  call?: CallSpec
  data?: string
}

/** "Send 1,200 USDC to Dave", "Remove the transaction guard", "Run a batch of 2 steps". */
export function describeCall(world: World, c: CallLike): string {
  const to = c.to
  const a = c.call?.args ?? []
  const value = c.value && Number(c.value) > 0 ? c.value : ''
  let text: string
  if (c.call) {
    const n = c.call.configurations?.length ?? 0
    switch (c.call.fn) {
      case 'transfer':
        text = `Send ${amountWithSymbol(world, to, a[1])} to ${nameOf(world, String(a[0] ?? ''))}`
        break
      case 'approve':
        text =
          Number(a[1] ?? 0) === 0
            ? `Revoke ${nameOf(world, String(a[0] ?? ''))}'s ${entity(world, to).symbol ?? nameOf(world, to)} allowance`
            : `Let ${nameOf(world, String(a[0] ?? ''))} spend ${amountWithSymbol(world, to, a[1])}`
        break
      case 'transferFrom':
        text = `Move ${amountWithSymbol(world, to, a[2])} from ${nameOf(world, String(a[0] ?? ''))} to ${nameOf(world, String(a[1] ?? ''))}`
        break
      case 'deposit':
        text = `Wrap ${formatHuman(value || '0')} ETH into WETH`
        break
      case 'withdraw':
        text = `Unwrap ${formatHuman(String(a[0] ?? '0'))} WETH`
        break
      case 'setGuard':
        text = isZero(world, a[0])
          ? 'Remove the transaction guard'
          : `Set the transaction guard to ${nameOf(world, String(a[0] ?? ''))}`
        break
      case 'setModuleGuard':
        text = isZero(world, a[0])
          ? 'Remove the module guard'
          : `Set the module guard to ${nameOf(world, String(a[0] ?? ''))}`
        break
      case 'enableModule':
        text = `Enable ${nameOf(world, String(a[0] ?? ''))}`
        break
      case 'disableModule':
        text = `Disable ${nameOf(world, String(a[0] ?? ''))}`
        break
      case 'changeThreshold':
        text = `Change the threshold to ${a[0] ?? '?'}`
        break
      case 'addOwnerWithThreshold':
        text = `Add ${nameOf(world, String(a[0] ?? ''))} as an owner, threshold ${a[1] ?? '?'}`
        break
      case 'removeOwner':
        text = `Remove ${nameOf(world, String(a[0] ?? ''))} as an owner, threshold ${a[1] ?? '?'}`
        break
      case 'configureImmediately':
        text = `Set ${plural(n, 'rule')} immediately`
        break
      case 'requestConfiguration':
        text = `Propose a change set of ${plural(n, 'rule')}`
        break
      case 'applyConfiguration':
        text = `Apply a change set of ${plural(n, 'rule')}`
        break
      case 'invalidateRoot':
        text = 'Cancel a proposed change set'
        break
      case 'multiSend':
        text = `Run a batch of ${plural(c.call.batch?.length ?? 0, 'step')}`
        break
      default: {
        const f = fnByName(c.call.fn)
        text = `${f?.label ?? c.call.fn} on ${nameOf(world, to)}`
      }
    }
    if (value && c.call.fn !== 'deposit') text += `, with ${formatHuman(value)} ETH`
  } else if (c.data && c.data !== '0x') {
    text = `Call ${nameOf(world, to)} with custom data${value ? `, with ${formatHuman(value)} ETH` : ''}`
  } else {
    text = value ? `Send ${formatHuman(value)} ETH to ${nameOf(world, to)}` : `Empty call to ${nameOf(world, to)}`
  }
  if (c.operation === 'DELEGATECALL') text += ' as a delegatecall'
  return text
}

export function describeWho(world: World, tx: TxSpec): string {
  if (tx.path === 'module') return `${nameOf(world, tx.module ?? '')} executes`
  const signers = tx.signers ?? defaultSigners(world)
  return `${joinNames(signers.map((s) => nameOf(world, s)))} ${signers.length === 1 ? 'signs' : 'sign'}`
}

export function describeContext(world: World, ctx: ContextSpec | undefined): string {
  if (!ctx) return ''
  switch (ctx.type) {
    case 'cosignature':
      return `Co-signature from ${nameOf(world, ctx.signer)}${ctx.over === 'batch' ? ', over the whole batch' : ''}`
    case 'ownerSignatures':
      return `Extra owner signatures: ${joinNames(ctx.signers.map((s) => nameOf(world, s)))}`
    case 'attestation':
      return `Safenet attestation, ${ctx.key} key, ${ctx.valid ? 'valid' : 'invalid'}`
    case 'batch':
      return `${plural(ctx.items.length, 'context item')}`
  }
}

/** "Allowed" or "Blocked by Recipient Allowlist: Recipient Not Allowed". */
export function describeExpectation(e: Expectation): string {
  if (e.ok) return 'Allowed'
  let by = e.by
  let policy = e.policy
  let error = e.error
  let r = e.reason
  while (r) {
    if (r.policy) policy = r.policy
    if (r.error) error = r.error
    if (r.by) by = r.by
    r = r.reason
  }
  const title = error ? (errorInfo(error, policy)?.title ?? error) : ''
  const verb = by === 'execution' ? 'Fails during execution' : 'Blocked'
  const who = policy
    ? ` by ${policyLabel(policy)}`
    : by === 'safe'
      ? ' by the Safe'
      : by === 'guard'
        ? ' by the Policy Guard'
        : ''
  return `${verb}${by === 'execution' ? '' : who}${title ? `: ${title}` : ''}`
}

/** A holder's balances, formatted, in book order of assets. */
export function balanceRows(world: World, holder: string): { asset: string; amount: string; symbol: string }[] {
  const rows: { asset: string; amount: string; symbol: string }[] = []
  const addr = holder.toLowerCase()
  for (const [asset, holders] of Object.entries(world.balances)) {
    const hit = Object.entries(holders).find(([h]) => h.toLowerCase() === addr)
    if (!hit) continue
    if (asset === 'ETH') rows.push({ asset, amount: formatUnits(hit[1], 18), symbol: 'ETH' })
    else {
      const e = world.book.find((b) => b.address.toLowerCase() === asset.toLowerCase())
      rows.push({ asset, amount: formatUnits(hit[1], e?.decimals ?? 18), symbol: e?.symbol ?? nameOf(world, asset) })
    }
  }
  return rows
}
