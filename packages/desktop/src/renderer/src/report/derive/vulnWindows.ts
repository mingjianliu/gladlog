import { computeOffensiveWindows } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/**
 * Vulnerability window bands (backlog #8): burst = a kill attempt (gold),
 * vulnerable = a whole stretch of vulnerability nobody punished (grey-red).
 * Single-source predicate: this consumes analysis's computeOffensiveWindows
 * directly (including the 2026-07-17 burst redesign) and never copies its
 * constants into the render layer. Times are **relative seconds** (from combat
 * start); each renderer converts into its own coordinate system.
 */
export interface VulnBand {
  kind: "burst" | "vulnerable";
  fromS: number;
  toS: number;
  targetName: string;
  /** burst: team damage; vulnerable: team damage over the whole stretch —
   * the health the target lost. */
  damage: number;
  /** What the target's shields absorbed of the same hits (fact2 R7: the
   * analysis line prints it beside the total; so does the list). */
  absorbed: number;
  /** The target died inside the window (plus 3s of slack) → kill chip
   * (P3-2). */
  targetDied: boolean;
}

export function deriveVulnBands(source: ReportSource): VulnBand[] {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friendlies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friendlies.length === 0 || enemies.length === 0) return [];

    // Kill test (P3-2): the target died inside the window (with 3s of slack at
    // the tail, since kills often land right at the window's edge)
    const deathsByName = new Map<string, number[]>();
    for (const u of players) {
      const ts = (u.deathRecords ?? []).map(
        (d: { timestamp: number }) => (d.timestamp - legacy.startTime) / 1000,
      );
      if (ts.length) deathsByName.set(u.name, ts);
    }
    const KILL_SLACK_S = 3;
    const diedIn = (name: string, fromS: number, toS: number): boolean =>
      (deathsByName.get(name) ?? []).some(
        (d) => d >= fromS && d <= toS + KILL_SLACK_S,
      );

    const bands: VulnBand[] = [];
    for (const w of computeOffensiveWindows(enemies, friendlies, legacy)) {
      if (w.bursts.length > 0) {
        for (const b of w.bursts) {
          bands.push({
            kind: "burst",
            fromS: b.fromSeconds,
            toS: b.toSeconds,
            targetName: w.targetName,
            damage: b.damage,
            absorbed: b.absorbed,
            targetDied: diedIn(w.targetName, b.fromSeconds, b.toSeconds),
          });
        }
      } else {
        bands.push({
          kind: "vulnerable",
          fromS: w.fromSeconds,
          toS: w.toSeconds,
          targetName: w.targetName,
          damage: w.friendlyDamageInWindow,
          absorbed: w.friendlyAbsorbedInWindow,
          targetDied: diedIn(w.targetName, w.fromSeconds, w.toSeconds),
        });
      }
    }
    return bands.sort((a, b) => a.fromS - b.fromS);
  } catch {
    return [];
  }
}
