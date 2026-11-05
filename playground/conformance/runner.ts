/**
 * Replays scenarios and challenges on chain and compares the outcome with their expectations.
 */
import type { Challenge, Expectation, Scenario, StateExpectation, TxSpec } from '../src/engine/types'
import { ChainError, classify, decodeRevert, describe } from './decode'
import { buildContext, encodeRules, encodeTx } from './encode'
import { ethers, helpers, utils } from './upstream'
import {
  Base,
  createWorld,
  decimalsOf,
  enabledModules,
  execSafeTx,
  fromUnits,
  GUARD_STORAGE_SLOT,
  HarnessSetupError,
  keyOf,
  MODULE_GUARD_STORAGE_SLOT,
  nameOf,
  ownerSignatures,
  readGuard,
  resolve,
  send,
  toUnits,
  TX_GAS_LIMIT,
  World
} from './world'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChainResult {
  ok: boolean
  error?: ChainError
}

export function describeResult(result: ChainResult): string {
  return result.ok ? 'ok' : `reverted ${describe(result.error)}`
}

function worldOptions(rules?: any) {
  return {
    rules,
    encodeRules,
    describeRevert: (world: World, data: string) => describe(decodeRevert(world, data, 'execution'))
  }
}

/**
 * Mines the next transaction exactly the accumulated `wait` seconds after the latest block, so a
 * scenario's timeline is the engine's: transactions between waits share one timestamp. Without
 * same-timestamp blocks each transaction is at least one second after the previous one.
 */
async function advanceClock(world: World): Promise<void> {
  const latest = await helpers.time.latest()
  const gap = world.base.sameTimestamp ? world.pendingWait : Math.max(1, world.pendingWait)
  await helpers.time.setNextBlockTimestamp(latest + gap)
  world.pendingWait = 0
}

/** Executes one TxSpec on chain. */
export async function runTx(world: World, tx: TxSpec): Promise<ChainResult> {
  const checked = await encodeTx(world, tx)
  const path = tx.path ?? 'owner'

  if (path === 'module') {
    const moduleName = tx.module ?? 'AllowanceModule'
    const module = world.base.modules[moduleName]
    if (!module) throw new Error(`module path: "${moduleName}" is not a module contract in the harness (AllowanceModule, RecoveryModule)`)
    const moduleAddress = await module.getAddress()
    const moduleEnabled: boolean = await world.safe.isModuleEnabled(moduleAddress)
    const guardInstalled = (await readGuard(world, MODULE_GUARD_STORAGE_SLOT)) === world.book.PolicyGuard.address
    await advanceClock(world)
    const result = await send(() =>
      module.connect(world.base.relayer).executeTx(world.book.Safe.address, checked.to, checked.value, checked.data, checked.operation, { gasLimit: TX_GAS_LIMIT })
    )
    if (!result.ok) {
      if (result.revertData === undefined) throw new Error('module transaction failed without revert data')
      return { ok: false, error: classify(world, result.revertData, { path, moduleEnabled, guardInstalled, dataLength: ethers.dataLength(checked.data) }) }
    }
    // No revert: the Safe tells success from failure with its events (execTransactionFromModule returned false).
    const safeAddress = world.book.Safe.address.toLowerCase()
    const events = result.receipt.logs
      .filter((log: any) => log.address.toLowerCase() === safeAddress)
      .map((log: any) => {
        try {
          return world.safe.interface.parseLog(log)?.name
        } catch {
          return undefined
        }
      })
    if (events.includes('ExecutionFromModuleFailure')) return { ok: false, error: { by: 'execution', error: 'CallFailed' } }
    if (!events.includes('ExecutionFromModuleSuccess')) throw new Error('module transaction emitted neither ExecutionFromModuleSuccess nor ExecutionFromModuleFailure')
    return { ok: true }
  }

  // Owner path.
  const owners: string[] = (await world.safe.getOwners()).map((o: string) => ethers.getAddress(o))
  const threshold = Number(await world.safe.getThreshold())
  const signerNames = tx.signers ?? owners.slice(0, threshold).map((address) => nameOf(world, address))
  const signers = signerNames.map((name) => keyOf(world, name))
  const safeTxGas = BigInt(tx.safeTxGas ?? '0')
  const gasPrice = BigInt(tx.gasPrice ?? '0')
  const nonce = BigInt(await world.safe.nonce())
  const env = { nonce, outer: checked, safeAddress: world.book.Safe.address }
  const context = await buildContext(world, env, tx.context, checked, false)
  const fields = {
    to: checked.to,
    value: checked.value,
    data: checked.data,
    operation: checked.operation,
    safeTxGas,
    baseGas: 0n,
    gasPrice,
    gasToken: ethers.ZeroAddress,
    refundReceiver: ethers.ZeroAddress
  }

  // Pre-check the exact signature bytes with Safe.checkSignatures (a view), so a revert can be
  // attributed to the Safe's signature check rather than guessed from the GS code.
  const txHash = await world.safe.getTransactionHash(fields.to, fields.value, fields.data, fields.operation, safeTxGas, 0, gasPrice, ethers.ZeroAddress, ethers.ZeroAddress, nonce)
  let signatureBytes = await ownerSignatures(world, signers, { ...fields, nonce })
  if (context !== null) signatureBytes = utils.appendSignatureExtension(signatureBytes, context)
  let signaturesRejected = false
  try {
    await world.safe['checkSignatures(address,bytes32,bytes)'].staticCall(await world.base.relayer.getAddress(), txHash, signatureBytes)
  } catch {
    signaturesRejected = true
  }
  const guardInstalled = (await readGuard(world, GUARD_STORAGE_SLOT)) === world.book.PolicyGuard.address

  await advanceClock(world)
  const result = await execSafeTx(world, fields, signers, context)
  if (result.signatures !== signatureBytes) throw new Error('harness: signature bytes changed between pre-check and execution')
  if (!result.ok) {
    if (result.revertData === undefined) throw new Error('owner transaction failed without revert data')
    return { ok: false, error: classify(world, result.revertData, { path, signaturesRejected, guardInstalled, dataLength: ethers.dataLength(checked.data) }) }
  }
  // Executed without reverting. With safeTxGas or gasPrice set (no guard) a failed inner call does not revert.
  const safeAddress = world.book.Safe.address.toLowerCase()
  const failed = result.receipt.logs.some((log: any) => {
    if (log.address.toLowerCase() !== safeAddress) return false
    try {
      return world.safe.interface.parseLog(log)?.name === 'ExecutionFailure'
    } catch {
      return false
    }
  })
  if (failed) return { ok: false, error: { by: 'execution', error: 'CallFailed' } }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------------------------

/** Compares only the fields `expected` gives. Returns a list of mismatches (empty = match). */
export function compareExpectation(expected: Expectation, actual: ChainResult): string[] {
  const problems: string[] = []
  if (expected.ok !== actual.ok) {
    problems.push(`ok: expected ${expected.ok}, got ${actual.ok}`)
    return problems
  }
  if (!actual.ok) compareError(expected, actual.error, 'error', problems)
  return problems
}

function compareError(expected: Omit<Expectation, 'ok'>, actual: ChainError | undefined, at: string, problems: string[]) {
  if (!actual) {
    problems.push(`${at}: expected ${JSON.stringify(expected)}, got no error`)
    return
  }
  if (expected.by !== undefined && expected.by !== actual.by) problems.push(`${at}.by: expected ${expected.by}, got ${actual.by}`)
  if (expected.error !== undefined && expected.error !== actual.error) problems.push(`${at}.error: expected ${expected.error}, got ${actual.error}`)
  if (expected.policy !== undefined && expected.policy !== (actual.policy ?? null)) {
    problems.push(`${at}.policy: expected ${expected.policy}, got ${actual.policy === undefined ? 'none' : actual.policy}`)
  }
  if (expected.reason !== undefined) compareError(expected.reason, actual.reason, `${at}.reason`, problems)
}

const ASSETS = ['ETH', 'USDC', 'SAFE', 'WETH']

async function balanceOf(world: World, holder: string, asset: string): Promise<bigint> {
  if (asset === 'ETH') return ethers.provider.getBalance(holder)
  const token = asset === 'USDC' ? world.base.usdc : asset === 'SAFE' ? world.base.safeToken : asset === 'WETH' ? world.base.weth : undefined
  if (!token) throw new Error(`unknown asset "${asset}" (expected ${ASSETS.join(', ')})`)
  return token.balanceOf(holder)
}

function sameSet(a: string[], b: string[]): boolean {
  const left = [...a].map((x) => x.toLowerCase()).sort()
  const right = [...b].map((x) => x.toLowerCase()).sort()
  return left.length === right.length && left.every((x, i) => x === right[i])
}

export async function compareState(world: World, expected: StateExpectation): Promise<string[]> {
  const problems: string[] = []
  for (const [holderName, assets] of Object.entries(expected.balances ?? {})) {
    const holder = resolve(world, holderName)
    for (const [asset, human] of Object.entries(assets)) {
      const decimals = asset === 'ETH' ? 18 : decimalsOf(world, resolve(world, asset))
      const actual = await balanceOf(world, holder, asset)
      const want = toUnits(human, decimals)
      if (actual !== want) problems.push(`balances.${holderName}.${asset}: expected ${human}, got ${fromUnits(actual, decimals)}`)
    }
  }
  if (expected.nonce !== undefined) {
    const delta = BigInt(await world.safe.nonce()) - world.setupNonce
    if (delta !== BigInt(expected.nonce)) problems.push(`nonce: expected ${expected.nonce}, got ${delta}`)
  }
  for (const [field, slot] of [
    ['txGuard', GUARD_STORAGE_SLOT],
    ['moduleGuard', MODULE_GUARD_STORAGE_SLOT]
  ] as const) {
    const want = expected[field]
    if (want === undefined) continue
    const actual = await readGuard(world, slot)
    const wantAddress = want === null ? ethers.ZeroAddress : resolve(world, want)
    if (actual !== wantAddress) problems.push(`${field}: expected ${want}, got ${actual === ethers.ZeroAddress ? 'null' : nameOf(world, actual)}`)
  }
  if (expected.modules !== undefined) {
    const actual = await enabledModules(world)
    const want = expected.modules.map((name) => resolve(world, name))
    if (!sameSet(actual, want)) problems.push(`modules: expected [${expected.modules.join(', ')}], got [${actual.map((a) => nameOf(world, a)).join(', ')}]`)
  }
  if (expected.threshold !== undefined) {
    const actual = Number(await world.safe.getThreshold())
    if (actual !== expected.threshold) problems.push(`threshold: expected ${expected.threshold}, got ${actual}`)
  }
  if (expected.owners !== undefined) {
    const actual: string[] = (await world.safe.getOwners()).map((o: string) => ethers.getAddress(o))
    const want = expected.owners.map((name) => resolve(world, name))
    if (!sameSet(actual, want)) problems.push(`owners: expected [${expected.owners.join(', ')}], got [${actual.map((a) => nameOf(world, a)).join(', ')}]`)
  }
  return problems
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

export interface StepReport {
  index: number
  label: string
  kind: 'tx' | 'wait'
  ok: boolean
  actual?: string
  problems: string[]
}

export interface ScenarioReport {
  id: string
  setupError?: string
  steps: StepReport[]
  passed: boolean
}

export async function runScenario(base: Base, scenario: Scenario): Promise<ScenarioReport> {
  let world: World
  try {
    world = await createWorld(base, scenario.setup ?? {}, worldOptions())
  } catch (error: any) {
    return { id: scenario.id, setupError: error instanceof HarnessSetupError ? error.message : String(error?.stack ?? error), steps: [], passed: false }
  }
  const steps: StepReport[] = []
  for (const [index, step] of scenario.steps.entries()) {
    if (step.do === 'wait') {
      world.pendingWait += step.seconds
      steps.push({ index, label: step.label, kind: 'wait', ok: true, problems: [] })
      continue
    }
    try {
      const result = await runTx(world, step.tx)
      const problems = compareExpectation(step.expect, result)
      if (step.expectState) problems.push(...(await compareState(world, step.expectState)))
      steps.push({ index, label: step.label, kind: 'tx', ok: problems.length === 0, actual: describeResult(result), problems })
    } catch (error: any) {
      steps.push({ index, label: step.label, kind: 'tx', ok: false, actual: 'harness error', problems: [`harness error: ${error?.message ?? error}`] })
    }
  }
  return { id: scenario.id, steps, passed: steps.every((s) => s.ok) }
}

export function formatScenarioFailure(scenario: Scenario, report: ScenarioReport): string {
  if (report.setupError) return `scenario ${scenario.id}: setup failed: ${report.setupError}`
  return report.steps
    .filter((s) => !s.ok)
    .map((s) => `scenario ${scenario.id} step ${s.index} "${s.label}": ${s.problems.join('; ')} (on chain: ${s.actual})`)
    .join('\n')
}

// ---------------------------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------------------------

export interface TestRun {
  label: string
  want: 'pass' | 'block'
  verdict: 'pass' | 'block' | 'error'
  actual: string
}

export interface RulesetReport {
  setupError?: string
  tests: TestRun[]
  /** Every test's verdict equals its want. */
  solved: boolean
}

export async function runChallengeRules(base: Base, challenge: Challenge, rules: any[]): Promise<RulesetReport> {
  let world: World
  try {
    world = await createWorld(base, challenge.setup ?? {}, worldOptions(rules))
  } catch (error: any) {
    return { setupError: error instanceof HarnessSetupError ? error.message : String(error?.stack ?? error), tests: [], solved: false }
  }
  const configured = await helpers.takeSnapshot()
  const tests: TestRun[] = []
  const sequence = challenge.testMode === 'sequence'
  for (const [i, test] of challenge.tests.entries()) {
    if (!sequence && i > 0) {
      await configured.restore()
      world.pendingWait = 0
    }
    try {
      const result = await runTx(world, test.tx)
      tests.push({ label: test.label, want: test.want, verdict: result.ok ? 'pass' : 'block', actual: describeResult(result) })
    } catch (error: any) {
      tests.push({ label: test.label, want: test.want, verdict: 'error', actual: `harness error: ${error?.message ?? error}` })
    }
  }
  return { tests, solved: tests.every((t) => t.verdict === t.want) }
}

export interface ChallengeReport {
  id: string
  solution: RulesetReport
  starting: RulesetReport
  passed: boolean
}

export async function runChallenge(base: Base, challenge: Challenge): Promise<ChallengeReport> {
  const solution = await runChallengeRules(base, challenge, challenge.solution)
  const starting = await runChallengeRules(base, challenge, challenge.setup?.rules ?? [])
  const startingHarnessError = starting.tests.some((t) => t.verdict === 'error')
  // A challenge is valid if the solution passes every test and the starting rules fail at least one
  // (a starting setup that cannot even be configured counts as failing).
  const passed = solution.solved && !startingHarnessError && !starting.solved
  return { id: challenge.id, solution, starting, passed }
}

export function formatChallengeFailure(challenge: Challenge, report: ChallengeReport): string {
  const lines: string[] = []
  if (report.solution.setupError) lines.push(`challenge ${challenge.id}: solution rules failed to configure: ${report.solution.setupError}`)
  for (const [i, t] of report.solution.tests.entries()) {
    if (t.verdict !== t.want) lines.push(`challenge ${challenge.id} solution test ${i} "${t.label}": want ${t.want}, got ${t.verdict} (on chain: ${t.actual})`)
  }
  if (report.starting.solved) lines.push(`challenge ${challenge.id}: the starting rules already pass every test (${report.starting.tests.map((t) => `"${t.label}" ${t.actual}`).join('; ')})`)
  for (const [i, t] of report.starting.tests.entries()) {
    if (t.verdict === 'error') lines.push(`challenge ${challenge.id} starting test ${i} "${t.label}": ${t.actual}`)
  }
  return lines.join('\n')
}
