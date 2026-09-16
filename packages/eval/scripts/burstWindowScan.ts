/**
 * burstWindowScan.ts — GH #60 phase 1 corpus scan for the enemy-burst-window
 * decision points.
 *
 * Same shape (and much of the same plumbing) as `behaviorPriorScan.ts`: one
 * row per bounded burst window, produced by the SHARED predicate
 * `packages/analysis/src/analysis/burstWindowDecisionPoints.ts` — the scan
 * computes no window, no response and no feasibility logic of its own, so the
 * reference table it emits and whatever the product later says are, by
 * construction, about the same windows (CLAUDE.md shared-predicate rule).
 *
 *   scan        tsx burstWindowScan.ts scan --manifest <file> --ledger <dir>
 *                 --out <file.jsonl> [--offset N] [--limit N]
 *   sweep       tsx burstWindowScan.ts sweep --manifest <file> --ledger <dir>
 *                 [--limit N]           # lapse floor × lapse seconds grid
 *   report      tsx burstWindowScan.ts report --in <file.jsonl>
 *   overreact   tsx burstWindowScan.ts overreact --in <file.jsonl>   # probe only
 *   gradient    tsx burstWindowScan.ts gradient --in <file.jsonl>
 *                 --ledger <dir> [--md <out>]   # skill gradient, measurement only
 *   emit-table  tsx burstWindowScan.ts emit-table --in <file.jsonl>
 *                 --out <file.json> [--corpus <label>]
 *
 * `emit-table` writes through a temp file and copies it into place: never
 * redirect `>` straight into the imported json — a crashed script truncates
 * the file that the product imports.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  boundedBurstSegments,
  BURST_LAPSE_DMG_PCT_PER_S,
  BURST_LAPSE_SECONDS,
  BURST_RESPONSE_WINDOW_SEC,
  BURST_TRIAGE_MIN_HP_DROP_PP,
  type BurstWindowDecisionPoint,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { BURST_WINDOW_MIN_JUDGED_S } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { CRISIS_HP_PCT_RENDERED } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  BURST_REF_MIN_CONTRAST_PP,
  burstRefClearsMinContrast,
  burstRefContrastPp,
  lookupBurstWindowPrior,
} from "@gladlog/analysis/src/data/burstWindowPrior";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { gunzipSync } from "zlib";

import {
  buildBurstWindowPriorTable,
  type BurstWindowPriorRow,
} from "../src/explore/burstWindowPriorTable";
import {
  bandOfPct,
  PCT_BANDS,
  rankLedger,
} from "../src/explore/ratingPercentile";
import { wilson95 } from "../src/explore/signalSkillGradient";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

/** one row per bounded burst window; `point` is the shared predicate's own
 * output, trimmed of the per-friendly outcome detail the table never reads */
interface Row {
  kind?: undefined;
  matchId: string;
  seq: number | null;
  bracket: string;
  /** did the friendly team win this round (null when unknown) */
  win: boolean | null;
  point: Omit<BurstWindowDecisionPoint, "friendlyOutcomes"> & {
    /** name + min HP of the friendly that dipped lowest — kept for the
     * value-gate examples, dropped for the rest of the team */
    lowestFriendly: { name: string; minHpPct: number | null } | null;
  };
}
/** one row per round: the UNBOUNDED builder windows, so the report can state
 * the window-length p50 before and after bounding under the same corpus */
interface RoundRow {
  kind: "round";
  matchId: string;
  seq: number | null;
  bracket: string;
  win: boolean | null;
  /** duration in seconds of each `alignedBurstWindows` entry, unbounded */
  parentDurs: number[];
}
type AnyRow = Row | RoundRow | { matchId: string; empty: true };

function loadLedger(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.id) out.set(String(r.id), r);
      } catch {
        /* torn */
      }
    }
  }
  return out;
}

function parseRounds(path: string): any[] {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    return [];
  }
  const combats: any[] = [];
  try {
    const parser = new GladLogParser();
    parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
    parser.on("shuffle", (sh: any) => {
      for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
    });
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
  } catch {
    return [];
  }
  return combats;
}

function friendlyTeamIdOf(legacy: any): string | null {
  for (const u of Object.values(legacy.units ?? {}) as any[])
    if (u.info && u.reaction === 1) return String(u.info.teamId);
  return null;
}
function winOf(legacy: any): boolean | null {
  const team = friendlyTeamIdOf(legacy);
  if (team == null || legacy.winningTeamId == null) return null;
  return String(legacy.winningTeamId) === team;
}

function manifestFiles(): string[] {
  const manifestPath = flag("--manifest")!;
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (limit) files = files.slice(0, limit);
  return files;
}

async function scan(): Promise<void> {
  const out = flag("--out");
  if (!flag("--manifest") || !flag("--ledger") || !out) {
    console.error(
      "usage: scan --manifest <file> --ledger <dir> --out <file.jsonl> [--offset N] [--limit N]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const ledger = loadLedger(flag("--ledger")!);
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        done.add(JSON.parse(l).matchId);
      } catch {
        /* torn */
      }
    }
  let scanned = 0,
    oldSeason = 0,
    windows = 0;
  for (const path of manifestFiles()) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    if (done.has(matchId)) continue;
    const meta = ledger.get(matchId);
    if (
      !meta ||
      !meta.startTime ||
      meta.startTime < PATCH_121_GOLIVE_EPOCH_MS
    ) {
      oldSeason++;
      continue;
    }
    const combats = parseRounds(path);
    if (!combats.length) continue;
    scanned++;
    const bracket = meta.bracket ?? "?";
    const lines: string[] = [];
    let seq = 0;
    for (const legacy of combats) {
      const mySeq = combats.length > 1 ? seq++ : null;
      const win = winOf(legacy);
      let points: BurstWindowDecisionPoint[] = [];
      let parentDurs: number[] = [];
      try {
        // `collectSpend` is the PROBE-ONLY option (over-react probe): the
        // product never sets it, the scan does, so `point.spend` exists on
        // archive rows and nowhere else.
        points = burstWindowDecisionPoints(legacy, { collectSpend: true });
        parentDurs = unboundedDurations(legacy);
      } catch {
        continue;
      }
      lines.push(
        JSON.stringify({
          kind: "round",
          matchId,
          seq: mySeq,
          bracket,
          win,
          parentDurs,
        } as RoundRow),
      );
      for (const p of points) {
        const { friendlyOutcomes, ...rest } = p;
        let lowest: { name: string; minHpPct: number | null } | null = null;
        for (const f of friendlyOutcomes)
          if (
            f.minHpPct !== null &&
            (lowest === null ||
              lowest.minHpPct === null ||
              f.minHpPct < lowest.minHpPct)
          )
            lowest = { name: f.name, minHpPct: f.minHpPct };
        lines.push(
          JSON.stringify({
            matchId,
            seq: mySeq,
            bracket,
            win,
            point: { ...rest, lowestFriendly: lowest },
          } as unknown as Row),
        );
        windows++;
      }
    }
    if (!lines.length) lines.push(JSON.stringify({ matchId, empty: true }));
    appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 100 === 0)
      console.error(
        `… ${scanned} matches, ${windows} windows, ${oldSeason} skipped (old season/no ledger)`,
      );
  }
  console.error(
    `done: scanned=${scanned} windows=${windows} skipped=${oldSeason}`,
  );
}

/** duration of every UNBOUNDED builder window of one round — the "before"
 * half of the p50 claim. Reads the same `reconstructEnemyCDTimeline` the
 * engine reads, through the engine's own module boundary. */
function unboundedDurations(legacy: any): number[] {
  const units: any[] = Object.values(legacy.units ?? {});
  const players = units.filter((u) => u.info);
  const enemies = players.filter((u) => u.reaction !== 1);
  if (!enemies.length) return [];
  const t = reconstructEnemyCDTimeline(enemies, legacy);
  return t.alignedBurstWindows.map((w: any) =>
    Math.max(0, Math.floor(w.toSeconds) - Math.floor(w.fromSeconds)),
  );
}

// ────────────────────────────────────────────────────────────── sweep ──────
/** Pick the lapse predicate from the data (the GH #60 brief): how the bounded
 * window length distribution and the window count move across a grid of
 * (damage floor, lapse seconds). */
async function sweep(): Promise<void> {
  if (!flag("--manifest") || !flag("--ledger")) {
    console.error("usage: sweep --manifest <file> --ledger <dir> [--limit N]");
    process.exit(1);
  }
  await ensureAnalysisData();
  const ledger = loadLedger(flag("--ledger")!);
  const floors = [0.01, 0.02, 0.03, 0.05];
  const lapses = [2, 3, 4, 5];
  /** the literal GH #60 wording ("no offensive CD buff active AND no damage")
   * as a control row — measured a no-op, see the report */
  const cdRow = { dmgFloor: 0.02, lapseSeconds: 3, cdBuffIsPressure: true };
  const durs = new Map<string, number[]>();
  const unbounded: number[] = [];
  let matches = 0;
  for (const path of manifestFiles()) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    const meta = ledger.get(matchId);
    if (!meta?.startTime || meta.startTime < PATCH_121_GOLIVE_EPOCH_MS)
      continue;
    const combats = parseRounds(path);
    if (!combats.length) continue;
    matches++;
    for (const legacy of combats) {
      unbounded.push(...unboundedDurations(legacy));
      {
        const arr = durs.get("cdBuff") ?? durs.set("cdBuff", []).get("cdBuff")!;
        try {
          for (const seg of boundedBurstSegments(legacy, cdRow).segments)
            arr.push(
              Math.max(
                0,
                Math.floor(seg.toSeconds) - Math.floor(seg.fromSeconds),
              ),
            );
        } catch {
          /* skip */
        }
      }
      for (const f of floors)
        for (const l of lapses) {
          const k = `${f}|${l}`;
          const arr = durs.get(k) ?? durs.set(k, []).get(k)!;
          try {
            // segmentation only — the sweep needs window lengths, not the
            // response/feasibility/outcome pass (16 configs × that would be
            // 16× the corpus cost for numbers it never reads)
            for (const seg of boundedBurstSegments(legacy, {
              dmgFloor: f,
              lapseSeconds: l,
            }).segments)
              arr.push(
                Math.max(
                  0,
                  Math.floor(seg.toSeconds) - Math.floor(seg.fromSeconds),
                ),
              );
          } catch {
            /* skip */
          }
        }
    }
    if (matches % 50 === 0) console.error(`… ${matches} matches`);
  }
  const q = (v: number[], p: number) => {
    if (!v.length) return NaN;
    const s = [...v].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  };
  const lines: string[] = [];
  lines.push(`# burst-window lapse sweep (${matches} matches)\n`);
  lines.push(
    `unbounded builder windows: n=${unbounded.length} p50=${q(unbounded, 0.5)}s p90=${q(unbounded, 0.9)}s mean=${(unbounded.reduce((a, b) => a + b, 0) / Math.max(1, unbounded.length)).toFixed(1)}s\n`,
  );
  lines.push(`| dmg floor %/s | lapse s | windows | p50 s | p75 s | p90 s |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const f of floors)
    for (const l of lapses) {
      const v = durs.get(`${f}|${l}`) ?? [];
      lines.push(
        `| ${(f * 100).toFixed(0)}% | ${l} | ${v.length} | ${q(v, 0.5)} | ${q(v, 0.75)} | ${q(v, 0.9)} |`,
      );
    }
  {
    const v = durs.get("cdBuff") ?? [];
    lines.push(
      `| 2% + "CD buff counts as pressure" (literal GH #60 wording) | 3 | ${v.length} | ${q(v, 0.5)} | ${q(v, 0.75)} | ${q(v, 0.9)} |`,
    );
  }
  lines.push(
    `\ncurrent code default: ${(BURST_LAPSE_DMG_PCT_PER_S * 100).toFixed(0)}% / ${BURST_LAPSE_SECONDS}s`,
  );
  process.stdout.write(lines.join("\n") + "\n");
}

// ───────────────────────────────────────────────────────────── report ──────
function readRows(inPath: string): { rows: Row[]; rounds: RoundRow[] } {
  const rows: Row[] = [];
  const rounds: RoundRow[] = [];
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l) as AnyRow;
      if ("empty" in r) continue;
      if ((r as RoundRow).kind === "round") rounds.push(r as RoundRow);
      else rows.push(r as Row);
    } catch {
      /* torn */
    }
  }
  return { rows, rounds };
}
const pctStr = (n: number, d: number) =>
  d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "—";
const q = (v: number[], p: number) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

function report(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <file.jsonl>");
    process.exit(1);
  }
  const { rows, rounds } = readRows(inPath);
  const matches = new Set(rounds.map((r) => r.matchId));
  const parentDurs = rounds.flatMap((r) => r.parentDurs);
  const lines: string[] = [];
  lines.push(`# enemy burst windows — GH #60 phase 1 corpus scan\n`);
  lines.push(
    `matches ${matches.size}, rounds ${rounds.length}, bounded windows ${rows.length}.\n`,
  );
  lines.push(
    `window length — UNBOUNDED builder windows: n=${parentDurs.length} p50=${q(parentDurs, 0.5)}s p75=${q(parentDurs, 0.75)}s p90=${q(parentDurs, 0.9)}s`,
  );
  const bd = rows.map((r) => r.point.durationSec);
  lines.push(
    `window length — BOUNDED (this engine): n=${bd.length} p50=${q(bd, 0.5)}s p75=${q(bd, 0.75)}s p90=${q(bd, 0.9)}s\n`,
  );

  const feas = rows.filter((r) => r.point.feasible);
  lines.push(
    `feasibility gate: ${pctStr(feas.length, rows.length)} of windows were answerable BY OR FOR THE PRESSURED FRIENDLY (their own tool ready, or a teammate's ally-reaching tool ready, and that unit not hard-CC'd for the full 8 s).\n`,
  );

  // Triage + fire rate (approved correction 2). The "fire rate" is exactly
  // what the product candidate would emit before its per-round cap: feasible
  // AND triaged AND unanswered.
  const triaged = feas.filter((r) => r.point.triaged);
  const unanswered = feas.filter((r) => !r.point.responded);
  const fire = unanswered.filter((r) => r.point.triaged);
  lines.push(`## triage + fire rate\n`);
  lines.push(
    `triaged (pressured friendly reached the crisis HP line, or a friendly died in the window): ${pctStr(triaged.length, feas.length)} of feasible windows`,
  );
  lines.push(
    `unanswered within 8 s: ${pctStr(unanswered.length, feas.length)} of feasible windows`,
  );
  lines.push(
    `**FIRE (feasible ∧ triaged ∧ unanswered)**: ${pctStr(fire.length, feas.length)} of feasible windows, ${(fire.length / Math.max(1, rounds.length)).toFixed(3)} per round`,
  );
  lines.push(
    `  · of which the pressured friendly died in the window: ${pctStr(fire.filter((r) => r.point.anyFriendlyDeath).length, fire.length)}`,
  );
  const fireHp = fire
    .map((r) => r.point.pressured?.minHpPct)
    .filter((v): v is number => v != null);
  lines.push(
    `  · pressured min HP among fired windows: p10=${q(fireHp, 0.1)}% p25=${q(fireHp, 0.25)}% p50=${q(fireHp, 0.5)}% p75=${q(fireHp, 0.75)}%`,
  );
  const unansweredHp = unanswered
    .map((r) => r.point.pressured?.minHpPct)
    .filter((v): v is number => v != null);
  lines.push(
    `  · pressured min HP among ALL unanswered feasible windows (the triage denominator): p10=${q(unansweredHp, 0.1)}% p25=${q(unansweredHp, 0.25)}% p50=${q(unansweredHp, 0.5)}% p75=${q(unansweredHp, 0.75)}%\n`,
  );

  // ── the two 2026-09-01 doors, swept ────────────────────────────────────
  // Both are CANDIDATE doors: neither touches the reference table, which is
  // built over `feasible` and never reads `triaged` (pinned by a unit test).
  lines.push(`## the two 2026-09-01 doors\n`);
  lines.push(
    `Fire = feasible ∧ unanswered ∧ (pressured min HP ≤ ${CRISIS_HP_PCT_RENDERED}% or a death) ∧ durationSec ≥ ${BURST_WINDOW_MIN_JUDGED_S} — i.e. exactly what the producer emits before its per-round cap. "quoted contrast" is the reference cell the line would cite, after fallback resolution (lookupBurstWindowPrior).\n`,
  );
  const dropOf = (r: Row): number | null => {
    const p = r.point.pressured;
    if (!p || p.startHpPct == null || p.minHpPct == null) return null;
    return p.startHpPct - p.minHpPct;
  };
  const refOfRow = (r: Row) =>
    lookupBurstWindowPrior(r.bracket, r.point.leadCd.spellId);
  const baseFire = feas.filter(
    (r) =>
      !r.point.responded &&
      r.point.durationSec >= BURST_WINDOW_MIN_JUDGED_S &&
      ((r.point.pressured?.minHpPct != null &&
        r.point.pressured.minHpPct <= CRISIS_HP_PCT_RENDERED) ||
        r.point.deathsInWindow > 0),
  );
  const noDrop = baseFire.filter((r) => dropOf(r) === null).length;
  lines.push(
    `windows with no measurable HP drop (no start sample — the door fails these closed): ${pctStr(noDrop, baseFire.length)}\n`,
  );
  lines.push(
    `| HP-drop floor pp | fires | fires/round | of feasible | death share | median quoted contrast pp | flat/reversed (< ${BURST_REF_MIN_CONTRAST_PP} pp or no cell) | + contrast door: fires | fires/round |`,
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const floor of [0, 10, 15, 20]) {
    const fires = baseFire.filter((r) => (dropOf(r) ?? -1) >= floor);
    const contrasts = fires.map((r) => {
      const ref = refOfRow(r);
      return ref ? burstRefContrastPp(ref) : null;
    });
    const good = fires.filter(
      (_, i) =>
        contrasts[i] !== null && contrasts[i]! >= BURST_REF_MIN_CONTRAST_PP,
    );
    const cv = contrasts.filter((v): v is number => v !== null);
    lines.push(
      `| ${floor} | ${fires.length} | ${(fires.length / Math.max(1, rounds.length)).toFixed(3)} | ${pctStr(fires.length, feas.length)} | ${pctStr(fires.filter((r) => r.point.anyFriendlyDeath).length, fires.length)} | ${cv.length ? q(cv, 0.5) : "—"} | ${pctStr(fires.length - good.length, fires.length)} | ${good.length} | ${(good.length / Math.max(1, rounds.length)).toFixed(3)} |`,
    );
  }
  lines.push(
    `\nshipped: HP-drop floor ${BURST_TRIAGE_MIN_HP_DROP_PP} pp + contrast floor ${BURST_REF_MIN_CONTRAST_PP} pp.\n`,
  );

  // opportunity normalisation (Value-Gate rule 4): windows per match, split by
  // the round's own outcome — so a "responders win more" reading can be
  // checked against how many windows each side even faced.
  const perRound = (f: (r: RoundRow) => boolean) => {
    const rs = rounds.filter(f);
    const ids = new Set(rs.map((r) => `${r.matchId}|${r.seq}`));
    const n = rows.filter(
      (r) => ids.has(`${r.matchId}|${r.seq}`) && r.point.feasible,
    ).length;
    return rs.length ? (n / rs.length).toFixed(2) : "—";
  };
  // CLAUDE.md Value-Gate rule 5: never pool brackets — bracket composition
  // shifts with rating, and a pooled number fabricates effects (the
  // death-unused-defensive Simpson case).
  lines.push(`opportunity denominator (Value-Gate rule 4 + 5)\n`);
  lines.push(`| bracket | feasible windows / won round | / lost round |`);
  lines.push(`|---|---|---|`);
  const allBrackets = [...new Set(rounds.map((r) => r.bracket))].sort();
  for (const b of ["ALL", ...allBrackets])
    lines.push(
      `| ${b} | ${perRound((r) => r.win === true && (b === "ALL" || r.bracket === b))} | ${perRound((r) => r.win === false && (b === "ALL" || r.bracket === b))} |`,
    );
  lines.push("");

  const brackets = [...new Set(rows.map((r) => r.bracket))].sort();
  lines.push(`## per bracket (feasible windows only)\n`);
  lines.push(
    `| bracket | windows | responded | death-in-window RESP | death-in-window NO-RESP | Δ pp | median first-response s |`,
  );
  lines.push(`|---|---|---|---|---|---|---|`);
  const bracketLine = (label: string, rs: Row[]) => {
    const resp = rs.filter((r) => r.point.responded);
    const no = rs.filter((r) => !r.point.responded);
    const dr = resp.filter((r) => r.point.anyFriendlyDeath).length;
    const dn = no.filter((r) => r.point.anyFriendlyDeath).length;
    const rate = (a: number, b: number) => (b ? (100 * a) / b : NaN);
    const delta = rate(dn, no.length) - rate(dr, resp.length);
    const lat = resp
      .map((r) => r.point.firstResponseSec)
      .filter((v): v is number => v != null);
    lines.push(
      `| ${label} | ${rs.length} | ${pctStr(resp.length, rs.length)} | ${pctStr(dr, resp.length)} | ${pctStr(dn, no.length)} | ${isNaN(delta) ? "—" : delta.toFixed(1)} | ${lat.length ? q(lat, 0.5) : "—"} |`,
    );
  };
  bracketLine("ALL", feas);
  for (const b of brackets)
    bracketLine(
      b,
      feas.filter((r) => r.bracket === b),
    );

  lines.push(`\n## response mix (feasible windows)\n`);
  const KEYS = [
    "wall",
    "external",
    "healCd",
    "control",
    "kite",
    "attackerMoved",
  ] as const;
  lines.push(`| response | share of feasible windows |`);
  lines.push(`|---|---|`);
  for (const k of KEYS)
    lines.push(
      `| ${k} | ${pctStr(feas.filter((r) => r.point.responses[k]).length, feas.length)} |`,
    );

  lines.push(`\n## latency of the first response (feasible + responded)\n`);
  const lat = feas
    .filter((r) => r.point.responded)
    .map((r) => r.point.firstResponseSec)
    .filter((v): v is number => v != null);
  lines.push(
    `n=${lat.length} p25=${q(lat, 0.25)}s p50=${q(lat, 0.5)}s p75=${q(lat, 0.75)}s p90=${q(lat, 0.9)}s\n`,
  );

  lines.push(`## top lead CDs (feasible windows)\n`);
  const byLead = new Map<string, Row[]>();
  for (const r of feas) {
    const k = `${r.point.leadCd.spellId}|${r.point.leadCd.spellName}`;
    (byLead.get(k) ?? byLead.set(k, []).get(k)!).push(r);
  }
  lines.push(
    `| lead CD | windows | responded | death RESP | death NO-RESP | Δ pp |`,
  );
  lines.push(`|---|---|---|---|---|---|`);
  for (const [k, rs] of [...byLead.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)) {
    const resp = rs.filter((r) => r.point.responded);
    const no = rs.filter((r) => !r.point.responded);
    const dr = resp.filter((r) => r.point.anyFriendlyDeath).length;
    const dn = no.filter((r) => r.point.anyFriendlyDeath).length;
    const rate = (a: number, b: number) => (b ? (100 * a) / b : NaN);
    const delta = rate(dn, no.length) - rate(dr, resp.length);
    lines.push(
      `| ${k.split("|")[1]} (${k.split("|")[0]}) | ${rs.length} | ${pctStr(resp.length, rs.length)} | ${pctStr(dr, resp.length)} | ${pctStr(dn, no.length)} | ${isNaN(delta) ? "—" : delta.toFixed(1)} |`,
    );
  }
  process.stdout.write(lines.join("\n") + "\n");
}

// ────────────────────────────────────────────────────────── emit-table ─────
async function emitTable(): Promise<void> {
  const inPath = flag("--in");
  const outPath = flag("--out");
  if (!inPath || !outPath) {
    console.error(
      "usage: emit-table --in <file.jsonl> --out <file.json> [--corpus <label>]",
    );
    process.exit(1);
  }
  const { rows, rounds } = readRows(inPath);
  const tableRows: BurstWindowPriorRow[] = rows.map((r) => ({
    bracket: r.bracket,
    point: r.point as unknown as BurstWindowDecisionPoint,
  }));
  const table = buildBurstWindowPriorTable(tableRows, {
    generatedAt: new Date().toISOString().slice(0, 10),
    corpus:
      flag("--corpus") ??
      `${new Set(rounds.map((x) => x.matchId)).size} archived matches`,
    command:
      "npx tsx packages/eval/scripts/burstWindowScan.ts emit-table --in <scan.jsonl> --out <file.json>",
    predicateVersion: 1,
  });
  // NEVER `>` into the imported json: write a temp file, then copy it in.
  const tmp = join(dirname(outPath), `.${basename(outPath)}.tmp`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(tmp, JSON.stringify(table, null, 2) + "\n");
  copyFileSync(tmp, outPath);
  console.error(
    `wrote ${Object.keys(table.cells).length} cells → ${outPath} (via ${tmp})`,
  );
}

/**
 * examples — the Value-Gate rule 1 step: print COMPLETE real-match outputs
 * (window facts + the reference numbers the product would quote) for the
 * user to approve or kill BEFORE anything is wired. Reads raw local logs, not
 * the archive, so the examples come from the user's own library.
 */
/**
 * The exact sentence the product would say, composed ONLY from engine facts
 * and reference-table numbers — no adjectives the data cannot back. This is
 * the Value-Gate rule 1 artefact: it exists to be shown to the user and
 * approved (or killed) before any wiring.
 */
function renderExample(
  file: string,
  seq: number | null,
  bracket: string,
  p: BurstWindowDecisionPoint,
  ref: ReturnType<typeof lookupBurstWindowPrior>,
): string {
  // only the CDs that landed inside the 8 s the sentence judges: a CD cast
  // 21 s later is part of a different exchange and reads as if it had opened
  // with the lead one (real case: match 2195ab6e round 1, window 2:17–2:58).
  const inWindowExtras = p.extraCds.filter(
    (c) => c.castSec <= p.tSec + BURST_RESPONSE_WINDOW_SEC,
  );
  const extras = inWindowExtras.length
    ? `(+${inWindowExtras.map((c) => `${c.spellName} ${fmtTime(c.castSec)}`).join("、")})`
    : "";
  const lowest = [...p.friendlyOutcomes]
    .filter((f) => f.minHpPct !== null)
    .sort((a, b) => a.minHpPct! - b.minHpPct!)[0];
  const hpClause = lowest
    ? `${lowest.name} 在窗口内被打到 ${lowest.minHpPct}%${lowest.died ? "、并在窗口内阵亡" : ""}`
    : "窗口内没有可用的 HP 采样";
  const refClause = ref
    ? `语料参照(n=${ref.nResp + ref.nNoResp} 个${ref.fellBack ? `${ref.cellKey} 回退` : ` ${p.leadCd.spellName} `}爆发窗):8 秒内有应对的窗口内死人 ${ref.deathRespPct}%(n=${ref.nResp});没应对的 ${ref.deathNoRespPct}%(n=${ref.nNoResp})。`
    : "语料参照:该 lead CD 的样本量未过下限,不出面。";
  const head = `${fmtTime(p.tSec)} 对方开了 ${p.leadCd.spellName}${extras}(${p.leadCd.casterSpec} ${p.leadCd.casterName})`;
  const body = p.responded
    ? `应对了:${p.responseCasts
        .map(
          (r) =>
            `${r.casterName} 交了 ${r.spellName},latency ${r.latencySec} 秒`,
        )
        .join(
          ";",
        )}${p.responseCasts.length === 0 && p.responses.kite ? "拉开了距离(无施法)" : ""}`
    : `8 秒内你们没有任何应对——当时 ${p.feasibleUnits.join("、")} 手上有可用的减伤/救人/控制大招,且没有被硬控整整 8 秒`;
  return [
    `## ${file}${seq === null ? "" : ` round ${seq}`} · ${bracket} · window ${fmtTime(p.tSec)}–${fmtTime(p.endSec)} (${p.durationSec}s)`,
    `${head},${body};${hpClause}。${refClause}`,
    "",
  ].join("\n");
}

async function examples(): Promise<void> {
  if (!flag("--manifest")) {
    console.error(
      "usage: examples --manifest <file> [--limit N] [--responded]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const wantResponded = argv.includes("--responded");
  const render = argv.includes("--render");
  const out: string[] = [];
  for (const path of manifestFiles()) {
    const combats = parseRounds(path);
    let seq = 0;
    for (const legacy of combats) {
      const mySeq = combats.length > 1 ? seq++ : null;
      let points: BurstWindowDecisionPoint[] = [];
      try {
        points = burstWindowDecisionPoints(legacy);
      } catch {
        continue;
      }
      const bracket = legacy.startInfo?.bracket ?? "?";
      for (const p of points) {
        if (!p.feasible) continue;
        if (p.responded !== wantResponded) continue;
        const ref = lookupBurstWindowPrior(bracket, p.leadCd.spellId);
        if (render) {
          out.push(renderExample(basename(path), mySeq, bracket, p, ref));
          continue;
        }
        out.push(
          JSON.stringify({
            file: basename(path),
            seq: mySeq,
            bracket,
            win: winOf(legacy),
            tSec: p.tSec,
            endSec: p.endSec,
            durationSec: p.durationSec,
            lead: p.leadCd,
            extras: p.extraCds,
            responses: p.responses,
            responseCasts: p.responseCasts,
            firstResponseSec: p.firstResponseSec,
            feasibleUnits: p.feasibleUnits,
            deathsInWindow: p.deathsInWindow,
            minFriendlyHpPct: p.minFriendlyHpPct,
            friendlyOutcomes: p.friendlyOutcomes,
            ref,
          }),
        );
      }
    }
  }
  process.stdout.write(out.join("\n") + "\n");
  console.error(`${out.length} example windows`);
}

// ─────────────────────────────────────────────────────────── overreact ─────
/**
 * PROBE ONLY — nothing here is wired into the product, no candidate reads it
 * and no gate checks it (user idea, 2026-09-01).
 *
 * The question: does spending MORE defensive cooldowns than a burst window
 * needed cost you later in the same round? The bar this has to clear is
 * explicit — `cd-spent-idle` was retired 2026-08-30 because "wasteful spend"
 * showed no outcome cost (punished 3.6% vs 3.1%). If all three definitions
 * below come out flat, the idea dies the same way.
 *
 * **The denominator trap this probe is built around.** "Later punishment"
 * requires at least one SPENT cooldown to still be on cooldown at a later
 * window — so a window where nobody spent anything can never be punished, by
 * construction. Comparing over-spenders against everybody would therefore
 * manufacture a positive result out of nothing. Every control here is
 * restricted to windows that spent AT LEAST ONE major, so the punishment
 * mechanism is available to both arms (CLAUDE.md Value-Gate rule 4: ask what
 * the denominator is before reading the sign).
 *
 * Severity is stratified, never pooled (Value-Gate rule 5), by the pressured
 * friendly's min grid HP: >60 / 40–60 / ≤40. Brackets are reported
 * separately for the same reason.
 */
type Band = ">60" | "40-60" | "<=40";
const BANDS: Band[] = [">60", "40-60", "<=40"];
const bandOf = (hp: number | null | undefined): Band | null =>
  hp == null ? null : hp > 60 ? ">60" : hp > 40 ? "40-60" : "<=40";
/** "a big cooldown" for O2 — 3 minutes or longer. */
const LONG_CD_SECONDS = 180;

interface ProbeWindow {
  matchId: string;
  seq: number | null;
  bracket: string;
  win: boolean | null;
  tSec: number;
  band: Band | null;
  /** every response event inside the 8 s the window is judged over, all
   * friendlies (casts + a kite, which has no cast instant) */
  responsesCount: number;
  /** personal walls + externals + major healing CDs actually cast inside the
   * bounded window, all friendlies */
  majorsSpent: number;
  spentIds: string[];
  /** sum of the spent CDs' base cooldown seconds (0-cd ledger misses excluded
   * from the sum but still counted in `majorsSpent`) */
  spendWeightS: number;
  minHp: number | null;
  died: boolean;
  /** a spent CD whose base cooldown is >= LONG_CD_SECONDS */
  hasLongCd: boolean;
  /** "weak window": one lead CD, no extras, nobody died, nobody went under
   * 60% — the moment did not ask for a big button */
  weak: boolean;
  /** LATER PUNISHMENT: a later feasible window in the same round, during
   * which >=1 of the CDs spent here was still on cooldown, that either went
   * unanswered or contained a friendly death */
  punished: boolean;
  /** could this window be punished at all (>=1 spend with a known cooldown
   * AND a later feasible window exists)? the honest denominator */
  punishable: boolean;
  /**
   * The CONFOUND-CONTROLLED outcome. `punished` above is mechanically
   * satisfied by long cooldowns — a 180 s CD is still down at essentially
   * every later window in the round, so "was one of them still down" measures
   * cooldown length, not decision quality. These four count the round's own
   * later feasible windows split by whether they fall inside the exhausted
   * CD's shadow, so "more spend covers more windows" cancels: what is
   * compared is a RATE over later windows, inside vs outside, within the same
   * round.
   */
  shadowN: number;
  shadowBad: number;
  clearN: number;
  clearBad: number;
  /** spend casts the cooldown ledger had no entry for (they count toward
   * `majorsSpent`, contribute nothing to `spendWeightS`) */
  zeroCdSpends: number;
}

function buildProbeWindows(rows: Row[]): ProbeWindow[] {
  const byRound = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.matchId}|${r.seq}`;
    (byRound.get(k) ?? byRound.set(k, []).get(k)!).push(r);
  }
  const out: ProbeWindow[] = [];
  for (const group of byRound.values()) {
    const sorted = [...group].sort((a, b) => a.point.tSec - b.point.tSec);
    for (const r of sorted) {
      const p = r.point;
      const spend = (p.spend ?? []).filter((c) => c.tSec >= p.tSec);
      const laterFeasible = sorted.filter(
        (o) => o.point.tSec > p.tSec && o.point.feasible,
      );
      const withCd = spend.filter((c) => c.cooldownSeconds > 0);
      const punishable = withCd.length > 0 && laterFeasible.length > 0;
      const punished =
        punishable &&
        laterFeasible.some(
          (o) =>
            (!o.point.responded || o.point.anyFriendlyDeath) &&
            withCd.some((c) => c.tSec + c.cooldownSeconds > o.point.tSec),
        );
      const isBad = (o: Row) => !o.point.responded || o.point.anyFriendlyDeath;
      const inShadow = (o: Row) =>
        withCd.some((c) => c.tSec + c.cooldownSeconds > o.point.tSec);
      const shadow = laterFeasible.filter(inShadow);
      const clear = laterFeasible.filter((o) => !inShadow(o));
      const minHp = p.pressured?.minHpPct ?? null;
      out.push({
        matchId: r.matchId,
        seq: r.seq,
        bracket: r.bracket,
        win: r.win,
        tSec: p.tSec,
        band: bandOf(minHp),
        responsesCount: p.responseCasts.length + (p.responses.kite ? 1 : 0),
        majorsSpent: spend.length,
        spentIds: spend.map((c) => c.spellId),
        spendWeightS: withCd.reduce((n, c) => n + c.cooldownSeconds, 0),
        minHp,
        died: p.anyFriendlyDeath,
        hasLongCd: withCd.some((c) => c.cooldownSeconds >= LONG_CD_SECONDS),
        weak:
          p.extraCds.length === 0 &&
          !p.anyFriendlyDeath &&
          minHp != null &&
          minHp > 60,
        punished,
        punishable,
        zeroCdSpends: spend.length - withCd.length,
        shadowN: shadow.length,
        shadowBad: shadow.filter(isBad).length,
        clearN: clear.length,
        clearBad: clear.filter(isBad).length,
      });
    }
  }
  return out;
}

const rate = (ws: ProbeWindow[]) =>
  ws.length ? (100 * ws.filter((w) => w.punished).length) / ws.length : NaN;
const rateStr = (ws: ProbeWindow[]) =>
  ws.length
    ? `${rate(ws).toFixed(1)}% (${ws.filter((w) => w.punished).length}/${ws.length})`
    : "—";

/** Band-standardised rates: each band's rate weighted by the TRIGGER arm's own
 * band distribution, so a definition that lives in a more dangerous band than
 * its control cannot borrow that band's punishment rate. */
function standardised(
  trig: ProbeWindow[],
  ctrl: ProbeWindow[],
): { t: number; c: number } {
  let tw = 0,
    cw = 0,
    wsum = 0;
  for (const b of BANDS) {
    const t = trig.filter((w) => w.band === b);
    const c = ctrl.filter((w) => w.band === b);
    if (!t.length || !c.length) continue;
    tw += t.length * rate(t);
    cw += t.length * rate(c);
    wsum += t.length;
  }
  return wsum ? { t: tw / wsum, c: cw / wsum } : { t: NaN, c: NaN };
}

function overreact(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: overreact --in <file.jsonl> [--out <file.md>]");
    process.exit(1);
  }
  const { rows, rounds } = readRows(inPath);
  const all = buildProbeWindows(rows);
  const brackets = [...new Set(all.map((w) => w.bracket))].sort();
  const L: string[] = [];
  L.push(`# burst windows — the over-react probe (GH #60, 2026-09-01)\n`);
  L.push(
    `**Probe only.** Nothing below is wired into the product. Bar to clear: \`cd-spent-idle\` was retired 2026-08-30 for showing no outcome cost (punished 3.6% vs 3.1%); "has teeth" here means a later-punishment contrast of ≥ 3 pp in at least two brackets, band-standardised.\n`,
  );
  L.push(
    `Corpus: ${new Set(rows.map((r) => r.matchId)).size} archived 12.1 matches, ${rounds.length} rounds, ${all.length} bounded windows.\n`,
  );

  // ── the denominator, stated before any comparison ─────────────────────
  const spent = all.filter((w) => w.majorsSpent >= 1);
  const punishable = all.filter((w) => w.punishable);
  L.push(`## the denominator\n`);
  L.push(`| population | windows | share | later-punishment rate |`);
  L.push(`|---|---|---|---|`);
  L.push(`| all bounded windows | ${all.length} | 100% | ${rateStr(all)} |`);
  L.push(
    `| spent ≥ 1 major inside the window | ${spent.length} | ${((100 * spent.length) / Math.max(1, all.length)).toFixed(1)}% | ${rateStr(spent)} |`,
  );
  L.push(
    `| **punishable** (≥1 spend with a known cooldown AND a later feasible window exists) | ${punishable.length} | ${((100 * punishable.length) / Math.max(1, all.length)).toFixed(1)}% | ${rateStr(punishable)} |`,
  );
  L.push(
    `\nA window with no spend can NEVER be punished by construction, so every control below is restricted to windows that spent at least one major. Reading the trigger arms against "everybody" would manufacture the result.\n`,
  );
  const spendCasts = all.reduce((n, w) => n + w.majorsSpent, 0);
  const zeroCd = all.reduce((n, w) => n + w.zeroCdSpends, 0);
  L.push(
    `spend ledger coverage: ${spendCasts} spend casts, ${zeroCd} (${((100 * zeroCd) / Math.max(1, spendCasts)).toFixed(1)}%) with no cooldown entry in the \`extractMajorCooldowns\` ledger — those count toward \`majorsSpent\` but contribute nothing to \`spendWeightS\` and cannot make a window punishable.\n`,
  );
  const qn = (v: number[], pp: number) => {
    if (!v.length) return NaN;
    const a = [...v].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(pp * a.length))]!;
  };
  const rc = all.map((w) => w.responsesCount);
  const ms = all.map((w) => w.majorsSpent);
  const sw = all.filter((w) => w.majorsSpent > 0).map((w) => w.spendWeightS);
  L.push(
    `per-window distributions — \`responsesCount\` (response events inside the 8 s the window is judged over, all friendlies, kite counted as one): p50=${qn(rc, 0.5)} p75=${qn(rc, 0.75)} p90=${qn(rc, 0.9)} max=${Math.max(0, ...rc)}; \`majorsSpent\` (walls+externals+major heal CDs cast anywhere inside the bounded window): p50=${qn(ms, 0.5)} p75=${qn(ms, 0.75)} p90=${qn(ms, 0.9)} max=${Math.max(0, ...ms)}; \`spendWeightS\` among windows with a spend: p25=${qn(sw, 0.25)}s p50=${qn(sw, 0.5)}s p75=${qn(sw, 0.75)}s p90=${qn(sw, 0.9)}s\n`,
  );
  L.push(
    `**Read the sign, not the size.** Spending two cooldowns instead of one MECHANICALLY leaves more on cooldown later, so O1/O3 are biased toward a positive Δ before any coaching claim enters. That makes a flat or negative result strong evidence of no cost, and a small positive one weak evidence of a cost.\n`,
  );

  const section = (
    title: string,
    note: string,
    trig: ProbeWindow[],
    ctrl: ProbeWindow[],
    denom: ProbeWindow[],
  ) => {
    L.push(`## ${title}\n`);
    L.push(`${note}\n`);
    L.push(
      `share of windows: ${trig.length} / ${denom.length} = ${((100 * trig.length) / Math.max(1, denom.length)).toFixed(1)}% of its own denominator (${((100 * trig.length) / Math.max(1, all.length)).toFixed(1)}% of all windows); control arm ${ctrl.length}\n`,
    );
    L.push(
      `| bracket | trigger n | trigger punished | control n | control punished | Δ pp (band-standardised) |`,
    );
    L.push(`|---|---|---|---|---|---|`);
    const row = (label: string, t: ProbeWindow[], c: ProbeWindow[]) => {
      const st = standardised(t, c);
      const d = st.t - st.c;
      L.push(
        `| ${label} | ${t.length} | ${rateStr(t)} | ${c.length} | ${rateStr(c)} | ${isNaN(d) ? "—" : d.toFixed(1)} |`,
      );
      return d;
    };
    row("ALL", trig, ctrl);
    const deltas: { b: string; d: number }[] = [];
    for (const b of brackets) {
      const d = row(
        b,
        trig.filter((w) => w.bracket === b),
        ctrl.filter((w) => w.bracket === b),
      );
      if (!isNaN(d)) deltas.push({ b, d });
    }
    // severity cells, so a pooled bracket number can be checked (rule 5)
    L.push(`\nby severity band (trigger vs control, unstandardised):\n`);
    L.push(`| band | trigger | control | Δ pp |`);
    L.push(`|---|---|---|---|`);
    for (const b of BANDS) {
      const t = trig.filter((w) => w.band === b);
      const c = ctrl.filter((w) => w.band === b);
      const d = rate(t) - rate(c);
      L.push(
        `| ${b} | ${rateStr(t)} | ${rateStr(c)} | ${isNaN(d) ? "—" : d.toFixed(1)} |`,
      );
    }
    // ── the confound-controlled outcome ───────────────────────────────────
    L.push(
      `\nwithin-round paired outcome — of the round's LATER feasible windows, how many went badly (unanswered or a death) INSIDE the exhausted cooldown's shadow vs OUTSIDE it. "more spend covers more windows" cancels here, because this is a rate over later windows, not a count of them:\n`,
    );
    L.push(
      `| bracket | arm | later windows in shadow | bad | later windows clear | bad | Δ pp |`,
    );
    L.push(`|---|---|---|---|---|---|---|`);
    const pairRow = (label: string, arm: string, ws: ProbeWindow[]) => {
      const sn = ws.reduce((n, w) => n + w.shadowN, 0);
      const sb = ws.reduce((n, w) => n + w.shadowBad, 0);
      const cn = ws.reduce((n, w) => n + w.clearN, 0);
      const cb = ws.reduce((n, w) => n + w.clearBad, 0);
      const d = sn && cn ? (100 * sb) / sn - (100 * cb) / cn : NaN;
      L.push(
        `| ${label} | ${arm} | ${sn} | ${sn ? ((100 * sb) / sn).toFixed(1) : "—"}% | ${cn} | ${cn ? ((100 * cb) / cn).toFixed(1) : "—"}% | ${isNaN(d) ? "—" : d.toFixed(1)} |`,
      );
      return d;
    };
    const pairedDeltas: { b: string; d: number }[] = [];
    {
      const t = pairRow("ALL", "trigger", trig);
      const c = pairRow("ALL", "control", ctrl);
      if (!isNaN(t) && !isNaN(c)) pairedDeltas.push({ b: "ALL", d: t - c });
    }
    for (const b of brackets) {
      const t = pairRow(
        b,
        "trigger",
        trig.filter((w) => w.bracket === b),
      );
      const c = pairRow(
        b,
        "control",
        ctrl.filter((w) => w.bracket === b),
      );
      if (!isNaN(t) && !isNaN(c)) pairedDeltas.push({ b, d: t - c });
    }
    // The deciding statistic is the DIFFERENCE IN DIFFERENCES: an exhausted
    // cooldown's shadow makes later windows go worse in BOTH arms (a burst
    // that just happened is followed by more pressure), so the trigger's own
    // shadow effect proves nothing on its own — only the amount by which it
    // EXCEEDS the control's does.
    L.push(
      `\ndifference in differences (trigger's shadow effect − control's) — the deciding statistic: ${pairedDeltas
        .map((x) => `${x.b} ${x.d >= 0 ? "+" : ""}${x.d.toFixed(1)}`)
        .join(" · ")}\n`,
    );

    // opportunity denominator (Value-Gate rule 4)
    L.push(`\nwindows per round by outcome (opportunity denominator):\n`);
    L.push(`| bracket | trigger / won round | / lost round |`);
    L.push(`|---|---|---|`);
    const perRoundOf = (ws: ProbeWindow[], b: string, win: boolean) => {
      const rs = rounds.filter(
        (r) => r.win === win && (b === "ALL" || r.bracket === b),
      );
      if (!rs.length) return "—";
      const ids = new Set(rs.map((r) => `${r.matchId}|${r.seq}`));
      const n = ws.filter((w) => ids.has(`${w.matchId}|${w.seq}`)).length;
      return (n / rs.length).toFixed(3);
    };
    for (const b of ["ALL", ...brackets])
      L.push(
        `| ${b} | ${perRoundOf(trig, b, true)} | ${perRoundOf(trig, b, false)} |`,
      );
    const teeth = deltas.filter((x) => x.d >= 3).length;
    // brackets only (ALL is a pooled row, and Value-Gate rule 5 forbids a
    // pooled call)
    const pairedTeeth = pairedDeltas.filter(
      (x) => x.b !== "ALL" && x.d >= 3,
    ).length;
    L.push(
      `\nraw outcome (task definition): ${
        teeth >= 2
          ? `≥3 pp in ${teeth} brackets (${deltas
              .filter((x) => x.d >= 3)
              .map((x) => `${x.b} ${x.d.toFixed(1)}`)
              .join(", ")})`
          : `≥3 pp in ${teeth} bracket(s)`
      }`,
    );
    L.push(
      `confound-controlled (within-round paired, difference in differences): ${
        pairedTeeth >= 2
          ? `≥3 pp in ${pairedTeeth} brackets (${pairedDeltas
              .filter((x) => x.b !== "ALL" && x.d >= 3)
              .map((x) => `${x.b} ${x.d.toFixed(1)}`)
              .join(", ")})`
          : `≥3 pp in ${pairedTeeth} bracket(s)`
      }`,
    );
    L.push(
      `\n**verdict: ${pairedTeeth >= 2 ? "HAS TEETH" : "FLAT"}** — the confound-controlled column is the one that decides, because the raw one is mechanically satisfied by cooldown LENGTH.\n`,
    );
  };

  // O1
  const o1denom = all.filter(
    (w) => w.punishable && w.band === ">60" && w.majorsSpent >= 1,
  );
  section(
    "O1 — two or more majors spent while the pressured friendly never went under 60%",
    "trigger `majorsSpent ≥ 2` ∧ min HP > 60; control: the same band, exactly ONE major spent. Both arms restricted to PUNISHABLE windows (≥1 spend with a known cooldown, and a later feasible window in the round exists) so the outcome is reachable on both sides.",
    o1denom.filter((w) => w.majorsSpent >= 2),
    o1denom.filter((w) => w.majorsSpent === 1),
    o1denom,
  );

  // O2
  const o2denom = all.filter((w) => w.punishable && w.weak);
  section(
    `O2 — a ≥${LONG_CD_SECONDS} s cooldown spent on a weak window`,
    `"weak" = one lead CD, no extras, nobody died, min HP > 60. trigger: at least one spent CD with base cooldown ≥ ${LONG_CD_SECONDS} s; control: weak windows where a major was spent but all of them were shorter. Both arms punishable-restricted.`,
    o2denom.filter((w) => w.hasLongCd),
    o2denom.filter((w) => !w.hasLongCd),
    o2denom,
  );

  // O3 — top quartile spendWeightS within its own severity band
  const o3denom = all.filter((w) => w.punishable && w.band !== null);
  const p75ByBand = new Map<Band, number>();
  for (const b of BANDS) {
    const v = o3denom
      .filter((w) => w.band === b)
      .map((w) => w.spendWeightS)
      .sort((x, y) => x - y);
    p75ByBand.set(b, v.length ? v[Math.floor(0.75 * v.length)]! : Infinity);
  }
  L.push(
    `<!-- O3 band p75 of spendWeightS: ${BANDS.map((b) => `${b}=${p75ByBand.get(b)}s`).join(", ")} -->\n`,
  );
  section(
    "O3 — top-quartile cooldown weight spent, within its own severity band",
    `trigger: \`spendWeightS\` at or above its band's p75 (${BANDS.map((b) => `${b}: ${p75ByBand.get(b)}s`).join(", ")}); control: the rest of the band. Both arms punishable-restricted.`,
    o3denom.filter((w) => w.spendWeightS >= p75ByBand.get(w.band!)!),
    o3denom.filter((w) => w.spendWeightS < p75ByBand.get(w.band!)!),
    o3denom,
  );

  const outPath = flag("--out");
  const text = L.join("\n") + "\n";
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.error(`wrote ${outPath}`);
  } else process.stdout.write(text);
}

// ────────────────────────────────────────────────────────────── gradient ───
/**
 * Skill gradient for `slow-defensive-response` on its OWN denominator
 * (GH #60 tail, 2026-09-02). MEASUREMENT ONLY — nothing here is wired into
 * the product and no threshold is derived from it.
 *
 * Denominator: the candidate's exact opportunity population — a bounded
 * window that is `feasible` AND `triaged` AND at least
 * `BURST_WINDOW_MIN_JUDGED_S` long AND whose resolved reference cell clears
 * the minimum-contrast door (the same four doors `burstWindowResponseEvents`
 * applies before its per-round cap, read off the scan rows the shared engine
 * produced). Trigger: such a window going unanswered within 8 s. The rate is
 * per WINDOW (windows unanswered ÷ windows that were a real opportunity),
 * i.e. the opportunity-normalised form the Value-Gate rules require.
 *
 * Rank axis: rating percentile within (bracket, ISO week) — the house
 * convention (`../src/explore/ratingPercentile.ts`), NOT absolute rating and
 * NOT the fixed `RATING_BUCKETS` — with the `signalSkillGradient` reading:
 * a negative top10−<30 gap (better players leave fewer opportunities
 * unanswered) is consistent with a teachable mistake; flat or positive is a
 * red flag on the predicate. Brackets are never pooled (Simpson).
 *
 * The retired predicate's "+15.3 pp opportunity-normalised" line
 * (docs/coaching-grounding-audit.md §F.5) was a WIN/LOSS conversion contrast
 * on the old window definition — a different axis (outcome, circular) and a
 * different denominator; it is not comparable number-for-number, which is
 * exactly why this command exists.
 */
function gradient(): void {
  const inPath = flag("--in");
  const ledgerDir = flag("--ledger");
  if (!inPath || !ledgerDir) {
    console.error(
      "usage: gradient --in <file.jsonl> --ledger <dir> [--md <out>]",
    );
    process.exit(1);
  }
  const { rows, rounds } = readRows(inPath);
  const ledger = loadLedger(ledgerDir);
  const pctOf = rankLedger(ledger);

  interface Opp {
    bracket: string;
    band: string;
    unanswered: boolean;
    roundKey: string;
  }
  const opps: Opp[] = [];
  let noRank = 0;
  for (const r of rows) {
    const p = r.point;
    if (!p.feasible || !p.triaged) continue;
    if (p.durationSec < BURST_WINDOW_MIN_JUDGED_S) continue;
    const ref = lookupBurstWindowPrior(r.bracket, p.leadCd.spellId);
    if (ref === null || !burstRefClearsMinContrast(ref)) continue;
    const pct = pctOf.get(r.matchId);
    if (pct == null) {
      noRank++;
      continue;
    }
    opps.push({
      bracket: r.bracket,
      band: bandOfPct(pct),
      unanswered: !p.responded,
      roundKey: `${r.matchId}|${r.seq}`,
    });
  }

  const L: string[] = [];
  L.push(
    `# slow-defensive-response — skill gradient on the NEW denominator (2026-09-02)\n`,
  );
  L.push(
    `Denominator: feasible ∧ triaged ∧ ≥ ${BURST_WINDOW_MIN_JUDGED_S}s ∧ contrast-door windows (the candidate's own opportunity population). Trigger: unanswered within 8 s. Rate per window. Rank: rating percentile within (bracket, ISO week).\n`,
  );
  L.push(
    `rounds ${rounds.length}, opportunity windows ${opps.length + noRank}, of which ${noRank} without a ledger rank (excluded).\n`,
  );
  L.push(
    `Reading: NEGATIVE (top10 lower than <30) = higher-ranked teams leave fewer opportunity windows unanswered — consistent with a teachable mistake. Flat/positive = red flag. Old form's +15.3 pp was a win/loss conversion on the OLD window definition — different axis, not comparable number-for-number.\n`,
  );
  const brackets = [...new Set(opps.map((o) => o.bracket))].sort();
  for (const b of ["ALL", ...brackets]) {
    const os = b === "ALL" ? opps : opps.filter((o) => o.bracket === b);
    if (!os.length) continue;
    L.push(
      `## ${b}${b === "ALL" ? " (pooled — context only, never the verdict)" : ""} — ${os.length} opportunity windows, ${new Set(os.map((o) => o.roundKey)).size} rounds\n`,
    );
    L.push(`| band | opportunity windows | unanswered | rate | 95% CI |`);
    L.push(`|---|---|---|---|---|`);
    const rate = new Map<string, number>();
    for (const band of [...PCT_BANDS].reverse()) {
      const bs = os.filter((o) => o.band === band);
      const k = bs.filter((o) => o.unanswered).length;
      const ci = wilson95(k, bs.length);
      rate.set(band, bs.length ? k / bs.length : NaN);
      L.push(
        `| ${band === "top10" ? "≥90" : band} | ${bs.length} | ${k} | ${bs.length ? ((100 * k) / bs.length).toFixed(1) + "%" : "—"} | ${ci ? `[${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}]` : "—"} |`,
      );
    }
    const g = rate.get("top10")! - rate.get("<30")!;
    L.push(
      `\ngradient (≥90 − <30): ${isNaN(g) ? "—" : `${g >= 0 ? "+" : ""}${(100 * g).toFixed(1)} pp`}\n`,
    );
  }
  const outPath = flag("--md");
  const text = L.join("\n") + "\n";
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.error(`wrote ${outPath}`);
  } else process.stdout.write(text);
}

if (cmd === "scan") await scan();
else if (cmd === "examples") await examples();
else if (cmd === "sweep") await sweep();
else if (cmd === "report") report();
else if (cmd === "overreact") overreact();
else if (cmd === "emit-table") await emitTable();
else if (cmd === "gradient") gradient();
else {
  console.error(
    "usage: burstWindowScan.ts scan|sweep|report|emit-table|examples|overreact|gradient ...",
  );
  process.exit(1);
}
