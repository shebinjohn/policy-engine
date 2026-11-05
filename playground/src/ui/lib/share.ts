/**
 * Setup codes: a Sandbox run as text made of lowercase letters and digits only, so it survives an
 * artifact link (`#run-<code>`, a plain #name) and any chat. A code carries the Safe as it is now
 * (owners, threshold, modules, guards, balances, allowances, rules with their current settings,
 * waiting period) and one transaction. The clock, waiting change sets and used signatures stay
 * behind.
 *
 * Format, version 1: "1" + base32( payload ) + 2 check characters.
 *   payload = ASCII JSON of { s: SetupSpec, t: TxSpec } where every quoted string found in DICT_V1
 *   is replaced by one byte 0x80 + its index. Base32 alphabet: a-z then 2-7.
 * DICT_V1 is frozen: never reorder or remove an entry. A new entry or format means version 2.
 */
import type { PermissionName, PolicyConfig, RuleSpec, SetupSpec, TableEntry, TxSpec, World } from '../../engine/types.ts'
import { decodeConfig, entity, keyOf, moduleNames, ownerNames, ruleSpecFromEntry } from './describe.ts'
import { formatUnits } from './format.ts'

export const SHARE_VERSION = '1'

const DICT_V1: readonly string[] = [
  // address book
  'Safe', 'PolicyGuard', 'MultiSend', 'USDC', 'SAFE', 'WETH', 'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Mallory',
  'CoSigner', 'AllowanceModule', 'RecoveryModule', 'MysteryContract', 'Zero', 'ETH',
  // policies
  'AllowPolicy', 'DenyPolicy', 'OneTimeAllowPolicy', 'AllowedModulePolicy', 'NativeTransferPolicy', 'ERC20TransferPolicy',
  'ERC20ApprovePolicy', 'MultiSendPolicy', 'CoSignerPolicy', 'IncreasedThresholdPolicy', 'SafenetPolicy',
  // functions and enums
  'transfer', 'approve', 'transferFrom', 'deposit', 'withdraw', 'setGuard', 'setModuleGuard', 'enableModule', 'disableModule',
  'changeThreshold', 'addOwnerWithThreshold', 'removeOwner', 'configureImmediately', 'requestConfiguration',
  'applyConfiguration', 'invalidateRoot', 'multiSend', 'none', 'CALL', 'DELEGATECALL', 'ALWAYS', 'ONCE', 'NONE',
  'owner', 'module', 'cosignature', 'ownerSignatures', 'attestation', 'batch', 'self', 'trusted', 'untrusted',
  // keys
  's', 't', 'to', 'value', 'operation', 'call', 'fn', 'args', 'configurations', 'data', 'context', 'type', 'signer',
  'over', 'signers', 'key', 'valid', 'items', 'path', 'safeTxGas', 'gasPrice', 'label', 'owners', 'threshold', 'modules',
  'balances', 'allowances', 'rules', 'guards', 'transaction', 'delay', 'expiry', 'target', 'selector', 'policy', 'config',
  'fallback', 'recipients', 'spenders', 'account', 'permission', 'cosigner', 'maxAbsent', 'allowed', 'granted', 'token',
  'spender', 'amount',
  // common amounts
  '0', '1', '2', '3', '10', '100', '1000'
]
if (DICT_V1.length > 127) throw new Error('share dictionary overflow')
const DICT_INDEX = new Map(DICT_V1.map((w, i) => [w, i]))

const B32 = 'abcdefghijklmnopqrstuvwxyz234567'

function base32(bytes: number[]): string {
  let out = ''
  let buf = 0
  let bits = 0
  for (const b of bytes) {
    buf = (buf << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(buf >> (bits - 5)) & 31]
      bits -= 5
    }
    buf &= (1 << bits) - 1
  }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 31]
  return out
}

function unbase32(s: string): number[] {
  const out: number[] = []
  let buf = 0
  let bits = 0
  for (const ch of s) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new ShareError('This setup code has a character that does not belong in it.')
    buf = (buf << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((buf >> (bits - 8)) & 255)
      bits -= 8
    }
    buf &= (1 << bits) - 1
  }
  return out
}

/** Two base32 characters (10 bits) of FNV-1a, to catch a truncated or mistyped code. */
function check(body: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return B32[(h >>> 5) & 31] + B32[h & 31]
}

export class ShareError extends Error {}

export interface SharedRun {
  setup: SetupSpec
  tx: TxSpec
}

/** Drops empty and default fields so codes stay short. */
function prune<T>(v: T): T {
  if (Array.isArray(v)) return v.map(prune) as unknown as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined || k === 'note') continue
      out[k] = prune(x)
    }
    return out as T
  }
  return v
}

export function encodeShare(run: SharedRun): string {
  const json = JSON.stringify(prune({ s: run.setup, t: run.tx })).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  const bytes: number[] = []
  let i = 0
  while (i < json.length) {
    if (json[i] === '"') {
      // a JSON string: find its end, honouring escapes
      let j = i + 1
      while (j < json.length && json[j] !== '"') j += json[j] === '\\' ? 2 : 1
      const raw = json.slice(i, j + 1)
      const word = JSON.parse(raw) as string
      const idx = DICT_INDEX.get(word)
      if (idx !== undefined) bytes.push(0x80 | idx)
      else for (const ch of raw) bytes.push(ch.charCodeAt(0))
      i = j + 1
    } else {
      bytes.push(json.charCodeAt(i))
      i++
    }
  }
  const body = base32(bytes)
  return SHARE_VERSION + body + check(body)
}

export function decodeShare(input: string): SharedRun {
  const code = input
    .trim()
    .toLowerCase()
    .replace(/^.*#run-/, '')
    .replace(/^run-/, '')
    .replace(/[\s-]/g, '')
  if (!code) throw new ShareError('Paste a setup code first.')
  if (code[0] !== SHARE_VERSION) throw new ShareError('This setup code comes from another version of the playground.')
  const body = code.slice(1, -2)
  if (code.length < 4 || check(body) !== code.slice(-2)) throw new ShareError('This setup code is incomplete or mistyped. Copy it again in full.')
  const bytes = unbase32(body)
  let json = ''
  for (const b of bytes) {
    if (b & 0x80) {
      const word = DICT_V1[b & 0x7f]
      if (word === undefined) throw new ShareError('This setup code could not be read.')
      json += JSON.stringify(word)
    } else json += String.fromCharCode(b)
  }
  let parsed: { s?: SetupSpec; t?: TxSpec }
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new ShareError('This setup code could not be read.')
  }
  if (!parsed.s || !parsed.t || typeof parsed.t.to !== 'string') throw new ShareError('This setup code could not be read.')
  return { setup: parsed.s, tx: parsed.t }
}

// ---------------------------------------------------------------------------------------------
// World -> setup
// ---------------------------------------------------------------------------------------------

const PERMS: PermissionName[] = ['NONE', 'ONCE', 'ALWAYS']
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** A rule's settings as they stand now: spent ONCE permissions and used grants are left out. */
function liveConfig(world: World, entry: TableEntry): PolicyConfig | null {
  const st = (world.policyState as Record<string, Record<string, unknown>> | undefined)?.[entry.policy]
  if (entry.policy === 'ERC20TransferPolicy' || entry.policy === 'ERC20ApprovePolicy') {
    const table = (st?.recipients ?? st?.spenders) as Record<string, Record<string, number>> | undefined
    if (!table) return null
    const tokenKey = Object.keys(table).find((k) => eq(k, entry.target))
    const rows = Object.entries(tokenKey ? table[tokenKey] : {}).map(([acct, p]) => ({ account: keyOf(world, acct), permission: PERMS[p] ?? 'NONE' }))
    return entry.policy === 'ERC20TransferPolicy' ? { recipients: rows } : { spenders: rows }
  }
  if (entry.policy === 'OneTimeAllowPolicy') {
    const grants = (st?.grants ?? {}) as Record<string, unknown>
    return { granted: Object.keys(grants).some((k) => eq(k, entry.access)) }
  }
  return null
}

function human(world: World, asset: string, base: string): string {
  const decimals = asset === 'ETH' ? 18 : (entity(world, asset).decimals ?? 18)
  return formatUnits(base, decimals, decimals).replace(/,/g, '')
}

/** The Safe as it is now, as a setup the engine can rebuild. */
export function worldToSetup(world: World): SetupSpec {
  const safe = world.safe.address
  const balances: Record<string, string> = {}
  for (const [asset, holders] of Object.entries(world.balances)) {
    const hit = Object.entries(holders).find(([h]) => eq(h, safe))
    if (!hit || hit[1] === '0') continue
    balances[asset === 'ETH' ? 'ETH' : keyOf(world, asset)] = human(world, asset, hit[1])
  }
  const allowances: NonNullable<SetupSpec['allowances']> = []
  for (const [token, owners] of Object.entries(world.allowances ?? {})) {
    for (const [owner, spenders] of Object.entries(owners)) {
      for (const [spender, amount] of Object.entries(spenders)) {
        if (amount === '0') continue
        allowances.push({ token: keyOf(world, token), owner: keyOf(world, owner), spender: keyOf(world, spender), amount: human(world, token, amount) })
      }
    }
  }
  const rules: RuleSpec[] = Object.values(world.table).map((entry) => {
    const rule = ruleSpecFromEntry(world, entry)
    const live = liveConfig(world, entry)
    if (live) {
      rule.config = live
      delete rule.data
    } else if (!rule.config && !rule.data) {
      const cfg = decodeConfig(world, entry.policy, entry.data)
      if (cfg && Object.keys(cfg).length) rule.config = cfg
    }
    if (rule.config && Object.keys(rule.config).length === 0) delete rule.config
    if (rule.fallback) delete rule.operation
    else if (rule.operation === 'CALL') delete rule.operation
    return rule
  })
  // Fields equal to the engine's defaults (SPEC §3) are left out to keep codes short.
  const setup: SetupSpec = {}
  const owners = ownerNames(world)
  if (owners.join() !== 'Alice,Bob,Carol') setup.owners = owners
  if (world.safe.threshold !== 2) setup.threshold = world.safe.threshold
  const modules = moduleNames(world)
  if (modules.length) setup.modules = modules
  if (Object.keys(balances).length) setup.balances = balances
  if (rules.length) setup.rules = rules
  const guards = { transaction: Boolean(world.safe.txGuard), module: Boolean(world.safe.moduleGuard) }
  if (!guards.transaction || !guards.module) setup.guards = guards
  if (allowances.length) setup.allowances = allowances
  if (world.delay !== 3600) setup.delay = world.delay
  if (world.expiry !== 604800) setup.expiry = world.expiry
  return setup
}
