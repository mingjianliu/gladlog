/**
 * CLI: the fastest a major cooldown ever comes back, per (spell, spec) — the
 * "earliest ready" bound of the tri-state cooldown ledger (GH #106 step 3).
 *
 * A cooldown that combat events shorten (Anger Management: rage spent → Avatar
 * / Colossus Smash / Recklessness back sooner; Cold Snap resetting Ice Block;
 * Doom Winds procs) is never exactly "N s left": the static, talent-resolved
 * number is the LATEST it can be back, and the corpus says how much sooner it
 * can be. For each unit's ledger entry the recast ratio is
 *   gap(cast i → cast i + cap) / that unit's modelled cooldown
 * (cap = charges, so one ratio = one charge coming back). Files are split in
 * two halves (file index parity): the floor is learnt on one half and checked
 * on the other. It is the HIGHEST of the FLOOR_QS quantiles of the training
 * ratios that the hold-out half breaks at most MAX_HOLDOUT_BELOW of the time
 * (a fixed p2 left borderline cells — Arms Bladestorm at 3.1–3.3 % — with no
 * range at all, and the ledger then called 97 % of their real presses "on
 * cooldown"). A quantile at or above MAX_FLOOR_RATIO is skipped rather than
 * ending the search, and the ladder runs down to the training minimum: a
 * cooldown the static model gets right 97 % of the time (Bestial Wrath —
 * 2–3 % of recasts before 30 s, so its p2 IS 30 s) has no useful p2 floor but
 * a real p1 / p0.5 one, and a fixed "p2 < 0.95" dropped it with those presses
 * still called "certainly on cooldown". The hold-out check above only rejects
 * a floor that is too HIGH, so two more conditions guard against one that is
 * spuriously LOW (codex astra review: 99 exact recasts plus one mislogged
 * 0.1× one emitted a 0.1× floor with zero hold-out shortening):
 *   - replication: on EACH half ≥ MIN_STATIC_BREAK of the recasts, and at
 *     least MIN_BREAK_COUNT of them, beat the modelled cooldown;
 *   - depth: some hold-out recast lands within DEPTH_SUPPORT of the floor.
 * Plus ≥ MIN_N ratios on each half.
 *
 * Usage:
 *   tsx packages/eval/scripts/cdRecastFloorScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt \
 *     [--every 10] [--offset 0] [--out <json>]   (default: print the report only)
 *   --dump <json> saves the per-cell ratios after the corpus pass; --from-dump
 *   <json> re-applies this selection rule to a saved pass without reading the
 *   corpus (minutes instead of ~1.5 h when only the rule changes).
 *   --offset picks manifest index ≡ offset (mod every), so an evaluation on a
 *   disjoint file set stays out-of-sample.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { extractMajorCooldowns } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, renameSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";

// 0 = the training minimum — still validated on the hold-out like the rest
// (Life Cocoon failed the hold-out at p0.5 by 3.2 % and had no floor at all)
const FLOOR_QS = [0.02, 0.01, 0.005, 0.0025, 0];
// 50, not 30: at n = 30 every FLOOR_QS quantile is the sample minimum and a
// single hold-out ratio under it is already 3.3 % (agy review, GH #106)
const MIN_N = 50;
const MAX_FLOOR_RATIO = 0.99;
const MIN_STATIC_BREAK = 0.01;
const MIN_BREAK_COUNT = 3;
const DEPTH_SUPPORT = 0.1;
const MAX_HOLDOUT_BELOW = 0.03;

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    manifest: "",
    every: 10,
    offset: 0,
    out: "",
    dump: "",
    fromDump: "",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--offset") out.offset = Number(a[++i]);
    else if (a[i] === "--out") out.out = a[++i] ?? "";
    else if (a[i] === "--dump") out.dump = a[++i] ?? "";
    else if (a[i] === "--from-dump") out.fromDump = a[++i] ?? "";
  }
  if (
    (!out.manifest && !out.fromDump) ||
    !Number.isInteger(out.every) ||
    out.every < 1 ||
    // an offset outside [0, every) would silently select no file
    !Number.isInteger(out.offset) ||
    out.offset < 0 ||
    out.offset >= out.every
  ) {
    console.error(
      "usage: cdRecastFloorScan.ts (--manifest <path> [--every N] [--offset 0..N-1] [--dump <json>] | --from-dump <json>) [--out <json>]",
    );
    process.exit(1);
  }
  return out;
}

const quantile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

const args = parseArgs();

type Cell = { name: string; ratios: [number[], number[]] };
type Dump = {
  manifest: string;
  every: number;
  offset: number;
  filesRead: number;
  cells: [string, Cell][];
};
const cells = new Map<string, Cell>();
let read = 0;
let source = {
  manifest: args.manifest.split("/").pop() ?? "",
  every: args.every,
  offset: args.offset,
};
if (args.fromDump) {
  const dump = JSON.parse(readFileSync(args.fromDump, "utf8")) as Dump;
  for (const [key, cell] of dump.cells) cells.set(key, cell);
  read = dump.filesRead;
  source = { manifest: dump.manifest, every: dump.every, offset: dump.offset };
} else {
  await ensureAnalysisData();
  const files = readFileSync(args.manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % args.every === args.offset);
  for (const [fi, f] of files.entries()) {
    const half = fi % 2;
    const parser = new GladLogParser();
    const items: GladMatch[] = [];
    parser.on("match", (m) => items.push(m));
    parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
    let text: string;
    try {
      const raw = readFileSync(f);
      text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    read++;
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
    for (const m of items) {
      let legacy: ReturnType<typeof toLegacyMatch>;
      try {
        legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
      } catch {
        continue;
      }
      for (const u of Object.values(legacy.units)) {
        if (!u.info) continue;
        let cds: ReturnType<typeof extractMajorCooldowns> = [];
        try {
          cds = extractMajorCooldowns(u, legacy);
        } catch {
          continue;
        }
        for (const cd of cds) {
          if (cd.isProcOnly || !(cd.cooldownSeconds > 0)) continue;
          // a per-cast override (Guardian Angel's saved branch) is a different
          // cooldown for that one cast — keep the ratio on the modelled one only
          if (cd.casts.some((c) => c.cooldownSecondsOverride !== undefined))
            continue;
          const cap = Math.max(1, cd.charges ?? 1);
          const ts = cd.casts.map((c) => c.timeSeconds).sort((a, b) => a - b);
          const key = `${cd.spellId}|${u.spec}`;
          const cell = cells.get(key) ?? {
            name: cd.spellName,
            ratios: [[], []],
          };
          for (let i = 0; i + cap < ts.length; i++)
            cell.ratios[half]!.push(
              (ts[i + cap]! - ts[i]!) / cd.cooldownSeconds,
            );
          cells.set(key, cell);
        }
      }
    }
  }
  if (args.dump) {
    const dump: Dump = { ...source, filesRead: read, cells: [...cells] };
    const tmp = `${args.dump}.tmp`;
    writeFileSync(tmp, JSON.stringify(dump));
    renameSync(tmp, args.dump);
    console.log(`dumped ${cells.size} cells to ${args.dump}`);
  }
}

const rows = [...cells]
  .map(([key, c]) => {
    const [train, hold] = c.ratios.map((r) => [...r].sort((a, b) => a - b));
    const below = (f: number) =>
      hold!.length ? hold!.filter((r) => r < f).length / hold!.length : 1;
    // replication: the static model has to break on BOTH halves
    const breaks = (r: number[]) => r.filter((x) => x < MAX_FLOOR_RATIO).length;
    const breakShare = (r: number[]) => (r.length ? breaks(r) / r.length : 0);
    const replicated =
      breakShare(train!) >= MIN_STATIC_BREAK &&
      breakShare(hold!) >= MIN_STATIC_BREAK &&
      breaks(train!) >= MIN_BREAK_COUNT &&
      breaks(hold!) >= MIN_BREAK_COUNT;
    let floor = 1;
    let holdBelow = 1;
    let q = FLOOR_QS[0]!;
    // the floor is validated AS EMITTED (rounded to 3 decimals) and the
    // violation rate compared at full precision (codex astra review: an
    // unrounded check accepted a rounded floor 100 % of the hold-out broke,
    // and 10/329 = 3.04 % rounded to 3 % and passed)
    for (const cand of FLOOR_QS) {
      if (!train!.length) break;
      q = cand;
      floor = Math.round(quantile(train!, cand) * 1000) / 1000;
      if (floor >= MAX_FLOOR_RATIO) continue;
      holdBelow = below(floor);
      if (holdBelow <= MAX_HOLDOUT_BELOW) break;
    }
    // depth: the hold-out half itself gets that far down (a floor only the
    // training half's outlier reaches is not evidence)
    const depthSupported =
      hold!.length > 0 && hold![0]! <= floor + DEPTH_SUPPORT;
    return {
      quantile: q,
      key,
      name: c.name,
      nTrain: train!.length,
      nHoldout: hold!.length,
      floorRatio: floor,
      staticBreak: breakShare(train!),
      holdoutStaticBreak: breakShare(hold!),
      replicated,
      depthSupported,
      holdoutBelowExact: holdBelow,
      holdoutBelow: Math.round(holdBelow * 1000) / 1000,
    };
  })
  .sort((a, b) => a.floorRatio - b.floorRatio);

const kept = rows.filter(
  (r) =>
    r.nTrain >= MIN_N &&
    r.nHoldout >= MIN_N &&
    r.floorRatio < MAX_FLOOR_RATIO &&
    r.replicated &&
    r.depthSupported &&
    r.holdoutBelowExact <= MAX_HOLDOUT_BELOW,
);
console.log(
  `files read ${read}, cells ${rows.length}, kept ${kept.length} (floor < ${MAX_FLOOR_RATIO}, on each half ≥ ${MIN_STATIC_BREAK * 100} % and ≥ ${MIN_BREAK_COUNT} recasts under it, a hold-out recast within ${DEPTH_SUPPORT} of the floor, n ≥ ${MIN_N} per half, hold-out below floor ≤ ${MAX_HOLDOUT_BELOW * 100} %)`,
);
for (const r of rows)
  if (r.floorRatio < MAX_FLOOR_RATIO && r.nTrain >= 10)
    console.log(
      `${kept.includes(r) ? "KEEP" : "    "} ${r.key.padEnd(14)} ${r.name.slice(0, 28).padEnd(28)} floor ×${r.floorRatio.toFixed(3)} (p${r.quantile * 100}) static break ${(r.staticBreak * 100).toFixed(1)} / ${(r.holdoutStaticBreak * 100).toFixed(1)} %${r.depthSupported ? "" : " NO-DEPTH"} train ${r.nTrain} hold-out ${r.nHoldout} below ${(r.holdoutBelow * 100).toFixed(1)} %`,
    );

if (args.out) {
  const table = {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      manifest: source.manifest,
      every: source.every,
      offset: source.offset,
      filesRead: read,
      rule: `floor = the highest of p${FLOOR_QS.map((q) => q * 100).join(" / p")} (p0 = minimum) of recast/modelled-cooldown ratios on even-indexed files that is < ${MAX_FLOOR_RATIO} and that ≤ ${MAX_HOLDOUT_BELOW * 100} % of odd-file ratios fall below; kept when on each half ≥ ${MIN_STATIC_BREAK * 100} % and ≥ ${MIN_BREAK_COUNT} ratios are < ${MAX_FLOOR_RATIO}, the odd-file minimum is ≤ floor + ${DEPTH_SUPPORT}, and ≥ ${MIN_N} ratios per half`,
    },
    floors: Object.fromEntries(
      kept.map((r) => [
        r.key,
        {
          name: r.name,
          quantile: r.quantile,
          floorRatio: r.floorRatio,
          staticBreak: Math.round(r.staticBreak * 1000) / 1000,
          holdoutStaticBreak: Math.round(r.holdoutStaticBreak * 1000) / 1000,
          nTrain: r.nTrain,
          nHoldout: r.nHoldout,
          holdoutBelow: r.holdoutBelow,
        },
      ]),
    ),
  };
  const tmp = `${args.out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(table, null, 2)}\n`);
  renameSync(tmp, args.out);
  console.log(`wrote ${kept.length} floors to ${args.out}`);
}
