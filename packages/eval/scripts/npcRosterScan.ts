/**
 * Direction 4 of the log-observability audit (GH #100): the observed NPC
 * roster versus CRITICAL_NON_PLAYER_NPC_NAMES, the hand list that decides which
 * non-player deaths the prompt prints as [UNIT DESTROYED]. CLAUDE.md's
 * Curated-List Completeness Rule, both directions:
 *   forward — summoned npcIds the list does not know, ranked by how often
 *             players actually kill them (a unit nobody attacks is not a
 *             coaching fact whether listed or not);
 *   reverse — listed npcIds with zero occurrences in the slice (renumbered or
 *             removed).
 * Lifecycle honesty: a summon with no UNIT_DIED is "end unknown", never
 * "survived"; the last event naming a unit is not its despawn time.
 *
 * Usage: npx tsx packages/eval/scripts/npcRosterScan.ts --manifest <txt> [--offset 0] [--limit 600] --out <new.json>
 */
import { CRITICAL_NON_PLAYER_NPC_NAMES } from "@gladlog/analysis/src/context/timelineHelpers";
import { parseLine } from "@gladlog/parser";
import { readFileSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const out = flag("--out");
if (!flag("--manifest") || !out) throw new Error("--manifest and --out");
const files = readFileSync(flag("--manifest")!, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(Number(flag("--offset") ?? 0))
  .slice(0, Number(flag("--limit") ?? 600));

const npcIdOf = (guid: string): string | null => {
  const parts = guid.split("-");
  return /^(Creature|Vehicle|Pet)$/.test(parts[0]) && parts.length >= 7
    ? parts[5]
    : null;
};

type Row = {
  npcId: string;
  listed: boolean;
  name: string;
  summons: number;
  files: number;
  summonSpells: Record<string, number>;
  unitsHitByEnemyPlayers: number;
  unitsDied: number;
  /** units that took a damage event with overkill > 0 from an enemy player */
  unitsKilledByOverkill: number;
  damageTaken: number;
};
const rows = new Map<string, Row>();
let scanned = 0;

for (const path of files) {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  scanned++;
  const seenInFile = new Set<string>();
  const summoned = new Map<string, { npcId: string; owner: string }>();
  const hit = new Set<string>();
  const died = new Set<string>();
  const overkilled = new Set<string>();
  const team = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.eventName === "COMBATANT_INFO") team.set(p.params[0], p.params[1]);
    if (!p.base) continue;
    const { srcGuid, destGuid } = p.base;
    if (p.eventName === "SPELL_SUMMON") {
      const npcId = npcIdOf(destGuid);
      if (!npcId) continue;
      summoned.set(destGuid, { npcId, owner: srcGuid });
      const row =
        rows.get(npcId) ??
        rows
          .set(npcId, {
            npcId,
            listed: npcId in CRITICAL_NON_PLAYER_NPC_NAMES,
            name: p.params[5]?.replace(/"/g, "") ?? "",
            summons: 0,
            files: 0,
            summonSpells: {},
            unitsHitByEnemyPlayers: 0,
            unitsDied: 0,
            unitsKilledByOverkill: 0,
            damageTaken: 0,
          })
          .get(npcId)!;
      row.summons++;
      if (!seenInFile.has(npcId)) {
        seenInFile.add(npcId);
        row.files++;
      }
      const spell = `${p.params[8]} ${p.params[9]?.replace(/"/g, "")}`;
      row.summonSpells[spell] = (row.summonSpells[spell] ?? 0) + 1;
      continue;
    }
    const s = summoned.get(destGuid);
    if (!s) continue;
    const row = rows.get(s.npcId)!;
    if (p.damage && srcGuid.startsWith("Player-")) {
      // an ENEMY player: different team from the summoner, when both known
      const a = team.get(srcGuid);
      const b = team.get(s.owner);
      if (a !== undefined && b !== undefined && a !== b) {
        row.damageTaken += Math.abs(p.damage.amount ?? 0);
        if (!hit.has(destGuid)) {
          hit.add(destGuid);
          row.unitsHitByEnemyPlayers++;
        }
        if ((p.damage.overkill ?? 0) > 0 && !overkilled.has(destGuid)) {
          overkilled.add(destGuid);
          row.unitsKilledByOverkill++;
        }
      }
    }
    if (p.eventName === "UNIT_DIED" && !died.has(destGuid)) {
      died.add(destGuid);
      row.unitsDied++;
    }
  }
}

const all = [...rows.values()];
const top = (r: Row) =>
  Object.entries(r.summonSpells).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
const view = (r: Row) => ({
  npcId: r.npcId,
  name: r.name,
  summons: r.summons,
  files: r.files,
  hitByEnemyShare: +(r.unitsHitByEnemyPlayers / r.summons).toFixed(3),
  diedShare: +(r.unitsDied / r.summons).toFixed(3),
  killedByOverkill: r.unitsKilledByOverkill,
  killedByOverkillShare: +(r.unitsKilledByOverkill / r.summons).toFixed(3),
  topSummonSpell: top(r),
});
const result = {
  scannedFiles: scanned,
  scope:
    "npcId = GUID field 6 of a SPELL_SUMMON destination. hitByEnemyShare = summoned units damaged at least once by a player on the other team from the summoner. diedShare = units with a UNIT_DIED; killedByOverkill = units that took enemy-player damage with overkill > 0 (the only kill evidence when no UNIT_DIED is logged); everything else is END UNKNOWN, not a survivor. Names are the recorder's client locale.",
  distinctNpcIds: all.length,
  listedEntries: Object.keys(CRITICAL_NON_PLAYER_NPC_NAMES).length,
  reverse_listedButNeverSummoned: Object.entries(CRITICAL_NON_PLAYER_NPC_NAMES)
    .filter(([id]) => !rows.has(id))
    .map(([id, name]) => ({ npcId: id, name })),
  listedObserved: all
    .filter((r) => r.listed)
    .sort((a, b) => b.summons - a.summons)
    .map(view),
  forward_unlistedAttacked: all
    .filter((r) => !r.listed && r.unitsHitByEnemyPlayers >= 5)
    .sort((a, b) => b.unitsHitByEnemyPlayers - a.unitsHitByEnemyPlayers)
    .map(view),
  unlistedRarelyAttacked: all
    .filter((r) => !r.listed && r.unitsHitByEnemyPlayers < 5)
    .sort((a, b) => b.summons - a.summons)
    .slice(0, 40)
    .map(view),
};
writeFileSync(out, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
