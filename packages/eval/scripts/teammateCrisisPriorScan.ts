/**
 * teammateCrisisPriorScan.ts — build the `teammate-crisis-idle` reference
 * table (GH #95, 2026-09-17) from the archive, through the SAME predicate the
 * candidate uses (`teammateCrisisPoints`, analysis/teammateCrisis.ts).
 *
 * Replaces the probe-era scripts (`teammateCrisisAnswerProbe.ts` measured
 * the incidence for the user ruling with an inline copy of the rules; this
 * one consumes the shipped predicate so the table can never drift from the
 * card).
 *
 *   scan        tsx teammateCrisisPriorScan.ts scan --manifest <m> [--every N] [--shard i --shards n] --out <rows.jsonl>
 *   report      tsx teammateCrisisPriorScan.ts report --in <rows.jsonl>
 *   emit-table  tsx teammateCrisisPriorScan.ts emit-table --in <rows.jsonl> [--corpus <label>] --out <file.json>
 *
 * `report` also answers the user's 2026-09-17 question 4 ("治疗在救别人时这个队友
 * 掉了 — 要看另外一个队友是否危险"): the busyElsewhere points split by whether
 * the healer's in-window cast went to a friendly at or under the crisis line.
 *
 * Baseline (1/10 archive, 11,536 rounds, probe c07796b5): 29,925 dangerous
 * teammate points; 60 clean idle (0.0052 / round), teammate died within 10 s
 * 77 %; answered comparator 7–13 % by bracket × severity.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { teammateCrisisPoints } from "@gladlog/analysis/src/analysis/teammateCrisis";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import {
  buildTeammateCrisisPriorTable,
  type TeammateCrisisPriorRow,
} from "../src/explore/teammateCrisisPriorTable";

const a = process.argv.slice(2);
const cmd = a[0];
const flag = (k: string): string | undefined => {
  const i = a.indexOf(k);
  return i >= 0 ? a[i + 1] : undefined;
};

interface ScanRow extends TeammateCrisisPriorRow {
  matchId: string;
  tSec: number;
  idleReason: string | null;
  mateResponded: boolean;
  busyOnInCrisis: boolean;
  busyOnHpPct: number | null;
  /** which side had already lost a player at t (rows scanned since
   * 2026-09-19) — lets a narrower `priorDeath` reading be re-derived from the
   * rows without another archive scan */
  priorDeathSide?: string | null;
}

async function scan(): Promise<void> {
  const manifest = flag("--manifest");
  const out = flag("--out");
  if (!manifest || !out) {
    console.error(
      "usage: scan --manifest <m> --out <rows.jsonl> [--every N] [--shard i --shards n]",
    );
    process.exit(1);
  }
  const every = Number(flag("--every") ?? "1");
  const shard = Number(flag("--shard") ?? "0");
  const shards = Number(flag("--shards") ?? "1");
  await ensureAnalysisData();
  const files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0)
    .filter((_, i) => i % shards === shard);
  writeFileSync(out, "");
  let done = 0;
  for (const f of files) {
    const parser = new GladLogParser();
    const items: GladMatch[] = [];
    parser.on("match", (m) => items.push(m));
    parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
    let text: string;
    try {
      const raw = readFileSync(resolve(f));
      text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
    const lines: string[] = [];
    for (const m of items) {
      let legacy: any;
      try {
        legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
      } catch {
        continue;
      }
      const bracket = String(legacy.startInfo?.bracket ?? "?");
      const matchId = String(legacy.id ?? m.id ?? f);
      lines.push(JSON.stringify({ matchId, round: true }));
      for (const owner of (Object.values(legacy.units ?? {}) as any[]).filter(
        (u) => u.info && isHealerSpec(u.spec),
      )) {
        let pts;
        try {
          pts = teammateCrisisPoints(owner, legacy);
        } catch {
          continue;
        }
        for (const p of pts) {
          const row: ScanRow = {
            matchId,
            bracket,
            tSec: p.tSec,
            dmg2s: p.dmg2s,
            excluded: p.excluded,
            priorDeathSide: p.priorDeathSide,
            healerAnswered: p.healerAnswered,
            cleanIdle: p.cleanIdle,
            idleReason: p.idleReason,
            mateResponded: p.mateResponded,
            busyOnInCrisis: p.busyOnInCrisis,
            busyOnHpPct: p.busyOn?.hpPct ?? null,
            diedWithin10s: p.diedWithin10s,
          };
          lines.push(JSON.stringify(row));
        }
      }
    }
    if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
    done++;
    if (done % 200 === 0) console.error(`[scan] ${done}/${files.length} files`);
  }
  console.error(`[scan] done ${done}/${files.length} → ${out}`);
}

function readRows(inPath: string): { rows: ScanRow[]; rounds: number } {
  const rows: ScanRow[] = [];
  let rounds = 0;
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      if (r.round) rounds++;
      else rows.push(r);
    } catch {
      /* torn line */
    }
  }
  return { rows, rounds };
}

function report(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <rows.jsonl>");
    process.exit(1);
  }
  const { rows, rounds } = readRows(inPath);
  const count = (f: (r: ScanRow) => boolean) => rows.filter(f).length;
  const died = (f: (r: ScanRow) => boolean) =>
    rows.filter((r) => f(r) && r.diedWithin10s).length;
  const comparator = rows.filter((r) => r.excluded === null);
  const idle = comparator.filter((r) => r.cleanIdle);
  const answered = comparator.filter((r) => r.healerAnswered);
  const busy = comparator.filter((r) => r.idleReason === "busyElsewhere");
  const byKey = (xs: ScanRow[], key: (r: ScanRow) => string) => {
    const m: Record<string, { n: number; died: number }> = {};
    for (const r of xs) {
      const k = key(r);
      const c = (m[k] ??= { n: 0, died: 0 });
      c.n++;
      if (r.diedWithin10s) c.died++;
    }
    return m;
  };
  const summary = {
    rounds,
    points: rows.length,
    excludedBy: byKey(
      rows.filter((r) => r.excluded !== null),
      (r) => r.excluded!,
    ),
    /** user ruling 2026-09-19: what the `priorDeath` exclusion removed, by
     * the side that was already a player down (points no OLDER exclusion
     * had already taken) */
    priorDeath: Object.fromEntries(
      ["friendly", "enemy", "both"].map((side) => {
        const xs = rows.filter(
          (r) => r.excluded === "priorDeath" && r.priorDeathSide === side,
        );
        return [
          side,
          {
            n: xs.length,
            wouldBeCleanIdle: xs.filter(
              (r) =>
                !r.healerAnswered && !r.mateResponded && r.idleReason === null,
            ).length,
            wouldBeAnswered: xs.filter((r) => r.healerAnswered).length,
          },
        ];
      }),
    ),
    comparator: comparator.length,
    cleanIdle: { n: idle.length, died: died((r) => r.cleanIdle) },
    cleanIdlePerRound: rounds ? idle.length / rounds : null,
    answered: {
      n: answered.length,
      died: died((r) => r.excluded === null && r.healerAnswered),
    },
    idleReasons: byKey(
      comparator.filter((r) => !r.healerAnswered && r.idleReason),
      (r) => r.idleReason!,
    ),
    /** user question 4: healer busy on someone else — was that someone in
     * crisis (≤ 40 % at the cast)? */
    busyElsewhere: {
      n: busy.length,
      otherInCrisis: {
        n: count(
          (r) =>
            r.excluded === null &&
            r.idleReason === "busyElsewhere" &&
            r.busyOnInCrisis,
        ),
        died: died(
          (r) =>
            r.excluded === null &&
            r.idleReason === "busyElsewhere" &&
            r.busyOnInCrisis,
        ),
      },
      otherNotInCrisis: {
        n: count(
          (r) =>
            r.excluded === null &&
            r.idleReason === "busyElsewhere" &&
            !r.busyOnInCrisis &&
            r.busyOnHpPct !== null,
        ),
        died: died(
          (r) =>
            r.excluded === null &&
            r.idleReason === "busyElsewhere" &&
            !r.busyOnInCrisis &&
            r.busyOnHpPct !== null,
        ),
      },
      otherHpUnknownOrNotFriendly: count(
        (r) =>
          r.excluded === null &&
          r.idleReason === "busyElsewhere" &&
          !r.busyOnInCrisis &&
          r.busyOnHpPct === null,
      ),
    },
    byBracket: byKey(idle, (r) => r.bracket),
    table: buildTeammateCrisisPriorTable(rows, {
      generatedAt: "",
      corpus: "",
      command: "",
      rows: rows.length,
      nFloor: 0,
      predicateVersion: 2,
    }).cells,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

function emitTable(): void {
  const inPath = flag("--in");
  const out = flag("--out");
  if (!inPath || !out) {
    console.error(
      "usage: emit-table --in <rows.jsonl> --out <file.json> [--corpus <label>]",
    );
    process.exit(1);
  }
  const { rows, rounds } = readRows(inPath);
  const table = buildTeammateCrisisPriorTable(rows, {
    generatedAt: new Date().toISOString().slice(0, 10),
    corpus: flag("--corpus") ?? `${rounds} archived rounds`,
    command:
      "npx tsx packages/eval/scripts/teammateCrisisPriorScan.ts emit-table --in <rows.jsonl> --out <file.json>",
    rows: rows.length,
    nFloor: 50,
    predicateVersion: 2,
  });
  // write to the given path (never straight over the json the analysis
  // package imports while a script that imports it is running)
  writeFileSync(out, JSON.stringify(table, null, 2) + "\n");
  console.error(
    `[emit-table] ${Object.keys(table.cells).length} cells → ${out}`,
  );
}

if (cmd === "scan") await scan();
else if (cmd === "report") report();
else if (cmd === "emit-table") emitTable();
else {
  console.error("usage: teammateCrisisPriorScan.ts scan|report|emit-table ...");
  process.exit(1);
}
