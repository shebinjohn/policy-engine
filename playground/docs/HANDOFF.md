# Handoff: Building the Playground in Its Own Repository

This guide is written for an AI coding agent (and the people steering it) that will move the
Policy Engine Playground out of this fork into a standalone repository, keep it in sync with the
Policy Engine contracts, and extend it. Read it fully before changing anything.

## 1. What the playground is

An interactive web app that simulates a Safe protected by the Safe{Policies} Policy Engine
(`SafePolicyGuard` plus its policies). People set up a Safe, fire a transaction, and see in plain
language whether it passes and why, step by step. It has three modes:

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

<!-- HANDOFF-DETAILS: filled in after integration (commands, conformance wiring, publishing) -->
