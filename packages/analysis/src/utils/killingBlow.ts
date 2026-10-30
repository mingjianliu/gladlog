/**
 * The killing blow of a player's death, when it was an EXECUTE — B-tier
 * B15c-U11 (user ruling 2026-10-06: "死亡块写出致死一击，只收斩杀类（轮回之触
 * 等）"). An execute changes what the death teaches: the defensive had to be
 * pressed above the health the execute works from, not when the bar looked
 * empty (95127ab4 1:51: a Mistweaver killed by Touch of Death, and the words
 * "Touch of Death" nowhere in the prompt).
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

/**
 * Damage ids of abilities that END a low-health target outright. A hand
 * table (registered in curatedIdRegistry), deliberately one row:
 *  - Touch of Death 322109 — 5 of the 90 player deaths in the 60 triage
 *    rounds (the id is both the cast and the damage row).
 * Looked at and left out (the same 90 deaths, `fix-BD/u11Probe.out`):
 *  - Execute 260798 (2 deaths): a damage ability a Sudden Death proc allows
 *    at any health — being the last hit does not make the death an execute;
 *  - Sudden Demise 343769 (3 deaths, logged without overkill): its mechanic
 *    is not read from DB2 here yet — open, not assumed.
 */
export const EXECUTE_KILLING_BLOW_IDS: ReadonlySet<string> = new Set([
  "322109", // Touch of Death
]);

type DamageRow = ICombatUnit["damageIn"][number];

/** Damage ids of transfers the log writes as a plain SPELL_DAMAGE row, not a
 * DAMAGE_SPLIT: the source is the protected unit, the destination the one
 * taking the share. A hand table (registered in curatedIdRegistry), one row:
 *  - Roar of Sacrifice 67481 — the hunter pet's share of the damage on the
 *    ally its 53480 aura sits on (bdce91c4 3:02: 138 SPELL_DAMAGE rows from the
 *    Paladin onto the pet, no DAMAGE_SPLIT in the file; the pet's overkill row
 *    read "killed by: 1(RPaladin) — Roar of Sacrifice", PARTY_KILL credits the
 *    Paladin too — checkKillCreditNotOwnSide 3 on the F20 605 capture). */
export const DAMAGE_TRANSFER_ROW_IDS: ReadonlySet<string> = new Set([
  "67481", // Roar of Sacrifice
]);

/** A damage row an ATTACKER dealt. A DAMAGE_SPLIT row is not one: its source
 * is the unit whose damage was moved away (Soul Link's warlock, Blessing of
 * Sacrifice's protected ally — parser l3/collect.ts: src and dest teammates in
 * 7,354 rows, opponents in 0) — nor is a `DAMAGE_TRANSFER_ROW_IDS` row, the
 * same transfer logged as SPELL_DAMAGE. fact6 D22 (114a4df7 r0 1:02): the Sayaad's
 * overkill row was its warlock's Soul Link split and the line read "killed
 * by: 5(DWarlock) — Soul Link"; PARTY_KILL credits our Balance Druid. */
export function isAttackerDamageRow(
  d: Pick<DamageRow, "logLine" | "spellId">,
): boolean {
  return (
    (d.logLine?.event as string | undefined) !== LogEvent.DAMAGE_SPLIT &&
    !DAMAGE_TRANSFER_ROW_IDS.has(d.spellId ?? "")
  );
}

const rowMs = (d: DamageRow): number => d.logLine?.timestamp ?? d.timestamp;

/** How far before a split row the hit on its link holder that moved the
 * damage is looked for: the two are logged in one millisecond (114a4df7 r0
 * 1:02.437: Starsurge on the warlock, then the Soul Link DAMAGE_SPLIT onto
 * the Sayaad); the slack only absorbs a rounding of the log's clock. */
export const SPLIT_TRANSFER_SLACK_MS = 50;

/** Who a split row's source is: the link holder whose damage was moved. */
export type UnitById = (
  id: string,
) => Pick<ICombatUnit, "damageIn"> | undefined;

/** The attacker blow behind an overkill row: the row itself, or — when it is
 * a split (`isAttackerDamageRow` false) — the attacker's hit on the split's
 * source (the link holder) that moved the damage: its latest attacker row
 * with damage at or before the split, inside `SPLIT_TRANSFER_SLACK_MS`. With
 * no such row (or no `unitById` to find the holder) it is undefined and the
 * caller falls back to its top sources: the victim's own earlier hit is no
 * evidence of the lethal attack (codex F20-07: 114a4df7 r0, Shooting Stars
 * left the Sayaad at 3,657 HP; the Starsurge on its warlock 81 ms later moved
 * 3,924 through Soul Link and killed it). The ONE "who killed it" reading of
 * `playerKillingBlow` and `nonPlayerUnitKill`. */
export function attackerBlowFor(
  blow: DamageRow,
  unitById?: UnitById,
): DamageRow | undefined {
  if (isAttackerDamageRow(blow)) return blow;
  const holder = blow.srcUnitId ? unitById?.(blow.srcUnitId) : undefined;
  if (!holder) return undefined;
  const at = rowMs(blow);
  let best: DamageRow | undefined;
  for (const d of holder.damageIn) {
    if (!isAttackerDamageRow(d)) continue;
    const t = rowMs(d);
    if (t > at || at - t > SPLIT_TRANSFER_SLACK_MS) continue;
    // damage amounts are negative on these rows; a zero row dealt nothing
    if (Math.abs(d.amount ?? 0) === 0) continue;
    if (!best || t >= rowMs(best)) best = d;
  }
  return best;
}

/** The blow that killed a player: the last damage event with overkill > 0 at
 * or before the death (+500 ms log slack) — the attacker blow behind it when
 * that row is a split (`attackerBlowFor`) — else undefined. The ONE predicate
 * for "the killing blow" — KILL SEQUENCE's `killing blow:` and the friendly
 * death block's execute line both read it (moved here from
 * context/timelineHelpers.ts, which re-exports it; agy review of the B15c-U11
 * batch: the first cut carried a second predicate with other bounds). */
export function playerKillingBlow(
  unit: Pick<ICombatUnit, "damageIn"> &
    Partial<Pick<ICombatUnit, "advancedActions">>,
  deathMs: number,
  unitById?: UnitById,
): ICombatUnit["damageIn"][number] | undefined {
  let best: ICombatUnit["damageIn"][number] | undefined;
  for (const d of unit.damageIn) {
    if ((d.overkill ?? 0) <= 0) continue;
    if (d.logLine.timestamp > deathMs + 500) continue;
    if (!best || d.logLine.timestamp >= best.logLine.timestamp) best = d;
  }
  if (best && aliveAfter(unit, best.logLine.timestamp, deathMs + 500))
    return undefined;
  return best && attackerBlowFor(best, unitById);
}

/** A reading of the unit above 0 HP logged after `rowMs` (and by `untilMs`):
 * the overkill row did not kill it. codex F20-21 (d8a6e7cb, 18:54:30): an
 * Arcane Mage's Refraction self-tick reported 6,392 overkill and left it at
 * 1 HP; it cast Greater Invisibility at 1,141 HP 329 ms later and died to an
 * enemy hit the log writes only as SPELL_ABSORBED rows (PARTY_KILL credits
 * the enemy) — the line read "killing blow: 4(AMage) — Refraction". With no
 * row the log shows as lethal, no killing blow is named. */
function aliveAfter(
  unit: Partial<Pick<ICombatUnit, "advancedActions">>,
  rowMs: number,
  untilMs: number,
): boolean {
  return (unit.advancedActions ?? []).some(
    (a) =>
      a.logLine.timestamp > rowMs &&
      a.logLine.timestamp <= untilMs &&
      a.advancedActorCurrentHp > 0,
  );
}

/** `playerKillingBlow`, only when it is an execute (`EXECUTE_KILLING_BLOW_IDS`). */
export function executeKillingBlowOf(
  unit: Pick<ICombatUnit, "damageIn"> &
    Partial<Pick<ICombatUnit, "advancedActions">>,
  deathMs: number,
  unitById?: UnitById,
): ICombatUnit["damageIn"][number] | undefined {
  const blow = playerKillingBlow(unit, deathMs, unitById);
  return blow && EXECUTE_KILLING_BLOW_IDS.has(blow.spellId ?? "")
    ? blow
    : undefined;
}
