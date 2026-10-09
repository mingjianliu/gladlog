/**
 * FT-T08 step 3c: `ccLoggedEnd` — how a CC application ended as the log
 * states it (the damage that broke it, a dispel, the holder's death), and the
 * clause the control lines print for it.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { DEATH_CASCADE_MS } from "../src/utils/auraEndCause";
import {
  CC_LOGGED_END_NOTE_RE_SRC,
  ccLoggedEnd,
  formatCcLoggedEnd,
} from "../src/utils/ccTrinketAnalysis";

const T0 = 1_000_000;
const POLY = "118";
const aura = (
  event: LogEvent,
  ms: number,
  src: string,
  parameters: unknown[] = [],
) => ({
  logLine: { event, timestamp: ms, parameters },
  timestamp: ms,
  spellId: POLY,
  spellName: "Polymorph",
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: "holder",
  destUnitName: "holder",
});
const brokenSpell = (ms: number, by: string, id: string, name: string) => {
  const parameters: unknown[] = [];
  parameters[11] = id;
  parameters[12] = name;
  return aura(LogEvent.SPELL_AURA_BROKEN_SPELL, ms, by, parameters);
};
const holder = (over: Record<string, unknown>) =>
  ({
    id: "holder",
    name: "holder",
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    deathRecords: [],
    ...over,
  }) as never;
// landed at 10 s, removed at 13.2 s
const cc = { spellId: POLY, atSeconds: 10, durationSeconds: 3.2 };
const label = (name: string, id: string | undefined) => `<${id ?? name}>`;

describe("ccLoggedEnd", () => {
  it("伤害打破:BROKEN_SPELL 行的来源和法术;平砍是 SPELL_AURA_BROKEN", () => {
    const bySpell = holder({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, T0 + 10_000, "mage"),
        brokenSpell(T0 + 13_195, "mate", "133", "Fireball"),
        aura(LogEvent.SPELL_AURA_REMOVED, T0 + 13_200, "mage"),
      ],
    });
    const end = ccLoggedEnd(bySpell, cc, T0);
    expect(end).toEqual({
      kind: "broken",
      spellName: "Fireball",
      byUnitId: "mate",
      byName: "mate",
    });
    expect(formatCcLoggedEnd(end, label)).toBe(" | broken by <mate>'s Fireball");
    const byMelee = holder({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, T0 + 10_000, "mage"),
        aura(LogEvent.SPELL_AURA_BROKEN, T0 + 13_200, "rogue"),
        aura(LogEvent.SPELL_AURA_REMOVED, T0 + 13_200, "mage"),
      ],
    });
    expect(formatCcLoggedEnd(ccLoggedEnd(byMelee, cc, T0), label)).toBe(
      " | broken by <rogue>'s melee hit",
    );
  });

  it("驱散、持有者死亡;都没有 → undefined(到期 / 取消 / 回合结束,日志不说)", () => {
    const removed = [
      aura(LogEvent.SPELL_AURA_APPLIED, T0 + 10_000, "mage"),
      aura(LogEvent.SPELL_AURA_REMOVED, T0 + 13_200, "mage"),
    ];
    const dispelled = holder({
      auraEvents: removed,
      actionIn: [
        {
          logLine: { event: LogEvent.SPELL_DISPEL, timestamp: T0 + 13_200, parameters: [] },
          timestamp: T0 + 13_200,
          spellId: "527",
          spellName: "Purify",
          srcUnitId: "priest",
          srcUnitName: "priest",
          destUnitId: "holder",
          extraSpellId: POLY,
        },
      ],
    });
    expect(formatCcLoggedEnd(ccLoggedEnd(dispelled, cc, T0), label)).toBe(
      " | dispelled by <priest>'s Purify",
    );
    const died = holder({
      auraEvents: removed,
      deathRecords: [{ timestamp: T0 + 13_200 + DEATH_CASCADE_MS }],
    });
    expect(ccLoggedEnd(died, cc, T0)).toEqual({ kind: "death" });
    expect(formatCcLoggedEnd({ kind: "death" }, label)).toBe(" | ended at their death");
    expect(ccLoggedEnd(holder({ auraEvents: removed }), cc, T0)).toBeUndefined();
    expect(formatCcLoggedEnd(undefined, label)).toBe("");
  });

  it("实例的结束不是日志里的一行(回合结束截断 / 按官方时长封口)→ 不读原因(agy 审查)", () => {
    // the aura's REMOVED is logged at 15.0 s, the instance was closed at 13.2 s (round end)
    const clamped = holder({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, T0 + 10_000, "mage"),
        brokenSpell(T0 + 13_195, "mate", "133", "Fireball"),
        aura(LogEvent.SPELL_AURA_REMOVED, T0 + 15_000, "mage"),
      ],
      deathRecords: [{ timestamp: T0 + 13_210 }],
    });
    expect(ccLoggedEnd(clamped, cc, T0)).toBeUndefined();
  });

  it("codex 3c P2-1: 两个施法者的同名控制在同一毫秒结束 —— 原因只读这一份自己的 REMOVED", () => {
    // caster A's copy runs out at 13.2 s; then a melee break and caster B's REMOVED in that same ms
    const two = holder({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, T0 + 10_000, "A"),
        aura(LogEvent.SPELL_AURA_APPLIED, T0 + 10_000, "B"),
        aura(LogEvent.SPELL_AURA_REMOVED, T0 + 13_200, "A"),
        aura(LogEvent.SPELL_AURA_BROKEN, T0 + 13_200, "rogue"),
        aura(LogEvent.SPELL_AURA_REMOVED, T0 + 13_200, "B"),
      ],
    });
    expect(ccLoggedEnd(two, { ...cc, sourceId: "A" }, T0)).toBeUndefined();
    expect(ccLoggedEnd(two, { ...cc, sourceId: "B" }, T0)).toMatchObject({ kind: "broken", byUnitId: "rogue" });
  });

  it("每种子句都能被门规的模式读回,别的写法不能", () => {
    const re = new RegExp(`^${CC_LOGGED_END_NOTE_RE_SRC}$`);
    for (const note of [
      "",
      " | broken by 2(FMage)'s Fire Blast",
      " | broken by 3(BMHunter)'s pet's melee hit",
      " | dispelled by 5(HPriest)'s Purify",
      " | ended at their death",
    ])
      expect(re.test(note)).toBe(true);
    expect(re.test(" | whatever")).toBe(false);
    expect(re.test(" | broken by a | b")).toBe(false);
  });
});
