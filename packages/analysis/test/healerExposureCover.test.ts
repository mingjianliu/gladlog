/**
 * Pipeline T128 (CXA13 D28, ba2503cc r0): a healer under Nullifying Shroud
 * (378464, the next loss-of-control effect's immunity) was listed Blinding
 * Light and Hammer of Justice as Full-DR threats. The exposure filter asks
 * `healerCcCoverAt` (the `[IMMUNE — X was up]` reading +
 * `avoidanceBuffCoversCc`, cc-avoidable's buff test).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  applicableCCAvoidanceIds,
  avoidanceBuffCoversCc,
  CC_AVOIDANCE_BUFF_SPELLS,
} from "../src/utils/ccTrinketAnalysis";
import {
  formatEnemyCCKitHeader,
  healerCcCoverAt,
} from "../src/utils/healerExposureAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const S = (s: number) => T0 + s * 1000;
const SHROUD = "378464";
const HOJ = "853"; // Hammer of Justice (stun)
const BLINDING_LIGHT = "105421"; // disorient

describe("T128 — a healer's up avoidance aura covers the controls it stops", () => {
  // ba2503cc r0 shape: Shroud 4.593 → refreshed 7.266 → removed 7.592; the
  // window opened at 6.909
  const healer = makeUnit("h", {
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        SHROUD,
        S(4.593),
        "h",
        "h",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REFRESH,
        SHROUD,
        S(7.266),
        "h",
        "h",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        SHROUD,
        S(7.592),
        "h",
        "h",
        "BUFF",
      ),
    ],
  });

  it("Nullifying Shroud stops a stun and a disorient while it is up", () => {
    const cover = healerCcCoverAt(healer as never, S(6.909), T0);
    expect(cover(HOJ)).toBe("Nullifying Shroud");
    expect(cover(BLINDING_LIGHT)).toBe("Nullifying Shroud");
  });

  it("covers nothing before it went up or after it was removed", () => {
    expect(healerCcCoverAt(healer as never, S(4.0), T0)(HOJ)).toBeUndefined();
    expect(healerCcCoverAt(healer as never, S(8.0), T0)(HOJ)).toBeUndefined();
  });

  it("a Druid form covers Polymorph and Hex only", () => {
    const cat = makeUnit("d", {
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "768",
          S(1),
          "d",
          "d",
          "BUFF",
        ),
      ],
    });
    const cover = healerCcCoverAt(cat as never, S(2), T0);
    expect(cover("118")).toBe("Cat Form"); // Polymorph
    expect(cover("51514")).toBe("Cat Form"); // Hex
    expect(cover("46968")).toBeUndefined(); // Shockwave
    expect(cover(HOJ)).toBeUndefined();
  });

  it("the buff half of applicableCCAvoidanceIds is avoidanceBuffCoversCc", () => {
    for (const cc of [HOJ, BLINDING_LIGHT, "118", "5782"]) {
      const all = applicableCCAvoidanceIds(cc, "");
      for (const buffId of CC_AVOIDANCE_BUFF_SPELLS.keys())
        expect(all.has(buffId) || !avoidanceBuffCoversCc(buffId, cc)).toBe(
          true,
        );
    }
  });

  it("a round whose every threat was covered keeps the landed controls in the kit (codex T128-1)", () => {
    const covered = Object.assign([], { coveredWindows: 1 }) as never;
    const out = formatEnemyCCKitHeader(covered, undefined, [
      {
        enemyName: "E",
        enemySpec: "Retribution Paladin",
        spellName: "Hammer of Justice",
        category: "stun",
        count: 1,
      },
    ] as never);
    expect(out.join("\n")).toContain("Hammer of Justice");
    expect(out.join("\n")).toContain("landed 1×");
    // no threat for any other reason: the landed controls print all the
    // same since T179 (the header promises every control that landed)
    expect(
      formatEnemyCCKitHeader([], undefined, [
        {
          enemyName: "E",
          enemySpec: "Retribution Paladin",
          spellName: "Hammer of Justice",
          count: 1,
        },
      ]).join("\n"),
    ).toContain("Hammer of Justice (landed 1×)");
  });
});
