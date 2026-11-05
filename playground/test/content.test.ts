/**
 * Replays every scenario and challenge in scenarios/ and challenges/ through the engine.
 * Scenarios: every tx step must match its `expect` (and `expectState`).
 * Challenges: the solution must solve it, and the starting rules must not.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkExpectation, runChallenge, runScenario, type Challenge, type Scenario } from '../src/engine/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function load<T>(dir: string): { file: string; data: T }[] {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: `${dir}/${f}`, data: JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')) as T }))
}

function chain(err: { error: string; policy?: string | null; reason?: unknown } | undefined): string {
  if (!err) return 'ok'
  const head = err.policy !== undefined ? `${err.error}(${err.policy ?? 'null'})` : err.error
  return err.reason ? `${head} > ${chain(err.reason as typeof err)}` : head
}

const scenarios = load<Scenario>('scenarios')
const challenges = load<Challenge>('challenges')

describe('content: scenarios', () => {
  if (scenarios.length === 0) it('no scenario files yet', () => {})
  for (const { file, data: scenario } of scenarios) {
    it(`${scenario.id} (${file})`, () => {
      assert.equal(path.basename(file, '.json'), scenario.id, 'file name must equal id')
      const outcomes = runScenario(scenario)
      const problems: string[] = []
      outcomes.forEach((o, i) => {
        if (o.step.do !== 'tx') return
        if (!o.matches) {
          problems.push(
            `  step ${i + 1} "${o.step.label}": ${o.mismatch}\n    expected ${JSON.stringify(o.step.expect)}\n    engine   ${o.result?.ok ? 'ok' : `${o.result?.error?.by}:${chain(o.result?.error)}`}`
          )
        }
      })
      assert.equal(problems.length, 0, `\n${scenario.id}: ${problems.length} step(s) disagree\n${problems.join('\n')}`)
    })
  }
})

describe('content: challenges', () => {
  if (challenges.length === 0) it('no challenge files yet', () => {})
  for (const { file, data: challenge } of challenges) {
    it(`${challenge.id} (${file})`, () => {
      assert.equal(path.basename(file, '.json'), challenge.id, 'file name must equal id')
      const solved = runChallenge(challenge, challenge.solution)
      const problems: string[] = []
      if (solved.setupError) problems.push(`  solution cannot be configured: ${chain(solved.setupError)} (${solved.setupError.message})`)
      solved.results.forEach((r, i) => {
        if (!r.matches) {
          problems.push(
            `  solution, test ${i + 1} "${r.test.label}": want ${r.test.want}, engine ${r.verdict}${r.result.ok ? '' : ` (${r.result.error?.by}:${chain(r.result.error)})`}`
          )
        }
      })
      const start = runChallenge(challenge, challenge.setup.rules ?? [])
      if (start.solved) problems.push('  the starting rules already solve the challenge')
      if (solved.solved && solved.stars !== 3 && challenge.solution.length <= challenge.parRules) {
        problems.push(`  solution within par should earn 3 stars, got ${solved.stars}`)
      }
      assert.equal(problems.length, 0, `\n${challenge.id}:\n${problems.join('\n')}`)
    })
  }
})

describe('content: expectation helper', () => {
  it('checkExpectation agrees with runScenario on every step', () => {
    for (const { data: scenario } of scenarios) {
      for (const o of runScenario(scenario)) {
        if (o.step.do !== 'tx' || !o.result || o.step.expectState) continue
        assert.equal(checkExpectation(o.result, o.step.expect) === null, o.matches, `${scenario.id} ${o.step.label}`)
      }
    }
  })
})
