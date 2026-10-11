/**
 * What a unit's own non-wall defensive DOES — the label its `[ENEMY DEF]`
 * line prints (user ruling 2026-10-11: "each spell's label says what the
 * spell does — an absorb, a self-heal, a damage reduction, a freedom /
 * movement effect, a spell reflect, an avoidance — never a purpose").
 *
 * No member prints a percentage: a percentage wall is a `MITIGATION_TABLE`
 * row and renders from its aura, and the one member with an official
 * reduction on its own aura — Roar of Sacrifice 53480, DB2 row 46148: aura
 * 87, −15 × PvpMultiplier 1.66666 = 25 — is a signed redirect (rulings A20 +
 * U3) whose number has no corpus split behind it, so it reads `(redirect)`
 * here as it does everywhere else (predicate-index "Not yet unified").
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
 * | `absorb` | `abilityProfile.absorbs` (DB2 aura 69) | `(absorb Nk, Ts)` — Feign Death's form |
 * | `heal` | `abilityProfile.healsSelf` / `healsOthers` (DB2 Effect 10 / 136, aura 8 / 20); `+ heal absorb` from `HEAL_ABSORB_SELF_SAVE_IDS` | `(heal)` |
 * | `healing received` | `abilityProfile.healingReceivedPct` (DB2 aura 118 / 259) | `(+N% healing received)` |
 * | `mechanic immunity` | `immunityMechanics` (DB2 aura 77) of the cast or of an aura the log shows it applying (`effectAurasOfCast`) | `(root / snare immunity)` |
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
} from "../data/spellIdLists";
import { immunityMechanics } from "../data/spellSchools";
import { HEAL_ABSORB_SELF_SAVE_IDS } from "./healAbsorbSave";

export type SelfDefensiveMechanism =
  /** an absorb shield */
  | { kind: "absorb" }
  /** a heal of the caster; `healAbsorb` = it also puts a heal absorb on them */
  | { kind: "heal"; healAbsorb: boolean }
  /** more healing received, by an official percentage */
  | { kind: "healing received"; pct: number }
  /** immunity to the named control mechanics while it is up */
  | { kind: "mechanic immunity"; mechanics: readonly string[] }
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

/** What `spellId` does, for a unit that pressed it on itself — or undefined
 * when no source classifies it (`test/selfDefensiveMechanism.test.ts` fails
 * for a live `SELF_SAVE_IDS` member without one). */
export function selfDefensiveMechanism(
  spellId: string,
): SelfDefensiveMechanism | undefined {
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
  if (mechanics.length > 0) return { kind: "mechanic immunity", mechanics };
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
 * but one: an `absorb` goes on to what the shield absorbed and how long it
 * was up (`enemySaveEffectNote`).
 */
export function selfDefensiveLabelWords(m: SelfDefensiveMechanism): string {
  switch (m.kind) {
    case "heal":
      return m.healAbsorb ? "heal + heal absorb" : "heal";
    case "healing received":
      return `+${m.pct}% healing received`;
    case "mechanic immunity":
      return `${m.mechanics.join(" / ")} immunity`;
    case "movement speed":
      return `+${m.pct}% movement speed`;
    default:
      return m.kind;
  }
}

/**
 * Does a rendered `[ENEMY DEF]` parenthesis — the text that follows the
 * ability's name, from its `(` — state this mechanism? The gate's reader of
 * what the renderer wrote with `selfDefensiveLabelWords`: the words, then
 * the parenthesis closes — or, for an absorb, the log's figures follow
 * (` 64k`, `, 2.0s …`).
 */
export function statesSelfDefensiveLabel(
  parenthesis: string,
  m: SelfDefensiveMechanism,
): boolean {
  const open = `(${selfDefensiveLabelWords(m)}`;
  if (!parenthesis.startsWith(open)) return false;
  const rest = parenthesis.slice(open.length);
  if (rest.startsWith(")")) return true;
  return m.kind === "absorb" && /^(?: (?:\d+|<1)k)?(?:, |\))/.test(rest);
}

/** The label a line must NOT carry any more: a purpose, not a mechanism. */
export const SELF_SAVE_PURPOSE_LABEL = "(self-save)";

/**
 * What the `[ENEMY DEF]` legend says of each label this module writes — one
 * entry per label form, emitted only when a line carries it. `(absorb …)`
 * and `(area)` are the legend's own existing lines. The legend
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
      "`(root / snare immunity)`, `(charm / fear / sleep immunity)` = the unit cannot be put under those controls while it is up, and one already on it is removed — no damage is reduced;",
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
      "`(rewind)` = pressed again, or when it runs out, the unit goes back to where it stood at this press and is healed toward the health it had then;",
  },
  {
    carried: / \(redirect\)/,
    legend:
      "`(redirect)` = part of the damage the unit takes goes to another unit (its pet, for Roar of Sacrifice);",
  },
];

/** The legend entries for the labels these `[ENEMY DEF]` lines carry, in the
 * table's order; empty when none does. */
export function selfDefensiveLabelLegends(
  enemyDefLines: readonly string[],
): string[] {
  return LABEL_LEGENDS.filter(({ carried }) =>
    enemyDefLines.some((l) => carried.test(l)),
  ).map(({ legend }) => legend);
}
