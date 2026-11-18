/* Round-revisit probe (T199): on the BUILT app, does a shuffle round that was
 * filled once come back in one pass, and one whose derive results were
 * evicted fill in steps again? The staged fill's completed mark
 * (report/derive/sourceMemo.ts) decides it; jsdom tests pin the rule
 * (test/stagedFill.test.tsx), this reads it off the production bundle.
 *
 *   npx electron-vite build
 *   npx tsx scripts/pageSwitchProbe.mts --make-lib <src lib> <userData> <N>
 *   npx tsx scripts/roundRevisitProbe.mts <userData> <out.json> [row=0] [launches=3]
 *
 * `row` must be a Solo Shuffle with at least three rounds. Per launch: open
 * the row, then rounds 2, 3, 2, 1. The derive cache keeps two sources, so:
 *   3 -> 2   round 2 is still kept: the first frame after the click is the
 *            finished report (data-fill="done"), no placeholder ever shown;
 *   2 -> 1   round 1 was evicted by round 3: the first frame is the frame
 *            with placeholders, and the fill runs in steps.
 * Exit code 1 when either reads otherwise. Each switch also records the time
 * to the finished report and the longest main-thread task after the click.
 * NEVER point it at a real library: the app writes sidecars into what it opens.
 *
 * 2026-11-18, M-series mac, 20 real matches, row 0 (6 rounds), 3 launches
 * (first frame per launch; ms to the finished report and longest task,
 * median):
 *   1 -> 2  first visit      shell,shell,shell   485   127
 *   2 -> 3  first visit      shell,shell,shell   171     0
 *   3 -> 2  kept             done,done,done       10     0   no placeholder
 *   2 -> 1  evicted          0,0,0               205    94   placeholders
 */
import { _electron as electron } from "@playwright/test";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const [userData, outPath, rowArg, launchesArg] = process.argv.slice(2);
if (!userData || !outPath)
  throw new Error("usage: <userData> <out.json> [row] [launches]");
const ROW = Number(rowArg ?? 0);
const LAUNCHES = Number(launchesArg ?? 3);
const MAIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env["T93_OUT"] ?? "../out",
  "main/index.js",
);

type Switch = {
  /** data-fill of .rpt-match on the first frame after the click; "shell"
   * while the round is still being read */
  firstFrame: string;
  /** a placeholder section was on screen at any frame of the switch */
  placeholderSeen: boolean;
  doneMs: number;
  longestTaskMs: number;
};
/** the visits after the row's own open: [round index, kept?] */
const VISITS: ReadonlyArray<readonly [number, boolean | null]> = [
  [1, null],
  [2, null],
  [1, true],
  [0, false],
];
const all: Array<{ launch: number; visits: Switch[] }> = [];
const failures: string[] = [];

for (let l = 0; l < LAUNCHES; l++) {
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-testid=match-list] li:not(.mlr-group)", {
    timeout: 120_000,
  });
  await page.waitForFunction(
    () => !document.querySelector(".loading-more"),
    null,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(1500);
  // A string, not a function: tsx's keepNames helper does not exist in the page.
  await page.evaluate(`(() => {
    const li = document.querySelectorAll("[data-testid=match-list] li:not(.mlr-group):not(.loading-more)")[${ROW}];
    if (!li) throw new Error("no row ${ROW}");
    if (li.className !== "sel") li.click();
  })()`);
  await page.waitForSelector(".rpt-shuffle .rpt-match[data-fill=done]", {
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
  const visits: Switch[] = [];
  for (const [round, kept] of VISITS) {
    const v = (await page.evaluate(`new Promise((res, rej) => {
      const tabs = document.querySelectorAll(".rpt-shuffle-seq [role=tab]");
      if (tabs.length < 3) return rej(new Error("row ${ROW} has " + tabs.length + " rounds"));
      let longest = 0;
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
      });
      po.observe({ entryTypes: ["longtask"] });
      const start = performance.now();
      let firstFrame = null, placeholderSeen = false, doneAt = null;
      tabs[${round}].click();
      function tick() {
        const now = performance.now();
        const el = document.querySelector(".rpt-shuffle .rpt-match");
        const fill = el ? el.dataset.fill : "shell";
        if (firstFrame === null) firstFrame = fill;
        if (!el || el.querySelector(".rpt-skel")) placeholderSeen = true;
        if (fill === "done" && doneAt === null) doneAt = now - start;
        // 400 ms past the finished report: late long tasks are in
        if (doneAt !== null && now - start - doneAt > 400) {
          po.disconnect();
          return res({ firstFrame, placeholderSeen, doneMs: doneAt, longestTaskMs: longest });
        }
        if (now - start > 120000) return rej(new Error("timeout round ${round}"));
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })`)) as Switch;
    visits.push(v);
    const onePass = v.firstFrame === "done" && !v.placeholderSeen;
    if (kept === true && !onePass)
      failures.push(
        `launch ${l}: round ${round + 1} was kept and did not come back in one pass (${JSON.stringify(v)})`,
      );
    if (kept === false && onePass)
      failures.push(
        `launch ${l}: round ${round + 1} was evicted and rendered in one pass (${JSON.stringify(v)})`,
      );
    await page.waitForTimeout(600);
  }
  all.push({ launch: l, visits });
  await app.close();
}

const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const summary = VISITS.map(([round, kept], i) => ({
  to: `round ${round + 1}`,
  expected:
    kept === null ? "first visit" : kept ? "kept: one pass" : "evicted: steps",
  firstFrame: all.map((x) => x.visits[i]!.firstFrame).join(","),
  placeholderSeen: all.map((x) => x.visits[i]!.placeholderSeen).join(","),
  doneMs: Math.round(med(all.map((x) => x.visits[i]!.doneMs))),
  longestTaskMs: Math.round(med(all.map((x) => x.visits[i]!.longestTaskMs))),
}));
writeFileSync(
  outPath,
  JSON.stringify({ userData, row: ROW, launches: LAUNCHES, summary, all, failures }, null, 1),
);
for (const s of summary) console.log(JSON.stringify(s));
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
