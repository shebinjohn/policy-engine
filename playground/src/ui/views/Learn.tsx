/** Learn: how a check flows, the policies, and the glossary. */
import { useState } from 'react'
import { ALL_POLICIES, GLOSSARY, POLICY_LIST, policyLabel } from '../lib/content.ts'
import { Field, Glyph, Pill, TextInput, useEngineer } from '../components/ui.tsx'

function FlowDiagram() {
  return (
    <figure className="flow" aria-labelledby="flow-caption">
      <div className="flow-grid" role="img" aria-label="Owner transactions and module transactions both pass through the Policy Guard before the Safe runs them.">
        <p className="flow-caption flow-caption-top">Owner transaction</p>
        <div className="flow-actor flow-r1">
          <Glyph kind="user" size={20} />
          <span>Owners sign</span>
        </div>
        <span className="flow-arrow flow-r1 flow-c2" aria-hidden="true" />
        <div className="flow-node flow-r1 flow-c3">Safe runs it</div>
        <span className="flow-arrow flow-r1 flow-c4" aria-hidden="true" />
        <div className="flow-node is-outcome flow-r1 flow-c5">Executed</div>

        <span className="flow-vlink flow-rl1 flow-c3" aria-hidden="true" />
        <div className="flow-node is-check flow-r2 flow-c3">
          Policy Guard
          <span className="flow-node-sub">checks first</span>
        </div>
        <span className="flow-vlink flow-rl2 flow-c3" aria-hidden="true" />

        <div className="flow-actor flow-r3">
          <Glyph kind="module" size={20} />
          <span>A module asks</span>
        </div>
        <span className="flow-arrow flow-r3 flow-c2" aria-hidden="true" />
        <div className="flow-node flow-r3 flow-c3">Safe runs it</div>
        <span className="flow-arrow flow-r3 flow-c4" aria-hidden="true" />
        <div className="flow-node is-outcome flow-r3 flow-c5">Executed</div>
        <p className="flow-caption flow-caption-bottom">Module transaction</p>
      </div>
      <figcaption id="flow-caption" className="muted small">
        The Policy Guard is installed twice: as the transaction guard and as the module guard. With only one, the other path skips every rule.
      </figcaption>
    </figure>
  )
}

const STEPS: { node: string; title: string; text: string }[] = [
  {
    node: 'Signatures',
    title: 'Signatures or module',
    text: 'The Safe checks that enough owners signed, or that the module asking is enabled. This is Safe itself, before any rule.'
  },
  {
    node: 'Guard checks',
    title: 'Guard checks',
    text: 'The Policy Guard refuses gas refunds: gasPrice and safeTxGas must be 0. Calls to the guard are refused, except managing rules, which always goes through the waiting period.'
  },
  {
    node: 'Rule lookup',
    title: 'Rule lookup',
    text: 'The guard looks for the rule for this target, action and call type. If there is none, it uses the catch-all rule for that call type. If there is neither, the transaction is blocked: deny by default.'
  },
  {
    node: 'Policy',
    title: 'Policy decides',
    text: 'One rule, one policy. The policy allows or refuses. A batch policy checks every step against that step’s own rule before anything runs.'
  },
  {
    node: 'Execution',
    title: 'Execution',
    text: 'The call runs. If it fails, everything is undone, including grants or signatures a policy marked as used during the check.'
  }
]

function CheckSteps() {
  return (
    <ol className="check-steps">
      {STEPS.map((s, i) => (
        <li key={s.node} className="check-step">
          <span className="node">{s.node}</span>
          <div>
            <p className="check-step-title">
              <span className="tnum muted">{i + 1}.</span> {s.title}
            </p>
            <p className="small">{s.text}</p>
          </div>
        </li>
      ))}
      <li className="check-step">
        <span className="node is-outcome">Executed</span>
        <div>
          <p className="check-step-title">Outcome</p>
          <p className="small">All changes are kept, or nothing changed at all. There is no half-done transaction.</p>
        </div>
      </li>
    </ol>
  )
}

function PolicyCards() {
  const engineer = useEngineer()
  const list = POLICY_LIST.length > 0 ? POLICY_LIST : null
  return (
    <ul className="policy-grid">
      {(list ?? ALL_POLICIES.map((name) => ({ name }))).map((p) => {
        const full = list ? (p as (typeof POLICY_LIST)[number]) : null
        return (
          <li key={p.name} className="policy-card">
            <div className="policy-card-head">
              <h3 className="policy-name">{full?.label ?? policyLabel(p.name)}</h3>
              {engineer ? <code className="tech">{p.name}</code> : null}
            </div>
            {full ? (
              <>
                <p className="policy-one">{full.oneLiner}</p>
                <div className="chips">
                  <Pill tone={full.paths === 'owner-only' ? 'warning' : 'neutral'}>{full.paths === 'owner-only' ? 'Owner transactions only' : 'Owner and module transactions'}</Pill>
                  {full.stateful ? <Pill tone="info">Remembers what it allowed</Pill> : null}
                </div>
                <p className="small">{full.plain}</p>
                <dl className="policy-facts">
                  <dt>Where it fits</dt>
                  <dd>{full.placement}</dd>
                  <dt>Settings</dt>
                  <dd>{full.configHelp}</dd>
                </dl>
                {full.pitfalls.length > 0 ? (
                  <div className="pitfalls">
                    <p className="field-label">Watch out</p>
                    <ul>
                      {full.pitfalls.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function Glossary() {
  const engineer = useEngineer()
  const [q, setQ] = useState('')
  const terms = [...GLOSSARY]
    .sort((a, b) => a.term.localeCompare(b.term))
    .filter((t) => !q || (t.term + ' ' + t.plain).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="glossary">
      <Field id="glossary-filter" label="Find a term">
        <TextInput id="glossary-filter" value={q} onChange={setQ} placeholder="Catch-all, waiting period, nonce…" />
      </Field>
      {terms.length === 0 ? <p className="muted">{GLOSSARY.length === 0 ? 'The glossary is not published yet.' : 'No term matches.'}</p> : null}
      <dl className="terms">
        {terms.map((t) => (
          <div key={t.term} className="term">
            <dt>{t.term}</dt>
            <dd>
              {t.plain}
              {engineer && t.tech ? <span className="tech">{t.tech}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Learn() {
  return (
    <div className="view">
      <header className="view-head">
        <p className="overline">Reference</p>
        <h1 className="page-title">Learn</h1>
        <p className="lead">How the Policy Engine decides, the eleven policies, and the words the playground uses.</p>
      </header>
      <section className="learn-section" aria-labelledby="learn-flow">
        <h2 className="section-heading" id="learn-flow">
          How a check flows
        </h2>
        <div className="learn-flow">
          <FlowDiagram />
          <CheckSteps />
        </div>
      </section>
      <section className="learn-section" aria-labelledby="learn-policies">
        <h2 className="section-heading" id="learn-policies">
          Policies
        </h2>
        <p className="muted">Every rule names one policy. A policy is a small audited contract with one job.</p>
        <PolicyCards />
      </section>
      <section className="learn-section" aria-labelledby="learn-glossary">
        <h2 className="section-heading" id="learn-glossary">
          Glossary
        </h2>
        <Glossary />
      </section>
    </div>
  )
}
