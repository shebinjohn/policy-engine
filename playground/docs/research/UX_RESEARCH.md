# UX Research: Puzzle Games, Explainers and the Playground

What makes educational puzzle games and interactive explainers work, and which practices fit the Policy Engine Playground. Based on the UI screenshots of 5 Nov 2026 (Sandbox, Scenarios, Challenges and Learn at 1440 px and 400 px) and the code in `src/ui/`.

Cost, for one developer in the single-file React app: **S** under 2 days, **M** 3 to 7 days, **L** more than a week.

## 1. Summary

- **Ask before you show.** People who predict an outcome before seeing it learn more than people who only watch, most of all when the outcome surprises them. The engine's sharp edges are such surprises. Today each scenario step prints the expected outcome before the run.
- **Name the misconception when it bites.** A short "you might expect X, but Y, because Z" has a moderate, reliable effect. The decision path is the place for it.
- **Make every debated state a link.** Scenarios and challenges have routes; steps and Sandbox runs do not. A link to the exact Safe, transaction and verdict ends a team argument.
- **Introduce, develop, twist, then test.** The chapters already do the first three. The matching challenge sits in another menu with no link.
- **Hints should point first and solve last,** and the solution should not earn full stars.
- **Keep the tool calm.** No tours, leaderboards, streaks or confetti. Motion shows cause and change only. Progress is a checkmark and a par count.
- **Plain by default, bytes on request.** Keep the Engineer view and add per-item peeks.
- **Keep what works:** the full decision path, "How to fix", "What changed", the pre-filled example, Want/Got per test and "Why this works".

## 2. Ranked recommendations

### 1. Ask for a prediction before the reveal (S)
- **Pattern:** Before a step runs, the learner taps "Allowed" or "Blocked". The result then shows beside the guess.
- **Evidence:** Students who only watched a physics demonstration understood it no better than students who never saw it; students who predicted first did ([Crouch et al. 2004](https://mazur.harvard.edu/presentations/classroom-demonstrations-learning-tools-or-entertainment)). Predicting works through surprise when a confident guess is wrong, and needs feedback right after ([Brod 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8642250/)). Feedback should follow an attempt ([Shute 2008](https://doi.org/10.3102/0034654307313795)). [Parable of the Polygons](https://ncase.me/polygons/) asks "what happens?" before each run; [The Evolution of Trust](https://ncase.me/trust/) asks for a choice before each match.
- **Where:** Scenario step card: hide "Expected: Blocked by Co-Signer" until the guess, then show "You said Allowed. It was Blocked, at Policy." Sandbox: optional "Your guess" chips beside "Run transaction".
- **Benefit:** The catch-all leak, the WETH back door and "removing is not denying" are exactly the surprising cases.
- **Risks:** An extra click. Offer "Skip guessing", remember it, never score guesses.

### 2. Name the sharp edge when it happens (M)
- **Pattern:** When a run hits a known trap, add one line: what people expect, what happens, why.
- **Evidence:** Refutation text has a moderate effect, g = 0.41 across 44 comparisons ([Schroeder and Kucera 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8784251/)). Good feedback says what, how and why, in small pieces (Shute 2008). Flexbox Froggy's author logs wrong answers per level to find misconceptions ([Park 2015](https://thomaspark.co/2015/11/learning-css-layout-with-flexbox-froggy/)).
- **Where:** Decision path, styled like the existing "No guard" warning. At Rule lookup: "This call has no rule of its own. The catch-all decided it." Also under a failing challenge test.
- **Benefit:** Teaches the sharp edges at the moment they matter, which is the product's goal.
- **Risks:** One per run, or it becomes noise. The copy needs the same review as scenarios.

### 3. Deep links to a step and to any Sandbox run (M)
- **Pattern:** Every state worth arguing about has a URL.
- **Evidence:** The TypeScript Playground keeps editor state in the URL hash, compressed with lz-string ([handbook](https://www.typescriptlang.org/_playground-handbook/url-structure.html)). Learn Git Branching takes commands from the URL and shares levels as gist links or pasted JSON ([repo](https://github.com/pcottle/learnGitBranching)). Bret Victor: readers should be able to test an author's claim in place ([Explorable Explanations](http://worrydream.com/ExplorableExplanations/)).
- **Where:** Extend `#scenario-<id>` to `#scenario-<id>/3`; encode the Sandbox state (preset, rule changes, transaction) in the hash. Add "Copy link to this run" in the "What happened" header and "Copy link with my rules" on a challenge.
- **Benefit:** A thread ends with "open this link".
- **Risks:** A Claude artifact runs in a frame and may drop the fragment; test it, and fall back to "Copy setup" text that "Reset Safe" can paste. Version the format.

### 4. Light up the rule that decided (S)
- **Pattern:** Rules are visible objects; show which one is active.
- **Evidence:** Baba Is You puts its rules on screen, and its designer found levels overwhelm as active rules multiply ([Game Developer](https://www.gamedeveloper.com/design/designing-i-baba-is-you-i-s-delightfully-innovative-rule-writing-system)). Victor: "follow the flow", "see the state" ([Learnable Programming](http://worrydream.com/LearnableProgramming/)).
- **Where:** After a run, mark the matched row in "Your Safe > Rules" (or the dashed Catch-all box) "Decided the last run", and make "Rule found: USDC transfers…" link to it.
- **Benefit:** Ties the lookup to the table people edit.
- **Risks:** At 400 px the table is on another tab; show the rule inline there.

### 5. Close each chapter with its challenge (S)
- **Pattern:** Introduce, develop, twist, conclude.
- **Evidence:** Koichi Hayashida: learn the mechanic, a harder use, "something crazy happens", then "demonstrate ... mastery" ([Game Developer](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design); [GMTK](https://youtu.be/dBmIkEvEBtA)). Testing beats restudying for long-term retention ([Roediger and Karpicke 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x)).
- **Where:** Chapter 2 already runs The Catch-All Rule, Deny Beats the Catch-All, then the twist, The WETH Back Door. Its lesson should link "Show what you learned: No Wrapped Ether". Map: 1 Pay the Vendor; 2 No Wrapped Ether, The Co-Signed Invoice; 3 A Bonus for Erin, Gas Money, Revoke Never Approve; 4 Monthly Payroll, The Night Shift; 5 The Allowance Module; 6 Retiring the Guard. Number challenge cards 1 to 10 (three now read "Level 2") and add "Builds on Chapter 3".
- **Benefit:** Two parallel menus become one path.
- **Risks:** Recommend, never lock.

### 6. Hints that point, then teach, then solve (S)
- **Pattern:** A hint ladder: pointing, teaching, answer.
- **Evidence:** Hints raised tutor results by over 20% in one classic study, yet in the game Refraction all four hint designs slightly lowered performance across 50,000 players ([O'Rourke et al. 2014](https://grail.cs.washington.edu/wp-content/uploads/2015/08/orourke2014hsm.pdf)). Hint chains that end in the answer invite abuse (Shute 2008), and students who "game the system" learn less ([Baker et al. 2004](https://doi.org/10.1145/985692.985741)). In Learn Git Branching a viewed solution does not count as solved ([wiki](https://github.com/pcottle/learnGitBranching/wiki)).
- **Where:** Challenge "Hints": a free first hint names the first failing test and stage; the next links the scenario that teaches it. Today "Use these rules" then "Run tests" earns full stars; record "Solved with the solution" instead.
- **Benefit:** Help that teaches, stars that mean something.
- **Risks:** Effects are small either way ([Aleven et al. 2016](https://doi.org/10.1007/s40593-015-0089-1)); do not over-build.

### 7. A "Start here" cue instead of a tour (S)
- **Pattern:** Learn by using; one obvious first step.
- **Evidence:** NN/g found tutorials did not improve task performance ([NN/g](https://www.nngroup.com/articles/mobile-app-onboarding/)). Blockly Games students closed instruction popups unread, "then were lost" ([Fraser 2015](https://developers.google.com/static/blockly/publications/papers/TenThingsWeveLearnedFromBlockly.pdf)). Zach Barth: "We failed to make the game start simply enough" ([SpaceChem postmortem](https://gamedeveloper.com/design/postmortem-zachtronics-industries-i-spacechem-i-)). Capture the Ether opens with a Warmup category that only teaches the game ([challenges](https://capturetheether.com/challenges/)).
- **Where:** The Sandbox "Example" banner: "New to the Policy Engine? Start with Deny by Default, 4 steps." Dismissible, remembered.
- **Benefit:** A three-minute route for a CEO or designer, without hiding the Sandbox.
- **Risks:** None worth noting.

### 8. Accessibility pass on the interactive parts (S to M)
- **Pattern:** Keyboard, screen reader and colour-independent states everywhere.
- **Evidence:** WCAG 2.2 [Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [Info and Relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html), [Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html); [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/).
- **Where:** Move focus to the verdict after "Run transaction" (today it only scrolls). Make the 400 px "Your Safe / Build / Result" switcher [APG tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), not a radio group. Add arrow keys to segmented controls. Have test rows read "Want Allowed, got Blocked, wrong".
- **Benefit:** Required before the public launch.
- **Risks:** Test with a real screen reader, not only an audit tool.

### 9. Turn "How to fix" into a drafted change (M)
- **Pattern:** An error is a teachable moment with an action.
- **Evidence:** NN/g calls error messages "a teachable moment". Victor: "Start with something, then adjust until it's right."
- **Where:** Sandbox verdict: "Draft this change" opens the rule editor pre-filled and adds it to the change set, so the waiting period applies.
- **Benefit:** Non-developers learn request, wait, apply by doing it.
- **Risks:** Never one-click a fix that weakens security, such as an Always Allow catch-all; explain those instead.

### 10. Add a "Your turn" step to each scenario (M, L for all 24)
- **Pattern:** Worked example, then a partly completed problem, then a free one.
- **Evidence:** Fading worked steps gradually helps learning ([Renkl et al. 2002](https://doi.org/10.1080/00220970209599510)). Guidance that helps novices can hurt experts ([Kalyuga et al. 2003](https://doi.org/10.1207/S15326985EP3801_4)). Flexbox Froggy offers Beginner, "No Directions" and "Expert" modes ([site](https://flexboxfroggy.com/)). Trying before instruction helps conceptual learning, g = 0.36 ([Sinha and Kapur 2021](https://doi.org/10.3102/00346543211019105)).
- **Where:** A last step with the same Safe, one editable field (signers, call type or one rule) and a target verdict.
- **Benefit:** Bridges watching and building.
- **Risks:** Blockly found locked fill-in-the-blank exercises gave "no sense of ownership"; keep the edit real.

### 11. Compare two runs (M)
- **Pattern:** Show comparisons, not single data points.
- **Evidence:** Victor: "It is rarely enough to see a single data point in isolation." Wichary prefers an A/B toggle to a drag divider ([Wichary](https://unsung.aresluna.org/three-good-interactive-explainers/)).
- **Where:** "What happened": "Compare with last run", or one line ("Last run stopped at Policy. This run passed."). Activity entries reopen past runs.
- **Benefit:** Team debates are "what if": delegatecall or call, with or without the co-signer.
- **Risks:** No room side by side at 1440 px; use a toggle.

### 12. Define terms where they appear (M)
- **Pattern:** Label in place instead of a separate help page.
- **Evidence:** Victor: "it's not help, it's simply labeling" (Learnable Programming); lowering "the effort barrier" invites questions (Explorable Explanations).
- **Where:** First use of a glossary term (catch-all, selector zero, nonce) in narration, errors or the path gets a dotted underline and a popover. The glossary lives only on Learn today.
- **Benefit:** People read definitions where they need them.
- **Risks:** First use per card only. Popovers must open on focus and tap.

### 13. Fold the rule-change machinery (S)
- **Pattern:** Progressive disclosure, two levels at most.
- **Evidence:** Defer rarely used features; deeper nesting gets users lost ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).
- **Where:** "Your Safe" shows Change set, Waiting changes, Clock, Activity and Reset even when empty. Group them as "Rule changes and time" with a summary ("1 waiting, ready in 59 min") that opens when something is pending.
- **Benefit:** The column shows what decides the next run.
- **Risks:** Keep the waiting period visible while it is active; it is a sharp edge.

### 14. Carry the player's rules into the Sandbox (S)
- **Pattern:** Learners own their work.
- **Evidence:** Blockly: the student's own solution as the start of the next exercise worked where fill-in-the-blank failed (Fraser 2015).
- **Where:** Challenge "Why this works": "Open these rules in the Sandbox", reusing the scenario seed.
- **Benefit:** The game becomes a tool for real setups.
- **Risks:** None.

### 15. Calm progress for professionals (S)
- **Pattern:** Completion and personal par, not rank.
- **Evidence:** Barth chose histograms to "impersonally see how your solution stacks up" and called leaderboards "a fantastic incentive for cheating" (SpaceChem postmortem). Opus Magnum gives no rewards for optimizing ([Game Developer](https://gamedeveloper.com/business/road-to-the-igf-zachtronics-i-opus-magnum-i-)). Human Resource Machine keeps size and speed goals optional ([Tomorrow Corporation](https://tomorrowcorporation.com/posts/questions-about-the-machine)). Shute: avoid normative comparisons.
- **Where:** Scenarios grid: a done mark per card, "3 of 5" per chapter, resume. Challenges: "Solved in 2 rules, par 2".
- **Benefit:** Orientation without pressure.
- **Risks:** Histograms need a backend; skip them.

### 16. Re-check tests when a rule is saved (S)
- **Pattern:** Immediate feedback per case.
- **Evidence:** RegexOne updates each row "as you type" ([RegexOne](https://regexone.com/lesson/introduction_abcs)); [Brilliant](https://brilliant.org/) gives instant feedback per problem. Immediate feedback suits hard tasks and novices; delay can aid transfer (Shute 2008).
- **Where:** Challenge "Tests": refresh "Got" after each rule save. "Run tests" stays the counted attempt.
- **Benefit:** Clearer cause and effect.
- **Risks:** Invites trial and error; counted runs and par push back.

### 17. Lighter, live Learn policy cards (M)
- **Pattern:** Live examples over static text.
- **Evidence:** Blockly Games replaced documentation screenshots with live read-only instances (Fraser 2015). Ciechanowski's figures change one variable at a time ([GPS](https://ciechanow.ski/gps/)). TIS-100 makes its manual part of play ([Game Developer](https://gamedeveloper.com/design/-things-we-create-tell-people-who-we-are-designing-zachtronics-i-tis-100-i-)).
- **Where:** Learn > Policies, 11 dense cards: show "what it does" and "where it fits", fold Settings and Watch out, add "See it in action" linking its scenario.
- **Benefit:** Learn becomes an index into practice.
- **Risks:** Keep any live example small.

### 18. Engineer view as a peek and an off-ramp (S to M)
- **Pattern:** Plain by default, a path to the real representation.
- **Evidence:** Blockly Games shows the JavaScript after each level as an "exit strategy" (Fraser 2015). Hiding advanced functions helped novices ([Carroll and Carrithers 1984](https://doi.org/10.1145/358198.358218)). SQL Murder Mystery gives beginners a walkthrough and experts a bare prompt ([repo](https://github.com/NUKnightLab/sql-mysteries)).
- **Where:** Keep the toggle. Add "Show bytes" on a single path step or rule card, and a folded "Your rules as stored" after a solved challenge.
- **Benefit:** A PM can check one selector without switching modes.
- **Risks:** Reuse one component for both.

### 19. Motion only for cause and change (S)
- **Pattern:** Animate order and change, nothing else.
- **Evidence:** Staged transitions help people track change ([Heer and Robertson 2007](https://homes.cs.washington.edu/~jheer/files/2007-AnimatedTrans-InfoVis.pdf)). Interesting but irrelevant extras hurt learning ([Harp and Mayer 1998](https://doi.org/10.1037/0022-0663.90.3.414)). "Juice" research treats embellishments as repeating what is already shown ([Hicks et al. 2019](https://doi.org/10.1145/3311350.3347171); [Jonasson and Purho](https://www.youtube.com/watch?v=Fy0aCDmgnxg)).
- **Where:** Keep the 200 ms stage fade and the reduced-motion rule. Add only a short highlight on changed balances, nonce and the matched rule.
- **Benefit:** The eye lands on what the run did.
- **Risks:** Long staggers slow repeat runs.

### 20. Step-through mode for presenting (M)
- **Pattern:** Reveal the path one stage at a time.
- **Evidence:** Wichary praises on-screen controls and "automatic playback" for sequences; staging aids tracking (Heer and Robertson).
- **Where:** "Decision path" header: "Step through", one stage per click or arrow key, so a presenter can ask "where does it stop?"
- **Benefit:** Fits demos and leadership reviews.
- **Risks:** Never the default.

### 21. An "In the wild" line after a lesson (S)
- **Pattern:** Tie the puzzle to a real event.
- **Evidence:** Each Ethernaut level has a `completedDescription`; Delegation's warns about `delegatecall` and links the Parity hack ([gamedata.json](https://github.com/OpenZeppelin/ethernaut/blob/master/client/src/gamedata/gamedata.json), [delegate_complete.md](https://github.com/OpenZeppelin/ethernaut/blob/master/client/src/gamedata/en/descriptions/levels/delegate_complete.md)).
- **Where:** Scenario "Lesson" and "Why this works": one optional linked line. For delegatecall: the 2025 Bybit theft, where signers approved a DELEGATECALL that replaced the Safe's implementation ([CertiK](https://www.certik.com/resources/blog/bybit-incident-technical-analysis)).
- **Benefit:** Shows the stakes in a sentence.
- **Risks:** Safe incidents are sensitive; get comms review.

## 3. Anti-patterns to avoid

- **Modal tours and text walls.** People close them unread (Blockly, NN/g). Barth's test: "Can someone pick up our game and not read a single word of the text and play it?" ([Game Developer](https://www.gamedeveloper.com/design/spacechem-s-zach-barth-on-educational-games-tutorial-design)).
- **Leaderboards, streaks, XP and badges.** A course with badges and a leaderboard ended with lower intrinsic motivation and exam scores ([Hanus and Fox 2015](https://doi.org/10.1016/j.compedu.2014.08.019)); expected rewards undermine interest ([Deci, Koestner and Ryan 1999](https://doi.org/10.1037/0033-2909.125.6.627)); results vary with design ([Sailer and Homner 2020](https://link.springer.com/article/10.1007/s10648-019-09498-w)). Streaks make no sense for a tool used in a debate.
- **Confetti, sounds, shakes and mascots.** They distract (Harp and Mayer). "Blocked" is often the wanted outcome, never a failure.
- **Locked content.** A teammate must reach any lesson from a link. Gating suits a linear essay ([Case](https://blog.ncase.me/explorable-explanations/)), not this tool.
- **Answer before attempt.** Showing the expected outcome or solution first removes the learning (Shute, Crouch).
- **Locked fill-in-the-blank templates.** No ownership (Blockly).
- **Crowded starting setups.** Extra rules bury the one idea (Baba Is You).
- **Jargon in the plain view.** Hex belongs in Engineer view (Kalyuga).
- **Heavy fiction.** Story wrappers like [CodeCombat](https://codecombat.com/) are built for school learners. Alice, Dave, Erin and Mallory are enough.
- **Looking like the real Safe{Wallet}.** A simulator that resembles the signing app could be mistaken for it.

## 4. What the current UI already does well

- **Pre-filled Sandbox:** it opens on a blocked run with an explanation, not an empty form. Victor's "create by reacting".
- **Complete decision path:** every stage shows, including "Not reached" and "Skipped", with nested batch steps. No hidden state.
- **Elaborated verdicts:** a plain title, the policy blamed, why, and "How to fix" (Shute's what, how, why).
- **"What changed":** undone changes stay visible, struck through.
- **Preview:** "This call will be checked by" shows the lookup before running.
- **State per step:** "The Safe, after step 2" in scenarios.
- **Clear challenge goals:** Want/Got/Right per test with click-through, like Learn Git Branching's goal view; passing tests is the win and any valid solution counts, as in [Damn Vulnerable DeFi](https://github.com/theredguild/damn-vulnerable-defi). "Policies you can use" is OverTheWire's "Commands you may need" ([Bandit](https://overthewire.org/wargames/bandit/bandit0.html)), [Oh My Git!](https://ohmygit.org/)'s cards and [Lightbot](https://lightbot.com/)'s small command set.
- **Par and "Why this works":** HRM's size goal and Ethernaut's completion text.
- **Hints one at a time,** with the solution held back.
- **One concept per scenario,** six ordered chapters, nothing locked.
- **Two audiences:** plain language by default, a remembered Engineer view.
- **Accessible basics:** icon plus word on every verdict, reduced motion honoured, `role="status"` on the verdict, the path as an ordered list.
- **Mobile:** Your Safe, Build and Result tabs at 400 px, Result first after a run.
- **Visible trust:** the footer says every scenario and challenge is replayed against the real contracts.

## 5. Sources

**Games and level design**
- Hayashida, [The secret to Mario level design](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design), Game Developer
- Game Maker's Toolkit, [Super Mario 3D World's 4 Step Level Design](https://youtu.be/dBmIkEvEBtA)
- Barth, [Postmortem: Zachtronics Industries' SpaceChem](https://gamedeveloper.com/design/postmortem-zachtronics-industries-i-spacechem-i-)
- [SpaceChem's Zach Barth on educational games, tutorial design](https://www.gamedeveloper.com/design/spacechem-s-zach-barth-on-educational-games-tutorial-design)
- [Designing Zachtronics' TIS-100](https://gamedeveloper.com/design/-things-we-create-tell-people-who-we-are-designing-zachtronics-i-tis-100-i-); [TIS-100 manual](https://www.zachtronics.com/images/TIS-100P%20Reference%20Manual.pdf); [Shenzhen I/O](https://www.zachtronics.com/shenzhen-io/)
- [Road to the IGF: Opus Magnum](https://gamedeveloper.com/business/road-to-the-igf-zachtronics-i-opus-magnum-i-); [PC Gamer on Opus Magnum histograms](https://www.pcgamer.com/au/perfectly-solving-opus-magnums-puzzles-is-impossible-but-thats-ok)
- [Designing Baba Is You's rule-writing system](https://www.gamedeveloper.com/design/designing-i-baba-is-you-i-s-delightfully-innovative-rule-writing-system); [Reading the Rules of Baba Is You, GDC](https://gdcvault.com/play/1026590/Reading-the-Rules-of-Baba)
- Tomorrow Corporation, [Questions about the Machine](https://tomorrowcorporation.com/posts/questions-about-the-machine)
- Fraser, [Ten Things We've Learned from Blockly](https://developers.google.com/static/blockly/publications/papers/TenThingsWeveLearnedFromBlockly.pdf); [Blockly Games](https://blockly.games/); [Lightbot](https://lightbot.com/)

**Learn-by-doing tools and wargames**
- [Learn Git Branching](https://github.com/pcottle/learnGitBranching) and [wiki](https://github.com/pcottle/learnGitBranching/wiki)
- [Oh My Git!](https://ohmygit.org/); [FOSDEM 2021 talk](https://archive.fosdem.org/2021/schedule/event/git_learning_game/)
- [Flexbox Froggy](https://flexboxfroggy.com/); [Park 2015](https://thomaspark.co/2015/11/learning-css-layout-with-flexbox-froggy/); [Grid Garden](https://cssgridgarden.com/)
- [SQL Murder Mystery](https://github.com/NUKnightLab/sql-mysteries) and [walkthrough](https://mystery.knightlab.com/walkthrough.html)
- [RegexOne](https://regexone.com/lesson/introduction_abcs); [CodeCombat](https://codecombat.com/)
- [Ethernaut](https://ethernaut.openzeppelin.com/); [gamedata.json](https://github.com/OpenZeppelin/ethernaut/blob/master/client/src/gamedata/gamedata.json); [delegate_complete.md](https://github.com/OpenZeppelin/ethernaut/blob/master/client/src/gamedata/en/descriptions/levels/delegate_complete.md)
- [Damn Vulnerable DeFi](https://github.com/theredguild/damn-vulnerable-defi); [Capture the Ether](https://capturetheether.com/challenges/); [OverTheWire Bandit](https://overthewire.org/wargames/bandit/bandit0.html)
- CertiK, [Bybit incident technical analysis](https://www.certik.com/resources/blog/bybit-incident-technical-analysis)

**Explorable explanations**
- Case, [Explorable Explanations](https://blog.ncase.me/explorable-explanations/); [Parable of the Polygons](https://ncase.me/polygons/); [The Evolution of Trust](https://ncase.me/trust/)
- Victor, [Explorable Explanations](http://worrydream.com/ExplorableExplanations/); [Learnable Programming](http://worrydream.com/LearnableProgramming/)
- Ciechanowski, [GPS](https://ciechanow.ski/gps/); Wichary, [Three good interactive explainers](https://unsung.aresluna.org/three-good-interactive-explainers/); [Brilliant](https://brilliant.org/)

**Learning science**
- Crouch, Fagen, Callan and Mazur 2004, [Classroom demonstrations](https://mazur.harvard.edu/presentations/classroom-demonstrations-learning-tools-or-entertainment)
- Brod 2021, [Predicting as a learning strategy](https://pmc.ncbi.nlm.nih.gov/articles/PMC8642250/)
- Shute 2008, [Focus on Formative Feedback](https://doi.org/10.3102/0034654307313795)
- Schroeder and Kucera 2022, [Refutation Text Facilitates Learning](https://pmc.ncbi.nlm.nih.gov/articles/PMC8784251/)
- Sinha and Kapur 2021, [When Problem Solving Followed by Instruction Works](https://doi.org/10.3102/00346543211019105)
- Renkl, Atkinson, Maier and Staley 2002, [From Example Study to Problem Solving](https://doi.org/10.1080/00220970209599510)
- Kalyuga, Ayres, Chandler and Sweller 2003, [The Expertise Reversal Effect](https://doi.org/10.1207/S15326985EP3801_4)
- Roediger and Karpicke 2006, [Test-Enhanced Learning](https://doi.org/10.1111/j.1467-9280.2006.01693.x)
- O'Rourke, Ballweber and Popović 2014, [Hint Systems May Negatively Impact Performance](https://grail.cs.washington.edu/wp-content/uploads/2015/08/orourke2014hsm.pdf)
- Aleven, Roll, McLaren and Koedinger 2016, [Help Helps, but Only So Much](https://doi.org/10.1007/s40593-015-0089-1)
- Baker et al. 2004, [Off-task behavior: when students game the system](https://doi.org/10.1145/985692.985741)

**Motivation, motion and onboarding**
- Hanus and Fox 2015, [Assessing the effects of gamification in the classroom](https://doi.org/10.1016/j.compedu.2014.08.019)
- Sailer and Homner 2020, [The Gamification of Learning: a Meta-analysis](https://link.springer.com/article/10.1007/s10648-019-09498-w)
- Deci, Koestner and Ryan 1999, [Effects of extrinsic rewards on intrinsic motivation](https://doi.org/10.1037/0033-2909.125.6.627)
- Hicks, Gerling, Dickinson and Vanden Abeele 2019, [Juicy Game Design](https://doi.org/10.1145/3311350.3347171); Jonasson and Purho, [Juice it or lose it](https://www.youtube.com/watch?v=Fy0aCDmgnxg)
- Harp and Mayer 1998, [How seductive details do their damage](https://doi.org/10.1037/0022-0663.90.3.414)
- Heer and Robertson 2007, [Animated Transitions in Statistical Data Graphics](https://homes.cs.washington.edu/~jheer/files/2007-AnimatedTrans-InfoVis.pdf)
- NN/g, [Mobile-App Onboarding](https://www.nngroup.com/articles/mobile-app-onboarding/); [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- Carroll and Carrithers 1984, [Training wheels in a user interface](https://doi.org/10.1145/358198.358218)

**Accessibility and sharing**
- [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/)
- WCAG 2.2: [1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html), [4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html); [ARIA APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [TypeScript Playground URL structure](https://www.typescriptlang.org/_playground-handbook/url-structure.html)
