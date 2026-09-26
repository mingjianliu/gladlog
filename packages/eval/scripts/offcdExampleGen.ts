/**
 * offcdExampleGen.ts — value-gate example generator (2026-09-02, THROWAWAY).
 * Produces real-match missed-sync-window candidate lines (the redesigned,
 * reference-quoting form) so the user can judge the signal on one output
 * example before any product wiring. Reuses the product's own predicates:
 * enemyHealerCcWindows + missedSyncWindowEvents + extractMajorCooldowns.
 */
import {
  ensureAnalysisData,
  extractMajorCooldowns,
} from "@gladlog/analysis";
import {
  enemyHealerCcWindows,
  enemyMinHpPctInWindow,
  missedSyncWindowEvents,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { lookupSyncWindowPrior } from "@gladlog/analysis/src/data/syncWindowPrior";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
export const parseNonNegativeInt = (
  name: string,
  defaultVal: number,
  argvList = argv,
): number => {
  const i = argvList.indexOf(name);
  const raw = i >= 0 ? argvList[i + 1] : undefined;
  if (raw === undefined) return defaultVal;
  const val = Number(raw);
  if (!Number.isInteger(val) || val < 0) {
    throw new Error(`expected non-negative integer for ${name}, got: ${raw}`);
  }
  return val;
};

function loadLedger(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.id) out.set(String(r.id), r);
      } catch { /* torn/unparseable — skip */ }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const manifestPath = flag("--manifest");
  if (!manifestPath) {
    console.error("missing required --manifest <path>");
    process.exit(1);
  }
  const ledgerDir = flag("--ledger");
  if (!ledgerDir) {
    console.error("missing required --ledger <dir>");
    process.exit(1);
  }
  const offset = parseNonNegativeInt("--offset", 0);
  const limit = parseNonNegativeInt("--limit", 40);
  await ensureAnalysisData();
  const ledger = loadLedger(ledgerDir);
  let files = readFileSync(manifestPath, "utf8")
    .split("\n").map((s) => s.trim()).filter(Boolean);
  files = files.slice(offset, offset + limit);

  interface Ex { score: number; text: string }
  const examples: Ex[] = [];
  let scanned = 0;
  let readFiles = 0;
  let skippedFiles = 0;

  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    const meta = ledger.get(matchId);
    if (!meta?.startTime || meta.startTime < PATCH_121_GOLIVE_EPOCH_MS) continue;
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch (err) {
      skippedFiles++;
      process.stderr.write(
        `[warn] failed to read ${path}: ${err instanceof Error ? err.message : String(err)}, skipping\n`,
      );
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
    } catch (err) {
      skippedFiles++;
      process.stderr.write(
        `[warn] failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}, skipping\n`,
      );
      continue;
    }
    readFiles++;
    scanned++;

    for (const combat of combats) {
      const units: any[] = Object.values(combat?.units ?? {});
      const players = units.filter((u) => u.info);
      const friends = players.filter((u) => u.reaction === CombatUnitReaction.Friendly);
      const enemies = players.filter((u) => u.reaction === CombatUnitReaction.Hostile);
      if (friends.length < 2 || enemies.length < 2) continue;
      const startMs: number = combat.startTime;
      const enemyDeathS: number[] = enemies
        .flatMap((u: any) => (u.deathRecords ?? []).map(
          (d: any) => (d.timestamp - startMs) / 1000))
        .sort((a: number, b: number) => a - b);
      let ccWindows: any[];
      try {
        ccWindows = enemyHealerCcWindows(friends, enemies, combat)
          .filter((w: any) => w.toSeconds - w.fromSeconds >= 3);
      } catch { continue; }
      if (!ccWindows.length) continue;
      const teamOffensiveCds: any[] = [];
      for (const f of friends) {
        try {
          for (const cd of extractMajorCooldowns(f, combat)) {
            if (!OFFENSIVE_CD_SPELL_IDS.has(String(cd.spellId))) continue;
            teamOffensiveCds.push({ ...cd, ownerName: f.name });
          }
        } catch { /* torn/unparseable — skip */ }
      }
      if (!teamOffensiveCds.length) continue;
      let evs: any[];
      try {
        // Post-resurrection signature (2026-09-02): mirror production wiring.
        evs = missedSyncWindowEvents(ccWindows, teamOffensiveCds, {
          enemyMinHpPctAt: (from: number, to: number) =>
            enemyMinHpPctInWindow(enemies, combat, from, to),
          enemyDeathS: enemies
            .flatMap((e: any) => (e.deathRecords ?? []) as any[])
            .map((d: any) => (d.timestamp - startMs) / 1000),
          ref: lookupSyncWindowPrior(meta.bracket ?? ""),
        });
      } catch { continue; }
      for (const ev of evs) {
        const f = ev.facts;
        if (Number(f.t) < 30) continue; // opener setup windows excluded
        const dur = Number(f.durationS);
        const minHp = f.enemyMinHpPct !== undefined ? Number(f.enemyMinHpPct) : null;
        const windowEnd = Number(f.windowEndT);
        const killAfter = enemyDeathS.some(
          (d) => d > windowEnd && d <= windowEnd + 15);
        const nReady = String(f.readyCds).split("、").length;
        // prefer: long window, low enemy HP, several ready CDs
        if (minHp !== null && (minHp < 25 || minHp > 85)) continue; // kill already happening / no pressure at all
        const score = dur * 2 + (minHp !== null ? (100 - minHp) / 10 : 0) + nReady * 3;
        const line =
          `${fmtTime(Number(f.t))} [MISSED-SYNC] enemy healer ${f.healer} ` +
          `hard-CC'd by ${f.cc} for ${f.durationS}s; ready offensive CDs: ${f.readyCds}; ` +
          (minHp !== null ? `enemy team bottomed at ${minHp}% in-window; ` : "") +
          `no friendly offensive CD entered the window. ` +
          `Ref(3v3): windows a CD entered → enemy death ≤15s 17.8%, ` +
          `unentered 7.6% (corpus n=671).`;
        examples.push({
          score,
          text:
            `match ${matchId} rating ${meta.playerTeamRating ?? "?"} ` +
            `dur ${combat.endTime && startMs ? Math.round((combat.endTime - startMs) / 1000) : "?"}s ` +
            `killWithin15sOfWindowEnd=${killAfter}\n  ${line}`,
        });
      }
    }
  }
  examples.sort((a, b) => b.score - a.score);
  console.log(
    `scanned=${scanned} readFiles=${readFiles} skippedFiles=${skippedFiles} candidates=${examples.length}`,
  );
  for (const e of examples.slice(0, 8)) console.log("\n" + e.text);
}
if (process.argv[1]?.includes("offcdExampleGen")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
