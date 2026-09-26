/**
 * selfDamageScan — which spells deal SELF → SELF damage, and how much.
 *
 * Why it exists (reliability round 3 N13, b12b, 2026-09-26): the death block's
 * "top damage" hid a unit's own damage (Time Dilation's deferred ticks, 255k
 * in the last 10 s of a death). Once own damage is shown, `deferred X (own)`
 * must be reserved for real delayed-damage effects (DEFERRED_DAMAGE_SPELL_IDS
 * in context/timelineHelpers.ts); this scan lists the self-damage ids so that
 * set is filled from the corpus, not from memory.
 *
 *   npx tsx packages/eval/scripts/selfDamageScan.ts --manifest <m> [--every 60]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { arg, argOf } from "./lib/cli";

async function main(): Promise<void> {
  const manifest = arg("--manifest", "");
  const every = argOf("--every", 60);
  await ensureAnalysisData();
  const files = readFileSync(manifest, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).filter((_, i) => i % every === 0);
  const agg = new Map<string, { name: string; events: number; amount: number; periodic: number; units: Set<string> }>();
  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const combats: any[] = [];
    try {
      const p = new GladLogParser();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p.on("shuffle", (sh: any) => { for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r); });
      for (const line of text.split("\n")) p.push(line);
      p.end();
    } catch {
      continue;
    }
    for (const c of combats)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const u of Object.values(c?.units ?? {}) as any[]) {
        if (!u.info) continue;
        for (const d of u.damageIn ?? []) {
          if (d.srcUnitId !== u.id || !d.spellId) continue;
          const a = agg.get(d.spellId) ?? { name: getEnglishSpellName(d.spellId, d.spellName ?? "?"), events: 0, amount: 0, periodic: 0, units: new Set<string>() };
          a.events++;
          a.amount += Math.abs(d.effectiveAmount ?? 0);
          if (String(d.logLine?.event).includes("PERIODIC")) a.periodic++;
          a.units.add(`${u.spec}`);
          agg.set(d.spellId, a);
        }
      }
  }
  console.log(`files ${files.length}\nspellId\tname\tevents\tperiodic\tamountK\tspecs`);
  for (const [id, a] of [...agg].sort((x, y) => y[1].amount - x[1].amount).slice(0, 30))
    console.log(`${id}\t${a.name}\t${a.events}\t${a.periodic}\t${Math.round(a.amount / 1000)}\t${[...a.units].join(",")}`);
}

void main();
