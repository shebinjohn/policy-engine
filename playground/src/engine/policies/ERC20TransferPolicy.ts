/**
 * contracts/policies/ERC20TransferPolicy.sol: `$recipients[guard][safe][token][recipient]`, keyed
 * by token (the call target), not by access selector. The recipient is decoded from the calldata.
 */
import { ethers } from 'ethers'

import { parseAccess } from '../access.ts'
import { eqAddr, shortLabel, symbolOf } from '../book.ts'
import { SELECTORS } from '../catalog.ts'
import { Revert, revert } from '../errors.ts'
import { T } from '../messages.ts'
import { emit, fail, stage, stateOf, strictDecode, type PolicyImpl } from './common.ts'

interface State {
  /** recipients[token][account] = 1 (ONCE) or 2 (ALWAYS); NONE is absent. */
  recipients: Record<string, Record<string, 1 | 2>>
}

const init = (): State => ({ recipients: {} })

export function decodeAllowlist(data: string): { account: string; permission: number }[] {
  const [list] = strictDecode(['tuple(address account, uint8 permission)[]'], data)
  return (list as ethers.Result).map((item: ethers.Result) => {
    const permission = Number(item[1])
    if (permission > 2) throw new Revert({ error: 'Reverted' })
    return { account: ethers.getAddress(item[0]), permission }
  })
}

export function lookupPermission(table: Record<string, Record<string, 1 | 2>>, token: string, account: string): 0 | 1 | 2 {
  const tokenKey = Object.keys(table).find((k) => eqAddr(k, token))
  if (!tokenKey) return 0
  const accKey = Object.keys(table[tokenKey]).find((k) => eqAddr(k, account))
  return accKey ? table[tokenKey][accKey] : 0
}

export function setPermission(
  table: Record<string, Record<string, 1 | 2>>,
  token: string,
  account: string,
  permission: number
): void {
  const tokenKey = ethers.getAddress(token)
  const accKey = ethers.getAddress(account)
  const byToken = (table[tokenKey] ??= {})
  if (permission === 0) delete byToken[accKey]
  else byToken[accKey] = permission as 1 | 2
  if (Object.keys(byToken).length === 0) delete table[tokenKey]
}

export const ERC20TransferPolicy: PolicyImpl = {
  name: 'ERC20TransferPolicy',
  configure(w, access, data) {
    const { selector, op, target } = parseAccess(access)
    if (selector !== SELECTORS.transfer && selector !== SELECTORS.transferFrom) revert('InvalidSelector')
    if (op !== 0) revert('InvalidOperation')
    const list = decodeAllowlist(data)
    const s = stateOf(w, 'ERC20TransferPolicy', init)
    for (const item of list) setPermission(s.recipients, target, item.account, item.permission)
    return true
  },
  check(ctx, a) {
    const token = a.to
    const selector = ethers.dataLength(a.data) >= 4 ? a.data.slice(0, 10) : '0x00000000'
    let recipient: string
    try {
      if (selector === SELECTORS.transfer) recipient = strictDecode(['address', 'uint256'], a.data, 4)[0]
      else if (selector === SELECTORS.transferFrom) recipient = strictDecode(['address', 'address', 'uint256'], a.data, 4)[1]
      else return fail(ctx, a, 'ERC20TransferPolicy', { title: T.transferNotTransfer }, { error: 'InvalidTransfer' })
    } catch (e) {
      if (e instanceof Revert && e.fault.error === 'Reverted') {
        fail(ctx, a, 'ERC20TransferPolicy', { title: T.transferBadData, tech: 'abi.decode reverted' }, { error: 'Reverted' })
      }
      throw e
    }
    const s = stateOf(ctx.w, 'ERC20TransferPolicy', init)
    const who = shortLabel(ctx.w, recipient)
    const sym = symbolOf(ctx.w, token)
    const permission = lookupPermission(s.recipients, token, recipient)
    if (permission === 0) {
      fail(ctx, a, 'ERC20TransferPolicy', { title: T.transferDenied(who, sym) }, { error: 'Unauthorized' })
    }
    if (permission === 1) {
      setPermission(s.recipients, token, recipient, 0)
      emit(ctx, a, 'ERC20TransferPolicy', { status: 'pass', title: T.transferOnce(who, sym), tech: 'Permission.ONCE' })
      stage(ctx, a, 'ERC20TransferPolicy', T.transferState(who, sym), `delete $recipients[guard][safe][${token}][${recipient}]`)
    } else {
      emit(ctx, a, 'ERC20TransferPolicy', { status: 'pass', title: T.transferAllowed(who, sym), tech: 'Permission.ALWAYS' })
    }
    return true
  }
}
