/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F15 / fact1215 R5 + R6: "which control-avoidance aura was up when the
 * control hit" — read in log order, capped at the aura's length when the log
 * never closes it, and (for a control that lands after its cast) at the
 * instant it hit. Shapes from the audited rounds: 086019c0 / 09195b87
 * (Nullifying Shroud consumed by the IMMUNE miss, REMOVED after it in the
 * same ms), 15b4d4ec (a Phase Shift with no REMOVED held open 56 s), 06aa443c
 * (Capacitor Totem cast inside Shroud, pulse after it ran out).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import {
  analyzePlayerCCAndTrinket,
  ccAvoidanceBuffsUpAt,
} from "../src/utils/ccTrinketAnalysis";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const SHROUD = "378464"; // Nullifying Shroud, 3 s
const PHASE_SHIFT = "408558"; // 1 s
const CAPACITOR_TOTEM = "192058";
const STATIC_CHARGE = "118905";

const aura = (event: LogEvent, id: string, atMs: number, line: number) =>
  ({
    timestamp: T0 + atMs,
    spellId: id,
    spellName: id,
    srcUnitId: "P",
    srcUnitName: "Player",
    destUnitId: "P",
    logLine: { event, timestamp: T0 + atMs, lineIndex: line },
  }) as any;
const unit = (auraEvents: any[]) => ({ id: "P", auraEvents }) as any;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ccAvoidanceBuffsUpAt", () => {
  it("an aura the judged row consumed — REMOVED in its ms, logged after it — was up (R5, 086019c0)", () => {
    const u = unit([
      aura(LogEvent.SPELL_AURA_APPLIED, SHROUD, 0, 10),
      aura(LogEvent.SPELL_AURA_REMOVED, SHROUD, 1500, 25),
    ]);
    // the miss row is line 20, in the REMOVED's ms
    expect(
      ccAvoidanceBuffsUpAt(u, T0 + 1500, { atLine: 20 }).map((b) => b.name),
    ).toEqual(["Nullifying Shroud"]);
    // a REMOVED logged before the row in that ms: gone
    expect(ccAvoidanceBuffsUpAt(u, T0 + 1500, { atLine: 30 })).toEqual([]);
  });
  it("an application the log never closes holds only its official length (R5, 15b4d4ec)", () => {
    const u = unit([aura(LogEvent.SPELL_AURA_APPLIED, PHASE_SHIFT, 0, 1)]);
    expect(ccAvoidanceBuffsUpAt(u, T0 + 900).map((b) => b.spellId)).toEqual([
      PHASE_SHIFT,
    ]);
    expect(ccAvoidanceBuffsUpAt(u, T0 + 56_000)).toEqual([]);
  });
  it("…but one its own REMOVED closes later is up until that REMOVED, whatever its official length", () => {
    const u = unit([
      aura(LogEvent.SPELL_AURA_APPLIED, PHASE_SHIFT, 0, 1),
      aura(LogEvent.SPELL_AURA_REMOVED, PHASE_SHIFT, 5000, 2),
    ]);
    expect(ccAvoidanceBuffsUpAt(u, T0 + 4000).map((b) => b.spellId)).toEqual([
      PHASE_SHIFT,
    ]);
  });
});

describe("ccAvoidanceBuffsUpAt — Druid forms", () => {
  it("a new form ends the one before, also one the log's start list held", () => {
    const u = {
      id: "P",
      info: { interestingAurasJSON: JSON.stringify([783]) }, // Travel Form at the start
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, "5487", 5000, 1)], // Bear Form
    } as any;
    expect(
      ccAvoidanceBuffsUpAt(u, T0 + 6000, {
        withForms: true,
        logStartMs: T0,
      }).map((b) => b.name),
    ).toEqual(["Bear Form"]);
  });
});

describe("[CC AVOIDED?] — a delayed control is read at the instant it hit (R6, 06aa443c)", () => {
  const run = (opts: { missAtMs?: number; pulseOnMateAtMs?: number }) => {
    const enemy = makeUnit("enemy-1", {
      name: "Shaman",
      spec: CombatUnitSpec.Shaman_Enhancement,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          CAPACITOR_TOTEM,
          T0 + 10_000,
          "0000000000000000",
          "nil",
          "enemy-1",
          "Shaman",
          0,
          getEnglishSpellName(CAPACITOR_TOTEM),
        ),
      ],
    });
    const totem = makeUnit("totem-1", { name: "Totem", ownerId: "enemy-1" });
    // Shroud 9.0–11.7 s, REMOVED logged right after any miss row in its ms
    const player = makeUnit("player-1", {
      name: "Player",
      spec: CombatUnitSpec.Evoker_Preservation,
      reaction: CombatUnitReaction.Friendly,
      auraEvents: [
        {
          ...aura(LogEvent.SPELL_AURA_APPLIED, SHROUD, 9_000, 1),
          srcUnitId: "player-1",
          destUnitId: "player-1",
        },
        {
          ...aura(
            LogEvent.SPELL_AURA_REMOVED,
            SHROUD,
            opts.missAtMs ?? 11_700,
            999,
          ),
          srcUnitId: "player-1",
          destUnitId: "player-1",
        },
      ],
    });
    player.missesIn = (
      opts.missAtMs === undefined
        ? []
        : [
            {
              timestamp: T0 + opts.missAtMs,
              spellId: STATIC_CHARGE,
              srcUnitId: "totem-1",
              destUnitId: "player-1",
              missType: "IMMUNE",
              amount: 0,
              logLine: {
                event: LogEvent.SPELL_MISSED,
                timestamp: T0 + opts.missAtMs,
                lineIndex: 998,
              },
            },
          ]
    ) as never;
    const mate = makeUnit("mate-1", {
      name: "Mate",
      auraEvents:
        opts.pulseOnMateAtMs === undefined
          ? []
          : [
              {
                ...aura(
                  LogEvent.SPELL_AURA_APPLIED,
                  STATIC_CHARGE,
                  opts.pulseOnMateAtMs,
                  500,
                ),
                srcUnitId: "totem-1",
                destUnitId: "mate-1",
              },
            ],
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 60_000,
      startInfo: { zoneId: "1672" },
      units: {
        [player.id]: player,
        [enemy.id]: enemy,
        [totem.id]: totem,
        [mate.id]: mate,
      },
    };
    return analyzePlayerCCAndTrinket(player, [enemy], combat as never, [totem])
      .ccAvoidedInstances;
  };
  it("pulse after the Shroud ran out: no Shroud credit", () => {
    expect(run({ pulseOnMateAtMs: 12_000 })).toEqual([]);
  });
  it("IMMUNE row on the player at the pulse, Shroud consumed by it: credited at the pulse second", () => {
    const [a] = run({ missAtMs: 12_000 });
    expect(a).toMatchObject({
      avoidanceSpellName: "Nullifying Shroud",
      loggedMissType: "IMMUNE",
      atSeconds: 12,
    });
  });
  it("a totem that stunned nobody: the cast is the only instant, as before", () => {
    expect(run({}).map((a) => a.atSeconds)).toEqual([10]);
  });
});
