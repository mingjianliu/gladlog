/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T06: a Stasis is RELEASED when its ready aura (370562) comes off — not
 * when storing ended (370537 REMOVED), which is where the line used to sit.
 * Shapes from 141470d0: storing 1:39.9 → 1:42.9, ready aura off at 1:51.9.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { emitStasisEntries } from "../src/context/timelineSections/stasis";
import { extractStasisEvents } from "../src/utils/combatStates";

const combat = { startTime: 0, endTime: 200_000 } as never;
const aura = (event: LogEvent, spellId: string, ms: number): any => ({
  logLine: { event, timestamp: ms },
  timestamp: ms,
  spellId,
  spellName: "Stasis",
});
const cast = (spellId: string, spellName: string, ms: number): any => ({
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
  spellId,
  spellName,
});
/** storing 99.9 → 102.9 s with three heals, then the ready aura */
const storing = [
  aura(LogEvent.SPELL_AURA_APPLIED, "370537", 99_900),
  aura(LogEvent.SPELL_AURA_REMOVED_DOSE, "370537", 101_300),
  aura(LogEvent.SPELL_AURA_REMOVED_DOSE, "370537", 101_800),
  aura(LogEvent.SPELL_AURA_REMOVED, "370537", 102_900),
  aura(LogEvent.SPELL_AURA_APPLIED, "370562", 102_900),
];
const storedCasts = [
  cast("370537", "Stasis", 99_901),
  cast("366155", "Reversion", 101_300),
  cast("355936", "Dream Breath", 101_800),
  cast("364343", "Echo", 102_900),
];
const replays = (ms: number) => [
  cast("366155", "Reversion", ms + 10),
  cast("355936", "Dream Breath", ms + 380),
  cast("364343", "Echo", ms + 710),
];
const unit = (auraEvents: any[], spellCastEvents: any[]): any => ({
  id: "evoker",
  auraEvents,
  spellCastEvents,
});
const render = (events: ReturnType<typeof extractStasisEvents>) => {
  const lines: string[] = [];
  emitStasisEntries({
    stasisEvents: events,
    addEntry: (_t: number, l: string) => lines.push(l),
  } as never);
  return lines;
};

describe("FT-T06 — Stasis release", () => {
  it("释放时刻 = 就绪光环的 REMOVED,不是储存完成那一刻", () => {
    const u = unit(
      [...storing, aura(LogEvent.SPELL_AURA_REMOVED, "370562", 111_900)],
      [...storedCasts, ...replays(111_900)],
    );
    const [e] = extractStasisEvents(u, combat);
    expect(e).toMatchObject({
      startSeconds: 99.9,
      storedSeconds: 102.9,
      releaseSeconds: 111.9,
      spells: ["Reversion", "Dream Breath", "Echo"],
    });
    expect(render([e!])).toEqual([
      "1:51  [YOU] [STASIS RELEASE] → Reversion, Dream Breath, Echo",
    ]);
  });

  it("回合结束时还存着 / 掉了但什么都没重放 → 不印 RELEASE,在储存时刻说明", () => {
    const held = extractStasisEvents(unit(storing, storedCasts), combat);
    expect(held[0]).toMatchObject({ releaseSeconds: undefined, unreleased: "held" });
    expect(render(held)).toEqual([
      "1:42  [YOU] [STASIS STORED] → Reversion, Dream Breath, Echo (not released before the round ended)",
    ]);
    const lost = extractStasisEvents(
      unit([...storing, aura(LogEvent.SPELL_AURA_REMOVED, "370562", 108_000)], storedCasts),
      combat,
    );
    expect(lost[0]).toMatchObject({ releaseSeconds: undefined, unreleased: "lost" });
    expect(render(lost)[0]).toContain("(never released: it came off with nothing replayed)");
  });

  it("开场前存好的:释放时刻在日志里,内容不在 —— 不从重放去猜(codex 审查)", () => {
    const u = unit(
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "370562", 2_400),
        aura(LogEvent.SPELL_AURA_REMOVED, "370562", 21_000),
      ],
      // replays use their own ids and real presses land between them
      [cast("355941", "Dream Breath", 21_000), cast("364343", "Echo", 21_289), cast("355941", "Dream Breath", 21_361)],
    );
    const events = extractStasisEvents(u, combat);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ releaseSeconds: 21, storedBeforeRound: true, spells: [], storedCount: 0 });
    expect(render(events)).toEqual([
      "0:21  [YOU] [STASIS RELEASE] → stored before this round (its contents are not in this round's log)",
    ]);
  });

  it("回合结束之后才释放 = 回合内没放出来(codex 审查):本回合存的和开场前存的都一样", () => {
    const round = { startTime: 0, endTime: 100_454 } as never;
    const stored = extractStasisEvents(
      unit(
        [
          aura(LogEvent.SPELL_AURA_APPLIED, "370537", 90_000),
          aura(LogEvent.SPELL_AURA_REMOVED_DOSE, "370537", 91_000),
          aura(LogEvent.SPELL_AURA_REMOVED, "370537", 93_813),
          aura(LogEvent.SPELL_AURA_APPLIED, "370562", 93_813),
          aura(LogEvent.SPELL_AURA_REMOVED, "370562", 103_920),
        ],
        [cast("370537", "Stasis", 90_000), cast("366155", "Reversion", 91_000), cast("364343", "Echo", 93_813), ...replays(103_920)],
      ),
      round,
    );
    expect(stored[0]).toMatchObject({ releaseSeconds: undefined, unreleased: "held" });
    expect(render(stored)).toEqual([
      "1:33  [YOU] [STASIS STORED] → Reversion, Echo (not released before the round ended)",
    ]);
    const before = extractStasisEvents(
      unit(
        [aura(LogEvent.SPELL_AURA_APPLIED, "370562", 80_000), aura(LogEvent.SPELL_AURA_REMOVED, "370562", 110_000)],
        replays(110_000),
      ),
      round,
    );
    expect(before[0]).toMatchObject({ releaseSeconds: undefined, unreleased: "held", storedBeforeRound: true });
    expect(render(before)[0]).toContain("[YOU] [STASIS STORED] → stored before this round (not released before the round ended");
  });

  it("日志里没有就绪光环:退回储存结束时刻(旧行为);一次按键写两个 id 只算一个", () => {
    const u = unit(storing.slice(0, 4), [
      cast("370537", "Stasis", 99_901),
      cast("360995", "Verdant Embrace", 101_300),
      cast("361195", "Verdant Embrace", 101_301),
      cast("355936", "Dream Breath", 101_800),
    ]);
    const [e] = extractStasisEvents(u, combat);
    expect(e!.releaseSeconds).toBe(102.9);
    expect(e!.spells).toEqual(["Verdant Embrace", "Dream Breath"]);
  });
  it("储存光环中途被重播(REMOVED / APPLIED 同毫秒)仍是一次储存,不被读成开场前存好的", () => {
    const u = unit(
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "370537", 85_000),
        aura(LogEvent.SPELL_AURA_REMOVED_DOSE, "370537", 86_000),
        aura(LogEvent.SPELL_AURA_REMOVED_DOSE, "370537", 87_500),
        aura(LogEvent.SPELL_AURA_REMOVED, "370537", 90_300),
        aura(LogEvent.SPELL_AURA_APPLIED, "370537", 90_300),
        aura(LogEvent.SPELL_AURA_REMOVED, "370537", 92_400),
        aura(LogEvent.SPELL_AURA_APPLIED, "370562", 92_400),
        aura(LogEvent.SPELL_AURA_REMOVED, "370562", 110_400),
      ],
      [
        cast("370537", "Stasis", 85_000),
        cast("355936", "Dream Breath", 86_000),
        // one Verdant Embrace press: 360995 at the press, 361195 when it lands
        cast("360995", "Verdant Embrace", 87_500),
        cast("361195", "Verdant Embrace", 87_657),
        cast("364343", "Echo", 92_400),
        ...replays(110_400),
      ],
    );
    const events = extractStasisEvents(u, combat);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      startSeconds: 85,
      storedSeconds: 92.4,
      releaseSeconds: 110.4,
      spells: ["Dream Breath", "Verdant Embrace", "Echo"],
    });
    expect(events[0]!.storedBeforeRound).toBeUndefined();
  });
});
