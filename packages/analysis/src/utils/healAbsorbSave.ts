/**
 * A self-save that also puts a HEAL ABSORB on its caster — Death Pact: it
 * heals at once and then swallows the next healing aimed at the unit. B-tier
 * B15a step 2 (user ruling 2026-10-06, wording approved 2026-10-07): the
 * press line says what the absorb ate, and a death under it quotes that
 * (82a2d681 round 5, 2:45: 284k of absorb, 32 heals / 200k eaten in the
 * 8.5 s to the death, none of the healing landed).
 *
 * Everything here is read off the log: the absorb's size is the aura's own
 * `amount` on its SPELL_AURA_APPLIED row, what it ate is the unit's
 * `healAbsorbsIn` (SPELL_HEAL_ABSORBED) rows of that debuff. Only
 * `unspentAmount` is arithmetic (size − eaten).
 *
 * Who a heal came from: a summon's healing (a Treant, a totem, a statue)
 * counts for its OWNER — the repo's rule for a summon's row (GH #99) — and a
 * source the roster cannot name is `unattributed`; a summon's own name is
 * never printed (it is localized, two of them share it, and a unit the
 * roster does not hold has only a GUID — all three on the 605-file capture).
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

/** Self-saves whose aura is a heal absorb on the caster. A hand table
 * (registered in curatedIdRegistry); 48743 is the cast, the aura and the
 * heal row alike (605 S2 files: 196 casts). */
export const HEAL_ABSORB_SELF_SAVE_IDS: ReadonlySet<string> = new Set([
  "48743", // Death Pact
]);

/** A healer the roster cannot name: a summon whose owner the log does not
 * give, or the nil source. Rendered `unattributed`. */
export const UNATTRIBUTED_HEALER = "";

/**
 * `creditTo` for `healAbsorbUseOf`: a roster player counts as itself, a
 * summon for its owner (`summonOwners` = `buildSummonOwnerNames`, summon id
 * → owner's full name), anything else for nobody.
 */
export function healerCreditOf(
  players: ReadonlyArray<Pick<ICombatUnit, "id" | "name">>,
  summonOwners: ReadonlyMap<string, string> | undefined,
): (healerId: string) => string | null {
  const ids = new Set(players.map((p) => p.id));
  const idByName = new Map(players.map((p) => [p.name, p.id]));
  return (healerId) =>
    ids.has(healerId)
      ? healerId
      : (idByName.get(summonOwners?.get(healerId) ?? "") ?? null);
}

/** The aura row sits within this of the cast row. */
const AURA_PAIR_MS = 500;
/** The press's own heal row sits within this of the cast row. */
const OWN_HEAL_PAIR_MS = 200;

export interface IHealAbsorbUse {
  pressMs: number;
  /** the press's own heal (SPELL_HEAL `amount` of the same id at the press) */
  ownHeal: number;
  /** the absorb the aura put on the unit */
  absorbAmount: number;
  /** healing the absorb swallowed, and in how many heals */
  eaten: number;
  heals: number;
  /** eaten healing by the unit it counts for (`creditTo`;
   * UNATTRIBUTED_HEALER when nobody), largest first */
  byHealer: Array<{ healerId: string; amount: number }>;
  /** how it ended: the unit died under it, the aura was removed with the
   * absorb spent, it was removed with some left, or the round ended */
  ended: "death" | "used-up" | "removed" | "round-end";
  endMs: number;
  /** effective healing that reached the unit between the press and the end
   * (the press's own heal excluded) */
  healingLanded: number;
  /** absorbAmount − eaten when it did not run out; arithmetic, not logged */
  unspentAmount: number;
}

/** Eaten within this of the absorb's size counts as spent (rounding of the
 * last partial heal). */
const USED_UP_TOLERANCE = 1;

/**
 * What `unit`'s heal-absorb self-save pressed at `pressMs` did, or null when
 * the id is not one, the aura row is missing, or it carries no amount (a
 * document that did not keep it) — nothing is estimated. `creditTo` folds a
 * healer id into the unit its healing counts for (`healerCreditOf`); without
 * it every healer id stands for itself.
 */
export function healAbsorbUseOf(
  unit: Pick<
    ICombatUnit,
    "id" | "auraEvents" | "healIn" | "healAbsorbsIn" | "deathRecords"
  >,
  spellId: string,
  pressMs: number,
  roundEndMs: number,
  creditTo?: (healerId: string) => string | null,
): IHealAbsorbUse | null {
  if (!HEAL_ABSORB_SELF_SAVE_IDS.has(spellId)) return null;
  const auras = (unit.auraEvents ?? [])
    .filter((a) => a.spellId === spellId && a.destUnitId === unit.id)
    .sort((a, b) => a.timestamp - b.timestamp);
  const applied = auras.find(
    (a) =>
      a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
      Math.abs(a.timestamp - pressMs) <= AURA_PAIR_MS,
  );
  const absorbAmount = Number((applied as { amount?: number })?.amount);
  if (!applied || !(absorbAmount > 0)) return null;
  const removedMs = auras.find(
    (a) =>
      a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
      a.timestamp > applied.timestamp,
  )?.timestamp;
  const deathMs = (unit.deathRecords ?? [])
    .map((d) => d.timestamp)
    .filter((t) => t >= pressMs)
    .sort((a, b) => a - b)[0];
  const endMs = Math.min(
    removedMs ?? Infinity,
    deathMs ?? Infinity,
    roundEndMs,
  );
  const events = (unit.healAbsorbsIn ?? []).filter(
    (e) =>
      e.absorbSpellId === spellId &&
      e.timestamp >= applied.timestamp &&
      e.timestamp <= endMs,
  );
  const eaten = events.reduce((n, e) => n + e.absorbedAmount, 0);
  const by = new Map<string, number>();
  for (const e of events) {
    const who = creditTo
      ? (creditTo(e.healerId) ?? UNATTRIBUTED_HEALER)
      : e.healerId;
    by.set(who, (by.get(who) ?? 0) + e.absorbedAmount);
  }
  const ownHeal = (unit.healIn ?? [])
    .filter(
      (h) =>
        h.spellId === spellId &&
        Math.abs(h.timestamp - pressMs) <= OWN_HEAL_PAIR_MS,
    )
    .reduce((n, h) => n + Math.abs(h.amount), 0);
  const healingLanded = (unit.healIn ?? [])
    .filter(
      (h) =>
        h.timestamp > pressMs &&
        h.timestamp <= endMs &&
        !(
          h.spellId === spellId &&
          Math.abs(h.timestamp - pressMs) <= OWN_HEAL_PAIR_MS
        ),
    )
    .reduce((n, h) => n + Math.abs(h.effectiveAmount), 0);
  const spent = eaten >= absorbAmount - USED_UP_TOLERANCE;
  const ended: IHealAbsorbUse["ended"] =
    deathMs !== undefined && endMs === deathMs
      ? "death"
      : removedMs !== undefined && endMs === removedMs
        ? spent
          ? "used-up"
          : "removed"
        : "round-end";
  return {
    pressMs,
    ownHeal,
    absorbAmount,
    eaten,
    heals: events.length,
    byHealer: [...by]
      .map(([healerId, amount]) => ({ healerId, amount }))
      .sort(
        (a, b) => b.amount - a.amount || (a.healerId < b.healerId ? -1 : 1),
      ),
    ended,
    endMs,
    healingLanded,
    unspentAmount: Math.max(0, absorbAmount - eaten),
  };
}

/** `215k` — the one rounding of every amount in the heal-absorb wording. */
export const healAbsorbK = (n: number): string => `${Math.round(n / 1000)}k`;

const byHealerText = (
  use: IHealAbsorbUse,
  ownId: string,
  label: (unitId: string) => string,
): string =>
  // a share that rounds to 0k is not listed (the largest always is)
  use.byHealer
    .filter((h, i) => i === 0 || Math.round(h.amount / 1000) > 0)
    .map(
      (h) =>
        `${h.healerId === UNATTRIBUTED_HEALER ? "unattributed" : h.healerId === ownId ? "own" : label(h.healerId)} ${healAbsorbK(h.amount)}`,
    )
    .join("、");

/**
 * The clause a press line gains (wording approved by the user 2026-10-07,
 * `fix-BT/p4/RESULT.md`): the press's own heal, the absorb's size, what it
 * ate and from whom, and how it ended. `fmt` renders an epoch ms as m:ss.
 */
export function healAbsorbPressClause(
  use: IHealAbsorbUse,
  ownId: string,
  label: (unitId: string) => string,
  fmt: (ms: number) => string,
): string {
  const ate =
    use.heals > 0
      ? `ate ${healAbsorbK(use.eaten)} of healing (${use.heals} heal${use.heals === 1 ? "" : "s"} — ${byHealerText(use, ownId, label)})`
      : "ate no healing";
  const tail =
    use.ended === "death"
      ? ` through ${fmt(use.endMs)}${use.healingLanded === 0 ? " · no healing landed after the press" : ""} · ${healAbsorbK(use.unspentAmount)} of it unspent at death`
      : use.ended === "used-up"
        ? ` · used up at ${fmt(use.endMs)}`
        : use.ended === "removed"
          ? ` · ended at ${fmt(use.endMs)} with ${healAbsorbK(use.unspentAmount)} unspent`
          : ` through the end of the round · ${healAbsorbK(use.unspentAmount)} of it unspent`;
  return ` | healed ${healAbsorbK(use.ownHeal)} · heal absorb ${healAbsorbK(use.absorbAmount)}: ${ate}${tail}`;
}

/** The death block's line for a death UNDER the absorb (same approval). */
export function healAbsorbDeathLine(
  use: IHealAbsorbUse,
  spellName: string,
  victimId: string,
  label: (unitId: string) => string,
  fmt: (ms: number) => string,
): string {
  const from = use.heals > 0 ? ` — ${byHealerText(use, victimId, label)}` : "";
  return `Heal absorb: own ${spellName} (pressed ${fmt(use.pressMs)}) ate ${healAbsorbK(use.eaten)} of the healing aimed at ${label(victimId)} before the death${from}; healing that landed after ${fmt(use.pressMs)}: ${use.healingLanded === 0 ? "0" : healAbsorbK(use.healingLanded)}`;
}
