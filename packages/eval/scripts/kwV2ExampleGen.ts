/** kwV2ExampleGen.ts — GH #31 ① value-gate example generator (THROWAWAY).
 * Renders the REDESIGNED [KILL WINDOW] line for real 3v3 matches: burst
 * anchor + killability gates (canonical offensive CD ready; target reachable
 * by an attacker; enemy-healer state as a FACT). Product predicates only. */
import { ensureAnalysisData, extractMajorCooldowns } from "@gladlog/analysis";
import { enemyHealerCcWindows } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { cdAvailableAt } from "@gladlog/analysis/src/utils/cooldowns";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { getUnitPositionAtTime } from "@gladlog/analysis/src/utils/losAnalysis";
import {
  computeBurstSubWindows,
  computeOffensiveWindows,
} from "@gladlog/analysis/src/utils/offensiveWindows";
import { LOS_SWEEP_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { canReachTargetAt } from "@gladlog/analysis/src/utils/rootReachability";
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
const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const num = (f: string, d: number) => Number(flag(f) ?? d);

function loadLedger(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.id) out.set(String(r.id), r); } catch { /* torn */ }
    }
  }
  return out;
}

async function main() {
  await ensureAnalysisData();
  const ledger = loadLedger(flag("--ledger")!);
  let files = readFileSync(flag("--manifest")!, "utf8").split("\n").map(s => s.trim()).filter(Boolean);
  files = files.slice(num("--offset", 0), num("--offset", 0) + num("--limit", 40));
  const examples: Array<{ score: number; text: string }> = [];
  let scanned = 0, bursts = 0, killable = 0;
  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    const meta = ledger.get(matchId);
    if (!meta?.startTime || meta.startTime < PATCH_121_GOLIVE_EPOCH_MS) continue;
    let text: string;
    try { text = gunzipSync(readFileSync(path)).toString("utf8"); } catch { continue; }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => { for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r); });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch { continue; }
    scanned++;
    for (const combat of combats) {
      const units: any[] = Object.values(combat?.units ?? {});
      const players = units.filter(u => u.info);
      const friends = players.filter(u => u.reaction === CombatUnitReaction.Friendly);
      const enemies = players.filter(u => u.reaction === CombatUnitReaction.Hostile);
      if (friends.length < 2 || enemies.length < 2) continue;
      const startMs = combat.startTime;
      let windows: any[], hlrWindows: any[];
      try {
        windows = computeOffensiveWindows(enemies, friends, combat);
        hlrWindows = enemyHealerCcWindows(friends, enemies, combat);
      } catch { continue; }
      const teamCds: any[] = [];
      for (const f of friends) {
        try {
          for (const cd of extractMajorCooldowns(f, combat)) {
            if (!OFFENSIVE_CD_SPELL_IDS.has(String(cd.spellId))) continue;
            teamCds.push({ ...cd, ownerName: f.name, owner: f });
          }
        } catch { /* absent */ }
      }
      for (const w of windows) {
        const target = enemies.find(e => e.id === w.targetUnitId);
        if (!target) continue;
        const dmg: Array<{ t: number; amount: number }> = [];
        for (const f of friends)
          for (const e of (f.damageOut ?? []) as any[])
            if (e.destUnitId === w.targetUnitId) {
              const t = (e.timestamp - startMs) / 1000;
              if (t >= w.fromSeconds && t <= w.toSeconds) dmg.push({ t, amount: Math.abs(Number(e.effectiveAmount ?? e.amount ?? 0)) });
            }
        for (const bu of computeBurstSubWindows(dmg, w.fromSeconds, w.toSeconds)) {
          bursts++;
          const tMs = startMs + bu.fromSeconds * 1000;
          // gate a: canonical offensive CD ready at burst start
          const ready = teamCds.filter(cd => cdAvailableAt(cd, bu.fromSeconds));
          // gate b: some friendly DPS attacker can reach target (fail OPEN)
          let reachable = true; let reachKnown = false;
          for (const f of friends) {
            const pos = getUnitPositionAtTime(f, tMs, LOS_SWEEP_GAP_MS);
            if (!pos) continue;
            reachKnown = true;
            if (canReachTargetAt(pos, target, tMs, combat?.startInfo?.zoneId, 40, true) !== false) { reachable = true; break; }
            reachable = false;
          }
          if (!reachKnown) reachable = true;
          // fact c: enemy healer hard-CC overlap with burst
          const hlrLocked = hlrWindows.some((h: any) => h.fromSeconds <= bu.toSeconds && h.toSeconds >= bu.fromSeconds);
          const isKillable = ready.length > 0 && reachable;
          if (isKillable) killable++;
          const deaths: number[] = ((target.deathRecords ?? []) as any[]).map((d: any) => (d.timestamp - startMs) / 1000);
          const died = deaths.some(d => d > bu.fromSeconds && d <= bu.toSeconds + 15);
          const line =
            `${fmtTime(bu.fromSeconds)}–${fmtTime(bu.toSeconds)} [KILL WINDOW] on ${target.name} (no major defensives ` +
            `${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)}): team burst ${(bu.damage / 1000).toFixed(0)}k; ` +
            `offensive CDs ready: ${ready.length ? ready.map((c: any) => c.spellName).join("、") : "none"}; ` +
            `target ${reachable ? "reachable" : "NOT reachable (positions recorded)"}; ` +
            `enemy healer ${hlrLocked ? "hard-CC'd during burst" : "free"}; killable=${isKillable ? "yes" : "no"}`;
          const score = (isKillable ? 4 : 0) + (hlrLocked ? 2 : 0) + Math.min(3, bu.damage / 100000) + (died ? 1 : 0);
          examples.push({ score, text: `match ${matchId} (${meta.bracket} ${meta.playerTeamRating}) died15=${died}\n  ${line}` });
        }
      }
    }
  }
  console.log(`scanned=${scanned} bursts=${bursts} killable=${killable} (${(100 * killable / Math.max(1, bursts)).toFixed(1)}%)`);
  examples.sort((a, b) => b.score - a.score);
  for (const e of examples.slice(0, 6)) console.log("\n" + e.text);
  console.log("\n=== killable=no counter-examples (the previously unadjudicable false positives) ===");
  const nos = examples.filter((e) => e.text.includes("killable=no"));
  for (const e of nos.slice(0, 3)) console.log("\n" + e.text);
}
main().catch(e => { console.error(e); process.exit(1); });
