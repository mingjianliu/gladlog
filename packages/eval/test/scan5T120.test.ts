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
  /** the rows' caster: the enemy, or its pet */
  casterId: "e1" | "pet1" = "e1",
): number {
  let n = 0;
  const rows = [60_000, ...extraMs].map((t) => ({
    spellId,
    spellName: spellId === HOJ ? "Hammer of Justice" : "Silence",
    srcUnitId: casterId,
    destUnitId: "p1",
    missType,
    timestamp: t,
    logLine: { event: "SPELL_MISSED", timestamp: t },
  }));
  const victim = {
    id: "p1",
    name: "Victim",
    reaction: 1,
    auraEvents: [],
    missesIn: rows,
    missesOut: [],
  };
  // the producer's chains read the caster's own rows (`reflectedSpells`)
  const enemy = {
    id: "e1",
    name: "Enemy",
    reaction: 2,
    missesOut: casterId === "e1" ? rows : [],
  };
  const pet = {
    id: "pet1",
    name: "Felhunter",
    reaction: 2,
    ownerId: "e1",
    missesOut: casterId === "pet1" ? rows : [],
  };
  run({
    firstOwnerOfRound: true,
    lines,
    units: [victim, enemy, pet],
    players: [victim],
    pidOf: (n: string) =>
      n === "Victim" ? "1" : n === "Enemy" ? "4" : undefined,
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
  // a REFLECT row of a chain the producer prints is stated by that line
  // alone (codex 85-tk-L-T120-2 #2 … 2e)
  const REF = (by: string, n = 1, caster = "4(Enemy)'s") =>
    `1:00  [REFLECTED]   ${caster} Hammer of Justice reflected${n >= 2 ? ` ×${n}` : ""} by ${by}`;
  it("a reflected control's row is stated by its chain's [REFLECTED] line", () => {
    expect(scan([REF("1(Victim)")], "REFLECT")).toBe(0);
    // another reflector's line, or none
    expect(scan([REF("2(Other)")], "REFLECT")).toBe(1);
    expect(scan([], "REFLECT")).toBe(1);
  });
  it("a row 2.5 s into the chain is stated by the first row's `reflected ×2` line", () => {
    expect(scan([REF("1(Victim)", 2)], "REFLECT", HOJ, [62_500])).toBe(0);
    // 3.5 s later starts its own chain, whose line is missing
    expect(scan([REF("1(Victim)")], "REFLECT", HOJ, [63_500])).toBe(1);
  });
  it("another caster's line does not state the row", () => {
    expect(scan([REF("1(Victim)", 1, "5(Other)'s")], "REFLECT")).toBe(1);
  });
  it("a pet's chain is stated by `N(owner)'s pet's X reflected ×2`", () => {
    expect(
      scan(
        [REF("1(Victim)", 2, "4(Enemy)'s pet's")],
        "REFLECT",
        HOJ,
        [62_500],
        "pet1",
      ),
    ).toBe(0);
  });
  it("a reflected Silence no [REFLECTED] line prints needs its own line", () => {
    expect(scan([], "REFLECT", "15487")).toBe(1);
    expect(
      scan(
        [
          "1:00  [CC AVOIDED?]   1(Victim): Silence (by 4(Enemy)) logged REFLECT",
        ],
        "REFLECT",
        "15487",
      ),
    ).toBe(0);
  });
});

// codex 85-tk-L-T120-2f: an owner's Seduction its pet carried out — the
// owner's row is dropped by the producer (`commandReflectRows`), the pet's
// row is stated by the pet's [REFLECTED] line
describe("scan5 failedControlNoLine: a carried-out pet command", () => {
  it("counts only the pet's row, stated by its line", () => {
    const row = (spellId: string, src: string, t: number) => ({
      spellId,
      spellName: "Seduction",
      srcUnitId: src,
      destUnitId: "p1",
      missType: "REFLECT",
      timestamp: t,
      logLine: { event: "SPELL_MISSED", timestamp: t },
    });
    const ownerRow = row("119909", "e1", 60_000);
    const petRow = row("6358", "Pet-1", 60_440);
    const victim = {
      id: "p1",
      name: "Victim",
      reaction: 1,
      auraEvents: [],
      missesIn: [ownerRow, petRow],
      missesOut: [],
    };
    const owner = {
      id: "e1",
      name: "Enemy",
      reaction: 2,
      info: {},
      missesOut: [ownerRow],
      spellCastEvents: [],
      castStartEvents: [],
    };
    const pet = {
      id: "Pet-1",
      name: "Sayaad",
      reaction: 2,
      ownerId: "e1",
      missesOut: [petRow],
      spellCastEvents: [],
      castStartEvents: [],
    };
    let checked = 0;
    let violations = 0;
    run({
      firstOwnerOfRound: true,
      lines: [
        "1:00  [REFLECTED]   4(Enemy)'s pet's Seduction reflected by 1(Victim) (a control — sent back at the caster)",
      ],
      units: [victim, owner, pet],
      players: [victim],
      pidOf: (n: string) =>
        n === "Victim" ? "1" : n === "Enemy" ? "4" : undefined,
      start: 0,
      roundEndAt: 300_000,
      bump: () => checked++,
      violate: () => violations++,
    } as never);
    expect({ checked, violations }).toEqual({ checked: 1, violations: 0 });
  });
});
