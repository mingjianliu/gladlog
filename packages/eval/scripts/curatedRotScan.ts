/**
 * Curated-List Completeness Rule — the REVERSE pass, as a standing tool.
 *
 * Forward pass (rotScan.ts, dispel completeness in update-wow-data.md) finds
 * ids the corpus uses that no list knows. This one finds the opposite: ids a
 * hand-maintained list asserts something about that the corpus **never
 * shows** — the GH #23 shape, where a patch renumbered a spell and the list
 * kept the dead id looking authoritative. Cost: one set intersection per table.
 *
 * Usage:
 *   tsx packages/eval/scripts/curatedRotScan.ts --observed <ids.json>
 *        [--baseline <ids.json>] [--md <out.md>]
 *
 *   --observed  the corpus-observed id set to judge against (output of
 *               observedSpellIds.ts over the corpus you care about, e.g. the
 *               current season's archive — NOT the cumulative universe, which
 *               still carries every id ever seen and hides staleness).
 *   --baseline  optional: the cumulative universe
 *               (packages/analysis/src/data/observedSpellIdsGenerated.json).
 *               An id absent from BOTH was never seen at all (wrong from day
 *               one, or a passive/talent id that never logs as an event);
 *               absent from --observed only = was live once, gone now →
 *               the renumber signature.
 *
 * Not every zero is a bug: talent ids, passive auras and aura ids that only
 * appear via SPELL_AURA_APPLIED on rare specs legitimately sit at 0 in a
 * week's corpus. The scan ranks; a human (or the next patch-notes audit)
 * adjudicates. Output is a Markdown report, one row per stale id.
 */
import {
  AURA_ONLY_ACTIVATION_IDS,
  CURATED_ID_TABLES,
  getEnglishSpellName,
} from "@gladlog/analysis";
import { readFileSync, writeFileSync } from "fs";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const observedPath = arg("--observed");
if (!observedPath) {
  console.error("Usage: curatedRotScan --observed <ids.json> [--baseline <ids.json>] [--md <out.md>]");
  process.exit(1);
}
const load = (p: string) => new Set((JSON.parse(readFileSync(p, "utf8")) as Array<number | string>).map(String));
const observed = load(observedPath);
const baselinePath = arg("--baseline");
const baseline = baselinePath ? load(baselinePath) : undefined;

interface Row {
  table: string;
  file: string;
  kind: string;
  id: string;
  name: string;
  /** "gone" = in baseline but not observed (renumber signature); "never" = in neither; "?" = no baseline given */
  status: "gone" | "never" | "?";
}
/** 这个 cast id 的证据是不是只存在于它的光环上,而那个光环确实观测到了。 */
function auraAlive(id: string): boolean {
  const auras = (AURA_ONLY_ACTIVATION_IDS as Record<string, string[] | undefined>)[id];
  return auras !== undefined && auras.some((a) => observed.has(a));
}

const rows: Row[] = [];
const perTable: Array<{ name: string; file: string; kind: string; total: number; stale: number }> = [];
for (const t of CURATED_ID_TABLES) {
  const ids = t.ids();
  let stale = 0;
  for (const id of ids) {
    if (observed.has(id)) continue;
    // 无施法行的技能不算腐烂:有些能力**结构上**永远不产生 SPELL_CAST_SUCCESS
    // (复苏烈焰 374348 是被动 proc,唯一会存在的证据是光环 374349),按 cast id
    // 查观测宇宙必然是 0 —— 那不是「这个 id 死了」,是查错了字段。不看这一层的话
    // 扫描会催人删掉一个活得好好的技能:实测归档 400 个文件里 374349 上身 347 次、
    // 周期治疗 3,145 次,而 374348 本身连观测宇宙都进不去,于是它在 6 张表里被
    // 重复报死 6 次(2026-08-23,本条判据落地前的实测)。
    if (auraAlive(id)) continue;
    stale++;
    rows.push({
      table: t.name,
      file: t.file,
      kind: t.kind,
      id,
      name: getEnglishSpellName(id) ?? "",
      status: !baseline ? "?" : baseline.has(id) ? "gone" : "never",
    });
  }
  perTable.push({ name: t.name, file: t.file, kind: t.kind, total: ids.length, stale });
}

const totalIds = perTable.reduce((a, t) => a + t.total, 0);
const gone = rows.filter((r) => r.status === "gone").length;
const never = rows.filter((r) => r.status === "never").length;
const lines: string[] = [];
lines.push(`# Curated-list reverse completeness scan`);
lines.push(``);
lines.push(`- observed set: \`${observedPath}\` (${observed.size} ids)`);
if (baseline) lines.push(`- baseline universe: \`${baselinePath}\` (${baseline.size} ids)`);
lines.push(`- tables: ${perTable.length}, ids asserted: ${totalIds}, **not observed: ${rows.length}**` +
  (baseline ? ` (gone-since-baseline: ${gone}, never-seen: ${never})` : ""));
lines.push(``);
lines.push(`## Per table (worst first)`);
lines.push(``);
lines.push(`| table | kind | ids | stale | stale % |`);
lines.push(`|---|---|---:|---:|---:|`);
for (const t of [...perTable].sort((a, b) => b.stale / b.total - a.stale / a.total || b.stale - a.stale)) {
  lines.push(`| ${t.name} | ${t.kind} | ${t.total} | ${t.stale} | ${((100 * t.stale) / t.total).toFixed(0)}% |`);
}
lines.push(``);
lines.push(`## Stale ids${baseline ? " — \"gone\" first (renumber signature)" : ""}`);
lines.push(``);
lines.push(`| status | table | id | name | file |`);
lines.push(`|---|---|---:|---|---|`);
const order = { gone: 0, never: 1, "?": 2 } as const;
for (const r of [...rows].sort((a, b) => order[a.status] - order[b.status] || a.table.localeCompare(b.table) || Number(a.id) - Number(b.id))) {
  lines.push(`| ${r.status} | ${r.table} | ${r.id} | ${r.name} | ${r.file} |`);
}
const md = lines.join("\n") + "\n";
const out = arg("--md");
if (out) {
  writeFileSync(out, md);
  console.error(`wrote ${out}: ${rows.length}/${totalIds} ids not observed across ${perTable.length} tables`);
} else process.stdout.write(md);
