/* eslint-disable @typescript-eslint/no-explicit-any -- the scan's readers walk untyped legacy aura / cast rows; the fixtures build them */
import { ccFullDurationSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import spellEffectGenerated from "@gladlog/analysis/src/data/spellEffectGenerated.json";
import spellMechanicsGenerated from "@gladlog/analysis/src/data/spellMechanicsGenerated.json";
import {
  CC_AVOIDANCE_BUFF_SPELLS,
  MECHANIC_LIMITED_AVOIDANCE_BUFFS,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { getDRCategory } from "@gladlog/analysis/src/utils/drAnalysis";
import { OWN_SHIELD_PRESS_LOOKBACK_MS } from "@gladlog/analysis/src/utils/enemyDefensives";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  cannotCauseOf,
  CAPPED_UNCLOSED,
  controlApplications,
  diminishedBoundS,
  drChain,
  E6_OWN_SHIELD_PRESS_WINDOW_MS,
  isUnclosedApp,
  unclosedAuraCapS,
  upAtRows,
} from "../scripts/corpusFactScan2";

// codex 21-R12-c (corpusFactScan2 review) — its three synthetic false
// negatives, rebuilt on legacy-shaped rows and driven through the scan's own
// readers.

const T = "Player-1-0000000T"; // the target
const M = "Player-1-0000000M"; // a mage
const P = "Player-1-0000000P"; // a paladin

const DIVINE_SHIELD = "642";
const BEAST_WITHIN = "212704";
const HAMMER_OF_JUSTICE = "853";
const FEAR = "5782";
const BOP = "1022";
const POLYMORPH = "118";

let line = 0;
const aura = (
  event: string,
  ms: number,
  spellId: string,
  src: string,
  dst: string,
  auraType = "BUFF",
) => ({
  spellId,
  spellName: "",
  srcUnitId: src,
  destUnitId: dst,
  auraType,
  timestamp: ms,
  logLine: { event, timestamp: ms, lineIndex: line++ },
});
const cast = (ms: number, spellId: string, src: string, dst: string) => ({
  spellId,
  spellName: "",
  srcUnitId: src,
  destUnitId: dst,
  timestamp: ms,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS as string,
    timestamp: ms,
    lineIndex: line++,
  },
});
const APPLIED = LogEvent.SPELL_AURA_APPLIED as string;
const REMOVED = LogEvent.SPELL_AURA_REMOVED as string;
const REFRESH = LogEvent.SPELL_AURA_REFRESH as string;
const REMOVED_DOSE = LogEvent.SPELL_AURA_REMOVED_DOSE as string;

describe("premises — the ids the fixtures stand on, read off the committed data", () => {
  it("The Beast Within 212704 is a mechanic-limited listed avoidance with DB2 mechanics [5, 24]; Hammer of Justice is mechanic 12, Fear 5", () => {
    expect(MECHANIC_LIMITED_AVOIDANCE_BUFFS.has(BEAST_WITHIN)).toBe(true);
    expect(CC_AVOIDANCE_BUFF_SPELLS.has(BEAST_WITHIN)).toBe(true);
    const mech = (spellMechanicsGenerated as any).spells;
    expect(mech[BEAST_WITHIN].immuneMech).toEqual([5, 24]);
    expect(ccMechanicOf(HAMMER_OF_JUSTICE)).toBe(12);
    expect(ccMechanicOf(FEAR)).toBe(5);
  });
  it("Divine Shield has an official length of 8 s", () => {
    expect((spellEffectGenerated as any)[DIVINE_SHIELD].durationSeconds).toBe(
      8,
    );
  });
  it("Polymorph 118 is an Incapacitate with an official length", () => {
    expect(getDRCategory(POLYMORPH)).toBe("Incapacitate");
    expect(ccFullDurationSeconds(POLYMORPH)).toBeGreaterThan(4);
  });
});

describe("codex 21-R12-c #1 — a listed aura must still be able to stop the control", () => {
  it("The Beast Within named for an IMMUNE Hammer of Justice cannot have caused it (mechanic 12 ∉ [5, 24])", () => {
    expect(
      cannotCauseOf(
        "The Beast Within",
        "IMMUNE",
        new Set([BEAST_WITHIN]),
        HAMMER_OF_JUSTICE,
        "Hammer of Justice",
      ),
    ).toBe("listed:mechanic");
  });
  it("…while it does stop a Fear (mechanic 5) — no violation", () => {
    expect(
      cannotCauseOf(
        "The Beast Within",
        "IMMUNE",
        new Set([BEAST_WITHIN]),
        FEAR,
        "Fear",
      ),
    ).toBeUndefined();
  });
  it("Divine Shield (all schools) stops a Hammer of Justice; Blessing of Protection (physical only) does not stop a Holy one", () => {
    expect(
      cannotCauseOf(
        "Divine Shield",
        "IMMUNE",
        new Set([DIVINE_SHIELD]),
        HAMMER_OF_JUSTICE,
        "Hammer of Justice",
      ),
    ).toBeUndefined();
    expect(
      cannotCauseOf(
        "Blessing of Protection",
        "IMMUNE",
        new Set([BOP]),
        HAMMER_OF_JUSTICE,
        "Hammer of Justice",
      ),
    ).toBe("listed:school");
  });
  it("a `did not land` line is not judged", () => {
    expect(
      cannotCauseOf(
        "The Beast Within",
        "didNotLand",
        new Set([BEAST_WITHIN]),
        HAMMER_OF_JUSTICE,
        "Hammer of Justice",
      ),
    ).toBeUndefined();
  });
  it("a same-ms twin miss row of the line's name counts (183-1-1098 0:22: Metamorphosis 247121, mechanic 11, beside its stun 200166 — Icebound Fortitude stops the stun)", () => {
    const IBF = "48792";
    expect(ccMechanicOf("247121")).toBe(11);
    expect(ccMechanicOf("200166")).toBe(12);
    expect(
      cannotCauseOf(
        "Icebound Fortitude",
        "MISS",
        new Set([IBF]),
        "247121",
        "Metamorphosis",
      ),
    ).toBe("listed:mechanic");
    expect(
      cannotCauseOf(
        "Icebound Fortitude",
        "MISS",
        new Set([IBF]),
        "247121",
        "Metamorphosis",
        ["247121", "200166"],
      ),
    ).toBeUndefined();
  });
});

describe("codex 21-R12-c #2 — an immunity the log never closes holds only its official length", () => {
  const isDS = (a: any) => a.spellId === DIVINE_SHIELD;
  it("Divine Shield APPLIED at 1 s with no later row is not up at 30 s", () => {
    const rows = [aura(APPLIED, 1000, DIVINE_SHIELD, T, T)];
    expect(upAtRows(rows, isDS, 30_000, -1, CAPPED_UNCLOSED)).toEqual([]);
  });
  it("…but is up at 5 s", () => {
    const rows = [aura(APPLIED, 1000, DIVINE_SHIELD, T, T)];
    expect(upAtRows(rows, isDS, 5000, -1, CAPPED_UNCLOSED)).toHaveLength(1);
  });
  it("an application the log closes later holds to its REMOVED (production's reading: only an unclosed one is capped)", () => {
    const rows = [
      aura(APPLIED, 1000, DIVINE_SHIELD, T, T),
      aura(REMOVED, 40_000, DIVINE_SHIELD, T, T),
    ];
    expect(upAtRows(rows, isDS, 30_000, -1, CAPPED_UNCLOSED)).toHaveLength(1);
  });
});

describe("codex 30-RV-04 #2 — a dose row neither restarts an application's cap nor closes it", () => {
  const NULLIFYING_SHROUD = "378464";
  const isNS = (a: any) => a.spellId === NULLIFYING_SHROUD;
  it("Nullifying Shroud (3 s → cap 4 s): APPLIED 1 s, REMOVED_DOSE 3 s, no REMOVED — gone at 6.5 s", () => {
    expect(unclosedAuraCapS(NULLIFYING_SHROUD)).toBe(4);
    const rows = [
      aura(APPLIED, 1000, NULLIFYING_SHROUD, T, T),
      aura(REMOVED_DOSE, 3000, NULLIFYING_SHROUD, T, T),
    ];
    expect(upAtRows(rows, isNS, 6500, -1, CAPPED_UNCLOSED)).toEqual([]);
    // still up inside its own length
    expect(upAtRows(rows, isNS, 4500, -1, CAPPED_UNCLOSED)).toHaveLength(1);
  });
  it("APPLIED 1 s, REMOVED_DOSE 20 s, REMOVED 21 s: the REMOVED closes it, so it holds at 18 s", () => {
    const rows = [
      aura(APPLIED, 1000, NULLIFYING_SHROUD, T, T),
      aura(REMOVED_DOSE, 20_000, NULLIFYING_SHROUD, T, T),
      aura(REMOVED, 21_000, NULLIFYING_SHROUD, T, T),
    ];
    expect(upAtRows(rows, isNS, 18_000, -1, CAPPED_UNCLOSED)).toHaveLength(1);
  });
});

describe("codex 21-R12-c #3 — a cast-backed REFRESH is a new control application", () => {
  const mageCasts = [cast(1000, POLYMORPH, M, T), cast(4000, POLYMORPH, M, T)];
  const castsOf = (id: string) => (id === M ? mageCasts : []);
  const rows = [
    aura(APPLIED, 1000, POLYMORPH, M, T, "DEBUFF"),
    aura(REFRESH, 4000, POLYMORPH, M, T, "DEBUFF"),
  ];
  it("Polymorph at 1 s, recast with a logged REFRESH at 4 s: two applications, the first ending at the recast", () => {
    const apps = controlApplications(rows, T, castsOf);
    expect(apps.map((a) => a.ts)).toEqual([1000, 4000]);
    expect(apps[0]!.end).toBe(4000);
    expect(apps[1]!.refresh).toBe(true);
  });
  it("the REFRESH application is the 2nd of its family, never closed, and a printed (6s) breaks the 50 % bound", () => {
    const apps = controlApplications(rows, T, castsOf);
    const second = apps[1]!;
    expect(isUnclosedApp(rows, second)).toBe(true);
    expect(isUnclosedApp(rows, apps[0]!)).toBe(false);
    const prior = drChain(apps, second.cat, second.ts, second.src);
    expect(prior).toHaveLength(1);
    const base = ccFullDurationSeconds(POLYMORPH)!;
    expect(6).toBeGreaterThan(diminishedBoundS(base, prior.length));
  });
  it("a bare REFRESH (no recast for it) is the same application", () => {
    const apps = controlApplications(rows, T, (id) =>
      id === M ? [mageCasts[0]!] : [],
    );
    expect(apps.map((a) => a.ts)).toEqual([1000]);
  });
  it("a recast by another unit does not back the source's REFRESH", () => {
    const apps = controlApplications(rows, T, (id) =>
      id === P ? [cast(4000, POLYMORPH, P, T)] : [mageCasts[0]!],
    );
    expect(apps).toHaveLength(1);
  });
});

// weekly review 2026-10-24: the product's own-shield lookback is "the
// corpusFactScan2 E6 window" by its own comment, but the scan held a bare
// 60_000 — the two now drift only through a red test
describe("E6 window ↔ product", () => {
  it("the scan's own-shield press window equals OWN_SHIELD_PRESS_LOOKBACK_MS", () => {
    expect(E6_OWN_SHIELD_PRESS_WINDOW_MS).toBe(OWN_SHIELD_PRESS_LOOKBACK_MS);
  });
});
