/**
 * GH #148 item 4: two kicks on one player that round to the same second
 * shared one kick-eaten id (605 capture: 2 prompts). The earlier keeps the
 * id it always had, the later gets `#2`; ids that never collided are
 * unchanged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";

import {
  kickEatenEvents,
  suffixCollidingIds,
} from "../src/analysis/candidateFindings";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const kick = (atSeconds: number, sourceName: string, spell: string) => ({
  atSeconds,
  lockoutDurationSeconds: 3,
  kickSpellName: "Counter Shot",
  interruptedSpellName: spell,
  sourceName,
  postKick: "idle" as const,
  firstActionDelayS: null,
  switchSpellName: null,
  switchDelayS: null,
  switchWasHardCast: null,
  nearestKickerDistYd: null,
  kickersInRange: null,
  kickDepthPct: null,
  ccInWindowS: null,
});
const owner = { id: "o", name: "Owner" };

describe("kick-eaten ids (GH #148 item 4)", () => {
  it("two kicks rounding to one second get distinct ids, the earlier unchanged", () => {
    // the later kick first in the input: the suffix follows the clock
    const out = kickEatenEvents(
      [
        kick(51.1, "Rogue", "Fireball"),
        kick(50.8, "Hunter", "Polymorph"),
      ] as any[],
      owner,
    );
    const idOf = (src: string) => out.find((e) => e.unitNames[1] === src)!.id;
    expect(idOf("Hunter")).toBe("kick-eaten:o:51");
    expect(idOf("Rogue")).toBe("kick-eaten:o:51#2");
  });

  it("leaves ids that never collided byte-for-byte as they were", () => {
    const out = kickEatenEvents(
      [
        kick(40.2, "Rogue", "Fireball"),
        kick(50.8, "Hunter", "Polymorph"),
      ] as any[],
      owner,
    );
    expect(out.map((e) => e.id).sort()).toEqual([
      "kick-eaten:o:40",
      "kick-eaten:o:51",
    ]);
  });

  it("numbers a third collision #3, in time order", () => {
    const rows = [
      { id: "x:1", t: 1.3 },
      { id: "x:1", t: 0.6 },
      { id: "x:1", t: 1.1 },
      { id: "y:1", t: 1.0 },
    ];
    expect(suffixCollidingIds(rows).map((r) => r.id)).toEqual([
      "x:1#3",
      "x:1",
      "x:1#2",
      "y:1",
    ]);
  });
});
