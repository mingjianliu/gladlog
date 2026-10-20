import { describe, expect, it } from "vitest";

import type { VideoMoment } from "../derive/videoMoments";
import { advanceFeed, FEED_OUT_MS, initialFeed } from "./VideoFeed";

const mk = (tS: number, label = `e${tS}`): VideoMoment => ({
  tS,
  kind: "death",
  weight: "major",
  label,
  unitNames: [],
});

describe("advanceFeed(displacement,不再是 wall-clock TTL)", () => {
  it("正常推进:收 (lastS, nowS] 的事件,新条目在底部", () => {
    let s = initialFeed(10);
    s = advanceFeed(s, 12, 1000, [mk(11), mk(12), mk(13)], 4);
    expect(s.items.map((i) => i.moment.tS)).toEqual([11, 12]);
    s = advanceFeed(s, 13, 1200, [mk(11), mk(12), mk(13)], 4);
    expect(s.items.map((i) => i.moment.tS)).toEqual([11, 12, 13]);
  });

  it("容量够用时条目常驻:时间流逝、容量有空位,不会凭空消失", () => {
    let s = initialFeed(10);
    s = advanceFeed(s, 11, 1000, [mk(11)], 4);
    // A heartbeat tick at the same nowS (=lastS) while the wall clock jumped
    // far ahead — the old TTL would fade it out on schedule; under the new
    // displacement semantics it must stay as long as capacity is not contested.
    s = advanceFeed(s, 11, 1000 + 60_000, [mk(11)], 4);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.out).toBe(false);
  });

  it("拖进度条(前跳/回退)重置:只补种新位置前 5s 内", () => {
    let s = initialFeed(10);
    s = advanceFeed(s, 11, 1000, [mk(11)], 4);
    // Jump forward to 60s: the entry at 11 is cleared, only (55,60] is taken
    s = advanceFeed(s, 60, 2000, [mk(11), mk(56), mk(59), mk(40)], 4);
    expect(s.items.map((i) => i.moment.tS)).toEqual([56, 59]);
    // Seek back to 20: reset, only (15,20] is taken
    s = advanceFeed(s, 20, 3000, [mk(11), mk(18), mk(56)], 4);
    expect(s.items.map((i) => i.moment.tS)).toEqual([18]);
  });

  it("容量位移:超出容量的最旧条目先标 out(不立即消失)", () => {
    let s = initialFeed(0);
    const moments = [1, 2, 3, 4, 5].map((t) => mk(t));
    s = advanceFeed(s, 2.5, 1000, moments, 4); // take 1,2
    s = advanceFeed(s, 5.5, 1100, moments, 4); // then 3,4,5 → 5 items, cap=4
    // At the moment of displacement the total briefly exceeds capacity (one item
    // is fading out); it is not a hard cut
    expect(s.items.map((i) => i.moment.tS)).toEqual([1, 2, 3, 4, 5]);
    expect(s.items.find((i) => i.moment.tS === 1)!.out).toBe(true);
    expect(s.items.filter((i) => i.out)).toHaveLength(1);
  });

  it("FEED_OUT_MS 淡出期满后才真正移除,不早不晚", () => {
    let s = initialFeed(0);
    const moments = [1, 2, 3, 4, 5].map((t) => mk(t));
    s = advanceFeed(s, 5.5, 1000, moments, 4); // take all 5 at once, cap=4 → 1 goes out
    const evictAt = s.items.find((i) => i.moment.tS === 1)!.evictAt!;
    expect(evictAt).toBe(1000 + FEED_OUT_MS);
    // Still kept during the fade-out period (even on a heartbeat tick at the same nowS)
    s = advanceFeed(s, 5.5, evictAt - 1, [], 4);
    expect(s.items.map((i) => i.moment.tS)).toContain(1);
    // The heartbeat tick after expiry really removes it
    s = advanceFeed(s, 5.5, evictAt, [], 4);
    expect(s.items.map((i) => i.moment.tS)).toEqual([2, 3, 4, 5]);
  });

  it("已在淡出中的条目再次被判定超容量时不重设 evictAt(不拖长淡出)", () => {
    let s = initialFeed(0);
    s = advanceFeed(
      s,
      5.5,
      1000,
      [1, 2, 3, 4, 5].map((t) => mk(t)),
      4,
    );
    const firstEvictAt = s.items.find((i) => i.moment.tS === 1)!.evictAt!;
    // One more item arrives; entry 1 is still the oldest and still over
    // capacity, but it is already fading out
    s = advanceFeed(s, 6.5, 1050, [mk(6)], 4);
    expect(s.items.find((i) => i.moment.tS === 1)!.evictAt).toBe(firstEvictAt);
  });

  it("capacity 变化(容器 resize)对下一次推进即时生效", () => {
    let s = initialFeed(0);
    const moments = [1, 2, 3].map((t) => mk(t));
    s = advanceFeed(s, 3.5, 1000, moments, 4); // capacity 4, all 3 stay
    expect(s.items).toHaveLength(3);
    s = advanceFeed(s, 3.5, 1000, [], 2); // container gets shorter: capacity drops to 2
    expect(s.items.filter((i) => !i.out)).toHaveLength(2);
    expect(s.items.find((i) => i.moment.tS === 1)!.out).toBe(true);
  });
});
