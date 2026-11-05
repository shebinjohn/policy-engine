# Policy Engine Playground

An interactive sandbox for the [Safe{Policies} Policy Engine](../README.md). Set up a Safe with the
Policy Guard, fire any transaction and see, step by step and in plain language, whether it passes
and why. Guided scenarios walk through every behaviour in the README, and challenges turn the
gotchas into puzzles.

- **Sandbox**: a simulated Safe with guards, modules, balances and rules; build any transaction,
  batch or module call, and change the rules through the waiting period.
- **Scenarios**: 23 short lessons in six chapters.
- **Challenges**: 10 levels; edit the rules until every test gets the verdict it wants.
- **Engineer view**: selectors, calldata and the exact Solidity errors.

The simulator is checked against the real contracts: every scenario and challenge solution is
replayed on Safe 1.5.0 with the `SafePolicyGuard` and its policies in Hardhat.

```sh
npm ci
npm test                 # engine tests and a replay of all content through the engine
npm run conformance      # replay all content on the real contracts (needs the parent Hardhat project)
npm run build            # dist/policy-playground.html (artifact) and dist/site/index.html (static site)
```

| Read | For |
| --- | --- |
| [docs/SPEC.md](docs/SPEC.md) | Exactly what the engine simulates; the contract between all parts |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Moving to a standalone repo, keeping in sync with the contracts, roadmap |
| [conformance/README.md](conformance/README.md) | How the on-chain check works |
| [src/engine/types.ts](src/engine/types.ts) | Engine API and the scenario and challenge formats |

Not audited and not a security tool: it explains the contracts, it does not replace reading them.
