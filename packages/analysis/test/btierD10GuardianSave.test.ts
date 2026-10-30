/**
 * B-tier D10 B18 (user ruling 2026-10-06): a Guardian Spirit press line says
 * `| save triggered Ns later (m:ss): a killing blow was prevented, healed Nk`
 * when — and only when — the priest's save heal (48153) is logged inside the
 * press's window. The heal is the one `guardianSpiritSaved` (the ledger's
 * recovery predicate) already reads.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import {
  GUARDIAN_SPIRIT_SAVE_HEAL_ID,
  GUARDIAN_SPIRIT_SAVE_WINDOW_S,
  GUARDIAN_SPIRIT_SPELL_ID,
  guardianSpiritSaveClause,
  guardianSpiritSaved,
  guardianSpiritSaveOf,
} from "../src/utils/cooldowns";

const START = 1_000_000;
const heal = (
  s: number,
  destUnitName: string,
  effectiveAmount: number,
  spellId = GUARDIAN_SPIRIT_SAVE_HEAL_ID,
): any => ({
  spellId,
  timestamp: START + s * 1000,
  destUnitId: `id-${destUnitName}`,
  destUnitName,
  amount: effectiveAmount,
  effectiveAmount,
});
const priest = (...heals: any[]): any => ({ healOut: heals });
const clause = (p: any, pressS: number, target?: string) =>
  guardianSpiritSaveClause(GUARDIAN_SPIRIT_SPELL_ID, p, pressS, START, target);

describe("guardianSpiritSaveOf", () => {
  it("the first save heal inside the window, with who it landed on and what reached them", () => {
    const p = priest(
      heal(132.715, "War-Realm", 352_625),
      heal(140, "War-Realm", 1),
    );
    expect(guardianSpiritSaveOf(p, 132.213, START)).toEqual({
      atSeconds: 132.715,
      healedUnitId: "id-War-Realm",
      healedUnitName: "War-Realm",
      healed: 352_625,
    });
  });

  it("is the predicate the ledger reads: null exactly when guardianSpiritSaved is false", () => {
    const before = priest(heal(9.9, "War-Realm", 300_000));
    const late = priest(
      heal(10 + GUARDIAN_SPIRIT_SAVE_WINDOW_S + 0.1, "War-Realm", 300_000),
    );
    const edge = priest(
      heal(10 + GUARDIAN_SPIRIT_SAVE_WINDOW_S, "War-Realm", 300_000),
    );
    const other = priest(heal(11, "War-Realm", 300_000, "2061"));
    for (const p of [before, late, other]) {
      expect(guardianSpiritSaveOf(p, 10, START)).toBeNull();
      expect(guardianSpiritSaved(p, 10, START)).toBe(false);
    }
    expect(guardianSpiritSaveOf(edge, 10, START)).not.toBeNull();
    expect(guardianSpiritSaved(edge, 10, START)).toBe(true);
  });
});

describe("guardianSpiritSaveClause", () => {
  it("8930cb36 2:12 — pressed 132.213, the save 0.5 s later, 353k", () => {
    expect(
      clause(priest(heal(132.715, "War-Realm", 352_625)), 132.213, "War-Realm"),
    ).toBe(
      " | save triggered 0.5s later (2:12): a killing blow was prevented, healed 353k",
    );
  });

  it("the stamp is the save's own rendered second, not the press's (58a3d0f8: 0:21 → 0:26)", () => {
    expect(
      clause(priest(heal(26.931, "Hunt-Realm", 347_916)), 21.491, "Hunt-Realm"),
    ).toBe(
      " | save triggered 5.4s later (0:26): a killing blow was prevented, healed 348k",
    );
  });

  it("no save heal → no clause; another spell's press → no clause", () => {
    expect(clause(priest(), 21.491, "Hunt-Realm")).toBe("");
    expect(
      guardianSpiritSaveClause(
        "33206",
        priest(heal(26.9, "Hunt-Realm", 347_916)),
        21.491,
        START,
        "Hunt-Realm",
      ),
    ).toBe("");
  });

  it("the heal row landed on someone else (the priest, at full health), or healed nothing: the save is stated, no amount is quoted", () => {
    // 605 S2 files: 4 of 79 save heals are logged on the priest, fully overhealed
    const onPriest = priest(heal(35.976, "Priest-Realm", 0));
    expect(clause(onPriest, 33.979, "Target-Realm")).toBe(
      " | save triggered 2.0s later (0:35): a killing blow was prevented",
    );
    const elsewhere = priest(heal(35.976, "Priest-Realm", 175_276));
    expect(clause(elsewhere, 33.979, "Target-Realm")).not.toContain("healed");
    const nothing = priest(heal(35.976, "Target-Realm", 300));
    expect(clause(nothing, 33.979, "Target-Realm")).not.toContain("healed");
    expect(clause(elsewhere, 33.979, undefined)).not.toContain("healed");
  });
});
