import type { StoredMatchMeta } from "../../src/main/matchStore";
import { installFixtureBridge } from "../../src/renderer/src/fixtureBridge";

import { FIXED_NOW } from "./fixedNow";

// Single-sourced in ./fixedNow (a leaf module with zero imports, so
// Playwright's Node process can consume it too). Re-exported here so existing
// browser-side references need no change.
export { FIXED_NOW };

const HOUR = 3_600_000;
const DAY = 86_400_000;

const BRACKETS = ["3v3", "3v3", "2v2", "Solo Shuffle"] as const;

/** 12 deterministic matches: spanning 3 days, with wins/losses and rating
 * swings — enough to cover list grouping and the dashboard curves. */
const DEMO_METAS: StoredMatchMeta[] = Array.from(
  { length: 12 },
  (_, i) => {
    const startTime = FIXED_NOW - Math.floor(i / 4) * DAY - (i % 4) * HOUR;
    return {
      id: `demo-${i}`,
      kind: "match" as const,
      bracket: BRACKETS[i % BRACKETS.length]!,
      zoneId: "1505",
      startTime,
      endTime: startTime + 180_000,
      result: i % 3 === 0 ? "Loss" : "Win",
      storedAt: startTime + 200_000,
      playerName: "Demo",
      playerRating: 1800 + i * 7,
    } as StoredMatchMeta;
  },
);

/** Install the fixture bridge and swap the match list for deterministic
 * data. */
export function installAppShellFixture(): void {
  installFixtureBridge();
  const api = window.__gladlogFixture;
  if (!api) throw new Error("installFixtureBridge 未挂载 __gladlogFixture");
  const matches = api.matches as unknown as {
    list: () => Promise<StoredMatchMeta[]>;
    page: (o: { before?: number; limit: number }) => Promise<StoredMatchMeta[]>;
  };
  matches.list = async () => DEMO_METAS;
  matches.page = async (o) =>
    DEMO_METAS.filter((m) => o.before == null || m.startTime < o.before)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, o.limit);
}

/**
 * demo-* metas are built by this file, so the underlying bridge does not know
 * them and `matches.get` always returns null — which left the developer page's
 * match inspector showing an empty tree whatever you clicked. This wires demo
 * ids onto the fixture document.
 *
 * **dev scene only — do not fold it into installAppShellFixture**: the
 * matchlist scene auto-selects the first match, so the moment get returns
 * something its right column changes from "pick a match" into a full report —
 * a developer-page change must not casually move someone else's baseline
 * (this exact baseline drift was observed on 2026-08-02).
 */
export function patchDemoMatchDocs(): void {
  const api = window.__gladlogFixture;
  if (!api) throw new Error("installFixtureBridge 未挂载 __gladlogFixture");
  const matches = api.matches as unknown as {
    get: (id: string) => Promise<unknown | null>;
  };
  const baseGet = matches.get.bind(matches);
  matches.get = async (id) =>
    id.startsWith("demo-") ? baseGet("fixture-match") : baseGet(id);
}

/** An oversized match for first-paint timing: it duplicates a real sample's
 *  event streams a fixed number of times, shifting timestamps, so the shape
 *  matches real data at N times the scale. Deterministic (no randomness), but
 *  **never used as a screenshot baseline** — its value is stressing render
 *  time, not pinning down appearance. */
export function heavyMatch(
  base: Record<string, unknown>,
  factor = 12,
): Record<string, unknown> {
  const span = (base["endTime"] as number) - (base["startTime"] as number);
  const srcUnits = base["units"] as Record<string, Record<string, unknown>>;
  const units: Record<string, unknown> = {};
  for (const [id, u] of Object.entries(srcUnits)) {
    const grown: Record<string, unknown> = { ...u };
    for (const field of [
      "damageOut",
      "damageIn",
      "healOut",
      "absorbsOut",
      "casts",
      "auraEvents",
      "advancedSamples",
    ]) {
      const arr = u[field] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const out: unknown[] = [];
      for (let k = 0; k < factor; k++) {
        for (const e of arr) {
          const shifted: Record<string, unknown> = { ...e };
          if (typeof e["t"] === "number") shifted["t"] = e["t"] + k * span;
          if (typeof e["timestamp"] === "number")
            shifted["timestamp"] = (e["timestamp"] as number) + k * span;
          out.push(shifted);
        }
      }
      grown[field] = out;
    }
    units[id] = grown;
  }
  return {
    ...base,
    endTime: (base["startTime"] as number) + span * factor,
    units,
  };
}
