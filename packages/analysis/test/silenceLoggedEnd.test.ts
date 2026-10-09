/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T08 step 3c: a `[SILENCE]` line says a dispel of the silence, or the
 * unit's death at its removal, when the log does (`auraEndFromLog`).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitSilenceEntries } from "../src/context/timelineSections/silence";
import { ensureAnalysisData } from "../src/data/ensure";

const T0 = Date.UTC(2026, 9, 9);
const SILENCE = "15487"; // Priest: Silence
const aura = (event: LogEvent, atS: number): any => ({
  spellId: SILENCE,
  spellName: "Silence",
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId: "f1",
  destUnitName: "f1",
  timestamp: T0 + atS * 1000,
  logLine: { event, timestamp: T0 + atS * 1000, parameters: [] },
  auraType: "DEBUFF",
});
const unit = (id: string, over: Record<string, unknown> = {}): any => ({
  id,
  name: id,
  spellCastEvents: [],
  auraEvents: [],
  actionIn: [],
  deathRecords: [],
  ...over,
});
function render(victim: any): string[] {
  const lines: string[] = [];
  emitSilenceEntries({
    allUnits: [],
    friends: [victim, unit("f2")],
    enemies: [unit("e1")],
    ccTrinketSummaries: [],
    matchStartMs: T0,
    matchEndMs: T0 + 120_000,
    pid: (n: string) => `F:${n}`,
    enemyPid: (n: string) => `E:${n}`,
    actorLabel: (n: string, side: "friendly" | "enemy") =>
      side === "friendly" ? `F:${n}` : `E:${n}`,
    addEntry: (_t: number, line: string) => lines.push(line),
    silenceLineCount: 0,
  } as never);
  return lines;
}
const silenced = [
  aura(LogEvent.SPELL_AURA_APPLIED, 20),
  aura(LogEvent.SPELL_AURA_REMOVED, 22),
];

describe("FT-T08 step 3c — [SILENCE] logged end", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("没有日志原因:只印时长", () => {
    expect(render(unit("f1", { auraEvents: silenced }))).toEqual([
      "0:20  [SILENCE]   F:f1 ← Silence (by E:e1) | 2s",
    ]);
  });

  it("被队友驱散 / 在移除时死亡", () => {
    const dispelled = unit("f1", {
      auraEvents: silenced,
      actionIn: [
        {
          logLine: { event: LogEvent.SPELL_DISPEL, timestamp: T0 + 22_000, parameters: [] },
          timestamp: T0 + 22_000,
          spellId: "527",
          spellName: "Purify",
          srcUnitId: "f2",
          srcUnitName: "f2",
          destUnitId: "f1",
          extraSpellId: SILENCE,
        },
      ],
    });
    expect(render(dispelled)).toEqual([
      "0:20  [SILENCE]   F:f1 ← Silence (by E:e1) | 2s | dispelled by F:f2's Purify",
    ]);
    const died = unit("f1", {
      auraEvents: silenced,
      deathRecords: [{ timestamp: T0 + 22_030 }],
    });
    expect(render(died)).toEqual([
      "0:20  [SILENCE]   F:f1 ← Silence (by E:e1) | 2s | ended at their death",
    ]);
  });
  it("codex 3c P2-2: 敌方交徽章解掉沉默、随后死亡 —— 不印 ended at their death([ENEMY TRINKET] 行说了)", () => {
    const lines: string[] = [];
    const enemy = unit("e9", {
      auraEvents: [
        { ...aura(LogEvent.SPELL_AURA_APPLIED, 20), srcUnitId: "f2", srcUnitName: "f2", destUnitId: "e9", destUnitName: "e9" },
        { ...aura(LogEvent.SPELL_AURA_REMOVED, 22), srcUnitId: "f2", srcUnitName: "f2", destUnitId: "e9", destUnitName: "e9" },
      ],
      spellCastEvents: [
        { spellId: "336126", spellName: "Gladiator's Medallion", logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 22_000, parameters: [] } },
      ],
      deathRecords: [{ timestamp: T0 + 22_030 }],
    });
    emitSilenceEntries({
      allUnits: [],
      friends: [unit("f2")],
      enemies: [enemy],
      ccTrinketSummaries: [],
      matchStartMs: T0,
      matchEndMs: T0 + 120_000,
      pid: (n: string) => `F:${n}`,
      enemyPid: (n: string) => `E:${n}`,
      actorLabel: (n: string, side: "friendly" | "enemy") => (side === "friendly" ? `F:${n}` : `E:${n}`),
      addEntry: (_t: number, line: string) => lines.push(line),
      silenceLineCount: 0,
    } as never);
    expect(lines).toEqual(["0:20  [SILENCE]   E:e9 ← Silence (by F:f2) | 2s"]);
  });
});
