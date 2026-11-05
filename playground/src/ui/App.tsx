/**
 * App shell. The simple layer (Learn, Ask, Play) is the default; today's detailed app lives behind
 * "Advanced" (Sandbox, Scenarios, Reference, Engineer view). Routes are plain #names.
 */
import { Component, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TxSpec, World } from '../engine/types.ts'
import { CHALLENGES, SCENARIOS } from './generated/content.ts'
import { BIG_IDEAS } from './lib/simpleWords.ts'
import { load, save } from './lib/storage.ts'
import { EngineerContext, Glyph, Switch } from './components/ui.tsx'
import { Sandbox } from './views/Sandbox.tsx'
import type { Seed } from './views/Sandbox.tsx'
import { ScenarioList, ScenarioView } from './views/Scenarios.tsx'
import { Learn as Reference } from './views/Learn.tsx'
import { Home } from './simple/Home.tsx'
import { Ask } from './simple/Ask.tsx'
import { IdeaView } from './simple/Idea.tsx'
import { PlayList, PlayView, useProgress } from './simple/Play.tsx'
import { DeepDives } from './simple/DeepDives.tsx'

type View = 'home' | 'ask' | 'idea' | 'play' | 'play-one' | 'deep' | 'sandbox' | 'scenarios' | 'scenario' | 'learn'
interface Route {
  view: View
  id?: string
  /** 1-based scenario step from #scenario-<id>-step-<n>. */
  step?: number
  /** Setup code from #run-<code>. */
  code?: string
  /** The canonical hash, when an old link should be rewritten. */
  redirect?: string
}

const ADVANCED: View[] = ['sandbox', 'scenarios', 'scenario', 'learn']

/** Routes are plain #names (ASCII letters, digits and hyphens), the only kind an artifact link carries. */
export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '')
  if (h === '' || h === 'home') return { view: 'home' }
  if (h === 'ask') return { view: 'ask' }
  if (h === 'deep-dives') return { view: 'deep' }
  if (h.startsWith('idea-')) {
    const id = h.slice('idea-'.length)
    return BIG_IDEAS.some((i) => i.id === id) ? { view: 'idea', id } : { view: 'home' }
  }
  if (h === 'play' || h === 'challenges') return { view: 'play', redirect: h === 'challenges' ? 'play' : undefined }
  if (h.startsWith('play-') || h.startsWith('challenge-')) {
    const id = h.slice(h.indexOf('-') + 1)
    if (!CHALLENGES.some((c) => c.id === id)) return { view: 'play', redirect: 'play' }
    return { view: 'play-one', id, redirect: h.startsWith('challenge-') ? `play-${id}` : undefined }
  }
  if (h === 'advanced' || h === 'sandbox') return { view: 'sandbox' }
  if (h.startsWith('run-') && /^run-[a-z0-9]+$/.test(h)) return { view: 'sandbox', code: h.slice(4) }
  if (h.startsWith('scenario-')) {
    const rest = h.slice('scenario-'.length)
    const m = /^(.*)-step-(\d+)$/.exec(rest)
    if (m && SCENARIOS.some((s) => s.id === m[1])) return { view: 'scenario', id: m[1], step: Number(m[2]) }
    return SCENARIOS.some((s) => s.id === rest) ? { view: 'scenario', id: rest } : { view: 'scenarios' }
  }
  if (h === 'scenarios' || h === 'learn') return { view: h }
  return { view: 'home' }
}

function go(hash: string) {
  if (location.hash === `#${hash}`) return
  location.hash = hash
}

function redirect(route: Route) {
  if (!route.redirect) return
  try {
    history.replaceState(null, '', `#${route.redirect}`)
  } catch {
    // the frame may refuse; the route is already right
  }
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

const NAV: { label: string; hash: string; match: View[] }[] = [
  { label: 'Learn', hash: 'home', match: ['home', 'idea', 'deep'] },
  { label: 'Ask', hash: 'ask', match: ['ask'] },
  { label: 'Play', hash: 'play', match: ['play', 'play-one'] }
]

const ADVANCED_NAV: { label: string; hash: string; match: View[] }[] = [
  { label: 'Sandbox', hash: 'sandbox', match: ['sandbox'] },
  { label: 'Scenarios', hash: 'scenarios', match: ['scenarios', 'scenario'] },
  { label: 'Reference', hash: 'learn', match: ['learn'] }
]

export function App() {
  const [route, setRoute] = useState<Route>(() => {
    const r = parseRoute(location.hash)
    redirect(r)
    return r
  })
  const [engineer, setEngineer] = useState(() => Boolean(load().engineer))
  const [seed, setSeed] = useState<Seed | null>(() => (route.code ? { id: 1, kind: 'code', code: route.code } : null))
  const [resetKey, setResetKey] = useState(0)
  const [progress, record] = useProgress()
  const advanced = ADVANCED.includes(route.view)

  useEffect(() => {
    const on = () => {
      const next = parseRoute(location.hash)
      redirect(next)
      setRoute((prev) => {
        if (!(prev.view === 'scenario' && next.view === 'scenario' && prev.id === next.id)) window.scrollTo({ top: 0 })
        return next
      })
      if (next.code) setSeed({ id: Date.now(), kind: 'code', code: next.code })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const toggleEngineer = (v: boolean) => {
    setEngineer(v)
    save({ engineer: v })
  }

  const openInSandbox = (world: World, tx: TxSpec, from: string, blurb: string, run = false) => {
    setSeed({ id: Date.now(), kind: 'world', world, tx, from, blurb, run })
    go('sandbox')
  }

  const scenario = route.view === 'scenario' ? SCENARIOS.find((s) => s.id === route.id) : undefined
  const challenge = route.view === 'play-one' ? CHALLENGES.find((c) => c.id === route.id) : undefined
  const idea = route.view === 'idea' ? BIG_IDEAS.find((i) => i.id === route.id) : undefined

  return (
    <EngineerContext.Provider value={engineer && advanced}>
      <header className="app-header">
        <div className="gutter header-inner">
          <a className="brand" href="#home" aria-label="Policy Engine Playground, home">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Policy Engine Playground</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <a
                key={n.hash}
                id={`nav-${n.hash}`}
                href={`#${n.hash}`}
                className="nav-link"
                aria-current={n.match.includes(route.view) ? 'page' : undefined}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <a
            href="#advanced"
            id="nav-advanced"
            className={`nav-quiet${advanced ? ' is-on' : ''}`}
            aria-current={advanced ? 'page' : undefined}
          >
            Advanced
          </a>
        </div>
      </header>
      {advanced ? (
        <div className="advanced-bar">
          <div className="gutter advanced-inner">
            <a href="#home" className="back-simple" id="back-simple">
              <Glyph kind="arrow-right" size={14} />
              Back to the simple view
            </a>
            <nav className="advanced-nav" aria-label="Advanced">
              {ADVANCED_NAV.map((n) => (
                <a
                  key={n.hash}
                  id={`nav-${n.hash}`}
                  href={`#${n.hash}`}
                  className="nav-link"
                  aria-current={n.match.includes(route.view) ? 'page' : undefined}
                >
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
        </div>
      ) : null}
      <main className={`gutter page${advanced ? ' is-advanced' : ' is-simple'}`} id="main">
        <div hidden={route.view !== 'sandbox'}>
          <Boundary key={`sandbox-${resetKey}`} onReset={() => setResetKey((k) => k + 1)}>
            <Sandbox key={`${seed?.id ?? 0}-${resetKey}`} seed={seed} />
          </Boundary>
        </div>
        <Boundary key={`${route.view}-${route.id ?? ''}-${resetKey}`} onReset={() => setResetKey((k) => k + 1)}>
          {route.view === 'home' ? <Home /> : null}
          {route.view === 'ask' ? (
            <Ask
              onOpenAdvanced={(world, tx) =>
                openInSandbox(
                  world,
                  tx,
                  'From Will this pass?',
                  'The Safe and transaction you asked about, with every detail. Change anything and run it again.',
                  true
                )
              }
            />
          ) : null}
          {route.view === 'idea' && idea ? <IdeaView key={idea.id} idea={idea} /> : null}
          {route.view === 'play' ? <PlayList progress={progress} /> : null}
          {route.view === 'play-one' && challenge ? (
            <PlayView
              key={challenge.id}
              challenge={challenge}
              onSolved={record}
              progress={progress[challenge.id]}
              onOpenAdvanced={(world, tx) =>
                openInSandbox(
                  world,
                  tx,
                  `Your rules for ${challenge.title}`,
                  'The challenge Safe with your rules, and its first test ready to run. Try anything the tests did not.'
                )
              }
            />
          ) : null}
          {route.view === 'deep' ? <DeepDives /> : null}
          {route.view === 'scenarios' ? <ScenarioList onOpen={(id) => go(`scenario-${id}`)} /> : null}
          {route.view === 'scenario' && scenario ? (
            <ScenarioView
              key={scenario.id}
              scenario={scenario}
              step={route.step}
              onBack={() => go('scenarios')}
              onOpen={(id) => go(`scenario-${id}`)}
              onTry={(world, tx) =>
                openInSandbox(
                  world,
                  tx,
                  `From the scenario ${scenario.title}`,
                  'The Safe as it was before this step, with its transaction ready to run. Change anything and run it.'
                )
              }
            />
          ) : null}
          {route.view === 'learn' ? <Reference /> : null}
        </Boundary>
      </main>
      <footer className="app-footer">
        <div className="gutter footer-inner">
          <p className="muted small">
            A simulated Safe with the Policy Engine. Every example here is also replayed on the real contracts, so what
            you see is what the chain decides.
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
