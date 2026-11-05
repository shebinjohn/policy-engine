/**
 * contracts/policies/SafenetPolicy.sol: check order module, length (MalformedAttestation),
 * trusted key (UntrustedAttestationKey), spent nonce (AttestationAlreadySpent), FROST.verify
 * (a well-formed signature over another message reverts Secp256k1.InvalidMulMulAddWitness),
 * then spend the nonce.
 */
import { T } from '../messages.ts'
import { emit, fail, stage, stateOf, type PolicyImpl } from './common.ts'

interface State {
  spent: Record<string, true>
}

const init = (): State => ({ spent: {} })

export const SafenetPolicy: PolicyImpl = {
  name: 'SafenetPolicy',
  configure: () => true,
  check(ctx, a) {
    if (ctx.module !== null) fail(ctx, a, 'SafenetPolicy', { title: T.safenetModule }, { error: 'ModulePathUnsupported' })
    const att = a.context?.type === 'attestation' ? a.context : null
    if (!att) {
      fail(ctx, a, 'SafenetPolicy', { title: T.safenetMalformed, tech: 'context.length != 256' }, { error: 'MalformedAttestation' })
    }
    if (att.key !== 'trusted') fail(ctx, a, 'SafenetPolicy', { title: T.safenetUntrusted }, { error: 'UntrustedAttestationKey' })
    const nonce = ctx.signedNonce
    const s = stateOf(ctx.w, 'SafenetPolicy', init)
    if (s.spent[String(nonce)]) {
      fail(ctx, a, 'SafenetPolicy', { title: T.safenetSpent(nonce), detail: T.safenetSpentDetail }, { error: 'AttestationAlreadySpent' })
    }
    if (!att.valid) {
      fail(
        ctx,
        a,
        'SafenetPolicy',
        { title: T.safenetInvalid, tech: 'FROST.verify reverts Secp256k1.InvalidMulMulAddWitness()' },
        { error: 'InvalidMulMulAddWitness' }
      )
    }
    s.spent[String(nonce)] = true
    emit(ctx, a, 'SafenetPolicy', { status: 'pass', title: T.safenetPass })
    stage(ctx, a, 'SafenetPolicy', T.safenetState(nonce), `$spent[guard][safe][${nonce}] = true`)
    return true
  }
}
