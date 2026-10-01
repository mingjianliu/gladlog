// packages/eval/test/explore.manaDrink.test.ts
/**
 * TDD fixture for `mana`/`drink` (BACKLOG #26 Task 5) — the two matchExplore
 * subcommands that consume Task 1's rawStreams predicates
 * (`parseRawStreams`/`manaAt`/`oomWindows`/`castFailedInWindow`/
 * `drinkingSegments`). Line shapes mirror `packages/analysis/test/
 * rawStreams.test.ts`'s real-raw.txt-anchored fixture helpers (same
 * `SPELL_CAST_SUCCESS`/`SPELL_CAST_FAILED` field layout), not a bespoke
 * format — a divergent fixture shape here would test nothing real.
 *
 * Fields asserted are the CONTENT a reviewer would cross-check (times,
 * mana values, reject reasons, interruption verdicts), not the exact
 * rendered string — per the task brief, "assert key output fields, not
 * exact formatting strings".
 */
import {
  parseRawStreams,
  parseRawTimestamp,
  type RawStreams,
} from "@gladlog/analysis";
import {
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { drinkLines, manaLines, runQuery } from "../src/explore/matchExplore";
import type { LegacyRound } from "../src/explore/storeAccess";

// A real CombatUnitSpec healer value (not a placeholder string) — drinkLines
// filters healers via `isHealerSpec`, which reads the real enum, so the
// fixture must too.
const HEALER_SPEC = CombatUnitSpec.Paladin_Holy;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function unit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: overrides.id ?? "u1",
    name: overrides.name ?? "Unit-Realm-US",
    reaction: overrides.reaction ?? CombatUnitReaction.Friendly,
    info: overrides.info ?? ({} as never),
    class: overrides.class ?? ("Priest" as never),
    spec: overrides.spec ?? (undefined as never),
    advancedActions: overrides.advancedActions ?? [],
    damageIn: overrides.damageIn ?? [],
    auraEvents: overrides.auraEvents ?? [],
    spellCastEvents: overrides.spellCastEvents ?? [],
    deathRecords: overrides.deathRecords ?? [],
    ...overrides,
  } as unknown as ICombatUnit;
}

function legacyOf(
  units: ICombatUnit[],
  opts?: { startTime?: number; endTime?: number },
): LegacyRound {
  const byId: Record<string, ICombatUnit> = {};
  for (const u of units) byId[u.id] = u;
  return {
    units: byId,
    playerId: units[0]?.id,
    startTime: opts?.startTime ?? BASE_MS,
    endTime: opts?.endTime ?? BASE_MS + 30_000,
  } as unknown as LegacyRound;
}

// Real match 60ab1e8f's real Holy Paladin healer/Holy Shock shape (same
// fixture helpers as rawStreams.test.ts) — GUIDs below are the test's own,
// not the real match's, but the line SHAPE is copied field-for-field.
const HEALER_GUID = "Player-57-0E0CB0B6";
const HEALER_NAME = "Minilay-Illidan-US";
const ENEMY_HEALER_GUID = "Player-11-0EAEB10E";
const ENEMY_HEALER_NAME = "Enemyheal-Tichondrius-US";

function castSuccessLine(
  ts: string,
  actorGuid: string,
  actorName: string,
  mana: number,
  manaMax: number,
): string {
  return `7/19/2026 ${ts}-4  SPELL_CAST_SUCCESS,${actorGuid},"${actorName}",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,20473,"神圣震击",0x2,${actorGuid},0000000000000000,612340,612340,3012,2896,2605,2385,0,0,0,${mana},${manaMax},0,1278.80,1721.48,0,4.8195,298`;
}

function castFailedLine(
  ts: string,
  actorGuid: string,
  actorName: string,
  reason: string,
): string {
  return `7/19/2026 ${ts}-4  SPELL_CAST_FAILED,${actorGuid},"${actorName}",0x10511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,20473,"神圣震击",0x2,"${reason}"`;
}

// The round's own startTime, computed via the SAME `parseRawTimestamp` the
// fixture lines below are parsed with — anchored at "04:10:00.000-4" so
// every line's `ts` argument below (e.g. "04:10:10.200") IS its render-grid
// offset in seconds from round start (10.2s), no separate epoch-math
// required.
const BASE_MS = parseRawTimestamp("7/19/2026 04:10:00.000-4")!;

// ---------------------------------------------------------------------------
// manaLines
// ---------------------------------------------------------------------------

describe("manaLines", () => {
  const healer = unit({
    id: HEALER_GUID,
    name: HEALER_NAME,
    reaction: CombatUnitReaction.Friendly,
  });
  const legacy = legacyOf([healer]);

  // Trajectory (manaMax 20000, MANA_PRESSURE_LOW_PCT threshold = 2000):
  // t10 15000 -> t12 10000 (falling) -> t14 12000 (rising, reverses at t12)
  // -> t16 3000 (falling) -> t18 1500 (still falling, below OOM threshold)
  // -> t20 4000 (rising, reverses at t18). 6 raw samples, 5 turning/endpoint
  // key points (t16's 3000 is a pure midpoint of the t14->t18 decline and
  // must be dropped by decimation).
  const raw = [
    castSuccessLine("04:10:10.200", HEALER_GUID, HEALER_NAME, 15000, 20000),
    castSuccessLine("04:10:12.400", HEALER_GUID, HEALER_NAME, 10000, 20000),
    castSuccessLine("04:10:14.600", HEALER_GUID, HEALER_NAME, 12000, 20000),
    castSuccessLine("04:10:16.800", HEALER_GUID, HEALER_NAME, 3000, 20000),
    castSuccessLine("04:10:18.100", HEALER_GUID, HEALER_NAME, 1500, 20000),
    castFailedLine("04:10:13.000", HEALER_GUID, HEALER_NAME, "尚未恢复"),
    castFailedLine("04:10:19.500", HEALER_GUID, HEALER_NAME, "法力值不足"),
    castSuccessLine("04:10:20.300", HEALER_GUID, HEALER_NAME, 4000, 20000),
  ].join("\n");
  const streams = parseRawStreams(raw, BASE_MS);

  it("decimates the trajectory to turning points + endpoints, dropping the pure-midpoint sample", () => {
    const lines = manaLines(legacy, streams, HEALER_NAME, 10, 21);
    const header = lines[0]!;
    expect(header).toContain(HEALER_NAME);

    const keyPointLines = lines.filter((l) => / mana \d+\/\d+$/.test(l));
    expect(keyPointLines).toHaveLength(5);
    const values = keyPointLines.map((l) =>
      l.match(/ mana (\d+)\/(\d+)$/)!.slice(1, 3),
    );
    expect(values).toEqual([
      ["15000", "20000"],
      ["10000", "20000"],
      ["12000", "20000"],
      ["1500", "20000"],
      ["4000", "20000"],
    ]);
    // the pure-midpoint decline sample (3000, at t16) never appears.
    expect(lines.some((l) => l.includes("3000/20000"))).toBe(false);
  });

  it("walks the product's mana series: advanced samples past the last cast are in the trajectory (triage other F-OT)", () => {
    // the raw pass only sees cast lines (last cast 20.3 s); the unit's own
    // advanced samples — heal ticks, damage taken — carry mana to 29 s
    const adv = (s: number, mana: number) => ({
      advancedActorId: HEALER_GUID,
      advancedActorPowers: [{ type: 0, current: mana, max: 20000 }],
      advancedActorCurrentHp: 1,
      advancedActorMaxHp: 1,
      logLine: { timestamp: BASE_MS + s * 1000, parameters: [] },
      timestamp: BASE_MS + s * 1000,
    });
    const sampled = unit({
      id: HEALER_GUID,
      name: HEALER_NAME,
      reaction: CombatUnitReaction.Friendly,
      advancedActions: [
        adv(10.2, 15000),
        adv(20.3, 4000),
        adv(29, 900),
      ] as never,
    });
    const lines = manaLines(legacyOf([sampled]), streams, HEALER_NAME, 10, 30);
    expect(
      lines.some((l) => l.includes("终局蓝量") && l.includes("900/20000")),
    ).toBe(true);
    expect(
      lines.some((l) => l.includes("0:29") && l.includes("900/20000")),
    ).toBe(true);
    // and the OOM window now reaches that sample (900 / 20000 < threshold)
    expect(lines.some((l) => l.includes("窗内最低蓝 900"))).toBe(true);
  });

  it("reports the terminal mana reading at --to via manaAt (60ab-style headline stat)", () => {
    const lines = manaLines(legacy, streams, HEALER_NAME, 10, 21);
    expect(
      lines.some((l) => l.includes("终局蓝量") && l.includes("4000/20000")),
    ).toBe(true);
  });

  it("surfaces the below-threshold run as an OOM window (MANA_PRESSURE_LOW_PCT, single-sourced)", () => {
    const lines = manaLines(legacy, streams, HEALER_NAME, 10, 21);
    const oomLine = lines.find((l) => l.includes("窗内最低蓝"));
    expect(oomLine).toBeDefined();
    expect(oomLine).toContain("1500");
  });

  it("lists rejected casts (time/spell/reason) inside the window", () => {
    const lines = manaLines(legacy, streams, HEALER_NAME, 10, 21);
    expect(
      lines.some((l) => l.includes("神圣震击") && l.includes("尚未恢复")),
    ).toBe(true);
    expect(
      lines.some((l) => l.includes("神圣震击") && l.includes("法力值不足")),
    ).toBe(true);
  });

  it("defaults --from/--to to the whole round when omitted", () => {
    const lines = manaLines(legacy, streams, HEALER_NAME, undefined, undefined);
    // round spans [0, 30) — every sample above (t10..t20) falls inside it.
    const keyPointLines = lines.filter((l) => / mana \d+\/\d+$/.test(l));
    expect(keyPointLines.length).toBeGreaterThan(0);
  });

  it("resolves --unit by exact name, then by case-insensitive substring", () => {
    expect(() => manaLines(legacy, streams, HEALER_NAME, 10, 21)).not.toThrow();
    expect(() => manaLines(legacy, streams, "minilay", 10, 20)).not.toThrow();
  });

  it("throws for an unresolvable --unit (usage-style error, not a silent wrong pick)", () => {
    expect(() => manaLines(legacy, streams, "NoSuchUnit", 10, 20)).toThrow();
  });

  it("degrades to a NO_RAW line (never throws) when rawStreams is unavailable/undefined", () => {
    const unavailable: RawStreams = {
      available: false,
      manaSamples: [],
      castFailed: [],
    };
    for (const rs of [unavailable, undefined]) {
      const lines = manaLines(legacy, rs, HEALER_NAME, 10, 21);
      expect(lines.some((l) => l.includes("raw.txt"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// drinkLines
// ---------------------------------------------------------------------------

describe("drinkLines", () => {
  it("lists a drinking segment per healer with render-grid start/end + mana gained + interrupted flag", () => {
    const raw = [
      castSuccessLine("04:10:05.000", HEALER_GUID, HEALER_NAME, 2000, 20000),
      castSuccessLine("04:10:08.000", HEALER_GUID, HEALER_NAME, 6000, 20000),
      castSuccessLine("04:10:11.000", HEALER_GUID, HEALER_NAME, 10000, 20000),
      castSuccessLine("04:10:14.000", HEALER_GUID, HEALER_NAME, 9500, 20000), // falling — closes the segment at t11
      castSuccessLine(
        "04:10:05.000",
        ENEMY_HEALER_GUID,
        ENEMY_HEALER_NAME,
        3000,
        20000,
      ),
      castSuccessLine(
        "04:10:09.000",
        ENEMY_HEALER_GUID,
        ENEMY_HEALER_NAME,
        7000,
        20000,
      ),
      castSuccessLine(
        "04:10:13.000",
        ENEMY_HEALER_GUID,
        ENEMY_HEALER_NAME,
        8000,
        20000,
      ), // falling — closes the segment at t9
    ].join("\n");
    const streams = parseRawStreams(raw, BASE_MS);

    const legacy = legacyOf([
      unit({
        id: HEALER_GUID,
        name: HEALER_NAME,
        reaction: CombatUnitReaction.Friendly,
        spec: HEALER_SPEC,
        damageIn: [{ timestamp: BASE_MS + 11_500 } as never],
      }),
      unit({
        id: ENEMY_HEALER_GUID,
        name: ENEMY_HEALER_NAME,
        reaction: CombatUnitReaction.Hostile,
        spec: HEALER_SPEC,
        damageIn: [],
      }),
    ]);

    const lines = drinkLines(legacy, streams);
    expect(lines.join("\n")).toContain(HEALER_NAME);
    expect(lines.join("\n")).toContain(ENEMY_HEALER_NAME);

    const friendlyRow = lines.find((l) => l.includes("回蓝 8000"));
    expect(friendlyRow).toBeDefined();
    expect(friendlyRow).toContain("被伤害打断:是");

    const enemyRow = lines.find((l) => l.includes("回蓝 5000"));
    expect(enemyRow).toBeDefined();
    expect(enemyRow).toContain("被伤害打断:否");
  });

  it("degrades to a NO_RAW line (never throws) when rawStreams is unavailable", () => {
    const legacy = legacyOf([
      unit({
        id: HEALER_GUID,
        reaction: CombatUnitReaction.Friendly,
        spec: HEALER_SPEC,
      }),
    ]);
    const unavailable: RawStreams = {
      available: false,
      manaSamples: [],
      castFailed: [],
    };
    const lines = drinkLines(legacy, unavailable);
    expect(lines.some((l) => l.includes("raw.txt"))).toBe(true);
  });

  it("reports NO_DATA (not NO_RAW) when raw.txt IS available but has zero drinking segments", () => {
    const legacy = legacyOf([
      unit({
        id: HEALER_GUID,
        reaction: CombatUnitReaction.Friendly,
        spec: HEALER_SPEC,
      }),
    ]);
    // Non-empty but nothing but a malformed line (parseRawStreams.available
    // only checks non-empty rawText — see rawStreams.test.ts's own "skips a
    // malformed line" case) — available:true, zero samples.
    const streams = parseRawStreams(
      "this is not a combat log line at all",
      BASE_MS,
    );
    const lines = drinkLines(legacy, streams);
    expect(lines).toEqual(["## drink", "(无数据)"]);
  });

  // Review fix round 1 (2026-08-15, Important #1): sort by manaGained
  // descending + --min-gain, so a rare genuine drink isn't buried among many
  // small in-combat regen ticks. Three segments, deliberately created in
  // CHRONOLOGICAL order 500 → 8300 → 16000 (ascending) — if `drinkLines`
  // only preserved raw/chronological order, the printed order would still
  // read 500,8300,16000; only an actual descending sort flips it to
  // 16000,8300,500, which is what these assertions require.
  describe("descending sort + --min-gain (review fix round 1)", () => {
    const raw = [
      castSuccessLine("04:10:00.000", HEALER_GUID, HEALER_NAME, 1000, 30000),
      castSuccessLine("04:10:02.000", HEALER_GUID, HEALER_NAME, 1500, 30000), // segment A closes: gained 500
      castSuccessLine("04:10:03.000", HEALER_GUID, HEALER_NAME, 1200, 30000),
      castSuccessLine("04:10:05.000", HEALER_GUID, HEALER_NAME, 1200, 30000), // flat, not a rise
      castSuccessLine("04:10:07.000", HEALER_GUID, HEALER_NAME, 9000, 30000),
      castSuccessLine("04:10:09.000", HEALER_GUID, HEALER_NAME, 9500, 30000), // segment B closes: gained 8300
      castSuccessLine("04:10:10.000", HEALER_GUID, HEALER_NAME, 9000, 30000),
      castSuccessLine("04:10:12.000", HEALER_GUID, HEALER_NAME, 9000, 30000), // flat, not a rise
      castSuccessLine("04:10:14.000", HEALER_GUID, HEALER_NAME, 9300, 30000),
      castSuccessLine("04:10:15.000", HEALER_GUID, HEALER_NAME, 25000, 30000), // segment C closes: gained 16000 (the real drink)
      castSuccessLine("04:10:17.000", HEALER_GUID, HEALER_NAME, 24500, 30000),
    ].join("\n");
    const streams = parseRawStreams(raw, BASE_MS);
    const legacy = legacyOf([
      unit({
        id: HEALER_GUID,
        name: HEALER_NAME,
        reaction: CombatUnitReaction.Friendly,
        spec: HEALER_SPEC,
        damageIn: [],
      }),
    ]);

    it("prints segments sorted by manaGained descending by default (min-gain 0)", () => {
      const lines = drinkLines(legacy, streams);
      const gains = lines
        .filter((l) => l.startsWith("0:"))
        .map((l) => Number(l.match(/回蓝 (\d+)/)![1]));
      expect(gains).toEqual([16000, 8300, 500]);
    });

    it("--min-gain filters out segments below the threshold, keeping descending order", () => {
      const lines = drinkLines(legacy, streams, 1000);
      const gains = lines
        .filter((l) => l.startsWith("0:"))
        .map((l) => Number(l.match(/回蓝 (\d+)/)![1]));
      expect(gains).toEqual([16000, 8300]); // the 500 segment is dropped
    });

    it("runQuery wires --min-gain through to drinkLines", () => {
      const lines = runQuery(legacy, ["drink", "--min-gain", "9000"], streams);
      const gains = lines
        .filter((l) => l.startsWith("0:"))
        .map((l) => Number(l.match(/回蓝 (\d+)/)![1]));
      expect(gains).toEqual([16000]); // only the real drink clears 9000
    });
  });
});

// ---------------------------------------------------------------------------
// runQuery dispatch wiring (BACKLOG #26 Task 5)
// ---------------------------------------------------------------------------

describe("runQuery dispatch — mana/drink", () => {
  const healer = unit({
    id: HEALER_GUID,
    name: HEALER_NAME,
    reaction: CombatUnitReaction.Friendly,
  });
  const legacy = legacyOf([healer]);
  const raw = [
    castSuccessLine("04:10:10.000", HEALER_GUID, HEALER_NAME, 5000, 20000),
  ].join("\n");
  const streams = parseRawStreams(raw, BASE_MS);

  it("requires --unit for mana", () => {
    expect(() => runQuery(legacy, ["mana"], streams)).toThrow(/usage/);
  });

  it("dispatches mana --unit X to manaLines, passing rawStreams through", () => {
    const lines = runQuery(legacy, ["mana", "--unit", HEALER_NAME], streams);
    expect(lines[0]).toContain(HEALER_NAME);
    expect(lines.some((l) => l.includes("5000/20000"))).toBe(true);
  });

  it("dispatches drink with no required flags", () => {
    const lines = runQuery(legacy, ["drink"], streams);
    expect(lines[0]).toBe("## drink");
  });

  it("mana/drink degrade gracefully (no throw) when rawStreams is omitted entirely", () => {
    expect(() =>
      runQuery(legacy, ["mana", "--unit", HEALER_NAME]),
    ).not.toThrow();
    expect(() => runQuery(legacy, ["drink"])).not.toThrow();
  });
});
