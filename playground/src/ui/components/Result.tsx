/** "What happened": the verdict, the decision path drawn from the trace, and what changed. */
import { useMemo } from 'react'
import type { Effect, EncodedTx, SimResult, TraceEvent, TxSpec, World } from '../../engine/types.ts'
import { errorInfo, innermost, policyLabel, solidityError } from '../lib/content.ts'
import { describeCall, describeContext, describeWho, nameOf } from '../lib/describe.ts'
import { formatUnits } from '../lib/format.ts'
import { buildStages, stageLabel, statusWord } from '../lib/pipeline.ts'
import type { PipeItem, Stage, SubItem } from '../lib/pipeline.ts'
import { CopyText, Glyph, Pill, Status, Tech, useEngineer } from './ui.tsx'

// ---------------------------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------------------------

export function Verdict({ result }: { result: SimResult }) {
  const engineer = useEngineer()
  if (result.ok) {
    const noGuard = result.trace.find((e) => e.id === 'safe.noGuard')
    const managed = result.trace.some((e) => e.id === 'engine.allowedCall')
    const sub = noGuard
      ? 'It ran without any rule being checked.'
      : managed
        ? 'Managing rules is always allowed. New rules still wait out the waiting period.'
        : result.matched
          ? `${policyLabel(result.matched.policy)} approved it${result.matched.isFallback ? ' through the catch-all rule' : ''}.`
          : 'The transaction ran.'
    return (
      <div className="verdict tone-success" role="status">
        <Glyph kind="pass" size={32} />
        <div className="verdict-text">
          <p className="verdict-word">Allowed</p>
          <p className="verdict-sub">{sub}</p>
        </div>
      </div>
    )
  }
  const err = result.error
  if (!err) return null
  const deep = innermost(err)
  const info = errorInfo(deep.error.error, deep.policy) ?? errorInfo(err.error, err.policy)
  const word = err.by === 'execution' ? 'Failed' : 'Blocked'
  const who =
    err.by === 'safe'
      ? 'Stopped by the Safe'
      : err.by === 'execution'
        ? 'The rules allowed it. The call itself failed.'
        : deep.policy
          ? `Stopped by ${policyLabel(deep.policy)}`
          : 'Stopped by the Policy Guard'
  const chain: string[] = []
  for (let e: typeof err | undefined = err; e; e = e.reason) if (e.policy) chain.push(policyLabel(e.policy))
  return (
    <div className="verdict tone-danger" role="status">
      <Glyph kind="fail" size={32} />
      <div className="verdict-text">
        <p className="verdict-word">{word}</p>
        <p className="verdict-sub">{who}</p>
        <div className="verdict-reason">
          <p className="verdict-title">{info?.title ?? deep.error.error}</p>
          <p>{err.message}</p>
          {info?.plain && info.plain !== err.message ? <p className="muted">{info.plain}</p> : null}
          {chain.length > 1 ? (
            <p className="verdict-chain">
              <span className="muted">Path: </span>
              {chain.map((c, i) => (
                <span key={i}>
                  {i > 0 ? <Glyph kind="arrow-right" size={12} /> : null}
                  {c}
                </span>
              ))}
            </p>
          ) : null}
          {info?.fix ? (
            <p className="verdict-fix">
              <strong>How to fix: </strong>
              {info.fix}
            </p>
          ) : null}
          {engineer ? (
            <p className="tech">
              {solidityError(err)}
              {info?.tech ? ` · ${info.tech}` : ''}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Decision path
// ---------------------------------------------------------------------------------------------

function EventRow({ ev }: { ev: TraceEvent }) {
  const engineer = useEngineer()
  return (
    <li className={`pipe-event is-${ev.status}`}>
      <span className={`pipe-event-mark tone-${ev.status === 'pass' ? 'success' : ev.status === 'fail' ? 'danger' : ev.status === 'warn' ? 'warning' : 'muted'}`}>
        <Glyph kind={ev.status} size={14} />
        <span className="sr-only">{ev.status === 'pass' ? 'Passed: ' : ev.status === 'fail' ? 'Failed: ' : ev.status === 'warn' ? 'Warning: ' : ''}</span>
      </span>
      <div className="pipe-event-text">
        <p className="pipe-event-title">{ev.title}</p>
        {ev.detail ? <p className="pipe-event-detail">{ev.detail}</p> : null}
        {engineer && (ev.tech || ev.access) ? (
          <p className="tech">
            {ev.tech}
            {ev.tech && ev.access ? ' · ' : ''}
            {ev.access ? <span className="tech-access">{ev.access}</span> : null}
          </p>
        ) : null}
      </div>
    </li>
  )
}

function SubBlock({ sub, path }: { sub: SubItem; path: 'owner' | 'module' }) {
  const ran = sub.stages.filter((s) => s.items.length > 0)
  return (
    <li className={`pipe-sub is-${sub.status}`}>
      <div className="pipe-sub-head">
        <span className="pipe-sub-index">{sub.index >= 0 ? `Step ${sub.index + 1}` : 'Nested check'}</span>
        <span className="pipe-sub-title">{sub.header?.title ?? ''}</span>
        <Status status={sub.status} compact label={sub.status === 'pass' ? 'Passed' : sub.status === 'fail' ? 'Failed' : sub.status === 'warn' ? 'Warning' : sub.status === 'none' ? 'Not reached' : 'Done'} />
      </div>
      {sub.header?.detail ? <p className="pipe-event-detail">{sub.header.detail}</p> : null}
      <Tech block>{sub.header?.tech}</Tech>
      {ran.length > 0 ? (
        <ul className="pipe-sub-stages">
          {ran.map((st) => (
            <li key={st.key} className="pipe-sub-stage">
              <span className="pipe-sub-stage-label">
                {st.key === 'policy' && st.policy ? policyLabel(st.policy) : stageLabel(st.key, path, true)}
              </span>
              <ul className="pipe-events">
                {st.items.map((it, i) => (
                  <Item key={i} it={it} path={path} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Item({ it, path }: { it: PipeItem; path: 'owner' | 'module' }) {
  return it.type === 'event' ? <EventRow ev={it.ev} /> : <SubBlock sub={it} path={path} />
}

function StageView({ st, path, index }: { st: Stage; path: 'owner' | 'module'; index: number }) {
  const label = st.key === 'policy' && st.policy ? `Policy: ${policyLabel(st.policy)}` : stageLabel(st.key, path, false)
  return (
    <li className={`pipe-stage is-${st.status}`} style={{ ['--i' as string]: index }}>
      <div className="pipe-head">
        <span className="node">{label}</span>
        <Status status={st.status} label={statusWord(st.key, st.status)} />
      </div>
      {st.items.length > 0 ? (
        <ul className="pipe-events">
          {st.items.map((it, i) => (
            <Item key={i} it={it} path={path} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function Pipeline({ result, path, animate = false }: { result: SimResult; path: 'owner' | 'module'; animate?: boolean }) {
  const stages = useMemo(() => buildStages(result.trace), [result.trace])
  const err = result.error
  const outcome = result.ok
    ? { cls: 'is-outcome', word: 'Executed', note: 'All changes were kept.' }
    : err?.by === 'execution'
      ? { cls: 'is-blocked', word: 'Reverted', note: 'Nothing changed. Everything staged was undone.' }
      : { cls: 'is-blocked', word: 'Blocked', note: 'Nothing ran. Nothing changed.' }
  return (
    <div className="scroll-x">
      <ol className={`pipe${animate ? ' is-build' : ''}`} aria-label="Decision path">
        {stages.map((st, i) => (
          <StageView key={st.key} st={st} path={path} index={i} />
        ))}
        <li className="pipe-stage pipe-end" style={{ ['--i' as string]: stages.length }}>
          <div className="pipe-head">
            <span className={`node ${outcome.cls}`}>{outcome.word}</span>
            <span className="muted pipe-end-note">{outcome.note}</span>
          </div>
        </li>
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------------------------

const KIND_LABEL: Record<Effect['kind'], string> = {
  balance: 'Balance',
  allowance: 'Allowance',
  guard: 'Guard',
  module: 'Module',
  owners: 'Owners',
  threshold: 'Threshold',
  rule: 'Rule',
  policyState: 'Policy state',
  root: 'Change set',
  nonce: 'Nonce',
  note: 'Note'
}

export function Effects({ result }: { result: SimResult }) {
  const effects = result.effects
  const kept = effects.filter((e) => !e.reverted)
  const undone = effects.filter((e) => e.reverted)
  if (effects.length === 0) return <p className="muted">Nothing changed.</p>
  return (
    <div className="effects">
      {!result.ok && undone.length > 0 ? (
        <p className="muted">Nothing changed. These changes were staged while checking and then undone:</p>
      ) : null}
      <ul className="effect-list">
        {[...kept, ...undone].map((e, i) => (
          <li key={i} className={`effect${e.reverted ? ' is-reverted' : ''}`}>
            <span className="effect-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
            <span className="effect-title">{e.reverted ? <s>{e.title}</s> : e.title}</span>
            {e.reverted ? <Pill tone="muted">Undone</Pill> : null}
            <Tech block>{e.tech}</Tech>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Encoded transaction (engineer view)
// ---------------------------------------------------------------------------------------------

export function Encoded({ encoded }: { encoded: EncodedTx }) {
  return (
    <div className="encoded">
      <dl className="kv">
        <dt>to</dt>
        <dd className="mono">{encoded.to}</dd>
        <dt>value</dt>
        <dd className="mono">{encoded.value} wei</dd>
        <dt>operation</dt>
        <dd className="mono">
          {encoded.operation} ({encoded.operation === 1 ? 'DELEGATECALL' : 'CALL'})
        </dd>
        <dt>access selector</dt>
        <dd className="mono">{encoded.accessSelector}</dd>
      </dl>
      <p className="field-label">Calldata</p>
      <CopyText text={encoded.data || '0x'} label="Copy calldata" />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Whole result
// ---------------------------------------------------------------------------------------------

export function TxSummary({ world, tx }: { world: World; tx: TxSpec }) {
  const ctx = describeContext(world, tx.context)
  return (
    <div className="tx-summary">
      <p className="tx-summary-who">
        <Glyph kind={tx.path === 'module' ? 'module' : 'user'} size={14} />
        {tx.path === 'module' ? 'Module transaction' : 'Owner transaction'} · {describeWho(world, tx)}
      </p>
      <p className="tx-summary-what">{describeCall(world, tx)}</p>
      {tx.call?.batch && tx.call.batch.length > 0 ? (
        <ol className="tx-summary-batch">
          {tx.call.batch.map((s, i) => (
            <li key={i}>{describeCall(world, s)}</li>
          ))}
        </ol>
      ) : null}
      {ctx ? <p className="muted small">With {ctx.charAt(0).toLowerCase() + ctx.slice(1)}</p> : null}
    </div>
  )
}

export function ResultView({
  result,
  tx,
  world,
  animate = false,
  headingLevel = 3
}: {
  result: SimResult
  tx: TxSpec
  world: World
  animate?: boolean
  headingLevel?: 2 | 3 | 4
}) {
  const engineer = useEngineer()
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  return (
    <div className="result">
      <TxSummary world={world} tx={tx} />
      <Verdict result={result} />
      <section className="result-section" aria-label="Decision path">
        <H className="section-title">Decision path</H>
        <Pipeline result={result} path={tx.path ?? 'owner'} animate={animate} />
      </section>
      <section className="result-section" aria-label="What changed">
        <H className="section-title">What changed</H>
        <Effects result={result} />
      </section>
      {engineer ? (
        <section className="result-section" aria-label="Encoded transaction">
          <H className="section-title">Encoded transaction</H>
          <Encoded encoded={result.encoded} />
        </section>
      ) : null}
    </div>
  )
}

export function balanceRows(world: World, holder: string): { asset: string; amount: string; symbol: string }[] {
  const rows: { asset: string; amount: string; symbol: string }[] = []
  const addr = holder.toLowerCase()
  for (const [asset, holders] of Object.entries(world.balances)) {
    const hit = Object.entries(holders).find(([h]) => h.toLowerCase() === addr)
    if (!hit) continue
    if (asset === 'ETH') rows.push({ asset, amount: formatUnits(hit[1], 18), symbol: 'ETH' })
    else {
      const e = world.book.find((b) => b.address.toLowerCase() === asset.toLowerCase())
      rows.push({ asset, amount: formatUnits(hit[1], e?.decimals ?? 18), symbol: e?.symbol ?? nameOf(world, asset) })
    }
  }
  return rows
}
