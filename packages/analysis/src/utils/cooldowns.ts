import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitPowerType,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { isSurvivalWall } from "../data/abilityProfile";
import { classMetadata } from "../data/classSpells";
import { CURATED_ABILITY_FACTS } from "../data/curatedAbilityFacts";
import { DISCOVERY_TAG_RULES } from "../data/discoveryRules";
import {
  healerSaveCdRoster,
  healerSaveCdStripDefensive,
} from "../data/healerSaveCd";
import { PVP_TALENT_REPLACES_GENERATED } from "../data/pvpTalentReplacesGenerated";
import { OFFENSIVE_RACIAL_SPELL_IDS } from "../data/racialAbilities";
import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
import spellIdListsData from "../data/spellIdLists";
import { reachesAlly } from "../data/spellTargeting";
import { SpellTag } from "../data/spellTypes";
import { USABLE_WHILE_CC_GENERATED } from "../data/usableWhileCcGenerated";
import { binarySearchClosest } from "./binarySearch";
import { COPY_CAST_IDS } from "./castPress";
import { incomingPressureEvents } from "./incomingPressure";
import { fmtTime, toRenderSecond } from "./renderGrid";
import { OFFENSIVE_CD_SPELL_IDS } from "./spellDanger";
import { CD_TALENT_MODIFIERS, type ICDModifier } from "./talentModifiers";
import {
  getPlayerTalentedSpellInfo,
  getSpecTalentTreeSpellInfo,
} from "./talents";

export const MAJOR_DEFENSIVE_IDS = new Set<string>(
  (spellIdListsData as unknown as { externalOrBigDefensiveSpellIds?: string[] })
    .externalOrBigDefensiveSpellIds ?? [],
);

// H11: defensives that can be cast on a teammate (not just self). Used to avoid suggesting
// self-only tools (e.g. Barkskin) as "cheaper" alternatives when the annotated cast was an
// external thrown on an ally — a self-only tool can't help that ally.
const EXTERNAL_DEFENSIVE_IDS = new Set<string>(
  spellIdListsData.externalDefensiveSpellIds as string[],
);

/**
 * B112/B127: true when a big personal defensive is SELF-ONLY (cannot be cast on an ally) — e.g.
 * Divine Shield, Ice Block, Obsidian Scales, Barkskin. Such a cast logs whatever unit the caster was
 * targeting at the time (often an enemy, or an ally being healed) as its "target", so the timeline
 * must render it as (self) with the caster's own HP — never "→ <enemy>"/"→ <ally>" with that unit's
 * HP. Defined as a major/big defensive that is NOT in the ally-castable external set; this is
 * deliberately conservative (only known big defensives) so an external missing from the list is never
 * mis-rendered as self.
 */
export function isSelfOnlyDefensive(spellId: string): boolean {
  return (
    MAJOR_DEFENSIVE_IDS.has(spellId) && !EXTERNAL_DEFENSIVE_IDS.has(spellId)
  );
}

/** True if this defensive can be cast on an ALLY (an external). A Defensive-tagged CD that is NOT
 *  ally-castable cannot save a teammate — used to drop self-only red-herrings from teammate-death traces.
 *  NOTE (GH #28): this is the narrow "can I TARGET it on an ally" question. For "would pressing it help
 *  the ally at all" (area effects like Rallying Cry reach allies without being castable on one) use
 *  `canHelpAnotherUnit` below — mixing the two is what produced the false accusations. */
export function isAllyCastableDefensive(spellId: string): boolean {
  return EXTERNAL_DEFENSIVE_IDS.has(spellId);
}

/**
 * GH #28 (2026-08-22, user report): 「我玩牧师,绝望祷言全场没用,然后我队友生命垂危的时候我应该用 —— 这技能
 * 只能给自己加血。」Can pressing this cooldown help a unit OTHER than the caster? Every "you had X and your
 * teammate died / dropped to N%" surface must gate on this, or the coach demands a self-heal be spent on
 * somebody else's health bar.
 *
 * This is the exact mirror of the #25-1 fix (`SELF_CAST_NOOP_EXTERNAL_IDS` /
 * `selfCastNoopAnnotatedName`, 2026-08-19), which stopped the ledger from suggesting an ALLY-ONLY external
 * (Blessing of Sacrifice) as self-defence. That fix handled "an external cannot save you"; this one handles
 * "a personal defensive cannot save them" — the same fact, the other direction. Nobody had noticed the
 * second half for three years.
 *
 * The four layers, official data first (CLAUDE.md 正式数据优先于启发式):
 *  1. `reachesAlly` — DB2 `SpellEffect.ImplicitTarget`, generated. Targeted externals, party/raid auras
 *     (Rallying Cry, Aura Mastery) and ally-healing channels (Tranquility, Divine Hymn) all pass here.
 *  2. `isTeamHealCD` — the existing team-heal registry, kept as a floor for anything the official targeting
 *     cannot see (a heal that lands through a summon/totem).
 *  3. `THROUGHPUT_EMPOWER_DEFENSIVE_IDS` — Defensive-TAGGED cooldowns that actually empower the caster's own
 *     output (Apotheosis empowers Holy Words). Officially self-targeted, but pressing one absolutely helps
 *     the ally being healed, so it must not be filtered.
 *  4. Anything that is not a defensive-class cooldown at all is out of this gate's jurisdiction: CC and
 *     offensive cooldowns are peels — "you sat on Paralysis while your partner was at 26%" is legitimate
 *     coaching, and the corpus scan behind this fix measured 15 such events that must survive it.
 */
export function canHelpAnotherUnit(spellId: string, tag?: string): boolean {
  if (reachesAlly(spellId)) return true;
  if (TEAM_HEAL_CD_IDS.has(spellId)) return true;
  if (THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(spellId)) return true;
  // Layer 4. `tag` is the caller's own IMajorCooldownInfo.tag when it has one,
  // and it takes precedence over the id set — because the id set is built from
  // the STATIC classMetadata, and two paths add Defensive-tagged cooldowns at
  // runtime that it therefore cannot contain:
  //   · extractMajorCooldowns' per-unit injection (Ultimate Penitence 421453,
  //     pushed onto the Priest catalog at :1128 — a personal absorb; measured
  //     7 cd-hoarded events in 250 matches citing it over a TEAMMATE's crisis
  //     before this argument existed), and
  //   · discoveryRules' name regexes (Spiritwalker's Grace 79206 / Spirit Walk
  //     58875 pick up a Defensive tag from `/spirit/`).
  // Without the hint those fall through to "not a defensive → not this gate's
  // business" and sail straight past the GH #28 filter.
  // 2026-08-23(DPS 视角实测补洞):tag 与 id 集合都可能认不出一个防御 CD ——
  // Berserker Shout 384100 既不在静态 classMetadata(它走名字正则发现)、tag 也不是
  // Defensive,却officially 带四个机制免疫,是货真价实的自保墙;它因此从这一层溜过去,
  // 405 个 DPS 回合里造成 2 条「自保墙救队友」。第三个判据用官方画像兜底:
  // **官方说它是墙(减伤/吸收/免疫任一),就按防御类管辖**,与 tag 和名单无关。
  const isDefensiveClass =
    tag === "Defensive" ||
    DEFENSIVE_CLASS_IDS.has(spellId) ||
    isSurvivalWall(spellId);
  return !isDefensiveClass;
}

/**
 * B113/B130: role tags for throughput / mana / mobility / modifier cooldowns that reach the timeline
 * (often via the B38 [YOU] [CD] promotion) without a survival/defensive context. Absent a role, the
 * model invents mechanics — e.g. calling Restoral (a mana+heal CD) a "stun break", or equating a cheap
 * modifier (Tip the Scales) with a 90–240s emergency CD. Each tag is a short, factual role descriptor
 * appended to the CD's timeline line so the model reasons about what the CD actually does. Keep these
 * conservative and correct — a wrong role is worse than none.
 */
export const CD_ROLE_TAGS: Record<string, string> = {
  // Mistweaver Monk (B113)
  "388615": "mana+heal CD", // Restoral — restores team mana and heals; NOT a defensive/CC
  "325197": "healing CD", // Invoke Chi-Ji, the Red Crane — healing throughput
  "116680": "heal amplifier", // Thunder Focus Tea — empowers the next heal; not a defensive
  // Preservation Evoker (B130)
  "357170": "ally heal-over-time", // Time Dilation — delayed healing on an ally; throughput
  "370553": "cast-time modifier", // Tip the Scales — makes next Empower instant; cheap modifier
  "358267": "mobility", // Hover — cast while moving; not a defensive
};

/** Returns a role descriptor for a throughput/modifier CD, or undefined if none is tagged. */
export function cdRoleTag(spellId: string): string | undefined {
  return CD_ROLE_TAGS[spellId];
}

/**
 * B136: team-wide healing throughput CDs. These have no single target, so the timeline would
 * otherwise render the CASTER's own HP (usually ~100%), making the model read the cast as
 * "premature". For these the relevant context is the lowest-HP ally at cast time, not the healer.
 */
export const TEAM_HEAL_CD_IDS = new Set<string>([
  "64843", // Divine Hymn — Holy Priest
  "115310", // Revival — Mistweaver Monk
  "363534", // Rewind — Preservation Evoker
  "359816", // Dream Flight — Preservation Evoker
  "388615", // Restoral — Mistweaver Monk
  "325197", // Invoke Chi-Ji, the Red Crane — Mistweaver Monk
  "740", // Tranquility — Restoration Druid
  "108280", // Healing Tide Totem — Restoration Shaman
]);

/** True for team-wide healing CDs whose timeline context should be the lowest ally, not the caster. */
export function isTeamHealCD(spellId: string): boolean {
  return TEAM_HEAL_CD_IDS.has(spellId);
}

/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Diffuse Magic 122783, Dampen Harm 122278, Earthen Wall 201633, Netherwalk 196555, Rapture 47536 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const ADDITIONAL_OVERLAP_DEFENSIVE_IDS = new Set<string>([
  "108416", // Dark Pact (Warlock)
  "5277", // Evasion (Rogue)
  "184662", // Shield of Vengeance (Paladin)
  "145629", // Anti-Magic Zone (DK)
  "62618", // Power Word: Barrier (Priest)
  "374348", // Renewing Blaze (Evoker)
  "98008", // Spirit Link Totem (Shaman)
]);

const ALL_MAJOR_DEFENSIVE_IDS = new Set<string>([
  ...MAJOR_DEFENSIVE_IDS,
  ...ADDITIONAL_OVERLAP_DEFENSIVE_IDS,
]);

/**
 * Every id this repo treats as a defensive-class cooldown: the classMetadata
 * `Defensive` tag UNION the major-defensive id lists. Both halves are load
 * bearing — the 250-match verification run for GH #28 caught Ice Barrier
 * (11426) leaking a `[DEFENSIVE AVAILABLE]` line at a TEAMMATE's death because
 * it is Defensive-tagged but is not in `externalOrBigDefensiveSpellIds`, so an
 * id-list-only membership test read it as "not a defensive, out of
 * jurisdiction" and waved it through.
 */
const DEFENSIVE_CLASS_IDS = new Set<string>([
  ...classMetadata.flatMap((cls) =>
    cls.abilities
      .filter((ability) => ability.tags.includes(SpellTag.Defensive))
      .map((ability) => ability.spellId),
  ),
  ...ALL_MAJOR_DEFENSIVE_IDS,
]);

/**
 * Unconditional hand-written gap layer for USABLE_WHILE_CC_SPELL_IDS: spells
 * confirmed usable while stunned that USABLE_WHILE_CC_GENERATED.stunned (DB2
 * SpellMisc.Attributes, <=2-bit OR-union, restricted to the observed corpus —
 * see usableWhileCcGenerated.ts) doesn't cover yet. Each entry needs its own
 * source, same as drCategories.ts' hand gap. Signed record for every entry
 * lives in curatedAbilityFacts.ts (kind "usable_while_cc_gap").
 *
 * - "498"/"403876" Divine Protection (Paladin, incl. talent-cloned id) —
 *   wowhead's "Allow While Stunned by Stun Mechanic" attribute flag + 748
 *   observed casts-in-stun in the corpus + the user's own-class confirmation
 *   (2026-08-14).
 * - "51490" Thunderstorm (Shaman) — same wowhead flag shape as 498/403876
 *   (attribute sits on the base spell, outside the generated table's adopted
 *   2-bit union) + 321 observed casts-in-stun in the corpus + a negative-result
 *   search across all 3 shaman PvP-talent pools and community guides found no
 *   gating talent, i.e. this is unconditional, not the conditional-layer
 *   candidate it was first suspected to be (Task 6, 2026-08-14 user sign-off).
 *   Shim total: 470 → 471.
 */
export const USABLE_WHILE_CC_GAP_IDS = new Set<string>([
  "498",
  "403876",
  "51490",
]);

/**
 * Spell IDs that can be cast while the player is stunned. Used to avoid
 * blaming players for "unused" defensives when they were locked out.
 *
 * Made official 2026-08-14 (Task 5): generated ∪ gap-layer union, same shape
 * as drCategories.ts. The previous fully hand-written 6-entry list is now
 * absorbed: 5 of 6 (642 Divine Shield, 33206 Pain Suppression, 22812
 * Barkskin, 47585 Dispersion, 48792 Icebound Fortitude) are confirmed IN the
 * generated 468-id "stunned" table. The 6th, 55233 Vampiric Blood, is
 * user-ruled NOT usable while stunned (2026-08-14: "都不行", corroborated by
 * 0 casts-in-stun in the corpus) — the old list's inclusion of it was wrong,
 * and that error is deliberately NOT carried into the gap layer.
 */
export const USABLE_WHILE_CC_SPELL_IDS = new Set<string>([
  ...USABLE_WHILE_CC_GENERATED.stunned,
  ...USABLE_WHILE_CC_GAP_IDS,
]);

/**
 * Conditional layer: spells usable while stunned only when the player has a
 * specific PvP talent that grants the exception (the base spell isn't
 * unconditionally usable — a chosen PvP talent makes it so). Keyed by the
 * gated spell id. Signed record for every entry lives in
 * curatedAbilityFacts.ts (kind "usable_while_cc_conditional").
 *
 * - "119996" Transcendence: Transfer (Monk) — gated on Mistweaver PvP talent
 *   "Eminence" (353584): wowhead's "Allow While Stunned by Stun Mechanic" +
 *   "Allow While Stunned By Horror Mechanic" flags, Icy Veins' Mistweaver PvP
 *   guide text, and Blizzard's 9.1.0 (2021-06-29) patch note all describe the
 *   stun-usability as conditional on Eminence, not baseline — the opposite
 *   conclusion from 51490's research below (Task 6, 2026-08-14 user sign-off).
 *
 * The former placeholder note ("51490 pending its gating talent id") was
 * resolved by research to be a false premise: 51490 has no gating talent and
 * moved to the unconditional gap layer above instead (see its entry there).
 */
export const USABLE_WHILE_CC_CONDITIONAL: Record<
  string,
  { requiresTalent: string; source: string }
> = {
  "119996": {
    requiresTalent: "353584",
    source: "明心(Eminence)PvP 天赋,用户签字 2026-08-14",
  },
};

/**
 * True if `spellId` is usable while the player is stunned.
 * - Unconditional hit (USABLE_WHILE_CC_SPELL_IDS: generated ∪ gap layer) →
 *   true, regardless of `pvpTalentIds`.
 * - Conditional-layer hit AND `pvpTalentIds` contains its `requiresTalent` →
 *   true.
 * - Conditional-layer hit but no talent context, or the talent is absent →
 *   false. This is the conservative direction: withhold "usable" rather than
 *   assume a talent the caller couldn't confirm the player has — same
 *   false-accusation-averse posture as the unconditional set's own gap layer.
 */
export function usableWhileStunned(
  spellId: string,
  pvpTalentIds?: ReadonlySet<string>,
): boolean {
  if (USABLE_WHILE_CC_SPELL_IDS.has(spellId)) return true;
  const conditional = USABLE_WHILE_CC_CONDITIONAL[spellId];
  if (!conditional) return false;
  return pvpTalentIds?.has(conditional.requiresTalent) ?? false;
}

/**
 * Forbearance: Paladin's Divine Shield / Lay on Hands / Blessing of Protection / Blessing of Spellwarding
 * share a 30s lockout. A defensive that reads "available" by its own cooldown is UNCASTABLE on the paladin
 * if they self-applied Forbearance within the last 30s — so it must not be listed as "unused"/"available"
 * at a death (false accusation). Forbearance is not reliably logged as an aura, so detect it from the
 * applying cast: Divine Shield always self-applies; the ally-castable ones self-apply only when cast on self.
 */
// Official read (GH #34 batch 4, 2026-08-28): DB2 Spell 25771 Forbearance
// durationSeconds = 30 at 12.1.0.69382 (SpellMisc.DurationIndex 9 → 30000ms).
// The literal is only the fallback if the generated table ever loses the row;
// `forbearance.test.ts` pins official == fallback so a drift goes red.
export const FORBEARANCE_FALLBACK_SECONDS = 30;
export const FORBEARANCE_SECONDS =
  spellEffectData["25771"]?.durationSeconds ?? FORBEARANCE_FALLBACK_SECONDS;
export const FORBEARANCE_GATED_IDS = new Set<string>([
  "642",
  "633",
  "1022",
  "204018",
]); // DivineShield, LayOnHands, BoP, Spellwarding
export function selfForbearanceActiveAt(
  unit: ICombatUnit,
  allUnits: ICombatUnit[],
  atSeconds: number,
  matchStartMs: number,
): boolean {
  for (const u of allUnits) {
    for (const cast of u.spellCastEvents ?? []) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (!cast.spellId || !FORBEARANCE_GATED_IDS.has(cast.spellId)) continue;
      const castSec = (cast.timestamp - matchStartMs) / 1000;
      if (castSec > atSeconds || atSeconds - castSec > FORBEARANCE_SECONDS)
        continue;
      if (cast.spellId === "642") {
        if (u.id === unit.id) return true;
      } else {
        if (cast.destUnitId === unit.id) return true;
      }
    }
  }
  return false;
}

// "Is this an offensive cooldown" — the canonical table (GH #60 coarse spot 4,
// unified 2026-09-02). This used to be a private classMetadata-only set (34
// ids, 9 of them corpus-dead) that disagreed with `spellDanger.ts`'s
// `isOffensiveSpell` (41 ids) on 22+6 live ids; both sides now read ONE
// export, so the aura evidence (`hasOffensiveSpellActive` → `threatActiveAt`,
// panic-press) and the enemy-CD window builder can no longer drift apart.
const OFFENSIVE_SPELL_IDS = OFFENSIVE_CD_SPELL_IDS;

/** Only track cooldowns at or above this threshold.
 *
 * GH #34 batch 4 (2026-08-28), static check against the tagged classMetadata
 * catalog with official cooldowns: ≥ 120 s 53 · [60,120) 31 · [45,60) 8 ·
 * [30,45) 10 · [20,30) **1** (Gouge 25 s) · no official cd 19. The 30 s cut
 * excludes exactly one catalog ability; the catalog itself is the real
 * selector (it holds only major CDs), so this floor is a guard, not a
 * curator. Measured against official data; the value is editorial. */
// Exported 2026-08-28 (GH #34 batch 4): enemyCDs.ts carried its own
// uncommented copy of the same floor for the ENEMY offensive-CD timeline —
// one fact ("what counts as a major cooldown"), one predicate.
export const MIN_CD_SECONDS = 30;

/**
 * Passive proc spells that emit SPELL_CAST_SUCCESS but are not intentional player casts.
 * Filtering these removes noise from the [YOU] [CAST] timeline.
 */
export const PASSIVE_SPELL_BLOCKLIST = new Set([
  "Reclamation",
  "Infusion of Light",
  "Ysera's Gift",
  "Nature's Vigor",
  "Resounding Voice",
  "Eminence",
  "Awakening",
  "Divine Purpose",
]);

/**
 * Spec-exclusive spells: if a spell ID appears here, it is only valid for the listed specs.
 * Any other spec that shares the same class will have this spell filtered out.
 * Covers all tagged (Offensive/Defensive/Control) spells in classMetadata that are
 * listed under a spec-specific comment block.
 */
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Rapture 47536, Psychic Horror 64044, Dark Soul: Instability 113858, Shadowy Duel 207736, Icy Veins 12472, Wyvern Sting 19386, Fel Eruption 211881; 79140 Vendetta → Deathmark 360194/1248010 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const SPEC_EXCLUSIVE_SPELLS: Record<string, CombatUnitSpec[]> = {
  // Druid
  "102560": [CombatUnitSpec.Druid_Balance], // Incarnation: Chosen of Elune
  "194223": [CombatUnitSpec.Druid_Balance], // Celestial Alignment
  "102543": [CombatUnitSpec.Druid_Feral], // Incarnation: King of the Jungle
  "106839": [CombatUnitSpec.Druid_Feral], // Skull Bash
  "106951": [CombatUnitSpec.Druid_Feral], // Berserk
  "102558": [CombatUnitSpec.Druid_Guardian], // Incarnation: Guardian of Ursoc
  "18562": [CombatUnitSpec.Druid_Restoration], // Swiftmend
  "33891": [CombatUnitSpec.Druid_Restoration], // Incarnation: Tree of Life
  "102342": [CombatUnitSpec.Druid_Restoration], // Ironbark
  "236696": [CombatUnitSpec.Druid_Restoration], // Thorns
  "740": [CombatUnitSpec.Druid_Restoration], // Tranquility
  // Monk
  "115203": [CombatUnitSpec.Monk_Brewmaster], // Fortifying Brew
  "122470": [CombatUnitSpec.Monk_Windwalker], // Touch of Karma
  "123904": [CombatUnitSpec.Monk_Windwalker], // Invoke Xuen, the White Tiger
  "137639": [CombatUnitSpec.Monk_Windwalker], // Storm, Earth, and Fire
  "201318": [CombatUnitSpec.Monk_Windwalker], // Fortifying Elixir
  "116849": [CombatUnitSpec.Monk_Mistweaver], // Life Cocoon
  // Paladin
  "498": [CombatUnitSpec.Paladin_Holy], // Divine Protection
  "6940": [CombatUnitSpec.Paladin_Holy], // Blessing of Sacrifice
  "199448": [CombatUnitSpec.Paladin_Holy], // Blessing of Sacrifice
  "210294": [CombatUnitSpec.Paladin_Holy], // Divine Favor
  "31821": [CombatUnitSpec.Paladin_Holy], // Aura Mastery
  "216331": [CombatUnitSpec.Paladin_Holy], // Avenging Crusader
  "86659": [CombatUnitSpec.Paladin_Protection], // Guardian of Ancient Kings
  "337851": [CombatUnitSpec.Paladin_Protection], // Guardian of Ancient Kings
  "337852": [CombatUnitSpec.Paladin_Protection], // Reign of Ancient Kings
  "228049": [CombatUnitSpec.Paladin_Protection], // Guardian of the Forgotten Queen
  "31850": [CombatUnitSpec.Paladin_Protection], // Ardent Defender
  // Priest
  "33206": [CombatUnitSpec.Priest_Discipline], // Pain Suppression
  "62618": [CombatUnitSpec.Priest_Discipline], // Power Word: Barrier
  "81782": [CombatUnitSpec.Priest_Discipline], // Power Word: Barrier
  "197871": [CombatUnitSpec.Priest_Discipline], // Dark Archangel
  // 19236 Desperate Prayer 不在此表:三系牧师都有。2026-08-22 语料实测(60 场 / 200 轮)
  // 施放 49 次,其中暗影 28 次 / 5 人、神圣 15 次 / 6 人、戒律 6 次 / 4 人 —— 69.4% 的真实施放来自
  // 被这条 Holy-only 排除掉的专精,那些牧师的绝望祷言对整条大 CD 台账完全不可见(GH #28 附带发现)。
  "196762": [CombatUnitSpec.Priest_Holy], // Inner Focus
  "200183": [CombatUnitSpec.Priest_Holy], // Apotheosis
  "47788": [CombatUnitSpec.Priest_Holy], // Guardian Spirit
  "64843": [CombatUnitSpec.Priest_Holy], // Divine Hymn
  "47585": [CombatUnitSpec.Priest_Shadow], // Dispersion
  // Warlock
  "113860": [CombatUnitSpec.Warlock_Affliction], // Dark Soul: Misery
  // Rogue
  "5277": [CombatUnitSpec.Rogue_Assassination], // Evasion
  "36554": [CombatUnitSpec.Rogue_Assassination], // Shadowstep
  "360194": [CombatUnitSpec.Rogue_Assassination], // Deathmark (2026-08-21: was 79140 Vendetta, wrong id)
  "1248010": [CombatUnitSpec.Rogue_Assassination], // Deathmark (12.1 variant id)
  "1776": [CombatUnitSpec.Rogue_Outlaw], // Gouge
  "2094": [CombatUnitSpec.Rogue_Outlaw], // Blind
  "13750": [CombatUnitSpec.Rogue_Outlaw], // Adrenaline Rush
  "51690": [CombatUnitSpec.Rogue_Outlaw], // Killing Spree
  "121471": [CombatUnitSpec.Rogue_Subtlety], // Shadow Blades
  "185313": [CombatUnitSpec.Rogue_Subtlety], // Shadow Dance
  "185422": [CombatUnitSpec.Rogue_Subtlety], // Shadow Dance
  "212182": [CombatUnitSpec.Rogue_Subtlety], // Smoke Bomb
  "213981": [CombatUnitSpec.Rogue_Subtlety], // Cold Blood
  // Shaman
  "191634": [CombatUnitSpec.Shaman_Elemental], // Stormkeeper
  "58875": [CombatUnitSpec.Shaman_Enhancement], // Spirit Walk
  "98008": [CombatUnitSpec.Shaman_Restoration], // Spirit Link Totem
  "204293": [CombatUnitSpec.Shaman_Restoration], // Spirit Link
  "204336": [
    CombatUnitSpec.Shaman_Elemental,
    CombatUnitSpec.Shaman_Enhancement,
    CombatUnitSpec.Shaman_Restoration,
  ], // Grounding Totem
  // Mage
  "12042": [CombatUnitSpec.Mage_Arcane], // Arcane Power
  "205025": [CombatUnitSpec.Mage_Arcane], // Presence of Mind
  "190319": [CombatUnitSpec.Mage_Fire], // Combustion
  // Hunter
  "19574": [CombatUnitSpec.Hunter_BeastMastery], // Bestial Wrath
  "24394": [CombatUnitSpec.Hunter_BeastMastery], // Intimidation
  "19577": [CombatUnitSpec.Hunter_BeastMastery], // Intimidation
  "213691": [CombatUnitSpec.Hunter_Marksmanship], // Scatter Shot
  // Demon Hunter
  "207684": [CombatUnitSpec.DemonHunter_Vengeance], // Sigil of Misery
  // Death Knight
  "55233": [CombatUnitSpec.DeathKnight_Blood], // Vampiric Blood
  "49028": [CombatUnitSpec.DeathKnight_Blood], // Dancing Rune Weapon
  "108199": [CombatUnitSpec.DeathKnight_Blood], // Gorefiend's Grasp
  "221562": [CombatUnitSpec.DeathKnight_Blood], // Asphyxiate (Blood)
  "51271": [CombatUnitSpec.DeathKnight_Frost], // Pillar of Frost
  "47568": [CombatUnitSpec.DeathKnight_Frost], // Empower Rune Weapon
  "279302": [CombatUnitSpec.DeathKnight_Frost], // Frostwyrm's Fury
  "196770": [CombatUnitSpec.DeathKnight_Frost], // Remorseless Winter
  "152279": [CombatUnitSpec.DeathKnight_Frost], // Breath of Sindragosa
  "42650": [CombatUnitSpec.DeathKnight_Unholy], // Army of the Dead
  "49206": [CombatUnitSpec.DeathKnight_Unholy], // Summon Gargoyle
  "220143": [CombatUnitSpec.DeathKnight_Unholy], // Apocalypse
  "108194": [CombatUnitSpec.DeathKnight_Unholy], // Asphyxiate (Unholy)
  // Evoker
  "375087": [CombatUnitSpec.Evoker_Devastation], // Dragonrage
  "363916": [
    CombatUnitSpec.Evoker_Devastation,
    CombatUnitSpec.Evoker_Preservation,
    CombatUnitSpec.Evoker_Augmentation,
  ], // Obsidian Scales
  "359816": [CombatUnitSpec.Evoker_Preservation], // Dream Flight
  "363534": [CombatUnitSpec.Evoker_Preservation], // Rewind
  "370960": [CombatUnitSpec.Evoker_Preservation], // Emerald Communion
  "370537": [CombatUnitSpec.Evoker_Preservation], // Stasis
  "370665": [CombatUnitSpec.Evoker_Preservation], // Rescue
  "403631": [CombatUnitSpec.Evoker_Augmentation], // Breath of Eons
  "404977": [CombatUnitSpec.Evoker_Augmentation], // Time Skip
  "360828": [CombatUnitSpec.Evoker_Augmentation], // Blistering Scales
};

/** Ignore available windows shorter than this (e.g. just before match ends).
 *
 * GH #34 batch 4 (2026-08-28), 300 matches / 8,326 kept healer-owner
 * available windows: (3,5] 182 · (5,8] 245 · (8,10] 176 · (10,20] 1,376 ·
 * (20,30] 1,059 · (30,60] 1,851 · > 60 3,437 — ≤ 5 s is 2.2 %, ≤ 10 s 7.2 %.
 * The 3 s grace sits at the very bottom of the distribution (raising it to
 * 5 s would drop 2.2 % of windows). Measured, not official. */
const GRACE_SECONDS = 3;

export type DefensiveTimingLabel =
  "Optimal" | "Early" | "Late" | "Reactive" | "Unnecessary" | "Unknown";

export interface ICooldownCast {
  timeSeconds: number;
  /** Timing classification relative to enemy burst activity. Only set for Defensive/External CDs. */
  timingLabel?: DefensiveTimingLabel;
  /** One-line reason for the timing label */
  timingContext?: string;
  /** HP% of the target unit at cast time, 0–100, when available from advanced logging */
  targetHpPct?: number;
  /** Name of the unit the spell was cast on (from destUnitName), when available */
  targetName?: string;
  /**
   * 17a: distance in seconds to the nearest aligned burst window (before or after the cast).
   * Only set when timingLabel === "Unnecessary" — computed once here (annotateDefensiveTimings
   * already has `enemyCDTimeline.alignedBurstWindows` in scope) so candidateFindings'
   * questionable-external event can read it instead of re-deriving burst-window distance from
   * scratch (single-source predicate: computed in one place, consumed in many;
   * never re-implement the window geometry).
   */
  nearestBurstGapS?: number;
}

/**
 * Shared HP sampling radius for prompt-rendered HP claims (B4 residual fix,
 * 2026-07-14 audit). Every renderer that prints an HP% for a specific instant
 * ([STATE] baseline ticks, [DMG SPIKE] endpoints, death HP-trajectory
 * checkpoints, burst most-pressured readings) must sample within this radius
 * of the claimed instant, or print nothing — otherwise two lines about the
 * same second can disagree and force the model to guess which is real.
 */
export const HP_SAMPLE_RADIUS_MS = 3_000;

/*
 * There used to be a second constant here: HP_SAMPLE_RADIUS_CRITICAL_MS = 1500
 * (a narrowed radius for "critical" windows) plus a selector predicate
 * hpSampleRadiusMs(). The whole thing was deleted on 2026-07-20. The reasons are
 * recorded here so nobody re-adds it on the intuition that "critical moments
 * deserve fresher readings":
 *
 * 1. **It did not fix the problem it claimed to fix.** The theory was that
 *    "two HP lines for the same second disagree" came from the two sides using
 *    different radii, so the radius was collapsed into a shared predicate —
 *    measured result: 26/50 → 26/50, not a single number moved. Because
 *    getUnitHpAtTimestamp first picks the nearest sample and only then uses the
 *    radius to accept or reject it: changing the radius can only turn the value
 *    into null, it **can never change the value that was picked**. The real root
 *    cause was the two queries not landing on the same grid (see
 *    toRenderSecond); aligning the instants is what drove it to zero.
 * 2. **It was redundant with an existing mechanism.** "Repeated sampling on
 *    dense ticks" was already handled by the STATE emission gate (a line is
 *    emitted only on ≥10% HP change or a status change) — that is row-level
 *    dedup and does not need to be implemented by throwing data away.
 * 3. **It actively lost coverage, and lost it exactly where it mattered most.**
 *    Measured on 24/50 matches, ±1.5s dropped whole units out of the [STATE]
 *    lines — and critical windows are precisely when the model most needs the
 *    full team's health. The units dropped were the ones with sparse
 *    advancedActions — i.e. the people who were NOT being attacked, whose HP was
 *    flat anyway, so a ±3s reading is perfectly accurate for them.
 *
 * Conclusion: use HP_SAMPLE_RADIUS_MS everywhere. To improve freshness, change
 * the emission gate or the sampling source — do not introduce a second radius.
 */

/**
 * Returns the HP% (0–100) of `unit` at the given timestamp by finding the nearest
 * advancedAction where advancedActorId === unit.id. Returns null when no data exists.
 */
export function getUnitHpAtTimestamp(
  unit: ICombatUnit,
  timestampMs: number,
  maxDtMs = HP_SAMPLE_RADIUS_MS,
): number | null {
  const closestAction = binarySearchClosest(
    unit.advancedActions,
    timestampMs,
    (a) => a.logLine.timestamp,
  );

  if (!closestAction) {
    return null;
  }

  if (closestAction.advancedActorId !== unit.id) {
    return null;
  }

  if (closestAction.advancedActorMaxHp <= 0) {
    return null;
  }

  const dt = Math.abs(closestAction.logLine.timestamp - timestampMs);
  if (dt > maxDtMs) {
    return null;
  }

  return Math.round(
    (closestAction.advancedActorCurrentHp / closestAction.advancedActorMaxHp) *
      100,
  );
}

/**
 * The `[STATE]` tick's HP predicate — **the** single sampler for "what HP does
 * the prompt show for this unit at this rendered second" (CLAUDE.md
 * Shared-Predicate Rule).
 *
 * Two consumers, one predicate:
 *  - `context/matchTimeline.ts`'s `[STATE]` loop prints this integer next to
 *    `fmtTime(s)`;
 *  - `analysis/crisisDecisionPoints.ts` re-anchors every crisis crossing onto
 *    the same grid through it, so a `cd-hoarded` / `crisis-no-response` fact
 *    rendered at a displayed second is by construction the number the
 *    same-second `[STATE]` line prints.
 *
 * The clamp is not cosmetic: `getUnitHpAtTimestamp` can exceed 100 (absorb
 * shields / max-HP changes mid-sample) and `[STATE]` renders the clamped
 * value, so anything comparing against the rendered text must clamp too.
 *
 * Measured cost of the two sides sampling separately (2026-08-30, 309-prompt
 * A/B corpus): cd-hoarded 155/167 covered menu lines contradicted their own
 * `[STATE]` tick, crisis-no-response 7/8. The eval gate
 * `checkCrisisHpStateConsistency` (promptQualityCheck.ts) re-parses the
 * rendered text and fails on any residual disagreement.
 *
 * @param tMs must already be on the render grid (`matchStartMs + s * 1000`).
 */
export function gridHpPct(unit: ICombatUnit, tMs: number): number | null {
  const pct = getUnitHpAtTimestamp(unit, tMs, HP_SAMPLE_RADIUS_MS);
  return pct === null ? null : Math.min(pct, 100);
}

/**
 * The `[STATE]` tick's death predicate — the companion to `gridHpPct`, and
 * the second half of "what does the prompt show for this unit at this
 * rendered second". `[STATE]` prints `unit:dead` (never a number) from the
 * rendered second `Math.floor(deathSeconds)` onward, so a claim citing a
 * numeric HP at such a second contradicts the timeline just as loudly as a
 * wrong number does.
 *
 * Measured 2026-08-30: after the crisis crossings were re-anchored onto the
 * render grid, 6 of the 158 covered `cd-hoarded` menu lines still disagreed
 * with their `[STATE]` tick — every one of them "fact 18% vs [STATE] dead",
 * because `gridHpPct` happily returns the last pre-death sample within
 * `HP_SAMPLE_RADIUS_MS` of a second the unit did not live to see.
 *
 * Multiple `deathRecords` resolve to the LAST one, matching
 * matchTimeline.ts's per-name map (built from ascending-sorted deaths, so the
 * last write wins).
 */
export function isDeadAtRenderSecond(
  unit: ICombatUnit,
  matchStartMs: number,
  renderSecond: number,
): boolean {
  const records = unit.deathRecords ?? [];
  if (records.length === 0) return false;
  let lastMs = -Infinity;
  for (const d of records) lastMs = Math.max(lastMs, d.timestamp);
  return renderSecond >= Math.floor((lastMs - matchStartMs) / 1000);
}

/**
 * Returns the power state (current/max) of `unit` for a specific power type
 * (defaults to Mana) at the given timestamp by finding the nearest advancedAction.
 * Returns null when no data exists.
 */
export function getUnitManaAtTimestamp(
  unit: ICombatUnit,
  timestampMs: number,
  maxDtMs = HP_SAMPLE_RADIUS_MS,
): { current: number; max: number } | null {
  const closestAction = binarySearchClosest(
    unit.advancedActions,
    timestampMs,
    (a) => a.logLine.timestamp,
  );

  if (!closestAction) {
    return null;
  }

  if (closestAction.advancedActorId !== unit.id) {
    return null;
  }

  const manaPower = closestAction.advancedActorPowers.find(
    (p) => p.type === CombatUnitPowerType.Mana,
  );
  if (!manaPower) {
    return null;
  }

  const dt = Math.abs(closestAction.logLine.timestamp - timestampMs);
  if (dt > maxDtMs) {
    return null;
  }

  return { current: manaPower.current, max: manaPower.max };
}

/**
 * Computes overall healing metrics (HPS and Overheal %) for a unit across a given duration.
 */
export function computeOverallHealingMetrics(
  unit: ICombatUnit,
  matchStartMs: number,
  matchEndMs: number,
): { hps: number; overhealPct: number } {
  const durationSeconds = (matchEndMs - matchStartMs) / 1000;
  if (durationSeconds <= 0) return { hps: 0, overhealPct: 0 };

  let totalAmount = 0;
  let totalEffective = 0;
  for (const h of unit.healOut) {
    if (
      h.logLine.timestamp >= matchStartMs &&
      h.logLine.timestamp <= matchEndMs
    ) {
      totalAmount += h.amount;
      totalEffective += h.effectiveAmount;
    }
  }

  const hps = totalEffective / durationSeconds;
  const overhealPct =
    totalAmount > 0
      ? Math.round(((totalAmount - totalEffective) / totalAmount) * 100)
      : 0;
  return { hps, overhealPct };
}

export interface IAvailableWindow {
  fromSeconds: number;
  toSeconds: number;
  durationSeconds: number;
}

export interface IMajorCooldownInfo {
  spellId: string;
  spellName: string;
  tag: string;
  cooldownSeconds: number;
  /** Observed maximum charge count. >1 when casts occur faster than a single charge allows (e.g. double Pain Suppression via PvP talent). */
  maxChargesDetected: number;
  /** Talent-resolved charge cap (official `charges` + `applyCdTalentModifiers`).
   * Read by `cdAvailableAt` (GH #22): >1 routes availability through the
   * sequential-recharge simulation `chargesAvailableAt`. Optional for
   * back-compat with hand-built fixtures; absent means 1. */
  charges?: number;
  casts: ICooldownCast[];
  /** Periods when the CD was available but the player did not use it */
  availableWindows: IAvailableWindow[];
  neverUsed: boolean;
  /** True when the spell is also tagged Offensive (a throughput/burst CD such as Power
   * Infusion), i.e. not a pure survival defensive. Used to keep throughput CDs out of
   * "cheaper defensive available" suggestions. Optional for back-compat with hand-built
   * fixtures; production always sets it. */
  isThroughput?: boolean;
  /** 这个能力**根本没有按键** —— 它是被动触发的(见 `PROC_ONLY_ACTIVATION_IDS`)。
   *  凡是「你当时本可以按它」形状的判断都必须跳过它:玩家没有那个选择,指控无法
   *  被满足。可选是为了兼容手搭 fixture,生产路径一定会设。 */
  isProcOnly?: boolean;
}

/**
 * Shared algorithmic core for cooldown availability (BACKLOG #21 item2; the
 * drift-prevention sharing point required by "a gate predicate IS the spec"):
 * given "the most recent use before instant t" (null = never used) and the
 * cooldown length in seconds, decide whether the CD is available at t.
 *
 * This package has two cooldown-availability predicates that read different data
 * sources and are deliberately not fully unified:
 * - `cdAvailableAt` (this file): reads `IMajorCooldownInfo.casts` (the parsed
 *   cooldown ledger).
 * - `isAvailableAt` (deathOutcomeAnalysis.ts): reads raw `unit.spellCastEvents`,
 *   with one extra layer of `resetSpellIds` expansion (reset abilities, e.g. B30
 *   Cold Snap resetting Ice Block).
 * Each side must keep its own "find the most recent use" adapter logic (the data
 * sources differ; merging them would distort the result), but the core criterion
 * — "no recorded use means available; otherwise check whether last use +
 * cooldown has reached t" — is identical, and MUST be shared through this
 * function rather than re-implemented on each side, which would drift.
 */
export function isCooldownAvailableFromLastUse(
  lastUseSeconds: number | null,
  cooldownSeconds: number,
  atSeconds: number,
): boolean {
  if (lastUseSeconds === null) return true; // never used before t
  return atSeconds >= lastUseSeconds + cooldownSeconds;
}

/**
 * Whether this major CD is available at instant t. Same source of truth as
 * deathSetupEvents' defensive-early check (which computes readyAt by hand):
 * that side decides "unavailable at death because it was pressed too early",
 * this side is the complementary consumer (death-unused-defensive /
 * external-unused decide "available at death yet never pressed").
 */
export function cdAvailableAt(
  cd: Pick<
    IMajorCooldownInfo,
    "casts" | "cooldownSeconds" | "neverUsed" | "charges"
  >,
  tSeconds: number,
): boolean {
  // GH #22: multi-charge entries go through the shared sequential-recharge
  // simulation — "last cast + cooldown" alone calls a 2-charge ability with one
  // charge spent unavailable. At <=1 charge the two agree point-by-point
  // (pinned in chargeAvailability.test.ts), so single-charge callers are
  // byte-for-byte unchanged.
  // Rendered-second slack (CD_INSTANT_SLACK_S, GH #61): the instant this
  // predicate answers for is the same one the [RES] ledger renders.
  const t = tSeconds + CD_INSTANT_SLACK_S;
  if ((cd.charges ?? 1) > 1) {
    return (
      chargesAvailableAt(
        cd.casts.map((c) => c.timeSeconds),
        cd.cooldownSeconds,
        cd.charges as number,
        t,
      ) > 0
    );
  }
  const last = [...cd.casts].filter((c) => c.timeSeconds <= t).pop();
  return isCooldownAvailableFromLastUse(
    last ? last.timeSeconds : null,
    cd.cooldownSeconds,
    t,
  );
}

/**
 * Rendered-second slack shared by EVERY "is cooldown X available at instant
 * t" consumer: a cast up to this many seconds AFTER the queried instant counts
 * as already consumed, and a cooldown that comes back within this many seconds
 * after the instant counts as ready. The `[RES]` ledger (resourceSnapshot.ts)
 * has rendered this way since the 2026-07-15 RES-lag fix — a snapshot printed
 * under a [CD] line must show the state AFTER that line's cast — and the
 * prompt's rendered clock is whole seconds, so a claim and the ledger it sits
 * next to can only agree if both read casts through the same slack.
 *
 * GH #61 (2026-09-02): `cdAvailableAt` and `deathOutcomeAnalysis.isAvailableAt`
 * used a strict `<= t` while the ledger used `<= t + 0.5`, so a Blessing of
 * Protection pressed 0.3 s after a death rendered as "had Blessing of
 * Protection available, caster was free" one line above a `[RES]` that listed
 * it on `cd:` (3/309 prompts of the 12.1 eval corpus; hard-failure class
 * "cooldown ledger consistency"). One constant, three consumers.
 */
export const CD_INSTANT_SLACK_S = 0.5;

/**
 * For a given unit, return all class-tagged major cooldowns (>= 30s) with
 * cast times and idle availability windows derived from the combat log.
 */
/** PvP talent → the spell ids it replaces. Official data (DB2
 * PvpTalent.OverridesSpellID, generated by genPvpTalentReplaces, 17 pairs,
 * including same-name id bridges from classSpells such as 105421/115750 Blinding
 * Light). The first case (Searing Glare) was confirmed from a user log and
 * matches the official table; a corpus scan (pvpReplaceScan) found no
 * high-confidence replacement pair outside the official table. */
export const PVP_TALENT_REPLACES: Record<string, string[]> =
  PVP_TALENT_REPLACES_GENERATED;

/**
 * Spells whose activation can produce ZERO SPELL_CAST_SUCCESS evidence for a
 * *particular* application — the only on-log evidence for that occurrence is
 * a self-applied buff aura, sometimes under the spell's own id and sometimes
 * under a *different* id (classSpells.ts/spellEffectData/the cooldown
 * ledger's spellId key). Same "光环 id 腐烂" shape as the rest of this
 * codebase's aura/cast id splits, just with the cast side entirely absent
 * for that instance instead of merely under a variant id — the existing
 * English-name fallback below (`getEnglishSpellName(e.spellId, "") ===
 * spell.name`) can't help here because it only scans `spellCastEvents`,
 * which has no row at all for the cast-less occurrence.
 *
 * Two distinct sub-shapes populate this table (batch1 = row 1 only,
 * task-A/2026-08-14 batch2 added rows 2-3):
 * 1. **Structurally cast-less** (Renewing Blaze): the ability is ALWAYS a
 *    reactive proc, never a button press, so 0/N matches ever show a cast
 *    for it — the aura is the only evidence that will ever exist.
 * 2. **Conditionally cast-less** (Avenging Wrath, Ascendance): the ability
 *    is normally a button press (most occurrences DO log a normal
 *    SPELL_CAST_SUCCESS, handled by the ordinary castRawCasts path above)
 *    but a specific talent can ALSO grant it as a free proc off a different
 *    spell's cast, and that proc-grant path applies the buff aura without
 *    going through the cast pipeline at all. `auraOnlyActivationSeconds` is
 *    fallback-only (see its own doc comment): it is consulted ONLY when the
 *    unit has zero real casts of `spellId` in the round, so a unit that DID
 *    press the button normally never has its ledger polluted by a stray
 *    resync-artifact aura for the same id (see that function's doc comment
 *    for the corpus-measured exposure this closed off).
 *
 * - "374348" Renewing Blaze (Evoker) → aura id "374349": a reactive defensive
 *   proc ("gain Renewing Blaze" when triggered, not a button press), so it
 *   has no cast line by design. Confirmed by a full-corpus scan (see
 *   cd-ledger-rot report, 2026-08-14): 0/N matches with a
 *   SPELL_CAST_SUCCESS for 374348 or 374349, vs. many matches where the buff
 *   aura (374349) is applied — e.g. match 76ea5f90, Girlbye-Tichondrius-US,
 *   03:08:19.314. The task-7 brief's original repro cited the flow line
 *   "活化烈焰" (spellId 361469) as the contradicting evidence; that id is
 *   actually Living Flame (spellNames.json/spellNamesZhGenerated.json both
 *   independently agree: 361469/361500/361509 → "Living Flame"/"活化烈焰",
 *   374348/374349 → "Renewing Blaze"/"新生光焰") — a coincidental Chinese-name
 *   mix-up (both contain 烈焰/"blaze"), not the real evidence. The real,
 *   reproducible contradiction in that same match is Renewing Blaze's own
 *   aura (374349) firing at 03:08:19 while the cd ledger says neverUsed.
 *
 * - "31884" Avenging Wrath (Paladin) → aura ids "31884" (base, same id) and
 *   "454351": Herald of the Sun hero-talent build — a Judgment cast has a
 *   chance to proc-grant Avenging Wrath (and a short bundle of related
 *   buffs: "愤怒之锤"/1241410 Hammer of Wrath enable, "安瑟的祝福"/445206
 *   Blessing of Anshe, "诞于日光"/1264050 Born of the Dawn, sometimes
 *   "苍穹之遗"/387178) with zero SPELL_CAST_SUCCESS for Avenging Wrath.
 *   Task-A cd-ledger-rot residual scan (2026-08-14): 7/8 hits show this
 *   exact bundle applying 0.7-9s after a Judgment cast/aura in the SAME
 *   round, no other cast anywhere nearby — e.g. match 8e45b000,
 *   Fantasyext-Illidan-US, aura burst @11.0s and again @20.5s, each right
 *   after a Judgment cast (@7.8s/@20.4s); match c95bd9cc#3,
 *   Retriboosin-Tichondrius-US, @26.3s after Judgment@20.7s; match
 *   6cdbb8a8#4, Belfy-WyrmrestAccord-US, @23.0s after Judgment@20.1s; match
 *   5321ca9b#0, Fantasyext-Illidan-US, @15.5s after Judgment@10.7s; match
 *   2fde172d#0, Picorii-Frostmourne-US, @25.9s after Judgment@18.1s; match
 *   4e71f364#5, Retx-Tichondrius-US, @18.9s; match 237d95ef#1,
 *   Eliory-Tichondrius-US, @28.3s after Judgment@26.9s. The 8th hit (match
 *   72bcb552#0, Lightsmith-Drak'thul-US, @129.7s) shows the same
 *   aura-with-zero-cast shape but embedded in a larger multi-buff batch with
 *   no isolated Judgment adjacency — included on the same aura-evidence
 *   basis even though its exact trigger wasn't pinned down. Contrast: the
 *   OTHER 110/121 batch2 residual hits (Stampeding Roar, Cloak of Shadows,
 *   Incarnation, Trueshot, Shadow Blades, Power Infusion, Ironbark, Evasion,
 *   Aura Mastery, Survival Instincts, Icebound Fortitude, Ice Barrier,
 *   Arcane Surge, Adrenaline Rush) were investigated and are NOT this same
 *   proc shape — see cd-ledger-rot-batch2.md for the full per-spell
 *   evidence; they are a combat-log state-resync artifact (a batch of
 *   already-active, unrelated buffs — Dampening/110310, potions, trinkets,
 *   marks, world blessings — reapplying at the exact same millisecond,
 *   confirming the log is re-syncing existing state rather than logging a
 *   fresh activation) and were deliberately left OUT of this table.
 *
 * - "114052" Ascendance (Shaman, shared id across all 3 specs' talent trees)
 *   → aura id "114052" (same id): a Restoration-tree talent in the same
 *   family as the above — a Riptide cast has a chance to proc-grant a brief
 *   Ascendance (bundled with "潮汐奔涌"/53390, "暗流"/383235,
 *   "先祖活力"/207400), zero SPELL_CAST_SUCCESS for Ascendance. Task-A scan:
 *   all 3/3 hits land on the SAME tick as a Riptide cast/aura, and one match
 *   shows it recurring 5 times in a single round (match 4159c044#4,
 *   Worstrshamn-Stormrage-US, @52.8s/66.4s/93.2s/114.8s — each paired with a
 *   Riptide cast/aura at the same tick); also match 296154b1#1,
 *   Bumbings-Tichondrius-US, @23.8s (Riptide@23.8s); match 296154b1#3, same
 *   player, @1.7s (Riptide@1.6s).
 */
export const AURA_ONLY_ACTIVATION_IDS: Record<string, string[]> = {
  "374348": ["374349"], // Renewing Blaze (Evoker)
  "31884": ["31884", "454351"], // Avenging Wrath (Paladin) — Herald of the Sun Judgment proc
  "114052": ["114052"], // Ascendance (Shaman) — Deeply Rooted Elements-style Riptide proc
};

/**
 * **根本没有按键的能力** —— `AURA_ONLY_ACTIVATION_IDS` 上面那段注释里的「第 1 种」
 * (structurally cast-less),与「第 2 种」(平时是按键、某个天赋另给一条 proc 路径,
 * 如复仇之怒 / 升腾)必须分开:后者「你整局没按」是成立的指控,前者不是。
 *
 * 为什么单列成一张表:`AURA_ONLY_ACTIVATION_IDS` 只解决「怎么算它用过了」,它把两种
 * 形状混在一起;而这里要回答的是**另一个事实** ——「玩家有没有这个选择」。凡是
 * 「你当时本可以按它」形状的判断(cd-waste 的整局没交、cd-spent-idle 的空放、
 * cd-hoarded 的攥着不放、死亡处的还有墙没交、loadout 的 `[UNUSED]` 标记)都必须跳过
 * 它们 —— 指控**无法被满足**,这正是价值门规则第 3 条「当时做得到吗」的极端情形:
 * 不是难做到,是没有那个按钮。
 *
 * 实测(2026-08-23,S2 归档 120 文件):复苏烈焰在治疗视角被 cd-waste 指控 4 次、
 * cd-spent-idle 1 次、death-setup 2 次、death-unused-defensive 1 次,DPS 视角
 * cd-spent-idle 2 次、death-setup 2 次;两侧各有 44 行 prompt 提到它。而归档 400 个
 * 文件里它的 `SPELL_CAST_SUCCESS` 是 **0 次**(光环 374349 上身 347 次)—— 也就是说
 * 每一个持有它的玩家都会被指控,而且永远洗不掉。
 *
 * 用户 2026-08-23 裁定:「那个是被动技能,等于是一个保命的、类似冰箱的技能」。
 */
export const PROC_ONLY_ACTIVATION_IDS: ReadonlySet<string> = new Set([
  "374348", // 复苏烈焰 Renewing Blaze(唤魔师)—— 被动触发的保命 HoT,没有按键
]);

/** 这个能力有没有按键;`false` 表示玩家可以主动按它。 */
export function isProcOnlyActivation(spellId: string): boolean {
  return PROC_ONLY_ACTIVATION_IDS.has(spellId);
}

/**
 * Match-relative-second timestamps of every self-applied buff aura that
 * counts as an activation of `spellId`, per AURA_ONLY_ACTIVATION_IDS. Empty
 * when `spellId` has no registered aura-only mapping.
 *
 * Single source, consumed by BOTH sides of this package's other
 * "was this cooldown available" pairing (predicate-index.md: `cdAvailableAt`
 * — via `extractMajorCooldowns`' cast ledger below — and
 * `deathOutcomeAnalysis.ts`'s `isAvailableAt`, pinned equal by
 * `cooldownAvailabilityKernel.test.ts`). Before this export existed, a spell
 * added to AURA_ONLY_ACTIVATION_IDS would fix the cd ledger's `neverUsed`
 * flag (this file) while `isAvailableAt`'s `lastCastSeconds` — which reads
 * raw `spellCastEvents` directly, with no path through this file's ledger —
 * stayed blind to the exact same aura evidence: the CD ledger would
 * correctly show the spell on cooldown while a death-outcome "died with X
 * available" judgement kept reporting it available. That is precisely the
 * "same fact, two hand-rolled predicates" failure CLAUDE.md's shared-
 * predicate rule exists to prevent — factoring the aura lookup out here
 * (rather than requiring each call site to re-check
 * AURA_ONLY_ACTIVATION_IDS itself) makes it structurally impossible for a
 * future table entry to reach only one side.
 *
 * **Fallback-only (2026-08-14, Task A follow-up)**: returns `[]` whenever
 * `unit` has ANY real `SPELL_CAST_SUCCESS` for `spellId` anywhere in the
 * round — aura evidence is consulted ONLY for the zero-real-cast case this
 * table exists for (a proc-only build with no button press logged at all).
 * This was NOT the original behavior: `auraOnlyActivationSeconds` used to be
 * unconditionally additive (aura evidence folded in on top of cast evidence
 * regardless of whether casts existed), on the theory that adding an entry
 * could only ADD a missing activation, never fabricate one. That reasoning
 * broke for "conditionally cast-less" entries (Avenging Wrath, Ascendance —
 * see the table's doc comment): the SAME combat-log state-resync artifact
 * documented in cd-ledger-rot-batch2.md (a burst of unrelated already-active
 * buffs reapplying at one instant) can ALSO re-emit these ids' aura on a
 * unit that DOES have real casts elsewhere in the round — e.g. batch2's own
 * row 11 sample (match 047a0ae0, Miltonight-Korgath-US) bundles a stray
 * Avenging Wrath aura into an Aura Mastery resync burst. A corpus-wide
 * exposure scan (2026-08-14, units with >=1 real cast of 31884 or 114052,
 * scanning all 1319 of their self-applied aura events for that id) found
 * 27 aura events >2s from the nearest real cast AND with no plausible
 * trigger cast (Judgment for 31884, Riptide for 114052) within 10s before —
 * i.e. 27 latent spurious-extra-`casts`-entry risks under the old additive
 * semantics, none of which were part of the 11 confirmed genuine-proc hits
 * (those all had ZERO real casts, so this fallback change has no effect on
 * them). Fallback-only closes this off structurally: with a real cast
 * present, aura evidence is never consulted, so it can never fabricate an
 * extra "used" credit; with zero real casts, aura evidence is the only
 * signal there ever was, exactly the Renewing Blaze/Avenging-Wrath-proc/
 * Ascendance-proc case this table is for.
 */
export function auraOnlyActivationSeconds(
  unit: ICombatUnit,
  spellId: string,
  matchStartMs: number,
): number[] {
  const auraIds = AURA_ONLY_ACTIVATION_IDS[spellId];
  if (!auraIds) return [];
  const hasRealCast = unit.spellCastEvents.some(
    (e) =>
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS && e.spellId === spellId,
  );
  if (hasRealCast) return [];
  return unit.auraEvents
    .filter(
      (a) =>
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        !!a.spellId &&
        auraIds.includes(a.spellId) &&
        a.srcUnitId === unit.id &&
        a.destUnitId === unit.id,
    )
    .map((a) => (a.timestamp - matchStartMs) / 1000);
}

/**
 * Applies a spellId's `CD_TALENT_MODIFIERS` entries to a base cooldown +
 * charge count, given which talentSpellIds the unit has (regular/hero talents
 * and PvP talents). Shared by `extractMajorCooldowns` below and by
 * `test/datagen/talentModifiers.test.ts`'s exhaustive invariant test — per
 * CLAUDE.md's shared-predicate rule, "cooldownSeconds after talent
 * modifiers" is one fact and must be computed by one function, not
 * re-derived in the test (fix-29a-review.md finding #2: an earlier version
 * of the invariant test reimplemented `base - totalReduce` in isolation,
 * which would have silently kept asserting against the *old*, wrong,
 * flat-only arithmetic even after this function grew percentage support).
 *
 * Combination order for `reduce_cd` (flat seconds) vs `reduce_cd_pct`
 * (percentage) mirrors real WoW's own SpellMod application order — verified
 * against TrinityCore's `Player::ApplySpellMod`/`GetSpellModValues`
 * (Player.cpp:22636-22860, upstream `TrinityCore/TrinityCore@master`): every
 * matching FLAT mod for an op is summed first, THEN every matching PCT mod's
 * multiplier is applied to that *sum* — `basevalue = (base + totalFlat) *
 * totalPctMultiplier`, not percent-of-base-then-subtract-flat. TrinityCore
 * stores the DB2 value with its sign (negative for a reduction) and computes
 * `1 + value/100`; the generator strips the sign (`Math.abs`, same
 * convention as flat `reduce_cd`) and stores the reduction magnitude, so here
 * the multiplier is `1 - value/100` per mod — every `reduce_cd_pct` entry
 * IS a reduction, mirroring `reduce_cd`'s existing "always subtractive"
 * convention. Multiple pct mods on the same spell multiply together, not add.
 */
// Pure form of `applyCdTalentModifiers` below, taking the modifiers array
// directly instead of looking it up from the production `CD_TALENT_MODIFIERS`
// table — this is what makes the stacking arithmetic unit-testable against a
// synthetic fixture (test/datagen/talentModifiers.test.ts) without mocking
// the generated JSON module. `applyCdTalentModifiers` is a thin wrapper
// around this so production still has exactly one call site for real spell
// ids, and there remains exactly ONE place doing the sum/multiply math —
// this function — for both production and tests to share (CLAUDE.md's
// shared-predicate rule: `genTalentModifiers.ts`'s `addModifier` therefore
// must NOT re-aggregate multiple same-(talentSpellId,effect) rows into one
// entry; it emits every distinct-value row and this function stacks them).
export function applyCdModifiers(
  modifiers: ICDModifier[] | undefined,
  baseCooldownSeconds: number,
  baseCharges: number,
  talentedSpellIds: Set<string> | null,
  pvpTalentIds: Set<string>,
): { cooldownSeconds: number; charges: number } {
  if (!modifiers || (!talentedSpellIds && pvpTalentIds.size === 0)) {
    return { cooldownSeconds: baseCooldownSeconds, charges: baseCharges };
  }

  let charges = baseCharges;
  let flatReduceSeconds = 0;
  let pctMultiplier = 1;
  for (const mod of modifiers) {
    if (
      !talentedSpellIds?.has(mod.talentSpellId) &&
      !pvpTalentIds.has(mod.talentSpellId)
    ) {
      continue;
    }
    if (mod.effect === "extra_charge") {
      charges += mod.value;
    } else if (mod.effect === "reduce_cd") {
      flatReduceSeconds += mod.value;
    } else if (mod.effect === "reduce_cd_pct") {
      pctMultiplier *= 1 - mod.value / 100;
    }
  }

  return {
    cooldownSeconds: (baseCooldownSeconds - flatReduceSeconds) * pctMultiplier,
    charges,
  };
}

/**
 * How many charges of an ability the player has in hand at `atSeconds`, given
 * every cast of it and the ability's per-charge recharge time.
 *
 * **Charges recharge SEQUENTIALLY, not in parallel** — WoW runs exactly one
 * recharge timer at a time, and it only restarts once the previous charge has
 * landed. A sliding-window count ("casts inside the last `recharge` seconds")
 * models parallel recharge and over-reports availability; cross-AI review
 * (agy, 2026-08-18) caught this with a concrete case: 2 charges / 20s, casts
 * at 0, 5 and 20 leaves ZERO charges at t=35 (t=0 spends one and starts the
 * timer; t=5 spends the second; the timer completes at t=20 and that charge
 * is spent immediately, so the next one is not back until t=40), while the
 * window (15, 35] sees only one cast and would wrongly answer "available".
 *
 * The cast list is ground truth: if a cast appears while this model believes
 * the player had nothing left (an unmodelled reset/talent), the cast is still
 * consumed and the timer re-anchored to it, so the model self-corrects
 * forward instead of drifting further out of sync.
 *
 * `maxCharges <= 1` reduces exactly to `cdAvailableAt`'s "last cast +
 * cooldown <= t", boundary included — pinned by
 * `packages/analysis/test/chargeAvailability.test.ts`.
 */
export function chargesAvailableAt(
  castSeconds: readonly number[],
  rechargeSeconds: number,
  maxCharges: number,
  atSeconds: number,
): number {
  const cap = Math.max(1, Math.floor(maxCharges));
  if (!(rechargeSeconds > 0)) return cap;
  const casts = [...castSeconds]
    .filter((t) => t <= atSeconds)
    .sort((a, b) => a - b);
  let charges = cap;
  let nextRecharge = Number.POSITIVE_INFINITY;
  const advanceTo = (t: number): void => {
    while (charges < cap && nextRecharge <= t) {
      charges++;
      nextRecharge =
        charges < cap
          ? nextRecharge + rechargeSeconds
          : Number.POSITIVE_INFINITY;
    }
  };
  for (const c of casts) {
    advanceTo(c);
    if (charges > 0) {
      charges--;
      // A timer already running is NOT restarted by spending another charge.
      if (charges < cap && nextRecharge === Number.POSITIVE_INFINITY) {
        nextRecharge = c + rechargeSeconds;
      }
    } else {
      // The log says it was cast with nothing in hand by our reckoning — an
      // unmodelled reset/talent. Trust the log: a charge demonstrably existed
      // and was spent at `c`, so re-anchor the timer there rather than keep
      // running one we now know is wrong.
      nextRecharge = c + rechargeSeconds;
    }
  }
  advanceTo(atSeconds);
  return charges;
}

/**
 * The two talent-id sets `applyCdTalentModifiers` needs for a unit: regular /
 * hero talents (null when COMBATANT_INFO carries no talent blob — "unknown",
 * NOT "took none") and PvP talents.
 *
 * Extracted 2026-08-18 (CLAUDE.md shared-predicate rule): "which talents does
 * this player have, for cooldown purposes" is one fact, and it was previously
 * inlined inside `extractMajorCooldowns` only — so `ccAvoidanceOptionsAt`
 * (candidateFindings.ts), the other consumer of a spell's cooldown, had no way
 * to reach it and silently used raw base cooldowns instead. One derivation,
 * both call sites.
 *
 * **Memoised per unit, and it has to be.** `extractMajorCooldowns` calls this
 * once per unit, but the two consumers added on 2026-08-18 call it inside
 * loops — `ccAvoidanceOptionsAt` once per CC event, `getDefensiveStateAtTime`
 * once per (enemy × offensive window) — and each uncached call walks the
 * unit's whole talent list building a fresh Map plus two Sets. That path is
 * live in the desktop renderer (report → burstLedger →
 * analyzeKillWindowTargetSelection), and CI's first-paint budget started
 * failing on both commits that introduced those loops (the parent commit's
 * two samples were 4722/5154ms; d5a66dce's were 5226/5349ms, i.e. both above
 * either parent sample, and a same-SHA rerun failed too rather than
 * regressing to the mean).
 *
 * Keyed by the unit object in a WeakMap, so entries die with the match. The
 * returned object is SHARED — callers read it (`.has`) and must never mutate
 * the sets.
 */
const talentIdSetsCache = new WeakMap<
  ICombatUnit,
  { talentedSpellIds: Set<string> | null; pvpTalentIds: Set<string> }
>();

export function playerTalentIdSets(unit: ICombatUnit): {
  talentedSpellIds: Set<string> | null;
  pvpTalentIds: Set<string>;
} {
  const cached = talentIdSetsCache.get(unit);
  if (cached !== undefined) return cached;

  const specIdNum = parseInt(unit.spec, 10);
  const talentedSpellInfo = unit.info?.talents
    ? getPlayerTalentedSpellInfo(specIdNum, unit.info.talents)
    : null;
  const result = {
    talentedSpellIds: talentedSpellInfo
      ? new Set(talentedSpellInfo.keys())
      : null,
    // PvP talents selected by this player (spell IDs). Available when
    // COMBATANT_INFO is present.
    pvpTalentIds: new Set<string>(unit.info?.pvpTalents ?? []),
  };
  talentIdSetsCache.set(unit, result);
  return result;
}

export function applyCdTalentModifiers(
  spellId: string,
  baseCooldownSeconds: number,
  baseCharges: number,
  talentedSpellIds: Set<string> | null,
  pvpTalentIds: Set<string>,
): { cooldownSeconds: number; charges: number } {
  return applyCdModifiers(
    CD_TALENT_MODIFIERS[spellId],
    baseCooldownSeconds,
    baseCharges,
    talentedSpellIds,
    pvpTalentIds,
  );
}

export function extractMajorCooldowns(
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
): IMajorCooldownInfo[] {
  const matchStartMs = combat.startTime;
  const matchEndMs = combat.endTime;
  const matchDurationSeconds = (matchEndMs - matchStartMs) / 1000;

  const classData = classMetadata.find((c) => c.unitClass === unit.class);
  if (!classData) return [];

  if (unit.class === CombatUnitClass.Priest) {
    // 2026-08-21: the 421116 sibling was a "Push Loot [DNT]" placeholder, not
    // Ultimate Penitence — deleted (S2 corpus scan, 0/10,682 matches).
    const hasUP2 = classData.abilities.some((a) => a.spellId === "421453");
    if (!hasUP2) {
      classData.abilities.push({
        spellId: "421453",
        name: "Ultimate Penitence",
        tags: [SpellTag.Defensive],
      });
    }
  }

  const specIdNum = parseInt(unit.spec, 10);
  const specTalentTreeSpellInfo = getSpecTalentTreeSpellInfo(specIdNum);
  const specTalentTreeSpellIds = new Set(specTalentTreeSpellInfo.keys());
  const talentedSpellInfo = unit.info?.talents
    ? getPlayerTalentedSpellInfo(specIdNum, unit.info.talents)
    : null;
  const { talentedSpellIds, pvpTalentIds } = playerTalentIdSets(unit);
  // Spells **replaced** by a selected PvP talent: with the talent taken, the
  // baseline/class-talent spell no longer exists, so it must not enter the
  // "never used all match" ledger (2026-07-25 user report: a Holy Paladin who
  // took Searing Glare was still told they never pressed Blinding Light). The
  // table only accepts replacement pairs confirmed by a user or the corpus —
  // do not extend it from memory.
  const replacedByPvpTalent = new Set<string>();
  for (const [talentId, replaced] of Object.entries(PVP_TALENT_REPLACES))
    if (pvpTalentIds.has(talentId))
      for (const r of replaced) replacedByPvpTalent.add(r);
  const hasCombatantInfo = unit.info !== undefined;
  // Build a fast lookup of all spell IDs the player actually cast this match.
  const castSpellIds = new Set<string>(
    unit.spellCastEvents
      .filter((e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS)
      .map((e) => e.spellId)
      .filter((id): id is string => id !== null),
  );

  // Keep only tagged spells with cooldown data >= MIN_CD_SECONDS that belong to the owner's spec
  const seen = new Set<string>();
  const majorSpells = classData.abilities.filter((spell) => {
    if (seen.has(spell.spellId)) return false;
    if (replacedByPvpTalent.has(spell.spellId)) return false;
    if (spell.tags.length === 0) return false;
    const effectData = spellEffectData[spell.spellId];
    if (!effectData) return false;
    const cd =
      effectData.cooldownSeconds ??
      effectData.charges?.chargeCooldownSeconds ??
      0;
    if (cd < MIN_CD_SECONDS) return false;
    const allowedSpecs = SPEC_EXCLUSIVE_SPELLS[spell.spellId];
    if (allowedSpecs && !allowedSpecs.includes(unit.spec)) return false;

    const isInTalentTree = specTalentTreeSpellIds.has(spell.spellId);

    if (isInTalentTree) {
      // Regular/hero talent — filter out if the player didn't take it.
      if (talentedSpellIds !== null && !talentedSpellIds.has(spell.spellId)) {
        return false;
      }
      // If talent data failed to parse (talentedSpellIds null) but COMBATANT_INFO is present,
      // require cast evidence to avoid including talents the player didn't actually take.
      if (
        talentedSpellIds === null &&
        hasCombatantInfo &&
        !castSpellIds.has(spell.spellId)
      ) {
        return false;
      }
    } else if (hasCombatantInfo) {
      // Not in the regular talent tree — could be a PvP talent or a true baseline ability.
      // Accept if: (a) the player selected it as a PvP talent, OR (b) they actually cast it
      // this match (proof they have it regardless of talent source).
      // This filters out PvP talents the player didn't pick while keeping baseline abilities
      // that were used. Baseline abilities that were never used and aren't PvP talents will be
      // silently excluded — acceptable trade-off to avoid false "never used X" reports.
      if (
        !pvpTalentIds.has(spell.spellId) &&
        !castSpellIds.has(spell.spellId)
      ) {
        return false;
      }
    }

    seen.add(spell.spellId);
    return true;
  });

  // --- Racial cooldowns (2026-08-12) ---
  // The combat log has no race field, so a racial can only ever enter the
  // ledger on cast evidence — which also means it can never produce a "never
  // used X all match" line for a player whose race does not have it. That is
  // the same cast-evidence rule the baseline-ability branch above already
  // applies, just with ownership that is unknowable rather than merely absent.
  // Cooldowns come from the official DB2 table like every other spell (the ids
  // are in the datagen candidate universe), never from a hand-written number.
  for (const spellId of OFFENSIVE_RACIAL_SPELL_IDS) {
    if (seen.has(spellId)) continue;
    if (!castSpellIds.has(spellId)) continue;
    const effectData = spellEffectData[spellId];
    if (!effectData) continue;
    const cd =
      effectData.cooldownSeconds ??
      effectData.charges?.chargeCooldownSeconds ??
      0;
    if (cd < MIN_CD_SECONDS) continue;
    majorSpells.push({
      spellId,
      name: effectData.name,
      tags: [SpellTag.Offensive],
    });
    seen.add(spellId);
  }

  // --- Dynamic Discovery ---
  // Add any active talent spell with CD >= 30s that wasn't already in the static list.
  if (talentedSpellInfo) {
    for (const [spellId, info] of talentedSpellInfo.entries()) {
      if (seen.has(spellId)) continue;
      // Spells replaced by a selected PvP talent must not enter the ledger via
      // the dynamic-discovery path either.
      if (replacedByPvpTalent.has(spellId)) continue;
      // Only discover buttons (active nodes). Passives are handled via CD_TALENT_MODIFIERS.
      if (info.type !== "active") continue;

      const effectData = spellEffectData[spellId];
      if (!effectData) continue;

      const cd =
        effectData.cooldownSeconds ??
        effectData.charges?.chargeCooldownSeconds ??
        0;
      if (cd >= MIN_CD_SECONDS) {
        // Intelligent tagging based on name pattern rules
        const name = effectData.name.toLowerCase();
        const tags: SpellTag[] = [];

        for (const rule of DISCOVERY_TAG_RULES) {
          if (rule.pattern.test(name)) {
            tags.push(...rule.tags);
          }
        }

        // If we found a tag, it's a "Major CD" for analysis purposes.
        if (tags.length > 0) {
          majorSpells.push({ spellId, name: effectData.name, tags });
          seen.add(spellId);
        }
      }
    }
  }

  // --- Healer save-cooldown roster (GH #63, 2026-09-04) ---
  // The generated roster is the AUTHORITY for healer specs: every roster
  // spell the unit has evidence for (cast it, has it talented, or picked it
  // as a PvP talent — the same evidence rules the catalog branches above
  // apply) enters the ledger tagged Defensive, and a catalog Offensive tag on
  // the same id is dropped (Avenging Wrath heals in a Holy Paladin's hands;
  // `isThroughput` reads that tag). Spells the roster does not list are left
  // exactly as the catalog had them. See data/healerSaveCd.ts.
  const saveRoster = healerSaveCdRoster(specToString(unit.spec));
  if (saveRoster) {
    // Authority cuts both ways — but only on EVIDENCE: a catalog / name-regex
    // Defensive tag is dropped for this healer when the generated table says
    // so (`stripDefensive`: user-ruled out, profile-ineligible CC relief /
    // mobility such as Spirit Walk and Spiritwalker's Grace from the `/spirit/`
    // regex, or measured below the door like Divine Protection and Barkskin).
    // An unmeasured catalog Defensive (Power Word: Barrier, n < 100) is left
    // alone. The spell stays in the ledger under its other tags; with no
    // other tag it leaves the major-cooldown list altogether.
    // COPY-ON-WRITE: `majorSpells` entries are the static `classMetadata`
    // objects themselves. Mutating `tags` in place leaked the strip into the
    // shared catalog (a Resto Druid processed once removed Barkskin's tag for
    // every Druid afterwards — caught by test ordering, 2026-09-04).
    const strip = healerSaveCdStripDefensive(specToString(unit.spec));
    for (let i = majorSpells.length - 1; i >= 0; i--) {
      const sp = majorSpells[i]!;
      if (!strip.has(sp.spellId) || !sp.tags.includes(SpellTag.Defensive)) continue;
      const tags = sp.tags.filter((t) => t !== SpellTag.Defensive);
      if (tags.length === 0) majorSpells.splice(i, 1);
      else majorSpells[i] = { ...sp, tags };
    }
    for (const [spellId, entry] of saveRoster) {
      if (replacedByPvpTalent.has(spellId)) continue;
      const evidence =
        castSpellIds.has(spellId) ||
        pvpTalentIds.has(spellId) ||
        (talentedSpellIds !== null && talentedSpellIds.has(spellId));
      if (!evidence) continue;
      const idx = majorSpells.findIndex((s) => s.spellId === spellId);
      if (idx >= 0) {
        const existing = majorSpells[idx]!;
        majorSpells[idx] = {
          ...existing,
          tags: [
            SpellTag.Defensive,
            ...existing.tags.filter(
              (t) => t !== SpellTag.Defensive && t !== SpellTag.Offensive,
            ),
          ],
        };
      } else {
        majorSpells.push({
          spellId,
          name: spellEffectData[spellId]?.name ?? entry.name,
          tags: [SpellTag.Defensive],
        });
        seen.add(spellId);
      }
    }
  }

  return majorSpells.flatMap((spell) => {
    const effectData = spellEffectData[spell.spellId];
    if (!effectData) return [];

    const baseCooldownSeconds =
      effectData.cooldownSeconds ??
      effectData.charges?.chargeCooldownSeconds ??
      0;
    const baseCharges = effectData.charges?.charges ?? 1;

    // Apply talent-based modifications if the player's talents are known
    const { cooldownSeconds, charges: baselineCharges } =
      applyCdTalentModifiers(
        spell.spellId,
        baseCooldownSeconds,
        baseCharges,
        talentedSpellIds,
        pvpTalentIds,
      );

    const castEvents = unit.spellCastEvents.filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        (e.spellId === spell.spellId ||
          // Variant cast ids (form-specific Stampeding Roar, talent-modified
          // Blessing of Sacrifice / Oppressing Roar, …) log a different id
          // with the same English name. Exact-id matching stamped 15/1245
          // prompts' real casts [UNUSED] and emitted bogus "available all
          // match" windows (invariant sweep I1, 2026-07-16).
          (!!e.spellId && getEnglishSpellName(e.spellId, "") === spell.name)),
    );

    const isDefOrExternal = spell.tags.includes(SpellTag.Defensive);
    const isControl = spell.tags.includes(SpellTag.Control);
    // GH #29 阶段 2b:这个门决定「这次施放要不要记下目标和目标血量」,真正想问的是
    // **这次施放有没有作用在别人身上**,而三值 tag 只能表达防御/控制两类。后果实测:
    // 强化(Power Infusion,10060)是给队友的产出 buff 却挂 Offensive tag,250 场 /
    // 312 治疗轮里 **59 条 [YOU][CD] 行全部丢掉受益人**,还印着施法者自己的血量 ——
    // 模型看不出这个大 CD 给了谁。官方 targeting 正好回答这个问题(reachesAlly),
    // 补成第三个分支即可,对原有两类逐字节无影响(纯增补)。
    const reachesSomeoneElse = reachesAlly(spell.spellId);

    const castRawCasts: ICooldownCast[] = castEvents
      .filter((e) => !e.spellName || !PASSIVE_SPELL_BLOCKLIST.has(e.spellName))
      // #36(a): an echo copy (Dream Breath 355941 etc.) is not a press — as a
      // ledger cast it would fabricate cooldown usage and corrupt
      // cdAvailableAt/chargesAvailableAt for the real spell's variants.
      .filter((e) => !COPY_CAST_IDS.has(String(e.spellId ?? "")))
      .map((e) => {
        const timeSeconds = (e.logLine.timestamp - matchStartMs) / 1000;
        const cast: ICooldownCast = { timeSeconds };
        if (
          (isDefOrExternal || isControl || reachesSomeoneElse) &&
          e.destUnitId &&
          e.destUnitName &&
          e.destUnitName !== "nil"
        ) {
          cast.targetName = e.destUnitName;
          const targetUnit = combat.units[e.destUnitId];
          if (targetUnit) {
            // This value is ultimately rendered in `[CD] … → target (N% HP)`,
            // side by side with the [STATE] line for the same second. It used to
            // sample at the raw log millisecond with its own 2s radius (a third
            // independent HP path), so two HP numbers under the same displayed
            // second contradicted each other (class C). Now snapped to the render
            // grid and using the shared radius constant.
            const hp = getUnitHpAtTimestamp(
              targetUnit,
              matchStartMs + toRenderSecond(timeSeconds) * 1000,
              HP_SAMPLE_RADIUS_MS,
            );
            if (hp !== null) cast.targetHpPct = hp;
          }
        }
        return cast;
      });

    // Aura-only activations (AURA_ONLY_ACTIVATION_IDS): spells with no
    // SPELL_CAST_SUCCESS line at all — the self-applied buff aura is the
    // only evidence the ability fired. Without this, `castRawCasts` above is
    // permanently empty for these ids and the ledger reports `neverUsed`
    // even when the aura is visibly up in the log (cd-ledger-rot class of
    // bug; see the constant's doc comment for the confirmed case).
    const auraRawCasts: ICooldownCast[] = auraOnlyActivationSeconds(
      unit,
      spell.spellId,
      matchStartMs,
    ).map((timeSeconds) => ({ timeSeconds }));

    const rawCasts: ICooldownCast[] = [...castRawCasts, ...auraRawCasts].sort(
      (a, b) => a.timeSeconds - b.timeSeconds,
    );

    const casts: ICooldownCast[] = [];
    for (const c of rawCasts) {
      const last = casts[casts.length - 1];
      if (!last || c.timeSeconds - last.timeSeconds > 2) {
        casts.push(c);
      }
    }

    const availableWindows: IAvailableWindow[] = [];

    const pushWindow = (from: number, to: number) => {
      const duration = to - from;
      if (duration > GRACE_SECONDS) {
        availableWindows.push({
          fromSeconds: from,
          toSeconds: to,
          durationSeconds: duration,
        });
      }
    };

    if (casts.length === 0) {
      // Never used — available the entire match
      pushWindow(0, matchDurationSeconds);
    } else {
      // Window before first cast
      if (casts[0].timeSeconds > GRACE_SECONDS) {
        pushWindow(0, casts[0].timeSeconds);
      }
      // Windows between casts (and from last cast to match end)
      for (let i = 0; i < casts.length; i++) {
        const cdReadyAt = casts[i].timeSeconds + cooldownSeconds;
        const nextCastAt =
          i + 1 < casts.length
            ? casts[i + 1].timeSeconds
            : matchDurationSeconds;
        if (cdReadyAt < matchDurationSeconds - GRACE_SECONDS) {
          pushWindow(cdReadyAt, nextCastAt);
        }
      }
    }

    // Detect observed charge count: if any two consecutive casts are closer than the CD,
    // the player must have had at least 2 charges (e.g. double Pain Suppression via PvP talent).
    let maxChargesDetected = Math.max(1, baselineCharges);
    for (let i = 1; i < casts.length; i++) {
      if (casts[i].timeSeconds - casts[i - 1].timeSeconds < cooldownSeconds) {
        maxChargesDetected = Math.max(maxChargesDetected, 2);
      }
    }

    return [
      {
        spellId: spell.spellId,
        spellName: spell.name,
        tag: spell.tags[0] as string,
        cooldownSeconds,
        maxChargesDetected,
        charges: baselineCharges,
        casts,
        availableWindows,
        neverUsed: casts.length === 0,
        isThroughput: spell.tags.includes(SpellTag.Offensive),
        isProcOnly: PROC_ONLY_ACTIVATION_IDS.has(spell.spellId),
      },
    ];
  });
}

/**
 * B138: spells that carry a Defensive tag but are NOT damage-mitigation/heal substitutes — mobility,
 * dispels, single-spell reflects, and utility. Suggesting one as a "cheaper alternative" to a major
 * survival CD is misleading (e.g. "you could have used Spirit Walk / Cauterizing Flame instead of
 * Emerald Communion"): they neither reduce damage taken nor heal, so they can't cover the same need.
 */
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
// 2026-08-21 S2 corpus scan (10,682 matches): removed 8178 old Grounding Totem id (204336 kept) — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const NON_SUBSTITUTE_DEFENSIVE_IDS = new Set<string>([
  "374251", // Cauterizing Flame (Evoker) — dispel
  "370665", // Rescue (Evoker) — mobility / reposition
  "58875", // Spirit Walk (Shaman) — mobility / snare break
  "106898", // Stampeding Roar (Druid) — group mobility
  "77761", // Stampeding Roar (Bear form variant)
  "77764", // Stampeding Roar (Cat form variant)
  "370537", // Stasis (Evoker) — spell storage utility
  "204336", // Grounding Totem (Shaman) — single-spell reflect
  "79206", // Spiritwalker's Grace (Shaman) — cast-while-moving utility
]);

/**
 * #10 T5 follow-up (High-severity finding from the agy flash review; verified
 * and fixed): externals whose
 * effect is a damage-REDIRECT to the caster (target takes less, caster takes
 * the difference) are a mechanical no-op when self-cast — target === caster
 * means nothing is redirected. Suggesting one as a "cheaper alternative" in a
 * SELF-cast context (opts.castTargetIsTeammate falsy) is not just unhelpful,
 * it's actively wrong (the player could not have gained anything from it).
 * Scoped to this one verified mechanic per reviewer — do NOT expand to all
 * of EXTERNAL_DEFENSIVE_IDS without confirming each spell's actual self-cast
 * behavior (e.g. Pain Suppression/Ironbark/Guardian Spirit ARE useful
 * self-cast, they grant/heal rather than redirect).
 */
export const SELF_CAST_NOOP_EXTERNAL_IDS: ReadonlySet<string> = new Set([
  "6940", // Blessing of Sacrifice (Paladin) — damage-redirect-to-caster
]);

/**
 * #25-1 (2026-08-19) same-predicate guard annotation for cooldown LEDGER
 * surfaces — renderers that list every player's ready/onCd as neutral facts
 * (momentSnapshot's cd-ledger, eval explore's cdLines). Reviewer-verified
 * failure (60ab1e8f @8:25, promptVersion 24): a bare "ready: Blessing of
 * Sacrifice" on the dying player's OWN row reads as "could have saved
 * themself", which is mechanically false (self-cast redirects nothing). The
 * fact itself must stay — the same "ready" is genuinely actionable toward a
 * dying TEAMMATE — so ledger surfaces annotate instead of filter. Filtering
 * call sites (cheaper-alternative, [DEATH] Unused, death candidates) keep
 * consuming the set directly; every ledger-style renderer takes its display
 * name from here so the annotation cannot drift per surface.
 */
export function selfCastNoopAnnotatedName(cd: {
  spellId: string;
  spellName: string;
}): string {
  return SELF_CAST_NOOP_EXTERNAL_IDS.has(cd.spellId)
    ? `${cd.spellName}(仅可施于队友,不可自保)`
    : cd.spellName;
}

/**
 * Self throughput-EMPOWER CDs that are tagged 'Defensive' in classMetadata but are NOT survival responses —
 * they empower the caster's own throughput (e.g. Apotheosis empowers Holy Words to pump team healing). There
 * is no "cheaper" substitute for the empower and a self-heal cannot replace it, so they must never receive a
 * `cheaper available:` note. Follow-up to B138/B142 (surfaced by the 2026-07-02 meta-eval).
 */
export const THROUGHPUT_EMPOWER_DEFENSIVE_IDS = new Set<string>(
  CURATED_ABILITY_FACTS.filter((f) => f.kind === "throughput_role").map(
    (f) => f.id,
  ),
);

/**
 * F166 / review C2: given a defensive cast `cd`, return the names of strictly-cheaper
 * (shorter-cooldown) defensive tools that were available at `atSeconds`.
 *
 * Throughput cooldowns (Offensive-tagged, e.g. Power Infusion) are excluded — a healer
 * burning a survival CD did not have a "cheaper" alternative in a burst/throughput CD,
 * and suggesting one is misleading. The cast itself and tools on cooldown are excluded.
 * B138: mobility/dispel/utility "defensives" (NON_SUBSTITUTE_DEFENSIVE_IDS) are also excluded —
 * they can't substitute for a damage-mitigation/heal cooldown.
 * #10 T5 follow-up: in a SELF-cast context (opts.castTargetIsTeammate falsy), damage-redirect
 * externals (SELF_CAST_NOOP_EXTERNAL_IDS, e.g. Blessing of Sacrifice) are also excluded — they
 * are a mechanical no-op when the caster targets themself.
 */
export function findCheaperDefensiveAlternatives(
  cd: IMajorCooldownInfo,
  ownerCDs: IMajorCooldownInfo[],
  atSeconds: number,
  opts: { castTargetIsTeammate?: boolean } = {},
): string[] {
  return ownerCDs
    .filter(
      (other) =>
        other.spellId !== cd.spellId &&
        other.tag === "Defensive" &&
        !other.isThroughput &&
        !NON_SUBSTITUTE_DEFENSIVE_IDS.has(other.spellId) &&
        other.cooldownSeconds < cd.cooldownSeconds &&
        other.availableWindows.some(
          (w) => atSeconds >= w.fromSeconds && atSeconds <= w.toSeconds,
        ) &&
        // H11: a self-only tool can't help a teammate — only suggest it when the cast that's
        // being annotated targeted the owner themself. GH #36 item 4 (2026-08-27): the
        // "can it reach the teammate" fact is `canHelpAnotherUnit` (official targeting +
        // team-heal registry), no longer the 15-entry hand list EXTERNAL_DEFENSIVE_IDS —
        // that list could never suggest Tranquility / Divine Hymn / Revival (officially
        // ally-reaching, unlisted), a false-negative shape recorded in GH #30 C1.
        // Throughput-empower CDs stay out as ALTERNATIVES too: `canHelpAnotherUnit` counts
        // Apotheosis as helping an ally (it does, indirectly), but "press Apotheosis
        // instead of Pain Suppression" is not a cheaper substitute for a mitigation cast.
        (!opts.castTargetIsTeammate ||
          (canHelpAnotherUnit(other.spellId, other.tag) &&
            !THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(other.spellId))) &&
        // Self-cast context: exclude damage-redirect externals that do nothing when
        // caster === target (verified mechanic, not a broad External exclusion).
        (!!opts.castTargetIsTeammate ||
          !SELF_CAST_NOOP_EXTERNAL_IDS.has(other.spellId)),
    )
    .map((other) => other.spellName);
}

// Minimal shape of IEnemyCDTimeline needed for timing classification.
// Defined locally to avoid a circular import (enemyCDs.ts already imports from cooldowns.ts).
interface IBurstWindow {
  fromSeconds: number;
  toSeconds: number;
}
interface ISingleEnemyCDCast {
  spellName: string;
  castTimeSeconds: number;
  buffEndSeconds: number;
}
export interface IEnemyCDTimelineForTiming {
  alignedBurstWindows: IBurstWindow[];
  players: Array<{ offensiveCDs: ISingleEnemyCDCast[] }>;
}

/** How many seconds before a burst window a defensive can be cast and still be
 * "Early/pre-wall". Exported (2026-08-11, DEFENSIVE-003): candidateFindings'
 * slow-defensive-response counts a cast inside this same grace span as a
 * (pre-wall) reaction — one fact, one predicate; see docs/predicate-index.md. */
// GH #36 item 1 (measured 2026-08-27, user ruling 2026-08-29: keep 5 / 8 / 3).
// 300 matches / 4,268 healer-owner defensive casts through annotateDefensiveTimings:
// Optimal 56.5 % · Unknown 18.6 % · Late 13.4 % · Early 7.3 % · Reactive 3.9 % · Unnecessary 0.4 %.
// PRE_WALL 5 s — seconds to the next window start (n=1,532): density 0–2 s 80/s ·
//   2–5 s 57/s · 5–8 s 57/s · 8–12 s 45/s; no break at 5 (cutting at 8 adds 55 % Early).
// LATE_WINDOW 8 s — seconds since the previous window end (n=1,748): 0–2 s 95/s ·
//   2–5 s 84/s · 5–8 s 55/s · 8–12 s 53/s; the only edge is at 5 s, 8 sits mid-plateau
//   (5 s would drop Late by 29 %, 12 s add 213). Kept at 8 as a game-semantics call.
// TIMING_DAMAGE_WINDOW 3 s / REACTIVE_RATIO 1.75 — before/after damage ratio for
//   step-3 casts (before > 50 k): ±3 s n=258, p50 2.35, 64 % exceed 1.75; ±2 s 67 %,
//   ±5 s 54 % — mildly window-sensitive. These labels reach the desktop key-moments
//   card and two predicates (death.ts Early gate, healerMetrics), NOT the single-shot
//   prompt (criticalMoments has no consumers; the SPEC BASELINES aggregate line was
//   measured inert, 120 agy calls). Re-run the distribution script before moving any.
export const PRE_WALL_SECONDS = 5;
/** How many seconds after a burst window ends before a defensive is classified "Late" */
const LATE_WINDOW_SECONDS = 8;
/** Damage curve window for fallback classification */
const TIMING_DAMAGE_WINDOW_S = 3;
/** Ratio threshold: if damage before cast is this much higher than after, classify as Reactive */
const REACTIVE_RATIO = 1.75;

/**
 * How much damage inside a single damage window (TIMING_DAMAGE_WINDOW_S seconds)
 * counts as "under pressure". Two checks share this one number: the Reactive
 * check uses it to ask "was the target already eating a spike before the cast?"
 * (dmgBefore > threshold); 17a's Unnecessary check is its **negation** — asking
 * "was the target eating no spike either side of the cast?" (both < threshold).
 * A gate predicate IS the spec: a magnitude criterion may exist in exactly one
 * place; two sites must never each hardcode their own 50_000.
 */
export const TIMING_SPIKE_THRESHOLD = 50_000;

/**
 * Sum of `Math.abs(effectiveAmount)` for damage-taken events whose timestamp falls in
 * [fromMs, toMs). Shared window-sum arithmetic for both the Reactive spike check (caster's
 * damageIn) and the Unnecessary no-pressure check (target's damageIn, or the caster's as a
 * fallback) — same predicate, only the unit and window position differ.
 */
function sumDamageInWindow(
  damageIn: ICombatUnit["damageIn"],
  fromMs: number,
  toMs: number,
): number {
  return damageIn
    .filter((d) => d.logLine.timestamp >= fromMs && d.logLine.timestamp < toMs)
    .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
}

/**
 * Threshold for 17a's sixth tier (Unnecessary): the target counts as "under no
 * pressure" only at HP% ≥ this value.
 *
 * **This number is NOT corpus-derived.** It is a prior chosen when 17a was
 * designed — `docs/BACKLOG.md`'s 17a block says so in as many words: *"is a
 * prior value, pending user testing for tuning"*. The 794-match scan this
 * comment used to cite was an OCCURRENCE measurement that took 80 as one of its
 * **input** filter conditions (`docs/superpowers/plans/2026-07-30-counterfactual.md`,
 * the `targetHpPct >= UNNECESSARY_TARGET_HP_PCT` condition) and reported how
 * often all three negation conditions co-occur — 0.52%, 25/4780 external casts.
 * A scan that counts how many rows satisfy X cannot also be the derivation of X.
 *
 * Corrected 2026-08-17 (docs/coaching-grounding-audit.md §D4): the previous
 * wording claimed *"Derived from corpus evidence … not from guesswork"* and
 * cited a "task-3 report". That report does not exist — the file now sitting at
 * `.superpowers/sdd/task-3-report.md` is an unrelated leftover about dev:ui
 * scene routing. A false provenance is worse than none: it tells the next
 * reader the value is already grounded and stops them from grounding it.
 *
 * To actually ground it, measure the thing the tier claims — of the casts this
 * flags as "Unnecessary", how many were genuinely unforced — and sign the
 * resulting value the way `data/mitigationVerdicts.ts` does. Until then treat
 * it as an unvalidated prior.
 */
export const UNNECESSARY_TARGET_HP_PCT = 80;

/** 防御类 tag 的集合。2026-08-22 起只有一个成员:`External` 这个枚举值被删了
 *  (见 data/spellTypes.ts 的说明——它从无生产者,却让 8 处判据看着像三选一)。
 *  保留集合形态是因为 5 个 import 消费者 + 4 处内联判据共用它这一个定义。 */
export const DEFENSIVE_TAGS = new Set<string>([SpellTag.Defensive]);

/**
 * Annotates each cast on Defensive/External cooldowns with a timing label:
 *   Optimal — cast during an aligned burst window
 *   Early   — cast within PRE_WALL_SECONDS before a burst window (pre-wall, may be intentional)
 *   Late    — cast within LATE_WINDOW_SECONDS after a burst window ended
 *   Reactive — no nearby burst window, but damage curve shows the spike already peaked at cast time
 *   Unnecessary — 17a: EXTERNAL_DEFENSIVE_IDS only. No burst signal, target HP already
 *     ≥UNNECESSARY_TARGET_HP_PCT, and neither the target nor (when unresolvable) the
 *     caster shows a nearby damage spike — the external was thrown with nothing to answer.
 *   Unknown — no burst signal and no clear damage curve pattern
 *
 * Offensive CDs are left unlabelled (timingLabel stays undefined).
 * Mutates the cast objects in-place and returns the same array.
 */
export function annotateDefensiveTimings(
  cooldowns: IMajorCooldownInfo[],
  unit: ICombatUnit,
  combat: AtomicArenaCombat,
  enemyCDTimeline: IEnemyCDTimelineForTiming,
): IMajorCooldownInfo[] {
  const matchStartMs = combat.startTime;

  const allSingleCDs = enemyCDTimeline.players.flatMap((p) => p.offensiveCDs);

  for (const cd of cooldowns) {
    if (!DEFENSIVE_TAGS.has(cd.tag)) continue;

    for (const cast of cd.casts) {
      const t = cast.timeSeconds;

      // ── 1. Aligned burst window ────────────────────────────────────────────
      let bestAligned: { label: DefensiveTimingLabel; context: string } | null =
        null;
      for (const w of enemyCDTimeline.alignedBurstWindows) {
        if (t >= w.fromSeconds && t <= w.toSeconds) {
          bestAligned = {
            label: "Optimal",
            context: `cast during burst window ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)}`,
          };
          break; // Optimal is the highest tier, stop searching
        }
        if (t >= w.fromSeconds - PRE_WALL_SECONDS && t < w.fromSeconds) {
          if (!bestAligned || bestAligned.label === "Late") {
            bestAligned = {
              label: "Early",
              context: `cast ${(w.fromSeconds - t).toFixed(1)}s before burst window at ${fmtTime(w.fromSeconds)} — possible pre-wall`,
            };
          }
        }
        if (t > w.toSeconds && t <= w.toSeconds + LATE_WINDOW_SECONDS) {
          if (!bestAligned) {
            bestAligned = {
              label: "Late",
              context: `cast ${(t - w.toSeconds).toFixed(1)}s after burst window ended at ${fmtTime(w.toSeconds)}`,
            };
          }
        }
      }

      if (bestAligned) {
        cast.timingLabel = bestAligned.label;
        cast.timingContext = bestAligned.context;
        continue;
      }

      // ── 2. Single-enemy offensive CD active during cast ────────────────────
      let bestSingle: { label: DefensiveTimingLabel; context: string } | null =
        null;
      for (const ec of allSingleCDs) {
        if (t >= ec.castTimeSeconds && t <= ec.buffEndSeconds) {
          bestSingle = {
            label: "Optimal",
            context: `cast during enemy ${ec.spellName} active ${fmtTime(ec.castTimeSeconds)}–${fmtTime(ec.buffEndSeconds)}`,
          };
          break; // Optimal stops search
        }
        if (
          t >= ec.castTimeSeconds - PRE_WALL_SECONDS &&
          t < ec.castTimeSeconds
        ) {
          if (!bestSingle || bestSingle.label === "Late") {
            bestSingle = {
              label: "Early",
              context: `cast ${(ec.castTimeSeconds - t).toFixed(1)}s before enemy ${ec.spellName} at ${fmtTime(ec.castTimeSeconds)} — possible pre-wall`,
            };
          }
        }
        if (
          t > ec.buffEndSeconds &&
          t <= ec.buffEndSeconds + LATE_WINDOW_SECONDS
        ) {
          if (!bestSingle) {
            bestSingle = {
              label: "Late",
              context: `cast ${(t - ec.buffEndSeconds).toFixed(1)}s after enemy ${ec.spellName} expired at ${fmtTime(ec.buffEndSeconds)}`,
            };
          }
        }
      }

      if (bestSingle) {
        cast.timingLabel = bestSingle.label;
        cast.timingContext = bestSingle.context;
        continue;
      }

      // ── 3. Damage curve fallback ───────────────────────────────────────────
      // NOTE: `unit.damageIn` refers to damage taken by the caster. For External CDs
      // (e.g. Blessing of Sacrifice on an ally), this will check the Paladin's damage,
      // not the friendly target's damage. (Target resolution is tracked in overlaps, not here).
      const castMs = matchStartMs + t * 1000;
      const windowFromMs = castMs - TIMING_DAMAGE_WINDOW_S * 1000;
      const windowToMs = castMs + TIMING_DAMAGE_WINDOW_S * 1000;
      const dmgBefore = sumDamageInWindow(unit.damageIn, windowFromMs, castMs);
      const dmgAfter = sumDamageInWindow(unit.damageIn, castMs, windowToMs);

      if (
        dmgBefore > TIMING_SPIKE_THRESHOLD &&
        dmgAfter > 0 &&
        dmgBefore > dmgAfter * REACTIVE_RATIO
      ) {
        cast.timingLabel = "Reactive";
        cast.timingContext = `damage spike appeared to peak before cast (${Math.round(dmgBefore / 1000)}k in 3s before vs ${Math.round(dmgAfter / 1000)}k after)`;
      } else if (
        EXTERNAL_DEFENSIVE_IDS.has(cd.spellId) &&
        cast.targetHpPct !== undefined &&
        cast.targetHpPct >= UNNECESSARY_TARGET_HP_PCT
      ) {
        // ── 3b. 17a tier six: external thrown in a no-pressure window ─────
        // The no-pressure criterion is the negation of the Reactive spike
        // criterion — same TIMING_SPIKE_THRESHOLD. Reactive asks "was the target
        // already eating a spike before the cast?" (dmgBefore > threshold); here
        // we ask "was there no spike either side of the cast?" (both <
        // threshold). The only difference is whose damageIn we read: it must be
        // the **target's**, not the caster's (dmgBefore/dmgAfter above are from
        // the caster's point of view, which is the wrong unit for an external —
        // the caster taking no damage says nothing about the healed target).
        // Resolve the target by cast.targetName against combat.units; only when
        // the target is unresolvable (renamed / not recorded) fall back to the
        // caster-side reading over the same window, and say so in the context
        // rather than silently passing it off as target data.
        const targetUnit = cast.targetName
          ? Object.values(combat.units).find((u) => u.name === cast.targetName)
          : undefined;
        let spikeBefore = dmgBefore;
        let spikeAfter = dmgAfter;
        let fallbackNote = "";
        if (targetUnit) {
          spikeBefore = sumDamageInWindow(
            targetUnit.damageIn,
            windowFromMs,
            castMs,
          );
          spikeAfter = sumDamageInWindow(
            targetUnit.damageIn,
            castMs,
            windowToMs,
          );
        } else {
          fallbackNote = " (caster-side fallback)";
        }

        if (
          spikeBefore < TIMING_SPIKE_THRESHOLD &&
          spikeAfter < TIMING_SPIKE_THRESHOLD
        ) {
          // Distance to the nearest burst window (regardless of whether it falls
          // inside PRE_WALL/LATE — stage 1 already handled that case). This just
          // reports "how far away the nearest window is", so timingContext and
          // candidateFindings' questionable-external share one number instead of
          // recomputing it.
          const windows = enemyCDTimeline.alignedBurstWindows;
          const gap = windows.length
            ? Math.min(
                ...windows.map((w) =>
                  t < w.fromSeconds
                    ? w.fromSeconds - t
                    : t > w.toSeconds
                      ? t - w.toSeconds
                      : 0,
                ),
              )
            : undefined;
          cast.nearestBurstGapS = gap;
          const gapText =
            gap !== undefined
              ? `nearest burst window ${gap.toFixed(1)}s away`
              : "no burst windows this match";
          cast.timingLabel = "Unnecessary";
          cast.timingContext =
            `no pressure: target ${cast.targetName ?? "unknown"} at ` +
            `${cast.targetHpPct}% HP, no damage spike within ` +
            `±${TIMING_DAMAGE_WINDOW_S}s of cast${fallbackNote}, ${gapText}`;
        } else {
          cast.timingLabel = "Unknown";
          cast.timingContext =
            "no enemy burst window or damage curve signal nearby";
        }
      } else {
        cast.timingLabel = "Unknown";
        cast.timingContext =
          "no enemy burst window or damage curve signal nearby";
      }
    }
  }

  return cooldowns;
}

/** 每个玩家的承伤,按 **10 秒**滑窗聚合(`windowSeconds` 默认 10;此前这行写的是
 *  15 秒,与代码不符 —— 2026-08-23 更正)。
 *  承伤口径走 `incomingPressureEvents` 单源:伤害事件 **+ 被盾吃掉的整发**
 *  (`SPELL_ABSORBED`)。此前只读 `damageIn`,而整发被吸收的伤害根本不产生伤害
 *  事件 —— 实测 600 场新赛季语料漏掉 22.2% 的入伤,且按专精从 0.9%(preg)到
 *  35.4%(奥法)不等,跨专精比较会被系统性歪掉。 */
export interface IDamageBucket {
  fromSeconds: number;
  toSeconds: number;
  totalDamage: number;
  targetName: string;
  targetSpec: string;
}

export function computePressureWindows(
  friendlyPlayers: ICombatUnit[],
  combat: AtomicArenaCombat,
  windowSeconds = 10,
  topN = 5,
): IDamageBucket[] {
  const matchStartMs = combat.startTime;
  const allSpikes: IDamageBucket[] = [];

  for (const player of friendlyPlayers) {
    const damageEvents = incomingPressureEvents(player)
      .map((a) => ({
        timeSec: (a.timestamp - matchStartMs) / 1000,
        amount: a.amount,
      }))
      // 一条 NaN 会顺着下面的增量累加污染这个玩家**之后的每一个窗口**,而
      // `pw.totalDamage >= DMG_SPIKE_THRESHOLD` 对 NaN 恒为 false —— 于是那些窗口
      // 被静默丢弃:不报错、不计数、也不进 criticalWindows 的密采区。
      // 实测(2026-08-23,S2 归档 585 文件 / 1,155 回合):5,697 个窗口里 15 个
      // (0.3%)的 totalDamage 是 NaN。
      .filter((e) => Number.isFinite(e.timeSec) && Number.isFinite(e.amount))
      .sort((a, b) => a.timeSec - b.timeSec);

    // Two-pointer sliding window: O(n) — j only advances, windowDamage is updated incrementally
    let j = 0;
    let windowDamage = 0;
    for (let i = 0; i < damageEvents.length; i++) {
      while (
        j < damageEvents.length &&
        damageEvents[j].timeSec <= damageEvents[i].timeSec + windowSeconds
      ) {
        windowDamage += damageEvents[j].amount;
        j++;
      }
      allSpikes.push({
        fromSeconds: damageEvents[i].timeSec,
        toSeconds: damageEvents[i].timeSec + windowSeconds,
        totalDamage: windowDamage,
        targetName: player.name,
        targetSpec: specToString(player.spec),
      });
      // Remove the event at i as the left edge advances
      windowDamage -= damageEvents[i].amount;
    }
  }

  // Sort and deduplicate: keep only non-overlapping top-N spikes per target
  allSpikes.sort((a, b) => b.totalDamage - a.totalDamage);
  const distinctSpikes: IDamageBucket[] = [];
  for (const spike of allSpikes) {
    const overlaps = distinctSpikes.some(
      (s) =>
        s.targetName === spike.targetName &&
        Math.min(s.toSeconds, spike.toSeconds) -
          Math.max(s.fromSeconds, spike.fromSeconds) >
          0,
    );
    if (!overlaps) {
      distinctSpikes.push(spike);
      if (distinctSpikes.length >= topN) break;
    }
  }

  return distinctSpikes;
}

// ---------------------------------------------------------------------------
// Spec name helpers
// ---------------------------------------------------------------------------

export function specToString(spec: CombatUnitSpec): string {
  const map: Partial<Record<CombatUnitSpec, string>> = {
    [CombatUnitSpec.DeathKnight_Blood]: "Blood Death Knight",
    [CombatUnitSpec.DeathKnight_Frost]: "Frost Death Knight",
    [CombatUnitSpec.DeathKnight_Unholy]: "Unholy Death Knight",
    [CombatUnitSpec.DemonHunter_Havoc]: "Havoc Demon Hunter",
    [CombatUnitSpec.DemonHunter_Vengeance]: "Vengeance Demon Hunter",
    [CombatUnitSpec.DemonHunter_Devourer]: "Devourer Demon Hunter",
    [CombatUnitSpec.Druid_Balance]: "Balance Druid",
    [CombatUnitSpec.Druid_Feral]: "Feral Druid",
    [CombatUnitSpec.Druid_Guardian]: "Guardian Druid",
    [CombatUnitSpec.Druid_Restoration]: "Restoration Druid",
    [CombatUnitSpec.Hunter_BeastMastery]: "Beast Mastery Hunter",
    [CombatUnitSpec.Hunter_Marksmanship]: "Marksmanship Hunter",
    [CombatUnitSpec.Hunter_Survival]: "Survival Hunter",
    [CombatUnitSpec.Mage_Arcane]: "Arcane Mage",
    [CombatUnitSpec.Mage_Fire]: "Fire Mage",
    [CombatUnitSpec.Mage_Frost]: "Frost Mage",
    [CombatUnitSpec.Monk_Brewmaster]: "Brewmaster Monk",
    [CombatUnitSpec.Monk_Windwalker]: "Windwalker Monk",
    [CombatUnitSpec.Monk_Mistweaver]: "Mistweaver Monk",
    [CombatUnitSpec.Paladin_Holy]: "Holy Paladin",
    [CombatUnitSpec.Paladin_Protection]: "Protection Paladin",
    [CombatUnitSpec.Paladin_Retribution]: "Retribution Paladin",
    [CombatUnitSpec.Priest_Discipline]: "Discipline Priest",
    [CombatUnitSpec.Priest_Holy]: "Holy Priest",
    [CombatUnitSpec.Priest_Shadow]: "Shadow Priest",
    [CombatUnitSpec.Rogue_Assassination]: "Assassination Rogue",
    [CombatUnitSpec.Rogue_Outlaw]: "Outlaw Rogue",
    [CombatUnitSpec.Rogue_Subtlety]: "Subtlety Rogue",
    [CombatUnitSpec.Shaman_Elemental]: "Elemental Shaman",
    [CombatUnitSpec.Shaman_Enhancement]: "Enhancement Shaman",
    [CombatUnitSpec.Shaman_Restoration]: "Restoration Shaman",
    [CombatUnitSpec.Warlock_Affliction]: "Affliction Warlock",
    [CombatUnitSpec.Warlock_Demonology]: "Demonology Warlock",
    [CombatUnitSpec.Warlock_Destruction]: "Destruction Warlock",
    [CombatUnitSpec.Warrior_Arms]: "Arms Warrior",
    [CombatUnitSpec.Warrior_Fury]: "Fury Warrior",
    [CombatUnitSpec.Warrior_Protection]: "Protection Warrior",
    [CombatUnitSpec.Evoker_Devastation]: "Devastation Evoker",
    [CombatUnitSpec.Evoker_Preservation]: "Preservation Evoker",
    [CombatUnitSpec.Evoker_Augmentation]: "Augmentation Evoker",
  };
  return map[spec] ?? "Unknown";
}

const HEALER_SPECS = new Set([
  CombatUnitSpec.Druid_Restoration,
  CombatUnitSpec.Monk_Mistweaver,
  CombatUnitSpec.Paladin_Holy,
  CombatUnitSpec.Priest_Discipline,
  CombatUnitSpec.Priest_Holy,
  CombatUnitSpec.Shaman_Restoration,
  CombatUnitSpec.Evoker_Preservation,
]);

export function isHealerSpec(spec: CombatUnitSpec): boolean {
  return HEALER_SPECS.has(spec);
}

// All specs that fight primarily at melee range, including tanks (rare in arena but present).
// Used for enemy comp classification — anything not in this set and not a healer = ranged/caster.
const MELEE_SPECS = new Set([
  CombatUnitSpec.DeathKnight_Blood,
  CombatUnitSpec.DeathKnight_Frost,
  CombatUnitSpec.DeathKnight_Unholy,
  CombatUnitSpec.DemonHunter_Havoc,
  CombatUnitSpec.DemonHunter_Vengeance,
  CombatUnitSpec.Druid_Feral,
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Hunter_BeastMastery,
  CombatUnitSpec.Hunter_Survival,
  CombatUnitSpec.Monk_Brewmaster,
  CombatUnitSpec.Monk_Windwalker,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.Paladin_Retribution,
  CombatUnitSpec.Rogue_Assassination,
  CombatUnitSpec.Rogue_Outlaw,
  CombatUnitSpec.Rogue_Subtlety,
  CombatUnitSpec.Shaman_Enhancement,
  CombatUnitSpec.Warrior_Arms,
  CombatUnitSpec.Warrior_Fury,
  CombatUnitSpec.Warrior_Protection,
]);

export function isMeleeSpec(spec: CombatUnitSpec): boolean {
  return MELEE_SPECS.has(spec);
}

/**
 * Returns the key used for this spec in benchmarks.json (e.g. "DeathKnight Frost").
 */
export function specToBenchmarkKey(spec: CombatUnitSpec): string {
  const key = Object.keys(CombatUnitSpec).find(
    (k) => CombatUnitSpec[k as keyof typeof CombatUnitSpec] === spec,
  );
  return key?.replace("_", " ") ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Panic trading / major defensive overlap detection
// ---------------------------------------------------------------------------

/** Minimum seconds two defensive buffs must coexist on the same target to count as a true overlap */
const MIN_SIMULTANEOUS_SECONDS = 2;
/**
 * Assumed minimum duration (seconds) for any major defensive. Used as a proxy for overlap
 * detection when aura events can't be matched reliably (spell cast ID ≠ aura buff ID in WoW logs).
 * Most majors last 8–12s; 8s is conservative enough to avoid false positives.
 */
const OVERLAP_ASSUME_DURATION_S = 8;

export interface IOverlappedDefensive {
  /** Timestamp of the first cast */
  timeSeconds: number;
  /** Timestamp of the second cast */
  secondCastTimeSeconds: number;
  targetUnitId: string;
  targetName: string;
  firstCasterSpec: string;
  firstCasterName: string;
  firstSpellName: string;
  firstSpellId: string;
  secondCasterSpec: string;
  secondCasterName: string;
  secondSpellName: string;
  secondSpellId: string;
  /** How long both buffs were simultaneously active on the target */
  simultaneousSeconds: number;
}

/**
 * Detects when two different friendly players cast major defensives (from
 * `BIG_DEFENSIVE_IDS` | `EXTERNAL_DEFENSIVE_IDS`) whose actual buff durations
 * overlapped on the same target for >= MIN_SIMULTANEOUS_SECONDS.
 * Same-player double-casts are ignored.
 */
export function detectOverlappedDefensives(
  friends: ICombatUnit[],
  combat: { startTime: number },
): IOverlappedDefensive[] {
  const friendlyIds = new Set(friends.map((u) => u.id));
  const unitMap = new Map(friends.map((u) => [u.id, u]));

  const casts: Array<{
    timeSeconds: number;
    castMs: number;
    casterUnitId: string;
    casterName: string;
    casterSpec: string;
    spellId: string;
    spellName: string;
    targetUnitId: string;
    targetName: string;
  }> = [];

  for (const unit of friends) {
    // SPELL_CAST_SUCCESS events are in spellCastEvents, not actionOut
    for (const action of unit.spellCastEvents) {
      if (action.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const spellId = action.spellId;
      if (!spellId || !ALL_MAJOR_DEFENSIVE_IDS.has(spellId)) continue;

      let targetId = action.destUnitId;
      let targetName = action.destUnitName;
      if (!targetId || targetId === "0000000000000000") {
        targetId = unit.id;
        targetName = unit.name;
      }

      if (!friendlyIds.has(targetId)) continue;

      casts.push({
        timeSeconds: (action.timestamp - combat.startTime) / 1000,
        castMs: action.timestamp,
        casterUnitId: unit.id,
        casterName: unit.name,
        casterSpec: specToString(unit.spec),
        spellId,
        spellName: getEnglishSpellName(spellId, action.spellName),
        targetUnitId: targetId,
        targetName: targetName,
      });
    }
  }

  casts.sort((a, b) => a.timeSeconds - b.timeSeconds);

  const overlaps: IOverlappedDefensive[] = [];

  for (let i = 0; i < casts.length; i++) {
    const first = casts[i];
    const targetUnit = unitMap.get(first.targetUnitId);
    if (!targetUnit) continue;

    for (let j = i + 1; j < casts.length; j++) {
      const second = casts[j];
      const gapSeconds = second.timeSeconds - first.timeSeconds;
      const firstDuration =
        spellEffectData[first.spellId]?.durationSeconds ||
        OVERLAP_ASSUME_DURATION_S;
      const maxGap = firstDuration - MIN_SIMULTANEOUS_SECONDS;
      if (gapSeconds > maxGap) break;
      if (first.targetUnitId !== second.targetUnitId) continue;
      if (first.casterUnitId === second.casterUnitId) continue;

      const simultaneousSeconds = firstDuration - gapSeconds;

      overlaps.push({
        timeSeconds: first.timeSeconds,
        secondCastTimeSeconds: second.timeSeconds,
        targetUnitId: first.targetUnitId,
        targetName: first.targetName,
        firstCasterSpec: first.casterSpec,
        firstCasterName: first.casterName,
        firstSpellName: first.spellName,
        firstSpellId: first.spellId,
        secondCasterSpec: second.casterSpec,
        secondCasterName: second.casterName,
        secondSpellName: second.spellName,
        secondSpellId: second.spellId,
        simultaneousSeconds,
      });
    }
  }

  return overlaps;
}

export function formatOverlappedDefensivesForContext(
  overlaps: IOverlappedDefensive[],
): string[] {
  if (overlaps.length === 0) return [];
  const lines: string[] = [];
  // Neutral section header: 'PANIC TRADING' is a loaded label (hit by the
  // labelBias anchor during the 2026-07-11 calibration).
  lines.push(
    "DEFENSIVE OVERLAPS (two buffs simultaneously active on the same target):",
  );

  for (const o of overlaps) {
    const sim = o.simultaneousSeconds.toFixed(1);
    lines.push(
      `  ⚠ Major Overlap: [${o.firstCasterSpec}] used ${o.firstSpellName} on ${o.targetName} (at ${fmtTime(o.timeSeconds)}), then [${o.secondCasterSpec}] used ${o.secondSpellName} (at ${fmtTime(o.secondCastTimeSeconds)}) — both active simultaneously for ${sim}s.`,
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Panic press detection (defensive cast with no enemy offensive threat active)
// ---------------------------------------------------------------------------

/** Fraction of the target's max HP that constitutes meaningful pressure in a window */
const PANIC_PRESS_PRESSURE_PCT = 0.15;

// Tank specs — relevant for role-based pressure threshold fallback.
// Tanks have substantially higher HP pools than DPS/healers.
const TANK_SPECS = new Set([
  CombatUnitSpec.DeathKnight_Blood,
  CombatUnitSpec.DemonHunter_Vengeance,
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Monk_Brewmaster,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.Warrior_Protection,
]);

// Role-based damage thresholds used when advancedActions data is absent (no advanced logging).
// ⚠️  PATCH-VOLATILE: These values are calibrated from benchmark data collected via
//     packages/tools/src/collectBenchmarks.ts against 2400+ MMR 3v3 matches.
//     Blizzard tuning (ilvl increases, class buffs, HP pool changes) can shift these
//     significantly between patches. Re-run collectBenchmarks after each major patch.
//
// Methodology: pressure window = 3s pre + 4s post cast = 7s total.
//   Threshold = ~P75–P85 of the 7s damage-taken distribution at 2400+ MMR.
//   A window below threshold with no enemy offensive CD → flagged as panic.
//
// Last calibrated: 2026-07-03 (past-week corpus 2026-06-28→07-03, 5160 matches, 3v3 + Rated Solo
// Shuffle, per-spec floors 2700/2400 — see benchmark_data.json meta). Positioning rule (same as the
// 2026-04-08 calibration): healer threshold ≈ 0.86 × the LOWEST-pressure healer spec's 7s-scaled P90
// (10s-window P90 × 0.7), so the most chip-resistant spec's genuinely pressured presses are never
// flagged panic. Benchmark source: packages/analysis/benchmarks/benchmark_data.json
//
//   Healer: lowest 7s-P90 is Discipline 84k (10s P90 120k, n=204@2700) → 0.86 × 84k ≈ 70k.
//           Damage inflation vs April roughly doubled healer pressure (HPriest P90 58k→129k/10s).
//   DPS:    distributions moved only ~+9% (p75 210k→228k); 60k stays below every real DPS spec's
//           7s-P50 (min: Havoc 73k; Augmentation 41k excluded — support spec, 2400-floor sample).
//   Tank:   first real sample (Prot Paladin n=54@2400): 7s-scaled P50 116k / P75 281k → 200k
//           (between P50 and P75; replaces the old HP-pool guess of 135k).
//
// Two empirical facts from the 2026-07-03 recalibration audit (packages/tools/src/auditPanic.ts,
// 1151 games / 5210 healer defensive casts):
//   1. The threshold is applied to the 3s-pre and 4s-post windows SEPARATELY (see detectPanicDefensives),
//      not to the 7s sum — so it means "significant pressure within either sub-window".
//   2. Within [35k, 70k] the healer threshold is empirically INERT on the corpus: flag sets are
//      identical (29 flags, 0.6% of casts) because the enemy-offensive-CD gates (#1/#2) already
//      exclude nearly every mid-pressure press. The threshold only guards the tails; precision of
//      panic detection comes from the CD gates, not this constant.
const PANIC_PRESS_DAMAGE_THRESHOLD_TANK = 200_000;
const PANIC_PRESS_DAMAGE_THRESHOLD_DPS = 60_000;
const PANIC_PRESS_DAMAGE_THRESHOLD_HEALER = 70_000; // was 35k (Apr-2026); re-anchored to Disc 7s-P90 84k
const PANIC_PRESS_PRE_CAST_WINDOW_MS = 3_000;
const PANIC_PRESS_POST_CAST_WINDOW_MS = 4_000;
/** If an enemy offensive CD starts within this window after the cast, it was a valid pre-wall */
const ENEMY_BURST_POST_CAST_WINDOW_MS = 2_000;

export interface IPanicDefensive {
  timeSeconds: number;
  casterSpec: string;
  casterName: string;
  spellName: string;
  spellId: string;
  targetName: string;
  targetSpec: string;
}

/**
 * Returns true if the given unit has an Offensive-tagged spell active at `timestampMs`,
 * optionally filtered to only auras sourced from `requiredSourceIds`.
 * - Pass `null` for `requiredSourceIds` to allow any source (used for enemy self-buffs).
 * - Pass the `enemyIds` set to restrict to enemy-sourced auras (used for debuffs on friendlies).
 *
 * Exported (was panic-press-private) for `threatAssessment.ts`'s `threatActiveAt`
 * — real aura-interval evidence off the same OFFENSIVE_SPELL_IDS table, not a
 * second cast+duration estimate (predicate-index.md: "Threat / pressure").
 */
export function hasOffensiveSpellActive(
  unit: ICombatUnit,
  timestampMs: number,
  requiredSourceIds: Set<string> | null,
): boolean {
  const applied = new Map<string, number[]>();
  const removed = new Map<string, number[]>();

  for (const aura of unit.auraEvents) {
    const spellId = aura.spellId;
    if (!spellId || !OFFENSIVE_SPELL_IDS.has(spellId)) continue;
    if (requiredSourceIds !== null && !requiredSourceIds.has(aura.srcUnitId))
      continue;

    if (aura.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      const b = applied.get(spellId) ?? [];
      applied.set(spellId, [...b, aura.timestamp]);
    } else if (
      aura.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
      aura.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
    ) {
      const b = removed.get(spellId) ?? [];
      removed.set(spellId, [...b, aura.timestamp]);
    }
  }

  for (const [spellId, applications] of Array.from(applied)) {
    const removals = removed.get(spellId) ?? [];
    for (const applyTs of applications) {
      if (applyTs > timestampMs) continue;
      const removeTs = removals.find((r) => r > applyTs);
      if (removeTs === undefined || removeTs > timestampMs) return true;
    }
  }
  return false;
}

/**
 * Derive the pressure threshold for a unit from its recorded max HP (15% of max HP).
 * When no advanced HP data is available, falls back to a role-based estimate derived
 * from typical arena HP pools at Gladiator ilvl rather than a flat value.
 */
export function getPressureThreshold(unit: ICombatUnit): number {
  if (unit.advancedActions.length > 0) {
    const maxHp = Math.max(
      ...unit.advancedActions.map((a) => a.advancedActorMaxHp),
    );
    if (maxHp > 0) return maxHp * PANIC_PRESS_PRESSURE_PCT;
  }
  // Role-based fallback: tanks absorb far more damage than the flat 250k implied
  if (TANK_SPECS.has(unit.spec)) return PANIC_PRESS_DAMAGE_THRESHOLD_TANK;
  if (HEALER_SPECS.has(unit.spec)) return PANIC_PRESS_DAMAGE_THRESHOLD_HEALER;
  return PANIC_PRESS_DAMAGE_THRESHOLD_DPS;
}

/**
 * Returns true if an enemy offensive CD was activated within `windowMs` AFTER `castMs`.
 * Checks both enemy self-buffs (e.g. Combustion applied to the enemy) and offensive
 * debuffs applied to the target (e.g. Deathmark placed on the friendly target).
 * A match here means the defensive was a valid pre-wall, not a panic press.
 */
function offensiveThreatStartedAfter(
  target: ICombatUnit,
  enemies: ICombatUnit[],
  enemyIds: Set<string>,
  castMs: number,
  windowMs: number,
): boolean {
  const windowEnd = castMs + windowMs;

  for (const enemy of enemies) {
    for (const aura of enemy.auraEvents) {
      if (aura.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
      if (!aura.spellId || !OFFENSIVE_SPELL_IDS.has(aura.spellId)) continue;
      if (aura.timestamp > castMs && aura.timestamp <= windowEnd) return true;
    }
  }

  for (const aura of target.auraEvents) {
    if (aura.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
    if (!aura.spellId || !OFFENSIVE_SPELL_IDS.has(aura.spellId)) continue;
    if (!enemyIds.has(aura.srcUnitId)) continue;
    if (aura.timestamp > castMs && aura.timestamp <= windowEnd) return true;
  }

  return false;
}

/**
 * Detects major defensive casts where there is no sign of active enemy threat:
 * 1. No enemy has an Offensive-tagged self-buff active (e.g. Combustion, Recklessness)
 * 2. The defensive target has no Offensive-tagged debuff from an enemy (e.g. Deathmark, Colossus Smash)
 * 3. The target took < threshold damage in the 3 seconds immediately before the cast
 * 4. The target took < threshold damage in the 4 seconds immediately after the cast (pre-wall check)
 * 5. No enemy offensive CD was activated within 2 seconds after the cast (pre-wall check)
 *
 * All conditions must be true to flag a panic press.
 */
export function detectPanicDefensives(
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: { startTime: number },
): IPanicDefensive[] {
  const friendlyIds = new Set(friends.map((u) => u.id));
  const enemyIds = new Set(enemies.map((u) => u.id));
  const unitMap = new Map(friends.map((u) => [u.id, u]));
  const results: IPanicDefensive[] = [];

  for (const unit of friends) {
    // SPELL_CAST_SUCCESS events are in spellCastEvents, not actionOut
    for (const action of unit.spellCastEvents) {
      if (action.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const spellId = action.spellId;
      if (!spellId || !MAJOR_DEFENSIVE_IDS.has(spellId)) continue;
      if (!friendlyIds.has(action.destUnitId)) continue;

      const castMs = action.timestamp;
      const castTimeSeconds = (castMs - combat.startTime) / 1000;
      const targetUnit = unitMap.get(action.destUnitId);

      // 1. Enemy self-buffs: Combustion, Recklessness, etc.
      if (enemies.some((e) => hasOffensiveSpellActive(e, castMs, null)))
        continue;

      // 2. Offensive debuffs on the target from enemies: Deathmark, Colossus Smash, etc.
      if (targetUnit && hasOffensiveSpellActive(targetUnit, castMs, enemyIds))
        continue;

      // 3. Local pressure: raw damage to target in the 3s before this cast
      const pressureThreshold = targetUnit
        ? getPressureThreshold(targetUnit)
        : PANIC_PRESS_DAMAGE_THRESHOLD_DPS;
      const preCastDamage = (targetUnit?.damageIn ?? [])
        .filter(
          (d) =>
            d.logLine.timestamp >= castMs - PANIC_PRESS_PRE_CAST_WINDOW_MS &&
            d.logLine.timestamp < castMs,
        )
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
      if (preCastDamage >= pressureThreshold) continue;

      // 3. Post-cast pressure: if the target took significant damage in the 4s after, it was a pre-wall
      const postCastDamage = (targetUnit?.damageIn ?? [])
        .filter(
          (d) =>
            d.logLine.timestamp > castMs &&
            d.logLine.timestamp <= castMs + PANIC_PRESS_POST_CAST_WINDOW_MS,
        )
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
      if (postCastDamage >= pressureThreshold) continue;

      // 4. Enemy burst started within 2s after the cast — valid pre-wall, not a panic
      if (
        targetUnit &&
        offensiveThreatStartedAfter(
          targetUnit,
          enemies,
          enemyIds,
          castMs,
          ENEMY_BURST_POST_CAST_WINDOW_MS,
        )
      )
        continue;

      results.push({
        timeSeconds: castTimeSeconds,
        casterSpec: specToString(unit.spec),
        casterName: unit.name,
        spellName: getEnglishSpellName(spellId, action.spellName),
        spellId,
        targetName: action.destUnitName,
        targetSpec: targetUnit ? specToString(targetUnit.spec) : "Unknown",
      });
    }
  }

  results.sort((a, b) => a.timeSeconds - b.timeSeconds);
  return results;
}

export function formatPanicDefensivesForContext(
  panics: IPanicDefensive[],
): string[] {
  if (panics.length === 0) return [];
  const lines: string[] = [];
  lines.push(
    "QUESTIONABLE CD TIMING (major defensive used with no enemy offensive threat and target not under pressure):",
  );

  for (const p of panics) {
    lines.push(
      `  ⚠ Panic Press at ${fmtTime(p.timeSeconds)}: [${p.casterSpec}] used ${p.spellName} on ${p.targetName} [${p.targetSpec}] — no enemy offensive CDs or debuffs active, <250k incoming damage in prior 3s.`,
    );
  }

  return lines;
}
