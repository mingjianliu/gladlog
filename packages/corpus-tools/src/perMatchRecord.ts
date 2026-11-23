import {
  computeDpsMetrics,
  computeHealerMetrics,
  enemyCompArchetype,
  enemyCompSignature,
  extractRotations,
  heroBuildGroupOf,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";

import type { PerMatchRecord } from "./cellAggregator";
import { assignBuildGroup, type KeystoneGate } from "./keystoneGates";

/** One combat → one record per Friendly player (healers get IHealerMetrics,
 * DPS get IDpsMetrics; a pure function, so a synthetic combat can unit-test it).
 * Follows the Friendly-only convention (the recorder's side has the most
 * complete data); disjoint specs guarantee a single metric set within a cell. */
export function combatToRecords(
  combat: any,
  gates: KeystoneGate[],
): PerMatchRecord[] {
  const players = (Object.values(combat.units) as any[]).filter((u) => u.info);
  const friendly = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const out: PerMatchRecord[] = [];
  for (const unit of friendly) {
    const enemies = players.filter((u) => u.reaction !== unit.reaction);
    const healer = isHealerSpec(unit.spec);
    let metrics;
    try {
      metrics = healer
        ? computeHealerMetrics(combat, unit.name)
        : computeDpsMetrics(combat, unit.name);
    } catch {
      continue;
    }
    const archetype = enemyCompArchetype(enemies);
    // P2: comp signature + duration + who died first (comp-cell aggregates)
    const enemyComp = enemyCompSignature(
      enemies.map((e: any) => specToString(e.spec)),
    );
    const durationS = Math.max(
      0,
      Math.round(((combat.endTime ?? 0) - (combat.startTime ?? 0)) / 1000),
    );
    let firstEnemyKillSpec = "";
    let firstDeathTs = Infinity;
    for (const e of enemies) {
      for (const d of e.deathRecords ?? []) {
        if (d.timestamp < firstDeathTs) {
          firstDeathTs = d.timestamp;
          firstEnemyKillSpec = specToString(e.spec);
        }
      }
    }
    const rotations = extractRotations(unit, combat);
    const spec = specToString(unit.spec);
    const gate = gates.find((g) => g.spec === spec);
    const talents = (unit.info?.talents ?? [])
      .map((t: any) => t.id1)
      .filter(Boolean);
    // #37 缺口二 + 用户裁定 2026-09-11: the hero tree is the default build
    // dimension and now takes PRECEDENCE over a keystone declaration; the gate
    // is the FALLBACK for loadouts whose hero tree cannot be resolved (old
    // builds, missing COMBATANT_INFO talents).
    //
    // Why the order flipped: Discipline Priest was the only spec with a gate,
    // so it was the only healer NOT split by hero tree — contradicting the
    // 2026-08-23 ruling (「一切按英雄天赋分层,适用于所有治疗」). The two Disc
    // trees really are two builds: Shadow Mend is held by 72–79% of Oracle and
    // 41–57% of Voidweaver (healer-study corpus rows, early S2).
    //
    // ⚠ Takes effect only after `reference_vectors.json` is rebuilt: cells
    // built before this carry `offensive`/`standard` for Disc, so the read side
    // asks for `Oracle` and degrades through lookupCell's normal chain to the
    // build-agnostic cell until the rebuild lands.
    const heroGroup = heroBuildGroupOf(unit.info?.talents);
    const buildGroup =
      heroGroup !== "*"
        ? heroGroup
        : gate
          ? assignBuildGroup(talents, gate)
          : "*";
    out.push({
      spec,
      bracket: combat.startInfo?.bracket ?? "unknown",
      archetype,
      buildGroup,
      enemyComp,
      durationS,
      firstEnemyKillSpec,
      metrics,
      crisisEvents: rotations.crisisEvents,
      rotations: {
        opener: rotations.opener,
        coreSequences: rotations.coreSequences,
      },
    });
  }
  return out;
}

/**
 * A deep copy whose strings no longer point into the source log. V8 cuts a
 * substring of a large string as a slice that keeps the whole parent alive, so
 * one spec or spell name carried out of a parsed line pins that log's full
 * text (tens of MB for a Solo Shuffle log) for as long as the record lives.
 * buildCorpus keeps every record of hundreds of logs: on 2026-11-23 the
 * Solo Shuffle reference-vector build took a 26 GB machine down to 570 MB
 * free by its 400th log (a 60-log probe: 5.1 GB and still climbing, flat at
 * about 2 GB once detached). The memory is the text's, outside the JS heap,
 * so --max-old-space-size does not stop it. JSON.parse of a JSON string builds
 * a fresh flat string; numbers (NaN included), booleans, null and undefined
 * pass through unchanged.
 */
export function detachStrings<T>(v: T): T {
  if (typeof v === "string") return JSON.parse(JSON.stringify(v)) as T;
  if (Array.isArray(v)) return v.map(detachStrings) as T;
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = detachStrings(x);
    return o as T;
  }
  return v;
}

/** One log → parse → per-match records. A thin shell; the real parsing
 *  integration is verified in the T8 live run. The records are detached from
 *  `logText` (see detachStrings) so a caller can keep many logs' records. */
export function buildPerMatchRecords(
  logText: string,
  gates: KeystoneGate[],
): PerMatchRecord[] {
  const parser = new GladLogParser();
  const combats: any[] = [];
  parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
  parser.on("shuffle", (sh: any) => {
    const legacy = toLegacyShuffle(sh);
    (legacy.rounds ?? []).forEach((r: any) => combats.push(r));
  });
  for (const line of logText.split("\n")) parser.push(line);
  parser.end();
  return combats.flatMap((c) => combatToRecords(c, gates)).map(detachStrings);
}
