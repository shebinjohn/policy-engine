# Policy Engine Playground: Engine Spec

This document defines exactly what the playground simulates. It is the contract between the four
parts of the playground:

| Part | Lives in | Owns |
| --- | --- | --- |
| Engine | `src/engine/` | The simulation: Safe, `SafePolicyGuard`, the 11 policies, execution effects |
| Content | `scenarios/`, `challenges/`, `src/content/` | Guided scenarios, challenges, glossary, error and policy explanations |
| Conformance | `conformance/` | Replays every scenario and challenge solution against the real contracts in Hardhat |
| UI | `src/ui/`, `scripts/build.mjs` | The single-file web app published as a Claude artifact |

Types are in [`src/engine/types.ts`](../src/engine/types.ts). Behaviour is defined here. Source of
truth for behaviour is always the Solidity in `../contracts/` (and Safe 1.5.0 from
`@safe-global/safe-smart-account`). Where this spec and the contracts disagree, the contracts win
and this spec is fixed.

## 1. Fidelity rules

1. The engine decides **exactly** what the contracts decide: same outcome, same error name, same
   policy blamed, same nesting of `PolicyReverted` reasons.
2. Calldata is real: the engine ABI-encodes every call with ethers and decodes selectors and
   arguments from those bytes, so the selector-zero, short-calldata and fallback-dispatch cases come
   out right.
3. Context (co-signatures, owner signatures, attestations) is **symbolic** (`ContextSpec`). The
   engine reasons about who signed what; the conformance harness produces real signatures.
4. State changes are staged on a copy and committed only if the whole transaction succeeds. A
   revert anywhere undoes everything, including policy state written during the check and the Safe
   nonce increment. The trace still shows the staged changes, marked `reverted`.
5. Addresses differ between the playground and a Hardhat run. Content refers to entities by
   **name** only; each side resolves names in its own address book.

## 2. Address book (canonical names)

Content may use only these names. The engine picks the addresses (stable, valid checksummed hex).
The conformance harness maps each name to a deployed contract or a funded test account.

| Name | Label | Kind | Notes |
| --- | --- | --- | --- |
| `Safe` | Treasury Safe | safe | The simulated Safe. As a `to` it means a self-call. |
| `PolicyGuard` | Policy Guard | guard | `SafePolicyGuard` instance |
| `MultiSend` | MultiSend (call only) | multisend | Safe 1.5.0 `MultiSendCallOnly` semantics |
| `USDC` | USDC | token | 6 decimals, OpenZeppelin ERC-20 semantics |
| `SAFE` | SAFE token | token | 18 decimals |
| `WETH` | Wrapped Ether | weth | WETH9 semantics: `deposit()`, `withdraw(uint256)`, payable fallback that deposits |
| `Alice`, `Bob`, `Carol` | | person | Default owners |
| `Dave` | Dave (vendor) | person | |
| `Erin` | Erin (contractor) | person | |
| `Mallory` | Mallory (attacker) | person | |
| `CoSigner` | Co-signer service | service | Key used by `CoSignerPolicy` |
| `AllowanceModule` | Allowance Module | module | Has no special logic; it just executes what it is told |
| `RecoveryModule` | Recovery Module | module | Same |
| `MysteryContract` | Unknown contract | contract | No code. Any call or delegatecall succeeds and does nothing |
| `Zero` | Zero address | contract | `0x0000000000000000000000000000000000000000` |
| `AllowPolicy` ... `SafenetPolicy` | | policy | One entity per policy, named exactly as the contract |

`ETH` is the native asset name in `balances`.

## 3. World and setup

`createWorld(setup)` builds the world the way a careful team hardens a Safe (README "Setup with
Safe"), and the conformance harness does the same steps on chain:

1. Create the Safe with `owners` (default Alice, Bob, Carol) and `threshold` (default 2), no guard,
   no fallback handler, nonce 0.
2. Enable `modules`.
3. Fund the Safe with `balances`; seed `allowances`.
4. If `rules` is non-empty, run `configureImmediately(rules)` as a Safe self-transaction through
   the guard contract (no guard installed yet, so unchecked). Each rule goes through the policy's
   `configure`; a failure throws `SetupError` (for example `PolicyConfigurationFailed`).
5. Install guards per `guards` (default both): `setModuleGuard(PolicyGuard)` **first**, then
   `setGuard(PolicyGuard)`. The order matters on chain: once the transaction guard is installed,
   the following `setModuleGuard` is an ordinary checked call and, with no rule for it, fails with
   `AccessDenied(null)` (verified by conformance). The README recommends installing both in one
   MultiSend; content that teaches installation must account for this.

**Hardening in one batch** (README "Setup with Safe": "Install both guards, ideally atomically via
MultiSend"). The recommended real-world flow is one owner transaction, a `DELEGATECALL` to
`MultiSend` with the steps `[configureImmediately(rules), setModuleGuard(PolicyGuard),
setGuard(PolicyGuard)]`, sent while no guard is installed. Rules for it (§9 "Batches and guard
changes"): no guard exists when the batch starts, so nothing is checked and the order of the two
`set*Guard` steps does not matter; but `configureImmediately` must come **before** both, because
once either guard slot points at the PolicyGuard it reverts `GuardAlreadyEnabled`, which reverts the
whole batch. Include a `MultiSend` rule (`MultiSendPolicy` on `multiSend`, `DELEGATECALL`) in the
rules if the Safe should be able to batch afterwards.

Setup transactions do not count: after setup the world's `nonce` is reset to 0 and `history` is
empty, so content can reason from a clean slate. (The harness reads its real nonce after setup and
compares deltas.)

Defaults: `delay` 3600 s, `expiry` 604800 s (the deploy script's values). `now` starts at
`1767225600` (2026-01-01 00:00 UTC).

## 4. Function catalog

`call.fn` must be one of these. `args` are positional; addresses are names or hex; `amount`
arguments are human units of the token being called (`USDC` → 6 decimals; `WETH`/`SAFE` → 18);
`uint` arguments are plain integers.

| fn | Signature | On |
| --- | --- | --- |
| `transfer` | `transfer(address,uint256)` | token, weth |
| `approve` | `approve(address,uint256)` | token, weth |
| `transferFrom` | `transferFrom(address,address,uint256)` | token, weth |
| `deposit` | `deposit()` | weth |
| `withdraw` | `withdraw(uint256)` | weth |
| `setGuard` | `setGuard(address)` | safe |
| `setModuleGuard` | `setModuleGuard(address)` | safe |
| `enableModule` | `enableModule(address)` | safe |
| `disableModule` | `disableModule(address,address)` | safe; `args: [module]` only, the engine fills `prevModule` |
| `changeThreshold` | `changeThreshold(uint256)` | safe |
| `addOwnerWithThreshold` | `addOwnerWithThreshold(address,uint256)` | safe |
| `removeOwner` | `removeOwner(address,address,uint256)` | safe; `args: [owner, threshold]`, the engine fills `prevOwner` |
| `configureImmediately` | `configureImmediately((address,bytes4,uint8,address,bytes)[])` | guard; uses `configurations` |
| `requestConfiguration` | `requestConfiguration(bytes32)` | guard; uses `configurations`, the engine computes the root |
| `applyConfiguration` | `applyConfiguration((address,bytes4,uint8,address,bytes)[])` | guard; uses `configurations` |
| `invalidateRoot` | `invalidateRoot(bytes32)` | guard; uses `configurations`, the engine computes the root |
| `multiSend` | `multiSend(bytes)` | multisend; uses `batch`, packed as Safe's `encodeMultiSend` |

A tx may give raw `data` (hex) instead of `call`. No `call` and no `data` means empty calldata.

## 5. Owner transaction (`path: 'owner'`)

Order follows `Safe.execTransaction` (1.5.0) and `SafePolicyGuard.checkTransaction`.

1. **Signatures** (Safe). Signers are sorted by address; the Safe needs `threshold` of them.
   Fewer than `threshold` signers → `{by:'safe', error:'GS020'}`. A non-owner among the first
   `threshold` sorted signers, or a duplicate → `GS026`. Content should only assert `by: 'safe'`
   for these, because on chain the appended context changes which GS code fires (with too few
   signers plus a context, conformance observed `GS026`, not `GS020`).
2. **Nonce** increments (staged). Policies compute hashes with `nonce - 1`, i.e. the nonce the
   owners signed.
3. **No transaction guard installed** → trace a `warn` ("No guard: the Safe runs this without any
   policy check") and go to execution.
4. **Guard pre-checks**: `gasPrice != 0` → `NonZeroGasPrice`; `safeTxGas != 0` → `NonZeroSafeTxGas`.
5. **Engine check** (§7) with `module = 0x0` and the tx `context`.
6. **Execution** (§9). A failed inner call reverts the whole tx with the inner revert data
   (Safe 1.5.0 bubbles it because `safeTxGas == 0 && gasPrice == 0`): `{by:'execution', error: <inner error name>}`.
   Empty revert data → `error: 'Reverted'`.
   With `safeTxGas != 0` and **no** guard installed (so nothing rejects the non-zero gas), a failed
   inner call does **not** revert: the Safe emits `ExecutionFailure`, the nonce is still used, and
   the result is `{ok:false, by:'execution', error:'CallFailed'}` with only the nonce committed.
7. `checkAfterExecution(success)` always passes here (a failure already reverted).
8. Commit.

## 6. Module transaction (`path: 'module'`)

1. Module not enabled → `{by:'safe', error:'GS104'}`.
2. **No module guard installed** → trace `warn` ("No module guard: modules bypass every policy")
   and go to execution.
3. **Engine check** (§7) with `module = <module address>` and **empty** context. A `context` on a
   module tx is ignored (trace a `warn`).
4. **Execution**. If the inner call fails:
   - module guard installed → `checkAfterModuleExecution` reverts `{by:'guard', error:'ModuleExecutionFailed'}`;
   - no module guard → no revert; the Safe returns `false`: `{by:'execution', error:'CallFailed'}`,
     nothing is committed (the failed call changed nothing) and `ok` is `false`.
5. Module transactions do not touch the nonce.

## 7. Engine check: `PolicyEngine.checkTransaction(safe, to, value, data, operation, context)`

Runs at depth 0 for the top-level tx and recursively at depth+1 for each MultiSend sub-tx.

1. **Allowed configuration calls** (`SafePolicyGuard._allowedCalls`): first decodes the selector
   (data of 1-3 bytes → `InvalidSelector`). If `to == PolicyGuard && value == 0 && operation == CALL`
   and the selector is `requestConfiguration`, `applyConfiguration` or `invalidateRoot`: on the
   module path → `ModuleConfigurationDenied`; otherwise **allowed with no policy** (trace: "Managing
   policies is always allowed, through the waiting period").
2. **Guard as target**: `to == PolicyGuard` (any other call) → `GuardTargetDenied`. This includes
   `configureImmediately` and any value transfer to the guard.
3. **Lookup** (`getPolicy`): selector = first 4 bytes, or `0x00000000` for empty data (1-3 bytes →
   `InvalidSelector`). Exact key = `selector | operation << 216 | to` (README access-selector
   layout). If no entry, fallback key = `operation << 216`. Trace both: exact hit, or exact miss
   then fallback hit, or both miss.
4. No policy → `AccessDenied(policy = null)`.
5. **Policy check** (§8) with the resolved `access` (the fallback key when the fallback matched).
   - Policy reverts → `PolicyReverted(policy, reason)`; `reason` is the policy's own error (nested
     `SimError`, e.g. `{error:'Unauthorized'}`, or the inner engine revert for MultiSend).
   - Policy returns without the magic value (only `DenyPolicy`) → `AccessDenied(policy)`.
6. Pass.

The top-level result's `matched` is the entry found in step 3 at depth 0 (or `null` when step 1
allowed the call without a policy).

## 8. Policies

Errors are the policy's own custom errors and are always wrapped as
`PolicyReverted(<policy>, reason)` by step 7.5, except `DenyPolicy` (`AccessDenied(DenyPolicy)`).
State is keyed by access selector where the contract does so. Check order matters: follow it.

| Policy | `configure(access, data)` | `checkTransaction` |
| --- | --- | --- |
| `AllowPolicy` | always ok | pass |
| `DenyPolicy` | always ok | returns no magic → `AccessDenied(DenyPolicy)` |
| `OneTimeAllowPolicy` | data `bool`; sets/clears `grant[access]` | no grant → `Unauthorized`; else delete the grant (staged), pass |
| `AllowedModulePolicy` | data `(address module, bool allowed)`; module 0 → reverts `InvalidModule`; sets `allowed[module]` (not per access) | `module == 0` → `InvalidModule`; not allowed → `UnauthorizedModule` |
| `NativeTransferPolicy` | returns false (→ `PolicyConfigurationFailed`) unless access selector is 0, op CALL and data empty | `operation != CALL` → `InvalidOperation`; `data.length != 0` → `CalldataNotPermitted`; `value == 0` → `InvalidTransfer` |
| `ERC20TransferPolicy` | access selector must be `transfer` or `transferFrom` (else reverts `InvalidSelector`), op CALL (else `InvalidOperation`); data `(address account, uint8 permission)[]`; sets `recipients[token = access target][account]` | decode recipient from `transfer(to, _)` or `transferFrom(_, to, _)`, else `InvalidTransfer`; permission NONE → `Unauthorized`; ONCE → delete (staged) and pass; ALWAYS → pass. Keyed by **token**, not selector |
| `ERC20ApprovePolicy` | selector must be `approve` (else `InvalidSelector`), op CALL; data `(address,uint8)[]`; sets `spenders[token][account]` | selector not `approve` → `InvalidApproval`; `amount == 0` → pass (revoking is always allowed, grant untouched); NONE → `Unauthorized`; ONCE → delete, pass |
| `MultiSendPolicy` | returns false unless selector is `multiSend` and op DELEGATECALL | data selector not `multiSend` → `InvalidMultiSend`; for each packed sub-tx in order: `to == 0` → the Safe; take the next context item positionally (empty once exhausted); run §7 recursively at depth+1. Any sub-check failure propagates (so the outer error is `PolicyReverted(MultiSendPolicy, <sub-tx error>)`) |
| `CoSignerPolicy` | data `address`; sets `cosigner[access]` | `module != 0` → `ModulePathUnsupported`; `cosigner[access] == 0` → `NoCosignerConfigured`; context must be `cosignature` by that cosigner over this checked tx (`over: 'self'`), else `Unauthorized`; tx hash already spent → `CoSignatureAlreadySpent`; mark spent (staged) |
| `IncreasedThresholdPolicy` | data `uint256 maxAbsent`; sets `maxAbsent[access]` | `module != 0` → `ModulePathUnsupported`; required = `owners - maxAbsent` (saturating at 0), clamped to `[threshold + 1, owners]`; context must be `ownerSignatures`: sorted, fewer than `required` → reason `GS020`; a non-owner or duplicate among the first `required` → `GS026`; hash already spent → `SignaturesAlreadySpent`; mark spent |
| `SafenetPolicy` | always ok | `module != 0` → `ModulePathUnsupported`; context not an `attestation` → `MalformedAttestation`; `key: 'untrusted'` → `UntrustedAttestationKey`; `spent[nonce - 1]` → `AttestationAlreadySpent`; `valid: false` → reason `InvalidMulMulAddWitness` (raised by `Secp256k1.mulmuladd` inside `FROST.verify`; verified by conformance); mark `spent[nonce - 1]` |

Notes:

- **Tx hash identity** for CoSigner / IncreasedThreshold spending: `(to, value, data, operation, nonce - 1)`
  of the checked (sub-)transaction. Two identical sub-txs in one batch share a hash, so the second
  is rejected (README "A batch cannot repeat an identical signature-checked sub-transaction").
- **Safenet** spends per **nonce**, so two Safenet-checked sub-txs in one batch fail on the second.
- `over: 'batch'` on a sub-tx cosignature means the co-signer signed the outer batch hash; the
  sub-tx check fails with `Unauthorized` (README: "each sub-transaction's own hash at the batch's
  nonce, not the hash of the batch"). On the outer tx itself (when the batch is routed to
  `CoSignerPolicy`), `over: 'batch'` and `'self'` both mean the outer hash and pass.
- A context of the wrong `type` for a policy is treated as an invalid signature (`Unauthorized`
  for CoSigner, `GS020`/`GS026` for IncreasedThreshold by the counting rule, `MalformedAttestation`
  for Safenet), judged by the **bytes** it would produce. One exception follows from that: an
  `ownerSignatures` context with exactly one signer who is the configured co-signer is byte-for-byte
  a valid co-signature, so `CoSignerPolicy` accepts it (verified by conformance).

## 9. Execution effects

Executed from the Safe (`msg.sender == Safe`). Only `CALL` to a contract with logic below has an
effect; anything else follows the "no code" rule.

- **ETH value**: moved from the Safe to `to` before the call. Insufficient balance → the call fails
  with empty data → `Reverted`. For `DELEGATECALL` no ETH moves (policies still saw the declared value).
- **Token (`USDC`, `SAFE`)**: OpenZeppelin ERC-20 v5 semantics and errors:
  `transfer` (`ERC20InsufficientBalance`, `ERC20InvalidReceiver` for 0x0), `approve`
  (`ERC20InvalidSpender` for 0x0), `transferFrom` (`ERC20InsufficientAllowance`, then balance).
  Unknown selector or empty data → `Reverted`. Sending ETH to a token → `Reverted`.
- **WETH**: WETH9. `deposit()` and the fallback (any other calldata, or empty) mint `value` WETH to
  the Safe; `withdraw(amount)` burns and sends ETH (insufficient → `Reverted`); `transfer`,
  `approve`, `transferFrom` as WETH9 (insufficient → `Reverted`).
- **Safe self-call** (`to == Safe`, CALL): `setGuard(g)`: `g` must be `Zero` or `PolicyGuard`;
  any other address (a person, a token, a policy, the Safe itself) → `Reverted`, because Safe 1.5.0
  first calls `g.supportsInterface` and that call reverts before `GS300` can fire (verified by
  conformance); `setModuleGuard(g)` likewise (`Reverted`, not `GS301`); `enableModule(m)` (`GS101` for 0x0 or
  sentinel, `GS102` already enabled); `disableModule` (`GS101`, `GS103`); `changeThreshold(t)`
  (`GS201` if `t > owners`, `GS202` if `t == 0`); `addOwnerWithThreshold` (`GS203` invalid,
  `GS204` duplicate, then threshold rules); `removeOwner` (`GS201`/`GS202`, `GS205` not an owner).
  Any other calldata to the Safe (no fallback handler) succeeds and does nothing, and so does a
  plain ETH self-transfer; but ETH **with** unknown calldata → `Reverted`, because the Safe 1.5.0
  fallback is not payable.
- **PolicyGuard** (CALL): `configureImmediately` → `GuardAlreadyEnabled` if either guard slot is
  the PolicyGuard, else confirms each rule (§10); `requestConfiguration(root)` → if
  `roots[root]` exists and is not expired → `RootAlreadyConfigured`; else `roots[root] = now + delay`;
  `invalidateRoot(root)` → missing → `RootNotConfigured`, else delete;
  `applyConfiguration(rules)` → root missing → `RootNotConfigured`; `now < validFrom` →
  `RootConfigurationPending`; `now >= validFrom + expiry` → `RootConfigurationExpired`; else delete
  the root and confirm each rule in order. Unknown selector or ETH → `Reverted`.
- **MultiSend** as `DELEGATECALL` (the normal case): runs sub-txs in order from the Safe; a sub-tx
  `DELEGATECALL` → `Reverted`; `to == 0x0` → the Safe; any sub-tx failure reverts the whole batch
  with that sub-tx's revert data. As a `CALL` (verified by conformance): the sub-txs run *from the
  MultiSend contract*, not the Safe; zero-value sub-txs succeed (as calls by MultiSend), and a
  sub-tx that sends ETH reverts unless that ETH was attached to the outer call.
- **Batches and guard changes**: the Safe reads its transaction guard **once**, before the
  check, and calls `checkAfterExecution` on that same guard (Safe 1.5.0 `execTransaction`). So
  inside one batch: steps are never re-checked by a guard that an earlier step installed; a batch
  that installs the guard is unchecked if no guard existed when it started; a batch that removes the
  guard is still checked (pre-batch, per `MultiSendPolicy`) and still gets `checkAfterExecution`
  from the old guard. `configureImmediately` reads the guard slots **live**, so it fails with
  `GuardAlreadyEnabled` if an earlier step of the same batch already set either guard.
  `requestConfiguration`, `applyConfiguration` and `invalidateRoot` are allowed as batch steps
  without a rule (§7 step 1 runs for every step), but a step checked after `applyConfiguration` in
  the same batch is checked against the rules from before the batch (README "Guard Removal").
- **Delegatecall** to anything other than MultiSend: runs "unknown code with full control of the
  Safe"; it succeeds and changes nothing, with a `warn` effect. A delegatecall into a contract the
  playground knows runs that contract's code against the Safe's own (empty) storage, as on chain:
  e.g. a token `transfer` of a non-zero amount → `ERC20InsufficientBalance`, WETH `withdraw` of a
  non-zero amount → `Reverted`, an `authorized` Safe function → `GS031`, a module → `Reverted`.
- **People, `MysteryContract`, `Zero`**: no code; any call succeeds, ETH is received.
- **Modules** (`AllowanceModule`, `RecoveryModule`) are `TestModule` contracts on chain: code with
  one function and no `receive` or `fallback`, so any call or ETH sent to them → `Reverted`, and
  they hold no key (they cannot co-sign). Only people and `CoSigner` can sign.

## 10. Confirming a rule (`_confirmPolicy`)

For each `RuleSpec` in order: compute `access`; set `table[access] = policy` (or delete it when
`policy` is null; deleting does **not** clear the policy's own state); if `policy` is not null call
its `configure` (§8). `configure` returning false → `PolicyConfigurationFailed`; a revert inside
`configure` propagates with the policy's error. Effects list each rule change in plain words.

`configurationRoot(rules)` = `keccak256(abi.encode(tuple(address target, bytes4 selector, uint8 operation, address policy, bytes data)[]))`
over the encoded rules, identical to `src/utils.ts#getConfigurationRoot`.

## 11. Trace and copy

Trace events are what non-developers read. Each event has a short `title` in plain language, an
optional `detail` that explains why, and an optional `tech` line for engineer view (hex access
selector, function signature, Solidity error). Voice (from the Safe Research design system): short,
declarative, no emoji, no em dashes; write identifiers exactly as the code does in `tech`.

Event ids are stable codes so the UI can draw the pipeline: `safe.signatures`, `safe.nonce`,
`safe.noGuard`, `safe.module` (module enabled check), `safe.context` (context ignored on the module path), `guard.gasPrice`, `guard.safeTxGas`, `engine.allowedCall`, `engine.guardTarget`,
`engine.selector`, `engine.lookup.exact`, `engine.lookup.fallback`, `engine.lookup.none`,
`policy.check`, `policy.state`, `multisend.step`, `exec.call`, `exec.effect`, `exec.configure` (a
policy's `configure` refused a rule while setting it up), `exec.revert`,
`guard.after`, `commit`, `rollback`.

## 12. Scenario and challenge files

- One JSON file per scenario in `scenarios/<id>.json`, matching `Scenario` in `types.ts`.
- One JSON file per challenge in `challenges/<id>.json`, matching `Challenge`.
- `expect` asserts only what the chain can observe: `ok`, `by`, `error`, `policy`, nested `reason`.
- Each `tx` step starts from the world left by the previous step. `wait` advances time.
- Challenges: the player's rules are the setup `rules`; each test runs on a fresh copy of the
  configured world (`testMode: 'independent'`) unless `testMode: 'sequence'`.
- A challenge is valid only if its `solution` passes every test **and** its starting rules fail at
  least one test.
- `conformance: false` (or a reason string) skips the on-chain check, for example where Hardhat
  cannot produce the context (none expected; prefer making the harness capable).

## 13. Conformance

`npm run conformance` (from `playground/`) runs `conformance/conformance.spec.ts` inside the parent
Hardhat project. For every scenario and every challenge solution it deploys a fresh Safe, guard and
policies, maps names to real addresses, replays the steps with real signatures, and asserts each
`expect` against the real revert data (decoded with the guard, policy, Safe and ERC-20 ABIs,
recursing into `PolicyReverted.reason`). The engine's own tests (`npm test`) assert the same
expectations against the engine. Together they prove engine == contracts for every published
example.
