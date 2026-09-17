/**
 * teammateCrisisHandRead.ts — hand-read helper for one `teammate-crisis-idle`
 * card (GH #95 value gate, 2026-09-17): for one archive file + owner name,
 * print every clean-idle teammate crisis point with the healer's casts and
 * cast starts ±6 s, auras applied to the healer (CC?), enemy offensive-CD
 * casts in the 8 s before, the mate's death time and HP samples after t —
 * everything a human needs to say "yes, the healer really did nothing here"
 * or to name the innocent explanation the predicate missed.
 *
 * Usage: npx tsx packages/eval/scripts/teammateCrisisHandRead.ts <archive.txt.gz> <owner name>
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CRISIS_OFFENSIVE_CD_IDS,
  ENEMY_BURST_LOOKBACK_MS,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { teammateCrisisPoints } from "@gladlog/analysis/src/analysis/teammateCrisis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const [file, ownerName] = process.argv.slice(2);
if (!file || !ownerName) {
  console.error(
    "usage: teammateCrisisHandRead.ts <archive.txt.gz> <owner name>",
  );
  process.exit(1);
}
await ensureAnalysisData();
const parser = new GladLogParser();
const items: GladMatch[] = [];
parser.on("match", (m) => items.push(m));
parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
const raw = readFileSync(file);
const text = (file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
for (const line of text.split("\n")) parser.push(line);
parser.end();
const nm = (id: string) => getEnglishSpellName(id, "") || id;
for (const m of items) {
  const legacy: any = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
  const owner = (Object.values(legacy.units) as any[]).find(
    (u) => u.name === ownerName,
  );
  if (!owner) continue;
  const rel = (ms: number) => ((ms - legacy.startTime) / 1000).toFixed(1);
  console.log(
    `round ${rel(legacy.endTime)}s bracket ${legacy.startInfo?.bracket} zone ${legacy.zoneId}`,
  );
  // sanity: how many enemy offensive-CD casts does the whole round carry?
  let enemyOffensiveCasts = 0;
  for (const e of Object.values(legacy.units) as any[]) {
    if (!e.info || e.reaction === owner.reaction) continue;
    for (const c of (e.spellCastEvents ?? []) as any[])
      if (CRISIS_OFFENSIVE_CD_IDS.has(String(c.spellId))) enemyOffensiveCasts++;
  }
  console.log(
    `offensive-CD id set size ${CRISIS_OFFENSIVE_CD_IDS.size}; enemy offensive-CD casts this round ${enemyOffensiveCasts}`,
  );
  const pts = teammateCrisisPoints(owner, legacy);
  for (const p of pts) {
    if (!p.cleanIdle) continue;
    console.log(
      `\n== clean idle: mate ${p.mateName} t=${p.tSec} hp=${p.hpPct} dmg2s=${p.dmg2s} dist=${p.distanceYd} mana=${p.manaPct} burst=${JSON.stringify(p.enemyBurst)} ext=${p.externalsReady.map((e) => e.spellName).join("/")}`,
    );
    const mate = legacy.units[p.mateId];
    const w0 = p.tMs - 6000;
    const w1 = p.tMs + 6000;
    console.log("healer casts ±6 s:");
    for (const c of (owner.spellCastEvents ?? []) as any[])
      if (c.timestamp >= w0 && c.timestamp <= w1)
        console.log(
          `  ${rel(c.timestamp)} ${c.logLine?.event} ${nm(String(c.spellId))} -> ${legacy.units[c.destUnitId]?.name ?? c.destUnitId}`,
        );
    for (const c of (owner.castStartEvents ?? []) as any[])
      if (c.timestamp >= w0 && c.timestamp <= w1)
        console.log(`  ${rel(c.timestamp)} START ${nm(String(c.spellId))}`);
    console.log("auras applied to the healer ±6 s:");
    for (const a of (owner.auraEvents ?? []) as any[])
      if (
        a.destUnitId === owner.id &&
        a.timestamp >= w0 &&
        a.timestamp <= w1 &&
        a.logLine?.event === LogEvent.SPELL_AURA_APPLIED
      )
        console.log(
          `  ${rel(a.timestamp)} +${nm(String(a.spellId))} from ${legacy.units[a.srcUnitId]?.name ?? a.srcUnitId}`,
        );
    console.log("enemy offensive-CD casts in the 8 s before:");
    for (const e of Object.values(legacy.units) as any[]) {
      if (!e.info || e.reaction === owner.reaction) continue;
      for (const c of (e.spellCastEvents ?? []) as any[])
        if (
          c.timestamp > p.tMs - ENEMY_BURST_LOOKBACK_MS &&
          c.timestamp <= p.tMs &&
          CRISIS_OFFENSIVE_CD_IDS.has(String(c.spellId))
        )
          console.log(
            `  ${rel(c.timestamp)} ${e.name} ${nm(String(c.spellId))}`,
          );
    }
    const deaths = ((mate?.deathRecords ?? []) as any[]).map((d) =>
      rel(d.timestamp),
    );
    const hpAfter = ((mate?.advancedActions ?? []) as any[])
      .filter((s) => s.timestamp >= p.tMs && s.timestamp <= p.tMs + 8000)
      .map(
        (s) =>
          `${rel(s.timestamp)}:${Math.round((s.advancedActorCurrentHp / s.advancedActorMaxHp) * 100)}%`,
      );
    console.log(
      `mate deaths: ${deaths.join(",") || "none"}; mate hp after t: ${hpAfter.join(" ")}`,
    );
  }
}
