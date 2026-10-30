/**
 * The target's own absorb shields that end `defenseless` while up
 * (corpusFactScan2 defenselessSaveUp ownAbsorb, 2026-10-22): ruling (1)'s
 * Power Word: Shield / Void Shield ids pressed or not; any other aura DB2
 * calls an absorb only when the log shows it absorbing as the unit's own
 * shield AND the unit pressed it at the run's start (E6: a talent's passive
 * absorb — Frost Shield, Will of the Necropolis — is no shield it applied).
 * User ruling 1 (2026-10-28, fact6 F20): the PW:S family by DB2 class mask
 * (Unfolding Vision's copies) and a talent shield that rides another press
 * (`riderCastsOfShield`) count; passive procs and deferrals do not.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import abilityEffects from "../src/data/abilityEffectsGenerated.json";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  OWN_SHIELD_RULING_FAMILY_IDS,
  riderCastsOfShield,
  riderShieldPairs,
  riderStandsForUnloggedPress,
} from "../src/data/ownShieldLinks";
import {
  isOwnPressedShieldRun,
  ownPressedShieldSpansMs,
} from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const absorb = (spellId: string, owner = "u") => ({
  spellId,
  srcUnitId: owner,
  absorbedAmount: 10_000,
  timestamp: T + 500,
  logLine: { timestamp: T + 500 },
});
const cast = (spellId: string, ms: number) => ({
  spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
});
const unit = (absorbsIn: unknown[], casts: unknown[] = []) =>
  ({ id: "u", absorbsIn, spellCastEvents: casts }) as never;

describe("isOwnPressedShieldRun", () => {
  it("the ruling's shields count pressed or not (Holy's proc PW:S 1246768 has no cast row)", () => {
    for (const id of ["17", "1246768", "1253593"])
      expect(isOwnPressedShieldRun(unit([]), id, T), id).toBe(true);
  });
  it("a pressed Blazing Barrier that absorbed counts; unpressed, or with no absorb row, it does not", () => {
    const BB = "235313";
    expect(
      isOwnPressedShieldRun(unit([absorb(BB)], [cast(BB, T)]), BB, T),
    ).toBe(true);
    expect(isOwnPressedShieldRun(unit([absorb(BB)]), BB, T)).toBe(false);
    expect(isOwnPressedShieldRun(unit([], [cast(BB, T)]), BB, T)).toBe(false);
    // a shield an ally owns is not the unit's own
    expect(
      isOwnPressedShieldRun(unit([absorb(BB, "ally")], [cast(BB, T)]), BB, T),
    ).toBe(false);
  });
  it("a shield re-applied by its own buff long after the press still counts (Holy Bulwark 432607, 12 s after it)", () => {
    const HB = "432607";
    expect(
      isOwnPressedShieldRun(unit([absorb(HB)], [cast(HB, T - 12_000)]), HB, T),
    ).toBe(true);
    // past the 60 s lookback it is no longer that press's
    expect(
      isOwnPressedShieldRun(unit([absorb(HB)], [cast(HB, T - 61_000)]), HB, T),
    ).toBe(false);
  });
  it("a run kept up by REFRESH counts only within a minute of a press (b42: Holy Bulwark 6:33–6:43)", () => {
    const HB = "432607";
    const spans = ownPressedShieldSpansMs(
      unit([absorb(HB)], [cast(HB, T)]),
      HB,
      T - 5_000,
      T + 90_000,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]!.toMs).toBe(T + 60_000);
    // the ruling's shields: the whole run
    expect(ownPressedShieldSpansMs(unit([]), "17", T, T + 90_000)).toEqual([
      { fromMs: T, toMs: T + 90_000 },
    ]);
  });
  it("a passive talent absorb (Frost Shield 207203) never counts — no press", () => {
    expect(isOwnPressedShieldRun(unit([absorb("207203")]), "207203", T)).toBe(
      false,
    );
  });
  it("Unfolding Vision's copies are ruling (1)'s shields by DB2 family (fact6 D15 D16 D18)", () => {
    // 3b2585b5 0:38.8: `Void Shield (Unfolding Vision)` 1300009 went up on
    // the priest as her own shield ended — no cast row of it, ever
    for (const id of ["1300008", "1300009"])
      expect(isOwnPressedShieldRun(unit([]), id, T), id).toBe(true);
  });
  it("a talent shield that rides another press counts with that press (fact6 D21: Chi Cocoon)", () => {
    // 406220 goes up in the ms of Invoke Chi-Ji 325197, 1260681 with an
    // Enveloping Mist 124682 — DB2 has no cast → aura chain for either
    expect(
      isOwnPressedShieldRun(
        unit([absorb("406220")], [cast("325197", T)]),
        "406220",
        T,
      ),
    ).toBe(true);
    expect(
      isOwnPressedShieldRun(
        unit([absorb("1260681")], [cast("124682", T - 10)]),
        "1260681",
        T,
      ),
    ).toBe(true);
    // its carrier pressed this round, but not in the minute before: no
    // press of this run
    expect(
      isOwnPressedShieldRun(
        unit([absorb("406220")], [cast("325197", T - 61_000)]),
        "406220",
        T,
      ),
    ).toBe(false);
  });
  it("a rider whose carrying press the log never shows this round stands for that press (codex 20-F20-12 P2: the Devourer's Shift → First In, Last Out)", () => {
    // 20c23c12 r1: FILO 1266619 2:14.400–2:16.298, ate 49k, no Fel Rush
    // 195072 in the round (Shift writes no cast row) — inside `defenseless
    // 2:02–2:19`
    const FILO = "1266619";
    expect(
      isOwnPressedShieldRun(unit([absorb(FILO)], [cast("162794", T)]), FILO, T),
    ).toBe(true);
    // its span: the run, up to a minute
    expect(
      ownPressedShieldSpansMs(unit([absorb(FILO)]), FILO, T, T + 90_000),
    ).toEqual([{ fromMs: T, toMs: T + 60_000 }]);
    // a holder that logged a Fel Rush this round reads its presses
    expect(
      isOwnPressedShieldRun(
        unit([absorb(FILO)], [cast("195072", T - 61_000)]),
        FILO,
        T,
      ),
    ).toBe(false);
    // still a shield only when it absorbed for the unit
    expect(isOwnPressedShieldRun(unit([]), FILO, T)).toBe(false);
    // a passive proc is no rider: no press, no shield
    expect(isOwnPressedShieldRun(unit([absorb("47753")]), "47753", T)).toBe(
      false,
    );
    // a rider whose own id is a logged press (Ice Barrier 11426, carried by
    // Blazing Barrier 235313 on a fire mage) does not stand in: a frost
    // mage's run with no press of it in the minute before is no press
    expect(riderStandsForUnloggedPress("11426")).toBe(false);
    expect(riderStandsForUnloggedPress(FILO)).toBe(true);
    expect(isOwnPressedShieldRun(unit([absorb("11426")]), "11426", T)).toBe(
      false,
    );
    expect(
      isOwnPressedShieldRun(
        unit([absorb("11426")], [cast("11426", T - 1_000)]),
        "11426",
        T,
      ),
    ).toBe(true);
  });
  it("a passive proc beside a press stays passive (user ruling 1: Divine Aegis, Soul Leech)", () => {
    // 6be60aae 2:09.6: Divine Aegis 47753 off a Power Word: Radiance 194509
    // crit, 1 ms after the cast
    expect(
      isOwnPressedShieldRun(
        unit([absorb("47753")], [cast("194509", T - 1)]),
        "47753",
        T,
      ),
    ).toBe(false);
    expect(
      isOwnPressedShieldRun(
        unit([absorb("108366")], [cast("686", T - 1)]),
        "108366",
        T,
      ),
    ).toBe(false);
  });
});

describe("ownShieldLinks (generated: ownShieldLinkScan.ts)", () => {
  it("ruling (1)'s DB2 family is PW:S, Void Shield, Holy's proc PW:S and Unfolding Vision's copies", () => {
    expect([...OWN_SHIELD_RULING_FAMILY_IDS].sort()).toEqual(
      ["1246768", "1253593", "1300008", "1300009", "17"].sort(),
    );
  });
  it("Chi Cocoon rides Invoke Chi-Ji / Enveloping Mist; passive procs and deferrals are no riders", () => {
    expect(riderCastsOfShield("406220")).toContain("325197");
    expect(riderCastsOfShield("1260681")).toContain("124682");
    // Divine Aegis, Soul Leech, Yu'lon's Grace, Angelic Bulwark, Stretch Time
    for (const id of ["47753", "108366", "414143", "114214", "410355"])
      expect(riderCastsOfShield(id), id).toEqual([]);
  });
  it("605 re-measure: Purification (no SpellClassOptions row) rides Purify, Chi Cocoon 406139 Invoke Yu'lon, First In, Last Out Fel Rush; auras that never absorb are no riders", () => {
    expect(riderCastsOfShield("196440")).toContain("527");
    expect(riderCastsOfShield("406139")).toContain("322118");
    // 1,332 / 1,332 over the holders that logged a Fel Rush; the Devourer's
    // Shift writes no cast row and is left out of the rate
    expect(riderCastsOfShield("1266619")).toContain("195072");
    // Glimpse (a 20 % reduction, 0 of 1,172 applications absorbed),
    // Masterwork: Bulwark (a trigger, 0 of 794), Worldsoul Cradle (an
    // enchant's proc beside scattered presses)
    for (const id of ["354610", "1271383", "1242003"])
      expect(riderCastsOfShield(id), id).toEqual([]);
  });
  it("a shield carried by another press and pressed as itself on the rest is a rider (F20 wide residual: Reversion 367364 with Merithra's Blessing)", () => {
    // 8448004d r2: Reversion 367364 up on the evoker at 1:09.75 in the ms of
    // her own Merithra's Blessing 1256581 (refreshed by the next one at
    // 1:24.1), up to 1:43.37 — her last Reversion press was 1:12 before the
    // span; read as defenseless from 1:32
    expect(riderCastsOfShield("367364")).toEqual(["1256581"]);
    const REV = "367364";
    expect(
      isOwnPressedShieldRun(unit([absorb(REV)], [cast("1256581", T)]), REV, T),
    ).toBe(true);
    // its own Reversion press links by name, as before
    expect(
      isOwnPressedShieldRun(unit([absorb(REV)], [cast("366155", T)]), REV, T),
    ).toBe(true);
    // the HoT itself (366155: 72 % pressed, Hover / Merithra's Blessing
    // neighbours) is no rider
    expect(riderCastsOfShield("366155")).toEqual([]);
    // codex F20-25: pressed as itself under another id (366155), so its
    // application never stands for an unlogged carrier — no Merithra's
    // Blessing this round and the last Reversion press 61 s back is no
    // protection (it was 60 s with the fallback)
    expect(riderStandsForUnloggedPress(REV)).toBe(false);
    expect(
      ownPressedShieldSpansMs(
        unit([absorb(REV)], [cast("366155", T - 61_000)]),
        REV,
        T,
        T + 90_000,
      ),
    ).toEqual([]);
  });
  it("every rider is a DB2 absorb", () => {
    for (const [aura] of riderShieldPairs())
      expect(
        (abilityEffects as Record<string, { absorbs?: boolean }>)[aura]
          ?.absorbs,
        aura,
      ).toBe(true);
  });
});
