/**
 * Per-viewer conveniences in localStorage: Engineer view and challenge progress. Every access is
 * wrapped, because storage can be missing or throw (private windows, previews, blocked site data).
 * The page works the same without it; progress then lasts only for the visit.
 */

const KEY = 'policy-playground:v1'

export interface Stored {
  engineer?: boolean
  progress?: Record<string, { stars: number; solvedAt?: number }>
}

let memory: Stored = {}

export function load(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) memory = { ...memory, ...(JSON.parse(raw) as Stored) }
  } catch {
    // storage unavailable: keep the in-memory copy
  }
  return memory
}

export function save(patch: Partial<Stored>): Stored {
  memory = { ...memory, ...patch }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    // ignore
  }
  return memory
}
