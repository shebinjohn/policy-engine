/**
 * Deploys the on-chain world the playground simulates and maps every canonical name of SPEC §2 to
 * a real address.
 *
 * `deployBase()` runs once per Mocha run: the Safe 1.5.0 singleton and proxy factory,
 * `MultiSendCallOnly`, all eleven policies, the tokens, WETH, the two module contracts and the
 * FROST helper. It ends with a snapshot. `createWorld(base, setup)` restores that snapshot, deploys
 * a `SafePolicyGuard` with the scenario's delay and expiry, and performs SPEC §3 on chain.
 */
import fs from 'fs'
import path from 'path'

import type { RuleSpec, SetupSpec } from '../src/engine/types'
import { ethers, create2, deployers, frost, helpers, safeArtifact, utils } from './upstream'

/* eslint-disable @typescript-eslint/no-explicit-any */

export const GUARD_STORAGE_SLOT = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8'
export const MODULE_GUARD_STORAGE_SLOT = '0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947'
export const SENTINEL = '0x0000000000000000000000000000000000000001'

/** Gas limit for every transaction the harness sends, so nothing is estimated (and nothing is skipped on a revert). */
export const TX_GAS_LIMIT = 15_000_000n

/** SafenetPolicy is deployed with a FROST group whose secret the harness knows (single-participant FROST = Schnorr). */
export const SAFENET = {
  consensusChainId: 100n,
  consensusAddress: '0x1111111111111111111111111111111111111111',
  epoch: 7n,
  trustedSecret: 0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afen,
  untrustedSecret: 0xbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadn
}

export const POLICY_NAMES = [
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
] as const

/** Names that hold a private key in the harness (they can sign). */
export const KEY_HOLDERS = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Mallory', 'CoSigner'] as const

export type EntityKind = 'safe' | 'guard' | 'policy' | 'person' | 'service' | 'token' | 'weth' | 'multisend' | 'module' | 'contract'

export interface BookEntry {
  name: string
  address: string
  kind: EntityKind
  decimals?: number
}

/** Everything deployed once per run, before any Safe exists. */
export interface Base {
  relayer: any
  chainId: bigint
  singleton: any
  safeProxyFactory: any
  multiSend: any
  policies: Record<string, any>
  usdc: any
  safeToken: any
  weth: any
  modules: Record<string, any>
  testFrost: any
  keys: Record<string, any> // name -> ethers.Wallet (no ETH; the relayer pays gas)
  book: Record<string, BookEntry> // without Safe and PolicyGuard (they depend on the setup)
  /** Blocks may share a timestamp, so time moves only on `wait` (as in the engine). */
  sameTimestamp: boolean
  snapshot: any
}

/** One Safe, configured per a SetupSpec. */
export interface World {
  base: Base
  safe: any
  guard: any
  book: Record<string, BookEntry>
  byAddress: Map<string, string> // lower-case address -> name
  delay: number
  expiry: number
  /** The Safe nonce right after setup; scenario nonces are deltas from it (SPEC §3). */
  setupNonce: bigint
  /** Seconds to add before the next transaction (accumulated `wait` steps). */
  pendingWait: number
}

/** Thrown when the setup cannot be performed (for example `PolicyConfigurationFailed`). */
export class HarnessSetupError extends Error {
  constructor(
    message: string,
    public readonly revertData?: string
  ) {
    super(message)
  }
}

function keyFor(name: string): any {
  // Deterministic, so a failing run can be replayed and addresses are stable between runs.
  return new ethers.Wallet(ethers.id(`policy-engine-playground:${name}`), ethers.provider)
}

function codelessAddress(label: string): string {
  return ethers.getAddress(ethers.dataSlice(ethers.id(`policy-engine-playground:${label}`), 12))
}

function loadWethArtifact(): { abi: any[]; bytecode: string } {
  const file = path.join(__dirname, 'artifacts', 'WETH9.json')
  if (!fs.existsSync(file)) {
    throw new Error('conformance/artifacts/WETH9.json is missing: run node conformance/scripts/build-weth.cjs')
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export async function deployBase(): Promise<Base> {
  const [relayer] = await ethers.getSigners()
  const { chainId } = await ethers.provider.getNetwork()

  const { safe: singleton, safeProxyFactory } = await deployers.deploySafeContracts()
  const multiSendArtifact = safeArtifact('libraries/MultiSendCallOnly.sol/MultiSendCallOnly.json')
  const multiSend = await create2.deterministicDeployment(
    await ethers.getContractFactory(multiSendArtifact.abi, multiSendArtifact.bytecode),
    []
  )

  const policies: Record<string, any> = {
    AllowPolicy: (await deployers.deployAllowPolicy()).allowPolicy,
    DenyPolicy: (await deployers.deployDenyPolicy()).denyPolicy,
    OneTimeAllowPolicy: (await deployers.deployOneTimeAllowPolicy()).oneTimeAllowPolicy,
    AllowedModulePolicy: (await deployers.deployAllowedModulePolicy()).allowedModulePolicy,
    NativeTransferPolicy: (await deployers.deployNativeTransferPolicy()).nativeTransferPolicy,
    ERC20TransferPolicy: (await deployers.deployERC20TransferPolicy()).erc20TransferPolicy,
    ERC20ApprovePolicy: (await deployers.deployERC20ApprovePolicy()).erc20ApprovePolicy,
    MultiSendPolicy: (await deployers.deployMultiSendPolicy()).multiSendPolicy,
    CoSignerPolicy: (await deployers.deployCoSignerPolicy()).coSignerPolicy,
    IncreasedThresholdPolicy: (await deployers.deployIncreasedThresholdPolicy()).increasedThresholdPolicy,
    SafenetPolicy: (
      await deployers.deploySafenetPolicy({
        consensusChainId: SAFENET.consensusChainId,
        consensusAddress: SAFENET.consensusAddress,
        initialEpoch: SAFENET.epoch,
        initialGroupKey: frost.pointFromScalar(SAFENET.trustedSecret)
      })
    ).safenetPolicy
  }

  // Plain CREATE (not the CREATE2 helper) so the two tokens get distinct addresses.
  const tokenFactory = await ethers.getContractFactory('TestERC20Token')
  const usdc = await (await tokenFactory.deploy()).waitForDeployment()
  const safeToken = await (await tokenFactory.deploy()).waitForDeployment()
  const wethArtifact = loadWethArtifact()
  const weth = await (await (await ethers.getContractFactory(wethArtifact.abi, wethArtifact.bytecode)).deploy()).waitForDeployment()

  const moduleFactory = await ethers.getContractFactory('TestModule')
  const modules: Record<string, any> = {
    AllowanceModule: await (await moduleFactory.deploy()).waitForDeployment(),
    RecoveryModule: await (await moduleFactory.deploy()).waitForDeployment()
  }

  const testFrost = await (await (await ethers.getContractFactory('TestFROST')).deploy()).waitForDeployment()

  const keys: Record<string, any> = {}
  for (const name of KEY_HOLDERS) keys[name] = keyFor(name)

  const book: Record<string, BookEntry> = {}
  const add = (name: string, address: string, kind: EntityKind, decimals?: number) => {
    book[name] = { name, address: ethers.getAddress(address), kind, decimals }
  }
  add('MultiSend', await multiSend.getAddress(), 'multisend')
  add('USDC', await usdc.getAddress(), 'token', 6)
  add('SAFE', await safeToken.getAddress(), 'token', 18)
  add('WETH', await weth.getAddress(), 'weth', 18)
  for (const name of ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Mallory']) add(name, keys[name].address, 'person')
  add('CoSigner', keys.CoSigner.address, 'service')
  for (const [name, module] of Object.entries(modules)) add(name, await module.getAddress(), 'module')
  add('MysteryContract', codelessAddress('MysteryContract'), 'contract')
  add('Zero', ethers.ZeroAddress, 'contract')
  for (const name of POLICY_NAMES) add(name, await policies[name].getAddress(), 'policy')

  if ((await ethers.provider.getCode(book.MysteryContract.address)) !== '0x') {
    throw new Error('MysteryContract address unexpectedly has code')
  }

  let sameTimestamp = true
  try {
    await helpers.time.setNextBlockTimestamp(await helpers.time.latest())
    await helpers.mine()
  } catch {
    sameTimestamp = false
  }

  const snapshot = await helpers.takeSnapshot()
  return { relayer, chainId, singleton, safeProxyFactory, multiSend, policies, usdc, safeToken, weth, modules, testFrost, keys, book, sameTimestamp, snapshot }
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** Resolves a canonical name or a 0x address. */
export function resolve(world: Pick<World, 'book'>, nameOrAddress: string): string {
  if (typeof nameOrAddress !== 'string') throw new Error(`expected a name or address, got ${JSON.stringify(nameOrAddress)}`)
  const entry = world.book[nameOrAddress]
  if (entry) return entry.address
  if (/^0x[0-9a-fA-F]{40}$/.test(nameOrAddress)) return ethers.getAddress(nameOrAddress.toLowerCase())
  throw new Error(`unknown name "${nameOrAddress}" (not in the SPEC §2 address book and not a 0x address)`)
}

export function nameOf(world: Pick<World, 'byAddress'>, address: string): string {
  return world.byAddress.get(address.toLowerCase()) ?? ethers.getAddress(address)
}

export function decimalsOf(world: Pick<World, 'book'>, address: string): number {
  const entry = Object.values(world.book).find((e) => e.address.toLowerCase() === address.toLowerCase())
  return entry?.decimals ?? 18
}

export function keyOf(world: World, name: string): any {
  const key = world.base.keys[name]
  if (!key) throw new Error(`"${name}" cannot sign: only ${KEY_HOLDERS.join(', ')} hold keys in the harness`)
  return key
}

/** Base-unit amount from a human amount of the asset with `decimals`. */
export function toUnits(human: string | number, decimals: number): bigint {
  const text = String(human).trim()
  // The engine reads "max" / "unlimited" as type(uint256).max (book.ts parseAmount), e.g. an
  // unlimited approval; the harness must encode the same word.
  if (text === 'max' || text === 'unlimited') return ethers.MaxUint256
  return ethers.parseUnits(text, decimals)
}

export function fromUnits(units: bigint, decimals: number): string {
  const text = ethers.formatUnits(units, decimals)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

// ---------------------------------------------------------------------------------------------
// Safe transactions (shared by the setup and the steps)
// ---------------------------------------------------------------------------------------------

export interface SafeTxFields {
  to: string
  value: bigint
  data: string
  operation: number
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: string
  refundReceiver: string
  nonce: bigint
}

export function safeTx(partial: Partial<SafeTxFields> & { to: string; nonce: bigint }): SafeTxFields {
  return {
    value: 0n,
    data: '0x',
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ethers.ZeroAddress,
    refundReceiver: ethers.ZeroAddress,
    ...partial
  }
}

/** The Safe transaction hash the policies derive: gas fields zero, at `nonce` (SPEC §8 "Tx hash identity"). */
export async function policyTxHash(world: World, tx: { to: string; value: bigint; data: string; operation: number }, nonce: bigint): Promise<string> {
  return world.safe.getTransactionHash(tx.to, tx.value, tx.data, tx.operation, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce)
}

/** Safe owner signatures (EIP-712, 65 bytes each) by `signers` over `tx`, packed in ascending signer order. */
export async function ownerSignatures(world: World, signers: any[], tx: SafeTxFields): Promise<string> {
  const safeAddress = await world.safe.getAddress()
  const signatures = await Promise.all(signers.map((signer) => utils.safeSignTypedData(signer, safeAddress, tx, world.base.chainId)))
  return utils.buildSignatureBytes(signatures)
}

export function revertDataOf(error: any): string | undefined {
  // Hardhat attaches the return data of a reverted transaction to the error (see
  // hardhat-chai-matchers getReturnDataFromError); ethers may wrap it once more.
  for (const candidate of [error?.data, error?.error?.data, error?.info?.error?.data, error?.error?.error?.data]) {
    if (typeof candidate === 'string' && /^0x[0-9a-fA-F]*$/.test(candidate)) return candidate
    if (candidate && typeof candidate.data === 'string') return candidate.data
  }
  return undefined
}

export interface SendResult {
  ok: boolean
  revertData?: string
  receipt?: any
}

/** Sends a transaction from the relayer with a fixed gas limit; a revert is returned, not thrown. */
export async function send(promise: () => Promise<any>): Promise<SendResult> {
  try {
    const response = await promise()
    const receipt = await response.wait()
    return { ok: receipt.status === 1, receipt }
  } catch (error: any) {
    const revertData = revertDataOf(error)
    if (revertData === undefined) throw error
    return { ok: false, revertData }
  }
}

/** Executes a Safe transaction signed by `signers` (EIP-712), with an optional policy context payload appended. */
export async function execSafeTx(
  world: World,
  fields: Omit<SafeTxFields, 'nonce'>,
  signers: any[],
  contextPayload: string | null
): Promise<SendResult & { nonce: bigint; signatures: string; txHash: string }> {
  const nonce = BigInt(await world.safe.nonce())
  const tx = { ...fields, nonce }
  const txHash = await world.safe.getTransactionHash(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, nonce)
  let signatures = await ownerSignatures(world, signers, tx)
  if (contextPayload !== null) signatures = utils.appendSignatureExtension(signatures, contextPayload)
  const result = await send(() =>
    world.safe
      .connect(world.base.relayer)
      .execTransaction(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures, {
        gasLimit: TX_GAS_LIMIT
      })
  )
  return { ...result, nonce, signatures, txHash }
}

// ---------------------------------------------------------------------------------------------
// Setup (SPEC §3)
// ---------------------------------------------------------------------------------------------

export const PERMISSION: Record<string, number> = { NONE: 0, ONCE: 1, ALWAYS: 2 }
export const OPERATION: Record<string, number> = { CALL: 0, DELEGATECALL: 1 }

/** Storage slots of the allowance mappings: OpenZeppelin ERC20 v5 `_allowances` (slot 1), WETH9 `allowance` (slot 4). */
function allowanceSlot(mappingSlot: number, owner: string, spender: string): string {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const inner = ethers.keccak256(coder.encode(['address', 'uint256'], [owner, mappingSlot]))
  return ethers.keccak256(coder.encode(['address', 'bytes32'], [spender, inner]))
}

export interface CreateWorldOptions {
  /** Rules used instead of `setup.rules` (challenges: the solution). */
  rules?: RuleSpec[]
  /** Encodes RuleSpec[] to Configuration structs (injected to avoid a cycle with encode.ts). */
  encodeRules: (world: World, rules: RuleSpec[]) => any[]
  describeRevert: (world: World, data: string) => string
}

export async function createWorld(base: Base, setup: SetupSpec, options: CreateWorldOptions): Promise<World> {
  await base.snapshot.restore()

  const delay = setup.delay ?? 3600
  const expiry = setup.expiry ?? 604800
  const { safePolicyGuard: guard } = await deployers.deploySafePolicyGuard({ delay: BigInt(delay), expiry: BigInt(expiry) })

  const book: Record<string, BookEntry> = { ...base.book }
  book.PolicyGuard = { name: 'PolicyGuard', address: await guard.getAddress(), kind: 'guard' }
  const partial = { book } as World

  const ownerNames = setup.owners ?? ['Alice', 'Bob', 'Carol']
  const threshold = setup.threshold ?? 2
  const owners = ownerNames.map((name) => resolve(partial, name))

  // 1. Safe with owners and threshold, no guard, no fallback handler, nonce 0.
  const initializer = base.singleton.interface.encodeFunctionData('setup', [owners, threshold, ethers.ZeroAddress, '0x', ethers.ZeroAddress, ethers.ZeroAddress, 0, ethers.ZeroAddress])
  const singletonAddress = await base.singleton.getAddress()
  const safeAddress = await utils.calculateProxyAddress(base.safeProxyFactory, singletonAddress, initializer, 0n)
  const created = await send(() => base.safeProxyFactory.connect(base.relayer).createProxyWithNonce(singletonAddress, initializer, 0n, { gasLimit: TX_GAS_LIMIT }))
  if (!created.ok) throw new HarnessSetupError(`Safe creation failed (owners ${ownerNames.join(', ')}, threshold ${threshold})`, created.revertData)
  const safe = base.singleton.attach(safeAddress).connect(base.relayer)
  book.Safe = { name: 'Safe', address: safeAddress, kind: 'safe' }

  const byAddress = new Map<string, string>()
  for (const entry of Object.values(book)) if (!byAddress.has(entry.address.toLowerCase())) byAddress.set(entry.address.toLowerCase(), entry.name)

  const world: World = { base, safe, guard, book, byAddress, delay, expiry, setupNonce: 0n, pendingWait: 0 }

  const setupSigners = ownerNames.slice(0, threshold).map((name) => keyOf(world, name))
  const setupTx = async (label: string, to: string, data: string) => {
    const result = await execSafeTx(world, { ...safeTx({ to, data, nonce: 0n }) }, setupSigners, null)
    if (!result.ok) {
      throw new HarnessSetupError(`setup step "${label}" reverted: ${options.describeRevert(world, result.revertData ?? '0x')}`, result.revertData)
    }
  }

  // 2. Modules.
  for (const name of setup.modules ?? []) {
    await setupTx(`enableModule(${name})`, safeAddress, safe.interface.encodeFunctionData('enableModule', [resolve(world, name)]))
  }

  // 3. Balances and allowances.
  for (const [asset, human] of Object.entries(setup.balances ?? {})) {
    if (asset === 'ETH') {
      await helpers.setBalance(safeAddress, toUnits(human, 18))
    } else if (asset === 'USDC' || asset === 'SAFE') {
      const token = asset === 'USDC' ? base.usdc : base.safeToken
      const minted = await send(() => token.connect(base.relayer).mint(safeAddress, toUnits(human, book[asset].decimals ?? 18), { gasLimit: TX_GAS_LIMIT }))
      if (!minted.ok) throw new HarnessSetupError(`minting ${human} ${asset} failed`)
    } else if (asset === 'WETH') {
      const amount = toUnits(human, 18)
      await (await base.weth.connect(base.relayer).deposit({ value: amount })).wait()
      await (await base.weth.connect(base.relayer).transfer(safeAddress, amount)).wait()
    } else {
      throw new HarnessSetupError(`unknown asset "${asset}" in setup.balances (expected ETH, USDC, SAFE or WETH)`)
    }
  }
  for (const allowance of setup.allowances ?? []) {
    const tokenAddress = resolve(world, allowance.token)
    const owner = resolve(world, allowance.owner)
    const spender = resolve(world, allowance.spender)
    const amount = toUnits(allowance.amount, decimalsOf(world, tokenAddress))
    const mappingSlot = allowance.token === 'WETH' ? 4 : 1
    if (!['USDC', 'SAFE', 'WETH'].includes(allowance.token)) throw new HarnessSetupError(`allowance on "${allowance.token}" is not a token`)
    await helpers.setStorageAt(tokenAddress, allowanceSlot(mappingSlot, owner, spender), ethers.toBeHex(amount, 32))
    const token = allowance.token === 'WETH' ? base.weth : allowance.token === 'USDC' ? base.usdc : base.safeToken
    const stored = await token.allowance(owner, spender)
    if (stored !== amount) throw new HarnessSetupError(`allowance storage write did not take effect for ${allowance.token}`)
  }

  // 4. Rules, through configureImmediately while no guard is installed.
  const rules = options.rules ?? setup.rules ?? []
  if (rules.length > 0) {
    const configurations = options.encodeRules(world, rules)
    await setupTx('configureImmediately(rules)', book.PolicyGuard.address, guard.interface.encodeFunctionData('configureImmediately', [configurations]))
  }

  // 5. Guards. The module guard goes first: once the transaction guard is installed, the
  //    setModuleGuard transaction itself would be checked by the rules just configured. The final
  //    state is the one SPEC §3 describes ("setGuard then setModuleGuard").
  const guards = { transaction: true, module: true, ...(setup.guards ?? {}) }
  if (guards.module) await setupTx('setModuleGuard(PolicyGuard)', safeAddress, safe.interface.encodeFunctionData('setModuleGuard', [book.PolicyGuard.address]))
  if (guards.transaction) await setupTx('setGuard(PolicyGuard)', safeAddress, safe.interface.encodeFunctionData('setGuard', [book.PolicyGuard.address]))

  world.setupNonce = BigInt(await safe.nonce())
  return world
}

/** Reads a guard slot of the Safe. */
export async function readGuard(world: World, slot: string): Promise<string> {
  const raw = await world.safe.getStorageAt(slot, 1)
  return ethers.getAddress(ethers.dataSlice(raw, 12))
}

export async function enabledModules(world: World): Promise<string[]> {
  const [modules] = await world.safe.getModulesPaginated(SENTINEL, 100)
  return modules.map((m: string) => ethers.getAddress(m))
}
