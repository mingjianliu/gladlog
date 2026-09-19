import { ensureAnalysisData } from "@gladlog/analysis";
import { isKillWindowMajorDefensive } from "@gladlog/analysis/src/data/abilityProfile";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellIdListsData from "@gladlog/analysis/src/data/spellIdLists";
import { GladLogParser } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";
async function main() {
  await ensureAnalysisData();
  const hand = new Set<string>((spellIdListsData as any).externalOrBigDefensiveSpellIds);
  const files = readFileSync(process.argv[2]!, "utf8").split("\n").map(s => s.trim()).filter(Boolean).slice(0, 200);
  const counts = new Map<string, number>();
  for (const path of files) {
    let text: string; try { text = gunzipSync(readFileSync(path)).toString("utf8"); } catch { continue; }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => { for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r); });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch { continue; }
    for (const combat of combats) {
      for (const u of Object.values(combat?.units ?? {}) as any[]) {
        if (!u.info || u.reaction !== CombatUnitReaction.Hostile) continue;
        for (const c of (u.spellCastEvents ?? []) as any[]) {
          const id = String(c.spellId ?? "");
          if (!id || hand.has(id)) continue;
          if (!isKillWindowMajorDefensive(id)) continue;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`beyond-hand admitted ids observed in enemy casts: ${rows.length}`);
  for (const [id, n] of rows.slice(0, 20)) {
    const eff = (spellEffectData as Record<string, any>)[id];
    console.log(`  ${id} ${eff?.name ?? "?"} casts=${n} cd=${effectiveCooldownSeconds(id) ?? 0}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
