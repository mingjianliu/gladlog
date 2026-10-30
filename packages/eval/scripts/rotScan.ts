 
/**
 * CLI: corpus-driven scan for whitelist rot (the mining tool behind
 * update-wow-data step 7).
 *
 * Runs a plain-text scan over raw logs from the wild corpus, looking for
 * frequently used spells that SPELL_CATEGORIES does not recognize — after a new
 * season's ability rework or id change, the curated whitelist fails silently and
 * the analysis goes completely blind to those events (they are missing from the
 * manifest and the prompt at the same time, so the coverage gate cannot catch
 * it; only crowd evidence can).
 *
 * Three event types:
 *   SPELL_AURA_APPLIED (DEBUFF, player → player) — candidate CC/roots/disarms gaps
 *   SPELL_INTERRUPT                              — candidate interrupts gaps
 *   SPELL_DISPEL (the casting-spell side)        — candidate dispel-spell gaps
 * Any id already in SPELL_CATEGORIES (under any type) counts as classified and
 * is not reported.
 * Output is sorted by "number of matches it appeared in" — DoT noise that spams
 * a single match naturally sinks to the bottom.
 *
 * Usage: tsx packages/eval/scripts/rotScan.ts (--dir <logDir> | --manifest <file>) [--top 60]
 *   --manifest: one log path per line; `.gz` entries are gunzipped in memory
 *   (the PvP log archive keeps raw gzip bytes).
 */

import { getEnglishSpellName,SPELL_CATEGORIES } from "@gladlog/analysis";
import fs from "fs-extra";
import path from "path";
import { gunzipSync } from "zlib";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { dir: "", manifest: "", top: 60 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--dir") out.dir = a[i + 1];
    else if (a[i] === "--manifest") out.manifest = a[i + 1];
    else if (a[i] === "--top") out.top = Number(a[i + 1]);
  }
  if (!out.dir && !out.manifest) {
    console.error("Usage: rotScan (--dir <logDir> | --manifest <file>) [--top N]");
    process.exit(1);
  }
  return out;
}

interface Tally {
  count: number;
  matches: Set<string>;
  name: string;
}

/** Quote-aware CSV split (guards against commas inside spell/unit names; the
 *  vast majority of lines take the fast path). */
function splitCsv(s: string): string[] {
  if (!s.includes('"')) return s.split(",");
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of s) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const { dir, manifest, top } = parseArgs();
  const files: string[] = manifest
    ? (await fs.readFile(manifest, "utf-8"))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : (await fs.readdir(dir))
        .filter((f) => f.endsWith(".txt"))
        .map((f) => path.join(dir, f));
  const auras = new Map<string, Tally>();
  const kicks = new Map<string, Tally>();
  const dispels = new Map<string, Tally>();

  const bump = (m: Map<string, Tally>, id: string, name: string, f: string) => {
    const t = m.get(id) ?? { count: 0, matches: new Set<string>(), name };
    t.count++;
    t.matches.add(f);
    m.set(id, t);
  };

  let done = 0;
  for (const f of files) {
    let text: string;
    try {
      const raw = await fs.readFile(f);
      text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf-8");
    } catch (e) {
      console.error(`skip ${f}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const line of text.split("\n")) {
      // Fast pre-filter: skip any line outside the three event types
      let ev: "aura" | "kick" | "dispel";
      if (line.includes("SPELL_AURA_APPLIED,")) ev = "aura";
      else if (line.includes("SPELL_INTERRUPT,")) ev = "kick";
      else if (line.includes("SPELL_DISPEL,")) ev = "dispel";
      else continue;

      const comma = line.indexOf(",");
      const body = line.slice(comma + 1); // the CSV body, starting at src
      const fields = splitCsv(body);
      if (fields.length < 10) continue;
      const [srcGuid, , , , dstGuid] = fields;
      const spellId = fields[8];
      const spellName = (fields[9] ?? "").replace(/^"|"$/g, "");
      if (!/^\d+$/.test(spellId)) continue;
      if (SPELL_CATEGORIES[spellId]) continue; // already classified

      if (ev === "aura") {
        // Only DEBUFFs from a player/player pet onto a player: the CC candidate set
        if (!dstGuid?.startsWith("Player-")) continue;
        if (!srcGuid?.startsWith("Player-") && !srcGuid?.startsWith("Pet-"))
          continue;
        if (fields[fields.length - 1]?.trim() !== "DEBUFF") continue;
        bump(auras, spellId, spellName, f);
      } else if (ev === "kick") {
        bump(kicks, spellId, spellName, f);
      } else {
        bump(dispels, spellId, spellName, f);
      }
    }
    done++;
    if (done % 200 === 0) console.log(`scan: ${done}/${files.length}`);
  }

  const report = (label: string, m: Map<string, Tally>, n: number) => {
    console.log(`\n===== ${label}(不在 SPELL_CATEGORIES;按对局数排序)=====`);
    const rows = [...m.entries()].sort(
      (a, b) => b[1].matches.size - a[1].matches.size,
    );
    for (const [id, t] of rows.slice(0, n)) {
      const en = getEnglishSpellName(id) || t.name;
      console.log(
        `${String(t.matches.size).padStart(5)} 场  ${String(t.count).padStart(6)} 次  ${id.padStart(7)}  ${en}`,
      );
    }
    console.log(`(共 ${rows.length} 个未归类 id)`);
  };

  console.log(`\nfiles=${files.length}`);
  report("DEBUFF 玩家→玩家(CC/roots/disarms 候选)", auras, top);
  report("SPELL_INTERRUPT 踢技能(interrupts 候选)", kicks, 20);
  report("SPELL_DISPEL 驱散法术(dispel 候选)", dispels, 20);
}

void main();
