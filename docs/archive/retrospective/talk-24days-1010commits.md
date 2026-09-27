# One Person + AI: 24 Days, 1,010 Commits

> Talk script + slide outline · Scalable version
> Source material: git history from the gladlog / wowarenalogs repositories + all local AI session logs from 2026-03-31 to 2026-08-02

---

## How to use this script

Each slide is marked `[Core]` or `[Extended]`. **Core frames are the skeleton—don't cut them; extended ones are the flesh—add or remove on the fly based on remaining time.**

| Duration | What to cover | Slides |
|---|---|---|
| **20 minutes** | Only `[Core]`; keep each of the three mechanisms in Act 3 to one sentence | ~16 slides |
| **45 minutes** | Core + all `[Extended]` in Act 3 + the war stories in Act 4 | ~28 slides |
| **90 minutes / podcast** | Everything + the two demo slots + Appendix B Q&A material | ~36 slides |

In the script, **bolded sentences are meant to be spoken verbatim**; the rest are prompts. Square brackets `[…]` are stage directions.

---

# Cold Open `[Core]` · ~2 minutes

### Slide 1 — A single message

The entire slide is a single chat screenshot, with no explanation:

```
2026-07-10  21:39
Keep going. Don't wait for me.
```

**Script:**

> This is a message I sent at 9:30 PM on July 10, 2026. Seven words. After sending it, I went to sleep.

[Pause for two seconds]

### Slide 2 — Twenty-four days later

```
1,010 commits
7 modules · 86,938 lines of code · 273 test files
A desktop application that can actually be installed and used
```

**Script:**

> Twenty-four days later, this is the result. One thousand and ten commits.

> I want to get one thing straight up front, so you don't think I'm bluffing: **I didn't write those thousand commits.** Over those twenty-four days, I sent a total of only 749 messages to the AI, **with a median length of 55 characters**—shorter than any single line on this slide.

### Slide 3 — What we're talking about today

```
1 · What happened over those four months
2 · Why it didn't turn into a pile of garbage
3 · How much it actually cost me
```

**Script:**

> Today I'm covering three things: what actually happened over those four months; why something built this fast didn't turn into a pile of garbage—which is what you're all dying to ask right now; and how much it actually cost me. **I'll report every last dollar on that last one. Nothing hidden.**

> Let's start from four months ago.

---

# Act 1 · Late March–June: The Prequel `[Core]`

## Slide 4 — What I was doing `[Core]`

A screenshot of a World of Warcraft arena match + a raw combat log excerpt.

**Script:**

> I play World of Warcraft arena. The game writes every action from every match into a text file—who cast what ability, how much damage was dealt, who died. A single match produces hundreds of thousands of lines.

> The problem was: **I lost a match. I knew I lost. But I didn't know why I lost.** The answer was in that file, but no human could read through it.

> So four months ago, I started doing something: having AI read it and tell me what I did wrong.

## Slide 5 — Starting from someone else's project `[Core]`

**Script:**

> I didn't plan to write from scratch. There was an existing open-source project for combat log parsing. I forked it and started modifying it myself.

> From late March to June, I made **over a thousand commits** on that project. Those three months were my apprenticeship.

## Slide 6 — What I learned wasn't how to write code `[Core]`

Large text:

```
What I learned wasn't "how to get AI to write code"
It was "how to get AI to work without lying to me"
```

**Script:**

> Those three months, I thought I was learning how to use AI to write code. **Looking back, what I actually learned was something else entirely: how to keep it from lying to me when I wasn't watching.**

> That distinction nearly killed me later. We'll get to it in Act 4.

## Slide 7 — The first thing I ever said `[Core]`

Quoted verbatim with timestamps:

```
2026-05-21  17:23
"is there a way to connect claude with agy
 for task dispatching, code review"

2026-05-21  17:31
"i want the reverse,
 Claude write code, agy review.
 Claude create tasks, agy execute"
```

**Script:**

> This is the earliest AI conversation record still saved on my machine.

> Notice what I was asking. I wasn't asking "help me write a feature." **I was asking: can I connect two different AIs so one writes and the other reviews.**

> The first thing I did wasn't writing code. **It was building a pipeline.** This is the first important point of this entire talk: if you treat AI as a faster typist, your ceiling is very low. You need to treat it as a team that needs to be managed.

## Slide 8 — What grew out of those three months `[Extended]`

```
· agy — a second AI, dedicated to review and debate
· eval system — scoring AI output instead of going by gut feel
· HANDOFF docs — sessions end, but memory must be persisted to disk
· TRACKER — a numbered ledger of 100+ bugs and features
```

**Script:**

> Those three months I didn't ship any earth-shattering features, but four things grew out of it—and all four were carried over intact into the new project.

> The most important one is the second: **eval**—a system for scoring AI output. Because I quickly discovered that AI-written analyses always sound convincing, **and you need something without feelings to judge whether they're actually correct.**

## Slide 9 — A hidden fact `[Extended]`

```
2026-07-09, I was using the exact same methodology
to investigate a database problem completely unrelated to gaming
```

**Script:**

> A quick aside. July 9—the day before the rewrite—I was using the exact same methodology to do something completely unrelated: investigating an observability problem in a large-scale database. I had Claude produce a report, had agy challenge it, then brought Gemini into the debate.

> What I'm saying is: **this methodology wasn't custom-built for a gaming project. It proved itself first, and only then was it applied to this project.**

---

# Act 2 · July 10: That Day `[Core]` — The climax

> This entire act uses real chat logs from that day, one per slide, in chronological order.
> **Don't over-explain. Let the timestamps speak for themselves.** Keep the pace fast.

## Slide 10 — 06:13 `[Core]`

```
2026-07-10  06:13

"…I want to make my own version now
  because the original author won't allow me to distribute it"
```

**Script:**

> Six thirteen in the morning.

> I'd been modifying someone else's project for three months, and I was using what I built every day. Then I wanted to share it with others—**and I couldn't.** It was someone else's project. The license wasn't in my hands.

> **This was a distribution rights problem, not a technical one.** That's important: what made me start over wasn't bad code—it was that I wanted to give something away and didn't have the right to.

## Slide 11 — 06:21 `[Core]`

```
06:21  "I want to rewrite it"
06:39  "I don't want to use any of his stuff"
06:49  "Hmm, I can use my own code directly, right?"
```

**Script:**

> Eight minutes later, I decided to rewrite. Twenty-six minutes later, I decided not to keep a single line of his.

> That last question, "I can use my own code directly, right?"—that's the part I personally contributed over three months. **What I wanted was a version where I could account for the origin of every single line.**

## Slide 12 — 16:15 `[Core]`

```
16:15

"I want you to call agy for the actual coding as much as possible
  if you run out of quota, fall back to sub agent (a weaker model)
  start with architecture and spec first"
```

**Script:**

> Four in the afternoon. Notice the information density in this message—**three sentences, three decisions**: who does the work, who to fall back to when it can't keep up, and do design before code.

> I wasn't describing a single feature. I was configuring a production line.

## Slide 13 — 19:39 `[Core]`

```
19:39  "Max 20x, roughly how much of my quota would that use"
19:41  "Why spread it over six weeks? Is it because the program is slow?"
```

**Script:**

> Seven-thirty in the evening. I asked it how long this would take.

> **It told me: six weeks.**

> [Pause]

> My reaction wasn't "oh, okay then." My reaction was **"why does it need to be spread over six weeks?"**

> This is the single moment from the entire talk I most want you to remember. That "six weeks" was a **human-style project estimate**—it assumed someone working eight hours a day, resting on weekends, attending meetings, sleeping. **But the one doing the work isn't human.**

## Slide 14 — 19:42 / 21:39 `[Core]`

```
19:42  "I'll have it keep running continuously"
21:39  "Keep going. Don't wait for me."
```

**Script:**

> My answer was these two sentences. Then I went to sleep.

> [Cut back to the cold open slide]

> That's the message from the opening. Now you know when and why it was sent.

## Slide 15 — The six-week prophecy `[Core]`

Large-text comparison:

```
Prophecy    6 weeks
Actual      ~30 hours
```

Below in smaller text:

```
Six sub-projects — log parser / desktop client / match report UI /
AI analysis / evaluation toolchain / game data pipeline
July 10 → July 11, all closed within two days
```

**Script:**

> That six-week prophecy actually took about thirty hours.

> By July 11, six sub-projects—a log parser written from scratch, an Electron desktop client, a match report UI, AI analysis, an evaluation toolchain, a game data pipeline—**all closed.**

> **I want to be clear about what happened here: what got compressed wasn't the amount of work—it was the waiting.** Most of those six weeks would have been a human sleeping, commuting, sitting in meetings. The work itself was exactly the same amount—it's just that no one was waiting anymore.

---

# Act 3 · 7/11 – 8/2: Those Twenty-Four Days `[Core]`

## Slide 16 — What you're thinking right now `[Core]`

One sentence filling the entire slide:

```
"Anything built this fast
  must be garbage, right?"
```

**Script:**

> At this point, you're all thinking the same thing. I know, because I thought it too.

> For this next act, I'm not going in chronological order. I'm covering three mechanisms. **The first answers "how was it done so fast," the second answers "why isn't it garbage," and the third answers "so what's left for me to do."**

## Slide 17 — Mechanism 1: The Pipeline `[Core]`

```
Claude   Lead · architecture · proposals before final call
agy      Independent review · debate · cheap implementation work
Sonnet   Bulk grunt work (evaluation, corpus scanning)
Codex / Gemini   Third-party cross-validation
```

**Script:**

> The first mechanism: **it's not one AI—it's a team.**

> The key isn't how many there are. It's that **they don't defer to each other.** My rule is: an important conclusion must be challenged by a model from a different vendor before it counts. A single model checking its own work is the same as no check at all—it'll validate itself using the same flawed logic that produced the error.

## Slide 18 — The physical form of the pipeline `[Extended]`

```
· git worktree parallelism — multiple isolated workspaces in the same repo, several things progressing simultaneously
· Background agents — dispatch and forget, notified when done
· Phone remote — work doesn't stop just because I'm away from my computer
```

Quote:

```
2026-08-01  07:49
"I'm on my phone doing remote ops, can't run commands
  can you check what state that worktree is in right now"
```

**Script:**

> Physically, it relies on three things. Multiple workspaces running in parallel, so unrelated tasks progress simultaneously; background tasks that notify me when they're done; and—**I can make decisions from my phone.**

> That message is from the morning of August 1. I wasn't at my computer, but the production line didn't stop.

## Slide 19 — A fact I didn't expect `[Extended]`

```
2026-05   opus 4.7
2026-06   opus 4.8
2026-07   fable 5
2026-08   opus 5
```

**Script:**

> Here's something I didn't realize while I was doing it—I only noticed when compiling this material: **the model I was using changed four generations over those four months.**

> I was building a house on a ship that kept swapping out its engine. This also means—**if you think AI can't handle your particular task today, that judgment might have a shelf life of only six weeks.**

## Slide 20 — Mechanism 2: Validation Gates `[Core]`

Three lines filling the entire slide—this is the project's constitution:

```
1 · Gate predicates are the specification
2 · Fixes must include before-and-after numbers
3 · Documentation is bilingual and paired
```

**Script:**

> The second mechanism answers "why isn't it garbage."

> In the root of my project there's a file with three iron rules, **and every single one was paid for with an incident.** The second one is the most important—we'll cover exactly how it came about in the next act.

## Slide 21 — Rule 1: One fact, one source of truth `[Extended]`

```
The analysis code says "this ability is on cooldown"
The validation gate also says "this ability is on cooldown"

—— They must use the same function, the same constant, the same tolerance
```

**Script:**

> Rule one. When my analysis code asserts something and my validation gate needs to verify that same thing, **both sides must use the exact same piece of code to make the judgment.**

> Sounds obvious. But in a full audit in July 2026, I found five independent bugs—**and all five were the same kind: both sides had written their own version, and the two versions disagreed.**

> Later, I created a table registering all 54 such predicates across the entire project, **plus a test: if anyone renames or moves one, CI goes red.** The day that table went live, it caught five already-registered violations on the spot.

## Slide 22 — Rule 3 and hard gates `[Extended]`

```
QA hard gates (blocked from committing if they don't pass):
· Friendly death coverage + percentile monotonicity
· Same-second health consistency
· Window duration self-consistency
· Cooldown ledger consistency
```

**Script:**

> The key isn't "I was being careful." The key is that **all these predicates became automated gates.** I specifically wrote into the rules: don't leave one-off scripts—they vanish with the session, and next time there's a regression, no one's guarding the door.

## Slide 23 — Mechanism 3: My job became making decisions `[Core]`

```
749 messages · median 55 characters
```

Real samples:

```
"yeah"
"yes"
"anything else left to do?"
"fix them one by one and do thorough AB tests to prevent regression"
"what do you suggest? what approach gives the best results? ignore cost"
"anything you need me to decide on? be specific"
```

**Script:**

> The third mechanism. These are things I actually said during those twenty-four days.

> **You can tell I'm not writing code. I'm not even directing. I'm making decisions.**

> That last one—"anything you need me to decide on?"—is one of my most frequent messages. **My role shifted from "author" to "approver"—and the sole approver at that.**

## Slide 24 — But there's one thing only I can do `[Core]`

```
"I don't want the death recap to look like this
  I want it centered on the health curve
  with abilities annotated along the timeline
  maybe we shouldn't use this current approach"
```

**Script:**

> But there's one category of decisions it can't make for me. This one is from July 26.

> **What it built had no bugs. All tests green. All gates passed. But I didn't want it.** Because I play this game, and I know what I want to see first after I die.

> **AI can tell you whether an approach is correct. It can't tell you whether it's what you want.** The gap between those two things—that's still human territory.

## Slide 25 — The twenty-four day ledger `[Core]`

```
1,010 commits            24 days
749 messages from me      median 55 characters
105,388 message round-trips    87,453 tool calls
Single-day peak: 10,834 tool calls (July 1)
```

**Script:**

> Here's the ledger for those twenty-four days. The bottom line: **in a single day, this system performed ten thousand eight hundred operations on my behalf.**

---

# Act 4 · Cost and Boundaries `[Core]`

## Slide 26 — Let's talk money first: compute `[Core]`

```
24.9 billion tokens
Of which 81.4 million tokens of output on my side

Converted at Anthropic API list prices:
$30,217  –  $36,093
```

**Script:**

> Now let's talk money. Over these four months, these conversations burned through **24.9 billion tokens.**

> Converted at official API list prices—these are public prices anyone can look up—**that's thirty thousand to thirty-six thousand dollars in compute.**

> **And that's a lower bound.** The conversation records from April and early May were already purged by the system, and the consumption from agy, Gemini, and Codex isn't included at all.

## Slide 27 — Now let's talk money: what I actually paid `[Core]`

```
Claude Pro      $20 × 3 months (Apr/May/Jun)      $60
Claude Max 20x  $200 × 1 month (upgraded in Jul)  $200
agy             $20 × 4 months                    $80
Gemini CLI / Gemini web / Codex                    $0
──────────────────────────────────────────────────
Total                                             $340
```

Large text below:

```
$30,217 in compute
$340 on the bill

≈ 89×
```

**Script:**

> So what did I actually pay?

> **Three hundred and forty dollars.**

> From April to June I was on the twenty-dollar entry tier the whole time; I only upgraded to the two-hundred-dollar tier in early July. Add the twenty-dollar monthly fee for the other AI, and it's three forty total for four months.

> [Pause, let the number land]

> **This is the only number in this entire talk that I find truly staggering.** Not twenty-four days. Not a thousand commits. **It's the gap between thirty thousand dollars in compute at list price and the three forty on my credit card—roughly ninety times.**

> I don't know how long this pricing will last. **But as long as it does, you should be using it right now.**

## Slide 27b — A sequence `[Extended]`

```
Early July    Upgraded to Max 20x
July 10       Decided to rewrite
That evening 19:39  "Max 20x, roughly how much of my quota would that use"
That evening 21:39  "Keep going. Don't wait for me."
```

**Script:**

> By the way, here's a sequence I only noticed when compiling the material.

> I upgraded my tier in early July, and didn't decide to rewrite until several days later. And on the night of the decision, the last thing I did was **confirm whether my quota was sufficient**—only then did I dare say "keep going, don't wait for me."

> [⚠️ Only say the following if this genuinely reflects what you were thinking at the time; if it was just coincidence, delete this slide]
> **The reason I dared say that was half because I knew how to manage it, and half because I had just bought myself enough quota.**

## Slide 28 — Done with the good stuff; now the disasters `[Core]`

**Script:**

> That's the pretty part. Now the disasters, because I promised to report everything.

## Slide 29 — Disaster 1: The most expensive lesson `[Core]`

```
2026-07-20

Fix: "Unify health sampling radius"
Root cause analysis: reads convincingly
Commit message: persuasive
Merged to main

Actual test: 26/50  →  26/50
Not a single number changed
```

**Script:**

> This is the origin of the second iron rule.

> There was a time it reported a bug as fixed. **The root cause analysis read convincingly, the commit message was persuasive, I read it and thought it checked out, and merged it to main.**

> Later I ran the same predicate against real data: **twenty-six out of fifty matches had the problem. After the "fix," still twenty-six. Not a single number changed.**

> That "root cause" was wrong. The real cause was somewhere else entirely. **And the explanation it wrote was reasonable enough—reasonable enough to fool me.**

## Slide 30 — Same day, round two `[Extended]`

```
Same day, another bug:
Checked only one sample, then extrapolated to the entire category
—— later overturned by an independent review with a single counterexample
```

**Script:**

> What made it worse was that **the same thing happened again, the same day.** Another judgment—drew a conclusion from a single sample—later overturned flat out by an independent reviewer with a single counterexample.

> Self-verification failed twice in one day. That's how the second iron rule was born.

## Slide 31 — Iron Rule 2 `[Core]`

Full slide:

```
When claiming a bug is "fixed,"
you must provide before-and-after numbers under the same predicate.

If you can't, say so explicitly ——
Reading the code + a convincing commit message
does not count as verification.
```

**Script:**

> This rule is now written in the very first file of my project. Every session starts by reading it.

> **Pay attention to the second half.** What I'm guarding against isn't wrong code—wrong code makes tests go red. **What I'm guarding against is an explanation that reads correct to me but was never actually verified.** This is the most dangerous thing about AI right now: **its confidence and its accuracy are two independent curves.**

## Slide 32 — Disaster 2: Silent failure `[Extended]`

```
Upstream directory doesn't recognize a certain ability
  ↓
Entire downstream whitelist silently fails
  ↓
"This never happened" and "this can't fire"
 look exactly the same
```

**Script:**

> The second category of disaster is sneakier. **It doesn't throw an error—it just quietly does nothing.**

> An upstream data table was missing a few entries, and an entire downstream rule would never trigger again. What I saw in the UI was: this problem never occurred. **"Never happened" and "can't fire" look exactly the same in the output.**

> Tests can't catch this kind of bug, because the tests were written based on the same wrong assumption.

## Slide 33 — Disaster 3: Me `[Extended]`

```
An agent ran in the wrong workspace once,
modifying files in my other checkout

—— recovered without data loss, but those thirty minutes were rough
```

**Script:**

> The third one wasn't the AI's fault. It was mine. I was running too many parallel workspaces too aggressively, and one agent wandered into my other directory and made changes.

> I recovered everything intact. **But for those thirty minutes, what I was thinking was: has this system already outrun my ability to keep watch over it.**

## Slide 34 — So what hasn't changed `[Core]`

```
The predicates were defined by me
The decisions were made by me
Real-device testing was run by me
What to build was decided by me
```

**Script:**

> So in the end, what hasn't changed?

> **The predicates were defined by me.** What counts as "fixed"—AI doesn't get to define that.

> **The decisions were made by me.** 749 times.

> **Real-device testing was run by me.** My rules still have a batch of items tagged "waiting on user"—Windows packaging on real hardware, running through actual matches—because those require me personally sitting at the computer.

> **And most importantly: what to build was decided by me.**

## Slide 35 — Closing `[Core]`

Return to the first slide's message:

```
2026-07-10  21:39
Keep going. Don't wait for me.
```

**Script:**

> Back to those seven words from the opening.

> **That sentence was possible not because I found a really smart AI.**

> **It was possible because, before I said it, I had already spent three months teaching myself how to know whether it was lying to me—even when I wasn't watching.**

> Thank you.

## Slide 36 — Backup closing slide `[Core]`

```
gladlog · v0.1.19 · 2026-08-02
github.com/mingjianliu/gladlog
```

---

# Appendix A · Methodology and Sources for All Numbers (Must read before going on stage)

If there's a stickler in the audience, you need to know where every number comes from and what its limitations are.

| Number | Source | Methodology & Notes |
|---|---|---|
| 1,010 commits | `git log` full dump | 2026-07-10 → 08-02, includes all commit types (feat/fix/docs/chore), **don't say "a thousand features"** |
| 24 days | 7-10 decided to rewrite → 8-02 released v0.1.19 | Calendar days |
| 749 messages from me | gladlog session logs, excluding system-injected messages (task notifications, slash commands, hooks) | **gladlog main directory + worktrees only**, excludes the predecessor project |
| Median 55 characters | Same as above | Mean gets pulled to 1,296 by a few pasted long texts, **reporting median is more honest** |
| 2,880 Claude prompts | `~/.claude/history.jsonl` | 2026-03-31 → 08-02, across all projects (not just these two) |
| 1,203 agy prompts | `~/.gemini/antigravity-cli/history.jsonl` | From 2026-05-20 onward; the two WoW projects account for 71% (858 prompts) |
| 105,388 messages / 87,453 tool calls / peak 10,834 | `~/.claude/stats-cache.json` | **Only covers 36 active days from 5-21 → 7-23**, this is a lower bound |
| 24.9 billion tokens | Summed from `usage` fields across all session logs | The vast majority is cache reads (17.2 billion); this is caused by repeatedly reading long contexts, **not 17.2 billion new tokens** |
| 81.4 million output tokens | Same source, `output_tokens` | This is "the amount AI actually produced" |
| $30,217 – $36,093 | Converted per-model at Anthropic official API list prices | Range comes from whether cache writes are priced at 1.25× or 2× (5-minute / 1-hour TTL). **This is a lower bound**: Apr–early May records are lost, agy/Gemini/Codex not included |
| $340 actual spend | Confirmed by you personally | Claude Pro $20×3 (Apr/May/Jun) + Max 20x $200×1 (upgraded early Jul) + agy $20×4. On stage, **report 89×** (calculated using the $30,217 lower bound); don't report 106×—dividing by the lower bound is more defensible |
| Six weeks vs 30 hours | Your verbatim message at 19:41 on 7-10 + git history | ⚠️ The AI's original "six weeks" statement is in a lost session; **you can only quote your own "why spread it over six weeks?"** Don't claim you have its original screenshot |
| 86,938 lines / 273 tests / 7 modules | `wc -l` on `packages/*/src`, excluding generated artifacts | |
| Models changed four generations | `model` field in session logs, tallied monthly | May opus-4.7 / Jun opus-4.8 / Jul fable-5 / Aug opus-5 |
| 54 predicates | `docs/predicate-index.md` | Companion consistency test at `packages/eval/test/predicateIndex.test.ts` |
| 26/50 → 26/50 | Documented in `CLAUDE.md` + commit `3cd5342` | |

**Three statements you must make on stage, or the numbers won't hold up:**

1. "**I didn't write those thousand commits.**"—Prevents being called a fraud.
2. "**Thirty thousand dollars is a lower bound, not a precise figure, because the April records are gone.**"—Prevents getting caught on methodology.
3. "**The six-week number comes from my own words at the time; I don't have a screenshot of its original response.**"—This is the only place you can't produce primary evidence. Disclose it proactively.

---

# Appendix B · Questions You'll Be Asked

**Q: How's the code quality really? Would you let people look at it?**
> Yes, the repo is public. And what I'd suggest you look at isn't the code—it's `CLAUDE.md` and `docs/predicate-index.md`—**those two files are the real output of this project.** Code can be rewritten; predicates can't.

**Q: What if AI prices go up 10× tomorrow?**
> Then I'll scale back to using it only for the hardest parts. But note the comparison I just gave: thirty thousand at list price, three forty on my bill. **Even at 10×, I still come out ahead.**

**Q: Is $340 the full picture? What about electricity, your own time?**
> Electricity wasn't counted, and my time wasn't counted—**but my time shouldn't be counted anyway, because those three months I was gaming and building at the same time.** What I will own up to is this: **conversation logs from April and early May were already purged by the system, so the thirty-thousand compute figure is a lower bound and the real number is higher.** That means the multiplier only gets bigger, not smaller.

**Q: Can an average person replicate your setup?**
> The pipeline, yes. The rules can't be copied directly—**because every rule was paid for with a specific incident, and copying my rules means copying a lesson that isn't yours.** What you should copy is the behavior: after every disaster, write the lesson into a rule that gets automatically enforced—not just a reminder.

**Q: Do you think programmers will be replaced?**
> My gut feeling from these four months: **typing has already been replaced; decision-making hasn't yet.** But I also want to be honest—three months ago I wouldn't have believed six sub-projects could be finished in a single night. **So I have no confidence in the shelf life of "hasn't yet."**

**Q: Do you regret the three months on the predecessor?**
> No regrets, and the sequence wouldn't work in reverse. **Without those three months of disasters, there would be no three iron rules; without those three iron rules, what got built in those twenty-four days really would have been garbage.**

---

# Appendix C · Two Optional Demo Slots

**Demo Slot 1 (after Slide 24, ~90 seconds)**
Open the app, pick a match you actually lost, run an AI analysis, read out one of its recommendations, then **click the evidence chain behind that recommendation**—jumping to the exact second on the timeline.
Say: "**Notice—it's not lecturing me. Every sentence it writes is anchored to a real moment in the log.**"

**Demo Slot 2 (after Slide 31, ~60 seconds)**
Open `CLAUDE.md` directly on screen, read the second iron rule verbatim, including the line "reading the code + a convincing commit message does not count as verification."
Say: "**I didn't write this for humans. This is the first thing it reads at the start of every session.**"
