---
name: run-ui
description: Run and drive gladlog's report UI locally to see/screenshot it. Use when asked to view, screenshot, iterate on, or visually check the 战报/回放/AI 报表 UI (MatchReport, ReplayView, GcdSwimlane, Meters, Timeline) — a pure-browser Vite test bed, no Electron/WoW client needed.
---

# Run the gladlog report UI (`dev:ui` test bed)

gladlog's report UI is pure React + one `styles.css`. This test bed renders it in
a plain browser via Vite (HMR) with real fixture data and a mock AI bridge —
fastest loop for iterating on the three views (战报 / 回放 / AI 分析), no Electron.

（另一条路:`VITE_FIXTURE_MODE=1 npm run dev` 起真 Electron 应用 + 免真数据的
fixture 预览——已修好,能走完整 App(比赛列表→报表)。想看真窗口/主进程行为用它;
只迭代 report UI 用本 dev:ui 更快。)

All paths relative to `packages/desktop/`.

## Start the server

```bash
cd packages/desktop
npm run dev:ui          # Vite → http://localhost:5199/  (leave running; HMR)
```

Runs on a fixed port (5199). Start it in the background; edits to any
`src/renderer/src/report/**` component or `styles.css` hot-reload.

## Drive it (Chrome MCP)

It's a normal web page — drive with the `claude-in-chrome` tools, no Playwright
driver needed:

1. `tabs_context_mcp` (createIfEmpty) → `navigate` to `http://localhost:5199/`.
2. Give it a moment: the harness may fetch a big local match (below). Then
   `javascript_tool` a quick check, e.g.
   `document.querySelector('.rpt-view-tabs button.active')?.textContent`.
3. Switch views by clicking the segmented tabs (战报 / 回放 / AI 分析). Their y
   shifts with header height — screenshot first, then click by the real coords
   (buttons carry text 战报/回放/AI 分析).
4. `computer screenshot` and **look at it**. A blank frame right after load is
   usually a mid-render race — re-check the DOM / re-screenshot, it's not a crash
   (the harness reliably renders; earlier "empty root" reads were timing).

Useful selectors: `.rpt-meters-card`, `.rpt-meter-name` (click = toggle a
player's HP curve), `.rpt-timeline`, `[data-testid=rpt-replay-field]`,
`.rpt-replay-unit`, `.rpt-gcd`, `.rpt-gcd-chip` (toggle a GCD column),
`.rpt-finding` (AI cards).

## Fixtures

Top-bar `<select>` switches the match feeding `<MatchReport>`:

- **real · 真实 3v3(纳格兰,裁剪匿名)** — committed `test/fixtures/real-match-sample.json`
  (anonymized, first 90s). Always present.
- **synthetic · 合成小样** — `test/fixtures/report-match.json`.
- **real · 完整真实局(本地 dev/local)** — optional. If `dev/local/full-match.json`
  exists it's fetched at runtime and auto-selected. This is a **full untrimmed
  real match kept only on this machine** (gitignored — real player names, ~10–15 MB).

### Add / refresh the full local match

The app stores parsed matches at
`~/Library/Application Support/gladlog/matches/<id>/match.json` (shape
`{schemaVersion,kind,data}`). To drop one into the test bed, trim the arrays the
views don't read + strip raw `params` (keeps size sane) and write to
`dev/local/full-match.json`:

```bash
node -e '
const src = require(process.env.HOME+"/Library/Application Support/gladlog/matches/<id>/match.json").data;
const KEEP=["damageOut","damageIn","healOut","absorbsOut","casts","petCasts","auraEvents","deaths","unconsciousEvents"];
const strip=e=>{const{params,...r}=e;return r};
const o={...src,units:{}};
for(const[id,u]of Object.entries(src.units)){const n={id:u.id,name:u.name,kind:u.kind,reaction:u.reaction,classId:u.classId,specId:u.specId};if(u.ownerId)n.ownerId=u.ownerId;if(u.info)n.info=u.info;n.advancedSamples=u.advancedSamples||[];for(const f of KEEP)n[f]=(u[f]||[]).map(strip);o.units[id]=n}
require("fs").writeFileSync("dev/local/full-match.json",JSON.stringify(o));
'
```

The 回放 arena/GCD need `advancedSamples` (positions); a match without advanced
combat logging shows 无位置数据 in 回放.

## Files

`dev/index.html` · `dev/main.tsx` (harness + fixture switch + AI mock bridge) ·
`dev/harness.css` · `dev/vite.config.mts` · `dev/.gitignore` (ignores `local/`).
`dev/` is outside `tsconfig`/electron-vite/eslint → never affects
`build`/`test`/`typecheck`/`lint`.
