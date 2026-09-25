import {
  CombatUnitType,
  getUnitType,
  type ICombatUnit,
} from "@gladlog/parser-compat";

import { coveredMsWithin } from "./cannotCastIntervals";

/**
 * A player under someone else's control (Mind Control): the log keeps the
 * player's GUID but flags the unit as a PET (COMBATLOG_OBJECT_TYPE_PET, the
 * player bit cleared) on the other side's reaction for as long as it lasts —
 * a5a8d31b: `Limìts` 0x512 before, 0x11148 / 0x1148 from 72.7 s to 75.5 s.
 *
 * One predicate for two consumers (reliability round 2 W1d):
 *  - dispelAnalysis: a charmed teammate is hostile, so a friendly Cleanse
 *    cannot touch anything on them — in the corpus every Mind Control
 *    removal (386 of 386 in a 1-in-5 sample of the 08-28 new-season
 *    manifest) is an offensive one (Dispel Magic 272, Greater Purge 55,
 *    Spellsteal 22 — SPELL_STOLEN —, Tranquilizing Shot 18, Consume Magic
 *    10, Purge 3, Devour Magic 3, Scouring-Flame Fire Breath 2, Mass Dispel
 *    1), never Purify / Cleanse / Nature's Cure;
 *  - matchTimeline: a cast at a charmed teammate is not a "[totem/pet]" cast
 *    (7b3c556e: "Holy Fire → 2 [totem/pet]" on the Mind-Controlled priest).
 */
export function isControlledPlayerFlags(
  unitId: string | undefined,
  flags: number | undefined,
): boolean {
  return (
    !!unitId &&
    unitId.startsWith("Player-") &&
    flags !== undefined &&
    getUnitType(flags) === CombatUnitType.Pet
  );
}

/**
 * The spans `unit` was under enemy control, from the log's own flags: a span
 * opens at the first event flagging the unit as a controlled player and
 * closes at the next event flagging it as a player again (or at its last
 * logged event). Reads only events where the unit is the DESTINATION —
 * `destUnitFlags` line up with `destUnitId`, while `srcUnitFlags` on some
 * event kinds describe a different actor (parser-compat convert.ts).
 */
export function charmedSpans(
  unit: ICombatUnit,
): Array<{ from: number; to: number }> {
  const marks: Array<{ ts: number; controlled: boolean }> = [];
  const streams = [
    unit.auraEvents,
    unit.damageIn,
    unit.healIn,
    unit.actionIn,
  ] as ReadonlyArray<
    | ReadonlyArray<{
        timestamp: number;
        destUnitId?: string;
        destUnitFlags?: number;
      }>
    | undefined
  >;
  for (const stream of streams)
    for (const e of stream ?? []) {
      if (e.destUnitId !== unit.id || e.destUnitFlags === undefined) continue;
      marks.push({
        ts: e.timestamp,
        controlled: isControlledPlayerFlags(e.destUnitId, e.destUnitFlags),
      });
    }
  marks.sort((a, b) => a.ts - b.ts);
  const spans: Array<{ from: number; to: number }> = [];
  let open: number | null = null;
  let last = 0;
  for (const m of marks) {
    if (m.controlled && open === null) open = m.ts;
    else if (!m.controlled && open !== null) {
      spans.push({ from: open, to: m.ts });
      open = null;
    }
    last = m.ts;
  }
  if (open !== null) spans.push({ from: open, to: last });
  return spans;
}

/**
 * Was `unit` charmed for all but less than `freeMs` of [fromMs, toMs]? A
 * 34 s Curse of Tongues with a 3 s Mind Control in the middle is not a
 * charmed window — the target was cleansable for 31 s of it (443-2-2611).
 */
export function charmedThrough(
  unit: ICombatUnit,
  fromMs: number,
  toMs: number,
  freeMs: number,
): boolean {
  const spans = charmedSpans(unit);
  if (spans.length === 0) return false;
  return toMs - fromMs - coveredMsWithin(spans, fromMs, toMs) < freeMs;
}
