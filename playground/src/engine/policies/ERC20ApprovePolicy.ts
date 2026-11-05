/**
 * contracts/policies/ERC20ApprovePolicy.sol: `$spenders[guard][safe][token][spender]`. An
 * approval of 0 is always allowed and leaves any grant untouched.
 */
import { ethers } from 'ethers'

import { parseAccess } from '../access.ts'
import { shortLabel, symbolOf } from '../book.ts'
import { SELECTORS } from '../catalog.ts'
import { Revert, revert } from '../errors.ts'
import { T } from '../messages.ts'
import { emit, fail, stage, stateOf, strictDecode, type PolicyImpl } from './common.ts'
import { decodeAllowlist, lookupPermission, setPermission } from './ERC20TransferPolicy.ts'

interface State {
  spenders: Record<string, Record<string, 1 | 2>>
}

const init = (): State => ({ spenders: {} })

export const ERC20ApprovePolicy: PolicyImpl = {
  name: 'ERC20ApprovePolicy',
  configure(w, access, data) {
    const { selector, op, target } = parseAccess(access)
    if (selector !== SELECTORS.approve) revert('InvalidSelector')
    if (op !== 0) revert('InvalidOperation')
    const list = decodeAllowlist(data)
    const s = stateOf(w, 'ERC20ApprovePolicy', init)
    for (const item of list) setPermission(s.spenders, target, item.account, item.permission)
    return true
  },
  check(ctx, a) {
    const token = a.to
    const selector = ethers.dataLength(a.data) >= 4 ? a.data.slice(0, 10) : '0x00000000'
    if (selector !== SELECTORS.approve) {
      fail(ctx, a, 'ERC20ApprovePolicy', { title: T.approveNotApprove }, { error: 'InvalidApproval' })
    }
    let spender: string
    let amount: bigint
    try {
      const r = strictDecode(['address', 'uint256'], a.data, 4)
      spender = r[0]
      amount = r[1]
    } catch (e) {
      if (e instanceof Revert && e.fault.error === 'Reverted') {
        fail(ctx, a, 'ERC20ApprovePolicy', { title: T.approveBadData, tech: 'abi.decode reverted' }, { error: 'Reverted' })
      }
      throw e
    }
    if (amount === 0n) {
      emit(ctx, a, 'ERC20ApprovePolicy', { status: 'pass', title: T.approveRevoke, tech: 'amount == 0' })
      return true
    }
    const s = stateOf(ctx.w, 'ERC20ApprovePolicy', init)
    const who = shortLabel(ctx.w, spender)
    const sym = symbolOf(ctx.w, token)
    const permission = lookupPermission(s.spenders, token, spender)
    if (permission === 0) fail(ctx, a, 'ERC20ApprovePolicy', { title: T.approveDenied(who, sym) }, { error: 'Unauthorized' })
    if (permission === 1) {
      setPermission(s.spenders, token, spender, 0)
      emit(ctx, a, 'ERC20ApprovePolicy', { status: 'pass', title: T.approveOnce(who, sym), tech: 'Permission.ONCE' })
      stage(ctx, a, 'ERC20ApprovePolicy', T.approveState(who, sym), `delete $spenders[guard][safe][${token}][${spender}]`)
    } else {
      emit(ctx, a, 'ERC20ApprovePolicy', { status: 'pass', title: T.approveAllowed(who, sym), tech: 'Permission.ALWAYS' })
    }
    return true
  }
}
