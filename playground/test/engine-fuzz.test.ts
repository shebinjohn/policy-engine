/**
 * Robustness fuzz: throws random calldata, contexts, targets, operations, paths and gas settings
 * at the engine and asserts it never throws, and that results keep their invariants. Seeded, so
 * a failure reproduces; set FUZZ_ITERATIONS to run longer.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ethers } from 'ethers'

import {
  SELECTORS,
  book,
  createWorld,
  encode,
  lookup,
  simulate,
  type ContextSpec,
  type RuleSpec,
  type SubTxSpec,
  type TxSpec,
  type World
} from '../src/engine/index.ts'
import { ERC20_IFACE, GUARD_IFACE, MULTISEND_IFACE, POLICY_IFACE, SAFE_IFACE, WETH_IFACE } from '../src/engine/catalog.ts'

/** Mulberry32: small, seeded, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  const pick = <T>(xs: T[]): T => xs[int(xs.length)]
  const bytes = (n: number) => {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = int(256)
    return ethers.hexlify(out)
  }
  return { next, int, pick, bytes }
}

const NAMES = book().map((e) => e.name)
const EXTRA = ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000004', '0x7e1A00000000000000000000000000000000fe1A', '0x1234567890123456789012345678901234567890']
const SELECTOR_POOL: string[] = []
for (const iface of [ERC20_IFACE, WETH_IFACE, SAFE_IFACE, GUARD_IFACE, MULTISEND_IFACE, POLICY_IFACE]) iface.forEachFunction((f) => SELECTOR_POOL.push(f.selector))

type R = ReturnType<typeof rng>

function word(r: R): string {
  switch (r.int(6)) {
    case 0:
      return ethers.zeroPadValue('0x', 32)
    case 1:
      return ethers.zeroPadValue(ethers.toBeHex(r.int(300)), 32)
    case 2:
      return ethers.zeroPadValue(book()[r.int(book().length)].address, 32) // a clean address
    case 3:
      return '0x' + 'ff'.repeat(12) + book()[r.int(book().length)].address.slice(2) // dirty upper bits
    case 4:
      return ethers.zeroPadValue(ethers.toBeHex(32 * r.int(8)), 32) // an offset-looking word
    default:
      return r.bytes(32)
  }
}

function packed(r: R, depth: number): string {
  const steps = r.int(4)
  const parts: string[] = []
  for (let i = 0; i < steps; i++) {
    const data = calldata(r, depth + 1)
    const op = r.pick([0, 0, 0, 1, 2])
    const to = r.pick([...NAMES.map((n) => book().find((e) => e.name === n)!.address), ethers.ZeroAddress])
    const len = r.int(5) === 0 ? r.int(400) : ethers.dataLength(data)
    parts.push(ethers.solidityPacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [op, to, r.int(3) === 0 ? ethers.parseEther('0.1') : 0n, len, data]))
  }
  let out = parts.length ? ethers.concat(parts) : '0x'
  if (r.int(4) === 0) out = ethers.concat([out, r.bytes(r.int(90))]) // junk tail
  if (r.int(6) === 0 && ethers.dataLength(out) > 3) out = ethers.dataSlice(out, 0, r.int(ethers.dataLength(out))) // truncated
  return out
}

function calldata(r: R, depth = 0): string {
  switch (r.int(7)) {
    case 0:
      return '0x'
    case 1:
      return r.bytes(1 + r.int(3)) // 1-3 bytes
    case 2:
      return r.bytes(r.int(200))
    case 3:
    case 4: {
      const words = Array.from({ length: r.int(8) }, () => word(r))
      return ethers.concat([r.pick(SELECTOR_POOL), ...words])
    }
    case 5: {
      if (depth > 2) return '0x'
      const inner = packed(r, depth)
      const enc = MULTISEND_IFACE.encodeFunctionData('multiSend', [inner])
      return r.int(5) === 0 ? ethers.dataSlice(enc, 0, r.int(ethers.dataLength(enc))) : enc
    }
    default:
      return ethers.concat(['0x00000000', r.bytes(r.int(40))])
  }
}

function context(r: R, depth = 0): ContextSpec | undefined {
  switch (r.int(8)) {
    case 0:
      return undefined
    case 1:
      return null
    case 2:
      return { type: 'cosignature', signer: r.pick(['CoSigner', 'Alice', 'Mallory', 'AllowanceModule']), over: r.pick(['self', 'batch']) }
    case 3:
      return { type: 'ownerSignatures', signers: Array.from({ length: r.int(4) }, () => r.pick(['Alice', 'Bob', 'Carol', 'Mallory', 'CoSigner'])) }
    case 4:
      return { type: 'attestation', key: r.pick(['trusted', 'untrusted']), valid: r.next() < 0.5 }
    default:
      if (depth > 2) return null
      return { type: 'batch', items: Array.from({ length: r.int(4) }, () => context(r, depth + 1) ?? null) }
  }
}

function target(r: R): string {
  return r.int(6) === 0 ? r.pick(EXTRA) : r.pick(NAMES)
}

function subTx(r: R, depth: number): SubTxSpec {
  if (depth < 2 && r.int(5) === 0) {
    return { to: 'MultiSend', operation: 'DELEGATECALL', call: { fn: 'multiSend', batch: Array.from({ length: 1 + r.int(3) }, () => subTx(r, depth + 1)) } }
  }
  const sub: SubTxSpec = { to: target(r), data: calldata(r, depth + 1) }
  if (r.int(3) === 0) sub.operation = 'DELEGATECALL'
  if (r.int(4) === 0) sub.value = r.pick(['0.1', '1', '50'])
  const c = context(r, depth + 1)
  if (c !== undefined) sub.context = c
  return sub
}

function tx(r: R): TxSpec {
  const out: TxSpec =
    r.int(4) === 0
      ? { to: 'MultiSend', operation: r.int(4) === 0 ? 'CALL' : 'DELEGATECALL', call: { fn: 'multiSend', batch: Array.from({ length: r.int(4) }, () => subTx(r, 1)) } }
      : { to: target(r), data: calldata(r) }
  if (r.int(3) === 0) out.operation = 'DELEGATECALL'
  if (r.int(4) === 0) out.value = r.pick(['0.5', '2', '100'])
  if (r.int(5) === 0) {
    out.path = 'module'
    out.module = r.pick(['AllowanceModule', 'RecoveryModule'])
  }
  if (r.int(6) === 0) out.signers = Array.from({ length: r.int(4) }, () => r.pick(['Alice', 'Bob', 'Carol', 'Mallory']))
  if (r.int(8) === 0) out.gasPrice = r.pick(['1', '0'])
  if (r.int(8) === 0) out.safeTxGas = r.pick(['1', '100000'])
  const c = context(r)
  if (c !== undefined) out.context = c
  return out
}

const RULE_SETS: RuleSpec[][] = [
  [],
  [{ fallback: 'CALL', policy: 'AllowPolicy' }, { fallback: 'DELEGATECALL', policy: 'AllowPolicy' }],
  [
    { target: 'MultiSend', selector: 'multiSend', operation: 'DELEGATECALL', policy: 'MultiSendPolicy' },
    { fallback: 'CALL', policy: 'CoSignerPolicy' },
    { target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ONCE' }] } },
    { target: 'USDC', selector: 'approve', policy: 'ERC20ApprovePolicy', config: { spenders: [{ account: 'Dave', permission: 'ALWAYS' }] } }
  ],
  [
    { target: 'MultiSend', selector: 'multiSend', operation: 'DELEGATECALL', policy: 'MultiSendPolicy' },
    { fallback: 'CALL', policy: 'IncreasedThresholdPolicy', config: { maxAbsent: 1 } },
    { fallback: 'DELEGATECALL', policy: 'SafenetPolicy' },
    { target: 'Dave', selector: 'none', policy: 'NativeTransferPolicy' }
  ],
  [
    { fallback: 'CALL', policy: 'OneTimeAllowPolicy' },
    { target: 'WETH', selector: 'deposit', policy: 'DenyPolicy' },
    { fallback: 'DELEGATECALL', policy: 'AllowedModulePolicy', config: { module: 'AllowanceModule', allowed: true } }
  ]
]

function worlds(): World[] {
  const out: World[] = []
  for (const rules of RULE_SETS) {
    for (const guards of [{}, { transaction: false }, { module: false }, { transaction: false, module: false }]) {
      out.push(createWorld({ balances: { ETH: '10', USDC: '100', WETH: '1' }, modules: ['AllowanceModule'], rules, guards }))
    }
  }
  return out
}

describe('engine robustness fuzz', () => {
  it('never throws on random calldata, contexts, targets and paths', () => {
    const iterations = Number(process.env.FUZZ_ITERATIONS ?? 1500)
    const r = rng(Number(process.env.FUZZ_SEED ?? 0x5afe))
    const ws = worlds()
    let failures = 0
    for (let i = 0; i < iterations; i++) {
      const w = ws[r.int(ws.length)]
      const t = tx(r)
      const before = JSON.stringify(w)
      let result
      try {
        result = simulate(w, t)
        encode(w, t)
        const enc = encode(w, t)
        lookup(w, enc.to, enc.data, t.operation ?? 'CALL')
        lookup(w, target(r), calldata(r), r.pick(['CALL', 'DELEGATECALL']))
      } catch (e) {
        failures++
        assert.fail(`iteration ${i} threw: ${(e as Error).stack}\ntx: ${JSON.stringify(t)}`)
      }
      assert.equal(JSON.stringify(w), before, `iteration ${i}: input world mutated`)
      assert.equal(result.ok, result.error === undefined, `iteration ${i}: ok and error disagree`)
      if (result.error) assert.ok(result.error.message.length > 0, `iteration ${i}: empty message`)
      JSON.stringify(result.world)
      assert.ok(result.trace.length > 0)
    }
    assert.equal(failures, 0)
  })

  it('reads the dirty-address transfer of the differential test without throwing', () => {
    const w = createWorld({ balances: { USDC: '100' }, rules: [{ fallback: 'CALL', policy: 'AllowPolicy' }] })
    const data = SELECTORS.transfer + 'ff'.repeat(12) + 'da7e'.repeat(10) + '00'.repeat(31) + '01'
    const r = simulate(w, { to: 'SAFE', data })
    assert.equal(r.error?.error, 'Reverted')
    assert.equal(simulate(w, { to: 'Dave', data }).ok, true)
  })
})
