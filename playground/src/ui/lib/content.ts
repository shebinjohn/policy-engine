/**
 * Normalized access to the plain-language content (src/content): errors, policies, glossary,
 * chapters. Accepts arrays or name-keyed records, so the UI does not depend on the export shape.
 */
import type { PolicyName, SimError } from '../../engine/types.ts'
import type { Chapter, ErrorInfo, PolicyInfo, Term } from '../../content/types.ts'
import { contentSource } from '../sources.ts'

function toList<T>(x: unknown): T[] {
  if (!x) return []
  if (Array.isArray(x)) return x as T[]
  if (typeof x === 'object') {
    return Object.entries(x as Record<string, T>).map(([k, v]) =>
      v && typeof v === 'object' && !('name' in (v as object)) ? ({ name: k, ...(v as object) } as T) : v
    )
  }
  return []
}

const errorsRaw = contentSource.ERRORS
export const ERROR_LIST: ErrorInfo[] = toList<ErrorInfo>(errorsRaw)
const errorsByKey = new Map<string, ErrorInfo>()
if (errorsRaw && typeof errorsRaw === 'object' && !Array.isArray(errorsRaw)) {
  for (const [k, v] of Object.entries(errorsRaw as Record<string, ErrorInfo>)) errorsByKey.set(k, v)
}
for (const e of ERROR_LIST) if (!errorsByKey.has(e.name)) errorsByKey.set(e.name, e)

export const POLICY_LIST: PolicyInfo[] = toList<PolicyInfo>(contentSource.POLICIES)
const policiesByName = new Map(POLICY_LIST.map((p) => [p.name, p]))

export const GLOSSARY: Term[] = toList<Term>(contentSource.GLOSSARY)
export const CHAPTERS: Chapter[] = toList<Chapter>(contentSource.CHAPTERS)

/** Error copy for an error name, preferring a policy-specific entry ("ERC20TransferPolicy.Unauthorized"). */
export function errorInfo(name: string | undefined, policy?: PolicyName | null): ErrorInfo | undefined {
  if (!name) return undefined
  if (policy) {
    const specific =
      errorsByKey.get(`${policy}.${name}`) ??
      errorsByKey.get(`${policy}:${name}`) ??
      errorsByKey.get(`${policy}/${name}`)
    if (specific) return specific
  }
  return errorsByKey.get(name)
}

export function policyInfo(name: PolicyName | string | null | undefined): PolicyInfo | undefined {
  if (!name) return undefined
  return policiesByName.get(name as PolicyName)
}

const FALLBACK_LABELS: Record<PolicyName, string> = {
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

export const ALL_POLICIES = Object.keys(FALLBACK_LABELS) as PolicyName[]

/** The label people read for a policy: "Recipient Allowlist". */
export function policyLabel(name: PolicyName | string | null | undefined): string {
  if (!name) return 'No policy'
  return policyInfo(name)?.label ?? FALLBACK_LABELS[name as PolicyName] ?? String(name)
}

/** The deepest reason of a nested error: PolicyReverted(MultiSend, PolicyReverted(ERC20, Unauthorized)) -> Unauthorized. */
export function innermost(err: SimError): { error: SimError; policy: PolicyName | null | undefined } {
  let cur = err
  let policy = err.policy
  while (cur.reason) {
    if (cur.policy) policy = cur.policy
    cur = cur.reason
  }
  if (cur.policy) policy = cur.policy
  return { error: cur, policy }
}

/** Solidity-style rendering for engineer view: PolicyReverted(MultiSendPolicy, Unauthorized()). */
export function solidityError(err: SimError): string {
  if (/^GS\d{3}$/.test(err.error)) return `GS${err.error.slice(2)}`
  if (err.error === 'Reverted') return 'revert (empty data)'
  if (err.error === 'CallFailed') return 'execTransactionFromModule returned false'
  if (err.error === 'PolicyReverted') {
    return `PolicyReverted(${err.policy ?? '?'}, ${err.reason ? solidityError(err.reason) : '0x'})`
  }
  if (err.error === 'AccessDenied') return `AccessDenied(${err.policy ?? 'address(0)'})`
  const args = err.args ? Object.values(err.args).join(', ') : ''
  return `${err.error}(${args})`
}

/** A few words for why a transaction was stopped: the error title of its deepest reason. */
export function shortReason(err: SimError | undefined): string {
  if (!err) return ''
  const d = innermost(err)
  return errorInfo(d.error.error, d.policy)?.title ?? d.error.error
}

/** Which authorization paths a policy can pass: words and tone for a pill. */
export function pathSupport(policy: PolicyName | string | null | undefined): {
  label: string
  restricted: boolean
  paths: 'both' | 'owner-only' | 'module-only'
} {
  const paths = (policyInfo(policy)?.paths ?? 'both') as 'both' | 'owner-only' | 'module-only'
  if (paths === 'owner-only') return { label: 'Owner transactions only', restricted: true, paths }
  if (paths === 'module-only') return { label: 'Module transactions only', restricted: true, paths }
  return { label: 'Owner and module transactions', restricted: false, paths }
}
