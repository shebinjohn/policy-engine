/**
 * Turns the engine's flat trace into the decision path the UI draws:
 * Signatures (or Module) → Guard checks → Rule lookup → Policy → Execution.
 * Events deeper than the current level (batch sub-transactions) become nested blocks, each with its
 * own stages, grouped by `subTx`.
 */
import type { PolicyName, TraceEvent, TraceStatus } from '../../engine/types.ts'

export type StageKey = 'auth' | 'guard' | 'lookup' | 'policy' | 'exec'
export type StageStatus = TraceStatus | 'none'

export const STAGE_ORDER: StageKey[] = ['auth', 'guard', 'lookup', 'policy', 'exec']

export interface EventItem {
  type: 'event'
  ev: TraceEvent
}
export interface SubItem {
  type: 'sub'
  index: number
  header?: TraceEvent
  stages: Stage[]
  status: StageStatus
}
export type PipeItem = EventItem | SubItem

export interface Stage {
  key: StageKey
  items: PipeItem[]
  status: StageStatus
  policy?: PolicyName
}

/** commit and rollback close the run: they belong under the outcome node, not to a stage. */
export function splitEnd(trace: TraceEvent[]): { main: TraceEvent[]; end: TraceEvent[] } {
  const isEnd = (e: TraceEvent) => e.depth === 0 && (e.id === 'commit' || e.id === 'rollback')
  return { main: trace.filter((e) => !isEnd(e)), end: trace.filter(isEnd) }
}

export function stageOf(id: string): StageKey {
  if (id.startsWith('safe.') || id.startsWith('module.')) return 'auth'
  if (id.startsWith('engine.lookup')) return 'lookup'
  if (id.startsWith('policy.') || id === 'multisend.step') return 'policy'
  if (id.startsWith('exec.') || id === 'guard.after' || id === 'commit' || id === 'rollback') return 'exec'
  if (id.startsWith('guard.') || id.startsWith('engine.')) return 'guard'
  return 'exec'
}

const RANK: Record<StageStatus, number> = { none: 0, skip: 1, info: 2, pass: 3, warn: 4, fail: 5 }

export function combine(statuses: StageStatus[]): StageStatus {
  let best: StageStatus = 'none'
  for (const s of statuses) if (RANK[s] > RANK[best]) best = s
  return best
}

function itemStatus(it: PipeItem): StageStatus {
  return it.type === 'event' ? it.ev.status : it.status
}

export function buildStages(events: TraceEvent[], depth = 0): Stage[] {
  const stages = new Map<StageKey, Stage>(STAGE_ORDER.map((k) => [k, { key: k, items: [], status: 'none' }]))
  let current: StageKey = 'auth'
  const subs = new Map<string, { item: SubItem; events: TraceEvent[] }>()
  let run = 0

  for (const ev of events) {
    const nested = ev.depth > depth || (ev.id === 'multisend.step' && ev.depth >= depth)
    if (!nested) {
      current = stageOf(ev.id)
      run++
      const st = stages.get(current)!
      st.items.push({ type: 'event', ev })
      if (ev.policy && current === 'policy' && !st.policy) st.policy = ev.policy
      continue
    }
    // A nested event belongs to the block of its sub-transaction, inside the stage it occurs in.
    const owner: StageKey = ev.id === 'multisend.step' && ev.depth === depth ? 'policy' : current
    const index = ev.subTx ?? -1
    const key = `${owner}:${index}:${index === -1 ? run : 0}`
    let entry = subs.get(key)
    if (!entry) {
      entry = { item: { type: 'sub', index, stages: [], status: 'none' }, events: [] }
      subs.set(key, entry)
      stages.get(owner)!.items.push(entry.item)
    }
    if (ev.id === 'multisend.step' && !entry.item.header) entry.item.header = ev
    else entry.events.push(ev)
  }

  for (const { item, events: evs } of subs.values()) {
    item.stages = buildStages(evs, depth + 1)
    const own = item.header ? [item.header.status === 'info' ? 'none' : item.header.status] : []
    item.status = combine([...own, ...item.stages.map((s) => s.status)] as StageStatus[])
  }
  for (const st of stages.values()) {
    // The lookup ends with its last step (an exact miss followed by a catch-all hit is a hit).
    const last = st.items[st.items.length - 1]
    st.status = st.key === 'lookup' && last ? itemStatus(last) : combine(st.items.map(itemStatus))
  }

  // Stages with no events: skipped when a later stage ran, otherwise not reached.
  const list = STAGE_ORDER.map((k) => stages.get(k)!)
  let laterRan = false
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].items.length > 0) laterRan = true
    else if (laterRan) list[i].status = 'skip'
  }
  return list
}

export function stageLabel(key: StageKey, path: 'owner' | 'module', nested: boolean): string {
  switch (key) {
    case 'auth':
      return nested ? 'Sub-transaction' : path === 'module' ? 'Module' : 'Signatures'
    case 'guard':
      return 'Guard checks'
    case 'lookup':
      return 'Rule lookup'
    case 'policy':
      return 'Policy'
    case 'exec':
      return 'Execution'
  }
}

export function statusWord(key: StageKey, status: StageStatus): string {
  if (status === 'none') return 'Not reached'
  if (status === 'skip') return 'Skipped'
  if (status === 'warn') return 'Warning'
  if (status === 'info') return 'Done'
  const ok = status === 'pass'
  switch (key) {
    case 'auth':
      return ok ? 'Passed' : 'Failed'
    case 'guard':
      return ok ? 'Passed' : 'Blocked'
    case 'lookup':
      return ok ? 'Rule found' : 'No rule'
    case 'policy':
      return ok ? 'Approved' : 'Rejected'
    case 'exec':
      return ok ? 'Executed' : 'Reverted'
  }
}
