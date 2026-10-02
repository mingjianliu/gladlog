/**
 * Forward check for the offensive-purger roster (`canOffensivePurge`:
 * OFFENSIVE_PURGERS + the DH / Hunter talent gates + the PvP-talent path;
 * CLAUDE.md Curated-List Completeness Rule; triage 2026-09-29 missed-cleanse
 * F-P5). Ground truth: every player who removed an enemy buff (our side's
 * `ourPurges`, the enemy side's `hostilePurges`, pet dispels folded to the
 * owner) — a spec that did it but `canOffensivePurge` rejects is a roster gap
 * (the Devourer DH and every Hunter spec before 2026-09-30). Expected: 0 rows,
 * except players whose talent gate genuinely failed (reported with their
 * dispel spell so a stale gate id shows).
 *
 * User ruling P-P5b = C (2026-10-01): each REMOVAL counts within its own
 * scope. A removal is explained by the Magic-purge roster, or by a scoped tool
 * its player holds that covers the removed aura (`scopedPurgeToolsOf` /
 * `scopedToolRemoves`: Shattering Throw → immunity shields, Shiv → enrage,
 * an observed Arcane Torrent → Magic buffs). Disentanglement and a defensive
 * cleanse landing on an enemy unit (one a teammate Mind-Controlled) count by
 * what they can dispel: Disentanglement by its id (snares off its own side),
 * a cleanse spell when the removed aura's dispel type is one the player
 * defensively cleanses (`canDefensiveCleanse`). Those are cleanses, counted
 * in their own column, never a roster gap. Anything left is a gap: a new
 * tool, or a scope set (`SHATTERING_THROW_REMOVES`, `SHIV_REMOVES`) missing
 * an id.
 *
 *   npx tsx packages/eval/scripts/purgerRosterScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt --every 30
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import { DISENTANGLEMENT_EFFECT_ID } from "@gladlog/analysis/src/data/scopedPurges";
import {
  canDefensiveCleanse,
  canOffensivePurge,
  CLEANSE_SPELLS_BY_TYPE,
  getDispelType,
  reconstructDispelSummary,
  scopedPurgeToolsOf,
  scopedToolRemoves,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const manifest = arg("--manifest");
if (!manifest) {
  console.error("usage: purgerRosterScan.ts --manifest <path> [--every N]");
  process.exit(1);
}
const every = Number(arg("--every") ?? "1");
await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const bySpec = new Map<
  string,
  {
    removals: number;
    roster: number;
    scoped: number;
    cleanses: number;
    rejected: number;
    spells: Map<string, number>;
  }
>();
/** every defensive cleanse spell of any spec */
const CLEANSE_SPELL_IDS = new Set<string>(
  Object.values(CLEANSE_SPELLS_BY_TYPE).flatMap((bySpecIds) =>
    Object.values(bySpecIds ?? {}).flatMap((ids) => [...(ids ?? [])]),
  ),
);
/** A cleanse counted by what it can dispel (P-P5b = C): Disentanglement, or a
 *  cleanse spell removing a dispel type this player defensively cleanses. */
function isOwnTypeCleanse(
  u: ICombatUnit,
  dispelSpellId: string,
  removedSpellId: string,
): boolean {
  if (dispelSpellId === DISENTANGLEMENT_EFFECT_ID) return true;
  if (!CLEANSE_SPELL_IDS.has(dispelSpellId)) return false;
  const type = getDispelType(removedSpellId);
  return type !== null && canDefensiveCleanse(u, type);
}
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
    const byName = new Map<string, ICombatUnit>(
      [...friends, ...enemies].map((u) => [u.name, u]),
    );
    const toolsOf = new Map<string, ReturnType<typeof scopedPurgeToolsOf>>();
    for (const p of [...ds.ourPurges, ...ds.hostilePurges]) {
      const u = byName.get(p.sourceName);
      if (!u) continue;
      const k = `${u.spec} ${specToString(u.spec)}`;
      const e = bySpec.get(k) ?? {
        removals: 0,
        roster: 0,
        scoped: 0,
        cleanses: 0,
        rejected: 0,
        spells: new Map<string, number>(),
      };
      e.removals++;
      const tools = toolsOf.get(u.id) ?? scopedPurgeToolsOf(u);
      toolsOf.set(u.id, tools);
      if (canOffensivePurge(u)) e.roster++;
      else if (tools.some((t) => scopedToolRemoves(t, p.removedSpellId)))
        e.scoped++;
      else if (isOwnTypeCleanse(u, p.dispelSpellId, p.removedSpellId))
        e.cleanses++;
      else {
        e.rejected++;
        const sk = `${p.dispelSpellId} ${p.dispelSpellName} → ${p.removedSpellId} ${p.removedSpellName}`;
        e.spells.set(sk, (e.spells.get(sk) ?? 0) + 1);
      }
      bySpec.set(k, e);
    }
  }
}
console.log(`files=${files.length}`);
console.log(
  "spec\tremovals\tby the Magic-purge roster\tby a scoped tool\tcleanses on an enemy unit\tunexplained\tunexplained: dispel spell → removed aura",
);
for (const [k, e] of [...bySpec].sort((a, b) => b[1].rejected - a[1].rejected))
  console.log(
    `${k}\t${e.removals}\t${e.roster}\t${e.scoped}\t${e.cleanses}\t${e.rejected}\t${[...e.spells]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}×${n}`)
      .join("; ")}`,
  );
