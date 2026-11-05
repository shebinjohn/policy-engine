/** Challenges: numbered puzzles with stars, a rule editor, tests, a hint ladder and a solution. */
import { useMemo, useRef, useState } from 'react'
import type { Challenge, ChallengeReport, ChallengeTestResult, RuleSpec, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { errorInfo, innermost, policyLabel } from '../lib/content.ts'
import { describeCall, describeWho } from '../lib/describe.ts'
import { plural } from '../lib/format.ts'
import { runLine } from '../lib/runline.ts'
import { load, save } from '../lib/storage.ts'
import type { ChallengeProgress } from '../lib/storage.ts'
import { CHALLENGE_TEACHER, chapterOfChallenge } from '../../content/paths.ts'
import { CHALLENGES, SCENARIOS } from '../generated/content.ts'
import { ResultView } from '../components/Result.tsx'
import { RuleEditor } from '../components/RuleEditor.tsx'
import { BalancesSection, GuardsSection, ModulesSection, OwnersSection, RuleSpecList } from '../components/Safe.tsx'
import { TermScope, Termed } from '../components/Terms.tsx'
import { Button, Callout, Glyph, Pill, Stars, Status } from '../components/ui.tsx'
import { chaptersWithScenarios } from './Scenarios.tsx'

export type Progress = Record<string, ChallengeProgress>

export function useProgress(): [Progress, (id: string, entry: ChallengeProgress) => void] {
  const [progress, setProgress] = useState<Progress>(() => load().progress ?? {})
  const record = (id: string, entry: ChallengeProgress) => {
    const prev = progress[id]
    let next: ChallengeProgress
    if (!prev) next = entry
    else if (entry.stars > prev.stars) next = entry
    else if (entry.stars === prev.stars && entry.stars > 0 && (entry.rules ?? 99) < (prev.rules ?? 99))
      next = { ...prev, rules: entry.rules }
    else return
    const all = { ...progress, [id]: { ...next, solvedAt: Date.now() } }
    setProgress(all)
    save({ progress: all })
  }
  return [progress, record]
}

function chapterOf(challengeId: string): { number: number; title: string } | null {
  const id = chapterOfChallenge(challengeId)
  if (!id) return null
  const c = chaptersWithScenarios().find((x) => x.id === id)
  return c ? { number: c.number, title: c.title } : null
}

function ProgressLine({ p, par }: { p?: ChallengeProgress; par: number }) {
  if (!p) return null
  if (p.stars > 0)
    return (
      <span className="progress-line">
        <Stars count={p.stars} />
        <span>
          Solved in {plural(p.rules ?? par, 'rule')}, par {par}
        </span>
      </span>
    )
  if (p.withSolution) return <span className="progress-line muted">Solved with the shown solution</span>
  return null
}

export function ChallengeList({ onOpen, progress }: { onOpen: (id: string) => void; progress: Progress }) {
  const total = CHALLENGES.length * 3
  const earned = CHALLENGES.reduce((n, c) => n + (progress[c.id]?.stars ?? 0), 0)
  return (
    <div className="view">
      <header className="view-head">
        <p className="overline">Puzzles</p>
        <h1 className="page-title">Challenges</h1>
        <p className="lead">
          Write the rules. Each challenge describes what a team wants to allow and block, with tests that check your
          rules. Fewer rules earn more stars. Nothing is locked: start anywhere.
        </p>
        {CHALLENGES.length > 0 ? (
          <p className="muted small tnum">
            {earned} of {total} stars earned
          </p>
        ) : null}
      </header>
      {CHALLENGES.length === 0 ? <p className="muted">No challenges are published yet.</p> : null}
      <ul className="card-grid">
        {CHALLENGES.map((c, i) => {
          const p = progress[c.id]
          const ch = chapterOf(c.id)
          return (
            <li key={c.id}>
              <button
                type="button"
                id={`challenge-${c.id}`}
                className={`card card-button${p ? ' is-done' : ''}`}
                onClick={() => onOpen(c.id)}
              >
                <span className="card-eyebrow tnum">
                  Challenge {i + 1}
                  {ch ? ` · Builds on chapter ${ch.number}` : ''}
                </span>
                <span className="card-title">{c.title}</span>
                <span className="card-text clamp-3">{c.brief}</span>
                <span className="card-meta">
                  {p ? <ProgressLine p={p} par={c.parRules} /> : <span>{plural(c.tests.length, 'test')}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The first rung of the hint ladder: the first failing test and where it stopped. */
function firstHint(results: ChallengeTestResult[], preview: boolean): string {
  const i = results.findIndex((r) => !r.matches)
  if (i < 0)
    return preview
      ? 'Every test gives the right answer now. Run the tests to count it.'
      : 'Every test gives the right answer.'
  const r = results[i]
  const name = `Test ${i + 1}, “${r.test.label}”,`
  if (r.verdict === 'pass') {
    const m = r.result.matched
    const by = m
      ? `${policyLabel(m.policy)} let it through${m.isFallback ? ' as the catch-all rule' : ''}.`
      : r.result.trace.some((e) => e.id === 'safe.noGuard')
        ? 'No guard checked it.'
        : 'Nothing in your rules stopped it.'
    return `${name} should be blocked but was allowed. ${by}`
  }
  const line = runLine(r.result, r.test.tx.path ?? 'owner')
  return `${name} should be allowed but was ${line.word.toLowerCase()}${line.stage ? ` at ${line.stage}: ${line.why}` : ''}.`
}

type Rung = { kind: 'first' } | { kind: 'hint'; text: string } | { kind: 'scenario'; id: string } | { kind: 'solution' }

export function ChallengeView({
  challenge,
  onBack,
  onOpen,
  onSolved,
  progress,
  onOpenInSandbox
}: {
  challenge: Challenge
  onBack: () => void
  onOpen: (id: string) => void
  onSolved: (id: string, entry: ChallengeProgress) => void
  progress?: ChallengeProgress
  onOpenInSandbox: (world: World, tx: TxSpec) => void
}) {
  const start = challenge.setup.rules ?? []
  const [rules, setRules] = useState<RuleSpec[]>(start)
  const [counted, setCounted] = useState<ChallengeReport | null>(null)
  const [preview, setPreview] = useState<ChallengeReport | null>(null)
  const [runError, setRunError] = useState('')
  const [failedRuns, setFailedRuns] = useState(0)
  const [runs, setRuns] = useState(0)
  const [rungs, setRungs] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [usedSolution, setUsedSolution] = useState(false)
  const summaryRef = useRef<HTMLParagraphElement>(null)

  const base: World | null = useMemo(() => {
    try {
      return engine.createWorld({ ...challenge.setup, rules: [] })
    } catch {
      try {
        return engine.createWorld({})
      } catch {
        return null
      }
    }
  }, [challenge])

  const configured: World | null = useMemo(() => {
    try {
      return engine.createWorld({ ...challenge.setup, rules })
    } catch {
      return base
    }
  }, [challenge, rules, base])

  const index = CHALLENGES.findIndex((c) => c.id === challenge.id)
  const next = CHALLENGES[index + 1]
  const ch = chapterOf(challenge.id)
  const teacher = CHALLENGE_TEACHER[challenge.id]
  const teacherScenario = teacher ? SCENARIOS.find((s) => s.id === teacher) : undefined
  const ladder: Rung[] = [
    { kind: 'first' },
    ...challenge.hints.map((text) => ({ kind: 'hint' as const, text })),
    ...(teacherScenario ? [{ kind: 'scenario' as const, id: teacherScenario.id }] : []),
    { kind: 'solution' }
  ]

  const changeRules = (nextRules: RuleSpec[], fromSolution = false) => {
    setRules(nextRules)
    setEditing(null)
    if (fromSolution) setUsedSolution(true)
    try {
      setPreview(engine.runChallenge(challenge, nextRules))
    } catch {
      setPreview(null)
    }
  }

  const runTests = () => {
    try {
      const r = engine.runChallenge(challenge, rules)
      setCounted(r)
      setPreview(null)
      setRunError('')
      setRuns((n) => n + 1)
      if (r.solved)
        onSolved(challenge.id, usedSolution ? { stars: 0, withSolution: true } : { stars: r.stars, rules: r.ruleCount })
      else setFailedRuns((a) => a + 1)
      setOpen(null)
      requestAnimationFrame(() => summaryRef.current?.focus())
    } catch (e) {
      setRunError((e as Error).message)
    }
  }

  if (!base) return <Callout tone="danger" title="This challenge could not be set up" />

  const report = preview ?? counted
  const isPreview = preview !== null
  const passing = report ? report.results.filter((r) => r.matches).length : 0
  const setupErr = report?.setupError
  const solvedNow = !isPreview && counted?.solved
  const nextRung = ladder[rungs]
  const solutionLocked = nextRung?.kind === 'solution' && runs === 0

  return (
    <div className="view">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="link-button" id="challenge-back" onClick={onBack}>
          Challenges
        </button>
        <span aria-hidden="true">/</span>
        <span className="tnum">Challenge {index + 1}</span>
      </nav>
      <TermScope>
        <header className="view-head">
          <p className="overline tnum">
            Challenge {index + 1} of {CHALLENGES.length}
            {ch ? (
              <>
                {' · '}
                <a href={`#scenarios`} className="overline-link">
                  Builds on chapter {ch.number}: {ch.title}
                </a>
              </>
            ) : null}
          </p>
          <h1 className="page-title">{challenge.title}</h1>
          <p className="lead">
            <Termed text={challenge.brief} />
          </p>
          <p className="muted small">
            Par: <strong className="tnum">{plural(challenge.parRules, 'rule')}</strong> for three stars.{' '}
            {progress ? <ProgressLine p={progress} par={challenge.parRules} /> : null}
          </p>
        </header>
      </TermScope>

      <div className="challenge-grid">
        <div className="challenge-rules">
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Your rules</h2>
              <span className="muted small tnum">
                {plural(rules.length, 'rule')} · par {challenge.parRules}
              </span>
            </div>
            <RuleSpecList
              world={base}
              rules={rules}
              empty="No rules yet. With the guards on, every transaction is blocked."
              actions={(_, i) => (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => changeRules(rules.filter((__, j) => j !== i))}>
                    Remove
                  </Button>
                </>
              )}
            />
            {editing !== null ? (
              <RuleEditor
                key={String(editing)}
                world={base}
                initial={editing === 'new' ? undefined : rules[editing]}
                allowedPolicies={challenge.allowedPolicies}
                idPrefix="challenge-rule"
                title={editing === 'new' ? 'New rule' : `Edit rule ${editing + 1}`}
                onSave={(r) =>
                  changeRules(editing === 'new' ? [...rules, r] : rules.map((x, j) => (j === editing ? r : x)))
                }
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="button-row">
                <Button id="challenge-add" onClick={() => setEditing('new')}>
                  <Glyph kind="plus" size={14} />
                  Add rule
                </Button>
                <Button
                  id="challenge-reset"
                  variant="ghost"
                  onClick={() => {
                    changeRules(start)
                    setUsedSolution(false)
                  }}
                  disabled={JSON.stringify(rules) === JSON.stringify(start) && !usedSolution}
                >
                  Back to the starting rules
                </Button>
              </div>
            )}
            {usedSolution ? (
              <p className="small text-warning">
                These rules came from the shown solution. Solving with them earns no stars.
              </p>
            ) : null}
            <p className="muted small">
              Policies you can use: {challenge.allowedPolicies.map((p) => policyLabel(p)).join(', ')}.
            </p>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">The Safe</h2>
            </div>
            <OwnersSection world={base} idPrefix="chl-" />
            <GuardsSection world={base} idPrefix="chl-" />
            <ModulesSection world={base} idPrefix="chl-" />
            <BalancesSection world={base} idPrefix="chl-" />
          </div>
        </div>

        <div className="challenge-tests">
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Tests</h2>
              <span className="muted small">
                {challenge.testMode === 'sequence' ? 'Run in order on one Safe' : 'Each on a fresh copy of the Safe'}
              </span>
            </div>
            <div className="button-row">
              <Button id="challenge-run" variant="primary" size="lg" onClick={runTests}>
                Run tests
              </Button>
              <span className="muted small">
                Each run counts. The answers below refresh as a preview whenever you change a rule.
              </span>
            </div>
            {report ? (
              <p className="tests-summary tnum" id="tests-summary" tabIndex={-1} ref={summaryRef}>
                {isPreview ? <Pill tone="info">Preview</Pill> : <Pill tone="neutral">Counted run {runs}</Pill>}
                <span>
                  {passing} of {report.results.length} tests give the right answer
                  {isPreview ? '. Run the tests to count it.' : '.'}
                </span>
              </p>
            ) : null}
            {runError ? (
              <Callout tone="danger" title="The tests could not run">
                {runError}
              </Callout>
            ) : null}
            {setupErr ? (
              <Callout
                tone="danger"
                title={`Your rules could not be set up: ${errorInfo(innermost(setupErr).error.error, innermost(setupErr).policy)?.title ?? setupErr.error}`}
              >
                {setupErr.message}
              </Callout>
            ) : null}
            {solvedNow && counted ? (
              <div className={`solved${usedSolution ? ' is-shown' : ''}`} role="status">
                {usedSolution ? <Glyph kind="pass" size={20} /> : <Stars count={counted.stars} />}
                <div>
                  <p className="solved-title">
                    {usedSolution
                      ? 'Solved with the shown solution'
                      : `Solved in ${plural(counted.ruleCount, 'rule')}, par ${challenge.parRules}`}
                  </p>
                  <p className="small">
                    {usedSolution
                      ? 'No stars for a shown solution. Write your own rules to earn them.'
                      : counted.stars === 3
                        ? 'Within par. Full marks.'
                        : 'Try it with fewer rules for more stars.'}
                  </p>
                </div>
              </div>
            ) : null}
            <ol className="tests">
              {challenge.tests.map((t, i) => {
                const r = report?.results[i]
                const isOpen = open === i && r
                const want = t.want === 'pass' ? 'Allowed' : 'Blocked'
                const got = r ? (r.verdict === 'pass' ? 'Allowed' : 'Blocked') : null
                const sentence = r
                  ? `Test ${i + 1}: ${t.label}. Want ${want}, got ${got}, ${r.matches ? 'right' : 'wrong'}${isPreview ? ', preview' : ''}.`
                  : `Test ${i + 1}: ${t.label}. Want ${want}. Not run yet.`
                return (
                  <li
                    key={i}
                    className={`test${r ? (r.matches ? ' is-match' : ' is-miss') : ''}${isPreview ? ' is-preview' : ''}`}
                  >
                    <button
                      type="button"
                      id={`test-${i}`}
                      className="test-button"
                      onClick={() => setOpen(open === i ? null : i)}
                      disabled={!r}
                      aria-expanded={r ? Boolean(isOpen) : undefined}
                      aria-label={sentence}
                    >
                      <span className="test-index tnum" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="test-main" aria-hidden="true">
                        <span className="test-label">{t.label}</span>
                        <span className="test-sub muted small">
                          {describeWho(base, t.tx)}: {describeCall(base, t.tx)}
                        </span>
                      </span>
                      <span className="test-verdicts" aria-hidden="true">
                        <span className="test-want">
                          <span className="muted small">Want</span>
                          <Pill tone="neutral">{want}</Pill>
                        </span>
                        <span className="test-got">
                          <span className="muted small">{isPreview ? 'Got, preview' : 'Got'}</span>
                          {r ? (
                            <Pill tone={r.verdict === 'pass' ? 'success' : 'danger'}>{got}</Pill>
                          ) : (
                            <Pill tone="muted">Not run</Pill>
                          )}
                        </span>
                        {r ? (
                          <Status status={r.matches ? 'pass' : 'fail'} label={r.matches ? 'Right' : 'Wrong'} compact />
                        ) : null}
                      </span>
                    </button>
                    {isOpen && r && configured ? (
                      <div className="test-trace">
                        <ResultView
                          result={r.result}
                          tx={t.tx}
                          world={configured}
                          headingLevel={4}
                          decided={{ world: configured, inline: true }}
                        />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
            {report ? <p className="muted small">Select a test to see its decision path.</p> : null}
          </div>

          {solvedNow ? (
            <section className="panel lesson" aria-labelledby="explain-title">
              <p className="overline">Why this works</p>
              <h2 className="step-title" id="explain-title">
                {challenge.title}
              </h2>
              <TermScope>
                <p className="lesson-text">
                  <Termed text={challenge.explain} />
                </p>
              </TermScope>
              <div className="button-row">
                {configured ? (
                  <Button id="challenge-sandbox" onClick={() => onOpenInSandbox(configured, challenge.tests[0].tx)}>
                    Open these rules in the Sandbox
                  </Button>
                ) : null}
                {next ? (
                  <Button id="challenge-next" variant="primary" onClick={() => onOpen(next.id)}>
                    Next: {next.title}
                    <Glyph kind="arrow-right" size={14} />
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Hints</h2>
              <span className="muted small tnum">
                {rungs} of {ladder.length} shown
              </span>
            </div>
            {rungs === 0 ? (
              <p className="muted small">
                Stuck? The first hint points at what goes wrong. Later ones teach, and the last one solves.
              </p>
            ) : null}
            <ol className="hints">
              {ladder.slice(0, rungs).map((rung, i) => (
                <li key={i} className={`hint is-${rung.kind}`}>
                  {rung.kind === 'first' ? (
                    <>
                      <span className="hint-label">Where it goes wrong</span>
                      <span id="hint-first">
                        {report
                          ? firstHint(report.results, isPreview)
                          : 'Run the tests, or change a rule, and this hint names the first test that gives the wrong answer.'}
                      </span>
                    </>
                  ) : null}
                  {rung.kind === 'hint' ? rung.text : null}
                  {rung.kind === 'scenario' && teacherScenario ? (
                    <>
                      <span className="hint-label">Learn the idea</span>
                      <span>
                        The scenario <a href={`#scenario-${teacherScenario.id}`}>{teacherScenario.title}</a> shows it
                        step by step.
                      </span>
                    </>
                  ) : null}
                  {rung.kind === 'solution' ? (
                    <div className="solution">
                      <span className="hint-label">One solution, {plural(challenge.solution.length, 'rule')}</span>
                      {base ? <RuleSpecList world={base} rules={challenge.solution} /> : null}
                      <div className="button-row">
                        <Button id="solution-use" size="sm" onClick={() => changeRules(challenge.solution, true)}>
                          Use these rules
                        </Button>
                        <span className="muted small">A run with the shown solution earns no stars.</span>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            {nextRung ? (
              <div className="button-row">
                <Button id="hint-next" size="sm" onClick={() => setRungs(rungs + 1)} disabled={solutionLocked}>
                  {nextRung.kind === 'solution'
                    ? 'Show the solution'
                    : nextRung.kind === 'scenario'
                      ? 'Show the scenario that teaches this'
                      : rungs === 0
                        ? 'Show a hint'
                        : 'Show the next hint'}
                </Button>
                {solutionLocked ? (
                  <span className="muted small">The solution unlocks after you run the tests once.</span>
                ) : null}
              </div>
            ) : null}
            {failedRuns > 0 && !solvedNow ? (
              <p className="muted small tnum">{plural(failedRuns, 'counted run')} so far</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
