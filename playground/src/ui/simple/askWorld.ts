/** The Safe behind "Will this pass?" and the example rulebooks people can start from. */
import type { RuleSpec, SetupSpec, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { PRESETS } from '../lib/presets.ts'

export const ASK_BASE: SetupSpec = {
  owners: ['Alice', 'Bob', 'Carol'],
  threshold: 2,
  modules: ['AllowanceModule'],
  balances: { ETH: '12', USDC: '250000', SAFE: '40000', WETH: '5' }
}

export interface RulebookPreset {
  id: string
  label: string
  rules: RuleSpec[]
}

export const RULEBOOKS: RulebookPreset[] = [
  { id: 'treasury', label: 'Treasury example', rules: (PRESETS.find((p) => p.id === 'example')?.setup.rules ?? []).map(({ note: _n, ...r }) => r) },
  { id: 'nothing', label: 'Nothing allowed', rules: [] },
  {
    id: 'everything',
    label: 'Everything allowed',
    rules: [
      { fallback: 'CALL', policy: 'AllowPolicy' },
      { fallback: 'DELEGATECALL', policy: 'AllowPolicy' }
    ]
  },
  { id: 'cosigner', label: 'Co-signer for anything else', rules: [{ fallback: 'CALL', policy: 'CoSignerPolicy', config: { cosigner: 'CoSigner' } }] }
]

/** A fresh guarded Safe with these rules, or the reason it cannot be set up. */
export function askWorld(rules: RuleSpec[]): { world: World; error: string | null } {
  try {
    return { world: engine.createWorld({ ...ASK_BASE, rules }), error: null }
  } catch (e) {
    return { world: engine.createWorld({ ...ASK_BASE, rules: [] }), error: (e as Error).message }
  }
}
