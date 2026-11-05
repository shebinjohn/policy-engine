/**
 * Policy context as bytes. The conformance harness turns a symbolic ContextSpec into real bytes
 * (conformance/encode.ts buildContext); policies and MultiSendPolicy then parse those bytes
 * (MultiSendPolicy._decodeNextContext, SafenetPolicy's length check, Safe.checkNSignatures). To
 * decide exactly what the contracts decide, the engine builds the same layout:
 *
 * - cosignature: 65 bytes r, s, v by `signer` over the checked tx hash (the outer tx for `over: 'batch'`)
 * - ownerSignatures: 65 bytes per signer, sorted by address; no signers = empty bytes (not "no context")
 * - attestation: 256 bytes `abi.encode(uint64 epoch = 7, address oracle, bytes32 oracleDataHash, Point, Signature)`
 * - batch: `[uint256 length][item bytes]` per item; a null item is length 0
 *
 * Signature and key bytes are placeholders (keccak-derived, so they read like random words); each
 * signature or attestation carries a tag saying who signed which transaction hash. A tag counts only
 * when a reader takes exactly its bytes; anything else is garbage, as on chain.
 */
import { ethers } from 'ethers'

import { resolveAddress } from './book.ts'
import type { ContextSpec, World } from './types.ts'

export type Tag =
  | { start: number; end: number; kind: 'sig'; signer: string; hash: string; overBatch: boolean }
  | { start: number; end: number; kind: 'attestation'; trusted: boolean; valid: boolean; hash: string }

export interface CtxBytes {
  hex: string
  tags: Tag[]
}

export const EMPTY_CONTEXT: CtxBytes = { hex: '0x', tags: [] }

/** Safenet constants the harness uses (conformance/world.ts SAFENET, encode.ts attestation). */
export const SAFENET_EPOCH = 7n
const ORACLE = '0x0000000000000000000000000000000000000ac1'
const ORACLE_DATA_HASH = ethers.id('policy-engine-playground:oracle-data')

const placeholder = (label: string) => ethers.id(`policy-engine-playground:placeholder:${label}`)

export function ctxLength(c: CtxBytes): number {
  return ethers.dataLength(c.hex)
}

export function concatCtx(parts: CtxBytes[]): CtxBytes {
  const tags: Tag[] = []
  let offset = 0
  for (const p of parts) {
    for (const t of p.tags) tags.push({ ...t, start: t.start + offset, end: t.end + offset })
    offset += ctxLength(p)
  }
  return { hex: ethers.concat(parts.map((p) => p.hex)), tags }
}

export function raw(hex: string): CtxBytes {
  return { hex: hex.toLowerCase(), tags: [] }
}

/** Bytes [a, b) with the tags that lie wholly inside, rebased. */
export function sliceCtx(c: CtxBytes, a: number, b: number): CtxBytes {
  const tags = c.tags.filter((t) => t.start >= a && t.end <= b).map((t) => ({ ...t, start: t.start - a, end: t.end - a }))
  return { hex: ethers.dataSlice(c.hex, a, b), tags }
}

/** The tag that spans exactly [start, end), if any. */
export function tagAt(c: CtxBytes, start: number, end: number): Tag | undefined {
  return c.tags.find((t) => t.start === start && t.end === end)
}

/** The 32-byte word at `at` as a number, or null if it runs past the end. */
export function wordAt(c: CtxBytes, at: number): bigint | null {
  if (at < 0 || at + 32 > ctxLength(c)) return null
  return BigInt(ethers.dataSlice(c.hex, at, at + 32))
}

export function byteAt(c: CtxBytes, at: number): number {
  return Number(BigInt(ethers.dataSlice(c.hex, at, at + 1)))
}

function signature(signer: string, hash: string, overBatch: boolean): CtxBytes {
  const r = placeholder(`r:${signer}:${hash}`)
  const s = placeholder(`s:${signer}:${hash}`)
  return { hex: ethers.concat([r, s, '0x1b']), tags: [{ start: 0, end: 65, kind: 'sig', signer, hash, overBatch }] }
}

function attestation(trusted: boolean, valid: boolean, hash: string): CtxBytes {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const key = trusted ? 'trusted' : 'untrusted'
  const hex = coder.encode(
    ['uint64', 'address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
    [
      SAFENET_EPOCH,
      ORACLE,
      ORACLE_DATA_HASH,
      placeholder(`key-x:${key}`),
      placeholder(`key-y:${key}`),
      placeholder(`R-x:${hash}`),
      placeholder(`R-y:${hash}`),
      placeholder(`z:${hash}:${valid}`)
    ]
  )
  return { hex, tags: [{ start: 0, end: 256, kind: 'attestation', trusted, valid, hash }] }
}

/** `[uint256 length][bytes]` per item, as MultiSendPolicy._decodeNextContext reads it. */
export function packList(items: (CtxBytes | null)[]): CtxBytes {
  return concatCtx(items.flatMap((item) => [raw(ethers.toBeHex(item ? ctxLength(item) : 0, 32)), item ?? EMPTY_CONTEXT]))
}

/** A checked (sub-)transaction in the spec tree: its tx hash and its sub-transactions. */
export interface CtxNode {
  hash: string
  subs?: CtxNode[]
  /** The sub-transactions' own symbolic contexts (undefined = none given). */
  subContexts?: (ContextSpec | undefined)[]
}

/**
 * Build the context bytes for `node` from `spec`, like conformance/encode.ts buildContext.
 * Returns null for "no context at all" (no SignatureExtension envelope).
 */
export function buildContext(w: World, spec: ContextSpec | undefined, node: CtxNode, outerHash: string): CtxBytes | null {
  if (spec === null) return null
  if (spec === undefined) {
    if (!node.subs) return null
    const items = node.subs.map((sub, i) => buildContext(w, node.subContexts?.[i], sub, outerHash))
    if (!items.some((item) => item !== null)) return null
    while (items.length > 0 && items[items.length - 1] === null) items.pop()
    return packList(items)
  }
  switch (spec.type) {
    case 'cosignature': {
      const overBatch = spec.over === 'batch'
      return signature(resolveAddress(w, spec.signer), overBatch ? outerHash : node.hash, overBatch)
    }
    case 'ownerSignatures': {
      const signers = spec.signers.map((s) => resolveAddress(w, s)).sort(byAddress)
      return concatCtx(signers.map((s) => signature(s, node.hash, false)))
    }
    case 'attestation':
      return attestation(spec.key === 'trusted', spec.valid, node.hash)
    case 'batch':
      return packList(
        spec.items.map((item, i) => {
          const sub = node.subs?.[i]
          return buildContext(w, item, sub ?? node, outerHash)
        })
      )
  }
}

export function byAddress(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** Approximate size check helper for messages. */
export function isEmpty(c: CtxBytes): boolean {
  return ctxLength(c) === 0
}
