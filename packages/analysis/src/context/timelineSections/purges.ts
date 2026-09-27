/**
 * [PURGE] / [ENEMY PURGE] / [ENEMY CLEANSE] (T5 dispel coverage) — teammates'
 * offensive purges (and the owner's pet dispels, which have no cast line to
 * annotate), enemies stripping our buffs, and enemies cleansing their own team;
 * Critical / High priority only (F163), same-second same-source merge (B14).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { getEnglishSpellName } from "../../data/spellEffectData";
import type { IDispelEvent } from "../../utils/dispelAnalysis";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitPurgeEntries(
  ctx: Pick<
    TimelineCtx,
    | "dispelSummary"
    | "owner"
    | "enemyPid"
    | "addEntry"
    | "pid"
    | "enemyDispelSummary"
  >,
): void {
  const { dispelSummary, owner, enemyPid, addEntry, pid, enemyDispelSummary } =
    ctx;

  const purgeGroups = new Map<string, IDispelEvent[]>();
  for (const purge of dispelSummary.ourPurges) {
    // Pet-cast dispels (Devour Magic, …) have no owner cast line to annotate,
    // so they must not be skipped
    if (purge.sourceName === owner.name && !purge.isPetDispel) continue;
    if (purge.priority !== "Critical" && purge.priority !== "High") continue;
    const key = `${Math.round(purge.timeSeconds)}|${purge.sourceName}`;
    const group = purgeGroups.get(key) ?? [];
    group.push(purge);
    purgeGroups.set(key, group);
  }
  for (const group of purgeGroups.values()) {
    const first = group[0];
    const viaTag = first.dispelSpellName ? ` (${first.dispelSpellName})` : "";
    const effects = group
      .map(
        (c) =>
          `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${enemyPid(c.targetName)}`,
      )
      .join(", ");
    addEntry(
      first.timeSeconds,
      `${fmtTime(first.timeSeconds)}  [PURGE]   ${pid(first.sourceName)} purged ${effects}${viaTag}`,
    );
  }

  const hostileGroups = new Map<string, IDispelEvent[]>();
  for (const purge of dispelSummary.hostilePurges) {
    if (purge.priority !== "Critical" && purge.priority !== "High") continue;
    const key = `${Math.round(purge.timeSeconds)}|${purge.sourceName}`;
    const group = hostileGroups.get(key) ?? [];
    group.push(purge);
    hostileGroups.set(key, group);
  }
  for (const group of hostileGroups.values()) {
    const first = group[0];
    const viaTag = first.dispelSpellName ? ` (${first.dispelSpellName})` : "";
    const effects = group
      .map(
        (c) =>
          `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${pid(c.targetName)}`,
      )
      .join(", ");
    addEntry(
      first.timeSeconds,
      `${fmtTime(first.timeSeconds)}  [ENEMY PURGE]   ${enemyPid(first.sourceName)} stripped ${effects}${viaTag}`,
    );
  }

  // [ENEMY CLEANSE]: the enemy team removing our CC/dots from their own
  // teammates (key coaching information — "your Hex was dispelled instantly";
  // 2026-07-18 baseline investigation: the whole class was invisible, 42/176
  // matches missing Purify). Same Critical/High filter + same-second
  // same-source merge.
  if (enemyDispelSummary) {
    const enemyCleanseGroups = new Map<string, IDispelEvent[]>();
    for (const c of enemyDispelSummary.allyCleanse) {
      if (c.priority !== "Critical" && c.priority !== "High") continue;
      const key = `${Math.round(c.timeSeconds)}|${c.sourceName}`;
      const group = enemyCleanseGroups.get(key) ?? [];
      group.push(c);
      enemyCleanseGroups.set(key, group);
    }
    for (const group of enemyCleanseGroups.values()) {
      const first = group[0];
      const viaTag = first.dispelSpellName ? ` (${first.dispelSpellName})` : "";
      const effects = group
        .map(
          (c) =>
            `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${enemyPid(c.targetName)}`,
        )
        .join(", ");
      addEntry(
        first.timeSeconds,
        `${fmtTime(first.timeSeconds)}  [ENEMY CLEANSE]   ${enemyPid(first.sourceName)} cleansed ${effects}${viaTag}`,
      );
    }
  }
}
