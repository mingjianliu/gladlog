/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the producer and the check read them untyped */
/**
 * scan5/t08 `deathTeardownEarly` (fact12 D32), mutation-tested on the
 * producer's own lines: each case renders `[ENEMY DEF]` with
 * `emitEnemyDefEntries`, the correct line must pass, and the same line with
 * its death label turned into `— removed early` must be caught. The shapes
 * are codex's (85-tk-A-T08-2c / -2d): a self-defensive whose duration leads
 * with its effect, two casters' copies of one aura, a REFRESH re-press, a
 * re-broadcast REMOVED+APPLIED, a source-less closing row.
 */
import { emitEnemyDefEntries } from "@gladlog/analysis/src/context/timelineSections/enemyDef";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t08";

const START = Date.UTC(2026, 9, 9);
const ms = (s: number): number => START + Math.round(s * 1000);
const BARKSKIN = "22812";
const IRONBARK = "102342";
const OBSIDIAN_SCALES = "363916";
const PEACEWEAVER = "353319";
const RESTORAL = "388615";
const ULTIMATE_PENITENCE = "421453";
const PID: Record<string, string> = { e1: "4", e2: "5", e3: "6" };

function unit(id: string, over: Record<string, unknown> = {}): any {
  const auras = (over.auraEvents as any[] | undefined) ?? [];
  return {
    id,
    name: id,
    pid: PID[id],
    type: 1,
    spec: "105",
    reaction: 1,
    info: {},
    actionIn: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
    auraEvents: auras,
    // a wall the unit put on itself is a press: the cast beside its aura
    spellCastEvents: [
      ...((over.spellCastEvents as any[] | undefined) ?? []),
      ...auras
        .filter(
          (a) => a.press && a.srcUnitId === id && (a.destUnitId ?? id) === id,
        )
        .map((a) => cast(a.spellId, id, (a.timestamp - START) / 1000)),
    ],
  };
}
const aura = (
  event: LogEvent,
  spellId: string,
  src: string,
  dest: string,
  atS: number,
  press = false,
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
  press,
});
const A = LogEvent.SPELL_AURA_APPLIED;
const R = LogEvent.SPELL_AURA_REMOVED;
const RF = LogEvent.SPELL_AURA_REFRESH;
const cast = (spellId: string, dest: string, atS: number): any => ({
  spellId,
  spellName: `S${spellId}`,
  destUnitId: dest,
  destUnitName: dest,
  timestamp: ms(atS),
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});
/** a lethal hit at `atS`, UNIT_DIED 125 ms later (the D32 shape) */
const dies = (atS: number) => ({
  damageIn: [
    {
      overkill: 5_000,
      amount: -50_000,
      timestamp: ms(atS),
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms(atS) },
    },
  ],
  deathRecords: [{ timestamp: ms(atS) + 125 }],
});

function render(enemies: any[], seed: string[] = []): string[] {
  const lines: string[] = [...seed];
  emitEnemyDefEntries({
    matchStartMs: START,
    matchEndSeconds: 120,
    enemies,
    enemyPid: (n: string) => `${PID[n]}(RDruid)`,
    friends: [unit("f1")],
    roundBounds: undefined,
    pid: (n: string) => `F:${n}`,
    actorLabel: (n: string) => n,
    addEntry: (_t: number, line: string) => lines.push(line),
    _allUnits: enemies,
    // matchTimeline's merge: the text goes in after the [ENEMY CD] head
    extendEnemyCdLine: (head: string, text: string) => {
      const i = lines.findIndex((l) => l.startsWith(head));
      if (i < 0) return false;
      lines[i] = head + text + lines[i]!.slice(head.length);
      return true;
    },
  } as never);
  return lines;
}
function scan(players: any[], lines: string[]): string[] {
  const seen: string[] = [];
  run({
    lines,
    legacy: {
      startTime: START,
      endTime: ms(120),
      units: Object.fromEntries(players.map((p) => [p.id, p])),
    },
    players,
    unitOfPid: (pid: string | undefined) => players.find((p) => p.pid === pid),
    start: START,
    firstOwnerOfRound: false,
    violate: (check: string, _k: string, _t: number, _f: string, d: string) =>
      seen.push(`${check}: ${d}`),
    bump: () => {},
  } as any);
  return seen;
}
/** the producer's lines pass; the death label turned into `removed early` is caught */
function mutationCaught(
  players: any[],
  spell: string,
  seed: string[] = [],
): void {
  const lines = render(players, seed);
  const mine = lines.filter((l) => l.includes(spell));
  const died = mine.filter((l) => /— (its target died|ended at death)/.test(l));
  expect(died, lines.join("\n")).toHaveLength(1);
  expect(scan(players, lines)).toEqual([]);
  const mutated = lines.map((l) =>
    l === died[0]
      ? l.replace(/— (its target died|ended at death)/, "— removed early")
      : l,
  );
  expect(scan(players, mutated)).toHaveLength(1);
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t08 deathTeardownEarly — mutation on the producer's lines", () => {
  it("a self-defensive in its holder's teardown (Barkskin, its effect leading the duration)", () => {
    const d = unit("e1", {
      auraEvents: [
        aura(A, BARKSKIN, "e1", "e1", 10, true),
        aura(R, BARKSKIN, "e1", "e1", 13),
      ],
      ...dies(13),
    });
    mutationCaught([d], "Barkskin");
  });

  it("two casters' copies: A's early removal is not the teardown, B's is", () => {
    const a = unit("e1", { spellCastEvents: [cast(IRONBARK, "e3", 10)] });
    const b = unit("e2", { spellCastEvents: [cast(IRONBARK, "e3", 13)] });
    const h = unit("e3", {
      auraEvents: [
        aura(A, IRONBARK, "e1", "e3", 10),
        aura(R, IRONBARK, "e1", "e3", 13),
        aura(A, IRONBARK, "e2", "e3", 13),
        aura(R, IRONBARK, "e2", "e3", 14),
      ],
      ...dies(14),
    });
    const lines = render([a, b, h]);
    // A's line is genuinely `removed early`: never flagged
    expect(
      lines.some((l) => l.startsWith("0:10") && l.includes("removed early")),
    ).toBe(true);
    mutationCaught([a, b, h], "Ironbark");
  });

  it("a re-press logged as REFRESH starts its own span (Obsidian Scales)", () => {
    const ev = unit("e1", {
      auraEvents: [
        aura(A, OBSIDIAN_SCALES, "e1", "e1", 10, true),
        aura(RF, OBSIDIAN_SCALES, "e1", "e1", 20),
        aura(R, OBSIDIAN_SCALES, "e1", "e1", 23),
      ],
      spellCastEvents: [cast(OBSIDIAN_SCALES, "e1", 20)],
      ...dies(23),
    });
    mutationCaught([ev], "Obsidian Scales");
  });

  it("a re-broadcast REMOVED+APPLIED inside the span is joined, not its end", () => {
    const d = unit("e1", {
      auraEvents: [
        aura(A, BARKSKIN, "e1", "e1", 10, true),
        aura(R, BARKSKIN, "e1", "e1", 11),
        aura(A, BARKSKIN, "e1", "e1", 11),
        aura(R, BARKSKIN, "e1", "e1", 13),
      ],
      ...dies(13),
    });
    mutationCaught([d], "Barkskin");
  });

  it("a closing row with no source", () => {
    const d = unit("e1", {
      auraEvents: [
        aura(A, BARKSKIN, "e1", "e1", 10, true),
        {
          ...aura(R, BARKSKIN, "0000000000000000", "e1", 13),
          srcUnitName: "nil",
        },
      ],
      ...dies(13),
    });
    mutationCaught([d], "Barkskin");
  });

  it("a self line never reads an ally copy's event of the same press (codex 85-tk-A-T08-2e #1)", () => {
    const ev = unit("e1", {
      spellCastEvents: [cast(OBSIDIAN_SCALES, "e1", 10)],
      auraEvents: [
        aura(A, OBSIDIAN_SCALES, "e1", "e1", 10.02),
        aura(R, OBSIDIAN_SCALES, "e1", "e1", 13),
      ],
      ...dies(13),
    });
    const mate = unit("e2", {
      auraEvents: [
        aura(A, OBSIDIAN_SCALES, "e1", "e2", 10.02),
        aura(R, OBSIDIAN_SCALES, "e1", "e2", 11),
      ],
    });
    const lines = render([ev, mate]);
    const self = lines.filter(
      (l) => l.includes("Obsidian Scales") && !l.includes("→"),
    );
    expect(self, lines.join("\n")).toHaveLength(1);
    expect(self[0]).toContain("ended at death");
    expect(scan([ev, mate], lines)).toEqual([]);
    const mutated = lines.map((l) =>
      l === self[0] ? l.replace("— ended at death", "— removed early") : l,
    );
    expect(scan([ev, mate], mutated)).toHaveLength(1);
  });

  it("an immunity line with `; also on …` after its label (codex 85-tk-A-T08-2e #2)", () => {
    const monk = unit("e1", {
      spec: "270",
      spellCastEvents: [cast(RESTORAL, "e1", 10)],
      auraEvents: [
        aura(A, PEACEWEAVER, "e1", "e1", 10),
        aura(R, PEACEWEAVER, "e1", "e1", 11),
      ],
      ...dies(11),
    });
    const mate = unit("e2", {
      auraEvents: [
        aura(A, PEACEWEAVER, "e1", "e2", 10),
        aura(R, PEACEWEAVER, "e1", "e2", 12),
      ],
    });
    const lines = render([monk, mate]);
    const pw = lines.filter((l) => l.includes("Peaceweaver"));
    expect(pw.join("\n")).toContain("; also on");
    mutationCaught([monk, mate], "Peaceweaver");
  });

  it("Ultimate Penitence's shield merged onto its [ENEMY CD] line (codex 85-tk-A-T08-2f #2)", () => {
    const priest = unit("e1", {
      spec: "256",
      auraEvents: [
        aura(A, ULTIMATE_PENITENCE, "e1", "e1", 10, true),
        aura(R, ULTIMATE_PENITENCE, "e1", "e1", 11),
      ],
      ...dies(11),
    });
    const seed = [
      "0:10  [ENEMY CD]   4(RDruid) (Discipline Priest): Ultimate Penitence (cast 1 of 1)",
    ];
    const lines = render([priest], seed);
    expect(lines.join("\n")).not.toContain("[ENEMY DEF]");
    mutationCaught([priest], "Ultimate Penitence", seed);
  });
});
