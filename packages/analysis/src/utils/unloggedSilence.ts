/**
 * Silences the log writes no aura for, read onto the log's owner — the one
 * reading behind the `[SILENCE] … no aura logged` line
 * (`timelineSections/silence.ts`) and the cast-bar stop evidence
 * (`ownerCastBarOutcomes` → `castBarOutcomesOf`'s `near` = "cc"; fact11 D6,
 * 0d7c70b7 r0 1:29.811: a Solar Beam on the owner's teammate, the owner's
 * Fear "Interrupted" 13 ms later, read as the player's own cancel while the
 * line below it said the Beam silenced them).
 *
 * fact1215 R11 (user approved 2026-10-19): a silence the log writes no aura
 * for (Solar Beam: its 81261 never appears in 1,215 logs) is proven only by
 * the owner's own press refused as silenced while no silence aura was on them
 * (d64022ad 0:25.915: Flash Heal refused after a 0:25.340 Solar Beam). Its
 * source: the latest enemy cast whose official effect aura
 * (`nominatedEffectAurasOfCast`) is a silence, inside that aura's official
 * length. The silence is placed at the cast — the log has no landing row and
 * no length.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { controlRejectKindOf } from "../context/controlRejectedPresses";
import { BACKLASH_AURA_CC_TYPE } from "../data/backlashCc";
import { nominatedEffectAurasOfCast } from "../data/castEffectAuras";
import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
import { buildAuraIntervals } from "./auraIntervals";
import { isSilenceEffectAura, silenceIntervals } from "./cannotCastIntervals";
import type { RawStreams } from "./rawStreams";
import { isSilenceableCast } from "./spellMechanics";

export interface UnloggedSilenceOnOwner {
  /** epoch ms of the enemy's cast row — where the silence is placed */
  castMs: number;
  spellId: string;
  spellName: string;
  srcId: string;
  srcName: string;
  /** epoch ms of the owner's first press refused as silenced under it */
  refusalMs: number;
  refusalSpellName: string;
}

interface UnloggedSilenceParams {
  owner: ICombatUnit;
  /** every unit of the round (the "logged on anyone" test reads them all) */
  allUnits: readonly ICombatUnit[];
  /** the other side's players; their pets join through `ownerId` */
  enemies: readonly ICombatUnit[];
  matchStartMs: number;
  roundEndAtMs: number;
  rawStreams?: RawStreams;
}

interface UnloggedSilenceCast {
  ms: number;
  untilMs: number;
  spellId: string;
  spellName: string;
  srcId: string;
  srcName: string;
}

/**
 * Every press of the owner's refused as silenced that an aura-less silence
 * explains, by the cast that explains it, in time order — the one selection
 * behind the `[SILENCE] … no aura logged` line (the first of each cast) and
 * the cannot-cast spans (`unloggedSilenceSpansOnOwner`, all of them).
 */
function refusalsUnderUnloggedSilences(
  params: UnloggedSilenceParams,
): Map<UnloggedSilenceCast, Array<{ ms: number; spellName: string }>> {
  const out = new Map<
    UnloggedSilenceCast,
    Array<{ ms: number; spellName: string }>
  >();
  const { owner, allUnits, matchStartMs, roundEndAtMs, rawStreams } = params;
  if (!rawStreams?.available) return out;
  const enemyIds = new Set(params.enemies.map((u) => u.id));
  for (const u of allUnits)
    if (u.ownerId && enemyIds.has(u.ownerId)) enemyIds.add(u.id);
  // every logged silence on the owner covers its refusals, by the same
  // reading that nominates — the dispel-backlash one too, which
  // `silenceIntervals` leaves to its own line (b47: 19 "Unstable Affliction
  // … no aura logged" lines were the logged 196364 backlash), and a logged
  // DR-Silence aura `silenceIntervals` does not carry (codex 20-F15-36: a
  // logged Solar Beam 81261 left a Strangulate cast "unlogged")
  const covered = [
    ...silenceIntervals(owner, enemyIds),
    ...buildAuraIntervals(owner, {
      startTime: matchStartMs,
      endTime: roundEndAtMs,
    })
      .filter((iv) => isSilenceEffectAura(iv.spellId))
      .map((iv) => ({
        from: matchStartMs + iv.fromS * 1000,
        to: matchStartMs + iv.toS * 1000,
      })),
  ];
  // a refusal after the owner's death in this round is no silence
  const ownerDeathMs = Math.min(
    ...(owner.deathRecords ?? [])
      .map((d) => d.timestamp)
      .filter((t) => t >= matchStartMs),
  );
  const silenceCasts: UnloggedSilenceCast[] = [];
  for (const u of allUnits)
    if (enemyIds.has(u.id))
      for (const c of u.spellCastEvents ?? []) {
        if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !c.spellId)
          continue;

        // a cast whose silence is a dispel backlash (Unstable Affliction:
        // its name also nominates two old silence auras, 43523 / 65813)
        // silences the dispeller through a logged aura with its own line
        if (
          nominatedEffectAurasOfCast(c.spellId).some((a) =>
            BACKLASH_AURA_CC_TYPE.has(a),
          )
        )
          continue;
        // a class-owned effect only: Arcane Torrent's name nominates the
        // TBC silence 33390, while the racial today only dispels (codex
        // 20-F15-36)
        const aura = nominatedEffectAurasOfCast(c.spellId, {
          classOwned: true,
        }).find(isSilenceEffectAura);
        if (!aura) continue;
        const lenS = spellEffectData[aura]?.durationSeconds;
        if (!lenS) continue;
        // … whose silence the log did NOT write — on anyone (b48–b52: a
        // Strangulate on a teammate silenced that teammate, logged; a
        // logged Strangulate on the owner removed early; Solar Beam is an
        // area and is written on no one, whoever it was aimed at)
        const logged = allUnits
          .flatMap((x) => x.auraEvents ?? [])
          .some(
            (a) =>
              !!a.spellId &&
              (a.spellId === aura || isSilenceEffectAura(a.spellId)) &&
              a.srcUnitId === c.srcUnitId &&
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
              a.timestamp >= c.logLine.timestamp - 100 &&
              a.timestamp <= c.logLine.timestamp + lenS * 1000,
          );
        if (logged) continue;
        silenceCasts.push({
          ms: c.logLine.timestamp,
          untilMs: c.logLine.timestamp + lenS * 1000,
          spellId: c.spellId,
          spellName: getEnglishSpellName(c.spellId, c.spellName),
          srcId: c.srcUnitId,
          srcName: c.srcUnitName,
        });
      }
  const failed = rawStreams.castFailed
    .filter(
      (h) =>
        h.unitGuid === owner.id && controlRejectKindOf(h.reason) === "silence",
    )
    .map((h) => ({ h, ms: matchStartMs + Math.round(h.tSeconds * 1000) }))
    .sort((x, y) => x.ms - y.ms);
  for (const { h, ms } of failed) {
    if (ms >= roundEndAtMs || ms >= ownerDeathMs) continue;
    if (covered.some((s) => s.from <= ms && ms <= s.to)) continue;
    // one source only: a refusal two such casts could explain (a Solar
    // Beam and a Wailing Arrow, both unlogged — 27-6 2:04; two druids'
    // Beams — codex 20-F15-36) names neither
    const open = silenceCasts.filter((c) => c.ms <= ms && ms <= c.untilMs);
    if (new Set(open.map((c) => `${c.srcId}:${c.spellName}`)).size !== 1)
      continue;
    const src = open.sort((a, b) => b.ms - a.ms)[0];
    if (!src) continue;
    const list = out.get(src) ?? [];
    list.push({
      ms,
      spellName: getEnglishSpellName(String(h.spellId), h.spellName),
    });
    out.set(src, list);
  }
  return out;
}

/**
 * The aura-less silences on `owner` in the round, each proven by the owner's
 * first refusal as silenced under it. Empty when the owner did not record the
 * log (`rawStreams` unavailable).
 */
export function unloggedSilencesOnOwner(
  params: UnloggedSilenceParams,
): UnloggedSilenceOnOwner[] {
  return [...refusalsUnderUnloggedSilences(params)].flatMap(([c, list]) => {
    const r = list[0];
    return r
      ? [
          {
            castMs: c.ms,
            spellId: c.spellId,
            spellName: c.spellName,
            srcId: c.srcId,
            srcName: c.srcName,
            refusalMs: r.ms,
            refusalSpellName: r.spellName,
          },
        ]
      : [];
  });
}

/**
 * The time the log PROVES the owner sat in an aura-less silence: from one
 * press refused as silenced to the next under the same cast
 * (`refusalsUnderUnloggedSilences`), as cannot-cast spans in epoch ms. The
 * log gives such a silence no landing row and no length (Solar Beam is an
 * area the player can leave), so nothing before the first refusal or after
 * the last is claimed, and a spell a silence stops (`isSilenceableCast`)
 * going out between two refusals cuts the span there — the owner was out of
 * it then. A lower bound on the silenced time, never an estimate of it.
 *
 * fact14 D5 (3c8cd2a3 r0 0:29): `[INACTIVITY] … inactive 6.2s (6.2s of it
 * un-CC'd/free to cast)` and the menu's `freeS=6` beside `pressed but
 * rejected (silenced×14)` — fourteen refusals from 0:31.938 to 0:35.707
 * under a Solar Beam cast at 0:29.667.
 */
export function unloggedSilenceSpansOnOwner(
  params: UnloggedSilenceParams,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const wentOut = (params.owner.spellCastEvents ?? [])
    .filter(
      (c) =>
        c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!c.spellId &&
        isSilenceableCast(c.spellId),
    )
    .map((c) => c.logLine.timestamp);
  for (const list of refusalsUnderUnloggedSilences(params).values()) {
    let from: number | undefined;
    let to = 0;
    for (const { ms } of list) {
      if (from !== undefined && wentOut.some((t) => to < t && t < ms)) {
        if (to > from) out.push({ from, to });
        from = undefined;
      }
      from ??= ms;
      to = ms;
    }
    if (from !== undefined && to > from) out.push({ from, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The silences the timeline prints a `[SILENCE]` line for on `unit`: its
 * logged silence auras from the other side (`silenceIntervals`) that began
 * before the round's end (F02b), in time order. The one set behind the
 * lines (`timelineSections/silence.ts`) and the kit's landed silences
 * (`landedControlsForKit`, fact11 D5). */
export function silenceIntervalsInRound(
  unit: ICombatUnit,
  attackerIds: Set<string>,
  roundEndAtMs: number,
): ReturnType<typeof silenceIntervals> {
  return silenceIntervals(unit, attackerIds).filter(
    (s) => s.from < roundEndAtMs,
  );
}
