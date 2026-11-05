/**
 * World creation (SPEC §3): create the Safe, enable modules, fund it, configureImmediately the
 * rules, install the guards. Setup transactions do not count: the nonce is 0 and history empty.
 */
import { SENTINEL, ZERO, addressOf, defaultBook, eqAddr, kindOf, parseAmount, resolveAddress, EngineInputError } from './book.ts'
import { ruleToConfiguration } from './catalog.ts'
import { confirmPolicy } from './engine.ts'
import { Revert, toSimError, type Fault } from './errors.ts'
import { makeMessageFor } from './messages.ts'
import { setAllowance, setBalance, balanceOf } from './safe.ts'
import { SetupError, type SetupSpec, type World } from './types.ts'

export const START_TIME = 1767225600
export const DEFAULT_DELAY = 3600
export const DEFAULT_EXPIRY = 604800

function setupFail(w: World | null, fault: Fault, what: string): never {
  const err = toSimError(fault, 'execution', makeMessageFor(w))
  throw new SetupError(`${what}: ${err.message}`, err)
}

export function createWorld(setup: SetupSpec = {}): World {
  const book = defaultBook()
  const proto = { book } as unknown as World
  const safeAddress = addressOf(proto, 'Safe')
  const w: World = {
    version: 1,
    now: START_TIME,
    delay: setup.delay ?? DEFAULT_DELAY,
    expiry: setup.expiry ?? DEFAULT_EXPIRY,
    book,
    safe: {
      address: safeAddress,
      owners: [],
      threshold: 0,
      nonce: 0,
      modules: [],
      txGuard: null,
      moduleGuard: null
    },
    balances: {},
    allowances: {},
    table: {},
    policyState: {},
    roots: {},
    history: []
  }
  if (!Number.isInteger(w.delay) || w.delay < 0) throw new EngineInputError(`delay must be a whole number of seconds`)
  if (!Number.isInteger(w.expiry) || w.expiry < 0) throw new EngineInputError(`expiry must be a whole number of seconds`)
  if (w.expiry === 0) setupFail(w, { error: 'ZeroExpiryNotAllowed', message: 'The guard needs an expiry above 0.' }, 'Policy Guard')

  // 1. Safe.setup -> OwnerManager.setupOwners
  const owners = (setup.owners ?? ['Alice', 'Bob', 'Carol']).map((o) => resolveAddress(w, o))
  const threshold = setup.threshold ?? 2
  if (threshold > owners.length) setupFail(w, { error: 'GS201' }, 'Safe setup')
  if (threshold === 0) setupFail(w, { error: 'GS202' }, 'Safe setup')
  for (const o of owners) {
    if (eqAddr(o, ZERO) || eqAddr(o, SENTINEL) || eqAddr(o, safeAddress)) setupFail(w, { error: 'GS203' }, 'Safe setup')
    if (w.safe.owners.some((x) => eqAddr(x, o))) setupFail(w, { error: 'GS204' }, 'Safe setup')
    w.safe.owners.push(o)
  }
  w.safe.threshold = threshold

  // 2. enableModule (each prepends to the linked list, as on chain)
  for (const name of setup.modules ?? []) {
    const m = resolveAddress(w, name)
    if (eqAddr(m, ZERO) || eqAddr(m, SENTINEL)) setupFail(w, { error: 'GS101' }, `Enable ${name}`)
    if (w.safe.modules.some((x) => eqAddr(x, m))) setupFail(w, { error: 'GS102' }, `Enable ${name}`)
    w.safe.modules.unshift(m)
  }

  // 3. Funding and allowances
  for (const [asset, human] of Object.entries(setup.balances ?? {})) {
    if (asset === 'ETH') {
      setBalance(w, 'ETH', safeAddress, balanceOf(w, 'ETH', safeAddress) + parseAmount(w, 'ETH', human))
      continue
    }
    const token = resolveAddress(w, asset)
    const kind = kindOf(w, token)
    if (kind !== 'token' && kind !== 'weth') throw new EngineInputError(`balances: ${asset} is not a token`)
    const amount = parseAmount(w, token, human)
    setBalance(w, token, safeAddress, balanceOf(w, token, safeAddress) + amount)
    if (kind === 'weth') setBalance(w, 'ETH', token, balanceOf(w, 'ETH', token) + amount) // WETH is backed 1:1
  }
  for (const a of setup.allowances ?? []) {
    const token = resolveAddress(w, a.token)
    setAllowance(w, token, resolveAddress(w, a.owner), resolveAddress(w, a.spender), parseAmount(w, token, a.amount))
  }

  // 4. configureImmediately(rules), before any guard is installed
  const rules = setup.rules ?? []
  rules.forEach((rule, i) => {
    const conf = ruleToConfiguration(w, rule)
    try {
      confirmPolicy(w, conf, null)
    } catch (e) {
      if (e instanceof Revert) setupFail(w, e.fault, `Rule ${i + 1}`)
      throw e
    }
  })

  // 5. setGuard / setModuleGuard
  const guard = addressOf(w, 'PolicyGuard')
  if (setup.guards?.transaction !== false) w.safe.txGuard = guard
  if (setup.guards?.module !== false) w.safe.moduleGuard = guard

  w.safe.nonce = 0
  w.history = []
  return w
}

export function advanceTime(world: World, seconds: number): World {
  if (!Number.isFinite(seconds) || seconds < 0) throw new EngineInputError('Time can only move forward')
  const w = structuredClone(world)
  w.now += Math.floor(seconds)
  return w
}

