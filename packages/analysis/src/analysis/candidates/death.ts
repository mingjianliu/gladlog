/**
 * Death-anchored candidate producers — the precursor chain (`death-setup`),
 * `external-unused` and `questionable-external`.
 *
 * Split out of `candidateFindings.ts` on 2026-08-16 (mechanical split by
 * theme); logic moved verbatim. These share the death window and the
 * free-to-act predicates, which is why they travel together. (The fourth,
 * `death-unused-defensive`, retired 2026-08-29; its emitter was deleted
 * 2026-09-24.)
 */
import {
  cdReadyInTimeAt,
  type IMajorCooldownInfo,
} from "../../utils/cooldowns";
import { fmtFactNum as fmt, fmtFactTime } from "../factFormat";
import { CandidateEvent } from "../types";

/** death-setup: minimum healer CC duration (seconds) — a short incapacitate
 * does not make the kill window unhealable.
 *
 * GH #34 batch 4 (2026-08-28), 300 matches / 566 friendly deaths: 74.6 % of
 * deaths have a healer CC overlapping the DEATH_CC_LOOKBACK_S window; the
 * longest such CC per death — [0,1) 23 · [1,2) 42 · [2,3) 45 · [3,4) 75 ·
 * [4,5) 65 · [5,6) 78 · [6,8) 86 · ≥ 8 8 (p50 4.2 s). Share clearing the
 * gate: ≥ 2 s 84.6 % · **≥ 3 s 73.9 %** · ≥ 4 s 56.2 % — so "healer-locked"
 * attaches to roughly 55 % of ALL friendly deaths at 3 s (41 % at 4 s). No
 * natural break; editorial. Measured, not official. */
const HEALER_LOCK_MIN_S = 3;

export interface DeathSetupParts {
  deathT: number;
  victim: { id: string; name: string };
  /**
   * Did the victim pay for this healer CC (`mateHitDuringCc`, the `[CONSEQ]`
   * predicate)? Absent = not checked (hand-built fixtures).
   */
  victimHitDuring?: (cc: {
    atSeconds: number;
    durationSeconds: number;
  }) => boolean;
  /** CC summary for the friendly healer (when the healer is not the victim). */
  healerCC?: {
    healerName: string;
    ccInstances: Array<{
      atSeconds: number;
      durationSeconds: number;
      /** Optional: real callers pass an ICCInstance that carries the id; test
       * fixtures may omit it (it only feeds the icon). */
      spellId?: string;
      spellName: string;
      sourceName: string;
    }>;
  };
}

/**
 * death-setup candidates (reasoning chain): trace a friendly death back to an
 * earlier precursor moment, giving the model a citable "other end of the
 * chain". Pure function (unit-testable with hand-built fixtures):
 *  - healer-locked: healer CC covers the DEATH_CC_LOOKBACK_S window before the
 *    death (same window constant).
 *
 * trinket-early and defensive-early were retired as accusations on
 * 2026-09-25 (reliability audit B2a; user ruling 2026-09-24 「改」 after the
 * codex astra debate): a later death cannot show an earlier trinket / wall
 * was used too early — a wall at 20 % that brings the target back to 80 %
 * before a separate burst kills them was the right press. Both also carried
 * false facts on the 5 audited matches (ccAtDeath named a CC that ended
 * 11.4 s before the death; an Ironbark pre-wall on a 34 % teammate was
 * called "spent early" for the owner). The facts stay in the timeline —
 * [TRINKET] / [YOU] [CD] (target + HP) / [RES] — and the IMMUNITY_BREAKERS
 * feasibility table (GH #18 ruling (c), whose only consumer was
 * defensive-early) went with them.
 */
/**
 * CC look-back window (seconds) for the death chain: "CC inside the death
 * window" is judged over the 12 s before the death. Lived in
 * context/criticalMoments.ts until that module was deleted (2026-09-05,
 * GH #51 — six zero-consumer exports, probe showed the block restates the
 * timeline); this was its only live consumer, so the constant moved here.
 */
export const DEATH_CC_LOOKBACK_S = 12;

export function deathSetupEvents(parts: DeathSetupParts): CandidateEvent[] {
  const { deathT, victim } = parts;
  const out: CandidateEvent[] = [];
  // Seconds of the CC inside [death − DEATH_CC_LOOKBACK_S, death].
  const overlapS = (cc: { atSeconds: number; durationSeconds: number }) =>
    Math.min(cc.atSeconds + cc.durationSeconds, deathT) -
    Math.max(cc.atSeconds, deathT - DEATH_CC_LOOKBACK_S);

  // healer-locked: the healer was CC'd for ≥ HEALER_LOCK_MIN_S INSIDE the
  // kill window (not merely a ≥ 3 s CC touching its edge), and the victim
  // paid for it. Reliability round 2 W1c: a Binding Shot that ended 10.7 s
  // before the death overlapped the window by 1.4 s (61740741), a Cyclone
  // 0.4 s (b12bfef4), a backlash 0.95 s inside the healer's own GCD
  // (eb8041ce); a Kidney Shot with the victim 84 % → 80 % during it, the
  // lethal dive after the healer was free (be835950).
  const lock = parts.healerCC?.ccInstances.find(
    (cc) =>
      cc.atSeconds < deathT &&
      overlapS(cc) >= HEALER_LOCK_MIN_S &&
      (parts.victimHitDuring?.(cc) ?? true),
  );
  if (lock) {
    out.push({
      id: `death-setup:${victim.id}:${Math.round(deathT)}:healer-locked`,
      type: "death-setup",
      t: lock.atSeconds,
      unitNames: [parts.healerCC!.healerName, victim.name],
      spell: lock.spellName,
      spellId: lock.spellId,
      facts: {
        t: fmt(lock.atSeconds),
        kind: "healer-locked",
        // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): deathT
        // names the SAME instant the later "death" candidate's own t names,
        // and must floor onto the same [DEATH] marker second -- 10/129
        // (7.8%) death-setup deathT facts on the 2026-08-30 A/B corpus
        // rounded up past it before this.
        deathT: fmtFactTime(deathT),
        victim: victim.name,
        healer: parts.healerCC!.healerName,
        cc: lock.spellName,
        duration: lock.durationSeconds.toFixed(1),
      },
    });
  }

  return out;
}

/** external-unused: lookback window before the death (seconds) and the owner's
 * minimum free gap (seconds). Threshold provenance: arenacoach DEATH-003's
 * "you were free to cast it" (the 1.5s reaction allowance matches theirs
 * site-wide); the 5s window is the near-end sub-window of
 * DEATH_CC_LOOKBACK_S. */
// 2026-08-20 接地登记(GH #16,用户裁定保留):171 次可指控死亡实测,
// free-gap p50=3.9s、1.5–2.5s 边界带仅 9.9%(1.5 线不承重);窗宽敏感性
// 3s→62.6% / 5s→69.6% / 8s→87.1% 指控率 —— 以死亡为锚无法用结果选窗
// (循环),5/1.5 居中稳健,维持。数字在 issue #16 的三小件接地评论。
export const EXTERNAL_FREE_WINDOW_S = 5;
export const EXTERNAL_FREE_MIN_GAP_S = 1.5;

/**
 * external-unused: a teammate died while the owner (usually the healer) had an
 * external damage reduction available (the isAllyCastableDefensive whitelist)
 * and never gave it (arenacoach DEATH-003). "Owner was free" verdict: within
 * the EXTERNAL_FREE_WINDOW_S seconds before the death, after subtracting CC
 * coverage there was still a contiguous gap of >=EXTERNAL_FREE_MIN_GAP_S
 * seconds — purely a reaction-time allowance; the owner is not expected to
 * press exactly at the moment of death. If the owner was already dead at that
 * point (e.g. a double death), nothing is reported.
 */
export function externalUnusedEvents(input: {
  deathT: number;
  victim: { id: string; name: string };
  owner: { id: string; name: string };
  ownerExternals: Array<
    Pick<
      IMajorCooldownInfo,
      "spellId" | "spellName" | "cooldownSeconds" | "casts" | "neverUsed"
    >
  >;
  ownerCC: Array<{ atSeconds: number; durationSeconds: number }>;
  ownerAliveAt: (t: number) => boolean;
}): CandidateEvent[] {
  const { deathT, victim, owner } = input;
  if (!input.ownerAliveAt(deathT)) return [];

  // Owner's free gap: the largest contiguous gap left in the window
  // [deathT-5, deathT] after subtracting CC coverage
  const from = Math.max(0, deathT - EXTERNAL_FREE_WINDOW_S);
  const covers = input.ownerCC
    .map((c) => [c.atSeconds, c.atSeconds + c.durationSeconds] as const)
    .filter(([a, b]) => b > from && a < deathT)
    .sort((a, b) => a[0] - b[0]);
  let cursor = from;
  let maxGap = 0;
  for (const [a, b] of covers) {
    maxGap = Math.max(maxGap, a - cursor);
    cursor = Math.max(cursor, b);
  }
  maxGap = Math.max(maxGap, deathT - cursor);
  if (maxGap < EXTERNAL_FREE_MIN_GAP_S) return [];

  const avail = input.ownerExternals.find((cd) => cdReadyInTimeAt(cd, deathT));
  if (!avail) return [];
  return [
    {
      id: `external-unused:${owner.id}:${victim.id}:${Math.round(deathT)}`,
      type: "external-unused",
      t: deathT,
      unitNames: [owner.name, victim.name],
      spell: avail.spellName,
      spellId: avail.spellId,
      facts: {
        // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): t IS the
        // death instant, matched against the [DEATH] marker.
        t: fmtFactTime(deathT),
        victim: victim.name,
        owner: owner.name,
        external: avail.spellName,
        freeGapS: fmt(maxGap),
      },
    },
  ];
}

/**
 * questionable-external (17a): the consumer of annotateDefensiveTimings' sixth
 * tier ("Unnecessary") — an external (EXTERNAL_DEFENSIVE_IDS /
 * isAllyCastableDefensive whitelist) handed out in a no-pressure window
 * (target at high HP + no damage spike + no burst alignment; all three
 * conditions are already decided inside annotate, so here we only filter on
 * timingLabel). For the corpus-measured occurrence rate see the task-3 report
 * (the pre-gate numbers).
 * Filed under category "cooldowns"; its deep dive is the survival pack —
 * "spending what you should have saved" is a survival-discipline issue, not
 * an offensive one.
 *
 * nearestBurstGapS is read straight off cast.nearestBurstGapS —
 * annotateDefensiveTimings already computed it while deciding Unnecessary,
 * holding enemyCDTimeline.alignedBurstWindows; we do not re-derive the window
 * geometry here (single-source predicate).
 */
export function questionableExternalEvents(
  cds: Pick<IMajorCooldownInfo, "spellId" | "spellName" | "casts">[],
  caster: { id: string; name: string },
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  for (const cd of cds) {
    for (const cast of cd.casts) {
      if (cast.timingLabel !== "Unnecessary") continue;
      const t = cast.timeSeconds;
      out.push({
        id: `questionable-external:${caster.id}:${Math.round(t)}`,
        type: "questionable-external",
        t,
        unitNames: [caster.name, cast.targetName ?? caster.name],
        spell: cd.spellName,
        spellId: cd.spellId,
        facts: {
          t: fmt(t),
          spell: cd.spellName,
          caster: caster.name,
          target: cast.targetName ?? caster.name,
          targetHp:
            cast.targetHpPct !== undefined ? fmt(cast.targetHpPct) : "n/a",
          nearestBurstGapS:
            cast.nearestBurstGapS !== undefined
              ? fmt(cast.nearestBurstGapS)
              : "n/a",
        },
      });
    }
  }
  return out;
}
