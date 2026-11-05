/** The transaction builder's editable state, and conversion to and from the engine's TxSpec. */
import type { ContextSpec, OperationName, RuleSpec, SubTxSpec, TxSpec, World } from '../../engine/types.ts'
import { CONFIG_FNS, defaultSigners, fnByName } from './describe.ts'

export type ContextKind = 'none' | 'cosignature' | 'ownerSignatures' | 'attestation'

export interface ContextDraft {
  kind: ContextKind
  signer: string
  over: 'self' | 'batch'
  signers: string[]
  key: 'trusted' | 'untrusted'
  valid: boolean
}

export const EMPTY_CONTEXT: ContextDraft = { kind: 'none', signer: 'CoSigner', over: 'self', signers: [], key: 'trusted', valid: true }

export type ActionMode = 'fn' | 'none' | 'raw'

export interface StepDraft {
  to: string
  mode: ActionMode
  fn: string
  args: string[]
  value: string
  operation: OperationName
  data: string
  context: ContextDraft
}

export interface TxDraft extends StepDraft {
  path: 'owner' | 'module'
  signers: string[]
  module: string
  safeTxGas: string
  gasPrice: string
  batch: StepDraft[]
  /** For applyConfiguration / invalidateRoot: 'draft' (the change set being edited) or a pending root. */
  rootSource: string
  label?: string
}

export function emptyStep(to = 'USDC'): StepDraft {
  return { to, mode: 'fn', fn: 'transfer', args: ['Dave', '100'], value: '0', operation: 'CALL', data: '', context: { ...EMPTY_CONTEXT } }
}

export function contextFromSpec(c: ContextSpec | undefined): ContextDraft {
  if (!c) return { ...EMPTY_CONTEXT }
  switch (c.type) {
    case 'cosignature':
      return { ...EMPTY_CONTEXT, kind: 'cosignature', signer: c.signer, over: c.over ?? 'self' }
    case 'ownerSignatures':
      return { ...EMPTY_CONTEXT, kind: 'ownerSignatures', signers: [...c.signers] }
    case 'attestation':
      return { ...EMPTY_CONTEXT, kind: 'attestation', key: c.key, valid: c.valid }
    default:
      return { ...EMPTY_CONTEXT }
  }
}

export function contextToSpec(c: ContextDraft): ContextSpec | undefined {
  switch (c.kind) {
    case 'cosignature':
      return { type: 'cosignature', signer: c.signer, over: c.over }
    case 'ownerSignatures':
      return { type: 'ownerSignatures', signers: c.signers }
    case 'attestation':
      return { type: 'attestation', key: c.key, valid: c.valid }
    default:
      return undefined
  }
}

function stepFromSpec(s: SubTxSpec): StepDraft {
  return {
    to: s.to,
    mode: s.call ? 'fn' : s.data !== undefined && s.data !== '' && s.data !== '0x' ? 'raw' : 'none',
    fn: s.call?.fn ?? '',
    args: (s.call?.args ?? []).map((a) => String(a)),
    value: s.value ?? '0',
    operation: s.operation ?? 'CALL',
    data: s.data ?? '',
    context: contextFromSpec(s.context)
  }
}

export function fromTxSpec(world: World, tx: TxSpec): TxDraft {
  const base = stepFromSpec(tx)
  return {
    ...base,
    path: tx.path ?? 'owner',
    signers: tx.signers ? [...tx.signers] : defaultSigners(world),
    module: tx.module ?? world.book.find((e) => e.kind === 'module')?.name ?? 'AllowanceModule',
    safeTxGas: tx.safeTxGas ?? '0',
    gasPrice: tx.gasPrice ?? '0',
    batch: (tx.call?.batch ?? []).map(stepFromSpec),
    rootSource: 'draft',
    label: tx.label
  }
}

function argsFor(fn: string, args: string[]): (string | number | boolean)[] {
  const info = fnByName(fn)
  if (!info) return args
  return info.args.map((a, i) => {
    const v = args[i] ?? ''
    if (a.type === 'uint') return /^\d+$/.test(v.trim()) ? Number(v.trim()) : v
    if (a.type === 'bool') return v === 'true'
    return v.trim()
  })
}

function stepToSpec(s: StepDraft): SubTxSpec {
  const out: SubTxSpec = { to: s.to }
  if (s.value && s.value !== '0') out.value = s.value.trim()
  if (s.operation !== 'CALL') out.operation = s.operation
  if (s.mode === 'fn' && s.fn) out.call = { fn: s.fn, args: argsFor(s.fn, s.args) }
  if (s.mode === 'raw') out.data = s.data.trim() || '0x'
  const ctx = contextToSpec(s.context)
  if (ctx) out.context = ctx
  return out
}

export function toTxSpec(world: World, d: TxDraft, changeSet: RuleSpec[]): TxSpec {
  const step = stepToSpec(d)
  const tx: TxSpec = { ...step }
  if (d.label) tx.label = d.label
  if (d.path === 'module') {
    tx.path = 'module'
    tx.module = d.module
    delete tx.context
  } else {
    tx.signers = d.signers
  }
  if (tx.call) {
    if (d.fn === 'multiSend') tx.call.batch = d.batch.map(stepToSpec)
    if (CONFIG_FNS.includes(d.fn)) {
      tx.call.args = []
      const fromRoot = d.rootSource !== 'draft' ? world.roots[d.rootSource]?.configurations : undefined
      tx.call.configurations =
        (d.fn === 'applyConfiguration' || d.fn === 'invalidateRoot') && fromRoot ? fromRoot : changeSet
    }
  }
  if (d.safeTxGas.trim() && d.safeTxGas.trim() !== '0') tx.safeTxGas = d.safeTxGas.trim()
  if (d.gasPrice.trim() && d.gasPrice.trim() !== '0') tx.gasPrice = d.gasPrice.trim()
  return tx
}

/** A sub-transaction as a stand-alone tx, for previews of which rule checks it. */
export function stepAsTx(s: StepDraft): TxSpec {
  return { ...stepToSpec(s), context: undefined }
}
