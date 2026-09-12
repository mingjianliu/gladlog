/**
 * Which interrupt each spec can have, from OFFICIAL data (GH #78, user
 * correction 2026-09-12 "奶龙和奶骑是没有打断的 … 能不能从官方的数据弄清楚"):
 *
 *   class baseline  DB2 SkillLineAbility.ClassMask (bit n = class id n+1):
 *                   Pummel → Warrior, Kick → Rogue, Counterspell → Mage,
 *                   Disrupt → Demon Hunter
 *   spec baseline   DB2 SpecializationSpells (Silence → Shadow 258)
 *   talent          the spec's own talent tree (talentIdMap.json, Raidbots'
 *                   export of the DB2 trait tables): Rebuke is a class-tree
 *                   node that only Protection / Retribution can see, Quell a
 *                   spec-tree node of Devastation / Augmentation, Skull Bash
 *                   Feral / Guardian, Spear Hand Strike Brewmaster /
 *                   Windwalker, Solar Beam Balance; Wind Shear / Mind Freeze /
 *                   Counter Shot / Muzzle are tree nodes for every spec of
 *                   their class — all of these count only when the player's
 *                   COMBATANT_INFO shows the node taken (id1 = node, id2 = entry).
 *   pet             SkillLineAbility rows on a pet skill line (ClassMask 0):
 *                   Spell Lock 19647 (Felhunter), Axe Toss 89766 (Felguard) —
 *                   possession is OBSERVED (the pet cast it), never assumed.
 *
 * Id universe = SPELL_CATEGORIES type "interrupts" (the roster kickAudit and
 * the stats table already use). Corpus cross-check 2026-09-12 (704 files,
 * every 30th of the archive): Holy Paladin 0 % of rounds cast an interrupt,
 * Preservation 0 %, Restoration Druid 0 %, Mistweaver 0 %, Discipline / Holy
 * Priest 0 %, Demonology 0 % — the specs this table gives no interrupt; every
 * spec it gives one casts it in 57–98 % of rounds.
 *
 *   DATAGEN_BUILD=<build> DATAGEN_CACHE=~/.cache/gladlog-datagen \
 *     npx tsx packages/analysis/scripts/datagen/genInterruptKit.ts
 */
import { SPELL_CATEGORIES } from "../../src/data/spellCategories";
import { getEnglishSpellName } from "../../src/data/spellEffectData";
import talentTrees from "../../src/data/talentIdMap.json";
import { writeArtifact } from "./lib/emit";
import { assertColumns, fetchTable, parseCsv, resolveBuild } from "./lib/wagoCsv";

const PET_SKILL_LINES = new Set(["189", "761", "931"]); // Felhunter, Felguard (two lines)

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const sla = parseCsv(await fetchTable("SkillLineAbility", build, cacheDir));
  const ss = parseCsv(await fetchTable("SpecializationSpells", build, cacheDir));
  assertColumns(sla.header, ["Spell", "ClassMask", "SkillLine"], "SkillLineAbility");
  assertColumns(ss.header, ["SpecID", "SpellID"], "SpecializationSpells");
  const roster = Object.entries(SPELL_CATEGORIES as Record<string, { type: string; name?: string }>)
    .filter(([, v]) => v.type === "interrupts")
    .map(([id]) => [id, getEnglishSpellName(id, id)] as const);
  const rosterIds = new Set(roster.map(([id]) => id));

  const out: Record<string, { name: string; classBaseline: number[]; specBaseline: number[]; talent: Record<string, { nodeId: number; entryId: number }>; pet: boolean }> = {};
  for (const [id, name] of roster) out[id] = { name, classBaseline: [], specBaseline: [], talent: {}, pet: false };

  // parseCsv rows are keyed by header name (same access genSpellReach uses)
  for (const r of sla.rows as unknown as Array<Record<string, string>>) {
    const id = String(r["Spell"]);
    if (!rosterIds.has(id)) continue;
    const mask = Number(r["ClassMask"]) >>> 0;
    if (PET_SKILL_LINES.has(String(r["SkillLine"]))) out[id]!.pet = true;
    for (let bit = 0; bit < 32; bit++) if (mask & (1 << bit)) { const cls = bit + 1; if (!out[id]!.classBaseline.includes(cls)) out[id]!.classBaseline.push(cls); }
  }
  for (const r of ss.rows as unknown as Array<Record<string, string>>) {
    const id = String(r["SpellID"]);
    if (!rosterIds.has(id)) continue;
    const spec = Number(r["SpecID"]);
    if (!out[id]!.specBaseline.includes(spec)) out[id]!.specBaseline.push(spec);
  }
  for (const tree of talentTrees as Array<{ specId: number; classNodes: any[]; specNodes: any[]; heroNodes: any[]; subTreeNodes: any[] }>) {
    for (const key of ["classNodes", "specNodes", "heroNodes", "subTreeNodes"] as const)
      for (const node of tree[key] ?? [])
        for (const e of node.entries ?? []) {
          const id = String(e.spellId);
          if (!rosterIds.has(id)) continue;
          out[id]!.talent[String(tree.specId)] = { nodeId: node.id, entryId: e.id };
        }
  }
  const outPath = new URL("../../src/data/interruptKitGenerated.json", import.meta.url).pathname;
  writeArtifact(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), build, interrupts: out }, null, 2) + "\n");
  for (const [id, v] of Object.entries(out)) console.log(`${id} ${v.name.padEnd(22)} class ${JSON.stringify(v.classBaseline)} spec ${JSON.stringify(v.specBaseline)} talent specs ${Object.keys(v.talent).join(",") || "-"}${v.pet ? " PET" : ""}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
