/**
 * Forward completeness check for the signed dispel-verdict table
 * (`data/dispelVerdicts.ts`, CLAUDE.md Curated-List Completeness Rule;
 * triage 2026-09-29 missed-cleanse F-C6, user ruling A41 = A). An id with no
 * signed row skips the matrix's skip / timing gates and renders the legacy
 * tier (`verdict=unsigned`), so the table's completeness decides what the
 * missed-cleanse menu can say. Two legs:
 *
 *  1. corpus: ids someone actually dispelled (`CORPUS_OBSERVED_DISPEL_IDS`)
 *     whose SPELL_CATEGORIES tier is one missed-cleanse can open (cc / roots /
 *     debuffs_offensive) and that `dispelVerdictOf` does not know, with the
 *     observed count from the generated file's comments;
 *  2. `--manifest <archive manifest> [--every N]` (optional): every missed /
 *     late cleanse window after the corpus gate whose id is unsigned, per id,
 *     and how many of them reached a missed-cleanse menu item, over every
 *     friendly owner (the acceptanceCapture loop).
 *
 * After a signing batch the signed ids must read 0 in both legs. Season
 * runbook: docs/commands/update-wow-data.md §7b.
 *
 *   npx tsx packages/eval/scripts/dispelVerdictForwardScan.ts \
 *     [--manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt --every 30]
 */
import {
  ensureAnalysisData,
  getDispelType,
} from "@gladlog/analysis";
import { CORPUS_OBSERVED_DISPEL_IDS } from "@gladlog/analysis/src/data/dispelObservedGenerated";
import { dispelVerdictOf } from "@gladlog/analysis/src/data/dispelVerdicts";
import { SPELL_CATEGORIES } from "@gladlog/analysis/src/data/spellCategories";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { reconstructDispelSummary } from "@gladlog/analysis/src/utils/dispelAnalysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { candidatesAsTheAppRuns } from "../src/corpus/appCandidates";
import { splitTeams } from "../src/explore/storeAccess";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
await ensureAnalysisData();

const counts = new Map<string, number>();
for (const m of readFileSync(
  resolve(
    import.meta.dirname,
    "../../analysis/src/data/dispelObservedGenerated.ts",
  ),
  "utf8",
).matchAll(/"(\d+)", \/\/ ×(\d+)/g))
  counts.set(m[1]!, Number(m[2]));
const TIERS = new Set(["cc", "roots", "debuffs_offensive"]);
console.log("## (1) corpus leg: observed-dispelled, debuff tier, unsigned");
const rows = [...CORPUS_OBSERVED_DISPEL_IDS]
  .filter(
    (id) =>
      TIERS.has(
        (SPELL_CATEGORIES as Record<string, { type?: string }>)[id]?.type ?? "",
      ) && !dispelVerdictOf(id),
  )
  .map((id) => ({
    id,
    name: getEnglishSpellName(id, "?"),
    type: (SPELL_CATEGORIES as Record<string, { type?: string }>)[id]?.type,
    dispel: getDispelType(id),
    n: counts.get(id) ?? 0,
  }))
  .sort((a, b) => b.n - a.n);
for (const r of rows)
  console.log(
    `  ${r.id}\t${r.name}\ttype=${r.type}\tdispel=${r.dispel}\tobserved×${r.n}`,
  );
console.log(`  total ${rows.length} unsigned ids`);

const manifest = arg("--manifest");
if (manifest) {
  const every = Number(arg("--every") ?? "1");
  const files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0);
  console.log(
    `## (2) archive leg: ${files.length} files, missed / late cleanse windows with an unsigned id`,
  );
  const win = new Map<string, { n: number; menu: number }>();
  let allWin = 0;
  for (const f of files) {
    let text: string;
    try {
      const raw = readFileSync(f);
      text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const parser = new GladLogParser();
    const items: GladMatch[] = [];
    parser.on("match", (m) => items.push(m));
    parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
    for (const m of items) {
      let legacy: ReturnType<typeof toLegacyMatch>;
      try {
        legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
      } catch {
        continue;
      }
      const { friends, enemies } = splitTeams(legacy);
      const units = Object.values(legacy.units);
      const fIds = new Set(friends.map((u) => u.id));
      const eIds = new Set(enemies.map((u) => u.id));
      let ds: ReturnType<typeof reconstructDispelSummary>;
      try {
        ds = reconstructDispelSummary(
          friends,
          enemies,
          legacy,
          units.filter((u) => u.ownerId && fIds.has(u.ownerId)),
          units.filter((u) => u.ownerId && eIds.has(u.ownerId)),
        );
      } catch {
        continue;
      }
      const ws = [...ds.missedCleanseWindows, ...ds.lateCleanseWindows].filter(
        (w) => CORPUS_OBSERVED_DISPEL_IDS.has(w.spellId),
      );
      allWin += ws.length;
      const menuIds = new Set<string>();
      for (const owner of friends) {
        try {
          for (const c of candidatesAsTheAppRuns(legacy, owner.id, text))
            if (c.type === "missed-cleanse") menuIds.add(c.id);
        } catch {
          /* not buildable → excluded */
        }
      }
      for (const w of ws) {
        if (dispelVerdictOf(w.spellId)) continue;
        const k = `${w.spellId} ${getEnglishSpellName(w.spellId, w.spellName)}`;
        const e = win.get(k) ?? { n: 0, menu: 0 };
        e.n++;
        if (
          menuIds.has(
            `missed-cleanse:${w.targetName}:${Math.round(w.timeSeconds)}`,
          )
        )
          e.menu++;
        win.set(k, e);
      }
    }
  }
  for (const [k, e] of [...win].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${k}\twindows=${e.n}\tmenu=${e.menu}`);
  console.log(`  all windows (after the corpus gate) = ${allWin}`);
}
