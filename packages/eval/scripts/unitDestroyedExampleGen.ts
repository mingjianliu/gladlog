/**
 * unitDestroyedExampleGen.ts — value-gate example generator (GH #100
 * direction 4). `[UNIT DESTROYED]` keys on UNIT_DIED, which 12.x logs no
 * longer emit for totems/guardians (npcRosterScan.ts: 5 of 13,439 listed
 * units). This renders, for real matches, the lines the coach gets TODAY next
 * to the lines it would get if a kill were read from enemy-player damage with
 * overkill > 0. No model calls; the list and the name table are the product's.
 *
 * Usage: npx tsx packages/eval/scripts/unitDestroyedExampleGen.ts --manifest <txt> [--offset 0] [--limit 40] [--show 3]
 */
import { CRITICAL_NON_PLAYER_NPC_NAMES } from "@gladlog/analysis/src/context/timelineHelpers";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { GladLogParser, parseLine } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const parseNonNegativeInt = (name: string, defaultVal: number): number => {
  const raw = flag(name);
  if (raw === undefined) return defaultVal;
  const val = Number(raw);
  if (!Number.isInteger(val) || val < 0) {
    throw new Error(`expected non-negative integer for ${name}, got: ${raw}`);
  }
  return val;
};

const manifestPath = flag("--manifest");
if (!manifestPath) {
  throw new Error("missing required --manifest <path>");
}
const offset = parseNonNegativeInt("--offset", 0);
const limit = parseNonNegativeInt("--limit", 40);
const show = parseNonNegativeInt("--show", 3);

let manifestRaw: string;
try {
  manifestRaw = readFileSync(manifestPath, "utf8");
} catch (err) {
  throw new Error(
    `failed to read manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
  );
}
const files = manifestRaw
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(offset, offset + limit);

const blocks: Array<{ n: number; text: string }> = [];
let rounds = 0;
let roundsWithAny = 0;
let totalToday = 0;
let totalProposed = 0;
let readFiles = 0;
let skippedFiles = 0;

for (const path of files) {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    readFiles++;
  } catch (err) {
    skippedFiles++;
    process.stderr.write(
      `[warn] failed to read ${path}: ${err instanceof Error ? err.message : String(err)}, skipping\n`,
    );
    continue;
  }
  const lines = text.split(/\r?\n/);
  const combats: any[] = [];
  try {
    const parser = new GladLogParser();
    parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
    parser.on("shuffle", (sh: any) => {
      for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
    });
    for (const line of lines) parser.push(line);
    parser.end();
  } catch (err) {
    process.stderr.write(
      `[warn] failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}, skipping\n`,
    );
    continue;
  }
  const kills: Array<{ t: number; dest: string; src: string; spell: string }> =
    [];
  const seen = new Set<string>();
  for (const line of lines) {
    const p = parseLine(line);
    if (!p?.damage || !p.base || !((p.damage.overkill ?? 0) > 0)) continue;
    const parts = p.base.destGuid.split("-");
    if (parts[0] !== "Creature" || !(parts[5] in CRITICAL_NON_PLAYER_NPC_NAMES))
      continue;
    if (!p.base.srcGuid.startsWith("Player-") || seen.has(p.base.destGuid))
      continue;
    seen.add(p.base.destGuid);
    kills.push({
      t: p.timestamp,
      dest: p.base.destGuid,
      src: p.base.srcGuid,
      spell: p.spell?.spellName ?? "Melee",
    });
  }
  for (const combat of combats) {
    rounds++;
    const units: Record<string, any> = combat.units ?? {};
    const players = Object.values(units).filter((u: any) => u.info);
    const label = (guid: string): string => {
      const u: any = units[guid];
      if (!u) return "unknown";
      const side =
        u.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Enemy";
      return `${side} ${String(u.info?.specName ?? u.spec ?? "player")}`;
    };
    const today = Object.values(units).filter(
      (u: any) =>
        !u.info &&
        (u.deathRecords?.length ?? 0) > 0 &&
        u.id.split("-")[5] in CRITICAL_NON_PLAYER_NPC_NAMES,
    ).length;
    const mine = kills.filter(
      (k) => k.t >= combat.startTime && k.t <= combat.endTime,
    );
    totalToday += today;
    totalProposed += mine.length;
    if (!mine.length) continue;
    roundsWithAny++;
    const out = mine.map((k) => {
      const owner: any = units[units[k.dest]?.ownerId ?? ""];
      const side =
        owner?.reaction === CombatUnitReaction.Friendly
          ? "Friendly"
          : owner?.reaction === CombatUnitReaction.Hostile
            ? "Enemy"
            : "Unknown";
      return `    ${fmtTime((k.t - combat.startTime) / 1000)}  [UNIT DESTROYED]   ${CRITICAL_NON_PLAYER_NPC_NAMES[k.dest.split("-")[5]]} (${side}) killed by: ${label(k.src)} (${k.spell})`;
    });
    blocks.push({
      n: mine.length,
      text:
        `${players.length} players, ${fmtTime((combat.endTime - combat.startTime) / 1000)} long\n` +
        `  TODAY     ${today} [UNIT DESTROYED] line(s)\n` +
        `  PROPOSED  ${mine.length} line(s):\n${out.join("\n")}`,
    });
  }
}
console.log(
  JSON.stringify({
    selectedFiles: files.length,
    readFiles,
    skippedFiles,
    rounds,
    roundsWithAny,
    totalToday,
    totalProposed,
  }),
);
blocks.sort((a, b) => a.n - b.n);
const mid = Math.floor(blocks.length / 2);
for (const b of blocks.slice(mid, mid + show)) console.log("\n" + b.text);
console.log("\n— busiest round —\n" + (blocks.at(-1)?.text ?? ""));
