/**
 * Edit one rulebook row in plain words:
 * "When the Safe [action] on [contract] ([call type]) → [policy] with [settings]".
 */
import { useMemo, useState } from 'react'
import type { OperationName, PolicyConfig, PolicyName, RuleSpec, SimError, World } from '../../engine/types.ts'
import { engine } from '../sources.ts'
import { ALL_POLICIES, policyInfo, policyLabel } from '../lib/content.ts'
import { entity, fnBySelector, keyOf, ZERO_SELECTOR } from '../lib/describe.ts'
import { ACTION_WORDS } from '../lib/simpleWords.ts'
import { setupSentence } from '../lib/simpleReason.ts'
import { PolicyConfigForm, defaultConfig } from '../components/RuleEditor.tsx'
import { Button, Callout, Segmented, Select } from '../components/ui.tsx'
import type { Option } from '../components/ui.tsx'

const ELSE = '__else'

const CONTRACTS: Option[] = [
  { value: 'USDC', label: 'USDC', group: 'Tokens' },
  { value: 'SAFE', label: 'SAFE token', group: 'Tokens' },
  { value: 'WETH', label: 'Wrapped Ether', group: 'Tokens' },
  { value: 'Safe', label: 'The Safe itself', group: 'The Safe' },
  { value: 'MultiSend', label: 'Batches', group: 'The Safe' },
  { value: 'Dave', label: 'Dave', group: 'People' },
  { value: 'Erin', label: 'Erin', group: 'People' },
  { value: 'Mallory', label: 'Mallory', group: 'People' },
  { value: 'Alice', label: 'Alice', group: 'People' },
  { value: 'Bob', label: 'Bob', group: 'People' },
  { value: 'Carol', label: 'Carol', group: 'People' },
  { value: 'MysteryContract', label: 'Unknown contract', group: 'Other' },
  { value: ELSE, label: 'Anything else', group: 'Other' }
]

const ACTIONS: Record<string, string[]> = {
  token: ['transfer', 'approve', 'transferFrom'],
  weth: ['transfer', 'approve', 'transferFrom', 'deposit', 'withdraw', 'none'],
  safe: ['addOwnerWithThreshold', 'removeOwner', 'changeThreshold', 'enableModule', 'disableModule', 'setGuard', 'setModuleGuard'],
  multisend: ['multiSend'],
  person: ['none'],
  contract: ['none']
}

function actionsFor(world: World, contract: string): string[] {
  if (contract === ELSE) return []
  return ACTIONS[entity(world, contract).kind] ?? ['none']
}

const actionLabel = (a: string) => (a === 'none' ? 'Send ETH' : (ACTION_WORDS[a] ?? a))

function hasSettings(p: PolicyName): boolean {
  return ['ERC20TransferPolicy', 'ERC20ApprovePolicy', 'CoSignerPolicy', 'IncreasedThresholdPolicy', 'AllowedModulePolicy', 'OneTimeAllowPolicy'].includes(p)
}

export function RowEditor({
  world,
  initial,
  allowed,
  onSave,
  onCancel,
  idPrefix,
  saveLabel = 'Save rule'
}: {
  world: World
  initial?: RuleSpec
  allowed?: PolicyName[]
  onSave: (r: RuleSpec) => void
  onCancel: () => void
  idPrefix: string
  saveLabel?: string
}) {
  const policies = allowed && allowed.length ? allowed : ALL_POLICIES
  const initContract = initial?.fallback ? ELSE : initial?.target ? keyOf(world, initial.target) : 'USDC'
  const sel = initial?.selector ?? 'transfer'
  const initAction = sel === 'none' || sel.toLowerCase() === ZERO_SELECTOR ? 'none' : (fnBySelector(sel)?.name ?? sel)
  const [contract, setContract] = useState(initContract)
  const [action, setAction] = useState(initAction)
  const [op, setOp] = useState<OperationName>(initial?.fallback ?? initial?.operation ?? 'CALL')
  const initPolicy = (initial?.policy && policies.includes(initial.policy) ? initial.policy : policies[0]) as PolicyName
  const [policy, setPolicy] = useState<PolicyName>(initPolicy)
  const [config, setConfig] = useState<Record<string, unknown>>((initial?.config as Record<string, unknown>) ?? defaultConfig(world, initPolicy))

  const actions = actionsFor(world, contract)
  const act = actions.includes(action) ? action : (actions[0] ?? 'none')
  const isElse = contract === ELSE

  const changeContract = (c: string) => {
    setContract(c)
    const next = actionsFor(world, c)
    if (next.length && !next.includes(action)) setAction(next[0])
    setOp(c === 'MultiSend' ? 'DELEGATECALL' : 'CALL')
  }

  const rule = (): RuleSpec => {
    const r: RuleSpec = isElse ? { fallback: op, policy } : { target: contract, selector: act, operation: op, policy }
    if (hasSettings(policy)) r.config = config as PolicyConfig
    return r
  }
  const key = JSON.stringify(rule())
  const problem = useMemo((): SimError | null => {
    try {
      engine.createWorld({ rules: [JSON.parse(key) as RuleSpec], guards: { transaction: false, module: false } })
      return null
    } catch (e) {
      return (e as { error?: SimError }).error ?? { by: 'guard', error: 'PolicyConfigurationFailed', message: '' }
    }
  }, [key])

  return (
    <div className="row-editor" role="group" aria-label="Edit a rule">
      <p className="row-sentence">
        <span>When the Safe</span>
        {isElse ? (
          <span className="muted">does anything without its own rule</span>
        ) : (
          <Select id={`${idPrefix}-action`} ariaLabel="Action" value={act} onChange={setAction} options={actions.map((a) => ({ value: a, label: actionLabel(a).toLowerCase() }))} />
        )}
        {isElse ? null : <span>{entity(world, contract).kind === 'person' ? 'to' : 'on'}</span>}
        <Select id={`${idPrefix}-contract`} ariaLabel="Contract" value={contract} onChange={changeContract} options={CONTRACTS} />
      </p>
      <div className="row-line">
        <span className="row-label">Call type</span>
        <Segmented
          id={`${idPrefix}-op`}
          label="Call type"
          size="sm"
          value={op}
          onChange={setOp}
          options={[
            { value: 'CALL', label: 'Normal' },
            { value: 'DELEGATECALL', label: 'Delegatecall' }
          ]}
        />
      </div>
      <div className="row-line">
        <span className="row-label">Policy</span>
        <Select
          id={`${idPrefix}-policy`}
          ariaLabel="Policy"
          value={policy}
          onChange={(v) => {
            setPolicy(v as PolicyName)
            setConfig(defaultConfig(world, v as PolicyName))
          }}
          options={policies.map((p) => ({ value: p, label: policyLabel(p) }))}
        />
      </div>
      {policyInfo(policy)?.oneLiner ? <p className="muted small">{policyInfo(policy)?.oneLiner}</p> : null}
      {hasSettings(policy) ? <PolicyConfigForm id={`${idPrefix}-cfg`} world={world} policy={policy} config={config} onChange={setConfig} /> : null}
      {problem ? (
        <Callout tone="warning" title="The Policy Guard would refuse this rule">
          {setupSentence(world, null, problem, policy, isElse)}
        </Callout>
      ) : null}
      <div className="button-row">
        <Button id={`${idPrefix}-save`} variant="primary" onClick={() => onSave(rule())} disabled={!!problem}>
          {saveLabel}
        </Button>
        <Button id={`${idPrefix}-cancel`} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
