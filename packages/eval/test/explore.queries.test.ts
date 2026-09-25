// packages/eval/test/explore.queries.test.ts
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  cdAvailableAt,
  cdSecondsUntilReady,
  ensureAnalysisData,
  type IMajorCooldownInfo,
  parseRawStreams,
  roundDurationSOf,
} from "@gladlog/analysis";
import { describe, expect, it } from "vitest";

import { runQuery } from "../src/explore/matchExplore";
import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  readRawText,
  splitTeams,
} from "../src/explore/storeAccess";

const emptyLegacy = {
  startTime: 1_000_000,
  endTime: 1_180_000,
  startInfo: { zoneId: "1672" },
  units: {},
} as any;

// #25-1 守护注:cd 台账渲染面对转伤类外置(Blessing of Sacrifice)必须经
// selfCastNoopAnnotatedName 取名 —— 裸 "ready: Blessing of Sacrifice" 在死者
// 本人行会被读成「可自救」(评审实证 60ab1e8f @8:25)。与 momentSnapshot
// cd-ledger 共用同一助手(单源谓词);此处钉 cdLines 这一侧。
const bosLegacy = {
  startTime: 1_000_000,
  endTime: 1_400_000,
  startInfo: { zoneId: "1672" },
  units: {
    p1: {
      id: "p1",
      name: "Pally-Area52",
      info: { specId: "65" },
      spec: "65",
      class: 2, // CombatUnitClass.Paladin
      reaction: 1,
      advancedActions: [],
      damageOut: [],
      damageIn: [],
      healOut: [],
      healIn: [],
      absorbsOut: [],
      absorbsIn: [],
      auraEvents: [],
      castStartEvents: [],
      deathRecords: [],
      spellCastEvents: [
        {
          logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 1_010_000, parameters: [] },
          timestamp: 1_010_000,
          spellId: "6940",
          spellName: "Blessing of Sacrifice",
        },
        {
          logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 1_015_000, parameters: [] },
          timestamp: 1_015_000,
          spellId: "642",
          spellName: "Divine Shield",
        },
      ],
    },
  },
} as any;

describe("cdLines 守护注:转伤类外置不得以裸名入台账(#25-1)", () => {
  it("onCd 侧带注、圣盾裸名;ready 侧转好后同样带注", () => {
    const early = runQuery(bosLegacy, ["cd", "--t", "20"]).join("\n");
    expect(early).toContain("Blessing of Sacrifice(仅可施于队友,不可自保)(还剩");
    expect(early).toContain("Divine Shield(还剩");
    expect(early).not.toContain("Divine Shield(仅可施于队友");
    const late = runQuery(bosLegacy, ["cd", "--t", "380"]).join("\n");
    const readyPart = late.split(" | onCd:")[0];
    expect(readyPart).toContain("Blessing of Sacrifice(仅可施于队友,不可自保)");
  });
});

describe("runQuery dispatch", () => {
  it("rejects unknown subcommand with usage", () => {
    expect(() => runQuery(emptyLegacy, ["nope"])).toThrow(/usage/);
  });
  it("requires --t for cd", () => {
    expect(() => runQuery(emptyLegacy, ["cd"])).toThrow(/usage/);
  });
  it("floors fractional seconds to the render grid", () => {
    // 空对局也要输出表头行,且表头时刻是 floor 后的渲染秒
    const lines = runQuery(emptyLegacy, ["cd", "--t", "93.9"]);
    expect(lines[0]).toContain("1:33"); // fmtTime(93), not 1:34
  });
});

// "还剩 Ns" is the shared cdSecondsUntilReady since GH #106 step 3 (it used to
// be a hand-copy here); keep the sign/arithmetic pins on the shared function.
describe("cdSecondsUntilReady parity with cdAvailableAt", () => {
  const cd: Pick<
    IMajorCooldownInfo,
    "casts" | "cooldownSeconds" | "neverUsed"
  > = {
    casts: [{ timeSeconds: 10 }],
    cooldownSeconds: 120,
    neverUsed: false,
  };

  it("is 0 exactly when cdAvailableAt says ready, across before/at/mid/expiry/after", () => {
    for (const t of [5, 10, 70, 129.4, 129.6, 130, 131, 200]) {
      expect(cdSecondsUntilReady(cd, t) === 0).toBe(cdAvailableAt(cd, t));
    }
  });

  it("agrees with cdAvailableAt for the neverUsed case (always available)", () => {
    const neverUsed: Pick<
      IMajorCooldownInfo,
      "casts" | "cooldownSeconds" | "neverUsed"
    > = { casts: [], cooldownSeconds: 60, neverUsed: true };
    for (const t of [0, 30, 1000]) {
      expect(cdSecondsUntilReady(neverUsed, t)).toBe(0);
      expect(cdAvailableAt(neverUsed, t)).toBe(true);
    }
  });

  it("pins exact 还剩 Ns arithmetic, not just its sign", () => {
    // cast at t=10, 120s cd → at t=70, 60s remain.
    expect(cdSecondsUntilReady(cd, 70)).toBe(60);
    const shortCd: Pick<
      IMajorCooldownInfo,
      "casts" | "cooldownSeconds" | "neverUsed"
    > = { casts: [{ timeSeconds: 0 }], cooldownSeconds: 30, neverUsed: false };
    // cast at t=0, 30s cd → at t=10, 20s remain.
    expect(cdSecondsUntilReady(shortCd, 10)).toBe(20);
  });
});

const hasLibrary = existsSync(join(DEFAULT_MATCH_DIR, "_index.ndjson"));

describe.skipIf(!hasLibrary)("runQuery against real library", () => {
  it("all 11 subcommands run clean on a real >120s round (mana/drink exercise the real raw.txt path via readRawText+parseRawStreams, same as the CLI shell)", async () => {
    await ensureAnalysisData();
    const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 121 });
    expect(rows.length).toBeGreaterThan(0);
    const { legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, rows[0].id);
    const fromS = 10;
    const toS = 100;
    const midT = 60;

    // Same load path scripts/matchExplore.ts's CLI shell uses for `mana`/
    // `drink`: readRawText (matchesDir-relative, null on missing/unreadable)
    // + parseRawStreams(text, legacy.startTime, roundDurationSOf(...)) — the
    // 3rd arg via the same single-sourced helper the CLI shell derives it
    // with (BACKLOG #26 final review §2.d.2/(iv); BACKLOG #32's "no caller
    // in this codebase currently omits it" only holds if this real-library
    // smoke passes it too). Real raw.txt may or may not be present for
    // whichever match `pickRows` happens to surface first — either way
    // `parseRawStreams` degrades gracefully (available:false), so the smoke
    // assertions below hold regardless; a second assertion further down
    // additionally exercises the real-data branch WHEN raw.txt is actually
    // present for this row.
    const rawText = readRawText(DEFAULT_MATCH_DIR, rows[0].id);
    const rawStreams = parseRawStreams(
      rawText,
      legacy.startTime,
      roundDurationSOf(legacy.startTime, legacy.endTime),
    );
    const { friends } = splitTeams(legacy);
    const unitName = friends[0]?.name ?? "";

    const cases: string[][] = [
      ["overview"],
      ["cd", "--t", String(midT)],
      ["hp", "--t", String(midT)],
      ["hpcurve", "--from", String(fromS), "--to", String(toS), "--step", "10"],
      ["auras", "--t", String(midT)],
      ["pos", "--t", String(midT)],
      ["dr", "--from", String(fromS), "--to", String(toS)],
      ["flow", "--from", String(fromS), "--to", String(toS)],
      ["gaps"],
      [
        "mana",
        "--unit",
        unitName,
        "--from",
        String(fromS),
        "--to",
        String(toS),
      ],
      ["drink"],
    ];

    for (const argv of cases) {
      const lines = runQuery(legacy, argv, rawStreams);
      expect(lines.length).toBeGreaterThanOrEqual(1);
    }

    const posOut = runQuery(legacy, ["pos", "--t", String(midT)], rawStreams);
    // "(无数据)" is a legitimate sole result, not a malformed line: posLines
    // needs the OWNER interpolated at exactly `midT` within INTERP_MAX_GAP_MS,
    // and whichever round pickRows surfaces first may have a position gap
    // there (2026-08-22: the library grew and row 0 became 0266d177, whose
    // owner's nearest positioned event to t=60s is 1.9s away — every other
    // unit has one at 0.0s, so this is the gap rule working, not missing
    // data). Assert the shape of DATA lines, and that no-data stands alone.
    const posBody = posOut.slice(1);
    if (posBody.length === 1 && posBody[0] === "(无数据)") {
      expect(posBody[0]).toBe("(无数据)");
    } else {
      for (const line of posBody) expect(line).toMatch(/dist [\d.]+yd|未知/);
    }

    if (rawStreams.available) {
      // Real raw.txt was present for this row — confirm `mana` actually
      // walked it (didn't silently fall back to the NO_RAW line) so this
      // test is a real exercise of the raw-parsing path, not just a
      // graceful-degradation no-op.
      const manaOut = runQuery(
        legacy,
        [
          "mana",
          "--unit",
          unitName,
          "--from",
          String(fromS),
          "--to",
          String(toS),
        ],
        rawStreams,
      );
      expect(manaOut.some((l) => l.includes("raw.txt"))).toBe(false);
    }
  });
});
