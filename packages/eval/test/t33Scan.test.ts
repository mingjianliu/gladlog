/**
 * scan5/t33 `auditSplitLabel` (pipeline T33, ruling R07 (5)), fed the
 * producer's own lines: every row is rendered by `formatMitigationAuditLine`.
 * Each form must be counted; a split's unlabelled same-seconds pair must be
 * caught (codex 85-tk-C-T33-1 #1: Cloak of Shadows' immunity + physical 20
 * pair was read as one row); the labelled pair must pass.
 */
import { formatMitigationAuditLine } from "@gladlog/analysis/src/context/matchTimelineSections";
import type { IMitigationAuditRow } from "@gladlog/analysis/src/utils/counterfactual";
import { describe, expect, it } from "vitest";

import { AUDIT_ROW, run } from "../scripts/scan5/t33";

const row = (
  over: Partial<IMitigationAuditRow> & Pick<IMitigationAuditRow, "kind">,
): IMitigationAuditRow => ({
  spellId: "1",
  spellName: "Cloak of Shadows",
  activeOverlapS: 2.2,
  ...over,
});
const scan = (rows: IMitigationAuditRow[]) => {
  const violations: string[] = [];
  let counted = 0;
  run({
    start: 0,
    lines: ["[DEATH] …", ...rows.map(formatMitigationAuditLine), ""],
    bump: () => counted++,
    violate: (_c: string, kind: string, _t: number, factId: string) =>
      violations.push(`${kind}:${factId}`),
  } as never);
  return { counted, violations };
};

describe("t33 auditSplitLabel reads every audit form", () => {
  const forms: IMitigationAuditRow[] = [
    row({ kind: "arith", blockedAmount: 8_000, blockedPctMaxHp: 0.8 }),
    row({ kind: "arith", blockedAmount: 8_000 }),
    row({ kind: "deferred", deferredAmount: 9_000 }),
    row({ kind: "immunity", damageTakenDuringImmunity: 5_000 }),
    row({ kind: "deflection", damageTakenDuringImmunity: 5_000 }),
    row({ kind: "absorb" }),
  ];
  it.each(forms.map((r) => [r.kind, r] as const))(
    "%s: name and overlap parsed, labelled or not",
    (_k, r) => {
      for (const r2 of [r, { ...r, schoolMask: 0x1 }]) {
        const line = formatMitigationAuditLine(r2);
        const m = AUDIT_ROW.exec(line);
        expect(m, line).not.toBeNull();
        expect(m!.groups!.overlap).toBe("2.2");
        expect(m!.groups!.name).toBe(
          r2.schoolMask !== undefined &&
            r2.kind !== "deferred" &&
            r2.kind !== "absorb"
            ? "Cloak of Shadows (physical damage)"
            : "Cloak of Shadows",
        );
      }
    },
  );
});

describe("t33 auditSplitLabel on a split pair", () => {
  const immunity = row({ kind: "immunity", damageTakenDuringImmunity: 5_000 });
  const phys = row({ kind: "arith", blockedAmount: 8_000 });

  it("Cloak with Bait and Switch, unlabelled: immunity + arith over the same seconds is caught", () => {
    expect(scan([immunity, phys])).toEqual({
      counted: 2,
      violations: ["unlabelled:Cloak of Shadows|2.2"],
    });
  });

  it("the same pair labelled by school passes", () => {
    expect(
      scan([
        { ...immunity, schoolMask: 0x7e },
        { ...phys, schoolMask: 0x1 },
      ]).violations,
    ).toEqual([]);
  });

  it("one row printed twice is a duplicate, not an unlabelled split", () => {
    const offTable = row({ kind: "absorb", spellName: "Touch of Karma" });
    expect(scan([offTable, offTable]).violations).toEqual([
      "duplicate:Touch of Karma|2.2",
    ]);
  });

  it("a split whose two components print the same text is still unlabelled (codex 85-tk-C-T33-1b #1)", () => {
    const evasion = row({
      kind: "arith",
      spellName: "Evasion",
      blockedAmount: 8_000,
      blockedPctMaxHp: 0.8,
    });
    expect(scan([evasion, evasion]).violations).toEqual([
      "unlabelled:Evasion|2.2",
    ]);
  });

  it("two applications over different seconds are no split", () => {
    expect(scan([phys, { ...phys, activeOverlapS: 1.4 }]).violations).toEqual(
      [],
    );
  });
});
