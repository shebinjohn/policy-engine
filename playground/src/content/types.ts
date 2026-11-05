/**
 * Shapes of the plain-language content modules in src/content/. Owned by the content author;
 * consumed by the UI. Engine trace copy lives in src/engine (see docs/SPEC.md §11).
 */
import type { PolicyName } from '../engine/types.ts'

/** One entry per error name the engine can return (Solidity custom error, Safe GS code, 'Reverted', 'CallFailed'). */
export interface ErrorInfo {
  name: string
  source: 'Safe' | 'Policy Guard' | 'Policy' | 'Token' | 'Execution'
  title: string // Title Case, a few words: 'Recipient Not Allowed'
  plain: string // 1-2 sentences a non-developer understands
  fix?: string // what to change so it passes, if anything
  tech?: string // engineer view: signature, where it is thrown
}

export interface PolicyInfo {
  name: PolicyName
  label: string // 'Recipient Allowlist'
  oneLiner: string // 'Only lets tokens go to people you list.'
  plain: string // 2-4 sentences
  paths: 'both' | 'owner-only' | 'module-only' // CoSigner, IncreasedThreshold, Safenet: owner-only; AllowedModule: module-only
  configHelp: string // how to fill its settings in the rule editor
  stateful: boolean // does a check change its stored state (spent grants, spent signatures)?
  pitfalls: string[] // short sentences, from the README's limitations
  placement: string // where this policy can be attached, e.g. 'Only on transfer or transferFrom of one token'
}

export interface Term {
  term: string
  plain: string
  tech?: string
}

export interface Chapter {
  id: string // matches Scenario.chapter
  title: string
  blurb: string
}
