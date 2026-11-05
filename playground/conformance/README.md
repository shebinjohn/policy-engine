# Playground conformance harness

The playground engine (`src/engine/`) is a TypeScript model of a Safe protected by the
Safe{Policies} Policy Engine. This harness proves the model right: it replays every scenario
(`scenarios/*.json`) and every challenge (`challenges/*.json`) against the real Solidity contracts in
Hardhat, with real signatures, and checks that each expected outcome holds on chain.

The engine's own tests (`npm test`) check the same expectations against the engine. When both
pass, the engine and the contracts agree on every published example (SPEC §13).

## What it checks

For each **scenario**, one Mocha `it`:

- Builds a fresh world from `setup` (SPEC §3).
- Runs each step. A `tx` step is compared with `expect` (`ok`, `by`, `error`, `policy`, nested
  `reason`; only the fields given) and `expectState` (balances in human units, nonce delta since
  setup, guards, modules, threshold, owners). A `wait` step moves the chain clock.
- Fails with the scenario id, step index and label, the expected and actual values, and the full
  on-chain outcome. It reports every mismatched step, not only the first.

For each **challenge**, one `it`:

- With the `solution` rules, every test's verdict must equal its `want`. The verdict is `pass` if
  the transaction succeeded and `block` otherwise.
- With the starting rules (`setup.rules`), at least one test must miss its `want`. Starting rules
  that cannot even be configured count as failing.
- Tests run on a fresh copy of the configured world (snapshot and revert), or in order when
  `testMode: 'sequence'`.

A file with `conformance: false`, or a reason string, is skipped and the reason is printed.

The harness was mutation-tested: 140 deliberately wrong expectations across every scenario,
fixture and challenge (flipped `ok`, wrong error, policy, nested reason or balance, flipped `want`,
starting rules that already solve the challenge). Every one of them made the run fail.

## Run it

From `playground/`:

```sh
npm run conformance
```

Or from the policy-engine root:

```sh
npx hardhat test --network hardhat playground/conformance/conformance.spec.ts
```

At the end it prints a results table (`pass` / `fail` / `skipped` per id). Environment options:

| Variable | Effect |
| --- | --- |
| `CONFORMANCE_ONLY=id1,id2` | Run only these scenario, challenge or fixture ids |
| `CONFORMANCE_VERBOSE=1` | Print each step's on-chain outcome, e.g. `guard:PolicyReverted(MultiSendPolicy) <- guard:AccessDenied(null)` |
| `CONFORMANCE_REPORT=out.json` | Also write the results table as JSON |
| `CONFORMANCE_EXTRA=dir[:dir]` | Also run the JSON files in these directories (drafts, mutants) |
| `POLICY_ENGINE_ROOT=path` | The policy-engine checkout to use (standalone layout, see below) |

`npx hardhat test --grep <text>` also works. A full run takes about 15 seconds after compilation.

## Files

| File | Role |
| --- | --- |
| `conformance.spec.ts` | Mocha entry: discovers files, one `it` each, prints the table |
| `runner.ts` | Runs a scenario or challenge, executes owner and module transactions, compares outcomes |
| `world.ts` | Deploys the contracts once, maps SPEC §2 names to addresses, performs SPEC §3 setup |
| `encode.ts` | `RuleSpec` to `Configuration`, the SPEC §4 call catalog, MultiSend packing, policy contexts |
| `decode.ts` | Revert data to the nested `SimError` shape, and who stopped the transaction (`by`) |
| `upstream.ts` | The only place that loads anything from the policy-engine checkout |
| `contracts/WETH9.sol`, `artifacts/WETH9.json`, `scripts/build-weth.cjs` | WETH9 port, its checked-in artifact, and the script that rebuilds it |
| `fixtures/*.json` | Harness fixtures (same shapes as content), also run on every `npm run conformance` |
| `package.json` | `{"type": "commonjs"}`, so Hardhat's ts-node loads these `.ts` files as CommonJS inside the ESM playground package |
| `tsconfig.json` | Type checking only: `npx tsc -p conformance` from `playground/` |

The harness reads the content JSON with `fs` and imports only types from `../src/engine/types.ts`.
Those imports are erased at compile time, so no playground ESM module is ever loaded.

## How the chain world is built

**Deployed once per run, then snapshotted.** Safe 1.5.0 singleton and proxy factory, and
`MultiSendCallOnly`, all from `@safe-global/safe-smart-account/build/artifacts`. The eleven
policies come from `test/deploy`. `SafenetPolicy` is deployed with consensus chain 100, address
`0x1111…1111`, epoch 7, and a FROST group key whose secret the harness holds. Two
`TestERC20Token`s serve as USDC and SAFE, plus WETH9 and two `TestModule`s
(AllowanceModule, RecoveryModule). `TestFROST` exposes the challenge hash for signing.

**Per scenario, and per challenge rule set.** Revert to that snapshot. Deploy `SafePolicyGuard`
with the setup's `delay` and `expiry` (default 3600 and 604800). Then follow SPEC §3:

1. Create the Safe (owners, threshold, no guard, no fallback handler).
2. Enable the modules with Safe transactions.
3. Fund the Safe. ETH with `setBalance`; USDC and SAFE with `mint`; WETH by depositing from the
   relayer and transferring it. Allowances are written straight into the token's allowance storage
   slot and read back to check them. This works for any owner, including people with no ETH.
4. Run `configureImmediately(rules)` as a Safe transaction to the guard.
5. Install the guards. **The module guard goes first** (SPEC §3): once the transaction guard is on, the `setModuleGuard` transaction is
   checked by the rules like any other call and is denied without a matching rule (pinned in
   `fixture-module-no-guard`). The final state is the same.

The nonce right after setup is the baseline for `expectState.nonce`.

**Address book (SPEC §2).**

| Name | On chain |
| --- | --- |
| `Safe` | The Safe proxy |
| `PolicyGuard` | This scenario's `SafePolicyGuard` |
| `MultiSend` | `MultiSendCallOnly` (Safe 1.5.0) |
| `USDC` | `TestERC20Token` (18 decimals on chain; amounts are scaled by 6, the playground's USDC decimals, so the numbers stay consistent) |
| `SAFE` | Another `TestERC20Token` (18) |
| `WETH` | `WETH9` port (18) |
| `Alice` `Bob` `Carol` `Dave` `Erin` `Mallory` `CoSigner` | `ethers.Wallet`s with fixed keys (`id("policy-engine-playground:<name>")`) and **no ETH**. Balances start at 0, as in the engine, and a Hardhat signer relays and pays all gas |
| `AllowanceModule`, `RecoveryModule` | Two `TestModule` instances (they call `execTransactionFromModule`) |
| `MysteryContract` | A fixed codeless address |
| `Zero` | `0x0000…0000` |
| `AllowPolicy` … `SafenetPolicy` | The deployed policy |

Names and `0x` addresses are accepted everywhere (rules, args, sub-transactions, `expectState`).

## How transactions are executed

**Owner path.**

- The default signers are the first `threshold` owners, in the Safe's linked-list order.
- Each signer gives an EIP-712 signature over the full Safe transaction hash, including
  `safeTxGas` and `gasPrice`. Signatures are sorted by signer address, as the Safe requires.
- The policy context is appended with `appendSignatureExtension`.
- Before sending, the exact signature bytes are checked with the view `Safe.checkSignatures`.
  That is how `by: 'safe'` is attributed: from where the transaction failed, not from the GS code.
- Every transaction is sent with a fixed 15M gas limit, so nothing is estimated and a revert's
  data is captured.
- With `safeTxGas` or `gasPrice` set and no guard, Safe 1.5.0 does not revert a failed inner
  call: it emits `ExecutionFailure`. The harness reports this as `{ ok: false, by: 'execution',
  error: 'CallFailed' }`.

**Module path.** The named `TestModule` calls `execTransactionFromModule`. Any `context` is
ignored. No revert plus an `ExecutionFromModuleFailure` event is reported as `CallFailed`.

**Context (`ContextSpec` to bytes).** All hashes here are the policy's view of the transaction:
gas fields zero, at the nonce the owners sign.

| Spec | Bytes |
| --- | --- |
| `cosignature` | 65-byte EIP-712 signature by `signer` over the checked transaction's Safe hash. For a MultiSend sub-transaction that is the sub-transaction's own hash at the batch nonce, with `to = 0x0` read as the Safe. `over: 'batch'` signs the outer transaction's hash instead |
| `ownerSignatures` | `buildSignatureBytes` by `signers` over the checked hash |
| `attestation` | `abi.encode(epoch, oracle, oracleDataHash, groupKey, signature)`, a real single-signer FROST signature over the Safenet `TransactionProposal` for the checked hash. `key: 'untrusted'` signs with a key outside the trusted epoch; `valid: false` keeps the key and adds 1 to `z` |
| `batch` | The positional list `MultiSendPolicy._decodeNextContext` reads: `[uint256 length][bytes]` per item |
| none, on a `multiSend` call built from `batch` | The positional list of the sub-transactions' own contexts (recursively), trailing empty items dropped, or no context at all if no sub-transaction has one. An explicit `context: null` means no context |

**Time.** The engine's clock moves only on `wait`. `upstream.ts` sets
`allowBlocksWithSameTimestamp` on the in-process Hardhat network before its provider is created.
This affects only this test process, not `hardhat.config.ts`. Each transaction is then mined
exactly the accumulated `wait` seconds after the previous block, so `delay` and `expiry` boundaries
match the engine to the second (`fixture-policy-edges` pins `delay - 1` as pending and `delay` as
applicable). If the setting cannot take effect, the harness falls back to at least one second per
transaction.

## How reverts are decoded

`decode.ts` builds a selector table from the compiled ABIs of `SafePolicyGuard` (which includes the
`PolicyEngine` and `SignatureExtension` errors), every policy (which includes the FROST, Secp256k1
and EpochRollover library errors), and OpenZeppelin ERC-20 v5. It decodes:

- `AccessDenied(policy)`: `policy` mapped back to a policy name, or `null` for `0x0`.
- `PolicyReverted(policy, reason)`: recurses into `reason`. Nested reasons carry `by: 'guard'`.
- `Error(string)`: the string, e.g. a Safe GS code.
- `Panic(uint256)`: `Panic`, with the code in `args`.
- Empty data: `Reverted`.

`by` at the top level is:

- `safe`: the signature pre-check rejected the bytes (or `GS010`), or `GS104` with the module not
  enabled.
- `guard`: the guard for this path is installed and the error is a check-time guard or engine
  error (`AccessDenied`, `PolicyReverted`, `GuardTargetDenied`, `ModuleConfigurationDenied`,
  `NonZeroGasPrice`, `NonZeroSafeTxGas`, `ModuleExecutionFailed`, `MalformedSignatureExtension`,
  or `InvalidSelector` when the calldata is 1 to 3 bytes).
- `execution`: anything else, which is an inner revert bubbled by Safe 1.5.0. That includes guard
  errors raised while executing a call to the guard (`RootConfigurationPending`,
  `GuardAlreadyEnabled`, `PolicyConfigurationFailed`, ...).

## Fixtures

`fixtures/` holds harness fixtures. They also act as regression pins for behaviour the engine
must reproduce.

| Fixture | Covers |
| --- | --- |
| `fixture-allowed-transfer` | Allowlisted ERC-20 transfer, blocked recipient, execution revert, too few signers |
| `fixture-deny-by-default` | No rules: AccessDenied, guard as target, InvalidSelector, NonZeroGasPrice, request, wait and apply |
| `fixture-multisend-cosigner` | Nested MultiSend checks with per-sub-transaction co-signatures, `over: 'batch'`, replay in one batch, execution failure in a batch |
| `fixture-module-path` | Allowed module, module not enabled (GS104), owner hitting a module-only rule, ModuleConfigurationDenied, ModuleExecutionFailed |
| `fixture-module-no-guard` | No module guard: bypass, CallFailed, and why the module guard is installed first |
| `fixture-context-kinds` | Safenet attestations (valid, missing, untrusted, corrupted) and IncreasedThreshold owner signatures |
| `fixture-policy-edges` | One-time grants, ONCE permissions in a batch, Safenet per-nonce spending, signature checks with a context, root lifecycle, exact delay boundary |
| `fixture-spec-pins` | Safe 1.5.0, MultiSendCallOnly and WETH9 execution edge cases with no guard, where SPEC §9 and the chain differ |
| `fuzz/fuzz-*` | Minimal reproducers from differential fuzzing (random scenarios, engine outcome replayed on chain). Each pins the chain outcome; its `summary` starts with the classification (ENGINE BUG, MODEL LIMIT, HARNESS BUG) and names the deciding contract line, and `lesson` says what the engine answers instead. Discovered from `fixtures/fuzz/` as well |
| `fixture-challenge-vendor` | The challenge path (solution passes, starting rules fail) |

## Using it from a standalone playground repository

When the playground moves to its own repository, add the policy-engine (or a fork) as a git
submodule. The harness then runs inside the submodule's Hardhat project:

```
playground/                  standalone repo root ("type": "module")
  conformance/               this directory, unchanged
  scenarios/  challenges/  src/engine/types.ts
  policy-engine/             git submodule
```

```sh
git submodule add https://github.com/safe-research/policy-engine.git policy-engine
git submodule update --init --recursive
(cd policy-engine && npm ci && npx hardhat compile)

# run
(cd policy-engine && npx hardhat test --network hardhat ../conformance/conformance.spec.ts)
```

As an npm script in the standalone `package.json`:

```json
"conformance": "cd policy-engine && npx hardhat test --network hardhat ../conformance/conformance.spec.ts"
```

`upstream.ts` finds the checkout in this order:

1. `$POLICY_ENGINE_ROOT`.
2. An ancestor of this directory.
3. An ancestor of the working directory, which is the submodule when you `cd` into it.
4. `../policy-engine` or `../lib/policy-engine`.

It loads `hardhat`, `ethers` and the helpers with a `require` rooted there, so the playground's
own `ethers` copy never mixes with Hardhat's. Run Hardhat from the submodule: the playground's root
`tsconfig.json` is ESM and bundler-oriented, and Hardhat must use the submodule's CommonJS one.
This layout was tried with the harness copied outside the checkout.

**What the harness uses from the checkout.** Keep these, or vendor them:

| Root file | Used for |
| --- | --- |
| `hardhat.config.ts` | The `hardhat` network, compilers (Cancun, viaIR) |
| `src/utils.ts` | `safeSignTypedData`, `buildSignatureBytes`, `appendSignatureExtension`, `encodeMultiSend`, `getConfigurationRoot`, `calculateProxyAddress`, `encode{OneTimeGrant,Module,CoSigner,IncreasedThreshold}Config` |
| `test/deploy/index.ts`, `test/deploy/util/create2.ts` | `deploySafeContracts`, `deploySafePolicyGuard`, `deploy*Policy`, `deterministicDeployment` |
| `test/utils/frost.ts` | `pointFromScalar`, `signFrost`, `consensusDomainSeparator`, `transactionProposalMessage`, `encodeAttestation`, `SECP256K1_N` |
| `contracts/test/TestERC20Token.sol`, `TestModule.sol`, `TestFROST.sol` | Deployed by name with `getContractFactory` |
| `artifacts/contracts/**` | Error ABIs for decoding (produced by `npx hardhat compile`) |
| `node_modules` | `hardhat`, `@nomicfoundation/hardhat-network-helpers`, `@safe-global/safe-smart-account` (Safe 1.5.0 artifacts); `solc` only to rebuild WETH9 |

Importing these through `upstream.ts` is the default, because the harness then always uses the
same helpers as the contract tests. If a fork drops or renames one, copy it into
`conformance/vendor/` and point the matching `require` in `upstream.ts` at the copy. Do not
change the call sites.

## Re-syncing after the contracts change

```sh
git -C policy-engine fetch && git -C policy-engine checkout <commit>   # or: git submodule update --remote policy-engine
(cd policy-engine && npm ci && npx hardhat compile)
npm run conformance
```

- A failure caused by a deliberate behaviour change is a content or engine update. Fix the engine
  and SPEC.md (the contracts win), then the content.
- If `configure` data shapes changed, update `encodePolicyConfig` in `encode.ts`.
- If a policy's constructor or a `test/deploy` signature changed, update `deployBase` in
  `world.ts`.
- If the guard's `Configuration` struct changed, update `encodeRule`.
- New custom errors are picked up from the artifacts automatically. A new contract to decode goes
  into `ABI_SOURCES` in `decode.ts`.
- `artifacts/WETH9.json` changes only with `contracts/WETH9.sol`: `node conformance/scripts/build-weth.cjs`.

## Corrections the chain made to SPEC.md

The first runs contradicted SPEC.md in the places below. SPEC.md has since been corrected to match
the chain, and the fixtures keep pinning each one, quoted from the observed reverts:

1. **SPEC §8, Safenet `valid: false`.** SPEC names the reason `InvalidSignature`. On chain it is
   `PolicyReverted(SafenetPolicy, InvalidMulMulAddWitness())`, raised by
   `Secp256k1.mulmuladd` inside `FROST.verify` (`fixture-context-kinds`).
2. **SPEC §9, `setGuard(g)` / `setModuleGuard(g)` with `g` not `Zero` or `PolicyGuard`.** SPEC
   says `GS300` / `GS301`. On chain it is an empty revert (`Reverted`) for every address in the
   book: Safe 1.5.0 first calls `g.supportsInterface`, which reverts for EOAs (Mallory), contracts
   without it (USDC, AllowPolicy), and the Safe itself (no fallback handler: empty return data
   fails the bool decode). `GS300` would need a contract that answers `false` (`fixture-spec-pins`).
3. **SPEC §9, Safe self-call.** SPEC says any other calldata to the Safe, or a plain ETH
   self-transfer, succeeds. Calldata without value succeeds, and so does ETH without calldata. ETH
   **with** unknown calldata reverts with empty data, because the Safe 1.5.0 fallback is not
   payable (`fixture-spec-pins`).
4. **SPEC §8 note, wrong context type.** A one-signer `ownerSignatures` by the co-signer is byte
   for byte a valid `cosignature`, so `CoSignerPolicy` accepts it (`fixture-policy-edges`). The
   engine already models this.
5. **SPEC §3 step 5 order.** See setup step 5 above.
