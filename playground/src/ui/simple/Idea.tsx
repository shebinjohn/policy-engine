/** One big idea (#idea-<id>): a few short paragraphs, the rulebook, and cards to predict then reveal. */
import { useEffect, useMemo, useState } from 'react'
import type { BigIdea, SimResult, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { formatDuration } from '../lib/format.ts'
import { plainCopy } from '../lib/plainCopy.ts'
import { BIG_IDEAS, whoWord } from '../lib/simpleWords.ts'
import { load, save } from '../lib/storage.ts'
import { SCENARIOS } from '../generated/content.ts'
import { Button, Checkbox, Glyph } from '../components/ui.tsx'
import { Answer } from './Answer.tsx'
import { Rulebook, TxCard, litOf } from './Pieces.tsx'

type Item =
  | { kind: 'tx'; i: number; label: string; tx: TxSpec; result: SimResult; before: World; note?: string }
  | { kind: 'wait'; i: number; label: string; seconds: number; note?: string }

function markDone(id: string) {
  save({ ideasDone: { ...(load().ideasDone ?? {}), [id]: true } })
}

export function IdeaView({ idea }: { idea: BigIdea }) {
  const run = useMemo(() => {
    try {
      const initial = engine.createWorld(idea.setup)
      const outs = engine.runScenario(idea)
      const items: Item[] = outs.map((o, i) => {
        const before = i === 0 ? initial : outs[i - 1].world
        if (o.step.do === 'wait')
          return { kind: 'wait', i, label: o.step.label, seconds: o.step.seconds, note: o.step.note }
        return { kind: 'tx', i, label: o.step.label, tx: o.step.tx, result: o.result!, before, note: o.step.note }
      })
      return { initial, items, error: '' }
    } catch (e) {
      return { initial: null, items: [] as Item[], error: (e as Error).message }
    }
  }, [idea])
  const [revealed, setRevealed] = useState<Record<number, 'pass' | 'block' | 'skip'>>({})
  const [active, setActive] = useState<number | null>(null)
  const [skipGuess, setSkipGuess] = useState(() => Boolean(load().skipGuess))
  const txItems = run.items.filter((x) => x.kind === 'tx')
  const allDone = txItems.length > 0 && txItems.every((x) => revealed[x.i])
  useEffect(() => {
    if (allDone) markDone(idea.id)
  }, [allDone, idea.id])

  const pos = BIG_IDEAS.findIndex((x) => x.id === idea.id)
  const next = BIG_IDEAS[pos + 1]
  const activeItem = run.items.find((x) => x.i === active && x.kind === 'tx') as
    | Extract<Item, { kind: 'tx' }>
    | undefined
  const bookWorld = activeItem?.before ?? run.initial
  const reveal = (i: number, guess: 'pass' | 'block' | 'skip') => {
    setRevealed((r) => ({ ...r, [i]: guess }))
    setActive(i)
    requestAnimationFrame(() => document.getElementById(`card-${i}-answer-verdict`)?.focus())
  }

  return (
    <div className="simple">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="#home">Learn</a>
        <span aria-hidden="true">/</span>
        <span>Big idea {idea.order}</span>
      </nav>
      <header className="simple-head">
        <p className="overline tnum">
          Big idea {idea.order} of {BIG_IDEAS.length}
        </p>
        <h1 className="simple-title">{idea.title}</h1>
        <p className="simple-lead">{idea.oneLiner}</p>
      </header>
      <div className="idea-explain">
        {idea.explain.slice(0, 3).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {run.error ? <p className="text-warning">{run.error}</p> : null}
      <div className="idea-layout">
        <div className="idea-cards">
          <div className="idea-cards-head">
            <h2 className="simple-h3">Allowed or blocked?</h2>
            <Checkbox
              id="idea-skip"
              checked={skipGuess}
              onChange={(v) => {
                setSkipGuess(v)
                save({ skipGuess: v })
              }}
              label="Skip guessing"
              hint="Guesses are never scored."
            />
          </div>
          <ol className="idea-list">
            {run.items.map((it) =>
              it.kind === 'wait' ? (
                <li key={it.i} className="idea-wait">
                  <Glyph kind="clock" size={16} />
                  <span>
                    <strong>{formatDuration(it.seconds)} later.</strong> {it.note ?? it.label}
                  </span>
                </li>
              ) : (
                <li key={it.i} className={`idea-card-item${active === it.i ? ' is-active' : ''}`}>
                  <TxCard
                    id={`card-${it.i}`}
                    sentence={it.label}
                    who={whoWord(it.before, it.tx)}
                    selected={active === it.i}
                    onClick={revealed[it.i] ? () => setActive(it.i) : undefined}
                  />
                  {!revealed[it.i] ? (
                    skipGuess ? (
                      <div className="guess-row">
                        <Button id={`card-${it.i}-show`} onClick={() => reveal(it.i, 'skip')}>
                          Show the answer
                        </Button>
                      </div>
                    ) : (
                      <div className="guess-row" role="group" aria-label={`${it.label}: allowed or blocked?`}>
                        <Button id={`card-${it.i}-pass`} onClick={() => reveal(it.i, 'pass')}>
                          <Glyph kind="pass" size={16} />
                          Allowed
                        </Button>
                        <Button id={`card-${it.i}-block`} onClick={() => reveal(it.i, 'block')}>
                          <Glyph kind="fail" size={16} />
                          Blocked
                        </Button>
                        <button
                          type="button"
                          className="link-button"
                          id={`card-${it.i}-skip`}
                          onClick={() => reveal(it.i, 'skip')}
                        >
                          Just show me
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="idea-reveal">
                      {revealed[it.i] !== 'skip' ? (
                        <p className="guess-said">
                          You said {revealed[it.i] === 'pass' ? 'Allowed' : 'Blocked'}.
                          {(revealed[it.i] === 'pass') === it.result.ok
                            ? ' So did the Policy Guard.'
                            : ` The Policy Guard said ${it.result.ok ? 'Allowed' : 'Blocked'}.`}
                        </p>
                      ) : null}
                      <Answer
                        id={`card-${it.i}-answer`}
                        result={it.result}
                        tx={it.tx}
                        world={it.before}
                        reason={it.note}
                        animate
                        showRule={false}
                      />
                    </div>
                  )}
                </li>
              )
            )}
          </ol>
        </div>
        <aside className="idea-side">
          {bookWorld ? (
            <Rulebook
              world={bookWorld}
              lit={activeItem ? litOf(activeItem.result, activeItem.tx) : undefined}
              title="Rulebook"
              id="idea-rulebook"
            />
          ) : null}
        </aside>
      </div>
      <section className={`takeaway${allDone ? ' is-done' : ''}`} aria-labelledby="takeaway-title">
        <p className="overline" id="takeaway-title">
          Remember
        </p>
        <p className="takeaway-text">{idea.takeaway}</p>
      </section>
      {idea.deepDives.length > 0 ? (
        <section className="deep-links" aria-labelledby="deep-title">
          <h2 className="simple-h3" id="deep-title">
            Go deeper
          </h2>
          <ul>
            {idea.deepDives
              .map((id) => SCENARIOS.find((s) => s.id === id))
              .filter((s): s is NonNullable<typeof s> => !!s)
              .map((s) => (
                <li key={s.id}>
                  <a href={`#scenario-${s.id}`}>{plainCopy(s.title)}</a>
                  <span className="muted"> · {plainCopy(s.summary)}</span>
                </li>
              ))}
          </ul>
          <p className="muted small">Deep dives open in the Advanced view, with every step and its fine print.</p>
        </section>
      ) : null}
      <nav className="idea-next" aria-label="Next">
        {next ? (
          <a className="next-link" href={`#idea-${next.id}`} id="idea-next">
            Next: {next.title}
            <Glyph kind="arrow-right" size={16} />
          </a>
        ) : (
          <a className="next-link" href="#play" id="idea-next">
            You have seen all eight. Play the challenges
            <Glyph kind="arrow-right" size={16} />
          </a>
        )}
        <a href="#home" className="quiet-link">
          Back to Learn
        </a>
      </nav>
    </div>
  )
}
