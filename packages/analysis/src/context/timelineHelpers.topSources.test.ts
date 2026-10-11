/**
 * `Top sources:` / `Top damage in final Ns:` labels (2026-09-15): a summon
 * that logs with NPC flags instead of Pet/Guardian (a Death Knight's ghoul,
 * 0xa28) bypassed the B24 `[pet]` relabel and printed its client-locale
 * name — the last CJK leak standing after the KILL ATTEMPTS / [ROOT] fixes
 * (9 of 309 prompts). Same rule as `actorLabel`: not a player, not ASCII →
 * `[pet]`; an ASCII summon keeps its name.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  getTopDamageSourcesInWindow,
  TOP_SOURCE_MIXED_SCHOOL_RE,
} from "./timelineHelpers";

const T0 = 1_000_000;
/** hostile NPC, straight from a zh-client log line (`"次级食尸鬼",0xa28`) */
const HOSTILE_NPC = 0xa28;
/** hostile player */
const HOSTILE_PLAYER = 0x548;

const hit = (srcUnitName: string, srcUnitFlags: number, amount: number) => ({
  logLine: { timestamp: T0 + 5_000 },
  effectiveAmount: -amount,
  srcUnitName,
  srcUnitFlags,
  spellId: "",
  spellName: "Death Order",
});

const victim = (damageIn: unknown[]) =>
  ({ reaction: CombatUnitReaction.Friendly, damageIn }) as never;

describe("getTopDamageSourcesInWindow — summon labels", () => {
  it("a localized NPC-flagged summon → [pet]; an ASCII one keeps its short name", () => {
    const out = getTopDamageSourcesInWindow(
      victim([
        hit("次级食尸鬼", HOSTILE_NPC, 107_000),
        hit("Earthgrab Totem-Illidan-US", HOSTILE_NPC, 50_000),
      ]),
      T0 + 10_000,
      10_000,
      3,
      new Map(),
      new Map(),
    );
    expect(out[0]).toBe("[pet] — Death Order (107k)");
    expect(out[1]).toBe("Earthgrab Totem — Death Order (50k)");
    expect(out.join("\n")).not.toMatch(/[一-鿿]/);
  });

  it("a player source resolves to its roster id, never the name", () => {
    const out = getTopDamageSourcesInWindow(
      victim([hit("Deathlord-Illidan-US", HOSTILE_PLAYER, 90_000)]),
      T0 + 10_000,
      10_000,
      3,
      new Map(),
      new Map([["Deathlord-Illidan-US", 4]]),
    );
    expect(out[0]).toBe("4 — Death Order (90k)");
  });
});

describe("getTopDamageSourcesInWindow — absorbed parts of hits (round 3 N13, b12b)", () => {
  it("a shield-eaten part joins its hit's line and is stated; a friendly attacker's absorb is not counted", () => {
    const dmg = {
      logLine: { timestamp: T0 + 5_000 },
      effectiveAmount: -43_000,
      srcUnitId: "Player-B",
      srcUnitName: "Boomy-Illidan-US",
      srcUnitFlags: HOSTILE_PLAYER,
      spellId: "78674",
      spellName: "Starsurge",
    };
    const absorb = (amt: number, flags: number) => ({
      timestamp: T0 + 5_000,
      absorbedAmount: amt,
      attackerId: "Player-B",
      attackSpellId: "78674",
      attackSpellName: "Starsurge",
      srcUnitFlags: flags,
      logLine: { timestamp: T0 + 5_000, parameters: ["Player-B", "Boomy-Illidan-US"] },
    });
    const unit = {
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [dmg],
      absorbsIn: [absorb(108_000, HOSTILE_PLAYER), absorb(50_000, 0x511)],
    } as never;
    const out = getTopDamageSourcesInWindow(unit, T0 + 10_000, 10_000, 3, new Map(), new Map([["Boomy-Illidan-US", 5]]));
    expect(out).toEqual(["5 — Starsurge (151k; 108k of it absorbed)"]);
  });

  it("FT-T02b: what Time Dilation only delayed is not \"absorbed\" — it is the deferred row when it lands", () => {
    const hit = {
      logLine: { timestamp: T0 + 5_000 },
      effectiveAmount: -60_000,
      srcUnitId: "Player-B",
      srcUnitName: "Boomy-Illidan-US",
      srcUnitFlags: HOSTILE_PLAYER,
      spellId: "78674",
      spellName: "Starsurge",
    };
    const delayed = {
      timestamp: T0 + 5_000,
      absorbedAmount: 60_000,
      spellId: "357170",
      spellName: "Time Dilation",
      attackerId: "Player-B",
      attackSpellId: "78674",
      attackSpellName: "Starsurge",
      srcUnitFlags: HOSTILE_PLAYER,
      logLine: { timestamp: T0 + 5_000, parameters: ["Player-B", "Boomy-Illidan-US"] },
    };
    const tick = {
      logLine: { timestamp: T0 + 7_000 },
      effectiveAmount: -20_000,
      srcUnitId: "Player-V",
      srcUnitName: "Victim-Illidan-US",
      srcUnitFlags: 0x511,
      spellId: "361029",
      spellName: "Time Dilation",
    };
    const unit = {
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [hit, tick],
      absorbsIn: [delayed],
    } as never;
    const out = getTopDamageSourcesInWindow(unit, T0 + 10_000, 10_000, 3, new Map(), new Map([["Boomy-Illidan-US", 5]]));
    expect(out).toEqual(["5 — Starsurge (60k)", "deferred Time Dilation (own) (20k)"]);
  });
});

// FT F22 (b): one ability is logged under several spell ids, and they do not
// all carry the same school tag — the list named one source + ability twice
// (312 of 20,847 lists on the 605-file capture).
describe("getTopDamageSourcesInWindow — one entry per ability of a source (FT F22)", () => {
  const dmg = (spellId: string, spellName: string, school: string, amount: number, src = "Player-R") => ({
    logLine: { timestamp: T0 + 5_000 },
    effectiveAmount: -amount,
    srcUnitId: src,
    srcUnitName: src === "Player-R" ? "Rogue-Illidan-US" : "Other-Illidan-US",
    srcUnitFlags: HOSTILE_PLAYER,
    spellId,
    spellName,
    spellSchoolId: school,
  });
  const ids = new Map([
    ["Rogue-Illidan-US", 4],
    ["Other-Illidan-US", 5],
  ]);
  // the callers' GUID → name map: an absorb row names its attacker by GUID only
  const names = new Map([["Player-R", "Rogue-Illidan-US"]]);
  const top = (unit: unknown) => getTopDamageSourcesInWindow(unit as never, T0 + 10_000, 10_000, 3, new Map(), ids, undefined, names);

  it("1b930c17: Eviscerate 196819 (Physical) + its Shadow half 328082 are one entry, both schools named, largest first", () => {
    const out = top({
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [
        dmg("196819", "Eviscerate", "0x1", 85_000),
        dmg("328082", "Eviscerate", "0x20", 69_000),
        dmg("999001", "Tempest", "0x8", 70_000, "Player-S"),
      ],
    });
    expect(out).toEqual(["4 — Eviscerate [Physical + Shadow] (154k)", "5 — Tempest [Nature] (70k)"]);
    expect(TOP_SOURCE_MIXED_SCHOOL_RE.test(`Top sources: ${out.join(", ")}`)).toBe(true);
    // the same ability from ANOTHER source stays its own entry
    const two = top({
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [dmg("196819", "Eviscerate", "0x1", 85_000), dmg("196819", "Eviscerate", "0x1", 60_000, "Player-S")],
    });
    expect(two).toEqual(["4 — Eviscerate [Physical] (85k)", "5 — Eviscerate [Physical] (60k)"]);
    expect(TOP_SOURCE_MIXED_SCHOOL_RE.test(`Top sources: ${two.join(", ")}`)).toBe(false);
  });

  it("f94a7604: The Hunt's impact absorbed whole (no damage row, no school) joins its DoT's entry", () => {
    const out = top({
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [dmg("370969", "The Hunt", "0x7c", 108_000)],
      absorbsIn: [
        {
          timestamp: T0 + 4_000,
          absorbedAmount: 116_000,
          attackerId: "Player-R",
          attackSpellId: "370966",
          attackSpellName: "The Hunt",
          srcUnitFlags: HOSTILE_PLAYER,
          logLine: { timestamp: T0 + 4_000, parameters: [] },
        },
      ],
    });
    expect(out).toEqual(["4 — The Hunt [Chaos] (224k; 116k of it absorbed)"]);
  });

  it("an ability under a different name is not folded in (Eviscerate (Coup de Grace))", () => {
    const out = top({
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [dmg("196819", "Eviscerate", "0x1", 85_000), dmg("999002", "Eviscerate (Coup de Grace)", "0x1", 75_000)],
    });
    expect(out).toEqual(["4 — Eviscerate [Physical] (85k)", "4 — Eviscerate (Coup de Grace) [Physical] (75k)"]);
  });
});
