/* Main-thread freeze probe for the report's heavy derives, on the BUILT app.
 *
 *   npx electron-vite build
 *   npx tsx scripts/pageSwitchProbe.mts --make-lib <src lib> <userData> <N>
 *   npx tsx scripts/derivePerfProbe.mts <userData> <out.json> [rows=4,2,0] [launches=3]
 *   DERIVE_OUT=../other-out ...   (another build, for a before/after pair)
 *
 * Every launch opens each listed row once (a first computation: nothing is
 * cached for it yet), then per row:
 *   open     click the row -> report quiet (no long task, no DOM mutation
 *            for 1.5 s); `block` is the longest main-thread task in between
 *   ai       first click on 「AI 分析」 -> its analyze button usable;
 *            `block` as above (the freeze the Windows field run measured at
 *            6.8 s on a 778 s 3v3, 2026-11-14)
 *   aiAgain  「战报」 report tab and back to 「AI 分析」: the re-entry
 *   back     top tab 「战绩」 then 「对局」: until the match list is up
 * NEVER point it at a real library: the app writes sidecars into what it opens.
 */
import { _electron as electron } from "@playwright/test";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const [userData, outPath, rowsArg, launchesArg] = process.argv.slice(2);
if (!userData || !outPath)
  throw new Error("usage: <userData> <out.json> [rows] [launches]");
const ROWS = (rowsArg ?? "4,2,0").split(",").map(Number);
const LAUNCHES = Number(launchesArg ?? 3);
const MAIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env["DERIVE_OUT"] ?? "../out",
  "main/index.js",
);

type Reading = { ms: number; blockMs: number; longSumMs: number };
const out: Array<{ launch: number; row: number; step: string } & Reading> = [];

/** In-page: run `act`, then wait until `done` holds and the page has been
 * quiet (no long task, no DOM mutation) for `quietMs`. Returns the time until
 * `done` first held and the long tasks seen from the click to the end. */
const SW = `window.__sw = (act, done, quietMs) => new Promise((res, rej) => {
  const doneFn = new Function('return (' + done + ');');
  const start = performance.now();
  let lastBusy = start, doneAt = null, block = 0, sum = 0;
  const po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.startTime + e.duration < start) continue;
      block = Math.max(block, e.duration); sum += e.duration;
      lastBusy = Math.max(lastBusy, e.startTime + e.duration);
    }
  });
  po.observe({ type: 'longtask', buffered: false });
  const mo = new MutationObserver(() => { lastBusy = performance.now(); });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  try { new Function(act)(); } catch (e) { rej(e); return; }
  function tick() {
    const now = performance.now();
    if (now - start > 180000) return rej(new Error('timeout: ' + done));
    if (doneAt === null && doneFn()) doneAt = now;
    if (doneAt !== null && now - lastBusy > quietMs && now - doneAt > quietMs) {
      po.disconnect(); mo.disconnect();
      return res({ ms: doneAt - start, blockMs: block, longSumMs: sum });
    }
    setTimeout(tick, 16);
  }
  tick();
});`;

const topTab = (label: string) =>
  `[...document.querySelectorAll('.app-view-tabs button')].find(b=>b.textContent==='${label}').click()`;
const reportTab = (label: string) =>
  `[...document.querySelectorAll('.rpt-head-tabs button')].find(b=>b.textContent==='${label}').click()`;
const AI_READY = `(() => { const b = document.querySelector('.rpt-ai-primary'); return !!b && !b.disabled && b.textContent !== '正在准备分析数据…'; })()`;

for (let l = 0; l < LAUNCHES; l++) {
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.text().includes("derive-worker")) console.log(`  [page] ${m.text()}`);
  });
  await page.waitForSelector("[data-testid=match-list] li:not(.mlr-group)", {
    timeout: 120_000,
  });
  await page.evaluate(SW);
  const sw = (act: string, done: string, quietMs = 1500): Promise<Reading> =>
    page.evaluate(
      ([a, d, q]) =>
        (
          window as unknown as {
            __sw: (a: string, d: string, q: number) => Promise<Reading>;
          }
        ).__sw(a as string, d as string, q as number),
      [act, done, quietMs] as const,
    );
  // let the auto-opened first report settle before measuring anything
  await sw("", "!!document.querySelector('.rpt-match')", 2000);
  for (const row of ROWS) {
    const click = `document.querySelectorAll('[data-testid=match-list] li:not(.mlr-group)')[${row}].click()`;
    const push = (step: string, r: Reading) => {
      out.push({ launch: l, row, step, ...r });
      console.log(
        `launch ${l} row ${row} ${step.padEnd(8)} ${r.ms.toFixed(0).padStart(6)} ms  block ${r.blockMs.toFixed(0).padStart(5)}  long-sum ${r.longSumMs.toFixed(0).padStart(5)}`,
      );
    };
    // the report on screen is the previous row's until the new one mounts
    await page.evaluate(() =>
      document.querySelectorAll(".rpt-match").forEach((e) => {
        (e as HTMLElement).dataset["probeOld"] = "1";
      }),
    );
    push(
      "open",
      await sw(
        click,
        "!!document.querySelector('.rpt-match:not([data-probe-old])')",
      ),
    );
    push("ai", await sw(reportTab("AI 分析"), AI_READY));
    await sw(reportTab("战报"), "true", 800);
    push("aiAgain", await sw(reportTab("AI 分析"), AI_READY));
    await sw(topTab("战绩"), "true", 800);
    push(
      "back",
      await sw(
        topTab("对局"),
        "!!document.querySelector('.app-layout [data-testid=match-list]')",
        800,
      ),
    );
  }
  // the renderer process (its workers included), after every row was opened
  const metrics = (await app.evaluate(({ app: a }) =>
    a.getAppMetrics().map((m) => ({
      type: m.type,
      kb: m.memory.workingSetSize,
      peakKb: m.memory.peakWorkingSetSize,
    })),
  )) as Array<{ type: string; kb: number; peakKb: number }>;
  for (const m of metrics.filter((x) => x.type === "Tab")) {
    out.push({
      launch: l,
      row: -1,
      step: "rendererMB",
      ms: m.kb / 1024,
      blockMs: m.peakKb / 1024,
      longSumMs: 0,
    });
    console.log(
      `launch ${l} renderer ${(m.kb / 1024).toFixed(0)} MB (peak ${(m.peakKb / 1024).toFixed(0)} MB)`,
    );
  }
  await app.close();
}
writeFileSync(outPath, JSON.stringify(out, null, 2));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
console.log("\nmedian over launches (ms / block ms):");
for (const row of ROWS)
  for (const step of ["open", "ai", "aiAgain", "back"]) {
    const rs = out.filter((r) => r.row === row && r.step === step);
    console.log(
      `row ${row} ${step.padEnd(8)} ${median(rs.map((r) => r.ms))
        .toFixed(0)
        .padStart(6)} / ${median(rs.map((r) => r.blockMs))
        .toFixed(0)
        .padStart(5)}`,
    );
  }
