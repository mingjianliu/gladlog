/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT F22 (a): Unstable Affliction's dispel backlash on an ENEMY is a silence
 * (196364 — DB2 mechanic 9, `BACKLASH_AURA_CC_TYPE`), not hard CC. It read
 * `[CC ON ENEMY] … ← Unstable Affliction (by …) (4s)` (6 lines on the 60
 * re-eval prompts, 515 on the 605-file capture) under a legend that says the
 * [CC ON …] lines hold no silences. 06bb9860: Purify takes Unstable
 * Affliction off a teammate at 21:40:09.797, 196364 is on the priest from
 * .811 to 21:40:13.821.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { BACKLASH_AURA_CC_TYPE } from "../src/data/backlashCc";
import { makeUnit } from "./ported/testHelpers";

const UA_SILENCE = "196364";
const VT_HORROR = "87204";
const aura = (event: LogEvent, spellId: string, ms: number) =>
  ({
    logLine: { event, timestamp: ms, parameters: [] },
    timestamp: ms,
    spellId,
    srcUnitId: "m",
    srcUnitName: "Lock",
    destUnitId: "e",
    destUnitName: "Enemy",
  }) as any;

function render(
  spellId: string,
  spellName: string,
  keepOwnerCcOnEnemy?: unknown[],
  sourceName = "Lock",
): string[] {
  const owner = makeUnit("o", { name: "Me" });
  const mate = makeUnit("m", { name: "Lock" });
  const enemy = makeUnit("e", {
    name: "Enemy",
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, spellId, 16_000),
      aura(LogEvent.SPELL_AURA_REMOVED, spellId, 20_000),
    ],
  });
  const emptyDispels = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  } as any;
  return buildMatchTimeline({
    owner,
    ownerSpec: "Fury Warrior",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
    ccTrinketSummaries: [],
    enemyCCSummaries: [
      {
        playerName: "Enemy",
        trinketUseTimes: [],
        trinketCooldownSeconds: 120,
        ccInstances: [
          {
            atSeconds: 16,
            durationSeconds: 4,
            spellId,
            spellName,
            sourceName,
            sourceId: sourceName === "Me" ? "o" : "m",
            trinketState: "available_unused",
          },
        ],
      },
    ] as never,
    dispelSummary: emptyDispels,
    enemyDispelSummary: emptyDispels,
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy],
    allUnits: [owner, mate, enemy],
    matchStartMs: 0,
    matchEndMs: 60_000,
    isHealer: false,
    outgoingCCChains: [],
    criticalWindowSeconds: new Set<number>(),
    ...(keepOwnerCcOnEnemy ? { keepOwnerCcOnEnemy } : {}),
  } as any).split("\n");
}

const ccOnEnemy = (out: string[]) =>
  out.filter((l) => /^\s*\d+:\d\d\s+\[CC ON ENEMY\]/.test(l));

describe("an enemy's dispel-backlash silence is a [SILENCE] line (FT F22)", () => {
  it("Unstable Affliction's backlash: [SILENCE] with the backlash tag, no [CC ON ENEMY]", () => {
    expect(BACKLASH_AURA_CC_TYPE.get(UA_SILENCE)).toBe("silence");
    const out = render(UA_SILENCE, "Unstable Affliction");
    expect(ccOnEnemy(out)).toEqual([]);
    const silence = out.filter((l) => /^\s*\d+:\d\d\s+\[SILENCE\]/.test(l));
    expect(silence).toHaveLength(1);
    expect(silence[0]).toMatch(
      /^0:16 {2}\[SILENCE\] {3}\S+ ← Unstable Affliction \(by \S+\) \| 4s \[DISPEL BACKLASH CC: silence\]$/,
    );
    // the [SILENCE] legend is printed for it, and the tag is explained
    const text = out.join("\n");
    expect(text).toContain("[SILENCE] = that player was silenced");
    expect(text).toContain(
      "`[DISPEL BACKLASH CC: silence]` on it = the silence a dispel of that debuff puts on the player who dispelled it.",
    );
  });

  it("a backlash that is not a silence (Vampiric Touch's horror) stays a [CC ON ENEMY] line", () => {
    expect(BACKLASH_AURA_CC_TYPE.get(VT_HORROR)).toBe("horror");
    const out = render(VT_HORROR, "Sin and Punishment");
    expect(ccOnEnemy(out)).toHaveLength(1);
    expect(out.filter((l) => /^\s*\d+:\d\d\s+\[SILENCE\]/.test(l))).toEqual([]);
    expect(out.join("\n")).not.toContain("[DISPEL BACKLASH CC: silence]");
  });

  it("the landing a QUICK FOLLOW-UPS line cites keeps its [CC ON ENEMY] line (the gate's anchor)", () => {
    const out = render(
      UA_SILENCE,
      "Unstable Affliction",
      [{ targetName: "Enemy", spellId: UA_SILENCE, ccAtS: 16 }],
      "Me",
    );
    expect(ccOnEnemy(out)).toHaveLength(1);
    expect(out.filter((l) => /^\s*\d+:\d\d\s+\[SILENCE\]/.test(l))).toEqual([]);
  });
});
