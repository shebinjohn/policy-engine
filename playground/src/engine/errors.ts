/**
 * Reverts inside the simulation. A `Fault` is the revert data as the chain would carry it: an
 * error name, the blamed policy for `PolicyReverted` / `AccessDenied`, the nested reason, and
 * decoded arguments. It becomes a public `SimError` (with `by` and a plain `message`) at the
 * boundary.
 */
import type { ErrorSource, PolicyName, SimError } from './types.ts'

export interface Fault {
  error: string
  policy?: PolicyName | null
  reason?: Fault
  args?: Record<string, string>
  /** Plain sentence that overrides the generic message for this error. */
  message?: string
}

export class Revert extends Error {
  constructor(public readonly fault: Fault) {
    super(fault.error)
  }
}

export function revert(error: string, extra: Omit<Fault, 'error'> = {}): never {
  throw new Revert({ error, ...extra })
}

/** Empty revert data. */
export function reverted(message?: string): never {
  throw new Revert({ error: 'Reverted', message })
}

export function toSimError(
  fault: Fault,
  by: ErrorSource,
  messageFor: (fault: Fault, by: ErrorSource) => string
): SimError {
  const out: SimError = { by, error: fault.error, message: fault.message ?? messageFor(fault, by) }
  if (fault.policy !== undefined) out.policy = fault.policy
  if (fault.args) out.args = { ...fault.args }
  if (fault.reason) out.reason = toSimError(fault.reason, 'guard', messageFor)
  return out
}

/** "PolicyReverted(MultiSendPolicy) > PolicyReverted(ERC20TransferPolicy) > Unauthorized" */
export function describeChain(err: { error: string; policy?: PolicyName | null; reason?: unknown } | undefined): string {
  if (!err) return 'no error'
  const parts: string[] = []
  let cur: { error: string; policy?: PolicyName | null; reason?: unknown } | undefined = err
  while (cur) {
    parts.push(cur.policy !== undefined ? `${cur.error}(${cur.policy ?? 'none'})` : cur.error)
    cur = cur.reason as typeof cur
  }
  return parts.join(' > ')
}
