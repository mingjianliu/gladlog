# gladlog user guide

**English** · [Chinese](user-guide.zh-CN.md)

## Install and first-time setup

1. Download and install from [Releases](https://github.com/mingjianliu/gladlog/releases) (Windows x64 / macOS; on macOS, if the first launch is blocked, right-click → Open).
2. On launch, follow the wizard to **Select WoW folder** — the app locates `Logs/WoWCombatLog*.txt` automatically and starts watching it live.
3. **Turn on combat logging in-game**: type `/combatlog` before you enter the arena (or let an addon do it), and tick **Advanced Combat Logging** under System Settings → Network. Without advanced logging there are no coordinates and no HP samples — the replay, the death recap, and positioning analysis all depend on them.
4. Play an arena match (3v3 / 2v2 / Solo Shuffle). When it ends, the report shows up in the list on the left by itself.

**Importing historical logs**: use **Import historical logs…** on the settings page or in the first-run wizard → select as many old `WoWCombatLog*.txt` files as you like → they are parsed into the library automatically. Re-importing is safe; matches are deduplicated.

## Match list

Each row shows the win/loss, the arena name, the duration, the average team rating, and the spec icons for both teams. The filter bar at the top filters by win/loss, bracket, and spec (matching either team).

> If matches saved by an older version are missing composition icons: Developer view → **Rebuild match index** backfills them in one pass.

## Match report view

- **Meter card**: four modes — damage / healing / damage taken / **stats**. The stats table is one row of hard numbers per player (interrupts cast and interrupts suffered, seconds under crowd control and the percentage of the match that represents, dispels, buffs stolen). Click a row to expand the individual events; each one has a "▶" that jumps the replay to that moment.
- **HP curves**: the whole team's health over time. Shaded bands mark **kill attempts** (gold) and windows where **the enemy had no major defensive up and nobody pressured them** (grey-red); click a band to jump straight into the replay.
- **Death recap**: click a death triangle on the curve → the stream of damage taken, healing received, crowd control, and self-cast defensives from the 10 seconds before the death, plus "defensives you had available at the time of death and never pressed" and "externals your teammates could have given you and didn't". "Replay this moment" lands 8 seconds before the death.
- Clicking a name in the meter hides or shows that player's curve.

## Replay view

The arena is on the left (real minimap, movement trails, obstacles), the GCD swimlanes on the right (one lane of ability usage per player, with real spell icons). Both sides share one clock.

- **Controls**: space plays/pauses; ← / → move ±5 seconds (±1 second with Shift); speed 0.5× / 1× / 2× / 4×; drag the scrubber to go anywhere.
- **Cast bars**: a unit that is casting gets a progress bar under its health bar — gold means the cast finished, red means it was interrupted or cancelled. (Only matches imported or recorded by a recent version have this; re-import an older one to get it.)
- Click any ability chip in a swimlane and the clock jumps to that cast; click a "died" marker to open the death recap.
- The right side of the control bar shows the current **dampening** percentage.

## AI analysis view (optional)

1. Pick a backend on the settings page: an API key (Anthropic or DeepSeek), or a local CLI you already have (Claude Code, agy, or Codex) which needs no key.
2. Click **Structured analysis** — you get a live preview while it generates, and the result is a set of findings graded by severity.

**Every finding is verifiable**: "Evidence" highlights the events it cites on the timeline, and "▶ replay this moment" jumps straight to that second in the replay. The AI is only allowed to cite events that actually occurred in the match; findings with citations that don't check out are discarded automatically.

- **Language**: the CN/EN toggle next to the analyze button. Results for each language are cached separately, so switching is instant.
- **Follow-up marks**: each finding can be marked "✓ fixed" or "↻ still doing it". The "most frequent mistakes" section on the statistics page aggregates these marks.

## Statistics view

Three time ranges — today / 7 days / all: match count and win rate, rating curve (one line per bracket), win rate against each enemy composition (click a row to filter the match list by that spec), win rate by map, and the cross-match aggregate of your **most frequent mistakes** (click the most recent entry to go to that match).

## Settings

- **WoW folder**: changing it restarts the watcher.
- **AI backend**: five options — the Anthropic API and the DeepSeek API (both need a key), and the Claude, agy, and Codex CLIs (local, no key; the command path is auto-detected, and you can enter it by hand if it lives somewhere unusual). Each backend has its own model dropdown.
- **API key**: keys are encrypted on disk and the UI never shows more than "configured". You can clear one at any time. Note that with an API backend the match summary goes to that provider's servers, whereas the local CLIs keep the call on your machine (apart from whatever the CLI itself does).
- **Coach reply language**: Chinese or English.
- **AI self-review** (off by default): after an analysis, the same model checks its own findings once more against the match data — it corrects or removes statements the data does not support and never adds new ones. It costs one extra AI call per analysis (roughly double the AI usage, 1–2 minutes longer). A result that went through it says "已 AI 自查" above the findings; if the check fails, you get the original findings marked "未自查". Turning it on or off makes already-analyzed matches show as not analyzed until you re-run them.

## Troubleshooting

- **The replay says "no position data".** Advanced combat logging was off for that match (see step 3 of first-time setup).
- **Old matches have no cast bars / no composition icons.** Cast data only exists in matches parsed by a newer version — re-import the raw log with "Import historical logs". For the composition icons in the list, use "Rebuild match index" in the developer view.
- **The AI analysis button is greyed out.** The match data is incomplete (the recorder's own unit can't be found). AI review always centers on **you**: both the healer perspective and the DPS perspective (burst alignment, target discipline, interrupt audit) are supported.
- **Can I use it without an API key?** Yes — reports, replay, stats, and the statistics page are all local and don't depend on the AI.
