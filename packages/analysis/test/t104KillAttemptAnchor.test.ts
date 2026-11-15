/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built legacy units and rows */
/**
 * T104 (fact13 D9 36e987ca 3:17, D12 54251a4b-r0 1:57): the name and the
 * start of a burst-anchored kill attempt.
 *  - D9: a self-buff whose cast row names an enemy unit (its caster's current
 *    target, a Grounding Totem) and that never met it is a self-buff, not a
 *    press `cast into` that unit.
 *  - D12: a cluster opened by a press that went elsewhere and named for a
 *    later press into the target starts at that later press.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { castAndEffectIds } from "../src/data/castEffectAuras";
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
  missesOut: [],
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
const dmg = (
  destUnitId: string,
  atS: number,
  amount: number,
  spellId = "1",
): any => ({
  spellId,
  spellName: "Hit",
  destUnitId,
  effectiveAmount: amount,
  logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms(atS), parameters: [] },
});
const applied = (spellId: string, src: string, atS: number): any => ({
  spellId,
  srcUnitId: src,
  destUnitId: src,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_AURA_APPLIED,
    timestamp: ms(atS),
    parameters: [],
  },
});

const VOIDFORM = "228260";
const VOIDFORM_AURA = "194249";
const MALEVOLENCE = "442726";
const RECK = "1719";

function run(f: any[], e: any[]) {
  const units = Object.fromEntries([...f, ...e].map((u) => [u.id, u]));
  return extractKillAttempts(f, e, {
    startTime: MATCH_START,
    endTime: MATCH_START + 300_000,
    startInfo: { zoneId: "1505" },
    units,
  } as any);
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T104 D9 — a self-buff naming an enemy unit", () => {
  /** f1 (Shadow) presses Voidform at 40 s with e3 (a totem) as its target */
  const shadow = (over: { damage?: any[]; misses?: any[] } = {}) =>
    unit("f1", {
      spec: "258",
      spellCastEvents: [press(VOIDFORM, "Voidform", 40, "e3")],
      auraEvents: [applied(VOIDFORM_AURA, "f1", 40)],
      damageOut: over.damage ?? [dmg("e1", 42, 300_000)],
      missesOut: over.misses ?? [],
    });
  const enemies = () => [
    unit("e1", { reaction: 2 }),
    unit("e2", { reaction: 2 }),
    unit("e3", { reaction: 2, type: 3, info: undefined, name: "Totem" }),
  ];

  it("the harness's aura is Voidform's own effect aura", () => {
    expect(castAndEffectIds(VOIDFORM).has(VOIDFORM_AURA)).toBe(true);
  });

  it("Voidform whose row names a totem it never met is named as the self-buff", () => {
    const [a] = run([shadow()], enemies());
    expect(a!.targetUnitId).toBe("e1");
    expect(a!.anchorSpellName).toBe("Voidform");
  });

  it("a press the named unit refused (its MISSED row) stays cast into it", () => {
    const miss = {
      spellId: VOIDFORM,
      spellName: "Voidform",
      destUnitId: "e3",
      logLine: {
        event: LogEvent.SPELL_MISSED,
        timestamp: ms(40),
        parameters: [],
      },
    };
    const [a] = run([shadow({ misses: [miss] })], enemies());
    expect(a!.anchorSpellName).toBe("Voidform (cast into Totem)");
  });

  it("a self-buff whose caster hit another enemy more is named plainly, never cast into the totem", () => {
    const f2 = unit("f2", { damageOut: [dmg("e1", 41, 600_000)] });
    const [a] = run(
      [
        shadow({
          damage: [dmg("e2", 42, 200_000), dmg("e1", 43, 50_000)],
        }),
        f2,
      ],
      enemies(),
    );
    expect(a!.targetUnitId).toBe("e1");
    expect(a!.anchorSpellName).toBe("Voidform");
  });
});

describe("T104 D12 — the bracket opens at the press it is named for", () => {
  it("a Malevolence whose warlock hit another enemy does not open the go on the target", () => {
    const lock = unit("f1", {
      spec: "267", // Destruction Warlock
      spellCastEvents: [press(MALEVOLENCE, "Malevolence", 40)],
      auraEvents: [applied(MALEVOLENCE, "f1", 40)],
      // its own splash on e2 (a hit of the press), most of the warlock's
      // damage there
      damageOut: [
        dmg("e2", 40.5, 30_000, MALEVOLENCE),
        dmg("e2", 41, 150_000),
        dmg("e1", 42, 20_000),
      ],
    });
    const war = unit("f3", {
      spellCastEvents: [press(RECK, "Recklessness", 46)],
      damageOut: [dmg("e1", 47, 300_000)],
    });
    const attempts = run(
      [lock, war],
      [unit("e1", { reaction: 2 }), unit("e2", { reaction: 2 })],
    );
    const a = attempts.find((x) => x.targetUnitId === "e1")!;
    expect(a.anchorSpellName).toBe("Recklessness");
    expect(a.fromSeconds).toBe(46);
  });

  it("the opener that went into the target keeps the cluster's start", () => {
    const lock = unit("f1", {
      spec: "267",
      spellCastEvents: [press(MALEVOLENCE, "Malevolence", 40)],
      auraEvents: [applied(MALEVOLENCE, "f1", 40)],
      damageOut: [dmg("e1", 41, 150_000)],
    });
    const war = unit("f3", {
      spellCastEvents: [press(RECK, "Recklessness", 46)],
      damageOut: [dmg("e1", 47, 300_000)],
    });
    const [a] = run(
      [lock, war],
      [unit("e1", { reaction: 2 }), unit("e2", { reaction: 2 })],
    );
    expect(a!.anchorSpellName).toBe("Malevolence");
    expect(a!.fromSeconds).toBe(40);
  });
});
