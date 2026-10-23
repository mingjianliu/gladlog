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
import { sanctuaryRemovesControl } from "../src/utils/sanctuaryRemovals";

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
    // the totem's outcome line (SPELL_MISSED IMMUNE, as in 7d1f) — required
    // since the codex review of batch 13
    const immune = (spellId: string, s: number) => ({
      spellId,
      destUnitId: TOTEM,
      missType: "IMMUNE",
      logLine: { timestamp: T0 + s * 1000 },
    });
    const mage = unit("Player-M", {
      spellCastEvents: [cast("118", 6.4, TOTEM), cast("108853", 7.8, TOTEM)],
      missesOut: [immune("118", 6.4), immune("108853", 7.8)],
    });
    const owner = unit("Player-O", {
      spellCastEvents: [cast("33786", 9, TOTEM)],
    });
    const out = groundedControls([mage, owner], T0, new Set(["Player-O"]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ casterId: "Player-M", spellId: "118" });
  });

  it("F-E27: a trap eaten by the totem (IMMUNE miss, no cast aimed at it) is stated — the owner's too", () => {
    // c2058ed4 L5985: Freezing Trap cast 187650 has no destination; the only
    // trace is `SPELL_MISSED … Grounding Totem … 3355 IMMUNE`.
    const trapMiss = (s: number) => ({
      spellId: "3355",
      spellName: "冰冻陷阱",
      destUnitId: TOTEM,
      missType: "IMMUNE",
      logLine: { timestamp: T0 + s * 1000 },
    });
    const hunter = unit("Player-H", {
      spellCastEvents: [cast("187650", 53.9, "")],
      missesOut: [trapMiss(54.407), trapMiss(115.204)],
    });
    const out = groundedControls([hunter], T0, new Set(["Player-H"]));
    expect(out.map((g) => [g.spellId, g.spellName, g.atSeconds])).toEqual([
      ["3355", "Freezing Trap", 54.407],
      ["3355", "Freezing Trap", 115.204],
    ]);
  });

  it("F-E27: a miss following the caster's own cast into that totem is the same redirect", () => {
    const mage = unit("Player-M", {
      spellCastEvents: [cast("118", 6.4, TOTEM)],
      missesOut: [
        {
          spellId: "118",
          destUnitId: TOTEM,
          missType: "IMMUNE",
          logLine: { timestamp: T0 + 7_000 },
        },
      ],
    });
    expect(groundedControls([mage], T0, new Set())).toHaveLength(1);
  });

  it("F-E27 (codex review): a cast and its miss logged under another id of the same spell are one redirect", () => {
    // Fear: cast 5782 into the totem, the IMMUNE miss on the aura id 118699
    const lock = unit("Player-W", {
      spellCastEvents: [cast("5782", 10, TOTEM)],
      missesOut: [
        {
          spellId: "118699",
          destUnitId: TOTEM,
          missType: "IMMUNE",
          logLine: { timestamp: T0 + 10_100 },
        },
      ],
    });
    const out = groundedControls([lock], T0, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ spellId: "5782" });
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
  it("corpusFactScan reflectReturn: the return under the spell's damage id (Frostfire Bolt 431044 → 468655), logged just before the REFLECT row", () => {
    const caster = unit("Player-P", {
      missesOut: [miss("431044")],
      damageIn: [
        {
          spellId: "468655",
          srcUnitId: "Player-W",
          effectiveAmount: -112_000,
          logLine: { timestamp: T0 + 4_990 },
        },
      ],
      advancedActions: advanced(500_000),
    });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    expect(r!.damageBack).toBe(112_000);
  });
  it("a scripted damage spell the profile misses (Fel Lance) owns the reflector's own-id return when its caster's hits of it are in the round", () => {
    const FEL_LANCE = "206966";
    const caster = unit("Player-P", {
      missesOut: [miss(FEL_LANCE)],
      damageIn: [
        {
          spellId: "23920",
          srcUnitId: "Player-W",
          effectiveAmount: -133_000,
          logLine: { timestamp: T0 + 6_200 },
        },
      ],
      advancedActions: advanced(500_000),
    });
    const mate = unit("Player-M", {
      damageIn: [
        {
          spellId: FEL_LANCE,
          srcUnitId: "Player-P",
          effectiveAmount: -40_000,
          logLine: { timestamp: T0 + 2_000 },
        },
      ],
    });
    const [r] = reflectedSpells([caster, unit("Player-W"), mate], T0);
    expect(r!.damageBack).toBe(133_000);
  });
  it("a dispel backlash of the reflected spell's name (Unstable Affliction 196364) is not the return", () => {
    const UA = "1259790";
    const caster = unit("Player-P", {
      missesOut: [miss(UA)],
      damageIn: [
        {
          spellId: UA,
          srcUnitId: "Player-P",
          effectiveAmount: -61_500,
          logLine: { timestamp: T0 + 6_000 },
        },
        {
          spellId: "196364",
          srcUnitId: "Player-P",
          effectiveAmount: -127_700,
          logLine: { timestamp: T0 + 9_000 },
        },
      ],
      advancedActions: advanced(500_000),
    });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    expect(r!.damageBack).toBe(61_500);
  });
  it("fact3 D15 / D40: the reflector's own copy of the DoT on the caster is not the return; the copy ticking caster → caster is", () => {
    const AGONY = "980";
    const tick = (src: string, amt: number, ms: number) => ({
      spellId: AGONY,
      srcUnitId: src,
      effectiveAmount: -amt,
      logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: T0 + ms },
    });
    const ownAgony = {
      spellId: AGONY,
      srcUnitId: "Player-W",
      destUnitId: "Player-P",
      logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: T0 + 1_000 },
    };
    const caster = unit("Player-P", {
      missesOut: [miss(AGONY)],
      auraEvents: [ownAgony],
      damageIn: [
        tick("Player-P", 40_000, 7_000), // the reflected copy
        tick("Player-W", 60_000, 8_000), // the reflector's own Agony
      ],
      advancedActions: advanced(500_000),
    });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    expect(r!.damageBack).toBe(40_000);
  });
  it("a copy the reflect itself applied, logged reflector → caster (Wither 445474 147 ms after the row), is the return, not the reflector's own", () => {
    const WITHER = "445474";
    const tick = (amt: number, ms: number) => ({
      spellId: WITHER,
      srcUnitId: "Player-W",
      effectiveAmount: -amt,
      logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: T0 + ms },
    });
    const aura = (event: LogEvent, ms: number) => ({
      spellId: WITHER,
      srcUnitId: "Player-W",
      destUnitId: "Player-P",
      logLine: { event, timestamp: T0 + ms },
    });
    const caster = unit("Player-P", {
      missesOut: [miss(WITHER)],
      auraEvents: [
        // the reflector's own Wither, gone 2 s before the reflect
        aura(LogEvent.SPELL_AURA_APPLIED, 0),
        aura(LogEvent.SPELL_AURA_REMOVED, 3_000),
        // the reflected copy
        aura(LogEvent.SPELL_AURA_APPLIED, 5_147),
      ],
      damageIn: [tick(30_000, 2_000), tick(6_000, 7_500), tick(6_000, 8_700)],
      advancedActions: advanced(200_000),
    });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    expect(r!.damageBack).toBe(12_000);
  });
  it("a hit of the spell the reflector sends after the projectile's flight, outside a copy the reflect put up, is its own (Shadow of Nathreza mirror)", () => {
    const SON = "1262710";
    const hit = (amt: number, ms: number) => ({
      spellId: SON,
      srcUnitId: "Player-W",
      effectiveAmount: -amt,
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: T0 + ms },
    });
    const caster = unit("Player-P", {
      missesOut: [miss(SON)],
      damageIn: [
        hit(5_553, 5_000), // the return, in the REFLECT row's ms
        hit(5_925, 9_000), // the reflector's own pulses
        hit(5_925, 10_000),
      ],
      advancedActions: advanced(100_000),
    });
    const [r] = reflectedSpells([caster, unit("Player-W")], T0);
    expect(r!.damageBack).toBe(5_553);
  });
  it("an own-id return goes to the chain whose nearest REFLECT row is closest, not the chain's first row (two Wicked Reapings, a Demonbolt between)", () => {
    const WR = "449826";
    const DB = "264178";
    const reflect = (spellId: string, ms: number) => ({
      ...miss(spellId),
      logLine: { timestamp: T0 + ms },
    });
    const nw = (amt: number, ms: number) => ({
      spellId: "212295",
      srcUnitId: "Player-W",
      effectiveAmount: -amt,
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: T0 + ms },
    });
    const caster = unit("Player-P", {
      // 50-1 2:17's timings: WR 44.788 / 45.874, Demonbolt 45.539 / 46.643;
      // Nether Ward rows 44.789, 45.874, 46.289
      missesOut: [
        reflect(WR, 5_000),
        reflect(DB, 5_751),
        reflect(WR, 6_086),
        reflect(DB, 6_855),
      ],
      damageIn: [nw(59_508, 5_001), nw(59_508, 6_086), nw(60_696, 6_501)],
      advancedActions: advanced(300_000),
    });
    const out = reflectedSpells([caster, unit("Player-W")], T0);
    const back = (id: string) => out.find((x) => x.spellId === id)!.damageBack;
    expect(back(WR)).toBe(119_016);
    expect(back(DB)).toBe(60_696);
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

describe("sanctuaryRemovals — the mechanics Blessing of Sanctuary removes (fact4 D40)", () => {
  it("a silence (Strangulate) is removed; an incapacitate (Polymorph) or a root (Earthbind) at the same ms is not", () => {
    const pal = unit("Player-Pal", {
      spellCastEvents: [cast("210256", 10, "Player-H")],
    });
    const aura = (spellId: string) => ({
      spellId,
      spellName: "x",
      srcUnitName: "Enemy-R-US",
      logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 10_000 },
    });
    const holder = unit("Player-H", {
      auraEvents: [aura("47476"), aura("118"), aura("116947")],
    });
    expect(sanctuaryRemovals([pal, holder], T0).map((r) => r.ccSpellId)).toEqual([
      "47476",
    ]);
    expect(sanctuaryRemovesControl("853")).toBe(true); // Hammer of Justice, stun
    expect(sanctuaryRemovesControl("8122")).toBe(true); // Psychic Scream, fear
    expect(sanctuaryRemovesControl("6789")).toBe(true); // Mortal Coil, horror
    expect(sanctuaryRemovesControl("2094")).toBe(false); // Blind, disorient
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
