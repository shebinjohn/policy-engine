/** Deep dives (#deep-dives): the scenarios as a shelf, one line each, opening in Advanced. */
import { load } from '../lib/storage.ts'
import { plainCopy } from '../lib/plainCopy.ts'
import { Glyph, Status } from '../components/ui.tsx'
import { chaptersWithScenarios } from '../views/Scenarios.tsx'

export function DeepDives() {
  const done = load().scenariosDone ?? {}
  return (
    <div className="simple">
      <header className="simple-head">
        <p className="overline">Learn</p>
        <h1 className="simple-title">Deep Dives</h1>
        <p className="simple-lead">
          Step-by-step walk-throughs of every behaviour, with the fine print. Each one opens in the Advanced view.
        </p>
      </header>
      {chaptersWithScenarios().map((c) => (
        <section key={c.id} className="shelf" aria-labelledby={`shelf-${c.number}`}>
          <h2 className="simple-h3" id={`shelf-${c.number}`}>
            {c.title}
          </h2>
          <ul className="shelf-list">
            {c.items.map((s) => (
              <li key={s.id}>
                <a href={`#scenario-${s.id}`} id={`dive-${s.id}`} className="shelf-item">
                  <span className="shelf-title">{plainCopy(s.title)}</span>
                  <span className="shelf-summary">{plainCopy(s.summary)}</span>
                  {done[s.id] ? <Status status="pass" label="Done" compact /> : <Glyph kind="arrow-right" size={14} />}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
