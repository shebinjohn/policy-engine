/**
 * contracts/policies/MultiSendPolicy.sol: unpacks the packed batch from the calldata and runs the
 * engine check on every sub-transaction in order (a zero `to` is the Safe), pairing contexts
 * positionally. Any sub-check revert propagates, so the engine wraps it as
 * PolicyReverted(MultiSendPolicy, <sub-check error>).
 */
import { ethers } from 'ethers'

import { ZERO, eqAddr } from '../book.ts'
import { SELECTORS } from '../catalog.ts'
import { Revert } from '../errors.ts'
import { describeCall, T } from '../messages.ts'
import { EMPTY_CONTEXT, ctxLength, sliceCtx, wordAt, type CtxBytes } from '../context.ts'
import type { TraceEvent } from '../types.ts'
import { emit, fail, type CheckArgs, type CheckCtx, type PolicyImpl, type SubCall } from './common.ts'

function word(bytes: Uint8Array, at: number): bigint {
  if (at + 32 > bytes.length) throw new Revert({ error: 'Reverted' })
  return BigInt(ethers.hexlify(bytes.slice(at, at + 32)))
}

/** `_decodeMultiSendTransactions`: the packed bytes inside multiSend(bytes). */
function packedTransactions(data: string): Uint8Array {
  const bytes = ethers.getBytes(data).slice(4)
  const offset = word(bytes, 0)
  if (offset > BigInt(bytes.length)) throw new Revert({ error: 'Reverted' })
  const rest = bytes.slice(Number(offset))
  const length = word(rest, 0)
  if (length > BigInt(rest.length - 32)) throw new Revert({ error: 'Reverted' })
  return rest.slice(32, 32 + Number(length))
}

/** `_decodeNextTransaction`. */
function nextTransaction(safe: string, txs: Uint8Array): { call: SubCall; rest: Uint8Array } {
  // Operation(uint8(transactions[0])) converts first: a value above 1 panics 0x21 before any
  // slice bounds check (MultiSendPolicy.sol 66).
  const op = txs[0]
  if (op > 1) throw new Revert({ error: 'Panic', args: { code: '0x21' } })
  if (txs.length < 85) throw new Revert({ error: 'Reverted' })
  let to = ethers.getAddress(ethers.hexlify(txs.slice(1, 21)))
  if (eqAddr(to, ZERO)) to = safe
  const value = word(txs, 21)
  const len = word(txs, 53)
  if (len > BigInt(txs.length - 85)) throw new Revert({ error: 'Reverted' })
  const n = Number(len)
  return {
    call: { to, value, data: ethers.hexlify(txs.slice(85, 85 + n)), operation: op as 0 | 1 },
    rest: txs.slice(85 + n)
  }
}

/** Tolerant count for the trace header. */
export function countSubTxs(data: string): number | null {
  try {
    let txs = packedTransactions(data)
    let n = 0
    while (txs.length > 0) {
      txs = nextTransaction(ZERO, txs).rest
      n++
    }
    return n
  } catch {
    return null
  }
}

/**
 * `_decodeNextContext` (MultiSendPolicy.sol 78-90) on the context bytes: empty stays empty;
 * otherwise a 32-byte length, that many bytes for this step, and the rest for the next.
 */
function nextContext(context: CtxBytes): { ctx: CtxBytes; rest: CtxBytes } {
  const len = ctxLength(context)
  if (len === 0) return { ctx: EMPTY_CONTEXT, rest: EMPTY_CONTEXT }
  const length = wordAt(context, 0)
  if (length === null) throw new Revert({ error: 'Reverted' })
  if (length > (1n << 256n) - 33n) throw new Revert({ error: 'Panic', args: { code: '0x11' } })
  const end = 32n + length
  if (end > BigInt(len)) throw new Revert({ error: 'Reverted' })
  return { ctx: sliceCtx(context, 32, Number(end)), rest: sliceCtx(context, Number(end), len) }
}

export const MultiSendPolicy: PolicyImpl = {
  name: 'MultiSendPolicy',
  configure(_w, access, _data) {
    const selector = '0x' + BigInt(access).toString(16).padStart(64, '0').slice(0, 8)
    const op = (BigInt(access) >> 216n) & 1n
    return selector === SELECTORS.multiSend && op === 1n
  },
  check(ctx: CheckCtx, a: CheckArgs) {
    const len = ethers.dataLength(a.data)
    if (len < 4) fail(ctx, a, 'MultiSendPolicy', { title: T.batchMalformed, tech: 'data[:4] out of bounds' }, { error: 'Reverted' })
    if (a.data.slice(0, 10) !== SELECTORS.multiSend) {
      fail(ctx, a, 'MultiSendPolicy', { title: T.batchNotMultiSend }, { error: 'InvalidMultiSend' })
    }
    let txs: Uint8Array
    try {
      txs = packedTransactions(a.data)
    } catch (e) {
      if (e instanceof Revert) fail(ctx, a, 'MultiSendPolicy', { title: T.batchMalformed }, e.fault)
      throw e
    }
    const count = countSubTxs(a.data)
    emit(ctx, a, 'MultiSendPolicy', {
      status: 'info',
      title: count === null ? T.batchStartUnknown : T.batchStart(count),
      detail: T.batchStartDetail
    })
    let i = 0
    let context = a.context
    while (txs.length > 0) {
      let call: SubCall
      let subContext: CtxBytes
      try {
        const next = nextTransaction(a.safe, txs)
        call = next.call
        txs = next.rest
      } catch (e) {
        if (e instanceof Revert) fail(ctx, a, 'MultiSendPolicy', { title: T.batchMalformed }, e.fault)
        throw e
      }
      try {
        const next = nextContext(context)
        subContext = next.ctx
        context = next.rest
      } catch (e) {
        if (e instanceof Revert) fail(ctx, a, 'MultiSendPolicy', { title: T.batchContextMalformed }, e.fault)
        throw e
      }
      const step: TraceEvent = {
        id: 'multisend.step',
        depth: a.depth + 1,
        actor: 'MultiSend',
        status: 'info',
        title: T.batchStep(i, describeCall(ctx.w, call.to, call.value, call.data, call.operation)),
        subTx: i
      }
      ctx.trace.push(step)
      try {
        ctx.recurse(call, subContext, a.depth + 1, i)
      } catch (e) {
        if (e instanceof Revert) {
          emit(ctx, a, 'MultiSendPolicy', { status: 'fail', title: T.batchFail(i) })
        }
        throw e
      }
      i++
    }
    emit(ctx, a, 'MultiSendPolicy', { status: 'pass', title: T.batchPass(i) })
    return true
  }
}
