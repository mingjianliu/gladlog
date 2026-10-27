/**
 * [ENEMY DEF] (GH #97) — enemy defensive cooldowns on the timeline (when
 * TIMELINE_LINE_FLAGS.enemyDef is "timeline"), priced through the same resolver
 * as the burst-into-mitigation door, with the `| during it:` fact line.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { MITIGATION_TABLE } from "../../data/mitigationData";
import { TIMELINE_LINE_FLAGS } from "../../data/timelineLineFlags";
import {
  guardianSpiritSaveClause,
  hasOffensiveSpellActive,
  hpAtPress,
  specToString,
} from "../../utils/cooldowns";
import { isEnemyCdWindowSpell } from "../../utils/enemyCDs";
import {
  ENEMY_DEF_DEFLECTS_WORDS,
  ENEMY_DEF_END_NOT_LOGGED,
  ENEMY_DEF_NO_PRESS_TAG,
  ENEMY_DEF_UNSEEN_PRESS_TAG,
  enemyDefensiveEvents,
  enemySaveEffectNote,
  immunitySchoolWords,
  limitedImmunitySchoolMask,
  renderedObservedSeconds,
  wallTableIdOfAura,
} from "../../utils/enemyDefensives";
import {
  externalDamageForApplication,
  formatDuringExternal,
} from "../../utils/externalDamage";
import { isDeferralAbsorb } from "../../utils/incomingPressure";
import {
  karmaFeedClause,
  karmaFeedOf,
  TOUCH_OF_KARMA_ID,
} from "../../utils/karmaFeed";
import { fmtTime } from "../../utils/renderGrid";
import { AURA_STILL_UP_AT_ROUND_END } from "../../utils/roundEnd";
import { selfDefensiveLabelWords } from "../../utils/selfDefensiveMechanism";
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
    | "actorLabel"
    | "addEntry"
    | "_allUnits"
  > &
    // optional for the hand-built contexts of the unit tests: absent, the
    // log's end stands in
    Partial<Pick<TimelineCtx, "roundEndAtMs">>,
): void {
  const {
    matchStartMs,
    matchEndSeconds,
    enemies,
    enemyPid,
    friends,
    roundBounds,
    pid,
    actorLabel,
    addEntry,
    _allUnits,
  } = ctx;

  if (TIMELINE_LINE_FLAGS.enemyDef === "timeline") {
    const combatSpan = {
      startTime: matchStartMs,
      endTime: matchStartMs + matchEndSeconds * 1000,
    };
    // The round's end (`roundEndMs`: a Solo Shuffle round's ending death,
    // ~2 s before the log's end) — the instant `— still up when the round
    // ended` and the `during it` window are read against, as on every other
    // line that says the round ended.
    const roundEndAtMs = Math.min(
      ctx.roundEndAtMs ?? combatSpan.endTime,
      combatSpan.endTime,
    );
    const roundSpan = { startTime: matchStartMs, endTime: roundEndAtMs };
    for (const enemy of enemies ?? []) {
      const events = enemyDefensiveEvents(
        enemy,
        enemies ?? [],
        combatSpan,
        roundEndAtMs,
      );
      for (const d of events) {
        if (d.atSeconds < 0 || d.atSeconds > matchEndSeconds) continue;
        const who = `${enemyPid(enemy.name)} (${specToString(enemy.spec)})`;
        // FT-T08 step 3: an early end says the cause the log gives for it
        // (`auraEndFromLog`); `removed early` is what is left when it gives
        // none. A dispel line names this aura outright, so it is read before
        // the holder's death (a cascade inferred from timing).
        const end = d.earlyEnd;
        const taker =
          end?.takenBy &&
          `${actorLabel(
            end.takenBy.unitName,
            (enemies ?? []).some((e) => e.id === end.takenBy!.unitId)
              ? "enemy"
              : "friendly",
            end.takenBy.unitId,
          )}'s ${end.takenBy.spellName}`;
        // a dispel line the log cannot tie to this copy is stated next to
        // the death / the empty shield, never dropped behind them
        const unclear = end?.takeUnclear
          ? "; a dispel of this spell is logged at that moment, not which copy it took"
          : "";
        const earlyNote = d.upAtRoundEnd
          ? ` — ${AURA_STILL_UP_AT_ROUND_END}`
          : !d.removedEarly
            ? ""
            : end?.takenBy
              ? ` — ${end.takenBy.kind} by ${taker}`
              : end?.holderDied
                ? d.kind === "external"
                  ? ` — its target died${unclear}`
                  : ` — ended at death${unclear}`
                : end?.absorb?.left === 0
                  ? // an `(absorb Nk, …)` line already leads with the amount
                    d.effect === "absorb"
                    ? ` — used up${unclear}`
                    : ` — used up, absorbed ${Math.round(end.absorb.absorbed / 1000)}k${unclear}`
                  : end?.takeUnclear
                    ? " — a dispel of this spell is logged at that moment, not which copy it took"
                    : " — removed early";
        // Ruling D6 (2026-10-10): an aura the log never shows end prints
        // that, not the official length the interval was closed at — the
        // number was read as OBSERVED (`Mass Invisibility (immune, 12.0s)` on
        // a mage hit 3.3 s later).
        const dur = d.endNotLogged
          ? ENEMY_DEF_END_NOT_LOGGED
          : d.observedSeconds !== undefined
            ? `${renderedObservedSeconds(d.observedSeconds).toFixed(1)}s${earlyNote}`
            : "";
        const friendlyIds = new Set(friends.map((f) => f.id));
        // the tag is a fact of the PRESS instant (round-3 audit D8: at
        // m:ss.0 it missed a Dark Transformation started 0.13 s before an
        // Obsidian Scales in the same second)
        const pressMs =
          matchStartMs + Math.round((d.pressSeconds ?? d.atSeconds) * 1000);
        const hasBurst =
          friends.some((f) =>
            hasOffensiveSpellActive(
              f,
              pressMs,
              friendlyIds,
              undefined,
              roundBounds,
            ),
          ) ||
          (enemies ?? []).some((e) =>
            hasOffensiveSpellActive(
              e,
              pressMs,
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
              // the window stops where the printed length does
              roundSpan,
            );
            if (obs.length > 0)
              duringStr = ` | during it: ${obs.map((o) => formatDuringExternal(o, pid)).join("; ")}`;
          }
          // B18: a Guardian Spirit whose save triggered says so — ahead of
          // `| during it:`, which the gate reads to the end of the line
          const saveStr = guardianSpiritSaveClause(
            d.spellId,
            enemy,
            d.pressSeconds ?? d.atSeconds,
            matchStartMs,
            targetUnit?.name,
          );
          line = `${d.spellName} → ${enemyPid(d.recipientName ?? "")}${dur ? ` (${dur})` : ""}${burstStr}${hpStr}${saveStr}${duringStr}`;
        } else if (d.kind === "area") {
          // Ruling A15 (2026-09-30): who pressed it and when — no %, no
          // recipients, no duration, no HP (nobody is "the target"). fact2
          // (2026-10-20): the second's `[friendly offensive CD active]` tag
          // is a fact of the second, not of the save — its absence read as
          // "nothing of ours was running" (0deb726b 0:47 Spirit Link Totem)
          line = `${d.spellName} (area)${burstStr}`;
        } else if (d.kind === "self-save") {
          // The unit's own defensive outside the wall table, labelled by what
          // it DOES — never by why it was pressed (user ruling 2026-10-11;
          // the label read `(self-save)`):
          //  - an effect note (ruling D8): Feign Death's shield and a pressed
          //    absorb with what it absorbed and how long it was up, a proc
          //    by its type;
          //  - else the press's mechanism (`selfDefensiveMechanism`), a
          //    percentage reduction with how long its aura was up;
          //  - a press no source classifies prints no label at all.
          const label =
            d.effect !== undefined
              ? enemySaveEffectNote(d.effect, d.absorbedAmount, dur)
              : d.mechanism
                ? `${selfDefensiveLabelWords(d.mechanism)}${d.mechanism.kind === "reduction" && dur ? `, ${dur}` : ""}`
                : "";
          const hpStr = hpPct !== null ? ` (at ${hpPct.toFixed(0)}% HP)` : "";
          // B18: a Guardian Spirit the priest put on THEMSELVES is a
          // self-save here, not an external (agy review of the batch)
          const selfSaveStr = guardianSpiritSaveClause(
            d.spellId,
            enemy,
            d.pressSeconds ?? d.atSeconds,
            matchStartMs,
            enemy.name,
          );
          // B20a: Touch of Karma says what our side fed it and where it
          // sent the damage — a fact, by PRESS time (karmaFeed.ts)
          let karmaStr = "";
          if (d.spellId === TOUCH_OF_KARMA_ID) {
            const pressS = d.pressSeconds ?? d.atSeconds;
            const nextS = events
              .filter(
                (o) =>
                  o.spellId === TOUCH_OF_KARMA_ID &&
                  (o.pressSeconds ?? o.atSeconds) > pressS,
              )
              .map((o) => o.pressSeconds ?? o.atSeconds)
              .sort((a, b) => a - b)[0];
            karmaStr = karmaFeedClause(
              karmaFeedOf(
                enemy,
                pressS,
                nextS,
                friends,
                _allUnits,
                matchStartMs,
              ),
              pid,
              fmtTime,
            );
          }
          const channelStr = channelTargetClause(
            enemy,
            d,
            friends,
            matchStartMs,
            roundEndAtMs,
            pid,
            enemies ?? [],
            enemyPid,
          );
          // F16 retest: a rider shield no press of its own put up
          // (Shield of Vengeance with Divine Protection) says so, as a wall
          // copy does (F15 C5)
          const noPress = d.noPressLogged
            ? ` ${ENEMY_DEF_NO_PRESS_TAG}`
            : d.unseenPress
              ? ` ${ENEMY_DEF_UNSEEN_PRESS_TAG}`
              : "";
          line = `${d.spellName}${label ? ` (${label})` : ""}${noPress}${burstStr}${hpStr}${selfSaveStr}${karmaStr}${channelStr}`;
        } else {
          // F15 C2: a school-limited immunity says which schools it stops
          const limited =
            d.kind === "immune"
              ? limitedImmunitySchoolMask(wallTableIdOfAura(d.spellId))
              : undefined;
          // Aspect of the Turtle (user ruling 2026-10-21): no immunity, no
          // percentage — what the log shows it doing
          const deflects =
            MITIGATION_TABLE[wallTableIdOfAura(d.spellId)]
              ?.deflectsDirectAttacks === true;
          const strength = deflects
            ? ENEMY_DEF_DEFLECTS_WORDS
            : d.kind === "immune"
              ? limited !== undefined
                ? `immune to ${immunitySchoolWords(limited)}`
                : "immune"
              : `${d.pct}%`;
          const hpStr = hpPct !== null ? ` (at ${hpPct.toFixed(0)}% HP)` : "";
          // F15 C5: a copy no press put up says so; fact3 D35: a press made
          // while the unit was unseen, too
          const noPress = d.noPressLogged
            ? ` ${ENEMY_DEF_NO_PRESS_TAG}`
            : d.unseenPress
              ? ` ${ENEMY_DEF_UNSEEN_PRESS_TAG}`
              : "";
          line = `${d.spellName} (${strength}${dur ? `, ${dur}` : ""})${noPress}${burstStr}${hpStr}`;
        }
        addEntry(
          d.atSeconds,
          `${fmtTime(d.atSeconds)}  [ENEMY DEF]   ${who}: ${line}`,
        );
      }
    }
  }
}

/**
 * WO3 #16 (r1008-57): a self-save pressed AT one of our players — Ultimate
 * Penitence channels at the target its SUCCESS names — says who that was and
 * what the channel dealt them: the caster's damage rows to that player under
 * the cast's own (log-locale) name, over the caster's own aura of it (the
 * line's printed length, clipped to the round's end), beside everything
 * that player took in the same span. Nothing when the SUCCESS names no
 * friendly or no such damage landed.
 * @internal exported for tests
 */
export function channelTargetClause(
  enemy: ICombatUnit,
  d: {
    spellId: string;
    atSeconds: number;
    pressSeconds?: number;
    observedSeconds?: number;
  },
  friends: readonly ICombatUnit[],
  matchStartMs: number,
  roundEndAtMs: number,
  pid: (name: string) => string,
  /** the caster's own team: a cast row can name one of them (fact5 retest
   * r4 7798a79a 0:50: Ultimate Penitence aimed at the priest's own Feral,
   * its bolts on 2(HDHunter)) */
  castersTeam: readonly ICombatUnit[] = [],
  castersPid: (name: string) => string = pid,
): string {
  if (d.observedSeconds === undefined) return "";
  const pressMs =
    matchStartMs + Math.round((d.pressSeconds ?? d.atSeconds) * 1000);
  const cast = (enemy.spellCastEvents ?? []).find(
    (c) =>
      c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      c.spellId === d.spellId &&
      Math.abs(c.logLine.timestamp - pressMs) <= 1,
  );
  if (!cast) return "";
  const fromMs = matchStartMs + Math.round(d.atSeconds * 1000);
  const toMs = Math.min(
    fromMs + Math.round(d.observedSeconds * 1000),
    roundEndAtMs,
  );
  // Work order 2026-10-14d #2: name the units the bolts LANDED on, not the
  // cast row's target — f94a7604 1:05: the SUCCESS names the hunter, one bolt
  // hit him (9k) and ~30 hit the priest (673k). The log does not say whether
  // the game re-aims the channel; it says where the damage went.
  // Per friendly: landed (`effectiveAmount`) plus what shields absorbed
  // (`absorbsIn`, the victim-keyed stream) — the two parts `Top damage`
  // counts — beside everything they took over the channel.
  const per = friends.map((f) => {
    let dealt = 0;
    let took = 0;
    const hitIds = new Set<string>();
    for (const r of f.damageIn ?? []) {
      const ts = r.logLine.timestamp;
      if (ts < fromMs || ts > toMs || r.srcUnitId === f.id) continue;
      const amount = Math.abs(r.effectiveAmount);
      took += amount;
      if (r.srcUnitId === enemy.id && r.spellName === cast.spellName) {
        dealt += amount;
        if (r.spellId) hitIds.add(r.spellId);
      }
    }
    for (const a of f.absorbsIn ?? []) {
      if (a.timestamp < fromMs || a.timestamp > toMs) continue;
      if (!a.attackerId || a.attackerId === f.id) continue;
      if (isDeferralAbsorb(a)) continue; // delayed, counted when it lands
      const amount = Math.abs(a.absorbedAmount);
      took += amount;
      if (
        a.attackerId === enemy.id &&
        ((a.attackSpellId !== undefined && hitIds.has(a.attackSpellId)) ||
          a.attackSpellName === cast.spellName)
      )
        dealt += amount;
    }
    return {
      f,
      dealtK: Math.round(dealt / 1000),
      tookK: Math.round(took / 1000),
    };
  });
  const hit = per
    .filter((x) => x.dealtK > 0)
    .sort((a, b) => b.dealtK - a.dealtK);
  if (hit.length === 0) return "";
  const namedFriend = friends.find((f) => f.id === cast.destUnitId);
  const namedMate = namedFriend
    ? undefined
    : castersTeam.find((e) => e.id === cast.destUnitId && e.id !== enemy.id);
  const castRow =
    namedFriend && namedFriend.id !== hit[0]!.f.id
      ? ` (its cast row names ${pid(namedFriend.name)})`
      : namedMate
        ? ` (its cast row names ${castersPid(namedMate.name)})`
        : "";
  return ` — its bolts hit ${hit
    .map(
      (x) =>
        `${pid(x.f.name)}: ${x.dealtK}k of the ${x.tookK}k damage they took over it`,
    )
    .join("; ")}${castRow}`;
}
