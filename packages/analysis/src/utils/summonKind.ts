/**
 * The word a summoned unit gets beside its owner's label — `6(RShaman)'s
 * totem`, `4(UDKnight)'s pet`, `5(SPriest)'s guardian`.
 *
 * FT-T14 (2026-10-09): every summon on a control / kick / break line was a
 * "pet" — 80 lines of the 60 re-eval prompts called a Capacitor Totem or a
 * Healing Stream Totem a shaman's pet (`← Capacitor Totem (by 6(RShaman)'s
 * pet)`), a unit the round never had. The kind is read off the log:
 *  - a `Pet-` GUID is a permanent pet (the unit type of every one of them is
 *    Pet, and no `Creature-` GUID has that type);
 *  - a unit a totem spell summoned (its own SPELL_SUMMON's official English
 *    name has the word "Totem"), or whose listed npc name does, is a totem;
 *  - any other summoned creature is a guardian — the word the damage rows
 *    already used.
 * Without a GUID (a document that carries only a name) the event's unit type
 * decides, as it did before.
 *
 * One predicate for every `X's <kind>` label; the gate re-parses the word
 * through `SUMMON_KIND_RE_SRC`.
 */
import {
  CombatUnitType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";

export const SUMMON_KIND_WORDS = ["pet", "totem", "guardian"] as const;
export type SummonKindWord = (typeof SUMMON_KIND_WORDS)[number];
/** Regex source matching any kind word (gates and scans). */
export const SUMMON_KIND_RE_SRC = `(?:${SUMMON_KIND_WORDS.join("|")})`;

// the word, anywhere in the name: "Capacitor Totem" and "Totem of Wrath" are
// totems, "Totemic Projection" (the relocation marker) is not
const TOTEM_NAME = /\bTotem\b/;

export function summonKindWord(
  sourceId: string | undefined,
  evidence: {
    /** The summoned unit, for its own SPELL_SUMMON line. */
    unit?: Pick<ICombatUnit, "actionIn">;
    /** The npc's listed English name, when the caller has a table for it. */
    npcName?: string;
    /** The event's unit type — the only evidence when there is no GUID. */
    srcType?: CombatUnitType;
  } = {},
): SummonKindWord {
  const { unit, npcName, srcType } = evidence;
  if (!sourceId)
    return srcType === CombatUnitType.Guardian ? "guardian" : "pet";
  if (sourceId.startsWith("Pet-")) return "pet";
  if (npcName && TOTEM_NAME.test(npcName)) return "totem";
  const summon = (unit?.actionIn ?? []).find(
    (a) => a.logLine.event === LogEvent.SPELL_SUMMON,
  );
  if (
    summon?.spellId &&
    TOTEM_NAME.test(getEnglishSpellName(summon.spellId, summon.spellName ?? ""))
  )
    return "totem";
  return "guardian";
}
