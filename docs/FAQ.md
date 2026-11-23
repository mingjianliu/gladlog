# gladlog FAQ

**English** · [Chinese](FAQ.zh-CN.md)

This page is all a new user needs; for the complete feature walkthrough see the [user guide](user-guide.md).

## Basics

**What is gladlog?**
An arena combat log analyzer for World of Warcraft. When a match ends you automatically get a report (damage / healing / damage-taken meters, HP curves, death recaps), a 2D replay (real minimap positioning plus one lane of ability usage per player), and cross-match statistics. An AI coach for per-match review is available as an option.

**Does it cost anything? Do I need an account?**
It is free and open source (MIT), with no account, no login, and no in-app purchases. The only thing that can cost money is AI analysis — and that runs on an AI service you configure yourself, and it's optional; every local feature works without it.

**Could I get banned? Is it safe?**
The app only reads Blizzard's own combat log text files (`WoWCombatLog*.txt`) — a public feature the game ships with, and the same route Warcraft Logs, Details, and similar tools take. gladlog does not modify the game, inject into its process, or read its memory.

## Installation

**Which platforms are supported?**
Windows x64 and macOS (Apple Silicon, i.e. the M-series chips). There is no Intel Mac build yet.

**Windows says "Windows protected your PC" / SmartScreen blocks it.**
The installer has no purchased code-signing certificate (this is a personal open-source project). Click **More info** → **Run anyway**.

**macOS says it "cannot be opened because the developer cannot be verified".**
Same cause — the app isn't notarized. **Right-click the app → Open**, then confirm once; after that a normal double-click works.

**Where do I download it?**
The latest version on [GitHub Releases](https://github.com/mingjianliu/gladlog/releases). Pick `Setup.exe` on Windows, the `.dmg` on Mac.

## Getting started

**What do I do after installing?**
Two things: (1) **Select WoW folder** in the app (it locates the log and starts watching automatically); (2) turn on combat logging in-game — type `/combatlog` before entering the arena, and tick **Advanced Combat Logging** under System Settings → Network. After that, finishing a match produces a report on its own.

**Why is Advanced Combat Logging mandatory?**
Coordinates and HP samples only exist in the advanced log. Without it there is no positioning replay, no health bars in the death recap, and no positioning analysis. Leave it on permanently; an addon can auto-run `/combatlog` for you.

**Can I import matches I played earlier?**
Yes. Use **Import historical logs…** on the settings page and select as many old `WoWCombatLog*.txt` files as you like; re-imports are deduplicated per match.

**Which brackets are supported?**
3v3, 2v2, and Solo Shuffle (split round by round).

## AI analysis

**How do I turn on AI analysis, and what does it cost?**
Pick a backend on the settings page:

- **Anthropic API key**: billed by usage, typically a few cents per match analysis.
- **DeepSeek API key**: also billed by usage, and cheaper. Note that this one sends the match summary to DeepSeek's servers.
- **Claude CLI / agy / Codex CLI** (local): if you already subscribe to Claude Code, Antigravity, or OpenAI Codex, install the corresponding command-line tool and it works with no API key and no extra cost. gladlog detects the command path itself.

You can also configure no backend at all — reports, replay, meters, and statistics are all local features.

**Will the AI make things up?**
Preventing that is gladlog's core design. The AI is only allowed to cite events that actually happened in the match, and every conclusion carries an evidence chain: "Evidence" highlights the cited events on the timeline, and "replay this moment" jumps to that second so you can verify it with your own eyes. Entries with false citations, invented numbers, or unfounded causal claims are discarded automatically by deterministic audits.

**Why did this match produce zero findings?**
Most often because there genuinely was nothing to fault — nobody died, resource usage had no obvious problems. That's a good outcome; gladlog does not manufacture coaching opinions. If it says the output was malformed, click **Re-analyze** to retry.

**What does "recurring problem · N times in the last M matches" on a finding mean?**
Cross-match self-learning. Every analysis result is recorded in a local learning ledger, and a problem that appears 5 or more times in your last 20 matches is judged a stable pattern of yours — after that, every recurrence is flagged directly on the report. (This step is pure statistics; it makes no AI call.) The **Long-term patterns** card on the statistics page shows every pattern, its frequency trend, and whether it's improving.

**Why is "Long-term patterns" empty?**
It needs history: aggregation only starts once you have analyzed more than 5 matches, and confirming a pattern requires 5 occurrences within the last 20. Being empty on a fresh install is expected — analyze a few more matches.

**Can it reply in English?**
Yes. Set **Language** to English at the top of the settings page: the interface and the AI replies both switch. Results for each language are cached separately (see the [user guide](user-guide.md#language)).

## Privacy

**Is my data uploaded?**
No. All match data lives in the app data folder on your machine — there is no account and no cloud. The only network traffic: when you actively click "analyze", a text summary of that one match goes to **the AI service you configured yourself**; separately, map backgrounds and spell icons load from public CDNs. If you never click analyze, no match data leaves your machine.

## Troubleshooting

**I finished a match and no report appeared.**
Check in order: (1) Did you run `/combatlog` in-game? You have to do it every session unless an addon handles it. (2) Is the WoW folder correct? Point it at the installation root — the app finds `Logs/` itself. (3) A match is only stored once it **finishes**; a match you left early may be incomplete.

**The replay says "no position data".**
Advanced combat logging was off for that match (see above). Re-importing an old match after enabling it won't help — coordinates only exist in matches played after advanced logging was on.

**Old matches have no cast bars, or the list is missing composition icons.**
Cast data only exists in matches parsed by a newer version: re-import the raw log with "Import historical logs" to fill it in. For composition icons in the list, use Developer view → **Rebuild match index** to backfill them in one pass.

**The AI analysis button is greyed out.**
That match's data is incomplete (the recorder's own unit can't be found). AI review always centers on you, and both the healer and DPS perspectives are supported.

**I found a bug / I have a feature request.**
Open a [GitHub Issue](https://github.com/mingjianliu/gladlog/issues), ideally with the version number (visible on the settings page) and a rough description of the match in question.
