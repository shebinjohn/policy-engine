/** Sandbox: Your Safe (left), Build a transaction (center), What happened (right). */
import { useMemo, useState } from 'react'
import type { RuleSpec, SimResult, TableEntry, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { describeCall, ruleSpecFromEntry, sameRuleKey } from '../lib/describe.ts'
import { shortReason } from '../lib/content.ts'
import { fromTxSpec, toTxSpec } from '../lib/draft.ts'
import type { TxDraft } from '../lib/draft.ts'
import { plural } from '../lib/format.ts'
import { EXAMPLES, PRESETS } from '../lib/presets.ts'
import type { Preset } from '../lib/presets.ts'
import { ResultView } from '../components/Result.tsx'
import { RuleEditor } from '../components/RuleEditor.tsx'
import {
  Activity,
  BalancesSection,
  Clock,
  GuardsSection,
  ModulesSection,
  OwnersSection,
  PendingChanges,
  RuleSpecList,
  RuleTable,
  SafeHeader,
  Section,
  guardState
} from '../components/Safe.tsx'
import type { LogEntry } from '../components/Safe.tsx'
import { BATCH_RULE, TxBuilder, hasBatchRule } from '../components/TxBuilder.tsx'
import { Button, Callout, Glyph, Pill, Segmented, Select } from '../components/ui.tsx'

interface Run {
  result: SimResult
  tx: TxSpec
  before: World
  n: number
}

interface State {
  preset: Preset
  world: World
  draft: TxDraft
  changeSet: RuleSpec[]
  run: Run | null
  setupError?: string
  example: boolean
  log: LogEntry[]
}

function logEntry(world: World, tx: TxSpec, result: SimResult): LogEntry {
  return { at: world.now, label: tx.label ?? describeCall(world, tx), ok: result.ok, why: result.ok ? '' : shortReason(result.error) }
}

function boot(preset: Preset): State {
  let world: World
  try {
    world = engine.createWorld(preset.setup)
  } catch (e) {
    world = engine.createWorld({})
    return { preset, world, draft: fromTxSpec(world, preset.tx), changeSet: [], run: null, setupError: (e as Error).message, example: false, log: [] }
  }
  const draft = fromTxSpec(world, preset.tx)
  const tx = toTxSpec(world, draft, [])
  let run: Run | null = null
  const log: LogEntry[] = []
  try {
    const result = engine.simulate(world, tx)
    run = { result, tx, before: world, n: 0 }
    log.push(logEntry(world, tx, result))
    world = result.world
  } catch {
    run = null
  }
  return { preset, world, draft, changeSet: [], run, example: preset.id === 'example', log }
}

type Tab = 'safe' | 'build' | 'result'

/** Does this transaction propose or set exactly these drafted rules, at the top or as a batch step? */
function sendsRules(tx: TxSpec, rules: RuleSpec[]): boolean {
  if (rules.length === 0) return false
  const calls = [tx.call, ...(tx.call?.batch ?? []).map((b) => b.call)]
  return calls.some((c) => {
    if (!c || (c.fn !== 'requestConfiguration' && c.fn !== 'configureImmediately')) return false
    const sent = new Set((c.configurations ?? []).map((r) => JSON.stringify(r)))
    return rules.every((r) => sent.has(JSON.stringify(r)))
  })
}

function hardenTx(rules: RuleSpec[], signers: string[] | undefined): TxSpec {
  return {
    label: 'Harden in one batch',
    to: 'MultiSend',
    operation: 'DELEGATECALL',
    signers,
    call: {
      fn: 'multiSend',
      batch: [
        { to: 'PolicyGuard', call: { fn: 'configureImmediately', configurations: structuredClone(rules) } },
        { to: 'Safe', call: { fn: 'setModuleGuard', args: ['PolicyGuard'] } },
        { to: 'Safe', call: { fn: 'setGuard', args: ['PolicyGuard'] } }
      ]
    }
  }
}

function proposeBatchTx(rules: RuleSpec[], signers: string[] | undefined): TxSpec {
  return {
    label: 'Propose a change in a batch',
    to: 'MultiSend',
    operation: 'DELEGATECALL',
    signers,
    call: { fn: 'multiSend', batch: [{ to: 'PolicyGuard', call: { fn: 'requestConfiguration', configurations: structuredClone(rules) } }] }
  }
}

function removeGuardsTx(signers: string[] | undefined): TxSpec {
  return {
    label: 'Remove both guards in one batch',
    to: 'MultiSend',
    operation: 'DELEGATECALL',
    signers,
    call: {
      fn: 'multiSend',
      batch: [
        { to: 'Safe', call: { fn: 'setGuard', args: ['Zero'] } },
        { to: 'Safe', call: { fn: 'setModuleGuard', args: ['Zero'] } }
      ]
    }
  }
}

const REMOVAL_RULES: RuleSpec[] = [
  { target: 'Safe', selector: 'setGuard', operation: 'CALL', policy: 'AllowPolicy', note: 'Lets the owners remove the transaction guard' },
  { target: 'Safe', selector: 'setModuleGuard', operation: 'CALL', policy: 'AllowPolicy', note: 'Lets the owners remove the module guard' }
]

/** After a run, bring the verdict into view if it is above the fold or behind a tab. */
function revealResult() {
  requestAnimationFrame(() => {
    const el = document.getElementById('panel-result')
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (top < 60 || top > window.innerHeight * 0.6) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    }
  })
}

/** A starting point handed over from a scenario step: its world and transaction. */
export interface Seed {
  id: number
  world: World
  tx: TxSpec
  from: string
}

function fromSeed(seed: Seed): State {
  const preset: Preset = {
    id: 'seed',
    label: `From the scenario ${seed.from}`,
    blurb: 'The Safe as it was before this step, with its transaction ready to run. Change anything and run it.',
    setup: {},
    tx: seed.tx
  }
  return { preset, world: seed.world, draft: fromTxSpec(seed.world, seed.tx), changeSet: [], run: null, example: false, log: [] }
}

export function Sandbox({ seed }: { seed?: Seed | null }) {
  const [state, setState] = useState<State>(() => (seed ? fromSeed(seed) : boot(PRESETS[0])))
  const [tab, setTab] = useState<Tab>(seed ? 'build' : 'result')
  const [editor, setEditor] = useState<{ initial?: RuleSpec; title: string } | null>(null)
  const [resetChoice, setResetChoice] = useState(PRESETS[0].id)
  const [confirmReset, setConfirmReset] = useState(false)
  const { world, draft, changeSet, run } = state
  const g = guardState(world)

  const runTx = (tx: TxSpec, after?: (r: SimResult) => Partial<State>) => {
    let result: SimResult
    try {
      result = engine.simulate(world, tx)
    } catch (e) {
      setState((s) => ({ ...s, setupError: `The simulator could not run this: ${(e as Error).message}` }))
      return
    }
    setState((s) => ({
      ...s,
      world: result.world,
      run: { result, tx, before: s.world, n: (s.run?.n ?? 0) + 1 },
      log: [...s.log, logEntry(s.world, tx, result)],
      example: false,
      setupError: undefined,
      // A change set that went out (alone or as a batch step) is no longer a draft.
      changeSet: result.ok && sendsRules(tx, s.changeSet) ? [] : s.changeSet,
      ...(after ? after(result) : {})
    }))
    setTab('result')
    revealResult()
  }

  const managementTx = (fn: string, configurations: RuleSpec[], label: string): TxSpec => ({
    label,
    to: 'PolicyGuard',
    call: { fn, configurations },
    signers: draft.path === 'owner' && draft.signers.length ? draft.signers : undefined
  })

  const addToChangeSet = (rule: RuleSpec) => {
    setState((s) => ({ ...s, changeSet: [...s.changeSet.filter((r) => !sameRuleKey(s.world, r, rule)), rule] }))
    setEditor(null)
  }
  const removeEntry = (e: TableEntry) => addToChangeSet(ruleSpecFromEntry(world, e, null))
  const editEntry = (e: TableEntry) => setEditor({ initial: ruleSpecFromEntry(world, e), title: 'Edit rule' })
  const staged = (e: TableEntry) => changeSet.some((r) => sameRuleKey(world, r, ruleSpecFromEntry(world, e)))

  const propose = () =>
    runTx(managementTx('requestConfiguration', changeSet, `Propose ${plural(changeSet.length, 'change')}`))
  const setNow = () =>
    runTx(managementTx('configureImmediately', changeSet, `Set ${plural(changeSet.length, 'rule')} immediately`))
  const apply = (root: string) => runTx(managementTx('applyConfiguration', world.roots[root].configurations, 'Apply change set'))
  const cancel = (root: string) => runTx(managementTx('invalidateRoot', world.roots[root].configurations, 'Cancel change set'))

  const reset = () => {
    const preset = PRESETS.find((p) => p.id === resetChoice) ?? PRESETS[0]
    setState(boot(preset))
    setEditor(null)
    setConfirmReset(false)
  }

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((x) => x.id === id)
    if (ex) setState((s) => ({ ...s, draft: fromTxSpec(s.world, ex.tx) }))
    setTab('build')
  }

  const examples = useMemo(() => EXAMPLES.map((e) => ({ id: e.id, label: e.label })), [])

  const signersNow = draft.path === 'owner' && draft.signers.length ? draft.signers : undefined
  const draftTx = (tx: TxSpec) => {
    setState((s) => ({ ...s, draft: fromTxSpec(s.world, tx) }))
    setTab('build')
    requestAnimationFrame(() => document.getElementById('panel-build')?.scrollIntoView({ block: 'start' }))
  }
  const tableHasBatchRule = Object.values(world.table).some((e) => e.policy === 'MultiSendPolicy')
  const addRules = (rules: RuleSpec[]) =>
    setState((s) => ({ ...s, changeSet: [...s.changeSet.filter((r) => !rules.some((x) => sameRuleKey(s.world, r, x))), ...rules] }))

  const guardActions = g.none ? (
    <div className="helper">
      <p className="helper-title">Harden in one batch</p>
      <p className="small">
        Drafts one batch: set your drafted rules, then install the module guard and the transaction guard. Review it in the builder, then run it.
      </p>
      {changeSet.length === 0 ? (
        <p className="small text-warning">No rules drafted. Hardened with no rules, the Safe blocks every transaction.</p>
      ) : null}
      {!hasBatchRule(changeSet) ? (
        <p className="small">
          Your drafted rules have no rule for batches.{' '}
          <button type="button" className="link-button" id="harden-add-batch-rule" onClick={() => addRules([{ ...BATCH_RULE }])}>
            Add the Batch Checker rule
          </button>
        </p>
      ) : null}
      <div className="button-row">
        <Button id="harden-draft" variant="primary" size="sm" onClick={() => draftTx(hardenTx(changeSet, signersNow))}>
          Harden in one batch
        </Button>
      </div>
    </div>
  ) : (
    <details className="disclosure helper">
      <summary>Remove the guards</summary>
      <ol className="helper-steps small">
        <li>
          Allow it: add rules that let the owners call setGuard and setModuleGuard, propose them, wait, apply.{' '}
          <button type="button" className="link-button" id="removal-rules" onClick={() => addRules(REMOVAL_RULES)}>
            Add these rules to the change set
          </button>
        </li>
        <li>
          In a later transaction, remove both guards in one batch.{' '}
          <button type="button" className="link-button" id="removal-batch" onClick={() => draftTx(removeGuardsTx(signersNow))}>
            Draft the removal batch
          </button>
          {!tableHasBatchRule ? <span className="muted"> The Safe has no rule for batches yet, so add one too.</span> : null}
        </li>
      </ol>
    </details>
  )

  const safePanel = (
    <div className="panel" id="panel-safe">
      <div className="panel-head">
        <h2 className="panel-title">Your Safe</h2>
        {state.example ? <Pill tone="info">Example</Pill> : <Pill tone="neutral">{state.preset.label}</Pill>}
      </div>
      <SafeHeader world={world} />
      <OwnersSection world={world} />
      <GuardsSection world={world} actions={guardActions} />
      <ModulesSection world={world} />
      <BalancesSection world={world} />
      <Section
        title="Rules"
        id="sec-rules"
        aside={
          <Button id="rule-add" size="sm" onClick={() => setEditor({ title: 'New rule' })}>
            <Glyph kind="plus" size={14} />
            Add rule
          </Button>
        }
      >
        <RuleTable world={world} onEdit={editEntry} onRemove={removeEntry} staged={staged} />
        {editor ? (
          <RuleEditor
            key={JSON.stringify(editor.initial ?? {})}
            world={world}
            initial={editor.initial}
            idPrefix="sandbox-rule"
            title={editor.title}
            saveLabel="Add to change set"
            onSave={addToChangeSet}
            onCancel={() => setEditor(null)}
          />
        ) : null}
      </Section>
      <Section title="Change set" id="sec-changes">
        {changeSet.length === 0 ? (
          <p className="muted small">No changes drafted. Add, edit or remove a rule to start one.</p>
        ) : (
          <div className="draft">
            <RuleSpecList
              world={world}
              rules={changeSet}
              actions={(_, i) => (
                <Button size="sm" variant="ghost" onClick={() => setState((s) => ({ ...s, changeSet: s.changeSet.filter((__, j) => j !== i) }))}>
                  Drop
                </Button>
              )}
            />
            <div className="button-row">
              {g.none ? null : (
                <>
                  <Button id="changes-propose" variant="primary" onClick={propose}>
                    Propose change
                  </Button>
                  <Button id="changes-propose-batch" onClick={() => draftTx(proposeBatchTx(changeSet, signersNow))}>
                    Propose in a batch
                  </Button>
                </>
              )}
              {g.none ? (
                <>
                  <Button id="changes-now" variant="primary" onClick={setNow}>
                    Set now
                  </Button>
                  <Button id="changes-harden" onClick={() => draftTx(hardenTx(changeSet, signersNow))}>
                    Set and harden in one batch
                  </Button>
                </>
              ) : null}
              <Button id="changes-clear" variant="ghost" onClick={() => setState((s) => ({ ...s, changeSet: [] }))}>
                Clear
              </Button>
            </div>
            <p className="muted small">
              {g.none
                ? 'No guard yet: rules can be set at once. Once a guard is on, every change waits out the waiting period.'
                : 'Proposing starts the waiting period. Apply it once it is ready. In a batch it can go out with other steps.'}
            </p>
          </div>
        )}
      </Section>
      <Section title="Waiting changes" id="sec-pending">
        <PendingChanges world={world} onApply={apply} onCancel={cancel} />
      </Section>
      <Section title="Clock" id="sec-clock">
        <Clock world={world} onAdvance={(s) => setState((st) => ({ ...st, world: engine.advanceTime(st.world, s) }))} />
      </Section>
      <Section title="Activity" id="sec-activity">
        <Activity log={state.log} />
      </Section>
      <Section title="Reset Safe" id="sec-reset">
        <div className="reset">
          <Select id="reset-preset" ariaLabel="Preset" value={resetChoice} onChange={setResetChoice} options={PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
          <p className="muted small">{PRESETS.find((p) => p.id === resetChoice)?.blurb}</p>
          {confirmReset ? (
            <div className="confirm" role="alertdialog" aria-label="Confirm reset">
              <p className="small">This replaces your Safe, its rules and its history.</p>
              <div className="button-row">
                <Button id="reset-confirm" variant="danger" size="sm" onClick={reset}>
                  Reset Safe
                </Button>
                <Button id="reset-cancel" size="sm" onClick={() => setConfirmReset(false)}>
                  Keep my Safe
                </Button>
              </div>
            </div>
          ) : (
            <Button id="reset-start" size="sm" onClick={() => setConfirmReset(true)}>
              Reset…
            </Button>
          )}
        </div>
      </Section>
    </div>
  )

  const buildPanel = (
    <div className="panel" id="panel-build">
      <div className="panel-head">
        <h2 className="panel-title">Build a transaction</h2>
      </div>
      <TxBuilder
        world={world}
        draft={draft}
        onChange={(d) => setState((s) => ({ ...s, draft: d }))}
        changeSet={changeSet}
        onRun={(tx) => runTx(tx)}
        examples={examples}
        onExample={loadExample}
      />
    </div>
  )

  const resultPanel = (
    <div className="panel" id="panel-result">
      <div className="panel-head">
        <h2 className="panel-title">What happened</h2>
        {state.example && run ? <Pill tone="info">Example run</Pill> : null}
      </div>
      {state.setupError ? <Callout tone="danger" title="Something went wrong">{state.setupError}</Callout> : null}
      {run ? (
        <ResultView key={run.n} result={run.result} tx={run.tx} world={run.before} animate={run.n > 0} />
      ) : (
        <p className="muted">Run a transaction to see whether it passes and why.</p>
      )}
    </div>
  )

  return (
    <div className="sandbox">
      <div className="intro-strip">
        {state.example ? (
          <>
            <Pill tone="info">Example</Pill>
            <p>
              A hardened treasury with five rules. Its first transaction already ran: see why it was blocked. Change anything and run it again, or
              reset the Safe to another starting point.
            </p>
          </>
        ) : (
          <>
            <Pill tone="neutral">{state.preset.label}</Pill>
            <p>{state.preset.blurb}</p>
          </>
        )}
      </div>
      <div className="sandbox-tabs">
        <Segmented
          id="sandbox-tab"
          label="Sandbox section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'safe', label: 'Your Safe' },
            { value: 'build', label: 'Build' },
            { value: 'result', label: 'Result' }
          ]}
        />
      </div>
      <div className={`sandbox-grid show-${tab}`}>
        <div className="col col-safe">{safePanel}</div>
        <div className="col col-build">{buildPanel}</div>
        <div className="col col-result">{resultPanel}</div>
      </div>
    </div>
  )
}
