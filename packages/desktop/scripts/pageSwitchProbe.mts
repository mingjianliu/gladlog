/* Page-switch probe (T80): time every page / tab switch of the BUILT app on
 * a library of a given size, cold and warm.
 *
 *   npx electron-vite build
 *   npx tsx scripts/pageSwitchProbe.mts --make-lib <src lib> <userData> <N>
 *   npx tsx scripts/pageSwitchProbe.mts <userData> <out.json> [reps=7] [rows=0,1]
 *
 * --make-lib builds a scratch userData of N matches by APFS-cloning the
 * matches of a real library (`cp -c -p`: no extra disk, mtime kept so a
 * copied rounds.idx.json stays valid). NEVER point the probe at a real
 * library: the app writes sidecars into what it opens.
 *
 * Each switch is timed in the page: from the click until its target is up
 * plus two frames ("done"), and until 300 ms pass with no DOM mutation and no
 * frame over 50 ms ("settled"). T80_PROFILE=1 adds a CPU profile of the first
 * warm run of every switch (build with renderer minify off to read it);
 * T80_OUT=../other-out compares two builds back to back.
 *
 * Baseline, 2026-11-11, M-series mac, 1,100 cloned matches (20 real ones),
 * warm median of 6, ms, before -> after the per-source derive cache
 * (report/derive/sourceMemo.ts) and the offscreen-row containment:
 *   other top tab -> matches (small round)   587 -> 106   (100 matches: 446 -> 34)
 *   other top tab -> matches (large match)  1441 -> 124   (100 matches: 1266 -> 44)
 *   shuffle round already seen               415 -> 33
 *   AI view, re-entry                   727 / 2209 -> 33 / 37
 *   AI view, first entry                744 / 2239 -> 660 / 1841  (analysis-layer cost, not cached)
 *   list filter win -> all                   115 -> 83    (100 matches: 23 -> 22)
 *   open another match (settled)       1995 / 2313 -> 861 / 2214
 */
import { _electron as electron } from "@playwright/test";
import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

if (process.argv[2] === "--make-lib") {
  const [src, out, nArg] = process.argv.slice(3);
  if (!src || !out || !nArg) throw new Error("--make-lib <src lib> <userData> <N>");
  const mdir = join(out, "matches");
  mkdirSync(mdir, { recursive: true });
  const metas = readFileSync(join(src, "_index.ndjson"), "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, number | string>)
    .sort((a, b) => Number(b["startTime"]) - Number(a["startTime"]));
  const base = Number(metas[0]!["startTime"]);
  const STEP_MS = 2.6 * 3600 * 1000; // about nine matches a day
  const lines: string[] = [];
  for (let i = 0; i < Number(nArg); i++) {
    const m = { ...metas[i % metas.length]! };
    const srcDir = join(src, String(m["id"]));
    const id = (0xa0000000 + i).toString(16);
    const dur = Number(m["endTime"]) - Number(m["startTime"]);
    m["id"] = id;
    m["startTime"] = base - i * STEP_MS;
    m["endTime"] = Number(m["startTime"]) + dur;
    m["storedAt"] = Number(m["endTime"]) + 60_000;
    const d = join(mdir, id);
    mkdirSync(d, { recursive: true });
    for (const f of ["match.json", "rounds.idx.json"])
      if (existsSync(join(srcDir, f)))
        execFileSync("cp", ["-c", "-p", join(srcDir, f), join(d, f)]);
    writeFileSync(join(d, "meta.json"), JSON.stringify(m, null, 2));
    lines.push(JSON.stringify(m));
  }
  writeFileSync(join(mdir, "_index.ndjson"), lines.join("\n") + "\n");
  console.log(`built ${nArg} matches in ${mdir}`);
  process.exit(0);
}

const [userData, outPath, repsArg, rowsArg] = process.argv.slice(2);
if (!userData || !outPath) throw new Error("usage: <userData> <out.json> [reps] [rows]");
const REPS = Number(repsArg ?? 7);
const ROWS = (rowsArg ?? "0,1").split(",").map(Number);
const MAIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env["T80_OUT"] ?? "../out", "main/index.js",
);

const t0 = Date.now();
const app = await electron.launch({
  args: [MAIN],
  env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
});
const page = await app.firstWindow();
await page.waitForSelector("[data-testid=match-list] li:not(.mlr-group)", {
  timeout: 120_000,
});
const firstRowMs = Date.now() - t0;
await page.waitForSelector(".rpt-match", { timeout: 120_000 });
const firstReportMs = Date.now() - t0;

/** In-page stopwatch: run `act`, poll `done` each frame, stop two frames after
 * it first holds (so the synchronous render, layout and paint are inside). */
await page.evaluate(`window.__sw = (act, done) => new Promise((res, rej) => {
  const doneFn = new Function('return (' + done + ');');
  const start = performance.now();
  let lastBusy = start, doneAt = null, prev = start;
  const mo = new MutationObserver(() => { lastBusy = performance.now(); });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  try { new Function(act)(); } catch (e) { rej(e); return; }
  function tick() {
    const now = performance.now();
    if (now - prev > 50) lastBusy = now;
    prev = now;
    if (now - start > 120000) return rej(new Error('timeout'));
    if (doneAt === null && doneFn()) { doneAt = -1; requestAnimationFrame(() => requestAnimationFrame(() => { doneAt = performance.now(); })); }
    if (doneAt > 0 && now - lastBusy > 300 && now - doneAt > 300) { mo.disconnect(); return res([doneAt - start, Math.max(doneAt, lastBusy) - start]); }
    requestAnimationFrame(tick);
  }
  tick();
});`);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
const PROFILE = process.env["T80_PROFILE"] === "1";
const profiles: Record<string, Array<[string, number]>> = {};
const profiled = new Map<string, number>();
const sw = (act: string, done: string): Promise<[number, number]> =>
  page.evaluate(
    ([a, d]) =>
      (
        window as unknown as {
          __sw: (a: string, d: string) => Promise<[number, number]>;
        }
      ).__sw(a!, d!),
    [act, done],
  );

const topTab = (label: string) =>
  `[...document.querySelectorAll('.app-view-tabs button')].find(b=>b.textContent==='${label}').click()`;
const reportTab = (label: string) =>
  `[...document.querySelectorAll('.rpt-head-tabs button')].find(b=>b.textContent==='${label}').click()`;
const reportTabDone = (label: string) =>
  `!![...document.querySelectorAll('.rpt-head-tabs button')].find(b=>b.textContent==='${label}'&&b.className==='active')`;
const row = (i: number) =>
  `document.querySelectorAll('[data-testid=match-list] li:not(.mlr-group):not(.loading-more)')[${i}]`;
const reportUp = `!!document.querySelector('.rpt-match') && !document.querySelector('.app-main > .empty-state')`;
const matchesUp = `!!document.querySelector('[data-testid=match-list] li:not(.mlr-group)') && ${reportUp}`;

const samples: Record<string, number[]> = {};
const settled: Record<string, number[]> = {};
const rec = async (name: string, act: string, done: string) => {
  // Profile the second occurrence (the first warm one) of every switch.
  const seen = (profiled.get(name) ?? 0) + 1;
  profiled.set(name, seen);
  const prof = PROFILE && seen === 2;
  if (prof) await cdp.send("Profiler.start");
  const [ms, st] = await sw(act, done);
  if (prof) {
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map<number, number>();
    const dts = profile.timeDeltas ?? [];
    (profile.samples ?? []).forEach((id, i) =>
      self.set(id, (self.get(id) ?? 0) + (dts[i] ?? 0) / 1000),
    );
    const byFn = new Map<string, number>();
    for (const n of profile.nodes) {
      const t = self.get(n.id) ?? 0;
      if (!t) continue;
      const k = n.callFrame.functionName || "(anon)";
      byFn.set(k, (byFn.get(k) ?? 0) + t);
    }
    profiles[name] = [...byFn].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => [k, Math.round(v)]);
    writeFileSync(outPath.replace(/\.json$/, "") + "." + encodeURIComponent(name).replace(/%/g, "") + ".cpuprofile", JSON.stringify(profile));
  }
  (samples[name] ??= []).push(Math.round(ms * 10) / 10);
  (settled[name] ??= []).push(Math.round(st * 10) / 10);
};

// Switches measured while the meta backfill is still paging in (first seconds).
const duringBackfill = await page.evaluate(
  () => !!document.querySelector(".loading-more"),
);
if (duringBackfill) {
  await rec(
    "backfill:matches→stats",
    topTab("战绩"),
    `!!document.querySelector('[data-testid=stats-dashboard]')`,
  );
  await rec("backfill:stats→matches", topTab("对局"), matchesUp);
}
await page.waitForFunction(
  () => !document.querySelector(".loading-more"),
  null,
  {
    timeout: 120_000,
  },
);
const backfillDoneMs = Date.now() - t0;
const rowCount = await page.evaluate(
  () =>
    document.querySelectorAll("[data-testid=match-list] li:not(.mlr-group)")
      .length,
);
const domNodes = () =>
  page.evaluate(() => document.querySelectorAll("*").length);
const nodesMatches = await domNodes();

for (let r = 0; r < REPS; r++) {
  for (const i of ROWS) {
    await rec(
      `select row ${i}`,
      `${row(i)}.click()`,
      `${row(i)}.className==='sel' && ${reportUp}`,
    );
    const isShuffle = await page.evaluate(
      () => !!document.querySelector(".rpt-shuffle"),
    );
    if (isShuffle) {
      await rec(
        `row ${i}: round 1→2`,
        `document.querySelectorAll('.rpt-shuffle-seq [role=tab]')[1].click()`,
        `document.querySelectorAll('.rpt-shuffle-seq [role=tab]')[1].getAttribute('aria-selected')==='true' && ${reportUp}`,
      );
      await rec(
        `row ${i}: round 2→1`,
        `document.querySelectorAll('.rpt-shuffle-seq [role=tab]')[0].click()`,
        `document.querySelectorAll('.rpt-shuffle-seq [role=tab]')[0].getAttribute('aria-selected')==='true' && ${reportUp}`,
      );
    }
    for (const [from, to, tag] of [
      ["战报", "回放", ""],
      ["回放", "事件", ""],
      ["事件", "AI 分析", " (first entry)"],
      ["AI 分析", "战报", ""],
      ["战报", "AI 分析", " (re-entry)"],
      ["AI 分析", "战报", " (2)"],
    ] as const)
      await rec(`row ${i}: ${from}→${to}${tag}`, reportTab(to), reportTabDone(to));
    await rec(
      `row ${i}: matches→stats`,
      topTab("战绩"),
      `!!document.querySelector('[data-testid=stats-dashboard]')`,
    );
    await rec(`row ${i}: stats→matches`, topTab("对局"), matchesUp);
    await rec(
      `row ${i}: matches→settings`,
      topTab("设置"),
      `!!document.querySelector('[data-testid=settings-panel]')`,
    );
    await rec(`row ${i}: settings→matches`, topTab("对局"), matchesUp);
    await rec(
      `row ${i}: matches→dev`,
      topTab("开发者"),
      `!!document.querySelector('.dev-wb')`,
    );
    await rec(`row ${i}: dev→matches`, topTab("对局"), matchesUp);
    await rec(
      `row ${i}: filter all→win`,
      `document.querySelectorAll('.mlf-seg button')[1].click()`,
      `document.querySelectorAll('.mlf-seg button')[1].className==='active'`,
    );
    await rec(
      `row ${i}: filter win→all`,
      `document.querySelectorAll('.mlf-seg button')[0].click()`,
      `document.querySelectorAll('.mlf-seg button')[0].className==='active'`,
    );
  }
}

const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const summary = Object.fromEntries(
  Object.entries(samples).map(([k, v]) => [
    k,
    {
      first: v[0],
      warmMedian: v.length > 1 ? med(v.slice(1)) : null,
      settledFirst: settled[k]![0],
      settledWarmMedian: v.length > 1 ? med(settled[k]!.slice(1)) : null,
      n: v.length,
      all: v,
      settledAll: settled[k],
    },
  ]),
);
const out = { userData, rowCount, firstRowMs, firstReportMs, backfillDoneMs, nodesMatches, summary, profiles };
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`rows=${rowCount} firstRow=${firstRowMs} firstReport=${firstReportMs} backfillDone=${backfillDoneMs} nodes=${nodesMatches}`);
for (const [k, v] of Object.entries(summary))
  console.log(`${k.padEnd(34)} first=${String(v.first).padStart(7)} warm=${String(v.warmMedian).padStart(7)} | settled first=${String(v.settledFirst).padStart(7)} warm=${String(v.settledWarmMedian).padStart(7)} n=${v.n}`);
for (const [k, v] of Object.entries(profiles))
  console.log(`\n[profile] ${k}\n  ` + v.map(([f, t]) => `${t}ms ${f}`).join("\n  "));
await app.close();
