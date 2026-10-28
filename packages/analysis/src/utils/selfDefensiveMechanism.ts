/**
 * What a unit's own non-wall defensive DOES — the label its `[ENEMY DEF]`
 * line prints (user ruling 2026-10-11: "each spell's label says what the
 * spell does — an absorb, a self-heal, a damage reduction, a freedom /
 * movement effect, a spell reflect, an avoidance — never a purpose").
 *
 * The family is `enemyDefensives.SELF_SAVE_IDS`: the presses that used to
 * print `(self-save)`. That word states why the button was pressed, and the
 * log does not show it — on the 605-file capture (`cap605-n9`, 3,520
 * contexts) the unit stood at ≥ 95 % HP at the press on 160 of 292 Spirit
 * Walk lines, 260 of 729 Master's Call, 287 of 862 Nether Ward, 313 of 1,022
 * Alter Time, 424 of 1,543 Dark Pact.
 *
 * ONE function, official data first — in this order, the first that applies:
 *
 * | kind | source | label |
 * |---|---|---|
 * | `reduction` | `talentMitigationGenerated.json`, when the reduction sits on the cast's own aura (no member is a `MITIGATION_TABLE` row — a wall renders from its aura, with the caster's talents). One member: Roar of Sacrifice, evidence at `ownAuraReductionPct` | `(N%, Ts)` — the wall line's form, with its own legend entry (`selfReductionLegend`) |
 * | `absorb` | `abilityProfile.absorbs` (DB2 aura 69) | `(absorb Nk, Ts)` — Feign Death's form |
 * | `heal` | `abilityProfile.healsSelf` / `healsOthers` (DB2 Effect 10 / 136, aura 8 / 20); `+ heal absorb` from `HEAL_ABSORB_SELF_SAVE_IDS` | `(heal)` |
 * | `healing received` | `abilityProfile.healingReceivedPct` (DB2 aura 118 / 259) | `(+N% healing received)` |
 * | `mechanic immunity` | `immunityMechanics` (DB2 aura 77) of the cast or of an aura the log shows it applying (`effectAurasOfCast`) | `(root / snare immunity)` |
 * | `control removal` | the same, for a press in `MECHANIC_IMMUNITY_REMOVAL_ONLY_IDS` (Master's Call: the corpus does not bear out the immunity; user ruling 2026-10-27) | `(removes roots / snares)` |
 * | `movement speed` | `abilityProfile.moveSpeedPct` (DB2 aura 31) | `(+N% movement speed)` |
 * | `dodge` / `spell reflect` / `rewind` | `ENEMY_SELF_DEFENSIVE_HAND_MECHANISMS` — the three the profile has no dimension for, DB2 rows quoted there | the word |
 * | `redirect` / `area` | `ENEMY_REDIRECT_SAVE_IDS` / `ENEMY_AREA_SAVE_IDS` (signed sets) | the word |
 *
 * A label is the ability's; the figures beside it are the log's and are
 * added by the renderer where the log has them (`enemyDefensiveEvents`: what
 * a shield absorbed and how long the caster's own aura was up). No figure is
 * estimated, and no purpose is stated.
 *
 * The writer (`selfDefensiveLabelWords`) and the gate's reader
 * (`statesSelfDefensiveLabel`, `checkEnemyDefSaveEffect`) live here together.
 */
import { abilityProfile } from "../data/abilityProfile";
import { effectAurasOfCast } from "../data/castEffectAuras";
import {
  ENEMY_AREA_SAVE_IDS,
  ENEMY_REDIRECT_SAVE_IDS,
  ENEMY_SELF_DEFENSIVE_HAND_MECHANISMS,
  type EnemySelfDefensiveHandMechanism,
  MECHANIC_IMMUNITY_REMOVAL_ONLY_IDS,
} from "../data/spellIdLists";
import { immunityMechanics } from "../data/spellSchools";
import talentMitigationGenerated from "../data/talentMitigationGenerated.json";
import { HEAL_ABSORB_SELF_SAVE_IDS } from "./healAbsorbSave";

export type SelfDefensiveMechanism =
  /** an official percentage of damage reduction on the unit that carries it
   * — a press outside `MITIGATION_TABLE`, so no wall for any predicate */
  | { kind: "reduction"; pct: number }
  /** an absorb shield */
  | { kind: "absorb" }
  /** a heal of the caster; `healAbsorb` = it also puts a heal absorb on them */
  | { kind: "heal"; healAbsorb: boolean }
  /** more healing received, by an official percentage */
  | { kind: "healing received"; pct: number }
  /** immunity to the named control mechanics while it is up */
  | { kind: "mechanic immunity"; mechanics: readonly string[] }
  /** the named controls removed at the press, no immunity claimed
   * (`MECHANIC_IMMUNITY_REMOVAL_ONLY_IDS`) */
  | { kind: "control removal"; mechanics: readonly string[] }
  /** more movement speed, by an official percentage */
  | { kind: "movement speed"; pct: number }
  | { kind: EnemySelfDefensiveHandMechanism }
  /** a grip / a damage redirect (rulings A20 + U3) */
  | { kind: "redirect" }
  /** an area save anchored on its cast (ruling A15) */
  | { kind: "area" };

/**
 * DB2 `SpellMechanic` ids a label can name (aura 77's `MiscValue_0`). A
 * mechanic outside this map is not named — Lichborne's 23 (turned, an
 * NPC-only state), Spirit Walk's 13 — so a label lists only what it can say.
 */
const MECHANIC_NAMES: Readonly<Record<number, string>> = {
  1: "charm",
  5: "fear",
  7: "root",
  10: "sleep",
  11: "snare",
  12: "stun",
};

/**
 * The official percentage a cast's OWN aura takes off its carrier's damage:
 * the generated tooltip table's row for the cast, when the reduction sits on
 * the cast id itself (`auraSpellId`). A row that points at another aura (a
 * talent's, a proc's) is not the press's.
 *
 * One `SELF_SAVE_IDS` member has such a row — Roar of Sacrifice 53480 — and
 * its label prints the number on the Game-Behaviour Rule's three legs (user
 * 2026-10-11: print it if a corpus split supports it; `(redirect)` had
 * replaced an unevidenced `(25%, Ts)` the same day):
 *  (a) DB2 12.1.5.69594, SpellEffect 46148 of 53480: aura 87
 *      (MOD_DAMAGE_PERCENT_TAKEN), −15 × PvpMultiplier 1.66666 = −25;
 *  (b) it is the cast's own aura on its target, MiscValue 127 — every
 *      school, no class mask or label in between — and the log shows aura
 *      53480 on the carrier (354 applications for 350 casts);
 *  (c) corpus split, 605 new-season files (fix-FT/scripts/roar_split.ts →
 *      roar-split-605.txt; 124 files with the spell, 233 observed auras on
 *      the hunter itself): non-crit hits on the carrier, (amount + absorbed +
 *      blocked) / baseAmount, with no `MITIGATION_TABLE` wall or other
 *      listed defensive up. Same attacker and spell, last hit before against
 *      first hit after the aura's edge: APPLIED 717 pairs, median 0.750, IQR
 *      0.748–0.781; REMOVED 596 pairs, median 0.750, IQR 0.745–0.751; the 16
 *      pairs with no other buff edge between the two hits 0.750–0.751 (p10–
 *      p90). Same attacker and spell over the round: 1,112 groups, median
 *      0.750, IQR 0.735–0.788. Against the carrier's own median with nothing
 *      up: 6,741 hits, median 0.750 (physical 0.750, magic 0.750), IQR
 *      0.713–0.804; one median per carrier-round, 135: 0.750, IQR 0.728–0.766.
 *      On an ally (115 auras): edge pairs 418 / 389, median 0.750 / 0.750;
 *      groups 628, median 0.751; hits 3,896, median 0.763. The same three
 *      estimates return the table's walls in the same files (Ironbark 0.800,
 *      Defensive Stance 0.850, Astral Shift 0.600, Dispersion 0.250) and 1.000
 *      for the two rows known not to reduce (Greater Invisibility's FLAG,
 *      Time Dilation's deferral);
 *  (d) 1 − 0.25 = 0.750; tolerance ±0.02 on a median (the PvE 15 % would
 *      read 0.850, a 20 % / 30 % wall 0.800 / 0.700) — every median above is
 *      inside it, the widest the ally hit pool's 0.763.
 * Found beside it, not printed: crits on the carrier do not stop (direct
 * hits 14.3 % crit with the aura up, 13.9 % with it down, same carrier-
 * rounds), and the pet half is spell 67481 — a SPELL_DAMAGE on the hunter's
 * pet, logged with the CARRIER as its source, equal (±1) to half of a hit the
 * carrier just took on 6,824 of 7,154 rows (DB2 row 46149, dummy 50); 57 of
 * the 233 auras have no such row.
 * It stays a signed redirect (`ENEMY_REDIRECT_SAVE_IDS`, rulings A20 + U3)
 * and enters no table that prices or gates on mitigation.
 */
function ownAuraReductionPct(spellId: string): number | undefined {
  const row = (
    talentMitigationGenerated as {
      entries: Record<string, { pct: number; auraSpellId: string }>;
    }
  ).entries[spellId];
  return row && row.auraSpellId === spellId && row.pct > 0
    ? row.pct
    : undefined;
}

/** What `spellId` does, for a unit that pressed it on itself — or undefined
 * when no source classifies it (`test/selfDefensiveMechanism.test.ts` fails
 * for a live `SELF_SAVE_IDS` member without one). */
export function selfDefensiveMechanism(
  spellId: string,
): SelfDefensiveMechanism | undefined {
  const pct = ownAuraReductionPct(spellId);
  if (pct !== undefined) return { kind: "reduction", pct };
  const profile = abilityProfile(spellId);
  if (profile.absorbs) return { kind: "absorb" };
  if (profile.healsSelf || profile.healsOthers)
    return { kind: "heal", healAbsorb: HEAL_ABSORB_SELF_SAVE_IDS.has(spellId) };
  if (profile.healingReceivedPct !== undefined)
    return { kind: "healing received", pct: profile.healingReceivedPct };
  // the cast's own aura, or the aura the log shows the cast applying
  // (Master's Call 272682 → 54216 / 62305, 1241871 → 1224810)
  const mechanics = [
    ...new Set(
      [spellId, ...effectAurasOfCast(spellId)].flatMap(
        (id) => immunityMechanics(id) ?? [],
      ),
    ),
  ]
    .sort((a, b) => a - b)
    .flatMap((m) => MECHANIC_NAMES[m] ?? []);
  if (mechanics.length > 0)
    return MECHANIC_IMMUNITY_REMOVAL_ONLY_IDS.has(spellId)
      ? { kind: "control removal", mechanics }
      : { kind: "mechanic immunity", mechanics };
  if (profile.moveSpeedPct !== undefined)
    return { kind: "movement speed", pct: profile.moveSpeedPct };
  const hand = ENEMY_SELF_DEFENSIVE_HAND_MECHANISMS[spellId];
  if (hand) return { kind: hand };
  if (ENEMY_REDIRECT_SAVE_IDS.has(spellId)) return { kind: "redirect" };
  if (ENEMY_AREA_SAVE_IDS.has(spellId)) return { kind: "area" };
  return undefined;
}

/**
 * The words a mechanism's label opens with — the whole label for every kind
 * but two: an `absorb` goes on to what the shield absorbed and how long it
 * was up (`enemySaveEffectNote`), a `reduction` to how long its aura was.
 */
export function selfDefensiveLabelWords(m: SelfDefensiveMechanism): string {
  switch (m.kind) {
    case "reduction":
      return `${m.pct}%`;
    case "heal":
      return m.healAbsorb ? "heal + heal absorb" : "heal";
    case "healing received":
      return `+${m.pct}% healing received`;
    case "mechanic immunity":
      return `${m.mechanics.join(" / ")} immunity`;
    case "control removal":
      return `removes ${m.mechanics.map((x) => `${x}s`).join(" / ")}`;
    case "movement speed":
      return `+${m.pct}% movement speed`;
    default:
      return m.kind;
  }
}

/** The kinds whose label carries figures from the log after its words. */
function carriesFigures(m: SelfDefensiveMechanism): boolean {
  return m.kind === "absorb" || m.kind === "reduction";
}

/**
 * Does a rendered `[ENEMY DEF]` parenthesis — the text that follows the
 * ability's name, from its `(` — state this mechanism? The gate's reader of
 * what the renderer wrote with `selfDefensiveLabelWords`: the words, then
 * the parenthesis closes — or, for an absorb / a reduction, the log's
 * figures follow (` 64k`, `, 2.0s …`).
 */
export function statesSelfDefensiveLabel(
  parenthesis: string,
  m: SelfDefensiveMechanism,
): boolean {
  const open = `(${selfDefensiveLabelWords(m)}`;
  if (!parenthesis.startsWith(open)) return false;
  const rest = parenthesis.slice(open.length);
  if (rest.startsWith(")")) return true;
  if (!carriesFigures(m)) return false;
  return m.kind === "absorb"
    ? /^(?: (?:\d+|<1)k)?(?:, |\))/.test(rest)
    : rest.startsWith(", ");
}

/** The label a line must NOT carry any more: a purpose, not a mechanism. */
export const SELF_SAVE_PURPOSE_LABEL = "(self-save)";

/**
 * The legend entry for a pressed self defensive whose label is a percentage
 * (`reduction`) — by the name its line prints. The line has a wall's form,
 * `X (N%, Ts)`, and the general legend reads that form as a wall's; this
 * entry says what differs, and nothing else in the prompt changes with it:
 * the press is in no mitigation table, so `defenseless` spans, PRIME and the
 * kill-attempt order treat it as before — KILL ATTEMPTS still names it in the
 * slot of the target's own other defensives (`attributeFailure`: after a
 * wall and an external), which is the one place a reader would otherwise
 * take `popped X` + a percentage for "a wall".
 * Worded for the one member that has it, Roar of Sacrifice (the pet half is
 * the log's spell 67481, see `ownAuraReductionPct`); the family's labels are
 * pinned by id in `test/selfDefensiveMechanism.test.ts`, so a second member
 * cannot take this sentence unseen.
 */
export function selfReductionLegend(spellName: string): string {
  return `\`${spellName} (N%, Ts)\` = NOT one of the walls — a damage redirect the unit pressed on itself: it takes N% less damage while the aura is up (official figure, OBSERVED duration) and its pet, when one is out, is damaged in turn. KILL ATTEMPTS names it among the target's own other defensives, after a wall and an external;`;
}

/** Does this `[ENEMY DEF]` line print `spellName` as a unit's own press with
 * a percentage label — `…: Roar of Sacrifice (25%…`, never the external form
 * `Roar of Sacrifice → unit`? */
export function carriesSelfReductionLabel(
  enemyDefLine: string,
  spellName: string,
): boolean {
  const at = enemyDefLine.indexOf(`: ${spellName} (`);
  return (
    at >= 0 && /^\d+%[,)]/.test(enemyDefLine.slice(at + spellName.length + 4))
  );
}

/**
 * What the `[ENEMY DEF]` legend says of each label this module writes — one
 * entry per label form, emitted only when a line carries it. `(absorb …)`
 * and `(area)` are the legend's own existing lines; a percentage on a
 * pressed self defensive has `selfReductionLegend`. The legend
 * states the mechanism the label names, nothing about when to press it.
 */
const LABEL_LEGENDS: ReadonlyArray<{ carried: RegExp; legend: string }> = [
  {
    carried: / \(heal\)/,
    legend:
      "`(heal)` = it heals the unit that pressed it, at once or over a few seconds — no damage is reduced;",
  },
  {
    carried: / \(heal \+ heal absorb\)/,
    legend:
      "`(heal + heal absorb)` = a heal, then a debuff that swallows the next healing aimed at the unit;",
  },
  {
    carried: / \(\+\d+% healing received\)/,
    legend:
      "`(+N% healing received)` = the unit takes that much more healing while it is up (Guardian Spirit also refuses one killing blow — `| save triggered` says when it did);",
  },
  {
    carried: / \([a-z]+(?: \/ [a-z]+)* immunity\)/,
    legend:
      "`(charm / fear / sleep immunity)` (or another list of controls) = the unit cannot be put under those controls while it is up, and one already on it is removed — no damage is reduced;",
  },
  {
    carried: / \(removes [a-z]+s(?: \/ [a-z]+s)*\)/,
    legend:
      "`(removes roots / snares)` = those controls already on the unit are removed at the press; it does not say the unit stayed free of new ones afterwards — no damage is reduced;",
  },
  {
    carried: / \(\+\d+% movement speed\)/,
    legend: "`(+N% movement speed)` = the unit only moves faster;",
  },
  {
    carried: / \(dodge\)/,
    legend:
      "`(dodge)` = a dodge-chance buff: attacks that can be dodged are dodged while it is up — no other damage is reduced;",
  },
  {
    carried: / \(spell reflect\)/,
    legend:
      "`(spell reflect)` = harmful spells cast at the unit are reflected while it is up;",
  },
  {
    carried: / \(rewind\)/,
    legend:
      "`(rewind)` = pressed again, or when it runs out, the unit goes back to where it stood at this press and returns to the health it had then (up or down);",
  },
  {
    carried: / \(redirect\)/,
    legend: "`(redirect)` = a grip or a damage redirect;",
  },
];

/** The legend entries for the labels these `[ENEMY DEF]` lines carry, in the
 * table's order; empty when none does. `reductionNames` = the printed names
 * of the pressed self defensives whose label is a percentage
 * (`enemyDefensives.selfSaveReductionNames`); each one a line carries gets
 * its `selfReductionLegend`, ahead of the table's entries. */
export function selfDefensiveLabelLegends(
  enemyDefLines: readonly string[],
  reductionNames: readonly string[] = [],
): string[] {
  return [
    ...reductionNames
      .filter((name) =>
        enemyDefLines.some((l) => carriesSelfReductionLabel(l, name)),
      )
      .map(selfReductionLegend),
    ...LABEL_LEGENDS.filter(({ carried }) =>
      enemyDefLines.some((l) => carried.test(l)),
    ).map(({ legend }) => legend),
  ];
}
