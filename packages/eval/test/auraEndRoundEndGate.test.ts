import { emitEnemyBuffEntries } from "@gladlog/analysis/src/context/timelineSections/enemyBuff";
import {
  CC_STILL_ON_AT_ROUND_END,
  renderedCcSpan,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  AURA_STILL_UP_AT_ROUND_END,
  roundEndLegend,
  SOLO_SHUFFLE_BRACKET,
} from "@gladlog/analysis/src/utils/roundEnd";
import { describe, expect, it } from "vitest";

import { checkAuraEndWithinRound } from "../src/quality/promptQualityCheck";

// F02b: no line states an aura's end, or a control's length, past the
// round's end. The gate reads the round's end off the prompt (`[MATCH END]`,
// and a Solo Shuffle round's first `[DEATH]` line) — the producers cut at
// `roundEndMs`.
const header = (bracket: string) =>
  `  Spec: Restoration Shaman (Healer)  |  Bracket: ${bracket}  |  Result: Loss  |  Duration: 2:38  |  Map: Nagrand Arena`;
const DEATH =
  "2:36  [DEATH]  3(RShaman) (Restoration Shaman — friendly) | dampening: 31%";
const MATCH_END = "2:38  [MATCH END]   damp: 31%";
const prompt = (bracket: string, ...lines: string[]) => [
  header(bracket),
  ...lines,
  DEATH,
  MATCH_END,
];
const shuffle = (...lines: string[]) =>
  checkAuraEndWithinRound(prompt(SOLO_SHUFFLE_BRACKET, ...lines));

describe("checkAuraEndWithinRound — [BUFF FADED] / [ENEMY BUFF END]", () => {
  it("passes an end inside the round, and the round-end label in the round-end second", () => {
    expect(
      shuffle(
        "2:20  [BUFF FADED]   Spirit Link Totem (expired)",
        "2:36  [BUFF FADED]   Ascendance (removed at your death)",
        `2:36  [BUFF FADED]   Astral Shift (${AURA_STILL_UP_AT_ROUND_END})`,
        "2:30  [ENEMY BUFF END]   4(HPriest): Power Infusion",
        `2:36  [ENEMY BUFF END]   5(ARogue): Power Infusion (${AURA_STILL_UP_AT_ROUND_END})`,
      ),
    ).toEqual([]);
  });

  it("fails a line after the Solo Shuffle round's ending death — s0/1-4-11 `2:37 [BUFF FADED] Astral Shift (expired)`", () => {
    const fails = shuffle(
      "2:37  [BUFF FADED]   Astral Shift (expired)",
      "2:38  [BUFF FADED]   Ascendance (ended early — no dispel logged)",
      "2:38  [ENEMY BUFF END]   4(HPriest): Power Infusion",
    );
    expect(fails).toHaveLength(3);
    expect(fails[0]).toContain("line 2: [BUFF FADED] 行在回合结束之后");
    expect(fails[0]).toContain("第一条 [DEATH] 行在 2:36");
    expect(fails[2]).toContain("line 4: [ENEMY BUFF END] 行在回合结束之后");
  });

  it("fails the round-end label printed anywhere but the round-end second", () => {
    const fails = shuffle(
      `2:20  [BUFF FADED]   Astral Shift (${AURA_STILL_UP_AT_ROUND_END})`,
    );
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("却不在回合结束那一秒");
  });

  it("another bracket ends at [MATCH END]: a line between a death and it is in the round", () => {
    expect(
      checkAuraEndWithinRound(
        prompt(
          "Rated Arena 3v3",
          "2:37  [BUFF FADED]   Astral Shift (expired)",
          `2:38  [BUFF FADED]   Ascendance (${AURA_STILL_UP_AT_ROUND_END})`,
        ),
      ),
    ).toEqual([]);
    expect(
      checkAuraEndWithinRound(
        prompt(
          "Rated Arena 3v3",
          "2:39  [BUFF FADED]   Astral Shift (expired)",
        ),
      ),
    ).toHaveLength(1);
  });

  it("no round end stated → nothing to hold a line to", () => {
    expect(
      checkAuraEndWithinRound([
        header(SOLO_SHUFFLE_BRACKET),
        "2:37  [BUFF FADED]   Astral Shift (expired)",
      ]),
    ).toEqual([]);
  });
});

describe("checkAuraEndWithinRound — control lines", () => {
  const cut = (seconds: number) =>
    renderedCcSpan({ durationSeconds: seconds, stillOnAtRoundEnd: true });

  it("passes a length that ends by the round's end (± the grid's one second) and a labelled cut that ends there", () => {
    expect(cut(1.2)).toBe(`${CC_STILL_ON_AT_ROUND_END}, 1s in`);
    expect(
      shuffle(
        "2:30  [SILENCE]   3(RShaman) ← Silence (by 4(SPriest)) | 4s",
        // 2:33.9 + 2.6 s = 2:36.5: floor 2:33 + round 3 = 2:36
        "2:33  [CC ON TEAM]   3(RShaman) ← Kidney Shot (by 4(ORogue)) | 3s [DR: Stun Full]",
        // the grid: start floored, length rounded → one second over
        "2:34  [DISARM]   3(ARogue) ← Dismantle (by 5(ARogue)) | 3s",
        `2:35  [SILENCE]   3(RShaman) ← Silence (by 4(SPriest)) | ${cut(1.2)}`,
        `2:36  [SILENCE]   3(RShaman) ← Strangulate (by 4(UDKnight)) | ${cut(0.3)}`,
        `2:33  [CC ON ENEMY]   5(HPriest) ← Freezing Trap (by 3(SHunter)) (${cut(3.4)}) [DR: Incapacitate Full]`,
        `2:34  [DISARM]   3(ARogue) ← Dismantle (by 5(ARogue)) | ${cut(2.9)}`,
      ),
    ).toEqual([]);
  });

  it("fails an unlabelled length that runs past the round's end — s0/134-2-775 `2:12 [SILENCE] … | 3s` under a round that ended at 2:13", () => {
    const fails = shuffle(
      "2:35  [SILENCE]   3(RShaman) ← Silence (by 4(SPriest)) | 3s",
      "2:33  [DISARM]   3(ARogue) ← Dismantle (by 5(ARogue)) | 5s",
      "2:34  [CC ON ENEMY]   5(HPriest) ← Freezing Trap (by 3(SHunter)) (6s) [DR: Incapacitate Full]",
      "2:34  [CC ON TEAM]   3(RShaman) ← Fear (by 5(AWarlock)) | 6s [DR: Disorient Full]",
    );
    expect(fails).toHaveLength(4);
    expect(fails[0]).toContain(
      "line 2: [SILENCE] 行的时长越过回合结束(起点 + 时长 = 2:38)",
    );
    expect(fails[1]).toContain("[DISARM] 行的时长越过回合结束");
    expect(fails[2]).toContain("[CC ON ENEMY] 行的时长越过回合结束");
    expect(fails[3]).toContain("[CC ON TEAM] 行的时长越过回合结束");
  });

  it("fails a control that starts after the round's end, and a labelled cut that does not end at it", () => {
    const fails = shuffle(
      "2:37  [SILENCE]   1(HPriest) ← Spider Venom (by 4(BMHunter)) | 1s",
      `2:20  [SILENCE]   3(RShaman) ← Silence (by 4(SPriest)) | ${cut(2)}`,
      `2:30  [CC ON ENEMY]   5(HPriest) ← Freezing Trap (by 3(SHunter)) (${cut(9)}) [DR: Incapacitate Full]`,
    );
    expect(fails).toHaveLength(3);
    expect(fails[0]).toContain("[SILENCE] 行起于回合结束之后");
    expect(fails[1]).toContain("不在回合结束处");
    expect(fails[2]).toContain("起点 + 时长 = 2:39 不在回合结束处");
  });

  it("a trinket / Tremor break states its own time and is not read as the control's length", () => {
    expect(
      shuffle(
        "2:35  [CC ON TEAM]   3(RShaman) ← Fear (by 5(AWarlock)) | trinket broke this CC after 1s (cut short — it had not expired) [DR: Disorient Full]",
      ),
    ).toEqual([]);
  });
});

describe("emitEnemyBuffEntries — the producer the gate holds (F02b)", () => {
  const T0 = 1_700_000_000_000;
  const run = (
    intervals: Array<{ startSeconds: number; endSeconds: number }>,
    roundEndS: number,
  ) => {
    const out: string[] = [];
    emitEnemyBuffEntries({
      enemyBuffIntervals: new Map([
        [
          "Priest",
          intervals.map((iv) => ({
            ...iv,
            spellId: "10060",
            spellName: "Power Infusion",
            purgeable: true,
          })),
        ],
      ]),
      droppedBuffIntervals: new Set(),
      buffPurgeAnnotations: new Map(),
      addEntry: (_t: number, ...lines: unknown[]) => {
        out.push(...(lines as string[]));
        return true;
      },
      enemyPid: () => "4(HPriest)",
      matchStartMs: T0,
      roundEndAtMs: T0 + roundEndS * 1000,
    } as never);
    return out.filter((l) => l.includes("[ENEMY BUFF END]"));
  };

  it("an end inside the round prints as it was; one at or after the round's end sits at it with the label; a buff that went up after it has no end line", () => {
    const lines = run(
      [
        { startSeconds: 100, endSeconds: 115 },
        { startSeconds: 150, endSeconds: 158.2 },
        { startSeconds: 156.5, endSeconds: 158.2 },
      ],
      156,
    );
    expect(lines).toEqual([
      "1:55  [ENEMY BUFF END]   4(HPriest): Power Infusion",
      `2:36  [ENEMY BUFF END]   4(HPriest): Power Infusion (${AURA_STILL_UP_AT_ROUND_END})`,
    ]);
    expect(
      checkAuraEndWithinRound(prompt(SOLO_SHUFFLE_BRACKET, ...lines)),
    ).toEqual([]);
  });
});

// 2026-10-11: `[ENEMY DEF] … still up when the round ended` is held to the
// same second as `[BUFF FADED]` — one round end in a prompt.
describe("checkAuraEndWithinRound — [ENEMY DEF]", () => {
  const D = (at: string, rest: string) =>
    `${at}  [ENEMY DEF]   6(BDruid) (Balance Druid): ${rest}`;
  const UP = `— ${AURA_STILL_UP_AT_ROUND_END}`;

  it("passes a length that ends inside the round, and the label on a length that ends in the round-end second (2:36)", () => {
    expect(
      shuffle(
        D("2:10", "Barkskin (30%, 12.0s) (at 51% HP)"),
        D("2:35", `Barkskin (30%, 1.4s ${UP}) (at 51% HP)`),
        D("2:31", `Divine Shield (immune, 5.0s ${UP})`),
        D("2:34", `Feign Death (absorb 30k, 2.0s ${UP})`),
        D(
          "2:33",
          `Ironbark → 4(FMage) (3.4s ${UP}) (target at 40% HP) | during it: 1(AWarrior) 12k on target · 40% of their enemy-player damage · direct 12k / periodic 0k · damage in 2 of 3 s · longest gap 1 s`,
        ),
        // no length at all: a press after the round, an unseen carrier
        D("2:37", "Divine Shield (immune)"),
        D("2:35", "Vanish (immune, end not logged)"),
        `2:36  [BUFF FADED]   Astral Shift (${AURA_STILL_UP_AT_ROUND_END})`,
      ),
    ).toEqual([]);
  });

  it("fails the label on a length counted to the LOG's end — s0/101-1-549 `2:27 … Barkskin (30%, 3.5s — still up when the round ended)` under a death at 2:28", () => {
    // the same shape on this fixture's round (death 2:36, log end 2:38)
    const fails = shuffle(
      D("2:35", `Barkskin (30%, 3.5s ${UP}) (at 51% HP)`),
      D("2:33", `Ironbark → 4(FMage) (5.4s ${UP}) (target at 40% HP)`),
    );
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain("line 2: [ENEMY DEF] 行的时长越过回合结束");
    expect(fails[0]).toContain("第一条 [DEATH] 行在 2:36");
  });

  it("fails the label on a length that stops short of the round's end, and an unlabelled length that runs past it", () => {
    const fails = shuffle(
      D("2:20", `Barkskin (30%, 4.0s ${UP})`),
      D("2:30", "Barkskin (30%, 12.0s)"),
    );
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain("但起点 + 时长在回合结束之前");
    expect(fails[1]).toContain("[ENEMY DEF] 行的时长越过回合结束");
  });

  it("another bracket: the same lines are held to [MATCH END] (2:38)", () => {
    expect(
      checkAuraEndWithinRound(
        prompt(
          "Rated Arena 3v3",
          D("2:35", `Barkskin (30%, 3.5s ${UP})`),
          D("2:30", "Barkskin (30%, 8.0s)"),
        ),
      ),
    ).toEqual([]);
    expect(
      checkAuraEndWithinRound(
        prompt("Rated Arena 3v3", D("2:35", `Barkskin (30%, 1.4s ${UP})`)),
      ),
    ).toHaveLength(1);
  });
});

describe("checkAuraEndWithinRound — the legend says which instant `the round ended` is", () => {
  const LEGEND_HEAD = "MATCH TIMELINE";
  const stated = `2:36  [BUFF FADED]   Astral Shift (${AURA_STILL_UP_AT_ROUND_END})`;

  it("a timeline line that says it needs the producer's legend lines for the header's bracket", () => {
    for (const bracket of [SOLO_SHUFFLE_BRACKET, "Rated Arena 3v3"]) {
      const ok = [
        header(bracket),
        LEGEND_HEAD,
        ...roundEndLegend(bracket),
        ...(bracket === SOLO_SHUFFLE_BRACKET
          ? [stated]
          : [
              `2:38  [BUFF FADED]   Astral Shift (${AURA_STILL_UP_AT_ROUND_END})`,
            ]),
        DEATH,
        MATCH_END,
      ];
      expect(checkAuraEndWithinRound(ok), bracket).toEqual([]);
      // mutation: the legend of the OTHER bracket, or none
      const wrong = ok.filter((l) => !roundEndLegend(bracket).includes(l));
      const fails = checkAuraEndWithinRound(wrong);
      expect(fails, bracket).toHaveLength(1);
      expect(fails[0]).toContain("图例却没有说明它指哪一刻");
      expect(
        checkAuraEndWithinRound([
          ...wrong.slice(0, 2),
          ...roundEndLegend(
            bracket === SOLO_SHUFFLE_BRACKET ? "2v2" : SOLO_SHUFFLE_BRACKET,
          ),
          ...wrong.slice(2),
        ]),
        bracket,
      ).toHaveLength(1);
    }
  });

  it("no line says it → no legend asked for; a prompt without the timeline's legend is not judged on it", () => {
    expect(
      checkAuraEndWithinRound([
        header(SOLO_SHUFFLE_BRACKET),
        LEGEND_HEAD,
        // the static legend text mentions the words; it is not a timeline line
        "    `— still up when the round ended` = the round ended before it did;",
        "2:20  [BUFF FADED]   Spirit Link Totem (expired)",
        DEATH,
        MATCH_END,
      ]),
    ).toEqual([]);
    expect(shuffle(stated)).toEqual([]);
  });
});
