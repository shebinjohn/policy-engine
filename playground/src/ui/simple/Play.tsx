/** Play (#play, #play-<id>): the challenges, simple and visual. The only challenge view. */
import { useMemo, useRef, useState } from 'react'
import type {
  Challenge,
  ChallengeReport,
  ChallengeTestResult,
  RuleSpec,
  TableEntry,
  TxSpec,
  World
} from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { policyLabel } from '../lib/content.ts'
import { ruleSpecFromEntry, sameRuleKey } from '../lib/describe.ts'
import { plural } from '../lib/format.ts'
import { plainCopy } from '../lib/plainCopy.ts'
import { simpleReason } from '../lib/simpleReason.ts'
import { whoWord } from '../lib/simpleWords.ts'
import { load, save } from '../lib/storage.ts'
import type { ChallengeProgress } from '../lib/storage.ts'
import { CHALLENGE_TEACHER } from '../../content/paths.ts'
import { CHALLENGES, SCENARIOS } from '../generated/content.ts'
import { Button, Glyph, Stars } from '../components/ui.tsx'
import { Answer } from './Answer.tsx'
import { Rulebook, TxCard } from './Pieces.tsx'
import { RowEditor } from './RowEditor.tsx'

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

export function PlayList({ progress }: { progress: Progress }) {
  const earned = CHALLENGES.reduce((n, c) => n + (progress[c.id]?.stars ?? 0), 0)
  return (
    <div className="simple">
      <header className="simple-head">
        <p className="overline">Play</p>
        <h1 className="simple-title">Write the Rulebook</h1>
        <p className="simple-lead">
          Each challenge is a team with a wish. Write rules so every test card gets the right answer. Fewer rules earn
          more stars.
        </p>
        {CHALLENGES.length ? (
          <p className="muted tnum">
            {earned} of {CHALLENGES.length * 3} stars
          </p>
        ) : null}
      </header>
      <ol className="play-grid">
        {CHALLENGES.map((c, i) => (
          <li key={c.id}>
            <a
              className={`play-card${progress[c.id] ? ' is-done' : ''}`}
              href={`#play-${c.id}`}
              id={`play-card-${c.id}`}
            >
              <span className="idea-n tnum">{i + 1}</span>
              <span className="idea-title">{plainCopy(c.title)}</span>
              <span className="idea-one clamp-3">{plainCopy(c.brief)}</span>
              <span className="play-meta">
                {progress[c.id] ? (
                  <ProgressLine p={progress[c.id]} par={c.parRules} />
                ) : (
                  <span className="muted">{plural(c.tests.length, 'test card')}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The first hint: the first wrong card, in plain words. */
function firstHint(results: ChallengeTestResult[], world: World, counted: boolean): string {
  const i = results.findIndex((r) => !r.matches)
  if (i < 0)
    return counted
      ? 'Every card gets the right answer.'
      : 'Every card gets the right answer now. Run the tests to count it.'
  const r = results[i]
  const why = simpleReason(r.result, r.test.tx, world)
  const label = plainCopy(r.test.label)
  return r.verdict === 'pass'
    ? `Card ${i + 1}, “${label}”, should be blocked but passed. ${why}`
    : `Card ${i + 1}, “${label}”, should pass but was blocked. ${why}`
}

type Rung = { kind: 'first' } | { kind: 'hint'; text: string } | { kind: 'scenario'; id: string } | { kind: 'solution' }

export function PlayView({
  challenge,
  onSolved,
  progress,
  onOpenAdvanced
}: {
  challenge: Challenge
  onSolved: (id: string, entry: ChallengeProgress) => void
  progress?: ChallengeProgress
  onOpenAdvanced: (world: World, tx: TxSpec) => void
}) {
  const start = challenge.setup.rules ?? []
  const [rules, setRules] = useState<RuleSpec[]>(start)
  const [counted, setCounted] = useState<ChallengeReport | null>(null)
  const [preview, setPreview] = useState<ChallengeReport | null>(null)
  const [runs, setRuns] = useState(0)
  const [rungs, setRungs] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ initial?: RuleSpec; index: number | null } | null>(null)
  const [usedSolution, setUsedSolution] = useState(false)
  const summaryRef = useRef<HTMLParagraphElement>(null)

  const built = useMemo(() => {
    try {
      return { world: engine.createWorld({ ...challenge.setup, rules }), error: '' }
    } catch (e) {
      return { world: engine.createWorld({ ...challenge.setup, rules: [] }), error: (e as Error).message }
    }
  }, [challenge, rules])
  const world = built.world

  const index = CHALLENGES.findIndex((c) => c.id === challenge.id)
  const next = CHALLENGES[index + 1]
  const teacher = SCENARIOS.find((s) => s.id === CHALLENGE_TEACHER[challenge.id])
  const ladder: Rung[] = [
    { kind: 'first' },
    ...challenge.hints.map((text) => ({ kind: 'hint' as const, text })),
    ...(teacher ? [{ kind: 'scenario' as const, id: teacher.id }] : []),
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
  const indexOf = (e: TableEntry) => rules.findIndex((r) => sameRuleKey(world, r, ruleSpecFromEntry(world, e)))

  const runTests = () => {
    const r = engine.runChallenge(challenge, rules)
    setCounted(r)
    setPreview(null)
    setRuns((n) => n + 1)
    if (r.solved)
      onSolved(challenge.id, usedSolution ? { stars: 0, withSolution: true } : { stars: r.stars, rules: r.ruleCount })
    requestAnimationFrame(() => summaryRef.current?.focus())
  }

  const report = preview ?? counted
  const isPreview = preview !== null
  const right = report ? report.results.filter((r) => r.matches).length : 0
  const solved = !isPreview && counted?.solved
  const nextRung = ladder[rungs]
  const solutionLocked = nextRung?.kind === 'solution' && runs === 0

  return (
    <div className="simple">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="#play">Play</a>
        <span aria-hidden="true">/</span>
        <span className="tnum">Challenge {index + 1}</span>
      </nav>
      <header className="simple-head">
        <p className="overline tnum">
          Challenge {index + 1} of {CHALLENGES.length}
        </p>
        <h1 className="simple-title">{plainCopy(challenge.title)}</h1>
        <p className="simple-lead">{plainCopy(challenge.brief)}</p>
        <p className="muted">
          Par: <strong className="tnum">{plural(challenge.parRules, 'rule')}</strong> for three stars.{' '}
          {progress ? <ProgressLine p={progress} par={challenge.parRules} /> : null}
        </p>
      </header>

      <div className="play-layout">
        <section className="simple-card play-book" aria-labelledby="play-book-title">
          <div className="card-head">
            <h2 className="simple-h3" id="play-book-title">
              Your rulebook
            </h2>
            <span className="muted small tnum">
              {plural(rules.length, 'rule')} · par {challenge.parRules}
            </span>
          </div>
          <Rulebook
            world={world}
            id="play-rulebook"
            onEdit={(e) => setEditing({ initial: rules[indexOf(e)] ?? ruleSpecFromEntry(world, e), index: indexOf(e) })}
            onRemove={(e) => {
              const i = indexOf(e)
              if (i >= 0) changeRules(rules.filter((_, j) => j !== i))
            }}
          />
          {built.error ? <p className="small text-warning">These rules could not be set up together.</p> : null}
          {editing ? (
            <RowEditor
              key={editing.index ?? 'new'}
              world={world}
              initial={editing.initial}
              allowed={challenge.allowedPolicies}
              idPrefix="play-rule"
              saveLabel={editing.index === null ? 'Add rule' : 'Save rule'}
              onCancel={() => setEditing(null)}
              onSave={(r) => {
                const i = editing.index
                changeRules(
                  i === null || i < 0
                    ? [...rules.filter((x) => !sameRuleKey(world, x, r)), r]
                    : rules.map((x, j) => (j === i ? r : x))
                )
              }}
            />
          ) : (
            <div className="button-row">
              <Button id="play-add" onClick={() => setEditing({ index: null })}>
                <Glyph kind="plus" size={14} />
                Add a rule
              </Button>
              <Button
                id="play-reset"
                variant="ghost"
                onClick={() => {
                  changeRules(start)
                  setUsedSolution(false)
                }}
                disabled={JSON.stringify(rules) === JSON.stringify(start) && !usedSolution}
              >
                Start over
              </Button>
            </div>
          )}
          <p className="muted small">You can use: {challenge.allowedPolicies.map((p) => policyLabel(p)).join(', ')}.</p>
          {usedSolution ? (
            <p className="small text-warning">These rules are the shown solution. Solving with them earns no stars.</p>
          ) : null}
        </section>

        <section className="simple-card play-tests" aria-labelledby="play-tests-title">
          <div className="card-head">
            <h2 className="simple-h3" id="play-tests-title">
              Test cards
            </h2>
            <Button id="play-run" variant="primary" size="lg" onClick={runTests}>
              Run the tests
            </Button>
          </div>
          {report ? (
            <p className="tests-summary tnum" id="play-summary" tabIndex={-1} ref={summaryRef}>
              {right} of {report.results.length} cards right
              {isPreview ? '. A preview: run the tests to count it.' : '.'}
            </p>
          ) : (
            <p className="muted">
              Run the tests to see which cards your rulebook gets right. After that, every change shows a preview.
            </p>
          )}
          {solved && counted ? (
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
                    ? 'No stars for a shown solution.'
                    : counted.stars === 3
                      ? 'Within par. Full marks.'
                      : 'Fewer rules earn more stars.'}
                </p>
              </div>
            </div>
          ) : null}
          <ol className="test-grid">
            {challenge.tests.map((t, i) => {
              const r = report?.results[i]
              const want = t.want === 'pass' ? 'Should pass' : 'Should be blocked'
              const label = r
                ? `Card ${i + 1}: ${t.label}. ${want}. ${r.verdict === 'pass' ? 'Allowed' : 'Blocked'}, ${r.matches ? 'right' : 'wrong'}${isPreview ? ', preview' : ''}.`
                : `Card ${i + 1}: ${t.label}. ${want}.`
              return (
                <li key={i} className={isPreview ? 'is-preview' : undefined}>
                  <TxCard
                    id={`play-test-${i}`}
                    sentence={plainCopy(t.label)}
                    who={whoWord(world, t.tx)}
                    tag={<span className={`want-tag is-${t.want}`}>{want}</span>}
                    verdict={r ? r.verdict === 'pass' : null}
                    mark={r ? (r.matches ? 'right' : 'wrong') : null}
                    selected={open === i}
                    onClick={r ? () => setOpen(open === i ? null : i) : undefined}
                    label={label}
                  />
                </li>
              )
            })}
          </ol>
          {open !== null && report?.results[open] ? (
            <div className="play-detail">
              <p className="simple-label">
                Card {open + 1}: {plainCopy(challenge.tests[open].label)}
              </p>
              <Answer
                key={`${open}-${runs}`}
                id={`play-detail`}
                result={report.results[open].result}
                tx={challenge.tests[open].tx}
                world={world}
              />
            </div>
          ) : report ? (
            <p className="muted small">Tap a card to see why.</p>
          ) : null}
        </section>
      </div>

      {solved ? (
        <section className="simple-card lesson" aria-labelledby="why-title">
          <p className="overline" id="why-title">
            Why this works
          </p>
          <p className="lesson-text">{plainCopy(challenge.explain)}</p>
          <div className="button-row">
            {next ? (
              <a className="next-link" href={`#play-${next.id}`} id="play-next">
                Next: {plainCopy(next.title)}
                <Glyph kind="arrow-right" size={16} />
              </a>
            ) : null}
            <Button id="play-advanced" variant="ghost" onClick={() => onOpenAdvanced(world, challenge.tests[0].tx)}>
              Open these rules in Advanced
            </Button>
          </div>
        </section>
      ) : null}

      <section className="simple-card" aria-labelledby="hints-title">
        <div className="card-head">
          <h2 className="simple-h3" id="hints-title">
            Hints
          </h2>
          <span className="muted small tnum">
            {rungs} of {ladder.length}
          </span>
        </div>
        {rungs === 0 ? (
          <p className="muted">The first hint points at what goes wrong. Later ones teach, and the last one solves.</p>
        ) : null}
        <ol className="hints">
          {ladder.slice(0, rungs).map((rung, i) => (
            <li key={i} className={`hint is-${rung.kind}`}>
              {rung.kind === 'first' ? (
                <span id="play-hint-first">
                  {report
                    ? firstHint(report.results, world, !isPreview)
                    : 'Run the tests, and this hint names the first card your rulebook gets wrong.'}
                </span>
              ) : null}
              {rung.kind === 'hint' ? plainCopy(rung.text) : null}
              {rung.kind === 'scenario' && teacher ? (
                <span>
                  The deep dive <a href={`#scenario-${teacher.id}`}>{plainCopy(teacher.title)}</a> shows the idea step
                  by step.
                </span>
              ) : null}
              {rung.kind === 'solution' ? (
                <div className="solution">
                  <Rulebook
                    world={engine.createWorld({ ...challenge.setup, rules: challenge.solution })}
                    title="One solution"
                    id="play-solution"
                  />
                  <div className="button-row">
                    <Button id="play-use-solution" size="sm" onClick={() => changeRules(challenge.solution, true)}>
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
            <Button id="play-hint" size="sm" onClick={() => setRungs(rungs + 1)} disabled={solutionLocked}>
              {nextRung.kind === 'solution'
                ? 'Show the solution'
                : nextRung.kind === 'scenario'
                  ? 'Show where this is taught'
                  : rungs === 0
                    ? 'Show a hint'
                    : 'Show the next hint'}
            </Button>
            {solutionLocked ? (
              <span className="muted small">The solution unlocks after you run the tests once.</span>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
