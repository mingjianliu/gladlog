/**
 * troughFactScan.ts — F15 (fact1215 R1, user ruling 2026-10-16: every printed
 * "lowest / low / team min" is the true minimum, same-millisecond
 * intermediate lines included). Re-derives the minimum from the parsed log
 * and checks the printed number, over an acceptanceCapture `--context-dir`
 * capture (`<dir>/s<k>/context/`; file layout as `pressFactScan.ts`).
 *
 * Read straight from the parsed advanced-log lines (every line whose actor
 * is the unit, max HP > 0, current HP > 0, rounded to a whole percent — a
 * living 0 % counts — before the unit's death, its death second's live lines
 * included since the 2026-10-20 ruling), never through `hpTroughInWindow`:
 *
 *  - `dmgSpikeLow`: `M:SS–M:SS  [DMG SPIKE]   <pid>(…) … low N% @M:SS` — no
 *    line of the unit inside the window's displayed seconds
 *    `[from, to + 1)` may round below N;
 *  - `killWindowTeamMin`: `[KILL WINDOW] M:SS–M:SS … team min HP N%` — no
 *    friendly line strictly inside the window's interior
 *    `[from + 1, to)` (certainly inside the span, whose ends are fractional)
 *    may round below N.
 *
 *   npx tsx packages/eval/scripts/troughFactScan.ts <captureDir> [--examples N] [--archive-dir <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: troughFactScan.ts <captureDir> [--examples N] [--archive-dir <dir>]");
  process.exit(2);
}
const exIdx = process.argv.indexOf("--examples");
// relative manifest paths are written as given: resolve them the way
// acceptanceCapture.ts did (`--archive-dir`)
const adIdx = process.argv.indexOf("--archive-dir");
const ARCHIVE_DIR = adIdx > 0 ? (process.argv[adIdx + 1] ?? "") : "";
/** contexts that could not be mapped back to a parsed round — any one fails
 * the run (codex review 20-F15-01: a silent skip read as "0 missing") */
const unmapped: string[] = [];
const EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 5;

const secOf = (m: string, s: string) => Number(m) * 60 + Number(s);
type Check =
  | "dmgSpikeLow"
  | "killWindowTeamMin"
  | "slackTeamMin"
  | "kickLowInSpan"
  | "consequenceLow"
  | "cdPriorBottom";
const checked = new Map<Check, number>();
const bad = new Map<Check, string[]>();
const count = (c: Check) => checked.set(c, (checked.get(c) ?? 0) + 1);
const fail = (c: Check, s: string) => {
  const l = bad.get(c) ?? [];
  l.push(s);
  bad.set(c, l);
};

function parseFile(path: string): GladMatch[] {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  return items;
}

/** The unit's own HP lines in [fromMs, toMs), before its death (user ruling
 * 2026-10-20: the death second's live lines count — the `[STATE]` tick of
 * that second prints `dead`, the unit was alive until the death record; the
 * last death record, as `isDeadAtRenderSecond` reads it). A line at 0 HP is
 * no live reading. */
function minPct(
  u: any,
  start: number,
  fromMs: number,
  toMs: number,
): { pct: number; ms: number } | null {
  const deaths = ((u.deathRecords ?? []) as any[]).map((d) => d.timestamp);
  const deathMs = deaths.length ? Math.max(...deaths) : Infinity;
  let best: { pct: number; ms: number } | null = null;
  for (const a of u.advancedActions ?? []) {
    const ts = a.logLine.timestamp;
    if (ts < fromMs || ts >= toMs || ts >= deathMs) continue;
    if (a.advancedActorId !== u.id || !(a.advancedActorMaxHp > 0)) continue;
    if (!(a.advancedActorCurrentHp > 0)) continue;
    const pct = Math.min(
      Math.round((a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100),
      100,
    );
    if (!best || pct < best.pct) best = { pct, ms: ts };
  }
  return best;
}

await ensureAnalysisData();
const files: Array<{
  shard: string;
  name: string;
  fileNo: number;
  round: number;
}> = [];
for (const shard of readdirSync(dir).filter((d) => /^s\d+$/.test(d))) {
  for (const name of readdirSync(join(dir, shard, "context"))) {
    const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
    if (m) files.push({ shard, name, fileNo: +m[1]!, round: +m[2]! });
  }
}
files.sort((a, b) =>
  a.shard === b.shard ? a.fileNo - b.fileNo : a.shard < b.shard ? -1 : 1,
);

const SPIKE =
  /^(\d+):(\d{2})–(\d+):(\d{2})\s+\[DMG SPIKE\]\s+(\d+)\(.*low (\d+)% @(\d+):(\d{2})/;
const KW = /\[KILL WINDOW\] (\d+):(\d{2})–(\d+):(\d{2}) .*team min HP (\d+)%/;
const SLACK =
  /^ {2}\[(SLACK|CONTESTED)\] (\d+):(\d{2})–(\d+):(\d{2}) \(\d+s, team min HP (\d+)%\)/;
const KICK_ROW = /type=kick-eaten t=\S+ units=\S+ facts=\{(.*)\}/;
// fact2 R1: `[CONSEQ] … for Ns → during it: <pid>(…) A% → low B% at M:SS`
const CONSEQ =
  /^(\d+):(\d{2}) {2}\[CONSEQ\] .* for (\d+)s → during it: (.*)$/;
const CONSEQ_LOW = /(\d+)\([^)]*\) \d+% → low (\d+)% at (\d+):(\d{2})/g;
// `[CD PRIOR] … median lowest-friendly HP of L% …; <pid>(…) fell below that
// at M:SS (N%) and bottomed at B% by M:SS`
const CD_PRIOR =
  /\[CD PRIOR\] .*HP of (\d+)% .*; (\d+)\([^)]*\) fell below that at (\d+):(\d{2}) \(\d+%\) and bottomed at (\d+)% by (\d+):(\d{2})/;

let cacheKey = "";
let cacheItems: GladMatch[] = [];
let contexts = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  // a per-line test below; this only skips contexts with neither family
  // (codex 20-F15-02: an anchored test on the flattened text skipped 6,213
  // of 9,443 lows)
  const findingsPath = join(dir, f.shard, "findings", f.name);
  let menu = "";
  try {
    menu = readFileSync(findingsPath, "utf8");
  } catch {
    menu = "";
  }
  if (
    !text.includes("[DMG SPIKE]") &&
    !text.includes("team min HP") &&
    !text.includes("[CONSEQ]") &&
    !text.includes("[CD PRIOR]") &&
    !menu.includes("type=kick-eaten")
  )
    continue;
  const [archive] = text.split("\n", 1);
  if (!archive) continue;
  const key = `${f.shard}:${archive}`;
  if (key !== cacheKey) {
    try {
      cacheItems = parseFile(
        archive.startsWith("/") ? archive : resolve(ARCHIVE_DIR, archive),
      );
    } catch {
      cacheItems = [];
    }
    cacheKey = key;
  }
  const item = cacheItems[f.round - 1];
  if (!item) {
    unmapped.push(`${f.shard}/${f.name} (${archive})`);
    continue;
  }
  let legacy: ReturnType<typeof toLegacyMatch>;
  try {
    legacy = toLegacyMatch({ ...item, rawLines: [] } as GladMatch);
  } catch {
    unmapped.push(`${f.shard}/${f.name} (toLegacyMatch threw)`);
    continue;
  }
  contexts++;
  const lines = text.split("\n");
  const byName = new Map(
    (Object.values(legacy.units ?? {}) as any[]).map((u) => [u.name, u]),
  );
  const pidUnit = new Map<string, any>();
  const friends: any[] = [];
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"[^>]*role="([^"]+)"/.exec(l);
    if (!u) continue;
    const unit = byName.get(u[2]!);
    if (!unit) continue;
    pidUnit.set(u[1]!, unit);
    if (u[3] !== "enemy") friends.push(unit);
  }
  const start = legacy.startTime;
  const where = `${f.shard}/${f.name}`;
  for (const l of lines) {
    const s = SPIKE.exec(l);
    if (s) {
      const unit = pidUnit.get(s[5]!);
      if (!unit) continue;
      count("dmgSpikeLow");
      const from = secOf(s[1]!, s[2]!);
      const to = secOf(s[3]!, s[4]!);
      const printed = Number(s[6]);
      const m = minPct(unit, start, start + from * 1000, start + (to + 1) * 1000);
      if (m && m.pct < printed)
        fail(
          "dmgSpikeLow",
          `${where} ${s[1]}:${s[2]}–${s[3]}:${s[4]} ${unit.name}: printed ${printed}%, log ${m.pct}% at +${((m.ms - start) / 1000).toFixed(3)}s`,
        );
    }
    const sl = SLACK.exec(l);
    if (sl) {
      count("slackTeamMin");
      const from = secOf(sl[2]!, sl[3]!);
      const to = secOf(sl[4]!, sl[5]!);
      const printed = Number(sl[6]);
      let low: { pct: number; ms: number; name: string } | null = null;
      for (const u of friends) {
        const m = minPct(u, start, start + from * 1000, start + to * 1000);
        if (m && (!low || m.pct < low.pct)) low = { ...m, name: u.name };
      }
      if (low && low.pct < printed)
        fail(
          "slackTeamMin",
          `${where} [${sl[1]}] ${sl[2]}:${sl[3]}–${sl[4]}:${sl[5]}: printed ${printed}%, log ${low.pct}% (${low.name})`,
        );
    }
    // [CONSEQ]: the span starts inside second t and lasts N s rounded, so
    // [t + 1, t + N − 0.5) is certainly inside it; no reading there may sit
    // below the printed low
    const cq = CONSEQ.exec(l);
    if (cq) {
      const t = secOf(cq[1]!, cq[2]!);
      const dur = Number(cq[3]);
      for (const m of cq[4]!.matchAll(CONSEQ_LOW)) {
        const unit = pidUnit.get(m[1]!);
        if (!unit) continue;
        count("consequenceLow");
        const printed = Number(m[2]);
        const low = minPct(unit, start, start + (t + 1) * 1000, start + (t + dur - 0.5) * 1000);
        if (low && low.pct < printed)
          fail(
            "consequenceLow",
            `${where} ${cq[1]}:${cq[2]} ${unit.name}: printed low ${printed}%, log ${low.pct}% at +${((low.ms - start) / 1000).toFixed(3)}s`,
          );
      }
    }
    // [CD PRIOR]: the dip runs from the last reading above the line before
    // the crossing second to the end of the second it bottomed in
    const cp = CD_PRIOR.exec(l);
    if (cp) {
      const unit = pidUnit.get(cp[2]!);
      if (unit) {
        count("cdPriorBottom");
        const line = Number(cp[1]);
        const cross = secOf(cp[3]!, cp[4]!);
        const printed = Number(cp[5]);
        const bottom = secOf(cp[6]!, cp[7]!);
        let dipFrom = start + cross * 1000;
        for (const a of (unit.advancedActions ?? []) as Array<{
          logLine: { timestamp: number };
          advancedActorId: string;
          advancedActorCurrentHp: number;
          advancedActorMaxHp: number;
        }>) {
          const ts = a.logLine.timestamp;
          if (ts >= start + cross * 1000) break;
          if (ts < start + (cross - 1) * 1000) continue;
          if (a.advancedActorId !== unit.id || !(a.advancedActorMaxHp > 0)) continue;
          const pct = Math.round((a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100);
          if (pct > line) dipFrom = ts + 1;
        }
        const low = minPct(unit, start, dipFrom, start + (Math.max(bottom, cross) + 1) * 1000);
        if (low && low.pct < printed)
          fail(
            "cdPriorBottom",
            `${where} ${cp[3]}:${cp[4]} ${unit.name}: printed bottomed ${printed}%, log ${low.pct}% at +${((low.ms - start) / 1000).toFixed(3)}s`,
          );
      }
    }
    const k = KW.exec(l);
    if (k) {
      count("killWindowTeamMin");
      const from = secOf(k[1]!, k[2]!);
      const to = secOf(k[3]!, k[4]!);
      const printed = Number(k[5]);
      let low: { pct: number; ms: number; name: string } | null = null;
      for (const u of friends) {
        const m = minPct(u, start, start + (from + 1) * 1000, start + to * 1000);
        if (m && (!low || m.pct < low.pct)) low = { ...m, name: u.name };
      }
      if (low && low.pct < printed)
        fail(
          "killWindowTeamMin",
          `${where} ${k[1]}:${k[2]}–${k[3]}:${k[4]}: printed ${printed}%, log ${low.pct}% (${low.name}) at +${((low.ms - start) / 1000).toFixed(3)}s`,
        );
    }
  }
  // kick-eaten ourLow / theirLow: a trough of the lockout's own span — no
  // reading from before the kick (user ruling 2026-10-17); the printed value
  // must not sit below every reading inside [kick, kick + lockout]
  for (const row of menu.split("\n")) {
    const km = KICK_ROW.exec(row);
    if (!km) continue;
    const facts = new Map(
      km[1]!.split(", ").map((kv: string) => {
        const i = kv.indexOf("=");
        return [kv.slice(0, i), kv.slice(i + 1)] as const;
      }),
    );
    const t = Number(facts.get("t"));
    const lock = Number(facts.get("lockout"));
    if (!Number.isFinite(t) || !Number.isFinite(lock)) continue;
    for (const side of ["our", "their"]) {
      const unitName = facts.get(`${side}LowUnit`);
      const pct = Number(facts.get(`${side}LowPct`));
      if (!unitName || !Number.isFinite(pct)) continue;
      const unit = byName.get(unitName);
      if (!unit) continue;
      count("kickLowInSpan");
      // `t` is printed to 0.1 s (fmtFactNum): ±50 ms covers its rounding
      const m = minPct(
        unit,
        start,
        start + Math.round((t - 0.05) * 1000),
        start + Math.round((t + lock + 0.05) * 1000) + 1,
      );
      if (m && pct < m.pct)
        fail(
          "kickLowInSpan",
          `${where} kick t=${t} ${side}Low ${unitName}: printed ${pct}%, lowest inside the lockout ${m.pct}%`,
        );
    }
  }
}

console.log(`contexts read: ${contexts}`);
for (const c of [
  "dmgSpikeLow",
  "killWindowTeamMin",
  "slackTeamMin",
  "kickLowInSpan",
  "consequenceLow",
  "cdPriorBottom",
] as Check[]) {
  const b = bad.get(c) ?? [];
  console.log(`${c}: lines ${checked.get(c) ?? 0}, below-printed ${b.length}`);
  for (const s of b.slice(0, EXAMPLES)) console.log(`    ${s}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
