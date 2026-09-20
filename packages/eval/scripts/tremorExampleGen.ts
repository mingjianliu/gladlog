/**
 * tremorExampleGen.ts — value-gate example generator (GH #100 direction 4,
 * user 2026-09-20: establish the facts first; a context line is "most likely
 * yes" but decided later). Renders, for real matches, the ONE tremor fact the
 * log supports deterministically: a friendly Tremor Totem dropped while a
 * teammate was feared, and the fear ending the same instant (300-file probe:
 * removal lag p50 0 s, p90 0.02 s, 49/50 within 1.5 s). The totem sources no
 * log event, so everything else ("it was already up") is not attributable and
 * is deliberately not rendered. No model calls, no product predicate yet.
 *
 * Usage: npx tsx packages/eval/scripts/tremorExampleGen.ts --manifest <txt> [--offset 3000] [--limit 200] [--show 4]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { ccFullDurationSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import { TREMOR_BREAKABLE_CC_IDS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { parseLine } from "@gladlog/parser";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
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
  await ensureAnalysisData();
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(Number(flag("--offset") ?? 3000))
    .slice(0, Number(flag("--limit") ?? 200));
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
    } catch {
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
        if (examples.length < Number(flag("--show") ?? 4))
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
        const drop = drops.find(
          (d) =>
            team.get(d.owner) === team.get(o.victim) &&
            d.t > o.t &&
            p.timestamp >= d.t &&
            p.timestamp - d.t <= SAME_INSTANT_MS,
        );
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
      files: files.length,
      rounds,
      roundsWithTremor,
      roundsWithLine,
      lines,
      secondsOfFearCut: {
        n: s.length,
        p50: s[Math.floor(s.length / 2)]?.toFixed(1),
        total: Math.round(s.reduce((a, b) => a + b, 0)),
      },
    }),
  );
  console.log("\n" + examples.join("\n\n"));
}
void main();
