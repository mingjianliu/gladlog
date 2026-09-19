import { ensureAnalysisData } from "@gladlog/analysis";
import { isKillWindowMajorDefensive } from "@gladlog/analysis/src/data/abilityProfile";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellIdListsData from "@gladlog/analysis/src/data/spellIdLists";
async function main() {
  await ensureAnalysisData();
  const hand: string[] = (spellIdListsData as any).externalOrBigDefensiveSpellIds;
  const lost = hand.filter((id) => !isKillWindowMajorDefensive(id));
  console.log(`hand=${hand.length} pass-new-predicate=${hand.length - lost.length} LOST=${lost.length}`);
  for (const id of lost) {
    const eff = (spellEffectData as Record<string, any>)[id];
    console.log(`  ${id} ${eff?.name ?? "?"} cd=${effectiveCooldownSeconds(id) ?? 0}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
