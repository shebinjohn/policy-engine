/**
 * Address book: the canonical names content may use (SPEC §2) and their playground addresses.
 * Addresses are stable, valid and checksummed. They differ from a Hardhat run on purpose; content
 * refers to entities by name only.
 */
import { ethers } from 'ethers'

import type { Entity, PolicyName, World } from './types.ts'

export const ZERO = '0x0000000000000000000000000000000000000000'
/** Safe's linked-list sentinel (`SENTINEL_OWNERS` / `SENTINEL_MODULES`). */
export const SENTINEL = '0x0000000000000000000000000000000000000001'

export const POLICY_NAMES: PolicyName[] = [
  'AllowPolicy',
  'DenyPolicy',
  'OneTimeAllowPolicy',
  'AllowedModulePolicy',
  'NativeTransferPolicy',
  'ERC20TransferPolicy',
  'ERC20ApprovePolicy',
  'MultiSendPolicy',
  'CoSignerPolicy',
  'IncreasedThresholdPolicy',
  'SafenetPolicy'
]

/** Plain labels for policies, used in trace and effect copy. */
export const POLICY_LABELS: Record<PolicyName, string> = {
  AllowPolicy: 'Always Allow',
  DenyPolicy: 'Always Deny',
  OneTimeAllowPolicy: 'One-Time Pass',
  AllowedModulePolicy: 'Module Allowlist',
  NativeTransferPolicy: 'Plain ETH Transfer',
  ERC20TransferPolicy: 'Recipient Allowlist',
  ERC20ApprovePolicy: 'Spender Allowlist',
  MultiSendPolicy: 'Batch Checker',
  CoSignerPolicy: 'Co-Signer',
  IncreasedThresholdPolicy: 'Extra Owner Signatures',
  SafenetPolicy: 'Safenet Attestation'
}

const POLICY_DESCRIPTIONS: Record<PolicyName, string> = {
  AllowPolicy: 'Allows every call it is attached to.',
  DenyPolicy: 'Refuses every call it is attached to.',
  OneTimeAllowPolicy: 'Allows one call, then refuses until it is granted again.',
  AllowedModulePolicy: 'Allows calls made by modules on its allowlist.',
  NativeTransferPolicy: 'Allows plain ETH transfers with no data.',
  ERC20TransferPolicy: 'Allows token transfers only to listed recipients.',
  ERC20ApprovePolicy: 'Allows token approvals only for listed spenders.',
  MultiSendPolicy: 'Checks every step of a batch against the rules.',
  CoSignerPolicy: 'Requires a signature from a co-signer service.',
  IncreasedThresholdPolicy: 'Requires more owner signatures than the Safe threshold.',
  SafenetPolicy: 'Requires an attestation from the Safenet validators.'
}

function pad(prefix: string, suffix: string): string {
  const hex = prefix + '0'.repeat(40 - prefix.length - suffix.length) + suffix
  return ethers.getAddress('0x' + hex)
}

function base(): Entity[] {
  const entities: Entity[] = [
    {
      name: 'Safe',
      label: 'Treasury Safe',
      address: pad('5afe', '5afe'),
      kind: 'safe',
      description: 'The Safe account this playground protects.'
    },
    {
      name: 'PolicyGuard',
      label: 'Policy Guard',
      address: pad('c4ec', 'c4ec'),
      kind: 'guard',
      description: 'The SafePolicyGuard: checks every transaction against the rules.'
    },
    {
      name: 'MultiSend',
      label: 'MultiSend (call only)',
      address: ethers.getAddress('0x9641d764fc13c8b624c04430c7356c1c7c8102e2'),
      kind: 'multisend',
      description: 'Runs several calls as one batch. Refuses delegatecalls inside the batch.'
    },
    {
      name: 'USDC',
      label: 'USDC',
      address: ethers.getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
      kind: 'token',
      decimals: 6,
      symbol: 'USDC',
      description: 'A dollar stablecoin with 6 decimals.'
    },
    {
      name: 'SAFE',
      label: 'SAFE token',
      address: ethers.getAddress('0x5afe3855358e112b5647b952709e6165e1c1eeee'),
      kind: 'token',
      decimals: 18,
      symbol: 'SAFE',
      description: 'The SAFE governance token.'
    },
    {
      name: 'WETH',
      label: 'Wrapped Ether',
      address: ethers.getAddress('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'),
      kind: 'weth',
      decimals: 18,
      symbol: 'WETH',
      description: 'Wraps ETH as a token. Any unknown call to it deposits the ETH sent.'
    },
    { name: 'Alice', label: 'Alice', address: pad('a11ce', 'a11ce'), kind: 'person', description: 'An owner.' },
    { name: 'Bob', label: 'Bob', address: pad('b0b', 'b0b'), kind: 'person', description: 'An owner.' },
    { name: 'Carol', label: 'Carol', address: pad('ca401', 'ca401'), kind: 'person', description: 'An owner.' },
    {
      name: 'Dave',
      label: 'Dave (vendor)',
      address: pad('da7e', 'da7e'),
      kind: 'person',
      description: 'A vendor the treasury pays.'
    },
    {
      name: 'Erin',
      label: 'Erin (contractor)',
      address: pad('e414', 'e414'),
      kind: 'person',
      description: 'A contractor the treasury pays.'
    },
    {
      name: 'Mallory',
      label: 'Mallory (attacker)',
      address: pad('bad', 'bad'),
      kind: 'person',
      description: 'An attacker who wants the funds.'
    },
    {
      name: 'CoSigner',
      label: 'Co-signer service',
      address: pad('c051', 'c051'),
      kind: 'service',
      description: 'An off-chain service whose key co-signs transactions.'
    },
    {
      name: 'AllowanceModule',
      label: 'Allowance Module',
      address: pad('a110', 'a110'),
      kind: 'module',
      description: 'A module that can execute transactions for the Safe.'
    },
    {
      name: 'RecoveryModule',
      label: 'Recovery Module',
      address: pad('4ec0', '4ec0'),
      kind: 'module',
      description: 'A module that can execute transactions for the Safe.'
    },
    {
      name: 'MysteryContract',
      label: 'Unknown contract',
      address: pad('deadbeef', ''),
      kind: 'contract',
      description: 'A contract nobody has checked. Here it does nothing.'
    },
    { name: 'Zero', label: 'Zero address', address: ZERO, kind: 'contract', description: 'The zero address.' }
  ]
  POLICY_NAMES.forEach((name, i) => {
    entities.push({
      name,
      label: POLICY_LABELS[name],
      address: pad('9011c1', (i + 1).toString(16).padStart(2, '0')),
      kind: 'policy',
      description: POLICY_DESCRIPTIONS[name]
    })
  })
  return entities
}

const DEFAULT_BOOK: Entity[] = base()

export function defaultBook(): Entity[] {
  return structuredClone(DEFAULT_BOOK)
}

export function eqAddr(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

export class EngineInputError extends Error {}

function bookOf(world: World | null): Entity[] {
  return world?.book ?? DEFAULT_BOOK
}

export function findByName(world: World | null, name: string): Entity | undefined {
  const book = bookOf(world)
  return book.find((e) => e.name === name) ?? book.find((e) => e.name.toLowerCase() === name.toLowerCase())
}

export function findByAddress(world: World | null, address: string): Entity | undefined {
  return bookOf(world).find((e) => eqAddr(e.address, address))
}

/** Resolve a name or a 0x address to a checksummed address. Throws EngineInputError if neither. */
export function resolveAddress(world: World | null, nameOrAddress: string): string {
  if (typeof nameOrAddress !== 'string' || nameOrAddress.length === 0) {
    throw new EngineInputError(`Expected a name or an address, got ${JSON.stringify(nameOrAddress)}`)
  }
  const entity = findByName(world, nameOrAddress)
  if (entity) return entity.address
  if (ethers.isHexString(nameOrAddress, 20)) return ethers.getAddress(nameOrAddress.toLowerCase())
  throw new EngineInputError(`Unknown name "${nameOrAddress}". Use an address-book name or a 0x address.`)
}

/** Entity for an address or name; a synthetic one for unknown addresses. */
export function resolveEntity(world: World | null, nameOrAddress: string): Entity {
  const byName = findByName(world, nameOrAddress)
  if (byName) return byName
  const address = resolveAddress(world, nameOrAddress)
  const known = findByAddress(world, address)
  if (known) return known
  return {
    name: address,
    label: `${address.slice(0, 6)}…${address.slice(-4)}`,
    address,
    kind: 'contract',
    description: 'An address that is not in the address book. It has no code here.'
  }
}

export function labelOf(world: World | null, address: string): string {
  return resolveEntity(world, address).label
}

/** Short label without the parenthetical role, e.g. 'Dave' for 'Dave (vendor)'. */
export function shortLabel(world: World | null, address: string): string {
  const entity = resolveEntity(world, address)
  if (entity.kind === 'person' || entity.kind === 'multisend') return entity.name
  return entity.label
}

export function nameOf(world: World | null, address: string): string {
  return resolveEntity(world, address).name
}

export function kindOf(world: World | null, address: string): Entity['kind'] {
  return resolveEntity(world, address).kind
}

export function policyAddress(world: World | null, policy: PolicyName): string {
  const entity = findByName(world, policy)
  if (!entity) throw new EngineInputError(`Unknown policy ${policy}`)
  return entity.address
}

export function policyAt(world: World | null, address: string): PolicyName | null {
  const entity = findByAddress(world, address)
  if (entity && entity.kind === 'policy' && (POLICY_NAMES as string[]).includes(entity.name)) {
    return entity.name as PolicyName
  }
  return null
}

export function addressOf(world: World | null, name: string): string {
  const entity = findByName(world, name)
  if (!entity) throw new EngineInputError(`Address book has no entry "${name}"`)
  return entity.address
}

/** Decimals for an asset address or 'ETH'. Unknown contracts default to 18. */
export function decimalsOf(world: World | null, asset: string): number {
  if (asset === 'ETH') return 18
  const entity = findByAddress(world, asset) ?? findByName(world, asset)
  return entity?.decimals ?? 18
}

export function symbolOf(world: World | null, asset: string): string {
  if (asset === 'ETH') return 'ETH'
  const entity = findByAddress(world, asset) ?? findByName(world, asset)
  return entity?.symbol ?? entity?.label ?? 'tokens'
}

const MAX_UINT = (1n << 256n) - 1n

export function formatUnitsPlain(amount: bigint, decimals: number): string {
  if (amount === MAX_UINT) return 'unlimited'
  const s = ethers.formatUnits(amount, decimals)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** "500 USDC", "1.5 ETH". */
export function formatAsset(world: World | null, asset: string, amount: bigint): string {
  const value = formatUnitsPlain(amount, decimalsOf(world, asset))
  return `${value} ${symbolOf(world, asset)}`
}

export function parseAmount(world: World | null, asset: string, human: string | number): bigint {
  const text = String(human).trim()
  if (text === 'max' || text === 'unlimited') return MAX_UINT
  try {
    return ethers.parseUnits(text, decimalsOf(world, asset))
  } catch {
    throw new EngineInputError(`Cannot read amount "${text}"`)
  }
}

export { MAX_UINT }
