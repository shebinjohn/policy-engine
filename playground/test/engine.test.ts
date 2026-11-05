/**
 * Focused engine tests: every row of SPEC §5-§10, every README "Accepted limitations" and "Where
 * the check and the execution can diverge" case, and the points conformance pinned on chain.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ethers } from 'ethers'

import {
  POLICY_NAMES,
  SELECTORS,
  START_TIME,
  accessSelector,
  advanceTime,
  book,
  checkExpectation,
  configurationRoot,
  createWorld,
  encode,
  encodeBatch,
  engine,
  functions,
  lookup,
  resolve,
  runChallenge,
  runScenario,
  simulate,
  SetupError,
  type Challenge,
  type ContextSpec,
  type RuleSpec,
  type SetupSpec,
  type SimError,
  type SimResult,
  type SubTxSpec,
  type TxSpec,
  type World
} from '../src/engine/index.ts'
import { requiredSignatures } from '../src/engine/policies/IncreasedThresholdPolicy.ts'

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const coder = ethers.AbiCoder.defaultAbiCoder()
const addr = (name: string) => resolve(createWorld(), name).address

/** "guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(ERC20TransferPolicy) > Unauthorized" */
function chain(err: SimError | undefined): string {
  if (!err) return 'ok'
  const parts: string[] = []
  let cur: SimError | undefined = err
  while (cur) {
    parts.push(cur.policy !== undefined ? `${cur.error}(${cur.policy ?? 'null'})` : cur.error)
    cur = cur.reason
  }
  return `${err.by}:${parts.join(' > ')}`
}

function sim(w: World, tx: TxSpec): SimResult {
  const before = structuredClone(w)
  const r = simulate(w, tx)
  assert.deepEqual(w, before, 'simulate must not mutate its input world')
  // A failed tx returns the input world, except an owner-path CallFailed, which still uses the nonce.
  if (!r.ok && !(r.error?.error === 'CallFailed' && (tx.path ?? 'owner') === 'owner')) {
    assert.equal(r.world, w, 'a failed tx returns the input world')
  }
  return r
}

function ok(w: World, tx: TxSpec): World {
  const r = sim(w, tx)
  assert.equal(r.ok, true, `expected ok, got ${chain(r.error)}: ${r.error?.message}`)
  return r.world
}

function blocked(w: World, tx: TxSpec, expected: string): SimResult {
  const r = sim(w, tx)
  assert.equal(r.ok, false, `expected ${expected}, but the tx passed`)
  assert.equal(chain(r.error), expected)
  return r
}

const usdc = (to: string, amount: string): TxSpec => ({ to: 'USDC', call: { fn: 'transfer', args: [to, amount] } })
const batch = (subs: SubTxSpec[], extra: Partial<TxSpec> = {}): TxSpec => ({
  to: 'MultiSend',
  operation: 'DELEGATECALL',
  call: { fn: 'multiSend', batch: subs },
  ...extra
})
const usdcStep = (to: string, amount: string, context?: ContextSpec): SubTxSpec => ({
  to: 'USDC',
  call: { fn: 'transfer', args: [to, amount] },
  ...(context !== undefined ? { context } : {})
})

const MULTISEND_RULE: RuleSpec = { target: 'MultiSend', selector: 'multiSend', operation: 'DELEGATECALL', policy: 'MultiSendPolicy' }
const ALLOW_ALL: RuleSpec = { fallback: 'CALL', policy: 'AllowPolicy' }
const cosig = (signer = 'CoSigner', over?: 'self' | 'batch'): ContextSpec => ({ type: 'cosignature', signer, ...(over ? { over } : {}) })

function base(extra: SetupSpec = {}): SetupSpec {
  return { balances: { ETH: '10', USDC: '5000', WETH: '2' }, ...extra }
}

function balance(w: World, asset: string, holder: string): bigint {
  const assetKey = asset === 'ETH' ? 'ETH' : addr(asset)
  const table = w.balances[assetKey] ?? {}
  const key = Object.keys(table).find((k) => k.toLowerCase() === addr(holder).toLowerCase())
  return key ? BigInt(table[key]) : 0n
}

// ---------------------------------------------------------------------------------------------
// §2 Address book, §4 catalog, access selectors, roots
// ---------------------------------------------------------------------------------------------

describe('§2 address book and §4 catalog', () => {
  it('has every canonical name with unique checksummed addresses', () => {
    const entities = book()
    const names = ['Safe', 'PolicyGuard', 'MultiSend', 'USDC', 'SAFE', 'WETH', 'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Mallory', 'CoSigner', 'AllowanceModule', 'RecoveryModule', 'MysteryContract', 'Zero', ...POLICY_NAMES]
    for (const n of names) assert.ok(entities.find((e) => e.name === n), `missing ${n}`)
    for (const e of entities) assert.equal(e.address, ethers.getAddress(e.address))
    assert.equal(new Set(entities.map((e) => e.address)).size, entities.length)
    assert.equal(addr('Zero'), ethers.ZeroAddress)
    assert.equal(resolve(createWorld(), 'USDC').decimals, 6)
  })

  it('resolves unknown addresses to a synthetic entity', () => {
    const e = resolve(createWorld(), '0x1234567890123456789012345678901234567890')
    assert.equal(e.kind, 'contract')
    assert.equal(e.address, ethers.getAddress('0x1234567890123456789012345678901234567890'))
  })

  it('lists the catalog with real selectors', () => {
    const fns = functions()
    assert.equal(fns.length, 17)
    for (const f of fns) assert.equal(f.selector, ethers.id(f.signature).slice(0, 10), f.name)
    assert.equal(fns.find((f) => f.name === 'configureImmediately')!.signature, 'configureImmediately((address,bytes4,uint8,address,bytes)[])')
  })

  it('packs access selectors as in the README examples', () => {
    assert.equal(accessSelector(addr('SAFE'), SELECTORS.transfer, 0), '0xa9059cbb00000000000000005afe3855358e112b5647b952709e6165e1c1eeee')
    assert.equal(accessSelector(addr('MultiSend'), SELECTORS.multiSend, 1), '0x8d80ff0a01000000000000009641d764fc13c8b624c04430c7356c1c7c8102e2')
    assert.equal(encode(createWorld(), { to: 'Dave', value: '1' }).accessSelector, accessSelector(addr('Dave'), '0x00000000', 0))
  })

  it('computes the configuration root exactly like src/utils.ts getConfigurationRoot', () => {
    const w = createWorld()
    const rules: RuleSpec[] = [
      { target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ALWAYS' }] } },
      { fallback: 'CALL', policy: null }
    ]
    const expected = ethers.keccak256(
      coder.encode(
        ['tuple(address target, bytes4 selector, uint8 operation, address policy, bytes data)[]'],
        [
          [
            {
              target: addr('USDC'),
              selector: SELECTORS.transfer,
              operation: 0,
              policy: addr('ERC20TransferPolicy'),
              data: coder.encode(['tuple(address account, uint8 permission)[]'], [[{ account: addr('Dave'), permission: 2 }]])
            },
            { target: ethers.ZeroAddress, selector: '0x00000000', operation: 0, policy: ethers.ZeroAddress, data: '0x' }
          ]
        ]
      )
    )
    assert.equal(configurationRoot(w, rules), expected.toLowerCase())
  })

  it('packs MultiSend batches exactly like src/utils.ts encodeMultiSend', () => {
    const w = createWorld()
    const transfer = new ethers.Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [addr('Dave'), 5_000_000n])
    const expected =
      '0x' +
      [
        { operation: 0, to: addr('USDC'), value: 0n, data: transfer },
        { operation: 0, to: addr('Dave'), value: ethers.parseEther('1'), data: '0x' }
      ]
        .map((tx) =>
          ethers
            .solidityPacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [tx.operation, tx.to, tx.value, ethers.getBytes(tx.data).length, tx.data])
            .slice(2)
        )
        .join('')
    assert.equal(encodeBatch(w, [usdcStep('Dave', '5'), { to: 'Dave', value: '1' }]), expected)
  })

  it('fills prevOwner and prevModule from the linked lists', () => {
    const w = createWorld({ modules: ['AllowanceModule', 'RecoveryModule'] })
    // enableModule prepends: RecoveryModule is the head, AllowanceModule follows it.
    const data = encode(w, { to: 'Safe', call: { fn: 'disableModule', args: ['AllowanceModule'] } }).data
    const iface = new ethers.Interface(['function disableModule(address,address)'])
    const [prev, mod] = iface.decodeFunctionData('disableModule', data)
    assert.equal(prev, addr('RecoveryModule'))
    assert.equal(mod, addr('AllowanceModule'))
    const rm = new ethers.Interface(['function removeOwner(address,address,uint256)']).decodeFunctionData(
      'removeOwner',
      encode(w, { to: 'Safe', call: { fn: 'removeOwner', args: ['Alice', 2] } }).data
    )
    assert.equal(rm[0], '0x0000000000000000000000000000000000000001')
  })
})

// ---------------------------------------------------------------------------------------------
// §3 World
// ---------------------------------------------------------------------------------------------

describe('§3 createWorld', () => {
  it('builds the hardened default Safe', () => {
    const w = createWorld()
    assert.equal(w.safe.owners.length, 3)
    assert.equal(w.safe.threshold, 2)
    assert.equal(w.safe.nonce, 0)
    assert.equal(w.safe.txGuard, addr('PolicyGuard'))
    assert.equal(w.safe.moduleGuard, addr('PolicyGuard'))
    assert.equal(w.now, START_TIME)
    assert.equal(w.delay, 3600)
    assert.equal(w.expiry, 604800)
    assert.deepEqual(JSON.parse(JSON.stringify(w)), w, 'a world is plain JSON')
  })

  it('throws SetupError when a policy rejects its rule', () => {
    const attempt = (rule: RuleSpec) => {
      try {
        createWorld({ rules: [rule] })
      } catch (e) {
        assert.ok(e instanceof SetupError)
        return `${e.error.by}:${e.error.error}`
      }
      return 'ok'
    }
    assert.equal(attempt({ target: 'USDC', selector: 'transfer', policy: 'NativeTransferPolicy' }), 'execution:PolicyConfigurationFailed')
    assert.equal(attempt({ fallback: 'DELEGATECALL', policy: 'NativeTransferPolicy' }), 'execution:PolicyConfigurationFailed')
    assert.equal(attempt({ target: 'Dave', selector: 'none', policy: 'NativeTransferPolicy', data: '0x01' }), 'execution:PolicyConfigurationFailed')
    assert.equal(attempt({ fallback: 'CALL', policy: 'MultiSendPolicy' }), 'execution:PolicyConfigurationFailed')
    assert.equal(attempt({ target: 'MultiSend', selector: 'multiSend', policy: 'MultiSendPolicy' }), 'execution:PolicyConfigurationFailed')
    assert.equal(attempt({ target: 'USDC', selector: 'approve', policy: 'ERC20TransferPolicy' }), 'execution:InvalidSelector')
    assert.equal(attempt({ target: 'USDC', selector: 'transfer', operation: 'DELEGATECALL', policy: 'ERC20TransferPolicy' }), 'execution:InvalidOperation')
    assert.equal(attempt({ target: 'USDC', selector: 'transfer', policy: 'ERC20ApprovePolicy' }), 'execution:InvalidSelector')
    assert.equal(attempt({ fallback: 'CALL', policy: 'AllowedModulePolicy', config: { module: 'Zero', allowed: true } }), 'execution:InvalidModule')
    assert.equal(attempt({ fallback: 'CALL', policy: 'AllowedModulePolicy' }), 'execution:Reverted')
    assert.equal(attempt({ fallback: 'CALL', policy: 'NativeTransferPolicy' }), 'ok')
  })

  it('advanceTime is pure', () => {
    const w = createWorld()
    const later = advanceTime(w, 60)
    assert.equal(later.now, w.now + 60)
    assert.equal(w.now, START_TIME)
  })

  it('(5) with only the transaction guard, a later setModuleGuard is a checked call', () => {
    const w = createWorld({ guards: { module: false } })
    blocked(w, { to: 'Safe', call: { fn: 'setModuleGuard', args: ['PolicyGuard'] } }, 'guard:AccessDenied(null)')
  })
})

// ---------------------------------------------------------------------------------------------
// §5 Owner path
// ---------------------------------------------------------------------------------------------

describe('§5 owner transaction', () => {
  const w = createWorld(base({ rules: [ALLOW_ALL] }))

  it('needs threshold owner signatures (GS020, GS026)', () => {
    blocked(w, { ...usdc('Dave', '1'), signers: ['Alice'] }, 'safe:GS020')
    blocked(w, { ...usdc('Dave', '1'), signers: ['Alice', 'Mallory'] }, 'safe:GS026')
    blocked(w, { ...usdc('Dave', '1'), signers: ['Alice', 'Alice'] }, 'safe:GS026')
    ok(w, { ...usdc('Dave', '1'), signers: ['Carol', 'Alice'] })
  })

  it('(6) too few signers plus a context reads the context bytes as signatures: GS026', () => {
    blocked(w, { ...usdc('Dave', '1'), signers: ['Alice'], context: cosig() }, 'safe:GS026')
    blocked(w, { ...usdc('Dave', '1'), signers: ['Alice'], context: { type: 'attestation', key: 'trusted', valid: true } }, 'safe:GS026')
    // With no owner signature at all, a 65-byte co-signature plus the 64-byte envelope is still too short.
    blocked(w, { ...usdc('Dave', '1'), signers: [], context: cosig() }, 'safe:GS020')
  })

  it('increments the nonce, and a revert undoes it', () => {
    const r = sim(w, usdc('Dave', '1'))
    assert.equal(r.world.safe.nonce, 1)
    assert.ok(r.effects.some((e) => e.kind === 'nonce'))
    const f = blocked(w, usdc('Dave', '999999'), 'execution:ERC20InsufficientBalance')
    assert.equal(f.world.safe.nonce, 0)
    assert.ok(f.effects.every((e) => e.reverted === true))
    assert.equal(f.error!.args!.needed, '999999000000')
  })

  it('without a transaction guard, runs with a warning and no policy', () => {
    const open = createWorld(base({ guards: { transaction: false } }))
    const r = sim(open, usdc('Mallory', '100'))
    assert.equal(r.ok, true)
    assert.ok(r.trace.some((e) => e.id === 'safe.noGuard' && e.status === 'warn'))
    assert.equal(r.matched, undefined)
  })

  it('refuses gasPrice and safeTxGas before any rule', () => {
    blocked(w, { ...usdc('Dave', '1'), gasPrice: '1' }, 'guard:NonZeroGasPrice')
    blocked(w, { ...usdc('Dave', '1'), safeTxGas: '100000' }, 'guard:NonZeroSafeTxGas')
    blocked(w, { ...usdc('Dave', '1'), safeTxGas: '1', gasPrice: '1' }, 'guard:NonZeroGasPrice')
    const denied = createWorld(base())
    blocked(denied, { ...usdc('Dave', '1'), safeTxGas: '1' }, 'guard:NonZeroSafeTxGas')
  })

  it('(7) safeTxGas != 0 with no guard: a failed call is CallFailed and the nonce is used', () => {
    const open = createWorld(base({ guards: { transaction: false } }))
    const r = sim(open, { ...usdc('Dave', '999999'), safeTxGas: '100000' })
    assert.notEqual(r.world, open)
    assert.equal(r.ok, false)
    assert.equal(chain(r.error), 'execution:CallFailed')
    assert.equal(r.world.safe.nonce, 1)
    assert.equal(balance(r.world, 'USDC', 'Dave'), 0n)
    assert.ok(r.effects.some((e) => e.kind === 'nonce' && !e.reverted))
  })
})

// ---------------------------------------------------------------------------------------------
// §6 Module path
// ---------------------------------------------------------------------------------------------

describe('§6 module transaction', () => {
  const modTx = (tx: TxSpec, module = 'AllowanceModule'): TxSpec => ({ ...tx, path: 'module', module })

  it('needs an enabled module (GS104)', () => {
    blocked(createWorld(base({ rules: [ALLOW_ALL] })), modTx(usdc('Dave', '1')), 'safe:GS104')
  })

  it('is checked with the module and empty context, and never touches the nonce', () => {
    const w = createWorld(base({ modules: ['AllowanceModule'], rules: [ALLOW_ALL] }))
    const r = sim(w, modTx({ ...usdc('Dave', '1'), context: cosig() }))
    assert.equal(r.ok, true)
    assert.equal(r.world.safe.nonce, 0)
    assert.ok(r.trace.some((e) => e.id === 'safe.context' && e.status === 'warn'))
  })

  it('deny by default applies to modules too', () => {
    blocked(createWorld(base({ modules: ['AllowanceModule'] })), modTx(usdc('Dave', '1')), 'guard:AccessDenied(null)')
  })

  it('AllowedModulePolicy: allowlisted module passes, others and owners do not', () => {
    const w = createWorld(
      base({
        modules: ['AllowanceModule', 'RecoveryModule'],
        rules: [{ fallback: 'CALL', policy: 'AllowedModulePolicy', config: { module: 'AllowanceModule', allowed: true } }]
      })
    )
    ok(w, modTx(usdc('Dave', '1')))
    blocked(w, modTx(usdc('Dave', '1'), 'RecoveryModule'), 'guard:PolicyReverted(AllowedModulePolicy) > UnauthorizedModule')
    blocked(w, usdc('Dave', '1'), 'guard:PolicyReverted(AllowedModulePolicy) > InvalidModule')
  })

  it('AllowedModulePolicy allowlist survives detaching the policy', () => {
    const w = createWorld(
      base({
        modules: ['AllowanceModule', 'RecoveryModule'],
        rules: [
          { fallback: 'CALL', policy: 'AllowedModulePolicy', config: { module: 'RecoveryModule', allowed: true } },
          { fallback: 'CALL', policy: null },
          { fallback: 'CALL', policy: 'AllowedModulePolicy', config: { module: 'AllowanceModule', allowed: true } }
        ]
      })
    )
    ok(w, modTx(usdc('Dave', '1'), 'RecoveryModule'))
    const revoked = createWorld(
      base({
        modules: ['RecoveryModule'],
        rules: [
          { fallback: 'CALL', policy: 'AllowedModulePolicy', config: { module: 'RecoveryModule', allowed: true } },
          { fallback: 'CALL', policy: 'AllowedModulePolicy', config: { module: 'RecoveryModule', allowed: false } }
        ]
      })
    )
    blocked(revoked, modTx(usdc('Dave', '1'), 'RecoveryModule'), 'guard:PolicyReverted(AllowedModulePolicy) > UnauthorizedModule')
  })

  it('owner-only policies refuse the module path', () => {
    for (const policy of ['CoSignerPolicy', 'IncreasedThresholdPolicy', 'SafenetPolicy'] as const) {
      const w = createWorld(base({ modules: ['AllowanceModule'], rules: [{ fallback: 'CALL', policy }] }))
      blocked(w, modTx(usdc('Dave', '1')), `guard:PolicyReverted(${policy}) > ModulePathUnsupported`)
    }
  })

  it('a failed module call: ModuleExecutionFailed with the guard, CallFailed without', () => {
    const guarded = createWorld(base({ modules: ['AllowanceModule'], rules: [ALLOW_ALL] }))
    blocked(guarded, modTx(usdc('Dave', '999999')), 'guard:ModuleExecutionFailed')
    const open = createWorld(base({ modules: ['AllowanceModule'], guards: { module: false } }))
    const r = blocked(open, modTx(usdc('Dave', '999999')), 'execution:CallFailed')
    assert.equal(r.world, open)
  })

  it('only one guard is no guard: modules bypass a transaction-guard-only Safe', () => {
    const w = createWorld(base({ modules: ['AllowanceModule'], guards: { module: false } }))
    const r = sim(w, modTx({ to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] } }))
    assert.equal(r.ok, true)
    assert.equal(r.world.safe.txGuard, null)
    assert.ok(r.trace.some((e) => e.id === 'safe.noGuard'))
    assert.ok(r.effects.some((e) => e.title === 'Transaction guard removed'))
    // And the reverse: owner transactions skip the rules with only the module guard installed.
    ok(createWorld(base({ guards: { transaction: false } })), usdc('Mallory', '1'))
  })
})

// ---------------------------------------------------------------------------------------------
// §7 Engine check
// ---------------------------------------------------------------------------------------------

describe('§7 engine check', () => {
  it('denies by default', () => {
    const r = blocked(createWorld(base()), usdc('Dave', '1'), 'guard:AccessDenied(null)')
    assert.ok(r.trace.some((e) => e.id === 'engine.lookup.none'))
    assert.equal(r.matched, null)
  })

  it('an exact entry wins over the fallback', () => {
    const w = createWorld(base({ rules: [ALLOW_ALL, { target: 'USDC', selector: 'transfer', policy: 'DenyPolicy' }] }))
    const r = blocked(w, usdc('Dave', '1'), 'guard:AccessDenied(DenyPolicy)')
    assert.deepEqual(r.matched, { access: accessSelector(addr('USDC'), SELECTORS.transfer, 0), policy: 'DenyPolicy', isFallback: false })
    const f = sim(w, { to: 'Dave', value: '1' })
    assert.equal(f.ok, true)
    assert.equal(f.matched!.isFallback, true)
    assert.ok(f.trace.some((e) => e.id === 'engine.lookup.exact' && e.status === 'skip'))
    assert.ok(f.trace.some((e) => e.id === 'engine.lookup.fallback' && e.status === 'pass'))
  })

  it('removing an exact entry falls back instead of denying', () => {
    const w = createWorld(
      base({ rules: [ALLOW_ALL, { target: 'USDC', selector: 'transfer', policy: 'DenyPolicy' }, { target: 'USDC', selector: 'transfer', policy: null }] })
    )
    const r = sim(w, usdc('Dave', '1'))
    assert.equal(r.ok, true)
    assert.equal(r.matched!.isFallback, true)
  })

  it('selector zero is not empty calldata: NativeTransferPolicy checks the data', () => {
    const w = createWorld(base({ rules: [{ target: 'Dave', selector: 'none', policy: 'NativeTransferPolicy' }] }))
    ok(w, { to: 'Dave', value: '1' })
    blocked(w, { to: 'Dave', value: '1', data: '0x00000000' }, 'guard:PolicyReverted(NativeTransferPolicy) > CalldataNotPermitted')
    blocked(w, { to: 'Dave' }, 'guard:PolicyReverted(NativeTransferPolicy) > InvalidTransfer')
    // AllowPolicy on the same key does not check, so data starting with four zero bytes passes.
    const loose = createWorld(base({ rules: [{ target: 'Dave', selector: 'none', policy: 'AllowPolicy' }] }))
    ok(loose, { to: 'Dave', data: '0x00000000deadbeef' })
  })

  it('1-3 bytes of calldata are always InvalidSelector, also inside a batch', () => {
    const w = createWorld(base({ rules: [ALLOW_ALL, MULTISEND_RULE] }))
    for (const data of ['0x01', '0x0102', '0x010203']) blocked(w, { to: 'Dave', data }, 'guard:InvalidSelector')
    blocked(w, batch([{ to: 'Dave', data: '0xab' }]), 'guard:PolicyReverted(MultiSendPolicy) > InvalidSelector')
    ok(w, { to: 'Dave', data: '0x01020304' })
    assert.ok('error' in lookup(w, 'Dave', '0x0102', 'CALL'))
  })

  it('a value transfer to the zero address resolves to the fallback', () => {
    const w = createWorld(base({ rules: [{ fallback: 'CALL', policy: 'NativeTransferPolicy' }] }))
    const r = sim(w, { to: 'Zero', value: '1' })
    assert.equal(r.ok, true)
    assert.equal(r.matched!.isFallback, true)
    assert.ok(r.trace.some((e) => e.id === 'engine.lookup.exact' && e.title.startsWith('The zero address shares its key')))
    assert.equal(balance(r.world, 'ETH', 'Zero'), ethers.parseEther('1'))
  })

  it('WETH fallback dispatch defeats a DenyPolicy on deposit', () => {
    const w = createWorld(base({ rules: [ALLOW_ALL, { target: 'WETH', selector: 'deposit', policy: 'DenyPolicy' }] }))
    blocked(w, { to: 'WETH', value: '1', call: { fn: 'deposit' } }, 'guard:AccessDenied(DenyPolicy)')
    const r = sim(w, { to: 'WETH', value: '1' })
    assert.equal(r.ok, true)
    assert.equal(balance(r.world, 'WETH', 'Safe'), ethers.parseEther('3'))
    const other = sim(w, { to: 'WETH', value: '1', data: '0x12345678' })
    assert.equal(other.ok, true)
    assert.equal(balance(other.world, 'WETH', 'Safe'), ethers.parseEther('3'))
  })

  it('the guard itself is off limits, except the three configuration calls', () => {
    const w = createWorld(base({ rules: [ALLOW_ALL] }))
    blocked(w, { to: 'PolicyGuard', call: { fn: 'configureImmediately', configurations: [ALLOW_ALL] } }, 'guard:GuardTargetDenied')
    blocked(w, { to: 'PolicyGuard', value: '1' }, 'guard:GuardTargetDenied')
    blocked(w, { to: 'PolicyGuard', value: '1', call: { fn: 'requestConfiguration', configurations: [] } }, 'guard:GuardTargetDenied')
    blocked(w, { to: 'PolicyGuard', operation: 'DELEGATECALL', call: { fn: 'requestConfiguration', configurations: [] } }, 'guard:GuardTargetDenied')
  })

  it('configuration calls need no rule on the owner path and are denied to modules', () => {
    const w = createWorld(base({ modules: ['AllowanceModule'], rules: [MULTISEND_RULE] }))
    const req: TxSpec = { to: 'PolicyGuard', call: { fn: 'requestConfiguration', configurations: [ALLOW_ALL] } }
    const r = sim(w, req)
    assert.equal(r.ok, true)
    assert.equal(r.matched, null)
    assert.ok(r.trace.some((e) => e.id === 'engine.allowedCall' && e.status === 'pass'))
    blocked(w, { ...req, path: 'module', module: 'AllowanceModule' }, 'guard:ModuleConfigurationDenied')
    blocked(w, { ...batch([{ to: 'PolicyGuard', call: req.call }]), path: 'module', module: 'AllowanceModule' }, 'guard:PolicyReverted(MultiSendPolicy) > ModuleConfigurationDenied')
    ok(w, batch([{ to: 'PolicyGuard', call: req.call }]))
  })

  it('lookup() previews the entry without side effects', () => {
    const w = createWorld(base({ rules: [ALLOW_ALL, { target: 'USDC', selector: 'transfer', policy: 'DenyPolicy' }] }))
    const data = encode(w, usdc('Dave', '1')).data
    const exact = lookup(w, 'USDC', data, 'CALL')
    assert.ok('entry' in exact && exact.entry?.policy === 'DenyPolicy' && !exact.usedFallback)
    const fb = lookup(w, 'Dave', '0x', 'CALL')
    assert.ok('entry' in fb && fb.entry?.policy === 'AllowPolicy' && fb.usedFallback && fb.access === '0x' + '0'.repeat(64))
    const none = lookup(w, 'Dave', '0x', 'DELEGATECALL')
    assert.ok('entry' in none && none.entry === null)
  })

  it('OneTimeAllowPolicy on the fallback is keyed by the fallback, so it authorises one arbitrary call', () => {
    const w = createWorld(base({ rules: [{ fallback: 'CALL', policy: 'OneTimeAllowPolicy' }] }))
    const once = ok(w, usdc('Mallory', '10'))
    blocked(once, { to: 'Dave', value: '1' }, 'guard:PolicyReverted(OneTimeAllowPolicy) > Unauthorized')
    const revoked = createWorld(base({ rules: [{ fallback: 'CALL', policy: 'OneTimeAllowPolicy' }, { fallback: 'CALL', policy: 'OneTimeAllowPolicy', config: { granted: false } }] }))
    blocked(revoked, usdc('Dave', '1'), 'guard:PolicyReverted(OneTimeAllowPolicy) > Unauthorized')
  })
})

// ---------------------------------------------------------------------------------------------
// §8 Policies
// ---------------------------------------------------------------------------------------------

describe('§8 policies', () => {
  it('ERC20TransferPolicy: allowlist keyed by token, ONCE spent, transferFrom recipient decoded', () => {
    const w = createWorld(
      base({
        allowances: [{ token: 'USDC', owner: 'Safe', spender: 'Safe', amount: '100' }],
        rules: [
          { target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ALWAYS' }, { account: 'Erin', permission: 'ONCE' }] } },
          { target: 'USDC', selector: 'transferFrom', policy: 'ERC20TransferPolicy', config: { recipients: [] } }
        ]
      })
    )
    ok(ok(w, usdc('Dave', '1')), usdc('Dave', '1'))
    const r = sim(w, usdc('Erin', '1'))
    assert.ok(r.effects.some((e) => e.kind === 'policyState' && e.title === 'One-time permission for Erin to receive USDC used up'))
    blocked(r.world, usdc('Erin', '1'), 'guard:PolicyReverted(ERC20TransferPolicy) > Unauthorized')
    blocked(w, usdc('Mallory', '1'), 'guard:PolicyReverted(ERC20TransferPolicy) > Unauthorized')
    // The transferFrom rule sees the recipients configured through the transfer rule: keyed by token.
    ok(w, { to: 'USDC', call: { fn: 'transferFrom', args: ['Safe', 'Dave', '1'] } })
    blocked(w, { to: 'USDC', call: { fn: 'transferFrom', args: ['Safe', 'Mallory', '1'] } }, 'guard:PolicyReverted(ERC20TransferPolicy) > Unauthorized')
    // Unreadable transfer data reverts inside the policy.
    blocked(w, { to: 'USDC', data: SELECTORS.transfer + '00' }, 'guard:PolicyReverted(ERC20TransferPolicy) > Reverted')
  })

  it('ERC20ApprovePolicy: revoking is always allowed and spends nothing', () => {
    const w = createWorld(base({ rules: [{ target: 'USDC', selector: 'approve', policy: 'ERC20ApprovePolicy', config: { spenders: [{ account: 'Dave', permission: 'ONCE' }] } }] }))
    const approve = (who: string, amount: string): TxSpec => ({ to: 'USDC', call: { fn: 'approve', args: [who, amount] } })
    const revoked = ok(w, approve('Mallory', '0'))
    const spent = ok(revoked, approve('Dave', '50'))
    blocked(spent, approve('Dave', '50'), 'guard:PolicyReverted(ERC20ApprovePolicy) > Unauthorized')
    ok(spent, approve('Dave', '0'))
    blocked(w, approve('Mallory', '1'), 'guard:PolicyReverted(ERC20ApprovePolicy) > Unauthorized')
  })

  it('CoSignerPolicy: configured co-signer over this transaction, single use', () => {
    const w = createWorld(base({ rules: [{ target: 'USDC', selector: 'transfer', policy: 'CoSignerPolicy', config: { cosigner: 'CoSigner' } }, MULTISEND_RULE] }))
    ok(w, { ...usdc('Dave', '1'), context: cosig() })
    ok(w, { ...usdc('Dave', '1'), context: cosig('CoSigner', 'batch') })
    blocked(w, usdc('Dave', '1'), 'guard:PolicyReverted(CoSignerPolicy) > Unauthorized')
    blocked(w, { ...usdc('Dave', '1'), context: cosig('Mallory') }, 'guard:PolicyReverted(CoSignerPolicy) > Unauthorized')
    blocked(w, { ...usdc('Dave', '1'), context: { type: 'attestation', key: 'trusted', valid: true } }, 'guard:PolicyReverted(CoSignerPolicy) > Unauthorized')
    // (4) one owner signature by the co-signer is byte-for-byte a co-signature.
    ok(w, { ...usdc('Dave', '1'), context: { type: 'ownerSignatures', signers: ['CoSigner'] } })
    blocked(w, { ...usdc('Dave', '1'), context: { type: 'ownerSignatures', signers: ['CoSigner', 'Alice'] } }, 'guard:PolicyReverted(CoSignerPolicy) > Unauthorized')
    // In a batch each step needs its own co-signature, not one over the batch.
    ok(w, batch([usdcStep('Dave', '1', cosig()), usdcStep('Erin', '2', cosig())]))
    blocked(w, batch([usdcStep('Dave', '1', cosig('CoSigner', 'batch'))]), 'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(CoSignerPolicy) > Unauthorized')
    // Identical signature-checked steps in one batch: the second is refused.
    blocked(
      w,
      batch([usdcStep('Dave', '1', cosig()), usdcStep('Dave', '1', cosig())]),
      'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(CoSignerPolicy) > CoSignatureAlreadySpent'
    )
    const none = createWorld(base({ rules: [{ fallback: 'CALL', policy: 'CoSignerPolicy', config: { cosigner: 'Zero' } }] }))
    blocked(none, { ...usdc('Dave', '1'), context: cosig() }, 'guard:PolicyReverted(CoSignerPolicy) > NoCosignerConfigured')
    const keyless = createWorld(base({ rules: [{ fallback: 'CALL', policy: 'CoSignerPolicy', config: { cosigner: 'AllowanceModule' } }] }))
    blocked(keyless, { ...usdc('Dave', '1'), context: cosig('AllowanceModule') }, 'guard:PolicyReverted(CoSignerPolicy) > Unauthorized')
  })

  it('MultiSendPolicy pairs contexts positionally and pads with empty items', () => {
    const w = createWorld(base({ rules: [{ target: 'Dave', selector: 'none', policy: 'AllowPolicy' }, { target: 'USDC', selector: 'transfer', policy: 'CoSignerPolicy', config: { cosigner: 'CoSigner' } }, MULTISEND_RULE] }))
    // The engine pads: step 1 gets an empty item, step 2 its co-signature.
    ok(w, batch([{ to: 'Dave', value: '1' }, usdcStep('Dave', '1', cosig())]))
    // An explicit list of one item lands on step 1, so step 2 gets nothing.
    blocked(
      w,
      batch([{ to: 'Dave', value: '1' }, usdcStep('Dave', '1')], { context: { type: 'batch', items: [cosig()] } }),
      'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(CoSignerPolicy) > Unauthorized'
    )
    // An explicit null drops every sub-context.
    blocked(w, batch([usdcStep('Dave', '1', cosig())], { context: null }), 'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(CoSignerPolicy) > Unauthorized')
  })

  it('MultiSendPolicy nests errors exactly like the chain and resolves to == 0 to the Safe', () => {
    const w = createWorld(
      base({
        rules: [
          MULTISEND_RULE,
          { target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ALWAYS' }] } },
          { target: 'Safe', selector: 'changeThreshold', policy: 'AllowPolicy' }
        ]
      })
    )
    blocked(w, batch([usdcStep('Dave', '1'), usdcStep('Mallory', '1')]), 'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(ERC20TransferPolicy) > Unauthorized')
    blocked(w, batch([usdcStep('Dave', '1'), { to: 'Erin', value: '1' }]), 'guard:PolicyReverted(MultiSendPolicy) > AccessDenied(null)')
    const r = sim(w, batch([{ to: 'Zero', call: { fn: 'changeThreshold', args: [3] } }]))
    assert.equal(r.ok, true)
    assert.equal(r.world.safe.threshold, 3)
  })

  it('MultiSend nesting: checked at depth 2, then MultiSend (call only) refuses the inner delegatecall', () => {
    const w = createWorld(base({ rules: [MULTISEND_RULE, ALLOW_ALL] }))
    const inner: SubTxSpec = { to: 'MultiSend', operation: 'DELEGATECALL', call: { fn: 'multiSend', batch: [usdcStep('Dave', '1')] } }
    const r = blocked(w, batch([inner]), 'execution:Reverted')
    assert.ok(r.trace.some((e) => e.depth === 2 && e.id === 'engine.lookup.fallback'))
    const denied = createWorld(base({ rules: [MULTISEND_RULE] }))
    blocked(denied, batch([inner]), 'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(MultiSendPolicy) > AccessDenied(null)')
  })

  it('IncreasedThresholdPolicy: all but maxAbsent owners, clamped to [threshold + 1, owners]', () => {
    assert.equal(requiredSignatures(3, 2, 0n), 3)
    assert.equal(requiredSignatures(3, 2, 5n), 3)
    assert.equal(requiredSignatures(5, 2, 1n), 4)
    assert.equal(requiredSignatures(5, 2, 4n), 3)
    assert.equal(requiredSignatures(2, 2, 0n), 2)
    assert.equal(requiredSignatures(1, 1, 0n), 1)
    const w = createWorld(base({ rules: [{ target: 'USDC', selector: 'transfer', policy: 'IncreasedThresholdPolicy' }, MULTISEND_RULE] }))
    const sigs = (...signers: string[]): ContextSpec => ({ type: 'ownerSignatures', signers })
    ok(w, { ...usdc('Dave', '1'), context: sigs('Alice', 'Bob', 'Carol') })
    blocked(w, { ...usdc('Dave', '1'), context: sigs('Alice', 'Bob') }, 'guard:PolicyReverted(IncreasedThresholdPolicy) > GS020')
    blocked(w, { ...usdc('Dave', '1'), context: sigs('Alice', 'Bob', 'Mallory') }, 'guard:PolicyReverted(IncreasedThresholdPolicy) > GS026')
    blocked(w, { ...usdc('Dave', '1'), context: sigs('Alice', 'Bob', 'Bob') }, 'guard:PolicyReverted(IncreasedThresholdPolicy) > GS026')
    blocked(w, usdc('Dave', '1'), 'guard:PolicyReverted(IncreasedThresholdPolicy) > GS020')
    blocked(
      w,
      batch([usdcStep('Dave', '1', sigs('Alice', 'Bob', 'Carol')), usdcStep('Dave', '1', sigs('Alice', 'Bob', 'Carol'))]),
      'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(IncreasedThresholdPolicy) > SignaturesAlreadySpent'
    )
  })

  it('a batch is checked against the Safe state from before it runs', () => {
    const owners = ['Alice', 'Bob', 'Carol', 'Dave']
    const w = createWorld(
      base({
        owners,
        rules: [MULTISEND_RULE, { target: 'Safe', selector: 'changeThreshold', policy: 'AllowPolicy' }, { target: 'USDC', selector: 'transfer', policy: 'IncreasedThresholdPolicy', config: { maxAbsent: 1 } }]
      })
    )
    const three: ContextSpec = { type: 'ownerSignatures', signers: ['Alice', 'Bob', 'Carol'] }
    // Checked against threshold 2 (needs 3), although the batch raises it to 3 (would need 4).
    const r = sim(w, batch([{ to: 'Safe', call: { fn: 'changeThreshold', args: [3] } }, usdcStep('Erin', '1', three)]))
    assert.equal(r.ok, true, chain(r.error))
    blocked(r.world, { ...usdc('Erin', '1'), signers: ['Alice', 'Bob', 'Carol'], context: three }, 'guard:PolicyReverted(IncreasedThresholdPolicy) > GS020')
  })

  it('SafenetPolicy: check order, InvalidMulMulAddWitness, one attestation per nonce', () => {
    const w = createWorld(base({ rules: [{ fallback: 'CALL', policy: 'SafenetPolicy' }, MULTISEND_RULE] }))
    const att = (key: 'trusted' | 'untrusted', valid: boolean): ContextSpec => ({ type: 'attestation', key, valid })
    const next = ok(w, { ...usdc('Dave', '1'), context: att('trusted', true) })
    ok(next, { ...usdc('Dave', '1'), context: att('trusted', true) })
    blocked(w, usdc('Dave', '1'), 'guard:PolicyReverted(SafenetPolicy) > MalformedAttestation')
    blocked(w, { ...usdc('Dave', '1'), context: cosig() }, 'guard:PolicyReverted(SafenetPolicy) > MalformedAttestation')
    blocked(w, { ...usdc('Dave', '1'), context: att('untrusted', true) }, 'guard:PolicyReverted(SafenetPolicy) > UntrustedAttestationKey')
    // (1) a well-formed signature that does not verify.
    blocked(w, { ...usdc('Dave', '1'), context: att('trusted', false) }, 'guard:PolicyReverted(SafenetPolicy) > InvalidMulMulAddWitness')
    // Two Safenet-checked steps share one nonce: the second fails.
    blocked(
      w,
      batch([usdcStep('Dave', '1', att('trusted', true)), usdcStep('Erin', '1', att('trusted', true))]),
      'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(SafenetPolicy) > AttestationAlreadySpent'
    )
    blocked(
      w,
      batch([usdcStep('Dave', '1', att('trusted', true)), usdcStep('Erin', '1', att('untrusted', true))]),
      'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(SafenetPolicy) > UntrustedAttestationKey'
    )
  })

  it('NativeTransferPolicy only covers CALL keys, so a delegatecall never reaches it', () => {
    const w = createWorld(base({ rules: [{ fallback: 'CALL', policy: 'NativeTransferPolicy' }] }))
    blocked(w, { to: 'Dave', value: '1', operation: 'DELEGATECALL' }, 'guard:AccessDenied(null)')
  })
})

// ---------------------------------------------------------------------------------------------
// §9 Execution
// ---------------------------------------------------------------------------------------------

describe('§9 execution', () => {
  const w = createWorld(base({ rules: [ALLOW_ALL, MULTISEND_RULE, { fallback: 'DELEGATECALL', policy: 'AllowPolicy' }] }))

  it('moves ETH and tokens with plain effects', () => {
    const r = sim(w, usdc('Dave', '500'))
    assert.ok(r.effects.some((e) => e.title === 'Dave received 500 USDC'))
    assert.equal(balance(r.world, 'USDC', 'Dave'), 500_000_000n)
    const e = sim(w, { to: 'Dave', value: '1.5' })
    assert.ok(e.effects.some((x) => x.title === 'Dave received 1.5 ETH'))
    blocked(w, { to: 'Dave', value: '11' }, 'execution:Reverted')
    assert.ok(r.world.history.length === 1 && r.world.history[0].ok)
  })

  it('OpenZeppelin ERC-20 v5 errors', () => {
    blocked(w, usdc('Zero', '1'), 'execution:ERC20InvalidReceiver')
    blocked(w, { to: 'USDC', call: { fn: 'approve', args: ['Zero', '1'] } }, 'execution:ERC20InvalidSpender')
    blocked(w, { to: 'USDC', call: { fn: 'transferFrom', args: ['Dave', 'Erin', '1'] } }, 'execution:ERC20InsufficientAllowance')
    const allowed = createWorld(base({ rules: [ALLOW_ALL], allowances: [{ token: 'USDC', owner: 'Dave', spender: 'Safe', amount: '10' }] }))
    blocked(allowed, { to: 'USDC', call: { fn: 'transferFrom', args: ['Dave', 'Erin', '1'] } }, 'execution:ERC20InsufficientBalance')
    blocked(w, { to: 'USDC', value: '1', call: { fn: 'transfer', args: ['Dave', '1'] } }, 'execution:Reverted')
    blocked(w, { to: 'USDC' }, 'execution:Reverted')
    const approved = sim(w, { to: 'USDC', call: { fn: 'approve', args: ['Dave', '25'] } })
    assert.ok(approved.effects.some((e) => e.title === 'Treasury Safe approved Dave to spend 25 USDC'))
  })

  it('WETH9: deposit, withdraw, insufficient balance', () => {
    const d = sim(w, { to: 'WETH', value: '1', call: { fn: 'deposit' } })
    assert.equal(balance(d.world, 'WETH', 'Safe'), ethers.parseEther('3'))
    const out = sim(w, { to: 'WETH', call: { fn: 'withdraw', args: ['2'] } })
    assert.equal(out.ok, true)
    assert.equal(balance(out.world, 'ETH', 'Safe'), ethers.parseEther('12'))
    blocked(w, { to: 'WETH', call: { fn: 'withdraw', args: ['3'] } }, 'execution:Reverted')
    blocked(w, { to: 'WETH', call: { fn: 'transfer', args: ['Dave', '3'] } }, 'execution:Reverted')
  })

  it('Safe self-calls and their GS codes', () => {
    const self = (fn: string, args: (string | number)[]): TxSpec => ({ to: 'Safe', call: { fn, args } })
    // (2) a non-guard address reverts with empty data, never GS300 / GS301.
    blocked(w, self('setGuard', ['Mallory']), 'execution:Reverted')
    blocked(w, self('setGuard', ['USDC']), 'execution:Reverted')
    blocked(w, self('setModuleGuard', ['AllowPolicy']), 'execution:Reverted')
    blocked(w, self('setModuleGuard', ['Safe']), 'execution:Reverted')
    const off = sim(w, self('setGuard', ['Zero']))
    assert.equal(off.world.safe.txGuard, null)
    const on = sim(createWorld(base({ guards: { transaction: false } })), self('setGuard', ['PolicyGuard']))
    assert.ok(on.effects.some((e) => e.title === 'Policy Guard installed as transaction guard'))
    blocked(w, self('enableModule', ['Zero']), 'execution:GS101')
    blocked(ok(w, self('enableModule', ['AllowanceModule'])), self('enableModule', ['AllowanceModule']), 'execution:GS102')
    blocked(w, self('disableModule', ['AllowanceModule']), 'execution:GS103')
    blocked(w, self('changeThreshold', [4]), 'execution:GS201')
    blocked(w, self('changeThreshold', [0]), 'execution:GS202')
    blocked(w, self('addOwnerWithThreshold', ['Alice', 2]), 'execution:GS204')
    blocked(w, self('addOwnerWithThreshold', ['Zero', 2]), 'execution:GS203')
    blocked(w, self('addOwnerWithThreshold', ['Erin', 5]), 'execution:GS201')
    blocked(w, self('removeOwner', ['Mallory', 2]), 'execution:GS205')
    blocked(w, self('removeOwner', ['Alice', 3]), 'execution:GS201')
    blocked(w, self('removeOwner', ['Alice', 0]), 'execution:GS202')
    const added = sim(w, self('addOwnerWithThreshold', ['Erin', 3]))
    assert.equal(added.world.safe.owners[0], addr('Erin'))
    assert.equal(added.world.safe.threshold, 3)
    const removed = sim(added.world, { ...self('removeOwner', ['Bob', 2]), signers: ['Alice', 'Bob', 'Carol'] })
    assert.equal(removed.ok, true, chain(removed.error))
    assert.equal(removed.world.safe.owners.length, 3)
  })

  it('(3) the Safe fallback is not payable: ETH with unknown calldata reverts', () => {
    blocked(w, { to: 'Safe', value: '1', data: '0x12345678' }, 'execution:Reverted')
    ok(w, { to: 'Safe', data: '0x12345678' })
    ok(w, { to: 'Safe', value: '1' })
  })

  it('PolicyGuard: delayed configuration pending, applied, expired, re-requested, cancelled', () => {
    const change: RuleSpec[] = [{ target: 'Safe', selector: 'setGuard', policy: 'AllowPolicy' }]
    const guarded = createWorld(base())
    const request: TxSpec = { to: 'PolicyGuard', call: { fn: 'requestConfiguration', configurations: change } }
    const apply: TxSpec = { to: 'PolicyGuard', call: { fn: 'applyConfiguration', configurations: change } }
    const cancel: TxSpec = { to: 'PolicyGuard', call: { fn: 'invalidateRoot', configurations: change } }
    blocked(guarded, apply, 'execution:RootNotConfigured')
    blocked(guarded, cancel, 'execution:RootNotConfigured')
    const requested = ok(guarded, request)
    const root = configurationRoot(guarded, change)
    assert.equal(requested.roots[root].validFrom, START_TIME + 3600)
    assert.deepEqual(requested.roots[root].configurations, change)
    blocked(requested, request, 'execution:RootAlreadyConfigured')
    blocked(requested, apply, 'execution:RootConfigurationPending')
    blocked(advanceTime(requested, 3599), apply, 'execution:RootConfigurationPending')
    const applied = ok(advanceTime(requested, 3600), apply)
    assert.equal(applied.table[accessSelector(addr('Safe'), SELECTORS.setGuard, 0)].policy, 'AllowPolicy')
    assert.equal(applied.roots[root], undefined)
    blocked(applied, apply, 'execution:RootNotConfigured')
    const expired = advanceTime(requested, 3600 + 604800)
    blocked(expired, apply, 'execution:RootConfigurationExpired')
    const again = ok(expired, request)
    ok(advanceTime(again, 3600), apply)
    blocked(ok(requested, cancel), apply, 'execution:RootNotConfigured')
    // Guard removal: setGuard checked against the rules from before applyConfiguration in the same batch.
    const ready = advanceTime(createWorld(base({ rules: [MULTISEND_RULE] })), 0)
    const withRequest = advanceTime(ok(ready, request), 3600)
    blocked(withRequest, batch([{ to: 'PolicyGuard', call: apply.call }, { to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] } }]), 'guard:PolicyReverted(MultiSendPolicy) > AccessDenied(null)')
    const ruled = ok(withRequest, apply)
    const gone = ok(ruled, { to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] } })
    assert.equal(gone.safe.txGuard, null)
  })

  it('configureImmediately: works before install, refused once either guard is set', () => {
    const fresh = createWorld(base({ guards: { transaction: false, module: false } }))
    const r = sim(fresh, { to: 'PolicyGuard', call: { fn: 'configureImmediately', configurations: [ALLOW_ALL] } })
    assert.equal(r.ok, true)
    assert.equal(r.world.table['0x' + '0'.repeat(64)].policy, 'AllowPolicy')
    const half = createWorld(base({ guards: { transaction: false } }))
    blocked(half, { to: 'PolicyGuard', call: { fn: 'configureImmediately', configurations: [ALLOW_ALL] } }, 'execution:GuardAlreadyEnabled')
    blocked(createWorld(base()), { to: 'PolicyGuard', call: { fn: 'configureImmediately', configurations: [ALLOW_ALL] } }, 'guard:GuardTargetDenied')
  })

  it('(7) MultiSend as CALL runs the steps from MultiSend, not the Safe', () => {
    const asCall = (subs: SubTxSpec[], value?: string): TxSpec => ({ to: 'MultiSend', ...(value ? { value } : {}), call: { fn: 'multiSend', batch: subs } })
    const r = sim(w, asCall([{ to: 'Dave' }]))
    assert.equal(r.ok, true)
    assert.ok(r.trace.some((e) => e.id === 'exec.call' && e.status === 'warn'))
    blocked(w, asCall([{ to: 'Dave', value: '1' }]), 'execution:Reverted')
    const paid = sim(w, asCall([{ to: 'Dave', value: '1' }], '1'))
    assert.equal(paid.ok, true)
    assert.equal(balance(paid.world, 'ETH', 'Dave'), ethers.parseEther('1'))
    blocked(w, asCall([usdcStep('Dave', '1')]), 'execution:ERC20InsufficientBalance')
    blocked(w, asCall([{ to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] } }]), 'execution:GS031')
  })

  it('a delegatecall inside a batch is refused by MultiSend (call only)', () => {
    blocked(w, batch([{ to: 'MysteryContract', operation: 'DELEGATECALL' }]), 'execution:Reverted')
  })

  it('a delegatecall to unknown code succeeds with a warning', () => {
    const r = sim(w, { to: 'MysteryContract', operation: 'DELEGATECALL', data: '0x12345678' })
    assert.equal(r.ok, true)
    assert.ok(r.trace.some((e) => e.id === 'exec.effect' && e.status === 'warn'))
    assert.ok(r.effects.some((e) => e.kind === 'note'))
  })

  it('a delegatecall into a known contract runs its code against the Safe storage', () => {
    blocked(w, { ...usdc('Dave', '1'), operation: 'DELEGATECALL' }, 'execution:ERC20InsufficientBalance')
    ok(w, { ...usdc('Dave', '0'), operation: 'DELEGATECALL' })
    blocked(w, { to: 'WETH', operation: 'DELEGATECALL', call: { fn: 'withdraw', args: ['1'] } }, 'execution:Reverted')
    blocked(w, { to: 'Safe', operation: 'DELEGATECALL', call: { fn: 'setGuard', args: ['Zero'] } }, 'execution:GS031')
    blocked(w, { to: 'AllowanceModule', operation: 'DELEGATECALL' }, 'execution:Reverted')
  })

  it('modules are contracts with no receive or fallback, and hold no key', () => {
    blocked(w, { to: 'AllowanceModule', value: '1' }, 'execution:Reverted')
    blocked(w, { to: 'RecoveryModule' }, 'execution:Reverted')
    ok(w, { to: 'MysteryContract', value: '1', data: '0x12345678' })
  })

  it('a one-time grant spent in the check is rolled back when a later step fails', () => {
    const g = createWorld(base({ rules: [MULTISEND_RULE, { target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ONCE' }, { account: 'Erin', permission: 'ALWAYS' }] } }] }))
    const r = blocked(g, batch([usdcStep('Dave', '100'), usdcStep('Erin', '9999')]), 'execution:ERC20InsufficientBalance')
    const grant = r.effects.find((e) => e.kind === 'policyState')
    assert.ok(grant && grant.reverted === true && grant.title.includes('Dave'))
    assert.ok(r.effects.find((e) => e.title === 'Dave received 100 USDC')?.reverted)
    const rollback = r.trace.find((e) => e.id === 'rollback')
    assert.ok(rollback && rollback.detail!.includes('One-time permission for Dave'))
    // The grant is still there.
    ok(g, usdc('Dave', '100'))
    // A check failure later in the batch also undoes it.
    const c = blocked(g, batch([usdcStep('Dave', '100'), usdcStep('Mallory', '1')]), 'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(ERC20TransferPolicy) > Unauthorized')
    assert.ok(c.effects.some((e) => e.kind === 'policyState' && e.reverted))
  })
})

// ---------------------------------------------------------------------------------------------
// §3 / §9 Batches and guard changes
// ---------------------------------------------------------------------------------------------

describe('§3 / §9 batches and guard changes', () => {
  const RULES: RuleSpec[] = [
    MULTISEND_RULE,
    { target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ALWAYS' }] } }
  ]
  const bare = () => createWorld(base({ guards: { transaction: false, module: false } }))
  const configure: SubTxSpec = { to: 'PolicyGuard', call: { fn: 'configureImmediately', configurations: RULES } }
  const setTx: SubTxSpec = { to: 'Safe', call: { fn: 'setGuard', args: ['PolicyGuard'] } }
  const setModule: SubTxSpec = { to: 'Safe', call: { fn: 'setModuleGuard', args: ['PolicyGuard'] } }

  it('(2) hardening in one batch: unchecked, leaves the rules and both guards in place', () => {
    const r = sim(bare(), batch([configure, setModule, setTx]))
    assert.equal(r.ok, true, chain(r.error))
    assert.ok(r.trace.some((e) => e.id === 'safe.noGuard' && e.title === 'No guard yet, so this batch is not checked'))
    assert.ok(!r.trace.some((e) => e.id.startsWith('engine.') || e.id === 'guard.after'))
    assert.equal(r.effects.filter((e) => e.kind === 'rule').length, 2)
    assert.ok(r.effects.some((e) => e.title === 'Policy Guard installed as transaction guard'))
    assert.ok(r.effects.some((e) => e.title === 'Policy Guard installed as module guard'))
    assert.equal(r.world.safe.txGuard, addr('PolicyGuard'))
    assert.equal(r.world.safe.moduleGuard, addr('PolicyGuard'))
    // The hardened Safe now checks: Dave passes, Mallory does not, and it can still batch.
    ok(r.world, usdc('Dave', '1'))
    blocked(r.world, usdc('Mallory', '1'), 'guard:PolicyReverted(ERC20TransferPolicy) > Unauthorized')
    ok(r.world, batch([usdcStep('Dave', '1')]))
    // The order of the two set*Guard steps does not matter.
    assert.equal(sim(bare(), batch([configure, setTx, setModule])).ok, true)
  })

  it('(1) a guard installed by a step does not check the later steps of the same batch', () => {
    const r = sim(bare(), batch([setTx, setModule, usdcStep('Mallory', '5')]))
    assert.equal(r.ok, true, chain(r.error))
    assert.equal(balance(r.world, 'USDC', 'Mallory'), 5_000_000n)
    assert.ok(!r.trace.some((e) => e.id === 'guard.after'))
    // The next transaction is checked, with no rules: deny by default.
    blocked(r.world, usdc('Mallory', '5'), 'guard:AccessDenied(null)')
  })

  it('(3) configureImmediately reads the guard slots live: after setGuard in the same batch it fails', () => {
    const r = blocked(bare(), batch([setTx, configure]), 'execution:GuardAlreadyEnabled')
    assert.ok(r.effects.some((e) => e.title === 'Policy Guard installed as transaction guard' && e.reverted === true))
    assert.ok(r.effects.every((e) => e.reverted === true))
    assert.equal(r.world.safe.txGuard, null)
    blocked(bare(), batch([setModule, configure]), 'execution:GuardAlreadyEnabled')
  })

  it('(4) configuration calls pass as batch steps without a rule; later steps see the pre-batch rules', () => {
    const change: RuleSpec[] = [{ target: 'Safe', selector: 'changeThreshold', policy: 'AllowPolicy' }]
    const w = createWorld(base({ rules: [MULTISEND_RULE] }))
    const step = (fn: string): SubTxSpec => ({ to: 'PolicyGuard', call: { fn, configurations: change } })
    const requested = sim(w, batch([step('requestConfiguration')]))
    assert.equal(requested.ok, true, chain(requested.error))
    assert.ok(requested.trace.some((e) => e.id === 'engine.allowedCall' && e.depth === 1))
    ok(requested.world, batch([step('invalidateRoot')]))
    const ready = advanceTime(requested.world, 3600)
    ok(ready, batch([step('applyConfiguration')]))
    blocked(
      ready,
      batch([step('applyConfiguration'), { to: 'Safe', call: { fn: 'changeThreshold', args: [3] } }]),
      'guard:PolicyReverted(MultiSendPolicy) > AccessDenied(null)'
    )
    const applied = ok(ready, batch([step('applyConfiguration')]))
    assert.equal(ok(applied, { to: 'Safe', call: { fn: 'changeThreshold', args: [3] } }).safe.threshold, 3)
  })

  it('(5) removing both guards in one batch is still checked, and the old guard runs the after-check', () => {
    const w = createWorld(base({ rules: [MULTISEND_RULE, { target: 'Safe', selector: 'setGuard', policy: 'AllowPolicy' }] }))
    const off = batch([
      { to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] } },
      { to: 'Safe', call: { fn: 'setModuleGuard', args: ['Zero'] } }
    ])
    blocked(w, off, 'guard:PolicyReverted(MultiSendPolicy) > AccessDenied(null)')
    const both = createWorld(
      base({ rules: [MULTISEND_RULE, { target: 'Safe', selector: 'setGuard', policy: 'AllowPolicy' }, { target: 'Safe', selector: 'setModuleGuard', policy: 'AllowPolicy' }] })
    )
    const r = sim(both, off)
    assert.equal(r.ok, true, chain(r.error))
    assert.ok(r.trace.some((e) => e.id === 'multisend.step'))
    const after = r.trace.find((e) => e.id === 'guard.after')
    assert.ok(after && after.title === 'The Safe asks the guard it had when the transaction started')
    assert.equal(r.world.safe.txGuard, null)
    assert.equal(r.world.safe.moduleGuard, null)
    // From now on nothing is checked.
    ok(r.world, usdc('Mallory', '1'))
  })
})

// ---------------------------------------------------------------------------------------------
// Differential-test findings (the fixtures in conformance/fixtures/fuzz pin the chain outcomes)
// ---------------------------------------------------------------------------------------------

describe('differential-test findings', () => {
  const open = () => createWorld(base({ guards: { transaction: false, module: false } }))
  const iface = (sig: string) => new ethers.Interface([sig])

  it('a policy called directly works in its own namespace, never the Safe rules', () => {
    const w = createWorld(base({ guards: { transaction: false }, rules: [{ target: 'Dave', selector: 'none', policy: 'OneTimeAllowPolicy', config: { granted: false } }] }))
    const access = accessSelector(addr('Dave'), '0x00000000', 0)
    const configure = iface('function configure(address,uint256,bytes)').encodeFunctionData('configure', [addr('Safe'), access, coder.encode(['bool'], [true])])
    const check = iface('function checkTransaction(address,address,uint256,bytes,uint8,address,bytes,uint256)').encodeFunctionData('checkTransaction', [addr('Safe'), addr('Dave'), 0, '0x', 0, ethers.ZeroAddress, '0x', access])
    blocked(w, { to: 'OneTimeAllowPolicy', data: check }, 'execution:Unauthorized')
    const granted = ok(w, { to: 'OneTimeAllowPolicy', data: configure })
    assert.deepEqual(granted.policyState, w.policyState, 'the Safe namespace is untouched')
    assert.ok(granted.otherPolicyState && Object.keys(granted.otherPolicyState).length === 1)
    const spent = ok(granted, { to: 'OneTimeAllowPolicy', data: check })
    blocked(spent, { to: 'OneTimeAllowPolicy', data: check }, 'execution:Unauthorized')
    // The Safe's own grant (false) still applies to the guarded rule.
    assert.deepEqual(JSON.parse(JSON.stringify(spent)), spent, 'plain JSON')
    blocked(w, { to: 'OneTimeAllowPolicy', data: configure.slice(0, 74) }, 'execution:Reverted')
    blocked(w, { to: 'CoSignerPolicy', data: iface('function configure(address,uint256,bytes)').getFunction('configure')!.selector + '00'.repeat(32) + '00'.repeat(31) + '4c' }, 'execution:Reverted')
  })

  it('guard hooks called directly behave as on chain', () => {
    const g = new ethers.Interface([
      'function checkAfterExecution(bytes32,bool)',
      'function checkAfterModuleExecution(bytes32,bool)',
      'function checkTransaction(address,address,uint256,bytes,uint8,bytes)',
      'function checkTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,address)'
    ])
    const w = open()
    blocked(w, { to: 'PolicyGuard', data: g.encodeFunctionData('checkAfterExecution', [ethers.ZeroHash, false]) }, 'execution:ExecutionFailed')
    ok(w, { to: 'PolicyGuard', data: g.encodeFunctionData('checkAfterExecution', [ethers.ZeroHash, true]) })
    blocked(w, { to: 'PolicyGuard', data: g.encodeFunctionData('checkAfterModuleExecution', [ethers.ZeroHash, false]) }, 'execution:ModuleExecutionFailed')
    blocked(w, { to: 'PolicyGuard', data: g.encodeFunctionData('checkTransaction(address,address,uint256,bytes,uint8,bytes)', [addr('Safe'), addr('Dave'), 0, '0x', 0, '0x']) }, 'execution:NotChecking')
    const hook = (to: string, gasPrice: number) =>
      g.encodeFunctionData('checkTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,address)', [addr(to), 0, '0x', 0, 0, 0, gasPrice, ethers.ZeroAddress, ethers.ZeroAddress, '0x', ethers.ZeroAddress])
    blocked(w, { to: 'PolicyGuard', data: hook('Dave', 1) }, 'execution:NonZeroGasPrice')
    blocked(w, { to: 'PolicyGuard', data: hook('Dave', 0) }, 'execution:AccessDenied(null)')
  })

  it('guard roots requested by another caller live in their own namespace', () => {
    const w = createWorld(base({ rules: [ALLOW_ALL] }))
    const request = { to: 'PolicyGuard', call: { fn: 'requestConfiguration', configurations: [ALLOW_ALL] } }
    const r = sim(w, { to: 'MultiSend', call: { fn: 'multiSend', batch: [request] } })
    assert.equal(r.ok, true, chain(r.error))
    assert.deepEqual(r.world.roots, {})
    const ns = `guard:${addr('MultiSend')}`
    assert.equal(r.world.otherRoots?.[ns]?.[configurationRoot(w, [ALLOW_ALL])], START_TIME + 3600)
    // The Safe's own namespace is separate: the Safe can request the same root.
    ok(r.world, request)
  })

  it('gas price with no guard: refund note, or GS011 with no ETH', () => {
    const w = createWorld(base({ guards: { transaction: false } }))
    const r = sim(w, { to: 'Dave', value: '1', gasPrice: '1' })
    assert.equal(r.ok, true)
    assert.ok(r.effects.some((e) => e.kind === 'note' && e.title === 'The Safe pays a gas refund to the relayer'))
    const broke = createWorld({ balances: { USDC: '1' }, guards: { transaction: false } })
    blocked(broke, { to: 'Dave', gasPrice: '1' }, 'execution:GS011')
    const starved = sim(w, { ...usdc('Dave', '1'), gasPrice: '1' })
    assert.equal(chain(starved.error), 'execution:CallFailed')
    assert.equal(starved.world.safe.nonce, 1)
  })

  it('MultiSendPolicy reads any context as its positional list', () => {
    const w = createWorld(base({ rules: [MULTISEND_RULE, ALLOW_ALL, { target: 'Erin', selector: 'none', policy: 'SafenetPolicy' }] }))
    ok(w, batch([{ to: 'Dave', value: '1' }], { context: { type: 'ownerSignatures', signers: [] } }))
    ok(w, batch([{ to: 'Dave', value: '1' }], { context: { type: 'attestation', key: 'trusted', valid: true } }))
    blocked(w, batch([{ to: 'Erin', value: '1' }], { context: { type: 'attestation', key: 'trusted', valid: true } }), 'guard:PolicyReverted(MultiSendPolicy) > PolicyReverted(SafenetPolicy) > MalformedAttestation')
    blocked(w, batch([{ to: 'Dave', value: '1' }], { context: cosig() }), 'guard:PolicyReverted(MultiSendPolicy) > Reverted')
  })
})

// ---------------------------------------------------------------------------------------------
// §11 Trace and copy
// ---------------------------------------------------------------------------------------------

describe('§11 trace and copy', () => {
  const IDS = new Set([
    'safe.signatures', 'safe.nonce', 'safe.noGuard', 'safe.module', 'safe.context', 'guard.gasPrice', 'guard.safeTxGas',
    'engine.allowedCall', 'engine.guardTarget', 'engine.selector', 'engine.lookup.exact', 'engine.lookup.fallback',
    'engine.lookup.none', 'policy.check', 'policy.state', 'multisend.step', 'exec.call', 'exec.effect', 'exec.revert', 'exec.configure',
    'guard.after', 'commit', 'rollback'
  ])

  it('uses stable ids, plain titles, and keeps hex in tech', () => {
    const w = createWorld(base({ modules: ['AllowanceModule'], rules: [MULTISEND_RULE, { target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ONCE' }] } }, { target: 'Dave', selector: 'none', policy: 'NativeTransferPolicy' }, { fallback: 'CALL', policy: 'CoSignerPolicy' }] }))
    const txs: TxSpec[] = [
      usdc('Dave', '1'),
      usdc('Mallory', '1'),
      { to: 'Dave', value: '1' },
      { to: 'Dave', data: '0x01' },
      { to: 'Dave', value: '1', data: '0x00000000' },
      { to: 'Erin', value: '1', context: cosig() },
      { to: 'PolicyGuard', call: { fn: 'requestConfiguration', configurations: [] } },
      { to: 'PolicyGuard', call: { fn: 'configureImmediately', configurations: [] } },
      batch([usdcStep('Dave', '1'), { to: 'Dave', value: '20' }]),
      { ...usdc('Dave', '1'), path: 'module', module: 'AllowanceModule' },
      { ...usdc('Dave', '1'), gasPrice: '1' },
      { ...usdc('Dave', '1'), signers: ['Mallory', 'Alice'] }
    ]
    const results = txs.map((tx) => sim(w, tx))
    for (const r of results) {
      for (const e of r.trace) {
        assert.ok(IDS.has(e.id), `unknown trace id ${e.id}`)
        assert.ok(e.title.length <= 80, `title too long: ${e.title}`)
        assert.doesNotMatch(e.title, /0x[0-9a-fA-F]{6}/, `hex in title: ${e.title}`)
        for (const text of [e.title, e.detail ?? '']) {
          assert.doesNotMatch(text, /[—–]/, `dash in: ${text}`)
          assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `emoji in: ${text}`)
        }
      }
      for (const e of r.effects) assert.doesNotMatch(e.title, /0x[0-9a-fA-F]{6}|[—–]/, e.title)
      let err = r.error
      while (err) {
        assert.ok(err.message.length > 0)
        assert.doesNotMatch(err.message, /[—–]/)
        assert.equal(err.message.trim().split(/(?<=\.)\s+(?=[A-Z])/).length, 1, `one sentence: ${err.message}`)
        err = err.reason
      }
    }
    const first = results[0]
    assert.deepEqual(
      first.trace.map((e) => e.id),
      ['safe.signatures', 'safe.nonce', 'guard.gasPrice', 'guard.safeTxGas', 'engine.selector', 'engine.lookup.exact', 'policy.check', 'policy.state', 'exec.call', 'exec.effect', 'guard.after', 'commit']
    )
    assert.ok(first.trace.some((e) => e.title === 'Rule found: USDC transfers are checked by Recipient Allowlist'))
    const fb = results[5]
    assert.ok(fb.trace.some((e) => e.title === 'No rule for this call, so the Safe uses the catch-all rule'))
    const step = results[8].trace.filter((e) => e.id === 'multisend.step')
    assert.deepEqual(step.map((e) => [e.depth, e.subTx]), [[1, 0], [1, 1]])
  })

  it('is deterministic', () => {
    const w = createWorld(base({ rules: [ALLOW_ALL] }))
    assert.deepEqual(simulate(w, usdc('Dave', '1')), simulate(w, usdc('Dave', '1')))
  })
})

// ---------------------------------------------------------------------------------------------
// §12 Scenarios and challenges
// ---------------------------------------------------------------------------------------------

describe('§12 scenarios, challenges, expectations', () => {
  const challenge: Challenge = {
    id: 'test-challenge',
    level: 1,
    title: 'Pay Dave Only',
    brief: 'Pay Dave, nobody else.',
    setup: base({ rules: [] }),
    allowedPolicies: ['ERC20TransferPolicy', 'AllowPolicy'],
    parRules: 1,
    tests: [
      { label: 'Dave', tx: usdc('Dave', '1'), want: 'pass' },
      { label: 'Mallory', tx: usdc('Mallory', '1'), want: 'block' }
    ],
    hints: [],
    solution: [{ target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ALWAYS' }] } }],
    explain: ''
  }

  it('scores stars by rule count', () => {
    const sol = challenge.solution
    assert.equal(runChallenge(challenge, sol).stars, 3)
    const padding: RuleSpec = { target: 'SAFE', selector: 'transfer', policy: 'ERC20TransferPolicy' }
    assert.equal(runChallenge(challenge, [...sol, padding]).stars, 2)
    assert.equal(runChallenge(challenge, [...sol, padding, padding]).stars, 2)
    assert.equal(runChallenge(challenge, [...sol, padding, padding, padding]).stars, 1)
    const open = runChallenge(challenge, [ALLOW_ALL])
    assert.equal(open.solved, false)
    assert.equal(open.stars, 0)
    assert.deepEqual(open.results.map((r) => r.verdict), ['pass', 'pass'])
  })

  it('never throws on bad player rules', () => {
    const bad = runChallenge(challenge, [{ target: 'USDC', selector: 'transfer', policy: 'NativeTransferPolicy' }])
    assert.equal(bad.setupError?.error, 'PolicyConfigurationFailed')
    assert.equal(bad.stars, 0)
    const unknown = runChallenge(challenge, [{ target: 'Nobody', selector: 'transfer', policy: 'AllowPolicy' }])
    assert.equal(unknown.setupError?.error, 'InvalidRule')
  })

  it('sequence mode carries the world between tests', () => {
    const seq: Challenge = { ...challenge, testMode: 'sequence', tests: [{ label: '1', tx: usdc('Dave', '1'), want: 'pass' }, { label: '2', tx: usdc('Dave', '1'), want: 'block' }] }
    const once: RuleSpec[] = [{ target: 'USDC', selector: 'transfer', policy: 'ERC20TransferPolicy', config: { recipients: [{ account: 'Dave', permission: 'ONCE' }] } }]
    assert.equal(runChallenge(seq, once).solved, true)
    assert.equal(runChallenge({ ...seq, testMode: 'independent' }, once).solved, false)
  })

  it('runs scenarios with waits and state expectations', () => {
    const change: RuleSpec[] = [ALLOW_ALL]
    const outcomes = runScenario({
      id: 's',
      chapter: 'Test',
      order: 1,
      title: 'T',
      summary: '',
      lesson: '',
      setup: base(),
      steps: [
        { do: 'tx', label: 'request', tx: { to: 'PolicyGuard', call: { fn: 'requestConfiguration', configurations: change } }, expect: { ok: true }, expectState: { nonce: 1 } },
        { do: 'tx', label: 'too early', tx: { to: 'PolicyGuard', call: { fn: 'applyConfiguration', configurations: change } }, expect: { ok: false, by: 'execution', error: 'RootConfigurationPending' } },
        { do: 'wait', label: 'wait', seconds: 3600 },
        { do: 'tx', label: 'apply', tx: { to: 'PolicyGuard', call: { fn: 'applyConfiguration', configurations: change } }, expect: { ok: true } },
        { do: 'tx', label: 'pay', tx: usdc('Dave', '5'), expect: { ok: true }, expectState: { balances: { Dave: { USDC: '5' }, Safe: { USDC: '4995' } }, nonce: 3, txGuard: 'PolicyGuard', moduleGuard: 'PolicyGuard', threshold: 2, owners: ['Carol', 'Bob', 'Alice'], modules: [] } }
      ]
    })
    for (const o of outcomes) if (o.step.do === 'tx') assert.equal(o.matches, true, `${o.step.label}: ${o.mismatch}`)
    const wrong = runScenario({
      id: 'w', chapter: 'T', order: 1, title: 'T', summary: '', lesson: '', setup: base(),
      steps: [{ do: 'tx', label: 'x', tx: usdc('Dave', '1'), expect: { ok: true }, expectState: { nonce: 5 } }]
    })
    assert.equal(wrong[0].matches, false)
  })

  it('checkExpectation compares only the given fields, recursing into reasons', () => {
    const w = createWorld(base({ rules: [MULTISEND_RULE] }))
    const r = simulate(w, batch([usdcStep('Dave', '1')]))
    assert.equal(checkExpectation(r, { ok: false }), null)
    assert.equal(checkExpectation(r, { ok: false, error: 'PolicyReverted', policy: 'MultiSendPolicy', reason: { error: 'AccessDenied', policy: null } }), null)
    assert.match(checkExpectation(r, { ok: false, reason: { policy: 'DenyPolicy' } }) ?? '', /reason\.policy/)
    assert.match(checkExpectation(r, { ok: true }) ?? '', /blocked/)
    assert.equal(engine.checkExpectation(simulate(createWorld(base({ rules: [ALLOW_ALL] })), usdc('Dave', '1')), { ok: true }), null)
  })
})
