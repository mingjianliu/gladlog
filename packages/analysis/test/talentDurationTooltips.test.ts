/** GH #155 (2026-10-21): the product rows of tooltip-stated duration
 * extensions stay what the talent tooltips say, and the duration predicate
 * prices them. */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { BUFF_DURATION_TALENT_MODIFIERS } from "../src/data/spellEffectData";
import {
  TOOLTIP_DURATION_ROWS,
  TOOLTIP_PER_EVENT_DURATIONS,
} from "../src/data/talentDurationTooltips";
import generated from "../src/data/talentDurationTooltipsGenerated.json";
import {
  buffDurationRangeForCaster,
  buffFullDurationForCaster,
} from "../src/utils/buffDuration";

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
      const [e] = entriesOf(p.talentSpellId, aura).filter(
        (x) => x.kind === "per-event",
      );
      expect(e).toMatchObject({
        amount: p.addSecondsPerEvent,
        cap: p.capSeconds,
      });
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
      AT + 300_000,
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
