/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T08 step 3b: an `[ENEMY DEF]` aura that ended early says the cause the
 * log gives (`auraEndFromLog`, read off the aura's HOLDER); `removed early`
 * is what is left when the log gives none.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import { ensureAnalysisData } from "../src/data/ensure";
import { DEATH_CASCADE_MS } from "../src/utils/auraEndCause";
import { enemyDefensiveEvents } from "../src/utils/enemyDefensives";

const MATCH_START = Date.UTC(2026, 9, 9);
const ms = (s: number): number => MATCH_START + Math.round(s * 1000);
const IRONBARK = "102342"; // external, 12 s
const DIVINE_SHIELD = "642"; // immunity, 8 s
const BARKSKIN = "22812"; // 20 %, 12 s

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "105",
    reaction: 1,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
  };
}
const aura = (
  event: LogEvent,
  spellId: string,
  src: string,
  dest: string,
  atS: number,
  amount?: number,
): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  destUnitName: dest,
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  auraType: "BUFF",
  amount,
});
const applied = (id: string, src: string, dest: string, atS: number) =>
  aura(LogEvent.SPELL_AURA_APPLIED, id, src, dest, atS);
const removed = (id: string, src: string, dest: string, atS: number) =>
  aura(LogEvent.SPELL_AURA_REMOVED, id, src, dest, atS);
const cast = (spellId: string, dest: string, atS: number): any => ({
  spellId,
  spellName: `S${spellId}`,
  destUnitId: dest,
  destUnitName: dest,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});
const taken = (
  event: LogEvent,
  extraSpellId: string,
  dest: string,
  atS: number,
): any => ({
  logLine: { event, timestamp: ms(atS), parameters: [] },
  timestamp: ms(atS),
  spellId: "32375",
  spellName: "Mass Dispel",
  srcUnitId: "f1",
  srcUnitName: "f1",
  destUnitId: dest,
  extraSpellId,
});
const combat = { startTime: ms(0), endTime: ms(120) };

function render(enemies: any[]): string[] {
  const lines: string[] = [];
  emitEnemyDefEntries({
    matchStartMs: combat.startTime,
    matchEndSeconds: 120,
    enemies,
    enemyPid: (n: string) => `E:${n}`,
    friends: [unit("f1")],
    roundBounds: undefined,
    pid: (n: string) => `F:${n}`,
    actorLabel: (n: string, side: "friendly" | "enemy") =>
      side === "friendly" ? `F:${n}` : `E:${n}`,
    addEntry: (_t: number, line: string) => lines.push(line),
    _allUnits: enemies,
  } as never);
  return lines;
}

describe("FT-T08 step 3b — [ENEMY DEF] early end: the cause the log gives", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("Divine Shield 被 Mass Dispel 驱散:事件带 takenBy,行印 dispelled by 谁的什么技能", () => {
    const pal = unit("e1", {
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 50),
        removed(DIVINE_SHIELD, "e1", "e1", 53),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, DIVINE_SHIELD, "e1", 53.004)],
    });
    const [d] = enemyDefensiveEvents(pal, [pal], combat);
    expect(d.removedEarly).toBe(true);
    expect(d.earlyEnd?.takenBy).toEqual({
      kind: "dispelled",
      unitId: "f1",
      unitName: "f1",
      spellName: "Mass Dispel",
    });
    const [line] = render([pal]);
    expect(line).toContain("(immune, 3.0s — dispelled by F:f1's Mass Dispel)");
    expect(line).not.toContain("removed early");
  });

  it("另一个法术的驱散、别的单位身上的驱散都不算:仍是 removed early", () => {
    const pal = unit("e1", {
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 50),
        removed(DIVINE_SHIELD, "e1", "e1", 53),
      ],
      // same moment, a different aura was taken off
      actionIn: [taken(LogEvent.SPELL_DISPEL, "1022", "e1", 53)],
    });
    const [d] = enemyDefensiveEvents(pal, [pal], combat);
    expect(d.removedEarly).toBe(true);
    expect(d.earlyEnd).toEqual({ holderDied: false });
    expect(render([pal])[0]).toContain("(immune, 3.0s — removed early)");
  });

  it("外置的原因读在受术者身上:Ironbark 的目标死了 → its target died;自己的墙 → ended at death", () => {
    const druid = unit("e1", {
      spellCastEvents: [cast(IRONBARK, "e2", 30)],
      auraEvents: [
        applied(BARKSKIN, "e1", "e1", 60),
        removed(BARKSKIN, "e1", "e1", 64),
      ],
      deathRecords: [{ timestamp: ms(64) + DEATH_CASCADE_MS }],
    });
    const mate = unit("e2", {
      auraEvents: [
        applied(IRONBARK, "e1", "e2", 30),
        removed(IRONBARK, "e1", "e2", 34),
      ],
      deathRecords: [{ timestamp: ms(34) + 20 }],
    });
    const events = enemyDefensiveEvents(druid, [druid, mate], combat);
    expect(events.map((e) => [e.kind, e.removedEarly, e.earlyEnd])).toEqual([
      ["external", true, { holderDied: true }],
      ["self", true, { holderDied: true }],
    ]);
    const lines = render([druid, mate]);
    expect(
      lines.find((l) => l.includes(`S${IRONBARK}`) || l.includes("Ironbark")),
    ).toContain("(4.0s — its target died)");
    expect(
      lines.find((l) => l.includes("4.0s — ended at death")),
    ).toBeDefined();
  });

  it("死亡晚于级联窗口不算死亡带走;驱散行先于死亡被读", () => {
    const late = unit("e1", {
      auraEvents: [
        applied(BARKSKIN, "e1", "e1", 60),
        removed(BARKSKIN, "e1", "e1", 64),
      ],
      deathRecords: [{ timestamp: ms(64) + DEATH_CASCADE_MS + 1 }],
    });
    expect(enemyDefensiveEvents(late, [late], combat)[0].earlyEnd).toEqual({
      holderDied: false,
    });
    const both = unit("e1", {
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 50),
        removed(DIVINE_SHIELD, "e1", "e1", 53),
      ],
      actionIn: [taken(LogEvent.SPELL_STOLEN, DIVINE_SHIELD, "e1", 53)],
      deathRecords: [{ timestamp: ms(53) + 30 }],
    });
    expect(render([both])[0]).toContain("— stolen by F:f1's Mass Dispel)");
  });

  it("满时长或结束是推断的:不问原因,也不印", () => {
    const full = unit("e1", {
      auraEvents: [
        applied(BARKSKIN, "e1", "e1", 10),
        removed(BARKSKIN, "e1", "e1", 22),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, BARKSKIN, "e1", 22)],
    });
    const [d] = enemyDefensiveEvents(full, [full], combat);
    expect(d.removedEarly).toBe(false);
    expect(d.earlyEnd).toBeUndefined();
    expect(render([full])[0]).toContain("(20%, 12.0s)");
  });
  it("驱散行分不清是哪一份:不说 removed early(图例说那是「日志没给原因」)", () => {
    const pal = unit("e1", {
      auraEvents: [
        applied(DIVINE_SHIELD, "e1", "e1", 50),
        removed(DIVINE_SHIELD, "e1", "e1", 53),
        // a second source's copy of the same spell off this unit in the same ms
        removed(DIVINE_SHIELD, "e2", "e1", 53),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, DIVINE_SHIELD, "e1", 53)],
    });
    const [d] = enemyDefensiveEvents(pal, [pal], combat);
    expect(d.earlyEnd).toEqual({ takeUnclear: true, holderDied: false });
    expect(render([pal])[0]).toContain(
      "(immune, 3.0s — a dispel of this spell is logged at that moment, not which copy it took)",
    );
  });
});
