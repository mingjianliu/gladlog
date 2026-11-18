/**
 * T142 (round-14 D27, bd6d44c1): Recklessness went up at 4:24.9 and the log
 * shows no REMOVED of it before the round ended at 4:47.9 — the timeline
 * printed `[BUFF FADED] Recklessness (expired, estimated)` at 4:42, the
 * press plus its 18 s table length. A buff the log shows going up and never
 * coming off was up when the round ended.
 *
 * E07 (GH #207.2): `extractOwnerCDBuffExpiry` asks a press's length at the
 * press, the set-bonus walk counts from the APPLIED row — pinned equal here.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { CLASS_SET_ITEM_IDS } from "../src/data/classSetBonuses";
import { ensureAnalysisData } from "../src/data/ensure";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const ME = "player-1";
const RECKLESSNESS = "1719";
const RAGING_BLOW = "85288";

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (event: LogEvent, s: number) =>
  makeAuraEvent(event, RECKLESSNESS, T0 + s * 1000, ME, ME, "BUFF");
const cast = (id: string, s: number) =>
  makeSpellCastEvent(id, T0 + s * 1000, ME);
const cdRow = (casts: number[]) =>
  [
    {
      spellId: RECKLESSNESS,
      spellName: "Recklessness",
      tag: "Offensive",
      casts: casts.map((timeSeconds) => ({ timeSeconds })),
      cooldownSeconds: 90,
      neverUsed: false,
      availableWindows: [],
    },
  ] as never;
const warrior = (presses: number[], auraEvents: unknown[]) =>
  makeUnit(ME, {
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Fury,
    spellCastEvents: presses.map((s) => cast(RECKLESSNESS, s)),
    auraEvents: auraEvents as never,
  }) as ICombatUnit;
const expiry = (u: ICombatUnit, presses: number[], roundEndS?: number) =>
  extractOwnerCDBuffExpiry(
    cdRow(presses),
    ME,
    [u],
    T0,
    u,
    [],
    roundEndS === undefined ? undefined : T0 + roundEndS * 1000,
  );

describe("an owner buff the log never shows ending (T142)", () => {
  it("up, no REMOVED, the round over past its table length: the round ended on it", () => {
    const u = warrior([100], [aura(LogEvent.SPELL_AURA_APPLIED, 100.001)]);
    const full = buffFullDurationForCaster(RECKLESSNESS, u, T0 + 100_000)!;
    const [e] = expiry(u, [100], 100 + full + 5);
    expect(e).toMatchObject({
      cause: "round_end",
      isEstimated: false,
      expiresAtSeconds: 100 + full + 5,
    });
  });

  it("its REMOVED logged inside the round: that row, as before", () => {
    const u = warrior(
      [100],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 100.001),
        aura(LogEvent.SPELL_AURA_REMOVED, 124),
      ],
    );
    const [e] = expiry(u, [100], 140);
    expect(e).toMatchObject({ isEstimated: false, expiresAtSeconds: 124 });
    expect(e!.cause).not.toBe("round_end");
  });

  it("no application of it logged: nothing shows it up — no round-end reading", () => {
    const u = warrior([100], []);
    expect(expiry(u, [100], 140).some((e) => e.cause === "round_end")).toBe(
      false,
    );
  });

  it("no round end given: the estimate stays", () => {
    const u = warrior([100], [aura(LogEvent.SPELL_AURA_APPLIED, 100.001)]);
    expect(expiry(u, [100])[0]).toMatchObject({ isEstimated: true });
  });
});

describe("a press's length is the same asked at the press or at its APPLIED row (E07)", () => {
  const SET = CLASS_SET_ITEM_IDS["2067"]!;
  // the Fury 12.1 2pc holder: each Raging Blow inside the run adds 2 s
  const holder = (appliedS: number, blows: number[]) =>
    ({
      id: ME,
      spec: CombatUnitSpec.Warrior_Fury,
      info: {
        talents: [{ id1: 110412, id2: 137002, count: 1 }],
        pvpTalents: [],
        equipment: SET.slice(0, 2).map((id) => ({ id })),
      },
      spellCastEvents: blows.map((s) => ({
        spellId: RAGING_BLOW,
        logLine: {
          event: LogEvent.SPELL_CAST_SUCCESS,
          timestamp: T0 + s * 1000,
        },
      })),
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, appliedS),
        aura(LogEvent.SPELL_AURA_REMOVED, appliedS + 24),
      ],
    }) as never;

  // bd6d44c1: the cast row 1 ms before its APPLIED; other logs put it after
  it.each([-0.005, -0.001, 0, 0.001, 0.005])(
    "press %f s from the APPLIED row",
    (offset) => {
      const applied = 100;
      const u = holder(applied, [101, 110, 119.5, 121]);
      const atApplied = buffFullDurationForCaster(
        RECKLESSNESS,
        u,
        T0 + applied * 1000,
      );
      expect(atApplied).toBe(24);
      expect(
        buffFullDurationForCaster(
          RECKLESSNESS,
          u,
          T0 + (applied + offset) * 1000,
        ),
      ).toBe(atApplied);
    },
  );
});
