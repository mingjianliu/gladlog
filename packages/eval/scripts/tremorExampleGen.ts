/**
 * tremorExampleGen.ts — exploratory / historical value-gate generator (GH #100 direction 4,
 * user 2026-09-20: establish the facts first; a context line is "most likely
 * yes" but decided later). Renders, for real matches, the ONE tremor fact the
 * log supports: a friendly Tremor Totem dropped while a teammate was feared,
 * and the fear ending the same instant.
 *
 * NOTE: Output is stdout JSON summary followed by example strings (not TSV).
 * This diagnostic script uses SPELL_SUMMON + 500ms; the shipped production
 * predicate uses tremorTotemBreak (ccTrinketAnalysis.ts) with SPELL_CAST_SUCCESS.
 * Seconds cut represents nominal duration difference (full - lasted).
 *
 * Usage: npx tsx packages/eval/scripts/tremorExampleGen.ts --manifest <txt> [--offset 3000] [--limit 200] [--show 4]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { ccFullDurationSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import { TREMOR_BREAKABLE_CC_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { parseLine } from "@gladlog/parser";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
/** Removal this close after the totem lands counts as the totem's doing. */
const SAME_INSTANT_MS = 500;
const SPEC: Record<number, string> = {
  262: "EleShaman",
  263: "EnhShaman",
  264: "RShaman",
  256: "DPriest",
  257: "HPriest",
  258: "SPriest",
  65: "HPaladin",
  105: "RDruid",
  270: "MWMonk",
  1468: "PEvoker",
};

async function main(): Promise<void> {
  const manifestPath = flag("--manifest");
  if (!manifestPath) {
    throw new Error("missing required --manifest <path>");
  }
  const parseNonNegativeInt = (name: string, defaultVal: number): number => {
    const raw = flag(name);
    if (raw === undefined) return defaultVal;
    const val = Number(raw);
    if (!Number.isInteger(val) || val < 0) {
      throw new Error(`expected non-negative integer for ${name}, got: ${raw}`);
    }
    return val;
  };
  const offset = parseNonNegativeInt("--offset", 3000);
  const limit = parseNonNegativeInt("--limit", 200);
  const show = parseNonNegativeInt("--show", 4);

  await ensureAnalysisData();

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
  let readFiles = 0;
  let skippedFiles = 0;
  let rounds = 0;
  let roundsWithTremor = 0;
  let lines = 0;
  let roundsWithLine = 0;
  const savedSeconds: number[] = [];
  const examples: string[] = [];

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
    let start = 0;
    let team = new Map<string, string>();
    let spec = new Map<string, number>();
    let open = new Map<
      string,
      { t: number; spellId: string; spellName: string; victim: string }
    >();
    let drops: Array<{ t: number; owner: string }> = [];
    let out: string[] = [];
    const flush = () => {
      if (!start) return;
      rounds++;
      if (drops.length) roundsWithTremor++;
      if (out.length) {
        roundsWithLine++;
        lines += out.length;
        if (examples.length < show)
          examples.push(out.join("\n"));
      }
    };
    for (const row of text.split(/\r?\n/)) {
      const p = parseLine(row);
      if (!p) continue;
      if (p.eventName === "ARENA_MATCH_START") {
        flush();
        start = p.timestamp;
        team = new Map();
        spec = new Map();
        open = new Map();
        drops = [];
        out = [];
        continue;
      }
      if (p.eventName === "ARENA_MATCH_END") {
        flush();
        start = 0;
        continue;
      }
      if (!start) continue;
      if (p.eventName === "COMBATANT_INFO" && p.combatantInfo) {
        team.set(p.params[0], p.params[1]);
        spec.set(p.params[0], p.combatantInfo.specId);
        continue;
      }
      if (!p.base) continue;
      if (
        p.eventName === "SPELL_SUMMON" &&
        p.base.destGuid.split("-")[5] === "5913"
      ) {
        drops.push({ t: p.timestamp, owner: p.base.srcGuid });
        continue;
      }
      const id = String(p.spell?.spellId ?? "");
      if (
        !TREMOR_BREAKABLE_CC_IDS.has(id) ||
        !p.base.destGuid.startsWith("Player-")
      )
        continue;
      const key = `${p.base.destGuid}|${id}`;
      if (p.eventName === "SPELL_AURA_APPLIED")
        open.set(key, {
          t: p.timestamp,
          spellId: id,
          spellName: p.spell?.spellName ?? id,
          victim: p.base.destGuid,
        });
      else if (p.eventName === "SPELL_AURA_REMOVED") {
        const o = open.get(key);
        if (!o) continue;
        open.delete(key);
        const drop = drops.find((d) => {
          const ownerTeam = team.get(d.owner);
          const victimTeam = team.get(o.victim);
          return (
            Boolean(ownerTeam) &&
            ownerTeam === victimTeam &&
            d.t > o.t &&
            p.timestamp >= d.t &&
            p.timestamp - d.t <= SAME_INSTANT_MS
          );
        });
        if (!drop) continue;
        const lasted = (p.timestamp - o.t) / 1000;
        const full = ccFullDurationSeconds(o.spellId);
        if (full) savedSeconds.push(full - lasted);
        const label = (g: string) =>
          SPEC[spec.get(g) ?? 0] ?? `spec${spec.get(g)}`;
        out.push(
          `  ${fmtTime((drop.t - start) / 1000)}  [TREMOR]   Tremor Totem (${label(drop.owner)}) ended ${o.spellName} on ${label(o.victim)} after ${lasted.toFixed(1)}s${full ? ` of ${full}s` : ""}`,
        );
      }
    }
    flush();
  }
  const s = [...savedSeconds].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      selectedFiles: files.length,
      readFiles,
      skippedFiles,
      rounds,
      roundsWithTremor,
      roundsWithLine,
      lines,
      nominalSecondsOfFearCut: {
        n: s.length,
        p50: s.length > 0 ? s[Math.floor(s.length / 2)]?.toFixed(1) : null,
        total: Math.round(s.reduce((a, b) => a + b, 0)),
      },
    }),
  );
  console.log("\n" + examples.join("\n\n"));
}
void main();
