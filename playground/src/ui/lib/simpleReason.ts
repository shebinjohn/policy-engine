/**
 * One plain sentence for any outcome, about people and money (SIMPLE_LAYER.md §5):
 * "Mallory is not on the USDC list.", "Nothing in the rulebook covers sending ETH to Erin, so it is
 * blocked.", "The co-signer has not signed this."
 *
 * It reads the result's error (nested the way the chain nests it), the transaction and the world the
 * transaction ran on. Every error name the engine can return has a sentence; anything unknown falls
 * back to a safe sentence by who stopped it. Never: nonce, selector, calldata, gas, hex, signature,
 * Solidity names or GS codes.
 */
import type {
  ContextSpec,
  PolicyName,
  RuleSpec,
  SimError,
  SimResult,
  SubTxSpec,
  TraceEvent,
  TxSpec,
  World
} from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { ALL_POLICIES, policyLabel } from './content.ts'
import { decodeConfig, defaultSigners, entity, isZero, nameOf, ownerNames } from './describe.ts'
import { gerund } from './simpleWords.ts'

type Call = TxSpec | SubTxSpec

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function symbolOf(world: World, token: string): string {
  const e = entity(world, token)
  return e.symbol ?? nameOf(world, token)
}

function arg(c: Call, i: number): string {
  return String(c.call?.args?.[i] ?? '')
}

/** The extra approval a call carried (co-signature, all owners, Safenet). */
function contextOf(c: Call): ContextSpec | undefined {
  return c.context ?? undefined
}

/** How many owners an IncreasedThreshold rule asks for, read from the rule that checked it. */
function requiredOwners(world: World, trace: TraceEvent[], subTx: number | undefined): number | null {
  const ev = trace.find((e) => e.id === 'policy.check' && e.policy === 'IncreasedThresholdPolicy' && e.subTx === subTx)
  const entry = ev?.access ? world.table[ev.access] : undefined
  if (!entry) return null
  const cfg = decodeConfig(world, 'IncreasedThresholdPolicy', entry.data) as { maxAbsent?: number } | null
  const owners = world.safe.owners.length
  const maxAbsent = Number(cfg?.maxAbsent ?? 0)
  return Math.min(owners, Math.max(world.safe.threshold + 1, owners - maxAbsent))
}

/** The batch step a nested failure happened in, from the trace. */
function failingStep(trace: TraceEvent[]): number | undefined {
  const ev = trace.find((e) => e.depth >= 1 && e.status === 'fail' && e.subTx !== undefined)
  return ev?.subTx
}

/** Signers of an owner transaction, as names. */
function signersOf(world: World, c: Call): string[] {
  const t = c as TxSpec
  return t.signers ?? defaultSigners(world)
}

function safeReason(world: World, c: Call, err: SimError): string {
  const t = c as TxSpec
  const owners = ownerNames(world)
  switch (err.error) {
    case 'GS020':
    case 'GS021':
    case 'GS022':
    case 'GS023':
    case 'GS024':
    case 'GS025':
    case 'GS026': {
      const signers = signersOf(world, c)
      const outsider = signers.find((s) => !owners.includes(s) && !owners.includes(entity(world, s).name))
      if (outsider) return `${nameOf(world, outsider)} is not an owner of this Safe, so that approval does not count.`
      if (new Set(signers).size < signers.length) return 'The same owner signed twice. Each owner counts once.'
      const n = signers.length
      const need = world.safe.threshold
      if (n === 0) return `No owner signed. This Safe needs ${need}.`
      return `Only ${n === 1 ? 'one owner' : `${n} owners`} signed. This Safe needs ${need}.`
    }
    case 'GS104':
      return `The ${nameOf(world, t.module ?? '')} is not switched on for this Safe.`
    case 'GS101':
      return 'That is not a module the Safe can switch on or off.'
    case 'GS102':
      return `The ${nameOf(world, arg(c, 0))} is already switched on.`
    case 'GS103':
      return 'That module is not switched on, so it cannot be switched off.'
    case 'GS201':
      return 'The Safe cannot need more owners to sign than it has.'
    case 'GS202':
      return 'At least one owner must always sign.'
    case 'GS203':
      return 'That address cannot be an owner.'
    case 'GS204':
      return `${nameOf(world, arg(c, 0))} is already an owner.`
    case 'GS205':
      return `${nameOf(world, arg(c, 0))} is not an owner, so cannot be removed.`
    case 'GS300':
    case 'GS301':
      return 'That is not a guard this Safe can use.'
    default:
      return 'The Safe refused this transaction.'
  }
}

function policyReason(
  world: World,
  c: Call,
  policy: PolicyName | null | undefined,
  err: SimError,
  trace: TraceEvent[],
  subTx: number | undefined
): string {
  const label = policyLabel(policy)
  const ctx = contextOf(c)
  switch (err.error) {
    case 'Unauthorized':
      switch (policy) {
        case 'ERC20TransferPolicy': {
          const to = c.call?.fn === 'transferFrom' ? arg(c, 1) : arg(c, 0)
          return `${nameOf(world, to)} is not on the ${symbolOf(world, c.to)} list.`
        }
        case 'ERC20ApprovePolicy':
          return `${nameOf(world, arg(c, 0))} is not on the list of who may spend ${symbolOf(world, c.to)}.`
        case 'OneTimeAllowPolicy':
          return 'The one-time pass for this is used up, or was never given.'
        case 'CoSignerPolicy':
          if (ctx?.type === 'cosignature' && ctx.over === 'batch')
            return 'The co-signer signed the whole batch, not this step. Each step needs its own.'
          if (ctx?.type === 'cosignature')
            return `${nameOf(world, ctx.signer)} signed, but this rule wants the co-signer.`
          return 'The co-signer has not signed this.'
        default:
          return `${label} did not allow this.`
      }
    case 'GS020':
    case 'GS021':
    case 'GS022':
    case 'GS023':
    case 'GS024':
    case 'GS025':
    case 'GS026': {
      const required = requiredOwners(world, trace, subTx)
      const extra = ctx?.type === 'ownerSignatures' ? ctx.signers : []
      const outsider = extra.find((s) => !ownerNames(world).includes(s))
      if (outsider) return `${nameOf(world, outsider)} is not an owner, so that approval does not count.`
      if (required === null) return 'This rule needs more owners to sign than usual.'
      if (extra.length === 0)
        return `This rule needs ${required} owners to sign, more than the usual ${world.safe.threshold}.`
      return `This rule needs ${required} owners to sign, and only ${extra.length} did.`
    }
    case 'InvalidModule':
      return policy === 'AllowedModulePolicy'
        ? 'Only a listed module may do this, not the owners.'
        : 'That is not a module this rule can list.'
    case 'UnauthorizedModule':
      return `The ${nameOf(world, (c as TxSpec).module ?? '')} is not on the module list.`
    case 'InvalidOperation':
      return policy === 'NativeTransferPolicy'
        ? 'Plain ETH has to go as a normal call.'
        : `${label} only works with normal calls.`
    case 'CalldataNotPermitted':
      return 'This rule only allows plain ETH, and this call carries extra instructions.'
    case 'InvalidTransfer':
      return policy === 'NativeTransferPolicy'
        ? 'This rule only allows sending ETH, and this sends none.'
        : `${label} only checks token payments.`
    case 'InvalidApproval':
      return `${label} only checks approvals.`
    case 'InvalidMultiSend':
      return 'The batch rule only checks batches.'
    case 'InvalidSelector':
      return `${label} cannot check this action.`
    case 'NoCosignerConfigured':
      return 'No co-signer is set for this rule.'
    case 'CoSignatureAlreadySpent':
      return 'The co-signer’s approval for this exact transaction was already used. It works once.'
    case 'SignaturesAlreadySpent':
      return 'The owners’ extra approval for this exact transaction was already used. It works once.'
    case 'ModulePathUnsupported': {
      const what =
        policy === 'CoSignerPolicy'
          ? 'the co-signer to sign'
          : policy === 'IncreasedThresholdPolicy'
            ? 'all owners to sign'
            : policy === 'SafenetPolicy'
              ? 'Safenet to approve'
              : 'the owners'
      return `A module cannot get ${what}, so the ${label} rule blocks it.`
    }
    case 'MalformedAttestation':
      return 'Safenet has not approved this.'
    case 'UntrustedAttestationKey':
      return 'This was approved by an unknown key, not by Safenet.'
    case 'AttestationAlreadySpent':
      return 'Safenet’s approval for this transaction was already used.'
    case 'InvalidSignature':
    case 'InvalidMulMulAddWitness':
    case 'InvalidScalar':
    case 'NotOnCurve':
    case 'UnsupportedMulMulAddInput':
      return 'Safenet’s approval is not valid.'
    default:
      return `${label} did not allow this.`
  }
}

/** The sentence for one (possibly nested) failure of one call. */
function failure(world: World, c: Call, err: SimError, result: SimResult, subTx?: number): string {
  if (err.by === 'safe') return safeReason(world, c, err)

  // A batch step that failed while running: blame the step, not the batch.
  if (err.by === 'execution' && (c as TxSpec).call?.fn === 'multiSend' && subTx === undefined) {
    const ev = result.trace.find(
      (e) => e.depth >= 1 && e.status === 'fail' && e.subTx !== undefined && e.id.startsWith('exec')
    )
    const inner = ev ? (c as TxSpec).call?.batch?.[ev.subTx!] : undefined
    if (inner) return `In step ${ev!.subTx! + 1} of the batch: ${uncap(failure(world, inner, err, result, ev!.subTx))}`
  }

  if (err.error === 'PolicyReverted') {
    const reason = err.reason
    if (err.policy === 'MultiSendPolicy' && reason) {
      const step = failingStep(result.trace)
      const batch = (c as TxSpec).call?.batch ?? []
      const inner = step !== undefined ? batch[step] : undefined
      if (inner) return `In step ${step! + 1} of the batch: ${uncap(failure(world, inner, reason, result, step))}`
      return 'One step of the batch was not allowed.'
    }
    const inner = reason
      ? policyReason(world, c, err.policy, reason, result.trace, subTx)
      : `${policyLabel(err.policy)} did not allow this.`
    // Reached through "Anything else": say so first, so people see why this policy was asked.
    const viaElse = result.trace.some(
      (e) =>
        e.id === 'engine.lookup.fallback' &&
        e.status === 'pass' &&
        (subTx === undefined ? e.depth === 0 : e.subTx === subTx)
    )
    return viaElse ? `No rule names ${gerund(world, c)}, so the Anything else rule decides. ${inner}` : inner
  }

  const what = gerund(world, c)
  switch (err.error) {
    case 'AccessDenied':
      if (err.policy === 'DenyPolicy') return `The rule for ${what} is Always Deny.`
      return `Nothing in the rulebook covers ${what}, so it is blocked.`
    case 'GuardTargetDenied':
      return 'Rules cannot be changed directly. Changes go through the waiting period.'
    case 'ModuleConfigurationDenied':
      return 'A module may not change the rulebook.'
    case 'PolicyConfigurationFailed':
      return setupSentence(world, c, err)
    case 'RootAlreadyConfigured':
      return 'This change is already waiting.'
    case 'RootNotConfigured':
      return 'This change was never proposed, or it was cancelled.'
    case 'RootConfigurationPending':
      return 'This change is still in its waiting period.'
    case 'RootConfigurationExpired':
      return 'This change waited too long and expired. Propose it again.'
    case 'GuardAlreadyEnabled':
      return 'The guard is already on, so rules only change through the waiting period.'
    case 'ZeroExpiryNotAllowed':
      return 'A change has to stay open for some time after it is ready.'
    case 'NonZeroGasPrice':
    case 'NonZeroSafeTxGas':
      return 'The Policy Guard refuses transactions that could pay a refund out of the Safe.'
    case 'InvalidSelector':
      return 'This transaction is malformed, so the Policy Guard refuses it.'
    case 'MalformedSignatureExtension':
      return 'The extra approval attached to this transaction is malformed.'
    case 'Reentrancy':
    case 'NotChecking':
    case 'CrossSafeCheck':
      return 'The Policy Guard refused a check it did not start.'
    case 'ModuleExecutionFailed':
    case 'CallFailed':
    case 'ExecutionFailed':
      return 'The transaction itself failed, so nothing changed.'
    case 'ERC20InsufficientBalance':
      return `The Safe does not have enough ${symbolOf(world, c.to)}.`
    case 'ERC20InsufficientAllowance':
      return `The Safe is not allowed to pull that much ${symbolOf(world, c.to)}.`
    case 'ERC20InvalidReceiver':
      return 'Tokens cannot be sent to the zero address.'
    case 'ERC20InvalidSpender':
      return 'The zero address cannot be allowed to spend tokens.'
    case 'Reverted':
    case 'Panic':
    case 'OutOfGas':
      if (c.value && Number(c.value) > 0 && enoughEth(world, c.value) === false)
        return 'The Safe does not have enough ETH.'
      return 'The transaction itself failed, so nothing changed.'
    default:
      if (/^GS\d{3}$/.test(err.error)) return safeReason(world, c, err)
      return err.by === 'execution'
        ? 'The transaction itself failed, so nothing changed.'
        : 'The Policy Guard blocked this transaction.'
  }
}

const COMMON_START =
  /^(The|A|An|In|No|Nothing|Only|This|That|These|Rules|Tokens|At|Plain|Step|Every|Enough|Taking|Changing|It|One|Each)\b/
/** Lower-cases a sentence's first word when it is a common word, not a name. */
const uncap = (s: string) => (s && COMMON_START.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)

function enoughEth(world: World, human: string): boolean | null {
  const bal =
    world.balances.ETH?.[world.safe.address] ??
    Object.entries(world.balances.ETH ?? {}).find(([h]) => h.toLowerCase() === world.safe.address.toLowerCase())?.[1]
  if (bal === undefined) return false
  try {
    const [w, f = ''] = human.split('.')
    const wei = BigInt(w || '0') * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18) || '0')
    return BigInt(bal) >= wei
  } catch {
    return null
  }
}

/** Why a rule could not be set up, in plain words. */
export function setupSentence(
  world: World,
  c: Call | null,
  err: SimError,
  rulePolicy?: PolicyName | null,
  isElse?: boolean
): string {
  const policy = rulePolicy ?? err.policy ?? null
  const label = policyLabel(policy)
  const configs = c?.call?.configurations ?? []
  const elseRule = isElse ?? configs.some((r) => r.fallback && r.policy === policy)
  if (policy === 'ERC20TransferPolicy' || policy === 'ERC20ApprovePolicy') {
    if (elseRule) return `A ${label} needs a token, so it cannot be the Anything else rule.`
    return `A ${label} only fits ${policy === 'ERC20TransferPolicy' ? 'sending or pulling tokens' : 'letting someone spend tokens'}, with a normal call.`
  }
  if (policy === 'MultiSendPolicy') return 'The Batch Checker only fits running a batch, as a delegatecall.'
  if (policy === 'NativeTransferPolicy') return 'Plain ETH Transfer only fits sending ETH, with a normal call.'
  if (policy === 'AllowedModulePolicy') return 'The Module Allowlist needs a real module to list.'
  return `${label} cannot be set up for this rule.`
}

/** One plain sentence for an outcome. */
export function simpleReason(result: SimResult, tx: TxSpec, world: World): string {
  try {
    if (!result.ok) {
      const err = result.error
      if (!err) return 'The transaction was blocked.'
      // A refused rule setup surfaces as the policy's own error inside a rulebook change.
      const refused = result.trace.find((e) => e.id === 'exec.configure' && e.status === 'fail')
      if (refused && err.by === 'execution') {
        const bad = (
          tx.call?.configurations ?? (tx.call?.batch ?? []).flatMap((s) => s.call?.configurations ?? [])
        ).find((r) => r.policy && refusedAlone(r))
        return setupSentence(world, tx, err, bad?.policy, Boolean(bad?.fallback))
      }
      return failure(world, tx, err, result)
    }
    return allowed(result, tx, world)
  } catch {
    return result.ok ? 'The rulebook allows this.' : 'The transaction was blocked.'
  }
}

/** Would the Policy Guard refuse this one rule on a fresh Safe with no guard? */
function refusedAlone(rule: RuleSpec): boolean {
  try {
    engine.createWorld({ rules: [rule], guards: { transaction: false, module: false } })
    return false
  } catch {
    return true
  }
}

function allowed(result: SimResult, tx: TxSpec, world: World): string {
  const trace = result.trace
  if (trace.some((e) => e.depth === 0 && e.id === 'safe.noGuard')) {
    return tx.path === 'module'
      ? 'The guard is not checking modules here, so nothing checked this.'
      : 'No Policy Guard is installed, so nothing checked this.'
  }
  if (trace.some((e) => e.depth === 0 && e.id === 'engine.allowedCall'))
    return 'Changing the rulebook is always allowed. The change waits before it applies.'
  const m = result.matched
  if (!m) return 'The rulebook allows this.'
  const viaElse = m.isFallback
  const lead = viaElse ? `No rule names ${gerund(world, tx)}, so the Anything else rule decides. ` : ''
  const spentOnce = result.effects.some((e) => e.kind === 'policyState' && !e.reverted)
  let s: string
  switch (m.policy) {
    case 'AllowPolicy':
      s = viaElse ? 'It allows everything.' : `The rule for ${gerund(world, tx)} is Always Allow.`
      break
    case 'ERC20TransferPolicy': {
      const to = tx.call?.fn === 'transferFrom' ? arg(tx, 1) : arg(tx, 0)
      s = spentOnce
        ? `${nameOf(world, to)} was on the ${symbolOf(world, tx.to)} list for one payment, and this is it.`
        : `${nameOf(world, to)} is on the ${symbolOf(world, tx.to)} list.`
      break
    }
    case 'ERC20ApprovePolicy':
      s =
        Number(arg(tx, 1) || 0) === 0
          ? 'Taking back an approval is always allowed.'
          : `${nameOf(world, arg(tx, 0))} is on the list of who may spend ${symbolOf(world, tx.to)}.`
      break
    case 'NativeTransferPolicy':
      s = `Plain ETH to ${nameOf(world, tx.to)} is allowed.`
      break
    case 'OneTimeAllowPolicy':
      s = 'This uses the one-time pass for it.'
      break
    case 'AllowedModulePolicy':
      s = `The ${nameOf(world, tx.module ?? '')} is on the module list.`
      break
    case 'MultiSendPolicy':
      s = 'Every step of the batch passed its own rule.'
      break
    case 'CoSignerPolicy':
      s = 'The co-signer signed this.'
      break
    case 'IncreasedThresholdPolicy': {
      const ctx = tx.context
      const n = ctx?.type === 'ownerSignatures' ? ctx.signers.length : world.safe.owners.length
      s = `Enough owners signed: ${n} of ${world.safe.owners.length}.`
      break
    }
    case 'SafenetPolicy':
      s = 'Safenet approved this transaction.'
      break
    default:
      s = 'The rulebook allows this.'
  }
  return lead + cap(s)
}

/** Words that must never appear on the simple layer (SIMPLE_LAYER.md §5). */
export const FORBIDDEN_WORDS = /\b(nonce|selectors?|calldata|gas|hex|signatures?|revert(ed|s)?|access selector)\b/i
/** Code identifiers: GS codes, hex, Solidity names. Case-sensitive. */
export const FORBIDDEN_CODE =
  /\b(GS\d{3}|0x[0-9a-fA-F]{4,}|[A-Z][A-Za-z0-9]*Policy|ERC20[A-Z][A-Za-z]+|PolicyReverted|AccessDenied|DELEGATECALL|CALL)\b/

export function jargonIn(text: string): string | null {
  // Policy labels from src/content/policies.ts are allowed words, even ones such as "More Owners Sign".
  let t = text
  for (const p of ALL_POLICIES) t = t.split(policyLabel(p)).join('')
  const m = FORBIDDEN_WORDS.exec(t) ?? FORBIDDEN_CODE.exec(t)
  return m ? m[0] : null
}
