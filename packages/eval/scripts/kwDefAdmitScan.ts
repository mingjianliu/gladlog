/** GH #31 ② forward scan: which corpus-observed ids does the official face
 * (+cd>=30s) admit as major defensives that the 39-id hand list lacks? */
import { ensureAnalysisData } from "@gladlog/analysis";
import { abilityProfile, isSurvivalWall } from "@gladlog/analysis/src/data/abilityProfile";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellIdListsData from "@gladlog/analysis/src/data/spellIdLists";
import observed from "@gladlog/analysis/src/data/observedSpellIdsGenerated.json";
async function main() {
  await ensureAnalysisData();
  const hand = new Set<string>((spellIdListsData as any).externalOrBigDefensiveSpellIds);
  // observedSpellIdsGenerated.json is an ARRAY of ids (the first run treated it
  // as a record and matched indices — which is why it reported only 1 observed
  // admission; kwDefDiagScan's direct cast-scan later found 14).
  const obs = new Set<string>((observed as unknown as Array<string | number>).map(String));
  const admitted: string[] = [];
  for (const [id, eff] of Object.entries(spellEffectData as Record<string, any>)) {
    if (hand.has(id)) continue;
    const cd = effectiveCooldownSeconds(id) ?? 0;
    if (cd < 30) continue;
    const p = abilityProfile(id);
    if (p.throughputRole) continue;
    const face = (p.mitigationPct ?? 0) >= 20 || p.absorbs || p.immuneSchools !== undefined || isSurvivalWall(id) || (p.healingReceivedPct ?? 0) >= 30;
    if (!face) continue;
    admitted.push(`${id} ${eff.name ?? "?"} cd=${cd} mit=${p.mitigationPct ?? "-"} abs=${p.absorbs} imm=${p.immuneSchools ?? "-"} hRcv=${p.healingReceivedPct ?? "-"} wall=${isSurvivalWall(id)} observed=${obs.has(id)}`);
  }
  const obsOnly = admitted.filter((l) => l.endsWith("observed=true"));
  console.log(`admitted beyond hand list: ${admitted.length} total, ${obsOnly.length} corpus-observed`);
  for (const l of obsOnly) console.log("  " + l);
}
main().catch(e => { console.error(e); process.exit(1); });
