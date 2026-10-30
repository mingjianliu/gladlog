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

  it("a summon with a resolvable owner → `<owner>'s <kind>` (an Earthgrab Totem is a totem)", () => {
    const all = [...players, unit("Creature-0-3878-2509-1-60561-0000000001", "陷地图腾", "p1")];
    expect(rootSourceLabel("陷地图腾", players, all)).toBe("Bingbumlol's totem");
  });

  it("sourceSide restricts the by-name owner lookup to the side that could cast it", () => {
    // Real shape (2026-09-24 corpus, 18 [ROOT] lines): both teams field a
    // shaman whose Earthgrab Totem shares one unit name; the name-only lookup
    // credited the rooted player's own teammate.
    const all = [
      ...players,
      unit("Creature-0-3878-2509-1-60561-0000000001", "Earthgrab Totem", "p1"),
      unit("Creature-0-3878-2509-1-60561-0000000002", "Earthgrab Totem", "p2"),
    ];
    expect(
      rootSourceLabel("Earthgrab Totem", players, all, [players[1]!]),
    ).toBe("Trillebelly's totem");
    // No owner on the casting side → no owner is invented.
    expect(rootSourceLabel("Earthgrab Totem", players, all, [])).toBe(
      "Earthgrab Totem",
    );
  });

  it("a localized summon with no owner → `[pet]`; an ASCII one keeps its short name", () => {
    expect(rootSourceLabel("陷地图腾", players, players)).toBe("[pet]");
    expect(
      rootSourceLabel("Earthgrab Totem-Illidan-US", players, players),
    ).toBe("Earthgrab Totem");
  });
});
