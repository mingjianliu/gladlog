/**
 * Supercharged combo points (Supercharger 470347), read off the presses —
 * the log has no aura for them: a charging press supercharges
 * `pointsPerCharge` points (one per rank of the talent), each damaging
 * finisher after it consumes one. A press while points are still in hand
 * adds to them (Preparation resets Adrenaline Rush). The one walk the
 * duration model (`superchargedPointsAt`, utils/castParam.ts) and the
 * cooldown ledger (`powerSpendTriggers`, data/talentScriptedCooldowns.ts)
 * both read (codex 85-tk-L1-T273-1 #3: the two had walks of their own, one
 * charge a press against one per rank — 1ce02e10 r6, Adrenaline Rush,
 * Dispatch, Between the Eyes: the press priced the second point, Restless
 * Blades did not).
 *
 * Returns the finisher rows that consumed a point.
 */
export function superchargedFinisherRows<
  C extends {
    spellId?: string | null;
    logLine: { event: string; timestamp: number };
  },
>(
  casts: readonly C[],
  chargeCastIds: readonly string[],
  finisherCastIds: readonly string[],
  pointsPerCharge: number,
): Set<C> {
  const used = new Set<C>();
  if (pointsPerCharge <= 0) return used;
  let left = 0;
  for (const c of casts) {
    if (c.logLine.event !== "SPELL_CAST_SUCCESS") continue;
    const id = String(c.spellId);
    if (chargeCastIds.includes(id)) left += pointsPerCharge;
    else if (left > 0 && finisherCastIds.includes(id)) {
      left--;
      used.add(c);
    }
  }
  return used;
}
