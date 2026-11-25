/**
 * Pipeline T260: `[RES] enemy:` gave every press with no effect span the 8 s
 * instant window. A press whose effect lives on an aura DB2 chains to it
 * (Champion's Spear 376079 → 376080) and that logged none did not land:
 * 27f20fb3, the spear's chain MISSED a Demonic Gateway, no 376080 on any
 * player, and `Champion's Spear(4s left)` printed after its warrior died.
 * The corpus check is `packages/eval/scripts/scan5/t260.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  RES_ENEMY_INSTANT_WINDOW_S,
  resEnemyEffectWindow,
} from "../src/context/resourceSnapshot";
import { triggeredEffectAurasOfCast } from "../src/data/castEffectAuras";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const SPEAR = "376079";
const ODYNS_FURY = "385059";
const METEOR = "153561";
const DARK_TRANSFORMATION = "1233448";
const press = (spellId: string, spanS = 0) =>
  ({
    spellId,
    castTimeSeconds: 100,
    buffEndSeconds: 100 + spanS,
  }) as never;

describe("resEnemyEffectWindow (pipeline T260)", () => {
  it("DB2 把长矛接到 376080,语料里绝大多数施放都有", () => {
    expect(triggeredEffectAurasOfCast(SPEAR)).toContain("376080");
    expect(triggeredEffectAurasOfCast(METEOR)).toHaveLength(0);
    // an effect aura by name only is not this rule's
    expect(triggeredEffectAurasOfCast(DARK_TRANSFORMATION)).toHaveLength(0);
  });
  it("效果在触发光环上、这次一个都没记到:没有窗口", () => {
    expect(resEnemyEffectWindow(press(SPEAR))).toBeUndefined();
    expect(resEnemyEffectWindow(press(ODYNS_FURY))).toBeUndefined();
  });
  it("记到了光环:到光环自己的结束", () => {
    expect(resEnemyEffectWindow(press(SPEAR, 4))).toEqual({
      endSeconds: 104,
      instant: false,
    });
  });
  it("没有触发光环的瞬发大招照旧显示 8 秒", () => {
    for (const id of [METEOR, DARK_TRANSFORMATION])
      expect(resEnemyEffectWindow(press(id))).toEqual({
        endSeconds: 100 + RES_ENEMY_INSTANT_WINDOW_S,
        instant: true,
      });
  });
});
