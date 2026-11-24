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

import {
  HASTE_SCALED_COOLDOWN_NOTE,
  isHasteScaledCooldown,
} from "../../data/hasteScaledCooldowns";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { cdWholeSecond } from "../../utils/cooldowns";
import {
  INTERRUPT_SPELL_IDS,
  interruptBackAtMs,
  interruptCooldownSeconds,
  interruptForUnit,
  kickCastSpellId,
} from "../../utils/enemyInterrupts";
import {
  analyzeKickAudit,
  jukedByFakeText,
  jukedByStoppedChannelText,
  kickMissTag,
  missedKickText,
} from "../../utils/kickAudit";
import { petCommands } from "../../utils/petCommands";
import { fmtTime } from "../../utils/renderGrid";
import { interruptImmuneWindows } from "../../utils/talentBehaviors";
import { resolveSummonOwner, summonKindOf } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

/** Two SPELL_MISSED rows of one kick (Skull Bash logs 93985 and 106839
 * 1 ms apart) are one `[KICK] … missed — IMMUNE` line. */
const IMMUNE_KICK_DEDUPE_MS = 50;

/** One refused kick: the miss row, the player it was refused on, and the
 * unit that kicked (a commanded pet for an owner's command row). */
export interface IImmuneKickRow {
  m: NonNullable<ICombatUnit["missesIn"]>[number];
  victim: ICombatUnit;
  kicker: { name: string; id: string };
}

/**
 * The kicks (`INTERRUPT_SPELL_IDS`, the kit the "enemy interrupts UP" ledger
 * calls an interrupt) the log refused IMMUNE on `victims`, one row per kick,
 * for kickers `kickerPlayerOf` resolves to a player (the kicker, or a pet's
 * owner). The one selection behind every `[KICK] … missed — IMMUNE` line and
 * its scan (scan5/t253).
 */
export function immuneKickRows(o: {
  victims: readonly ICombatUnit[];
  kickerPlayerOf: (name: string, unitId?: string) => ICombatUnit | null;
  units: readonly ICombatUnit[];
  /** rows before this instant (the round's start) are no kick of the round */
  fromMs: number;
}): IImmuneKickRow[] {
  const kickKitIds = new Set(INTERRUPT_SPELL_IDS);
  const out: IImmuneKickRow[] = [];
  const seenImmuneKicks: Array<{ key: string; ms: number }> = [];
  const commandsOf = new Map<string, ReturnType<typeof petCommands>>();
  for (const friend of o.victims) {
    for (const m of friend.missesIn ?? []) {
      if (m.missType !== "IMMUNE" || !m.spellId) continue;
      if (!kickKitIds.has(m.spellId)) continue;
      const kickerPlayer = o.kickerPlayerOf(m.srcUnitName, m.srcUnitId);
      if (!kickerPlayer) continue;
      if (m.timestamp < o.fromMs) continue;
      // fact6 D30's reading for kicks: the owner's command (Command Demon:
      // Spell Lock 119910) is the pet's kick — the Felhunter's own IMMUNE row
      // states it; a command no summon row carried out prints once, as the
      // pet's (`petCommands`)
      let kicker = { name: m.srcUnitName, id: m.srcUnitId };
      if (kickerPlayer.id === m.srcUnitId) {
        let cmd = commandsOf.get(kickerPlayer.id);
        if (!cmd) {
          cmd = petCommands(kickerPlayer, { units: o.units });
          commandsOf.set(kickerPlayer.id, cmd);
        }
        const name = getEnglishSpellName(m.spellId, m.spellName ?? "");
        if (cmd.carriedOutBy(m.timestamp, name)) continue;
        if (cmd.isCommandRow(m.spellId, m.timestamp, IMMUNE_KICK_DEDUPE_MS)) {
          const pet = cmd.commandPet(name);
          if (pet) kicker = { name: pet.name, id: pet.id };
        }
      }
      // one kick, one line: Skull Bash logs its two ids 1 ms apart
      const key = `${kicker.id}|${friend.id}|${kickCastSpellId(m.spellId)}`;
      if (
        seenImmuneKicks.some(
          (s) =>
            s.key === key &&
            Math.abs(s.ms - m.timestamp) <= IMMUNE_KICK_DEDUPE_MS,
        )
      )
        continue;
      seenImmuneKicks.push({ key, ms: m.timestamp });
      out.push({ m, victim: friend, kicker });
    }
  }
  return out;
}

/** The teammate behind a kick (the kicker, or a pet's owner) — never the
 * owner, whose refused kicks print from the kick audit — or null. */
export function teammateKickerUnit(
  ctx: Pick<TimelineCtx, "friends" | "enemies" | "allUnits" | "owner">,
  name: string,
  unitId?: string,
): ICombatUnit | null {
  const mate = (u: ICombatUnit | undefined) =>
    u && u.id !== ctx.owner.id ? u : null;
  // the source GUID decides before any name does: a pet that shares a
  // teammate's display name is its owner's (codex 85-tk-L4-T253-1 #3)
  if (unitId) {
    const byId = ctx.friends.find((f) => f.id === unitId);
    if (byId) return mate(byId);
    if ((ctx.enemies ?? []).some((e) => e.id === unitId)) return null;
  }
  const src = unitId ? ctx.allUnits?.find((u) => u.id === unitId) : undefined;
  if (!src?.ownerId) {
    if (ctx.friends.some((f) => f.name === name))
      return mate(ctx.friends.find((f) => f.name === name));
    if ((ctx.enemies ?? []).some((e) => e.name === name)) return null;
  }
  const petOwner = resolveSummonOwner({
    allUnits: ctx.allUnits,
    friends: ctx.friends,
    enemies: ctx.enemies,
    name,
    sourceId: unitId,
  });
  return mate(ctx.friends.find((f) => f.id === petOwner?.id));
}

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
      const staticKickCd =
        enemyKicker && action.spellId
          ? enemyKickCooldown(enemyKicker, action.spellId, kickSpell)
          : undefined;
      // FT-T11c: the cooldown runs from the PRESS behind this interrupt, and
      // a holder of an on-interrupt talent (Coldthirst, Light of the Sun)
      // gets a press that interrupted its target back sooner
      // (`interruptBackAtMs` — the readiness predicate's own number)
      const backAtSeconds =
        staticKickCd !== undefined && enemyKicker && action.spellId
          ? (interruptBackAtMs(
              enemyKicker,
              action.spellId,
              action.logLine.timestamp,
              staticKickCd,
            ) -
              matchStartMs) /
            1000
          : undefined;
      // T111 / R47: a haste-scaled kick (Protection's Avenger's Shield) is
      // back sooner than its unhasted base by an amount the log does not state
      const backSuffix =
        backAtSeconds === undefined
          ? ""
          : isHasteScaledCooldown(action.spellId ?? "", enemyKicker?.spec)
            ? `; ${HASTE_SCALED_COOLDOWN_NOTE}`
            : `; back ${fmtTime(cdWholeSecond(backAtSeconds))}`;
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
  // mechanic 26, `interruptImmuneWindows`); otherwise bare IMMUNE, never a
  // guess.
  const castersById = new Map(_allUnits.map((u) => [u.id, u]));
  const immuneAuraCache = new Map<
    string,
    ReturnType<typeof interruptImmuneWindows>
  >();
  const immuneAurasOf = (unit: ICombatUnit) => {
    let hit = immuneAuraCache.get(unit.id);
    if (!hit) {
      hit = interruptImmuneWindows(
        unit,
        { startTime: matchStartMs, endTime: matchEndMs },
        castersById,
      );
      immuneAuraCache.set(unit.id, hit);
    }
    return hit;
  };
  // …but one APPLIED in the miss's millisecond on a row AFTER it came with
  // the kick, not before it: Precognition is triggered by being kicked
  // (fact4 D48, 68ea5d79 2:07 — the round's first Precognition logged in the
  // IMMUNE miss's ms, after its row; a later kick on the idle priest
  // triggered it again with no miss)
  const appliedAfterMissRow = (
    unit: ICombatUnit,
    i: { spellId: string; from: number },
    m: { timestamp: number; logLine: { lineIndex?: number } },
  ) =>
    Math.abs(i.from - m.timestamp) <= 0.5 &&
    (unit.auraEvents ?? []).some(
      (a) =>
        a.spellId === i.spellId &&
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        Math.abs(a.timestamp - m.timestamp) <= 0.5 &&
        (a.logLine.lineIndex ?? 0) > (m.logLine.lineIndex ?? 0),
    );
  // T253 / R106 (user 2026-11-22): the same line for the other direction — a
  // TEAMMATE's kick, or a teammate's pet's, refused IMMUNE on an enemy
  // player. The owner's own refused kicks (and their pet's) keep their
  // `[KICK]   your …` line from the kick audit below.
  const immuneKicks = [
    ...immuneKickRows({
      victims: friends,
      kickerPlayerOf: enemyKickerUnit,
      units: _allUnits,
      fromMs: matchStartMs,
    }),
    ...immuneKickRows({
      victims: enemies ?? [],
      kickerPlayerOf: (name, unitId) => teammateKickerUnit(ctx, name, unitId),
      units: _allUnits,
      fromMs: matchStartMs,
    }),
  ];
  for (const { m, victim: friend, kicker } of immuneKicks) {
    const atSeconds = (m.timestamp - matchStartMs) / 1000;
    if (atSeconds < 0) continue;
    // every interrupt-immune aura on the victim that covers the miss
    // (inclusive: one removed in the miss's own millisecond was still
    // up; 0.5 ms absorbs the seconds round trip), in the order applied —
    // with two up at once either is a true reason, so both are named
    const why = [
      ...new Set(
        immuneAurasOf(friend)
          .filter(
            (i) =>
              i.from - 0.5 <= m.timestamp &&
              m.timestamp <= i.to + 0.5 &&
              !appliedAfterMissRow(friend, i, m),
          )
          .sort((a, b) => a.from - b.from)
          .map((i) => i.auraName),
      ),
    ].join(" + ");
    addEntry(
      atSeconds,
      `${fmtTime(atSeconds)}  [KICK]   ${resolveKicker(kicker.name, kicker.id)}'s ${getEnglishSpellName(
        m.spellId,
        m.spellName ?? "interrupt",
      )} on ${friends.some((f) => f.id === friend.id) ? pid(friend.name) : enemyPid(friend.name)} missed — IMMUNE${why ? ` (${why})` : ""}`,
    );
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
          : jukedByFakeText(k)
        : k.beatenBy
          ? `hit nothing — ${resolveKicker(k.beatenBy.kickerName, k.beatenBy.kickerId)}'s ${k.beatenBy.kickSpellName} had interrupted ${k.beatenBy.interruptedSpellName ? `the ${k.beatenBy.interruptedSpellName}` : "the cast"} ${k.beatenBy.agoS < 0.1 ? "under 0.1s" : `${(Math.floor(k.beatenBy.agoS * 10 + 1e-9) / 10).toFixed(1)}s`} earlier`
          : missedKickText(k);
    // a kick refused at a live cast has no outcome words: the tag alone
    addEntry(
      k.atSeconds,
      `${fmtTime(k.atSeconds)}  [KICK]   your ${k.kickSpellName}${on} — ${`${outcome}${kickMissTag(k, resolveKicker)}`.trim()}`,
    );
  }
}
