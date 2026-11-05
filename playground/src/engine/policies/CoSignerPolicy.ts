/**
 * contracts/policies/CoSignerPolicy.sol: `$cosigners[guard][safe][access]` and a spent set of
 * co-signed Safe tx hashes. Check order: module, (hash), cosigner configured, signature, spent.
 * The signature is the whole context: 65 bytes that recover to the co-signer over this tx's hash
 * (OpenZeppelin SignatureChecker; the co-signers here hold keys and have no code).
 */
import { ZERO, eqAddr, shortLabel } from '../book.ts'
import { ctxLength, tagAt } from '../context.ts'
import { T } from '../messages.ts'
import { emit, fail, stage, stateOf, strictDecode, txIdentity, type PolicyImpl } from './common.ts'

interface State {
  cosigners: Record<string, string>
  spent: Record<string, true>
}

const init = (): State => ({ cosigners: {}, spent: {} })

export const CoSignerPolicy: PolicyImpl = {
  name: 'CoSignerPolicy',
  configure(w, access, data) {
    const [cosigner] = strictDecode(['address'], data)
    const s = stateOf(w, 'CoSignerPolicy', init)
    if (eqAddr(cosigner, ZERO)) delete s.cosigners[access]
    else s.cosigners[access] = cosigner
    return true
  },
  check(ctx, a) {
    if (ctx.module !== null) fail(ctx, a, 'CoSignerPolicy', { title: T.cosignModule }, { error: 'ModulePathUnsupported' })
    if (ctx.notASafe) fail(ctx, a, 'CoSignerPolicy', { title: T.policyNotASafe, tech: 'ISafe(safe).getTransactionHash on an address that is not a Safe' }, { error: 'Reverted' })
    const hash = txIdentity(ctx.w, a, ctx.signedNonce)
    const s = stateOf(ctx.w, 'CoSignerPolicy', init)
    const cosigner = s.cosigners[a.access]
    if (!cosigner) fail(ctx, a, 'CoSignerPolicy', { title: T.cosignNone }, { error: 'NoCosignerConfigured' })
    const who = shortLabel(ctx.w, cosigner)
    const tech = `safeTxHash ${hash} at nonce ${ctx.signedNonce}`
    const len = ctxLength(a.context)
    const tag = len === 65 ? tagAt(a.context, 0, 65) : undefined
    function unauthorized(title: string, detail?: string): never {
      return fail(ctx, a, 'CoSignerPolicy', { title, detail, tech }, { error: 'Unauthorized' })
    }
    if (len === 0) unauthorized(T.cosignMissing(who))
    if (!tag || tag.kind !== 'sig') unauthorized(T.cosignNotSignature)
    if (tag.hash !== hash) {
      if (tag.overBatch && a.depth > 0) unauthorized(T.cosignOverBatch(who), T.cosignOverBatchDetail)
      unauthorized(T.cosignOtherTx(shortLabel(ctx.w, tag.signer)))
    }
    if (!eqAddr(tag.signer, cosigner)) unauthorized(T.cosignWrongSigner(who, shortLabel(ctx.w, tag.signer)))
    if (s.spent[hash]) {
      fail(ctx, a, 'CoSignerPolicy', { title: T.cosignSpent, detail: T.cosignSpentDetail, tech }, { error: 'CoSignatureAlreadySpent' })
    }
    s.spent[hash] = true
    emit(ctx, a, 'CoSignerPolicy', { status: 'pass', title: T.cosignPass(who), tech })
    stage(ctx, a, 'CoSignerPolicy', T.cosignState, `$spent[guard][safe][${hash}] = true`)
    return true
  }
}
