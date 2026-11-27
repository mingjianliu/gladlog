/**
 * Pipeline T268: 12.1.5 went live on NA realms 2026-10-13 and on EU realms
 * 10-14. An EU log stated after the NA go-live and before 10-15 00:00 UTC
 * reads the go-live's band side (`PATCH_1215_REGION_BANDS`, user ruling
 * 2026-11-27: the whole of EU's 10-14 is the band) — every reader of the
 * cutover alike, since the band is keyed by the cutover instant.
 * acc115f2 (EU, 10-13 23:30 UTC): its Holy Priest, read with the 12.1.5
 * talent map as an Ultimate Serenity holder, pressed Holy Word: Sanctify 11
 * times — a 12.1.0 log.
 */
import { describe, expect, it } from "vitest";

import { AURA_PRESS_BY_ERA } from "../src/utils/auraActivationEra";
import {
  logDatedAt,
  logInstantOf,
  PATCH_1215_GOLIVE_EPOCH_MS,
  PATCH_1215_REGION_BANDS,
  PATCH_1215_ZONE_BAND_TAKES,
} from "../src/utils/logEra";
import { OVERRIDE_VARIANT_SHARES_BY_ERA } from "../src/utils/overrideVariantEra";
import { talentsOf } from "../src/utils/talents";

const ACC115F2_START = Date.UTC(2026, 9, 13, 23, 30, 28);
const EU_BAND_END = Date.UTC(2026, 9, 15, 0, 0, 0);
const rule = {
  cutoverEpochMs: PATCH_1215_GOLIVE_EPOCH_MS,
  before: "12.1.0",
  since: "12.1.5",
  zoneBandTakes: PATCH_1215_ZONE_BAND_TAKES,
};

describe("12.1.5 分地区上线:欧服 10-14 整天走不确定带", () => {
  it("带的终点是 10-15 00:00 UTC", () => {
    expect(PATCH_1215_REGION_BANDS).toEqual({ EU: EU_BAND_END });
  });

  it("同一时刻:欧服读 before,美服读 since,没有地区的照旧", () => {
    const at = (region?: string) =>
      logInstantOf({ logClockOffsetMs: 0, logRegion: region }, ACC115F2_START);
    expect(at("EU")).toEqual({ statedMs: ACC115F2_START, region: "EU" });
    expect(logDatedAt(rule, at("EU"))).toBe("12.1.0");
    expect(logDatedAt(rule, at("US"))).toBe("12.1.5");
    expect(logDatedAt(rule, at(undefined))).toBe("12.1.5");
  });

  it("欧服:美服上线之前 before;带终点起 since;带内到终点前一毫秒都是 before", () => {
    const eu = (ms: number) => ({ statedMs: ms, region: "EU" });
    expect(logDatedAt(rule, eu(PATCH_1215_GOLIVE_EPOCH_MS - 1))).toBe("12.1.0");
    expect(logDatedAt(rule, eu(PATCH_1215_GOLIVE_EPOCH_MS))).toBe("12.1.0");
    expect(logDatedAt(rule, eu(EU_BAND_END - 1))).toBe("12.1.0");
    expect(logDatedAt(rule, eu(EU_BAND_END))).toBe("12.1.5");
  });

  it("别的切换时刻不读这张表:欧服 10-14 的日志在另一个切换点上照常", () => {
    const other = { ...rule, cutoverEpochMs: Date.UTC(2026, 9, 6, 15) };
    expect(logDatedAt(other, { statedMs: ACC115F2_START, region: "EU" })).toBe(
      "12.1.5",
    );
  });

  it("没有偏移的裸时间戳不带地区,规则照旧", () => {
    expect(logInstantOf({ logRegion: "EU" }, ACC115F2_START)).toBe(
      ACC115F2_START,
    );
  });

  it("这个切换点的每张表在欧服带内都读 before 一侧", () => {
    const inEuBand = { statedMs: ACC115F2_START, region: "EU" };
    let n = 0;
    for (const row of [
      ...Object.values(OVERRIDE_VARIANT_SHARES_BY_ERA),
      ...Object.values(AURA_PRESS_BY_ERA),
    ])
      if (row.cutoverEpochMs === PATCH_1215_GOLIVE_EPOCH_MS) {
        n++;
        expect(logDatedAt(row, inEuBand)).toBe(row.before);
      }
    expect(n).toBeGreaterThan(0);
  });

  it("acc115f2 的神牧:欧服单位按 12.1.0 的天赋表读(两个条目换回),同一时刻的美服单位不换", () => {
    // 12.1.5 map: node 82612 entry 103745 = Ultimate Serenity
    const unit = (logRegion: string) => ({
      info: { talents: [{ id1: 82612, id2: 103745, count: 1 }] },
      logClockOffsetMs: 0,
      logRegion,
      spellCastEvents: [{ logLine: { timestamp: ACC115F2_START + 5000 } }],
      auraEvents: [],
    });
    expect(talentsOf(unit("EU"))?.[0]).toMatchObject({
      id1: 103900,
      id2: 103733,
    });
    expect(talentsOf(unit("US"))?.[0]).toMatchObject({
      id1: 82612,
      id2: 103745,
    });
  });
});
