/** Scenarios: the learning path by chapter, and a step-by-step walk through one scenario. */
import { useEffect, useMemo, useState } from 'react'
import type { Scenario, StepOutcome, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { CHAPTERS } from '../lib/content.ts'
import { describeExpectation } from '../lib/describe.ts'
import { formatDuration, formatTime, plural } from '../lib/format.ts'
import { runLine } from '../lib/runline.ts'
import { keysOf } from '../lib/sharpEdges.ts'
import { load, save } from '../lib/storage.ts'
import { CHAPTER_CHALLENGES } from '../../content/paths.ts'
import { CHALLENGES, SCENARIOS } from '../generated/content.ts'
import { ResultView, TxSummary } from '../components/Result.tsx'
import {
  BalancesSection,
  Clock,
  GuardsSection,
  ModulesSection,
  OwnersSection,
  PendingChanges,
  RuleTable,
  Section
} from '../components/Safe.tsx'
import { TermScope, Termed } from '../components/Terms.tsx'
import { Button, Callout, Checkbox, CopyLink, Glyph, Status } from '../components/ui.tsx'

export interface ChapterGroup {
  id: string
  title: string
  blurb: string
  number: number
  items: Scenario[]
}

export function chaptersWithScenarios(): ChapterGroup[] {
  const known = CHAPTERS.map((c) => ({
    ...c,
    items: SCENARIOS.filter((s) => s.chapter === c.id || s.chapter === c.title)
  }))
  const used = new Set(known.flatMap((c) => c.items.map((s) => s.id)))
  const extra = new Map<string, Scenario[]>()
  for (const s of SCENARIOS.filter((x) => !used.has(x.id))) extra.set(s.chapter, [...(extra.get(s.chapter) ?? []), s])
  return [
    ...known.filter((c) => c.items.length > 0),
    ...[...extra.entries()].map(([id, items]) => ({ id, title: id, blurb: '', items }))
  ].map((c, i) => ({
    ...c,
    number: i + 1
  }))
}

/** The challenges that practise a chapter, as found in the published content. */
export function chapterChallenges(chapterId: string) {
  return (CHAPTER_CHALLENGES[chapterId] ?? [])
    .map((id) => CHALLENGES.find((c) => c.id === id))
    .filter((c): c is (typeof CHALLENGES)[number] => !!c)
}

function markDone(id: string) {
  const done = { ...(load().scenariosDone ?? {}), [id]: true as const }
  save({ scenariosDone: done })
}

export function ScenarioList({ onOpen }: { onOpen: (id: string) => void }) {
  const chapters = chaptersWithScenarios()
  const stored = load()
  const done = stored.scenariosDone ?? {}
  const last = stored.lastScenario
  const lastScenario = last ? SCENARIOS.find((s) => s.id === last.id) : undefined
  const total = SCENARIOS.length
  const doneCount = SCENARIOS.filter((s) => done[s.id]).length
  return (
    <div className="view">
      <header className="view-head">
        <p className="overline">Guided</p>
        <h1 className="page-title">Scenarios</h1>
        <p className="lead">
          Each scenario sets up a Safe and walks through a few transactions, one step at a time. Guess the outcome, run
          each step, and read why it passed or was blocked.
        </p>
        {total > 0 ? (
          <p className="muted small tnum">
            {doneCount} of {total} scenarios done
          </p>
        ) : null}
        {lastScenario && !done[lastScenario.id] ? (
          <p>
            <a
              className="continue-link"
              id="continue-link"
              href={`#scenario-${lastScenario.id}-step-${Math.min(last!.step, lastScenario.steps.length)}`}
            >
              Continue where you left off: {lastScenario.title}, step {Math.min(last!.step, lastScenario.steps.length)}
              <Glyph kind="arrow-right" size={14} />
            </a>
          </p>
        ) : null}
      </header>
      {chapters.length === 0 ? <p className="muted">No scenarios are published yet.</p> : null}
      {chapters.map((c) => {
        const count = c.items.filter((s) => done[s.id]).length
        const practise = chapterChallenges(c.id)
        return (
          <section key={c.id} className="chapter" aria-labelledby={`chapter-${c.number}`}>
            <div className="chapter-head">
              <h2 className="chapter-title" id={`chapter-${c.number}`}>
                <span className="chapter-index tnum">{c.number}</span>
                {c.title}
                <span className="chapter-count tnum">
                  {count} of {c.items.length} done
                </span>
              </h2>
              {c.blurb ? <p className="muted">{c.blurb}</p> : null}
            </div>
            <ul className="card-grid">
              {c.items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    id={`scenario-${s.id}`}
                    className={`card card-button${done[s.id] ? ' is-done' : ''}`}
                    onClick={() => onOpen(s.id)}
                  >
                    <span className="card-title">{s.title}</span>
                    <span className="card-text">{s.summary}</span>
                    <span className="card-meta">
                      {done[s.id] ? <Status status="pass" label="Done" compact /> : null}
                      <span>{plural(s.steps.length, 'step')}</span>
                      <Glyph kind="arrow-right" size={14} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {practise.length > 0 ? (
              <p className="practise">
                <span className="muted">Practise this chapter: </span>
                {practise.map((ch, i) => (
                  <span key={ch.id}>
                    {i > 0 ? ', ' : ''}
                    <a href={`#challenge-${ch.id}`}>{ch.title}</a>
                  </span>
                ))}
              </p>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function stepStatus(o: StepOutcome | undefined, ran: boolean): { status: string; label: string } {
  if (!ran || !o) return { status: 'none', label: 'Not run' }
  if (o.step.do === 'wait') return { status: 'info', label: 'Waited' }
  if (o.matches === false) return { status: 'warn', label: 'Unexpected' }
  return o.result?.ok ? { status: 'pass', label: 'Allowed' } : { status: 'fail', label: 'Blocked' }
}

type Guess = 'pass' | 'block'

function stepLink(id: string, n: number): string {
  return `#scenario-${id}-step-${n}`
}

export function ScenarioView({
  scenario,
  step: initialStep,
  onBack,
  onOpen,
  onTry
}: {
  scenario: Scenario
  /** 1-based step from the link. */
  step?: number
  onBack: () => void
  onOpen: (id: string) => void
  onTry: (world: World, tx: TxSpec) => void
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
  const total = scenario.steps.length
  const start = Math.max(0, Math.min((initialStep ?? 1) - 1, total - 1))
  const [ran, setRan] = useState(start) // steps before the linked one count as run
  const [current, setCurrent] = useState(start)
  const [guesses, setGuesses] = useState<Record<number, Guess | 'skip'>>({})
  const [skipGuess, setSkipGuess] = useState(() => Boolean(load().skipGuess))
  const [focusN, setFocusN] = useState(0)

  const idx = Math.min(current, total - 1)
  const step = scenario.steps[idx]
  const outcome = run.outcomes[idx]
  const isRun = idx < ran
  const worldBefore = idx === 0 ? run.initial : (run.outcomes[idx - 1]?.world ?? run.initial)
  const shown = isRun ? (outcome?.world ?? worldBefore) : worldBefore
  const finished = ran >= total
  const pos = SCENARIOS.findIndex((s) => s.id === scenario.id)
  const next = pos >= 0 ? SCENARIOS[pos + 1] : undefined
  const chapter = CHAPTERS.find((c) => c.id === scenario.chapter)
  const chapterItems = SCENARIOS.filter((s) => s.chapter === scenario.chapter)
  const lastOfChapter = chapterItems[chapterItems.length - 1]?.id === scenario.id
  const practise = chapterChallenges(scenario.chapter)
  const seenKeys = useMemo(() => keysOf([run.initial, ...run.outcomes.slice(0, idx).map((o) => o.world)]), [run, idx])

  // Keep the address on the current step, so it can be copied and shared.
  useEffect(() => {
    try {
      const hash = stepLink(scenario.id, idx + 1)
      if (location.hash !== hash) history.replaceState(null, '', hash)
    } catch {
      // the frame may not allow it; the step link below still works
    }
    save({ lastScenario: { id: scenario.id, step: idx + 1 } })
  }, [scenario.id, idx])

  useEffect(() => {
    if (finished) markDone(scenario.id)
  }, [finished, scenario.id])

  const runStep = (guess?: Guess) => {
    if (idx !== ran) return
    setGuesses((g) => ({ ...g, [idx]: guess ?? 'skip' }))
    setRan(ran + 1)
    setFocusN((n) => n + 1)
  }
  const goNext = () => setCurrent(Math.min(idx + 1, total - 1))
  const toggleSkip = (v: boolean) => {
    setSkipGuess(v)
    save({ skipGuess: v })
  }
  const guess = guesses[idx]
  const asking = step?.do === 'tx' && !isRun && !skipGuess

  return (
    <div className="view">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="link-button" id="scenario-back" onClick={onBack}>
          Scenarios
        </button>
        <span aria-hidden="true">/</span>
        <span>{chapter?.title ?? scenario.chapter}</span>
      </nav>
      <TermScope>
        <header className="view-head">
          <p className="overline">Scenario {pos + 1}</p>
          <h1 className="page-title">{scenario.title}</h1>
          <p className="lead">
            <Termed text={scenario.summary} />
          </p>
        </header>
      </TermScope>
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
                    <button
                      type="button"
                      id={`step-${i}`}
                      className="step-button"
                      disabled={!reachable}
                      onClick={() => setCurrent(i)}
                      aria-current={i === idx ? 'step' : undefined}
                    >
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
                <span className="muted small">
                  {isRun ? `after step ${idx + 1}` : idx === 0 ? 'at the start' : `before step ${idx + 1}`}
                </span>
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
            <TermScope key={idx}>
              <article className="panel step-card" aria-labelledby="step-title">
                <div className="step-card-head">
                  <p className="overline">
                    Step {idx + 1} of {total}
                  </p>
                  <CopyLink id="step-link" label="Copy link to this step" fragment={stepLink(scenario.id, idx + 1)} />
                </div>
                <h2 className="step-title" id="step-title">
                  {step.label}
                </h2>
                {step.note && !asking ? (
                  <p className="step-note">
                    <Termed text={step.note} />
                  </p>
                ) : null}
                {step.do === 'tx' && worldBefore ? <TxSummary world={worldBefore} tx={step.tx} /> : null}
                {step.do === 'tx' && !asking && !isRun ? (
                  <p className="expect">
                    <span className="muted">Expected: </span>
                    <strong>{describeExpectation(step.expect)}</strong>
                  </p>
                ) : null}
                {step.do === 'wait' ? (
                  <p className="expect">
                    <Glyph kind="clock" size={16} /> The clock moves forward by{' '}
                    <strong>{formatDuration(step.seconds)}</strong>.
                  </p>
                ) : null}
                {!isRun ? (
                  asking ? (
                    <div className="guess" role="group" aria-labelledby="guess-q">
                      <p className="guess-q" id="guess-q">
                        Will it be allowed or blocked?
                      </p>
                      <div className="button-row">
                        <Button id="guess-pass" size="lg" onClick={() => runStep('pass')} disabled={!outcome}>
                          <Glyph kind="pass" size={16} />
                          Allowed
                        </Button>
                        <Button id="guess-block" size="lg" onClick={() => runStep('block')} disabled={!outcome}>
                          <Glyph kind="fail" size={16} />
                          Blocked
                        </Button>
                        <button
                          type="button"
                          className="link-button"
                          id="guess-skip"
                          onClick={() => runStep()}
                          disabled={!outcome}
                        >
                          Run without guessing
                        </button>
                      </div>
                      <Checkbox
                        id="guess-off"
                        checked={skipGuess}
                        onChange={toggleSkip}
                        label="Skip guessing from now on"
                        hint="Guesses are never scored."
                      />
                    </div>
                  ) : (
                    <div className="button-row">
                      <Button
                        id="step-run"
                        variant="primary"
                        size="lg"
                        onClick={() => runStep()}
                        disabled={idx !== ran || !outcome}
                      >
                        Run this step
                      </Button>
                      {step.do === 'tx' && worldBefore ? (
                        <Button id="step-try" onClick={() => onTry(worldBefore, step.tx)}>
                          Try it in the Sandbox
                        </Button>
                      ) : null}
                      {step.do === 'tx' && skipGuess ? (
                        <Checkbox id="guess-off" checked={skipGuess} onChange={toggleSkip} label="Skip guessing" />
                      ) : null}
                    </div>
                  )
                ) : (
                  <div className="step-result">
                    {step.do === 'tx' && outcome?.result && worldBefore ? (
                      <>
                        {guess === 'pass' || guess === 'block' ? (
                          <p className="reveal" id="guess-reveal">
                            You said <strong>{guess === 'pass' ? 'Allowed' : 'Blocked'}</strong>. It was{' '}
                            <strong>
                              {runLine(outcome.result, step.tx.path ?? 'owner').text.replace(' at ', ', at ')}
                            </strong>
                            .
                          </p>
                        ) : null}
                        <p className="expect">
                          <span className="muted">Expected: </span>
                          <strong>{describeExpectation(step.expect)}</strong>
                          {outcome.matches === false ? null : <Status status="pass" label="Matches" compact />}
                        </p>
                        {outcome.matches === false ? (
                          <Callout tone="danger" title="The simulator disagrees with this scenario">
                            {outcome.mismatch ?? 'The result does not match the expected outcome.'}
                          </Callout>
                        ) : null}
                        <ResultView
                          result={outcome.result}
                          tx={step.tx}
                          world={worldBefore}
                          animate
                          headingLevel={3}
                          showSummary={false}
                          seenKeys={seenKeys}
                          here={scenario.id}
                          decided={{ world: worldBefore, inline: true }}
                          verdictId="scenario-verdict"
                          focusVerdict={focusN}
                        />
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
                        <Button id="step-try" onClick={() => onTry(worldBefore, step.tx)}>
                          Try it in the Sandbox
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </article>
            </TermScope>
          ) : (
            <p className="muted">This scenario has no steps.</p>
          )}
          {finished ? (
            <TermScope>
              <section className="panel lesson" aria-labelledby="lesson-title">
                <p className="overline">Lesson</p>
                <h2 className="step-title" id="lesson-title">
                  What this shows
                </h2>
                <p className="lesson-text">
                  <Termed text={scenario.lesson} />
                </p>
                {lastOfChapter && practise.length > 0 ? (
                  <div className="practise-box">
                    <p className="overline">Practise this</p>
                    <ul className="practise-list">
                      {practise.map((ch) => (
                        <li key={ch.id}>
                          <a href={`#challenge-${ch.id}`} id={`practise-${ch.id}`}>
                            {ch.title}
                          </a>
                          <span className="muted small"> · challenge, {plural(ch.tests.length, 'test')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
                      setGuesses({})
                    }}
                  >
                    Start again
                  </Button>
                </div>
              </section>
            </TermScope>
          ) : null}
        </div>
      </div>
    </div>
  )
}
