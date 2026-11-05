/**
 * Every plain-language string the engine produces: trace titles and details, effect titles and
 * error messages. Voice: short, declarative, no emoji, no em dashes. Hex, function signatures and
 * Solidity error signatures go in `tech` only.
 */
import { ethers } from 'ethers'

import { isFallbackAccess, parseAccess, type Op } from './access.ts'
import {
  POLICY_LABELS,
  ZERO,
  eqAddr,
  formatAsset,
  kindOf,
  shortLabel
} from './book.ts'
import { SELECTORS, catalogBySelector, decodeConfigurations, GUARD_IFACE, MULTISEND_IFACE } from './catalog.ts'
import type { Fault } from './errors.ts'
import type { ErrorSource, PolicyName, World } from './types.ts'

const L = POLICY_LABELS
export const policyLabel = (p: PolicyName): string => POLICY_LABELS[p]

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

export function formatTime(unix: number): string {
  const d = new Date(unix * 1000)
  const iso = d.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 seconds'
  if (seconds % 86400 === 0) return plural(seconds / 86400, 'day')
  if (seconds % 3600 === 0) return plural(seconds / 3600, 'hour')
  if (seconds % 60 === 0) return plural(seconds / 60, 'minute')
  return plural(seconds, 'second')
}

const FN_PHRASE: Record<string, (target: string) => string> = {
  transfer: (t) => `${t} transfers`,
  approve: (t) => `${t} approvals`,
  transferFrom: (t) => `${t} transferFrom pulls`,
  deposit: (t) => `${t} deposits`,
  withdraw: (t) => `${t} withdrawals`,
  setGuard: () => 'guard changes',
  setModuleGuard: () => 'module guard changes',
  enableModule: () => 'enabling modules',
  disableModule: () => 'disabling modules',
  changeThreshold: () => 'threshold changes',
  addOwnerWithThreshold: () => 'adding owners',
  removeOwner: () => 'removing owners',
  configureImmediately: () => 'immediate rule changes',
  requestConfiguration: () => 'rule change requests',
  applyConfiguration: () => 'applying rule changes',
  invalidateRoot: () => 'cancelling rule change requests',
  multiSend: (t) => `${t} batches`
}

const SAFE_FNS = new Set([
  'setGuard',
  'setModuleGuard',
  'enableModule',
  'disableModule',
  'changeThreshold',
  'addOwnerWithThreshold',
  'removeOwner'
])

/** Plain words for the calls an access selector covers: "USDC transfers", "plain transfers to Dave". */
export function describeAccess(w: World | null, access: string): string {
  const { target, selector, op } = parseAccess(access)
  if (isFallbackAccess(access)) {
    return op === 1 ? 'any delegatecall without its own rule' : 'any call without its own rule'
  }
  const t = shortLabel(w, target)
  const suffix = op === 1 ? ' (as delegatecall)' : ''
  if (selector === '0x00000000') return `plain transfers and empty calls to ${t}${suffix}`
  const entry = catalogBySelector(selector)
  if (entry) {
    const kind = kindOf(w, target)
    if (entry.name === 'multiSend') return op === 1 ? `${t} batches` : `${t} batches as a plain call`
    if (SAFE_FNS.has(entry.name) && kind !== 'safe') return `${entry.name} calls to ${t}${suffix}`
    return FN_PHRASE[entry.name](t) + suffix
  }
  return `calls to ${t} with an unknown function${suffix}`
}

/** Plain description of one call, decoded from its bytes. */
export function describeCall(w: World | null, to: string, value: bigint, data: string, op: Op): string {
  const t = shortLabel(w, to)
  const withEth = value > 0n ? ` with ${formatAsset(w, 'ETH', value)}` : ''
  const len = ethers.dataLength(data)
  if (len === 0) {
    if (op === 1) return `Delegatecall into ${t} with no data`
    return value > 0n ? `Send ${formatAsset(w, 'ETH', value)} to ${t}` : `Empty call to ${t}`
  }
  if (len < 4) return `Call ${t} with ${plural(len, 'byte')} of data${withEth}`
  const selector = data.slice(0, 10)
  const entry = catalogBySelector(selector)
  if (!entry) {
    return op === 1 ? `Delegatecall into ${t} with an unknown function` : `Call ${t} with an unknown function${withEth}`
  }
  let args: ethers.Result
  try {
    args = entry.iface.decodeFunctionData(entry.name, data)
  } catch {
    return `Call ${entry.name} on ${t} with unreadable data${withEth}`
  }
  const dc = op === 1 ? 'Delegatecall: ' : ''
  const amount = (raw: unknown) => formatAsset(w, to, BigInt(raw as bigint))
  const who = (raw: unknown) => shortLabel(w, String(raw))
  switch (entry.name) {
    case 'transfer':
      return `${dc}Send ${amount(args[1])} to ${who(args[0])}${withEth}`
    case 'approve':
      return BigInt(args[1]) === 0n
        ? `${dc}Remove the ${shortLabel(w, to)} allowance of ${who(args[0])}${withEth}`
        : `${dc}Approve ${who(args[0])} to spend ${amount(args[1])}${withEth}`
    case 'transferFrom':
      return `${dc}Move ${amount(args[2])} from ${who(args[0])} to ${who(args[1])}${withEth}`
    case 'deposit':
      return `${dc}Wrap ${formatAsset(w, 'ETH', value)} into ${t}`
    case 'withdraw':
      return `${dc}Unwrap ${amount(args[0])}${withEth}`
    case 'setGuard':
      return eqAddr(String(args[0]), ZERO)
        ? `${dc}Remove the transaction guard`
        : `${dc}Set the transaction guard to ${who(args[0])}`
    case 'setModuleGuard':
      return eqAddr(String(args[0]), ZERO)
        ? `${dc}Remove the module guard`
        : `${dc}Set the module guard to ${who(args[0])}`
    case 'enableModule':
      return `${dc}Enable ${who(args[0])}`
    case 'disableModule':
      return `${dc}Disable ${who(args[1])}`
    case 'changeThreshold':
      return `${dc}Change the threshold to ${args[0]}`
    case 'addOwnerWithThreshold':
      return `${dc}Add ${who(args[0])} as an owner, threshold ${args[1]}`
    case 'removeOwner':
      return `${dc}Remove ${who(args[1])} as an owner, threshold ${args[2]}`
    case 'configureImmediately':
      return `${dc}Set ${plural((args[0] as ethers.Result).length, 'rule')} immediately`
    case 'requestConfiguration':
      return `${dc}Request a rule change`
    case 'applyConfiguration':
      return `${dc}Apply a rule change of ${plural((args[0] as ethers.Result).length, 'rule')}`
    case 'invalidateRoot':
      return `${dc}Cancel a rule change request`
    case 'multiSend': {
      const n = countBatch(String(args[0]))
      const steps = n === null ? 'a batch' : `a batch of ${plural(n, 'step')}`
      return op === 1 ? `Run ${steps}` : `Call MultiSend directly with ${steps}${withEth}`
    }
  }
  return `Call ${t}`
}

function countBatch(packed: string): number | null {
  const bytes = ethers.getBytes(packed)
  let i = 0
  let n = 0
  while (i < bytes.length) {
    if (i + 85 > bytes.length) return null
    const len = Number(BigInt(ethers.hexlify(bytes.slice(i + 53, i + 85))))
    i += 85 + len
    n++
  }
  return i === bytes.length ? n : null
}

/** Rule change, plain words: "USDC transfers are checked by Recipient Allowlist". */
export function describeRule(w: World | null, access: string, policy: PolicyName | null, config?: string): string {
  const what = describeAccess(w, access)
  const cap = what.charAt(0).toUpperCase() + what.slice(1)
  if (policy === null) return `${cap} no longer have their own rule`
  return `${cap} are checked by ${policyLabel(policy)}${config ? ` (${config})` : ''}`
}

export function functionTech(selector: string): string {
  const entry = catalogBySelector(selector)
  if (!entry) return selector
  return `${entry.iface.getFunction(entry.name)!.format('sighash')} ${selector}`
}

// ---------------------------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------------------------

const GS: Record<string, string> = {
  GS001: 'The Safe has no threshold set.',
  GS010: 'Not enough gas to run the transaction.',
  GS020: 'Not enough owner signatures.',
  GS021: 'A contract signature points inside the signature data.',
  GS022: 'A contract signature points outside the signature data.',
  GS023: 'A contract signature is longer than the signature data.',
  GS024: 'A contract owner did not accept its signature.',
  GS025: 'An owner did not approve this transaction hash.',
  GS026: 'A signature is not from an owner, or an owner signed twice.',
  GS030: 'Only an owner can approve a hash.',
  GS031: 'Only the Safe itself can change its own settings.',
  GS101: 'That is not a valid module address.',
  GS102: 'That module is already enabled.',
  GS103: 'That module is not enabled, so it cannot be disabled.',
  GS104: 'This module is not enabled on the Safe.',
  GS200: 'The Safe is already set up.',
  GS201: 'The threshold cannot be higher than the number of owners.',
  GS202: 'The threshold must be at least 1.',
  GS203: 'That is not a valid owner address.',
  GS204: 'That address is already an owner.',
  GS205: 'That address is not an owner.',
  GS300: 'That contract is not a transaction guard.',
  GS301: 'That contract is not a module guard.',
  GS400: 'The Safe cannot be its own fallback handler.'
}

const GENERIC: Record<string, string> = {
  InvalidSelector: 'The call data is 1 to 3 bytes long, too short to name a function, so it is always refused.',
  GuardTargetDenied:
    'Transactions may not call the Policy Guard, except to request, apply or cancel a rule change.',
  ModuleConfigurationDenied: 'Modules may not change rules. Only the owners can.',
  NonZeroGasPrice: 'The Policy Guard requires a gas price of 0, because gas refunds could move funds unchecked.',
  NonZeroSafeTxGas: 'The Policy Guard requires the Safe transaction gas to be 0, so a failed call always undoes everything.',
  ModuleExecutionFailed: 'The module call failed, so the Policy Guard reverted it and undid every change.',
  ExecutionFailed: 'The call failed, so the Policy Guard reverted it.',
  PolicyConfigurationFailed: 'A policy rejected its settings for this rule.',
  GuardAlreadyEnabled: 'Rules can only be set immediately before the Policy Guard is installed.',
  RootAlreadyConfigured: 'This rule change is already requested and has not expired.',
  RootNotConfigured: 'This rule change was never requested, or it was already applied or cancelled.',
  RootConfigurationPending: 'The waiting period for this rule change has not ended yet.',
  RootConfigurationExpired: 'This rule change waited too long and expired. Request it again.',
  Reentrancy: 'A check tried to start another check.',
  Reverted: 'The target refused the call and gave no reason.',
  CallFailed: 'The call failed, and the Safe reported it without reverting.',
  Panic: 'The contract hit an internal error.',
  ERC20InsufficientBalance: 'The sender does not hold enough tokens.',
  ERC20InvalidReceiver: 'Tokens cannot be sent to the zero address.',
  ERC20InvalidSender: 'Tokens cannot be taken from the zero address.',
  ERC20InsufficientAllowance: 'The allowance is too small for this transfer.',
  ERC20InvalidSpender: 'The zero address cannot be approved to spend tokens.',
  ERC20InvalidApprover: 'The zero address cannot approve spending.',
  InvalidMulMulAddWitness: 'The Safenet attestation does not match this transaction.',
  InvalidScalar: 'The Safenet attestation is malformed.'
}

const POLICY_ERRORS: Partial<Record<PolicyName, Record<string, string>>> = {
  OneTimeAllowPolicy: { Unauthorized: 'The one-time permission was already used, or was never granted.' },
  AllowedModulePolicy: {
    InvalidModule: 'This rule only lets module transactions through, and this one came from the owners.',
    UnauthorizedModule: 'This module is not on the allowlist.'
  },
  NativeTransferPolicy: {
    InvalidOperation: 'This rule allows plain calls only, not delegatecalls.',
    CalldataNotPermitted: 'This rule allows plain ETH transfers only, and this call carries data.',
    InvalidTransfer: 'This rule allows ETH transfers only, and this call sends no ETH.'
  },
  ERC20TransferPolicy: {
    InvalidTransfer: 'This rule only understands token transfers.',
    Unauthorized: 'The recipient is not on the allowlist for this token.',
    InvalidSelector: 'The Recipient Allowlist can only be attached to transfer or transferFrom.',
    InvalidOperation: 'The Recipient Allowlist can only be attached to plain calls.'
  },
  ERC20ApprovePolicy: {
    InvalidApproval: 'This rule only understands token approvals.',
    Unauthorized: 'The spender is not on the allowlist for this token.',
    InvalidSelector: 'The Spender Allowlist can only be attached to approve.',
    InvalidOperation: 'The Spender Allowlist can only be attached to plain calls.'
  },
  MultiSendPolicy: { InvalidMultiSend: 'This rule only understands MultiSend batches.' },
  CoSignerPolicy: {
    Unauthorized: 'The co-signer did not sign this exact transaction.',
    NoCosignerConfigured: 'No co-signer is set for this rule.',
    CoSignatureAlreadySpent: 'This co-signature was already used in this transaction.',
    ModulePathUnsupported: 'This rule needs a co-signature, so it never lets module transactions through.'
  },
  IncreasedThresholdPolicy: {
    GS020: 'Not enough owner signatures for this rule.',
    GS026: 'One of the extra signatures is not from an owner, or is repeated.',
    SignaturesAlreadySpent: 'These owner signatures were already used for an identical step.',
    ModulePathUnsupported: 'This rule needs owner signatures, so it never lets module transactions through.'
  },
  SafenetPolicy: {
    MalformedAttestation: 'No valid Safenet attestation came with this transaction.',
    UntrustedAttestationKey: 'The attestation was signed by a key Safenet does not trust.',
    AttestationAlreadySpent: 'Safenet already approved another step at this nonce.',
    ModulePathUnsupported: 'This rule needs a Safenet attestation, so it never lets module transactions through.'
  }
}

/** Generic message for an error, used when the thrower gave no specific one. */
export function makeMessageFor(w: World | null) {
  const messageFor = (fault: Fault, by: ErrorSource, owner?: PolicyName): string => {
    if (fault.error === 'PolicyReverted' && fault.policy) {
      if (fault.policy === 'MultiSendPolicy') return 'The batch was refused because one of its steps was refused.'
      return `The ${policyLabel(fault.policy)} rule refused this call.`
    }
    if (fault.error === 'AccessDenied') {
      if (!fault.policy) return 'No rule covers this call, so the Safe refuses it by default.'
      if (fault.policy === 'DenyPolicy') return 'A Deny rule blocks this call.'
      return `The ${policyLabel(fault.policy)} rule did not approve this call.`
    }
    if (owner && POLICY_ERRORS[owner]?.[fault.error]) return POLICY_ERRORS[owner]![fault.error]
    if (GS[fault.error]) return GS[fault.error]
    if (GENERIC[fault.error]) return GENERIC[fault.error]
    void w
    void by
    return `The call failed with ${fault.error}.`
  }
  return messageFor
}

/** Message for a policy's own error. */
export function policyErrorMessage(policy: PolicyName, error: string): string {
  return POLICY_ERRORS[policy]?.[error] ?? GENERIC[error] ?? GS[error] ?? `${policyLabel(policy)} failed with ${error}.`
}

export function genericMessage(error: string): string {
  return GENERIC[error] ?? GS[error] ?? `The call failed with ${error}.`
}

// ---------------------------------------------------------------------------------------------
// Trace and effect copy
// ---------------------------------------------------------------------------------------------

export const T = {
  // Safe
  signaturesOk: (n: number, of: number) => `${n} of ${of} owners signed`,
  signaturesTooFew: (n: number, need: number) => `Only ${plural(n, 'owner')} signed, the Safe needs ${need}`,
  signaturesBad: (who: string) => `${who} cannot sign for this Safe`,
  signaturesTooFewContext: (n: number, need: number) =>
    `Only ${plural(n, 'owner')} signed, the Safe needs ${need}, and the attached context is no signature`,
  signaturesContextDetail:
    'The Safe reads its missing signatures from the bytes that follow, which here hold the policy context.',
  signaturesDuplicate: (who: string) => `${who} signed twice`,
  signaturesDetail: 'The Safe checks the owner signatures before anything else.',
  nonce: (from: number, to: number) => `Nonce goes from ${from} to ${to}`,
  nonceDetail: (n: number) =>
    `The owners signed nonce ${n}. Policies that check signatures use that number, so a signature works once.`,
  noTxGuard: 'No guard: the Safe runs this without any policy check',
  noTxGuardDetail: 'The Policy Guard is not installed as the transaction guard, so owner transactions skip every rule.',
  noModuleGuard: 'No module guard: modules bypass every policy',
  noModuleGuardDetail: 'The Policy Guard is not installed as the module guard, so this module call skips every rule.',
  moduleEnabled: (m: string) => `${m} is enabled on the Safe`,
  moduleNotEnabled: (m: string) => `${m} is not enabled on the Safe`,
  moduleContextIgnored: 'Module transactions carry no context, so the attached signatures are ignored',
  moduleContextDetail: 'Only owner transactions can carry co-signatures, extra signatures or attestations.',
  gasPriceOk: 'Gas price is 0, so no refund can move funds',
  gasPriceBad: 'Gas price is not 0, so the guard refuses',
  gasPriceDetail: 'Gas refunds could move funds without any policy check, so the guard requires a gas price of 0.',
  safeTxGasOk: 'Safe transaction gas is 0, so a failure undoes everything',
  safeTxGasBad: 'Safe transaction gas is not 0, so the guard refuses',
  safeTxGasDetail:
    'With a gas limit set, a failed call would not revert, and policy changes would stick. The guard forbids it.',
  gasIgnored: 'Gas settings are not 0, and no guard checks them',
  // Engine
  selectorEmpty: 'No calldata: a plain transfer or an empty call',
  selectorEmptyDetail: 'An empty call uses the all-zero function key, the same key as any data that starts with four zero bytes.',
  selectorOk: (fn: string) => `The call names the function ${fn}`,
  selectorUnknown: 'The call names a function the playground does not know',
  selectorZero: 'The data starts with four zero bytes, the same key as an empty call',
  selectorBad: (n: number) => `The data is ${plural(n, 'byte')} long, too short to name a function`,
  selectorBadDetail: 'A function name takes 4 bytes. Data of 1 to 3 bytes is always refused.',
  allowedCall: 'Managing policies is always allowed, through the waiting period',
  allowedCallDetail:
    'Requesting, applying and cancelling rule changes needs no rule, so the Safe can never lock itself out. Changes still wait for the delay.',
  allowedCallModule: 'Modules may not manage policies',
  allowedCallModuleDetail: 'Only owner transactions may request, apply or cancel rule changes.',
  guardTarget: 'Calls to the Policy Guard itself are refused',
  guardTargetDetail:
    'Only requesting, applying and cancelling rule changes may reach the guard. Setting rules immediately is not possible once the guard is on.',
  exactHit: (what: string, policy: string) => `Rule found: ${what} are checked by ${policy}`,
  exactMiss: (what: string) => `No rule of its own for ${what}`,
  fallbackHit: 'No rule for this call, so the Safe uses the catch-all rule',
  fallbackHitDetail: (policy: string, op: string) => `The catch-all rule for ${op} is ${policy}.`,
  noRule: 'No rule and no catch-all rule, so the Safe refuses by default',
  noRuleDetail: 'Every call needs a rule. Anything without one is denied.',
  // Policies
  allowPass: `${L.AllowPolicy}: this rule lets the call through`,
  denyFail: `${L.DenyPolicy}: this rule refuses the call`,
  denyDetail: 'A Deny rule always refuses, whatever the catch-all rule allows.',
  oneTimePass: `${L.OneTimeAllowPolicy}: the single permission is used now`,
  oneTimeFail: (what: string) => `${L.OneTimeAllowPolicy}: no permission left for ${what}`,
  oneTimeState: (what: string) => `One-time permission for ${what} used up`,
  moduleOwnerPath: `${L.AllowedModulePolicy}: owner transactions never pass this rule`,
  moduleNotAllowed: (m: string) => `${L.AllowedModulePolicy}: ${m} is not on the allowlist`,
  moduleAllowed: (m: string) => `${L.AllowedModulePolicy}: ${m} is on the allowlist`,
  nativeDelegate: `${L.NativeTransferPolicy}: a delegatecall is not a plain transfer`,
  nativeData: `${L.NativeTransferPolicy}: the call carries data, so it is not a plain transfer`,
  nativeDataDetail: 'Data starting with four zero bytes has the same key as an empty call, but this rule checks the data is empty.',
  nativeNoValue: `${L.NativeTransferPolicy}: the call sends no ETH`,
  nativePass: (amount: string, to: string) => `${L.NativeTransferPolicy}: plain transfer of ${amount} to ${to}`,
  transferNotTransfer: `${L.ERC20TransferPolicy}: this is not a token transfer`,
  transferBadData: `${L.ERC20TransferPolicy}: the transfer data cannot be read`,
  transferDenied: (who: string, token: string) => `${L.ERC20TransferPolicy}: ${who} may not receive ${token}`,
  transferAllowed: (who: string, token: string) => `${L.ERC20TransferPolicy}: ${who} may receive ${token}`,
  transferOnce: (who: string, token: string) => `${L.ERC20TransferPolicy}: ${who} may receive ${token} once`,
  transferState: (who: string, token: string) => `One-time permission for ${who} to receive ${token} used up`,
  approveNotApprove: `${L.ERC20ApprovePolicy}: this is not a token approval`,
  approveBadData: `${L.ERC20ApprovePolicy}: the approval data cannot be read`,
  approveRevoke: `${L.ERC20ApprovePolicy}: setting an allowance to 0 is always allowed`,
  approveDenied: (who: string, token: string) => `${L.ERC20ApprovePolicy}: ${who} may not be approved for ${token}`,
  approveAllowed: (who: string, token: string) => `${L.ERC20ApprovePolicy}: ${who} may be approved for ${token}`,
  approveOnce: (who: string, token: string) => `${L.ERC20ApprovePolicy}: ${who} may be approved for ${token} once`,
  approveState: (who: string, token: string) => `One-time permission to approve ${who} for ${token} used up`,
  batchStart: (n: number) => `${L.MultiSendPolicy}: each of the ${plural(n, 'step')} is checked on its own`,
  batchStartUnknown: `${L.MultiSendPolicy}: each step is checked on its own`,
  batchStartDetail:
    'Every step is checked against the rules before any of them runs, so all steps see the Safe as it is now.',
  batchPass: (n: number) => `${L.MultiSendPolicy}: all ${plural(n, 'step')} passed`,
  batchFail: (i: number) => `${L.MultiSendPolicy}: step ${i + 1} was refused, so the whole batch is refused`,
  batchNotMultiSend: `${L.MultiSendPolicy}: this is not a MultiSend batch`,
  batchMalformed: `${L.MultiSendPolicy}: the batch data cannot be read`,
  batchContextMalformed: `${L.MultiSendPolicy}: the attached context is not a list of step contexts`,
  batchStep: (i: number, what: string) => `Step ${i + 1}: ${what}`,
  cosignModule: `${L.CoSignerPolicy}: module transactions cannot carry a co-signature`,
  cosignNone: `${L.CoSignerPolicy}: no co-signer is set for this rule`,
  cosignMissing: (who: string) => `${L.CoSignerPolicy}: no co-signature from ${who}`,
  cosignWrongSigner: (who: string, signer: string) => `${L.CoSignerPolicy}: signed by ${signer}, not ${who}`,
  cosignOverBatch: (who: string) => `${L.CoSignerPolicy}: ${who} signed the whole batch, not this step`,
  cosignOverBatchDetail: 'In a batch each step needs a co-signature over its own transaction, not over the batch.',
  cosignSpent: `${L.CoSignerPolicy}: this co-signature was already used`,
  cosignSpentDetail: 'A batch cannot repeat an identical co-signed step. Vary it, or split it across transactions.',
  cosignPass: (who: string) => `${L.CoSignerPolicy}: ${who} signed this transaction`,
  cosignState: 'Co-signature for this transaction spent',
  thresholdModule: `${L.IncreasedThresholdPolicy}: module transactions carry no signatures`,
  thresholdTooFew: (need: number, got: number) => `${L.IncreasedThresholdPolicy}: needs ${need} owner signatures, got ${got}`,
  thresholdBad: (who: string) => `${L.IncreasedThresholdPolicy}: ${who} is not an owner or signed twice`,
  thresholdNeedDetail: (need: number, owners: number, threshold: number) =>
    `This rule needs ${need} of ${owners} owners, more than the Safe threshold of ${threshold}.`,
  thresholdSpent: `${L.IncreasedThresholdPolicy}: these signatures were already used`,
  thresholdSpentDetail: 'A batch cannot repeat an identical step checked by signatures. Vary it, or split it.',
  thresholdPass: (got: number, owners: number) => `${L.IncreasedThresholdPolicy}: ${got} of ${owners} owners signed`,
  thresholdState: 'Owner signatures for this transaction spent',
  safenetModule: `${L.SafenetPolicy}: module transactions carry no attestation`,
  safenetMalformed: `${L.SafenetPolicy}: no attestation came with this transaction`,
  safenetUntrusted: `${L.SafenetPolicy}: signed by a key Safenet does not trust`,
  safenetSpent: (n: number) => `${L.SafenetPolicy}: nonce ${n} already has an approved step`,
  safenetSpentDetail: 'Safenet approves one check per nonce, so a batch can hold only one Safenet-checked step.',
  safenetInvalid: `${L.SafenetPolicy}: the attestation does not match this transaction`,
  safenetPass: `${L.SafenetPolicy}: the validators approved this transaction`,
  safenetState: (n: number) => `Safenet attestation for nonce ${n} spent`,
  stagedDetail: 'This change is kept only if the whole transaction succeeds.',
  // Execution
  execCall: (what: string) => `Runs: ${what}`,
  execDelegate: (what: string) => `Delegatecall: ${what}`,
  execUnknownCode: (t: string) => `${t} runs its own code with full control of the Safe`,
  execUnknownCodeDetail: 'A delegatecall lets the target act as the Safe. Here it does nothing, but real code could do anything.',
  execMultiSendCall: 'MultiSend runs the steps from its own address, not from the Safe',
  execMultiSendCallDetail:
    'Called without delegatecall, MultiSend acts for itself. The steps cannot spend the Safe funds or change its settings.',
  execRevert: (what: string) => `The call failed: ${what}`,
  execStepDelegate: 'MultiSend (call only) refuses a delegatecall inside a batch',
  afterOk: 'The guard confirms the call succeeded',
  afterModuleFail: 'The module call failed, so the guard reverts everything',
  afterModuleFailDetail: 'Without this, a failed module call would leave policy changes in place.',
  callFailedNoRevert: 'The call failed, but the Safe does not revert',
  callFailedNoRevertDetail: 'Nothing changed. The Safe only reports the failure.',
  commit: 'Transaction executed. Every change is saved.',
  rollback: 'Transaction reverted. Every staged change is undone.',
  rollbackDetail: (items: string[]) =>
    items.length === 0 ? 'Nothing was changed.' : `Undone: ${items.join('; ')}.`
}

export const E = {
  received: (who: string, amount: string) => `${who} received ${amount}`,
  sent: (from: string, who: string, amount: string) => `${from} sent ${amount} to ${who}`,
  moved: (from: string, to: string, amount: string) => `${to} received ${amount} from ${from}`,
  approved: (owner: string, spender: string, amount: string) => `${owner} approved ${spender} to spend ${amount}`,
  allowanceRemoved: (owner: string, spender: string, token: string) => `${owner} removed the ${token} allowance of ${spender}`,
  wrapped: (who: string, amount: string) => `${who} wrapped ${amount}`,
  unwrapped: (who: string, amount: string) => `${who} unwrapped ${amount}`,
  guardSet: (g: string) => `${g} installed as transaction guard`,
  guardRemoved: 'Transaction guard removed',
  moduleGuardSet: (g: string) => `${g} installed as module guard`,
  moduleGuardRemoved: 'Module guard removed',
  moduleEnabled: (m: string) => `${m} enabled`,
  moduleDisabled: (m: string) => `${m} disabled`,
  threshold: (from: number, to: number) => `Threshold changed from ${from} to ${to}`,
  ownerAdded: (o: string) => `${o} added as an owner`,
  ownerRemoved: (o: string) => `${o} removed as an owner`,
  nonce: (from: number, to: number) => `Nonce went from ${from} to ${to}`,
  ruleSet: (text: string) => `Rule set: ${text}`,
  ruleRemoved: (text: string) => `Rule removed: ${text}`,
  rootRequested: (at: string) => `Rule change requested. It can be applied from ${at}`,
  rootCancelled: 'Rule change request cancelled',
  rootApplied: (n: number) => `Rule change applied: ${plural(n, 'rule')}`,
  delegateNoEffect: (t: string) => `${t} ran as the Safe and changed nothing here`,
  noEffectOnSafe: (t: string) => `${t} changed nothing for the Safe`,
  multiSendOwnCall: 'MultiSend acted for itself, not for the Safe'
}

export function describeAssetAmount(w: World | null, asset: string, amount: bigint): string {
  return formatAsset(w, asset, amount)
}

export function permissionWord(p: number): string {
  return p === 2 ? 'always' : p === 1 ? 'once' : 'removed'
}

/** Short config summary for effect copy, decoded from configure data. */
export function describeConfigData(w: World | null, policy: PolicyName, data: string): string | undefined {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  try {
    switch (policy) {
      case 'OneTimeAllowPolicy':
        return coder.decode(['bool'], data)[0] ? 'granted once' : 'grant removed'
      case 'AllowedModulePolicy': {
        const [m, ok] = coder.decode(['address', 'bool'], data)
        return `${shortLabel(w, m)}: ${ok ? 'allowed' : 'not allowed'}`
      }
      case 'CoSignerPolicy':
        return `co-signer ${shortLabel(w, coder.decode(['address'], data)[0])}`
      case 'IncreasedThresholdPolicy': {
        const n = Number(coder.decode(['uint256'], data)[0])
        return n === 0 ? 'every owner must sign' : `up to ${plural(n, 'owner')} may be absent`
      }
      case 'ERC20TransferPolicy':
      case 'ERC20ApprovePolicy': {
        const [list] = coder.decode(['tuple(address,uint8)[]'], data)
        if ((list as ethers.Result).length === 0) return 'nobody listed'
        return (list as ethers.Result)
          .map((item: ethers.Result) => `${shortLabel(w, item[0])}: ${permissionWord(Number(item[1]))}`)
          .join(', ')
      }
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

export function configurationsCount(data: string): number | null {
  try {
    return decodeConfigurations(GUARD_IFACE, data.slice(0, 10) === SELECTORS.applyConfiguration ? 'applyConfiguration' : 'configureImmediately', data).length
  } catch {
    return null
  }
}

export function multiSendInner(data: string): string | null {
  try {
    return String(MULTISEND_IFACE.decodeFunctionData('multiSend', data)[0])
  } catch {
    return null
  }
}
