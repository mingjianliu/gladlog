import { describe, expect, it } from "vitest";

import {
  checkOffensiveWindowHeaderSpan,
  checkOffensiveWindowSpikeCredit,
  checkOffensiveWindowSpikeMarker,
} from "../src/quality/promptQualityCheck";

describe("checkOffensiveWindowSpikeMarker", () => {
  it("passes when the required marker matches placement on the render grid", () => {
    const lines = [
      // inside: no marker
      "0:12  [OFFENSIVE WINDOW]   0:12–0:29 | peak spike 1.75M on 3(BDruid) (Balance Druid) over 0:14–0:24 | CDs: Trueshot@0:12",
      // runs-past: (runs past window)
      "0:42  [OFFENSIVE WINDOW]   0:42–1:03 | peak spike 1.30M on 3(EShaman) (Enhancement Shaman) over 0:44–1:05 (runs past window) | CDs: Avatar@0:42",
      // after: (lands after window)
      "1:15  [OFFENSIVE WINDOW]   1:15–1:35 | peak spike 1.03M on 3(EShaman) (Enhancement Shaman) over 1:37–1:47 (lands after window) | CDs: Avatar@1:15",
    ];
    expect(checkOffensiveWindowSpikeMarker(lines)).toEqual([]);
  });

  it("fails when a marker is missing on a line whose spike ends after the window", () => {
    const lines = [
      "1:15  [OFFENSIVE WINDOW]   1:15–1:35 | peak spike 1.03M on 3(EShaman) (Enhancement Shaman) over 1:37–1:47 | CDs: Avatar@1:15",
    ];
    const fails = checkOffensiveWindowSpikeMarker(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("缺少标注 (lands after window)");
  });

  it("fails when the wrong marker is present", () => {
    const lines = [
      // spike is fully after (1:37 >= 1:35), but marked (runs past window)
      "1:15  [OFFENSIVE WINDOW]   1:15–1:35 | peak spike 1.03M on 3(EShaman) (Enhancement Shaman) over 1:37–1:47 (runs past window) | CDs: Avatar@1:15",
    ];
    const fails = checkOffensiveWindowSpikeMarker(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain(
      "标注应为 (lands after window),实为 (runs past window)",
    );
  });

  it("fails when a spurious marker is present on an inside spike", () => {
    const lines = [
      // spike is inside (0:24 <= 0:29), but carries a marker
      "0:12  [OFFENSIVE WINDOW]   0:12–0:29 | peak spike 1.75M on 3(BDruid) (Balance Druid) over 0:14–0:24 (lands after window) | CDs: Trueshot@0:12",
    ];
    const fails = checkOffensiveWindowSpikeMarker(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("不应有标注 (lands after window)");
  });
});

// T12 ③ (user ruling 2026-10-10): a spike is named only on a window its
// bucket overlaps, and on one window.
describe("checkOffensiveWindowSpikeCredit", () => {
  const spike = (span: string, unit: string, amount: string) =>
    `${span}  [DMG SPIKE]   ${unit} (Balance Druid): ${amount}M in 10s (166k DPS) (90% -> 40% HP, -5%/s) | no enemy CC in window`;
  const header = (at: string, span: string, clause: string) =>
    `${at}  [OFFENSIVE WINDOW]   ${span} | ${clause} | CDs: Combustion@${at}`;
  const peak = (amount: string, unit: string, span: string, marker = "") =>
    `peak spike ${amount}M on ${unit} (Balance Druid) over ${span}${marker}`;
  const NONE = "no listed [DMG SPIKE] credited to it";

  it("passes when each window names the largest spike credited to it", () => {
    expect(
      checkOffensiveWindowSpikeCredit([
        header("0:32", "0:32–0:54", peak("1.66", "1(BDruid)", "0:37–0:47")),
        spike("0:37–0:47", "1(BDruid)", "1.66"),
        header("0:55", "0:55–1:10", peak("1.90", "1(BDruid)", "0:57–1:07")),
        spike("0:57–1:07", "1(BDruid)", "1.90"),
      ]),
    ).toEqual([]);
  });

  it("539b6ed0 as it was rendered: a header naming the spike that began after its window ended", () => {
    const fails = checkOffensiveWindowSpikeCredit([
      header(
        "0:32",
        "0:32–0:54",
        peak("1.90", "1(BDruid)", "0:57–1:07", " (lands after window)"),
      ),
      spike("0:37–0:47", "1(BDruid)", "1.66"),
      header("0:55", "0:55–1:10", peak("1.90", "1(BDruid)", "0:57–1:07")),
      spike("0:57–1:07", "1(BDruid)", "1.90"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("与窗口没有交集");
  });

  it("fails when a spike overlapping two windows is named on the one it overlaps less", () => {
    // 0:50–1:00: 4 s in 0:32–0:54, 5 s in 0:55–1:10
    const fails = checkOffensiveWindowSpikeCredit([
      header(
        "0:32",
        "0:32–0:54",
        peak("1.90", "1(BDruid)", "0:50–1:00", " (runs past window)"),
      ),
      spike("0:50–1:00", "1(BDruid)", "1.90"),
      header("0:55", "0:55–1:10", peak("1.90", "1(BDruid)", "0:50–1:00")),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("归属 0:55–1:10 的窗口");
  });

  it("fails when a header says none is credited while a listed spike is", () => {
    const fails = checkOffensiveWindowSpikeCredit([
      header("0:32", "0:32–0:54", NONE),
      spike("0:37–0:47", "1(BDruid)", "1.66"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("归属本窗口");
  });

  it("passes a header that says none when the only overlapping spike belongs to the other window", () => {
    expect(
      checkOffensiveWindowSpikeCredit([
        header("0:32", "0:32–0:54", NONE),
        spike("0:50–1:00", "1(BDruid)", "1.90"),
        header("0:55", "0:55–1:10", peak("1.90", "1(BDruid)", "0:50–1:00")),
      ]),
    ).toEqual([]);
  });

  it("fails when the named spike is not the largest credited to the window", () => {
    const fails = checkOffensiveWindowSpikeCredit([
      header("0:32", "0:32–1:10", peak("1.66", "1(BDruid)", "0:37–0:47")),
      spike("0:37–0:47", "1(BDruid)", "1.66"),
      spike("0:57–1:07", "2(SHunter)", "1.90"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("不是归属本窗口的最大一个");
  });

  it("fails when the named spike has no [DMG SPIKE] line, or a different amount on it", () => {
    expect(
      checkOffensiveWindowSpikeCredit([
        header("0:32", "0:32–0:54", peak("1.66", "1(BDruid)", "0:37–0:47")),
      ])[0],
    ).toContain("没有对应的 [DMG SPIKE] 行");
    expect(
      checkOffensiveWindowSpikeCredit([
        header("0:32", "0:32–0:54", peak("1.66", "1(BDruid)", "0:37–0:47")),
        spike("0:37–0:47", "1(BDruid)", "1.61"),
      ])[0],
    ).toContain("对应的 [DMG SPIKE] 行写 1.61M");
  });

  // Post-hoc review 45-FT-98, finding 4: a bucket closed in the second it
  // opened prints one second (`0:45–0:45 … in 0s`) and is in the window whose
  // printed span holds that second, ends included.
  describe("a [DMG SPIKE] line that prints one second", () => {
    const point = `0:45–0:45  [DMG SPIKE]   1(BDruid) (Balance Druid): 0.40M in 0s (400k DPS)`;

    it("passes: named on the window that ends in that second, with no marker — and the marker gate agrees", () => {
      const lines = [
        header("0:40", "0:40–0:45", peak("0.40", "1(BDruid)", "0:45–0:45")),
        point,
      ];
      expect(checkOffensiveWindowSpikeCredit(lines)).toEqual([]);
      expect(checkOffensiveWindowSpikeMarker(lines)).toEqual([]);
    });

    it("fails a header that says none is credited while that spike sits in its last second (what the producer printed)", () => {
      const fails = checkOffensiveWindowSpikeCredit([
        header("0:40", "0:40–0:45", NONE),
        point,
      ]);
      expect(fails).toHaveLength(1);
      expect(fails[0]).toContain(
        "0.40M on 1(BDruid) over 0:45–0:45 归属本窗口",
      );
    });

    it("fails `(lands after window)` on it; a window that ended the second before does not hold it", () => {
      expect(
        checkOffensiveWindowSpikeMarker([
          header(
            "0:40",
            "0:40–0:45",
            peak("0.40", "1(BDruid)", "0:45–0:45", " (lands after window)"),
          ),
        ])[0],
      ).toContain("不应有标注 (lands after window)");
      expect(
        checkOffensiveWindowSpikeCredit([
          header("0:30", "0:30–0:44", NONE),
          point,
        ]),
      ).toEqual([]);
      expect(
        checkOffensiveWindowSpikeCredit([
          header("0:30", "0:30–0:44", peak("0.40", "1(BDruid)", "0:45–0:45")),
          point,
        ])[0],
      ).toContain("与窗口没有交集");
    });

    it("two windows hold it: it is the earlier one's", () => {
      expect(
        checkOffensiveWindowSpikeCredit([
          header("0:40", "0:40–0:45", peak("0.40", "1(BDruid)", "0:45–0:45")),
          header("0:43", "0:43–0:45", NONE),
          point,
        ]),
      ).toEqual([]);
      const fails = checkOffensiveWindowSpikeCredit([
        header("0:40", "0:40–0:45", NONE),
        header("0:43", "0:43–0:45", peak("0.40", "1(BDruid)", "0:45–0:45")),
        point,
      ]);
      expect(fails).toHaveLength(2);
      expect(fails[0]).toContain("line 1");
      expect(fails[1]).toContain("归属 0:40–0:45 的窗口");
    });
  });

  it("fails on a clause it cannot read; ignores the legend's mention of the tag", () => {
    expect(
      checkOffensiveWindowSpikeCredit([
        header("0:32", "0:32–0:54", "some other wording"),
      ])[0],
    ).toContain("无法解析 spike 子句");
    expect(
      checkOffensiveWindowSpikeCredit([
        "  [OFFENSIVE WINDOW] `X on <unit>` = damage DEALT TO that unit (it is the victim, not the dealer);",
        `    the printed bounds. \`${NONE}\` = none of this timeline's [DMG SPIKE] lines overlaps the window, or the`,
      ]),
    ).toEqual([]);
  });
});

// T12 ① b (option A) + post-hoc review 45-FT-98, finding 3: the span a header
// prints lies inside the round and does not end before it starts.
describe("checkOffensiveWindowHeaderSpan", () => {
  const prompt = (bracket: string, ...headers: string[]) => [
    `  Spec: Holy Priest (Healer)  |  Bracket: ${bracket}  |  Result: Loss  |  Duration: 3:20  |  Map: Nagrand Arena`,
    ...headers,
    "3:12  [DEATH]  1(HPriest) (Holy Priest — friendly) | dampening: 30%",
    "3:20  [MATCH END]   damp: 32%",
  ];
  const header = (at: string, span: string) =>
    `${at}  [OFFENSIVE WINDOW]   ${span} | no listed [DMG SPIKE] credited to it | CDs: Avatar@${at}`;

  it("passes headers inside the round — ending in, or opened in, the round's last second included", () => {
    expect(
      checkOffensiveWindowHeaderSpan(
        prompt(
          "Rated Solo Shuffle",
          header("3:00", "3:00–3:12"),
          header("3:12", "3:12–3:12"),
        ),
      ),
    ).toEqual([]);
    expect(
      checkOffensiveWindowHeaderSpan(
        prompt("3v3", header("3:14", "3:14–3:20")),
      ),
    ).toEqual([]);
  });

  it("fails the reviewed header: opened after a Solo Shuffle round's end, its end cut before its start", () => {
    const fails = checkOffensiveWindowHeaderSpan(
      prompt("Rated Solo Shuffle", header("3:14", "3:14–3:12")),
    );
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain(
      "line 2: [OFFENSIVE WINDOW] 3:14–3:12 的结束早于开始",
    );
    expect(fails[1]).toContain("开始于回合结束之后");
    expect(fails[1]).toContain("第一条 [DEATH] 行在 3:12");
  });

  it("fails a header whose end runs past the round's end — the first [DEATH] of a Solo Shuffle round, [MATCH END] otherwise", () => {
    const shuffle = checkOffensiveWindowHeaderSpan(
      prompt("Rated Solo Shuffle", header("3:05", "3:05–3:20")),
    );
    expect(shuffle).toHaveLength(1);
    expect(shuffle[0]).toContain("3:05–3:20 结束于回合结束之后");
    // the same header in a 3v3, where the round runs to the log's end
    expect(
      checkOffensiveWindowHeaderSpan(
        prompt("3v3", header("3:05", "3:05–3:20")),
      ),
    ).toEqual([]);
    const threes = checkOffensiveWindowHeaderSpan(
      prompt("3v3", header("3:05", "3:05–3:35")),
    );
    expect(threes).toHaveLength(1);
    expect(threes[0]).toContain("[MATCH END]在 3:20");
  });

  it("ignores the legend's mention of the tag", () => {
    expect(
      checkOffensiveWindowHeaderSpan(
        prompt(
          "Rated Solo Shuffle",
          "  [OFFENSIVE WINDOW] `X on <unit>` = damage DEALT TO that unit (it is the victim, not the dealer);",
        ),
      ),
    ).toEqual([]);
  });
});
