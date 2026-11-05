/** One-line summaries of a run: "Allowed", "Blocked at Policy (Recipient Allowlist)". */
import type { SimResult } from '../../engine/types.ts'
import { policyLabel, shortReason } from './content.ts'
import { stopPoint } from './pipeline.ts'

export interface RunLine {
  ok: boolean
  word: 'Allowed' | 'Blocked' | 'Failed'
  stage?: string // "Policy"
  why?: string // "Recipient Allowlist" or an error title
  text: string // "Blocked at Policy (Recipient Allowlist)"
}

export function runLine(result: SimResult, path: 'owner' | 'module' = 'owner'): RunLine {
  if (result.ok) return { ok: true, word: 'Allowed', text: 'Allowed' }
  const word = result.error?.by === 'execution' ? 'Failed' : 'Blocked'
  const sp = stopPoint(result, path, (p) => (p ? policyLabel(p) : shortReason(result.error)))
  if (!sp) return { ok: false, word, text: word }
  return { ok: false, word, stage: sp.stage, why: sp.why, text: `${word} at ${sp.stage} (${sp.why})` }
}
