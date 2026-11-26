/**
 * Pipeline T192 (user ruling R121, 2026-11-25): the stealth a Vanish leaves
 * (11327) that came off right after its holder pressed something stealth
 * does not allow was ended by that press — the opener. It read `ended after
 * 0.4 of 1.5s — no dispel logged`. A press stealth allows (Shadowstep) ends
 * nothing (review 85-tk-L5-T192-2: an enemy Flare took the aura in a
 * Shadowstep's millisecond).
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { STEALTH_OPENER_CAST_MS } from "../src/utils/stealthActionEnd";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const ME = "player-1";
const VANISH = "1856";
const VANISH_AURA = "11327";
const CHEAP_SHOT = "1833";
const SHADOWSTEP = "36554";
const SHADOWSTRIKE = "185438";
const STEALTH = "115191";
const EVISCERATE = "196819";

beforeAll(async () => {
  await ensureAnalysisData();
});

interface Opener {
  id: string;
  name: string;
  atS: number;
  /** cast at the rogue itself (the Stealth button) */
  self?: boolean;
  /** the opener's own damage row, logged with the cast */
  damage?: boolean;
  /** …as a miss row instead (a fully absorbed hit) */
  missType?: string;
  /** the unit that row is on, when not the cast's target */
  hitUnit?: string;
  /** source line of the cast row, and of its damage/miss row */
  li?: number;
  hitLi?: number;
}
const withLine = <T>(row: T, li: number | undefined): T => {
  if (li !== undefined)
    (row as { logLine: { lineIndex?: number } }).logLine.lineIndex = li;
  return row;
};
const hitRow = (o: Opener) => ({
  spellId: o.id,
  spellName: o.name,
  srcUnitId: ME,
  destUnitId: o.hitUnit ?? "enemy-1",
  timestamp: T0 + o.atS * 1000,
  ...(o.missType ? { missType: o.missType, amount: 0 } : {}),
  logLine: {
    event: o.missType ? LogEvent.SPELL_MISSED : LogEvent.SPELL_DAMAGE,
    timestamp: T0 + o.atS * 1000,
    parameters: [],
    ...(o.hitLi !== undefined ? { lineIndex: o.hitLi } : {}),
  },
});
const rogue = (
  removedS: number,
  openers: Opener[] = [],
  appliedS = 30,
  rows: { appliedLi?: number; removedLi?: number } = {},
) =>
  Object.assign(
    makeUnit(ME, {
      class: CombatUnitClass.Rogue,
      spec: CombatUnitSpec.Rogue_Subtlety,
      spellCastEvents: [
        makeSpellCastEvent(VANISH, T0 + 30_000, ME),
        ...openers.map((o) =>
          withLine(
            makeSpellCastEvent(
              o.id,
              T0 + o.atS * 1000,
              o.self ? ME : "enemy-1",
              o.self ? "Me" : "Enemy",
              ME,
              "Me",
              0,
              o.name,
            ),
            o.li,
          ),
        ),
      ].sort((a, b) => a.logLine.timestamp - b.logLine.timestamp),
      damageOut: openers
        .filter((o) => o.damage && !o.missType)
        .map(hitRow) as never,
      auraEvents: [
        withLine(
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            VANISH_AURA,
            T0 + appliedS * 1000,
            ME,
            ME,
            "BUFF",
          ),
          rows.appliedLi,
        ),
        withLine(
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            VANISH_AURA,
            T0 + removedS * 1000,
            ME,
            ME,
            "BUFF",
          ),
          rows.removedLi,
        ),
      ],
    }),
    {
      missesOut: openers
        .filter((o) => o.damage && o.missType)
        .map(hitRow) as never,
    },
  ) as ICombatUnit;

const fade = (u: ICombatUnit) =>
  extractOwnerCDBuffExpiry(
    [
      {
        spellId: VANISH,
        spellName: "Vanish",
        tag: "Defensive",
        casts: [{ timeSeconds: 30 }],
        cooldownSeconds: 120,
        neverUsed: false,
        availableWindows: [],
      },
    ] as never,
    ME,
    [u],
    T0,
    u,
  )[0]!;

const cheap = (atS: number): Opener => ({
  id: CHEAP_SHOT,
  name: "Cheap Shot",
  atS,
});

describe("[BUFF FADED] — a Vanish its opener took (T192)", () => {
  it("the opener ≤ 100 ms before the removal ended it", () => {
    const e = fade(rogue(30.42, [cheap(30.4)]));
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBe("Cheap Shot");
    expect(STEALTH_OPENER_CAST_MS).toBe(100);
  });

  it("no cast at the removal: the early end keeps its length and no cause", () => {
    const e = fade(rogue(30.42));
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBeUndefined();
    expect(e.ranForS).toBeCloseTo(0.42);
  });

  it("an opener more than 100 ms before the removal is not at it", () => {
    expect(fade(rogue(30.6, [cheap(30.4)])).endedByOwnPress).toBeUndefined();
  });

  it("an aura that ran its 1.5 s beside a cast expired", () => {
    const e = fade(rogue(31.5, [cheap(31.45)]));
    expect(e.cause).toBe("expired");
    expect(e.endedByOwnPress).toBeUndefined();
  });

  it("a Shadowstep at the removal ended nothing (an enemy Flare took the aura): the line keeps its length", () => {
    const e = fade(
      rogue(31.0, [{ id: SHADOWSTEP, name: "Shadowstep", atS: 30.99 }]),
    );
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBeUndefined();
    expect(e.ranForS).toBeCloseTo(1.0);
  });

  it("Shadowstrike needs stealth and ends it: named when its damage landed, not without", () => {
    const strike = (damage: boolean): Opener => ({
      id: SHADOWSTRIKE,
      name: "Shadowstrike",
      atS: 30.9,
      damage,
    });
    expect(fade(rogue(30.97, [strike(true)])).endedByOwnPress).toBe(
      "Shadowstrike",
    );
    expect(fade(rogue(30.97, [strike(false)])).endedByOwnPress).toBeUndefined();
  });

  it("the Stealth button in the Shadowstrike's millisecond is no opener (codex 85-tk-L5-T192-2b #1)", () => {
    const e = fade(
      rogue(30.97, [
        { id: STEALTH, name: "Stealth", atS: 30.9, self: true },
        { id: SHADOWSTRIKE, name: "Shadowstrike", atS: 30.9, damage: true },
      ]),
    );
    expect(e.endedByOwnPress).toBe("Shadowstrike");
    expect(
      fade(
        rogue(30.97, [{ id: STEALTH, name: "Stealth", atS: 30.9, self: true }]),
      ).endedByOwnPress,
    ).toBeUndefined();
  });

  it("a press logged before the Vanish went up is no opener of it (same review #2)", () => {
    // Eviscerate 56 ms before the aura's APPLIED, the aura off 25 ms after it
    const e = fade(
      rogue(
        30.081,
        [{ id: EVISCERATE, name: "Eviscerate", atS: 30.0, damage: true }],
        30.056,
      ),
    );
    expect(e.endedByOwnPress).toBeUndefined();
    // the same press after it went up is one
    expect(
      fade(
        rogue(
          30.081,
          [{ id: EVISCERATE, name: "Eviscerate", atS: 30.07 }],
          30.056,
        ),
      ).endedByOwnPress,
    ).toBe("Eviscerate");
  });

  it("a Shadowstrike the target fully absorbed resolved on it: its miss row counts (codex 85-tk-L5-T192-2c #1)", () => {
    const e = fade(
      rogue(30.98, [
        {
          id: SHADOWSTRIKE,
          name: "Shadowstrike",
          atS: 30.9,
          damage: true,
          missType: "ABSORB",
        },
      ]),
    );
    expect(e.endedByOwnPress).toBe("Shadowstrike");
  });

  it("a hit on another unit proves nothing about the cast (2c #2)", () => {
    const e = fade(
      rogue(30.98, [
        {
          id: SHADOWSTRIKE,
          name: "Shadowstrike",
          atS: 30.9,
          damage: true,
          hitUnit: "enemy-2",
        },
      ]),
    );
    expect(e.endedByOwnPress).toBeUndefined();
  });

  it("a hit row logged before the cast row is not its hit (2c #2)", () => {
    const strike: Opener = {
      id: SHADOWSTRIKE,
      name: "Shadowstrike",
      atS: 30.9,
      damage: true,
      li: 20,
      hitLi: 19,
    };
    expect(fade(rogue(30.98, [strike])).endedByOwnPress).toBeUndefined();
    expect(fade(rogue(30.98, [{ ...strike, hitLi: 21 }])).endedByOwnPress).toBe(
      "Shadowstrike",
    );
  });

  it("rows in one ms keep their source order: a press logged after the removal is no cause, one right after the application is (2c #3)", () => {
    const garrote = (li: number): Opener => ({
      id: "703",
      name: "Garrote",
      atS: 31.0,
      li,
    });
    const rows = { appliedLi: 5, removedLi: 50 };
    expect(
      fade(rogue(31.0, [garrote(51)], 30, rows)).endedByOwnPress,
    ).toBeUndefined();
    expect(fade(rogue(31.0, [garrote(49)], 30, rows)).endedByOwnPress).toBe(
      "Garrote",
    );
    // the application's own millisecond
    const early: Opener = { id: "703", name: "Garrote", atS: 30.05, li: 6 };
    expect(
      fade(rogue(30.08, [early], 30.05, { appliedLi: 5, removedLi: 9 }))
        .endedByOwnPress,
    ).toBe("Garrote");
    expect(
      fade(
        rogue(30.08, [{ ...early, li: 4 }], 30.05, {
          appliedLi: 5,
          removedLi: 9,
        }),
      ).endedByOwnPress,
    ).toBeUndefined();
  });

  it("a missed Blind is an attempt, not a hit: only an ABSORB miss row counts (codex 85-tk-L5-T192-2d #1)", () => {
    const blind = (missType: string): Opener => ({
      id: "2094",
      name: "Blind",
      atS: 30.9,
      damage: true,
      missType,
    });
    for (const m of ["MISS", "IMMUNE", "DODGE", "REFLECT"])
      expect(fade(rogue(30.95, [blind(m)])).endedByOwnPress).toBeUndefined();
  });

  it("an application from an older use is not this press's (2d #2)", () => {
    // the current APPLIED row is missing; the last one is 24 s older
    const e = fade(
      rogue(
        30.081,
        [{ id: EVISCERATE, name: "Eviscerate", atS: 29.92, damage: true }],
        6,
      ),
    );
    expect(e.endedByOwnPress).toBeUndefined();
  });

  it("a REMOVED→APPLIED re-broadcast just before the removal is not the removal (2d #3)", () => {
    // Garrote in the real removal's ms, the re-broadcast pair 1 ms before
    const u = rogue(31.0, [{ id: "703", name: "Garrote", atS: 31.0 }]);
    u.auraEvents.push(
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        VANISH_AURA,
        T0 + 30_999,
        ME,
        ME,
        "BUFF",
      ) as never,
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        VANISH_AURA,
        T0 + 30_999,
        ME,
        ME,
        "BUFF",
      ) as never,
    );
    u.auraEvents.sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
    expect(fade(u).endedByOwnPress).toBe("Garrote");
  });

  it("a duplicate removal after a press in the removal's ms does not make that press the cause (2e)", () => {
    const rows = { appliedLi: 5, removedLi: 50 };
    const u = rogue(
      31.0,
      [{ id: "703", name: "Garrote", atS: 31.0, li: 52 }],
      30,
      rows,
    );
    const dup = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      VANISH_AURA,
      T0 + 31_000,
      ME,
      ME,
      "BUFF",
    ) as never as (typeof u.auraEvents)[number];
    dup.logLine.lineIndex = 53;
    u.auraEvents.push(dup);
    expect(fade(u).endedByOwnPress).toBeUndefined();
  });
});
