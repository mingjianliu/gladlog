import { describe, expect, it } from "vitest";

import { checkUnnecessaryNoteHpAgreement } from "../src/quality/promptQualityCheck";

/**
 * Triage 2026-09-29, hp-state F-R8 + its 2026-10-01 extension (P-R8b): the
 * `→ X (N% HP)` of a cooldown line and the `at N% HP` of its `[UNNECESSARY]`
 * note are one press reading; the line must not carry two numbers.
 */
const note = (hp: number) =>
  `[UNNECESSARY — no pressure: target Majkiáno-Drak'thul-EU at ${hp}% HP, no damage spike within ±3s of cast, nearest burst window 15.7s away]`;

describe("checkUnnecessaryNoteHpAgreement", () => {
  it("passes when the line and its note carry the same number", () => {
    expect(
      checkUnnecessaryNoteHpAgreement([
        `0:50  [YOU] [CD]   Blessing of Spellwarding → 3(AMage) (90% HP, +1%/s, 5k DPS) | dampening: 10% ${note(90)}`,
      ]),
    ).toEqual([]);
  });

  it("fails on a press reading next to a different note reading", () => {
    const out = checkUnnecessaryNoteHpAgreement([
      `0:12  [YOU] [CD]   Pain Suppression → 6(RPaladin) (75% HP, -8%/s, 40k DPS) | dampening: 10% ${note(90)}`,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("75%");
    expect(out[0]).toContain("90%");
  });

  it("reads the self-cast form", () => {
    expect(
      checkUnnecessaryNoteHpAgreement([
        `1:02  [YOU] [CD]   Barkskin (self: 88% HP, 0%/s, 3k DPS) ${note(88)}`,
      ]),
    ).toEqual([]);
    expect(
      checkUnnecessaryNoteHpAgreement([
        `1:02  [YOU] [CD]   Barkskin (self: 88% HP, 0%/s, 3k DPS) ${note(93)}`,
      ]),
    ).toHaveLength(1);
  });

  it("a teammate's cooldown line prints only the note: nothing to compare", () => {
    expect(
      checkUnnecessaryNoteHpAgreement([
        `0:50  [TEAM] [CD]   2(HPaladin) (Holy Paladin): Blessing of Spellwarding ${note(90)}`,
      ]),
    ).toEqual([]);
  });

  it("a line without the note is not this gate's business", () => {
    expect(
      checkUnnecessaryNoteHpAgreement([
        "0:15  [YOU] [CD]   Holy Word: Chastise → 6(RPaladin) (68% HP)",
      ]),
    ).toEqual([]);
  });
});
