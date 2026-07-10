import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { parseLine } from "../src/l1/parseLine";
import { Segmenter } from "../src/l2/segmenter";
import type { Segment, ShuffleClose } from "../src/l2/types";
import type { ParsedLine } from "../src/l1/types";

const FIX = process.env.GLADLOG_FIXTURES ?? "";
const hasFixtures = FIX !== "" && existsSync(FIX);
const d = hasFixtures ? describe : describe.skip;

async function runFile(name: string) {
  const matches: { seg: Segment; end: ParsedLine }[] = [];
  const shuffles: ShuffleClose[] = [];
  const diags: { code: string }[] = [];
  const seg = new Segmenter();
  seg.onMatch((s, end) => matches.push({ seg: s, end }));
  seg.onShuffle((s) => shuffles.push(s));
  seg.onDiagnostic((dg) => diags.push(dg));
  const rl = createInterface({
    input: createReadStream(join(FIX, name)),
    crlfDelay: Infinity,
  });
  for await (const raw of rl) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (p) seg.push(p, raw);
  }
  seg.end();
  return { matches, shuffles, diags };
}

d("L2 fixture scenarios (probe-established contract)", () => {
  it("one_solo_shuffle: 1 shuffle, 6 rounds, 6 COMBATANT_INFO per round head, END team 0", async () => {
    const r = await runFile("one_solo_shuffle.txt");
    expect(r.matches).toHaveLength(0);
    expect(r.shuffles).toHaveLength(1);
    const s = r.shuffles[0]!;
    expect(s.rounds).toHaveLength(6);
    // 裁决修正:CI 可与拆场 SPELL_AURA_REMOVED 交错(round3/6 实证),契约=前 12 条内恰 6 条 CI
    for (const round of s.rounds) {
      const head = round.records.slice(0, 12);
      expect(head.filter((x) => x.eventName === "COMBATANT_INFO")).toHaveLength(
        6,
      );
    }
    expect(s.end.arenaEnd?.winningTeamId).toBe(0);
  }, 120_000);

  it("double_start: 1 match + DOUBLE_START diagnostic", async () => {
    const r = await runFile("double_start.txt");
    expect(r.matches).toHaveLength(1);
    expect(r.diags.some((x) => x.code === "DOUBLE_START")).toBe(true);
  }, 60_000);

  it("one_match_synthetic_no_end: nothing emitted + UNCLOSED_SEGMENT", async () => {
    const r = await runFile("one_match_synthetic_no_end.txt");
    expect(r.matches).toHaveLength(0);
    expect(r.shuffles).toHaveLength(0);
    expect(r.diags.some((x) => x.code === "UNCLOSED_SEGMENT")).toBe(true);
  }, 60_000);

  it("shuffle_reloads: 4 shuffles (24 STARTs / 4 ENDs whole-file), 6 rounds each, reloads don't split", async () => {
    // 裁决修正:原契约"1 场"来自只看文件头部的探针;全文件实为 4 场 shuffle
    const r = await runFile("shuffle_reloads.txt");
    expect(r.shuffles).toHaveLength(4);
    for (const s of r.shuffles) expect(s.rounds).toHaveLength(6);
  }, 60_000);

  it("shuffle_early_leaver: 1 shuffle, 2 rounds, END winner sentinel 255", async () => {
    const r = await runFile("shuffle_early_leaver.txt");
    expect(r.shuffles).toHaveLength(1);
    expect(r.shuffles[0]!.rounds).toHaveLength(2);
    expect(r.shuffles[0]!.end.arenaEnd?.winningTeamId).toBe(255);
  }, 60_000);

  it("two_matches: 2 matches emitted", async () => {
    const r = await runFile("two_matches.txt");
    expect(r.matches).toHaveLength(2);
    expect(r.shuffles).toHaveLength(0);
  }, 60_000);
});
