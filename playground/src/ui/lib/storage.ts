/**
 * Per-viewer conveniences in localStorage: Engineer view, guessing preference, the Start here cue,
 * scenario and challenge progress. Every access is wrapped, because storage can be missing or throw
 * (private windows, previews, blocked site data). The page works the same without it; progress
 * then lasts only for the visit.
 */

const KEY = 'policy-playground:v1'

export interface ChallengeProgress {
  stars: number
  solvedAt?: number
  /** Fewest rules in a solve that earned stars. */
  rules?: number
  /** Solved only with the shown solution: no stars. */
  withSolution?: boolean
}

export interface Stored {
  engineer?: boolean
  /** Scenarios: run steps without guessing first. */
  skipGuess?: boolean
  /** The Sandbox "Start here" line was dismissed. */
  startDismissed?: boolean
  progress?: Record<string, ChallengeProgress>
  /** Scenario ids walked to the end. */
  scenariosDone?: Record<string, true>
  /** Where the viewer last was in the scenarios: id and 1-based step. */
  lastScenario?: { id: string; step: number }
}

let memory: Stored = {}
let loaded = false

export function load(): Stored {
  if (loaded) return memory
  loaded = true
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) memory = { ...memory, ...(JSON.parse(raw) as Stored) }
  } catch {
    // storage unavailable: keep the in-memory copy
  }
  return memory
}

export function save(patch: Partial<Stored>): Stored {
  load()
  memory = { ...memory, ...patch }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    // ignore
  }
  return memory
}
