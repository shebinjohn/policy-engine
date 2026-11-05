/** contracts/policies/AllowPolicy.sol: always returns the magic value; configure always succeeds. */
import { T } from '../messages.ts'
import { emit, type PolicyImpl } from './common.ts'

export const AllowPolicy: PolicyImpl = {
  name: 'AllowPolicy',
  configure: () => true,
  check(ctx, a) {
    emit(ctx, a, 'AllowPolicy', { status: 'pass', title: T.allowPass, tech: 'AllowPolicy.checkTransaction returns the magic value' })
    return true
  }
}
