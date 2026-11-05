/** "Your Safe": owners, guards, modules, balances, rules, change sets, clock, activity. */
import type { ReactNode } from 'react'
import type { RuleSpec, TableEntry, World } from '../../engine/types.ts'
import { describeRuleSpec, describeTableEntry, nameOf, ownerNames, moduleNames } from '../lib/describe.ts'
import type { RuleWords } from '../lib/describe.ts'
import { formatDuration, formatShortTime, formatTime, plural, shortAddress } from '../lib/format.ts'
import { balanceRows } from './Result.tsx'
import { Button, Callout, Glyph, Status, Tech, useEngineer } from './ui.tsx'

export function Section({ title, aside, children, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="panel-section" aria-labelledby={id}>
      <div className="panel-section-head">
        <h3 className="overline" id={id}>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function guardState(world: World) {
  const tx = Boolean(world.safe.txGuard)
  const mod = Boolean(world.safe.moduleGuard)
  return { tx, mod, both: tx && mod, none: !tx && !mod }
}

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------

export function OwnersSection({ world, idPrefix = '' }: { world: World; idPrefix?: string }) {
  const owners = ownerNames(world)
  return (
    <Section title="Owners" id={`${idPrefix}sec-owners`} aside={<span className="muted small tnum">Nonce {world.safe.nonce}</span>}>
      <ul className="chips" aria-label="Owners">
        {owners.map((o) => (
          <li key={o} className="chip">
            <Glyph kind="user" size={14} />
            {nameOf(world, o)}
          </li>
        ))}
      </ul>
      <p className="small">
        <strong className="tnum">
          {world.safe.threshold} of {owners.length}
        </strong>{' '}
        owners must sign an owner transaction.
      </p>
    </Section>
  )
}

export function GuardsSection({ world, idPrefix = '' }: { world: World; idPrefix?: string }) {
  const g = guardState(world)
  const row = (on: boolean, name: string, what: string) => (
    <li className="guard-row">
      <div>
        <p className="guard-name">{name}</p>
        <p className="muted small">{what}</p>
      </div>
      <span className={`state-pill ${on ? 'is-on' : 'is-off'}`}>
        <Glyph kind={on ? 'lock' : 'skip'} size={14} />
        {on ? 'On' : 'Off'}
      </span>
    </li>
  )
  return (
    <Section title="Protection" id={`${idPrefix}sec-guards`}>
      <ul className="guard-list">
        {row(g.tx, 'Transaction guard', 'Checks owner transactions')}
        {row(g.mod, 'Module guard', 'Checks module transactions')}
      </ul>
      {g.tx && !g.mod ? (
        <Callout tone="warning" title="Modules bypass every rule">
          Only the transaction guard is on. Any enabled module can do anything, including removing the guard.
        </Callout>
      ) : null}
      {!g.tx && g.mod ? (
        <Callout tone="warning" title="Owner transactions are unchecked">
          Only the module guard is on. Enough owners can do anything without a rule.
        </Callout>
      ) : null}
      {g.none ? (
        <Callout tone="info" title="No Policy Engine yet">
          No guard is installed, so no rule is checked. Rules can be set immediately, without a waiting period.
        </Callout>
      ) : null}
    </Section>
  )
}

export function ModulesSection({ world, idPrefix = '' }: { world: World; idPrefix?: string }) {
  const mods = moduleNames(world)
  return (
    <Section title="Modules" id={`${idPrefix}sec-modules`}>
      {mods.length === 0 ? (
        <p className="muted small">No modules enabled.</p>
      ) : (
        <ul className="chips" aria-label="Enabled modules">
          {mods.map((m) => (
            <li key={m} className="chip">
              <Glyph kind="module" size={14} />
              {nameOf(world, m)}
            </li>
          ))}
        </ul>
      )}
      {mods.length > 0 ? <p className="muted small">Modules execute without owner signatures.</p> : null}
    </Section>
  )
}

export function BalancesSection({ world, idPrefix = '' }: { world: World; idPrefix?: string }) {
  const rows = balanceRows(world, world.safe.address)
  const others = world.book
    .filter((e) => e.kind === 'person' || e.kind === 'module' || e.kind === 'contract' || e.kind === 'service')
    .map((e) => ({ e, rows: balanceRows(world, e.address).filter((r) => r.amount !== '0') }))
    .filter((x) => x.rows.length > 0)
  return (
    <Section title="Balances" id={`${idPrefix}sec-balances`}>
      {rows.length === 0 ? (
        <p className="muted small">The Safe holds nothing.</p>
      ) : (
        <table className="balances">
          <tbody>
            {rows.map((r) => (
              <tr key={r.asset}>
                <th scope="row">{r.symbol}</th>
                <td className="tnum">{r.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {others.length > 0 ? (
        <details className="disclosure">
          <summary>Others ({others.length})</summary>
          <ul className="others">
            {others.map(({ e, rows: rs }) => (
              <li key={e.name}>
                <span>{nameOf(world, e.name)}</span>
                <span className="tnum muted">{rs.map((r) => `${r.amount} ${r.symbol}`).join(', ')}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export function RuleRow({ w, access, actions, note, marker }: { w: RuleWords; access?: string; actions?: ReactNode; note?: string; marker?: ReactNode }) {
  return (
    <li className={`rule${w.isFallback ? ' is-fallback' : ''}${w.removes ? ' is-removal' : ''}`}>
      <div className="rule-top">
        <p className="rule-when">
          {w.isFallback ? (
            <>
              <span className="rule-target">Catch-all</span>
              <span className="rule-action">every call without its own rule</span>
              <span className="op-chip">{w.op}</span>
            </>
          ) : (
            <>
              <span className="rule-target">{w.target}</span>
              <span className="rule-action">{w.action}</span>
              <span className={`op-chip${w.op === 'delegatecall' ? ' is-delegate' : ''}`}>{w.op}</span>
            </>
          )}
        </p>
        {actions ? <div className="rule-actions">{actions}</div> : null}
      </div>
      <p className="rule-then">
        <Glyph kind="arrow-right" size={14} />
        {w.removes ? (
          <span>Remove this rule</span>
        ) : (
          <span>
            <strong>{w.policy}</strong>
            {w.config ? <span className="muted">: {w.config}</span> : null}
            {marker}
          </span>
        )}
      </p>
      {note ? <p className="muted small rule-note">{note}</p> : null}
      {access ? <Tech block>{access}</Tech> : null}
    </li>
  )
}

export function sortEntries(world: World, entries: TableEntry[]): TableEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isFallback !== b.isFallback) return a.isFallback ? 1 : -1
    const ta = nameOf(world, a.target)
    const tb = nameOf(world, b.target)
    return ta.localeCompare(tb) || a.selector.localeCompare(b.selector) || a.operation.localeCompare(b.operation)
  })
}

export function RuleTable({
  world,
  onEdit,
  onRemove,
  staged
}: {
  world: World
  onEdit?: (e: TableEntry) => void
  onRemove?: (e: TableEntry) => void
  staged?: (e: TableEntry) => boolean
}) {
  const entries = sortEntries(world, Object.values(world.table))
  const exact = entries.filter((e) => !e.isFallback)
  const fallback = entries.filter((e) => e.isFallback)
  const g = guardState(world)
  const actions = (e: TableEntry) =>
    onEdit || onRemove ? (
      <>
        {onEdit ? (
          <Button size="sm" variant="ghost" onClick={() => onEdit(e)}>
            Edit
          </Button>
        ) : null}
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={() => onRemove(e)} disabled={staged?.(e)}>
            {staged?.(e) ? 'In change set' : 'Remove'}
          </Button>
        ) : null}
      </>
    ) : undefined
  if (entries.length === 0) {
    return (
      <p className="muted small">
        {g.none
          ? 'No rules. No guard is installed, so nothing is checked yet.'
          : 'No rules. Deny by default: every checked transaction is blocked.'}
      </p>
    )
  }
  return (
    <div className="rule-table">
      {exact.length > 0 ? (
        <ul className="rule-list" aria-label="Rules">
          {exact.map((e) => (
            <RuleRow key={e.access} w={describeTableEntry(world, e)} access={e.access} actions={actions(e)} />
          ))}
        </ul>
      ) : (
        <p className="muted small">No specific rules.</p>
      )}
      <p className="rule-group-label">
        Catch-all <span className="muted">· decides calls that have no rule above</span>
      </p>
      {fallback.length > 0 ? (
        <ul className="rule-list" aria-label="Catch-all rules">
          {fallback.map((e) => (
            <RuleRow key={e.access} w={describeTableEntry(world, e)} access={e.access} actions={actions(e)} />
          ))}
        </ul>
      ) : (
        <p className="muted small rule-none">None. Anything without a rule is blocked.</p>
      )}
    </div>
  )
}

export function RuleSpecList({
  world,
  rules,
  actions,
  empty
}: {
  world: World
  rules: RuleSpec[]
  actions?: (r: RuleSpec, i: number) => ReactNode
  empty?: string
}) {
  if (rules.length === 0) return <p className="muted small">{empty ?? 'No rules.'}</p>
  return (
    <ul className="rule-list">
      {rules.map((r, i) => (
        <RuleRow key={i} w={describeRuleSpec(world, r)} note={r.note} actions={actions?.(r, i)} />
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------
// Change sets and time
// ---------------------------------------------------------------------------------------------

export type RootPhase = 'waiting' | 'ready' | 'expired'

export function rootPhase(world: World, validFrom: number): RootPhase {
  if (world.now < validFrom) return 'waiting'
  if (world.now >= validFrom + world.expiry) return 'expired'
  return 'ready'
}

export function PendingChanges({
  world,
  onApply,
  onCancel
}: {
  world: World
  onApply?: (root: string) => void
  onCancel?: (root: string) => void
}) {
  const engineer = useEngineer()
  const roots = Object.entries(world.roots)
  if (roots.length === 0) return <p className="muted small">No change set is waiting.</p>
  return (
    <ul className="pending-list">
      {roots.map(([root, r]) => {
        const phase = rootPhase(world, r.validFrom)
        const status =
          phase === 'waiting' ? (
            <Status status="warn" label={`Waiting period: ${formatDuration(r.validFrom - world.now)} left`} compact />
          ) : phase === 'ready' ? (
            <Status status="pass" label={`Ready. Expires in ${formatDuration(r.validFrom + world.expiry - world.now)}`} compact />
          ) : (
            <Status status="fail" label="Expired. Propose it again." compact />
          )
        return (
          <li key={root} className={`pending is-${phase}`}>
            <div className="pending-head">
              <p className="pending-title">Change set · {plural(r.configurations.length, 'change')}</p>
              {status}
            </div>
            <p className="muted small tnum">
              Can be applied from {formatShortTime(r.validFrom)} until {formatShortTime(r.validFrom + world.expiry)}
            </p>
            {engineer ? <p className="tech">root {root}</p> : null}
            <RuleSpecList world={world} rules={r.configurations} />
            {onApply || onCancel ? (
              <div className="button-row">
                {onApply ? (
                  <Button size="sm" variant="primary" onClick={() => onApply(root)} disabled={phase !== 'ready'}>
                    Apply change
                  </Button>
                ) : null}
                {onCancel ? (
                  <Button size="sm" onClick={() => onCancel(root)}>
                    Cancel change set
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function Clock({ world, onAdvance }: { world: World; onAdvance?: (s: number) => void }) {
  const waiting = Object.values(world.roots)
    .map((r) => r.validFrom - world.now)
    .filter((d) => d > 0)
  const next = waiting.length ? Math.min(...waiting) : 0
  return (
    <div className="clock">
      <p className="clock-time tnum">
        <Glyph kind="clock" size={16} />
        {formatTime(world.now)}
      </p>
      <p className="muted small">
        Waiting period {formatDuration(world.delay)} · change sets expire {formatDuration(world.expiry)} after they become ready
      </p>
      {onAdvance ? (
        <div className="button-row" role="group" aria-label="Advance time">
          <Button id="clock-1h" size="sm" onClick={() => onAdvance(3600)}>
            +1 hour
          </Button>
          <Button id="clock-1d" size="sm" onClick={() => onAdvance(86400)}>
            +1 day
          </Button>
          <Button id="clock-7d" size="sm" onClick={() => onAdvance(7 * 86400)}>
            +7 days
          </Button>
          {next > 0 ? (
            <Button id="clock-ready" size="sm" onClick={() => onAdvance(next)}>
              Skip to ready ({formatDuration(next)})
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export interface LogEntry {
  at: number
  label: string
  ok: boolean
  why: string
}

export function Activity({ log }: { log: LogEntry[] }) {
  const items = [...log].reverse().slice(0, 12)
  if (items.length === 0) return <p className="muted small">No transactions yet.</p>
  return (
    <ol className="activity">
      {items.map((h, i) => (
        <li key={i}>
          <Status status={h.ok ? 'pass' : 'fail'} label={h.ok ? 'Allowed' : 'Blocked'} compact />
          <div>
            <p className="small">{h.label}</p>
            <p className="muted small tnum">
              {formatShortTime(h.at)}
              {h.why ? ` · ${h.why}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function SafeHeader({ world, badge }: { world: World; badge?: ReactNode }) {
  const safe = world.book.find((b) => b.kind === 'safe')
  return (
    <div className="safe-header">
      <div>
        <p className="safe-name">{safe?.label || 'Treasury Safe'}</p>
        <p className="mono muted small" title={world.safe.address}>
          {shortAddress(world.safe.address)}
        </p>
      </div>
      {badge}
    </div>
  )
}

