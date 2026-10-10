/**
 * The log owner's interrupt (own or pet) and Death Grip as [RES] entries.
 *
 * User ruling 2026-09-26 (reliability round 3 N14 / W1g, "进"): the owner's
 * kick belongs on the [RES] line. It never entered the major-cooldown ledger
 * (Counterspell / Spell Lock 24 s, Disrupt 15 s sit under MIN_CD_SECONDS), so
 * f4eb's Felhunter Spell Lock — ready for the last 45 s while the Disc
 * Priest hard-cast the kill — and f4da's Counterspell (0 presses in the round)
 * were invisible. These entries are built for [RES] ONLY: the ledger's other
 * consumers ("never pressed", loadout [UNUSED], baselines) do not see them.
 *
 * Ownership is the official interrupt kit (`interruptForUnit`: baseline,
 * taken talent, or an observed pet cast); Death Grip is Death Knight class
 * baseline (DB2 SkillLineAbility 25595: skill line 796, AcquireMethod 2).
 * A kit talent the log cannot confirm (no talent list) is left out — the
 * evidence rule, not tree availability.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { effectiveCooldownSeconds } from "../data/spellEffectData";
import {
  eventReducedCooldownSeconds,
  eventReductionsFor,
} from "../data/talentScriptedCooldowns";
import {
  type IMajorCooldownInfo,
  playerTalentIdSets,
  unitCooldownOf,
} from "../utils/cooldowns";
import {
  interruptCooldownSeconds,
  interruptForUnit,
  interruptPressCooldownSeconds,
} from "../utils/enemyInterrupts";

export const DEATH_GRIP_ID = "49576";
const DEATH_KNIGHT_CLASS_ID = 6;

function castsOf(
  unit: ICombatUnit,
  spellId: string,
  matchStartMs: number,
): Array<{ timeSeconds: number }> {
  return [...unit.spellCastEvents, ...(unit.petSpellCastEvents ?? [])]
    .filter(
      (e) =>
        e.spellId === spellId &&
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    )
    .map((e) => ({ timeSeconds: (e.logLine.timestamp - matchStartMs) / 1000 }))
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
}

/** The ledger's per-press event reductions (Storm Conduit: each Lightning
 *  Bolt −1 s on Wind Shear), as extractMajorCooldowns applies them —
 *  single-charge only (codex review of batch 14: [RES] printed Wind Shear on
 *  cooldown while interruptCooldownRemainingMs had it ready). */
function withEventReductions(
  owner: ICombatUnit,
  spellId: string,
  cooldownSeconds: number,
  charges: number,
  casts: Array<{ timeSeconds: number; cooldownSecondsOverride?: number }>,
  matchStartMs: number,
): Array<{ timeSeconds: number; cooldownSecondsOverride?: number }> {
  if (charges > 1) return casts;
  const sets = playerTalentIdSets(owner);
  const reductions = eventReductionsFor(
    spellId,
    (t) => !!sets.talentedSpellIds?.has(t) || sets.pvpTalentIds.has(t),
  );
  // FT-T11c: the press's own cooldown first — an on-interrupt talent
  // (Coldthirst, Light of the Sun) shortens a press that interrupted a cast
  // (`interruptPressCooldownSeconds`, the number interruptCooldownRemainingMs
  // reads); the event reductions then act on that.
  const pressCd = (c: { timeSeconds: number }) =>
    interruptPressCooldownSeconds(
      owner,
      spellId,
      matchStartMs + c.timeSeconds * 1000,
      cooldownSeconds,
    );
  if (!reductions.length)
    return casts.map((c) => {
      const own = pressCd(c);
      return own < cooldownSeconds ? { ...c, cooldownSecondsOverride: own } : c;
    });
  const triggerSeconds = (r: { triggerCastIds: readonly string[] }) =>
    owner.spellCastEvents
      .filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          r.triggerCastIds.includes(String(e.spellId)),
      )
      .map((e) => (e.logLine.timestamp - matchStartMs) / 1000);
  return casts.map((c) => {
    const eff = eventReducedCooldownSeconds(
      c.timeSeconds,
      pressCd(c),
      reductions,
      triggerSeconds,
    );
    return eff < cooldownSeconds ? { ...c, cooldownSecondsOverride: eff } : c;
  });
}

function entry(
  spellId: string,
  spellName: string,
  cooldownSeconds: number,
  casts: Array<{ timeSeconds: number; cooldownSecondsOverride?: number }>,
  charges = 1,
): IMajorCooldownInfo {
  return {
    spellId,
    spellName,
    tag: "Utility",
    cooldownSeconds,
    // `charges` is what cdAvailableAt reads (codex review of batch 14: a
    // Death's Echo Death Grip with one charge spent read "cd:" — only
    // maxChargesDetected had been set)
    charges,
    maxChargesDetected: charges,
    casts,
    availableWindows: [],
    neverUsed: casts.length === 0,
  } as unknown as IMajorCooldownInfo;
}

export function ownerResUtilityCds(
  owner: ICombatUnit,
  matchStartMs: number,
): IMajorCooldownInfo[] {
  const out: IMajorCooldownInfo[] = [];
  const kick = interruptForUnit(owner);
  if (
    kick &&
    (kick.confirmed || castsOf(owner, kick.spellId, matchStartMs).length > 0)
  ) {
    // the owner's talent-resolved cooldown and charges — the predicate
    // interruptCooldownRemainingMs reads (agy re-review of batch 14: the
    // base cooldown ignored talent reductions, charges were fixed at 1)
    const cd = interruptCooldownSeconds(kick.spellId, owner);
    const charges = unitCooldownOf(owner, kick.spellId)?.charges ?? 1;
    if (cd !== undefined)
      out.push(
        entry(
          kick.spellId,
          kick.name,
          cd,
          withEventReductions(
            owner,
            kick.spellId,
            cd,
            charges,
            castsOf(owner, kick.spellId, matchStartMs),
            matchStartMs,
          ),
          charges,
        ),
      );
  }
  if (Number(owner.class) === DEATH_KNIGHT_CLASS_ID) {
    // the shared cooldown predicate (charge recharge, not charge spacing —
    // agy review of batch 14)
    const own = unitCooldownOf(owner, DEATH_GRIP_ID);
    const cd = own?.cooldownSeconds ?? effectiveCooldownSeconds(DEATH_GRIP_ID);
    if (cd !== undefined)
      out.push(
        entry(
          DEATH_GRIP_ID,
          "Death Grip",
          cd,
          withEventReductions(
            owner,
            DEATH_GRIP_ID,
            cd,
            own?.charges ?? 1,
            castsOf(owner, DEATH_GRIP_ID, matchStartMs),
            matchStartMs,
          ),
          own?.charges ?? 1,
        ),
      );
  }
  return out;
}
