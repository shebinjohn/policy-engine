/** App shell: header with navigation and Engineer view, hash routes, and the four views. */
import { Component, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TxSpec, World } from '../engine/types.ts'
import { CHALLENGES, SCENARIOS } from './generated/content.ts'
import { load, save } from './lib/storage.ts'
import { EngineerContext, Switch } from './components/ui.tsx'
import { Sandbox } from './views/Sandbox.tsx'
import type { Seed } from './views/Sandbox.tsx'
import { ScenarioList, ScenarioView } from './views/Scenarios.tsx'
import { ChallengeList, ChallengeView, useProgress } from './views/Challenges.tsx'
import { Learn } from './views/Learn.tsx'

type View = 'sandbox' | 'scenarios' | 'scenario' | 'challenges' | 'challenge' | 'learn'
interface Route {
  view: View
  id?: string
}

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '')
  if (h.startsWith('scenario-')) {
    const id = h.slice('scenario-'.length)
    return SCENARIOS.some((s) => s.id === id) ? { view: 'scenario', id } : { view: 'scenarios' }
  }
  if (h.startsWith('challenge-')) {
    const id = h.slice('challenge-'.length)
    return CHALLENGES.some((c) => c.id === id) ? { view: 'challenge', id } : { view: 'challenges' }
  }
  if (h === 'scenarios' || h === 'challenges' || h === 'learn' || h === 'sandbox') return { view: h }
  return { view: 'sandbox' }
}

function go(hash: string) {
  if (location.hash === `#${hash}`) return
  location.hash = hash
}

class Boundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="callout tone-danger" role="alert">
        <div className="callout-body">
          <p className="callout-title">This view stopped working</p>
          <p className="small">{this.state.error.message}</p>
          <button
            type="button"
            className="btn is-secondary is-sm"
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset()
            }}
          >
            Reload this view
          </button>
        </div>
      </div>
    )
  }
}

const NAV: { view: View; label: string; hash: string; match: View[] }[] = [
  { view: 'sandbox', label: 'Sandbox', hash: 'sandbox', match: ['sandbox'] },
  { view: 'scenarios', label: 'Scenarios', hash: 'scenarios', match: ['scenarios', 'scenario'] },
  { view: 'challenges', label: 'Challenges', hash: 'challenges', match: ['challenges', 'challenge'] },
  { view: 'learn', label: 'Learn', hash: 'learn', match: ['learn'] }
]

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash))
  const [engineer, setEngineer] = useState(() => Boolean(load().engineer))
  const [seed, setSeed] = useState<Seed | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [progress, record] = useProgress()

  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const toggleEngineer = (v: boolean) => {
    setEngineer(v)
    save({ engineer: v })
  }

  const tryInSandbox = (world: World, tx: TxSpec, from: string) => {
    setSeed({ id: Date.now(), world, tx, from })
    go('sandbox')
  }

  const scenario = route.view === 'scenario' ? SCENARIOS.find((s) => s.id === route.id) : undefined
  const challenge = route.view === 'challenge' ? CHALLENGES.find((c) => c.id === route.id) : undefined

  return (
    <EngineerContext.Provider value={engineer}>
      <header className="app-header">
        <div className="gutter header-inner">
          <a className="brand" href="#sandbox" aria-label="Policy Engine Playground, Sandbox">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Policy Engine Playground</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.view} id={`nav-${n.view}`} href={`#${n.hash}`} className="nav-link" aria-current={n.match.includes(route.view) ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <Switch
            id="engineer-toggle"
            checked={engineer}
            onChange={toggleEngineer}
            label={
              <>
                Engineer<span className="hide-narrow"> view</span>
              </>
            }
          />
        </div>
      </header>
      <main className="gutter page" id="main">
        <div hidden={route.view !== 'sandbox'}>
          <Boundary key={`sandbox-${resetKey}`} onReset={() => setResetKey((k) => k + 1)}>
            <Sandbox key={`${seed?.id ?? 0}-${resetKey}`} seed={seed} />
          </Boundary>
        </div>
        <Boundary key={`${route.view}-${route.id ?? ''}-${resetKey}`} onReset={() => setResetKey((k) => k + 1)}>
          {route.view === 'scenarios' ? <ScenarioList onOpen={(id) => go(`scenario-${id}`)} /> : null}
          {route.view === 'scenario' && scenario ? (
            <ScenarioView key={scenario.id} scenario={scenario} onBack={() => go('scenarios')} onOpen={(id) => go(`scenario-${id}`)} onTry={tryInSandbox} />
          ) : null}
          {route.view === 'challenges' ? <ChallengeList onOpen={(id) => go(`challenge-${id}`)} progress={progress} /> : null}
          {route.view === 'challenge' && challenge ? (
            <ChallengeView
              key={challenge.id}
              challenge={challenge}
              onBack={() => go('challenges')}
              onOpen={(id) => go(`challenge-${id}`)}
              onSolved={record}
              bestStars={progress[challenge.id]?.stars ?? 0}
            />
          ) : null}
          {route.view === 'learn' ? <Learn /> : null}
        </Boundary>
      </main>
      <footer className="app-footer">
        <div className="gutter footer-inner">
          <p className="muted small">
            Simulates a Safe 1.5.0 account with the SafePolicyGuard installed as transaction and module guard. Every published scenario and challenge is
            replayed against the real contracts.
          </p>
          <p className="small">
            <a href="https://github.com/safe-research/policy-engine" target="_blank" rel="noreferrer">
              github.com/safe-research/policy-engine
            </a>
          </p>
        </div>
      </footer>
    </EngineerContext.Provider>
  )
}
