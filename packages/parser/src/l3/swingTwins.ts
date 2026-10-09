import type { ParsedLine } from "../l1/types";

/**
 * One melee swing is logged up to twice: `SWING_DAMAGE` carries the attacker's
 * advanced block, `SWING_DAMAGE_LANDED` the victim's. The attacker-side line is
 * NOT always there — a guardian the logging client has not resolved an owner
 * for (Unholy's Lesser Ghoul, unit flags 0xa28) swings with a LANDED line only.
 * Dropping every LANDED line (the pre-FT-T01 rule) lost 5,767 swings / 3.94M
 * damage in the 60 raw logs of the 2026-10-08 re-eval, two of them killing
 * blows (06bb9860, 7d1f14af).
 *
 * Twin predicate, measured on those 60 logs (65,099 LANDED / 48,551
 * SWING_DAMAGE lines): same source, same target, same `baseAmount` (the
 * pre-mitigation roll — the landed `amount` and `absorbed` differ between the
 * two sides in 1,501 pairs), nearest line first. All 48,537 pairs lie within
 * 451 ms (99.4% within 25 ms; the LANDED line comes first in 314) and no
 * candidate pair exists between 452 ms and 3 s, so the window sits in an empty
 * band — neither a twin split in two (the swing counted twice) nor two swings
 * merged (one dropped) at this value.
 */
export const SWING_TWIN_WINDOW_MS = 1_000;

function isSwingLine(r: ParsedLine): boolean {
  return (
    r.eventName === "SWING_DAMAGE" || r.eventName === "SWING_DAMAGE_LANDED"
  );
}

/**
 * Every `SWING_DAMAGE_LANDED` record that repeats a `SWING_DAMAGE` record of
 * the same swing, mapped to that record. A LANDED record that is NOT a key is
 * the only line its swing has. Pairing is nearest-first within a (source,
 * target, baseAmount) group, so a far line can never take a near twin's
 * partner; ties resolve in log order.
 */
export function swingLandedTwins(
  records: ParsedLine[],
): Map<ParsedLine, ParsedLine> {
  const groups = new Map<
    string,
    { swings: ParsedLine[]; landed: ParsedLine[] }
  >();
  for (const r of records) {
    if (!isSwingLine(r) || !r.damage || !r.base) continue;
    const key = `${r.base.srcGuid}|${r.base.destGuid}|${r.damage.baseAmount}`;
    let g = groups.get(key);
    if (!g) {
      g = { swings: [], landed: [] };
      groups.set(key, g);
    }
    (r.eventName === "SWING_DAMAGE" ? g.swings : g.landed).push(r);
  }

  const twins = new Map<ParsedLine, ParsedLine>();
  for (const g of groups.values()) {
    if (g.swings.length === 0 || g.landed.length === 0) continue;
    // Log order is not time order: a segment's timestamps step back by up to
    // ~2 s (invariants.ts). The window slides over time-sorted lists; a tie
    // between two equally near candidates resolves by LOG order (`i`).
    const byTime = (
      a: { r: ParsedLine; i: number },
      b: { r: ParsedLine; i: number },
    ) => a.r.timestamp - b.r.timestamp || a.i - b.i;
    const swings = g.swings.map((r, i) => ({ r, i })).sort(byTime);
    const landed = g.landed.map((r, i) => ({ r, i })).sort(byTime);
    const candidates: { dt: number; s: number; l: number }[] = [];
    let lo = 0;
    for (let s = 0; s < swings.length; s++) {
      const at = swings[s]!.r.timestamp;
      while (
        lo < landed.length &&
        landed[lo]!.r.timestamp < at - SWING_TWIN_WINDOW_MS
      )
        lo++;
      for (let l = lo; l < landed.length; l++) {
        const dt = landed[l]!.r.timestamp - at;
        if (dt > SWING_TWIN_WINDOW_MS) break;
        candidates.push({ dt: Math.abs(dt), s, l });
      }
    }
    candidates.sort(
      (a, b) =>
        a.dt - b.dt ||
        swings[a.s]!.i - swings[b.s]!.i ||
        landed[a.l]!.i - landed[b.l]!.i,
    );
    const usedSwing = new Set<number>();
    const usedLanded = new Set<number>();
    for (const c of candidates) {
      if (usedSwing.has(c.s) || usedLanded.has(c.l)) continue;
      usedSwing.add(c.s);
      usedLanded.add(c.l);
      twins.set(landed[c.l]!.r, swings[c.s]!.r);
    }
  }
  return twins;
}
