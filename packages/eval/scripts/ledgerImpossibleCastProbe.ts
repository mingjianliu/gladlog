/**
 * ledgerImpossibleCastProbe.ts — "the ledger said it was on cooldown, the
 * player cast it anyway" for ONE spell, under the shipped ledger and under
 * alternative cooldown values (BACKLOG #45, The Hunt, 2026-09-17).
 *
 * For every player whose `extractMajorCooldowns` ledger carries the spell:
 * consecutive SPELL_CAST_SUCCESS gaps, and how many gaps fall short of
 * (a) the ledger's own talent-resolved `cooldownSeconds` (what the product
 * believes), (b) each `--alt` value. A gap shorter than the believed cooldown
 * is an impossible cast — the believed number is too long. Slack
 * CD_INSTANT_SLACK_S is applied the way `cdAvailableAt` applies it.
 *
 * Baseline for The Hunt 370965 (1/20 archive, 2026-09-17, before the corpus
 * patch): see the commit that landed CORPUS_COOLDOWN_PATCHES.
 *
 * Usage: npx tsx packages/eval/scripts/ledgerImpossibleCastProbe.ts --manifest <m> --spell 370965 [--every 20] [--alt 75,90]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CD_INSTANT_SLACK_S,
  extractMajorCooldowns,
} from "@gladlog/analysis/src/utils/cooldowns";
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
const spell = arg("--spell", "370965");
const every = Number(arg("--every", "20"));
const alts = arg("--alt", "").split(",").filter(Boolean).map(Number);

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const t = {
  files: files.length,
  rounds: 0,
  playersWithSpell: 0,
  gaps: 0,
  ledgerCooldownValues: {} as Record<string, number>,
  impossibleUnderLedger: 0,
  impossibleUnderAlt: Object.fromEntries(
    alts.map((x) => [String(x), 0]),
  ) as Record<string, number>,
  gapHistogram: {} as Record<string, number>,
  minGap: Infinity,
};

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
    t.rounds++;
    for (const u of Object.values(legacy.units ?? {}) as any[]) {
      if (!u.info) continue;
      let ledger: any[];
      try {
        ledger = extractMajorCooldowns(u, legacy);
      } catch {
        continue;
      }
      const cd = ledger.find((c) => String(c.spellId) === spell);
      if (!cd) continue;
      t.playersWithSpell++;
      const key = String(cd.cooldownSeconds);
      t.ledgerCooldownValues[key] = (t.ledgerCooldownValues[key] ?? 0) + 1;
      const times = (cd.casts as any[])
        .map((c) => c.timeSeconds as number)
        .sort((x, y) => x - y);
      for (let i = 1; i < times.length; i++) {
        const gap = times[i]! - times[i - 1]!;
        t.gaps++;
        t.minGap = Math.min(t.minGap, gap);
        const b = `${Math.floor(gap / 5) * 5}s`;
        t.gapHistogram[b] = (t.gapHistogram[b] ?? 0) + 1;
        if (gap + CD_INSTANT_SLACK_S < cd.cooldownSeconds)
          t.impossibleUnderLedger++;
        for (const x of alts)
          if (gap + CD_INSTANT_SLACK_S < x) t.impossibleUnderAlt[String(x)]!++;
      }
    }
  }
}
process.stdout.write(JSON.stringify(t, null, 2) + "\n");
