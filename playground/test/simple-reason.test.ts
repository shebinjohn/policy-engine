/**
 * simpleReason (src/ui/lib/simpleReason.ts): one plain sentence for every outcome, with none of the
 * words the simple layer must not show (SIMPLE_LAYER.md §5).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { engine, type BigIdea, type Challenge, type ErrorSource, type PolicyName, type Scenario, type SimResult, type TxSpec, type World } from '../src/engine/index.ts'
import { ERRORS } from '../src/content/index.ts'
import { jargonIn, simpleReason } from '../src/ui/lib/simpleReason.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = <T>(dir: string): T[] => {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')) as T)
}

function check(sentence: string, where: string) {
  assert.ok(sentence.length > 0, `${where}: empty`)
  assert.match(sentence, /[.]$/, `${where}: "${sentence}" should end with a full stop`)
  assert.equal(jargonIn(sentence), null, `${where}: "${sentence}" uses "${jargonIn(sentence)}"`)
  const sentences = sentence.split(/(?<=\.)\s+/)
  assert.ok(sentences.length <= 3, `${where}: at most three sentences`)
  for (const s of sentences) assert.ok(s.split(/\s+/).length <= 22, `${where}: "${s}" is longer than 22 words`)
}

function walk(s: Scenario, label: string) {
  const initial = engine.createWorld(s.setup)
  const outs = engine.runScenario(s)
  outs.forEach((o, i) => {
    if (o.step.do !== 'tx' || !o.result) return
    const before = i === 0 ? initial : outs[i - 1].world
    check(simpleReason(o.result, o.step.tx, before), `${label} ${s.id} step ${i + 1}`)
  })
}

describe('simple reasons', () => {
  it('read plainly for every scenario step', () => {
    for (const s of read<Scenario>('scenarios')) walk(s, 'scenario')
  })

  it('read plainly for every big idea card', () => {
    for (const s of read<BigIdea>('ideas')) walk(s, 'idea')
  })

  it('read plainly for every challenge test, with the starting rules and the solution', () => {
    for (const c of read<Challenge>('challenges')) {
      for (const rules of [c.setup.rules ?? [], c.solution]) {
        const world = engine.createWorld({ ...c.setup, rules })
        const report = engine.runChallenge(c, rules)
        report.results.forEach((r, i) => check(simpleReason(r.result, r.test.tx, world), `challenge ${c.id} test ${i + 1}`))
      }
    }
  })

  it('cover every error the content catalog names', () => {
    const world: World = engine.createWorld({ balances: { ETH: '1', USDC: '100' } })
    const tx: TxSpec = { to: 'USDC', call: { fn: 'transfer', args: ['Mallory', '5'] } }
    const base = engine.simulate(world, tx)
    for (const key of Object.keys(ERRORS)) {
      const [maybePolicy, maybeName] = key.includes('.') ? key.split('.') : [undefined, key]
      const name = maybeName ?? key
      const by: ErrorSource = /^GS/.test(name) && !maybePolicy ? 'safe' : /^ERC20|Reverted|CallFailed|ExecutionFailed/.test(name) ? 'execution' : 'guard'
      const error = maybePolicy
        ? { by, error: 'PolicyReverted', policy: maybePolicy as PolicyName, reason: { by, error: name, message: '' }, message: '' }
        : { by, error: name, policy: null, message: '' }
      const result: SimResult = { ...base, ok: false, error, matched: null }
      check(simpleReason(result, tx, world), `error ${key}`)
    }
  })
})
