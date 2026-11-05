/**
 * Replays every scenario and challenge in scenarios/ and challenges/ through the engine.
 * Scenarios: every tx step must match its `expect` (and `expectState`).
 * Challenges: the solution must solve it, and the starting rules must not.
 * Quality checks at the end keep the tests honest: wrong answers close to the solution must fail,
 * block tests must be stopped by the guard, and blocked scenario steps must name their error.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  checkExpectation,
  runChallenge,
  runScenario,
  type Challenge,
  type PolicyName,
  type RuleSpec,
  type Scenario,
  type ScenarioStep,
  type SubTxSpec,
  type TxSpec
} from '../src/engine/index.ts'

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

/**
 * Every permission in a challenge solution must be pinned by a test: switching one ALWAYS to ONCE,
 * or one ONCE to ALWAYS, must leave the challenge unsolved. Otherwise the tests cannot tell the two
 * apart (for example a "monthly" payment tested only once) and a wrong answer earns full marks.
 */
describe('content: challenge permissions are pinned by tests', () => {
  for (const { file, data: challenge } of challenges) {
    const solution = JSON.stringify(challenge.solution)
    const swaps: { label: string; rules: string }[] = []
    for (const [from, to] of [
      ['"ALWAYS"', '"ONCE"'],
      ['"ONCE"', '"ALWAYS"']
    ]) {
      let at = solution.indexOf(from)
      let n = 0
      while (at !== -1) {
        n++
        swaps.push({ label: `${from} #${n} -> ${to}`, rules: solution.slice(0, at) + to + solution.slice(at + from.length) })
        at = solution.indexOf(from, at + from.length)
      }
    }
    if (swaps.length === 0) continue
    it(`${challenge.id} (${file})`, () => {
      const solvedBy = swaps.filter((s) => runChallenge(challenge, JSON.parse(s.rules)).solved).map((s) => s.label)
      assert.deepEqual(solvedBy, [], `still solved after switching a permission: ${solvedBy.join(', ')}. Add a test that tells them apart.`)
    })
  }
})

/**
 * Par is the size of the solution, so the solution earns full marks and nothing shorter is expected.
 */
describe('content: challenge par equals the solution', () => {
  for (const { file, data: challenge } of challenges) {
    it(`${challenge.id} (${file})`, () => {
      assert.equal(challenge.parRules, challenge.solution.length, 'parRules must equal the number of rules in the solution')
    })
  }
})

/**
 * Under the solution, every block test must be stopped by the Policy Guard: a guard check or a
 * policy decision. A test blocked by a balance shortfall, a signature problem or a failed call
 * passes for a reason the puzzle is not about, and would pass under a wrong answer too.
 */
describe('content: challenge solutions block at the guard', () => {
  for (const { file, data: challenge } of challenges) {
    it(`${challenge.id} (${file})`, () => {
      const wrong = runChallenge(challenge, challenge.solution)
        .results.filter((r) => r.test.want === 'block' && !r.result.ok && r.result.error?.by !== 'guard')
        .map((r) => `"${r.test.label}" (${r.result.error?.by}:${chain(r.result.error)})`)
      assert.deepEqual(wrong, [], `blocked, but not by the guard: ${wrong.join(', ')}`)
    })
  }
})

/**
 * No single-rule edit of a solution may still solve its challenge: dropping a rule, giving it
 * another allowed policy, or moving it to a catch-all or to another call the tests make. If one
 * does, the tests cannot tell the intended rule from a wrong one and a wrong answer earns full
 * marks (for example Always Allow on a batch, a one-time pass on a catch-all, or an exact rule in
 * place of the catch-all). Allowlist policies are not swapped in: their list is a deliberate choice,
 * and the permission test above pins it. An edit the brief allows goes in LEGITIMATE_EDITS, and the
 * challenge's `explain` should mention it.
 */
const LEGITIMATE_EDITS: Record<string, string[]> = {
  // The rule table is the allowlist here, so Always Allow on the two exact rules stops wrapping too.
  'no-wrapped-ether': ['Dave.none:CALL NativeTransferPolicy -> AllowPolicy', 'USDC.transfer:CALL ERC20TransferPolicy -> AllowPolicy']
}

function ruleKey(r: RuleSpec): string {
  if (r.fallback) return `catch-all:${r.fallback}`
  const selector = r.selector === undefined || r.selector === '0x00000000' ? 'none' : r.selector
  return `${r.target}.${selector}:${r.operation ?? 'CALL'}`
}

function testedKeys(challenge: Challenge): RuleSpec[] {
  const keys: RuleSpec[] = [
    { fallback: 'CALL', operation: 'CALL', policy: null },
    { fallback: 'DELEGATECALL', operation: 'DELEGATECALL', policy: null }
  ]
  const visit = (tx: TxSpec | SubTxSpec) => {
    const selector = tx.call ? tx.call.fn : tx.data && tx.data.length >= 10 ? tx.data.slice(0, 10) : 'none'
    keys.push({ target: tx.to, selector, operation: tx.operation ?? 'CALL', policy: null })
    for (const sub of tx.call?.batch ?? []) visit(sub)
  }
  for (const t of challenge.tests) visit(t.tx)
  return keys.filter((k, i) => keys.findIndex((x) => ruleKey(x) === ruleKey(k)) === i)
}

function swapConfig(challenge: Challenge, policy: PolicyName): RuleSpec['config'] | undefined | null {
  switch (policy) {
    case 'OneTimeAllowPolicy':
      return { granted: true }
    case 'CoSignerPolicy':
      return { cosigner: 'CoSigner' }
    case 'IncreasedThresholdPolicy':
      return { maxAbsent: 0 }
    case 'AllowedModulePolicy':
      return { module: challenge.setup.modules?.[0] ?? 'AllowanceModule', allowed: true }
    case 'ERC20TransferPolicy':
    case 'ERC20ApprovePolicy':
      return null
    default:
      return undefined
  }
}

function singleRuleEdits(challenge: Challenge): { label: string; rules: RuleSpec[] }[] {
  const solution = challenge.solution
  const keys = testedKeys(challenge)
  const edits: { label: string; rules: RuleSpec[] }[] = []
  solution.forEach((rule, i) => {
    const replace = (next: RuleSpec) => solution.map((r, j) => (j === i ? next : r))
    edits.push({ label: `drop ${ruleKey(rule)}`, rules: solution.filter((_, j) => j !== i) })
    for (const policy of challenge.allowedPolicies) {
      const config = swapConfig(challenge, policy)
      if (policy === rule.policy || config === null) continue
      const swapped: RuleSpec = { ...rule, policy }
      delete swapped.config
      if (config) swapped.config = config
      edits.push({ label: `${ruleKey(rule)} ${rule.policy} -> ${policy}`, rules: replace(swapped) })
    }
    for (const key of keys) {
      if (solution.some((r) => ruleKey(r) === ruleKey(key))) continue
      const moved: RuleSpec = { ...key, policy: rule.policy }
      if (rule.config) moved.config = rule.config
      edits.push({ label: `move ${rule.policy} from ${ruleKey(rule)} to ${ruleKey(key)}`, rules: replace(moved) })
    }
  })
  return edits
}

describe('content: no single-rule edit of a solution still solves', () => {
  for (const { file, data: challenge } of challenges) {
    it(`${challenge.id} (${file})`, () => {
      const allowed = LEGITIMATE_EDITS[challenge.id] ?? []
      const solvedBy = singleRuleEdits(challenge)
        .filter((e) => runChallenge(challenge, e.rules).solved)
        .map((e) => e.label)
      const wrong = solvedBy.filter((l) => !allowed.includes(l))
      assert.deepEqual(wrong, [], `still solved after: ${wrong.join('; ')}. Add a test that refuses it, or list it in LEGITIMATE_EDITS if the brief allows it.`)
      const stale = allowed.filter((l) => !solvedBy.includes(l))
      assert.deepEqual(stale, [], `LEGITIMATE_EDITS lists edits that no longer solve: ${stale.join('; ')}`)
    })
  }
})

/**
 * A blocked scenario step must say who blocked it and with which error. A bare `ok: false` passes
 * whatever stops the transaction, so a note could blame the wrong check and no test would notice.
 */
describe('content: blocked scenario steps name the error', () => {
  for (const { file, data: scenario } of scenarios) {
    it(`${scenario.id} (${file})`, () => {
      const vague = scenario.steps
        .filter((s): s is Extract<ScenarioStep, { do: 'tx' }> => s.do === 'tx' && !s.expect.ok && (s.expect.by === undefined || s.expect.error === undefined))
        .map((s) => `"${s.label}"`)
      assert.deepEqual(vague, [], `blocked steps without both expect.by and expect.error: ${vague.join(', ')}`)
    })
  }
})
