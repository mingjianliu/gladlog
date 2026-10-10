/**
 * [STATE] — the per-second HP / alive-dead ticks of every unit, rendered at key
 * moments and on change (minimum gap 3 s), with the ghost state of Spirit of
 * Redemption and the crisis anchors forced in. The dead / alive predicate is
 * isDeadAtRenderSecond, shared with crisisDecisionPoints.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { gridHpPct, isDeadAtRenderSecond } from "../../utils/cooldowns";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitStateEntries(
  ctx: Pick<
    TimelineCtx,
    | "matchDurationS"
    | "matchStartMs"
    | "friendlyHpUnits"
    | "spiritOfRedemptionIntervals"
    | "criticalWindowSet"
    | "enemyHpUnits"
    | "crisisAnchorSeconds"
    | "keyMomentSeconds"
    | "addEntry"
  >,
): void {
  const {
    matchDurationS,
    matchStartMs,
    friendlyHpUnits,
    spiritOfRedemptionIntervals,
    criticalWindowSet,
    enemyHpUnits,
    crisisAnchorSeconds,
    keyMomentSeconds,
    addEntry,
  } = ctx;

  const lastEmittedHp = new Map<string, number>();
  const lastEmittedStatus = new Map<string, string>(); // 'alive' | 'dead' | 'ghost'
  // FT-T10: entering / leaving Spirit of Redemption form is a status change
  // like a death — a tick is due (inside the same emission gates as any other)
  const statusOf = (p: { isDead: boolean; isGhost: boolean }) =>
    p.isGhost ? "ghost" : p.isDead ? "dead" : "alive";
  const STATE_MIN_GAP_SECONDS = 3;
  let lastStateEmitT = -100;

  for (let t = 0; t <= Math.floor(matchDurationS); t++) {
    const tsMs = matchStartMs + t * 1000;

    const friendlyParts: string[] = [];
    const currentFriendlies = friendlyHpUnits.map(({ unit, label }) => {
      let isDead = isDeadAtRenderSecond(unit, matchStartMs, t);

      const isGhost = spiritOfRedemptionIntervals.some(
        (i) =>
          i.player.name === unit.name &&
          i.intervals.some(
            (int) => t >= int.startSeconds && t <= int.endSeconds,
          ),
      );

      const clamped = gridHpPct(unit, tsMs);

      if (isGhost) {
        friendlyParts.push(`${label(unit.name)}:ghost`);
        isDead = false;
      } else if (isDead) {
        friendlyParts.push(`${label(unit.name)}:dead`);
      } else if (clamped !== null) {
        if (clamped < 100) {
          friendlyParts.push(`${label(unit.name)}:${clamped}`);
        }
      }
      return { name: unit.name, isDead, isGhost, hp: clamped };
    });

    const enemyParts: string[] = [];
    const currentEnemies =
      criticalWindowSet.has(t) && enemyHpUnits.length > 0
        ? enemyHpUnits.map(({ unit, label }) => {
            let isDead = isDeadAtRenderSecond(unit, matchStartMs, t);

            const isGhost = spiritOfRedemptionIntervals.some(
              (i) =>
                i.player.name === unit.name &&
                i.intervals.some(
                  (int) => t >= int.startSeconds && t <= int.endSeconds,
                ),
            );

            const clamped = gridHpPct(unit, tsMs);

            if (isGhost) {
              enemyParts.push(`${label(unit.name)}:ghost`);
              isDead = false;
            } else if (isDead) {
              enemyParts.push(`${label(unit.name)}:dead`);
            } else if (clamped !== null) {
              if (clamped < 100) {
                enemyParts.push(`${label(unit.name)}:${clamped}`);
              }
            }
            return { name: unit.name, isDead, isGhost, hp: clamped };
          })
        : [];

    if (friendlyParts.length === 0 && enemyParts.length === 0) continue;

    // B15: Option 2 (Event-Gating) - strictly emit ONLY inside critical windows, or if a player died.
    const isInCritical = criticalWindowSet.has(t);
    const someoneDied =
      currentFriendlies.some((p) => p.isDead) ||
      currentEnemies.some((p) => p.isDead);

    const wasSomeoneDead = Array.from(lastEmittedStatus.values()).some(
      (status) => status === "dead",
    );
    const isFirstDeathTick = someoneDied && !wasSomeoneDead;

    // H18: a crisis anchor second is cited by a candidate — its tick is
    // always printed
    const isCrisisAnchor = crisisAnchorSeconds?.has(t) ?? false;

    // Only emit if inside critical window, or death. No time anchors!
    if (!isInCritical && !isFirstDeathTick && !isCrisisAnchor) continue;

    // Decide if it's a key moment or delta change
    let shouldEmit = false;
    if (t === 0) {
      shouldEmit = true; // Always emit first tick
    } else if (keyMomentSeconds.has(t) || isCrisisAnchor) {
      shouldEmit = true; // Key moment snapshot
    } else if (
      t - lastStateEmitT < STATE_MIN_GAP_SECONDS &&
      !isFirstDeathTick
    ) {
      // T3: per-second STATE inside critical windows is the timeline's largest
      // token source and, per blind review, a breeding ground for "read the
      // adjacent line" misattribution; enforce a ≥3s gap at non-key instants
      // (deaths / keyMoments are exempt)
      shouldEmit = false;
    } else {
      // Check if any player's HP changed by at least 10% or status changed since last emitted tick
      for (const p of [...currentFriendlies, ...currentEnemies]) {
        const lastHp = lastEmittedHp.get(p.name);
        const lastStatus = lastEmittedStatus.get(p.name) ?? "alive";
        const currentStatus = statusOf(p);

        if (currentStatus !== lastStatus) {
          shouldEmit = true;
          break;
        }

        if (p.hp !== null) {
          if (lastHp === undefined || Math.abs(p.hp - lastHp) >= 10) {
            shouldEmit = true;
            break;
          }
        }
      }
    }

    if (!shouldEmit) continue;

    // Update last emitted state
    for (const p of [...currentFriendlies, ...currentEnemies]) {
      if (p.hp !== null) lastEmittedHp.set(p.name, p.hp);
      lastEmittedStatus.set(p.name, statusOf(p));
    }

    let stateParts: string;
    if (friendlyParts.length > 0 && enemyParts.length > 0) {
      stateParts = `friends ${friendlyParts.join(" ")} / enemies ${enemyParts.join(" ")}`;
    } else if (friendlyParts.length > 0) {
      stateParts = `friends ${friendlyParts.join(" ")}`;
    } else {
      stateParts = `enemies ${enemyParts.join(" ")}`;
    }

    lastStateEmitT = t;
    addEntry(t, `${fmtTime(t)}  [STATE]   ${stateParts}`);
  }
}
