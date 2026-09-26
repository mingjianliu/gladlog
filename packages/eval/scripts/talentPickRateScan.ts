/**
 * talentPickRateScan.ts — how many players of each spec actually take each
 * talent (tree talents and PvP talents), from COMBATANT_INFO only.
 *
 * Why (user 2026-09-13): the talent catalog shows 2,087 talents with no code
 * reference; before integrating them the user asked how much each one matters
 * in real games. Pick rate is the exposure weight — a modifier nobody takes
 * cannot make coaching wrong; one 95 % of a spec takes can.
 *
 * Only COMBATANT_INFO lines are decoded (no match build), so a large manifest
 * slice is cheap. A loadout is counted once per (file, player GUID, loadout
 * string): Solo Shuffle repeats the line every round, and a player who swaps
 * talents between rounds counts once per distinct loadout.
 *
 * Selected spells come from the product's own predicate
 * (`getPlayerTalentedSpellInfo`, choice nodes count only the chosen entry);
 * loadouts `isLoadoutFullyResolved` rejects (other build / pet-tree rows) are
 * counted separately and excluded from the denominators. Free / entry nodes
 * are auto-granted and not reported in COMBATANT_INFO — listed as "auto".
 *
 * Usage:
 *   npx tsx packages/eval/scripts/talentPickRateScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt [--every 10]
 * Output: $GLADLOG_EVAL_HOME/reports/talent-catalog-2026-09-13/pickrates.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  getPlayerTalentedSpellInfo,
  getSpecFreeOrEntrySpellIds,
  isLoadoutFullyResolved,
} from "@gladlog/analysis/src/utils/talents";
import { parseLine } from "@gladlog/parser";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "10"));
if (!manifest) {
  console.error("usage: talentPickRateScan.ts --manifest <path> [--every N]");
  process.exit(1);
}

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const bySpec: Record<
  string,
  {
    loadouts: number;
    unresolved: number;
    tree: Record<string, number>;
    pvp: Record<string, number>;
  }
> = {};
let lines = 0;
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.includes("COMBATANT_INFO")) continue;
    const pl = parseLine(line);
    const ci: any = pl?.combatantInfo;
    if (!ci || !ci.specId) continue;
    lines++;
    const key = `${ci.playerGuid}|${JSON.stringify(ci.talents)}|${JSON.stringify(ci.pvpTalents)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = String(ci.specId);
    const b = (bySpec[spec] ??= {
      loadouts: 0,
      unresolved: 0,
      tree: {},
      pvp: {},
    });
    const talents = (ci.talents as number[][]).map((t) => ({
      id1: t[0]!,
      id2: t[1]!,
      count: t[2] ?? 1,
    }));
    if (!isLoadoutFullyResolved(ci.specId, talents)) {
      b.unresolved++;
      continue;
    }
    const sel = getPlayerTalentedSpellInfo(ci.specId, talents);
    if (!sel) {
      b.unresolved++;
      continue;
    }
    b.loadouts++;
    for (const id of sel.keys()) b.tree[id] = (b.tree[id] ?? 0) + 1;
    for (const id of ci.pvpTalents as number[])
      if (id) b.pvp[String(id)] = (b.pvp[String(id)] ?? 0) + 1;
  }
}

const out: Record<string, unknown> = {};
for (const [spec, b] of Object.entries(bySpec)) {
  out[spec] = {
    loadouts: b.loadouts,
    unresolved: b.unresolved,
    auto: [...getSpecFreeOrEntrySpellIds(Number(spec))],
    tree: b.tree,
    pvp: b.pvp,
  };
}
const dir = join(
  process.env.GLADLOG_EVAL_HOME ??
    join(process.env.HOME ?? "", "code/gladlog-eval-private"),
  "reports/talent-catalog-2026-09-13",
);
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "pickrates.json"),
  JSON.stringify(
    { files: files.length, combatantLines: lines, bySpec: out },
    null,
    1,
  ),
);
console.log(
  JSON.stringify({
    files: files.length,
    combatantLines: lines,
    specs: Object.keys(out).length,
    loadouts: Object.values(bySpec).reduce((n, b) => n + b.loadouts, 0),
    unresolved: Object.values(bySpec).reduce((n, b) => n + b.unresolved, 0),
  }),
);
