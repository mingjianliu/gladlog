/**
 * killTierValidationScan.ts — re-validates the kill-opportunity tier model
 * (killWindowTargetSelection.ts `killOpportunityAt`: prime / gated / locked)
 * against the corpus: per stun landing (Full or 50 % DR) on a player, which
 * tier was the victim in, and did they die within 10 s?
 *
 * The 2026-08-18 validation ("8,791 stun landings: prime 4.8 %, locked
 * 1.9 %, gated 0.8 %") was produced by a scratch script that never entered
 * the repo (only its report step, eval-private
 * perfriend-scan-2026-08-18/tier_report.py, survived). This is the standing
 * replacement, built on the product's own predicates so it cannot drift from
 * what the prompt renders:
 *   - stun instances + DR level: analyzePlayerCCAndTrinket (ccTrinketAnalysis)
 *   - tier: killOpportunityAt — trinket state + STUN_USABLE_MIT_IDS in hand
 * Re-run whenever STUN_USABLE_MIT_IDS' inputs move (MITIGATION_TABLE or the
 * usable-while-stunned table — BACKLOG #41 (8) shrank the set 17 → 6).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/killTierValidationScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 30] [--md <out.md>]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { analyzePlayerCCAndTrinket } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  killOpportunityAt,
  STUN_USABLE_MIT_IDS,
} from "@gladlog/analysis/src/utils/killWindowTargetSelection";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { manifest: "", every: 1, archiveDir: process.cwd(), md: "" };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
    else if (a[i] === "--md") out.md = a[++i] ?? "";
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: killTierValidationScan.ts --manifest <path> [--every N] [--archive-dir <dir>] [--md <file>]",
    );
    process.exit(1);
  }
  return out;
}

const DEATH_LOOKAHEAD_MS = 10_000;

interface Cell {
  n: number;
  died: number;
}
const cell = (): Cell => ({ n: 0, died: 0 });
const pct = (c: Cell) => (c.n ? ((100 * c.died) / c.n).toFixed(1) + "%" : "—");

const args = parseArgs();
await ensureAnalysisData();
const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

let rounds = 0;
const byTier = new Map<string, Cell>();
const byTierLevel = new Map<string, Cell>();
const gatedCards = new Map<string, Cell>();
const byBracketTier = new Map<string, Cell>();
const bump = (m: Map<string, Cell>, k: string, died: boolean) => {
  const c = m.get(k) ?? cell();
  c.n++;
  if (died) c.died++;
  m.set(k, c);
};

for (const f of files) {
  const p = f.startsWith("/") ? f : resolve(args.archiveDir, f);
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(p);
    text = (p.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const { friends, enemies } = splitTeams(legacy);
    const bracket = String(
      (legacy as unknown as { startInfo?: { bracket?: string } }).startInfo
        ?.bracket ?? "?",
    );
    const sides: Array<[ICombatUnit[], ICombatUnit[]]> = [
      [friends, enemies],
      [enemies, friends],
    ];
    for (const [team, opponents] of sides) {
      for (const victim of team) {
        let summary: ReturnType<typeof analyzePlayerCCAndTrinket>;
        try {
          summary = analyzePlayerCCAndTrinket(victim, opponents, legacy, []);
        } catch {
          continue;
        }
        for (const cc of summary.ccInstances) {
          if (cc.drInfo?.category !== "Stun") continue;
          if (cc.drInfo.level !== "Full" && cc.drInfo.level !== "50%") continue;
          const opp = killOpportunityAt(victim, cc.atSeconds, legacy.startTime);
          const atMs = legacy.startTime + cc.atSeconds * 1000;
          const died = victim.deathRecords.some(
            (d) =>
              d.timestamp >= atMs && d.timestamp <= atMs + DEATH_LOOKAHEAD_MS,
          );
          bump(byTier, opp.tier, died);
          bump(byTierLevel, `${opp.tier}/${cc.drInfo.level}`, died);
          bump(byBracketTier, `${bracket}/${opp.tier}`, died);
          if (opp.tier === "gated")
            for (const card of opp.stunMitReady) bump(gatedCards, card, died);
        }
      }
    }
  }
}

const total = [...byTier.values()].reduce((s, c) => s + c.n, 0);
const lines: string[] = [];
lines.push(
  `files=${files.length} rounds=${rounds} stun landings (Full/50%)=${total}`,
);
lines.push(
  `STUN_USABLE_MIT_IDS in force: ${[...STUN_USABLE_MIT_IDS].sort((a, b) => Number(a) - Number(b)).join(",")} (${STUN_USABLE_MIT_IDS.size} ids)`,
);
lines.push("");
lines.push("| tier | n | died ≤10s | conversion |");
lines.push("|---|---:|---:|---:|");
for (const t of ["prime", "gated", "locked"]) {
  const c = byTier.get(t) ?? cell();
  lines.push(`| ${t} | ${c.n} | ${c.died} | ${pct(c)} |`);
}
lines.push("");
lines.push("by DR level:");
for (const [k, c] of [...byTierLevel].sort())
  lines.push(`  ${k}: n=${c.n} died=${c.died} ${pct(c)}`);
lines.push("");
lines.push("gated — card in hand (a landing counts once per card):");
for (const [k, c] of [...gatedCards].sort((a, b) => b[1].n - a[1].n))
  lines.push(`  ${k}: n=${c.n} died=${c.died} ${pct(c)}`);
lines.push("");
lines.push("by bracket / tier:");
for (const [k, c] of [...byBracketTier].sort())
  lines.push(`  ${k}: n=${c.n} died=${c.died} ${pct(c)}`);
const report = lines.join("\n");
console.log(report);
if (args.md)
  writeFileSync(
    args.md,
    `# killTierValidationScan ${new Date().toISOString()}\n\n${report}\n`,
  );
