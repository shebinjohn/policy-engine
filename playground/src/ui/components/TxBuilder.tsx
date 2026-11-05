/** "Build a transaction": who executes, target, action, arguments, call type, batch steps, extra proof, advanced. */
import type { ReactNode } from 'react'
import type { EncodedTx, FunctionInfo, RuleSpec, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import {
  CONFIG_FNS,
  MANAGE_FNS,
  describeCall,
  describeTableEntry,
  entity,
  fnByName,
  fnsFor,
  moduleNames,
  nameOf,
  ownerNames,
  ruleLine,
  sameAddress
} from '../lib/describe.ts'
import { EMPTY_CONTEXT, emptyStep, stepAsTx, toTxSpec } from '../lib/draft.ts'
import { pathSupport } from '../lib/content.ts'
import type { ContextDraft, StepDraft, TxDraft } from '../lib/draft.ts'
import { plural } from '../lib/format.ts'
import { guardState } from './Safe.tsx'
import { AddressSelect, Button, Callout, Checkbox, CopyText, Field, Glyph, Segmented, Select, TextInput, useEngineer } from './ui.tsx'

// ---------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------

const DEFAULT_ARGS: Record<string, string[]> = {
  transfer: ['Dave', '100'],
  approve: ['Dave', '1000'],
  transferFrom: ['Dave', 'Erin', '100'],
  withdraw: ['1'],
  setGuard: ['Zero'],
  setModuleGuard: ['Zero'],
  enableModule: ['RecoveryModule'],
  disableModule: ['AllowanceModule'],
  changeThreshold: ['3'],
  addOwnerWithThreshold: ['Dave', '2'],
  removeOwner: ['Carol', '2']
}

function defaultArgs(f: FunctionInfo | undefined): string[] {
  if (!f) return []
  const preset = DEFAULT_ARGS[f.name]
  return f.args.map((a, i) => {
    if (preset && preset[i] !== undefined) return preset[i]
    switch (a.type) {
      case 'address':
        return 'Dave'
      case 'amount':
        return '100'
      case 'uint':
        return '1'
      case 'bool':
        return 'true'
      default:
        return '0x' + '0'.repeat(64)
    }
  })
}

function withFn(step: StepDraft, fn: string): StepDraft {
  const info = fnByName(fn)
  const next: StepDraft = { ...step, mode: fn === 'none' ? 'none' : 'fn', fn: fn === 'none' ? '' : fn, args: defaultArgs(info) }
  if (fn === 'multiSend') next.operation = 'DELEGATECALL'
  else if (step.fn === 'multiSend') next.operation = 'CALL'
  return next
}

// ---------------------------------------------------------------------------------------------
// Preview: which rule will check this call?
// ---------------------------------------------------------------------------------------------

export interface Preview {
  tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  label: string
  text: string
}

function lookupPreview(world: World, tx: TxSpec, encoded: EncodedTx): Preview {
  const to = entity(world, tx.to)
  const op = tx.operation ?? 'CALL'
  if (to.kind === 'guard') {
    const managed = tx.call && MANAGE_FNS.includes(tx.call.fn) && op === 'CALL' && (!tx.value || Number(tx.value) === 0)
    if (managed) {
      return tx.path === 'module'
        ? { tone: 'danger', label: 'Blocked', text: 'Modules may not manage rules.' }
        : { tone: 'info', label: 'No rule needed', text: 'Managing rules is always allowed. New rules wait out the waiting period.' }
    }
    return { tone: 'danger', label: 'Blocked', text: 'The guard itself cannot be called, except to manage rules through the waiting period.' }
  }
  const res = engine.lookup(world, to.address, encoded.data, op)
  if ('error' in res) return { tone: 'danger', label: 'Blocked', text: res.error.message }
  if (!res.entry) return { tone: 'danger', label: 'No rule', text: 'No rule and no catch-all matches. Deny by default: it will be blocked.' }
  const w = describeTableEntry(world, res.entry)
  const support = pathSupport(res.entry.policy)
  const path = tx.path ?? 'owner'
  const refuses = (support.paths === 'owner-only' && path === 'module') || (support.paths === 'module-only' && path === 'owner')
  if (refuses) {
    return {
      tone: 'warning',
      label: res.usedFallback ? 'Catch-all rule' : 'Rule',
      text: `${ruleLine(w)}. ${w.policy} accepts ${support.label.toLowerCase()}, so it will refuse this ${path === 'module' ? 'module' : 'owner'} transaction.`
    }
  }
  return { tone: 'neutral', label: res.usedFallback ? 'Catch-all rule' : 'Rule', text: ruleLine(w) }
}

export function previewFor(world: World, tx: TxSpec): { preview: Preview; encoded?: EncodedTx; note?: Preview } {
  let encoded: EncodedTx
  try {
    encoded = engine.encode(world, tx)
  } catch (e) {
    return { preview: { tone: 'warning', label: 'Incomplete', text: `Fill in the fields to see which rule applies. ${(e as Error).message ?? ''}`.trim() } }
  }
  const g = guardState(world)
  if (tx.path === 'module') {
    const enabled = world.safe.modules.some((m) => sameAddress(world, m, tx.module ?? ''))
    if (!enabled) return { encoded, preview: { tone: 'danger', label: 'Refused by the Safe', text: `${nameOf(world, tx.module)} is not an enabled module.` } }
    if (!g.mod) return { encoded, preview: { tone: 'warning', label: 'Not checked', text: 'No module guard: modules bypass every rule.' } }
  } else if (!g.tx) {
    return { encoded, preview: { tone: 'warning', label: 'Not checked', text: 'No transaction guard: no rule is checked.' } }
  }
  try {
    return { encoded, preview: lookupPreview(world, tx, encoded) }
  } catch (e) {
    return { encoded, preview: { tone: 'warning', label: 'Unknown', text: (e as Error).message } }
  }
}

export function PreviewLine({ p, prefix = 'Checked by' }: { p: Preview; prefix?: string }) {
  return (
    <div className={`preview tone-${p.tone}`} role="status">
      <span className="preview-label">
        {prefix}: <strong>{p.label}</strong>
      </span>
      <span className="preview-text">{p.text}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

function ArgFields({ id, world, step, onChange }: { id: string; world: World; step: StepDraft; onChange: (s: StepDraft) => void }) {
  const info = fnByName(step.fn)
  if (!info || info.args.length === 0) return null
  const target = entity(world, step.to)
  const set = (i: number, v: string) => {
    const args = [...step.args]
    while (args.length < info.args.length) args.push('')
    args[i] = v
    onChange({ ...step, args })
  }
  return (
    <div className="arg-grid">
      {info.args.map((a, i) => {
        const fid = `${id}-arg-${i}`
        const v = step.args[i] ?? ''
        switch (a.type) {
          case 'address':
            return (
              <Field key={i} id={fid} label={a.label}>
                <AddressSelect id={fid} world={world} value={v} onChange={(x) => set(i, x)} />
              </Field>
            )
          case 'amount':
            return (
              <Field key={i} id={fid} label={a.label}>
                <TextInput id={fid} value={v} inputMode="decimal" suffix={target.symbol ?? target.label} onChange={(x) => set(i, x)} />
              </Field>
            )
          case 'bool':
            return <Checkbox key={i} id={fid} checked={v === 'true'} onChange={(x) => set(i, String(x))} label={a.label} />
          case 'bytes32':
            return (
              <Field key={i} id={fid} label={a.label}>
                <TextInput id={fid} mono value={v} onChange={(x) => set(i, x)} />
              </Field>
            )
          default:
            return (
              <Field key={i} id={fid} label={a.label}>
                <TextInput id={fid} value={v} inputMode="numeric" onChange={(x) => set(i, x)} />
              </Field>
            )
        }
      })}
    </div>
  )
}

function StepFields({
  id,
  world,
  step,
  onChange,
  inBatch = false,
  children
}: {
  id: string
  world: World
  step: StepDraft
  onChange: (s: StepDraft) => void
  inBatch?: boolean
  children?: ReactNode
}) {
  const engineer = useEngineer()
  const target = entity(world, step.to)
  const fns = fnsFor(target.kind).filter((f) => !(inBatch && f.name === 'multiSend'))
  const actionValue = step.mode === 'none' ? 'none' : step.mode === 'raw' ? 'raw' : step.fn
  const options = [
    ...fns.map((f) => ({ value: f.name, label: engineer ? `${f.label} · ${f.signature}` : f.label })),
    { value: 'none', label: 'Send ETH only (no data)' },
    ...(step.mode === 'raw' ? [{ value: 'raw', label: 'Raw calldata (see Advanced)' }] : [])
  ]
  const changeTarget = (to: string) => {
    const k = entity(world, to).kind
    const next = fnsFor(k).filter((f) => !(inBatch && f.name === 'multiSend'))
    let s: StepDraft = { ...step, to }
    if (step.mode === 'fn' && !next.some((f) => f.name === step.fn)) s = withFn(s, next[0]?.name ?? 'none')
    onChange(s)
  }
  return (
    <div className="step-fields">
      <div className="field-pair">
        <Field id={`${id}-to`} label="Target" hint={target.description}>
          <AddressSelect id={`${id}-to`} world={world} value={step.to} onChange={changeTarget} />
        </Field>
        <Field id={`${id}-fn`} label="Action">
          <Select id={`${id}-fn`} value={actionValue} options={options} onChange={(v) => (v === 'raw' ? null : onChange(withFn(step, v)))} />
        </Field>
      </div>
      {step.mode === 'fn' ? <ArgFields id={id} world={world} step={step} onChange={onChange} /> : null}
      <div className="field-pair">
        <Field label="Call type">
          <Segmented
            id={`${id}-op`}
            label="Call type"
            value={step.operation}
            onChange={(operation) => onChange({ ...step, operation })}
            options={[
              { value: 'CALL', label: 'Normal call' },
              { value: 'DELEGATECALL', label: 'Delegatecall' }
            ]}
          />
        </Field>
        <Field id={`${id}-value`} label="ETH sent along">
          <TextInput id={`${id}-value`} inputMode="decimal" value={step.value} suffix="ETH" onChange={(value) => onChange({ ...step, value })} />
        </Field>
      </div>
      {step.operation === 'DELEGATECALL' && !(step.fn === 'multiSend' && target.kind === 'multisend') ? (
        <Callout tone="warning" title="Delegatecall runs code as the Safe">
          The target's code runs inside the Safe and can change anything, including owners and guards.
          {inBatch ? ' MultiSend (call only) refuses delegatecall steps.' : ''}
        </Callout>
      ) : null}
      {children}
    </div>
  )
}

function ContextFields({ id, world, ctx, onChange, inBatch = false }: { id: string; world: World; ctx: ContextDraft; onChange: (c: ContextDraft) => void; inBatch?: boolean }) {
  const owners = ownerNames(world)
  const others = world.book.filter((e) => e.kind === 'person' && !owners.includes(e.name)).map((e) => e.name)
  const toggle = (name: string, on: boolean) => onChange({ ...ctx, signers: on ? [...ctx.signers, name] : ctx.signers.filter((s) => s !== name) })
  return (
    <div className="context-fields">
      <Segmented
        id={`${id}-kind`}
        label="Extra proof"
        size="sm"
        value={ctx.kind}
        onChange={(kind) => onChange({ ...ctx, kind, signers: kind === 'ownerSignatures' && ctx.signers.length === 0 ? [...owners] : ctx.signers })}
        options={[
          { value: 'none', label: 'None' },
          { value: 'cosignature', label: 'Co-signer' },
          { value: 'ownerSignatures', label: 'Extra owners' },
          { value: 'attestation', label: 'Safenet' }
        ]}
      />
      {ctx.kind === 'cosignature' ? (
        <div className="field-pair">
          <Field id={`${id}-signer`} label="Signed by">
            <AddressSelect id={`${id}-signer`} world={world} value={ctx.signer} onChange={(signer) => onChange({ ...ctx, signer })} />
          </Field>
          {inBatch ? (
            <Field label="What they signed">
              <Segmented
                id={`${id}-over`}
                label="What they signed"
                size="sm"
                value={ctx.over}
                onChange={(over) => onChange({ ...ctx, over })}
                options={[
                  { value: 'self', label: 'This step' },
                  { value: 'batch', label: 'The whole batch' }
                ]}
              />
            </Field>
          ) : null}
        </div>
      ) : null}
      {ctx.kind === 'ownerSignatures' ? (
        <div className="check-grid" role="group" aria-label="Owners who signed again">
          {[...owners, ...others].map((o) => (
            <Checkbox key={o} id={`${id}-sig-${o}`} checked={ctx.signers.includes(o)} onChange={(v) => toggle(o, v)} label={nameOf(world, o)} hint={owners.includes(o) ? undefined : 'not an owner'} />
          ))}
        </div>
      ) : null}
      {ctx.kind === 'attestation' ? (
        <div className="field-pair">
          <Field label="Signing key">
            <Segmented
              id={`${id}-key`}
              label="Signing key"
              size="sm"
              value={ctx.key}
              onChange={(key) => onChange({ ...ctx, key })}
              options={[
                { value: 'trusted', label: 'Safenet key' },
                { value: 'untrusted', label: 'Unknown key' }
              ]}
            />
          </Field>
          <Checkbox id={`${id}-valid`} checked={ctx.valid} onChange={(valid) => onChange({ ...ctx, valid })} label="Signature is valid" />
        </div>
      ) : null}
    </div>
  )
}

function BatchBuilder({ id, world, steps, onChange, ownerPath }: { id: string; world: World; steps: StepDraft[]; onChange: (s: StepDraft[]) => void; ownerPath: boolean }) {
  const set = (i: number, s: StepDraft) => onChange(steps.map((x, j) => (j === i ? s : x)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="batch">
      <div className="batch-head">
        <p className="field-label">Batch steps</p>
        <p className="muted small">Run in order, all or nothing. Each step is checked against its own rule.</p>
      </div>
      <ol className="batch-list">
        {steps.map((s, i) => {
          const { preview } = previewFor(world, stepAsTx(s))
          return (
            <li key={i} className="batch-step">
              <div className="batch-step-head">
                <span className="batch-step-index">Step {i + 1}</span>
                <span className="batch-step-title">{describeCall(world, stepAsTx(s))}</span>
                <span className="batch-step-tools">
                  <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
                    <Glyph kind="up" size={14} />
                    <span className="sr-only">Move step {i + 1} up</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="Move down">
                    <Glyph kind="down" size={14} />
                    <span className="sr-only">Move step {i + 1} down</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onChange(steps.filter((_, j) => j !== i))} title="Remove step">
                    <Glyph kind="close" size={14} />
                    <span className="sr-only">Remove step {i + 1}</span>
                  </Button>
                </span>
              </div>
              <StepFields id={`${id}-${i}`} world={world} step={s} onChange={(x) => set(i, x)} inBatch>
                {ownerPath ? (
                  <Field label="Extra proof for this step">
                    <ContextFields id={`${id}-${i}-ctx`} world={world} ctx={s.context} onChange={(context) => set(i, { ...s, context })} inBatch />
                  </Field>
                ) : null}
              </StepFields>
              <PreviewLine p={preview} prefix="This step is checked by" />
            </li>
          )
        })}
      </ol>
      <Button id={`${id}-add`} size="sm" onClick={() => onChange([...steps, emptyStep()])}>
        <Glyph kind="plus" size={14} />
        Add step
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

export function TxBuilder({
  world,
  draft,
  onChange,
  changeSet,
  onRun,
  examples,
  onExample
}: {
  world: World
  draft: TxDraft
  onChange: (d: TxDraft) => void
  changeSet: RuleSpec[]
  onRun: (tx: TxSpec) => void
  examples?: { id: string; label: string }[]
  onExample?: (id: string) => void
}) {
  const engineer = useEngineer()
  const owners = ownerNames(world)
  const nonOwners = world.book.filter((e) => e.kind === 'person' && !owners.includes(e.name)).map((e) => e.name)
  const modules = moduleNames(world)
  const spec = toTxSpec(world, draft, changeSet)
  const { preview, encoded } = previewFor(world, spec)
  const set = (patch: Partial<TxDraft>) => onChange({ ...draft, ...patch, label: undefined })
  const setStep = (s: StepDraft) => {
    let next: TxDraft = { ...draft, ...s, label: undefined }
    if (s.fn === 'multiSend' && s.mode === 'fn' && draft.batch.length === 0) next.batch = [emptyStep(), { ...emptyStep(), args: ['Erin', '50'] }]
    onChange(next)
  }
  const toggleSigner = (name: string, on: boolean) => set({ signers: on ? [...draft.signers, name] : draft.signers.filter((s) => s !== name) })
  const isConfig = draft.mode === 'fn' && CONFIG_FNS.includes(draft.fn)
  const usesRoot = isConfig && (draft.fn === 'applyConfiguration' || draft.fn === 'invalidateRoot')
  const roots = Object.keys(world.roots)
  const moduleOptions = world.book.filter((e) => e.kind === 'module')

  return (
    <form
      className="builder"
      onSubmit={(e) => {
        e.preventDefault()
        onRun(spec)
      }}
    >
      {examples && onExample ? (
        <div className="examples">
          <p className="field-label">Examples</p>
          <div className="example-chips">
            {examples.map((x) => (
              <button key={x.id} id={`example-${x.id}`} type="button" className="example-chip" onClick={() => onExample(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <fieldset className="builder-group">
        <legend className="overline">Who executes</legend>
        <Segmented
          id="tx-path"
          label="Who executes"
          value={draft.path}
          onChange={(path) => set({ path })}
          options={[
            { value: 'owner', label: 'Owners sign' },
            { value: 'module', label: 'A module' }
          ]}
        />
        {draft.path === 'owner' ? (
          <>
            <div className="check-grid" role="group" aria-label="Signers">
              {owners.map((o) => (
                <Checkbox key={o} id={`tx-signer-${o}`} checked={draft.signers.includes(o)} onChange={(v) => toggleSigner(o, v)} label={nameOf(world, o)} />
              ))}
            </div>
            <p className={`small ${draft.signers.filter((s) => owners.includes(s)).length >= world.safe.threshold ? 'muted' : 'text-warning'}`}>
              {world.safe.threshold} of {owners.length} needed · {plural(draft.signers.length, 'signature')} selected
            </p>
            {nonOwners.length > 0 ? (
              <details className="disclosure">
                <summary>Add a signature from someone who is not an owner</summary>
                <div className="check-grid">
                  {nonOwners.map((o) => (
                    <Checkbox key={o} id={`tx-signer-${o}`} checked={draft.signers.includes(o)} onChange={(v) => toggleSigner(o, v)} label={nameOf(world, o)} />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <Field id="tx-module" label="Module" hint={modules.some((m) => m === draft.module) ? 'Executes without owner signatures.' : 'This module is not enabled. The Safe will refuse it.'}>
            <Select
              id="tx-module"
              value={draft.module}
              onChange={(module) => set({ module })}
              options={moduleOptions.map((m) => ({ value: m.name, label: `${m.label || m.name}${modules.includes(m.name) ? '' : ' (not enabled)'}` }))}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="builder-group">
        <legend className="overline">What it does</legend>
        <StepFields id="tx" world={world} step={draft} onChange={setStep} />
        {isConfig ? (
          <div className="config-source">
            {usesRoot ? (
              <Field id="tx-root" label="Change set">
                <Select
                  id="tx-root"
                  value={draft.rootSource}
                  onChange={(rootSource) => set({ rootSource })}
                  options={[
                    ...roots.map((r, i) => ({ value: r, label: `Proposed change set ${i + 1} (${plural(world.roots[r].configurations.length, 'change')})` })),
                    { value: 'draft', label: `The change set you are drafting (${plural(changeSet.length, 'change')})` }
                  ]}
                />
              </Field>
            ) : (
              <p className="small">
                Uses the change set you are drafting in Your Safe: <strong>{plural(changeSet.length, 'change')}</strong>.
              </p>
            )}
          </div>
        ) : null}
        {draft.mode === 'fn' && draft.fn === 'multiSend' ? (
          <BatchBuilder id="batch" world={world} steps={draft.batch} onChange={(batch) => set({ batch })} ownerPath={draft.path === 'owner'} />
        ) : null}
      </fieldset>

      <fieldset className="builder-group">
        <legend className="overline">Extra proof for policies</legend>
        {draft.path === 'owner' ? (
          <>
            <p className="muted small">Travels with the owner signatures. Only policies that ask for it read it.</p>
            <ContextFields id="tx-ctx" world={world} ctx={draft.context} onChange={(context) => set({ context })} />
          </>
        ) : (
          <p className="muted small">Module transactions carry no extra proof. Co-signer, extra signature and Safenet policies refuse them.</p>
        )}
      </fieldset>

      <details className="disclosure builder-advanced">
        <summary>Advanced</summary>
        <div className="stack-sm">
          <Checkbox
            id="tx-raw-on"
            checked={draft.mode === 'raw'}
            onChange={(on) => set(on ? { mode: 'raw', data: draft.data || encoded?.data || '0x' } : { mode: draft.fn ? 'fn' : 'none' })}
            label="Send raw calldata instead of the action"
          />
          {draft.mode === 'raw' ? (
            <Field id="tx-raw" label="Calldata (hex)">
              <textarea id="tx-raw" className="input is-mono textarea" spellCheck={false} value={draft.data} onChange={(e) => set({ data: e.target.value })} rows={3} />
            </Field>
          ) : null}
          <div className="field-pair">
            <Field id="tx-safetxgas" label="safeTxGas" hint="The guard requires 0.">
              <TextInput id="tx-safetxgas" inputMode="numeric" value={draft.safeTxGas} onChange={(safeTxGas) => set({ safeTxGas })} />
            </Field>
            <Field id="tx-gasprice" label="gasPrice" hint="The guard requires 0.">
              <TextInput id="tx-gasprice" inputMode="numeric" value={draft.gasPrice} onChange={(gasPrice) => set({ gasPrice })} />
            </Field>
          </div>
        </div>
      </details>

      <div className="builder-run">
        <PreviewLine p={preview} prefix="This call will be checked by" />
        {engineer && encoded ? (
          <div className="stack-sm">
            <p className="tech">access selector {encoded.accessSelector}</p>
            <CopyText text={encoded.data || '0x'} label="Copy calldata" />
          </div>
        ) : null}
        <div className="run-row">
          <p className="run-summary">{describeCall(world, spec)}</p>
          <Button id="tx-run" type="submit" variant="primary" size="lg">
            Run transaction
          </Button>
        </div>
      </div>
    </form>
  )
}

export { EMPTY_CONTEXT }
