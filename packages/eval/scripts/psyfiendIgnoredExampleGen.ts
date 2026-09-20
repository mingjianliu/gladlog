/**
 * psyfiendIgnoredExampleGen.ts — value-gate step 1 for the ACCUSATION half of
 * the user's 2026-09-20 ruling ("an occasional accusation is fine"). Nothing is
 * wired. It renders the target sentence on real matches and prints the gate
 * funnel, so the user can judge one output before any engine exists
 * (CLAUDE.md Value-Gate Rule 1–3).
 *
 * Target sentence: "the enemy Psyfiend stood for its whole 12 s with 0 damage
 * from your team, while <player> was in range of it and free to act, and
 * nobody on either side was in a position that mattered more."
 *
 * Gates, all reusing product predicates — never a second copy:
 *   presence     enemy Psyfiend, not killed (nonPlayerUnitKill), 0 opposing hits
 *   window       summon → summon + the summoning spell's DB2 duration
 *   position     the Psyfiend has a position sample at all (else UNKNOWN, skip)
 *   reach        some friendly DPS could reach it (canReachTargetAt: melee
 *                12 yd / ranged 40 yd + LoS) for >= REACH_MIN_S of the window
 *   free         that same player was not in cast-blocking CC for those seconds
 *   priority     no enemy player at/below KILL_HP and no friendly at/below the
 *                product's crisis line during the window — a team mid-kill or
 *                mid-rescue had something better to do
 *
 * Usage: npx tsx packages/eval/scripts/psyfiendIgnoredExampleGen.ts --manifest <txt> [--offset 3000] [--limit 300] [--show 6]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CRISIS_HP_PCT } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  nonPlayerUnitKill,
  opposingHitsOnUnit,
  summonedAtMs,
} from "@gladlog/analysis/src/context/timelineHelpers";
import { gridHpPct, specToString } from "@gladlog/analysis/src/utils/cooldowns";
import { summonReach } from "@gladlog/analysis/src/utils/summonReachability";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const PSYFIEND_NPC = "101398";
/** Seconds of the window a player must be both in reach and free. A probe
 * value, reported as a sensitivity row — not a product constant. */
const REACH_MIN_S = [3, 5];
/** "The team was mid-kill": an enemy player this low. Probe value. */
const KILL_HP_PCT = 35;

async function main(): Promise<void> {
  await ensureAnalysisData();
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(Number(flag("--offset") ?? 3000))
    .slice(0, Number(flag("--limit") ?? 300));
  const funnel: Record<string, number> = {
    enemyPsyfiends: 0,
    notKilled: 0,
    zeroHits: 0,
    hasPosition: 0,
  };
  for (const s of REACH_MIN_S) {
    funnel[`reachable+free>=${s}s`] = 0;
    funnel[`…and nothing better to do (>=${s}s)`] = 0;
  }
  const examples: string[] = [];
  let rounds = 0;

  for (const path of files) {
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
      for (const line of text.split(/\r?\n/)) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    for (const combat of combats) {
      rounds++;
      const all: any[] = Object.values(combat.units ?? {});
      const players = all.filter((u) => u.info);
      const friends = players.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      );
      const enemies = players.filter(
        (u) => u.reaction === CombatUnitReaction.Hostile,
      );
      for (const unit of all) {
        if (unit.info || unit.id.split("-")[5] !== PSYFIEND_NPC) continue;
        const owner = all.find((u) => u.id === unit.ownerId);
        if (owner?.reaction !== CombatUnitReaction.Hostile) continue;
        funnel.enemyPsyfiends++;
        if (nonPlayerUnitKill(unit)) continue;
        funnel.notKilled++;
        if (opposingHitsOnUnit(unit, CombatUnitReaction.Hostile).hits > 0)
          continue;
        funnel.zeroHits++;
        const t0 = summonedAtMs(unit);
        if (t0 === null) continue;
        const result = summonReach(unit, combat, friends, enemies);
        if (!result) continue;
        funnel.hasPosition++;

        const seconds: number[] = [];
        for (let k = 0; k < result.windowSeconds; k++) {
          seconds.push(t0 + 500 + k * 1000);
        }
        const betterToDo = seconds.some(
          (t) =>
            enemies.some((e) => {
              const hp = gridHpPct(e, t);
              return hp !== null && hp > 0 && hp <= KILL_HP_PCT;
            }) ||
            friends.some((f) => {
              const hp = gridHpPct(f, t);
              return hp !== null && hp > 0 && hp <= CRISIS_HP_PCT * 100;
            }),
        );
        const best = result.best;
        for (const min of REACH_MIN_S) {
          if (!best || best.seconds < min) continue;
          funnel[`reachable+free>=${min}s`]++;
          if (!betterToDo) funnel[`…and nothing better to do (>=${min}s)`]++;
        }
        if (
          best &&
          best.seconds >= REACH_MIN_S[0] &&
          !betterToDo &&
          examples.length < Number(flag("--show") ?? 6)
        )
          examples.push(
            `${fmtTime((t0 - combat.startTime) / 1000)}  [candidate: psyfiend-ignored]   Enemy Psyfiend (by ${specToString(owner.spec)}) stood its full ${result.windowSeconds}s with 0 damage from your team. ` +
              `${specToString(best.unit.spec)} was ${best.melee ? "within melee reach" : "within 40 yd with line of sight"} of it and free to act for ${best.seconds}s of those ${result.windowSeconds}; ` +
              `no enemy was at or below ${KILL_HP_PCT}% and no teammate at or below ${CRISIS_HP_PCT * 100}% in that window.`,
          );
      }
    }
  }
  console.log(JSON.stringify({ files: files.length, rounds, funnel }, null, 1));
  console.log("\n" + examples.join("\n\n"));
}
void main();
