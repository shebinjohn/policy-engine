/**
 * contracts/policies/SafenetPolicy.sol: check order module, length 256 (MalformedAttestation),
 * abi.decode, trusted (group key, epoch) (UntrustedAttestationKey), spent nonce
 * (AttestationAlreadySpent), FROST.verify (a well-formed signature that does not verify reverts
 * Secp256k1.InvalidMulMulAddWitness), then spend the nonce. Only the length is checked before
 * decoding, so any 256 bytes reach the key check.
 */
import { SAFENET_EPOCH, ctxLength, frostVerifyFailure, safenetTrustedKey, tagAt, wordAt } from '../context.ts'
import { T } from '../messages.ts'
import { emit, fail, stage, stateOf, txIdentity, type PolicyImpl } from './common.ts'

interface State {
  spent: Record<string, true>
}

const init = (): State => ({ spent: {} })

export const SafenetPolicy: PolicyImpl = {
  name: 'SafenetPolicy',
  configure: () => true,
  check(ctx, a) {
    if (ctx.module !== null) fail(ctx, a, 'SafenetPolicy', { title: T.safenetModule }, { error: 'ModulePathUnsupported' })
    if (ctxLength(a.context) !== 256) {
      fail(ctx, a, 'SafenetPolicy', { title: T.safenetMalformed, tech: 'context.length != 256' }, { error: 'MalformedAttestation' })
    }
    const tag = tagAt(a.context, 0, 256)
    const att = tag && tag.kind === 'attestation' ? tag : null
    let rawFailure: string | null = null
    if (!att) {
      // Any 256 bytes: abi.decode(context, (uint64, address, bytes32, Point, Signature)) validates
      // the first two words, then the (group key, epoch) must be the trusted genesis pair.
      const word = (i: number) => wordAt(a.context, 32 * i)!
      const epoch = word(0)
      if (epoch >= 1n << 64n || word(1) >= 1n << 160n) {
        fail(ctx, a, 'SafenetPolicy', { title: T.safenetUnreadable, tech: 'abi.decode reverted' }, { error: 'Reverted' })
      }
      const key = safenetTrustedKey()
      if (!(word(3) === key.x && word(4) === key.y && epoch === SAFENET_EPOCH)) {
        fail(ctx, a, 'SafenetPolicy', { title: T.safenetUntrusted, tech: `$epochs.isKnown(groupKey, ${epoch}) == false` }, { error: 'UntrustedAttestationKey' })
      }
      // A trusted key with a signature nobody made over this message.
      rawFailure = frostVerifyFailure(word(5), word(6), word(7))
    } else if (!att.trusted) {
      fail(ctx, a, 'SafenetPolicy', { title: T.safenetUntrusted }, { error: 'UntrustedAttestationKey' })
    }
    if (ctx.notASafe) fail(ctx, a, 'SafenetPolicy', { title: T.policyNotASafe, tech: 'ISafe(safe).nonce() on an address that is not a Safe' }, { error: 'Reverted' })
    const nonce = ctx.signedNonce
    const s = stateOf(ctx.w, 'SafenetPolicy', init)
    if (s.spent[String(nonce)]) {
      fail(ctx, a, 'SafenetPolicy', { title: T.safenetSpent(nonce), detail: T.safenetSpentDetail }, { error: 'AttestationAlreadySpent' })
    }
    const hash = txIdentity(ctx.w, a, nonce)
    const verifyError = att ? (!att.valid || att.hash !== hash ? 'InvalidMulMulAddWitness' : null) : rawFailure
    if (verifyError) {
      fail(ctx, a, 'SafenetPolicy', { title: T.safenetInvalid, tech: `FROST.verify reverts ${verifyError}()` }, { error: verifyError })
    }
    s.spent[String(nonce)] = true
    emit(ctx, a, 'SafenetPolicy', { status: 'pass', title: T.safenetPass })
    stage(ctx, a, 'SafenetPolicy', T.safenetState(nonce), `$spent[guard][safe][${nonce}] = true`)
    return true
  }
}
