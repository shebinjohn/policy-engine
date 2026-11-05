/**
 * Replays every conformance fixture (conformance/fixtures/**\/*.json) through the engine. Each
 * fixture's expectations are the on-chain outcome, checked by `npm run conformance`, so a pass
 * here means engine == chain on that fixture. A fixture with `engine: false` or a reason string
 * is skipped, with the reason printed.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { runChallenge, runScenario, type Challenge, type Scenario } from '../src/engine/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'conformance', 'fixtures')

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []))
    .sort()
}

function chain(err: { error: string; policy?: string | null; reason?: unknown } | undefined): string {
  if (!err) return 'ok'
  const head = err.policy !== undefined ? `${err.error}(${err.policy ?? 'null'})` : err.error
  return err.reason ? `${head} > ${chain(err.reason as typeof err)}` : head
}

function skipReason(engine: boolean | string | undefined): string | null {
  if (engine === undefined || engine === true) return null
  return engine === false ? 'engine: false' : engine
}

describe('conformance fixtures replayed through the engine', () => {
  const files = walk(root)
  if (files.length === 0) it('no fixture files', () => {})
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as (Scenario | Challenge) & { engine?: boolean | string }
    const rel = path.relative(root, file)
    const skip = skipReason(data.engine)
    if ('solution' in data) {
      it(`${data.id} (${rel})`, { skip: skip ?? false }, () => {
        const challenge = data as Challenge
        const solved = runChallenge(challenge, challenge.solution)
        const problems: string[] = []
        if (solved.setupError) problems.push(`  solution cannot be configured: ${chain(solved.setupError)}`)
        solved.results.forEach((r, i) => {
          if (!r.matches) problems.push(`  test ${i + 1} "${r.test.label}": want ${r.test.want}, engine ${r.verdict} (${chain(r.result.error)})`)
        })
        if (runChallenge(challenge, challenge.setup.rules ?? []).solved) problems.push('  the starting rules already solve it')
        assert.equal(problems.length, 0, `\n${data.id}:\n${problems.join('\n')}`)
      })
      continue
    }
    it(`${data.id} (${rel})`, { skip: skip ?? false }, () => {
      let outcomes
      try {
        outcomes = runScenario(data as Scenario)
      } catch (e) {
        assert.fail(`${data.id}: the engine threw: ${(e as Error).stack}`)
      }
      const problems: string[] = []
      outcomes.forEach((o, i) => {
        if (o.step.do === 'tx' && !o.matches) {
          problems.push(
            `  step ${i + 1} "${o.step.label}": ${o.mismatch}\n    chain  ${JSON.stringify(o.step.expect)}\n    engine ${o.result?.ok ? 'ok' : `${o.result?.error?.by}:${chain(o.result?.error)}`}`
          )
        }
      })
      assert.equal(problems.length, 0, `\n${data.id}: ${problems.length} step(s) disagree with the chain\n${problems.join('\n')}`)
    })
  }
})
