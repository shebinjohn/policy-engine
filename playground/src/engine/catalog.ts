/**
 * Function catalog (SPEC §4) and all ABI encoding: calls, rules (Configuration structs), the
 * configuration root, and MultiSend packing exactly like ../src/utils.ts `encodeMultiSend`.
 */
import { ethers } from 'ethers'

import { opNumber, type Op } from './access.ts'
import {
  EngineInputError,
  POLICY_NAMES,
  ZERO,
  SENTINEL,
  eqAddr,
  findByName,
  parseAmount,
  policyAddress,
  resolveAddress,
  resolveEntity
} from './book.ts'
import type {
  CallSpec,
  ContextSpec,
  EncodedTx,
  FunctionInfo,
  PermissionName,
  PolicyConfig,
  PolicyName,
  RuleSpec,
  SubTxSpec,
  TxSpec,
  World
} from './types.ts'

const coder = ethers.AbiCoder.defaultAbiCoder()

export const CONFIGURATION_TUPLE = 'tuple(address target, bytes4 selector, uint8 operation, address policy, bytes data)[]'

export const ERC20_IFACE = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
])

export const WETH_IFACE = new ethers.Interface([
  'function deposit() payable',
  'function withdraw(uint256 wad)',
  'function transfer(address dst, uint256 wad) returns (bool)',
  'function approve(address guy, uint256 wad) returns (bool)',
  'function transferFrom(address src, address dst, uint256 wad) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
])

export const SAFE_IFACE = new ethers.Interface([
  'function setGuard(address guard)',
  'function setModuleGuard(address moduleGuard)',
  'function enableModule(address module)',
  'function disableModule(address prevModule, address module)',
  'function changeThreshold(uint256 _threshold)',
  'function addOwnerWithThreshold(address owner, uint256 _threshold)',
  'function removeOwner(address prevOwner, address owner, uint256 _threshold)',
  'function swapOwner(address prevOwner, address oldOwner, address newOwner)',
  'function setFallbackHandler(address handler)',
  'function approveHash(bytes32 hashToApprove)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function isOwner(address owner) view returns (bool)',
  'function isModuleEnabled(address module) view returns (bool)',
  'function getStorageAt(uint256 offset, uint256 length) view returns (bytes)'
])

export const GUARD_IFACE = new ethers.Interface([
  `function configureImmediately(${CONFIGURATION_TUPLE} configurations)`,
  'function requestConfiguration(bytes32 configureRoot)',
  `function applyConfiguration(${CONFIGURATION_TUPLE} configurations)`,
  'function invalidateRoot(bytes32 configureRoot)',
  'function rootConfigured(address safe, bytes32 root) view returns (uint256)',
  'function DELAY() view returns (uint256)',
  'function EXPIRY() view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function getPolicy(address safe, address to, bytes data, uint8 operation) view returns (uint256, address)'
])

export const MULTISEND_IFACE = new ethers.Interface(['function multiSend(bytes transactions) payable'])

export const POLICY_IFACE = new ethers.Interface([
  'function checkTransaction(address safe, address to, uint256 value, bytes data, uint8 operation, address module, bytes context, uint256 access) returns (bytes4)',
  'function configure(address safe, uint256 access, bytes data) returns (bool)'
])

export const SELECTORS = {
  transfer: ERC20_IFACE.getFunction('transfer')!.selector,
  approve: ERC20_IFACE.getFunction('approve')!.selector,
  transferFrom: ERC20_IFACE.getFunction('transferFrom')!.selector,
  deposit: WETH_IFACE.getFunction('deposit')!.selector,
  withdraw: WETH_IFACE.getFunction('withdraw')!.selector,
  setGuard: SAFE_IFACE.getFunction('setGuard')!.selector,
  setModuleGuard: SAFE_IFACE.getFunction('setModuleGuard')!.selector,
  enableModule: SAFE_IFACE.getFunction('enableModule')!.selector,
  disableModule: SAFE_IFACE.getFunction('disableModule')!.selector,
  changeThreshold: SAFE_IFACE.getFunction('changeThreshold')!.selector,
  addOwnerWithThreshold: SAFE_IFACE.getFunction('addOwnerWithThreshold')!.selector,
  removeOwner: SAFE_IFACE.getFunction('removeOwner')!.selector,
  configureImmediately: GUARD_IFACE.getFunction('configureImmediately')!.selector,
  requestConfiguration: GUARD_IFACE.getFunction('requestConfiguration')!.selector,
  applyConfiguration: GUARD_IFACE.getFunction('applyConfiguration')!.selector,
  invalidateRoot: GUARD_IFACE.getFunction('invalidateRoot')!.selector,
  multiSend: MULTISEND_IFACE.getFunction('multiSend')!.selector
} as const

export type CatalogFn = keyof typeof SELECTORS

type ArgType = FunctionInfo['args'][number]['type']

interface CatalogEntry {
  name: CatalogFn
  iface: ethers.Interface
  on: FunctionInfo['on']
  label: string
  args: { name: string; type: ArgType; label: string }[]
}

const CATALOG: CatalogEntry[] = [
  {
    name: 'transfer',
    iface: ERC20_IFACE,
    on: ['token', 'weth'],
    label: 'Send tokens',
    args: [
      { name: 'to', type: 'address', label: 'Recipient' },
      { name: 'amount', type: 'amount', label: 'Amount' }
    ]
  },
  {
    name: 'approve',
    iface: ERC20_IFACE,
    on: ['token', 'weth'],
    label: 'Let someone spend tokens',
    args: [
      { name: 'spender', type: 'address', label: 'Spender' },
      { name: 'amount', type: 'amount', label: 'Amount' }
    ]
  },
  {
    name: 'transferFrom',
    iface: ERC20_IFACE,
    on: ['token', 'weth'],
    label: 'Pull tokens from someone',
    args: [
      { name: 'from', type: 'address', label: 'From' },
      { name: 'to', type: 'address', label: 'Recipient' },
      { name: 'amount', type: 'amount', label: 'Amount' }
    ]
  },
  { name: 'deposit', iface: WETH_IFACE, on: ['weth'], label: 'Wrap ETH', args: [] },
  {
    name: 'withdraw',
    iface: WETH_IFACE,
    on: ['weth'],
    label: 'Unwrap WETH',
    args: [{ name: 'amount', type: 'amount', label: 'Amount' }]
  },
  {
    name: 'setGuard',
    iface: SAFE_IFACE,
    on: ['safe'],
    label: 'Set the transaction guard',
    args: [{ name: 'guard', type: 'address', label: 'Guard (Zero removes it)' }]
  },
  {
    name: 'setModuleGuard',
    iface: SAFE_IFACE,
    on: ['safe'],
    label: 'Set the module guard',
    args: [{ name: 'guard', type: 'address', label: 'Module guard (Zero removes it)' }]
  },
  {
    name: 'enableModule',
    iface: SAFE_IFACE,
    on: ['safe'],
    label: 'Enable a module',
    args: [{ name: 'module', type: 'address', label: 'Module' }]
  },
  {
    name: 'disableModule',
    iface: SAFE_IFACE,
    on: ['safe'],
    label: 'Disable a module',
    args: [{ name: 'module', type: 'address', label: 'Module' }]
  },
  {
    name: 'changeThreshold',
    iface: SAFE_IFACE,
    on: ['safe'],
    label: 'Change the threshold',
    args: [{ name: 'threshold', type: 'uint', label: 'New threshold' }]
  },
  {
    name: 'addOwnerWithThreshold',
    iface: SAFE_IFACE,
    on: ['safe'],
    label: 'Add an owner',
    args: [
      { name: 'owner', type: 'address', label: 'New owner' },
      { name: 'threshold', type: 'uint', label: 'New threshold' }
    ]
  },
  {
    name: 'removeOwner',
    iface: SAFE_IFACE,
    on: ['safe'],
    label: 'Remove an owner',
    args: [
      { name: 'owner', type: 'address', label: 'Owner to remove' },
      { name: 'threshold', type: 'uint', label: 'New threshold' }
    ]
  },
  {
    name: 'configureImmediately',
    iface: GUARD_IFACE,
    on: ['guard'],
    label: 'Set rules immediately',
    args: []
  },
  {
    name: 'requestConfiguration',
    iface: GUARD_IFACE,
    on: ['guard'],
    label: 'Request a rule change',
    args: []
  },
  {
    name: 'applyConfiguration',
    iface: GUARD_IFACE,
    on: ['guard'],
    label: 'Apply a requested rule change',
    args: []
  },
  {
    name: 'invalidateRoot',
    iface: GUARD_IFACE,
    on: ['guard'],
    label: 'Cancel a rule change request',
    args: []
  },
  { name: 'multiSend', iface: MULTISEND_IFACE, on: ['multisend'], label: 'Run a batch', args: [] }
]

export function catalogEntry(fn: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.name === fn)
}

/** Catalog function whose selector is `selector`, if any. */
export function catalogBySelector(selector: string): CatalogEntry | undefined {
  return CATALOG.find((c) => SELECTORS[c.name] === selector.toLowerCase())
}

export function functions(): FunctionInfo[] {
  return CATALOG.map((c) => {
    const fragment = c.iface.getFunction(c.name)!
    return {
      name: c.name,
      signature: fragment.format('sighash'),
      selector: fragment.selector,
      on: [...c.on],
      label: c.label,
      args: c.args.map((a) => ({ ...a }))
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export interface Configuration {
  target: string
  selector: string
  operation: Op
  policy: string
  data: string
}

const PERMISSION: Record<PermissionName, number> = { NONE: 0, ONCE: 1, ALWAYS: 2 }

function isPolicyName(p: unknown): p is PolicyName {
  return typeof p === 'string' && (POLICY_NAMES as string[]).includes(p)
}

/** Resolve a rule's selector field: catalog name, 4-byte hex, or 'none'. */
export function resolveRuleSelector(selector: string | undefined): string {
  if (selector === undefined || selector === '' || selector === 'none') return '0x00000000'
  const entry = catalogEntry(selector)
  if (entry) return SELECTORS[entry.name]
  if (ethers.isHexString(selector, 4)) return selector.toLowerCase()
  throw new EngineInputError(`Unknown selector "${selector}". Use a function name, 4-byte hex, or "none".`)
}

/** ABI-encode a friendly policy config into the bytes passed to `configure`. */
export function encodeRuleData(world: World | null, policy: PolicyName, config: PolicyConfig | undefined): string {
  const c = (config ?? {}) as Record<string, unknown>
  switch (policy) {
    case 'OneTimeAllowPolicy':
      return coder.encode(['bool'], [c.granted === undefined ? true : Boolean(c.granted)])
    case 'AllowedModulePolicy': {
      if (typeof c.module !== 'string') return '0x'
      return coder.encode(
        ['address', 'bool'],
        [resolveAddress(world, c.module), c.allowed === undefined ? true : Boolean(c.allowed)]
      )
    }
    case 'CoSignerPolicy':
      return coder.encode(['address'], [resolveAddress(world, typeof c.cosigner === 'string' ? c.cosigner : 'CoSigner')])
    case 'IncreasedThresholdPolicy': {
      const n = c.maxAbsent === undefined ? 0 : Number(c.maxAbsent)
      if (!Number.isInteger(n) || n < 0) throw new EngineInputError(`maxAbsent must be a whole number, got ${c.maxAbsent}`)
      return coder.encode(['uint256'], [n])
    }
    case 'ERC20TransferPolicy':
    case 'ERC20ApprovePolicy': {
      const list = (policy === 'ERC20TransferPolicy' ? c.recipients : c.spenders) as
        | { account: string; permission: PermissionName }[]
        | undefined
      const items = (list ?? []).map((item) => {
        const permission = PERMISSION[item.permission ?? 'ALWAYS']
        if (permission === undefined) throw new EngineInputError(`Unknown permission "${item.permission}"`)
        return { account: resolveAddress(world, item.account), permission }
      })
      return coder.encode(['tuple(address account, uint8 permission)[]'], [items])
    }
    default:
      return '0x'
  }
}

export function ruleToConfiguration(world: World | null, rule: RuleSpec): Configuration {
  if (rule.policy !== null && !isPolicyName(rule.policy)) {
    throw new EngineInputError(`Unknown policy "${String(rule.policy)}"`)
  }
  let target: string
  let selector: string
  let operation: Op
  if (rule.fallback) {
    target = ZERO
    selector = '0x00000000'
    operation = opNumber(rule.fallback)
  } else {
    target = rule.target === undefined ? ZERO : resolveAddress(world, rule.target)
    selector = resolveRuleSelector(rule.selector)
    operation = opNumber(rule.operation)
  }
  const policy = rule.policy === null ? ZERO : policyAddress(world, rule.policy)
  let data: string
  if (rule.data !== undefined) {
    if (!ethers.isHexString(rule.data)) throw new EngineInputError(`Rule data must be hex, got "${rule.data}"`)
    data = rule.data.toLowerCase()
  } else {
    data = rule.policy === null ? '0x' : encodeRuleData(world, rule.policy, rule.config)
  }
  return { target, selector, operation, policy, data }
}

function configurationsValue(configs: Configuration[]) {
  return configs.map((c) => ({
    target: c.target,
    selector: c.selector,
    operation: c.operation,
    policy: c.policy,
    data: c.data
  }))
}

export function encodeConfigurations(configs: Configuration[]): string {
  return coder.encode([CONFIGURATION_TUPLE], [configurationsValue(configs)])
}

/** Identical to ../src/utils.ts getConfigurationRoot. */
export function configurationRootOf(configs: Configuration[]): string {
  return ethers.keccak256(encodeConfigurations(configs)).toLowerCase()
}

export function decodeConfigurations(iface: ethers.Interface, fn: string, data: string): Configuration[] {
  const [list] = iface.decodeFunctionData(fn, data)
  return (list as ethers.Result).map((item: ethers.Result) => {
    const op = Number(item[2])
    if (op !== 0 && op !== 1) throw new Error('invalid operation')
    return {
      target: ethers.getAddress(item[0]),
      selector: String(item[1]).toLowerCase(),
      operation: op as Op,
      policy: ethers.getAddress(item[3]),
      data: String(item[4]).toLowerCase()
    }
  })
}

// ---------------------------------------------------------------------------------------------
// MultiSend packing
// ---------------------------------------------------------------------------------------------

export interface PackedTx {
  operation: number
  to: string
  value: bigint
  data: string
}

/** Same bytes as ../src/utils.ts encodeMultiSend. */
export function packMultiSend(txs: PackedTx[]): string {
  return (
    '0x' +
    txs
      .map((tx) =>
        ethers
          .solidityPacked(
            ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
            [tx.operation, tx.to, tx.value, ethers.dataLength(tx.data), tx.data]
          )
          .slice(2)
      )
      .join('')
  )
}

// ---------------------------------------------------------------------------------------------
// Calls and transactions
// ---------------------------------------------------------------------------------------------

function argValue(world: World | null, to: string, type: ArgType, raw: unknown, fn: string, i: number): unknown {
  if (raw === undefined) throw new EngineInputError(`${fn}: missing argument ${i + 1}`)
  switch (type) {
    case 'address':
      return resolveAddress(world, String(raw))
    case 'amount':
      return parseAmount(world, to, raw as string)
    case 'uint': {
      try {
        const v = BigInt(raw as string | number)
        if (v < 0n) throw new Error('negative')
        return v
      } catch {
        throw new EngineInputError(`${fn}: argument ${i + 1} must be a whole number, got ${JSON.stringify(raw)}`)
      }
    }
    case 'bool':
      return Boolean(raw)
    case 'bytes32':
      if (!ethers.isHexString(raw, 32)) throw new EngineInputError(`${fn}: argument ${i + 1} must be 32-byte hex`)
      return raw
  }
}

/** Linked-list predecessor (Safe's prevOwner / prevModule), SENTINEL for the head or a missing item. */
function prevInList(list: string[], item: string): string {
  const i = list.findIndex((a) => eqAddr(a, item))
  if (i <= 0) return SENTINEL
  return list[i - 1]
}

function rootFromCall(world: World | null, call: CallSpec): string {
  if (call.configurations) {
    return configurationRootOf(call.configurations.map((r) => ruleToConfiguration(world, r)))
  }
  const raw = call.args?.[0]
  if (typeof raw === 'string' && ethers.isHexString(raw, 32)) return raw.toLowerCase()
  throw new EngineInputError(`${call.fn}: give "configurations" (or a 32-byte root as args[0])`)
}

/** ABI-encode a CallSpec aimed at `to`. */
export function encodeCall(world: World | null, to: string, call: CallSpec): string {
  const entry = catalogEntry(call.fn)
  if (!entry) throw new EngineInputError(`Unknown function "${call.fn}". See the function catalog.`)
  const args = call.args ?? []
  switch (entry.name) {
    case 'configureImmediately':
    case 'applyConfiguration': {
      const configs = (call.configurations ?? []).map((r) => ruleToConfiguration(world, r))
      return GUARD_IFACE.encodeFunctionData(entry.name, [configurationsValue(configs)])
    }
    case 'requestConfiguration':
    case 'invalidateRoot':
      return GUARD_IFACE.encodeFunctionData(entry.name, [rootFromCall(world, call)])
    case 'multiSend':
      return MULTISEND_IFACE.encodeFunctionData('multiSend', [encodeBatch(world, call.batch ?? [])])
    case 'disableModule': {
      const module = argValue(world, to, 'address', args[0], call.fn, 0) as string
      const prev = prevInList(world?.safe.modules ?? [], module)
      return SAFE_IFACE.encodeFunctionData('disableModule', [prev, module])
    }
    case 'removeOwner': {
      const owner = argValue(world, to, 'address', args[0], call.fn, 0) as string
      const threshold = argValue(world, to, 'uint', args[1], call.fn, 1)
      const prev = prevInList(world?.safe.owners ?? [], owner)
      return SAFE_IFACE.encodeFunctionData('removeOwner', [prev, owner, threshold])
    }
    default: {
      const values = entry.args.map((a, i) => argValue(world, to, a.type, args[i], call.fn, i))
      return entry.iface.encodeFunctionData(entry.name, values)
    }
  }
}

function normalizeData(data: string | undefined): string {
  if (data === undefined || data === '' || data === '0x') return '0x'
  if (!ethers.isHexString(data)) throw new EngineInputError(`Calldata must be 0x hex with whole bytes, got "${data}"`)
  return data.toLowerCase()
}

function parseEth(value: string | undefined): bigint {
  if (value === undefined || value === '') return 0n
  try {
    return ethers.parseEther(String(value))
  } catch {
    throw new EngineInputError(`Cannot read ETH value "${value}"`)
  }
}

export function encodeSubTx(world: World | null, sub: SubTxSpec): PackedTx {
  const to = resolveAddress(world, sub.to)
  // A zero `to` means the Safe: encode calls as if aimed at it (for amount decimals).
  const callTarget = eqAddr(to, ZERO) && world ? world.safe.address : to
  const data = sub.call ? encodeCall(world, callTarget, sub.call) : normalizeData(sub.data)
  return { operation: opNumber(sub.operation), to, value: parseEth(sub.value), data }
}

export function encodeBatch(world: World | null, batch: SubTxSpec[]): string {
  return packMultiSend(batch.map((sub) => encodeSubTx(world, sub)))
}

export interface EncodedCall {
  to: string
  value: bigint
  data: string
  operation: Op
}

export function encodeTxCall(world: World | null, tx: TxSpec): EncodedCall {
  const to = resolveAddress(world, tx.to)
  const data = tx.call ? encodeCall(world, to, tx.call) : normalizeData(tx.data)
  return { to, value: parseEth(tx.value), data, operation: opNumber(tx.operation) }
}

export function toEncodedTx(call: EncodedCall, accessSelectorHex: string): EncodedTx {
  return {
    to: call.to,
    value: call.value.toString(),
    data: call.data,
    operation: call.operation,
    accessSelector: accessSelectorHex
  }
}

/** The symbolic context for a tx or sub-tx: its own, or a positional list built from its batch. */
export function contextFor(spec: TxSpec | SubTxSpec): ContextSpec {
  if (spec.context !== undefined) return spec.context
  if (spec.call?.fn === 'multiSend' && spec.call.batch && spec.call.batch.length > 0) {
    const items = spec.call.batch.map((sub) => contextFor(sub))
    if (items.some((c) => c !== null)) {
      // Trailing empty items carry nothing; earlier ones pad the positions.
      while (items.length > 0 && items[items.length - 1] === null) items.pop()
      return { type: 'batch', items }
    }
  }
  return null
}

/** True if a name is a known entity of the address book used by this world. */
export function isKnownName(world: World | null, name: string): boolean {
  return findByName(world, name) !== undefined
}

export { resolveEntity }
