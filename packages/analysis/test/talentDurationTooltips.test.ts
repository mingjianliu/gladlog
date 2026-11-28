/** GH #155 (2026-10-21): the product rows of tooltip-stated duration
 * extensions stay what the talent tooltips say, and the duration predicate
 * prices them. */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { BUFF_DURATION_TALENT_MODIFIERS } from "../src/data/spellEffectData";
import {
  PRESS_OUTCOME_AURAS,
  TOOLTIP_DURATION_ROWS,
  TOOLTIP_PER_EVENT_DURATIONS,
} from "../src/data/talentDurationTooltips";
import generated from "../src/data/talentDurationTooltipsGenerated.json";
import {
  buffDurationRangeForCaster,
  buffFullDurationForCaster,
} from "../src/utils/buffDuration";

import { makeAuraEvent } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

interface GenEntry {
  talentSpellId: string;
  specs: string[];
  kind: string;
  unit: string;
  amount: number;
  cap?: number;
  qualifyingSpellIds?: string[];
  targets: Array<{ spellIds: string[]; baseSeconds: Record<string, number> }>;
}
const genEntries = (generated as unknown as { entries: GenEntry[] }).entries;
const entriesOf = (talent: string, aura: string): GenEntry[] =>
  genEntries.filter(
    (e) =>
      e.talentSpellId === talent &&
      e.targets.some((t) => t.spellIds.includes(aura)),
  );

describe("TOOLTIP_DURATION_ROWS — every number is the tooltip's", () => {
  for (const [aura, rows] of Object.entries(TOOLTIP_DURATION_ROWS))
    for (const r of rows)
      it(`${r.talentSpellId} → ${aura}`, () => {
        const es = entriesOf(r.talentSpellId, aura).filter(
          (e) => e.kind === "fixed",
        );
        expect(
          es.length,
          "a fixed tooltip entry names this aura",
        ).toBeGreaterThan(0);
        const e = es.find((x) =>
          r.pct !== undefined
            ? x.unit === "pct" && x.amount === r.pct
            : x.unit === "s" && x.amount === r.addSeconds,
        );
        expect(e, "the tooltip's amount and unit").toBeDefined();
        const target = e!.targets.find((t) => t.spellIds.includes(aura))!;
        expect(target.baseSeconds[aura]).toBe(r.untalentedBaseSeconds);
        for (const s of r.specs) expect(e!.specs).toContain(s);
        // not a second pricing of a talent the hand table already has
        expect(
          (BUFF_DURATION_TALENT_MODIFIERS[aura] ?? []).some(
            (h) => h.talentSpellId === r.talentSpellId,
          ),
        ).toBe(false);
      });
});

describe("TOOLTIP_PER_EVENT_DURATIONS — Spiritwalker's Momentum", () => {
  it("is the tooltip's per-event row: +1 s per press, up to 4 s", () => {
    for (const [aura, p] of Object.entries(TOOLTIP_PER_EVENT_DURATIONS)) {
      if (p.event !== "press") continue;
      // a talent that extends by being pressed (Keep It Rolling, pipeline
      // T273): its tooltip states one amount, which the generator reads as
      // a fixed row on the press whose outcome the aura is (the roll) —
      // each press inside the aura adds it, and no other press does (codex
      // 85-tk-L1-T273-1 #6)
      if (p.qualifyingSpellIds.has(p.talentSpellId)) {
        expect([...p.qualifyingSpellIds]).toEqual([p.talentSpellId]);
        expect(p.capSeconds).toBeUndefined();
        const press = p.endsAtCastIds?.[0] ?? aura;
        expect(PRESS_OUTCOME_AURAS[press] ?? [aura]).toContain(aura);
        expect(entriesOf(p.talentSpellId, press)).toMatchObject([
          { kind: "fixed", unit: "s", amount: p.addSecondsPerEvent },
        ]);
        continue;
      }
      const [e] = entriesOf(p.talentSpellId, aura).filter(
        (x) => x.kind === "per-event",
      );
      expect(e).toMatchObject({ amount: p.addSecondsPerEvent });
      // a tooltip that names no cap has none in the row either
      expect(e!.cap).toBe(p.capSeconds);
      // the generator lists the presses only for 「带有施法时间的法术」; a
      // tooltip that names one spell (Thunder Blast) is the row's own id
      if (e!.qualifyingSpellIds)
        expect(new Set(e!.qualifyingSpellIds)).toEqual(
          new Set(p.qualifyingSpellIds),
        );
    }
  });
});

const T0 = 1_000_000;
const press = (spellId: string, s: number) => ({
  spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});

describe("fact10 D14 / D17 — Stampeding Roar under Pack's Endurance, Time Skip under Tomorrow, Today", () => {
  const holder = (spec: string, talent: { id1: number; id2: number } | null) =>
    ({
      spec,
      info: {
        talents: talent ? [{ ...talent, count: 1 }] : [],
        pvpTalents: [],
      },
      spellCastEvents: [],
    }) as never;
  // COMBATANT_INFO entries read off 44942dae (Feral) and 461265d4 (Augmentation)
  const PACKS_ENDURANCE = { id1: 94615, id2: 117215 };
  const TOMORROW_TODAY = { id1: 93369, id2: 115687 };
  it("44942dae 0:22: a Feral holder's Roar runs 10 s, a non-holder's 8 s", () => {
    // …and the bear-form copy 77761 (GH #191: holders 2 / 2 at 10 s,
    // non-holders 11 / 16 at 8 s, none at 10 s)
    for (const id of ["77764", "106898", "77761"]) {
      expect(
        buffFullDurationForCaster(id, holder("103", PACKS_ENDURANCE)),
      ).toBe(10);
      expect(buffFullDurationForCaster(id, holder("103", null))).toBe(8);
    }
  });
  it("461265d4 1:05: a holder's Time Skip channels 3 s, a non-holder's 2 s", () => {
    expect(
      buffFullDurationForCaster(
        "404977",
        holder("1473", TOMORROW_TODAY),
        undefined,
        {
          pressed: true,
        },
      ),
    ).toBe(3);
    expect(
      buffFullDurationForCaster("404977", holder("1473", null), undefined, {
        pressed: true,
      }),
    ).toBe(2);
  });
});

describe("GH #173 Q5 — Darkness under Long Night", () => {
  // the choice node Long Night / Pitch Black (node 91001): entry 112920 is
  // Long Night 389781, 112919 Pitch Black 389783 (talentIdMap)
  const dh = (spec: string, entry: number | null, pvpTalents: string[] = []) =>
    ({
      spec,
      info: {
        talents: entry === null ? [] : [{ id1: 91001, id2: entry, count: 1 }],
        pvpTalents,
      },
      spellCastEvents: [],
    }) as never;
  it("a Long Night holder's Darkness runs 11 s, a Pitch Black taker's 8 s (fact11 39-23-361: rows to +10.65 s)", () => {
    for (const spec of ["577", "581", "1480"]) {
      expect(buffFullDurationForCaster("196718", dh(spec, 112920))).toBe(11);
      expect(buffFullDurationForCaster("196718", dh(spec, 112919))).toBe(8);
    }
    // no caster: the DB2 length, as before
    expect(buffFullDurationForCaster("196718", undefined)).toBe(8);
  });
  it("Cover of Darkness 357419 (PvP) adds 4 s: 12 s alone, 15 s with Long Night (corpus: 11.26 / 11.61 s alone, up to 12.31 s with both)", () => {
    expect(
      buffFullDurationForCaster("196718", dh("577", 112919, ["357419"])),
    ).toBe(12);
    expect(
      buffFullDurationForCaster("196718", dh("577", 112920, ["357419"])),
    ).toBe(15);
  });
});

describe("GH #123.2 — Anti-Magic Zone under Assimilation", () => {
  // Assimilation 374383: class node 76048, entry 96176 (talentIdMap)
  const dk = (spec: string, holds: boolean) =>
    ({
      spec,
      info: {
        talents: holds ? [{ id1: 76048, id2: 96176, count: 1 }] : [],
        pvpTalents: [],
      },
      spellCastEvents: [],
    }) as never;
  it("a holder's zone runs 8 s, a non-holder's 6 s — the cast id and its aura alike (605: h 7/0, n 0/103)", () => {
    for (const id of ["51052", "145629"])
      for (const spec of ["250", "251", "252"]) {
        expect(buffFullDurationForCaster(id, dk(spec, true))).toBe(8);
        expect(buffFullDurationForCaster(id, dk(spec, false))).toBe(6);
      }
    expect(buffFullDurationForCaster("145629", undefined)).toBe(6);
  });
});

describe("buffFullDurationForCaster — the tooltip rows", () => {
  // a COMBATANT_INFO loadout holding Ethereal Cloak 457022 (hero node 95106,
  // entry 117703) — a rank is needed to price a row; a "yes" with no rank
  // falls back to the plain value (the hand table's contract)
  const rogue = (holds: boolean) =>
    ({
      spec: CombatUnitSpec.Rogue_Assassination,
      info: {
        talents: holds ? [{ id1: 95106, id2: 117703, count: 1 }] : [],
        pvpTalents: [],
      },
      spellCastEvents: [],
    }) as never;
  it("Cloak of Shadows: 5 s without a caster, 7 s for a holder of 457022", () => {
    expect(buffFullDurationForCaster("31224", undefined)).toBe(5);
    expect(buffFullDurationForCaster("31224", rogue(true))).toBe(7);
    expect(buffFullDurationForCaster("31224", rogue(false))).toBe(5);
  });
  it("a spec outside the tooltip branch is not priced", () => {
    const holyHolder = {
      spec: CombatUnitSpec.Priest_Holy,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [press("238135", -100)],
    } as never;
    // 238135's +5 s on Power Word: Shield is Discipline's
    expect(buffFullDurationForCaster("17", holyHolder)).toBe(15);
  });
});

describe("buffFullDurationForCaster — Spiritwalker's Momentum per press", () => {
  const shaman = (casts: ReturnType<typeof press>[]) =>
    ({
      spec: CombatUnitSpec.Shaman_Elemental,
      info: { talents: [], pvpTalents: [] },
      // the talent spell's own cast is the ownership evidence the predicate
      // accepts without a decoded loadout
      spellCastEvents: [press("443425", -100), ...casts],
    }) as never;
  const AT = T0;
  it("each qualifying press while the buff is up adds 1 s, up to 4 s", () => {
    expect(buffFullDurationForCaster("79206", shaman([]), AT)).toBe(15);
    expect(
      buffFullDurationForCaster("79206", shaman([press("188196", 3)]), AT),
    ).toBe(16);
    expect(
      buffFullDurationForCaster(
        "79206",
        shaman([3, 5, 7, 9, 11, 13].map((s) => press("51505", s))),
        AT,
      ),
    ).toBe(19);
    // a press after the buff (as extended so far) ran out does not count
    expect(
      buffFullDurationForCaster("79206", shaman([press("188196", 15.5)]), AT),
    ).toBe(15);
    // an instant spell with no cast time does not count
    expect(
      buffFullDurationForCaster("79206", shaman([press("8042", 3)]), AT),
    ).toBe(15);
  });
  // codex 20-F16-13 #1: the owner's [BUFF FADED] reader read 15 s while the
  // aura builder read 19 — each press is priced at its own instant
  it("the owner's expiry reader prices the press with the casts after it (no REMOVED → estimated at 19 s)", () => {
    const owner = {
      ...(shaman([3, 5, 7, 9].map((s) => press("51505", s))) as object),
      id: "sh",
      name: "Sh",
      auraEvents: [
        {
          spellId: "79206",
          srcUnitId: "sh",
          destUnitId: "sh",
          timestamp: AT,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: AT },
        },
      ],
    } as never;
    const ev = extractOwnerCDBuffExpiry(
      [
        {
          spellId: "79206",
          spellName: "Spiritwalker's Grace",
          tag: "Utility",
          casts: [{ timeSeconds: 0 }],
          cooldownSeconds: 120,
          neverUsed: false,
          availableWindows: [],
        },
      ] as never,
      "sh",
      [owner],
      AT,
      owner,
      [],
      // no round end given: with one, an aura the log never shows coming
      // off runs to it (T142) and no length is estimated
    );
    expect(ev[0]?.expiresAtSeconds).toBeCloseTo(19, 3);
  });

  it("the loadout reads the span for a holder", () => {
    expect(buffDurationRangeForCaster("79206", shaman([]))).toEqual({
      min: 15,
      max: 19,
    });
  });
});

describe("buffFullDurationForCaster — Avatar under Capacitance (T76, GH #173 D13)", () => {
  const warrior = (spec: CombatUnitSpec, casts: ReturnType<typeof press>[]) =>
    ({
      spec,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [press("1270724", -100), ...casts],
    }) as never;
  const AT = T0;
  it("each Thunder Blast inside the growing window adds 2 s, with no cap", () => {
    const fury = CombatUnitSpec.Warrior_Fury;
    expect(buffFullDurationForCaster("107574", warrior(fury, []), AT)).toBe(20);
    expect(
      buffFullDurationForCaster(
        "107574",
        warrior(fury, [press("435222", 4), press("435222", 12)]),
        AT,
      ),
    ).toBe(24);
    // the fourth press lands at 25 s — inside the window the first three grew
    expect(
      buffFullDurationForCaster(
        "107574",
        warrior(
          fury,
          [4, 12, 19, 25].map((s) => press("435222", s)),
        ),
        AT,
      ),
    ).toBe(28);
    // a Thunder Blast after the run ended, and a Thunder Clap, add nothing
    expect(
      buffFullDurationForCaster(
        "107574",
        warrior(fury, [press("435222", 20.5), press("6343", 3)]),
        AT,
      ),
    ).toBe(20);
  });

  it("a Thunder Blast logged after Avatar's REMOVED row extends nothing (codex 85-tk-G-T76-1)", () => {
    const aura = (event: LogEvent, s: number, lineIndex: number) => ({
      spellId: "107574",
      srcUnitId: "w",
      destUnitId: "w",
      timestamp: T0 + s * 1000,
      logLine: { event, timestamp: T0 + s * 1000, lineIndex },
    });
    const blast = (s: number, lineIndex: number) => ({
      spellId: "435222",
      logLine: {
        event: LogEvent.SPELL_CAST_SUCCESS,
        timestamp: T0 + s * 1000,
        lineIndex,
      },
    });
    const fury = (casts: unknown[], removedLine: number) =>
      ({
        id: "w",
        spec: CombatUnitSpec.Warrior_Fury,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [press("1270724", -100), ...casts],
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, 0, 1),
          aura(LogEvent.SPELL_AURA_REMOVED, 20, removedLine),
        ],
      }) as never;
    // the press in the REMOVED's own millisecond, logged after it
    expect(
      buffFullDurationForCaster("107574", fury([blast(20, 4)], 3), AT),
    ).toBe(20);
    // …logged before it, it is still inside the run
    expect(
      buffFullDurationForCaster("107574", fury([blast(20, 2)], 3), AT),
    ).toBe(22);
    // a press inside the run counts as it did
    expect(
      buffFullDurationForCaster("107574", fury([blast(4, 2)], 3), AT),
    ).toBe(22);
  });

  it("Arms is outside the tooltip's specs: 20 s", () => {
    expect(
      buffFullDurationForCaster(
        "107574",
        warrior(CombatUnitSpec.Warrior_Arms, [press("435222", 4)]),
        AT,
      ),
    ).toBe(20);
  });

  it("the loadout prints the base: the tooltip names no cap", () => {
    expect(
      buffDurationRangeForCaster(
        "107574",
        warrior(CombatUnitSpec.Warrior_Fury, []),
      ),
    ).toEqual({ min: 20, max: 20 });
  });
});

describe("pipeline T309 — Dark Transformation grows 1 s per Death Coil / Epidemic", () => {
  // Dark Transformation 1233448: spec node 76185, entry 96322 (talentIdMap)
  const dk = (spec: string, casts: Array<[string, number]>) =>
    ({
      spec,
      info: { talents: [{ id1: 76185, id2: 96322, count: 1 }], pvpTalents: [] },
      spellCastEvents: casts.map(([id, s]) => press(id, s)),
    }) as never;
  it("96ada059 r0: four Death Coils inside it — 19 s; the ghoul's aura and the death knight's alike", () => {
    const u = dk("252", [
      ["47541", 4.05],
      ["47541", 11.93],
      ["47541", 13.49],
      ["47541", 14.76],
      // after its end at 19 s: extends nothing
      ["47541", 21.1],
    ]);
    for (const id of ["1233448", "1235391"])
      expect(buffFullDurationForCaster(id, u, T0)).toBe(19);
  });
  it("Necrotic Coil, Epidemic and Graveyard count; Death Strike does not; a press inside the grown window counts", () => {
    const u = dk("252", [
      ["1242174", 2],
      ["207317", 5],
      ["49998", 6],
      ["383269", 14],
      // inside only because the three before it grew the window to 18 s
      ["47541", 17.5],
    ]);
    expect(buffFullDurationForCaster("1235391", u, T0)).toBe(19);
  });
  it("no application time, or another spec: the DB2 15 s", () => {
    expect(buffFullDurationForCaster("1235391", dk("252", []))).toBe(15);
    expect(
      buffFullDurationForCaster("1235391", dk("251", [["47541", 2]]), T0),
    ).toBe(15);
    // no cap is named: the loadout's range has no upper end to print
    expect(buffDurationRangeForCaster("1235391", dk("252", []))).toEqual({
      min: 15,
      max: 15,
    });
  });
});

describe("pipeline T309 — Pillar of Frost under Chosen of Frostbrood", () => {
  // Chosen of Frostbrood 1265633: spec node 110400, entry 136967, two ranks
  const dk = (rank: number, casts: Array<[string, number]>) =>
    ({
      spec: "251",
      info: {
        talents: rank ? [{ id1: 110400, id2: 136967, count: rank }] : [],
        pvpTalents: [],
      },
      spellCastEvents: casts.map(([id, s]) => press(id, s)),
    }) as never;
  const FURY: [string, number] = ["279302", 3];
  const RECAST: [string, number] = ["1265384", 9];
  it("rank 2: 12 s, +4 s per Frostwyrm's Fury, +2 s per recast (90c57b63: 12 / 14 / 16 / 18 s)", () => {
    expect(buffFullDurationForCaster("51271", dk(2, []), T0)).toBe(12);
    expect(buffFullDurationForCaster("51271", dk(2, [RECAST]), T0)).toBe(14);
    expect(buffFullDurationForCaster("51271", dk(2, [FURY]), T0)).toBe(16);
    expect(buffFullDurationForCaster("51271", dk(2, [FURY, RECAST]), T0)).toBe(
      18,
    );
    // the recast at 15 s is inside only because the first press grew it
    expect(
      buffFullDurationForCaster("51271", dk(2, [FURY, ["1265384", 15]]), T0),
    ).toBe(18);
  });
  it("the amount is per purchased rank; without the talent, or past the end, nothing", () => {
    expect(buffFullDurationForCaster("51271", dk(1, [FURY, RECAST]), T0)).toBe(
      15,
    );
    expect(buffFullDurationForCaster("51271", dk(0, [FURY, RECAST]), T0)).toBe(
      12,
    );
    expect(
      buffFullDurationForCaster("51271", dk(2, [["279302", 12.5]]), T0),
    ).toBe(12);
  });
});

describe("pipeline T309 — Combustion under Fired Up and Savor the Moment", () => {
  // Fired Up 1257348: spec node 110423, entry 137035; Savor the Moment
  // 449412: hero node 94650, entry 117253 (talentIdMap)
  const FIRED_UP = { id1: 110423, id2: 137035, count: 1 };
  const SAVOR = { id1: 94650, id2: 117253, count: 1 };
  const row = (ev: LogEvent, id: string, sec: number, amount?: number) => ({
    ...makeAuraEvent(ev, id, T0 + sec * 1000, "mage", "mage", "BUFF"),
    ...(amount !== undefined ? { amount } : {}),
  });
  const mage = (talents: unknown[], auraEvents: unknown[]) =>
    ({
      id: "mage",
      spec: "63",
      info: { talents, pvpTalents: [] },
      spellCastEvents: [],
      auraEvents,
    }) as never;
  const COMBUSTION = row(LogEvent.SPELL_AURA_APPLIED, "190319", 0);
  it("05b762f1: 10 s + 1 s per Fired Up stack gained inside it — three gains, 13 s", () => {
    const u = mage(
      [FIRED_UP],
      [
        COMBUSTION,
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", 2.15),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, "1257350", 5.19, 2),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, "1257350", 6.34, 3),
        // a refresh, a spent stack and a gain past the end add nothing
        row(LogEvent.SPELL_AURA_REFRESH, "1257350", 6.34),
        row(LogEvent.SPELL_AURA_REMOVED_DOSE, "1257350", 10.16, 2),
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", 18.35),
      ],
    );
    expect(buffFullDurationForCaster("190319", u, T0)).toBe(13);
    // without the talent, or without the application's time: 10 s
    expect(
      buffFullDurationForCaster("190319", mage([], [COMBUSTION]), T0),
    ).toBe(10);
    expect(buffFullDurationForCaster("190319", u)).toBe(10);
  });
  it("Savor the Moment: 0.8 s per Spellfire Sphere held at the cast, up to 2.4 s; a gain inside the longer window counts", () => {
    const spheres = (n: number) => [
      row(LogEvent.SPELL_AURA_APPLIED, "448604", -30),
      ...(n >= 2
        ? [row(LogEvent.SPELL_AURA_APPLIED_DOSE, "448604", -20, 2)]
        : []),
      ...(n >= 3
        ? [row(LogEvent.SPELL_AURA_APPLIED_DOSE, "448604", -10, 3)]
        : []),
      // the aura re-sent while up keeps the count
      row(LogEvent.SPELL_AURA_APPLIED, "448604", -5),
      // the cast spends them just after Combustion goes up
      row(LogEvent.SPELL_AURA_REMOVED, "448604", 0.02),
    ];
    const life = (n: number, talents: unknown[], more: unknown[] = []) =>
      buffFullDurationForCaster(
        "190319",
        mage(talents, [...spheres(n), COMBUSTION, ...more]),
        T0,
      );
    expect(life(1, [FIRED_UP, SAVOR])).toBeCloseTo(10.8, 5);
    expect(life(2, [FIRED_UP, SAVOR])).toBeCloseTo(11.6, 5);
    expect(life(3, [FIRED_UP, SAVOR])).toBeCloseTo(12.4, 5);
    // not a holder: the spheres add nothing
    expect(life(3, [FIRED_UP])).toBe(10);
    // a gain at 12 s is inside 12.4 s, and outside the 10 s of a non-holder
    const late = [row(LogEvent.SPELL_AURA_APPLIED, "1257350", 12)];
    expect(life(3, [FIRED_UP, SAVOR], late)).toBeCloseTo(13.4, 5);
    expect(life(3, [FIRED_UP], late)).toBe(10);
  });
  it("spheres removed before the cast (not by it) count for nothing", () => {
    const u = mage(
      [FIRED_UP, SAVOR],
      [
        row(LogEvent.SPELL_AURA_APPLIED, "448604", -30),
        row(LogEvent.SPELL_AURA_REMOVED, "448604", -8),
        COMBUSTION,
      ],
    );
    expect(buffFullDurationForCaster("190319", u, T0)).toBe(10);
  });
});

describe("pipeline T309 — review 85-tk-L5-T309-1", () => {
  const FIRED_UP = { id1: 110423, id2: 137035, count: 1 };
  const SAVOR = { id1: 94650, id2: 117253, count: 1 };
  const row = (
    ev: LogEvent,
    id: string,
    sec: number,
    over: { amount?: number; lineIndex?: number; who?: string } = {},
  ) => {
    const who = over.who ?? "mage";
    const r = makeAuraEvent(ev, id, T0 + sec * 1000, who, who, "BUFF");
    if (over.lineIndex !== undefined) r.logLine.lineIndex = over.lineIndex;
    return {
      ...r,
      ...(over.amount !== undefined ? { amount: over.amount } : {}),
    };
  };
  const mage = (talents: unknown[], auraEvents: unknown[]) =>
    ({
      id: "mage",
      spec: "63",
      info: { talents, pvpTalents: [] },
      spellCastEvents: [],
      auraEvents,
    }) as never;
  it("#1 (30846f8e r1): Fired Up re-listed while up is no gain — two gains, 12 s", () => {
    const u = mage(
      [FIRED_UP],
      [
        row(LogEvent.SPELL_AURA_APPLIED, "190319", 0),
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", 2),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, "1257350", 4, { amount: 2 }),
        row(LogEvent.SPELL_AURA_REMOVED_DOSE, "1257350", 8, { amount: 1 }),
        // the aura re-sent with one stack left
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", 9),
      ],
    );
    expect(buffFullDurationForCaster("190319", u, T0)).toBe(12);
  });
  it("1b (f966f2d1): a Fired Up whose REMOVED the log lost is down after its own 8 s — the next APPLIED is a gain", () => {
    const u = mage(
      [FIRED_UP],
      [
        // an earlier Fired Up, never closed in the log
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", -53),
        row(LogEvent.SPELL_AURA_APPLIED, "190319", 0),
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", 0.319),
      ],
    );
    expect(buffFullDurationForCaster("190319", u, T0)).toBe(11);
  });
  it("1c (f966f2d1 / dac75479): a DOSE row two stacks above the last reading inside Combustion is two gains; above a reading from before it, one", () => {
    const inside = mage(
      [FIRED_UP],
      [
        row(LogEvent.SPELL_AURA_APPLIED, "190319", 0),
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", 1),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, "1257350", 4, { amount: 3 }),
      ],
    );
    expect(buffFullDurationForCaster("190319", inside, T0)).toBe(13);
    const before = mage(
      [FIRED_UP],
      [
        row(LogEvent.SPELL_AURA_APPLIED, "1257350", -3),
        row(LogEvent.SPELL_AURA_APPLIED, "190319", 0),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, "1257350", 2, { amount: 3 }),
      ],
    );
    expect(buffFullDurationForCaster("190319", before, T0)).toBe(11);
  });
  it("#2 (581d783f): the ghoul's Dark Transformation ends where the death knight's does — coils after it add nothing", () => {
    const dk = {
      id: "dk",
      spec: "252",
      info: { talents: [{ id1: 76185, id2: 96322, count: 1 }], pvpTalents: [] },
      spellCastEvents: [2, 5, 8, 9, 10].map((sec) => press("1242174", sec)),
      // its own copy, removed at 7.388 s; the ghoul's aura is on the pet
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, "1235391", 0, { who: "dk" }),
        row(LogEvent.SPELL_AURA_REMOVED, "1235391", 7.388, { who: "dk" }),
      ],
    } as never;
    expect(buffFullDurationForCaster("1235391", dk, T0)).toBe(17);
    expect(buffFullDurationForCaster("1233448", dk, T0)).toBe(17);
  });
  it("#3: Savor the Moment alone lengthens the cast; Fired Up's gains need Fired Up", () => {
    const rows = [
      row(LogEvent.SPELL_AURA_APPLIED, "448604", -30),
      row(LogEvent.SPELL_AURA_APPLIED_DOSE, "448604", -20, { amount: 3 }),
      row(LogEvent.SPELL_AURA_APPLIED, "190319", 0),
      row(LogEvent.SPELL_AURA_APPLIED, "1257350", 3),
    ];
    expect(
      buffFullDurationForCaster("190319", mage([SAVOR], rows), T0),
    ).toBeCloseTo(12.4, 5);
    expect(
      buffFullDurationForCaster("190319", mage([FIRED_UP, SAVOR], rows), T0),
    ).toBeCloseTo(13.4, 5);
  });
  it("#4: in Combustion's own milliseconds the log line decides — a gain before its APPLIED or after its REMOVED adds nothing, a sphere applied just before it counts", () => {
    const life = (talents: unknown[], rows: unknown[]) =>
      buffFullDurationForCaster("190319", mage(talents, rows), T0);
    const up = row(LogEvent.SPELL_AURA_APPLIED, "190319", 0, {
      lineIndex: 100,
    });
    const off = row(LogEvent.SPELL_AURA_REMOVED, "190319", 10, {
      lineIndex: 200,
    });
    const gain = (sec: number, lineIndex: number) =>
      row(LogEvent.SPELL_AURA_APPLIED, "1257350", sec, { lineIndex });
    expect(life([FIRED_UP], [gain(0, 99), up, off])).toBe(10);
    expect(life([FIRED_UP], [up, gain(0, 101), off])).toBe(11);
    expect(life([FIRED_UP], [up, gain(10, 199), off])).toBe(11);
    expect(life([FIRED_UP], [up, off, gain(10, 201)])).toBe(10);
    const sphere = row(LogEvent.SPELL_AURA_APPLIED, "448604", 0, {
      lineIndex: 99,
    });
    expect(life([SAVOR], [sphere, up, off])).toBeCloseTo(10.8, 5);
  });
});
