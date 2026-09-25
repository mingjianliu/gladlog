/**
 * syncWindowScan.ts — corpus scan for the REDESIGNED missed-sync-window
 * (GH #13 resurrection attempt, 2026-09-02): per eligible enemy-healer
 * hard-CC window, did a friendly canonical offensive CD enter it, and did
 * an enemy die within 15s of the window opening?
 *
 * Eligible window (THIS is the predicate the product side must share):
 *   - enemyHealerCcWindows (product function, hard-CC on enemy healer)
 *   - rendered duration >= 3s (toRenderSecond grid)
 *   - rendered start t >= 30s (opener/setup windows excluded)
 *   - no enemy death inside [from, to] (a kill already converting without
 *     CDs is not a missed sync)
 *   - feasibility: >=1 canonical offensive CD (OFFENSIVE_CD_SPELL_IDS,
 *     spellDanger.ts) ready at window start (cdAvailableAt)
 * entered = any canonical offensive CD cast in [from-2, to] (2s lead grace,
 *   same as signalOutcomeProbe's healer-locked-window).
 * kill15 = enemy death in (from, from+15].
 *
 * 2026-09-25 (reliability audit B3): the eligibility / ready / entered tests
 * are no longer copied here — the scan runs the product's own
 * `mergeHealerCcWindows` + `syncWindowEligible` + `evaluateSyncWindow`
 * (cooldownTiming.ts): one continuous lock = one window (B3ii), a ready CD
 * needs an owner free for ≥ REACTION_WINDOW_S of it (B3i), and a burst still
 * active at the lock counts as entered (B3iii); the DR labels the windows are
 * filtered on come from the apply-order engine (B3iv).
 *
 * scan   tsx syncWindowScan.ts scan --manifest <f> --ledger <dir> --out <f.jsonl> [--offset N] [--limit N]
 * report tsx syncWindowScan.ts report --in <f.jsonl>
 */
import {
  ensureAnalysisData,
  extractMajorCooldowns,
  toRenderSecond,
} from "@gladlog/analysis";
import {
  enemyHealerCcWindows,
  enemyMinHpPctInWindow,
  evaluateSyncWindow,
  mergeHealerCcWindows,
  syncWindowEligible,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { gunzipSync } from "zlib";

import { isoWeek, rankLedger } from "../src/explore/ratingPercentile";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

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
        /* torn/unparseable — skip */
      }
    }
  }
  return out;
}

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest")!;
  const ledgerDir = flag("--ledger")!;
  const out = flag("--out")!;
  await ensureAnalysisData();
  const ledger = loadLedger(ledgerDir);
  const pctOf = rankLedger(ledger);
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        done.add(JSON.parse(l).matchId);
      } catch {
        /* torn/unparseable — skip */
      }
    }
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (limit) files = files.slice(0, limit);

  let scanned = 0,
    rows = 0;
  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    if (done.has(matchId)) continue;
    const meta = ledger.get(matchId);
    if (!meta?.startTime || meta.startTime < PATCH_121_GOLIVE_EPOCH_MS)
      continue;
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
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
      continue;
    }
    scanned++;
    const lines: string[] = [];
    let seq = 0;
    for (const combat of combats) {
      const mySeq = combats.length > 1 ? seq++ : null;
      const units: any[] = Object.values(combat?.units ?? {});
      const players = units.filter((u) => u.info);
      const friends = players.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      );
      const enemies = players.filter(
        (u) => u.reaction === CombatUnitReaction.Hostile,
      );
      if (friends.length < 2 || enemies.length < 2) continue;
      const startMs: number = combat.startTime;
      const enemyDeathS: number[] = enemies
        .flatMap((u: any) =>
          (u.deathRecords ?? []).map(
            (d: any) => (d.timestamp - startMs) / 1000,
          ),
        )
        .sort((a: number, b: number) => a - b);
      let windows: any[];
      try {
        windows = mergeHealerCcWindows(
          enemyHealerCcWindows(friends, enemies, combat),
        );
      } catch {
        continue;
      }
      const enemyIdSet = new Set<string>(enemies.map((u: any) => u.id));
      const enemyAndPetIds = new Set<string>([
        ...enemyIdSet,
        ...units
          .filter((u: any) => u.ownerId && enemyIdSet.has(u.ownerId))
          .map((u: any) => u.id as string),
      ]);
      if (!windows.length) continue;
      const teamCds: any[] = [];
      for (const f of friends) {
        try {
          for (const cd of extractMajorCooldowns(f, combat)) {
            if (!OFFENSIVE_CD_SPELL_IDS.has(String(cd.spellId))) continue;
            teamCds.push({
              ...cd,
              owner: f,
              ownerEnemyIds: enemyAndPetIds,
              matchStartMs: startMs,
            });
          }
        } catch {
          /* torn/unparseable — skip */
        }
      }
      for (const w of windows) {
        if (!syncWindowEligible(w, enemyDeathS)) continue;
        const t = toRenderSecond(w.fromSeconds);
        const durR = toRenderSecond(w.toSeconds) - t;
        const { ready, entered } = evaluateSyncWindow(w, teamCds);
        if (!ready.length) continue;
        const kill15 = enemyDeathS.some(
          (d) => d > w.fromSeconds && d <= w.fromSeconds + 15,
        );
        let minHp: number | null = null;
        try {
          minHp = enemyMinHpPctInWindow(
            enemies,
            combat,
            w.fromSeconds,
            w.toSeconds,
          );
        } catch {
          /* torn/unparseable — skip */
        }
        lines.push(
          JSON.stringify({
            matchId,
            seq: mySeq,
            bracket: meta.bracket ?? "?",
            week: isoWeek(meta.startTime),
            rating: meta.playerTeamRating ?? null,
            pct: pctOf.get(matchId) ?? null,
            t,
            durR,
            cc: w.spellName,
            ccId: w.spellId,
            healer: w.healerName,
            readyN: ready.length,
            entered,
            kill15,
            minHp,
          }),
        );
        rows++;
      }
    }
    if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 200 === 0)
      console.log(`progress: scanned=${scanned} rows=${rows}`);
  }
  console.log(`done: scanned=${scanned} rows=${rows}`);
}

function report(): void {
  const inPath = flag("--in")!;
  const rows: any[] = [];
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      /* torn/unparseable — skip */
    }
  }
  const pctBin = (p: number | null): string =>
    p === null
      ? "?"
      : p < 30
        ? "<30"
        : p < 70
          ? "30-70"
          : p < 90
            ? "70-90"
            : ">=90";
  const agg = (rs: any[]): string => {
    const ent = rs.filter((r) => r.entered);
    const un = rs.filter((r) => !r.entered);
    const k = (xs: any[]) => xs.filter((r) => r.kill15).length;
    const pc = (n: number, d: number) =>
      d ? ((100 * n) / d).toFixed(1) + "%" : "—";
    return `n=${rs.length} entered=${pc(ent.length, rs.length)} | kill15·entered=${pc(k(ent), ent.length)} (${k(ent)}/${ent.length}) kill15·unentered=${pc(k(un), un.length)} (${k(un)}/${un.length}) Δ=${
      ent.length && un.length
        ? ((100 * k(ent)) / ent.length - (100 * k(un)) / un.length).toFixed(1) +
          "pp"
        : "—"
    }`;
  };
  const brackets = [...new Set(rows.map((r) => r.bracket))].sort();
  console.log("## per bracket");
  for (const b of brackets)
    console.log(`${b}: ${agg(rows.filter((r) => r.bracket === b))}`);
  console.log(`ALL: ${agg(rows)}`);
  console.log("\n## per bracket x rating percentile bin");
  for (const b of brackets)
    for (const bin of ["<30", "30-70", "70-90", ">=90"]) {
      const rs = rows.filter((r) => r.bracket === b && pctBin(r.pct) === bin);
      if (rs.length) console.log(`${b} pct ${bin}: ${agg(rs)}`);
    }
  console.log("\n## density");
  const byMatch = new Map<string, number>();
  for (const r of rows)
    byMatch.set(r.matchId, (byMatch.get(r.matchId) ?? 0) + 1);
  console.log(
    `matches-with-eligible-windows=${byMatch.size} windows/matchAvg=${(rows.length / Math.max(1, byMatch.size)).toFixed(2)} unentered-share=${((100 * rows.filter((r) => !r.entered).length) / rows.length).toFixed(1)}%`,
  );
}

/** emit-table: per-bracket reference cells for the product json. Writes to
 * stdout — redirect to a TEMP file and cp over the imported json
 * (update-wow-data temp-then-cp rule), never `>` directly. */
function emitTable(): void {
  const inPath = flag("--in")!;
  const corpus = flag("--corpus") ?? "unknown";
  const rows: any[] = [];
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      /* torn/unparseable — skip */
    }
  }
  const cells: Record<
    string,
    {
      nEntered: number;
      nUnentered: number;
      killEntered: number;
      killUnentered: number;
    }
  > = {};
  for (const r of rows) {
    const c = (cells[r.bracket] ??= {
      nEntered: 0,
      nUnentered: 0,
      killEntered: 0,
      killUnentered: 0,
    });
    if (r.entered) {
      c.nEntered++;
      if (r.kill15) c.killEntered++;
    } else {
      c.nUnentered++;
      if (r.kill15) c.killUnentered++;
    }
  }
  const outCells: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(cells)) {
    outCells[k] = {
      nEntered: c.nEntered,
      killEntered: c.nEntered ? c.killEntered / c.nEntered : 0,
      nUnentered: c.nUnentered,
      killUnentered: c.nUnentered ? c.killUnentered / c.nUnentered : 0,
    };
  }
  console.log(
    JSON.stringify(
      {
        meta: {
          corpus,
          generatedAt: new Date().toISOString().slice(0, 10),
          windows: rows.length,
          predicate:
            "eligible window: enemyHealerCcWindows merged per healer (mergeHealerCcWindows: one continuous lock = one window), syncWindowEligible (rendered dur>=3s, rendered t>=30s, no enemy death in-window), evaluateSyncWindow: >=1 canonical OFFENSIVE_CD_SPELL_IDS off cooldown at window start whose owner was free to act >= REACTION_WINDOW_S of the lock; entered = such a CD pressed in [from-2s, to] or still active (buffFullDurationForCaster) at the lock start; kill15 = enemy death in (from, from+15s]",
        },
        cells: outCells,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  if (cmd === "scan") await scan();
  else if (cmd === "report") report();
  else if (cmd === "emit-table") emitTable();
  else {
    console.error("usage: scan|report");
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
