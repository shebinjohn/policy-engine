/** Challenges: levels with stars, and a rule-table puzzle with tests, hints and a solution. */
import { useMemo, useState } from 'react'
import type { Challenge, ChallengeReport, RuleSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { errorInfo, innermost, policyLabel } from '../lib/content.ts'
import { describeCall, describeWho } from '../lib/describe.ts'
import { plural } from '../lib/format.ts'
import { load, save } from '../lib/storage.ts'
import { CHALLENGES } from '../generated/content.ts'
import { ResultView } from '../components/Result.tsx'
import { RuleEditor } from '../components/RuleEditor.tsx'
import { GuardsSection, ModulesSection, OwnersSection, BalancesSection, RuleSpecList } from '../components/Safe.tsx'
import { Button, Callout, Glyph, Pill, Stars, Status } from '../components/ui.tsx'

export function useProgress(): [Record<string, { stars: number }>, (id: string, stars: number) => void] {
  const [progress, setProgress] = useState(() => load().progress ?? {})
  const record = (id: string, stars: number) => {
    const prev = progress[id]?.stars ?? 0
    if (stars <= prev) return
    const next = { ...progress, [id]: { stars, solvedAt: Date.now() } }
    setProgress(next)
    save({ progress: next })
  }
  return [progress, record]
}

export function ChallengeList({ onOpen, progress }: { onOpen: (id: string) => void; progress: Record<string, { stars: number }> }) {
  const total = CHALLENGES.length * 3
  const earned = CHALLENGES.reduce((n, c) => n + (progress[c.id]?.stars ?? 0), 0)
  return (
    <div className="view">
      <header className="view-head">
        <p className="overline">Puzzles</p>
        <h1 className="page-title">Challenges</h1>
        <p className="lead">
          Write the rules. Each level describes what a team wants to allow and block, with tests that check your rules. Fewer rules earn more stars.
        </p>
        {CHALLENGES.length > 0 ? (
          <p className="muted small tnum">
            {earned} of {total} stars earned
          </p>
        ) : null}
      </header>
      {CHALLENGES.length === 0 ? <p className="muted">No challenges are published yet.</p> : null}
      <ul className="card-grid">
        {CHALLENGES.map((c) => {
          const stars = progress[c.id]?.stars ?? 0
          return (
            <li key={c.id}>
              <button type="button" id={`challenge-${c.id}`} className="card card-button" onClick={() => onOpen(c.id)}>
                <span className="card-eyebrow tnum">Level {c.level}</span>
                <span className="card-title">{c.title}</span>
                <span className="card-text clamp-3">{c.brief}</span>
                <span className="card-meta">
                  <Stars count={stars} />
                  <span>{stars > 0 ? 'Solved' : `${plural(c.tests.length, 'test')}`}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const SOLUTION_AFTER = 3

export function ChallengeView({
  challenge,
  onBack,
  onOpen,
  onSolved,
  bestStars
}: {
  challenge: Challenge
  onBack: () => void
  onOpen: (id: string) => void
  onSolved: (id: string, stars: number) => void
  bestStars: number
}) {
  const start = challenge.setup.rules ?? []
  const [rules, setRules] = useState<RuleSpec[]>(start)
  const [report, setReport] = useState<ChallengeReport | null>(null)
  const [runError, setRunError] = useState('')
  const [attempts, setAttempts] = useState(0)
  const [hints, setHints] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [solution, setSolution] = useState(false)
  const [runs, setRuns] = useState(0)

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

  const runTests = () => {
    try {
      const r = engine.runChallenge(challenge, rules)
      setReport(r)
      setRunError('')
      setRuns((n) => n + 1)
      if (r.solved) onSolved(challenge.id, r.stars)
      else setAttempts((a) => a + 1)
      setOpen(null)
    } catch (e) {
      setRunError((e as Error).message)
    }
  }

  const changeRules = (next: RuleSpec[]) => {
    setRules(next)
    setEditing(null)
  }

  const pos = CHALLENGES.findIndex((c) => c.id === challenge.id)
  const next = CHALLENGES[pos + 1]
  if (!base) return <Callout tone="danger" title="This challenge could not be set up" />

  const passing = report ? report.results.filter((r) => r.matches).length : 0
  const setupErr = report?.setupError

  return (
    <div className="view">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="link-button" id="challenge-back" onClick={onBack}>
          Challenges
        </button>
        <span aria-hidden="true">/</span>
        <span className="tnum">Level {challenge.level}</span>
      </nav>
      <header className="view-head">
        <p className="overline tnum">Level {challenge.level}</p>
        <h1 className="page-title">{challenge.title}</h1>
        <p className="lead">{challenge.brief}</p>
        <p className="muted small">
          Par: <strong className="tnum">{plural(challenge.parRules, 'rule')}</strong> for three stars.
          {bestStars > 0 ? (
            <>
              {' '}
              Your best: <Stars count={bestStars} />
            </>
          ) : null}
        </p>
      </header>

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
                onSave={(r) => changeRules(editing === 'new' ? [...rules, r] : rules.map((x, j) => (j === editing ? r : x)))}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="button-row">
                <Button id="challenge-add" onClick={() => setEditing('new')}>
                  <Glyph kind="plus" size={14} />
                  Add rule
                </Button>
                <Button id="challenge-reset" variant="ghost" onClick={() => changeRules(start)} disabled={JSON.stringify(rules) === JSON.stringify(start)}>
                  Back to the starting rules
                </Button>
              </div>
            )}
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
              {report ? (
                <span className="tnum small">
                  {passing} of {report.results.length} pass
                </span>
              ) : (
                <span className="muted small">{challenge.testMode === 'sequence' ? 'Run in order on one Safe' : 'Each on a fresh copy of the Safe'}</span>
              )}
            </div>
            <div className="button-row">
              <Button id="challenge-run" variant="primary" size="lg" onClick={runTests}>
                Run tests
              </Button>
            </div>
            {runError ? <Callout tone="danger" title="The tests could not run">{runError}</Callout> : null}
            {setupErr ? (
              <Callout tone="danger" title={`Your rules could not be set up: ${errorInfo(innermost(setupErr).error.error, innermost(setupErr).policy)?.title ?? setupErr.error}`}>
                {setupErr.message}
              </Callout>
            ) : null}
            {report?.solved ? (
              <div className="solved" role="status">
                <Stars count={report.stars} />
                <div>
                  <p className="solved-title">Solved with {plural(report.ruleCount, 'rule')}</p>
                  <p className="small">
                    {report.stars === 3
                      ? 'Within par. Full marks.'
                      : `Par is ${challenge.parRules}. Try it with fewer rules for more stars.`}
                  </p>
                </div>
              </div>
            ) : null}
            <ol className="tests" key={runs}>
              {challenge.tests.map((t, i) => {
                const r = report?.results[i]
                const isOpen = open === i && r
                return (
                  <li key={i} className={`test${r ? (r.matches ? ' is-match' : ' is-miss') : ''}`}>
                    <button
                      type="button"
                      id={`test-${i}`}
                      className="test-button"
                      onClick={() => setOpen(open === i ? null : i)}
                      disabled={!r}
                      aria-expanded={r ? Boolean(isOpen) : undefined}
                    >
                      <span className="test-index tnum">{i + 1}</span>
                      <span className="test-main">
                        <span className="test-label">{t.label}</span>
                        <span className="test-sub muted small">
                          {describeWho(base, t.tx)}: {describeCall(base, t.tx)}
                        </span>
                      </span>
                      <span className="test-verdicts">
                        <span className="test-want">
                          <span className="muted small">Want</span>
                          <Pill tone="neutral">{t.want === 'pass' ? 'Allowed' : 'Blocked'}</Pill>
                        </span>
                        <span className="test-got">
                          <span className="muted small">Got</span>
                          {r ? <Pill tone={r.verdict === 'pass' ? 'success' : 'danger'}>{r.verdict === 'pass' ? 'Allowed' : 'Blocked'}</Pill> : <Pill tone="muted">Not run</Pill>}
                        </span>
                        {r ? <Status status={r.matches ? 'pass' : 'fail'} label={r.matches ? 'Right' : 'Wrong'} compact /> : null}
                      </span>
                    </button>
                    {isOpen && r && configured ? (
                      <div className="test-trace">
                        <ResultView result={r.result} tx={t.tx} world={configured} headingLevel={4} />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
            {report ? <p className="muted small">Select a test to see its decision path.</p> : null}
          </div>

          {report?.solved ? (
            <section className="panel lesson" aria-labelledby="explain-title">
              <p className="overline">Why this works</p>
              <h2 className="step-title" id="explain-title">
                {challenge.title}
              </h2>
              <p className="lesson-text">{challenge.explain}</p>
              {next ? (
                <div className="button-row">
                  <Button id="challenge-next" variant="primary" onClick={() => onOpen(next.id)}>
                    Next level: {next.title}
                    <Glyph kind="arrow-right" size={14} />
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Hints</h2>
              <span className="muted small tnum">
                {hints} of {challenge.hints.length} shown
              </span>
            </div>
            {hints > 0 ? (
              <ol className="hints">
                {challenge.hints.slice(0, hints).map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            ) : (
              <p className="muted small">Stuck? Reveal one hint at a time.</p>
            )}
            <div className="button-row">
              <Button id="hint-next" size="sm" onClick={() => setHints(hints + 1)} disabled={hints >= challenge.hints.length}>
                {hints === 0 ? 'Show a hint' : 'Show another hint'}
              </Button>
              {attempts >= SOLUTION_AFTER || solution ? (
                <Button id="solution-show" size="sm" variant="ghost" onClick={() => setSolution(!solution)}>
                  {solution ? 'Hide the solution' : 'Show the solution'}
                </Button>
              ) : (
                <span className="muted small">The solution unlocks after {plural(SOLUTION_AFTER - attempts, 'more failed run')}.</span>
              )}
            </div>
            {solution ? (
              <div className="solution">
                <p className="field-label">One solution, {plural(challenge.solution.length, 'rule')}</p>
                <RuleSpecList world={base} rules={challenge.solution} />
                <Button id="solution-use" size="sm" onClick={() => changeRules(challenge.solution)}>
                  Use these rules
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
