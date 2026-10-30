/**
 * B1 (user 2026-10-24): the stats table's 解 / 驱散 read the dispel panel's
 * summary (`dispelSummaryOf`), where a pet's dispel is its owner's (B45) —
 * before, the table built its own summary with no pets (3 of 184 rows: a
 * Warlock's pet purges missing). The real fixtures hold no deliberate
 * dispel, so the summary is stubbed: a pet purge credited to its owner.
 */
import { describe, expect, it, vi } from "vitest";

let ownerName = "";
vi.mock("../src/renderer/src/report/derive/dispelSummary", () => ({
  dispelSummaryOf: (_l: unknown, us: Array<{ name: string }>) => ({
    allyCleanse: [],
    ourPurges: us.some((u) => u.name === ownerName)
      ? [
          {
            timeSeconds: 30,
            sourceName: ownerName,
            isPetDispel: true,
            dispelKind: "deliberate",
          },
        ]
      : [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  }),
}));

describe("B1 — a pet's purge is on its owner's row", () => {
  it("the table counts the panel's pet purge for the owner", async () => {
    const { loadRealMatchFixture } = await import("./fixtures/loadFixture");
    const { deriveStatsTable } = await import(
      "../src/renderer/src/report/derive/statsTable"
    );
    const m = loadRealMatchFixture();
    const before = deriveStatsTable(m);
    ownerName = before.find((r) => r.reaction === "Friendly")!.name;
    const row = deriveStatsTable(m).find((r) => r.name === ownerName)!;
    expect(row.purges).toBe(1);
  });
});
