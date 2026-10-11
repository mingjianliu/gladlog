/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T07, user ruling D8 (2026-10-10, re-opening A25): the `[ENEMY DEF]` line
 * names Feign Death, Nature's Guardian, Cheat Death and Cauterize by what
 * they do — `(absorb Nk, Ts)`, `(heal proc)`, `(cheat-death proc)` — where it
 * used to print `(immune, …)`. The rest of the line is unchanged.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  ENEMY_SAVE_EFFECT_BY_NAME,
  enemySaveEffectOfNote,
} from "../src/utils/enemyDefensives";

const MATCH_START = Date.UTC(2026, 9, 10);
const ms = (s: number): number => MATCH_START + Math.round(s * 1000);
const SURVIVAL_TACTICS = "202748"; // Feign Death's aura, 2 s
const DIVINE_SHIELD = "642";
const ULTIMATE_PENITENCE = "421453"; // cast id = the priest's own shield aura
const cast = (spellId: string, atS: number, destUnitId = "f1"): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId,
  destUnitName: destUnitId,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "253",
    reaction: 1,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    absorbsIn: [],
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
  atS: number,
  amount?: number,
): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId: "e1",
  destUnitName: "e1",
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  auraType: "BUFF",
  amount,
});
const applied = (id: string, atS: number, amount?: number) =>
  aura(LogEvent.SPELL_AURA_APPLIED, id, atS, amount);
const removed = (id: string, atS: number, amount?: number) =>
  aura(LogEvent.SPELL_AURA_REMOVED, id, atS, amount);
const absorbed = (
  atS: number,
  amount: number,
  spellId = SURVIVAL_TACTICS,
): any => ({
  spellId,
  spellName: `S${spellId}`,
  srcUnitId: "e1",
  srcUnitName: "e1",
  destUnitId: "e1",
  destUnitName: "e1",
  attackerId: "f1",
  absorbedAmount: amount,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_ABSORBED,
    timestamp: ms(atS),
    parameters: [],
  },
});
const selfHeal = (spellId: string, atS: number): any => ({
  spellId,
  srcUnitId: "e1",
  destUnitId: "e1",
  effectiveAmount: 150_000,
  logLine: { event: LogEvent.SPELL_HEAL, timestamp: ms(atS), parameters: [] },
});

function render(enemies: any[], matchEndSeconds = 120): string[] {
  const lines: string[] = [];
  emitEnemyDefEntries({
    matchStartMs: ms(0),
    matchEndSeconds,
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
/** the line from the ability's name on */
const body = (line: string): string => line.slice(line.indexOf("): ") + 3);

describe("[ENEMY DEF] names an effect save by its effect (FT-T07, ruling D8)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("Feign Death: `(absorb Nk, Ts)` with what the log says the shield absorbed — 0e0663e6 0:21 read `(immune, 2.0s)`", () => {
    const hunter = unit("e1", {
      auraEvents: [
        applied(SURVIVAL_TACTICS, 21.3, 594_477),
        removed(SURVIVAL_TACTICS, 23.3, 530_795),
      ],
      absorbsIn: [absorbed(21.4, 3_002), absorbed(22.2, 60_680)],
    });
    const [line] = render([hunter]);
    expect(line.startsWith("0:21  [ENEMY DEF]   E:e1 (")).toBe(true);
    expect(body(line)).toBe("Feign Death (absorb 64k, 2.0s)");
    expect(line).not.toContain("immune");
  });

  it("no absorb line in the log for it → `(absorb, Ts)`: no figure, never a 0", () => {
    const hunter = unit("e1", {
      auraEvents: [
        applied(SURVIVAL_TACTICS, 21.3, 594_477),
        removed(SURVIVAL_TACTICS, 23.3, 594_477),
      ],
    });
    expect(body(render([hunter])[0])).toBe("Feign Death (absorb, 2.0s)");
    // a record with no absorb array at all reads the same
    const bare = unit("e1", {
      absorbsIn: undefined,
      auraEvents: [
        applied(SURVIVAL_TACTICS, 21.3),
        removed(SURVIVAL_TACTICS, 23.3),
      ],
    });
    expect(body(render([bare])[0])).toBe("Feign Death (absorb, 2.0s)");
  });

  it("an amount under 0.5k reads `<1k`, not `0k`", () => {
    const hunter = unit("e1", {
      auraEvents: [
        applied(SURVIVAL_TACTICS, 21.3, 594_477),
        removed(SURVIVAL_TACTICS, 23.3, 594_077),
      ],
      absorbsIn: [absorbed(22, 400)],
    });
    expect(body(render([hunter])[0])).toBe("Feign Death (absorb <1k, 2.0s)");
  });

  it("a shield eaten through says `— used up` once — the amount already leads the note", () => {
    const hunter = unit("e1", {
      auraEvents: [
        applied(SURVIVAL_TACTICS, 21.3, 90_000),
        removed(SURVIVAL_TACTICS, 21.9, 0),
      ],
      absorbsIn: [absorbed(21.5, 50_000), absorbed(21.9, 40_000)],
    });
    expect(body(render([hunter])[0])).toBe(
      "Feign Death (absorb 90k, 0.6s — used up)",
    );
  });

  it("Nature's Guardian: `(heal proc)`; Cheat Death / Cauterize: `(cheat-death proc)` — a moment, no duration", () => {
    const sham = unit("e1", { healIn: [selfHeal("31616", 77)] });
    expect(body(render([sham])[0])).toBe("Nature's Guardian (heal proc)");
    const rogue = unit("e1", {
      auraEvents: [applied("45182", 40), removed("45182", 43)],
    });
    expect(body(render([rogue])[0])).toBe("Cheat Death (cheat-death proc)");
    const mage = unit("e1", {
      auraEvents: [applied("87023", 50), removed("87023", 56)],
    });
    expect(body(render([mage])[0])).toBe("Cauterize (cheat-death proc)");
  });

  it("a real immunity still reads `immune` with its duration", () => {
    const pal = unit("e1", {
      auraEvents: [applied(DIVINE_SHIELD, 50), removed(DIVINE_SHIELD, 58)],
    });
    expect(body(render([pal])[0])).toBe("Divine Shield (immune, 8.0s)");
  });

  it("Ultimate Penitence: the priest's shield, not `(self-save)` — f4eb8c87 2:01, pressed at 1,014,560 / 1,014,560 HP", () => {
    // raw (round 5): SUCCESS and APPLIED (835,679) at 16:54:35.864, REMOVED
    // (819,669) at 16:54:42.370; the cast's dest is the channel's target
    const priest = unit("e1", {
      spellCastEvents: [cast(ULTIMATE_PENITENCE, 121.3)],
      auraEvents: [
        applied(ULTIMATE_PENITENCE, 121.3, 835_679),
        removed(ULTIMATE_PENITENCE, 127.806, 819_669),
      ],
      absorbsIn: [absorbed(123, 16_010, ULTIMATE_PENITENCE)],
    });
    const lines = render([priest], 300);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith("2:01  [ENEMY DEF]   E:e1 (")).toBe(true);
    expect(body(lines[0])).toBe("Ultimate Penitence (absorb 16k, 6.5s)");
    expect(lines[0]).not.toContain("self-save");
  });

  it("Ultimate Penitence cut short (the channel stopped) says so, and one eaten through says `— used up`", () => {
    const stopped = unit("e1", {
      spellCastEvents: [cast(ULTIMATE_PENITENCE, 30)],
      auraEvents: [
        applied(ULTIMATE_PENITENCE, 30, 600_000),
        removed(ULTIMATE_PENITENCE, 32.1, 600_000),
      ],
    });
    expect(body(render([stopped])[0])).toBe(
      "Ultimate Penitence (absorb, 2.1s — removed early)",
    );
    const eaten = unit("e1", {
      spellCastEvents: [cast(ULTIMATE_PENITENCE, 30)],
      auraEvents: [
        applied(ULTIMATE_PENITENCE, 30, 600_000),
        removed(ULTIMATE_PENITENCE, 33, 0),
      ],
      absorbsIn: [absorbed(32.9, 600_000, ULTIMATE_PENITENCE)],
    });
    expect(body(render([eaten])[0])).toBe(
      "Ultimate Penitence (absorb 600k, 3.0s — used up)",
    );
  });

  it("Ultimate Penitence with no aura in the log is still named a shield — `(absorb)`, no figure", () => {
    const priest = unit("e1", {
      spellCastEvents: [cast(ULTIMATE_PENITENCE, 30)],
    });
    expect(body(render([priest])[0])).toBe("Ultimate Penitence (absorb)");
  });

  it("every rendered effect line states the effect its ability has (the gate's two readers)", () => {
    const all = unit("e1", {
      spellCastEvents: [cast(ULTIMATE_PENITENCE, 90)],
      auraEvents: [
        applied(SURVIVAL_TACTICS, 10, 1000),
        removed(SURVIVAL_TACTICS, 12, 1000),
        applied("45182", 40),
        removed("45182", 43),
        applied("87023", 50),
        removed("87023", 56),
        applied(ULTIMATE_PENITENCE, 90, 1000),
        removed(ULTIMATE_PENITENCE, 96.5, 1000),
      ],
      healIn: [selfHeal("31616", 77)],
    });
    const lines = render([all]);
    expect(lines).toHaveLength(ENEMY_SAVE_EFFECT_BY_NAME.size);
    for (const line of lines) {
      const b = body(line);
      const name = b.slice(0, b.indexOf(" ("));
      expect(enemySaveEffectOfNote(b.slice(name.length + 1)), b).toBe(
        ENEMY_SAVE_EFFECT_BY_NAME.get(name),
      );
    }
  });
});
