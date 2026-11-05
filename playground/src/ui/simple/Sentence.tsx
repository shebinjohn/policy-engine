/**
 * "Will this pass?" as a sentence: [The owners] want to [send tokens] [500] [USDC] to [Mallory].
 * Every verb the simple layer knows, batches as one sentence row per step, and a folded
 * "More options" (co-signed, all owners sign, call type). Produces a TxSpec.
 */
import type { ContextSpec, OperationName, SubTxSpec, TxSpec, World } from '../../engine/types.ts'
import { ownerNames } from '../lib/describe.ts'
import { Button, Glyph, Segmented } from '../components/ui.tsx'

export type Verb = 'send' | 'sendEth' | 'approve' | 'wrap' | 'addOwner' | 'enableModule' | 'guardOff' | 'batch' | 'unknown'
export type StepVerb = Exclude<Verb, 'batch' | 'unknown'>

export interface StepState {
  verb: StepVerb
  amount: string
  token: string
  person: string
  module: string
}

export interface AskState extends Omit<StepState, 'verb'> {
  who: 'owners' | 'AllowanceModule' | 'RecoveryModule'
  verb: Verb
  extra: 'none' | 'cosigned' | 'allOwners'
  callType: OperationName
  steps: StepState[]
}

export const VERBS: { value: Verb; label: string }[] = [
  { value: 'send', label: 'send tokens' },
  { value: 'sendEth', label: 'send ETH' },
  { value: 'approve', label: 'let someone spend' },
  { value: 'wrap', label: 'wrap ETH' },
  { value: 'addOwner', label: 'add an owner' },
  { value: 'enableModule', label: 'switch on a module' },
  { value: 'guardOff', label: 'turn off the guard' },
  { value: 'batch', label: 'run a batch' },
  { value: 'unknown', label: 'run unknown code' }
]

const PEOPLE = ['Dave', 'Erin', 'Mallory', 'Alice', 'Bob', 'Carol']
const TOKENS = [
  { value: 'USDC', label: 'USDC' },
  { value: 'SAFE', label: 'SAFE' },
  { value: 'WETH', label: 'WETH' }
]
const MODULES = [
  { value: 'RecoveryModule', label: 'Recovery Module' },
  { value: 'AllowanceModule', label: 'Allowance Module' }
]

export function defaultAsk(): AskState {
  return {
    who: 'owners',
    verb: 'send',
    amount: '500',
    token: 'USDC',
    person: 'Mallory',
    module: 'RecoveryModule',
    extra: 'none',
    callType: 'CALL',
    steps: [
      { verb: 'send', amount: '500', token: 'USDC', person: 'Dave', module: 'RecoveryModule' },
      { verb: 'send', amount: '300', token: 'USDC', person: 'Erin', module: 'RecoveryModule' }
    ]
  }
}

function stepTx(world: World, s: StepState): SubTxSpec {
  const amount = s.amount.trim() || '0'
  switch (s.verb) {
    case 'send':
      return { to: s.token, call: { fn: 'transfer', args: [s.person, amount] } }
    case 'sendEth':
      return { to: s.person, value: amount }
    case 'approve':
      return { to: s.token, call: { fn: 'approve', args: [s.person, amount] } }
    case 'wrap':
      return { to: 'WETH', value: amount, call: { fn: 'deposit' } }
    case 'addOwner':
      return { to: 'Safe', call: { fn: 'addOwnerWithThreshold', args: [s.person, world.safe.threshold] } }
    case 'enableModule':
      return { to: 'Safe', call: { fn: 'enableModule', args: [s.module] } }
    case 'guardOff':
      return { to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] } }
  }
}

/** The transaction the sentence describes. */
export function askToTx(world: World, a: AskState): TxSpec {
  const owners = ownerNames(world)
  const context = (): ContextSpec | undefined =>
    a.extra === 'cosigned' ? { type: 'cosignature', signer: 'CoSigner' } : a.extra === 'allOwners' ? { type: 'ownerSignatures', signers: owners } : undefined
  let tx: TxSpec
  if (a.verb === 'batch') {
    tx = {
      to: 'MultiSend',
      operation: 'DELEGATECALL',
      call: { fn: 'multiSend', batch: a.steps.map((s) => ({ ...stepTx(world, s), ...(context() ? { context: context() } : {}) })) }
    }
  } else if (a.verb === 'unknown') {
    tx = { to: 'MysteryContract', operation: 'DELEGATECALL' }
    if (context()) tx.context = context()
  } else {
    tx = { ...stepTx(world, { ...a, verb: a.verb }) }
    if (a.callType === 'DELEGATECALL') tx.operation = 'DELEGATECALL'
    if (context()) tx.context = context()
  }
  if (a.who !== 'owners') {
    tx.path = 'module'
    tx.module = a.who
    delete tx.context
    if (tx.call?.batch) tx.call.batch = tx.call.batch.map(({ context: _c, ...s }) => s)
  } else if (a.extra === 'allOwners') {
    tx.signers = owners
  }
  return tx
}

/** An inline select that reads as part of the sentence. */
function Pick({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select id={id} aria-label={label} className="pick" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Amount({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  return <input id={id} aria-label={label} className="pick pick-amount" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
}

/** The words after the verb, for one action. */
function Slots({ id, s, set }: { id: string; s: StepState; set: (p: Partial<StepState>) => void }) {
  const person = (label: string) => <Pick id={`${id}-person`} label={label} value={s.person} options={PEOPLE.map((p) => ({ value: p, label: p }))} onChange={(person) => set({ person })} />
  switch (s.verb) {
    case 'send':
      return (
        <>
          <Amount id={`${id}-amount`} label="Amount" value={s.amount} onChange={(amount) => set({ amount })} />
          <Pick id={`${id}-token`} label="Token" value={s.token} options={TOKENS} onChange={(token) => set({ token })} />
          <span>to</span>
          {person('Recipient')}
        </>
      )
    case 'sendEth':
      return (
        <>
          <Amount id={`${id}-amount`} label="Amount of ETH" value={s.amount} onChange={(amount) => set({ amount })} />
          <span>ETH to</span>
          {person('Recipient')}
        </>
      )
    case 'approve':
      return (
        <>
          {person('Who may spend')}
          <span>spend</span>
          <Amount id={`${id}-amount`} label="Amount" value={s.amount} onChange={(amount) => set({ amount })} />
          <Pick id={`${id}-token`} label="Token" value={s.token} options={TOKENS} onChange={(token) => set({ token })} />
        </>
      )
    case 'wrap':
      return (
        <>
          <Amount id={`${id}-amount`} label="Amount of ETH" value={s.amount} onChange={(amount) => set({ amount })} />
          <span>ETH</span>
        </>
      )
    case 'addOwner':
      return (
        <>
          {person('New owner')}
          <span>as an owner</span>
        </>
      )
    case 'enableModule':
      return <Pick id={`${id}-module`} label="Module" value={s.module} options={MODULES} onChange={(module) => set({ module })} />
    default:
      return null
  }
}

export function Sentence({
  value,
  onChange,
  idPrefix,
  compact = false
}: {
  value: AskState
  onChange: (a: AskState) => void
  idPrefix: string
  /** Home: no batch steps editor, no More options. */
  compact?: boolean
}) {
  const a = value
  const set = (p: Partial<AskState>) => onChange({ ...a, ...p })
  const verbs = compact ? VERBS.filter((v) => v.value !== 'batch') : VERBS
  const setStep = (i: number, p: Partial<StepState>) => set({ steps: a.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  return (
    <div className="sentence-wrap">
      <p className="sentence">
        <Pick
          id={`${idPrefix}-who`}
          label="Who sends it"
          value={a.who}
          onChange={(who) => set({ who: who as AskState['who'] })}
          options={[
            { value: 'owners', label: 'The owners' },
            { value: 'AllowanceModule', label: 'The Allowance Module' },
            { value: 'RecoveryModule', label: 'The Recovery Module' }
          ]}
        />
        <span>{a.who === 'owners' ? 'want to' : 'wants to'}</span>
        <Pick id={`${idPrefix}-verb`} label="Action" value={a.verb} options={verbs} onChange={(verb) => set({ verb: verb as Verb })} />
        {a.verb !== 'batch' && a.verb !== 'unknown' ? <Slots id={idPrefix} s={{ ...a, verb: a.verb }} set={(p) => set(p)} /> : null}
        {a.verb === 'batch' ? <span>of {a.steps.length} steps:</span> : null}
      </p>
      {a.verb === 'batch' && !compact ? (
        <ol className="batch-sentences">
          {a.steps.map((s, i) => (
            <li key={i} className="batch-sentence">
              <span className="batch-n">Step {i + 1}</span>
              <span className="sentence is-step">
                <Pick
                  id={`${idPrefix}-step-${i}-verb`}
                  label={`Step ${i + 1} action`}
                  value={s.verb}
                  options={VERBS.filter((v) => v.value !== 'batch' && v.value !== 'unknown')}
                  onChange={(verb) => setStep(i, { verb: verb as StepVerb })}
                />
                <Slots id={`${idPrefix}-step-${i}`} s={s} set={(p) => setStep(i, p)} />
              </span>
              <Button size="sm" variant="ghost" onClick={() => set({ steps: a.steps.filter((_, j) => j !== i) })} disabled={a.steps.length <= 1} title={`Remove step ${i + 1}`}>
                <Glyph kind="close" size={14} />
                <span className="sr-only">Remove step {i + 1}</span>
              </Button>
            </li>
          ))}
          <li>
            <Button id={`${idPrefix}-add-step`} size="sm" onClick={() => set({ steps: [...a.steps, { verb: 'sendEth', amount: '1', token: 'USDC', person: 'Dave', module: 'RecoveryModule' }] })}>
              <Glyph kind="plus" size={14} />
              Add a step
            </Button>
          </li>
        </ol>
      ) : null}
      {compact ? null : (
        <details className="disclosure more-options" id={`${idPrefix}-more`}>
          <summary>More options</summary>
          <div className="more-grid">
            <div className="row-line">
              <span className="row-label">Also</span>
              <Segmented
                id={`${idPrefix}-extra`}
                label="Extra approval"
                size="sm"
                value={a.who === 'owners' ? a.extra : 'none'}
                onChange={(extra) => set({ extra })}
                options={[
                  { value: 'none', label: 'Nothing extra' },
                  { value: 'cosigned', label: 'Co-signed' },
                  { value: 'allOwners', label: 'All owners sign' }
                ]}
              />
            </div>
            {a.verb !== 'batch' && a.verb !== 'unknown' ? (
              <div className="row-line">
                <span className="row-label">Call type</span>
                <Segmented
                  id={`${idPrefix}-calltype`}
                  label="Call type"
                  size="sm"
                  value={a.callType}
                  onChange={(callType) => set({ callType })}
                  options={[
                    { value: 'CALL', label: 'Normal' },
                    { value: 'DELEGATECALL', label: 'Delegatecall' }
                  ]}
                />
              </div>
            ) : null}
            {a.who !== 'owners' ? <p className="muted small">A module sends without the owners, so it cannot be co-signed.</p> : null}
          </div>
        </details>
      )}
    </div>
  )
}
