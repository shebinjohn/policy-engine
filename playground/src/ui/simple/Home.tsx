/** Learn home (#home): the 60-second explainer, a compact "Will this pass?", the eight big ideas. */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimResult, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { simpleReason } from '../lib/simpleReason.ts'
import { BIG_IDEAS, EXPLAINER, whoWord } from '../lib/simpleWords.ts'
import { load } from '../lib/storage.ts'
import { Button, Glyph, Status } from '../components/ui.tsx'
import { MiniPath, Rulebook, Stamp, TxCard, litOf } from './Pieces.tsx'
import type { Part } from './Pieces.tsx'
import { Sentence, askToTx, defaultAsk } from './Sentence.tsx'
import type { AskState } from './Sentence.tsx'
import { askWorld, RULEBOOKS } from './askWorld.ts'

const STEPS: { part: Exclude<Part, null>; text: ReactNode }[] = [
  {
    part: 'guard',
    text: (
      <>
        Every Safe transaction goes to the <strong>Policy Guard</strong> first.
      </>
    )
  },
  {
    part: 'keys',
    text: (
      <>
        The guard looks it up in the <strong>rulebook</strong> by three things: the <strong>contract</strong>, the{' '}
        <strong>action</strong> and the <strong>call type</strong>.
      </>
    )
  },
  {
    part: 'policy',
    text: (
      <>
        The matching <strong>rule</strong> names one <strong>policy</strong>, and the policy decides.
      </>
    )
  },
  {
    part: 'else',
    text: (
      <>
        No matching rule? The <strong>Anything else</strong> rule decides. No Anything else rule?{' '}
        <strong>Blocked.</strong>
      </>
    )
  }
]

interface Card {
  i: number
  label: string
  tx: TxSpec
  result: SimResult
  before: World
  note?: string
}

function Explainer() {
  const run = useMemo(() => {
    if (!EXPLAINER) return null
    try {
      const initial = engine.createWorld(EXPLAINER.setup)
      const outs = engine.runScenario(EXPLAINER)
      const cards: Card[] = []
      outs.forEach((o, i) => {
        if (o.step.do === 'tx' && o.result)
          cards.push({
            i,
            label: o.step.label,
            tx: o.step.tx,
            result: o.result,
            before: i === 0 ? initial : outs[i - 1].world,
            note: o.step.note
          })
      })
      return { initial, cards }
    } catch {
      return null
    }
  }, [])
  const [active, setActive] = useState(0)
  const [checked, setChecked] = useState<Set<number>>(() => new Set([0]))
  const [part, setPart] = useState<Part>(null)
  if (!EXPLAINER || !run || run.cards.length === 0) return null
  const card = run.cards[Math.min(active, run.cards.length - 1)]
  const pick = (i: number) => {
    setActive(i)
    setPart(null)
    setChecked((c) => new Set([...c, i]))
  }
  return (
    <section className="explainer" aria-labelledby="explainer-title">
      <header className="simple-head">
        <p className="overline">In 60 seconds</p>
        <h1 className="simple-title" id="explainer-title">
          {EXPLAINER.title}
        </h1>
        <p className="simple-lead">{EXPLAINER.oneLiner}</p>
      </header>
      <div className="explainer-grid">
        <div className="explainer-text">
          <ol className="explainer-steps">
            {STEPS.map((s, i) => (
              <li key={s.part}>
                <button
                  type="button"
                  id={`explain-step-${i + 1}`}
                  className={`explainer-step${part === s.part ? ' is-on' : ''}`}
                  aria-pressed={part === s.part}
                  onClick={() => setPart(part === s.part ? null : s.part)}
                  onMouseEnter={() => setPart(s.part)}
                  onMouseLeave={() => setPart(null)}
                  onFocus={() => setPart(s.part)}
                  onBlur={() => setPart(null)}
                >
                  <span className="explainer-n tnum">{i + 1}</span>
                  <span>{s.text}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="explainer-change">
            <Glyph kind="clock" size={16} />
            <span>
              Changing the rulebook takes a <strong>waiting period</strong>.
            </span>
          </p>
          <div className="explainer-try">
            <p className="simple-label">Try one</p>
            <div className="card-row" role="group" aria-label="Example transactions">
              {run.cards.map((c, i) => (
                <TxCard
                  key={c.i}
                  id={`explain-card-${i}`}
                  sentence={c.label}
                  who={whoWord(c.before, c.tx)}
                  selected={i === active}
                  verdict={checked.has(i) ? c.result.ok : null}
                  onClick={() => pick(i)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="explainer-figure" aria-live="polite">
          <TxCard sentence={card.label} who={whoWord(card.before, card.tx)} />
          <span className="flow-down" aria-hidden="true" />
          <Rulebook
            world={card.before}
            lit={part ? undefined : litOf(card.result, card.tx)}
            part={part}
            id="explainer-rulebook"
          />
          <span className="flow-down" aria-hidden="true" />
          <div className="explainer-verdict" key={active}>
            <Stamp ok={card.result.ok} />
            <p className="answer-reason">{card.note ?? simpleReason(card.result, card.tx, card.before)}</p>
          </div>
          <MiniPath result={card.result} world={card.before} />
        </div>
      </div>
    </section>
  )
}

function CompactAsk() {
  const treasury = RULEBOOKS[0]
  const { world } = useMemo(() => askWorld(treasury.rules), [treasury])
  const [ask, setAsk] = useState<AskState>(defaultAsk)
  const answer = (a: AskState) => {
    const tx = askToTx(world, a)
    return { tx, result: engine.simulate(world, tx) }
  }
  const [shown, setShown] = useState(() => answer(defaultAsk()))
  const [stale, setStale] = useState(false)
  return (
    <section className="home-ask" aria-labelledby="home-ask-title">
      <div className="home-ask-head">
        <h2 className="simple-h2" id="home-ask-title">
          Will this pass?
        </h2>
        <p className="muted">The treasury example rulebook answers. Change the sentence and check.</p>
      </div>
      <div className="home-ask-body">
        <Sentence
          compact
          idPrefix="home-ask"
          value={ask}
          onChange={(a) => {
            setAsk(a)
            setStale(true)
          }}
        />
        <div className="button-row">
          <Button
            id="home-ask-check"
            variant="primary"
            size="lg"
            onClick={() => {
              setShown(answer(ask))
              setStale(false)
            }}
          >
            Check
          </Button>
          <a href="#ask" className="quiet-link" id="home-ask-more">
            Ask your own, with your own rulebook
            <Glyph kind="arrow-right" size={14} />
          </a>
        </div>
        <div className={`home-ask-answer${stale ? ' is-stale' : ''}`} aria-live="polite">
          <Stamp ok={shown.result.ok} />
          <p className="answer-reason">{simpleReason(shown.result, shown.tx, world)}</p>
        </div>
      </div>
    </section>
  )
}

export function Home() {
  const done = load().ideasDone ?? {}
  return (
    <div className="simple">
      <Explainer />
      <CompactAsk />
      <section className="ideas" aria-labelledby="ideas-title">
        <h2 className="simple-h2" id="ideas-title">
          Eight big ideas
        </h2>
        <ol className="idea-grid">
          {BIG_IDEAS.map((idea) => (
            <li key={idea.id}>
              <a
                className={`idea-card${done[idea.id] ? ' is-done' : ''}`}
                href={`#idea-${idea.id}`}
                id={`idea-card-${idea.id}`}
              >
                <span className="idea-n tnum">{idea.order}</span>
                <span className="idea-title">{idea.title}</span>
                <span className="idea-one">{idea.oneLiner}</span>
                {done[idea.id] ? <Status status="pass" label="Done" compact /> : null}
              </a>
            </li>
          ))}
        </ol>
      </section>
      <nav className="quiet-links" aria-label="More">
        <a href="#play" id="home-play">
          Play the challenges
          <Glyph kind="arrow-right" size={14} />
        </a>
        <a href="#deep-dives" id="home-deep">
          Deep dives
          <Glyph kind="arrow-right" size={14} />
        </a>
        <a href="#advanced" id="home-advanced">
          Advanced simulator
          <Glyph kind="arrow-right" size={14} />
        </a>
      </nav>
    </div>
  )
}
