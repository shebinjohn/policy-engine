/** Ask (#ask): "Will this pass?" as a sentence, answered against a rulebook you can change. */
import { useMemo, useState } from 'react'
import type { RuleSpec, SimResult, TableEntry, TxSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { ruleSpecFromEntry, sameRuleKey } from '../lib/describe.ts'
import { encodeShare, worldToSetup } from '../lib/share.ts'
import { BIG_IDEAS } from '../lib/simpleWords.ts'
import { Button, CopyText, Field, Glyph, Select } from '../components/ui.tsx'
import { Answer } from './Answer.tsx'
import { Rulebook, litOf } from './Pieces.tsx'
import { RowEditor } from './RowEditor.tsx'
import { Sentence, askToTx, defaultAsk } from './Sentence.tsx'
import type { AskState } from './Sentence.tsx'
import { RULEBOOKS, askWorld } from './askWorld.ts'

interface Checked {
  tx: TxSpec
  result: SimResult
  world: World
  n: number
}

function check(world: World, ask: AskState, n: number): Checked | null {
  try {
    const tx = askToTx(world, ask)
    return { tx, result: engine.simulate(world, tx), world, n }
  } catch {
    return null
  }
}

export function Ask({ onOpenAdvanced }: { onOpenAdvanced: (world: World, tx: TxSpec) => void }) {
  const [preset, setPreset] = useState(RULEBOOKS[0].id)
  const [rules, setRules] = useState<RuleSpec[]>(RULEBOOKS[0].rules)
  const { world, error } = useMemo(() => askWorld(rules), [rules])
  const [ask, setAsk] = useState<AskState>(defaultAsk)
  const [checked, setChecked] = useState<Checked | null>(() =>
    check(askWorld(RULEBOOKS[0].rules).world, defaultAsk(), 0)
  )
  const [stale, setStale] = useState(false)
  const [editing, setEditing] = useState<{ initial?: RuleSpec; index: number | null } | null>(null)
  const [sharing, setSharing] = useState(false)
  const idea7 = BIG_IDEAS.find((i) => i.order === 7)

  const run = () => {
    setChecked(check(world, ask, (checked?.n ?? 0) + 1))
    setStale(false)
    setSharing(false)
    requestAnimationFrame(() => document.getElementById('ask-answer-verdict')?.focus())
  }

  /** A new rulebook: rebuild the Safe and answer the same question again. */
  const changeRules = (next: RuleSpec[], presetId = 'custom') => {
    setRules(next)
    setPreset(presetId)
    setEditing(null)
    const w = askWorld(next).world
    if (checked) setChecked(check(w, ask, checked.n + 1))
  }

  const indexOf = (e: TableEntry) => rules.findIndex((r) => sameRuleKey(world, r, ruleSpecFromEntry(world, e)))

  const code = useMemo(() => {
    if (!checked) return ''
    try {
      return encodeShare({ setup: worldToSetup(checked.world), tx: checked.tx })
    } catch {
      return ''
    }
  }, [checked])
  let link = `#run-${code}`
  try {
    link = `${window.location.href.split('#')[0]}#run-${code}`
  } catch {
    // keep the fragment
  }

  return (
    <div className="simple">
      <header className="simple-head">
        <p className="overline">Ask</p>
        <h1 className="simple-title">Will This Pass?</h1>
        <p className="simple-lead">Say what the Safe should do. The rulebook answers, and shows the rule it used.</p>
      </header>
      <div className="ask-grid">
        <div className="ask-main">
          <section className="simple-card" aria-labelledby="ask-q">
            <h2 className="sr-only" id="ask-q">
              Your question
            </h2>
            <Sentence
              idPrefix="ask"
              value={ask}
              onChange={(a) => {
                setAsk(a)
                setStale(true)
              }}
            />
            <div className="button-row">
              <Button id="ask-check" variant="primary" size="lg" onClick={run}>
                Check
              </Button>
              {stale && checked ? (
                <span className="muted small">The answer below is for the previous sentence.</span>
              ) : null}
            </div>
          </section>
          {checked ? (
            <section
              className={`simple-card answer-card${stale ? ' is-stale' : ''}`}
              aria-labelledby="ask-answer-title"
            >
              <h2 className="sr-only" id="ask-answer-title">
                The answer
              </h2>
              <Answer
                key={checked.n}
                id="ask-answer"
                result={checked.result}
                tx={checked.tx}
                world={checked.world}
                animate={checked.n > 0}
              />
              <div className="answer-actions">
                <Button id="ask-share" size="sm" onClick={() => setSharing(!sharing)} disabled={!code}>
                  {sharing ? 'Hide sharing' : 'Share'}
                </Button>
                <Button
                  id="ask-advanced"
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenAdvanced(checked.world, checked.tx)}
                >
                  Open in Advanced
                  <Glyph kind="arrow-right" size={14} />
                </Button>
              </div>
              {sharing && code ? (
                <div className="share" id="ask-share-panel">
                  <p className="small">
                    Anyone can paste this code into the Advanced simulator, or open the link, to see the same Safe and
                    transaction.
                  </p>
                  <Field label="Code">
                    <CopyText text={code} label="Copy code" />
                  </Field>
                  <Field label="Link">
                    <CopyText text={link} label="Copy link" />
                  </Field>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
        <aside className="ask-side">
          <section className="simple-card" aria-labelledby="ask-book-title">
            <div className="card-head">
              <h2 className="simple-h3" id="ask-book-title">
                The rulebook
              </h2>
              <Select
                id="ask-preset"
                ariaLabel="Example rulebook"
                value={preset}
                onChange={(id) => {
                  const p = RULEBOOKS.find((x) => x.id === id)
                  if (p) changeRules(p.rules, p.id)
                }}
                options={[
                  ...RULEBOOKS.map((p) => ({ value: p.id, label: p.label })),
                  ...(preset === 'custom' ? [{ value: 'custom', label: 'Your own rulebook' }] : [])
                ]}
              />
            </div>
            {error ? (
              <p className="small text-warning">That rulebook could not be set up, so this one is empty.</p>
            ) : null}
            <Rulebook
              world={world}
              lit={checked && !stale ? litOf(checked.result, checked.tx) : undefined}
              id="ask-rulebook"
              onEdit={(e) =>
                setEditing({ initial: rules[indexOf(e)] ?? ruleSpecFromEntry(world, e), index: indexOf(e) })
              }
              onRemove={(e) => {
                const i = indexOf(e)
                if (i >= 0) changeRules(rules.filter((_, j) => j !== i))
              }}
            />
            {editing ? (
              <RowEditor
                key={editing.index ?? 'new'}
                world={world}
                initial={editing.initial}
                idPrefix="ask-rule"
                saveLabel={editing.index === null ? 'Add rule' : 'Save rule'}
                onCancel={() => setEditing(null)}
                onSave={(r) => {
                  const i = editing.index
                  const next =
                    i === null || i < 0
                      ? [...rules.filter((x) => !sameRuleKey(world, x, r)), r]
                      : rules.map((x, j) => (j === i ? r : x))
                  changeRules(next)
                }}
              />
            ) : (
              <div className="button-row">
                <Button id="ask-add-rule" size="sm" onClick={() => setEditing({ index: null })}>
                  <Glyph kind="plus" size={14} />
                  Add a rule
                </Button>
              </div>
            )}
            <p className="muted small">
              Here every change makes a fresh Safe. On a live Safe, changing the rulebook takes a waiting period.
              {idea7 ? (
                <>
                  {' '}
                  <a href={`#idea-${idea7.id}`}>Why</a>
                </>
              ) : null}
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
