/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T07 / T15 ③, user ruling D6 (2026-10-10): an `[ENEMY DEF]` aura whose end
 * the log never showed prints `end not logged` — not the official length the
 * interval builder closed it at, which the legend called OBSERVED. On the 605
 * new-season files 1,302 of 7,541 lines with a duration had no logged end and
 * 1,129 printed the official maximum (fix-FT/t07-enemydef-vs-raw-605.txt).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import { CURATED_ID_TABLES } from "../src/data/curatedIdRegistry";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  MITIGATION_TABLE,
  SELF_WALL_AURA_TO_CAST_ID,
} from "../src/data/mitigationData";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import {
  ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
  ENEMY_STEALTH_WALL_AURAS,
} from "../src/data/spellIdLists";
import {
  ENEMY_DEF_END_NOT_LOGGED,
  ENEMY_DEF_END_NOT_LOGGED_SLOT_RE,
  enemyDefensiveEvents,
  enemySaveEffectOfNote,
  MITIGATION_AURA_IDS,
  renderedExternalSpanS,
  SAVE_AURA_END_UNSEEN_IDS,
  wallTableIdOfAura,
} from "../src/utils/enemyDefensives";

const OBSERVED = new Set(
  (observed as unknown as Array<string | number>).map(String),
);
const MATCH_START = Date.UTC(2026, 9, 10);
const ms = (s: number): number => MATCH_START + Math.round(s * 1000);
const MASS_INVISIBILITY = "414664"; // immunity-kind, 12 s
const VANISH_AURA = "11327"; // immunity-kind, 1.5 s
const GREATER_INVIS_AURA = "110960"; // 60 % wall, 20 s
const GREATER_INVIS_CAST = "110959";
const BARKSKIN = "22812"; // wall, 12 s (8 s base + talents: read from the line)
const DIVINE_SHIELD = "642"; // 8 s
const IRONBARK = "102342"; // external, 12 s
const SURVIVAL_TACTICS = "202748"; // Feign Death's shield, 2 s

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
  src: string,
  dest: string,
  atS: number,
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
const hit = (dest: string, atS: number): any => ({
  spellId: "1",
  srcUnitId: "f1",
  destUnitId: dest,
  effectiveAmount: -50_000,
  spellSchoolId: "0x1",
  logLine: {
    event: LogEvent.SPELL_DAMAGE,
    timestamp: ms(atS),
    parameters: [],
  },
});
const ROUND_S = 120;
const combat = { startTime: ms(0), endTime: ms(ROUND_S) };

function render(enemies: any[], friends: any[] = [unit("f1")]): string[] {
  const lines: string[] = [];
  emitEnemyDefEntries({
    matchStartMs: combat.startTime,
    matchEndSeconds: ROUND_S,
    enemies,
    enemyPid: (n: string) => `E:${n}`,
    friends,
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

describe("[ENEMY DEF] — an aura the log never shows end prints `end not logged` (ruling D6)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("Mass Invisibility with no REMOVED: `(immune, end not logged)`, not the official 12.0s — s0/1-2-4 0:04 read `(immune, 12.0s)` on a mage hit 3.3 s later", () => {
    const mage = unit("e1", {
      auraEvents: [applied(MASS_INVISIBILITY, "e1", "e1", 4.2)],
    });
    const [d] = enemyDefensiveEvents(mage, [mage], combat);
    expect(d.kind).toBe("immune");
    expect(d.endNotLogged).toBe(true);
    // the interval is still the builder's cap — it is just not an observation
    expect(d.observedSeconds).toBeCloseTo(12, 6);
    expect(d.removedEarly).toBe(false);
    expect(d.upAtRoundEnd).toBeUndefined();
    const [line] = render([mage]);
    expect(line.startsWith("0:04  [ENEMY DEF]   E:e1 (")).toBe(true);
    expect(body(line)).toBe("Mass Invisibility (immune, end not logged)");
    expect(line).not.toMatch(/\d+\.\ds/);
  });

  it("Greater Invisibility with no REMOVED: `(60%, end not logged)`, not `(60%, 20.0s)` — s2/112-1-757 5:49", () => {
    const mage = unit("e1", {
      spellCastEvents: [cast(GREATER_INVIS_CAST, "e1", 49.0)],
      auraEvents: [applied(GREATER_INVIS_AURA, "e1", "e1", 49.0)],
    });
    const [d] = enemyDefensiveEvents(mage, [mage], combat);
    expect(d.kind).toBe("self");
    expect(d.pct).toBe(MITIGATION_TABLE[GREATER_INVIS_CAST]!.pct);
    expect(d.endNotLogged).toBe(true);
    expect(d.observedSeconds).toBeCloseTo(20, 6);
    expect(body(render([mage])[0]!)).toBe(
      "Greater Invisibility (60%, end not logged)",
    );
  });

  it("the same auras WITH a logged end keep their observed duration and end note", () => {
    const mage = unit("e1", {
      spellCastEvents: [cast(GREATER_INVIS_CAST, "e1", 49.0)],
      auraEvents: [
        applied(MASS_INVISIBILITY, "e1", "e1", 4.2),
        removed(MASS_INVISIBILITY, "e1", "e1", 4.9),
        applied(GREATER_INVIS_AURA, "e1", "e1", 49.0),
        removed(GREATER_INVIS_AURA, "e1", "e1", 52.0),
      ],
    });
    const events = enemyDefensiveEvents(mage, [mage], combat);
    expect(events.map((d) => d.endNotLogged)).toEqual([undefined, undefined]);
    expect(render([mage]).map(body)).toEqual([
      "Mass Invisibility (immune, 0.7s — removed early)",
      "Greater Invisibility (60%, 3.0s — removed early)",
    ]);
  });

  it("any aura kind: a wall, an immunity, an external and Feign Death's shield with no logged end all say it — and none adds an end note or a `during it`", () => {
    const hunter = unit("e1", {
      auraEvents: [
        applied(BARKSKIN, "e1", "e1", 10),
        applied(DIVINE_SHIELD, "e1", "e1", 40),
        applied(SURVIVAL_TACTICS, "e1", "e1", 70),
      ],
    });
    const mate = unit("e2", {
      auraEvents: [applied(IRONBARK, "e1", "e2", 20)],
    });
    hunter.spellCastEvents = [cast(IRONBARK, "e2", 20)];
    // a friendly on the recipient before and during the external: with a
    // logged end the line measures it, without one there is no window
    const attacker = unit("f1", {
      damageOut: [hit("e2", 19), hit("e2", 22), hit("e2", 25)],
    });
    const bodies = render([hunter, mate], [attacker]).map(body);
    expect(bodies).toEqual([
      expect.stringMatching(/^Barkskin \(\d+%, end not logged\)$/),
      "Ironbark → E:e2 (end not logged)",
      "Divine Shield (immune, end not logged)",
      "Feign Death (absorb, end not logged)",
    ]);
    const seen = unit("e2", {
      auraEvents: [
        applied(IRONBARK, "e1", "e2", 20),
        removed(IRONBARK, "e1", "e2", 32),
      ],
    });
    expect(body(render([hunter, seen], [attacker])[1]!)).toMatch(
      /^Ironbark → E:e2 \(12\.0s\) \| during it: F:f1 /,
    );
    for (const b of bodies) {
      expect(b, b).toMatch(ENEMY_DEF_END_NOT_LOGGED_SLOT_RE);
      expect(b, b).not.toContain(" — ");
      expect(b, b).not.toContain("during it");
    }
    // Feign Death's note still reads as an absorb for the effect gate
    expect(enemySaveEffectOfNote("(absorb, end not logged)")).toBe("absorb");
    expect(enemySaveEffectOfNote("(absorb 64k, end not logged)")).toBe(
      "absorb",
    );
    expect(enemySaveEffectOfNote("(immune, end not logged)")).toBeUndefined();
  });

  it("the round ended inside the aura's official length: that is `— still up when the round ended`, with the seconds it was seen up — not a lost end", () => {
    const druid = unit("e1", {
      auraEvents: [applied(DIVINE_SHIELD, "e1", "e1", ROUND_S - 5)],
    });
    const [d] = enemyDefensiveEvents(druid, [druid], combat);
    expect(d.upAtRoundEnd).toBe(true);
    expect(d.endNotLogged).toBeUndefined();
    expect(d.removedEarly).toBe(false);
    expect(body(render([druid])[0]!)).toBe(
      "Divine Shield (immune, 5.0s — still up when the round ended)",
    );
  });

  it("…except an aura whose carrier goes unseen: its missing REMOVED says nothing about it being up at the round's end", () => {
    for (const id of [MASS_INVISIBILITY, VANISH_AURA, GREATER_INVIS_AURA]) {
      const u = unit("e1", {
        auraEvents: [applied(id, "e1", "e1", ROUND_S - 1)],
      });
      const [d] = enemyDefensiveEvents(u, [u], combat);
      expect(d.endNotLogged, id).toBe(true);
      expect(d.upAtRoundEnd, id).toBeUndefined();
      expect(body(render([u])[0]!), id).toContain(
        `, ${ENEMY_DEF_END_NOT_LOGGED})`,
      );
    }
  });

  it("the phrase's slot: after the strength or alone, closing the parenthesis — never with a duration or an end note", () => {
    for (const ok of [
      "Mass Invisibility (immune, end not logged) (at 100% HP)",
      "Greater Invisibility (60%, end not logged) [friendly offensive CD active]",
      "Ironbark → 5(RDruid) (end not logged) (target at 40% HP)",
      "Feign Death (absorb, end not logged)",
      "Feign Death (absorb 64k, end not logged)",
      "Feign Death (absorb <1k, end not logged)",
    ])
      expect(ENEMY_DEF_END_NOT_LOGGED_SLOT_RE.test(ok), ok).toBe(true);
    for (const bad of [
      "Mass Invisibility (immune, 12.0s, end not logged)",
      "Mass Invisibility (immune, end not logged — removed early)",
      "Ironbark → 5(RDruid) (12.0s — end not logged)",
      "Mass Invisibility (immune, 12.0s)",
    ])
      expect(ENEMY_DEF_END_NOT_LOGGED_SLOT_RE.test(bad), bad).toBe(false);
  });

  it("an external with no logged end keeps its capped span for the [KILL WINDOW] cut: `defenseless` is not claimed over an aura that may still be up", () => {
    const healer = unit("e1", { spellCastEvents: [cast(IRONBARK, "e2", 20)] });
    const mate = unit("e2", {
      auraEvents: [applied(IRONBARK, "e1", "e2", 20)],
    });
    const [d] = enemyDefensiveEvents(healer, [healer, mate], combat);
    expect(d.kind).toBe("external");
    expect(d.endNotLogged).toBe(true);
    expect(renderedExternalSpanS(d)).toEqual({ from: 20, to: 32 });
  });

  it("the unseen-carrier set is the three ruled-in immunities plus the stealth wall, and the wall is a real table row", () => {
    expect([...SAVE_AURA_END_UNSEEN_IDS].sort()).toEqual(
      [
        ...ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
        ...Object.keys(ENEMY_STEALTH_WALL_AURAS),
      ].sort(),
    );
    expect(Object.keys(ENEMY_STEALTH_WALL_AURAS)).toEqual([GREATER_INVIS_AURA]);
    for (const [id, name] of Object.entries(ENEMY_STEALTH_WALL_AURAS)) {
      // a logged aura id that resolves to a 20–99 % wall row
      expect(SELF_WALL_AURA_TO_CAST_ID[id], id).toBeDefined();
      expect(MITIGATION_AURA_IDS.has(wallTableIdOfAura(id)), id).toBe(true);
      // the name is the one the `[ENEMY DEF]` line prints for that aura
      expect(getEnglishSpellName(id, "?"), id).toBe(name);
      // …and the id is one the corpus logs (a renumbered id never fires)
      expect(OBSERVED.has(id), id).toBe(true);
    }
    expect(
      CURATED_ID_TABLES.some(
        (t) => t.name === "spellIdLists.ENEMY_STEALTH_WALL_AURAS",
      ),
    ).toBe(true);
  });
});
