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
 * NOTE: Output is stdout JSON summary followed by example strings.
 * REACH_MIN_S = [3, 5] and KILL_HP_PCT = 35 are diagnostic sensitivity probe
 * thresholds, NOT production constants.
 * Production crisis threshold is CRISIS_HP_PCT (0.30) from crisisDecisionPoints.ts.
 *
 * Usage: npx tsx packages/eval/scripts/psyfiendIgnoredExampleGen.ts --manifest <txt> [--offset 3000] [--limit 300] [--show 6]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CRISIS_HP_PCT } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  nonPlayerUnitKill,
  opposingHitsOnUnit,
  PSYFIEND_NPC_ID,
  summonedAtMs,
} from "@gladlog/analysis/src/context/timelineHelpers";
import { gridHpPct, specToString } from "@gladlog/analysis/src/utils/cooldowns";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
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
const parseNonNegativeInt = (name: string, defaultVal: number): number => {
  const raw = flag(name);
  if (raw === undefined) return defaultVal;
  const val = Number(raw);
  if (!Number.isInteger(val) || val < 0) {
    throw new Error(`expected non-negative integer for ${name}, got: ${raw}`);
  }
  return val;
};

const PSYFIEND_NPC = PSYFIEND_NPC_ID;
/** Seconds of the window a player must be both in reach and free. A probe
 * value, reported as a sensitivity row — not a product constant. */
const REACH_MIN_S = [3, 5];
/** "The team was mid-kill": an enemy player this low. Probe value. */
const KILL_HP_PCT = 35;

async function main(): Promise<void> {
  const manifestPath = flag("--manifest");
  if (!manifestPath) {
    throw new Error("missing required --manifest <path>");
  }
  const offset = parseNonNegativeInt("--offset", 3000);
  const limit = parseNonNegativeInt("--limit", 300);
  const show = parseNonNegativeInt("--show", 6);

  await ensureAnalysisData();

  let manifestRaw: string;
  try {
    manifestRaw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new Error(
      `failed to read manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const files = manifestRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(offset, offset + limit);
  let readFiles = 0;
  let skippedFiles = 0;
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
      readFiles++;
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
      for (const line of text.split(/\r?\n/)) parser.push(line);
      parser.end();
    } catch (err) {
      process.stderr.write(
        `[warn] failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}, skipping\n`,
      );
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
          examples.length < show
        )
          examples.push(
            `${fmtTime((t0 - combat.startTime) / 1000)}  [candidate: psyfiend-ignored]   Enemy Psyfiend (by ${specToString(owner.spec)}) stood its full ${result.windowSeconds}s with 0 damage from your team. ` +
              `${specToString(best.unit.spec)} was ${best.melee ? "within melee reach" : "within 40 yd with line of sight"} of it and free to act for ${best.seconds}s of those ${result.windowSeconds}; ` +
              `no enemy was at or below ${KILL_HP_PCT}% and no teammate at or below ${CRISIS_HP_PCT * 100}% in that window.`,
          );
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        selectedFiles: files.length,
        readFiles,
        skippedFiles,
        rounds,
        funnel,
      },
      null,
      1,
    ),
  );
  console.log("\n" + examples.join("\n\n"));
}
void main();
