/**
 * [ENEMY DEF] (GH #97) — enemy defensive cooldowns on the timeline (when
 * TIMELINE_LINE_FLAGS.enemyDef is "timeline"), priced through the same resolver
 * as the burst-into-mitigation door, with the `| during it:` fact line.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { TIMELINE_LINE_FLAGS } from "../../data/timelineLineFlags";
import {
  hasOffensiveSpellActive,
  hpAtPress,
  specToString,
} from "../../utils/cooldowns";
import { isEnemyCdWindowSpell } from "../../utils/enemyCDs";
import {
  enemyDefensiveEvents,
  renderedObservedSeconds,
} from "../../utils/enemyDefensives";
import {
  externalDamageForApplication,
  formatDuringExternal,
} from "../../utils/externalDamage";
import { fmtTime, toRenderSecond } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitEnemyDefEntries(
  ctx: Pick<
    TimelineCtx,
    | "matchStartMs"
    | "matchEndSeconds"
    | "enemies"
    | "enemyPid"
    | "friends"
    | "roundBounds"
    | "pid"
    | "addEntry"
  >,
): void {
  const {
    matchStartMs,
    matchEndSeconds,
    enemies,
    enemyPid,
    friends,
    roundBounds,
    pid,
    addEntry,
  } = ctx;

  if (TIMELINE_LINE_FLAGS.enemyDef === "timeline") {
    const combatSpan = {
      startTime: matchStartMs,
      endTime: matchStartMs + matchEndSeconds * 1000,
    };
    for (const enemy of enemies ?? []) {
      for (const d of enemyDefensiveEvents(enemy, enemies ?? [], combatSpan)) {
        if (d.atSeconds < 0 || d.atSeconds > matchEndSeconds) continue;
        const who = `${enemyPid(enemy.name)} (${specToString(enemy.spec)})`;
        const dur =
          d.observedSeconds !== undefined
            ? `${renderedObservedSeconds(d.observedSeconds).toFixed(1)}s${d.removedEarly ? " — removed early" : ""}`
            : "";
        const tSec = toRenderSecond(d.atSeconds);
        const tMs = matchStartMs + tSec * 1000;
        const friendlyIds = new Set(friends.map((f) => f.id));
        const hasBurst =
          friends.some((f) =>
            hasOffensiveSpellActive(
              f,
              tMs,
              friendlyIds,
              undefined,
              roundBounds,
            ),
          ) ||
          (enemies ?? []).some((e) =>
            hasOffensiveSpellActive(
              e,
              tMs,
              friendlyIds,
              isEnemyCdWindowSpell,
              roundBounds,
            ),
          );
        const burstStr = hasBurst ? " [friendly offensive CD active]" : "";
        const targetUnit =
          d.kind === "external"
            ? (enemies?.find((e) => e.id === d.recipientId) ??
              enemies?.find((e) => e.name === d.recipientName))
            : enemy;
        // HP at the press (A21, enemy-def F-E11) — the same sampler as the
        // owner's press lines; c2058ed4's Turtle read 26 % on the grid
        const hpPct = targetUnit
          ? hpAtPress(
              targetUnit,
              // the cast that put an aura up, when logged — not the aura
              matchStartMs + Math.round((d.pressSeconds ?? d.atSeconds) * 1000),
              { spellId: d.spellId, srcUnitId: enemy.id },
            )
          : null;
        let line: string;
        if (d.kind === "external") {
          const hpStr =
            hpPct !== null ? ` (target at ${hpPct.toFixed(0)}% HP)` : "";
          // GH #91: the application line owns the "what did our attackers do
          // during it" fact (GH #99 item 3 ownership rule); one shared
          // predicate with the burst-into-mitigation fact and the eval gate.
          let duringStr = "";
          if (
            TIMELINE_LINE_FLAGS.duringExternal === "annotate" &&
            targetUnit &&
            d.auraFromS !== undefined &&
            d.auraToS !== undefined
          ) {
            const obs = externalDamageForApplication(
              {
                spellId: d.spellId,
                spellName: d.spellName,
                srcUnitName: d.auraSrcName ?? d.casterName,
                fromS: d.auraFromS,
                toS: d.auraToS,
                inferredStart: !!d.auraInferredStart,
                inferredEnd: !!d.auraInferredEnd,
              },
              targetUnit,
              friends,
              enemies ?? [],
              combatSpan,
            );
            if (obs.length > 0)
              duringStr = ` | during it: ${obs.map((o) => formatDuringExternal(o, pid)).join("; ")}`;
          }
          line = `${d.spellName} → ${enemyPid(d.recipientName ?? "")}${dur ? ` (${dur})` : ""}${burstStr}${hpStr}${duringStr}`;
        } else if (d.kind === "area") {
          // Ruling A15 (2026-09-30): who pressed it and when — no %, no
          // recipients, no duration, no HP (nobody is "the target").
          line = `${d.spellName} (area)`;
        } else if (d.kind === "self-save") {
          const hpStr = hpPct !== null ? ` (at ${hpPct.toFixed(0)}% HP)` : "";
          line = `${d.spellName} (self-save)${burstStr}${hpStr}`;
        } else {
          const strength = d.kind === "immune" ? "immune" : `${d.pct}%`;
          const hpStr = hpPct !== null ? ` (at ${hpPct.toFixed(0)}% HP)` : "";
          line = `${d.spellName} (${strength}${dur ? `, ${dur}` : ""})${burstStr}${hpStr}`;
        }
        addEntry(
          d.atSeconds,
          `${fmtTime(d.atSeconds)}  [ENEMY DEF]   ${who}: ${line}`,
        );
      }
    }
  }
}
