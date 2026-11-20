/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built summary fixtures */
/**
 * pipeline T191 (7686e97d r3 2:22): `[MISSED PURGE OPPORTUNITY] … X's
 * Spellsteal at T took Y instead` names a removal pressed at T. Improved
 * Spellsteal's delayed re-steal (`delayedRepeat`) is the earlier press's —
 * it took Renew 0.67 s before the mage's next press, which took Body and
 * Soul; the line named the re-steal's Renew as that press's pick.
 */
import { describe, expect, it } from "vitest";

import { emitCleanseEntries } from "../src/context/timelineSections/cleanse";

const steal = (s: number, removed: string, removedId: string, extra = {}) => ({
  sourceName: "Mage-R",
  targetName: "Warlock-R",
  dispelSpellId: "30449",
  dispelSpellName: "Spellsteal",
  removedSpellId: removedId,
  removedSpellName: removed,
  timeSeconds: s,
  isSpellSteal: true,
  isPetDispel: false,
  dispelKind: "proc",
  purgeableOnTarget: 2,
  ...extra,
});

function lines(ourPurges: any[]): string[] {
  const out: string[] = [];
  const miss: any = {
    timeSeconds: 142,
    durationSeconds: 3,
    enemyName: "Warlock-R",
    spellId: "212295",
    spellName: "Nether Ward",
    purgeableOnTarget: 2,
  };
  emitCleanseEntries({
    dispelSummary: {
      missedCleanseWindows: [],
      ourPurges,
      allyCleanse: [],
    } as any,
    owner: { name: "Mage-R" } as any,
    addEntry: (_t: number, text: string) => out.push(text),
    pid: (n: string) => n,
    qualifyingMissedPurges: [miss],
    consumedMissedPurges: new Set(),
    enemyPid: (n: string) => n,
    enemies: [],
    matchStartMs: 0,
    allUnits: [],
  } as any);
  return out.filter((l) => l.includes("[MISSED PURGE OPPORTUNITY]"));
}

describe("T191: the purge a missed-purge line says took something else is a press", () => {
  it("the re-steal before the press is skipped: the line names the press's own pick", () => {
    const [line] = lines([
      steal(144.126, "Renew", "139", { delayedRepeat: true }),
      steal(144.798, "Body and Soul", "65081", { dispelKind: "deliberate" }),
    ]);
    expect(line).toContain(
      "Mage-R's Spellsteal at 2:24 took Body and Soul instead",
    );
    expect(line).not.toContain("Renew");
  });

  it("a re-steal alone in the window cites no press", () => {
    const [line] = lines([
      steal(144.126, "Renew", "139", { delayedRepeat: true }),
    ]);
    expect(line).not.toContain("took");
  });

  it("an ordinary removal in the window is still cited", () => {
    const [line] = lines([
      steal(144.126, "Renew", "139", { dispelKind: "deliberate" }),
    ]);
    expect(line).toContain("Mage-R's Spellsteal at 2:24 took Renew instead");
  });
});
