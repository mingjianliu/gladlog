/**
 * T101 (fact13 D16, 77310154 r0 0:48): a stun the death teardown stripped —
 * Terror of the Skies REMOVED at 48.707 among the dying mage's other auras
 * (24 removals in 36 ms), UNIT_DIED at 48.772 — read as ended 65 ms before
 * the death, and Alter Time printed `free to press it for the last 0.1s
 * before the death`. A REMOVED inside the unit's death teardown AND its
 * strip burst is the strip; the control ran to the death.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  castBlockingAuraIntervals,
  freeMsBefore,
  pressBlockedIntervalsForSpells,
} from "../src/utils/cannotCastIntervals";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const HOJ = "853";
const ALTER_TIME = "342245";
const GARROTE_SILENCE = "1330";
/** two of the holder's own buffs, stripped with everything else */
const BUFFS = ["1459", "1126"];
const enemies = new Set(["enemy-1"]);

const lethal = (ms: number) => ({
  overkill: 12_000,
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms, parameters: [] },
  timestamp: ms,
  srcUnitId: "enemy-1",
  destUnitId: "owner",
  effectiveAmount: -50_000,
  amount: -50_000,
});
const on = (event: LogEvent, spellId: string, ms: number, src = "enemy-1") =>
  makeAuraEvent(event, spellId, ms, src, "owner");
/** the holder's own buffs coming off in the strip burst at `ms` */
const strip = (ms: number) =>
  BUFFS.flatMap((id, k) => [
    on(LogEvent.SPELL_AURA_APPLIED, id, 1_000, "owner"),
    on(LogEvent.SPELL_AURA_REMOVED, id, ms + k * 3, "owner"),
  ]);

function unit(
  auras: ReturnType<typeof on>[],
  lethalMs: number,
  deathMs: number,
) {
  return makeUnit("owner", {
    reaction: CombatUnitReaction.Friendly,
    auraEvents: [...auras].sort((a, b) => a.timestamp - b.timestamp),
    damageIn: [lethal(lethalMs)] as never,
    deathRecords: [{ timestamp: deathMs }] as never,
  });
}
const blockingOf = (u: ReturnType<typeof unit>, spellId: string) =>
  castBlockingAuraIntervals(u, enemies).filter((iv) => iv.spellId === spellId);

describe("castBlockingAuraIntervals — a control stripped by the death (T101)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("a REMOVED in the teardown's strip burst runs the control to the UNIT_DIED", () => {
    const u = unit(
      [
        on(LogEvent.SPELL_AURA_APPLIED, HOJ, 48_012),
        on(LogEvent.SPELL_AURA_REMOVED, HOJ, 48_707),
        ...strip(48_700),
      ],
      48_700,
      48_772,
    );
    const [iv] = blockingOf(u, HOJ);
    expect(iv!.to).toBe(48_772);
    // the end's cause is still read off the logged REMOVED: the [SILENCE]
    // "ended at their death" note and the trinket binders match it there
    expect(iv!.removedMs).toBe(48_707);
    const blocked = pressBlockedIntervalsForSpells(
      u,
      enemies,
      [ALTER_TIME],
      undefined,
      true,
    );
    expect(freeMsBefore(blocked, 48_772)).toBe(0);
  });

  it("a strip at any point of the control's length counts — no duration model (codex 85-tk-L-T101-1b #1: HoJ stripped at a quarter of its length)", () => {
    const u = unit(
      [
        on(LogEvent.SPELL_AURA_APPLIED, HOJ, 10_000),
        on(LogEvent.SPELL_AURA_REMOVED, HOJ, 11_250),
        ...strip(11_250),
      ],
      11_250,
      11_315,
    );
    expect(blockingOf(u, HOJ)[0]!.to).toBe(11_315);
  });

  it("a removal in the teardown window with no strip burst around it keeps its end", () => {
    const u = unit(
      [
        on(LogEvent.SPELL_AURA_APPLIED, HOJ, 48_012),
        on(LogEvent.SPELL_AURA_REMOVED, HOJ, 48_707),
      ],
      48_707,
      48_772,
    );
    expect(blockingOf(u, HOJ)[0]!.to).toBe(48_707);
  });

  it("an aura that ran out 100 ms before the lethal hit's burst keeps its end (codex 85-tk-L-T101-1 #2, 1b #2 / #3)", () => {
    const u = unit(
      [
        on(LogEvent.SPELL_AURA_APPLIED, GARROTE_SILENCE, 10_000),
        // a re-broadcast of the same silence
        on(LogEvent.SPELL_AURA_REMOVED, GARROTE_SILENCE, 11_000),
        on(LogEvent.SPELL_AURA_APPLIED, GARROTE_SILENCE, 11_000),
        on(LogEvent.SPELL_AURA_REMOVED, GARROTE_SILENCE, 13_000),
        ...strip(13_100),
      ],
      13_100,
      14_100,
    );
    const ivs = blockingOf(u, GARROTE_SILENCE);
    expect(ivs).toHaveLength(1);
    expect(ivs[0]!.to).toBe(13_000);
  });

  it("a REMOVED before the teardown is the control's own end", () => {
    const u = unit(
      [
        on(LogEvent.SPELL_AURA_APPLIED, HOJ, 48_012),
        on(LogEvent.SPELL_AURA_REMOVED, HOJ, 48_500),
        ...strip(48_700),
      ],
      48_700,
      48_772,
    );
    const [iv] = blockingOf(u, HOJ);
    expect(iv!.to).toBe(48_500);
    expect(iv!.removedMs).toBe(48_500);
  });

  it("a merged re-broadcast keeps its last piece's logged removal (codex 85-tk-L-T101-1 #1)", () => {
    const u = makeUnit("owner", {
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        on(LogEvent.SPELL_AURA_APPLIED, GARROTE_SILENCE, 10_000),
        on(LogEvent.SPELL_AURA_REMOVED, GARROTE_SILENCE, 11_000),
        on(LogEvent.SPELL_AURA_APPLIED, GARROTE_SILENCE, 11_000),
        on(LogEvent.SPELL_AURA_REMOVED, GARROTE_SILENCE, 12_000),
      ],
    });
    const ivs = blockingOf(u, GARROTE_SILENCE);
    expect(ivs).toHaveLength(1);
    expect(ivs[0]!.to).toBe(12_000);
    expect(ivs[0]!.removedMs).toBe(12_000);
  });
});
