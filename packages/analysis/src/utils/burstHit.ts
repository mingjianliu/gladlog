/**
 * burstHit.ts — "did these attackers hit this unit inside a span?", the one
 * reading the burst-window engine (`burstWindowDecisionPoints`: who is
 * pressured, whether a control's target was hitting them) and the
 * POSITIONING burst target (`positionAnalysis.ts` `mostPressuredInSpan`)
 * share. Work order 2026-10-14d Part 2 (preview): POSITIONING named the
 * friendly with the most incoming damage from ANY source, the burst engine
 * one the burst's casters hit — 4 same-burst disagreements on the 60
 * re-eval prompts.
 *
 * Hit = landed damage > 0 from them, or a SPELL_MISSED IMMUNE they logged on
 * the unit (an immunity pressed at the opening is still the answer to it —
 * user 2026-10-14, G6 option B).
 */

/** Landed damage `unit` took in [fromMs, toMs] (both ends included), from
 * the sources `fromSource` admits (all when omitted). */
export function damageTakenBetween(
  unit: any,
  fromMs: number,
  toMs: number,
  fromSource?: (srcUnitId: string) => boolean,
): number {
  return ((unit.damageIn ?? []) as any[])
    .filter((d) => {
      const ts = d.timestamp ?? d.logLine?.timestamp;
      if (fromSource && !(d.srcUnitId && fromSource(d.srcUnitId))) return false;
      return ts != null && ts >= fromMs && ts <= toMs;
    })
    .reduce((n, d) => n + Math.abs(d.effectiveAmount ?? d.amount ?? 0), 0);
}

/** The unit ids an attacker `fromSource` admits logged an IMMUNE miss on in
 * [fromMs, toMs] — read off each attacker's own `missesOut`. */
export function immuneHitTargets(
  units: Iterable<any>,
  fromSource: (srcUnitId: string) => boolean,
  fromMs: number,
  toMs: number,
): Set<string> {
  const out = new Set<string>();
  for (const u of units) {
    if (!u?.id || !fromSource(u.id)) continue;
    for (const m of u.missesOut ?? []) {
      if (
        m.missType === "IMMUNE" &&
        m.destUnitId &&
        m.timestamp >= fromMs &&
        m.timestamp <= toMs
      )
        out.add(m.destUnitId);
    }
  }
  return out;
}

/** Did the attackers `fromSource` admits hit `unit` in [fromMs, toMs]? */
export function hitByAttackers(
  unit: any,
  units: Iterable<any>,
  fromSource: (srcUnitId: string) => boolean,
  fromMs: number,
  toMs: number,
): boolean {
  return (
    damageTakenBetween(unit, fromMs, toMs, fromSource) > 0 ||
    immuneHitTargets(units, fromSource, fromMs, toMs).has(unit.id)
  );
}
