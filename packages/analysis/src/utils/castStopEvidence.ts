/**
 * What tells a cast the unit stopped ITSELF from one something else stopped —
 * the evidence both sides of the "was it a fake" question read:
 *  - `castCancels.ts`: the log owner's own stopped hardcasts (rulings A′17,
 *    A35) and kick-eaten's `stoppedJustBefore` fact;
 *  - `kickAudit.ts`: a channel the kick's target stopped just before the kick
 *    (B-tier B21b, user ruling 2026-10-06 — "the mirror of A35, one
 *    predicate").
 * A leaf module: `castCancels.ts` imports `kickAudit.ts`, so the shared
 * pieces cannot live in either.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { AURA_ONLY_ACTIVATION_IDS } from "../data/auraActivation";
import { spellClassMap } from "../data/drCategories";
import { ccSpellIds, officialSilenceIds } from "../data/spellTags";

/** A control aura this close to the stop means CC broke the cast. */
export const CANCEL_CC_NEAR_S = 0.3;

/** How close before the next thing (the owner's next cast start that was
 * kicked; an enemy's kick) a self-stopped cast counts as "just before"
 * (user ruling A35, 2026-09-30: 0.5 s; B21b reads the same number for a
 * stopped channel). */
export const STOPPED_JUST_BEFORE_S = 0.5;

/**
 * Enemy displacements that break a cast bar by moving the caster: the hand
 * knockback family (`drCategories.ts`: Thunderstorm 51490, Typhoon 132469,
 * Gorefiend's Grasp 108199) plus the daze aura Typhoon leaves, 61391 — the
 * only trace on the victim when the knockback row itself is not logged
 * against them (138e632d @116.9, 141470d0 @344.0).
 *
 * Only LANDED evidence counts (codex review of the triage entry, 10-01): the
 * aura applied on the unit, or damage of one of these ids taken by it. A
 * displacement that MISSED (IMMUNE, MISS) did not move the unit, so a stop
 * next to it is still the unit's own.
 */
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const DISPLACEMENT_EVIDENCE_IDS: ReadonlySet<string> = new Set([
  ...spellClassMap.diminishingReturns.knockback.map((k) => k.spellId),
  "61391", // Typhoon (daze aura)
]);

export const DEATH_GRIP_ID = "49576";
/** A SPELL_MISSED row of the grip sits within this of its cast row. */
export const GRIP_MISS_PAIR_MS = 200;

/** The Death Grips among `rows` that another unit cast at `victim`: a
 * SPELL_CAST_SUCCESS of the grip naming the victim — the grip leaves nothing
 * else on it (no aura, no damage), so the cast row is the evidence — with
 * `missType` when a SPELL_MISSED row of the grip from the same caster sits
 * within `GRIP_MISS_PAIR_MS` (it moved nobody). The one predicate of "a grip
 * landed on the unit": the `[GRIP]` line hands it the opponents' cast rows
 * (`deathGripsOn`), the cast-stop evidence below the victim's own incoming
 * rows (`actionIn`, where the parser mirrors the same rows) — fact9 D11. */
export interface GripOn {
  castMs: number;
  srcUnitId: string;
  missType?: string;
}
export function gripsOn(
  victim: Pick<ICombatUnit, "id" | "missesIn">,
  rows: Iterable<ICombatUnit["spellCastEvents"][number]>,
): GripOn[] {
  const out: GripOn[] = [];
  for (const c of rows) {
    if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (c.spellId !== DEATH_GRIP_ID || c.destUnitId !== victim.id) continue;
    if (c.srcUnitId === victim.id) continue;
    const castMs = c.logLine.timestamp;
    const miss = (victim.missesIn ?? []).find(
      (m) =>
        m.spellId === DEATH_GRIP_ID &&
        m.srcUnitId === c.srcUnitId &&
        Math.abs(m.timestamp - castMs) <= GRIP_MISS_PAIR_MS,
    );
    out.push({
      castMs,
      srcUnitId: c.srcUnitId,
      ...(miss ? { missType: miss.missType } : {}),
    });
  }
  return out.sort((a, b) => a.castMs - b.castMs);
}

/** The instants (epoch ms) at which something other than the unit could
 * have stopped its cast: a control or silence aura applied on it (`cc`; a
 * silence breaks a cast bar too — codex review 2026-09-26), a landed
 * enemy displacement (`displaced`: aura applied, or damage of the
 * displacement taken — F-K10b), and a landed Death Grip (`gripped`,
 * `gripsOn`: fact9 D11, 1d6eee5f 1:26.609 — a Pyroblast stopped 1 ms before
 * the grip's cast row was counted as the player's own cancel). `gripped` is
 * kept apart from `displaced` because the forced-move readers list a grip
 * under its own name (`forcedMovesInRenderedSpan`). */
export function forcedStopInstantsMs(
  unit: Pick<ICombatUnit, "auraEvents" | "damageIn"> &
    Partial<Pick<ICombatUnit, "id" | "actionIn" | "missesIn">>,
): { cc: number[]; displaced: number[]; gripped: number[] } {
  const auras = unit.auraEvents ?? [];
  return {
    gripped:
      unit.id === undefined
        ? []
        : gripsOn({ id: unit.id, missesIn: unit.missesIn }, unit.actionIn ?? [])
            .filter((g) => g.missType === undefined)
            .map((g) => g.castMs),
    cc: auras
      .filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          (ccSpellIds.has(a.spellId) || officialSilenceIds.has(a.spellId)),
      )
      .map((a) => a.timestamp),
    displaced: [
      ...auras.filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          !!a.spellId &&
          DISPLACEMENT_EVIDENCE_IDS.has(a.spellId),
      ),
      ...(unit.damageIn ?? []).filter(
        (d) => !!d.spellId && DISPLACEMENT_EVIDENCE_IDS.has(d.spellId),
      ),
    ].map((e) => e.timestamp),
  };
}

/** Feign Death's cast id, which the log never writes as a SUCCESS. */
const FEIGN_DEATH_CAST_ID = "5384";

/**
 * The instants (epoch ms) `unit` went into Feign Death, off the two rows the
 * log writes for it: `UNIT_DIED … unconscious=1` for every feign, and the
 * Survival Tactics aura (`AURA_ONLY_ACTIVATION_IDS`, the table
 * `FEIGN_DEATH_ABSORB_AURA_IDS` reads) for a hunter with the talent. No
 * reader of cast rows can see one. 91 fact7 files: 456 such UNIT_DIED rows,
 * all on 39 hunters, 28 of them with no aura beside them (fact7 D31).
 */
/** The `UNIT_DIED … unconscious=1` rows of `unit` (epoch ms): every Feign
 * Death writes one, with or without Survival Tactics. */
export function feignDeathUnconsciousMs(
  unit: Pick<ICombatUnit, "unconsciousRecords">,
): number[] {
  return (unit.unconsciousRecords ?? []).map((r) => r.timestamp);
}

export function feignDeathInstantsMs(
  unit: Pick<ICombatUnit, "auraEvents" | "unconsciousRecords">,
): number[] {
  const auras = AURA_ONLY_ACTIVATION_IDS[FEIGN_DEATH_CAST_ID] ?? [];
  return [
    ...feignDeathUnconsciousMs(unit),
    ...(unit.auraEvents ?? [])
      .filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          !!a.spellId &&
          auras.includes(a.spellId),
      )
      .map((a) => a.timestamp),
  ];
}
