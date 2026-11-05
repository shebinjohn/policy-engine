/** Edit one rule: where it applies (target, action, call type, or catch-all) and which policy with which settings. */
import { useMemo, useState } from 'react'
import type { OperationName, PermissionName, PolicyConfig, PolicyName, RuleSpec, SimError, World } from '../../engine/types.ts'
import { ALL_POLICIES, errorInfo, pathSupport, policyInfo, policyLabel } from '../lib/content.ts'
import { engine } from '../sources.ts'
import { describeConfig, entity, fnByName, fnBySelector, fnsFor, keyOf, moduleNames, ZERO_SELECTOR } from '../lib/describe.ts'
import { AddressSelect, Button, Callout, Checkbox, Field, Glyph, Pill, Segmented, Select, TextInput, useEngineer } from './ui.tsx'
import type { Option } from './ui.tsx'

type Row = { account: string; permission: PermissionName }
type Config = {
  recipients?: Row[]
  spenders?: Row[]
  cosigner?: string
  maxAbsent?: number
  module?: string
  allowed?: boolean
  granted?: boolean
}

export function defaultConfig(world: World, policy: PolicyName): Config {
  switch (policy) {
    case 'ERC20TransferPolicy':
      return { recipients: [{ account: 'Dave', permission: 'ALWAYS' }] }
    case 'ERC20ApprovePolicy':
      return { spenders: [{ account: 'Dave', permission: 'ONCE' }] }
    case 'CoSignerPolicy':
      return { cosigner: 'CoSigner' }
    case 'IncreasedThresholdPolicy':
      return { maxAbsent: 0 }
    case 'AllowedModulePolicy':
      return { module: moduleNames(world)[0] ?? 'AllowanceModule', allowed: true }
    case 'OneTimeAllowPolicy':
      return { granted: true }
    default:
      return {}
  }
}

function hasConfig(policy: PolicyName): boolean {
  return ['ERC20TransferPolicy', 'ERC20ApprovePolicy', 'CoSignerPolicy', 'IncreasedThresholdPolicy', 'AllowedModulePolicy', 'OneTimeAllowPolicy'].includes(policy)
}

const PERM_OPTIONS: { value: PermissionName; label: string }[] = [
  { value: 'ALWAYS', label: 'Always' },
  { value: 'ONCE', label: 'Once' },
  { value: 'NONE', label: 'Not allowed' }
]

function AccountList({ id, world, rows, onChange, noun }: { id: string; world: World; rows: Row[]; onChange: (r: Row[]) => void; noun: string }) {
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="account-list">
      {rows.length === 0 ? <p className="muted small">Nobody listed yet.</p> : null}
      {rows.map((r, i) => (
        <div className="account-row" key={i}>
          <AddressSelect id={`${id}-acct-${i}`} ariaLabel={`${noun} ${i + 1}`} world={world} value={r.account} onChange={(v) => set(i, { account: v })} />
          <Segmented id={`${id}-perm-${i}`} label={`Permission for ${noun} ${i + 1}`} size="sm" value={r.permission} options={PERM_OPTIONS} onChange={(v) => set(i, { permission: v })} />
          <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} title={`Remove ${noun} ${i + 1}`}>
            <Glyph kind="close" size={14} />
            <span className="sr-only">Remove</span>
          </Button>
        </div>
      ))}
      <Button id={`${id}-add`} size="sm" onClick={() => onChange([...rows, { account: 'Erin', permission: 'ONCE' }])}>
        <Glyph kind="plus" size={14} />
        Add {noun}
      </Button>
    </div>
  )
}

export function PolicyConfigForm({ id, world, policy, config, onChange }: { id: string; world: World; policy: PolicyName; config: Config; onChange: (c: Config) => void }) {
  switch (policy) {
    case 'ERC20TransferPolicy':
      return (
        <Field label="Who may receive tokens">
          <AccountList id={`${id}-rcpt`} world={world} noun="recipient" rows={config.recipients ?? []} onChange={(r) => onChange({ ...config, recipients: r })} />
        </Field>
      )
    case 'ERC20ApprovePolicy':
      return (
        <Field label="Who may be approved to spend">
          <AccountList id={`${id}-spnd`} world={world} noun="spender" rows={config.spenders ?? []} onChange={(r) => onChange({ ...config, spenders: r })} />
        </Field>
      )
    case 'CoSignerPolicy':
      return (
        <Field id={`${id}-cosigner`} label="Co-signer" hint="Their signature over this exact transaction is required. Each signature works once.">
          <AddressSelect id={`${id}-cosigner`} world={world} value={config.cosigner ?? 'CoSigner'} onChange={(v) => onChange({ ...config, cosigner: v })} />
        </Field>
      )
    case 'IncreasedThresholdPolicy': {
      const owners = world.safe.owners.length
      const maxAbsent = Number(config.maxAbsent ?? 0)
      return (
        <Field id={`${id}-absent`} label="Owners who may be absent" hint={describeConfig(world, policy, { maxAbsent }) + '. Never fewer than the threshold plus one.'}>
          <TextInput id={`${id}-absent`} inputMode="numeric" value={String(config.maxAbsent ?? 0)} onChange={(v) => onChange({ ...config, maxAbsent: Math.max(0, Math.min(owners, Number(v.replace(/\D/g, '')) || 0)) })} />
        </Field>
      )
    }
    case 'AllowedModulePolicy':
      return (
        <div className="stack-sm">
          <Field id={`${id}-module`} label="Module">
            <AddressSelect id={`${id}-module`} world={world} kinds={['module']} allowCustom={false} value={config.module ?? 'AllowanceModule'} onChange={(v) => onChange({ ...config, module: v })} />
          </Field>
          <Checkbox id={`${id}-module-allowed`} checked={config.allowed !== false} onChange={(v) => onChange({ ...config, allowed: v })} label="Allowed" hint="Owner transactions are always refused by this policy." />
        </div>
      )
    case 'OneTimeAllowPolicy':
      return <Checkbox id={`${id}-granted`} checked={config.granted !== false} onChange={(v) => onChange({ ...config, granted: v })} label="Grant one use" hint="The first matching transaction spends it." />
    default:
      return <p className="muted small">This policy has no settings.</p>
  }
}

const CUSTOM = '__custom'

export function RuleEditor({
  world,
  initial,
  allowedPolicies,
  onSave,
  onCancel,
  idPrefix,
  title,
  saveLabel = 'Save rule'
}: {
  world: World
  initial?: RuleSpec
  allowedPolicies?: PolicyName[]
  onSave: (r: RuleSpec) => void
  onCancel: () => void
  idPrefix: string
  title?: string
  saveLabel?: string
}) {
  const engineer = useEngineer()
  const policies = allowedPolicies && allowedPolicies.length ? allowedPolicies : ALL_POLICIES
  const initSelector = initial?.selector ?? 'transfer'
  const initAction =
    initSelector === 'none' || initSelector === ZERO_SELECTOR
      ? 'none'
      : fnByName(initSelector)
        ? initSelector
        : fnBySelector(initSelector)?.name ?? CUSTOM
  const [scope, setScope] = useState<'exact' | 'fallback'>(initial?.fallback ? 'fallback' : 'exact')
  const [target, setTarget] = useState(initial?.target ? keyOf(world, initial.target) : 'USDC')
  const [action, setAction] = useState<string>(initAction)
  const [custom, setCustom] = useState(initAction === CUSTOM ? initSelector : '0x')
  const [operation, setOperation] = useState<OperationName>(initial?.fallback ?? initial?.operation ?? 'CALL')
  const initPolicy = (initial?.policy && policies.includes(initial.policy) ? initial.policy : policies[0]) as PolicyName
  const [policy, setPolicy] = useState<PolicyName>(initPolicy)
  const [config, setConfig] = useState<Config>((initial?.config as Config) ?? defaultConfig(world, initPolicy))

  const kind = entity(world, target).kind
  const fns = fnsFor(kind).filter((f) => !['configureImmediately', 'applyConfiguration', 'requestConfiguration', 'invalidateRoot'].includes(f.name) || engineer)
  const actionOptions: Option[] = [
    ...fns.map((f) => ({ value: f.name, label: engineer ? `${f.label} · ${f.signature}` : f.label })),
    { value: 'none', label: 'Send ETH only (no data)' },
    ...(engineer || action === CUSTOM ? [{ value: CUSTOM, label: 'Custom selector…' }] : [])
  ]
  const actionValid = actionOptions.some((o) => o.value === action)

  const changeTarget = (t: string) => {
    setTarget(t)
    const k = entity(world, t).kind
    const next = fnsFor(k)
    if (action !== CUSTOM && action !== 'none' && !next.some((f) => f.name === action)) {
      const first = next[0]?.name ?? 'none'
      setAction(first)
      if (first === 'multiSend') setOperation('DELEGATECALL')
    }
  }
  const changeAction = (a: string) => {
    setAction(a)
    if (a === 'multiSend') setOperation('DELEGATECALL')
  }
  const changePolicy = (p: PolicyName) => {
    setPolicy(p)
    setConfig(defaultConfig(world, p))
  }

  const customOk = /^0x[0-9a-fA-F]{8}$/.test(custom)
  const canSave = scope === 'fallback' || (target !== '' && (action !== CUSTOM || customOk))
  const info = policyInfo(policy)

  const buildRule = (): RuleSpec => {
    const cfg = hasConfig(policy) ? (config as PolicyConfig) : undefined
    const rule: RuleSpec =
      scope === 'fallback'
        ? { fallback: operation, operation, policy }
        : { target, selector: action === CUSTOM ? custom : actionValid ? action : 'none', operation, policy }
    if (cfg) rule.config = cfg
    return rule
  }
  const save = () => onSave(buildRule())

  // Ask the engine whether the Policy Guard would accept this rule at all: set it up on a fresh
  // Safe with no guard. The policy's own configure decides (for example, the recipient allowlist
  // refuses a catch-all), so this stays faithful without repeating the contract rules here.
  const draftKey = JSON.stringify(buildRule())
  const setupProblem = useMemo((): SimError | null => {
    if (!canSave) return null
    try {
      engine.createWorld({ rules: [JSON.parse(draftKey) as RuleSpec], guards: { transaction: false, module: false } })
      return null
    } catch (e) {
      return (e as { error?: SimError }).error ?? null
    }
  }, [draftKey, canSave])
  const problemInfo = setupProblem ? errorInfo(setupProblem.error, setupProblem.policy ?? policy) : undefined
  const problemIsSpecific = !!setupProblem && problemInfo !== undefined && problemInfo !== errorInfo(setupProblem.error)

  return (
    <div className="editor" role="group" aria-label={title ?? 'Rule editor'}>
      {title ? <p className="editor-title">{title}</p> : null}
      <Field label="Applies to">
        <Segmented
          id={`${idPrefix}-scope`}
          label="Applies to"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'exact', label: 'A specific call' },
            { value: 'fallback', label: 'Catch-all' }
          ]}
        />
      </Field>
      {scope === 'exact' ? (
        <>
          <Field id={`${idPrefix}-target`} label="Target" hint={entity(world, target).description}>
            <AddressSelect id={`${idPrefix}-target`} world={world} value={target} onChange={changeTarget} />
          </Field>
          <Field id={`${idPrefix}-action`} label="Action">
            <Select id={`${idPrefix}-action`} value={actionValid ? action : 'none'} onChange={changeAction} options={actionOptions} />
          </Field>
          {action === CUSTOM ? (
            <Field id={`${idPrefix}-selector`} label="Function selector" hint={customOk ? undefined : 'Four bytes in hex, like 0xa9059cbb.'}>
              <TextInput id={`${idPrefix}-selector`} mono value={custom} onChange={setCustom} />
            </Field>
          ) : null}
        </>
      ) : (
        <p className="muted small">A catch-all rule checks every call that has no rule of its own, for one call type.</p>
      )}
      <Field label="Call type">
        <Segmented
          id={`${idPrefix}-op`}
          label="Call type"
          value={operation}
          onChange={setOperation}
          options={[
            { value: 'CALL', label: 'Normal call' },
            { value: 'DELEGATECALL', label: 'Delegatecall' }
          ]}
        />
      </Field>
      <Field id={`${idPrefix}-policy`} label="Policy" hint={info?.oneLiner}>
        <Select id={`${idPrefix}-policy`} value={policy} onChange={(v) => changePolicy(v as PolicyName)} options={policies.map((p) => ({ value: p, label: engineer ? `${policyLabel(p)} · ${p}` : policyLabel(p) }))} />
      </Field>
      <div className="chips">
        <Pill tone={pathSupport(policy).restricted ? 'warning' : 'neutral'}>{pathSupport(policy).label}</Pill>
        {info?.stateful ? <Pill tone="info">Remembers what it allowed</Pill> : null}
      </div>
      {info?.placement ? <p className="muted small">Where it fits: {info.placement}</p> : null}
      <PolicyConfigForm id={`${idPrefix}-cfg`} world={world} policy={policy} config={config} onChange={setConfig} />
      {info?.configHelp && hasConfig(policy) ? <p className="muted small">{info.configHelp}</p> : null}
      {setupProblem ? (
        <Callout tone="warning" title={`The Policy Guard would refuse this rule: ${problemInfo?.title ?? setupProblem.error}`}>
          {problemIsSpecific ? problemInfo?.plain : setupProblem.message}
          {problemInfo?.fix ? <> {problemInfo.fix}</> : null}
          {engineer ? <span className="mono small"> ({setupProblem.policy ?? policy}.{setupProblem.error})</span> : null}
        </Callout>
      ) : null}
      <div className="button-row">
        <Button id={`${idPrefix}-save`} variant="primary" onClick={save} disabled={!canSave}>
          {saveLabel}
        </Button>
        <Button id={`${idPrefix}-cancel`} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
