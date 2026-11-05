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

import { findByAddress, resolveAddress } from './book.ts'
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
const TRUSTED_SECRET = 0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe5afen
const UNTRUSTED_SECRET = 0xbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadn
const FROST_NONCE = 0x1234abcdn

export const SECP256K1_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/** G * scalar, as test/utils/frost.ts pointFromScalar. */
export function pointFromScalar(scalar: bigint): { x: bigint; y: bigint } {
  const uncompressed = ethers.SigningKey.computePublicKey(ethers.toBeHex(scalar, 32), false)
  return { x: BigInt('0x' + uncompressed.slice(4, 68)), y: BigInt('0x' + uncompressed.slice(68, 132)) }
}

let trustedKey: { x: bigint; y: bigint } | null = null
/** The genesis (group key, epoch) SafenetPolicy trusts. */
export function safenetTrustedKey(): { x: bigint; y: bigint } {
  return (trustedKey ??= pointFromScalar(TRUSTED_SECRET))
}

function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n
  b %= m
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return r
}

/** Secp256k1._satisfiesCurveEquation: y^2 = x^3 + 7 (mod p), coordinates reduced. */
export function onCurve(x: bigint, y: bigint): boolean {
  if (x >= SECP256K1_P || y >= SECP256K1_P) return false
  return (y * y) % SECP256K1_P === (modpow(x, 3n, SECP256K1_P) + 7n) % SECP256K1_P
}

/**
 * FROST.verify on a signature that is not over the message (r, z read from bytes): InvalidScalar,
 * NotOnCurve from serializing R, or InvalidMulMulAddWitness from the ecrecover check.
 */
export function frostVerifyFailure(rx: bigint, ry: bigint, z: bigint): string {
  if (z >= SECP256K1_N) return 'InvalidScalar'
  if (!onCurve(rx, ry)) return 'NotOnCurve'
  return 'InvalidMulMulAddWitness'
}

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

/** Only people and services hold keys (as in the harness); a signature claimed by anything else is just bytes. */
function canSign(w: World, address: string): boolean {
  const kind = findByAddress(w, address)?.kind
  return kind === 'person' || kind === 'service'
}

function signature(w: World, signer: string, hash: string, overBatch: boolean): CtxBytes {
  const r = placeholder(`r:${signer}:${hash}`)
  const s = placeholder(`s:${signer}:${hash}`)
  const tags: Tag[] = canSign(w, signer) ? [{ start: 0, end: 65, kind: 'sig', signer, hash, overBatch }] : []
  return { hex: ethers.concat([r, s, '0x1b']), tags }
}

function attestation(trusted: boolean, valid: boolean, hash: string): CtxBytes {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const key = trusted ? safenetTrustedKey() : pointFromScalar(UNTRUSTED_SECRET)
  const r = pointFromScalar(FROST_NONCE)
  const hex = coder.encode(
    ['uint64', 'address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
    [SAFENET_EPOCH, ORACLE, ORACLE_DATA_HASH, key.x, key.y, r.x, r.y, BigInt(placeholder(`z:${hash}:${valid}`)) % SECP256K1_N]
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
      return signature(w, resolveAddress(w, spec.signer), overBatch ? outerHash : node.hash, overBatch)
    }
    case 'ownerSignatures': {
      const signers = spec.signers.map((s) => resolveAddress(w, s)).sort(byAddress)
      return concatCtx(signers.map((s) => signature(w, s, node.hash, false)))
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

export function isEmpty(c: CtxBytes): boolean {
  return ctxLength(c) === 0
}

export type NSigResult =
  | { ok: true; signers: string[] }
  | { ok: false; error: string; who: string | null; duplicate?: boolean; slot: number }

/**
 * `Safe.checkNSignatures(executor, dataHash, signatures, required)` (Safe.sol 289-341) over
 * `blob`. A slot that is exactly a tagged signature recovers its signer when `valid(tag.hash)`;
 * any other slot is read byte by byte: v = 0 is a contract signature, v = 1 an approved hash,
 * anything else recovers an unrelated address. No owner here is a contract and no hash is ever
 * approved, so those branches fail as they would on chain.
 */
export function checkNSignatures(
  w: World,
  blob: CtxBytes,
  required: number,
  valid: (hash: string) => boolean,
  executor: string
): NSigResult {
  const len = ctxLength(blob)
  if (len < required * 65) return { ok: false, error: 'GS020', who: null, slot: 0 }
  const isOwner = (a: string) => w.safe.owners.some((o) => o.toLowerCase() === a.toLowerCase())
  let last = 0n
  const signers: string[] = []
  for (let i = 0; i < required; i++) {
    const at = 65 * i
    const tag = tagAt(blob, at, at + 65)
    let owner: string | null = null
    if (tag && tag.kind === 'sig') {
      owner = valid(tag.hash) ? tag.signer : null
    } else {
      const r = wordAt(blob, at)!
      const sWord = wordAt(blob, at + 32)!
      const v = byteAt(blob, at + 64)
      const asAddress = ethers.getAddress('0x' + (r & ((1n << 160n) - 1n)).toString(16).padStart(40, '0'))
      if (v === 0) {
        if (sWord < BigInt(required * 65)) return { ok: false, error: 'GS021', who: null, slot: i }
        if (sWord + 32n > BigInt(len)) return { ok: false, error: 'GS022', who: null, slot: i }
        const sigLen = wordAt(blob, Number(sWord))!
        if (sWord + 32n + sigLen > BigInt(len)) return { ok: false, error: 'GS023', who: null, slot: i }
        // isValidSignature on an address with no ERC-1271 code: nothing to decode, empty revert.
        return { ok: false, error: 'Reverted', who: asAddress, slot: i }
      }
      if (v === 1) {
        if (asAddress.toLowerCase() !== executor.toLowerCase()) return { ok: false, error: 'GS025', who: asAddress, slot: i }
        owner = asAddress
      }
    }
    if (owner === null) return { ok: false, error: 'GS026', who: null, slot: i }
    const cur = BigInt(owner)
    if (cur <= last || !isOwner(owner) || cur === 1n) {
      return { ok: false, error: 'GS026', who: owner, duplicate: isOwner(owner), slot: i }
    }
    signers.push(owner)
    last = cur
  }
  return { ok: true, signers }
}
