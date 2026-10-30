/**
 * The synthetic events the tests build must look like the events the app
 * reads — the converted real fixture (desktop's anonymized report-match,
 * `loadLegacyMatchFixture`) is the reference. Weekly review 2026-10-24: the
 * root-cause pass over three weeks of fixes found helpers that described a
 * cleaner log than the real one — damage written positive where convert.ts
 * stores it negative (2cefc73's inverted 5 % filter), no `logLine.lineIndex`
 * (the same-ms order press HP reads, D31), advanced HP / position fields on
 * hit rows that production keeps on `advancedActions` only — and every
 * reader tested against them passed on inputs the app never sees. A field a
 * helper adds that no real event carries, or a sign it gets wrong, now turns
 * this red instead of quietly passing the next reader.
 */
import { GladLogParser,type GladMatch } from "@gladlog/parser";
import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";
import {
  type ICombatUnit,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  loadLegacyMatchFixture,
  loadLegacyRealMatchSample,
} from "./helpers/legacyFixture";
import {
  makeAuraEvent,
  makeDamageEvent,
  makeHealEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// both converted real fixtures: the 2v2 report match and the 3v3 sample
const units = [loadLegacyMatchFixture(), loadLegacyRealMatchSample()].flatMap(
  (m) => Object.values(m.units) as ICombatUnit[],
);
type Row = Record<string, unknown> & { logLine: Record<string, unknown> };
const first = (pick: (u: ICombatUnit) => readonly unknown[], event: string) => {
  for (const u of units)
    for (const e of pick(u) as Row[]) if (e.logLine.event === event) return e;
  throw new Error(`the fixture has no ${event}`);
};

/** Fields a helper may set that the reference row happens not to carry:
 * optional fields of the same event type (a cast with no target, an
 * aura with no amount). */
const OPTIONAL = new Set(["destUnitFlags", "auraType", "amount"]);

function expectShapeOf(helper: Row, real: Row) {
  const extra = Object.keys(helper).filter(
    (k) => !(k in real) && !OPTIONAL.has(k),
  );
  expect(extra, "fields no real event of this type carries").toEqual([]);
  expect(Object.keys(helper.logLine).sort()).toEqual(
    Object.keys(real.logLine).sort(),
  );
  expect(typeof helper.logLine.lineIndex).toBe("number");
}

describe("test helpers describe the events the app reads", () => {
  it("damage: production sign and fields", () => {
    const real = first((u) => u.damageOut, LogEvent.SPELL_DAMAGE);
    const helper = makeDamageEvent(1_000, 50_000) as Row;
    expectShapeOf(helper, real);
    expect(Math.sign(Number(real.amount))).toBe(-1);
    expect(Math.sign(Number(helper.amount))).toBe(-1);
    expect(Math.sign(Number(helper.effectiveAmount))).toBe(-1);
  });
  it("heal", () => {
    const real = first((u) => u.healOut, LogEvent.SPELL_HEAL);
    expectShapeOf(makeHealEvent(1_000, "h", 20_000) as Row, real);
  });
  it("cast", () => {
    const real = first((u) => u.spellCastEvents, LogEvent.SPELL_CAST_SUCCESS);
    expectShapeOf(makeSpellCastEvent("1", 1_000, "t") as Row, real);
  });
  it("aura", () => {
    const real = first((u) => u.auraEvents, LogEvent.SPELL_AURA_APPLIED);
    const helper = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "1",
      1_000,
    ) as Row;
    expectShapeOf(helper, real);
    expect(["BUFF", "DEBUFF"]).toContain(real.auraType);
  });
  it("interrupt", () => {
    // the fixtures strip their action streams; the reference is a real-format
    // SPELL_INTERRUPT line through the parser and convert.ts
    const lines = synthArenaLog({ eventsPerRound: 10 }).trim().split("\n");
    const end = lines.pop()!;
    const at = end.slice(0, end.indexOf("  "));
    lines.push(
      `${at}  SPELL_INTERRUPT,Player-1-0004,"Delta-Realm",0x548,0x0,Player-1-0003,"Charlie-Realm",0x511,0x0,1766,"Kick",0x1,2061,"Flash Heal",2`,
      end,
    );
    const parser = new GladLogParser({ timezone: "UTC" });
    const out: GladMatch[] = [];
    parser.on("match", (m) => out.push(m));
    for (const l of lines) parser.push(l);
    parser.end();
    const legacy = toLegacyMatch(out[0]!);
    const real = (Object.values(legacy.units) as ICombatUnit[])
      .flatMap((u) => u.actionOut as unknown as Row[])
      .find((e) => e.logLine.event === LogEvent.SPELL_INTERRUPT)!;
    expect(real).toBeDefined();
    expectShapeOf(
      makeInterruptEvent("1766", "Kick", "2061", "Flash Heal", 1_000) as Row,
      real,
    );
  });
  it("same-ms order: two rows built in turn keep that order", () => {
    const a = makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "1", 1_000) as Row;
    const b = makeSpellCastEvent("1", 1_000, "t") as Row;
    expect(Number(b.logLine.lineIndex)).toBeGreaterThan(
      Number(a.logLine.lineIndex),
    );
  });
  it("unit: every stream a converted unit has", () => {
    const real = units[0]!;
    const helper = makeUnit("x") as unknown as Record<string, unknown>;
    const streams = Object.keys(real).filter((k) =>
      Array.isArray((real as unknown as Record<string, unknown>)[k]),
    );
    expect(streams.filter((k) => !Array.isArray(helper[k]))).toEqual([]);
  });
});
