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

/**
 * FT-T12 D3 (user ruling 2026-10-10, T12 item 8 ii): what makes a friendly
 * CONTROL an answer to an enemy burst. The control's target — the unit an
 * aimed control was cast at, or the holder a ground / untargeted control
 * landed on (`BurstResponseCast.destId`) — or that target's pets / summons
 * must have dealt landed damage > 0 to the PRESSURED friendly inside the
 * burst window [fromMs, toMs] (the engine's `tMs` … `outcomeLastMs`, the span
 * and amounts `damageTakenBetween` reads for the window itself). No
 * threshold: one point of damage is "was hitting them".
 *
 * B5 (user 2026-10-24, 「全按建议」): the crisis engine's control answer reads
 * it too (`crisisDecisionPoints`), over the crisis's own span — moved here
 * from `burstWindowDecisionPoints.ts`, which imports the crisis engine.
 *
 * It narrows the rule it sits on, it does not replace it: the target must
 * still be one of the window's cooldown casters (`casterIdSet`). Before, that
 * was the whole rule, so a control on ANY enemy that pressed a cooldown in
 * the window counted — an enemy healer whose only press was Power Infusion
 * included (605 capture: 667 of 1,552 control answers were not on the opener,
 * 252 of them on the enemy healer). No pressured friendly ⇒ nobody was being
 * hit ⇒ no control answer.
 *
 * ONE rule, both signs: the engine drops a control that fails it from
 * `responseCasts`, the list `responded` (the slow-defensive-response
 * candidate's half) and `creditedAnswer` (the `[BURST ANSWERED]` line's
 * half) both read. Measured on the 605 capture (the preview, parent
 * session): slow-defensive-response 0 added / 0 removed; `[BURST ANSWERED]`
 * −143 / +91 lines.
 *
 * Known limit, not addressed (flagged with the preview, accepted with it): a
 * control that shut its target down for the WHOLE window leaves that target
 * with zero damage on the pressured friendly, and so does not count — the
 * most effective control of an attacker reads as no control. A hit from
 * before the window does not rescue it: the span is the window's.
 */
export function controlTargetHitPressured(
  pressuredUnit: unknown,
  controlTargetId: string | undefined,
  enemyPlayerOf: (srcUnitId: string) => string | undefined,
  fromMs: number,
  toMs: number,
  /** the round's units — whose IMMUNE misses on the pressured friendly also
   * count as hitting them (`hitByAttackers`, G6's reading; work order
   * 2026-10-14d Part 2, preview) */
  units: Iterable<unknown> = [],
): boolean {
  return (
    pressuredUnit != null &&
    controlTargetId !== undefined &&
    hitByAttackers(
      pressuredUnit,
      units,
      (src) => enemyPlayerOf(src) === controlTargetId,
      fromMs,
      toMs,
    )
  );
}
