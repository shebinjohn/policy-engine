/** Scenarios: the learning path by chapter, and a step-by-step walk through one scenario. */
import { useMemo, useState } from 'react'
import type { Scenario, StepOutcome, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { CHAPTERS } from '../lib/content.ts'
import { describeExpectation } from '../lib/describe.ts'
import { formatDuration, formatTime, plural } from '../lib/format.ts'
import { SCENARIOS } from '../generated/content.ts'
import { ResultView, TxSummary } from '../components/Result.tsx'
import { BalancesSection, Clock, GuardsSection, ModulesSection, OwnersSection, PendingChanges, RuleTable, Section } from '../components/Safe.tsx'
import { Button, Callout, Glyph, Status } from '../components/ui.tsx'

export function chaptersWithScenarios(): { id: string; title: string; blurb: string; items: Scenario[] }[] {
  const known = CHAPTERS.map((c) => ({ ...c, items: SCENARIOS.filter((s) => s.chapter === c.id || s.chapter === c.title) }))
  const used = new Set(known.flatMap((c) => c.items.map((s) => s.id)))
  const rest = SCENARIOS.filter((s) => !used.has(s.id))
  const extra = new Map<string, Scenario[]>()
  for (const s of rest) extra.set(s.chapter, [...(extra.get(s.chapter) ?? []), s])
  return [
    ...known.filter((c) => c.items.length > 0),
    ...[...extra.entries()].map(([id, items]) => ({ id, title: id, blurb: '', items }))
  ]
}

export function ScenarioList({ onOpen }: { onOpen: (id: string) => void }) {
  const chapters = chaptersWithScenarios()
  return (
    <div className="view">
      <header className="view-head">
        <p className="overline">Guided</p>
        <h1 className="page-title">Scenarios</h1>
        <p className="lead">Each scenario sets up a Safe and walks through a few transactions, one step at a time. Run each step and read why it passed or was blocked.</p>
      </header>
      {chapters.length === 0 ? <p className="muted">No scenarios are published yet.</p> : null}
      {chapters.map((c, ci) => (
        <section key={c.id} className="chapter" aria-labelledby={`chapter-${ci}`}>
          <div className="chapter-head">
            <h2 className="chapter-title" id={`chapter-${ci}`}>
              <span className="chapter-index tnum">{ci + 1}</span>
              {c.title}
            </h2>
            {c.blurb ? <p className="muted">{c.blurb}</p> : null}
          </div>
          <ul className="card-grid">
            {c.items.map((s) => (
              <li key={s.id}>
                <button type="button" id={`scenario-${s.id}`} className="card card-button" onClick={() => onOpen(s.id)}>
                  <span className="card-title">{s.title}</span>
                  <span className="card-text">{s.summary}</span>
                  <span className="card-meta">
                    {plural(s.steps.length, 'step')}
                    <Glyph kind="arrow-right" size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function stepStatus(o: StepOutcome | undefined, ran: boolean): { status: string; label: string } {
  if (!ran || !o) return { status: 'none', label: 'Not run' }
  if (o.step.do === 'wait') return { status: 'info', label: 'Waited' }
  if (o.matches === false) return { status: 'warn', label: 'Unexpected' }
  return o.result?.ok ? { status: 'pass', label: 'Allowed' } : { status: 'fail', label: 'Blocked' }
}

export function ScenarioView({
  scenario,
  onBack,
  onOpen,
  onTry
}: {
  scenario: Scenario
  onBack: () => void
  onOpen: (id: string) => void
  onTry: (world: World, tx: TxSpec, from: string) => void
}) {
  const run = useMemo(() => {
    try {
      const initial = engine.createWorld(scenario.setup)
      const outcomes = engine.runScenario(scenario)
      return { initial, outcomes, error: '' }
    } catch (e) {
      return { initial: null, outcomes: [] as StepOutcome[], error: (e as Error).message }
    }
  }, [scenario])
  const [ran, setRan] = useState(0) // number of steps run
  const [current, setCurrent] = useState(0)
  const total = scenario.steps.length
  const idx = Math.min(current, total - 1)
  const step = scenario.steps[idx]
  const outcome = run.outcomes[idx]
  const isRun = idx < ran
  const worldBefore = idx === 0 ? run.initial : (run.outcomes[idx - 1]?.world ?? run.initial)
  const shown = isRun ? (outcome?.world ?? worldBefore) : worldBefore
  const finished = ran >= total
  const list = SCENARIOS
  const pos = list.findIndex((s) => s.id === scenario.id)
  const next = pos >= 0 ? list[pos + 1] : undefined

  const runStep = () => {
    if (idx === ran) setRan(ran + 1)
  }
  const goNext = () => setCurrent(Math.min(idx + 1, total - 1))

  return (
    <div className="view">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="link-button" id="scenario-back" onClick={onBack}>
          Scenarios
        </button>
        <span aria-hidden="true">/</span>
        <span>{CHAPTERS.find((c) => c.id === scenario.chapter)?.title ?? scenario.chapter}</span>
      </nav>
      <header className="view-head">
        <p className="overline">Scenario {pos + 1}</p>
        <h1 className="page-title">{scenario.title}</h1>
        <p className="lead">{scenario.summary}</p>
      </header>
      {run.error ? (
        <Callout tone="danger" title="This scenario could not be set up">
          {run.error}
        </Callout>
      ) : null}
      <div className="scenario-grid">
        <aside className="scenario-side">
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Steps</h2>
              <span className="muted small tnum">
                {Math.min(ran, total)} of {total} run
              </span>
            </div>
            <ol className="steps">
              {scenario.steps.map((s, i) => {
                const st = stepStatus(run.outcomes[i], i < ran)
                const reachable = i <= ran
                return (
                  <li key={i} className={`step-item${i === idx ? ' is-current' : ''}`}>
                    <button type="button" id={`step-${i}`} className="step-button" disabled={!reachable} onClick={() => setCurrent(i)} aria-current={i === idx ? 'step' : undefined}>
                      <span className="step-index tnum">{i + 1}</span>
                      <span className="step-label">{s.label}</span>
                      <Status status={st.status} label={st.label} compact />
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
          {shown ? (
            <div className="panel">
              <div className="panel-head">
                <h2 className="panel-title">The Safe</h2>
                <span className="muted small">{isRun ? `after step ${idx + 1}` : idx === 0 ? 'at the start' : `before step ${idx + 1}`}</span>
              </div>
              <OwnersSection world={shown} idPrefix="scn-" />
              <GuardsSection world={shown} idPrefix="scn-" />
              <ModulesSection world={shown} idPrefix="scn-" />
              <Section title="Rules" id="scn-rules">
                <RuleTable world={shown} />
              </Section>
              {Object.keys(shown.roots).length > 0 ? (
                <Section title="Waiting changes" id="scn-pending">
                  <PendingChanges world={shown} />
                </Section>
              ) : null}
              <BalancesSection world={shown} idPrefix="scn-" />
              <Section title="Clock" id="scn-clock">
                <Clock world={shown} />
              </Section>
            </div>
          ) : null}
        </aside>
        <div className="scenario-main">
          {step ? (
            <article className="panel step-card" aria-labelledby="step-title">
              <p className="overline">
                Step {idx + 1} of {total}
              </p>
              <h2 className="step-title" id="step-title">
                {step.label}
              </h2>
              {step.note ? <p className="step-note">{step.note}</p> : null}
              {step.do === 'tx' && worldBefore ? (
                <>
                  <TxSummary world={worldBefore} tx={step.tx} />
                  <p className="expect">
                    <span className="muted">Expected: </span>
                    <strong>{describeExpectation(step.expect)}</strong>
                  </p>
                </>
              ) : null}
              {step.do === 'wait' ? (
                <p className="expect">
                  <Glyph kind="clock" size={16} /> The clock moves forward by <strong>{formatDuration(step.seconds)}</strong>.
                </p>
              ) : null}
              {!isRun ? (
                <div className="button-row">
                  <Button id="step-run" variant="primary" size="lg" onClick={runStep} disabled={idx !== ran || !outcome}>
                    Run this step
                  </Button>
                  {step.do === 'tx' && worldBefore ? (
                    <Button id="step-try" onClick={() => onTry(worldBefore, step.tx, scenario.title)}>
                      Try it in the Sandbox
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="step-result">
                  {step.do === 'tx' && outcome?.result && worldBefore ? (
                    <>
                      {outcome.matches === false ? (
                        <Callout tone="danger" title="The simulator disagrees with this scenario">
                          {outcome.mismatch ?? 'The result does not match the expected outcome.'}
                        </Callout>
                      ) : (
                        <Callout tone="success" title="Matches the expected outcome" />
                      )}
                      <ResultView result={outcome.result} tx={step.tx} world={worldBefore} animate headingLevel={3} showSummary={false} />
                    </>
                  ) : null}
                  {step.do === 'wait' && outcome ? (
                    <Callout tone="info" glyph="clock" title={`Clock moved to ${formatTime(outcome.world.now)}`}>
                      Anything proposed earlier may now be ready, or expired.
                    </Callout>
                  ) : null}
                  <div className="button-row">
                    {idx < total - 1 ? (
                      <Button id="step-next" variant="primary" onClick={goNext}>
                        Next step
                        <Glyph kind="arrow-right" size={14} />
                      </Button>
                    ) : null}
                    {step.do === 'tx' && worldBefore ? (
                      <Button id="step-try" onClick={() => onTry(worldBefore, step.tx, scenario.title)}>
                        Try it in the Sandbox
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </article>
          ) : (
            <p className="muted">This scenario has no steps.</p>
          )}
          {finished ? (
            <section className="panel lesson" aria-labelledby="lesson-title">
              <p className="overline">Lesson</p>
              <h2 className="step-title" id="lesson-title">
                What this shows
              </h2>
              <p className="lesson-text">{scenario.lesson}</p>
              <div className="button-row">
                {next ? (
                  <Button id="scenario-next" variant="primary" onClick={() => onOpen(next.id)}>
                    Next: {next.title}
                    <Glyph kind="arrow-right" size={14} />
                  </Button>
                ) : null}
                <Button
                  id="scenario-restart"
                  onClick={() => {
                    setRan(0)
                    setCurrent(0)
                  }}
                >
                  Start again
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
