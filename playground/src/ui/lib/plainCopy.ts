/**
 * Challenge copy for the simple layer. Some briefs and hints were written for the detailed view and
 * name code (ERC20TransferPolicy, DELEGATECALL, calldata, selector). This maps them to the simple
 * layer's words (SIMPLE_LAYER.md §5) at display time; the content files stay as they are.
 */
import { ALL_POLICIES, policyLabel } from './content.ts'

const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  // "Recipient Allowlist (ERC20TransferPolicy)" -> "Recipient Allowlist"
  [/\s*\(([A-Z][A-Za-z0-9]*Policy)\)/g, ''],
  [/\b(?:the empty selector, none|selector none|selector zero)\b/g, 'the plain ETH action'],
  [/\bSelector Zero\b/g, 'Four Zero Bytes'],
  [/\bgas settings\b/g, 'refund settings'],
  [/\b([Aa]) signature\b/g, (_m, a) => (a === 'A' ? 'An approval' : 'an approval')],
  [/\bfunction multiSend\b/g, 'the action Run a batch'],
  [/\boperation DELEGATECALL\b/g, 'call type delegatecall'],
  [/\bon setGuard and on setModuleGuard\b/g, 'on changing the guard, for owners and for modules,'],
  [/\bsetModuleGuard\b/g, 'changing the guard for modules'],
  [/\bsetGuard\b/g, 'changing the guard'],
  [/\bmultiSend\b/g, 'running a batch'],
  [/\bMultiSend\b(?!Policy)/g, 'Batches'],
  [/\bplain CALL\b/g, 'normal call'],
  [/\bDELEGATECALL\b/g, 'delegatecall'],
  [/\bCALL\b/g, 'normal call'],
  [/\bALWAYS\b/g, 'Always'],
  [/\bONCE\b/g, 'Once'],
  [/\bco-signatures\b/g, 'co-signer approvals'],
  [/\bco-signature\b/g, 'co-signer approval'],
  [/\bowner signatures\b/g, 'owners signing'],
  [/\bsignatures\b/g, 'approvals'],
  [/\bsignature\b/g, 'approval'],
  [/\b[Ee]mpty calldata\b/g, (m) => (m[0] === 'E' ? 'No extra data' : 'no extra data')],
  [/\bcalldata\b/g, 'extra data'],
  [/\bselector\b/g, 'action'],
  [/\bGas\b/g, 'Fee'],
  [/\bgas\b/g, 'fees']
]

export function plainCopy(text: string | undefined): string {
  if (!text) return ''
  let t = text
  for (const [re, to] of RULES) t = t.replace(re, to as string)
  for (const p of ALL_POLICIES) t = t.replace(new RegExp(`\\b${p}\\b`, 'g'), policyLabel(p))
  return t
}
