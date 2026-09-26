/**
 * racialTrinketLockScan — how long does each racial lock the PvP trinket?
 * Re-measures `racialTrinketLockoutMs` (packages/analysis/src/data/
 * racialAbilities.ts) against a corpus (CLAUDE.md Game-Behaviour Rule 8).
 *
 * Per racial, from the raw log lines:
 *  - successes: racial → Medallion (336126) successful press gaps (a success at
 *    gap g proves the lock ≤ g);
 *  - rejections: Medallion SPELL_CAST_FAILED after the racial with no trinket
 *    press in the previous 120 s (a rejection at g proves the lock > g, once
 *    the trinket's own cooldown is ruled out).
 *
 *   npx tsx packages/eval/scripts/racialTrinketLockScan.ts \
 *     --manifest <manifest.txt> [--every 5]
 *
 * 2026-09-25 (1-in-5 of manifest-archive-2026-08-28-newseason): Will to
 * Survive successes n=482 (p1 60.1 s), clean rejections n=17 (14 ≤ 57.5 s);
 * Will of the Forsaken successes min 30.1 s (n=1,404), rejections max 29.9 s.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { arg, argOf } from "./lib/cli";

const RACIALS: Record<string, string> = {
  "7744": "Will of the Forsaken",
  "20594": "Stoneform",
  "59752": "Will to Survive",
  "265221": "Fireblood",
};
const MEDALLION = "336126";
const OWN_CD_GUARD_S = 120;

const manifest = arg("--manifest", "");
if (!manifest) {
  console.error("usage: --manifest <file> [--every N]");
  process.exit(2);
}
const every = argOf("--every", 5);
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const TS = /^\d+\/\d+\/\d+ (\d+):(\d+):(\d+)\.(\d+)/;
const secs = (line: string): number | null => {
  const m = TS.exec(line);
  if (!m) return null;
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4]) / 10 ** m[4]!.length
  );
};

const successes = new Map<string, number[]>();
const rejections = new Map<string, number[]>();
for (const f of files) {
  let text: string;
  try {
    text = gunzipSync(readFileSync(f)).toString("utf8");
  } catch {
    continue;
  }
  let lastRacial = new Map<string, { id: string; t: number }>();
  const lastTrinket = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (line.includes("ARENA_MATCH_START")) lastRacial = new Map();
    if (
      !line.includes("SPELL_CAST_SUCCESS") &&
      !line.includes("SPELL_CAST_FAILED")
    )
      continue;
    const rest = line.slice(line.indexOf("  ") + 2);
    const parts = rest.split(",");
    if (parts.length < 12) continue;
    const [ev, src] = parts;
    const sid = parts[9]!;
    const t = secs(line);
    if (t === null || !src) continue;
    if (ev === "SPELL_CAST_SUCCESS") {
      if (RACIALS[sid]) lastRacial.set(src, { id: sid, t });
      else if (sid === MEDALLION) {
        const r = lastRacial.get(src);
        if (r && t - r.t > 0 && t - r.t < 300) {
          const list = successes.get(r.id) ?? [];
          list.push(t - r.t);
          successes.set(r.id, list);
          lastRacial.delete(src);
        }
        lastTrinket.set(src, t);
      }
    } else if (ev === "SPELL_CAST_FAILED" && sid === MEDALLION) {
      const r = lastRacial.get(src);
      if (!r) continue;
      const lt = lastTrinket.get(src);
      if (lt !== undefined && t - lt < OWN_CD_GUARD_S) continue;
      if (t - r.t > 0 && t - r.t < 300) {
        const list = rejections.get(r.id) ?? [];
        list.push(t - r.t);
        rejections.set(r.id, list);
      }
    }
  }
}

const q = (xs: number[], p: number) =>
  xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
for (const [id, name] of Object.entries(RACIALS)) {
  const s = (successes.get(id) ?? []).sort((a, b) => a - b);
  const r = (rejections.get(id) ?? []).sort((a, b) => a - b);
  if (!s.length && !r.length) continue;
  console.log(
    `${name} (${id}): successes n=${s.length}` +
      (s.length
        ? ` min=${s[0]!.toFixed(1)} p1=${q(s, 0.01).toFixed(1)} p50=${q(s, 0.5).toFixed(1)}`
        : "") +
      ` | clean rejections n=${r.length}` +
      (r.length
        ? ` max=${r[r.length - 1]!.toFixed(1)} p50=${q(r, 0.5).toFixed(1)}`
        : ""),
  );
}
