# gladlog — Report UI Design-Review Brief

> ⚠️ **已实现 / 历史文档(2026-07-13)。** 本简报当时发给云端设计工具做视觉重设计,
> 提出的方案**已全部实现并进一步迭代**。它描述的是**重设计前**的状态,不代表现状。
> 现状看 [`2026-07-13-report-ui-current-state.md`](./2026-07-13-report-ui-current-state.md)。
> (文中「fixture 预览坏了」也已修好。)

> Instructions for a visual/design pass on three newly-built report views.
> **Merged to `main`** (pull latest) — code + a real render fixture are in the
> repo, so you can render without a WoW client. The functionality and layout are
> done and tested; **this brief is about the visual design** — hierarchy, spacing,
> color, motion, legibility. Please critique and propose improved styling that
> stays inside the existing design system.

---

## 1. Product & aesthetic context

**gladlog** is a desktop (Electron) analyzer for World of Warcraft arena
combat logs. It parses a match and shows a report: a score header, damage/
healing meters, a timeline, per-unit detail, an AI coaching analysis, and now a
2D replay. It is a **dense, data-first desktop UI** (~1400px+ typical width,
mouse — not mobile, not touch).

**Design language — "石板黑 chrome + 鎏金点缀" (slate-black chrome + gilt accent):**
a quiet dark UI where the chrome is neutral slate and a single warm gold is the
only accent. Data identity colors (Blizzard class colors, win/loss green/red)
are used **only on data marks**, never on chrome. UI text is system sans; **all
numbers/timestamps are monospace, tabular**.

**Token palette (use these; do not introduce new hues except through tokens):**

```css
--bg: #0d0f12; /* app background        */
--surface: #14171c; /* panels/cards          */
--surface-2: #1a1e25; /* insets, tracks        */
--hairline: #262b34; /* borders               */
--hairline-soft: #1d2129; /* row dividers          */
--ink: #e8eaf0; /* primary text          */
--ink-2: #98a1b0; /* secondary text        */
--mute: #626b7a; /* tertiary/labels       */
--gold: #c9a35e; /* the one accent        */
--gold-dim: #8a7344; /* accent, subdued       */
--win: #4ade80; /* friendly / positive   */
--loss: #f87171; /* enemy / negative      */
--font-ui: -apple-system, system-ui, "Segoe UI", sans-serif;
--font-data: ui-monospace, SFMono-Regular, Menlo, monospace; /* all numbers */
```

Existing signature patterns to stay consistent with: active tabs = **gold
underline** (not filled pills); section headers = tiny uppercase gold letter-
spaced labels; cards = `--surface` + 1px `--hairline` + 8px radius.

## 2. Hard constraints (please respect)

- **Dark theme only** for now. Reuse the tokens above; no new colors on chrome.
- **Preserve the Chinese UI strings verbatim** (labels like 战报 / 回放 / AI 分析 /
  施法 / 免疫 / 控制). You may restyle, not retranslate.
- **Class colors are data-layer only** — fine on replay dots / identity marks,
  never on buttons/borders/backgrounds.
- Desktop density is intended; don't inflate to mobile spacing.
- Keep it consistent with the already-styled chrome (score header, meters,
  timeline) — those are the reference for "how gladlog looks."

## 3. The three views to review

### View A — Top-level tabs + full-width AI analysis

**Current state:** A new prominent tab row sits under the score header —
`战报 / 回放 / AI 分析` (report / replay / AI), gold-underline active state,
14px semibold. Selecting **AI 分析** renders the structured analysis + a "pro
comparison" panel at **full page width** (previously these were crammed into a
330px right sidebar). Report view keeps the main column (meters + timeline) with
a right sidebar that now holds only unit detail.
**Design questions:** Is the top-tab row distinct enough from the inner
伤害/治疗/承伤 meter tabs below it (two tab rows stacked)? Does the full-width AI
text column need a max-width / reading measure? Is the transition between views
abrupt?
CSS: `.rpt-view-tabs`, `.rpt-ai-full` in `styles.css`.

### View B — Unit detail: merged event stream + player filter

**Current state:** The right sidebar unit panel (330px). Top: a player dropdown
(`单位` label + `<select>`) to switch the focused unit — shares selection with
timeline clicks. Below: talents, then a **single merged, time-sorted table** of
casts + important auras (previously two separate tables). Cast rows show spell +
target; aura rows show `+`/`−` (green/mute) + spell + a small gold-dim category
chip (控制 / 免疫 / 防御 / 打断 …); aura rows carry a thin gold-dim left rule to
distinguish them from casts.
**Design questions:** Is cast-vs-aura distinction clear enough at a glance, or
does it need iconography / a type column? Are the category chips legible at 10px?
Is the native `<select>` acceptable or should it be a styled control? Row density
in a 330px column — comfortable or cramped?
CSS: `.rpt-unit-filter`, `.rpt-ev-aura`, `.rpt-aura-on/off`, `.rpt-cat`,
`.rpt-scroll-tall`.

### View C — 2D replay (the biggest visual surface)

**Current state:** A ~640px square SVG "arena." Each player = a **class-colored
dot** with a **team-colored ring** (friendly `--win` green / enemy `--loss` red),
dot opacity scales with current HP; a name label floats above. A faint 4×4 grid
gives spatial reference; a subtle inner rect frames the play area. Motion: a
**movement trail** (last ~6s of the unit's path, low-opacity class-color
polyline); on death the dot disappears and a dim red ✕ is left at the death spot.
Controls below the field: **▶ play / ⏸ pause**, a **scrubber** (range slider,
gold accent), a `m:ss / m:ss` monospace clock, and **1× / 2× / 4×** speed
buttons. Under that, a **legend**: class-swatch + team-ring + name per player,
struck-through when dead. Matches without advanced-log positions fall back to an
"无位置数据" message.
**Design questions:** Is dot + ring enough to tell teams/classes apart, or add
class icons / initials? Trail styling — length, fade, width? Does the arena need
a real map backdrop or is the abstract grid better? Are the controls'
grouping/affordances clear (play, scrub, speed, legend)? How should the dead
state read (✕ vs faded ghost)? Overall: does this feel like part of gladlog or
like a bolted-on widget?
CSS: the `.rpt-replay-*` block in `styles.css`.

## 4. What we'd like back

A visual critique + improved styling (mockups and/or updated CSS using the
tokens above) for the three views — especially **View C (replay)**, which is the
newest and most open-ended. Keep everything theme-consistent; the win is that
all three read as one system with the existing chrome.

## 5. How to render it (primary path for a design tool)

You do **not** need a WoW client or the Electron app. Everything is on `main`.

**Data — a real, committed match (recommended input):**
`packages/desktop/test/fixtures/real-match-sample.json` — a genuine 3v3 (Nagrand,
Win), anonymized (names/GUIDs → generic) and trimmed to the first 90s. It carries
real `advancedSamples` (movement coordinates), real casts/auras, real
classes/specs, and one death in window — i.e. everything the three views consume.
This is the input to design against.

**Components (pure React + CSS, no Electron API needed to render):**
`packages/desktop/src/renderer/src/report/components/` — `MatchReport` (top-level
tabs), `UnitPanel` (View B), `ReplayView` (View C). All styling lives in one file:
`packages/desktop/src/renderer/src/styles.css`. Render `MatchReport` with the
fixture above as `source` and you get all three views (the AI-analysis tab is the
only part that needs a data bridge — skip it for design).

`packages/desktop/test/report.realmatch.test.tsx` shows exactly how the fixture is
loaded and rendered through the views (a working reference harness).

**Live app (optional, for the full feel):**

```bash
cd packages/desktop && npm run dev     # opens the Electron window
```

Pick a match with advanced combat logging so replay has positions.

> Companion doc: `2026-07-12-report-ui-review-handoff.md` (dev-oriented — commit
> map, test coverage, and a note that the `VITE_FIXTURE_MODE` in-app fixture
> preview is currently broken; use the committed fixture or `npm run dev`).
