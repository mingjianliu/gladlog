/* Open-path stage probe (T93): where the time goes between a click on a
 * match-list row and the settled report, on the BUILT app.
 *
 *   npx electron-vite build
 *   npx tsx scripts/pageSwitchProbe.mts --make-lib <src lib> <userData> <N>
 *   npx tsx scripts/openStageProbe.mts <userData> <out.json> [rows=0,1] [launches=3]
 *
 * Every launch opens each listed row once, so each reading is a first
 * computation (nothing cached per source). The numbers are the app's own
 * `[open]` stage record (shared/openTrace.ts) - the same line a user's
 * main.log carries - plus the first frame that shows anything of the report
 * (`shellAt`: .rpt-match or .rpt-shell in the DOM, observed per frame).
 * NEVER point it at a real library: the app writes sidecars into what it opens.
 *
 * Baseline, 2026-11-12, M-series mac, 20 real matches, median of 5 launches,
 * ms after the click: before (integ/wave-1111) -> bytes parsed in the page ->
 * shell + staged fill. "content" is the first frame with the curve in it,
 * "block" the longest main-thread task.
 *                          anything     content            settled           block
 *   3v3, 14 MB              886 -> 3    886 ->  560 -> 177   901 ->  590 ->  551   468 -> 185
 *   3v3, 50 MB (median)    1960 -> 2   1960 -> 1244 -> 535  1979 -> 1271 -> 1280  1048 -> 372
 *   3v3, 68 MB (largest)   2603 -> 3   2603 -> 1456 -> 655  2627 -> 1480 -> 1535  1342 -> 444
 *   shuffle 192 MB, round 1 1541 -> 3  1541 ->  958 -> 404  1563 ->  980 ->  987   777 -> 280
 *   shuffle 54 MB, round 1  616 -> 2    616 ->  401 -> 159   637 ->  420 ->  429   346 -> 124
 * Where the "before" time went on the median match: disk + IPC 64, JSON.parse
 * 176, the context-bridge copy of the parsed doc 674, legacy conversion 164,
 * derives 870 (mistakes 376, stats table 311, death recaps 126), React
 * render + commit under 30.
 */
import { _electron as electron } from "@playwright/test";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const [userData, outPath, rowsArg, launchesArg] = process.argv.slice(2);
if (!userData || !outPath)
  throw new Error("usage: <userData> <out.json> [rows] [launches]");
const ROWS = (rowsArg ?? "0,1").split(",").map(Number);
const LAUNCHES = Number(launchesArg ?? 3);
const MAIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env["T93_OUT"] ?? "../out",
  "main/index.js",
);

type Trace = {
  id: string;
  at: Record<string, number>;
  dur: Record<string, number>;
  longTasks: { n: number; sumMs: number; maxMs: number };
  io: { invokeMs: number; parseMs: number } | null;
};
const all: Array<{ launch: number; row: number; trace: Trace; firstReportFrame: number | null; firstAnyFrame: number | null }> = [];

for (let l = 0; l < LAUNCHES; l++) {
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-testid=match-list] li:not(.mlr-group)", {
    timeout: 120_000,
  });
  await page.waitForFunction(() => !document.querySelector(".loading-more"), null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  for (const row of ROWS) {
    // A string, not a function: tsx's keepNames helper does not exist in the page.
    const r = (await page.evaluate(`new Promise((res, rej) => {
      const before = (window.__gladlogOpenTraces || []).length;
      const li = document.querySelectorAll("[data-testid=match-list] li:not(.mlr-group):not(.loading-more)")[${row}];
      if (!li) return rej(new Error("no row ${row}"));
      if (li.className === "sel") return rej(new Error("row already selected ${row}"));
      const start = performance.now();
      let firstReportFrame = null, firstAnyFrame = null, gone = false;
      li.click();
      function tick() {
        const now = performance.now();
        const main = document.querySelector(".app-main");
        // the old report leaves first; then the first frame that shows
        // report structure for the new selection
        if (!gone && !document.querySelector(".rpt-match")) gone = true;
        if (firstAnyFrame === null && main && (main.querySelector(".rpt-shell") || (gone && main.querySelector(".rpt-match"))))
          firstAnyFrame = now - start;
        if (firstReportFrame === null && gone && document.querySelector("[data-testid=rpt-timeline]"))
          firstReportFrame = now - start;
        const t = window.__gladlogOpenTraces || [];
        if (t.length > before) return res({ trace: t[t.length - 1], firstReportFrame, firstAnyFrame });
        if (now - start > 120000) return rej(new Error("timeout row ${row}"));
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })`)) as { trace: unknown; firstReportFrame: number | null; firstAnyFrame: number | null };
    all.push({ launch: l, row, trace: r.trace as Trace, firstReportFrame: r.firstReportFrame, firstAnyFrame: r.firstAnyFrame });
    await page.waitForTimeout(800);
  }
  await app.close();
}

const med = (a: number[]) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const summary: Record<string, Record<string, number>> = {};
for (const row of ROWS) {
  const rs = all.filter((x) => x.row === row);
  const keys = new Set<string>();
  for (const x of rs) {
    for (const k of Object.keys(x.trace.at)) keys.add("at:" + k);
    for (const k of Object.keys(x.trace.dur)) keys.add("dur:" + k);
  }
  const out: Record<string, number> = {};
  for (const k of keys) {
    const [kind, name] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    out[k] = Math.round(med(rs.map((x) => (kind === "at" ? x.trace.at[name!] : x.trace.dur[name!]) ?? NaN)));
  }
  out["io:invokeMs"] = Math.round(med(rs.map((x) => x.trace.io?.invokeMs ?? NaN)));
  out["io:parseMs"] = Math.round(med(rs.map((x) => x.trace.io?.parseMs ?? NaN)));
  out["longTasks:n"] = med(rs.map((x) => x.trace.longTasks.n));
  out["longTasks:sumMs"] = Math.round(med(rs.map((x) => x.trace.longTasks.sumMs)));
  out["longTasks:maxMs"] = Math.round(med(rs.map((x) => x.trace.longTasks.maxMs)));
  out["frame:firstAny"] = Math.round(med(rs.map((x) => x.firstAnyFrame ?? NaN)));
  out["frame:firstTimeline"] = Math.round(med(rs.map((x) => x.firstReportFrame ?? NaN)));
  summary[`row ${row}`] = out;
}
writeFileSync(outPath, JSON.stringify({ userData, rows: ROWS, launches: LAUNCHES, summary, all }, null, 1));
for (const [k, v] of Object.entries(summary)) {
  console.log(`\n== ${k}`);
  for (const [n, ms] of Object.entries(v).sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${n.padEnd(34)} ${ms}`);
}
