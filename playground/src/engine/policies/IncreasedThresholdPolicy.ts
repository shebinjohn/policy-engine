/**
 * contracts/policies/IncreasedThresholdPolicy.sol: requires owners - maxAbsent signatures,
 * clamped to [threshold + 1, owners], checked by the Safe's checkNSignatures over the context
 * bytes (executor address(0)), against the Safe state at check time. Spends the tx hash.
 */
import { ZERO, shortLabel } from '../book.ts'
import { checkNSignatures, ctxLength } from '../context.ts'
import { T } from '../messages.ts'
import { emit, fail, stage, stateOf, strictDecode, txIdentity, type PolicyImpl } from './common.ts'

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
    if (ctx.notASafe) fail(ctx, a, 'IncreasedThresholdPolicy', { title: T.policyNotASafe, tech: 'ISafe(safe).getTransactionHash on an address that is not a Safe' }, { error: 'Reverted' })
    const hash = txIdentity(ctx.w, a, ctx.signedNonce)
    const s = stateOf(ctx.w, 'IncreasedThresholdPolicy', init)
    const owners = ctx.w.safe.owners.length
    const threshold = ctx.w.safe.threshold
    const required = requiredSignatures(owners, threshold, BigInt(s.maxAbsent[a.access] ?? '0'))
    const detail = T.thresholdNeedDetail(required, owners, threshold)
    const tech = `checkNSignatures(address(0), ${hash}, context, ${required})`
    const res = checkNSignatures(ctx.w, a.context, required, (h) => h === hash, ZERO)
    if (!res.ok) {
      const got = Math.floor(ctxLength(a.context) / 65)
      const title =
        res.error === 'GS020'
          ? T.thresholdTooFew(required, got)
          : res.error === 'GS026' && res.who
            ? T.thresholdBad(shortLabel(ctx.w, res.who))
            : T.thresholdUnreadable
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
    emit(ctx, a, 'IncreasedThresholdPolicy', { status: 'pass', title: T.thresholdPass(required, owners), detail, tech })
    stage(ctx, a, 'IncreasedThresholdPolicy', T.thresholdState, `$spent[guard][safe][${hash}] = true`)
    return true
  }
}
