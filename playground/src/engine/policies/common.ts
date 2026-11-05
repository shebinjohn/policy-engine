/**
 * Shared shape of the simulated policies. Each policy mirrors its contract in contracts/policies/:
 * `configure(safe, access, data)` and `checkTransaction(safe, to, value, data, operation, module,
 * context, access)`. Both decide from the bytes. State lives in `world.policyState[<policy>]`,
 * the playground's single (guard, safe) namespace.
 */
import { ethers } from 'ethers'

import type { Op } from '../access.ts'
import { Revert, type Fault } from '../errors.ts'
import type { ContextSpec, Effect, PolicyName, TraceEvent, TraceStatus, World } from '../types.ts'

export interface SubCall {
  to: string
  value: bigint
  data: string
  operation: Op
}

export interface CheckCtx {
  /** Staged world. Policies write to it; the simulator discards it if the transaction fails. */
  w: World
  trace: TraceEvent[]
  effects: Effect[]
  /** Module that authorized the transaction, or null on the owner path. */
  module: string | null
  /** The nonce the owners signed (`ISafe.nonce() - 1` during the guard check). */
  signedNonce: number
  /** Recursive engine check (`IPolicyEngine(msg.sender).checkTransaction`), used by MultiSendPolicy. */
  recurse(call: SubCall, context: ContextSpec, depth: number, subTx: number): void
}

export interface CheckArgs {
  safe: string
  to: string
  value: bigint
  data: string
  operation: Op
  context: ContextSpec
  access: string
  depth: number
  subTx?: number
}

export interface PolicyImpl {
  name: PolicyName
  /** Returns the contract's boolean; throws Revert for a revert inside `configure`. Mutates `w.policyState`. */
  configure(w: World, access: string, data: string): boolean
  /** Returns true for the magic value, false for none (DenyPolicy). Throws Revert after tracing the failure. */
  check(ctx: CheckCtx, a: CheckArgs): boolean
}

export const coder = ethers.AbiCoder.defaultAbiCoder()

export function stateOf<T extends object>(w: World, policy: PolicyName, init: () => T): T {
  const existing = w.policyState[policy] as T | undefined
  if (existing) return existing
  const fresh = init()
  w.policyState[policy] = fresh
  return fresh
}

export function readState<T extends object>(w: World, policy: PolicyName): T | undefined {
  return w.policyState[policy] as T | undefined
}

export interface PolicyEvent {
  status: TraceStatus
  title: string
  detail?: string
  tech?: string
}

export function emit(ctx: CheckCtx, a: CheckArgs, policy: PolicyName, ev: PolicyEvent): void {
  const out: TraceEvent = {
    id: 'policy.check',
    depth: a.depth,
    actor: 'Policy',
    status: ev.status,
    title: ev.title,
    policy,
    access: a.access
  }
  if (ev.detail) out.detail = ev.detail
  if (ev.tech) out.tech = ev.tech
  if (a.subTx !== undefined) out.subTx = a.subTx
  ctx.trace.push(out)
}

/** Trace the failure, then revert with the policy's own error. */
export function fail(ctx: CheckCtx, a: CheckArgs, policy: PolicyName, ev: Omit<PolicyEvent, 'status'>, fault: Fault): never {
  emit(ctx, a, policy, { status: 'fail', ...ev, tech: ev.tech ?? `${policy}.${fault.error}()` })
  throw new Revert(fault)
}

/** Record a staged policy-state write as a trace event and an effect. */
export function stage(ctx: CheckCtx, a: CheckArgs, policy: PolicyName, title: string, tech?: string): void {
  const ev: TraceEvent = {
    id: 'policy.state',
    depth: a.depth,
    actor: 'Policy',
    status: 'info',
    title,
    detail: 'This change is kept only if the whole transaction succeeds.',
    policy,
    access: a.access
  }
  if (tech) ev.tech = tech
  if (a.subTx !== undefined) ev.subTx = a.subTx
  ctx.trace.push(ev)
  const effect: Effect = { kind: 'policyState', title }
  if (tech) effect.tech = tech
  ctx.effects.push(effect)
}

/** Strict ABI decode: throws Revert('Reverted') when Solidity's decoder would revert. */
export function strictDecode(types: string[], data: string, offset = 0): ethers.Result {
  try {
    const bytes = ethers.dataSlice(data, offset)
    const result = coder.decode(types, bytes)
    // Solidity validates static values: re-encoding must reproduce the head words.
    const again = coder.encode(types, result)
    const head = types.every((t) => !t.includes('[') && t !== 'bytes' && t !== 'string')
    if (head && ethers.dataSlice(bytes, 0, ethers.dataLength(again)) !== again.toLowerCase()) {
      throw new Error('dirty')
    }
    return result
  } catch (e) {
    if (e instanceof Revert) throw e
    throw new Revert({ error: 'Reverted' })
  }
}

/** The Safe tx hash identity the signature policies spend: (to, value, data, operation, nonce). */
export function txIdentity(w: World, call: { to: string; value: bigint; data: string; operation: Op }, nonce: number): string {
  return ethers.TypedDataEncoder.hash(
    { chainId: 1, verifyingContract: w.safe.address },
    {
      SafeTx: [
        { type: 'address', name: 'to' },
        { type: 'uint256', name: 'value' },
        { type: 'bytes', name: 'data' },
        { type: 'uint8', name: 'operation' },
        { type: 'uint256', name: 'safeTxGas' },
        { type: 'uint256', name: 'baseGas' },
        { type: 'uint256', name: 'gasPrice' },
        { type: 'address', name: 'gasToken' },
        { type: 'address', name: 'refundReceiver' },
        { type: 'uint256', name: 'nonce' }
      ]
    },
    {
      to: call.to,
      value: call.value,
      data: call.data,
      operation: call.operation,
      safeTxGas: 0,
      baseGas: 0,
      gasPrice: 0,
      gasToken: ethers.ZeroAddress,
      refundReceiver: ethers.ZeroAddress,
      nonce
    }
  )
}

/** Approximate byte length of a symbolic context once the harness encodes it. */
export function contextLength(ctx: ContextSpec): number {
  if (ctx === null || ctx === undefined) return 0
  switch (ctx.type) {
    case 'cosignature':
      return 65
    case 'ownerSignatures':
      return 65 * ctx.signers.length
    case 'attestation':
      return 256
    case 'batch':
      return ctx.items.reduce((n, item) => n + 32 + contextLength(item), 0)
  }
}
