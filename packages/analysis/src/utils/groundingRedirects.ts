/**
 * The one predicate for "a spell of this unit went into a Grounding Totem"
 * (triage 2026-09-29 enemy-def F-E27). Two log shapes say it:
 *
 *  - a SPELL_CAST_SUCCESS whose destination is the totem (7d1f: a Cyclone, a
 *    Polymorph) — the server redirected a targeted cast;
 *  - a SPELL_MISSED … IMMUNE on the totem with no such cast before it. A
 *    trap or other ground effect has no cast destination at all: c2058ed4's
 *    Freezing Trap (cast 187650, no dest) shows up only as `SPELL_MISSED …
 *    Grounding Totem … 3355 IMMUNE` at 0:54 and 1:55.
 *
 * Consumers: `[GROUNDED]` (`context/spellOutcomeLines.ts groundedControls`)
 * and the shaman's `[CC AVOIDED?]` redirect credit
 * (`utils/ccTrinketAnalysis.ts`). Callers apply their own spell filter.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  GROUNDING_TOTEM_NPC_ID,
  getNpcIdFromGuid,
} from "../context/timelineHelpers";
import { getEnglishSpellName } from "../data/spellEffectData";

/** A miss on the totem this soon after the caster's own cast of the same
 *  spell into that totem is the same redirect (cast → travel → immune). */
export const GROUNDING_MISS_AFTER_CAST_MS = 3000;

/** The cast and its miss may log different ids for one spell — Fear's cast
 *  is 5782, its IMMUNE miss the aura 118699 (06bb9860 / bd790c92; codex
 *  review of F-E27). Same id, or the same English name. */
function sameSpell(a: string, b: string): boolean {
  if (a === b) return true;
  const na = getEnglishSpellName(a, "");
  return na !== "" && na === getEnglishSpellName(b, "");
}

export interface IGroundingRedirect {
  timestampMs: number;
  spellId: string;
  /** as logged (callers map to English) */
  spellName: string;
  totemId: string;
  via: "cast" | "miss";
}

/** GUID first (locale-independent), the English name as the GUID-less
 *  fallback — the same test `[absorbed: Grounding Totem]` uses. */
export function isGroundingTotemTarget(
  destUnitId: string | undefined,
  destUnitName: string | undefined,
): boolean {
  return (
    getNpcIdFromGuid(destUnitId ?? "") === GROUNDING_TOTEM_NPC_ID ||
    (destUnitName?.toLowerCase().includes("grounding totem") ?? false)
  );
}

export function groundingRedirects(
  unit: ICombatUnit,
  casts: ICombatUnit["spellCastEvents"] = unit.spellCastEvents,
): IGroundingRedirect[] {
  const out: IGroundingRedirect[] = [];
  for (const c of casts ?? []) {
    if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !c.spellId) continue;
    if (!isGroundingTotemTarget(c.destUnitId, c.destUnitName)) continue;
    out.push({
      timestampMs: c.logLine.timestamp,
      spellId: c.spellId,
      spellName: c.spellName ?? "",
      totemId: c.destUnitId ?? "",
      via: "cast",
    });
  }
  const castRedirects = out.slice();
  for (const m of unit.missesOut ?? []) {
    if (m.missType !== "IMMUNE" || !m.spellId) continue;
    if (!isGroundingTotemTarget(m.destUnitId, m.destUnitName)) continue;
    const ts = m.logLine.timestamp;
    if (
      castRedirects.some(
        (c) =>
          sameSpell(c.spellId, m.spellId!) &&
          c.totemId === (m.destUnitId ?? "") &&
          ts >= c.timestampMs &&
          ts - c.timestampMs <= GROUNDING_MISS_AFTER_CAST_MS,
      )
    )
      continue;
    // one miss per effect at the same ms is one redirect
    if (
      out.some(
        (o) =>
          o.via === "miss" &&
          o.spellId === m.spellId &&
          o.totemId === (m.destUnitId ?? "") &&
          o.timestampMs === ts,
      )
    )
      continue;
    out.push({
      timestampMs: ts,
      spellId: m.spellId,
      spellName: m.spellName ?? "",
      totemId: m.destUnitId ?? "",
      via: "miss",
    });
  }
  return out.sort((a, b) => a.timestampMs - b.timestampMs);
}
