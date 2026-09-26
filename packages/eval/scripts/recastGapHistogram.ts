/**
 * recastGapHistogram.ts — distribution of the gap between consecutive casts
 * of given spells, per spec (GH #96 BACKLOG #45, 2026-09-15).
 *
 * Why: cooldownTalentScan found holders recasting The Hunt, Alter Time,
 * Capacitor Totem and Force of Nature faster than DB2 base − talent. A fixed
 * unknown reduction shows as a sharp floor (every fast gap at the same value);
 * a dynamic one (cooldown shortened per event) shows as a smear. Reports every
 * consecutive-cast gap (not only the minimum) in 1 s bins below the DB2 base.
 *
 * Usage: npx tsx packages/eval/scripts/recastGapHistogram.ts --manifest <m> [--every 10] --spells 370965,342245
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "10"));
const SPELLS = new Set(arg("--spells", "").split(",").filter(Boolean));

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

/** spell → spec → gap bin (1 s) → count */
const hist = new Map<string, Map<string, Map<number, number>>>();
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
    for (const u of Object.values(legacy.units) as any[]) {
      if (!u.info) continue;
      const bySpell = new Map<string, number[]>();
      for (const c of u.spellCastEvents ?? []) {
        if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
        const id = String(c.spellId ?? "");
        if (!SPELLS.has(id)) continue;
        const l = bySpell.get(id) ?? [];
        l.push(c.timestamp);
        bySpell.set(id, l);
      }
      for (const [id, ts] of bySpell) {
        ts.sort((x, y) => x - y);
        for (let i = 1; i < ts.length; i++) {
          const g = Math.floor((ts[i]! - ts[i - 1]!) / 1000);
          const bySpec = hist.get(id) ?? new Map();
          const h = bySpec.get(String(u.spec)) ?? new Map<number, number>();
          h.set(g, (h.get(g) ?? 0) + 1);
          bySpec.set(String(u.spec), h);
          hist.set(id, bySpec);
        }
      }
    }
  }
}
console.log(`files ${files.length}`);
for (const [id, bySpec] of hist) {
  const base = (spellEffectData[id] as any)?.cooldownSeconds;
  for (const [spec, h] of bySpec) {
    const total = [...h.values()].reduce((x, y) => x + y, 0);
    const below = [...h].filter(([g]) => g < base).sort((x, y) => x[0] - y[0]);
    console.log(
      `${id} base ${base}s spec ${spec}: ${total} gaps; below base: ${below
        .map(([g, n]) => `${g}s×${n}`)
        .join(" ")}`,
    );
  }
}
