/**
 * Setup codes (src/ui/lib/share.ts): letters and digits only, versioned, and a faithful round trip.
 * A decoded code must rebuild a Safe with the same rules and give the same verdict.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { engine, type Challenge, type Scenario, type SetupSpec, type TxSpec, type World } from '../src/engine/index.ts'
import { EXAMPLES, PRESETS } from '../src/ui/lib/presets.ts'
import { ShareError, decodeShare, encodeShare, worldToSetup } from '../src/ui/lib/share.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = <T>(dir: string): T[] =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(root, dir, f), 'utf8')) as T)

const norm = <T>(v: T): T => JSON.parse(JSON.stringify(v, (k, x) => (k === 'note' ? undefined : x)))

function tableShape(w: World) {
  return Object.values(w.table)
    .map((e) => `${e.access}:${e.policy}`)
    .sort()
}

function verdict(w: World, tx: TxSpec) {
  const r = engine.simulate(w, tx)
  return { ok: r.ok, error: r.error?.error, policy: r.error?.policy ?? null, reason: r.error?.reason?.error }
}

function roundTrip(world: World, tx: TxSpec) {
  const setup = worldToSetup(world)
  const code = encodeShare({ setup, tx })
  assert.match(code, /^[a-z0-9]+$/, 'only lowercase letters and digits')
  assert.equal(code[0], '1', 'version 1')
  const back = decodeShare(code)
  assert.deepEqual(back, norm({ setup, tx }), 'decodes to what was encoded')
  const rebuilt = engine.createWorld(back.setup)
  assert.deepEqual(tableShape(rebuilt), tableShape(world), 'same rules')
  assert.deepEqual(rebuilt.safe.owners, world.safe.owners, 'same owners')
  assert.equal(rebuilt.safe.threshold, world.safe.threshold)
  assert.equal(Boolean(rebuilt.safe.txGuard), Boolean(world.safe.txGuard))
  assert.equal(Boolean(rebuilt.safe.moduleGuard), Boolean(world.safe.moduleGuard))
  assert.deepEqual(verdict(rebuilt, back.tx), verdict(world, tx), 'same verdict')
  return code
}

describe('setup codes', () => {
  it('round-trip every Sandbox preset and example transaction', () => {
    for (const p of PRESETS) {
      const world = engine.createWorld(p.setup)
      roundTrip(world, p.tx)
      for (const ex of EXAMPLES) roundTrip(world, ex.tx)
    }
  })

  it('round-trip every scenario setup with its transactions', () => {
    for (const s of read<Scenario>('scenarios')) {
      const world = engine.createWorld(s.setup)
      for (const step of s.steps) if (step.do === 'tx') roundTrip(world, step.tx)
    }
  })

  it('round-trip every challenge with its solution rules', () => {
    for (const c of read<Challenge>('challenges')) {
      const setup: SetupSpec = { ...c.setup, rules: c.solution }
      const world = engine.createWorld(setup)
      for (const t of c.tests) roundTrip(world, t.tx)
    }
  })

  it('carry a spent one-time permission as spent', () => {
    const p = PRESETS.find((x) => x.id === 'example')!
    const payErin: TxSpec = { to: 'USDC', call: { fn: 'transfer', args: ['Erin', '800'] }, signers: ['Alice', 'Bob'] }
    const first = engine.simulate(engine.createWorld(p.setup), payErin)
    assert.equal(first.ok, true)
    const code = roundTrip(first.world, payErin)
    const again = engine.simulate(engine.createWorld(decodeShare(code).setup), payErin)
    assert.equal(again.ok, false, 'Erin was paid once already')
  })

  it('accept a pasted link and refuse foreign or damaged codes', () => {
    const p = PRESETS[0]
    const code = encodeShare({ setup: worldToSetup(engine.createWorld(p.setup)), tx: p.tx })
    assert.deepEqual(decodeShare(`https://example.org/#run-${code}`), decodeShare(code))
    assert.deepEqual(decodeShare(`  ${code.toUpperCase()}  `), decodeShare(code))
    assert.throws(() => decodeShare('2' + code.slice(1)), ShareError)
    assert.throws(() => decodeShare(code.slice(0, -5)), ShareError)
    assert.throws(() => decodeShare(code.slice(0, 20) + (code[20] === 'a' ? 'b' : 'a') + code.slice(21)), ShareError)
    assert.throws(() => decodeShare(''), ShareError)
  })
})
