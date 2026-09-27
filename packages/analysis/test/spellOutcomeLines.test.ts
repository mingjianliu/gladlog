/**
 * Reliability leftovers batch 13 (user ruling 2026-09-26): Grounding /
 * reflect / Sanctuary outcomes and the owner's rejected-press runs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  groundedControls,
  ownerRejectRuns,
  reflectedSpells,
  sanctuaryRemovals,
} from "../src/context/spellOutcomeLines";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const cast = (spellId: string, tS: number, destUnitId: string) => ({
  spellId,
  spellName: "x",
  destUnitId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + tS * 1000 },
});
const unit = (id: string, over: Record<string, unknown> = {}): any => ({
  id,
  name: `${id}-R-US`,
  spellCastEvents: [],
  auraEvents: [],
  missesOut: [],
  damageIn: [],
  absorbsIn: [],
  advancedActions: [],
  ...over,
});

describe("groundedControls (7d1f)", () => {
  const TOTEM = "Creature-0-4222-1911-5458-5925-0000050C82";
  it("a Polymorph into a Grounding Totem is stated; a damage spell and the owner's own cast are not", () => {
    const mage = unit("Player-M", {
      spellCastEvents: [cast("118", 6.4, TOTEM), cast("108853", 7.8, TOTEM)],
    });
    const owner = unit("Player-O", {
      spellCastEvents: [cast("33786", 9, TOTEM)],
    });
    const out = groundedControls([mage, owner], T0, new Set(["Player-O"]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ casterId: "Player-M", spellId: "118" });
  });
});

describe("reflectedSpells (0051f0c9)", () => {
  const advanced = (maxHp: number) =>
    [0, 10_000, 20_000].map((ms) => ({
      advancedActorId: "Player-P",
      advancedActorMaxHp: maxHp,
      advancedActorCurrentHp: maxHp,
      logLine: { timestamp: T0 + ms },
    }));
  const miss = (spellId: string) => ({
    spellId,
    spellName: "x",
    missType: "REFLECT",
    destUnitId: "Player-W",
    logLine: { timestamp: T0 + 5_000 },
  });
  it("a reflected control is stated whatever it did back", () => {
    const caster = unit("Player-P", {
      missesOut: [miss("118")],
      advancedActions: advanced(500_000),
    });
    const out = reflectedSpells([caster, unit("Player-W")], T0);
    expect(out).toHaveLength(1);
    expect(out[0]!.isControl).toBe(true);
  });
  it("a reflected damage spell only when it came back for ≥ 5 % of the caster's max HP", () => {
    const hitBack = (amt: number) => ({
      spellId: "686",
      srcUnitId: "Player-W",
      effectiveAmount: -amt,
      logLine: { timestamp: T0 + 5_100 },
    });
    const small = unit("Player-P", {
      missesOut: [miss("686")],
      damageIn: [hitBack(4_000)],
      advancedActions: advanced(500_000),
    });
    const big = unit("Player-P", {
      missesOut: [miss("686")],
      damageIn: [hitBack(300_000)],
      advancedActions: advanced(500_000),
    });
    expect(reflectedSpells([small, unit("Player-W")], T0)).toHaveLength(0);
    const out = reflectedSpells([big, unit("Player-W")], T0);
    expect(out).toHaveLength(1);
    expect(out[0]!.damageBack).toBe(300_000);
  });
});

describe("sanctuaryRemovals (0035285c)", () => {
  it("a Kidney Shot removed at the Sanctuary's millisecond; an unrelated removal a second later is not", () => {
    const pal = unit("Player-Pal", {
      spellCastEvents: [cast("210256", 10, "Player-H")],
    });
    const aura = (spellId: string, tS: number) => ({
      spellId,
      spellName: "x",
      srcUnitName: "Rogue-R-US",
      logLine: {
        event: LogEvent.SPELL_AURA_REMOVED,
        timestamp: T0 + tS * 1000,
      },
    });
    const hunter = unit("Player-H", {
      auraEvents: [aura("408", 10), aura("408", 11)],
    });
    const out = sanctuaryRemovals([pal, hunter], T0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ccSpellId: "408",
      ccSourceName: "Rogue-R-US",
    });
  });
});

describe("ownerRejectRuns (f4eb)", () => {
  const f = (t: number, reason: string, spellId = 6789) => ({
    tSeconds: t,
    unitGuid: "Player-O",
    spellId,
    spellName: "Mortal Coil",
    reason,
  });
  it("12 'Out of range' presses 2:39.9–2:42.3 are one run; two presses are not stated; GCD 'not ready' is never a run", () => {
    const hits = Array.from({ length: 12 }, (_, i) =>
      f(159.9 + i * 0.2, "Out of range"),
    );
    const runs = ownerRejectRuns(
      [
        ...hits,
        f(170, "Can't do that while moving", 111771),
        f(170.5, "Can't do that while moving", 111771),
        f(180, "Not yet recovered"),
        f(180.2, "Not yet recovered"),
        f(180.4, "Not yet recovered"),
      ],
      "Player-O",
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ count: 12, kind: "out of range" });
  });
  it("every locale's text is recognised", () => {
    const runs = ownerRejectRuns(
      [
        f(1, "超出范围"),
        f(1.5, "목표가 사정거리를 벗어났습니다."),
        f(2, "Fora de alcance"),
      ],
      "Player-O",
    );
    expect(runs).toHaveLength(1);
  });
});
