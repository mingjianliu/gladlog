/**
 * [KICK] — interrupts by the owner, teammates and enemies: what was kicked
 * (or missed / IMMUNE / eaten), the lockout and the school, with the two
 * SPELL_MISSED rows of one kick deduplicated.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. IMMUNE_KICK_DEDUPE_MS moved here
 * with it (its only user). Output is pinned by the 605-file acceptanceCapture
 * context hash.
 */
import {
  type AtomicArenaCombat,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../../data/spellEffectData";
import { buildAuraIntervals } from "../../utils/auraIntervals";
import {
  INTERRUPT_SPELL_IDS,
  interruptCooldownSeconds,
  interruptForUnit,
  kickCastSpellId,
} from "../../utils/enemyInterrupts";
import {
  analyzeKickAudit,
  jukedByStoppedChannelText,
} from "../../utils/kickAudit";
import { fmtTime } from "../../utils/renderGrid";
import {
  auraBlocksMechanic,
  INTERRUPT_MECHANIC,
} from "../../utils/spellMechanics";
import { resolveSummonOwner, summonKindOf } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

/** Two SPELL_MISSED rows of one kick (Skull Bash logs 93985 and 106839
 * 1 ms apart) are one `[KICK] … missed — IMMUNE` line. */
const IMMUNE_KICK_DEDUPE_MS = 50;

export function emitKickEntries(
  ctx: Pick<
    TimelineCtx,
    | "friends"
    | "enemies"
    | "pid"
    | "enemyPid"
    | "allUnits"
    | "matchStartMs"
    | "addEntry"
    | "_allUnits"
    | "matchEndMs"
    | "owner"
  >,
): void {
  const { owner } = ctx;
  const {
    friends,
    enemies,
    pid,
    enemyPid,
    allUnits,
    matchStartMs,
    addEntry,
    _allUnits,
    matchEndMs,
  } = ctx;

  const friendlyNames = new Set(friends.map((f) => f.name));
  const enemyNames = new Set((enemies ?? []).map((e) => e.name));
  // Pet kicks (ghoul Shambling Rush, felhunter Spell Lock, …) log the pet as
  // the source; attribute them to the owning player so the model doesn't
  // have to guess whose pet an unknown name belongs to (F134-adjacent).
  const resolveKicker = (name: string, unitId?: string): string => {
    if (friendlyNames.has(name)) return pid(name);
    if (enemyNames.has(name)) return enemyPid(name);
    // Same name collision as actorLabel (GH #99) — the kick line has no side
    // to fall back on, so the source GUID is the only exact key here.
    const petOwner = resolveSummonOwner({
      allUnits,
      friends,
      enemies,
      name,
      sourceId: unitId,
    });
    if (petOwner) {
      const ownerLabel = friendlyNames.has(petOwner.name)
        ? pid(petOwner.name)
        : enemyPid(petOwner.name);
      const src = allUnits?.find((u) => u.id === unitId);
      return `${ownerLabel}'s ${summonKindOf(src?.id ?? unitId, src)}`;
    }
    const short = name.split("-")[0];
    // Unresolved unit = pet/NPC whose owner lookup failed. Its name is
    // client-localized — don't leak a non-ASCII unit name into the prompt.
    const isLocalized = [...short].some((c) => c.charCodeAt(0) > 127);
    return isLocalized ? "[pet]" : short;
  };
  /** The enemy player behind a kick (the kicker, or a pet's owner), or
   * null for a friendly / unresolved kicker. */
  const enemyKickerUnit = (
    name: string,
    unitId?: string,
  ): ICombatUnit | null => {
    const direct = (enemies ?? []).find((e) => e.name === name);
    if (direct) return direct;
    if (friendlyNames.has(name)) return null;
    const petOwner = resolveSummonOwner({
      allUnits,
      friends,
      enemies,
      name,
      sourceId: unitId,
    });
    return petOwner && enemyNames.has(petOwner.name)
      ? ((enemies ?? []).find((e) => e.name === petOwner.name) ?? null)
      : null;
  };
  /** Cooldown behind an enemy kick. SPELL_INTERRUPT carries the interrupt
   * EFFECT id, which for some kits is not the cast id the cooldown lives on
   * (Skull Bash 93985 vs 106839, Solar Beam 97547 vs 78675) — fall back to
   * the cast id (`kickCastSpellId`, the same resolver kick-eaten's range
   * reads), then to the kicker's kit entry (`interruptForUnit`, what the
   * "enemy interrupts UP" ledger keys on) when it is the same spell by
   * name. */
  const enemyKickCooldown = (
    unit: ICombatUnit,
    spellId: string,
    kickSpell: string,
  ): number | undefined => {
    const direct = interruptCooldownSeconds(spellId, unit);
    if (direct !== undefined) return direct;
    const cast = kickCastSpellId(spellId);
    const viaCast =
      cast !== spellId ? interruptCooldownSeconds(cast, unit) : undefined;
    if (viaCast !== undefined) return viaCast;
    const def = interruptForUnit(unit);
    return def && getEnglishSpellName(def.spellId, def.name) === kickSpell
      ? interruptCooldownSeconds(def.spellId, unit)
      : undefined;
  };
  const seenKicks = new Set<string>();
  const allUnitsForKicks = friends ? [...friends] : [];
  if (enemies) {
    allUnitsForKicks.push(...enemies);
  }
  for (const unit of allUnitsForKicks) {
    const actions = [...(unit.actionOut ?? []), ...(unit.actionIn ?? [])];
    for (const action of actions) {
      if (action.logLine.event !== LogEvent.SPELL_INTERRUPT) continue;
      const key = `${action.timestamp}|${action.srcUnitName}|${action.destUnitName}|${action.spellId}`;
      if (seenKicks.has(key)) continue;
      seenKicks.add(key);
      const atSeconds = (action.timestamp - matchStartMs) / 1000;
      if (atSeconds < 0) continue;
      const kicker = resolveKicker(action.srcUnitName, action.srcUnitId);
      // Victims get the same resolution as kickers: players → pid, pets →
      // owner attribution ("N's pet"), localized NPC names suppressed.
      const victim = resolveKicker(action.destUnitName, action.destUnitId);
      const kickSpell = getEnglishSpellName(
        action.spellId ?? "",
        action.spellName ?? "interrupt",
      );
      const stoppedSpell =
        action.extraSpellId !== undefined
          ? getEnglishSpellName(action.extraSpellId, action.extraSpellName)
          : "";
      // GH #103 A3: an ENEMY kick says when it is back — the responder
      // otherwise estimated the return ("Disrupt would have been coming back
      // around the time you were free") from nothing. The kicker's cooldown
      // (`interruptCooldownSeconds` with the kicker: their talent-resolved
      // cooldown, the same number the "enemy
      // interrupts UP" ledger reads); no row → no suffix.
      const enemyKicker = enemyKickerUnit(action.srcUnitName, action.srcUnitId);
      const kickCd =
        enemyKicker && action.spellId
          ? enemyKickCooldown(enemyKicker, action.spellId, kickSpell)
          : undefined;
      const backSuffix =
        kickCd !== undefined ? `; back ${fmtTime(atSeconds + kickCd)}` : "";
      addEntry(
        atSeconds,
        `${fmtTime(atSeconds)}  [KICK]   ${kicker} interrupted ${victim}${
          stoppedSpell ? `'s ${stoppedSpell}` : ""
        } (${kickSpell}${backSuffix})`,
      );
    }
  }

  // Triage 2026-09-29 kick-eaten F-K14a: an ENEMY kick the game rejected as
  // IMMUNE on a friendly player rendered nothing — the kick was spent into
  // an interrupt immunity and the timeline showed only the buff and the
  // cast (5e8b11c1 2:10: Mind Freeze into Spiritwalker's Aegis). "Kick" =
  // the interrupt kit (`INTERRUPT_SPELL_IDS`), the same ids the "enemy
  // interrupts UP" ledger calls an interrupt. The immunity is named only
  // when an aura on the victim is officially interrupt-immune (DB2 aura 77
  // mechanic 26, `auraBlocksMechanic`); otherwise bare IMMUNE, never a
  // guess.
  const kickKitIds = new Set(INTERRUPT_SPELL_IDS);
  const castersById = new Map(_allUnits.map((u) => [u.id, u]));
  const immuneAuraCache = new Map<
    string,
    Array<{ fromMs: number; toMs: number; name: string }>
  >();
  /** The unit's interrupt-immune auras as [fromMs, toMs], through the shared
   * pairing (`buildAuraIntervals`: BROKEN closes too, an aura with no
   * REMOVED ends at its official duration, events are sorted). The pairing
   * clamps every event to its `startTime`, so an aura put up in the prep
   * room and never REMOVED would restart its official duration at 0:00 and
   * read as up for the first seconds of the round; the origin is therefore
   * moved back to the unit's earliest aura event and the result is kept in
   * absolute milliseconds. */
  const immuneAurasOf = (unit: ICombatUnit) => {
    let hit = immuneAuraCache.get(unit.id);
    if (!hit) {
      const originMs = (unit.auraEvents ?? []).reduce(
        (lo, a) => Math.min(lo, a.timestamp),
        matchStartMs,
      );
      hit = buildAuraIntervals(
        unit,
        { startTime: originMs, endTime: matchEndMs },
        castersById,
      )
        .filter(
          (i) => auraBlocksMechanic(i.spellId, INTERRUPT_MECHANIC) === true,
        )
        .map((i) => ({
          fromMs: originMs + i.fromS * 1000,
          toMs: originMs + i.toS * 1000,
          name: getEnglishSpellName(i.spellId, i.spellName),
        }));
      immuneAuraCache.set(unit.id, hit);
    }
    return hit;
  };
  const seenImmuneKicks: Array<{ key: string; ms: number }> = [];
  for (const friend of friends) {
    for (const m of friend.missesIn ?? []) {
      if (m.missType !== "IMMUNE" || !m.spellId) continue;
      if (!kickKitIds.has(m.spellId)) continue;
      if (!enemyKickerUnit(m.srcUnitName, m.srcUnitId)) continue;
      const atSeconds = (m.timestamp - matchStartMs) / 1000;
      if (atSeconds < 0) continue;
      // one kick, one line: Skull Bash logs its two ids 1 ms apart
      const key = `${m.srcUnitId}|${friend.id}|${kickCastSpellId(m.spellId)}`;
      if (
        seenImmuneKicks.some(
          (s) =>
            s.key === key &&
            Math.abs(s.ms - m.timestamp) <= IMMUNE_KICK_DEDUPE_MS,
        )
      )
        continue;
      seenImmuneKicks.push({ key, ms: m.timestamp });
      // every interrupt-immune aura on the victim that covers the miss
      // (inclusive: one removed in the miss's own millisecond was still
      // up; 0.5 ms absorbs the seconds round trip), in the order applied —
      // with two up at once either is a true reason, so both are named
      const why = [
        ...new Set(
          immuneAurasOf(friend)
            .filter(
              (i) =>
                i.fromMs - 0.5 <= m.timestamp && m.timestamp <= i.toMs + 0.5,
            )
            .sort((a, b) => a.fromMs - b.fromMs)
            .map((i) => i.name),
        ),
      ].join(" + ");
      addEntry(
        atSeconds,
        `${fmtTime(atSeconds)}  [KICK]   ${resolveKicker(m.srcUnitName, m.srcUnitId)}'s ${getEnglishSpellName(
          m.spellId,
          m.spellName ?? "interrupt",
        )} on ${pid(friend.name)} missed — IMMUNE${why ? ` (${why})` : ""}`,
      );
    }
  }

  // B-tier B7a (user ruling 2026-10-06, a fact — never an accusation): the
  // OWNER's kicks that stopped nothing, with the kick audit's own result — the
  // audit the burst ledger's `Kicks:` line and the desktop's missed-kick card
  // read. A landed kick has its `[KICK] … interrupted …` line above and a
  // silencing one its `[SILENCE]` line; these had no line at all for a
  // non-healer owner, and for a healer only the bare `[YOU] [CAST]` press
  // (1b930c17 1:36: Wind Shear 0.07 s after the Hunter's Counter Shot had
  // interrupted the Hex).
  const audit = analyzeKickAudit(owner, enemies ?? [], {
    startTime: matchStartMs,
    units: Object.fromEntries(_allUnits.map((u) => [u.id, u])),
  } as unknown as AtomicArenaCombat);
  for (const k of audit) {
    if (k.result !== "juked" && k.result !== "missed") continue;
    const on = k.targetName
      ? ` on ${resolveKicker(k.targetName, k.targetId)}`
      : "";
    const outcome =
      k.result === "juked"
        ? k.jukedChannelStoppedAgoS !== undefined
          ? jukedByStoppedChannelText(k)
          : `JUKED by fake ${k.jukedBySpellName}`
        : k.beatenBy
          ? `hit nothing — ${resolveKicker(k.beatenBy.kickerName, k.beatenBy.kickerId)}'s ${k.beatenBy.kickSpellName} had interrupted ${k.beatenBy.interruptedSpellName ? `the ${k.beatenBy.interruptedSpellName}` : "the cast"} ${k.beatenBy.agoS < 0.1 ? "under 0.1s" : `${(Math.floor(k.beatenBy.agoS * 10 + 1e-9) / 10).toFixed(1)}s`} earlier`
          : "hit nothing";
    addEntry(
      k.atSeconds,
      `${fmtTime(k.atSeconds)}  [KICK]   your ${k.kickSpellName}${on} — ${outcome}`,
    );
  }
}
