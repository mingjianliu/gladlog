import { WoWCombatLogParser } from "../src/shim";
import type { IArenaMatch, IShuffleMatch } from "../src/types";
import { CombatResult, CombatUnitSpec } from "../src/enums";

const CI = (guid: string, team: number, spec: number) =>
  `COMBATANT_INFO,${guid},${team},1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,${spec},[(1,2,1)],(0,1,2,3),[(100,200,())],[],248,41,2400,13`;

describe("WoWCombatLogParser shim (legacy call-site pattern)", () => {
  it("arena_match_ended fires with IArenaMatch", () => {
    const parser = new WoWCombatLogParser("retail", "UTC");
    const combats: IArenaMatch[] = [];
    parser.on("arena_match_ended", (c: IArenaMatch) => combats.push(c));
    const lines = [
      "ARENA_MATCH_START,1825,41,3v3,1",
      CI("Player-1-A", 0, 257),
      "ARENA_MATCH_END,0,30,1500,1501",
    ].map((s, i) => `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`);
    for (const l of lines) parser.parseLine(l);
    parser.flush();
    expect(combats).toHaveLength(1);
    expect(combats[0]!.dataType).toBe("ArenaMatch");
    expect(combats[0]!.units["Player-1-A"]!.spec).toBe(
      CombatUnitSpec.Priest_Holy,
    );
    expect(combats[0]!.result).toBe(CombatResult.Win);
  });

  it("solo_shuffle_ended fires with IShuffleMatch (rounds flattenable)", () => {
    const parser = new WoWCombatLogParser("retail");
    const ms: IShuffleMatch[] = [];
    parser.on("solo_shuffle_ended", (m: IShuffleMatch) => ms.push(m));
    const lines = [
      "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
      CI("Player-1-A", 0, 257),
      "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
      CI("Player-1-A", 1, 257),
      "ARENA_MATCH_END,0,155,1729,1730",
    ].map((s, i) => `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`);
    for (const l of lines) parser.parseLine(l);
    parser.flush();
    expect(ms).toHaveLength(1);
    expect(ms[0]!.rounds).toHaveLength(2);
    expect(ms[0]!.rounds[1]!.sequenceNumber).toBe(1);
  });

  it("garbage lines never throw", () => {
    const parser = new WoWCombatLogParser("retail");
    expect(() => {
      parser.parseLine("garbage");
      parser.parseLine("");
    }).not.toThrow();
  });
});
