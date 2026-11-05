/**
 * Playground conformance: replays every scenario and every challenge against the real contracts.
 *
 *   npx hardhat test --network hardhat playground/conformance/conformance.spec.ts   (repo root)
 *   npm run conformance                                                            (playground/)
 *
 * Discovers `scenarios/*.json`, `challenges/*.json` and `conformance/fixtures/*.json` (a fixture is
 * a scenario if it has `steps`, a challenge if it has `tests`). One `it` per file. Files with
 * `conformance: false` or a reason string are skipped with the reason printed.
 *
 * Environment:
 *   CONFORMANCE_ONLY=id1,id2   run only these ids
 *   CONFORMANCE_EXTRA=dir[:dir] also run the JSON files in these directories (drafts, mutants)
 *   CONFORMANCE_REPORT=path    also write the results as JSON
 *   CONFORMANCE_VERBOSE=1      print every step's on-chain outcome
 *   POLICY_ENGINE_ROOT=path    policy-engine checkout (standalone layout, see README.md)
 */
import fs from 'fs'
import path from 'path'

import type { Challenge, Scenario } from '../src/engine/types'
import { formatChallengeFailure, formatScenarioFailure, runChallenge, runScenario } from './runner'
import { Base, deployBase } from './world'

/* eslint-disable @typescript-eslint/no-explicit-any */

const PLAYGROUND = path.resolve(__dirname, '..')

interface Entry {
  kind: 'scenario' | 'challenge'
  source: 'scenarios' | 'challenges' | 'fixtures' | 'extra'
  file: string
  content: any
}

function readDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f))
}

function discover(): Entry[] {
  const entries: Entry[] = []
  const load = (file: string, source: Entry['source'], forced?: Entry['kind']) => {
    let content: any
    try {
      content = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error: any) {
      content = { id: path.basename(file, '.json'), __parseError: String(error?.message ?? error) }
    }
    const kind: Entry['kind'] = forced ?? (Array.isArray(content.tests) ? 'challenge' : 'scenario')
    entries.push({ kind, source, file, content })
  }
  for (const file of readDir(path.join(PLAYGROUND, 'scenarios'))) load(file, 'scenarios', 'scenario')
  for (const file of readDir(path.join(PLAYGROUND, 'challenges'))) load(file, 'challenges', 'challenge')
  for (const file of readDir(path.join(__dirname, 'fixtures'))) load(file, 'fixtures')
  // Minimal reproducers found by differential fuzzing (engine vs chain), pinned with the chain outcome.
  for (const file of readDir(path.join(__dirname, 'fixtures', 'fuzz'))) load(file, 'fixtures')
  for (const dir of (process.env.CONFORMANCE_EXTRA ?? '').split(path.delimiter).filter(Boolean)) {
    for (const file of readDir(path.resolve(dir))) load(file, 'extra')
  }
  const only = process.env.CONFORMANCE_ONLY?.split(',').map((s) => s.trim()).filter(Boolean)
  return only ? entries.filter((e) => only.includes(e.content.id) || only.includes(path.basename(e.file, '.json'))) : entries
}

function skipReason(content: any): string | undefined {
  if (content.conformance === false) return 'conformance: false'
  if (typeof content.conformance === 'string') return content.conformance
  return undefined
}

interface Row {
  kind: string
  source: string
  id: string
  status: 'pass' | 'fail' | 'skipped'
  detail: string
}

const verbose = process.env.CONFORMANCE_VERBOSE === '1'

describe('Playground conformance', function () {
  this.timeout(10 * 60 * 1000)

  const entries = discover()
  const rows: Row[] = []
  let base: Base

  before(async function () {
    base = await deployBase()
  })

  after(function () {
    if (rows.length === 0) return
    const width = Math.max(...rows.map((r) => r.id.length), 2)
    const lines = rows.map((r) => `  ${r.status.padEnd(7)} ${r.kind.padEnd(9)} ${r.id.padEnd(width)} ${r.source}${r.detail ? `  ${r.detail.split('\n')[0]}` : ''}`)
    const counts = ['pass', 'fail', 'skipped'].map((s) => `${rows.filter((r) => r.status === s).length} ${s}`).join(', ')
    console.log(`\n  Conformance results (${counts})\n${lines.join('\n')}\n`)
    if (process.env.CONFORMANCE_REPORT) {
      fs.writeFileSync(process.env.CONFORMANCE_REPORT, JSON.stringify(rows, null, 2) + '\n')
    }
  })

  if (entries.length === 0) {
    it('finds something to check', function () {
      console.log('    no scenarios, challenges or fixtures found')
      this.skip()
    })
  }

  for (const entry of entries) {
    const id: string = entry.content.id ?? path.basename(entry.file, '.json')
    const title = `${entry.kind} ${id}${entry.source === 'fixtures' ? ' (fixture)' : ''}`
    const reason = skipReason(entry.content)

    if (reason !== undefined) {
      it(`${title} [skipped: ${reason}]`, function () {
        console.log(`    skipped ${id}: ${reason}`)
        rows.push({ kind: entry.kind, source: entry.source, id, status: 'skipped', detail: reason })
        this.skip()
      })
      continue
    }

    it(title, async function () {
      if (entry.content.__parseError) {
        rows.push({ kind: entry.kind, source: entry.source, id, status: 'fail', detail: `invalid JSON: ${entry.content.__parseError}` })
        throw new Error(`${entry.file}: invalid JSON: ${entry.content.__parseError}`)
      }
      if (entry.kind === 'scenario') {
        const scenario = entry.content as Scenario
        const report = await runScenario(base, scenario)
        if (verbose) {
          for (const step of report.steps) console.log(`      [${step.index}] ${step.ok ? 'ok  ' : 'FAIL'} ${step.label}${step.actual ? ` -> ${step.actual}` : ''}`)
        }
        const failure = report.passed ? '' : formatScenarioFailure(scenario, report)
        rows.push({ kind: entry.kind, source: entry.source, id, status: report.passed ? 'pass' : 'fail', detail: failure })
        if (!report.passed) throw new Error(failure)
      } else {
        const challenge = entry.content as Challenge
        const report = await runChallenge(base, challenge)
        if (verbose) {
          for (const [name, run] of [
            ['solution', report.solution],
            ['starting', report.starting]
          ] as const) {
            if (run.setupError) console.log(`      ${name}: setup error ${run.setupError}`)
            for (const t of run.tests) console.log(`      ${name} ${t.verdict === t.want ? 'ok  ' : 'diff'} ${t.label}: want ${t.want}, got ${t.verdict} (${t.actual})`)
          }
        }
        const failure = report.passed ? '' : formatChallengeFailure(challenge, report)
        rows.push({ kind: entry.kind, source: entry.source, id, status: report.passed ? 'pass' : 'fail', detail: failure })
        if (!report.passed) throw new Error(failure)
      }
    })
  }
})
