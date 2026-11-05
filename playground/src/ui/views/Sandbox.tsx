/** Sandbox: Your Safe (left), Build a transaction (center), What happened (right). */
import { useEffect, useMemo, useState } from 'react'
import type { RuleSpec, SimResult, TableEntry, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { describeCall, ruleSpecFromEntry, sameRuleKey } from '../lib/describe.ts'
import { shortReason } from '../lib/content.ts'
import { fromTxSpec, toTxSpec } from '../lib/draft.ts'
import type { TxDraft } from '../lib/draft.ts'
import { formatDuration, formatShortTime, plural } from '../lib/format.ts'
import { EXAMPLES, PRESETS } from '../lib/presets.ts'
import type { Preset } from '../lib/presets.ts'
import { decodeShare, encodeShare, worldToSetup } from '../lib/share.ts'
import { keysOf } from '../lib/sharpEdges.ts'
import { load, save } from '../lib/storage.ts'
import { SCENARIOS } from '../generated/content.ts'
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
  guardState,
  rootPhase,
  ruleDomId
} from '../components/Safe.tsx'
import type { LogEntry } from '../components/Safe.tsx'
import { BATCH_RULE, TxBuilder, hasBatchRule } from '../components/TxBuilder.tsx'
import { Button, Callout, CopyText, Field, Glyph, Pill, Select, Tabs, TextInput, tabPanelProps, useMedia } from '../components/ui.tsx'

interface Run {
  result: SimResult
  tx: TxSpec
  before: World
  n: number
  /** Access keys with a rule in any earlier state of this session, for the removed-rule sharp edge. */
  seen: Set<string>
}

interface State {
  preset: Preset
  world: World
  draft: TxDraft
  changeSet: RuleSpec[]
  run: Run | null
  prev: Run | null
  setupError?: string
  notice?: string
  example: boolean
  log: LogEntry[]
  seen: Set<string>
}

function logEntry(world: World, tx: TxSpec, result: SimResult): LogEntry {
  return { at: world.now, label: tx.label ?? describeCall(world, tx), ok: result.ok, why: result.ok ? '' : shortReason(result.error) }
}

/** Start from a world, optionally running its transaction once so the page opens on a verdict. */
function startFrom(preset: Preset, world: World, tx: TxSpec, runIt: boolean, example = false): State {
  const draft = fromTxSpec(world, tx)
  const seen = keysOf([world])
  const base: State = { preset, world, draft, changeSet: [], run: null, prev: null, example, log: [], seen }
  if (!runIt) return base
  try {
    const spec = toTxSpec(world, draft, [])
    const result = engine.simulate(world, spec)
    return { ...base, world: result.world, run: { result, tx: spec, before: world, n: 0, seen }, log: [logEntry(world, spec, result)], seen: keysOf([world, result.world]) }
  } catch {
    return base
  }
}

function boot(preset: Preset): State {
  try {
    return startFrom(preset, engine.createWorld(preset.setup), preset.tx, true, preset.id === 'example')
  } catch (e) {
    const world = engine.createWorld({})
    return { ...startFrom(preset, world, preset.tx, false), setupError: (e as Error).message }
  }
}

/** A Safe and transaction rebuilt from a setup code. */
function fromCode(code: string): State {
  try {
    const shared = decodeShare(code)
    const world = engine.createWorld(shared.setup)
    const preset: Preset = {
      id: 'code',
      label: 'From a setup code',
      blurb: 'A shared Safe and its transaction, rebuilt from a setup code. Its waiting changes, clock and used signatures were not carried over.',
      setup: shared.setup,
      tx: shared.tx
    }
    return startFrom(preset, world, shared.tx, true)
  } catch (e) {
    return { ...boot(PRESETS[0]), notice: `This setup code could not be read. ${(e as Error).message}` }
  }
}

/** A starting point handed over from elsewhere: a scenario step, a challenge, or a shared code. */
export type Seed =
  | { id: number; kind: 'world'; world: World; tx: TxSpec; from: string; blurb: string; run?: boolean }
  | { id: number; kind: 'code'; code: string }

function fromSeed(seed: Seed): State {
  if (seed.kind === 'code') return fromCode(seed.code)
  const preset: Preset = { id: 'seed', label: seed.from, blurb: seed.blurb, setup: {}, tx: seed.tx }
  return startFrom(preset, seed.world, seed.tx, seed.run ?? false)
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

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** After a run, bring the result into view if it is above the fold. Focus moves to the verdict separately. */
function revealResult() {
  requestAnimationFrame(() => {
    const el = document.getElementById('panel-result')
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (top < 60 || top > window.innerHeight * 0.6) el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  })
}

/** Which Safe balances (by asset key) and whether the nonce changed between two worlds. */
function changes(before: World | undefined, after: World): { assets: Set<string>; nonce: boolean } {
  const assets = new Set<string>()
  if (!before) return { assets, nonce: false }
  const safe = after.safe.address.toLowerCase()
  const bal = (w: World, asset: string) => Object.entries(w.balances[asset] ?? {}).find(([h]) => h.toLowerCase() === safe)?.[1] ?? '0'
  for (const asset of new Set([...Object.keys(before.balances), ...Object.keys(after.balances)])) {
    if (bal(before, asset) !== bal(after, asset)) assets.add(asset)
  }
  return { assets, nonce: before.safe.nonce !== after.safe.nonce }
}

function StartHere() {
  const [hidden, setHidden] = useState(() => Boolean(load().startDismissed))
  const first = SCENARIOS[0]
  if (hidden || !first) return null
  return (
    <p className="start-here">
      <span>
        New to the Policy Engine? Start with{' '}
        <a href={`#scenario-${first.id}`} id="start-here-link">
          {first.title}
        </a>
        , {plural(first.steps.length, 'step')}.
      </span>
      <button
        type="button"
        className="icon-button"
        id="start-here-dismiss"
        aria-label="Dismiss the start here suggestion"
        onClick={() => {
          setHidden(true)
          save({ startDismissed: true })
        }}
      >
        <Glyph kind="close" size={14} />
      </button>
    </p>
  )
}

function SharePanel({ run }: { run: Run }) {
  const code = useMemo(() => {
    try {
      return encodeShare({ setup: worldToSetup(run.before), tx: run.tx })
    } catch {
      return ''
    }
  }, [run])
  if (!code) return <Callout tone="warning">This run cannot be turned into a setup code.</Callout>
  let link = `#run-${code}`
  try {
    link = `${window.location.href.split('#')[0]}#run-${code}`
  } catch {
    // keep the bare fragment
  }
  return (
    <div className="share" id="share-panel">
      <p className="small">
        The setup code carries this Safe as it was before the run (owners, guards, modules, balances and rules) and the transaction. Paste it under
        Reset Safe, or open the link.
      </p>
      <Field label="Setup code">
        <CopyText text={code} label="Copy code" />
      </Field>
      <Field label="Link" hint="Works on the website. Inside a Claude artifact the link may lose the code; the code always works.">
        <CopyText text={link} label="Copy link" />
      </Field>
    </div>
  )
}

export function Sandbox({ seed, onSeedUsed }: { seed?: Seed | null; onSeedUsed?: () => void }) {
  const [state, setState] = useState<State>(() => (seed ? fromSeed(seed) : boot(PRESETS[0])))
  const [tab, setTab] = useState<Tab>(seed && seed.kind === 'world' && !seed.run ? 'build' : 'result')
  const [editor, setEditor] = useState<{ initial?: RuleSpec; title: string } | null>(null)
  const [resetChoice, setResetChoice] = useState(PRESETS[0].id)
  const [confirmReset, setConfirmReset] = useState(false)
  const [paste, setPaste] = useState('')
  const [sharing, setSharing] = useState(false)
  const narrow = useMedia('(max-width: 1199px)')
  const { world, draft, changeSet, run } = state
  const g = guardState(world)

  useEffect(() => {
    if (seed) onSeedUsed?.()
    // the seed is consumed once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runTx = (tx: TxSpec) => {
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
      prev: s.run,
      run: { result, tx, before: s.world, n: (s.run?.n ?? 0) + 1, seen: s.seen },
      log: [...s.log, logEntry(s.world, tx, result)],
      seen: new Set([...s.seen, ...keysOf([result.world])]),
      example: false,
      setupError: undefined,
      notice: undefined,
      // A change set that went out (alone or as a batch step) is no longer a draft.
      changeSet: result.ok && sendsRules(tx, s.changeSet) ? [] : s.changeSet
    }))
    setSharing(false)
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

  const propose = () => runTx(managementTx('requestConfiguration', changeSet, `Propose ${plural(changeSet.length, 'change')}`))
  const setNow = () => runTx(managementTx('configureImmediately', changeSet, `Set ${plural(changeSet.length, 'rule')} immediately`))
  const apply = (root: string) => runTx(managementTx('applyConfiguration', world.roots[root].configurations, 'Apply change set'))
  const cancel = (root: string) => runTx(managementTx('invalidateRoot', world.roots[root].configurations, 'Cancel change set'))

  const replace = (next: State) => {
    setState(next)
    setEditor(null)
    setConfirmReset(false)
    setSharing(false)
    setTab('result')
  }
  const reset = () => replace(boot(PRESETS.find((p) => p.id === resetChoice) ?? PRESETS[0]))
  const loadCode = () => {
    const next = fromCode(paste)
    replace(next)
    if (!next.notice) setPaste('')
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

  /** "Rule found" in the path: bring the rule into view in Your Safe and highlight it. */
  const showRule = (access: string) => {
    if (narrow) setTab('safe')
    requestAnimationFrame(() => {
      const el = document.getElementById(ruleDomId(access))
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
      el.focus({ preventScroll: true })
    })
  }

  // What the last run changed, for the short highlights.
  const changed = useMemo(() => changes(run?.before, world), [run, world])
  const flashKey = run?.n ?? 0
  const decidedAccess = run && run.result.matched ? run.result.matched.access : null

  // "Rule changes and time": one folded section that opens itself while a change waits.
  const roots = Object.values(world.roots)
  const waiting = roots.filter((r) => rootPhase(world, r.validFrom) === 'waiting')
  const ready = roots.filter((r) => rootPhase(world, r.validFrom) === 'ready')
  const nextReady = waiting.length ? Math.min(...waiting.map((r) => r.validFrom - world.now)) : 0
  const autoOpen = roots.length > 0 || changeSet.length > 0
  const [foldManual, setFoldManual] = useState<boolean | null>(null)
  useEffect(() => {
    if (autoOpen) setFoldManual(null)
  }, [autoOpen, roots.length, changeSet.length])
  const foldOpen = foldManual ?? autoOpen
  const summaryParts: string[] = []
  if (changeSet.length) summaryParts.push(plural(changeSet.length, 'drafted change'))
  if (waiting.length) summaryParts.push(`${waiting.length} waiting, ready in ${formatDuration(nextReady)}`)
  if (ready.length) summaryParts.push(`${ready.length} ready to apply`)
  if (!summaryParts.length) summaryParts.push(`Nothing waiting · ${formatShortTime(world.now)} UTC`)

  const guardActions = g.none ? (
    <div className="helper">
      <p className="helper-title">Harden in one batch</p>
      <p className="small">Drafts one batch: set your drafted rules, then install the module guard and the transaction guard. Review it in the builder, then run it.</p>
      {changeSet.length === 0 ? <p className="small text-warning">No rules drafted. Hardened with no rules, the Safe blocks every transaction.</p> : null}
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
      <OwnersSection world={world} nonceChanged={changed.nonce} flashKey={flashKey} />
      <GuardsSection world={world} actions={guardActions} />
      <ModulesSection world={world} />
      <BalancesSection world={world} changed={changed.assets} flashKey={flashKey} />
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
        <RuleTable world={world} onEdit={editEntry} onRemove={removeEntry} staged={staged} decided={decidedAccess} flashKey={flashKey} />
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
      <section className="panel-section fold-section" aria-labelledby="sec-time">
        <details
          className="fold"
          open={foldOpen}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open
            if (isOpen !== foldOpen) setFoldManual(isOpen)
          }}
        >
          <summary className="fold-summary" id="sec-time-summary">
            <span className="overline" id="sec-time">
              Rule changes and time
            </span>
            <span className={`fold-line small${waiting.length ? ' text-warning' : ''}`}>{summaryParts.join(' · ')}</span>
          </summary>
          <div className="fold-body">
            <div className="fold-part">
              <p className="fold-title">Change set</p>
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
                    {g.none ? (
                      <>
                        <Button id="changes-now" variant="primary" onClick={setNow}>
                          Set now
                        </Button>
                        <Button id="changes-harden" onClick={() => draftTx(hardenTx(changeSet, signersNow))}>
                          Set and harden in one batch
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button id="changes-propose" variant="primary" onClick={propose}>
                          Propose change
                        </Button>
                        <Button id="changes-propose-batch" onClick={() => draftTx(proposeBatchTx(changeSet, signersNow))}>
                          Propose in a batch
                        </Button>
                      </>
                    )}
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
            </div>
            <div className="fold-part">
              <p className="fold-title">Waiting changes</p>
              <PendingChanges world={world} onApply={apply} onCancel={cancel} />
            </div>
            <div className="fold-part">
              <p className="fold-title">Clock</p>
              <Clock world={world} onAdvance={(s) => setState((st) => ({ ...st, world: engine.advanceTime(st.world, s) }))} />
            </div>
            <div className="fold-part">
              <p className="fold-title">Activity</p>
              <Activity log={state.log} />
            </div>
            <div className="fold-part">
              <p className="fold-title">Reset Safe</p>
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
                <Field id="paste-code" label="Paste a setup code" hint="Rebuilds a shared Safe and runs its transaction. Replaces your Safe.">
                  <div className="paste-row">
                    <TextInput id="paste-code" mono value={paste} onChange={setPaste} placeholder="1p…" />
                    <Button id="paste-load" size="sm" onClick={loadCode} disabled={!paste.trim()}>
                      Load
                    </Button>
                  </div>
                </Field>
              </div>
            </div>
          </div>
        </details>
      </section>
    </div>
  )

  const buildPanel = (
    <div className="panel" id="panel-build">
      <div className="panel-head">
        <h2 className="panel-title">Build a transaction</h2>
      </div>
      <TxBuilder world={world} draft={draft} onChange={(d) => setState((s) => ({ ...s, draft: d }))} changeSet={changeSet} onRun={(tx) => runTx(tx)} examples={examples} onExample={loadExample} />
    </div>
  )

  const resultPanel = (
    <div className="panel" id="panel-result">
      <div className="panel-head">
        <h2 className="panel-title">What happened</h2>
        <div className="panel-head-tools">
          {state.example && run ? <Pill tone="info">Example run</Pill> : null}
          {run ? (
            <Button id="share-run" size="sm" variant="ghost" onClick={() => setSharing(!sharing)}>
              {sharing ? 'Hide sharing' : 'Share this run'}
            </Button>
          ) : null}
        </div>
      </div>
      {sharing && run ? <SharePanel run={run} /> : null}
      {state.setupError ? (
        <Callout tone="danger" title="Something went wrong">
          {state.setupError}
        </Callout>
      ) : null}
      {run ? (
        <ResultView
          key={run.n}
          result={run.result}
          tx={run.tx}
          world={run.before}
          animate={run.n > 0}
          previous={state.prev ? { result: state.prev.result, path: state.prev.tx.path ?? 'owner' } : null}
          seenKeys={run.seen}
          decided={{ world: run.before, inline: narrow, onShow: showRule }}
          verdictId="sandbox-verdict"
          focusVerdict={run.n}
        />
      ) : (
        <p className="muted">Run a transaction to see whether it passes and why.</p>
      )}
    </div>
  )

  return (
    <div className="sandbox">
      <div className="intro-strip">
        <div className="intro-line">
          {state.example ? (
            <>
              <Pill tone="info">Example</Pill>
              <p>
                A hardened treasury with five rules. Its first transaction already ran: see why it was blocked. Change anything and run it again, or reset
                the Safe to another starting point.
              </p>
            </>
          ) : (
            <>
              <Pill tone="neutral">{state.preset.label}</Pill>
              <p>{state.preset.blurb}</p>
            </>
          )}
        </div>
        <StartHere />
      </div>
      {state.notice ? (
        <Callout tone="warning" title="Setup code not loaded">
          {state.notice}
        </Callout>
      ) : null}
      <div className="sandbox-tabs">
        <Tabs
          id="sandbox"
          label="Sandbox sections"
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
        <div className="col col-safe" {...tabPanelProps('sandbox', 'safe', narrow)}>
          {safePanel}
        </div>
        <div className="col col-build" {...tabPanelProps('sandbox', 'build', narrow)}>
          {buildPanel}
        </div>
        <div className="col col-result" {...tabPanelProps('sandbox', 'result', narrow)}>
          {resultPanel}
        </div>
      </div>
    </div>
  )
}
