import { describe, expect, it } from "vitest";
import { deriveRoster } from "../src/renderer/src/report/derive/roster";
import { loadMatchFixture } from "./fixtures/loadFixture";

describe("deriveRoster", () => {
  const m = loadMatchFixture();
  it("两队、每队相同人数、玩家队在前", () => {
    const teams = deriveRoster(m);
    expect(teams).toHaveLength(2);
    expect(teams[0]!.players.length).toBe(teams[1]!.players.length);
    const totalPlayers = teams[0]!.players.length + teams[1]!.players.length;
    const expectedCount = Object.values(m.units).filter(
      (u: any) => u.kind === "Player" && u.info
    ).length;
    expect(totalPlayers).toBe(expectedCount);
    expect(teams[0]!.isPlayerTeam).toBe(true);
  });
  it("胜负标注与 winningTeamId 一致;log owner 恰好一人", () => {
    const teams = deriveRoster(m);
    const winners = teams.filter((t) => t.isWinner);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.teamId).toBe(m.winningTeamId);
    const owners = teams.flatMap((t) => t.players).filter((p) => p.isLogOwner);
    expect(owners).toHaveLength(1);
    expect(owners[0]!.unitId).toBe(m.playerId);
  });
  it("队内按名字升序;rating 来自 CombatantInfo", () => {
    const teams = deriveRoster(m);
    for (const t of teams) {
      const names = t.players.map((p) => p.name);
      expect(names).toEqual([...names].sort());
    }
    expect(
      teams
        .flatMap((t) => t.players)
        .every((p) => p.rating === null || typeof p.rating === "number"),
    ).toBe(true);
  });
});
