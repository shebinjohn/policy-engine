/**
 * contracts/policies/CoSignerPolicy.sol: `$cosigners[guard][safe][access]` and a spent set of
 * co-signed Safe tx hashes. Check order: module, (hash), cosigner configured, signature, spent.
 */
import { ZERO, eqAddr, findByAddress, resolveAddress, shortLabel } from '../book.ts'
import { T } from '../messages.ts'
import type { ContextSpec, World } from '../types.ts'
import { emit, fail, stage, stateOf, strictDecode, txIdentity, type PolicyImpl } from './common.ts'

interface State {
  cosigners: Record<string, string>
  spent: Record<string, true>
}

const init = (): State => ({ cosigners: {}, spent: {} })

/**
 * Can `address` produce an ECDSA signature? Only people and services hold keys (the conformance
 * harness gives keys to exactly those). Modules, contracts and unknown addresses cannot sign.
 */
export function hasKey(w: World, address: string): boolean {
  const e = findByAddress(w, address)
  return e !== undefined && (e.kind === 'person' || e.kind === 'service')
}

function signerOf(w: World, ctx: ContextSpec): string | null {
  try {
    if (ctx?.type === 'cosignature') return resolveAddress(w, ctx.signer)
    if (ctx?.type === 'ownerSignatures' && ctx.signers.length === 1) return resolveAddress(w, ctx.signers[0])
  } catch {
    return null
  }
  return null
}

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
    const hash = txIdentity(ctx.w, a, ctx.signedNonce)
    const s = stateOf(ctx.w, 'CoSignerPolicy', init)
    const cosigner = s.cosigners[a.access]
    if (!cosigner) fail(ctx, a, 'CoSignerPolicy', { title: T.cosignNone }, { error: 'NoCosignerConfigured' })
    const who = shortLabel(ctx.w, cosigner)
    const signer = signerOf(ctx.w, a.context)
    const tech = `safeTxHash ${hash} at nonce ${ctx.signedNonce}`
    if (signer === null) {
      fail(ctx, a, 'CoSignerPolicy', { title: T.cosignMissing(who), tech }, { error: 'Unauthorized' })
    }
    if (!eqAddr(signer, cosigner) || !hasKey(ctx.w, signer)) {
      fail(ctx, a, 'CoSignerPolicy', { title: T.cosignWrongSigner(who, shortLabel(ctx.w, signer)), tech }, { error: 'Unauthorized' })
    }
    if (a.depth > 0 && a.context?.type === 'cosignature' && a.context.over === 'batch') {
      fail(ctx, a, 'CoSignerPolicy', { title: T.cosignOverBatch(who), detail: T.cosignOverBatchDetail, tech }, { error: 'Unauthorized' })
    }
    if (s.spent[hash]) {
      fail(ctx, a, 'CoSignerPolicy', { title: T.cosignSpent, detail: T.cosignSpentDetail, tech }, { error: 'CoSignatureAlreadySpent' })
    }
    s.spent[hash] = true
    emit(ctx, a, 'CoSignerPolicy', { status: 'pass', title: T.cosignPass(who), tech })
    stage(ctx, a, 'CoSignerPolicy', T.cosignState, `$spent[guard][safe][${hash}] = true`)
    return true
  }
}
