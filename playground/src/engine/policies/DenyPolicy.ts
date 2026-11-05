/**
 * contracts/policies/DenyPolicy.sol: returns bytes4(0) instead of the magic value, which the
 * engine reports as AccessDenied(DenyPolicy), not PolicyReverted.
 */
import { T } from '../messages.ts'
import { emit, type PolicyImpl } from './common.ts'

export const DenyPolicy: PolicyImpl = {
  name: 'DenyPolicy',
  configure: () => true,
  check(ctx, a) {
    emit(ctx, a, 'DenyPolicy', {
      status: 'fail',
      title: T.denyFail,
      detail: T.denyDetail,
      tech: 'DenyPolicy.checkTransaction returns 0x00000000, so the engine reverts AccessDenied(DenyPolicy)'
    })
    return false
  }
}
