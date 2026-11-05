/**
 * "What happened": the verdict, the decision path drawn from the trace, the sharp edge it hit, and
 * what changed. Step-through mode reveals the path one stage at a time for presenting.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Effect, EncodedTx, SimResult, TraceEvent, TxSpec, World } from '../../engine/types.ts'
import { errorInfo, innermost, policyLabel, solidityError } from '../lib/content.ts'
import { describeCall, describeContext, describeTableEntry, describeWho, isZero } from '../lib/describe.ts'
import { plural } from '../lib/format.ts'
import { buildStages, splitEnd, stageLabel, statusWord } from '../lib/pipeline.ts'
import type { PipeItem, Stage, StageKey, SubItem } from '../lib/pipeline.ts'
import { runLine } from '../lib/runline.ts'
import { detectSharpEdge } from '../lib/sharpEdges.ts'
import type { SharpEdge } from '../lib/sharpEdges.ts'
import { RuleRow } from './Safe.tsx'
import { TermScope, Termed } from './Terms.tsx'
import { Button, Callout, CopyText, Glyph, Pill, Status, Tech, useEngineer } from './ui.tsx'

// ---------------------------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------------------------

/** The verdict. Focusable (tabIndex -1) so a run can move keyboard and screen-reader focus to it. */
export const Verdict = forwardRef<HTMLDivElement, { result: SimResult; id?: string; children?: ReactNode }>(
  function Verdict({ result, id, children }, ref) {
    const engineer = useEngineer()
    if (result.ok) {
      const noGuard = result.trace.find((e) => e.id === 'safe.noGuard')
      const managed = result.trace.some((e) => e.id === 'engine.allowedCall')
      const sub = noGuard
        ? 'It ran without any rule being checked.'
        : managed
          ? 'Managing rules is always allowed. New rules still wait out the waiting period.'
          : result.matched
            ? `${policyLabel(result.matched.policy)} approved it${result.matched.isFallback ? ' through the catch-all rule' : ''}.`
            : 'The transaction ran.'
      return (
        <TermScope>
          <div className="verdict tone-success" tabIndex={-1} ref={ref} id={id} aria-label={`Verdict: Allowed. ${sub}`}>
            <Glyph kind="pass" size={32} />
            <div className="verdict-text">
              <p className="verdict-word">Allowed</p>
              <p className="verdict-sub">
                <Termed text={sub} />
              </p>
              {children}
            </div>
          </div>
        </TermScope>
      )
    }
    const err = result.error
    if (!err) return null
    const deep = innermost(err)
    const info = errorInfo(deep.error.error, deep.policy) ?? errorInfo(err.error, err.policy)
    const word = err.by === 'execution' ? 'Failed' : 'Blocked'
    const who =
      err.by === 'safe'
        ? 'Stopped by the Safe'
        : err.by === 'execution'
          ? 'The rules allowed it. The call itself failed.'
          : deep.policy
            ? `Stopped by ${policyLabel(deep.policy)}`
            : 'Stopped by the Policy Guard'
    const chain: string[] = []
    for (let e: typeof err | undefined = err; e; e = e.reason) if (e.policy) chain.push(policyLabel(e.policy))
    return (
      <TermScope>
        <div
          className="verdict tone-danger"
          tabIndex={-1}
          ref={ref}
          id={id}
          aria-label={`Verdict: ${word}. ${who}. ${info?.title ?? deep.error.error}.`}
        >
          <Glyph kind="fail" size={32} />
          <div className="verdict-text">
            <p className="verdict-word">{word}</p>
            <p className="verdict-sub">{who}</p>
            <div className="verdict-reason">
              <p className="verdict-title">{info?.title ?? deep.error.error}</p>
              <p>
                <Termed text={err.message} />
              </p>
              {info?.plain && info.plain !== err.message ? (
                <p className="muted">
                  <Termed text={info.plain} />
                </p>
              ) : null}
              {chain.length > 1 ? (
                <p className="verdict-chain">
                  <span className="muted">Path: </span>
                  {chain.map((c, i) => (
                    <span key={i}>
                      {i > 0 ? <Glyph kind="arrow-right" size={12} /> : null}
                      {c}
                    </span>
                  ))}
                </p>
              ) : null}
              {info?.fix ? (
                <p className="verdict-fix">
                  <strong>How to fix: </strong>
                  <Termed text={info.fix} />
                </p>
              ) : null}
              {engineer ? (
                <p className="tech">
                  {solidityError(err)}
                  {info?.tech ? ` · ${info.tech}` : ''}
                </p>
              ) : null}
            </div>
            {children}
          </div>
        </div>
      </TermScope>
    )
  }
)

/** "Last run: Blocked at Policy (Recipient Allowlist). This run: Allowed." */
export function CompareLine({
  previous,
  current,
  path
}: {
  previous: { result: SimResult; path: 'owner' | 'module' }
  current: SimResult
  path: 'owner' | 'module'
}) {
  const before = runLine(previous.result, previous.path)
  const now = runLine(current, path)
  return (
    <p className="compare">
      <span className="muted">Last run: </span>
      <span className={before.ok ? 'text-success' : 'text-danger'}>{before.text}.</span>{' '}
      <span className="muted">This run: </span>
      <span className={now.ok ? 'text-success' : 'text-danger'}>{now.text}.</span>
    </p>
  )
}

// ---------------------------------------------------------------------------------------------
// Decision path
// ---------------------------------------------------------------------------------------------

function EventRow({ ev }: { ev: TraceEvent }) {
  const engineer = useEngineer()
  return (
    <li className={`pipe-event is-${ev.status}`}>
      <span
        className={`pipe-event-mark tone-${ev.status === 'pass' ? 'success' : ev.status === 'fail' ? 'danger' : ev.status === 'warn' ? 'warning' : 'muted'}`}
      >
        <Glyph kind={ev.status} size={14} />
        <span className="sr-only">
          {ev.status === 'pass'
            ? 'Passed: '
            : ev.status === 'fail'
              ? 'Failed: '
              : ev.status === 'warn'
                ? 'Warning: '
                : ''}
        </span>
      </span>
      <div className="pipe-event-text">
        <p className="pipe-event-title">{ev.title}</p>
        {ev.detail ? <p className="pipe-event-detail">{ev.detail}</p> : null}
        {engineer && (ev.tech || ev.access) ? (
          <p className="tech">
            {ev.tech}
            {ev.tech && ev.access ? ' · ' : ''}
            {ev.access ? <span className="tech-access">{ev.access}</span> : null}
          </p>
        ) : null}
      </div>
    </li>
  )
}

function EdgeRow({ edge, here }: { edge: SharpEdge; here?: string }) {
  return (
    <li className="pipe-edge" aria-label={`Sharp edge: ${edge.title}`}>
      <span className="pipe-edge-label">
        <Glyph kind="warn" size={14} />
        Sharp edge
      </span>
      <p className="pipe-edge-title">{edge.title}</p>
      <p className="pipe-edge-text">{edge.text}</p>
      {edge.scenario && edge.scenario !== here ? (
        <a className="pipe-edge-link" href={`#scenario-${edge.scenario}`}>
          See it in a scenario
        </a>
      ) : null}
    </li>
  )
}

function SubBlock({ sub, path, titles }: { sub: SubItem; path: 'owner' | 'module'; titles: string[] }) {
  const ran = sub.stages.filter((s) => s.items.length > 0)
  const status =
    sub.status === 'pass'
      ? 'Passed'
      : sub.status === 'fail'
        ? 'Failed'
        : sub.status === 'warn'
          ? 'Warning'
          : sub.status === 'none'
            ? 'Not reached'
            : 'Done'
  return (
    <li className={`pipe-sub is-${sub.status}`}>
      <div className="pipe-sub-head">
        <span className="pipe-sub-index">{sub.index >= 0 ? `Step ${sub.index + 1}` : 'Nested check'}</span>
        <span className="pipe-sub-title">{sub.header?.title ?? titles[sub.index] ?? ''}</span>
        <Status status={sub.status} compact label={status} />
      </div>
      {sub.header?.detail ? <p className="pipe-event-detail">{sub.header.detail}</p> : null}
      <Tech block>{sub.header?.tech}</Tech>
      {ran.length > 0 ? (
        <ul className="pipe-sub-stages">
          {ran.map((st) => (
            <li key={st.key} className="pipe-sub-stage">
              <span className="pipe-sub-stage-label">
                {st.key === 'policy' && st.policy ? policyLabel(st.policy) : stageLabel(st.key, path, true)}
              </span>
              <ul className="pipe-events">
                {st.items.map((it, i) => (
                  <Item key={i} it={it} path={path} titles={[]} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Item({ it, path, titles }: { it: PipeItem; path: 'owner' | 'module'; titles: string[] }) {
  return it.type === 'event' ? <EventRow ev={it.ev} /> : <SubBlock sub={it} path={path} titles={titles} />
}

export interface Decided {
  /** The rule that decided, as it stood before the run. */
  world: World
  /** Show the rule inline (where the rule table is not beside the result). */
  inline: boolean
  /** Scroll to the rule in Your Safe. */
  onShow?: (access: string) => void
}

function DecidedRule({ result, decided }: { result: SimResult; decided: Decided }) {
  const m = result.matched
  if (!m) return null
  const entry =
    decided.world.table[m.access] ??
    Object.values(decided.world.table).find((e) => e.access.toLowerCase() === m.access.toLowerCase())
  if (!entry) return null
  return (
    <div className="decided">
      {decided.inline ? (
        <ul className="rule-list decided-rule" aria-label="The rule that decided">
          <RuleRow w={describeTableEntry(decided.world, entry)} access={entry.access} />
        </ul>
      ) : null}
      {decided.onShow ? (
        <button type="button" className="link-button decided-link" onClick={() => decided.onShow?.(entry.access)}>
          {m.isFallback ? 'Show the catch-all rule in Your Safe' : 'Show this rule in Your Safe'}
        </button>
      ) : null}
    </div>
  )
}

function StageView({
  st,
  path,
  index,
  titles,
  edge,
  here,
  extra
}: {
  st: Stage
  path: 'owner' | 'module'
  index: number
  titles: string[]
  edge?: SharpEdge | null
  here?: string
  extra?: ReactNode
}) {
  const label = st.key === 'policy' && st.policy ? `Policy: ${policyLabel(st.policy)}` : stageLabel(st.key, path, false)
  const showEdge = edge && edge.stage === st.key
  return (
    <li className={`pipe-stage is-${st.status}`} style={{ ['--i' as string]: index }}>
      <div className="pipe-head">
        <span className="node">{label}</span>
        <Status status={st.status} label={statusWord(st.key, st.status)} />
      </div>
      {st.items.length > 0 || showEdge || extra ? (
        <ul className="pipe-events">
          {st.items.map((it, i) => (
            <Item key={i} it={it} path={path} titles={titles} />
          ))}
          {showEdge ? <EdgeRow edge={edge!} here={here} /> : null}
          {extra ? <li className="pipe-extra">{extra}</li> : null}
        </ul>
      ) : null}
    </li>
  )
}

function outcomeOf(result: SimResult) {
  const err = result.error
  return result.ok
    ? { cls: 'is-outcome', word: 'Executed', note: 'All changes were kept.' }
    : err?.by === 'execution'
      ? { cls: 'is-blocked', word: 'Reverted', note: 'The call failed, so the whole transaction was undone.' }
      : { cls: 'is-blocked', word: 'Blocked', note: 'The call never ran.' }
}

export function Pipeline({
  result,
  path,
  animate = false,
  titles = [],
  edge,
  here,
  limit,
  decided
}: {
  result: SimResult
  path: 'owner' | 'module'
  animate?: boolean
  /** Plain titles of the batch steps, used when the trace does not name a step. */
  titles?: string[]
  edge?: SharpEdge | null
  /** The scenario on screen, so its own sharp-edge link is not offered. */
  here?: string
  /** Step-through: how many nodes (stages, then the outcome) to show. */
  limit?: number
  decided?: Decided
}) {
  const { stages, end } = useMemo(() => {
    const parts = splitEnd(result.trace)
    return { stages: buildStages(parts.main), end: parts.end }
  }, [result.trace])
  const outcome = outcomeOf(result)
  const shown = limit ?? stages.length + 1
  return (
    <div className="scroll-x">
      <ol className={`pipe${animate && limit === undefined ? ' is-build' : ''}`} aria-label="Decision path">
        {stages.slice(0, shown).map((st, i) => (
          <StageView
            key={st.key}
            st={st}
            path={path}
            index={i}
            titles={titles}
            edge={edge}
            here={here}
            extra={st.key === 'lookup' && decided ? <DecidedRule result={result} decided={decided} /> : undefined}
          />
        ))}
        {shown > stages.length ? (
          <li className="pipe-stage pipe-end" style={{ ['--i' as string]: stages.length }}>
            <div className="pipe-head">
              <span className={`node ${outcome.cls}`}>{outcome.word}</span>
              <span className="muted pipe-end-note">{outcome.note}</span>
            </div>
            {end.length > 0 || edge?.stage === 'end' ? (
              <ul className="pipe-events">
                {end.map((ev, i) => (
                  <EventRow key={i} ev={ev} />
                ))}
                {edge?.stage === 'end' ? <EdgeRow edge={edge} here={here} /> : null}
              </ul>
            ) : null}
          </li>
        ) : null}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------------------------

const KIND_LABEL: Record<Effect['kind'], string> = {
  balance: 'Balance',
  allowance: 'Allowance',
  guard: 'Guard',
  module: 'Module',
  owners: 'Owners',
  threshold: 'Threshold',
  rule: 'Rule',
  policyState: 'Policy state',
  root: 'Change set',
  nonce: 'Nonce',
  note: 'Note'
}

export function Effects({ result }: { result: SimResult }) {
  const effects = result.effects
  const kept = effects.filter((e) => !e.reverted)
  const undone = effects.filter((e) => e.reverted)
  if (effects.length === 0) return <p className="muted">Nothing changed.</p>
  return (
    <div className="effects">
      {!result.ok && undone.length > 0 ? (
        <p className="muted">Nothing changed. These changes were staged while checking and then undone:</p>
      ) : null}
      <ul className="effect-list">
        {[...kept, ...undone].map((e, i) => (
          <li key={i} className={`effect${e.reverted ? ' is-reverted' : ''}`}>
            <span className="effect-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
            <span className="effect-title">{e.reverted ? <s>{e.title}</s> : e.title}</span>
            {e.reverted ? <Pill tone="muted">Undone</Pill> : null}
            <Tech block>{e.tech}</Tech>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Encoded transaction (engineer view)
// ---------------------------------------------------------------------------------------------

export function Encoded({ encoded }: { encoded: EncodedTx }) {
  return (
    <div className="encoded">
      <dl className="kv">
        <dt>to</dt>
        <dd className="mono">{encoded.to}</dd>
        <dt>value</dt>
        <dd className="mono">{encoded.value} wei</dd>
        <dt>operation</dt>
        <dd className="mono">
          {encoded.operation} ({encoded.operation === 1 ? 'DELEGATECALL' : 'CALL'})
        </dd>
        <dt>access selector</dt>
        <dd className="mono">{encoded.accessSelector}</dd>
      </dl>
      <p className="field-label">Calldata</p>
      <CopyText text={encoded.data || '0x'} label="Copy calldata" />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Batches and guard changes (SPEC §9): the Safe picks its guard once, before the transaction
// ---------------------------------------------------------------------------------------------

export function GuardNotes({ result, tx, world }: { result: SimResult; tx: TxSpec; world: World }) {
  const batch = tx.call?.fn === 'multiSend' ? (tx.call.batch ?? []) : []
  if (batch.length === 0) return null
  const unchecked = result.trace.some((e) => e.depth === 0 && e.id === 'safe.noGuard')
  const guardSteps = batch
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.call && (s.call.fn === 'setGuard' || s.call.fn === 'setModuleGuard'))
    .map(({ s, i }) => ({
      i,
      which: s.call!.fn === 'setGuard' ? 'transaction guard' : 'module guard',
      removes: isZero(world, s.call!.args?.[0])
    }))
  const installs = guardSteps.filter((g) => !g.removes)
  const removals = guardSteps.filter((g) => g.removes)
  const out: ReactNode[] = []
  if (unchecked) {
    out.push(
      <Callout key="unchecked" tone="warning" title="This batch ran unchecked">
        No guard was installed when it started, and the Safe picks its guard once, before a transaction runs. None of
        its {plural(batch.length, 'step')} was checked.
        {result.ok && installs.length > 0
          ? ' The guards it installed check every transaction from the next one on.'
          : ''}
      </Callout>
    )
  } else if (result.ok) {
    for (const g of installs) {
      if (g.i < batch.length - 1) {
        out.push(
          <Callout key={`in-${g.i}`} tone="info" title={`Step ${g.i + 1} installed the ${g.which}`}>
            The steps after it were not checked again by it. It checks from the next transaction on.
          </Callout>
        )
      }
    }
    for (const g of removals) {
      out.push(
        <Callout key={`rm-${g.i}`} tone="info" title={`Step ${g.i + 1} removed the ${g.which}`}>
          This batch was still checked by it: the Safe picked its guard before the batch ran, and ran its after-check
          too.
        </Callout>
      )
    }
  }
  return out.length ? <div className="stack-sm">{out}</div> : null
}

// ---------------------------------------------------------------------------------------------
// Whole result
// ---------------------------------------------------------------------------------------------

export function TxSummary({ world, tx }: { world: World; tx: TxSpec }) {
  const ctx = describeContext(world, tx.context)
  return (
    <div className="tx-summary">
      <p className="tx-summary-who">
        <Glyph kind={tx.path === 'module' ? 'module' : 'user'} size={14} />
        {tx.path === 'module' ? 'Module transaction' : 'Owner transaction'} · {describeWho(world, tx)}
      </p>
      <p className="tx-summary-what">{describeCall(world, tx)}</p>
      {tx.call?.batch && tx.call.batch.length > 0 ? (
        <ol className="tx-summary-batch">
          {tx.call.batch.map((s, i) => (
            <li key={i}>{describeCall(world, s)}</li>
          ))}
        </ol>
      ) : null}
      {ctx ? <p className="muted small">With {ctx.charAt(0).toLowerCase() + ctx.slice(1)}</p> : null}
    </div>
  )
}

function stageCount(result: SimResult): number {
  return buildStages(splitEnd(result.trace).main).length + 1
}

function stageName(result: SimResult, path: 'owner' | 'module', n: number): string {
  const stages = buildStages(splitEnd(result.trace).main)
  if (n > stages.length) return `Outcome: ${outcomeOf(result).word}`
  const st = stages[n - 1]
  const label =
    st.key === 'policy' && st.policy ? `Policy: ${policyLabel(st.policy)}` : stageLabel(st.key as StageKey, path, false)
  return `${label}, ${statusWord(st.key, st.status)}`
}

export function ResultView({
  result,
  tx,
  world,
  animate = false,
  headingLevel = 3,
  showSummary = true,
  previous,
  seenKeys,
  here,
  decided,
  verdictId,
  focusVerdict = 0
}: {
  result: SimResult
  tx: TxSpec
  world: World
  animate?: boolean
  headingLevel?: 2 | 3 | 4
  showSummary?: boolean
  /** The run before this one, for the one-line comparison. */
  previous?: { result: SimResult; path: 'owner' | 'module' } | null
  /** Access keys that had rules earlier (removed-rule sharp edge). */
  seenKeys?: Set<string>
  here?: string
  decided?: Decided
  verdictId?: string
  /** Change this number to move focus to the verdict (after a run). */
  focusVerdict?: number
}) {
  const engineer = useEngineer()
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const path = tx.path ?? 'owner'
  const edge = useMemo(() => {
    try {
      return detectSharpEdge({ result, tx, world, seenKeys })
    } catch {
      return null
    }
  }, [result, tx, world, seenKeys])
  const total = useMemo(() => stageCount(result), [result])
  const [step, setStep] = useState<number | null>(null) // null: show everything
  const verdictRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<HTMLDivElement>(null)
  const done = step === null || step >= total

  useEffect(() => {
    if (focusVerdict > 0) verdictRef.current?.focus({ preventScroll: false })
  }, [focusVerdict])

  const startStepping = () => {
    setStep(1)
    requestAnimationFrame(() => pathRef.current?.focus())
  }
  const next = () => setStep((s) => (s === null ? null : Math.min(total, s + 1)))
  const back = () => setStep((s) => (s === null ? null : Math.max(1, s - 1)))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (step === null) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      next()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      back()
    } else if (e.key === 'Escape') {
      setStep(null)
    }
  }

  return (
    <div className="result">
      {showSummary ? <TxSummary world={world} tx={tx} /> : null}
      {done ? (
        <Verdict result={result} ref={verdictRef} id={verdictId}>
          {previous ? <CompareLine previous={previous} current={result} path={path} /> : null}
        </Verdict>
      ) : (
        <div className="verdict-hidden" role="note">
          <Glyph kind="none" size={20} />
          <p>The verdict is hidden while you step through. Where does it stop?</p>
        </div>
      )}
      {done ? <GuardNotes result={result} tx={tx} world={world} /> : null}
      <section className="result-section" aria-label="Decision path">
        <div className="section-head">
          <H className="section-title">Decision path</H>
          {step === null ? (
            <Button size="sm" variant="ghost" onClick={startStepping}>
              Step through
            </Button>
          ) : (
            <div className="stepper" role="group" aria-label="Step through the decision path">
              <span className="muted small tnum">
                Stage {Math.min(step, total)} of {total}
              </span>
              <Button size="sm" onClick={back} disabled={step <= 1}>
                <Glyph kind="up" size={14} />
                <span className="sr-only">Previous stage</span>
              </Button>
              <Button size="sm" variant="primary" onClick={next} disabled={step >= total}>
                Next stage
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStep(null)}>
                Show all
              </Button>
            </div>
          )}
        </div>
        <div
          ref={pathRef}
          className={`pipe-wrap${step !== null ? ' is-stepping' : ''}`}
          tabIndex={step !== null ? 0 : undefined}
          onKeyDown={onKeyDown}
          aria-label={
            step !== null
              ? 'Decision path, step-through mode. Right arrow reveals the next stage, left arrow goes back, Escape shows all.'
              : undefined
          }
        >
          <Pipeline
            result={result}
            path={path}
            animate={animate}
            titles={(tx.call?.batch ?? []).map((b) => describeCall(world, b))}
            edge={edge && (step === null || edgeShown(edge, result, step)) ? edge : null}
            here={here}
            limit={step ?? undefined}
            decided={decided}
          />
        </div>
        {step !== null ? (
          <p className="sr-only" aria-live="polite">
            {stageName(result, path, Math.min(step, total))}
          </p>
        ) : null}
      </section>
      {done ? (
        <section className="result-section" aria-label="What changed">
          <H className="section-title">What changed</H>
          <Effects result={result} />
        </section>
      ) : null}
      {engineer && done ? (
        <section className="result-section" aria-label="Encoded transaction">
          <H className="section-title">Encoded transaction</H>
          <Encoded encoded={result.encoded} />
        </section>
      ) : null}
    </div>
  )
}

/** In step-through, a sharp edge appears once its stage is revealed. */
function edgeShown(edge: SharpEdge, result: SimResult, step: number): boolean {
  if (edge.stage === 'end') return step >= stageCount(result)
  const order: StageKey[] = ['auth', 'guard', 'lookup', 'policy', 'exec']
  return step >= order.indexOf(edge.stage) + 1
}
