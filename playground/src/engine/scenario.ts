/**
 * Scenario and challenge runners (SPEC §12) and expectation checks.
 */
import { EngineInputError, eqAddr, nameOf, parseAmount, resolveAddress } from './book.ts'
import { describeChain } from './errors.ts'
import { makeMessageFor } from './messages.ts'
import { balanceOf } from './safe.ts'
import { simulate } from './simulate.ts'
import {
  SetupError,
  type Challenge,
  type ChallengeReport,
  type ChallengeTestResult,
  type Expectation,
  type RuleSpec,
  type Scenario,
  type SimError,
  type SimResult,
  type StateExpectation,
  type StepOutcome,
  type World
} from './types.ts'
import { advanceTime, createWorld } from './world.ts'

function compareError(path: string, actual: SimError | undefined, exp: Omit<Expectation, 'ok'>): string | null {
  if (exp.by !== undefined && actual?.by !== exp.by) {
    return `${path}.by: expected ${exp.by}, got ${actual?.by ?? 'nothing'}`
  }
  if (exp.error !== undefined && actual?.error !== exp.error) {
    return `${path}.error: expected ${exp.error}, got ${actual?.error ?? 'nothing'}`
  }
  if (exp.policy !== undefined && (actual?.policy ?? null) !== exp.policy) {
    return `${path}.policy: expected ${exp.policy ?? 'null'}, got ${actual?.policy ?? 'null'}`
  }
  if (exp.reason !== undefined) {
    return compareError(`${path}.reason`, actual?.reason, exp.reason)
  }
  return null
}

export function checkExpectation(result: SimResult, expect: Expectation): string | null {
  if (result.ok !== expect.ok) {
    return expect.ok
      ? `expected the transaction to pass, but it was blocked: ${describeChain(result.error)} (${result.error?.message ?? ''})`
      : 'expected the transaction to be blocked, but it passed'
  }
  if (expect.ok) return null
  const mismatch = compareError('error', result.error, expect)
  return mismatch ? `${mismatch} [actual: ${describeChain(result.error)}]` : null
}

function sameSet(world: World, actual: string[], expected: string[]): boolean {
  const exp = expected.map((n) => resolveAddress(world, n))
  return actual.length === exp.length && exp.every((a) => actual.some((b) => eqAddr(a, b)))
}

export function checkState(world: World, expect: StateExpectation): string | null {
  const problems: string[] = []
  for (const [holder, assets] of Object.entries(expect.balances ?? {})) {
    const holderAddr = resolveAddress(world, holder)
    for (const [asset, human] of Object.entries(assets)) {
      const assetKey = asset === 'ETH' ? 'ETH' : resolveAddress(world, asset)
      const want = parseAmount(world, assetKey, human)
      const got = balanceOf(world, assetKey, holderAddr)
      if (want !== got) problems.push(`${holder} ${asset}: expected ${human}, got base units ${got}`)
    }
  }
  if (expect.nonce !== undefined && world.safe.nonce !== expect.nonce) {
    problems.push(`nonce: expected ${expect.nonce}, got ${world.safe.nonce}`)
  }
  const guardCheck = (label: string, want: string | null | undefined, got: string | null) => {
    if (want === undefined) return
    const wantAddr = want === null || want === 'Zero' ? null : resolveAddress(world, want)
    if (!(wantAddr === null ? got === null : eqAddr(got, wantAddr))) {
      problems.push(`${label}: expected ${want ?? 'none'}, got ${got ? nameOf(world, got) : 'none'}`)
    }
  }
  guardCheck('txGuard', expect.txGuard, world.safe.txGuard)
  guardCheck('moduleGuard', expect.moduleGuard, world.safe.moduleGuard)
  if (expect.modules && !sameSet(world, world.safe.modules, expect.modules)) {
    problems.push(`modules: expected [${expect.modules.join(', ')}], got [${world.safe.modules.map((m) => nameOf(world, m)).join(', ')}]`)
  }
  if (expect.threshold !== undefined && world.safe.threshold !== expect.threshold) {
    problems.push(`threshold: expected ${expect.threshold}, got ${world.safe.threshold}`)
  }
  if (expect.owners && !sameSet(world, world.safe.owners, expect.owners)) {
    problems.push(`owners: expected [${expect.owners.join(', ')}], got [${world.safe.owners.map((m) => nameOf(world, m)).join(', ')}]`)
  }
  return problems.length > 0 ? problems.join('; ') : null
}

export function runScenario(scenario: Scenario): StepOutcome[] {
  let world = createWorld(scenario.setup)
  const out: StepOutcome[] = []
  for (const step of scenario.steps) {
    if (step.do === 'wait') {
      world = advanceTime(world, step.seconds)
      out.push({ step, world })
      continue
    }
    const result = simulate(world, step.tx)
    const mismatches: string[] = []
    const m = checkExpectation(result, step.expect)
    if (m) mismatches.push(m)
    if (step.expectState) {
      const s = checkState(result.world, step.expectState)
      if (s) mismatches.push(`state: ${s}`)
    }
    world = result.world
    const outcome: StepOutcome = { step, result, world, matches: mismatches.length === 0 }
    if (mismatches.length > 0) outcome.mismatch = mismatches.join('; ')
    out.push(outcome)
  }
  return out
}

function stars(solved: boolean, ruleCount: number, par: number): 0 | 1 | 2 | 3 {
  if (!solved) return 0
  if (ruleCount <= par) return 3
  if (ruleCount <= par + 2) return 2
  return 1
}

export function runChallenge(challenge: Challenge, rules: RuleSpec[]): ChallengeReport {
  const ruleCount = rules.length
  let base: World
  try {
    base = createWorld({ ...challenge.setup, rules })
  } catch (e) {
    if (e instanceof SetupError) return { solved: false, results: [], ruleCount, stars: 0, setupError: e.error }
    if (e instanceof EngineInputError) {
      return {
        solved: false,
        results: [],
        ruleCount,
        stars: 0,
        setupError: { by: 'execution', error: 'InvalidRule', message: e.message }
      }
    }
    throw e
  }
  const results: ChallengeTestResult[] = []
  let world = base
  for (const test of challenge.tests) {
    const start = challenge.testMode === 'sequence' ? world : base
    let result: SimResult
    try {
      result = simulate(start, test.tx)
    } catch (e) {
      if (!(e instanceof EngineInputError)) throw e
      // A test the rules cannot even encode counts as blocked.
      result = {
        ok: false,
        error: { by: 'execution', error: 'InvalidInput', message: e.message },
        trace: [],
        effects: [],
        world: start,
        encoded: { to: '', value: '0', data: '0x', operation: 0, accessSelector: '' }
      }
    }
    if (challenge.testMode === 'sequence') world = result.world
    const verdict = result.ok ? 'pass' : 'block'
    results.push({ test, result, verdict, matches: verdict === test.want })
  }
  const solved = results.every((r) => r.matches)
  return { solved, results, ruleCount, stars: stars(solved, ruleCount, challenge.parRules) }
}

export { makeMessageFor }
