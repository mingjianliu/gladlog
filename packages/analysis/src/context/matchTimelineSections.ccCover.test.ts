/** 敌方 CC 掩护标注(2026-08-26,逐行探针 R4)的行为钉。 */
import { describe, expect, it } from "vitest";

import type { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import { emitDmgSpikeEntries } from "./matchTimelineSections";

const PW = {
  fromSeconds: 10,
  toSeconds: 20,
  totalDamage: 500_000,
  targetName: "Victim-Realm",
  targetSpec: "Arms Warrior",
};
const sum = (name: string, ccs: Array<[number, number, string]>) =>
  ({
    playerName: name,
    ccInstances: ccs.map(([atSeconds, durationSeconds, spellName]) => ({
      atSeconds,
      durationSeconds,
      spellName,
    })),
  }) as unknown as IPlayerCCTrinketSummary;

function render(extra: Partial<Parameters<typeof emitDmgSpikeEntries>[0]>) {
  const out: string[] = [];
  emitDmgSpikeEntries({
    pressureWindows: [PW] as never,
    friends: [] as never,
    matchStartMs: 0,
    pid: (n) => n.split("-")[0],
    addEntry: (_t, ...ls) => out.push(...ls),
    ...extra,
  });
  return out.join("\n");
}

describe("emitDmgSpikeEntries · 敌方 CC 掩护标注", () => {
  it("受害者排最前(即使时间更晚),治疗次之;上限 3 条并计 +N more", () => {
    const line = render({
      ccTrinketSummaries: [
        sum("Other-R", [[11, 2, "Storm Bolt"]]),
        sum("Heals-R", [[11.5, 3, "Cyclone"]]),
        sum("Victim-Realm", [[18, 5, "Kidney Shot"]]),
        sum("Other2-R", [[12, 1, "Shockwave"]]),
      ],
      ownerName: "Heals-R",
      healerNames: ["Heals-R"],
    });
    const seg = line.split("enemy CC in window: ")[1];
    expect(seg).toBeDefined();
    // 受害者第一,owner 治疗第二,其余按时间;第 4 条折进 +1 more
    expect(
      seg.startsWith("Kidney Shot→the target@0:18 (5s), Cyclone→you@0:11 (3s)"),
    ).toBe(true);
    expect(seg).toContain("+1 more");
    expect(seg).not.toContain("Shockwave");
  });

  it("窗口内无 CC → 显式 no enemy CC in window(缺省歧义是植入实验钉过的坑)", () => {
    const line = render({
      ccTrinketSummaries: [sum("Other-R", [[30, 2, "Storm Bolt"]])],
    });
    expect(line).toContain("| no enemy CC in window");
  });

  it("不传 ccTrinketSummaries → 两种后缀都不渲染(fixture 兼容)", () => {
    const line = render({});
    expect(line).not.toContain("enemy CC in window");
  });

  it("边界:恰好在窗口边上的 CC 不算(atSeconds==to / at+dur==from)", () => {
    const line = render({
      ccTrinketSummaries: [
        sum("A-R", [[20, 5, "Fear"]]),
        sum("B-R", [[5, 5, "Sap"]]),
      ],
    });
    expect(line).toContain("no enemy CC in window");
  });
});
