/**
 * Pipeline T219 (round-14 D41, e7a3569f r0 0:39): the BUFF / DEBUFF marker
 * of a SPELL_AURA_BROKEN_SPELL row sits after the breaking spell's triple
 * (parameter 14), not at parameter 11. Read at 11, every such row had "no
 * marker", and a debuff its holder broke out of counted as the holder's own
 * purgeable buff.
 */
import { SLIM_PARAMS_KEEP } from "@gladlog/parser";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  AURA_MARKER_PARAM,
  AURA_MARKER_PARAM_BROKEN_SPELL,
  getAuraType,
  purgeableBuffCountAt,
  purgeableBuffIntervals,
} from "../src/utils/dispelAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const row = (event: string, params: Record<number, string>) => {
  const parameters: string[] = [];
  for (const [k, v] of Object.entries(params)) parameters[Number(k)] = v;
  return { logLine: { event, parameters } };
};

describe("getAuraType(光环行的 BUFF / DEBUFF 标记)", () => {
  it("APPLIED / REMOVED / BROKEN:法术三元组之后(参数 11)", () => {
    expect(AURA_MARKER_PARAM).toBe(11);
    for (const e of [
      LogEvent.SPELL_AURA_APPLIED,
      LogEvent.SPELL_AURA_REMOVED,
      LogEvent.SPELL_AURA_BROKEN,
    ])
      expect(getAuraType(row(e, { 8: "122", 11: "DEBUFF" }))).toBe("DEBUFF");
  });

  it("BROKEN_SPELL:打破它的法术三元组占 11–13,标记在 14", () => {
    expect(AURA_MARKER_PARAM_BROKEN_SPELL).toBe(14);
    // 122 Frost Nova broken by 100784 Blackout Kick
    const broken = row(LogEvent.SPELL_AURA_BROKEN_SPELL, {
      8: "122",
      9: "Frost Nova",
      10: "0x10",
      11: "100784",
      12: "Blackout Kick",
      13: "0x1",
      14: "DEBUFF",
    });
    expect(getAuraType(broken)).toBe("DEBUFF");
  });

  it("生产路径:参数被裁到 0–12(SLIM_PARAMS_KEEP),BROKEN_SPELL 读解析器解出的 auraType", () => {
    expect(SLIM_PARAMS_KEEP).toBe(13);
    const slim = {
      auraType: "DEBUFF",
      logLine: {
        event: LogEvent.SPELL_AURA_BROKEN_SPELL,
        parameters: ["", "", "0x548", "", "", "", "0x548", "", "", "", "0x10", 1287955, "x"],
      },
    };
    expect(slim.logLine.parameters).toHaveLength(SLIM_PARAMS_KEEP);
    expect(getAuraType(slim)).toBe("DEBUFF");
    // 别的事件不读 auraType(解析器把没有标记的行默认成 BUFF)
    expect(
      getAuraType({
        auraType: "BUFF",
        logLine: { event: LogEvent.SPELL_AURA_APPLIED, parameters: [] },
      }),
    ).toBe(null);
  });

  it("没有标记的行仍然是 null(旧夹具)", () => {
    expect(getAuraType(row(LogEvent.SPELL_AURA_APPLIED, { 8: "122" }))).toBe(
      null,
    );
    expect(
      getAuraType(
        row(LogEvent.SPELL_AURA_BROKEN_SPELL, { 8: "122", 11: "100784" }),
      ),
    ).toBe(null);
  });
});

describe("T219 — 自己打破的减益不算自己身上可驱散的增益", () => {
  it("e7a3569f r0: 我方 Frost Nova 被武僧自己打破的那一行不进 purgeableBuffIntervals", () => {
    // Power Word: Fortitude 21562 (Magic buff) up the whole time; Frost Nova
    // 122 (Magic, our mage's) applied at 44.047, broken by the monk at 44.687
    const monk = makeUnit("monk", {
      name: "Monk",
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "21562",
          T0 + 1_000,
          "priest",
          "monk",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "122",
          T0 + 44_047,
          "mage",
          "monk",
          "DEBUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_BROKEN_SPELL,
          "122",
          T0 + 44_687,
          "monk",
          "monk",
          "DEBUFF",
        ),
      ],
    });
    const ivs = purgeableBuffIntervals(monk, new Set(["monk", "priest"]), {
      startTime: T0,
      endTime: T0 + 120_000,
    });
    expect(ivs.map((iv) => iv.spellId)).toEqual(["21562"]);
    expect(purgeableBuffCountAt(ivs, 39.26)).toBe(1);
    expect(purgeableBuffCountAt(ivs, 44.5)).toBe(1);
  });
});
