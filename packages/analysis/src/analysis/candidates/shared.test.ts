import { describe, expect, it } from "vitest";

import type { CastFailedEvent } from "../../utils/rawStreams";
import {
  filterIntentGuardEvidence,
  INTENT_GUARD_GCD_S,
  INTENT_GUARD_PRE_CAST_EXCLUSION_S,
  NOT_READY_REASON_ZH,
} from "./shared";

const hit = (
  tSeconds: number,
  reason: string,
  spellId = 421453,
): CastFailedEvent => ({
  tSeconds,
  unitGuid: "h",
  spellId,
  spellName: "Ultimate Penitence",
  reason,
});

/**
 * BACKLOG #29 (2026-08-17 rewrite): the intent guard's evidence must not
 * count GCD-spam presses as "pressed but rejected". Two timing-based
 * exclusions, both derived from the 3df6ccf8 forensic trace + the n=300
 * corpus classification (478 尚未恢复 events: 81.2% spam-then-cast, 15.7%
 * gcd-locked, 3.1% genuine):
 *
 *  - pre-cast: a failure ≤2s BEFORE a same-spell successful cast is the
 *    mechanical act of finally pressing the button (spam clicks during the
 *    GCD immediately preceding the successful press), not blocked intent —
 *    ANY reason string is excluded here, because whatever blocked that exact
 *    instant self-resolved within 2s (the cast went through).
 *  - gcd-locked: a 尚未恢复 failure ≤1.5s AFTER one of the player's own
 *    successful casts is the game reporting the GCD, not the spell's own
 *    cooldown. Reason-narrowed to the zh-client string so a genuinely
 *    blocked press (stunned/silenced) adjacent to an own cast is never
 *    swallowed; on a non-zh client this narrows to a no-op (evidence kept —
 *    status-quo behavior, never a silent loss of genuine evidence).
 */
describe("filterIntentGuardEvidence(#29 意图守护证据过滤)", () => {
  it("pre-cast:同技能成功施放前 ≤2s 的失败(任何理由)被排除;>2s 保留", () => {
    const hits = [
      hit(429.0, NOT_READY_REASON_ZH), // 1.6s before cast → excluded
      hit(430.0, "无法在昏迷时那样做"), // 0.6s before cast → excluded (any reason)
      hit(428.5, NOT_READY_REASON_ZH), // 2.1s before cast → kept
      hit(400.7, NOT_READY_REASON_ZH), // mid-window → kept
    ];
    const out = filterIntentGuardEvidence(hits, [430.6]);
    expect(out.map((h) => h.tSeconds)).toEqual([428.5, 400.7]);
  });

  it("pre-cast 边界:恰好 2.0s 前(430.6-2)排除,恰好在施放同刻排除", () => {
    const out = filterIntentGuardEvidence(
      [hit(428.6, NOT_READY_REASON_ZH), hit(430.6, NOT_READY_REASON_ZH)],
      [430.6],
    );
    expect(out).toEqual([]);
  });

  it("gcd-locked:自己任意技能成功施放后 ≤1.5s 内的「尚未恢复」被排除;同时序的昏迷理由保留;>1.5s 的「尚未恢复」保留", () => {
    const hits = [
      hit(400.7, NOT_READY_REASON_ZH), // 1.2s after own cast → excluded
      hit(400.7, "无法在昏迷时那样做"), // same instant, CC reason → kept
      hit(401.2, NOT_READY_REASON_ZH), // 1.7s after own cast → kept
    ];
    const out = filterIntentGuardEvidence(hits, [], {
      ownCastSuccessSeconds: [399.5],
    });
    expect(out.map((h) => [h.tSeconds, h.reason])).toEqual([
      [400.7, "无法在昏迷时那样做"],
      [401.2, NOT_READY_REASON_ZH],
    ]);
  });

  it("gcd-locked 不给 ownCastSuccessSeconds 时是无操作(优雅降级)", () => {
    const hits = [hit(400.7, NOT_READY_REASON_ZH)];
    expect(filterIntentGuardEvidence(hits, [])).toEqual(hits);
  });

  it("空输入 → 空输出;两个常量为记录值(2 / 1.5)", () => {
    expect(filterIntentGuardEvidence([], [430.6])).toEqual([]);
    expect(INTENT_GUARD_PRE_CAST_EXCLUSION_S).toBe(2);
    expect(INTENT_GUARD_GCD_S).toBe(1.5);
  });
});

describe("gcd-locked exclusion matches every client locale (reliability round 2, 2c6e)", () => {
  it("an English 'Not yet recovered' 0.13 s after an own cast is the GCD, not a rejection", async () => {
    const { filterIntentGuardEvidence, NOT_READY_REASONS } = await import("./shared");
    for (const reason of NOT_READY_REASONS) {
      const kept = filterIntentGuardEvidence(
        [{ tSeconds: 16.916, reason, spellId: 1, spellName: "Starsurge", unitGuid: "o" } as never],
        [],
        { ownCastSuccessSeconds: [16.784] },
      );
      expect(kept).toHaveLength(0);
    }
    const stunned = filterIntentGuardEvidence(
      [{ tSeconds: 16.916, reason: "Can't do that while stunned", spellId: 1, spellName: "Starsurge", unitGuid: "o" } as never],
      [],
      { ownCastSuccessSeconds: [16.784] },
    );
    expect(stunned).toHaveLength(1);
  });
});
