/**
 * C3 (user 2026-10-24): a missed-purge-kill-window card only for a window
 * someone could have answered — `missedPurgeNotActionable` (the prompt's
 * `not actionable`, the dispel panel's notes) clears it. The real fixtures
 * hold no missed purge inside a kill window, so the summary is stubbed.
 */
import { describe, expect, it, vi } from "vitest";

const win = (over: Record<string, unknown>) => ({
  timeSeconds: 40,
  durationSeconds: 8,
  spellId: "1022",
  spellName: "Blessing of Protection",
  enemyName: "Pally-R",
  duringKillWindow: true,
  purgersLockedOut: false,
  losReachable: true,
  ...over,
});

vi.mock("../src/renderer/src/report/derive/dispelSummary", () => ({
  dispelSummaryOf: () => ({
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [
      win({ timeSeconds: 40 }),
      win({ timeSeconds: 50, purgersLockedOut: true }),
      win({ timeSeconds: 60, losReachable: false }),
      win({ timeSeconds: 70, purgeReadyAtSeconds: 77.5 }),
      win({ timeSeconds: 80, losReachable: null }),
    ],
  }),
}));
vi.mock("@gladlog/analysis", async (orig) => ({
  ...(await orig<typeof import("@gladlog/analysis")>()),
  // the stub's windows carry their own kill-window mark
  annotateMissedPurgesWithKillWindows: () => {},
}));

describe("C3 — missed-purge cards", () => {
  it("locked out / out of reach / on cooldown throughout get no card; unknown reach keeps it", async () => {
    const { deriveMistakes } = await import(
      "../src/renderer/src/report/derive/mistakes"
    );
    const { loadRealMatchFixture } = await import("./fixtures/loadFixture");
    const cards = deriveMistakes(loadRealMatchFixture()).filter(
      (c) => c.type === "missed-purge-kill-window",
    );
    expect(cards.map((c) => c.tS)).toEqual([40, 80]);
  });
});
