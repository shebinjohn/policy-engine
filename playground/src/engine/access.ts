/**
 * Access selectors, exactly as contracts/libraries/AccessSelector.sol packs them:
 *
 *       | 00000000001111111111222222222233
 *  byte | 01234567890123456789012345678901
 *  data | sssso       tttttttttttttttttttt
 */
import { ethers } from 'ethers'

import type { OperationName } from './types.ts'

export type Op = 0 | 1

export const opName = (op: Op): OperationName => (op === 1 ? 'DELEGATECALL' : 'CALL')
export const opNumber = (op: OperationName | undefined): Op => (op === 'DELEGATECALL' ? 1 : 0)

/** `AccessSelector.create(to, selector, operation)` as 32-byte lowercase hex. */
export function accessSelector(to: string, selector: string, op: Op): string {
  const packed = BigInt(to) | (BigInt(selector) << 224n) | (BigInt(op) << 216n)
  return '0x' + packed.toString(16).padStart(64, '0')
}

/** `AccessSelector.createFallback(operation)`. */
export function fallbackAccess(op: Op): string {
  return '0x' + (BigInt(op) << 216n).toString(16).padStart(64, '0')
}

export function parseAccess(access: string): { target: string; selector: string; op: Op } {
  const v = BigInt(access)
  const target = ethers.getAddress('0x' + (v & ((1n << 160n) - 1n)).toString(16).padStart(40, '0'))
  const selector = '0x' + (v >> 224n).toString(16).padStart(8, '0')
  const op = (((v >> 216n) & 1n) === 1n ? 1 : 0) as Op
  return { target, selector, op }
}

/** True for the two fallback keys (which are also the keys for selector 0 on address 0). */
export function isFallbackAccess(access: string): boolean {
  const v = BigInt(access)
  return v === 0n || v === 1n << 216n
}

export type SelectorResult = { ok: true; selector: string } | { ok: false }

/** `PolicyEngine._decodeSelector`: first 4 bytes, 0x00000000 for empty data, error for 1-3 bytes. */
export function decodeSelector(data: string): SelectorResult {
  const len = ethers.dataLength(data)
  if (len >= 4) return { ok: true, selector: data.slice(0, 10).toLowerCase() }
  if (len === 0) return { ok: true, selector: '0x00000000' }
  return { ok: false }
}
