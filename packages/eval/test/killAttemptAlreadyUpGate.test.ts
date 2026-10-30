/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  formatKillAttemptsForContext,
  KILL_ATTEMPTS_ALREADY_UP_LEGEND,
} from "@gladlog/analysis/src/utils/killAttempts";
import { describe, expect, it } from "vitest";

import { checkKillAttemptAlreadyUpStated } from "../src/quality/promptQualityCheck";

// R08 (c) (user ruling 2026-10-11): what a KILL ATTEMPTS line's FAILED clause
// marks `[up since m:ss]` is stated in its opportunity clause too.
const line = (opportunity: string, outcome: string) =>
  `  [0:59–1:14] on Druid-Realm-EU — Frozen Orb burst (no stun) | opportunity: ${opportunity} | team focus 94% (1.19M on target inside it, 1.19M incl. the 5 s after) | ${outcome}`;
const PRIME = "PRIME (no trinket, no 20-99% wall in hand";

describe("checkKillAttemptAlreadyUpStated", () => {
  it("passes: no `[up since]` and no fact; a wall, an external list, an immunity each restated", () => {
    expect(
      checkKillAttemptAlreadyUpStated([
        line(`${PRIME})`, "FAILED: not enough damage"),
        line(`${PRIME})`, "FAILED: popped Barkskin"),
        line(`${PRIME})`, "KILL"),
      ]),
    ).toEqual([]);
    expect(
      checkKillAttemptAlreadyUpStated([
        KILL_ATTEMPTS_ALREADY_UP_LEGEND,
        line(
          `${PRIME}; Barkskin already up since 0:55)`,
          "FAILED: popped Barkskin [up since 0:55]",
        ),
        line(
          "gated (Ironbark in hand; Barkskin already up since 0:55; Leap of Faith already up since 0:57; Renewal already up since 0:58; no softer target)",
          "FAILED: popped Barkskin [up since 0:55]/Survival Instincts; saved by external (Leap of Faith [up since 0:57]); popped Renewal [up since 0:58]",
        ),
        line(
          "trinket up (a full immunity already up since 0:50; softer target then: Mage-Realm-EU — PRIME)",
          "FAILED: target trinketed out; forced a full immunity [up since 0:50] (a win — re-open after it drops)",
        ),
        // a clause after FAILED is not part of it
        line(
          `${PRIME}; Barkskin already up since 0:55)`,
          "FAILED: popped Barkskin [up since 0:55] | target in your team's Cyclone 1:02–1:07",
        ),
      ]),
    ).toEqual([]);
  });

  it("fails: the line the packet quoted — `no wall in hand` beside `popped Barkskin [up since 0:59]`", () => {
    const fails = checkKillAttemptAlreadyUpStated([
      KILL_ATTEMPTS_ALREADY_UP_LEGEND,
      line(`${PRIME})`, "FAILED: popped Barkskin [up since 0:59]"),
      line(
        `${PRIME}; Barkskin already up since 0:55)`,
        "FAILED: popped Barkskin [up since 0:55]",
      ),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      'line 2: KILL ATTEMPTS 的 FAILED 子句写了 [up since],opportunity 子句却没写 "Barkskin already up since 0:59"',
    );
  });

  it("fails: another second, another name, or a fact the FAILED clause does not mark", () => {
    const second = checkKillAttemptAlreadyUpStated([
      KILL_ATTEMPTS_ALREADY_UP_LEGEND,
      line(
        `${PRIME}; Barkskin already up since 0:54)`,
        "FAILED: popped Barkskin [up since 0:55]",
      ),
    ]);
    // the right fact is missing AND the stated one is not marked
    expect(second).toHaveLength(2);
    const unmarked = checkKillAttemptAlreadyUpStated([
      KILL_ATTEMPTS_ALREADY_UP_LEGEND,
      line(
        `${PRIME}; Barkskin already up since 0:55)`,
        "FAILED: popped Barkskin",
      ),
    ]);
    expect(unmarked).toHaveLength(1);
    expect(unmarked[0]).toContain("没有对应的 [up since]");
  });

  it("fails: the legend sentence without a line that carries the fact, and a line without the legend", () => {
    expect(
      checkKillAttemptAlreadyUpStated([
        KILL_ATTEMPTS_ALREADY_UP_LEGEND,
        line(`${PRIME})`, "FAILED: not enough damage"),
      ]),
    ).toHaveLength(1);
    expect(
      checkKillAttemptAlreadyUpStated([
        line(
          `${PRIME}; Barkskin already up since 0:55)`,
          "FAILED: popped Barkskin [up since 0:55]",
        ),
      ]),
    ).toHaveLength(1);
  });
});

describe("formatKillAttemptsForContext ⇄ checkKillAttemptAlreadyUpStated", () => {
  const attempt = (
    tier: "prime" | "gated" | "locked",
    attribution: Record<string, unknown>,
  ): any => ({
    targetUnitId: "e1",
    targetName: "Druid-Realm-EU",
    anchor: "burst",
    anchorSpellName: "Frozen Orb",
    fromSeconds: 59.4,
    toSeconds: 74.2,
    stuns: [],
    opportunity: {
      tier,
      wallsInHand: tier === "gated" ? ["Ironbark"] : [],
    },
    teamDamageToTarget: 980_000,
    teamDamageToTargetInBracket: 980_000,
    teamDamageTotal: 980_000,
    teamOnTargetPct: 100,
    killed: false,
    attribution: {
      trinketed: false,
      brokeOut: [],
      immunityBaited: false,
      defensivePopped: [],
      defensivePoppedAtS: [],
      externalReceived: [],
      externalReceivedAtS: [],
      selfSaved: [],
      selfSavedAtS: [],
      outhealed: false,
      ...attribution,
    },
  });
  const block = formatKillAttemptsForContext([
    attempt("prime", {
      primary: "defensive",
      defensivePopped: ["Barkskin", "Survival Instincts"],
      defensivePoppedAtS: [55.2, 61],
      externalReceived: ["Leap of Faith"],
      externalReceivedAtS: [57.9],
      selfSaved: ["Renewal", "Nature's Guardian"],
      selfSavedAtS: [58.1, 60],
    }),
    attempt("gated", {
      primary: "trinketed",
      trinketed: true,
      immunityBaited: true,
      immunityUpSinceS: 50.5,
    }),
    attempt("locked", {
      primary: "broke-out",
      brokeOut: ["Will to Survive"],
      immunityBaited: true,
      immunityUpSinceS: 50.5,
    }),
    attempt("prime", {
      primary: "immunity-baited",
      immunityBaited: true,
      immunityUpSinceS: 50.5,
    }),
    attempt("prime", { primary: "pressure" }),
  ]);

  it("what the producer renders passes — every FAILED shape that carries `[up since]`", () => {
    expect(block.join("\n")).toContain(
      "opportunity: PRIME (no trinket, no 20-99% wall in hand; Barkskin already up since 0:55; Leap of Faith already up since 0:57; Renewal already up since 0:58)",
    );
    expect(
      block.filter((l) => l.includes("a full immunity already up since 0:50")),
    ).toHaveLength(3);
    expect(checkKillAttemptAlreadyUpStated(block)).toEqual([]);
  });

  it("mutation: the same block with the facts taken out of the opportunity clauses fails once per `[up since]`", () => {
    const stripped = block.map((l) =>
      l
        .replace(/; [^;()|]+ already up since \d+:\d\d/g, "")
        .replace(/\([^;()|]+ already up since \d+:\d\d; /, "("),
    );
    const fails = checkKillAttemptAlreadyUpStated(stripped);
    // 3 on the first line, 1 on each of the three immunity lines, and the
    // legend sentence left without a line
    expect(fails).toHaveLength(7);
  });
});
