import {
  ALLY_REACH_GRANTED_BY_TALENT,
  ENEMY_TARGET_DEFENSIVE_IDS,
  isCompanionCastRow,
  isEnemyCdWindowSpell,
  rendersOnCaster,
  SPELL_CATEGORIES,
  SPELL_ICONS_GENERATED,
} from "@gladlog/analysis";

import { sideOfUnit } from "./teamSide";
import type { ReportSource } from "./types";

export interface CastRow {
  t: number;
  spellId: number;
  spellName: string;
  /** The unit the press was put on; "" when the cast row's destination is
   * no target (`castRowDestinationIsNoTarget` — pipeline T239). */
  targetName: string;
  byPet: boolean;
  /** Icon base name (from the mined spellIconsGenerated table); undefined when
   * the table has no entry → falls back to the first letter. */
  icon?: string;
}

/** Whether this aura belongs to the curated PvP category set (CC / root /
 * immunity / defensive CD / offensive CD / disarm / interrupt …). */
export function auraCategory(spellId: number): string | undefined {
  return SPELL_CATEGORIES[String(spellId)]?.type;
}

/** Whether this cast is a major / key cooldown (immunity, defensive CD,
 * offensive CD, disarm) — used to highlight it in the GCD lane.
 *
 * The offensive leg is analysis's own answer, imported, not a category of
 * this file's: `isEnemyCdWindowSpell` — the predicate that makes a press an
 * `[ENEMY CD]` line (a member of the canonical offensive table whose official
 * cooldown is inside the tracked band). User ruling R71 (2026-11-18, pipeline
 * T154): the lane read `SPELL_CATEGORIES`' `buffs_offensive` rows, which
 * never held Champion's Spear 376079 after ruling A8 made it an offensive
 * cooldown — nor 43 other cooldown presses the prompt calls one. `spec` is
 * the unit's (a spec-gated member — Divine Toll, Convoke the Spirits — is
 * one only in its spec's hands). The other three kinds stay category rows.
 * `docs/predicate-index.md` "Report UI"; the flip list is pinned in
 * `test/report.majorcd.test.ts`. */
const MAJOR_CD_TYPES = new Set(["immunities", "buffs_defensive", "disarms"]);
export function isMajorCd(spellId: number, spec?: number | string): boolean {
  if (isEnemyCdWindowSpell(String(spellId), spec)) return true;
  const c = auraCategory(spellId);
  return c != null && MAJOR_CD_TYPES.has(c);
}

/** A press whose cast row's destination is not a unit it was put on: the
 * prompt renders it on its caster (`rendersOnCaster` — a personal
 * defensive's SPELL_CAST_SUCCESS row logs the caster's current target:
 * Survival of the Fittest "→" the enemy Discipline Priest, 69915cc5 r1,
 * pipeline T239). Two exceptions keep the name: a defensive pressed ON an
 * enemy (`ENEMY_TARGET_DEFENSIVE_IDS`: Touch of Karma — the prompt reads
 * that press on its caster too, and the lane's arrow is the cast's target),
 * and a self wall a talent can put on an ally
 * (`ALLY_REACH_GRANTED_BY_TALENT`: Obsidian Scales with Lifecinders) when
 * the named unit is not known to be on the other side (`destOnOtherSide`;
 * the talent itself is not read here). All three legs are analysis's,
 * imported; scan5 `t239` counts the same rows. */
export function castRowDestinationIsNoTarget(
  spellId: string,
  destOnOtherSide: boolean,
): boolean {
  if (!rendersOnCaster(spellId)) return false;
  if (ENEMY_TARGET_DEFENSIVE_IDS.has(spellId)) return false;
  return destOnOtherSide || ALLY_REACH_GRANTED_BY_TALENT[spellId] === undefined;
}

export function deriveCasts(m: ReportSource, unitId: string): CastRow[] {
  const u = m.units[unitId];
  if (!u) return [];
  // a destination known to be on the other side; an unknown side is no
  // evidence (`sideOfUnit`: an import with no playerTeamId, an unowned NPC)
  const casterSide = sideOfUnit(m, unitId);
  const onOtherSide = (destId: string): boolean => {
    const side = sideOfUnit(m, destId);
    return (
      casterSide !== "unknown" && side !== "unknown" && side !== casterSide
    );
  };
  const row =
    (byPet: boolean) =>
    (e: (typeof u.casts)[number]): CastRow => ({
      t: e.timestamp,
      spellId: e.spellId,
      spellName: e.spellName,
      // analysis's own answer, imported: the prompt renders such a press
      // on its caster (`rendersOnCaster`, the `[YOU] [CD]` / `[TEAM]` lines)
      targetName: castRowDestinationIsNoTarget(
        String(e.spellId),
        onOtherSide(e.destId),
      )
        ? ""
        : e.destName,
      byPet,
      icon: SPELL_ICONS_GENERATED[String(e.spellId)],
    });
  // A companion row (Germination's 774 beside its 155777, Evangelism's own
  // 194509 Radiance beside the 472433 press) is no press of its own — the
  // prompt's cast lines drop the same rows (`isCompanionCastRow`, GH #187).
  const asRow = (e: (typeof u.casts)[number]) => ({
    spellId: String(e.spellId),
    destUnitId: e.destId,
    logLine: { timestamp: e.timestamp },
  });
  const ownRows = u.casts.map(asRow);
  const own = u.casts.filter((_, i) => {
    const r = ownRows[i];
    return !r || !isCompanionCastRow(r, ownRows);
  });
  return [...own.map(row(false)), ...u.petCasts.map(row(true))].sort(
    (a, b) => a.t - b.t,
  );
}

/** Deny list for auto-triggered casts / internal variants (every entry meets
 * all of: outside the table + high frequency across the user's 10-match corpus
 * + not a player keypress; for the "variant" entries the keypress id is already
 * in the keep set, so denying only de-duplicates and loses no information).
 * Rot defence = an evidence comment per entry + a corpus rescan (the
 * evidenceDist / dropped-list human review process). */
const AUTO_CAST_DENY: ReadonlySet<string> = new Set([
  "1217610", // Devour: DH hero-talent soul-fragment auto-trigger, x867, p50≈4s, user-reported
  "473662", // Consume: same ability, second id
  "341263", // Shadowy Apparition: priest apparition entity cast, x747, not a keypress
  "415388", // Recycled reuse: BM auto-trigger, x1030, 93% sub-GCD
  "393035", // Throw Glaive auto variant: the keypress version (Throw Glaive in the spellbook) is kept, x338
  "337819", // Throw Glaive auto variant: same as above, x311
  "1226019", // Reaping: DK hero-talent auto, x490
  "469270", // Wind of Ruin: warrior hero-talent auto, x258
  "228537", // Shattered Souls: DH soul-fragment generation event, x220
  "408385", // Expedition Strike: hero-talent auto follow-up, x316
  "1242174", // Death Coil variant: DK hero-talent auto, x157
  "1256581", // Merithra's Blessing: proc buff cast, x148
  "126664", // Charge displacement internal id: the keypress version 100 is kept, x173
]);
// Re-review record (2026-07-25, confirmed by the user): 155777 was once wrongly
// placed on the deny list — its official name is "Rejuvenation (Germination)",
// a genuine second Rejuvenation keypress granted by the Germination talent, not
// a duplicate instance. Lesson: look up the official name before adding an
// entry (anything with a talent name in parentheses is a talent-granted cast);
// talent-granted spell ids are NOT in talentIdMap (that holds talent NODE ids),
// so "not in the talent tree" is not grounds for calling a cast auto-triggered.

/** GCD floor (ms): at extreme haste the GCD is ≈ 0.75s, so consecutive casts of
 * the same spell closer than this cannot physically be player GCD behaviour
 * (they are resource procs / aura-tick style casts). */
const SUB_GCD_MS = 700;
/** Minimum sample size and sub-GCD interval ratio for calling a spell noise. */
const NOISE_MIN_CASTS = 4;
const NOISE_SUB_GCD_RATIO = 0.5;

/**
 * The cast stream under the GCD-lane definition (2026-07-25, from the user's
 * hands-on feedback; two gates):
 *  1) **Official-data gate**: the player keypress table (SkillLineAbility
 *     spellbook ∪ talent tree ∪ PvP talents, generated by genGcdSpells) ∪
 *     curated (an item-spell fallback). Triggered sub-spells / engine-internal
 *     ids (the DH Devour id pair, soul fragments, mage Snowdrift, the Hymn
 *     healing-effect id) are all outside the table — verified 13/13 on the
 *     known samples. A "has a SpellCooldowns row" predicate would miss Devour
 *     (triggered spells also have cooldown rows) and was rejected.
 *  2) **Physical layer**: consecutive casts of the same-named spell are mostly
 *     closer than the 700ms GCD floor (a hard game rule — at extreme haste the
 *     GCD is ≈ 750ms) → channel tick-by-tick CAST-event spam (the DH Devour id
 *     pair alternates, so only name-based aggregation catches it).
 *  3) Pet casts are kept only inside the curated PvP categories (so key events
 *     such as a felhunter's Spell Lock still show).
 */
export function filterGcdNoise(rows: CastRow[]): CastRow[] {
  const bySpell = new Map<string, number[]>();
  // Aggregate by name: dual-id abilities (Devour 1217610/473662) alternate, so
  // aggregating by id would miss them
  const keyOf = (r: CastRow) => `${r.spellName}:${r.byPet ? 1 : 0}`;
  for (const r of rows) {
    const arr = bySpell.get(keyOf(r)) ?? [];
    arr.push(r.t);
    bySpell.set(keyOf(r), arr);
  }
  const noisy = new Set<string>();
  for (const [key, ts] of bySpell) {
    if (ts.length < NOISE_MIN_CASTS) continue;
    let sub = 0;
    for (let i = 1; i < ts.length; i++)
      if (ts[i]! - ts[i - 1]! < SUB_GCD_MS) sub++;
    if (sub >= (ts.length - 1) * NOISE_SUB_GCD_RATIO) noisy.add(key);
  }
  return rows.filter((r) => {
    const sid = String(r.spellId);
    if (r.byPet) return !!SPELL_CATEGORIES[sid];
    if (AUTO_CAST_DENY.has(sid)) return false;
    if (noisy.has(keyOf(r))) return false; // the physical layer treats in-table and out-of-table alike
    return true; // keep by default when out of table (SkillLineAbility is incomplete; hard-dropping would kill real keypresses)
  });
}

/** The cast stream the GCD lane consumes = all casts minus GCD noise. */
export function deriveGcdCasts(m: ReportSource, unitId: string): CastRow[] {
  return filterGcdNoise(deriveCasts(m, unitId));
}
