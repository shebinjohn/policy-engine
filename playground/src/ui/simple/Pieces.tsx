/**
 * The simple layer's four visual pieces (SIMPLE_LAYER.md §3), used on every simple screen:
 * the transaction card, the rulebook, the verdict stamp and the three-node mini path.
 */
import type { ReactNode } from 'react'
import type { OperationName, SimResult, TableEntry, TxSpec, World } from '../../engine/types.ts'
import { policyLabel } from '../lib/content.ts'
import { actionWord, contractWord, rulebookRows } from '../lib/simpleWords.ts'
import type { SimpleRow } from '../lib/simpleWords.ts'
import { Button, Glyph } from '../components/ui.tsx'

// ---------------------------------------------------------------------------------------------
// Verdict stamp
// ---------------------------------------------------------------------------------------------

export function Stamp({ ok, size = 'lg' }: { ok: boolean; size?: 'lg' | 'sm' }) {
  return (
    <span className={`stamp ${ok ? 'is-allowed' : 'is-blocked'} is-${size}`}>
      <Glyph kind={ok ? 'pass' : 'fail'} size={size === 'lg' ? 26 : 14} />
      {ok ? 'Allowed' : 'Blocked'}
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// Transaction card
// ---------------------------------------------------------------------------------------------

export function TxCard({
  id,
  sentence,
  who,
  onClick,
  selected = false,
  verdict,
  tag,
  mark,
  label
}: {
  id?: string
  sentence: string
  who: string
  onClick?: () => void
  selected?: boolean
  /** Shown as a small stamp once known. */
  verdict?: boolean | null
  /** A small line above the sentence, e.g. "Should pass". */
  tag?: ReactNode
  /** Right or wrong, for challenge tests. */
  mark?: 'right' | 'wrong' | null
  /** Accessible name when the visible text is not enough. */
  label?: string
}) {
  const body = (
    <>
      <span className="txcard-who">
        <Glyph kind={/module/i.test(who) ? 'module' : 'user'} size={14} />
        {who}
      </span>
      {tag ? <span className="txcard-tag">{tag}</span> : null}
      <span className="txcard-sentence">{sentence}</span>
      {verdict !== undefined && verdict !== null ? (
        <span className="txcard-foot">
          <Stamp ok={verdict} size="sm" />
          {mark ? <span className={`txcard-mark is-${mark}`}>{mark === 'right' ? 'Right' : 'Wrong'}</span> : null}
        </span>
      ) : null}
    </>
  )
  const cls = `txcard${selected ? ' is-selected' : ''}${verdict === true ? ' is-allowed' : verdict === false ? ' is-blocked' : ''}${mark ? ` is-${mark}` : ''}`
  return onClick ? (
    <button type="button" id={id} className={cls} onClick={onClick} aria-pressed={selected} aria-label={label}>
      {body}
    </button>
  ) : (
    <div id={id} className={cls} aria-label={label}>
      {body}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Mini path: Rulebook -> Policy -> Result
// ---------------------------------------------------------------------------------------------

type NodeStatus = 'pass' | 'fail' | 'skip' | 'none'
export interface PathState {
  rulebook: { status: NodeStatus; text: string }
  policy: { status: NodeStatus; text: string }
  ok: boolean
}

export function pathOf(result: SimResult, world: World): PathState {
  const top = result.trace.filter((e) => e.depth === 0)
  const has = (id: string, status?: string) => top.find((e) => e.id === id && (!status || e.status === status))
  const ok = result.ok
  if (has('safe.noGuard'))
    return {
      rulebook: { status: 'skip', text: 'No guard: not checked' },
      policy: { status: 'skip', text: 'Not asked' },
      ok
    }
  if (has('engine.allowedCall', 'pass'))
    return { rulebook: { status: 'pass', text: 'Rulebook change' }, policy: { status: 'skip', text: 'Not needed' }, ok }
  if (!ok && result.error?.by === 'safe')
    return { rulebook: { status: 'none', text: 'Not reached' }, policy: { status: 'none', text: 'Not asked' }, ok }
  const exact = has('engine.lookup.exact', 'pass')
  const fallback = has('engine.lookup.fallback', 'pass')
  const none = has('engine.lookup.none')
  let rulebook: PathState['rulebook']
  if (exact && exact.access) {
    const entry = world.table[exact.access]
    rulebook = {
      status: 'pass',
      text:
        entry && !entry.isFallback
          ? `${contractWord(world, entry.target)} · ${actionWord(entry.selector)}`
          : 'Anything else'
    }
  } else if (fallback) rulebook = { status: 'pass', text: 'Anything else' }
  else if (none) rulebook = { status: 'fail', text: 'No rule' }
  else rulebook = { status: 'fail', text: 'Refused first' }
  const checks = top.filter((e) => e.id === 'policy.check')
  const failed = checks.find((e) => e.status === 'fail')
  const passed = checks.find((e) => e.status === 'pass')
  const matchedPolicy = result.matched?.policy ?? failed?.policy ?? passed?.policy ?? result.error?.policy ?? null
  let policy: PathState['policy']
  if (rulebook.status !== 'pass') policy = { status: 'none', text: 'Not asked' }
  else if (result.error?.error === 'AccessDenied' && result.error.policy === 'DenyPolicy')
    policy = { status: 'fail', text: policyLabel('DenyPolicy') }
  else if (failed) policy = { status: 'fail', text: policyLabel(failed.policy) }
  else if (!ok && result.error?.by === 'guard' && result.error.policy)
    policy = { status: 'fail', text: policyLabel(result.error.policy) }
  else policy = { status: 'pass', text: policyLabel(matchedPolicy) }
  return { rulebook, policy, ok }
}

const NODE_GLYPH: Record<NodeStatus, 'pass' | 'fail' | 'skip' | 'none'> = {
  pass: 'pass',
  fail: 'fail',
  skip: 'skip',
  none: 'none'
}

export function MiniPath({ result, world, animate = false }: { result: SimResult; world: World; animate?: boolean }) {
  const p = pathOf(result, world)
  const node = (title: string, n: { status: NodeStatus; text: string }, i: number) => (
    <li className={`mini-node is-${n.status}`} style={{ ['--i' as string]: i }}>
      <span className="mini-title">{title}</span>
      <span className="mini-text">
        <Glyph kind={NODE_GLYPH[n.status]} size={14} />
        {n.text}
      </span>
    </li>
  )
  return (
    <ol
      className={`mini-path${animate ? ' is-build' : ''}`}
      aria-label={`Path: rulebook ${p.rulebook.text}, policy ${p.policy.text}, result ${p.ok ? 'Allowed' : 'Blocked'}`}
    >
      {node('Rulebook', p.rulebook, 0)}
      {node('Policy', p.policy, 1)}
      <li className={`mini-node mini-result ${p.ok ? 'is-allowed' : 'is-blocked'}`} style={{ ['--i' as string]: 2 }}>
        <span className="mini-title">Result</span>
        <span className="mini-text">
          <Glyph kind={p.ok ? 'pass' : 'fail'} size={14} />
          {p.ok ? 'Allowed' : 'Blocked'}
        </span>
      </li>
    </ol>
  )
}

// ---------------------------------------------------------------------------------------------
// Rulebook
// ---------------------------------------------------------------------------------------------

export type Part = 'guard' | 'keys' | 'policy' | 'else' | null

/** Which row a result lit: the matched rule, or the empty "Anything else" row when nothing matched. */
export function litOf(
  result: SimResult | null | undefined,
  tx?: TxSpec | null
): { access: string | null; noneOp: OperationName | null } {
  if (!result) return { access: null, noneOp: null }
  const top = result.trace.filter((e) => e.depth === 0)
  const hit = top.find(
    (e) => (e.id === 'engine.lookup.exact' || e.id === 'engine.lookup.fallback') && e.status === 'pass'
  )
  if (hit?.access) return { access: hit.access.toLowerCase(), noneOp: null }
  if (top.some((e) => e.id === 'engine.lookup.none'))
    return { access: null, noneOp: tx?.operation === 'DELEGATECALL' ? 'DELEGATECALL' : 'CALL' }
  return { access: null, noneOp: null }
}

function RowView({
  row,
  lit,
  onEdit,
  onRemove,
  idx
}: {
  row: SimpleRow
  lit: boolean
  onEdit?: (e: TableEntry) => void
  onRemove?: (e: TableEntry) => void
  idx: string
}) {
  const label = row.isElse
    ? `Anything else, ${row.callType.toLowerCase()} call: ${row.policy}${row.settings ? `, ${row.settings}` : ''}`
    : `${row.contract}, ${row.action}, ${row.callType.toLowerCase()} call: ${row.policy}${row.settings ? `, ${row.settings}` : ''}`
  return (
    <li
      className={`rb-row${row.isElse ? ' is-else' : ''}${row.empty ? ' is-empty' : ''}${lit ? ' is-lit' : ''}`}
      aria-label={`${lit ? 'Used: ' : ''}${label}`}
      id={idx}
    >
      <span className="rb-cell rb-contract">{row.contract}</span>
      <span className="rb-cell rb-action">
        {row.isElse ? <span className="muted">every action without its own rule</span> : row.action}
      </span>
      <span className="rb-cell rb-call">{row.callType}</span>
      <span className="rb-cell rb-policy">
        <Glyph kind="arrow-right" size={14} />
        <span>
          <strong>{row.policy}</strong>
          {row.settings ? <span className="rb-settings"> · {row.settings}</span> : null}
          {lit ? <span className="rb-used">Used</span> : null}
        </span>
      </span>
      {(onEdit || onRemove) && row.entry ? (
        <span className="rb-cell rb-tools">
          {onEdit ? (
            <Button size="sm" variant="ghost" onClick={() => onEdit(row.entry!)}>
              Edit
            </Button>
          ) : null}
          {onRemove ? (
            <Button size="sm" variant="ghost" onClick={() => onRemove(row.entry!)}>
              Remove
            </Button>
          ) : null}
        </span>
      ) : null}
    </li>
  )
}

export function Rulebook({
  world,
  lit,
  part = null,
  title = 'Rulebook',
  onEdit,
  onRemove,
  only = false,
  showDelegate,
  footer,
  id
}: {
  world: World
  /** The row the last check used. */
  lit?: { access: string | null; noneOp: OperationName | null }
  /** Explainer: which part of the picture to light. */
  part?: Part
  title?: string
  onEdit?: (e: TableEntry) => void
  onRemove?: (e: TableEntry) => void
  /** Show only the lit row ("Rule used"). */
  only?: boolean
  showDelegate?: boolean
  footer?: ReactNode
  id?: string
}) {
  const { rules, anythingElse } = rulebookRows(world, { showDelegate: showDelegate ?? lit?.noneOp === 'DELEGATECALL' })
  // Call type matters only where a delegatecall is in view (batch rows read plainly without it).
  const callTypes = [...rules, ...anythingElse].some((r) => r.callType === 'Delegatecall' && !r.isBatch)
  const isLit = (r: SimpleRow) =>
    !!lit &&
    ((!!lit.access && r.access?.toLowerCase() === lit.access) ||
      (!!lit.access && r.isElse && r.key === lit.access) ||
      (r.empty === true && r.isElse && lit.noneOp === (r.callType === 'Delegatecall' ? 'DELEGATECALL' : 'CALL')))
  if (only) {
    const row = [...rules, ...anythingElse].find(isLit)
    if (!row) return null
    return (
      <ul className={`rulebook is-only${callTypes ? ' has-calltype' : ''}`} aria-label="The rule used">
        <RowView row={row} lit idx={`${id ?? 'rb'}-used`} />
      </ul>
    )
  }
  return (
    <figure
      className={`rulebook-frame${part ? ` light-${part}` : ''}${callTypes ? ' has-calltype' : ''}`}
      id={id}
      aria-label={title}
    >
      <figcaption className="rulebook-caption">
        <span className="rb-guard">
          <Glyph kind="lock" size={14} />
          Policy Guard
        </span>
        <span className="rb-title">{title}</span>
      </figcaption>
      <div className="rb-head" aria-hidden="true">
        <span>Contract</span>
        <span>Action</span>
        <span className="rb-call">Call type</span>
        <span>Policy</span>
      </div>
      <ul className="rulebook">
        {rules.length === 0 ? <li className="rb-none muted">No rules of their own.</li> : null}
        {rules.map((r) => (
          <RowView
            key={r.key}
            row={r}
            lit={isLit(r)}
            onEdit={onEdit}
            onRemove={onRemove}
            idx={`${id ?? 'rb'}-${r.key.slice(-8)}`}
          />
        ))}
      </ul>
      <ul className="rulebook rulebook-else">
        {anythingElse.map((r) => (
          <RowView
            key={r.key}
            row={r}
            lit={isLit(r)}
            onEdit={onEdit}
            onRemove={onRemove}
            idx={`${id ?? 'rb'}-else-${r.callType}`}
          />
        ))}
      </ul>
      {footer ? <div className="rb-footer">{footer}</div> : null}
    </figure>
  )
}
