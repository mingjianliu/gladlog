/**
 * F11: Incarnation: Tree of Life logs a SPELL_CAST_SUCCESS of the cooldown's
 * id for the press AND for every shift back into the form while the
 * cooldown's own buff ("Incarnation", 117679) runs. Only the press is a
 * press — `isFormReshiftCast`, read by the ledger, the healer gap filler's
 * [YOU] [CD] promotion and the [ENEMY HEAL CD] line.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyCdEntries } from "../src/context/timelineSections/enemyCd";
import { FORM_COOLDOWN_BUFF_BY_CAST_ID } from "../src/data/druidForms";
import { ENEMY_HEAL_CD_IDS } from "../src/data/enemyHealCds";
import { ensureAnalysisData } from "../src/data/ensure";
import { spellEffectData } from "../src/data/spellEffectData";
import { isFormReshiftCast } from "../src/utils/castPress";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const TREE = "33891";
const INCARNATION = "117679";

beforeAll(async () => {
  await ensureAnalysisData();
});

const cast = (s: number) =>
  makeSpellCastEvent(
    TREE,
    T0 + s * 1000,
    "d",
    "Druid-R",
    "0000000000000000",
    "nil",
    0,
    "Incarnation: Tree of Life",
  );
const aura = (event: LogEvent, id: string, s: number) =>
  makeAuraEvent(event, id, T0 + s * 1000, "d", "d", "BUFF");

/** 14055cb2's enemy Restoration Druid: presses at 27.832 and 161.766, a
 * shift back at 185.500 with Incarnation up since 161.766 (removed 191.783). */
const druid = () =>
  makeUnit("d", {
    name: "Druid-R",
    spec: "105", // Restoration Druid
    spellCastEvents: [cast(27.832), cast(161.766), cast(185.5)],
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, TREE, 27.832),
      aura(LogEvent.SPELL_AURA_APPLIED, INCARNATION, 27.832),
      aura(LogEvent.SPELL_AURA_REMOVED, TREE, 57.815),
      aura(LogEvent.SPELL_AURA_REMOVED, INCARNATION, 57.815),
      aura(LogEvent.SPELL_AURA_APPLIED, TREE, 161.766),
      aura(LogEvent.SPELL_AURA_APPLIED, INCARNATION, 161.769),
      aura(LogEvent.SPELL_AURA_REMOVED, TREE, 183.684),
      aura(LogEvent.SPELL_AURA_APPLIED, TREE, 185.5),
      aura(LogEvent.SPELL_AURA_REMOVED, INCARNATION, 191.783),
      aura(LogEvent.SPELL_AURA_REMOVED, TREE, 191.783),
    ],
  });

describe("isFormReshiftCast", () => {
  it("the pair is the form's cast id and the cooldown's 30 s buff", () => {
    expect(FORM_COOLDOWN_BUFF_BY_CAST_ID[TREE]).toBe(INCARNATION);
    expect(spellEffectData[TREE]?.name).toBe("Incarnation: Tree of Life");
    expect(spellEffectData[INCARNATION]?.name).toBe("Incarnation");
    expect(spellEffectData[INCARNATION]?.durationSeconds).toBe(30);
  });

  it("a cast that applies the buff is a press; one inside it is a shift back", () => {
    const u = druid();
    expect(
      u.spellCastEvents.map((c: never) => isFormReshiftCast(u as never, c)),
    ).toEqual([false, false, true]);
  });

  it("a press inside a proc's buff refreshes it and stays a press", () => {
    const u = makeUnit("d", {
      name: "Druid-R",
      spellCastEvents: [cast(50)],
      auraEvents: [
        // a Reforestation proc: both auras, no cast
        aura(LogEvent.SPELL_AURA_APPLIED, INCARNATION, 45),
        aura(LogEvent.SPELL_AURA_APPLIED, TREE, 45),
        aura(LogEvent.SPELL_AURA_REFRESH, INCARNATION, 50.002),
      ],
    });
    expect(isFormReshiftCast(u as never, u.spellCastEvents[0])).toBe(false);
  });

  it("no buff line on the log, or another spell: never a shift back", () => {
    const bare = makeUnit("d", { name: "Druid-R", spellCastEvents: [cast(5)] });
    expect(isFormReshiftCast(bare as never, bare.spellCastEvents[0])).toBe(
      false,
    );
    const u = druid();
    const tranq = makeSpellCastEvent("740", T0 + 185_500, "d", "Druid-R");
    expect(isFormReshiftCast(u as never, tranq)).toBe(false);
  });

  it("the buff on somebody else is not this druid's", () => {
    const u = makeUnit("d", {
      name: "Druid-R",
      spellCastEvents: [cast(50)],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          INCARNATION,
          T0 + 40_000,
          "x",
          "x",
          "BUFF",
        ),
      ],
    });
    expect(isFormReshiftCast(u as never, u.spellCastEvents[0])).toBe(false);
  });
});

describe("[ENEMY HEAL CD] Incarnation: Tree of Life", () => {
  it("is on the enemy healer's throughput list", () => {
    expect(ENEMY_HEAL_CD_IDS.has(TREE)).toBe(true);
  });

  it("prints the two presses, not the shift back", () => {
    const u = druid();
    const lines: string[] = [];
    emitEnemyCdEntries({
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      cdPurgeAnnotations: new Map(),
      addEntry: ((_: number, line: string) => lines.push(line)) as never,
      enemyPid: () => "4(RDruid)",
      enemies: [u as never],
      matchStartMs: T0,
    });
    expect(lines).toEqual([
      "0:27  [ENEMY HEAL CD]   4(RDruid) (Restoration Druid): Incarnation: Tree of Life (cast 1 of 2)",
      "2:41  [ENEMY HEAL CD]   4(RDruid) (Restoration Druid): Incarnation: Tree of Life (cast 2 of 2)",
    ]);
  });
});
