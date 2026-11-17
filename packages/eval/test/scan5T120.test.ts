/**
 * scan5 `failedControlNoLine` (T120, codex 85-tk-L-T120-1 #3): the player
 * must be the line's subject, never a caster named in `(by N(…))`.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t120";

const HOJ = "853";

function scan(
  lines: string[],
  missType = "MISS",
  spellId = HOJ,
  extraMs: number[] = [],
): number {
  let n = 0;
  const victim = {
    id: "p1",
    name: "Victim",
    reaction: 1,
    auraEvents: [],
    missesIn: [60_000, ...extraMs].map((t) => ({
      spellId,
      spellName: "Hammer of Justice",
      srcUnitId: "e1",
      missType,
      timestamp: t,
      logLine: { event: "SPELL_MISSED", timestamp: t },
    })),
  };
  const enemy = { id: "e1", name: "Enemy", reaction: 2 };
  run({
    firstOwnerOfRound: true,
    lines,
    units: [victim, enemy],
    players: [victim],
    pidOf: (n: string) => (n === "Victim" ? "1" : undefined),
    start: 0,
    roundEndAt: 300_000,
    bump: () => {},
    violate: () => n++,
  } as never);
  return n;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 failedControlNoLine", () => {
  it("a MISS with no line is a violation", () => {
    expect(scan([])).toBe(1);
  });
  it("the player's own [CC AVOIDED?] line clears it", () => {
    expect(
      scan([
        "1:00  [CC AVOIDED?]   1(Victim) ← Hammer of Justice (by 4(Enemy)) logged MISS",
      ]),
    ).toBe(0);
  });
  it("the player as the caster of an outgoing control does not", () => {
    expect(
      scan([
        "1:00  [CC ON ENEMY]   4(Enemy): Hammer of Justice (by 1(Victim)) | 6s",
      ]),
    ).toBe(1);
  });
  // T120 605 rerun: the other side's press line states the miss in its tag
  it("the control's cast line's `[MISSED on N(…)` tag clears it; another unit's does not", () => {
    expect(
      scan([
        "1:00  [TEAM] [CC]   4(Enemy) (Holy Paladin) cast Hammer of Justice → 1(Victim) [MISSED on 1(Victim) — Phase Shift was up]",
      ]),
    ).toBe(0);
    expect(
      scan([
        "1:00  [TEAM] [CC]   4(Enemy) (Holy Paladin) cast Hammer of Justice → 2(Other) [MISSED on 2(Other)]",
      ]),
    ).toBe(1);
    // the tag of another miss type does not state a MISS
    expect(
      scan([
        "1:00  [TEAM] [CC]   4(Enemy) (Holy Paladin) cast Hammer of Justice → 1(Victim) [PARRIED by 1(Victim)]",
      ]),
    ).toBe(1);
  });
  // codex 85-tk-L-T120-2b #2: the second row of a chain is stated by the
  // chain's first-row line
  it("a REFLECT row 2.5 s after another of the chain is stated by its `reflected ×2` line", () => {
    expect(
      scan(
        [
          "1:00  [REFLECTED]   4(Enemy)'s Hammer of Justice reflected ×2 by 1(Victim)",
        ],
        "REFLECT",
        HOJ,
        [62_500],
      ),
    ).toBe(0);
    // a row 3.5 s after starts its own chain, with no line
    expect(
      scan(
        [
          "1:00  [REFLECTED]   4(Enemy)'s Hammer of Justice reflected by 1(Victim)",
        ],
        "REFLECT",
        HOJ,
        [63_500],
      ),
    ).toBe(1);
  });
  // codex 85-tk-L-T120-2 #2: a grouped return prints `reflected ×N by`
  it("a [REFLECTED] line naming the player as reflector clears a REFLECT row, grouped or not", () => {
    expect(
      scan(
        [
          "1:00  [REFLECTED]   4(Enemy)'s Hammer of Justice reflected by 1(Victim)",
        ],
        "REFLECT",
      ),
    ).toBe(0);
    expect(
      scan(
        [
          "1:00  [REFLECTED]   4(Enemy)'s Hammer of Justice reflected ×2 by 1(Victim)",
        ],
        "REFLECT",
      ),
    ).toBe(0);
    expect(
      scan(
        [
          "1:00  [REFLECTED]   4(Enemy)'s Hammer of Justice reflected ×2 by 2(Other)",
        ],
        "REFLECT",
      ),
    ).toBe(1);
  });
});
