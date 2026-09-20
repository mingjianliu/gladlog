import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { parseLine, splitLine } from "@gladlog/parser";

// Exploratory raw-log inventory, not a completeness or semantic-correctness gate.
// Usage: npx tsx packages/eval/scripts/logObservabilityPilot.ts <manifest> <output.json> [files=24]
// Outputs include private source paths; keep the JSON in GLADLOG_EVAL_HOME.
const [manifest, output, sampleArg = "24"] = process.argv.slice(2);
const count = Number(sampleArg);
if (!manifest || !output || !Number.isSafeInteger(count) || count < 1) {
  throw new Error(
    "usage: logObservabilityPilot.ts <manifest> <new-output.json> [positive file count]",
  );
}
const manifestText = readFileSync(manifest, "utf8");
const paths = manifestText.trim().split(/\r?\n/);
if (paths.length < count || !paths[0])
  throw new Error("manifest has fewer files than requested");
const selected = Array.from(
  { length: count },
  (_, i) => paths[Math.floor(((i + 0.5) * paths.length) / count)],
);
const eventCounts: Record<string, number> = {},
  eventFiles: Record<string, number> = {};
const unknown: Record<string, number> = {},
  powerTypes: Record<string, number> = {};
const npc: Record<
  string,
  {
    summons: number;
    files: number;
    death: number;
    sourceEvents: number;
    damageTaken: number;
    position: number;
  }
> = {};
const stats = {
  lines: 0,
  parsed: 0,
  failed: 0,
  arenaStarts: 0,
  combatantInfo: 0,
  combatantDecoded: 0,
  equipmentSlots: 0,
  enchantSlots: 0,
  bonusSlots: 0,
  gemSlots: 0,
  advanced: 0,
  finiteXY: 0,
  finiteFacing: 0,
  nonzeroFacing: 0,
  powerReadings: 0,
  multiPower: 0,
  healAbsorb: 0,
  empower: 0,
};
const files: Array<{
  path: string;
  sha256: string;
  lines: number;
  summonedGuids: number;
}> = [];
for (const path of selected) {
  const raw = gunzipSync(readFileSync(path)).toString("utf8");
  const rows = raw.split(/\r?\n/).filter(Boolean),
    seen = new Set<string>(),
    summons = new Map<string, string>(),
    dead = new Set<string>();
  const sources = new Map<string, number>(),
    damage = new Map<string, number>(),
    positions = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) =>
    m.set(k, (m.get(k) || 0) + 1);
  for (const row of rows) {
    stats.lines++;
    const split = splitLine(row);
    if (!split) {
      stats.failed++;
      continue;
    }
    const e = split.eventName;
    eventCounts[e] = (eventCounts[e] || 0) + 1;
    seen.add(e);
    const p = parseLine(row);
    if (!p) {
      stats.failed++;
      continue;
    }
    stats.parsed++;
    if (!p.known) unknown[e] = (unknown[e] || 0) + 1;
    if (e === "ARENA_MATCH_START") stats.arenaStarts++;
    if (e === "COMBATANT_INFO") {
      stats.combatantInfo++;
      if (p.combatantInfo) {
        stats.combatantDecoded++;
        for (const eq of p.combatantInfo.equipment) {
          if (!Array.isArray(eq)) continue;
          stats.equipmentSlots++;
          if (Array.isArray(eq[2]) && eq[2].some(Number)) stats.enchantSlots++;
          if (Array.isArray(eq[3]) && eq[3].some(Number)) stats.bonusSlots++;
          if (Array.isArray(eq[4]) && eq[4].some(Number)) stats.gemSlots++;
        }
      }
    }
    if (p.healAbsorbed) stats.healAbsorb++;
    if (p.empowerLevel !== undefined) stats.empower++;
    if (e === "SPELL_SUMMON") {
      const id = split.params[4];
      if (/^(Creature|Pet|Vehicle|GameObject)-/.test(id))
        summons.set(id, id.split("-")[5]);
    }
    if (e === "UNIT_DIED") dead.add(split.params[4]);
    if (p.base) {
      bump(sources, p.base.srcGuid);
      if (p.damage) bump(damage, p.base.destGuid);
    }
    const a = p.advanced;
    if (a && /^(Player|Creature|Pet|Vehicle|GameObject)-/.test(a.actorGuid)) {
      stats.advanced++;
      if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
        stats.finiteXY++;
        bump(positions, a.actorGuid);
      }
      if (Number.isFinite(a.facing)) {
        stats.finiteFacing++;
        if (a.facing !== 0) stats.nonzeroFacing++;
      }
      const valid = a.powers.filter(
        (v) =>
          Number.isFinite(v.current) && Number.isFinite(v.max) && v.max > 0,
      );
      stats.powerReadings += valid.length;
      if (valid.length > 1) stats.multiPower++;
      for (const v of valid)
        powerTypes[v.powerType] = (powerTypes[v.powerType] || 0) + 1;
    }
  }
  const npcSeen = new Set<string>();
  for (const [guid, id] of summons) {
    const n = (npc[id] ??= {
      summons: 0,
      files: 0,
      death: 0,
      sourceEvents: 0,
      damageTaken: 0,
      position: 0,
    });
    n.summons++;
    if (dead.has(guid)) n.death++;
    if (sources.has(guid)) n.sourceEvents++;
    if (damage.has(guid)) n.damageTaken++;
    if (positions.has(guid)) n.position++;
    npcSeen.add(id);
  }
  for (const id of npcSeen) npc[id].files++;
  for (const e of seen) eventFiles[e] = (eventFiles[e] || 0) + 1;
  files.push({
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
    lines: rows.length,
    summonedGuids: summons.size,
  });
  console.error(`done ${files.length}/${count}: ${rows.length} lines`);
}
const out = {
  manifest,
  manifestFiles: paths.length,
  manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
  sampling: `${count} evenly spaced file-index midpoints; exploratory, not representative or independent matches; no round segmentation; NPC matches within file, not lifetime proof`,
  stats,
  eventCounts,
  eventFiles,
  unknown,
  powerTypes,
  npc,
  files,
};
writeFileSync(output, JSON.stringify(out, null, 2), { flag: "wx" });
console.log(
  JSON.stringify(
    {
      manifestFiles: paths.length,
      sampledFiles: files.length,
      stats,
      unknown,
      output,
    },
    null,
    2,
  ),
);
