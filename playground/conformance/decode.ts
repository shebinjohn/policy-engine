/**
 * Decodes revert data into the nested shape of the engine's SimError (SPEC §1.1):
 * `{ by, error, policy?, reason?, args? }`, recursing into `PolicyReverted.reason`.
 *
 * Error names come from the ABIs of the guard (PolicyEngine + SafePolicyGuard + SignatureExtension),
 * every policy (including the FROST / Secp256k1 / EpochRollover library errors SafenetPolicy can
 * raise), OpenZeppelin ERC-20 v5, plus `Error(string)` (Safe GSxxx codes) and `Panic(uint256)`.
 * Empty data is `Reverted`.
 */
import { engineArtifact, ethers } from './upstream'
import { nameOf, World } from './world'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ErrorSource = 'safe' | 'guard' | 'execution'

export interface ChainError {
  by: ErrorSource
  error: string
  policy?: string | null
  reason?: ChainError
  args?: Record<string, string>
}

const ABI_SOURCES = [
  'SafePolicyGuard.sol/SafePolicyGuard.json',
  'policies/AllowPolicy.sol/AllowPolicy.json',
  'policies/DenyPolicy.sol/DenyPolicy.json',
  'policies/OneTimeAllowPolicy.sol/OneTimeAllowPolicy.json',
  'policies/AllowedModulePolicy.sol/AllowedModulePolicy.json',
  'policies/NativeTransferPolicy.sol/NativeTransferPolicy.json',
  'policies/ERC20TransferPolicy.sol/ERC20TransferPolicy.json',
  'policies/ERC20ApprovePolicy.sol/ERC20ApprovePolicy.json',
  'policies/MultiSendPolicy.sol/MultiSendPolicy.json',
  'policies/CoSignerPolicy.sol/CoSignerPolicy.json',
  'policies/IncreasedThresholdPolicy.sol/IncreasedThresholdPolicy.json',
  'policies/SafenetPolicy.sol/SafenetPolicy.json',
  'test/TestERC20Token.sol/TestERC20Token.json'
]

let errorTable: Map<string, any> | undefined

/** selector -> ErrorFragment, built from the compiled artifacts. Same-signature errors (Unauthorized(), ...) share a selector and a name. */
function errors(): Map<string, any> {
  if (errorTable) return errorTable
  const table = new Map<string, any>()
  for (const source of ABI_SOURCES) {
    const iface = new ethers.Interface(engineArtifact(source).abi)
    iface.forEachError((fragment: any) => {
      if (!table.has(fragment.selector)) table.set(fragment.selector, fragment)
    })
  }
  errorTable = table
  return table
}

const ERROR_STRING = '0x08c379a0'
const PANIC = '0x4e487b71'

/** Decodes one level (and recursively the nested reasons). `by` of nested reasons is always 'guard'. */
export function decodeRevert(world: World, data: string, by: ErrorSource = 'guard'): ChainError {
  if (!data || data === '0x') return { by, error: 'Reverted' }
  const selector = ethers.dataSlice(data, 0, 4).toLowerCase()
  const body = ethers.dataSlice(data, 4)
  const coder = ethers.AbiCoder.defaultAbiCoder()
  try {
    if (selector === ERROR_STRING) {
      const [message] = coder.decode(['string'], body)
      return { by, error: message }
    }
    if (selector === PANIC) {
      const [code] = coder.decode(['uint256'], body)
      return { by, error: 'Panic', args: { code: ethers.toBeHex(code) } }
    }
    const fragment = errors().get(selector)
    if (!fragment) return { by, error: selector, args: { data } }
    const values = coder.decode(fragment.inputs, body)
    const args: Record<string, string> = {}
    fragment.inputs.forEach((input: any, i: number) => {
      args[input.name || String(i)] = String(values[i])
    })
    if (fragment.name === 'AccessDenied') {
      const policy = values[0] as string
      return { by, error: 'AccessDenied', policy: policy === ethers.ZeroAddress ? null : nameOf(world, policy), args }
    }
    if (fragment.name === 'PolicyReverted') {
      const policy = values[0] as string
      return { by, error: 'PolicyReverted', policy: nameOf(world, policy), reason: decodeRevert(world, values[1] as string, 'guard'), args: { policy } }
    }
    return Object.keys(args).length > 0 ? { by, error: fragment.name, args } : { by, error: fragment.name }
  } catch {
    return { by, error: selector, args: { data } }
  }
}

/** Errors the guard raises while *checking* a transaction (as opposed to while executing one). */
const GUARD_CHECK_ERRORS = new Set([
  'AccessDenied',
  'PolicyReverted',
  'GuardTargetDenied',
  'ModuleConfigurationDenied',
  'NonZeroGasPrice',
  'NonZeroSafeTxGas',
  'ModuleExecutionFailed',
  'ExecutionFailed',
  'Reentrancy',
  'MalformedSignatureExtension'
])

/** Safe codes raised before the guard runs (signatures, gas). GS104 is handled on the module path. */
const SAFE_CODES = new Set(['GS010', 'GS020', 'GS021', 'GS022', 'GS023', 'GS024', 'GS025', 'GS026'])

export interface ClassifyInput {
  path: 'owner' | 'module'
  /** The owner path's signatures failed `checkSignatures` before execution (a view call with the same bytes). */
  signaturesRejected?: boolean
  moduleEnabled?: boolean
  /** Is the guard for this path (transaction guard for owner txs, module guard for module txs) the PolicyGuard? */
  guardInstalled: boolean
  /** Top-level calldata length (the engine raises InvalidSelector for 1-3 bytes). */
  dataLength: number
}

/**
 * Who stopped the transaction (SPEC §5-§6): `safe` for signature / module-enabled checks, `guard`
 * for guard and engine check errors, `execution` for inner call reverts bubbled by Safe 1.5.0.
 */
export function classify(world: World, data: string, input: ClassifyInput): ChainError {
  const decoded = decodeRevert(world, data, 'execution')
  let by: ErrorSource = 'execution'
  if (input.path === 'owner' && input.signaturesRejected) by = 'safe'
  else if (input.path === 'owner' && (decoded.error === 'GS010' || (input.signaturesRejected === undefined && SAFE_CODES.has(decoded.error)))) by = 'safe'
  else if (input.path === 'module' && input.moduleEnabled === false && decoded.error === 'GS104') by = 'safe'
  else if (input.guardInstalled && GUARD_CHECK_ERRORS.has(decoded.error)) by = 'guard'
  else if (input.guardInstalled && decoded.error === 'InvalidSelector' && input.dataLength > 0 && input.dataLength < 4) by = 'guard'
  return { ...decoded, by }
}

/** One-line rendering for messages: `PolicyReverted(MultiSendPolicy) <- PolicyReverted(ERC20TransferPolicy) <- Unauthorized`. */
export function describe(error: ChainError | undefined): string {
  if (!error) return 'none'
  const policy = error.policy !== undefined ? `(${error.policy ?? 'null'})` : ''
  const args = error.args && !['AccessDenied', 'PolicyReverted'].includes(error.error) ? ` ${JSON.stringify(error.args)}` : ''
  const head = `${error.by}:${error.error}${policy}${args}`
  return error.reason ? `${head} <- ${describe(error.reason)}` : head
}
