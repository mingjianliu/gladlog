/**
 * `[ROOT] … (from X)` caster label (2026-09-15): a totem / pet casts under a
 * client-locale unit name ("陷地图腾" on a zh client — 53 lines / 42 prompts
 * in the Opus baseline), so summons are labelled through their owner, the
 * way `actorLabel` does on `[CC]` lines. Players keep their own name.
 */
import { describe, expect, it } from "vitest";

import { rootSourceLabel } from "./rootReachability";

const unit = (id: string, name: string, ownerId = "") =>
  ({ id, name, ownerId }) as never;

const players = [
  unit("p1", "Bingbumlol-Illidan-US"),
  unit("p2", "Trillebelly-Area52-US"),
];

describe("rootSourceLabel", () => {
  it("a player casts under their own (full) name", () => {
    expect(rootSourceLabel("Trillebelly-Area52-US", players, players)).toBe(
      "Trillebelly-Area52-US",
    );
  });

  it("a summon with a resolvable owner → `<owner>'s pet`", () => {
    const all = [...players, unit("t1", "陷地图腾", "p1")];
    expect(rootSourceLabel("陷地图腾", players, all)).toBe("Bingbumlol's pet");
  });

  it("a localized summon with no owner → `[pet]`; an ASCII one keeps its short name", () => {
    expect(rootSourceLabel("陷地图腾", players, players)).toBe("[pet]");
    expect(
      rootSourceLabel("Earthgrab Totem-Illidan-US", players, players),
    ).toBe("Earthgrab Totem");
  });
});
