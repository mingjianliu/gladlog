/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact6 F20 — the immunity class ("is the target immune at this instant"):
 *  - D8: the Spirit of Redemption forms are an immunity form for the control
 *    sampler (`auraIsImmunityForm` → `ccSamplerFor` blockers), as for the
 *    interrupt test;
 *  - D14: one "was this press refused as IMMUNE" reading
 *    (`pressImmuneMissRows` / `pressRefusedImmuneOn`);
 *  - D17 (ruling 3): Peaceweaver is an immunity-kind save with its DB2 mask
 *    (126) — an `[ENEMY DEF]` event per carrier, `immune to magic`, holding
 *    while up and cutting the carrier's defenseless spans;
 *  - Q4: a ≤ 1 s triggered immunity is not its parent's standing mask
 *    (Cloak of Shadows, Metamorphosis).
 */
import { CombatUnitClass, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  ENEMY_IMMUNITY_SAVE_AURAS,
  ENEMY_IMMUNITY_TEAM_PROC_AURAS,
} from "../src/data/spellIdLists";
import { immunitySchoolMask } from "../src/data/spellSchools";
import {
  pressImmuneMissRows,
  pressRefusedImmuneOn,
} from "../src/utils/castMissRows";
import {
  ccSamplerFor,
  ccTargetBlockerIntervals,
} from "../src/utils/ccTargetState";
import {
  auraBlocksInterrupt,
  auraIsImmunityForm,
} from "../src/utils/combatStates";
import {
  enemyDefensiveEvents,
  immunityLastsItsAura,
  immunitySchoolWords,
  isImmunitySaveAura,
  limitedImmunitySchoolMask,
  ownSaveSpanS,
  schoolLimitedImmunityNames,
} from "../src/utils/enemyDefensives";

const T0 = Date.UTC(2026, 9, 25);
const ms = (s: number) => T0 + s * 1000;

beforeAll(async () => {
  await ensureAnalysisData();
});

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "270",
    reaction: 2,
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
  };
}
const auraRow = (
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
const castRow = (spellId: string, dest: string, atS: number): any => ({
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
const missRow = (
  spellId: string,
  dest: string,
  atS: number,
  event = LogEvent.SPELL_MISSED,
  missType = "IMMUNE",
) => ({
  spellId,
  missType,
  destUnitId: dest,
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS) },
});

describe("D8 — the Spirit of Redemption forms are an immunity form", () => {
  it("both forms, and nothing DB2 already encodes or no ruling covers", () => {
    expect(auraIsImmunityForm("215769")).toBe(true); // pressed
    expect(auraIsImmunityForm("27827")).toBe(true); // on death
    expect(auraIsImmunityForm("409293")).toBe(false); // Burrow
    expect(auraIsImmunityForm("11327")).toBe(false); // Vanish
    expect(auraIsImmunityForm("642")).toBe(false); // Divine Shield: DB2
    // the interrupt test reads the same predicate
    expect(auraBlocksInterrupt("27827")).toBe(true);
    expect(auraBlocksInterrupt("215769")).toBe(true);
  });

  it("c992ce75 0:47–0:55: the control sampler reads a priest in the form as immune", () => {
    const owner = unit("o", {
      reaction: 1,
      class: CombatUnitClass.Paladin,
      spec: "70",
    });
    const priest = unit("p", {
      auraEvents: [
        auraRow(LogEvent.SPELL_AURA_APPLIED, "215769", "p", "p", 45.6),
        auraRow(LogEvent.SPELL_AURA_REMOVED, "215769", "p", "p", 54.7),
      ],
    });
    const combat: any = {
      startTime: T0,
      endTime: ms(120),
      startInfo: { zoneId: "1505" },
      units: { o: owner, p: priest },
    };
    const sampler = ccSamplerFor({
      combat,
      owner,
      cd: {
        spellId: "853", // Hammer of Justice
        spellName: "Hammer of Justice",
        tag: "CC",
        cooldownSeconds: 45,
        maxChargesDetected: 1,
        casts: [],
        availableWindows: [],
        neverUsed: true,
      },
      enemyIds: new Set(["p"]),
    });
    expect(sampler).not.toBeNull();
    // every second the form overlaps, the boundary seconds included
    for (const s of [45, 47, 50, 54])
      expect(sampler!.stateAt(priest, s), String(s)).toMatchObject({
        ok: false,
        reason: "target-immune",
      });
    // control: after the form the target is no longer "immune" (it fails on
    // the next condition — no positions in this fixture)
    expect(sampler!.stateAt(priest, 56)).not.toMatchObject({
      reason: "target-immune",
    });
  });
});

describe("D14 — the one 'was this press refused as IMMUNE' reading", () => {
  const casts = [ms(30)];
  it("a non-periodic IMMUNE row of the cast or its effect, in the cast's window, on that unit", () => {
    // Storm Bolt 107570: its IMMUNE is logged under the stun 132169
    const rows = [missRow("132169", "e", 30.01)];
    expect(pressImmuneMissRows(rows, "107570", casts, ms(30))).toHaveLength(1);
    expect(pressRefusedImmuneOn(rows, "107570", casts, ms(30), "e")).toBe(true);
    expect(pressRefusedImmuneOn(rows, "107570", casts, ms(30), "x")).toBe(
      false,
    );
  });
  it("not a DoT tick, not another miss type, not outside the window", () => {
    const at = (r: ReturnType<typeof missRow>) =>
      pressRefusedImmuneOn([r], "360194", casts, ms(30), "e");
    expect(at(missRow("360194", "e", 30.0))).toBe(true);
    expect(at(missRow("360194", "e", 31, LogEvent.SPELL_PERIODIC_MISSED))).toBe(
      false,
    );
    expect(at(missRow("360194", "e", 30, LogEvent.SPELL_MISSED, "MISS"))).toBe(
      false,
    );
    expect(at(missRow("360194", "e", 33))).toBe(false);
  });
  it("F20 wide residual (0373256a r1 2:14): The Hunt's impact row 1246169 at the press's target is the press's — its IMMUNE counts", () => {
    const castRow = (id: string, dest: string, atS: number) => ({
      spellId: id,
      spellName: "The Hunt",
      destUnitId: dest,
      timestamp: ms(atS),
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms(atS) },
    });
    const hunts = [ms(30)];
    const rows = [
      missRow("1246168", "totem", 30.34), // the Grounding Totem's
      missRow("1246169", "pal", 30.393), // the impact's, on the paladin
    ];
    const pressCasts = [
      castRow("1246167", "pal", 30),
      castRow("1246169", "pal", 30.393),
    ];
    // without the caster's rows: only its own ids
    expect(pressRefusedImmuneOn(rows, "1246167", hunts, ms(30), "pal")).toBe(
      false,
    );
    expect(
      pressRefusedImmuneOn(rows, "1246167", hunts, ms(30), "pal", pressCasts),
    ).toBe(true);
    // an impact row at another unit, or past the window, is not the press's
    expect(
      pressRefusedImmuneOn(rows, "1246167", hunts, ms(30), "pal", [
        castRow("1246169", "x", 30.393),
      ]),
    ).toBe(false);
    expect(
      pressRefusedImmuneOn(
        [missRow("1246169", "pal", 33)],
        "1246167",
        hunts,
        ms(30),
        "pal",
        [castRow("1246169", "pal", 33)],
      ),
    ).toBe(false);
    // codex 20-F20-33: the other The Hunt, 370965 → 370966 (DB2 charge
    // trigger; 457 of 477 presses followed on the 605)
    expect(
      pressRefusedImmuneOn(
        [missRow("370966", "pal", 30.393)],
        "370965",
        hunts,
        ms(30),
        "pal",
        [castRow("370965", "pal", 30), castRow("370966", "pal", 30.393)],
      ),
    ).toBe(true);
  });
  it("codex 20-F20-28 #2: a same-name cast of another id is no follow-up — only a DB2-triggered id is", () => {
    const castRow = (id: string, name: string, dest: string, atS: number) => ({
      spellId: id,
      spellName: name,
      destUnitId: dest,
      timestamp: ms(atS),
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms(atS) },
    });
    // Moonfire 8921 lands; Cat Form; Lunar Inspiration's Moonfire 155625 is
    // pressed at the same target and refused
    const casts = [
      castRow("8921", "Moonfire", "e", 30),
      castRow("768", "Cat Form", "druid", 31.15),
      castRow("155625", "Moonfire", "e", 32.3),
    ];
    const misses = [missRow("155625", "e", 32.3)];
    expect(
      pressRefusedImmuneOn(misses, "8921", [ms(30)], ms(30), "e", casts),
    ).toBe(false);
    // the second press is refused on its own reading
    expect(
      pressRefusedImmuneOn(misses, "155625", [ms(32.3)], ms(32.3), "e", casts),
    ).toBe(true);
    // The Hunt: a second press of a press that triggers the same id, between
    // the press and the impact row, owns the row
    const hunt = [
      castRow("1246167", "The Hunt", "pal", 30),
      castRow("1259431", "Predator's Wake", "pal", 30.2),
      castRow("1246169", "The Hunt", "pal", 30.393),
    ];
    const huntMiss = [missRow("1246169", "pal", 30.393)];
    expect(
      pressRefusedImmuneOn(huntMiss, "1246167", [ms(30)], ms(30), "pal", hunt),
    ).toBe(false);
    expect(
      pressRefusedImmuneOn(
        huntMiss,
        "1259431",
        [ms(30.2)],
        ms(30.2),
        "pal",
        hunt,
      ),
    ).toBe(true);
  });
});

describe("D17 — Peaceweaver is an immunity-kind save with its DB2 mask (ruling 3)", () => {
  const PEACEWEAVER = "353319";
  const RESTORAL = "388615";

  it("the aura sets, the DB2 mask and the label", () => {
    expect(ENEMY_IMMUNITY_SAVE_AURAS[PEACEWEAVER]).toBe("Peaceweaver");
    expect(ENEMY_IMMUNITY_TEAM_PROC_AURAS.has(PEACEWEAVER)).toBe(true);
    expect(isImmunitySaveAura(PEACEWEAVER)).toBe(true);
    expect(immunitySchoolMask(PEACEWEAVER)).toBe(0x7e);
    expect(limitedImmunitySchoolMask(PEACEWEAVER)).toBe(0x7e);
    expect(immunitySchoolWords(0x7e)).toBe("magic");
    expect(schoolLimitedImmunityNames().has("Peaceweaver")).toBe(true);
    // a DB2 school immunity on the aura itself holds while it is up
    expect(immunityLastsItsAura(PEACEWEAVER)).toBe(true);
    // the all-school immunity-kind saves stay full (no limited mask)
    expect(limitedImmunitySchoolMask("378441")).toBeUndefined(); // Time Stop
    expect(limitedImmunitySchoolMask("409293")).toBeUndefined(); // Burrow
  });

  it("4caab013 1:38: one `immune` event per carrier, pressed by the monk's Restoral, cutting each carrier's span", () => {
    const peace = (dest: string, from: number, to: number) => [
      auraRow(LogEvent.SPELL_AURA_APPLIED, PEACEWEAVER, "monk", dest, from),
      auraRow(LogEvent.SPELL_AURA_REMOVED, PEACEWEAVER, "monk", dest, to),
    ];
    const monk = unit("monk", {
      spellCastEvents: [castRow(RESTORAL, "0000000000000000", 98.25)],
      auraEvents: peace("monk", 98.28, 100.3),
    });
    const ally = unit("ally", { auraEvents: peace("ally", 98.3, 100.32) });
    const enemies = [monk, ally];
    const combat = { startTime: T0, endTime: ms(180) };
    for (const [u, at] of [
      [monk, 98.28],
      [ally, 98.3],
    ] as const) {
      const evs = enemyDefensiveEvents(u, enemies, combat).filter(
        (e) => e.spellId === PEACEWEAVER,
      );
      expect(evs, u.id).toHaveLength(1);
      expect(evs[0]).toMatchObject({
        kind: "immune",
        spellName: "Peaceweaver",
        casterId: u.id,
        pressSeconds: 98.25,
      });
      expect(evs[0]!.atSeconds).toBeCloseTo(at, 5);
      expect(evs[0]!.observedSeconds).toBeCloseTo(2.02, 5);
      expect(evs[0]!.noPressLogged).toBeUndefined();
      expect(ownSaveSpanS(evs[0]!, false)).toBeDefined();
    }
  });

  it("an aura the OTHER side put on the unit is not its save", () => {
    // the source "monk" is not on the unit's team
    const enemy = unit("e", {
      auraEvents: [
        auraRow(LogEvent.SPELL_AURA_APPLIED, PEACEWEAVER, "monk", "e", 10),
        auraRow(LogEvent.SPELL_AURA_REMOVED, PEACEWEAVER, "monk", "e", 12),
      ],
    });
    expect(
      enemyDefensiveEvents(enemy, [enemy], {
        startTime: T0,
        endTime: ms(60),
      }).filter((e) => e.spellId === PEACEWEAVER),
    ).toEqual([]);
  });
});

describe("Q4 — a ≤ 1 s triggered immunity is not the parent's standing mask", () => {
  it("Cloak of Shadows, Metamorphosis and Void Metamorphosis lost the 127 their 1 s trigger gave them; the standing immunities keep theirs", () => {
    expect(immunitySchoolMask("31224")).toBeUndefined();
    expect(immunitySchoolMask("191427")).toBeUndefined();
    expect(immunitySchoolMask("1217605")).toBeUndefined();
    expect(immunitySchoolMask("642")).toBe(127); // Divine Shield
    expect(immunitySchoolMask("1022")).toBe(1); // Blessing of Protection
    expect(immunitySchoolMask("204018")).toBe(126); // Spellwarding
    // the signed table still says what Cloak stops
    expect(limitedImmunitySchoolMask("31224")).toBe(0x7e);
  });
});

describe("F20 residual — one target-immunity reading for the control sampler and the healer-offense lines", () => {
  const combatOf = (...us: any[]): any => ({
    startTime: T0,
    endTime: ms(300),
    startInfo: { zoneId: "1505" },
    units: Object.fromEntries(us.map((u) => [u.id, u])),
  });
  const blockedAt = (ivs: { fromS: number; toS: number }[], s: number) =>
    ivs.some((iv) => iv.fromS <= s && s < iv.toS);

  it("s0/76-1 0:32.6–0:37.6: Cloak of Shadows blocks Binding Shot's arcane stun by the signed school mask, never a physical stun", () => {
    const rogue = unit("r", {
      class: CombatUnitClass.Rogue,
      spec: "261",
      auraEvents: [
        auraRow(LogEvent.SPELL_AURA_APPLIED, "31224", "r", "r", 32.6),
        auraRow(LogEvent.SPELL_AURA_REMOVED, "31224", "r", "r", 37.6),
      ],
    });
    const combat = combatOf(rogue);
    const bs = ccTargetBlockerIntervals(
      rogue,
      combat,
      "109248",
      "Binding Shot",
    );
    expect(bs.map((iv) => iv.spellId)).toEqual(["31224"]);
    expect(blockedAt(bs, 34)).toBe(true);
    expect(blockedAt(bs, 38)).toBe(false);
    // Kidney Shot is physical: Cloak's 126 does not cover it
    expect(
      ccTargetBlockerIntervals(rogue, combat, "408", "Kidney Shot"),
    ).toEqual([]);
  });

  it("s0/72-1 3:01–3:05: a healer in Spirit of Redemption is not a control target for the healer-offense reading either", () => {
    const priest = unit("p", {
      auraEvents: [
        auraRow(LogEvent.SPELL_AURA_APPLIED, "27827", "p", "p", 181.2),
        auraRow(LogEvent.SPELL_AURA_REMOVED, "27827", "p", "p", 185.4),
      ],
    });
    const ivs = ccTargetBlockerIntervals(
      priest,
      combatOf(priest),
      "853",
      "Hammer of Justice",
    );
    expect(blockedAt(ivs, 183)).toBe(true);
    expect(blockedAt(ivs, 186)).toBe(false);
  });
});
