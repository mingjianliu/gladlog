/**
 * FT-T08 step 5: a channelled cooldown reads "interrupted" only for a kick in
 * its window or a control that landed DURING it and ended it — not for a
 * control it was cast under, nor one that landed and left it running.
 */
import { describe, expect, it } from "vitest";

import {
  CHANNEL_CUT_BY_CC_MS,
  channelWasInterrupted,
  landingCutChannel,
} from "../src/context/timelineHelpers";

const cc = (atSeconds: number, durationSeconds = 4) =>
  ({ atSeconds, durationSeconds }) as never;
const kick = (atSeconds: number) => ({ atSeconds }) as never;
const summary = (ccs: never[], kicks: never[] = []) => ({
  ccInstances: ccs,
  interruptInstances: kicks,
});

describe("channelWasInterrupted", () => {
  // the channel runs 66.0 → 69.72 s (141470d0's Emerald Communion, 3.72 s)
  const start = 66;
  const end = 69.72;

  it("施放时身上已有的控制不算打断(昏迷中按的 Emerald Communion)", () => {
    expect(channelWasInterrupted(summary([cc(65.2, 6)]), start, end)).toBe(false);
    // on at the press and still on at the end
    expect(channelWasInterrupted(summary([cc(66, 5)]), start, end)).toBe(false);
  });

  it("引导期间落地、引导在它落地时结束 → 打断;落地后引导照常继续 → 不是", () => {
    const cut = end - CHANNEL_CUT_BY_CC_MS / 1000;
    expect(channelWasInterrupted(summary([cc(cut)]), start, end)).toBe(true);
    expect(channelWasInterrupted(summary([cc(end - 0.019)]), start, end)).toBe(true);
    // 605-file sample: a Polymorph 0.2 s before the channel's end still cut it
    expect(channelWasInterrupted(summary([cc(end - 0.2)]), start, end)).toBe(true);
    expect(channelWasInterrupted(summary([cc(cut - 0.001)]), start, end)).toBe(false);
    // a Hammer of Justice 1.5 s before the end of a channel that went on
    expect(channelWasInterrupted(summary([cc(68.2)]), start, end)).toBe(false);
    // landing after the channel was over
    expect(channelWasInterrupted(summary([cc(end + 0.2)]), start, end)).toBe(false);
  });

  it("打断技同理:引导在它落下时结束才算(agy 审查 P1);没有 summary → false", () => {
    expect(channelWasInterrupted(summary([], [kick(end - 0.005)]), start, end)).toBe(true);
    // a kick mid-channel that left it running 1.7 s more
    expect(channelWasInterrupted(summary([], [kick(68)]), start, end)).toBe(false);
    // the cast BEFORE the channel was kicked 0.35 s before the press
    expect(channelWasInterrupted(summary([], [kick(start - 0.35)]), start, end)).toBe(false);
    // the kick's line right after the REMOVED it caused, across a ms boundary
    expect(channelWasInterrupted(summary([], [kick(end + 0.001)]), start, end)).toBe(true);
    // the cast AFTER the completed channel was kicked 0.3 s after its end
    expect(channelWasInterrupted(summary([], [kick(end + 0.3)]), start, end)).toBe(false);
    expect(channelWasInterrupted(undefined, start, end)).toBe(false);
  });

  it("landingCutChannel:[YOU] [CD] 的引导后缀与 [YOU] [CAST] 的 channel cut 用同一个判据", () => {
    expect(landingCutChannel(69_701, 66_000, 69_720)).toBe(true);
    expect(landingCutChannel(69_720 - CHANNEL_CUT_BY_CC_MS - 1, 66_000, 69_720)).toBe(false);
    expect(landingCutChannel(66_000, 66_000, 66_010)).toBe(false); // on at the press
    expect(landingCutChannel(69_730, 66_000, 69_720)).toBe(false);
    expect(CHANNEL_CUT_BY_CC_MS).toBe(250);
  });
});
