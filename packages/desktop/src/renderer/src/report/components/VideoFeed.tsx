import { fmtTime } from "@gladlog/analysis";
import { useEffect, useRef } from "react";
import type { VideoMoment } from "../derive/videoMoments";

/** Playback event feed (kill-feed style, per brainstorm C): as playback
 * crosses an event's timestamp the entry slides in from the bottom and pushes
 * the rest up. The state machine is a pure function (testable); the component
 * is just a shell plus capacity measurement. Driven by video timeupdate
 * (~4Hz), unrelated to the replay page clock.
 *
 * Eviction semantics (2026-08 rework, #video-tab-2): entries no longer expire
 * on a wall-clock TTL -- they stay resident and are only evicted when a new
 * entry pushes them past capacity (displacement, not time-based). The old
 * TTL + hard-cap combination was counterintuitive: entries vanished on
 * schedule even while capacity had free slots. Now, as long as there is room
 * they stay until genuinely displaced. Capacity is derived from the measured
 * container height, falling back to FEED_CAPACITY_FALLBACK when unmeasurable.
 * A displaced entry is first marked `out` to play the FEED_OUT_MS fade before
 * actual removal (that fade behavior is retained from the old version; only
 * the trigger changed from "expired" to "displaced"). */

/** Fade-out duration: a displaced entry is marked `out` to play the animation
 * before it is actually removed. */
export const FEED_OUT_MS = 400;
/** Fallback capacity when the container height can't be measured (the instant
 * of mount / no ResizeObserver in the environment / jsdom tests). */
export const FEED_CAPACITY_FALLBACK = 6;
/** Estimated item height (including the bottom gap) -- a constant rather than
 * a measurement: jsdom runs no real layout, and in the product users are
 * insensitive to a capacity error of a few pixels, so a constant suffices.
 * Changing the CSS line height / gap means updating this too. */
const ITEM_H_PX = 34;
const GAP_PX = 6;
/** A forward jump larger than this many seconds counts as scrubbing: reset the
 * stack and replay only the RESEED_S seconds before the new position. */
const JUMP_S = 3;
const RESEED_S = 5;

export interface FeedItem {
  key: string;
  moment: VideoMoment;
  bornAt: number; // wall-clock ms, for debugging/ordering only; no longer drives expiry
  out: boolean;
  /** Only meaningful when out=true: the wall-clock instant at which the entry
   * is actually removed from the array (leaving room for the fade). */
  evictAt?: number;
}

export interface FeedState {
  lastS: number;
  items: FeedItem[];
}

export const initialFeed = (nowS: number): FeedState => ({
  lastS: nowS,
  items: [],
});

const keyOf = (m: VideoMoment) => `${m.tS}:${m.kind}:${m.label}`;

/**
 * Advance the feed state machine. capacity<=0 is treated as 1 (always keep at
 * least one entry).
 *
 * When nowS equals the previous value (state.lastS) this is an "eviction
 * settlement" heartbeat (see the VideoFeed component): the seeding window
 * (fromS, nowS] is always empty when fromS===nowS, so such calls only advance
 * the removal of entries whose evictAt has passed and never conjure new ones.
 */
export function advanceFeed(
  state: FeedState,
  nowS: number,
  wallNow: number,
  moments: VideoMoment[],
  capacity: number,
): FeedState {
  const jumped = nowS < state.lastS - 0.5 || nowS > state.lastS + JUMP_S;
  const fromS = jumped ? nowS - RESEED_S : state.lastS;
  const fresh = moments
    .filter((m) => m.tS > fromS && m.tS <= nowS)
    .map((m, i) => ({
      key: keyOf(m),
      moment: m,
      // Stagger birth timestamps when reseeding, so the whole column doesn't
      // disappear on the same tick
      bornAt: wallNow + i,
      out: false,
      evictAt: undefined as number | undefined,
    }));
  const base = jumped ? [] : state.items;
  const seen = new Set(base.map((it) => it.key));
  const merged = [...base, ...fresh.filter((it) => !seen.has(it.key))];

  // Capacity displacement: entries at the head (oldest) beyond cap are marked
  // out and get a fixed evictAt -- an entry already fading (it.out true) is
  // not re-timed, so later displacements can't repeatedly stretch its fade.
  const cap = Math.max(1, capacity);
  const overflow = Math.max(0, merged.length - cap);
  const staged = merged.map((it, i) =>
    i < overflow && !it.out
      ? { ...it, out: true, evictAt: wallNow + FEED_OUT_MS }
      : it,
  );
  // Actual removal only at evictAt; entries not yet marked for eviction
  // (evictAt undefined) are kept forever -- this is "resident until
  // displaced", with no wall-clock TTL any more.
  const items = staged.filter(
    (it) => it.evictAt == null || wallNow < it.evictAt,
  );
  return { lastS: nowS, items };
}

const KIND_ICON: Record<string, string> = {
  death: "✕",
  "burst-band": "⚔",
  defensive: "🛡",
  dispel: "✨",
  cc: "🌀",
  mistake: "⚠",
  ai: "🤖",
};


export function VideoFeed({
  items,
  onCapacityChange,
}: {
  items: FeedItem[];
  /** Capacity derived from the measured container height; when it can't be
   * measured no callback fires and the caller keeps its previous value or the
   * FEED_CAPACITY_FALLBACK default. */
  onCapacityChange?: (capacity: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined" || !onCapacityChange)
      return;
    const compute = () => {
      const h = el.getBoundingClientRect().height;
      const cap =
        h > 0
          ? Math.max(1, Math.floor((h + GAP_PX) / (ITEM_H_PX + GAP_PX)))
          : FEED_CAPACITY_FALLBACK;
      onCapacityChange(cap);
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [onCapacityChange]);

  return (
    <div ref={containerRef} className="rpt-video-feed" data-testid="video-feed">
      {items.map((it) => (
        <div
          key={it.key}
          className={`rpt-video-feed-item${it.out ? " out" : ""}`}
        >
          <span className="rpt-video-feed-t">{fmtTime(it.moment.tS)}</span>
          <span className="rpt-video-feed-icon">
            {KIND_ICON[it.moment.kind] ?? "•"}
          </span>
          <span className="rpt-video-feed-label">{it.moment.label}</span>
        </div>
      ))}
    </div>
  );
}
