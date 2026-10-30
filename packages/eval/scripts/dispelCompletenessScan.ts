/**
 * Forward completeness check for dispels (update-wow-data.md Notes, as a tool):
 * every cross-unit DEBUFF dispel the corpus recorded, cross-referenced against
 * the official path getDispelType(). Input = the awk extraction from the
 * runbook, one line per (removed id, removed name, caster ability):
 *   <count> <removedId>|"<name>"|<byId>|"<byName>"
 * Residue to expect (not gaps): snares/roots stripped by Freedom-class
 * effects (Disentanglement, Jet Stream, Master's Call). Cyclone by Mass
 * Dispel is an explicit exemption since 2026-08-27 (GH #33, `MD_IDS`), not
 * residue. 2026-08-21 S2 archive: 294,282 events, 2.69% residue, all of it
 * that class.
 *
 * Usage: tsx packages/eval/scripts/dispelCompletenessScan.ts <dispel-counts.txt>
 */
import { getDispelType } from "@gladlog/analysis";
import { MD_SPELL_ID } from "@gladlog/analysis/src/analysis/candidates/massDispel";
import { readFileSync } from "fs";
// Mass Dispel ignores the DispelType flag: the cast is 32375 (MD_SPELL_ID), the
// dispel effect sometimes logs as 32592 (see dispelKind.ts). Cyclone 33786 is the
// canonical case — official DispelType=0 (verified 12.1.0.69382, GH #33) yet
// dispelled 35/35 times by MD in the local library. Explained, not a gap.
const MD_IDS = new Set([MD_SPELL_ID, "32592"]);
const rows = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((l) => {
    const m = l
      .trim()
      .match(/^(\d+) (\d+)\|"?([^"|]*)"?\|(\d+)\|"?([^"|]*)"?$/);
    return m
      ? { n: +m[1], id: m[2], name: m[3], by: m[4], byName: m[5] }
      : null;
  })
  .filter((x): x is NonNullable<typeof x> => !!x);
const byId = new Map<string, { n: number; name: string }>();
const mdOnly = new Set<string>();
for (const r of rows) {
  const e = byId.get(r.id) ?? { n: 0, name: r.name };
  e.n += r.n;
  byId.set(r.id, e);
  if (MD_IDS.has(r.by)) mdOnly.add(r.id);
}
let total = 0,
  unexplained = 0;
const bad: Array<[string, string, number]> = [];
let mdExplained = 0;
for (const [id, e] of byId) {
  total += e.n;
  if (getDispelType(id)) continue;
  if (mdOnly.has(id)) {
    mdExplained += e.n;
    continue;
  }
  unexplained += e.n;
  bad.push([id, e.name, e.n]);
}
bad.sort((a, b) => b[2] - a[2]);
console.log(
  `dispel events: ${total}, distinct removed ids: ${byId.size}, unexplained by getDispelType: ${bad.length} ids / ${unexplained} events (${((100 * unexplained) / total).toFixed(2)}%); explained by the Mass Dispel exemption: ${mdExplained} events`,
);
for (const [id, name, n] of bad.slice(0, 40))
  console.log(`${n}\t${id}\t${name}`);
