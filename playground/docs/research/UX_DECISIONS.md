# UX Decisions

What we adopt from [UX_RESEARCH.md](UX_RESEARCH.md), what we skip, and why. Judged against three
things: the audience (the Safe team first, then the public: people who know Safe but are not
developers), the goal (end the team's ambiguity about which transactions pass, and teach the
engine's sharp edges), and the constraints (one HTML file in a Claude artifact, no backend,
localStorage only, and an artifact link that only carries a plain `#name` of letters, digits and
hyphens).

## Adopt now

| # | Recommendation | Decision and scope |
| --- | --- | --- |
| 1 | Prediction before the reveal | **Scenarios only.** Each step asks "Allowed or Blocked?" before it runs and hides the expected outcome until then. "Skip guessing" is remembered. Guesses are never scored. Not in the Sandbox: it is a tool, and a prompt there is friction. |
| 2 | Name the sharp edge when it happens | **Yes.** A "Sharp edge" line in the decision path, at most one per run, when the trace shows a known trap: the catch-all decided, the zero address shares the catch-all key, selector zero is not empty calldata, WETH's fallback ran under a catch-all, a removed rule fell back to the catch-all, a batch checked against the old state, a module ran with no module guard, a one-time permission was undone by a failed transaction, a policy refused to be set up on a catch-all. Driven by trace event ids, so it stays faithful. |
| 3 | Deep links | **Two parts.** Scenario steps get `#scenario-<id>-step-<n>` (artifact-safe). Sandbox runs get a "Share this run" that copies a setup code (letters and digits only) and a `#run-<code>` link; "Reset Safe" gains "Paste a setup code". The code is the reliable path inside the artifact; the link works on the static site and is a best effort in the artifact. The format is versioned. |
| 4 | Light up the rule that decided | **Yes.** The matched rule (or the catch-all box) is marked "Decided the last run", and "Rule found" in the path links to it. At 400 px the rule shows inline in the result. |
| 5 | Close each chapter with its challenge | **Yes.** Each chapter lesson ends with "Practise this: <challenge>", challenge cards say which chapter they build on, and the chapter list shows its challenges. Nothing is locked. |
| 6 | Hints that point, teach, then solve | **Yes.** The first hint is generated: the first failing test and the stage where it stopped. Authored hints follow, then a link to the scenario that teaches the idea, then the solution. A solution loaded with "Use these rules" counts as "Solved with the shown solution" and earns no stars. |
| 7 | A "Start here" cue | **Yes.** One dismissible line on the Sandbox banner: start with the first scenario. No tour. |
| 8 | Accessibility pass | **Yes, before any public launch.** Focus moves to the verdict after a run; the 400 px switcher becomes real tabs; segmented controls take arrow keys; test rows read as full sentences to screen readers. |
| 11 | Compare with the last run | **The small version.** One line under the verdict: "Last run: Blocked at Policy (Recipient Allowlist). This run: Allowed." Side by side is skipped: no room. |
| 13 | Fold the rule-change machinery | **Yes.** Change set, waiting changes, clock, activity and reset become one "Rule changes and time" section with a summary line; it opens itself while a change is waiting. |
| 14 | Carry the player's rules into the Sandbox | **Yes.** "Open these rules in the Sandbox" after a challenge. |
| 15 | Calm progress | **Yes.** Done marks on scenarios and "3 of 5" per chapter, with "Continue where you left off". Challenges keep stars (they encode par) and add "Solved in 2 rules, par 2". No streaks, XP, badges or leaderboards. |
| 16 | Re-check tests when a rule is saved | **Yes, as a preview.** "Got" refreshes after each rule change, marked as a preview; "Run tests" stays the counted attempt that unlocks hints and the solution. |
| 17 | Lighter policy cards | **The small version.** Fold settings and pitfalls; add "See it in action" linking the scenario that shows the policy. No live embedded examples. |
| 19 | Motion only for cause and change | **Yes.** A short highlight on what changed (balances, nonce, the matched rule) and nothing else; off under reduced motion. |
| 20 | Step-through mode for presenting | **Yes.** "Step through" on the decision path reveals one stage per click or arrow key, for talks and reviews where the presenter asks "where does it stop?". Never the default. |
| 12 | Define terms where they appear | **A limited version.** The first use of a small set of glossary terms (catch-all, guard, module, delegatecall, calldata, nonce, co-signer, change set, waiting period) in scenario narration, verdicts and challenge briefs gets a dotted underline and a definition on hover, focus or tap. One per term per card. |

## Defer

| # | Recommendation | Why not now |
| --- | --- | --- |
| 9 | "How to fix" as a drafted change | A one-click fix can nudge people toward permissive rules, the opposite of the lesson. The fix text plus the rule editor already covers it. Revisit after team feedback, limited to safe fixes. |
| 10 | "Your turn" step in each scenario | Large content work for 24 scenarios. Prediction (1) and chapter challenges (5) give most of the active-learning benefit now. Pilot it on one chapter later. |
| 18 | Per-element "Show bytes" | The global Engineer view already serves developers; a second mechanism adds surface for little gain. |
| 21 | "In the wild" incident lines | Real incidents, Safe's included, are sensitive and need communications review. The team should decide the wording, not the tool. |

## Keep

The pre-filled Sandbox, the complete decision path with "Not reached" stages, verdicts with "How
to fix", "What changed" with undone changes, the live "will be checked by" preview, Want and Got per
test, par, "Why this works", Engineer view, and the footer that says every example is replayed on
the real contracts.

## Avoid

Modal tours, text walls, leaderboards, streaks, XP, badges, confetti, sounds, mascots, locked
content, showing the answer before an attempt, crowded starting setups, jargon in the plain view,
heavy fiction, and anything that looks like the real Safe{Wallet} signing screens.
