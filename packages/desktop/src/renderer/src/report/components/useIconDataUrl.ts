import { useEffect, useState } from "react";

import { bridge } from "../../bridge";

// Send at most one IPC per icon name (a single match's lanes hold hundreds of
// chips; the bridge side has a disk cache, this layer guards against
// round-trip jitter). Promise cache: concurrent requests share one in-flight
// call.
// Bounded (insertion-order eviction with LRU semantics): a base64 data URL is
// ~25KB each, so across hundreds of matches in a long session an unbounded map
// grows to 20-40MB and never shrinks (2026-07-26 audit). A single match has at
// most a few hundred distinct icons, so 512 covers the hot set of 2-3 matches
// and an evicted oldest entry merely costs one more IPC (the main side has a
// disk cache).
const ICON_MEMO_MAX = 512;
const iconMemo = new Map<string, Promise<string | null>>();

function getIconCached(icon: string): Promise<string | null> {
  const hit = iconMemo.get(icon);
  if (hit) {
    iconMemo.delete(icon);
    iconMemo.set(icon, hit); // LRU touch
    return hit;
  }
  const b = bridge();
  const p =
    b && b.icon ? b.icon.get(icon) : Promise.resolve<string | null>(null);
  iconMemo.set(icon, p);
  while (iconMemo.size > ICON_MEMO_MAX) {
    const oldest = iconMemo.keys().next().value!;
    iconMemo.delete(oldest);
  }
  return p;
}

/**
 * Icon base name → data URL. Whenever it can't be fetched (no bridge, main
 * process fetch failure, unknown icon) it returns null and lets the caller
 * decide what the fallback looks like — a spell chip falls back to its first
 * letter, the match list falls back to a class-colored glyph dot. They look
 * different, so what is shared is the fetch logic, not the whole component.
 */
export function useIconDataUrl(icon: string | null | undefined): {
  dataUrl: string | null;
  loading: boolean;
} {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!icon);

  useEffect(() => {
    if (!icon) {
      setDataUrl(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    getIconCached(icon)
      .then((url) => {
        if (active) {
          setDataUrl(url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setDataUrl(null);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [icon]);

  return { dataUrl, loading };
}

/**
 * Batch version, for when several icons are needed at once (one spec icon per
 * unit in the replay, one per selected spec in the filter bar) — hooks can't
 * be called in a loop, so the caller collects the names into an array and
 * passes them in. Returns a base-name → data URL map; keys that couldn't be
 * fetched are simply absent and the caller falls back on absence.
 *
 * Refetches only when the CONTENT of icons changes: callers usually build the
 * array inline during render, so comparing by reference would re-run the
 * effect every frame.
 */
export function useIconDataUrls(
  icons: (string | null | undefined)[],
): Record<string, string> {
  const names = Array.from(
    new Set(icons.filter((n): n is string => !!n)),
  ).sort();
  const key = names.join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (names.length === 0) {
      setUrls({});
      return;
    }
    let active = true;
    Promise.all(
      names.map((n) => getIconCached(n).then((u) => [n, u] as const)),
    ).then((pairs) => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const [n, u] of pairs) if (u) next[n] = u;
      setUrls(next);
    });
    return () => {
      active = false;
    };
    // key is a content fingerprint of names; names itself is a fresh array
    // reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}
