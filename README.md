# gladlog

**English** · [Chinese](README.zh-CN.md)

A desktop app for analyzing World of Warcraft arena combat logs: it parses your local combat log and gives you match reports, a 2D replay, and cross-match statistics, plus an AI coach that reviews matches one by one. **Local-first — no account, no upload, AI analysis optional.**

> Local-first World of Warcraft arena log analyzer with replay and AI coaching, built from scratch with Electron + React + TypeScript. All data stays on your machine.

## Features

- **Match report** — damage / healing / damage-taken meters, whole-team HP curves, and tables for interrupts, crowd control, and dispels. Click a death marker for a 10-second recap of what killed you (the incoming damage stream, defensives you had available but never pressed, externals your teammates never sent).
- **2D replay** — positioning replayed on the real arena minimap: health bars with HP numbers, true cast bars (gold = completed, red = kicked), obstacles, a dampening indicator, and GCD swimlanes (one lane of ability usage per player, with spell icons). Drive it with space and the arrow keys, at 0.5×–4× speed.
- **AI review** (optional) — structured findings where every conclusion cites a verifiable match event. Click "replay this moment" to jump straight to that second and see it for yourself. Replies in Chinese or English; each finding can be marked "fixed" or "still doing it".
- **Statistics** — across matches: win rate, rating curve, win rate against each enemy composition, win rate by map, and an aggregate of your most frequent mistakes.
- **Honesty is a hard requirement** — from the parser differential oracle, through the prompt coverage gates, to the UI data-faithfulness tests, the whole chain has deterministic verification (see the [verifiability roadmap](docs/verifiability-roadmap.md)).

## Install

Download the installer for your platform (Windows x64 / macOS) from [Releases](https://github.com/mingjianliu/gladlog/releases).

## Quick start

1. Open the app → **Select WoW folder** (it locates the combat log automatically and starts watching it).
2. Turn on combat logging in-game. Enable **Advanced Combat Logging** as well — without it there are no coordinates and no HP samples, so the replay and some analyses will not work.
3. Play an arena match; the report appears on its own. To backfill old logs, use **Import historical logs…**.

AI analysis needs a backend picked under Settings — either an API key (Anthropic or DeepSeek) or a local CLI you already have (Claude Code, agy, or Codex), which needs no key at all. Every local feature works without any of them.

Full details are in the **[user guide](docs/user-guide.md)**; common questions from new users are answered in the **[FAQ](docs/FAQ.md)**.

## Privacy

All match data lives on your machine, in the app data folder. Only when you actively click "analyze" is a text summary of that one match sent to the AI service you configured yourself; if you never click it, nothing is uploaded at all (map backgrounds and spell icons load from public CDNs).

## Development

```bash
npm ci
npm -w @gladlog/desktop run dev            # Electron development mode
npm -w @gladlog/desktop run dev:ui         # browser-only report UI test bed (the fastest UI iteration loop)
npm test --workspaces  # all tests
```

Architecture, engineering discipline, and workflows are covered in the **[developer guide](docs/developer-guide.md)**.

## License

MIT — see [LICENSE](LICENSE).
