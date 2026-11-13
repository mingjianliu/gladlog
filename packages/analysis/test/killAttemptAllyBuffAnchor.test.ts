/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built legacy units and rows */
/**
 * T42 (r12 D12 5d145b70 2:57, r12b N14 7edc099d-r0 1:40): a burst-anchored
 * kill attempt is named for the press that opened its bracket and went into
 * the target. A press whose cast row names a teammate is a buff on that
 * teammate — and on its caster too when its own aura went up there — and
 * goes where the players it buffed hit.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { extractKillAttempts } from "../src/utils/killAttempts";

const MATCH_START = Date.UTC(2026, 7, 15);
const ms = (s: number): number => MATCH_START + s * 1000;
const unit = (id: string, over: Record<string, unknown> = {}): any => ({
  id,
  name: id,
  type: 1,
  spec: "71", // Arms Warrior
  reaction: 1,
  info: {},
  spellCastEvents: [],
  auraEvents: [],
  damageOut: [],
  damageIn: [],
  healIn: [],
  deathRecords: [],
  advancedActions: [],
  actionIn: [],
  actionOut: [],
  ...over,
});
const press = (
  spellId: string,
  spellName: string,
  atS: number,
  destUnitId?: string,
): any => ({
  spellId,
  spellName,
  ...(destUnitId ? { destUnitId } : {}),
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});
const dmg = (destUnitId: string, atS: number, amount: number): any => ({
  destUnitId,
  effectiveAmount: amount,
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms(atS), parameters: [] },
});
const applied = (
  spellId: string,
  src: string,
  atS: number,
  dest = src,
): any => ({
  spellId,
  srcUnitId: src,
  destUnitId: dest,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_AURA_APPLIED,
    timestamp: ms(atS),
    parameters: [],
  },
});

const PI = "10060";
const RECK = "1719";

/** f1 (a priest) casts Power Infusion at 40 s on `piDest`; f3 presses
 *  Recklessness at 46 s, inside Power Infusion's reach, and hits e1 */
function attemptsOf(o: {
  piDest?: string;
  piAuraOnCaster?: boolean;
  /** the press leaves no aura of its own on the teammate it names */
  noAuraOnAlly?: boolean;
  f1Damage?: any[];
  f2Damage?: any[];
}) {
  const f1 = unit("f1", {
    spec: "258", // Shadow Priest
    spellCastEvents: [press(PI, "Power Infusion", 40, o.piDest)],
    auraEvents: o.piAuraOnCaster ? [applied(PI, "f1", 40)] : [],
    damageOut: o.f1Damage ?? [],
  });
  const f2 = unit("f2", {
    damageOut: o.f2Damage ?? [],
    auraEvents:
      o.piDest === "f2" && !o.noAuraOnAlly
        ? [applied(PI, "f1", 40.01, "f2")]
        : [],
  });
  const f3 = unit("f3", {
    spellCastEvents: [press(RECK, "Recklessness", 46)],
    damageOut: [dmg("e1", 47, 200_000)],
  });
  const e1 = unit("e1", { reaction: 2 });
  const e2 = unit("e2", { reaction: 2 });
  return extractKillAttempts([f1, f2, f3], [e1, e2], {
    startTime: MATCH_START,
    endTime: MATCH_START + 300_000,
    startInfo: { zoneId: "1505" },
    units: { f1, f2, f3, e1, e2 },
  } as any);
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T42 — the attempt is named for the buff that opened it", () => {
  it("Power Infusion on a teammate who hit the target names the attempt, not a later press", () => {
    const [a] = attemptsOf({ piDest: "f2", f2Damage: [dmg("e1", 42, 80_000)] });
    expect(a!.fromSeconds).toBe(40);
    expect(a!.targetUnitId).toBe("e1");
    expect(a!.anchorSpellName).toBe("Power Infusion");
  });

  it("the buffed teammate never hit the target: the first press that went into it is named", () => {
    const [a] = attemptsOf({ piDest: "f2", f2Damage: [dmg("e2", 42, 50_000)] });
    expect(a!.targetUnitId).toBe("e1");
    expect(a!.anchorSpellName).toBe("Recklessness");
  });

  it("a press that names a teammate and buffs its caster too counts the caster's damage (PvP Bloodlust's shape)", () => {
    const o = {
      piDest: "f2",
      f1Damage: [dmg("e1", 43, 60_000)],
      f2Damage: [dmg("e2", 42, 50_000)],
    };
    expect(attemptsOf({ ...o, piAuraOnCaster: true })[0]!.anchorSpellName).toBe(
      "Power Infusion",
    );
    expect(attemptsOf(o)[0]!.anchorSpellName).toBe("Recklessness");
  });

  it("a press on an enemy other than the target is still no buff", () => {
    const [a] = attemptsOf({ piDest: "e2", f2Damage: [dmg("e1", 42, 80_000)] });
    expect(a!.anchorSpellName).toBe("Recklessness");
  });

  // codex 85-tk-H-T42-1 #1 (Ultimate Penitence cast at a teammate)
  it("a press that names a teammate and leaves no aura on it is no buff on it", () => {
    const [a] = attemptsOf({
      piDest: "f2",
      noAuraOnAlly: true,
      f2Damage: [dmg("e1", 42, 80_000)],
    });
    expect(a!.anchorSpellName).toBe("Recklessness");
  });
});
