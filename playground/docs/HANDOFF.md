# Handoff: Building the Playground in Its Own Repository

This guide is written for an AI coding agent (and the people steering it) that will move the
Policy Engine Playground out of this fork into a standalone repository, keep it in sync with the
Policy Engine contracts, and extend it. Read it fully before changing anything.

## 1. What the playground is

An interactive web app that simulates a Safe protected by the Safe{Policies} Policy Engine
(`SafePolicyGuard` plus its policies). It has two layers. The **simple layer** (Learn, Ask, Play,
Deep dives; `src/ui/simple/`) is the default and is designed for non-developers; its brief,
including the words it must never show, is `docs/research/SIMPLE_LAYER.md`. Its content is the
explainer and eight big ideas in `ideas/*.json` (same shape as scenarios, so they are replayed on
chain too). The **Advanced** layer is the full simulator for engineers, with these modes:

- **Sandbox**: free play with a simulated Safe, its guards, modules, balances and rule table.
- **Scenarios**: a guided learning path; each scenario teaches one behaviour of the engine.
- **Challenges**: the game layer; the player edits the rule table so every test gets the wanted verdict.

Audience: first the Safe team (designers, developers, PMs, leadership), later the public: people
who know how Safe works but have no developer background. Plain language is the default; an
Engineer view reveals selectors, calldata and Solidity error names.

## 2. Non-negotiable rules

1. **The contracts are the source of truth.** The engine must decide exactly what the Solidity
   decides: same outcome, same error name, same policy blamed, same nesting. `docs/SPEC.md` writes
   that behaviour down; when SPEC and the contracts disagree, fix SPEC and the engine.
2. **Every scenario and challenge is checked twice**: by the engine tests (`npm test`) and against
   the real contracts (`npm run conformance`). A change is not done until both pass.
3. **Content uses names, never addresses** (`Alice`, `USDC`, `PolicyGuard`; see SPEC §2). Each side
   resolves names in its own address book.
4. **Voice**: short, declarative, no emoji, no em dashes. Titles in Title Case. Identifiers exactly
   as the code writes them, kept to Engineer view where possible.
5. **Design**: the Safe Research design system (`docs/design-system/`; the live copy is the user's
   "Safe Design System" artifact). Allow and deny always carry a word or glyph, not colour alone.

## 3. Layout

```
playground/
  docs/SPEC.md            behaviour contract (engine semantics, data formats)
  docs/HANDOFF.md         this file
  docs/design-system/     tokens.json and README.md of the Safe Research design system
  src/engine/             the simulator (pure TypeScript, runs in Node and the browser)
    types.ts              public types and EngineApi: the contract between all parts
  src/content/            plain-language catalogs: errors, policies, glossary, chapters
  src/ui/                 React UI
  scenarios/*.json        guided scenarios (learning path)
  challenges/*.json       challenges (game levels)
  test/                   engine unit tests and the content replay test
  conformance/            Hardhat harness that replays scenarios/challenges on the real contracts
  scripts/build.mjs       builds dist/policy-playground.html, one self-contained page
```

## 4. Commands

All from the playground root (today `policy-engine/playground/`, later the standalone repo root).

| Command | What it does | Must pass before merging |
| --- | --- | --- |
| `npm ci` | Install (ethers, React, esbuild, tsx, TypeScript) | |
| `npx tsc --noEmit -p .` | Type-check engine, content, UI, tests | yes |
| `npm test` | Engine unit tests plus a replay of every scenario and challenge through the engine | yes |
| `npm run conformance` | Replays every scenario, challenge and fixture on the real contracts in Hardhat | yes |
| `npm run build` | Writes `dist/policy-playground.html` (Claude artifact page) and `dist/site/index.html` (static hosting) | yes |

State at handoff: 24 scenarios, 10 challenges, 200 tests (`npm test`, one fixture skipped on
purpose), 58 conformance cases on chain (content plus fixtures, including the reproducers from the
differential test in `conformance/fixtures/fuzz/`), all green.

Quality gates that live in the tests, so keep them green rather than weakening them:

- `test/fixtures.test.ts`: the engine must match the chain outcome pinned in every fixture.
- `test/content.test.ts`: every scenario step matches; every challenge solution solves and its
  starting rules do not; par equals the solution size; every blocked test in a solution is blocked
  by the guard; switching any ALWAYS/ONCE in a solution, or making any single-rule edit, must
  unsolve it (except the listed legitimate alternatives); blocked scenario steps name their error.
- `test/engine-fuzz.test.ts`: random calldata and contexts never make the engine throw.
- `test/share.test.ts`: share codes round-trip for every preset, scenario and solution.

To hunt for new engine bugs, generate random scenarios and replay them on chain with
`CONFORMANCE_EXTRA=<dir> npm run conformance`; every minimal reproducer goes into
`conformance/fixtures/fuzz/` with the chain outcome as `expect`.

## 5. Moving to a standalone repository

Do these in order. Keep each step a separate commit.

1. **Create the repo** and copy the contents of `policy-engine/playground/` to its root (not the
   `playground/` folder itself). Keep `docs/`, `src/`, `scenarios/`, `challenges/`, `test/`,
   `conformance/`, `scripts/`, `package.json`, `package-lock.json`, `tsconfig.json`,
   `.prettierrc`, `.gitignore`. Copy `LICENSE` from the policy-engine repo (LGPL-3.0-only) unless
   the owners choose otherwise.
2. **Add the contracts as a submodule** (the fork or upstream), pinned to the commit the
   playground was last verified against:
   ```sh
   git submodule add https://github.com/safe-research/policy-engine.git policy-engine
   git -C policy-engine checkout <verified commit>
   (cd policy-engine && npm ci && npx hardhat compile)
   ```
3. **Rewire conformance** in `package.json`:
   `"conformance": "cd policy-engine && npx hardhat test --network hardhat ../conformance/conformance.spec.ts"`.
   `conformance/upstream.ts` finds the checkout by itself (`$POLICY_ENGINE_ROOT`, an ancestor
   directory, or `./policy-engine`). Details and the list of policy-engine files the harness uses:
   `conformance/README.md`, section "Using it from a standalone playground repository".
4. **Run all five commands** of §4. All must pass before anything else changes.
5. **Fix paths that pointed at the parent repo**: the footer link to the policy-engine repository
   in `src/ui/`, links in `docs/SPEC.md` to `../contracts/` and `../src/utils.ts` (point them at
   `policy-engine/...` or at GitHub URLs pinned to the verified commit).
6. **Add CI** (GitHub Actions): checkout with `submodules: recursive`, Node 22, `npm ci`, the
   submodule's `npm ci` and `npx hardhat compile`, then type-check, `npm test`,
   `npm run conformance`, `npm run build`.
7. **Hosting** (when it gets traction): publish `dist/site/` with GitHub Pages (same pattern as the
   policy-engine repo's `.github/workflows/app_publish.yml`: build, `actions/upload-pages-artifact`
   with `path: dist/site`, `actions/deploy-pages`). The page loads React, ReactDOM and ethers
   from cdnjs and fonts from Google Fonts; everything else is inline. Nothing is fetched at runtime.
8. **Remove the playground from the fork** only after the standalone repo is green, and drop the
   `'playground/**'` entry from the fork's root `eslint.config.mjs`.

## 6. Keeping it in sync with the contracts

The playground is a model of the contracts, so every contract change can make it wrong. The
conformance run is the alarm.

```sh
git -C policy-engine fetch && git -C policy-engine checkout <new commit>
(cd policy-engine && npm ci && npx hardhat compile)
npm run conformance && npm test
```

- **Both green**: bump the pinned commit, note it in the changelog, rebuild, republish.
- **Conformance red**: read the contract diff (`git -C policy-engine diff <old>..<new> -- contracts/`)
  and the failing step's on-chain outcome (`CONFORMANCE_VERBOSE=1 CONFORMANCE_ONLY=<id>`). The
  contracts win: update `docs/SPEC.md` first, then the engine (`src/engine/`), then the content
  whose expectations changed, then the plain-language copy (`src/engine/messages.ts`,
  `src/content/errors.ts`, `src/content/policies.ts`).
- **New policy**: add it to `PolicyName` in `types.ts`, the address book (SPEC §2,
  `src/engine/book.ts`), a file in `src/engine/policies/`, its row in SPEC §8, its deploy in
  `conformance/world.ts`, its config encoding in `conformance/encode.ts` and
  `src/engine/policies/`, a `POLICIES` card, every new error in `ERRORS`, a rule-editor form in
  `src/ui/components/RuleEditor.tsx`, at least one scenario and one challenge test.
- **New README limitation**: add a scenario that demonstrates it. Every limitation in the README
  should have one.
- A conformance-only quick check after any change: `CONFORMANCE_ONLY=<id> npm run conformance`.

## 7. Publishing the Claude artifact

`npm run build`, then republish `dist/policy-playground.html` to the **same** artifact URL so the
link the team already has keeps working (current artifact:
https://claude.ai/artifact/9nA2aLhRDoaeBi7xbtEcEn). The artifact page has no `<html>`, `<head>` or
`<body>` (the host wraps it), keeps its `<title>`, pins CDN versions exactly, and defines every
colour as a token with light and dark values. `scripts/build.mjs` handles all of that; do not
hand-edit `dist/`.

## 8. Adding content

- **Scenario**: one JSON file in `scenarios/` (shape `Scenario` in `types.ts`, rules in SPEC §12).
  One idea per scenario, 2 to 5 steps, a pass contrasted with a block, a `lesson` a PM could repeat
  in a meeting. Use names from SPEC §2 only. Set `chapter` and `order`; renumber `order` across
  files so the path stays continuous. Assert only what the chain can observe. Run `npm test` and
  `CONFORMANCE_ONLY=<id> npm run conformance`.
- **Challenge**: one JSON file in `challenges/`. It is valid only if the `solution` passes every
  test and the starting rules fail at least one. Before shipping, try the naive answers the puzzle
  is meant to catch and make sure each fails.
- **Copy**: errors in `src/content/errors.ts` (policy-specific keys `<Policy>.<Error>` win over bare
  names), policies in `policies.ts`, glossary in `glossary.ts`, trace lines in
  `src/engine/messages.ts`.

## 8a. UX principles

`docs/research/UX_RESEARCH.md` (sources) and `docs/research/UX_DECISIONS.md` (what was adopted,
deferred and avoided, and why) set the direction. In short: ask for a prediction before a reveal,
name the sharp edge when it decides a run (`src/ui/lib/sharpEdges.ts`, driven by trace ids), make
every debated state a link (`#scenario-<id>-step-<n>`, and a versioned `[a-z0-9]` share code with a
`#run-<code>` link, `src/ui/lib/share.ts`; the artifact link only carries a plain `#name`), hints
point before they solve, progress stays calm, and nothing is locked. Read the "Avoid" list before
adding anything game-like.

## 9. Known gaps

Not modelled (each would need a `TxSpec` field or a new contract in the address book):

- ETH attached to a `DELEGATECALL` (`msg.value` seen by delegated code; README "Where the check and
  the execution can diverge").
- A non-compliant token that returns `false` instead of reverting (README same section). All
  playground tokens are OpenZeppelin and revert.
- Gas refund payment with no guard installed.
- Raw calls to functions outside the catalog of SPEC §4 (for example a module's own entry points).

UI follow-ups noted by the builder:

- Expose policy state through the engine API (a "current settings of this rule" call) instead of
  the UI reading `world.policyState` defensively.
- Tag each `Effect` with the batch step it came from.
- The "Your Safe" column is long on desktop; give it its own scroll.
- Drafted batch steps preview against the current Safe, so after hardening the same draft shows
  its steps as blocked (correct, but surprising).

Content rule: never write outcomes that depend on the order of signer addresses; addresses differ
between the playground and Hardhat.

## 10. Roadmap

**Problem 3: the configuration builder** (agreed directions: intents with a rule table, a
drag-and-drop canvas, and integration into the existing Safe App in `policy-engine/app/`).

- Build on this engine. The builder edits a list of `RuleSpec`; the simulator is the live test
  panel ("these transactions pass, these are blocked") for every edit.
- The on-chain configuration is a flat lookup table: one policy per (target, function, operation)
  key plus one catch-all per operation, with no chaining. A canvas must not imply more structure
  than that: show contracts and functions as anchors, policies as the one card attached to each,
  the catch-all as a separate lane.
- **Export batches, not lists of transactions.** For a Safe without guards, export one MultiSend
  batch: `configureImmediately(rules)` first, then `setModuleGuard(guard)` and `setGuard(guard)`
  (SPEC §3 "Hardening in one batch"). Offer to add the MultiSend rule so the Safe can batch later.
  For a hardened Safe, export `requestConfiguration(root)` (alone or inside a batch with other
  steps), and after the waiting period `applyConfiguration(rules)`. Guard removal is two
  transactions: apply the removal rules alone, then remove both guards in one batch (README
  "Guard Removal"). Show the configuration root and the calldata in Engineer view.
- Intents compile to rules (for example "pay these recipients USDC" → `ERC20TransferPolicy` on
  `USDC.transfer`; "everything else needs a co-signer" → `CoSignerPolicy` on the CALL catch-all).
  Each intent should come with generated test transactions that must pass and must be blocked,
  checked by the engine.
- Safe App integration: read the live configuration of a Safe (the demo guard exposes
  `getAccesses`, `getAccessInfo`, `getConfigurationRoots`), load it into the builder, and submit the
  exported batch through the Safe Apps SDK.

**Problem 1: documentation.** Use the playground as the docs' interactive companion: each README
limitation links to its scenario (`#scenario-<id>` style deep links can be added to the UI), and
the glossary in `src/content/glossary.ts` is the shared vocabulary.

## 11. Starting prompt for the agent in the new repository

> You are taking over the Policy Engine Playground in this repository. Read `docs/HANDOFF.md`, then
> `docs/SPEC.md` and `src/engine/types.ts`, then `conformance/README.md`. Do the steps of HANDOFF §5
> in order, one commit each, and run all five commands of HANDOFF §4 after each step; stop and
> report if any fails. The contracts in the `policy-engine` submodule are the source of truth: never
> change an expectation to make a test pass without reading the Solidity that decides it. Follow the
> voice and design rules of HANDOFF §2.

