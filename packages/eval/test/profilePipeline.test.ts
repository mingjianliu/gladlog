import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";
import { describe, expect, it } from "vitest";

import {
  addProfileTally,
  formatProfile,
  newProfileTally,
  PHASES,
  profileText,
} from "../scripts/profilePipeline";

// The profiler runs the capture's pipeline: one file, its rounds, the
// friendly owners of each, every phase timed with the clock it is handed.

/** A clock that advances 1 ms per reading — every phase gets a non-zero,
 * deterministic duration. */
const tick = () => {
  let t = 0;
  return () => ++t;
};

describe("profileText", () => {
  it("one 3v3 file: one round, three friendly owners, every phase timed, the menu and the context built", () => {
    const t = profileText(synthArenaLog(), { now: tick() });
    expect([t.files, t.rounds, t.owners]).toEqual([1, 1, 3]);
    expect(t.chars).toBeGreaterThan(0);
    expect(t.contextChars).toBeGreaterThan(0);
    for (const p of PHASES.filter((p) => p !== "read"))
      expect(t.ms[p]).toBeGreaterThan(0);
    // read is the CLI's (file I/O), not the text pass
    expect(t.ms.read).toBe(0);
    expect(t.wallMs).toBeGreaterThan(
      t.ms.parse + t.ms.legacy + t.ms.rawStreams,
    );
  });

  it("the no-raw-streams arm builds the same rounds and owners", () => {
    const t = profileText(synthArenaLog(), { rawStreams: false, now: tick() });
    expect([t.rounds, t.owners]).toEqual([1, 3]);
  });

  it("text with no match in it: nothing to profile but the parse", () => {
    const t = profileText("not a combat log\n", { now: tick() });
    expect([t.files, t.rounds, t.owners]).toEqual([1, 0, 0]);
  });
});

describe("formatProfile / addProfileTally", () => {
  it("sums tallies and reports every phase plus the unaccounted rest", () => {
    const total = newProfileTally();
    const one = profileText(synthArenaLog(), { now: tick() });
    addProfileTally(total, one);
    addProfileTally(total, one);
    expect([total.files, total.rounds, total.owners]).toEqual([2, 2, 6]);
    expect(total.ms.context).toBe(2 * one.ms.context);
    const lines = formatProfile(total);
    expect(lines[0]).toMatch(/^files=2 rounds=2 owners=6 /);
    for (const p of [...PHASES, "other"])
      expect(lines.some((l) => l.trimStart().startsWith(p))).toBe(true);
    expect(lines.some((l) => l.startsWith("per owner:"))).toBe(true);
  });
});
