/**
 * contracts/policies/IncreasedThresholdPolicy.sol: requires owners - maxAbsent signatures,
 * clamped to [threshold + 1, owners], checked by the Safe's checkNSignatures (GS020 / GS026),
 * against the Safe state at check time. Spends the tx hash.
 */
import { SENTINEL, eqAddr, resolveAddress, shortLabel } from '../book.ts'
import { T } from '../messages.ts'
import type { ContextSpec, World } from '../types.ts'
import { contextLength, emit, fail, stage, stateOf, strictDecode, txIdentity, type PolicyImpl } from './common.ts'

interface State {
  maxAbsent: Record<string, string>
  spent: Record<string, true>
}

const init = (): State => ({ maxAbsent: {}, spent: {} })

export function requiredSignatures(owners: number, threshold: number, maxAbsent: bigint): number {
  let required = maxAbsent >= BigInt(owners) ? 0 : owners - Number(maxAbsent)
  if (required < threshold + 1) required = threshold + 1
  if (required > owners) required = owners
  return required
}

type SigCheck = { ok: true; count: number } | { ok: false; error: 'GS020' | 'GS026'; who?: string; got: number }

/** Symbolic `checkNSignatures(address(0), hash, context, required)` against the current owners. */
export function checkNSignatures(w: World, ctx: ContextSpec, required: number, depth: number): SigCheck {
  let signers: string[] | null = null
  if (ctx?.type === 'ownerSignatures') signers = ctx.signers
  else if (ctx?.type === 'cosignature' && !(depth > 0 && ctx.over === 'batch')) signers = [ctx.signer]
  if (signers === null) {
    const slots = Math.floor(contextLength(ctx) / 65)
    if (slots < required) return { ok: false, error: 'GS020', got: 0 }
    return { ok: false, error: 'GS026', got: 0 }
  }
  let addresses: string[]
  try {
    addresses = signers.map((s) => resolveAddress(w, s))
  } catch {
    return { ok: false, error: 'GS026', got: 0 }
  }
  if (ctx?.type === 'cosignature' && depth > 0 && ctx.over === 'batch') return { ok: false, error: 'GS026', got: 0 }
  addresses.sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0))
  if (addresses.length < required) return { ok: false, error: 'GS020', got: addresses.length }
  let last = 0n
  for (let i = 0; i < required; i++) {
    const cur = BigInt(addresses[i])
    const isOwner = w.safe.owners.some((o) => eqAddr(o, addresses[i]))
    if (cur <= last || !isOwner || eqAddr(addresses[i], SENTINEL)) {
      return { ok: false, error: 'GS026', who: addresses[i], got: addresses.length }
    }
    last = cur
  }
  return { ok: true, count: addresses.length }
}

export const IncreasedThresholdPolicy: PolicyImpl = {
  name: 'IncreasedThresholdPolicy',
  configure(w, access, data) {
    const [maxAbsent] = strictDecode(['uint256'], data)
    const s = stateOf(w, 'IncreasedThresholdPolicy', init)
    if (BigInt(maxAbsent) === 0n) delete s.maxAbsent[access]
    else s.maxAbsent[access] = BigInt(maxAbsent).toString()
    return true
  },
  check(ctx, a) {
    if (ctx.module !== null) {
      fail(ctx, a, 'IncreasedThresholdPolicy', { title: T.thresholdModule }, { error: 'ModulePathUnsupported' })
    }
    const hash = txIdentity(ctx.w, a, ctx.signedNonce)
    const s = stateOf(ctx.w, 'IncreasedThresholdPolicy', init)
    const owners = ctx.w.safe.owners.length
    const threshold = ctx.w.safe.threshold
    const required = requiredSignatures(owners, threshold, BigInt(s.maxAbsent[a.access] ?? '0'))
    const detail = T.thresholdNeedDetail(required, owners, threshold)
    const tech = `checkNSignatures(address(0), ${hash}, context, ${required})`
    const res = checkNSignatures(ctx.w, a.context, required, a.depth)
    if (!res.ok) {
      const title =
        res.error === 'GS020'
          ? T.thresholdTooFew(required, res.got)
          : T.thresholdBad(res.who ? shortLabel(ctx.w, res.who) : 'a signer')
      fail(ctx, a, 'IncreasedThresholdPolicy', { title, detail, tech: `${tech} reverts ${res.error}` }, { error: res.error })
    }
    if (s.spent[hash]) {
      fail(
        ctx,
        a,
        'IncreasedThresholdPolicy',
        { title: T.thresholdSpent, detail: T.thresholdSpentDetail, tech },
        { error: 'SignaturesAlreadySpent' }
      )
    }
    s.spent[hash] = true
    emit(ctx, a, 'IncreasedThresholdPolicy', { status: 'pass', title: T.thresholdPass(Math.min(res.count, owners), owners), detail, tech })
    stage(ctx, a, 'IncreasedThresholdPolicy', T.thresholdState, `$spent[guard][safe][${hash}] = true`)
    return true
  }
}
