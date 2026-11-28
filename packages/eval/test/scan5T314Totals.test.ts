/**
 * Pipeline T314 — the scan5 total counts only rows that say a rendered line
 * is false. Inventories, occasions, measurements and re-splits of another
 * check's rows (`MEASURED_ONLY`) leave it whole; model gaps no rendered line
 * states (`MODEL_GAP`) leave it and get their own section; two kinds a fixed
 * list cannot name leave it by rule (`outOfTotalKind`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { scan } from "../scripts/corpusFactScan5";
import type { IScanModule } from "../scripts/scan5/ctx";

const SCAN5 = join(import.meta.dirname, "../scripts/scan5");
const inTotal = (check: string, kind: string): boolean =>
  scan.inTotal!(check, kind);

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe("scan5 totals (T314)", () => {
  it("keeps every kind of a measured-only check out of the total", () => {
    for (const [check, kind] of [
      ["timelessDurationDiffers", "Rupture"],
      ["anothersPressCategory", "Fade | wall"],
      ["anothersOwnWallById", "Fade (586) | own protection only"],
      ["passiveAbsorbForward", "Soul Leech 108366"],
      ["visibleRunCastStart", "11327 press ≤1s ended"],
      ["stealthVisibleRunPress", "prowl-other-ended"],
      ["openerDebuffNoUnits", "Vanish"],
      ["divineHammerMissTypes", "ABSORB"],
      ["anothersSelfOnlyHealCd", "Dark Pact | signed table: self-only"],
      ["petKickOwnerLock", "ownerBlocked"],
      ["hiddenPressAtRelisting", "Stampeding Roar"],
      ["healMajorAsDefensive", "Nature's Swiftness"],
      ["mergedCcNoCast", "no-press"],
      ["sameSecondIdenticalLine", "[YOU] [CAST]"],
      ["resSecondFloatBand", "under 1e-8"],
      ["backSecondFloatBand", "under 1e-8"],
      ["stealthAllowedPress", "shadowmeld"],
      ["iceBarrierNoPress", "resync-pressed-span"],
      ["ascendanceProcAsPress", "no-end"],
      ["backBeforeNextSplit", "model: next press not back | Shimmer"],
      ["pressedInsideSplit", "model: not back at the press | Dark Harvest"],
      ["trinketTookSeveralRoots", "several"],
      ["evidencePressOnRestatedAura", "Bestial Wrath"],
      ["sameMsActionBelowApplied", "Vanish"],
      ["answeredOnlyByAnothersWall", "Ancient of Lore"],
      ["castlessPressCredited", "Feign Death | the only press"],
    ])
      expect(inTotal(check!, kind!), `${check}|${kind}`).toBe(false);
  });

  it("keeps the model gaps out of the total", () => {
    expect(inTotal("setBonusPressBeforeBack", "Verdant Embrace | unworn")).toBe(
      false,
    );
    expect(
      inTotal(
        "deathSetupUsable",
        "healer pressed a usable-under-control spell inside the lock",
      ),
    ).toBe(false);
    expect(inTotal("hoverPressBeforeBack", "1468")).toBe(false);
    expect(inTotal("hoverRefusedAfterBack", "1468")).toBe(false);
  });

  it("leaves the assertions beside them in the total", () => {
    for (const [check, kind] of [
      ["anothersOwnWallAnswers", "x"],
      ["anothersSelfOnlyHealCdAnswers", "x"],
      ["pressedInsideNeverBack", "Dark Harvest"],
      ["offListPressLine", "backBeforeNextPress"],
      ["resendPastBaseLength", "inside-extended"],
      ["hitEndPastOwnAction", "x"],
      ["feignNoTactics", "x"],
      ["castlessPressNotRead", "x"],
      [
        "noPressBesideLatePress",
        "no row of the file between the aura and the press | Avatar",
      ],
      [
        "noPressBesideLatePress",
        "a 1.4 s hole after the aura row, then rows before the press | Avatar",
      ],
    ])
      expect(inTotal(check!, kind!), `${check}|${kind}`).toBe(true);
  });

  it("moves out the kinds that refute nothing: a re-sent control both readings close, a proc before its press", () => {
    expect(inTotal("resendPastBaseLength", "past-both")).toBe(false);
    expect(inTotal("noPressBesideLatePress", "rows between | Avatar")).toBe(
      false,
    );
  });

  it("keeps a Sacrifice life shorter than the kit out, and one past it in", () => {
    const k = (kit: string, m: number) =>
      `kit ${kit}s, longest full life ${m}s (aura 6940)`;
    expect(inTotal("sacrificeKitLasts", k("12", 5))).toBe(false);
    expect(inTotal("sacrificeKitLasts", k("12", 11))).toBe(false);
    expect(inTotal("sacrificeKitLasts", k("12", 0))).toBe(false);
    expect(inTotal("sacrificeKitLasts", k("12", 13))).toBe(true);
    expect(inTotal("sacrificeKitLasts", k("10–12", 9))).toBe(false);
    expect(inTotal("sacrificeKitLasts", k("10–12", 13))).toBe(true);
    // a kind of another shape is not read by the rule
    expect(inTotal("sacrificeKitLasts", "something else")).toBe(true);
    expect(inTotal("otherCheck", k("12", 5))).toBe(true);
  });

  it("keeps divineHammerParry and multiBoltAbsorbId (not on T314's list) in the total", () => {
    expect(inTotal("divineHammerParry", "x")).toBe(true);
    expect(inTotal("multiBoltAbsorbId", "x")).toBe(true);
  });

  it("names the checks of a whole-check exclusion one by one, never as all of CHECKS", () => {
    // `new Set([...CHECKS])` would keep a check added to the module later
    // out of the total too, and hide its regressions
    for (const f of readdirSync(SCAN5).filter((n) => n.endsWith(".ts")))
      expect(readFileSync(join(SCAN5, f), "utf8"), f).not.toMatch(
        /export const (MEASURED_ONLY|MODEL_GAP)\b[^;]*\.\.\.CHECKS/,
      );
  });

  it("names only checks of its own module in a whole-check exclusion", async () => {
    for (const f of readdirSync(SCAN5).filter((n) => n.endsWith(".ts"))) {
      const m = (await import(join(SCAN5, f))) as Partial<IScanModule>;
      for (const c of [...(m.MEASURED_ONLY ?? []), ...(m.MODEL_GAP ?? [])])
        expect(m.CHECKS ?? [], `${f}: ${c}`).toContain(c);
    }
  });

  it("reports a saved walk's load failures with that walk only", () => {
    const s = scan.state();
    const say: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => {
      say.push(l);
    });
    scan.load({ ...s, contexts: 1, loadFailures: ["module x failed to load"] });
    scan.load({ ...s, contexts: 1, loadFailures: [] });
    scan.report({ unmapped: [] });
    expect(say).not.toContain("module x failed to load");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("prints the model gaps in their own section and the total by reason", () => {
    const s = scan.state();
    const ref = { archive: "a", round: 1, offMs: 0, detail: "", where: "w" };
    scan.load({
      ...s,
      contexts: 1,
      checked: new Map(),
      violations: [
        { ...ref, check: "hoverPressBeforeBack", kind: "1468", fact: "f1" },
        { ...ref, check: "hoverPressBeforeBack", kind: "1468", fact: "f2" },
        // a denominator kind of a model-gap check is a kind out of its total
        {
          ...ref,
          check: "setBonusPressBeforeBack",
          kind: "Verdant Embrace | presses unworn",
          fact: "f6",
        },
        { ...ref, check: "timelessDurationDiffers", kind: "Rip", fact: "f3" },
        {
          ...ref,
          check: "resendPastBaseLength",
          kind: "past-both",
          fact: "f4",
        },
        {
          ...ref,
          check: "resendPastBaseLength",
          kind: "inside-extended",
          fact: "f5",
        },
      ],
    });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => {
      lines.push(l);
    });
    scan.report({ unmapped: [] });
    expect(lines).toContain(
      "corpusFactScan5 total: 1 in-total violations; not in the total: measured-only checks 1, model gaps 2, kinds out of their check's total 2",
    );
    const at = lines.indexOf(
      "model gaps, no rendered line (not in the total):",
    );
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1)).toContain(
      "  hoverPressBeforeBack: 2 (distinct facts 2)",
    );
    expect(lines.slice(at + 1)).toContain(
      "  setBonusPressBeforeBack: 0 (distinct facts 0)",
    );
    expect(
      lines.find((l) => l.startsWith("timelessDurationDiffers: ")),
    ).toMatch(/violations 0 .*\[measured only: 1 rows not in the total\]$/);
    expect(lines).toContain("  Rip: 1 (distinct 1)  [not in the total]");
  });
});
