/**
 * contracts/policies/NativeTransferPolicy.sol: configure accepts only selector 0, CALL and empty
 * data; the check requires CALL, empty calldata (not just selector 0) and a non-zero value.
 */
import { ethers } from 'ethers'

import { parseAccess } from '../access.ts'
import { formatAsset, shortLabel } from '../book.ts'
import { T } from '../messages.ts'
import { emit, fail, type PolicyImpl } from './common.ts'

export const NativeTransferPolicy: PolicyImpl = {
  name: 'NativeTransferPolicy',
  configure(_w, access, data) {
    const { selector, op } = parseAccess(access)
    return selector === '0x00000000' && op === 0 && ethers.dataLength(data) === 0
  },
  check(ctx, a) {
    if (a.operation !== 0) fail(ctx, a, 'NativeTransferPolicy', { title: T.nativeDelegate }, { error: 'InvalidOperation' })
    if (ethers.dataLength(a.data) !== 0) {
      fail(ctx, a, 'NativeTransferPolicy', { title: T.nativeData, detail: T.nativeDataDetail }, { error: 'CalldataNotPermitted' })
    }
    if (a.value === 0n) fail(ctx, a, 'NativeTransferPolicy', { title: T.nativeNoValue }, { error: 'InvalidTransfer' })
    emit(ctx, a, 'NativeTransferPolicy', {
      status: 'pass',
      title: T.nativePass(formatAsset(ctx.w, 'ETH', a.value), shortLabel(ctx.w, a.to))
    })
    return true
  }
}
