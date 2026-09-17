/** Reference-table builder + lookup for `teammate-crisis-idle` (GH #95). */
import { describe, expect, it } from "vitest";

import { buildTeammateCrisisPriorTable } from "../src/explore/teammateCrisisPriorTable";

const meta = {
  generatedAt: "2026-09-17",
  corpus: "test",
  command: "",
  rows: 0,
  nFloor: 50,
  predicateVersion: 1,
};
const row = (over: Record<string, unknown> = {}) => ({
  bracket: "3v3",
  dmg2s: 0.25,
  excluded: null as string | null,
  healerAnswered: false,
  cleanIdle: true,
  diedWithin10s: false,
  ...over,
});

describe("buildTeammateCrisisPriorTable", () => {
  it("counts clean idle and answered separately, per bin and bracket-wide, with rendered integer rates", () => {
    const rows = [
      row({ diedWithin10s: true }),
      row({ diedWithin10s: true }),
      row(),
      row({ cleanIdle: false, healerAnswered: true }),
      row({ cleanIdle: false, healerAnswered: true, diedWithin10s: true }),
      row({ dmg2s: 0.12, cleanIdle: false, healerAnswered: true }),
    ];
    const t = buildTeammateCrisisPriorTable(rows, meta);
    expect(t.cells["3v3|20-30%"]).toEqual({
      nIdle: 3,
      deathIdlePct: 67,
      nAnswered: 2,
      deathAnsweredPct: 50,
    });
    expect(t.cells["3v3|10-20%"]).toEqual({
      nIdle: 0,
      deathIdlePct: 0,
      nAnswered: 1,
      deathAnsweredPct: 0,
    });
    expect(t.cells["3v3|*"]).toEqual({
      nIdle: 3,
      deathIdlePct: 67,
      nAnswered: 3,
      deathAnsweredPct: 33,
    });
  });

  it("excluded points enter neither population (codex R2: identical filters on both sides)", () => {
    const t = buildTeammateCrisisPriorTable(
      [
        row({ excluded: "losUnknown" }),
        row({
          excluded: "healerBlocked",
          cleanIdle: false,
          healerAnswered: true,
        }),
        row({ cleanIdle: false, healerAnswered: false }),
      ],
      meta,
    );
    expect(t.cells).toEqual({});
  });
});
