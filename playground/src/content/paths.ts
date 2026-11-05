/**
 * Links between the learning path and the practice: which challenges close each chapter, which
 * scenario teaches the idea a challenge needs, and which scenario shows each policy at work.
 * Owned by the UI. Ids match scenarios/*.json, challenges/*.json and CHAPTERS.
 *
 * Derived from the content (5 Nov 2026). Each challenge sits in the chapter whose scenarios teach
 * its central idea; nothing is locked by this map.
 */
import type { PolicyName } from '../engine/types.ts'

/** Chapter id -> the challenges that practise it, in suggested order. */
export const CHAPTER_CHALLENGES: Record<string, string[]> = {
  'how-a-check-works': ['pay-the-vendor'],
  'rules-and-catch-all': ['no-wrapped-ether', 'co-signed-invoice'],
  'policies-at-work': ['a-bonus-for-erin', 'gas-money', 'revoke-only'],
  batches: ['monthly-payroll', 'night-shift'],
  'modules-and-guards': ['allowance-module'],
  'changing-the-rules': ['retiring-the-guard']
}

/** Challenge id -> the scenario that teaches the idea it needs (the third rung of the hint ladder). */
export const CHALLENGE_TEACHER: Record<string, string> = {
  'pay-the-vendor': 'recipient-allowlist',
  'a-bonus-for-erin': 'recipient-allowlist',
  'gas-money': 'plain-eth-transfers',
  'revoke-only': 'approvals-and-revokes',
  'allowance-module': 'module-paths',
  'monthly-payroll': 'every-step-checked',
  'co-signed-invoice': 'catch-all-cosigner',
  'no-wrapped-ether': 'weth-fallback',
  'night-shift': 'co-sign-each-step',
  'retiring-the-guard': 'guard-removal'
}

/** Policy -> the scenario that shows it at work ("See it in action" on Learn). */
export const POLICY_SCENARIO: Record<PolicyName, string> = {
  AllowPolicy: 'exact-rule-match',
  DenyPolicy: 'deny-beats-catch-all',
  OneTimeAllowPolicy: 'failed-batch-keeps-grant',
  AllowedModulePolicy: 'module-paths',
  NativeTransferPolicy: 'plain-eth-transfers',
  ERC20TransferPolicy: 'recipient-allowlist',
  ERC20ApprovePolicy: 'approvals-and-revokes',
  MultiSendPolicy: 'every-step-checked',
  CoSignerPolicy: 'catch-all-cosigner',
  IncreasedThresholdPolicy: 'more-owner-signatures',
  SafenetPolicy: 'safenet-attestations'
}

/** The chapter a challenge builds on, from CHAPTER_CHALLENGES. */
export function chapterOfChallenge(challengeId: string): string | undefined {
  return Object.keys(CHAPTER_CHALLENGES).find((c) => CHAPTER_CHALLENGES[c].includes(challengeId))
}
