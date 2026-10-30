/**
 * BACKLOG #40 measurement: how often does one press render as TWO [YOU] lines?
 *
 * Mechanism: the general cast loop suppresses casts the cooldown ledger already
 * rendered, keyed by exact spellId — but skin-variant ids (Hex casts as 210873
 * while the ledger tracks the base id) slip through, so the same press shows up
 * as a ledger [YOU] [CD]/[CC] line AND a general-loop line at the same second.
 *
 * Counts same-second same-name [YOU] line groups across real prompts.
 * Run before and after the fix under the identical criterion.
 *
 * Usage: npx tsx packages/eval/scripts/dupLineScan.ts <archiveRoot> [maxRounds]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  buildMatchContext,
  ensureAnalysisData,
  isHealerSpec,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch } from "@gladlog/parser-compat";

await ensureAnalysisData();

const root = process.argv[2];
const maxRounds = Number(process.argv[3] ?? 300);

function newSeasonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = path.join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".txt.gz")) out.push(p);
    }
  };
  walk(dir);
  return out
    .filter((p) => {
      const m = /\/2026\/08\/(\d{2})\//.exec(p);
      return m != null && Number(m[1]) >= 12;
    })
    .sort();
}

/** `M:SS  [YOU] [CD|CC|CAST]   Name…` → `M:SS|Name` (name cut at the first
 * annotation/target marker so ledger and general renderings of one press
 * normalize to the same key). */
function youLineKey(line: string): string | null {
  const m = /^(\d+:\d{2})\s+\[YOU\] \[(?:CD|CC|CAST)\]\s+(.+)$/.exec(
    line.trim(),
  );
  if (!m) return null;
  const name = m[2]!.split(/\s+\(|\s+→|\s+\[|\s+\|/)[0]!.trim();
  if (!name) return null;
  return `${m[1]}|${name}`;
}

let rounds = 0;
let promptsWithDup = 0;
let dupGroups = 0;
const byName = new Map<string, number>();

outer: for (const file of newSeasonFiles(root)) {
  const items: GladMatch[] = [];
  try {
    const text = gunzipSync(readFileSync(file)).toString("utf8");
    const p = new GladLogParser();
    p.on("match", (m: GladMatch) => items.push(m));
    p.on("shuffle", (sh) => {
      for (const r of sh.rounds) items.push(r as never);
    });
    for (const line of text.split("\n")) p.push(line);
    p.end();
  } catch {
    continue;
  }
  for (const m of items) {
    if (rounds >= maxRounds) break outer;
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    const owner = friends.find((u) => isHealerSpec(u.spec));
    if (!owner) continue;
    rounds++;
    let prompt: string;
    try {
      prompt = buildMatchContext(legacy, friends, enemies, { owner });
    } catch {
      continue;
    }
    const counts = new Map<string, number>();
    for (const line of prompt.split("\n")) {
      const key = youLineKey(line);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let dupHere = 0;
    for (const [key, c] of counts) {
      if (c >= 2) {
        dupHere++;
        const name = key.split("|")[1]!;
        byName.set(name, (byName.get(name) ?? 0) + 1);
      }
    }
    if (dupHere > 0) promptsWithDup++;
    dupGroups += dupHere;
  }
}

console.log(
  `rounds=${rounds}  prompts with >=1 duplicate [YOU] group: ${promptsWithDup} (${((promptsWithDup / Math.max(1, rounds)) * 100).toFixed(1)}%)  duplicate groups total: ${dupGroups}`,
);
console.log("top duplicated names:");
for (const [name, c] of [...byName.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)) {
  console.log(`  ${name}: ${c}`);
}
