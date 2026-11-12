import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { tickEndedChannelSpans } from "../src/utils/castCommitSpans";

const T0 = 1_000_000;
const PRESS = "305483"; // Lightning Lasso, the press
const CARRIER = "305485"; // Lightning Lasso, the channelled debuff

beforeAll(async () => {
  await ensureAnalysisData();
});

const row = (id: string, s: number, event: string) => ({
  spellId: id,
  spellName: "Lightning Lasso",
  srcUnitId: "S",
  timestamp: T0 + s * 1000,
  logLine: { event, timestamp: T0 + s * 1000 },
});
const shaman = (extra: Record<string, unknown> = {}) =>
  ({
    id: "S",
    spellCastEvents: [row(PRESS, 0, "SPELL_CAST_SUCCESS")],
    auraEvents: [],
    damageOut: [1, 2, 2.5].map((s) => row(CARRIER, s, "SPELL_PERIODIC_DAMAGE")),
    healOut: [],
    actionIn: [],
    ...extra,
  }) as unknown as Parameters<typeof tickEndedChannelSpans>[0] & {
    spellCastEvents: unknown[];
  };

describe("T92: a channel pressed under one id and carried by another", () => {
  it("Lightning Lasso(按键 305483,引导 305485)到自己最后一跳为止", () => {
    expect(tickEndedChannelSpans(shaman())).toEqual([
      {
        spellId: PRESS,
        spellName: "Lightning Lasso",
        startMs: T0,
        endMs: T0 + 2500,
        castMs: T0,
        endedBy: "inferred",
      },
    ]);
  });

  it("没有任何一跳带引导 id:这次按键不当引导,什么也不猜", () => {
    expect(tickEndedChannelSpans(shaman({ damageOut: [] }))).toEqual([]);
    // the same name on rows of a non-channelled id proves nothing
    expect(
      tickEndedChannelSpans(
        shaman({
          damageOut: [1, 2].map((s) => row("999999", s, "SPELL_DAMAGE")),
        }),
      ),
    ).toEqual([]);
  });

  it("下一次别的按键之后的那一跳不算引导还在继续", () => {
    const s = shaman();
    s.spellCastEvents.push({
      ...row("8004", 1.5, "SPELL_CAST_SUCCESS"),
      spellName: "Healing Surge",
    });
    expect(tickEndedChannelSpans(s)[0]?.endMs).toBe(T0 + 1000);
  });

  it("打断结束引导(打断行记的是任一 id)", () => {
    const s = shaman({
      actionIn: [
        {
          spellId: "2139",
          extraSpellId: CARRIER,
          destUnitId: "S",
          timestamp: T0 + 1200,
          logLine: { event: "SPELL_INTERRUPT", timestamp: T0 + 1200 },
        },
      ],
    });
    expect(tickEndedChannelSpans(s)[0]?.endMs).toBe(T0 + 1200);
  });
});
