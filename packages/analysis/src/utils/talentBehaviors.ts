/**
 * B139 — Healer PvP-talent behavioral catalog.
 *
 * Curated from official tooltips (Wowhead game-data endpoint + Icy Veins per-spec PvP pages), NOT inferred
 * from logs. Each entry maps a PvP talent to the concrete aura/condition the analysis keys on, so the
 * pipeline reads talent-modified play correctly (credit avoidances, suppress impossible interrupts).
 *
 * Discipline (the B144 lesson): only well-understood talents belong here — a wrong entry mislabels an
 * avoidance. Every entry's aura id was verified against a real corpus log.
 *
 * Seasonal maintenance: talent/aura ids drift each patch — re-verify against a current log alongside
 * CC_AVOIDANCE_BUFF_SPELLS and CD_TALENT_MODIFIERS.
 */

import type { ICombatUnit } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { buildAuraIntervals } from "./auraIntervals";
import { auraBlocksInterrupt } from "./combatStates";

export type TalentEffectKind =
  /** while buffSpellId is active, immune to magic damage/effects → credit a magic CC/damage avoidance */
  | "magic_immunity"
  /** while buffSpellId is active, immune to (the next) full CC → credit a CC avoidance */
  | "cc_immunity"
  /** while conditionAuraId (a normal CD) or the talent's own buffSpellId is active, immune to interrupt/silence → suppress "interrupts UP" */
  | "interrupt_immunity"
  /** an offensive CC / peel tool the talent grants (surfaced in the toolkit for usage coaching) */
  | "offensive_cc"
  /** a dispel/purge-capability the talent grants (surfaced in the toolkit) */
  | "dispel"
  /** a snare/root avoidance the talent grants (surfaced in the toolkit) */
  | "snare_immunity";

/** Broad grouping for the PvP-toolkit render. */
export type TalentToolCategory = "immunity" | "cc" | "dispel" | "mobility";

export interface ITalentBehavior {
  /** the pvpTalents id as it appears in COMBATANT_INFO param 26 */
  talentSpellId: string;
  name: string;
  specs: string[];
  kind: TalentEffectKind;
  /**
   * For magic_immunity / cc_immunity: the buff aura whose active window IS the immunity. Self-gating —
   * the aura only exists when the talent is taken, so no pvpTalents lookup is needed downstream.
   */
  buffSpellId?: string;
  /**
   * The ability (or abilities) whose CAST produces `buffSpellId`. Several of
   * these immunities are PASSIVE procs — the buff has no cast event of its
   * own, so "was this tool available at time t" has to be answered from the
   * TRIGGER's cooldown, not the buff's (user ruling 2026-08-18: 「废灵遮罩
   * 现在这是被动技能 是青翠之拥触发的 所以应该走青翠的cd」). Corpus-verified
   * on the full local library: Nullifying Shroud (378464) appears 11,574×
   * SPELL_AURA_APPLIED / 11,503× SPELL_AURA_REMOVED and **zero**
   * SPELL_CAST_SUCCESS — so any consumer gating on its own casts could never
   * credit it at all. Omit for tools that are cast directly (e.g. Blessing of
   * Spellwarding, whose buff id IS the cast id).
   */
  triggerSpellIds?: string[];
  /**
   * For interrupt_immunity: the CD aura that must be active for the immunity to apply. The talent itself is
   * a passive with no marker aura and the condition (e.g. Obsidian Scales) exists WITHOUT the talent, so
   * this MUST be gated on the owner's pvpTalents containing talentSpellId.
   */
  conditionAuraId?: string;
  /** Display name of the condition CD (e.g. "Obsidian Scales") for the interrupt-immune render reason. */
  conditionName?: string;
  /**
   * Short label shown in the owner's <pvp_toolkit> loadout line, e.g. "Lightning Lasso (5s stun)". Present
   * for every talent worth surfacing to the coach as an available tool.
   */
  toolLabel?: string;
  /** Toolkit grouping for the loadout render. */
  toolCategory?: TalentToolCategory;
  /**
   * The castable ability this talent grants/modifies, if any. Used to mark a tool UNUSED when the owner
   * never cast it in the match (peel/usage coaching). Omit for always-on/reactive tools.
   */
  abilitySpellId?: string;
  note?: string;
}

export const TALENT_BEHAVIORS: ITalentBehavior[] = [
  // A. Magic immunity — self-gating buff aura
  {
    talentSpellId: "353313",
    name: "Peaceweaver",
    specs: ["Mistweaver Monk"],
    kind: "magic_immunity",
    buffSpellId: "353319",
    // Revival (115310) / Restoral (388615), both 1 charge / 180s.
    triggerSpellIds: ["115310", "388615"],
    toolLabel: "Peaceweaver (Revival/Restoral → 2s team magic immunity)",
    toolCategory: "immunity",
    note: "Revival/Restoral grants healed allies immunity to magic damage & harmful effects ~2s (proc 353319)",
  },
  {
    talentSpellId: "204018",
    name: "Blessing of Spellwarding",
    specs: ["Holy Paladin"],
    kind: "magic_immunity",
    buffSpellId: "204018",
    toolLabel: "Blessing of Spellwarding (ally magic immunity)",
    toolCategory: "immunity",
    note: "ally magic immunity; the buff shares the talent id",
  },
  // B. Full CC immunity / untargetable — self-gating buff aura
  {
    talentSpellId: "408557",
    name: "Phase Shift",
    specs: ["Discipline Priest", "Holy Priest"],
    kind: "cc_immunity",
    buffSpellId: "408558",
    // Fade (586, 30s).
    triggerSpellIds: ["586"],
    toolLabel: "Phase Shift (Fade → ~1s untargetable / CC dodge)",
    toolCategory: "immunity",
    note: "Fade phases the priest out (untargetable ~1s)",
  },
  {
    talentSpellId: "1241352",
    name: "Nullifying Shroud",
    specs: ["Preservation Evoker"],
    kind: "cc_immunity",
    buffSpellId: "378464",
    // Verdant Embrace (360995, 1 charge / 24s; Wings of Liberty 1241704
    // grants a 2nd charge — applied per player by applyCdTalentModifiers).
    triggerSpellIds: ["360995"],
    toolLabel: "Nullifying Shroud (Verdant Embrace → next-CC immunity 3s)",
    toolCategory: "immunity",
    note: "Verdant Embrace prevents the next full loss-of-control, 3s",
  },
  {
    talentSpellId: "1246968",
    name: "Psychic Shroud",
    specs: ["Holy Priest", "Discipline Priest"],
    kind: "cc_immunity",
    buffSpellId: "1246965",
    // Psychic Scream (8122, 40s).
    triggerSpellIds: ["8122"],
    toolLabel: "Psychic Shroud (Psychic Scream → next-CC immunity)",
    toolCategory: "immunity",
    note: "Psychic Scream prevents the next CC on you",
  },
  // C. Interrupt / silence immunity. What a kick can do is read from DB2, not
  // listed here (`unitAuraBlocksInterrupt`); a row is needed only for the one
  // aura DB2 gets wrong by itself, or for the toolkit line.
  //
  // Not here on purpose (12.1.5.70575 tooltips, GH #168): Divine Favor
  // 210294 / 210303 / 460422 / 1270916 read as heal and mana riders and grant
  // no immunity, none is logged on the new-season corpus. Spiritwalker's Aegis
  // 378077 is a tree talent of all three Shaman specs, which `pvpTalents`
  // never carries, so its row never fired (GH #126 row 243); its own aura
  // 378078 proves it (363 applications, 0 kicks landed, 24 refused on 605).
  {
    talentSpellId: "378444",
    name: "Obsidian Mettle",
    specs: ["Preservation Evoker"],
    kind: "interrupt_immunity",
    conditionAuraId: "363916",
    conditionName: "Obsidian Scales",
    toolLabel:
      "Obsidian Mettle (interrupt/silence immunity while Obsidian Scales up)",
    toolCategory: "immunity",
    note: "immune to interrupt/silence/pushback while Obsidian Scales is active",
  },
  {
    // Its own 5 s aura, tooltip "for $209584d": not Thunder Focus Tea 116680,
    // which the two empowerments consume (median 2.4 s). 605 files: 20 kicks
    // landed under 116680, 0 under 209584 (GH #168).
    talentSpellId: "468430",
    name: "Zen Focus Tea",
    specs: ["Mistweaver Monk"],
    kind: "interrupt_immunity",
    buffSpellId: "209584",
    toolLabel:
      "Zen Focus Tea (5s interrupt/silence immunity after Thunder Focus Tea)",
    toolCategory: "immunity",
    note: "immune to silence/interrupt for 5 s after Thunder Focus Tea",
  },

  // D. Offensive CC / peel tools — surfaced in the toolkit; usage checked via abilitySpellId
  {
    talentSpellId: "204336",
    name: "Grounding Totem",
    specs: ["Restoration Shaman"],
    kind: "offensive_cc",
    abilitySpellId: "204336",
    toolLabel: "Grounding Totem (redirect a targeted harmful spell/CC)",
    toolCategory: "cc",
    note: "redirects the first single-target harmful spell to the totem",
  },
  {
    talentSpellId: "305483",
    name: "Lightning Lasso",
    specs: ["Restoration Shaman"],
    kind: "offensive_cc",
    abilitySpellId: "305483",
    toolLabel: "Lightning Lasso (channeled 5s stun)",
    toolCategory: "cc",
    note: "non-dispellable channeled stun",
  },
  {
    talentSpellId: "355580",
    name: "Static Field Totem",
    specs: ["Restoration Shaman"],
    kind: "offensive_cc",
    abilitySpellId: "355580",
    toolLabel: "Static Field Totem (impassable electric wall)",
    toolCategory: "cc",
    note: "summons a wall enemies cannot pass",
  },
  {
    talentSpellId: "410126",
    name: "Searing Glare",
    specs: ["Holy Paladin"],
    kind: "offensive_cc",
    abilitySpellId: "410126",
    toolLabel: "Searing Glare (AoE blind, enemies miss 4s)",
    toolCategory: "cc",
    note: "cone disorient — enemies miss spells and attacks",
  },
  {
    talentSpellId: "1246126",
    name: "Call of Ohn'ahra",
    specs: ["Restoration Druid"],
    kind: "offensive_cc",
    abilitySpellId: "33786",
    toolLabel: "Call of Ohn'ahra (Nature's Swiftness → instant Cyclone)",
    toolCategory: "cc",
    note: "Nature's Swiftness also affects Cyclone (instant CC)",
  },

  // E. Dispel / purge capability — surfaced in the toolkit
  {
    talentSpellId: "378438",
    name: "Scouring Flame",
    specs: ["Preservation Evoker"],
    kind: "dispel",
    abilitySpellId: "357208", // Fire Breath
    toolLabel: "Scouring Flame (Fire Breath offensive-purges 2 magic buffs)",
    toolCategory: "dispel",
    note: "Fire Breath burns away beneficial magic effects — an Evoker offensive purge",
  },
  {
    talentSpellId: "199330",
    name: "Cleanse the Weak",
    specs: ["Holy Paladin"],
    kind: "dispel",
    toolLabel:
      "Cleanse the Weak (Cleanse hits 2 allies; FoL/HoL cleanse Disease/Poison)",
    toolCategory: "dispel",
    note: "extra dispel target + Flash/Holy Light passively cleanse Disease & Poison",
  },

  // F. Snare / root avoidance — surfaced in the toolkit
  {
    talentSpellId: "409293",
    name: "Burrow",
    specs: ["Restoration Shaman"],
    kind: "cc_immunity",
    buffSpellId: "409293",
    abilitySpellId: "409293",
    toolLabel: "Burrow (unattackable + clears snares, 5s)",
    toolCategory: "immunity",
    note: "unattackable defensive that removes movement-impairing effects",
  },
  {
    talentSpellId: "473909",
    name: "Ancient of Lore",
    specs: ["Restoration Druid"],
    kind: "cc_immunity",
    buffSpellId: "473909",
    abilitySpellId: "473909",
    toolLabel:
      "Ancient of Lore (shapeshift: CC immunity + 30% DR + Blossom Burst/Mass Blooming)",
    toolCategory: "immunity",
    note: "12.1 PvP-talent return; pvpTalents/cast/self-buff aura all 473909 (corpus match 7d74b373, 2026-08-13); interruptible 1.5s cast, observed buff window ~11.5s. DR is 30% per DB2@69404 aura87 on the cast id (patch notes said 20%; registered in MITIGATION_TABLE via attributedMitigationSpellIds 2026-09-01, BACKLOG #24-9)",
  },
];

/**
 * buffSpellId → the ability ids whose cast produces it, for the proc-style
 * immunities (see `ITalentBehavior.triggerSpellIds`). Consumers that ask "was
 * this avoidance tool available at t" MUST resolve through this first: the
 * buff itself has no cast events, so its own cooldown answers the wrong
 * question (and its own cast list is always empty).
 */
export function getTalentAvoidanceTriggers(): Map<
  string,
  { talentSpellId: string; triggerSpellIds: string[] }
> {
  const out = new Map<
    string,
    { talentSpellId: string; triggerSpellIds: string[] }
  >();
  for (const b of TALENT_BEHAVIORS) {
    if (!b.buffSpellId || !b.triggerSpellIds?.length) continue;
    out.set(b.buffSpellId, {
      talentSpellId: b.talentSpellId,
      triggerSpellIds: b.triggerSpellIds,
    });
  }
  return out;
}

/**
 * Talent-granted CC-avoidance buff auras (id → display name).
 *
 * These used to be described as "self-gating (the buff only exists when the
 * talent is taken), so callers can merge them into the static avoidance set
 * unconditionally". That was true only while availability was judged from the
 * BUFF's own casts: no talent → no buff → no casts → never credited. It stops
 * being true the moment a consumer resolves through
 * `getTalentAvoidanceTriggers` (2026-08-18), because the triggers are BASELINE
 * abilities — every priest casts Fade and Psychic Scream whether or not they
 * took Phase Shift / Psychic Shroud. Measured on n=300 the day the resolution
 * landed: 303 cc-avoidable citations named a proc tool whose talent the player
 * had NOT taken (Psychic Shroud alone 287 of 361 = 79.5%).
 *
 * So: entries WITHOUT `triggerSpellIds` remain self-gating and can be merged
 * unconditionally; entries WITH one must be gated on confirmed `pvpTalents`
 * membership by the consumer (see `ccAvoidanceOptionsAt`).
 */
export function getTalentAvoidanceBuffs(): Array<[string, string]> {
  return TALENT_BEHAVIORS.filter(
    (b) =>
      (b.kind === "magic_immunity" || b.kind === "cc_immunity") &&
      b.buffSpellId,
  ).map((b) => [b.buffSpellId as string, b.name]);
}

/**
 * Auras that are an interrupt immunity only with a talent: DB2 carries the
 * row in every state, so `auraBlocksInterrupt` cannot tell. Obsidian Scales
 * 363916 without Obsidian Mettle took 15 of its 25 kicks on 605 files.
 */
const TALENT_GATED_INTERRUPT_IMMUNITY = new Map(
  TALENT_BEHAVIORS.flatMap((b) =>
    b.kind === "interrupt_immunity" && b.conditionAuraId
      ? [[b.conditionAuraId, b] as const]
      : [],
  ),
);

/**
 * Does this aura stop a kick landing on this unit — the one reading for the
 * "enemy interrupts UP" correction, kick-eaten, kick-priority and `[KICK]`.
 * DB2 (`auraBlocksInterrupt`) unless a talent decides it. 605 files: 0 kicks
 * landed on 12,000+ applications of those auras (Sanctified Ground 289655,
 * Precognition 377362, Unending Resolve 104773, Aura Mastery 317929 …).
 */
export function unitAuraBlocksInterrupt(
  unit: { info?: { pvpTalents?: string[] } | null },
  auraId: string,
): boolean {
  const gate = TALENT_GATED_INTERRUPT_IMMUNITY.get(auraId);
  if (gate) return !!unit.info?.pvpTalents?.includes(gate.talentSpellId);
  return auraBlocksInterrupt(auraId);
}

export interface IInterruptImmuneWindow {
  spellId: string;
  /** epoch ms */
  from: number;
  to: number;
  reason: string;
  auraName: string;
}

/**
 * When a kick could not land on this unit (`unitAuraBlocksInterrupt`), one
 * window per aura interval, in the order applied, epoch ms. Through the shared
 * pairing (`buildAuraIntervals`: BROKEN closes too, an aura with no REMOVED
 * ends at its official duration, a re-broadcast is no end — codex G1 #1: a
 * pairing of its own kept a duplicate APPLIED's Unending Resolve 4 s long).
 * The pairing clamps every event to its `startTime`, so an aura put up in the
 * prep room and never REMOVED would restart its official duration at 0:00 and
 * read as up for the first seconds of the round; the origin is therefore moved
 * back to the unit's earliest aura event. One builder for the "enemy
 * interrupts UP" correction (B139), kick-eaten's `kickImmunityEnded` (triage
 * F-K14b), kick-priority and `[KICK]`.
 */
export function interruptImmuneWindows(
  unit: ICombatUnit,
  combat: {
    startTime: number;
    endTime: number;
    units?: Readonly<Record<string, ICombatUnit>>;
  },
  castersById?: Parameters<typeof buildAuraIntervals>[2],
): IInterruptImmuneWindow[] {
  if (!unit.auraEvents?.length) return [];
  const originMs = unit.auraEvents.reduce(
    (lo, a) => Math.min(lo, a.timestamp),
    combat.startTime,
  );
  // 0.1 ms grid: the rows' own precision, so a window's edge is its row's ms
  const toMs = (s: number) => originMs + Math.round(s * 1e7) / 1e4;
  return buildAuraIntervals(
    unit,
    { ...combat, startTime: originMs },
    castersById,
  )
    .filter(
      (i) =>
        unitAuraBlocksInterrupt(unit, i.spellId) &&
        // a talent's immunity is on the holder's own press: an ally's copy
        // of Obsidian Scales took 17 kicks of 17, Mettle on either side;
        // the holder's own took 0 of 6 (six files, wide + 605)
        (!TALENT_GATED_INTERRUPT_IMMUNITY.has(i.spellId) ||
          i.srcUnitId === unit.id),
    )
    .sort((a, b) => a.fromS - b.fromS)
    .map((i) => {
      const gate = TALENT_GATED_INTERRUPT_IMMUNITY.get(i.spellId);
      const auraName =
        gate?.conditionName ?? getEnglishSpellName(i.spellId, i.spellName);
      return {
        spellId: i.spellId,
        from: toMs(i.fromS),
        to: toMs(i.toS),
        reason: gate ? `${gate.name} + ${auraName}` : auraName,
        auraName,
      };
    });
}

/** The window `ms` lies in. Its end is out: a press logged in the millisecond
 * the aura went (a Cyclone's REMOVED, codex G1 #2) has no immunity left. */
export function interruptImmuneWindowAt<W extends { from: number; to: number }>(
  windows: readonly W[],
  ms: number,
): W | undefined {
  return windows.find((w) => w.from <= ms && ms < w.to);
}

/** PvP talents that grant an OFFENSIVE purge (dispelling beneficial effects from ENEMIES). */
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const OFFENSIVE_PURGE_TALENT_IDS = new Set([
  "378438", // Scouring Flame — Preservation Evoker's Fire Breath burns away enemy magic buffs
]);

/**
 * True when the owner's PvP talents grant an offensive purge they would not otherwise have. Used to gate
 * [MISSED PURGE] for specs with no baseline offensive purge (Preservation Evoker — Naturalize is a
 * defensive ally-dispel, so the only offensive purge is Scouring Flame).
 */
export function hasOffensivePurgeTalent(
  pvpTalentIds: string[] | undefined,
): boolean {
  return (pvpTalentIds ?? []).some((id) => OFFENSIVE_PURGE_TALENT_IDS.has(id));
}

/**
 * The owner's talent-granted PvP toolkit for the loadout render: every talent with a toolLabel that the
 * owner has taken. `used` is true/false for tools that grant a castable ability (abilitySpellId) — false
 * means the owner never cast it in the match (peel/usage coaching) — and undefined for always-on/reactive
 * tools where "unused" is not meaningful.
 */
export function getPvpToolkit(
  pvpTalentIds: string[] | undefined,
  ownerCastSpellIds: Set<string>,
): Array<{
  label: string;
  category: TalentToolCategory;
  used: boolean | undefined;
}> {
  const talents = new Set(pvpTalentIds ?? []);
  return TALENT_BEHAVIORS.filter(
    (b) => b.toolLabel && talents.has(b.talentSpellId),
  ).map((b) => ({
    label: b.toolLabel as string,
    category: b.toolCategory ?? "immunity",
    used: b.abilitySpellId
      ? ownerCastSpellIds.has(b.abilitySpellId)
      : undefined,
  }));
}
