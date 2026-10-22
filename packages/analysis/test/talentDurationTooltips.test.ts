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
