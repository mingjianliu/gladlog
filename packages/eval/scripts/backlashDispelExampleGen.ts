/**
 * GH #80 value gate step 1 — DETERMINISTIC rendering of what the two new
 * candidate types say on real rounds of the local library (no model call):
 * the menu line the model sees, its legend, and the desktop card text.
 *
 *   npx tsx packages/eval/scripts/backlashDispelExampleGen.ts [--n 8] [--type backlash-dispel|backlash-dispel-window]
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import { extractCandidateFindings } from "@gladlog/analysis/src/analysis/candidateFindings";

import { candidateDetail } from "../../desktop/src/renderer/src/report/derive/mistakes";
import { DEFAULT_MATCH_DIR, loadIndex, loadLegacyRound, pickRows, splitTeams } from "../src/explore/storeAccess";

const argv = process.argv.slice(2);
const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const want = Number(flag("--n") ?? 8);
const onlyType = flag("--type");

async function main(): Promise<void> {
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 });
  let shown = 0, rounds = 0; const perType = new Map<string, number>();
  for (const meta of rows) {
    let legacy: any; try { ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id)); } catch { continue; }
    const { owner, enemies } = splitTeams(legacy); if (!owner || enemies.length === 0) continue;
    rounds++;
    let cands; try { cands = extractCandidateFindings(legacy, owner.id); } catch { continue; }
    for (const c of cands) {
      if (!c.type.startsWith("backlash-dispel")) continue;
      if (onlyType && c.type !== onlyType) continue;
      perType.set(c.type, (perType.get(c.type) ?? 0) + 1);
      if (shown >= want) continue;
      shown++;
      console.log(`\n=== ${meta.id} ${meta.bracket} | owner ${specToString(owner.spec)} ===`);
      console.log(`menu: id=${c.id} type=${c.type} t=${c.t.toFixed(1)} spell=${c.spell}`);
      console.log(`facts: ${Object.entries(c.facts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      console.log(`card: ${candidateDetail(c)}`);
    }
  }
  console.log(`\nrounds ${rounds} | fires: ${[...perType].map(([t, n]) => `${t} ${n}`).join(" | ") || "none"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
