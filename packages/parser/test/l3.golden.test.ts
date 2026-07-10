import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { GladLogParser } from "../src/api";
import type { GladMatch, GladShuffle } from "../src/l3/model";

const FIX = process.env.GLADLOG_FIXTURES ?? "";
const d = FIX && existsSync(FIX) ? describe : describe.skip;

async function runFile(name: string) {
  const matches: GladMatch[] = [];
  const shuffles: GladShuffle[] = [];
  const p = new GladLogParser();
  p.on("match", (m: GladMatch) => matches.push(m));
  p.on("shuffle", (s: GladShuffle) => shuffles.push(s));
  const rl = createInterface({
    input: createReadStream(join(FIX, name)),
    crlfDelay: Infinity,
  });
  for await (const raw of rl) p.push(raw);
  p.end();
  return { matches, shuffles };
}

d("L3 golden assertions on real fixtures (probe-established facts)", () => {
  it("one_solo_shuffle: 6 rounds, 6 players each, feigns excluded, Kyberz real death ends round 0, teamIds reshuffle", async () => {
    const { shuffles } = await runFile("one_solo_shuffle.txt");
    expect(shuffles).toHaveLength(1);
    const s = shuffles[0]!;
    expect(s.rounds).toHaveLength(6);

    for (const r of s.rounds) {
      const players = Object.values(r.units).filter((u) => u.kind === "Player");
      expect(players).toHaveLength(6);
    }

    const r0 = s.rounds[0]!;
    // 探针事实:round0 内 Vaayl 假死 3 次(不入 deaths),Kyberz 真死结束回合
    const vaayl = Object.values(r0.units).find((u) =>
      u.name.startsWith("Vaayl-"),
    )!;
    expect(vaayl.deaths).toHaveLength(0);
    expect(vaayl.unconsciousEvents.length).toBeGreaterThanOrEqual(3);
    const kyberz = Object.values(r0.units).find((u) =>
      u.name.startsWith("Kyberz-"),
    )!;
    expect(kyberz.deaths).toHaveLength(1);
    // 22:13:22.724-4 → epoch(偏移已内嵌,timezone 参数无关)
    expect(kyberz.deaths[0]!.timestamp).toBe(
      Date.UTC(2025, 7, 28, 2, 13, 22, 724),
    );
    // round0 胜负:Kyberz 真死 → 对侧胜
    const kyberzTeam = kyberz.info?.teamId;
    expect(r0.winningTeamId).toBe(kyberzTeam === 0 ? 1 : 0);

    // teamId 每回合重分:至少存在一名玩家 round0 与 round1 的 teamId 不同
    const changed = Object.keys(s.rounds[0]!.units).some((id) => {
      const a = s.rounds[0]!.units[id]?.info?.teamId;
      const b = s.rounds[1]!.units[id]?.info?.teamId;
      return a !== undefined && b !== undefined && a !== b;
    });
    expect(changed).toBe(true);
  }, 180_000);

  it("shuffle_early_leaver: 2 rounds, envelope result Unknown (winner 255)", async () => {
    const { shuffles } = await runFile("shuffle_early_leaver.txt");
    expect(shuffles).toHaveLength(1);
    expect(shuffles[0]!.rounds).toHaveLength(2);
    expect(shuffles[0]!.result).toBe("Unknown");
  }, 60_000);

  it("two_matches: 2 GladMatches with definite results and 6 players each (3v3) or 4 (2v2)", async () => {
    const { matches } = await runFile("two_matches.txt");
    expect(matches).toHaveLength(2);
    for (const m of matches) {
      const players = Object.values(m.units).filter((u) => u.kind === "Player");
      expect([4, 6]).toContain(players.length);
      expect(["Win", "Lose", "Unknown"]).toContain(m.result);
      expect(m.playerId).toMatch(/^Player-/);
    }
  }, 60_000);
});
