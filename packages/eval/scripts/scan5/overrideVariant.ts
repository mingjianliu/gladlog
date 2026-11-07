/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/overrideVariant.ts — class 10 of the round-7 audit (fact7 F21, D68 /
 * D71), the override-variant readers commit b5131407d did not reach.
 *
 * `noPressOfOwnVariant`: a `(no press)` [ENEMY CD] line whose second has a
 * SPELL_CAST_SUCCESS of a DB2 override variant of the printed spell, or of the
 * button it overrides: one press read twice. Log truth: the unit's cast rows
 * and the generated variant table, not the occurrence builder.
 *
 * `kitRangeBelowSeen`: a kit `[a–Ns]` printing a = 0. Nothing comes back 0 s
 * after its press; a full reset summed as a number of seconds did it. The one
 * true 0 is a reset that really landed inside the press's own second (Apotheosis
 * 0.95 s after a Chastise, d5f35ce9 r6: pressed again 1.9 s after the first),
 * and the rows say so: a press of the spell, then within a second the
 * trigger's row of a full reset of it (`EVENT_COOLDOWN_REDUCTIONS`, a lookup).
 */
import { OVERRIDE_VARIANTS_GENERATED } from "@gladlog/analysis/src/data/overrideVariantsGenerated";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReductionOwner,
  eventReductionSecondsAt,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import {
  getPlayerTalentedSpellInfo,
  talentsOf,
} from "@gladlog/analysis/src/utils/talents";

import { APPLIED, ev, type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = ["noPressOfOwnVariant", "kitRangeBelowSeen"] as const;

const NO_PRESS =
  /^\s*(\d+):(\d\d)\s+\[ENEMY CD\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?) \(no press\)/;
const KIT_UNIT = /<unit id="(\d+)" name="([^"]+)"/;
const KIT_ZERO = /([^,>]+?) \[0–(\d+)s/g;

/** every name a DB2 override pair of `name` goes by */
function variantIds(name: string): Set<string> {
  const ids = new Set<string>();
  for (const [variant, base] of Object.entries(OVERRIDE_VARIANTS_GENERATED)) {
    if (
      getEnglishSpellName(base, "") === name ||
      getEnglishSpellName(variant, "") === name
    ) {
      ids.add(variant);
      ids.add(base);
    }
  }
  return ids;
}

/** does the unit hold `talentId`? — COMBATANT_INFO's talents (and PvP
 * talents) decoded; an unreadable talent list proves nothing either way */
function holdsTalent(unit: any, talentId: string): boolean {
  if ((unit.info?.pvpTalents ?? []).map(String).includes(talentId)) return true;
  const talents = talentsOf(unit);
  if (!talents) return true;
  const specId = parseInt(String(unit.spec), 10);
  const selected =
    !Number.isNaN(specId) && talents.length > 0
      ? getPlayerTalentedSpellInfo(specId, talents)
      : new Map();
  if (selected === null) return true;
  return selected.has(talentId);
}

/** a full reset of `name`'s cooldown under a second after one of its presses */
function resetInsideItsPress(unit: any, name: string): boolean {
  if (!unit) return false;
  const presses = successesOf(unit).filter(
    (c: any) =>
      getEnglishSpellName(String(c.spellId), c.spellName ?? "") === name,
  );
  const ids = new Set(presses.map((c: any) => String(c.spellId)));
  const spec = unit.spec === undefined ? undefined : String(unit.spec);
  for (const [key, r] of Object.entries(EVENT_COOLDOWN_REDUCTIONS)) {
    if (!r.targets.some((t) => ids.has(t))) continue;
    // the reset is the talent's: a unit without it gets none (codex
    // 20-F26-07 #5 — spec and date alone do not make a holder)
    const owned =
      (holdsTalent(unit, eventReductionOwner(key, r)) ||
        (spec !== undefined && !!r.ownedBySpecIds?.includes(spec))) &&
      (r.requiresTalentId === undefined ||
        holdsTalent(unit, r.requiresTalentId));
    if (!owned) continue;
    // a dated row (12.1.0's Violent Transformation, GH #193) is a full
    // reset only for its holders and only on the log's own date
    const full = presses.filter(
      (c: any) => eventReductionSecondsAt(r, spec, tsOf(c)) === Infinity,
    );
    if (full.length === 0) continue;
    const auras = new Set<string>(r.triggerSelfAuraAppliedIds ?? []);
    const casts = new Set<string>(r.triggerCastIds);
    const triggers = [
      ...((unit.auraEvents ?? []) as any[])
        .filter((a) => ev(a) === APPLIED && auras.has(a.spellId))
        .map(tsOf),
      ...successesOf(unit)
        .filter((c: any) => casts.has(String(c.spellId)))
        .map(tsOf),
    ];
    if (
      full.some((c: any) =>
        triggers.some((t) => t > tsOf(c) && t - tsOf(c) < 1000),
      )
    )
      return true;
  }
  return false;
}

export function run(ctx: IRoundCtx): void {
  let pid: string | undefined;
  for (const line of ctx.lines) {
    const u = KIT_UNIT.exec(line);
    if (u) pid = u[1];
    if (line.includes("<cooldowns>"))
      for (const m of line.matchAll(KIT_ZERO)) {
        ctx.bump("kitRangeBelowSeen");
        const name = m[1]!.replace(/^.*<cooldowns>/, "").trim();
        if (resetInsideItsPress(ctx.unitOfPid(pid), name)) continue;
        ctx.violate(
          "kitRangeBelowSeen",
          "zero",
          ctx.start,
          `${pid}#${name}`,
          `${ctx.unitOfPid(pid)?.name} ${name} [0–${m[2]}s]`,
        );
      }
    const n = NO_PRESS.exec(line);
    if (!n) continue;
    const name = n[4]!;
    const ids = variantIds(name);
    if (ids.size === 0) continue;
    ctx.bump("noPressOfOwnVariant");
    const unit = ctx.unitOfPid(n[3]);
    if (!unit) continue;
    const lo = ctx.start + (+n[1]! * 60 + +n[2]!) * 1000;
    const press = successesOf(unit).find(
      (c: any) =>
        ids.has(String(c.spellId)) &&
        tsOf(c) >= lo - 1000 &&
        tsOf(c) < lo + 1000,
    );
    if (press)
      ctx.violate(
        "noPressOfOwnVariant",
        "sameSecond",
        tsOf(press),
        `${unit.name}#${name}#${tsOf(press)}`,
        `${unit.name} ${name} (no press), cast row ${press.spellId} at +${tsOf(press) - ctx.start}ms`,
        line,
      );
  }
}
