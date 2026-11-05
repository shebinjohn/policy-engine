/**
 * Policy Engine Playground engine. Pure and deterministic; runs in Node and the browser.
 *
 *   import { engine } from './engine/index.ts'
 *   const world = engine.createWorld({ balances: { USDC: '5000' }, rules: [...] })
 *   const result = engine.simulate(world, { to: 'USDC', call: { fn: 'transfer', args: ['Dave', '500'] } })
 *
 * Every EngineApi method is also exported as a named function.
 */
import { accessSelector, decodeSelector, opNumber } from './access.ts'
import { defaultBook, resolveAddress, resolveEntity } from './book.ts'
import {
  configurationRootOf,
  encodeTxCall,
  functions as catalogFunctions,
  ruleToConfiguration,
  toEncodedTx
} from './catalog.ts'
import { getPolicy } from './engine.ts'
import { makeMessageFor } from './messages.ts'
import { checkExpectation, runChallenge, runScenario } from './scenario.ts'
import { simulate } from './simulate.ts'
import type { EncodedTx, EngineApi, Entity, OperationName, RuleSpec, SimError, TableEntry, TxSpec, World } from './types.ts'
import { advanceTime, createWorld } from './world.ts'

export * from './types.ts'
export { EngineInputError, POLICY_LABELS, POLICY_NAMES } from './book.ts'
export { encodeRuleData, encodeBatch, packMultiSend, contextFor, SELECTORS } from './catalog.ts'
export { accessSelector, fallbackAccess, parseAccess, isFallbackAccess } from './access.ts'
export { describeAccess, describeCall } from './messages.ts'
export { checkState } from './scenario.ts'
export { START_TIME } from './world.ts'

export function book(): Entity[] {
  return defaultBook()
}

export function functions() {
  return catalogFunctions()
}

export function lookup(
  world: World,
  to: string,
  data: string,
  operation: OperationName
): { access: string; entry: TableEntry | null; usedFallback: boolean } | { error: SimError } {
  const target = resolveAddress(world, to)
  const op = opNumber(operation)
  const normalized = data === '' ? '0x' : data.toLowerCase()
  if (!decodeSelector(normalized).ok) {
    return { error: { by: 'guard', error: 'InvalidSelector', message: makeMessageFor(world)({ error: 'InvalidSelector' }, 'guard') } }
  }
  const res = getPolicy(world, target, normalized, op)
  if (!res.entry) return { access: res.exact, entry: null, usedFallback: false }
  return { access: res.access, entry: structuredClone(res.entry), usedFallback: res.usedFallback }
}

export function encode(world: World, tx: TxSpec): EncodedTx {
  const call = encodeTxCall(world, tx)
  const sel = decodeSelector(call.data)
  return toEncodedTx(call, sel.ok ? accessSelector(call.to, sel.selector, call.operation) : '')
}

export function configurationRoot(world: World, rules: RuleSpec[]): string {
  return configurationRootOf(rules.map((r) => ruleToConfiguration(world, r)))
}

export function resolve(world: World, nameOrAddress: string): Entity {
  return structuredClone(resolveEntity(world, nameOrAddress))
}

export { advanceTime, checkExpectation, createWorld, runChallenge, runScenario, simulate }

export const engine: EngineApi = {
  book,
  functions,
  createWorld,
  simulate,
  advanceTime,
  lookup,
  encode,
  configurationRoot,
  runScenario,
  runChallenge,
  checkExpectation,
  resolve
}

export default engine
