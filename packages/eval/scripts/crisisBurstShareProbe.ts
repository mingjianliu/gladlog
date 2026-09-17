/**
 * crisisBurstShareProbe.ts — share of crisis decision points whose
 * `enemyBurst` is true, per bracket (2026-09-17, GH #95 hand-read finding:
 * 12/12 teammate-crisis-idle cards said burst=none because
 * crisisDecisionPoints still built its own 34-id offensive-CD set from
 * classMetadata instead of the canonical 47-id OFFENSIVE_CD_SPELL_IDS the
 * predicate index says every consumer reads). Run before and after the
 * unification; the delta is the acceptance number.
 *
 * Usage: npx tsx packages/eval/scripts/crisisBurstShareProbe.ts --manifest <m> [--every 60]
 */
import { ensureAnalysisData, isHealerSpec } from "@gladlog/analysis";
import {
  CRISIS_OFFENSIVE_CD_IDS,
  crisisDecisionPoints,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "60"));

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const t: Record<
  string,
  { points: number; burst: number; dangerous: number; dangerousBurst: number }
> = {};
let rounds = 0;
for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const bracket = String(legacy.startInfo?.bracket ?? "?");
    const row = (t[bracket] ??= {
      points: 0,
      burst: 0,
      dangerous: 0,
      dangerousBurst: 0,
    });
    for (const u of Object.values(legacy.units ?? {}) as any[]) {
      if (!u.info) continue;
      let pts;
      try {
        pts = crisisDecisionPoints(
          u,
          legacy,
          isHealerSpec(u.spec) ? "healer" : "dps",
        );
      } catch {
        continue;
      }
      for (const p of pts) {
        row.points++;
        if (p.enemyBurst) row.burst++;
        if (p.dangerous) {
          row.dangerous++;
          if (p.enemyBurst) row.dangerousBurst++;
        }
      }
    }
  }
}
process.stdout.write(
  JSON.stringify(
    { idSetSize: CRISIS_OFFENSIVE_CD_IDS.size, rounds, byBracket: t },
    null,
    2,
  ) + "\n",
);
