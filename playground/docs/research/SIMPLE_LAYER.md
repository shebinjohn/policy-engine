# The Simple Layer: Redesign Brief

The playground felt more complex than the Policy Engine is. This brief redesigns it for people who
know Safe but are not developers. Decided with the project owner:

- **Simple first, Advanced behind.** One link. The simple layer is the default; today's detailed
  app stays reachable as "Advanced" for engineers. Both run on the same verified engine.
- **A rulebook picture, with real words** introduced one at a time.
- **First screen:** a 60-second explainer, then "Will this pass?".
- **Depth:** 8 big ideas on the main path; the 24 scenarios move to a "Deep dives" shelf. Sharp-edge
  warnings appear only in deep dives and Advanced.

## 1. The whole idea, in four sentences

Everything on the simple layer serves this model. If a screen does not help someone hold it, it
belongs in Advanced.

1. Every Safe transaction goes to the **Policy Guard** first.
2. The guard looks the transaction up in the **rulebook** by three things: the **contract**, the
   **action**, and the **call type**.
3. The matching **rule** names one **policy**, and the policy decides.
4. No matching rule? The **"Anything else"** rule decides. No "Anything else" rule? **Blocked.**

Plus one fact about change: **changing the rulebook takes a waiting period.**

## 2. Structure and routes

Top bar: `Policy Engine Playground` · **Learn** · **Ask** · **Play** · (right side, quieter)
**Advanced**. Engineer view exists only inside Advanced.

| Route | Screen |
| --- | --- |
| `#home` (default, also empty hash) | Learn home: the explainer, a compact "Will this pass?", the 8 big ideas, links to Play, Deep dives, Advanced |
| `#ask` | Will this pass? (full width) |
| `#idea-<id>` | One big idea |
| `#play`, `#play-<challenge id>` | Challenges, simple view |
| `#deep-dives` | The 24 scenarios as a shelf; each opens in Advanced |
| `#advanced` and the existing `#sandbox`, `#scenarios`, `#scenario-<id>`, `#scenario-<id>-step-<n>`, `#learn`, `#run-<code>` | Today's app, unchanged inside an "Advanced" frame |
| `#challenge-<id>` (old links) | Redirects to `#play-<id>` |

Hash names stay plain: ASCII letters, digits and hyphens (the artifact link carries nothing else).

## 3. Visual vocabulary (the same four pieces everywhere)

- **Transaction card.** A sentence and who sends it: "Pay Mallory 500 USDC", small "Owners sign"
  or "Allowance Module". Tappable.
- **Rulebook.** A table with three key columns and the policy: `Contract · Action · Call type →
  Policy (settings)`, e.g. `USDC · Send tokens · Normal → Recipient Allowlist (Dave always)`. The
  "Anything else" rows sit at the bottom, visually separate. The matching row lights up.
- **Verdict.** A large stamp, `✓ Allowed` or `✕ Blocked`, and one reason sentence a non-developer
  understands ("Mallory is not on the USDC list."). Never only colour.
- **Mini path.** Three nodes, left to right: `Rulebook → Policy → Result`, filled in as the card is
  checked. A quiet "Show every step" opens today's full decision path for those who want it.

Card into rulebook into verdict is the one animation that matters. Keep it short, and instant
under reduced motion.

## 4. Screens

**Learn home (`#home`).**
1. *How the Policy Engine decides*: four short steps (sentences 1 to 4 above), each one with the
   rulebook picture lighting the part it talks about. Below, five transaction cards from
   `ideas/how-it-works.json`; tapping one runs it through the rulebook and stamps the verdict. The
   explainer is complete at rest (the first card already shown checked).
2. *Will this pass?*: the compact question builder, pre-filled and answered, with "Ask your own".
3. *Eight big ideas*: a grid of numbered cards (title, one-liner, done mark).
4. Quiet links: Play the challenges, Deep dives, Advanced simulator.

**Ask (`#ask`).** A sentence builder in plain words:
`[The owners ▾] want to [send ▾] [500] [USDC ▾] to [Mallory ▾]` → **Check**. Verbs: send tokens or
ETH, approve someone to spend, wrap ETH, add an owner, enable a module, turn off the guard, run a
batch (each step is one sentence row), run unknown code (delegatecall). "More options" (folded): a
co-signature, all owners signing, call type. The answer: verdict stamp, one reason, the rule used
(highlighted in a compact rulebook), and the mini path. Next to it the rulebook in use, editable:
pick an example rulebook (Treasury example, Nothing allowed, Everything allowed, Co-signer for
anything else) or edit rows ("When the Safe [action] on [contract] → [policy] with [settings]").
Editing here sets up a fresh Safe; one line says that on a live Safe changes take a waiting period
(big idea 7). "Share" gives the existing share code and link. "Open in Advanced" carries the setup.

**Big idea (`#idea-<id>`).** Title, one-liner, at most three short paragraphs, the rulebook used,
then the transaction cards. Each card first asks "Allowed or Blocked?" (skippable, never scored),
then stamps the verdict and shows its `note`. Ends with the takeaway, "Deep dives" links, and
Next idea.

**Play (`#play`).** The challenges with less text: the brief (two or three sentences), the rulebook
the player edits (same row editor as Ask, limited to the allowed policies), and the tests as a grid
of transaction cards marked *should pass* or *should be blocked*, each turning green or red. Run,
hints (the existing ladder), stars and par, "Why this works". One challenge view only: the old
detailed challenge screen goes away.

**Deep dives (`#deep-dives`).** The 24 scenarios grouped by chapter, one line each, opening the
scenario in Advanced.

**Advanced.** Today's app (Sandbox, Scenarios, Learn reference, Engineer view), inside a frame
with a clear "Back to the simple view".

## 5. Words

The simple layer uses: Safe, owners, transaction, Policy Guard, rulebook, rule, policy (introduced as
"the checker the rule names"), contract, action, call type (normal call; delegatecall from idea 8),
Anything else (introduced in idea 4 as "also called the catch-all"), batch, module, co-signer,
waiting period, and the policy labels from `src/content/policies.ts`.

It never shows: nonce, selector, calldata, gas, hex, access selector, signatures (beyond "owners
sign", "co-signed", "all owners sign"), revert, transaction guard vs module guard as two things
(say "the guard checks module transactions too"), Solidity error names, GS codes.

Copy: sentences of at most 20 words, at most three sentences per block, active voice, no emoji, no
em dashes, Title Case titles. Reasons talk about people and money ("Mallory is not on the USDC
list"), not mechanisms.

## 6. The 8 big ideas (`ideas/*.json`, order 1 to 8)

1. **Nothing Passes Without a Rule.** Deny by default.
2. **One Rule per Action.** A rule is contract + action + call type, and it names exactly one
   policy. No stacking: the same action cannot have two policies.
3. **Policies Check the Details.** Who receives, how many times, a co-signer, which module, more
   owners signing.
4. **The "Anything Else" Rule.** The catch-all decides calls without their own rule, and a
   specific rule always beats it (Always Deny included).
5. **Batches Are Checked Step by Step.** A batch needs its own rule, and every step needs one.
6. **Modules Are Checked Too.** Module transactions go through the same rulebook; some policies
   only accept owners, the Module Allowlist only accepts modules.
7. **Changing the Rulebook Takes Time.** Propose, wait, apply; changes expire; they can be
   cancelled; a new Safe is set up in one batch.
8. **A Few Surprises.** The handful of sharp edges, told gently, each linked to its deep dive:
   wrapped ETH's back door, removing a rule is not denying it, four zero bytes are not an empty
   call, a failed batch gives back a one-time permission, unknown code (delegatecall).

Each idea: 2 to 4 cards, at least one Allowed and one Blocked, a setup with only the rules the idea
needs (one to three rows), and deep dives pointing at the existing scenarios.

## 7. Done means

Every big idea and the explainer replay through the engine (`npm test`) and on chain
(`npm run conformance`). The simple layer passes a click-through: the explainer, every big idea,
Ask with every verb, Play solving every challenge, Deep dives opening Advanced, and old links
(`#scenario-…`, `#challenge-…`, `#run-…`) still working. Light, dark, 400 px with no horizontal
scroll, keyboard, reduced motion, no console errors.
