/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the checks read them untyped */
/**
 * scan5/t113 (T113): the `[ENEMY DEF]` line form `hitEndPastOwnAction`
 * reads, and the two scan-side readings batch review 80-PIPE-112-B99 fixed —
 * the line's own application (#1) and other protection over a kill window
 * (#2).
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { LINE_RE, run } from "../scripts/scan5/t113";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);

beforeAll(async () => {
  await ensureAnalysisData();
});

function scan(opts: {
  units: any[];
  players?: any[];
  lines?: string[];
  pids?: Record<string, any>;
  first?: boolean;
}) {
  const seen: Array<{ check: string; kind: string; detail: string }> = [];
  run({
    lines: opts.lines ?? [],
    units: opts.units,
    players: opts.players ?? [],
    unitOfPid: (pid: string) => opts.pids?.[pid],
    start: T0,
    legacy: {
      startTime: T0,
      endTime: at(120),
      units: Object.fromEntries(opts.units.map((u) => [u.id, u])),
    },
    firstOwnerOfRound: opts.first ?? false,
    roundKey: "r",
    violate: (
      check: string,
      kind: string,
      _t: number,
      _f: string,
      detail: string,
    ) => seen.push({ check, kind, detail }),
    bump: () => {},
  } as any);
  return seen;
}

describe("scan5/t113 LINE_RE", () => {
  it("reads the time, the pid, the aura and the printed length", () => {
    const m = LINE_RE.exec(
      "0:11  [ENEMY DEF]   5(AMage) (Arcane Mage): Mass Invisibility (immune, 10.8s — ended by a hit; also on 4(RShaman), 6(RPaladin))",
    );
    expect(m?.slice(1, 6)).toEqual([
      "0",
      "11",
      "5",
      "Mass Invisibility",
      "10.8",
    ]);
  });
  it("skips a line that states no hit end", () => {
    expect(
      LINE_RE.exec(
        "0:11  [ENEMY DEF]   5(AMage) (Arcane Mage): Mass Invisibility (immune, end not logged)",
      ),
    ).toBeNull();
  });
});

describe("scan5/t113 hitEndPastOwnAction — the line's own application (B99 #1)", () => {
  it("Mage A's Mass Invisibility on Mage B, B's Polymorph bar, then B's own in the same ms: B's line is not flagged", () => {
    const MI = "414664";
    const fromA = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      MI,
      at(20),
      "mA",
      "mB",
      "BUFF",
    );
    const fromB = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      MI,
      at(20),
      "mB",
      "mB",
      "BUFF",
    );
    const b: any = makeUnit("mB", {
      name: "MageB",
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [],
      auraEvents: [fromA, fromB],
    });
    Object.assign(b, {
      damageIn: [],
      castStartEvents: [
        {
          spellId: "118",
          timestamp: at(20),
          srcUnitId: "mB",
          logLine: {
            event: "SPELL_CAST_START",
            timestamp: at(20),
            lineIndex: fromA.logLine.lineIndex + 0.5,
          },
        },
      ],
    });
    const seen = scan({
      units: [b],
      pids: { "2": b },
      lines: [
        "0:20  [ENEMY DEF]   2(AMage) (Arcane Mage): Mass Invisibility (immune, 10.0s — ended by a hit)",
      ],
    }).filter((v) => v.check === "hitEndPastOwnAction");
    expect(seen).toEqual([]);
  });
});

describe("scan5/t113 killWindowShutPastAction — other protection (B99 #2)", () => {
  it("Burrow 20 s, the holder's cast 22 s, an Ironbark logged 20–25 s: the window rightly opens at 25 s, not flagged", () => {
    const shaman: any = makeUnit("e1", {
      name: "EnemyShaman",
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Enhancement,
      reaction: CombatUnitReaction.Hostile,
      info: { teamId: "1", talents: [], pvpTalents: [] } as never,
      spellCastEvents: [
        makeSpellCastEvent(
          "108271",
          at(2),
          "e1",
          "EnemyShaman",
          "e1",
          "EnemyShaman",
        ),
        makeSpellCastEvent(
          "409293",
          at(20),
          "e1",
          "EnemyShaman",
          "e1",
          "EnemyShaman",
        ),
      ],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "409293",
          at(20),
          "e1",
          "e1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "102342",
          at(20),
          "d1",
          "e1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "102342",
          at(25),
          "d1",
          "e1",
          "BUFF",
        ),
      ],
    });
    Object.assign(shaman, {
      damageIn: [],
      castStartEvents: [
        {
          spellId: "8004",
          spellName: "Healing Surge",
          timestamp: at(22),
          srcUnitId: "e1",
          logLine: { event: "SPELL_CAST_START", timestamp: at(22) },
        },
      ],
    });
    const druid: any = makeUnit("d1", {
      name: "EnemyDruid",
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      reaction: CombatUnitReaction.Hostile,
      info: { teamId: "1", talents: [], pvpTalents: [] } as never,
      spellCastEvents: [
        makeSpellCastEvent(
          "102342",
          at(20),
          "e1",
          "EnemyShaman",
          "d1",
          "EnemyDruid",
        ),
      ],
      auraEvents: [],
    });
    Object.assign(druid, { damageIn: [], castStartEvents: [] });
    const seen = scan({
      units: [shaman, druid],
      players: [shaman, druid],
      first: true,
    }).filter((v) => v.check === "killWindowShutPastAction");
    expect(seen).toEqual([]);
  });
});
