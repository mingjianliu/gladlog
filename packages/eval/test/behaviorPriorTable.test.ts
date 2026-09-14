import { describe, expect, it } from "vitest";

import {
  buildBehaviorPriorTable,
  dmgBinOf,
  outcomeOf,
  TEAM_OUTCOME_BRACKETS,
} from "../src/explore/behaviorPriorTable";

const point = (over: Record<string, unknown> = {}) => ({
  tMs: 0,
  tSec: 0,
  hpPct: 38,
  dmg2s: 0.25,
  attackers2s: 2,
  enemyBurst: false,
  inCC: false,
  lockedOut: false,
  diedInWindow: false,
  responses: {
    selfHeal: true,
    wall: false,
    external: false,
    control: false,
    peel: false,
    protective: false,
    kite: false,
  },
  responded: true,
  selfHealPct: 30,
  hasTool: true,
  feasible: true,
  dangerous: true,
  diedWithin10s: false,
  friendDiedWithin15s: false,
  ...over,
});
const meta = {
  generatedAt: "t",
  corpus: "c",
  weeks: ["2026-W33"],
  command: "x",
  predicateVersion: 1,
};

describe("buildBehaviorPriorTable", () => {
  it("bins dmg2s", () => {
    expect(dmgBinOf(0.05)).toBe("<10%");
    expect(dmgBinOf(0.1)).toBe("10-20%");
    expect(dmgBinOf(0.2)).toBe(">=20%");
  });
  it("nNoResp/nResp/death10*/top count ALL ranked feasible&dangerous rows split by responded — no rank filter anywhere; a dangerous:false row is excluded from everything", () => {
    const rows = [
      // no response, died within 10s — counts into nNoResp
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 95,
        point: point({ responded: false, diedWithin10s: true }),
      },
      // ranked, no response, survived — counts into nNoResp
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 50,
        point: point({ responded: false, diedWithin10s: false }),
      },
      // ranked, responded, survived — counts into nResp AND top
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 20,
        point: point({ responded: true, diedWithin10s: false }),
      },
      // NOT dangerous — must be excluded from nNoResp/nResp/top regardless of pct
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 95,
        point: point({ dangerous: false, responded: false }),
      },
      // gated (infeasible) — excluded from everything
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 95,
        point: point({ feasible: false, responded: false }),
      },
      // unranked — excluded from everything
      { bracket: "3v3", role: "healer" as const, pct: null, point: point() },
    ];
    const t = buildBehaviorPriorTable(rows, meta);
    const cell = t.cells["3v3|healer|>=20%"]!;
    expect(cell.nNoResp).toBe(2);
    expect(cell.deathNoResp).toBe(0.5);
    expect(cell.nResp).toBe(1);
    expect(cell.deathResp).toBe(0);
    expect(cell.top).toEqual([["selfHeal", 1]]); // the single low-pct (20) responder still counts — no rank filter
    expect(cell.outcome).toBe("ownDeath10s");
    expect(t.cells["3v3|healer|*"]!.nNoResp).toBe(2);
  });
  it("dangerous:false never produces a <10% cell, even when every row is dmg2s<10%", () => {
    const rows = [
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 95,
        point: point({ dmg2s: 0.05, dangerous: false }),
      },
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 20,
        point: point({ dmg2s: 0.05, dangerous: false, responded: false }),
      },
    ];
    const t = buildBehaviorPriorTable(rows, meta);
    expect(t.cells["3v3|healer|<10%"]).toBeUndefined();
    expect(Object.keys(t.cells)).toEqual([]);
  });
  it("top lists at most three responses, descending, computed over ALL responders (nResp) — a pct-20 responder contributes", () => {
    const rows = [
      {
        bracket: "2v2",
        role: "healer" as const,
        pct: 99,
        point: point({
          responses: {
            selfHeal: true,
            wall: true,
            external: false,
            control: true,
            peel: false,
            protective: false,
            kite: true,
          },
        }),
      },
      {
        bracket: "2v2",
        role: "healer" as const,
        pct: 60,
        point: point({
          responses: {
            selfHeal: true,
            wall: true,
            external: false,
            control: false,
            peel: false,
            protective: false,
            kite: false,
          },
        }),
      },
      {
        bracket: "2v2",
        role: "healer" as const,
        pct: 20,
        point: point({
          responses: {
            selfHeal: true,
            wall: false,
            external: false,
            control: false,
            peel: false,
            protective: false,
            kite: false,
          },
        }),
      },
    ];
    const t = buildBehaviorPriorTable(rows, meta);
    expect(t.cells["2v2|healer|>=20%"]!.nResp).toBe(3);
    expect(t.cells["2v2|healer|>=20%"]!.top).toEqual([
      ["selfHeal", 1],
      ["wall", 0.67],
      ["control", 0.33],
    ]);
  });
  it("outcomeOf: Rated Solo Shuffle maps to teamDeath15s for a HEALER, everything else (bracket or role) maps to ownDeath10s (spec §1c, tightened §1d)", () => {
    expect(TEAM_OUTCOME_BRACKETS.has("Rated Solo Shuffle")).toBe(true);
    expect(outcomeOf("Rated Solo Shuffle", "healer")).toBe("teamDeath15s");
    expect(outcomeOf("3v3", "healer")).toBe("ownDeath10s");
    expect(outcomeOf("2v2", "healer")).toBe("ownDeath10s");
    expect(outcomeOf("Rated Battleground", "healer")).toBe("ownDeath10s");
  });
  it("outcomeOf: a DPS owner is ownDeath10s in every bracket, Solo Shuffle included (spec §1d — DPS is the kill target far more often)", () => {
    expect(outcomeOf("Rated Solo Shuffle", "dps")).toBe("ownDeath10s");
    expect(outcomeOf("3v3", "dps")).toBe("ownDeath10s");
    expect(outcomeOf("2v2", "dps")).toBe("ownDeath10s");
  });
  it("cell keys carry role (spec §1d): a healer row and a dps row for the same bracket land in separate cells, never merged", () => {
    const rows = [
      { bracket: "3v3", role: "healer" as const, pct: 95, point: point() },
      { bracket: "3v3", role: "dps" as const, pct: 95, point: point() },
    ];
    const t = buildBehaviorPriorTable(rows, meta);
    expect(Object.keys(t.cells).sort()).toEqual([
      "3v3|dps|*",
      "3v3|dps|>=20%",
      "3v3|healer|*",
      "3v3|healer|>=20%",
    ]);
    expect(t.cells["3v3|healer|>=20%"]!.nResp).toBe(1);
    expect(t.cells["3v3|dps|>=20%"]!.nResp).toBe(1);
  });
  it("a dps cell in Rated Solo Shuffle counts via ownDeath10s (diedWithin10s), a healer cell in the same bracket counts via teamDeath15s (friendDiedWithin15s) — same bracket, different outcome by role", () => {
    const rows = [
      {
        bracket: "Rated Solo Shuffle",
        role: "dps" as const,
        pct: 95,
        point: point({
          responded: false,
          diedWithin10s: true,
          friendDiedWithin15s: false,
        }),
      },
      {
        bracket: "Rated Solo Shuffle",
        role: "healer" as const,
        pct: 95,
        point: point({
          responded: false,
          diedWithin10s: false,
          friendDiedWithin15s: true,
        }),
      },
    ];
    const t = buildBehaviorPriorTable(rows, meta);
    const dpsCell = t.cells["Rated Solo Shuffle|dps|>=20%"]!;
    const healerCell = t.cells["Rated Solo Shuffle|healer|>=20%"]!;
    expect(dpsCell.outcome).toBe("ownDeath10s");
    expect(dpsCell.deathNoResp).toBe(1); // diedWithin10s=true counted
    expect(healerCell.outcome).toBe("teamDeath15s");
    expect(healerCell.deathNoResp).toBe(1); // friendDiedWithin15s=true counted
  });
  it("a Solo Shuffle cell counts deaths via friendDiedWithin15s (ignoring diedWithin10s); a 3v3 cell counts via diedWithin10s (ignoring friendDiedWithin15s); outcome is stamped on both", () => {
    const soloRows = [
      {
        bracket: "Rated Solo Shuffle",
        role: "healer" as const,
        pct: 95,
        point: point({
          responded: false,
          diedWithin10s: true, // must be IGNORED for a Solo cell
          friendDiedWithin15s: false,
        }),
      },
      {
        bracket: "Rated Solo Shuffle",
        role: "healer" as const,
        pct: 50,
        point: point({
          responded: false,
          diedWithin10s: false,
          friendDiedWithin15s: true,
        }),
      },
    ];
    const solo = buildBehaviorPriorTable(soloRows, meta);
    const soloCell = solo.cells["Rated Solo Shuffle|healer|>=20%"]!;
    expect(soloCell.outcome).toBe("teamDeath15s");
    expect(soloCell.nNoResp).toBe(2);
    expect(soloCell.deathNoResp).toBe(0.5); // 1 of 2 by friendDiedWithin15s, not diedWithin10s (which would give 0.5 too by coincidence of counts, but the *identity* differs — see the isolated case below)

    // isolate the predicate choice: diedWithin10s says "both died", friendDiedWithin15s says "neither did"
    const soloIsolated = [
      {
        bracket: "Rated Solo Shuffle",
        role: "healer" as const,
        pct: 95,
        point: point({
          responded: false,
          diedWithin10s: true,
          friendDiedWithin15s: false,
        }),
      },
      {
        bracket: "Rated Solo Shuffle",
        role: "healer" as const,
        pct: 50,
        point: point({
          responded: false,
          diedWithin10s: true,
          friendDiedWithin15s: false,
        }),
      },
    ];
    const soloIsolatedCell = buildBehaviorPriorTable(soloIsolated, meta).cells[
      "Rated Solo Shuffle|healer|>=20%"
    ]!;
    expect(soloIsolatedCell.deathNoResp).toBe(0); // diedWithin10s is all true but must be ignored

    const teamRows = [
      {
        bracket: "3v3",
        role: "healer" as const,
        pct: 95,
        point: point({
          responded: false,
          diedWithin10s: true,
          friendDiedWithin15s: false, // must be IGNORED for a non-Solo cell
        }),
      },
    ];
    const team = buildBehaviorPriorTable(teamRows, meta);
    const teamCell = team.cells["3v3|healer|>=20%"]!;
    expect(teamCell.outcome).toBe("ownDeath10s");
    expect(teamCell.deathNoResp).toBe(1);
  });
});
