/**
 * Public types of the playground engine. This file is the contract between the engine, the UI,
 * the content files (scenarios/, challenges/) and the conformance harness. See docs/SPEC.md for
 * the behaviour behind each field. Change it only together with SPEC.md.
 *
 * Conventions
 * - Every "name" is a key of the address book (`Alice`, `USDC`, `PolicyGuard`, ...) or a 0x address.
 * - Human amounts are decimal strings in the asset's own units ("1.5" ETH, "100" USDC).
 * - Base-unit amounts inside a World are decimal strings (bigints are not JSON-serializable).
 * - A World is plain JSON: it can be cloned with structuredClone and stored as-is.
 */

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

export type PolicyName =
  | 'AllowPolicy'
  | 'DenyPolicy'
  | 'OneTimeAllowPolicy'
  | 'AllowedModulePolicy'
  | 'NativeTransferPolicy'
  | 'ERC20TransferPolicy'
  | 'ERC20ApprovePolicy'
  | 'MultiSendPolicy'
  | 'CoSignerPolicy'
  | 'IncreasedThresholdPolicy'
  | 'SafenetPolicy'

export type OperationName = 'CALL' | 'DELEGATECALL'

/** ERC-20 style permission stored by ERC20TransferPolicy / ERC20ApprovePolicy. Enum order on chain: NONE=0, ONCE=1, ALWAYS=2. */
export type PermissionName = 'NONE' | 'ONCE' | 'ALWAYS'

/** Address-book entry kinds. */
export type EntityKind = 'safe' | 'guard' | 'policy' | 'person' | 'service' | 'token' | 'weth' | 'multisend' | 'module' | 'contract'

export interface Entity {
  name: string // canonical key, e.g. 'AllowanceModule'
  label: string // what people read, e.g. 'Allowance Module'
  address: string // checksummed 0x address
  kind: EntityKind
  decimals?: number // tokens only
  symbol?: string // tokens only
  description?: string // one plain sentence
}

// ---------------------------------------------------------------------------------------------
// Rules (policy configuration entries)
// ---------------------------------------------------------------------------------------------

/** Friendly per-policy configuration. The engine ABI-encodes it into the `data` bytes passed to `configure`. */
export type PolicyConfig =
  | Record<string, never> // Allow, Deny, NativeTransfer, MultiSend, Safenet: no data
  | { granted: boolean } // OneTimeAllowPolicy
  | { module: string; allowed: boolean } // AllowedModulePolicy
  | { cosigner: string } // CoSignerPolicy
  | { maxAbsent: number } // IncreasedThresholdPolicy
  | { recipients: { account: string; permission: PermissionName }[] } // ERC20TransferPolicy
  | { spenders: { account: string; permission: PermissionName }[] } // ERC20ApprovePolicy

/**
 * One entry of a configuration (the on-chain `SafePolicyGuard.Configuration` struct).
 * Either `fallback` (sugar for target 0x0, selector 0x00000000) or `target` + `selector`.
 * `selector` is a function name from the function catalog (`transfer`, `multiSend`, ...),
 * a 4-byte hex string, or `"none"` for the empty-calldata key 0x00000000.
 * `policy: null` removes the entry (matching calls fall through to the fallback again).
 * `data` (hex) overrides `config` when given, for raw/advanced use.
 */
export interface RuleSpec {
  fallback?: OperationName
  target?: string
  selector?: string
  operation?: OperationName // default CALL; required meaning when `fallback` is set: the fallback's operation
  policy: PolicyName | null
  config?: PolicyConfig
  data?: string
  note?: string // optional plain-language note shown in the UI
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

/** Symbolic policy context. The conformance harness turns it into real bytes; the engine reasons about it symbolically. */
export type ContextSpec =
  | null
  | { type: 'cosignature'; signer: string; over?: 'self' | 'batch' } // 65-byte ECDSA by `signer` over the checked tx hash ('batch' = signed the outer batch instead)
  | { type: 'ownerSignatures'; signers: string[] } // Safe-style owner signatures over the checked tx hash
  | { type: 'attestation'; key: 'trusted' | 'untrusted'; valid: boolean } // Safenet FROST attestation
  | { type: 'batch'; items: ContextSpec[] } // MultiSendPolicy positional list (normally built by the engine from sub-tx contexts)

/** A structured call. Exactly the functions in the function catalog (docs/SPEC.md §4). */
export interface CallSpec {
  fn: string // catalog function name, e.g. 'transfer', 'setGuard', 'requestConfiguration', 'multiSend'
  args?: (string | number | boolean)[] // names or hex for addresses, human amounts for token amounts
  configurations?: RuleSpec[] // configureImmediately / requestConfiguration / applyConfiguration / invalidateRoot
  batch?: SubTxSpec[] // multiSend only
}

/** Sub-transaction of a MultiSend batch. */
export interface SubTxSpec {
  to: string // name or 0x; 0x000..0 means "the Safe itself" (MultiSend resolves it)
  value?: string // human ETH, default "0"
  operation?: OperationName // default CALL
  call?: CallSpec
  data?: string // raw hex calldata instead of `call`
  context?: ContextSpec // context for this sub-tx (positional, see SPEC §6.8)
  label?: string
}

export interface TxSpec {
  path?: 'owner' | 'module' // default 'owner'
  signers?: string[] // owner path: owners who sign; default = the first `threshold` owners
  module?: string // module path: which module executes
  to: string
  value?: string // human ETH, default "0"
  operation?: OperationName // default CALL
  call?: CallSpec
  data?: string // raw hex calldata instead of `call` (empty / omitted = no calldata)
  context?: ContextSpec // policy context carried in the signatures tail; owner path only
  safeTxGas?: string // default "0"
  gasPrice?: string // default "0"
  label?: string
}

// ---------------------------------------------------------------------------------------------
// Setup, world
// ---------------------------------------------------------------------------------------------

export interface SetupSpec {
  owners?: string[] // default ['Alice', 'Bob', 'Carol']
  threshold?: number // default 2
  modules?: string[] // enabled before hardening; default []
  balances?: Record<string, string> // Safe balances by asset name: { ETH: '10', USDC: '5000' }
  allowances?: { token: string; owner: string; spender: string; amount: string }[]
  rules?: RuleSpec[] // applied with configureImmediately before any guard is installed
  guards?: { transaction?: boolean; module?: boolean } // default both true
  delay?: number // seconds, default 3600
  expiry?: number // seconds, default 604800
}

/** Plain-JSON state of the simulated chain. Shape is engine-internal except where noted. */
export interface World {
  version: 1
  now: number // unix seconds
  delay: number
  expiry: number
  book: Entity[] // address book in use
  safe: {
    address: string
    owners: string[] // addresses, in Safe linked-list order
    threshold: number
    nonce: number
    modules: string[] // addresses
    txGuard: string | null // address or null
    moduleGuard: string | null
  }
  /** ETH and token balances in base units: balances[asset][holderAddress]. Asset is 'ETH' or a token address. */
  balances: Record<string, Record<string, string>>
  /** allowances[token][owner][spender] in base units */
  allowances: Record<string, Record<string, Record<string, string>>>
  /** The engine's policy table: access selector hex (32 bytes) -> entry. */
  table: Record<string, TableEntry>
  /** Policy-internal storage, namespaced as on chain by (guard, safe) — collapsed here to one namespace. */
  policyState: Record<string, unknown>
  /** rootConfigured[root] = validFrom (unix seconds). */
  roots: Record<string, { validFrom: number; configurations: RuleSpec[] }>
  /** Monotonic log of executed transactions (for the UI history). */
  history: HistoryEntry[]
}

export interface TableEntry {
  access: string // 32-byte hex access selector
  target: string // address
  selector: string // 4-byte hex
  operation: OperationName
  policy: PolicyName
  isFallback: boolean
  data: string // hex passed to configure (for display)
}

export interface HistoryEntry {
  at: number
  label: string
  ok: boolean
  summary: string
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/** Who stopped the transaction. */
export type ErrorSource = 'safe' | 'guard' | 'execution'

/**
 * A failure, nested the way the revert data nests on chain.
 * Examples:
 *   { by: 'guard', error: 'AccessDenied', policy: null }
 *   { by: 'guard', error: 'PolicyReverted', policy: 'MultiSendPolicy',
 *     reason: { by: 'guard', error: 'PolicyReverted', policy: 'ERC20TransferPolicy', reason: { by: 'guard', error: 'Unauthorized' } } }
 *   { by: 'execution', error: 'ERC20InsufficientBalance' }
 *   { by: 'safe', error: 'GS020' }
 * `error` is the Solidity custom-error name, a Safe `GSxxx` code, 'Reverted' (empty revert data)
 * or 'CallFailed' (module path, no module guard: the Safe returned false instead of reverting).
 */
export interface SimError {
  by: ErrorSource
  error: string
  policy?: PolicyName | null
  reason?: SimError
  args?: Record<string, string> // decoded error arguments for engineer view
  message: string // one plain-language sentence
}

export type TraceActor = 'Safe' | 'Guard' | 'Engine' | 'Policy' | 'MultiSend' | 'Target' | 'Module'
export type TraceStatus = 'info' | 'pass' | 'fail' | 'warn' | 'skip'

/** One step of the decision trace, in order. `depth` nests sub-transaction checks under a batch. */
export interface TraceEvent {
  id: string // stable code, e.g. 'safe.signatures', 'guard.gasPrice', 'engine.lookup.exact', 'policy.check', 'exec.call'
  depth: number
  actor: TraceActor
  status: TraceStatus
  title: string // short plain sentence, <= 80 chars
  detail?: string // plain explanation, 1-3 sentences
  tech?: string // engineer detail: hex, error signatures, contract function names
  policy?: PolicyName
  access?: string // access selector hex involved in this step
  subTx?: number // index of the batch step this event belongs to
}

/** A state change, for the "what changed" list. */
export interface Effect {
  kind: 'balance' | 'allowance' | 'guard' | 'module' | 'owners' | 'threshold' | 'rule' | 'policyState' | 'root' | 'nonce' | 'note'
  title: string // plain sentence, e.g. 'Dave received 500 USDC'
  tech?: string
  reverted?: boolean // true if this change was staged during the check but undone because the tx failed
}

export interface EncodedTx {
  to: string
  value: string // wei
  data: string // hex
  operation: 0 | 1
  accessSelector: string // the key the engine would compute (before fallback)
}

export interface SimResult {
  ok: boolean
  error?: SimError
  trace: TraceEvent[]
  effects: Effect[]
  world: World // the next world (equal to the input world when ok is false and nothing was committed)
  encoded: EncodedTx
  /** Which rule decided (the matched table entry), if any lookup happened at the top level. */
  matched?: { access: string; policy: PolicyName; isFallback: boolean } | null
}

// ---------------------------------------------------------------------------------------------
// Scenarios and challenges (JSON files under scenarios/ and challenges/)
// ---------------------------------------------------------------------------------------------

/** What a step must produce. Only the fields given are checked. */
export interface Expectation {
  ok: boolean
  by?: ErrorSource
  error?: string
  policy?: PolicyName | null
  reason?: Omit<Expectation, 'ok'>
}

export interface StateExpectation {
  balances?: Record<string, Record<string, string>> // holder name -> asset name -> human amount
  nonce?: number
  txGuard?: string | null // name or null
  moduleGuard?: string | null
  modules?: string[]
  threshold?: number
  owners?: string[]
}

export type ScenarioStep =
  | { do: 'tx'; label: string; tx: TxSpec; expect: Expectation; expectState?: StateExpectation; note?: string }
  | { do: 'wait'; label: string; seconds: number; note?: string }

export interface Scenario {
  id: string // kebab-case, equals the file name
  chapter: string // learning-path group, e.g. 'Basics'
  order: number // order within the whole path
  title: string // Title Case, a few words
  summary: string // one sentence: what you will see
  lesson: string // 1-3 sentences: the takeaway, plain language
  readme?: string // README section anchor this scenario illustrates
  setup: SetupSpec
  steps: ScenarioStep[]
  conformance?: boolean | string // false or a reason string = skip on-chain check; default true
  engine?: boolean | string // false or a reason string = skip the engine replay (the chain outcome depends on something the engine does not model); default true
}

export type ChallengeVerdict = 'pass' | 'block'

export interface ChallengeTest {
  label: string
  tx: TxSpec
  want: ChallengeVerdict
}

export interface Challenge {
  id: string
  level: number
  title: string
  brief: string // the story and goal, plain language
  setup: SetupSpec // `rules` here are the starting rules the player edits
  allowedPolicies: PolicyName[]
  parRules: number // rule count for full marks
  tests: ChallengeTest[]
  testMode?: 'independent' | 'sequence' // default independent: each test runs on a fresh copy of the configured world
  hints: string[]
  solution: RuleSpec[]
  explain: string // shown after solving
  conformance?: boolean | string
}

export interface ChallengeTestResult {
  test: ChallengeTest
  result: SimResult
  verdict: ChallengeVerdict
  matches: boolean
}

export interface ChallengeReport {
  solved: boolean
  results: ChallengeTestResult[]
  ruleCount: number
  stars: 0 | 1 | 2 | 3 // 0 unsolved; 3 = solved within par; 2 = par+1..par+2; 1 = more
  setupError?: SimError // the player's rules could not be configured (e.g. PolicyConfigurationFailed)
}

export interface StepOutcome {
  step: ScenarioStep
  result?: SimResult // tx steps only
  world: World // world after the step
  matches?: boolean // tx steps: did the result meet `expect` (and expectState)?
  mismatch?: string // human-readable reason when matches is false
}

// ---------------------------------------------------------------------------------------------
// Engine API (implemented in src/engine/index.ts)
// ---------------------------------------------------------------------------------------------

export interface EngineApi {
  /** The default address book. */
  book(): Entity[]
  /** The function catalog: name -> { signature, selector, target kinds it applies to }. */
  functions(): FunctionInfo[]
  /** Build a world from a setup: create Safe, enable modules, fund, configureImmediately(rules), install guards. Throws SetupError if a rule cannot be configured. */
  createWorld(setup?: SetupSpec): World
  /** Simulate one transaction. Pure: never mutates `world`. */
  simulate(world: World, tx: TxSpec): SimResult
  /** Move the clock. Pure. */
  advanceTime(world: World, seconds: number): World
  /** Which table entry would handle (to, data, operation)? No side effects; used for live previews. */
  lookup(world: World, to: string, data: string, operation: OperationName): { access: string; entry: TableEntry | null; usedFallback: boolean } | { error: SimError }
  /** Encode a tx without simulating it (engineer view, copy-calldata). */
  encode(world: World, tx: TxSpec): EncodedTx
  /** Configuration root (keccak256 of the ABI-encoded Configuration[]), exactly as SafePolicyGuard computes it. */
  configurationRoot(world: World, rules: RuleSpec[]): string
  /** Run a scenario from its setup through every step. */
  runScenario(scenario: Scenario): StepOutcome[]
  /** Run a challenge with the player's rules. */
  runChallenge(challenge: Challenge, rules: RuleSpec[]): ChallengeReport
  /** Does a result satisfy an expectation? Returns null when it does, else a reason. */
  checkExpectation(result: SimResult, expect: Expectation): string | null
  /** Resolve a name or address to its entity (or a synthetic one for unknown addresses). */
  resolve(world: World, nameOrAddress: string): Entity
}

export interface FunctionInfo {
  name: string // 'transfer'
  signature: string // 'transfer(address,uint256)'
  selector: string // '0xa9059cbb'
  on: EntityKind[] // where it makes sense: ['token', 'weth']
  label: string // plain label, e.g. 'Send tokens'
  args: { name: string; type: 'address' | 'amount' | 'uint' | 'bytes32' | 'bool'; label: string }[]
}

export class SetupError extends Error {
  constructor(
    message: string,
    public readonly error: SimError
  ) {
    super(message)
  }
}
