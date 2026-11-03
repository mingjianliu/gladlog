import type { ParsedLine } from "../l1/types";

/**
 * A `SPELL_ABSORBED` row the game wrote with a nil attacker
 * (`0000000000000000,nil`) — the hit of a guardian or pet whose owner the
 * logging client has not resolved: Desperate Soul's Wrath of Nathreza, a
 * Magus of the Dead's Withering Grasp, an Imp's Fel Firebolt. The hit's own
 * row names the source: the game writes a hit's absorb rows just before the
 * hit's damage row (its `absorbed` field holds them) or, when the shield ate
 * all of it, its `SPELL_MISSED … ABSORB` row (fact9 D29, dcff7ebb r0 1:06:
 * the 147k absorbed in the same ms as Desperate Soul's SPELL_DAMAGE with
 * absorbed 146997; D31, f73f4f15 r0 0:59: 106,650 absorbed, the MISSED
 * ABSORB 0.1 ms later carrying the guardian). With no attacker the absorbed
 * part was credited to nobody — `Unknown — Wrath of Nathreza (147k; 147k of
 * it absorbed)` — split from the landed part of the same hit.
 *
 * Twin predicate, measured on the round-9 audit's 30 raw logs (1,135 such
 * rows): the first later row, within `NIL_ATTACKER_TWIN_WINDOW_MS`, on the
 * same victim under the same attack spell is a damage row or an ABSORB miss
 * for 1,133; its absorbed amount equals the summed nil absorb rows it
 * follows for 1,079 (the rest also carry absorbs the log named an attacker
 * for). The first such row decides: a damage row with nothing absorbed, or
 * one whose source is nil too, leaves the attacker unknown.
 */
export const NIL_ATTACKER_TWIN_WINDOW_MS = 5;

const NIL_GUID = "0000000000000000";
const isNil = (guid: string | undefined) => !guid || guid === NIL_GUID;
/** how far ahead in log order the twin may sit (other units' rows of the
 * same instant come between) */
const LOOKAHEAD_LINES = 40;

export interface INilAttackerSource {
  guid: string;
  name: string;
}

/** Every nil-attacker absorb record whose hit's own row names its source,
 * mapped to that source. */
export function nilAttackerAbsorbSources(
  records: ParsedLine[],
): Map<ParsedLine, INilAttackerSource> {
  const out = new Map<ParsedLine, INilAttackerSource>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const a = r.absorbed;
    if (!a || !isNil(a.attackerGuid) || a.attackSpellId === null) continue;
    for (let j = i + 1; j < records.length && j <= i + LOOKAHEAD_LINES; j++) {
      const t = records[j]!;
      if (Math.abs(t.timestamp - r.timestamp) > NIL_ATTACKER_TWIN_WINDOW_MS)
        break;
      if (
        t.base?.destGuid !== a.victimGuid ||
        t.spell?.spellId !== a.attackSpellId
      )
        continue;
      const isHit = !!t.damage || t.missed?.missType === "ABSORB";
      if (!isHit) continue;
      const absorbedHere = t.damage ? t.damage.absorbed > 0 : true;
      if (absorbedHere && !isNil(t.base.srcGuid))
        out.set(r, {
          guid: t.base.srcGuid!,
          name:
            !t.base.srcName || t.base.srcName === "nil" ? "" : t.base.srcName,
        });
      break;
    }
  }
  return out;
}
