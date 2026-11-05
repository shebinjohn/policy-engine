/**
 * Turns the symbolic content shapes (RuleSpec, CallSpec, SubTxSpec, ContextSpec) into the exact
 * bytes the contracts read.
 */
import type { CallSpec, ContextSpec, RuleSpec, SubTxSpec, TxSpec } from '../src/engine/types'
import { ethers, frost, utils } from './upstream'
import {
  enabledModules,
  keyOf,
  OPERATION,
  ownerSignatures,
  PERMISSION,
  policyTxHash,
  resolve,
  safeTx,
  SAFENET,
  SENTINEL,
  toUnits,
  decimalsOf,
  World
} from './world'

/* eslint-disable @typescript-eslint/no-explicit-any */

const coder = () => ethers.AbiCoder.defaultAbiCoder()

/** SPEC §4 function catalog. `kind` drives argument encoding. */
export const CATALOG: Record<string, { signature: string; args: ('address' | 'amount' | 'uint' | 'bytes32' | 'configurations' | 'batch')[] }> = {
  transfer: { signature: 'transfer(address,uint256)', args: ['address', 'amount'] },
  approve: { signature: 'approve(address,uint256)', args: ['address', 'amount'] },
  transferFrom: { signature: 'transferFrom(address,address,uint256)', args: ['address', 'address', 'amount'] },
  deposit: { signature: 'deposit()', args: [] },
  withdraw: { signature: 'withdraw(uint256)', args: ['amount'] },
  setGuard: { signature: 'setGuard(address)', args: ['address'] },
  setModuleGuard: { signature: 'setModuleGuard(address)', args: ['address'] },
  enableModule: { signature: 'enableModule(address)', args: ['address'] },
  disableModule: { signature: 'disableModule(address,address)', args: ['address', 'address'] },
  changeThreshold: { signature: 'changeThreshold(uint256)', args: ['uint'] },
  addOwnerWithThreshold: { signature: 'addOwnerWithThreshold(address,uint256)', args: ['address', 'uint'] },
  removeOwner: { signature: 'removeOwner(address,address,uint256)', args: ['address', 'address', 'uint'] },
  configureImmediately: { signature: 'configureImmediately((address,bytes4,uint8,address,bytes)[])', args: ['configurations'] },
  requestConfiguration: { signature: 'requestConfiguration(bytes32)', args: ['bytes32'] },
  applyConfiguration: { signature: 'applyConfiguration((address,bytes4,uint8,address,bytes)[])', args: ['configurations'] },
  invalidateRoot: { signature: 'invalidateRoot(bytes32)', args: ['bytes32'] },
  multiSend: { signature: 'multiSend(bytes)', args: ['batch'] }
}

export function selectorOf(fn: string): string {
  const entry = CATALOG[fn]
  if (!entry) throw new Error(`unknown catalog function "${fn}"`)
  return ethers.dataSlice(ethers.id(entry.signature), 0, 4)
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

function ruleSelector(rule: RuleSpec): string {
  if (rule.fallback) return '0x00000000'
  const selector = rule.selector ?? 'none'
  if (selector === 'none') return '0x00000000'
  if (/^0x[0-9a-fA-F]{8}$/.test(selector)) return selector.toLowerCase()
  return selectorOf(selector)
}

function encodePermissions(world: World, list: { account: string; permission: string }[] | undefined): string {
  return coder().encode(
    ['tuple(address account, uint8 permission)[]'],
    [
      (list ?? []).map(({ account, permission }) => {
        if (!(permission in PERMISSION)) throw new Error(`unknown permission "${permission}"`)
        return { account: resolve(world, account), permission: PERMISSION[permission] }
      })
    ]
  )
}

/** The `data` bytes handed to the policy's `configure`, per policy (same encodings as src/utils.ts). */
export function encodePolicyConfig(world: World, rule: RuleSpec): string {
  if (rule.data !== undefined) return rule.data
  const config: any = rule.config ?? {}
  switch (rule.policy) {
    case 'OneTimeAllowPolicy':
      return utils.encodeOneTimeGrantConfig(config.granted ?? true)
    case 'AllowedModulePolicy':
      return utils.encodeModuleConfig(resolve(world, config.module), config.allowed ?? true)
    case 'CoSignerPolicy':
      return utils.encodeCoSignerConfig(resolve(world, config.cosigner))
    case 'IncreasedThresholdPolicy':
      return utils.encodeIncreasedThresholdConfig(Number(config.maxAbsent ?? 0))
    case 'ERC20TransferPolicy':
      return encodePermissions(world, config.recipients ?? config.spenders)
    case 'ERC20ApprovePolicy':
      return encodePermissions(world, config.spenders ?? config.recipients)
    default:
      return '0x'
  }
}

/** RuleSpec -> SafePolicyGuard.Configuration. */
export function encodeRule(world: World, rule: RuleSpec) {
  const operationName = rule.fallback ?? rule.operation ?? 'CALL'
  if (!(operationName in OPERATION)) throw new Error(`unknown operation "${operationName}"`)
  return {
    target: rule.fallback ? ethers.ZeroAddress : resolve(world, rule.target ?? 'Zero'),
    selector: ruleSelector(rule),
    operation: OPERATION[operationName],
    policy: rule.policy === null || rule.policy === undefined ? ethers.ZeroAddress : resolve(world, rule.policy),
    data: rule.policy === null || rule.policy === undefined ? (rule.data ?? '0x') : encodePolicyConfig(world, rule)
  }
}

export function encodeRules(world: World, rules: RuleSpec[]) {
  return rules.map((rule) => encodeRule(world, rule))
}

export function configurationRoot(world: World, rules: RuleSpec[]): string {
  return utils.getConfigurationRoot(encodeRules(world, rules))
}

// ---------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------

/** A checked (sub-)transaction: what a policy sees. `subs` is set for a multiSend built from a `batch`. */
export interface Checked {
  to: string // resolved; 0x0 kept as given (MultiSend and MultiSendPolicy map it to the Safe)
  value: bigint
  data: string
  operation: number
  context?: ContextSpec
  subs?: Checked[]
}

async function prevInList(list: string[], item: string): Promise<string> {
  const index = list.findIndex((entry) => entry.toLowerCase() === item.toLowerCase())
  return index <= 0 ? SENTINEL : list[index - 1]
}

function asAddress(world: World, value: unknown): string {
  return resolve(world, String(value))
}

function asUint(value: unknown): bigint {
  if (typeof value === 'boolean') throw new Error(`expected an integer, got ${value}`)
  return BigInt(value as any)
}

/** Encodes a CallSpec aimed at `to` (resolved). Returns calldata and, for multiSend, the decoded sub-transactions. */
export async function encodeCall(world: World, call: CallSpec, to: string): Promise<{ data: string; subs?: Checked[] }> {
  const entry = CATALOG[call.fn]
  if (!entry) throw new Error(`unknown catalog function "${call.fn}" (SPEC §4)`)
  const iface = new ethers.Interface([`function ${entry.signature}`])
  const args = [...(call.args ?? [])]
  const amountDecimals = decimalsOf(world, to)

  switch (call.fn) {
    case 'disableModule': {
      // args: [module] (the harness fills prevModule) or [prevModule, module].
      if (args.length === 1) {
        const module = asAddress(world, args[0])
        return { data: iface.encodeFunctionData('disableModule', [await prevInList(await enabledModules(world), module), module]) }
      }
      return { data: iface.encodeFunctionData('disableModule', [asAddress(world, args[0]), asAddress(world, args[1])]) }
    }
    case 'removeOwner': {
      // args: [owner, threshold] (the harness fills prevOwner) or [prevOwner, owner, threshold].
      if (args.length === 2) {
        const owner = asAddress(world, args[0])
        const owners: string[] = (await world.safe.getOwners()).map((o: string) => ethers.getAddress(o))
        return { data: iface.encodeFunctionData('removeOwner', [await prevInList(owners, owner), owner, asUint(args[1])]) }
      }
      return { data: iface.encodeFunctionData('removeOwner', [asAddress(world, args[0]), asAddress(world, args[1]), asUint(args[2])]) }
    }
    case 'configureImmediately':
    case 'applyConfiguration':
      // The guard's own ABI, so the Configuration struct is encoded exactly as SafePolicyGuard declares it.
      return { data: world.guard.interface.encodeFunctionData(call.fn, [encodeRules(world, call.configurations ?? [])]) }
    case 'requestConfiguration':
    case 'invalidateRoot': {
      const root =
        call.configurations !== undefined
          ? configurationRoot(world, call.configurations)
          : typeof args[0] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(args[0])
            ? args[0]
            : configurationRoot(world, [])
      return { data: iface.encodeFunctionData(call.fn, [root]) }
    }
    case 'multiSend': {
      const subs = await Promise.all((call.batch ?? []).map((sub) => encodeSubTx(world, sub)))
      const packed = utils.encodeMultiSend(subs.map((s) => ({ to: s.to, value: s.value, data: s.data, operation: s.operation })))
      return { data: iface.encodeFunctionData('multiSend', [packed]), subs }
    }
    default: {
      const encoded = entry.args.map((kind, i) => {
        const value = args[i]
        if (value === undefined) throw new Error(`${call.fn}: missing argument ${i + 1}`)
        if (kind === 'address') return asAddress(world, value)
        if (kind === 'amount') return toUnits(value as any, amountDecimals)
        if (kind === 'uint') return asUint(value)
        if (kind === 'bytes32') return String(value)
        throw new Error(`${call.fn}: unsupported argument kind ${kind}`)
      })
      return { data: iface.encodeFunctionData(call.fn, encoded) }
    }
  }
}

export async function encodeSubTx(world: World, sub: SubTxSpec): Promise<Checked> {
  const to = resolve(world, sub.to)
  const operation = OPERATION[sub.operation ?? 'CALL']
  if (operation === undefined) throw new Error(`unknown operation "${sub.operation}"`)
  const value = toUnits(sub.value ?? '0', 18)
  if (sub.call) {
    const { data, subs } = await encodeCall(world, sub.call, to)
    return { to, value, data, operation, context: sub.context, subs }
  }
  return { to, value, data: sub.data ?? '0x', operation, context: sub.context }
}

export async function encodeTx(world: World, tx: TxSpec): Promise<Checked> {
  const to = resolve(world, tx.to)
  const operation = OPERATION[tx.operation ?? 'CALL']
  if (operation === undefined) throw new Error(`unknown operation "${tx.operation}"`)
  const value = toUnits(tx.value ?? '0', 18)
  if (tx.call) {
    const { data, subs } = await encodeCall(world, tx.call, to)
    return { to, value, data, operation, context: tx.context, subs }
  }
  return { to, value, data: tx.data ?? '0x', operation, context: tx.context }
}

// ---------------------------------------------------------------------------------------------
// Policy context (the SignatureExtension payload)
// ---------------------------------------------------------------------------------------------

export interface ContextEnv {
  nonce: bigint // the nonce the owners sign (policies use nonce() - 1 after the increment)
  outer: Checked // the top-level transaction
  safeAddress: string
}

/** What a policy reads as `to`: MultiSend and MultiSendPolicy map a sub-transaction's 0x0 to the Safe. */
function effectiveTo(env: ContextEnv, checked: Checked, isSub: boolean): string {
  return isSub && checked.to === ethers.ZeroAddress ? env.safeAddress : checked.to
}

async function hashOf(world: World, env: ContextEnv, checked: Checked, isSub: boolean): Promise<string> {
  return policyTxHash(world, { to: effectiveTo(env, checked, isSub), value: checked.value, data: checked.data, operation: checked.operation }, env.nonce)
}

async function attestation(world: World, safeTxHash: string, key: 'trusted' | 'untrusted', valid: boolean): Promise<string> {
  const secret = key === 'trusted' ? SAFENET.trustedSecret : SAFENET.untrustedSecret
  const domain = frost.consensusDomainSeparator(SAFENET.consensusChainId, SAFENET.consensusAddress)
  const oracle = '0x0000000000000000000000000000000000000ac1'
  const oracleDataHash = ethers.id('policy-engine-playground:oracle-data')
  const message = frost.transactionProposalMessage(domain, SAFENET.epoch, oracle, oracleDataHash, safeTxHash)
  const { groupKey, signature } = await frost.signFrost(world.base.testFrost, secret, 0x1234abcdn, message)
  // valid: false keeps the shape and the key but breaks the Schnorr equation (z + 1).
  const z = valid ? signature.z : (signature.z + 1n) % frost.SECP256K1_N
  return frost.encodeAttestation({ epoch: SAFENET.epoch, oracle, oracleDataHash, groupKey, signature: { r: signature.r, z } })
}

/** The positional context list MultiSendPolicy._decodeNextContext reads: [uint256 length][bytes] per sub-transaction. */
export function packContextList(items: (string | null)[]): string {
  return ethers.concat(items.map((item) => ethers.concat([ethers.toBeHex(ethers.dataLength(item ?? '0x'), 32), item ?? '0x'])))
}

/**
 * Builds the context bytes for `checked` (a top-level tx when `isSub` is false). `null` = no context.
 * A multiSend built from a `batch` with no explicit context gets the positional list of its
 * sub-transactions' contexts (recursively), or no context if none of them has one.
 */
export async function buildContext(world: World, env: ContextEnv, spec: ContextSpec | undefined, checked: Checked, isSub: boolean): Promise<string | null> {
  if (spec === undefined || spec === null) {
    if (!checked.subs) return null
    const items = await Promise.all(checked.subs.map((sub) => buildContext(world, env, sub.context, sub, true)))
    return items.some((item) => item !== null) ? packContextList(items) : null
  }
  switch (spec.type) {
    case 'cosignature': {
      const signer = keyOf(world, spec.signer)
      const target = spec.over === 'batch' ? env.outer : checked
      const targetIsSub = spec.over === 'batch' ? false : isSub
      const fields = safeTx({ to: effectiveTo(env, target, targetIsSub), value: target.value, data: target.data, operation: target.operation, nonce: env.nonce })
      const signature = await utils.safeSignTypedData(signer, env.safeAddress, fields, world.base.chainId)
      return signature.data
    }
    case 'ownerSignatures': {
      const signers = spec.signers.map((name) => keyOf(world, name))
      const fields = safeTx({ to: effectiveTo(env, checked, isSub), value: checked.value, data: checked.data, operation: checked.operation, nonce: env.nonce })
      return ownerSignatures(world, signers, fields)
    }
    case 'attestation':
      return attestation(world, await hashOf(world, env, checked, isSub), spec.key, spec.valid)
    case 'batch': {
      const items = await Promise.all(spec.items.map((item, i) => buildContext(world, env, item, checked.subs?.[i] ?? checked, checked.subs?.[i] !== undefined || isSub)))
      return packContextList(items)
    }
    default:
      throw new Error(`unknown context type ${JSON.stringify(spec)}`)
  }
}
