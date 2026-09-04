/**
 * cdPriorExampleGen.ts — the Value-Gate rule 1 artefact for the `[CD PRIOR]`
 * context fact (GH #54 (f) / BACKLOG #38 (a)(h), 2026-09-04): print COMPLETE
 * real-match timeline excerpts around the lines the product would render,
 * and the dip-shape distribution the persistence door was set on.
 *
 *   stats     tsx cdPriorExampleGen.ts stats --manifest <file> [--offset N] [--limit N]
 *               # per episode: how long the dip persisted below the cohort
 *               # median (endSec − tSec) and how far below it bottomed
 *   examples  tsx cdPriorExampleGen.ts examples --manifest <file> [--offset N]
 *               [--limit N] [--around 6] [--max 3]
 *               # the rendered prompt, ±around lines of timeline per [CD PRIOR]
 *
 * Deterministic: no model call. Everything comes from the same
 * `buildMatchContext` the product runs (examples) or from the same
 * `cdPriorHoldEpisodes` engine + `lookupCdTriggerPrior` table (stats).
 *
 * Baseline numbers (2026-09-04, 120 archive files, offset 9000): recorded in
 * the GH #54 comment of that date.
 */
import {
  ensureAnalysisData,
  heroBuildGroupOf,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { cdPriorHoldEpisodes } from "@gladlog/analysis/src/analysis/cdTriggerPrior";
import { buildMatchContext } from "@gladlog/analysis/src/context/buildMatchContext";
import { lookupCdTriggerPrior } from "@gladlog/analysis/src/data/cdTriggerPrior";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { basename } from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

function* combatsOf(path: string): Generator<any> {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    return;
  }
  const combats: any[] = [];
  try {
    const parser = new GladLogParser();
    parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
    parser.on("shuffle", (sh: any) => {
      for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
    });
    for (const line of text.split("\n")) parser.push(line);
    parser.end();
  } catch {
    return;
  }
  yield* combats;
}

function files(): string[] {
  const manifest = flag("--manifest");
  if (!manifest) {
    console.error("usage: <stats|examples> --manifest <file> [--offset N] [--limit N]");
    process.exit(1);
  }
  let fs = readFileSync(manifest, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const offset = num("--offset", 0);
  const limit = num("--limit", 120);
  if (offset) fs = fs.slice(offset);
  if (limit) fs = fs.slice(0, limit);
  return fs;
}

const friendlyHealers = (legacy: any): any[] =>
  (Object.values(legacy.units ?? {}) as any[]).filter(
    (u) =>
      u.info &&
      isHealerSpec(u.spec) &&
      u.reaction === CombatUnitReaction.Friendly,
  );

async function stats(): Promise<void> {
  await ensureAnalysisData();
  const bucket = (v: number, edges: number[], labels: string[]): string => {
    for (let i = 0; i < edges.length; i++) if (v < edges[i]!) return labels[i]!;
    return labels[edges.length]!;
  };
  const persist: Record<string, number> = {};
  const depth: Record<string, number> = {};
  let n = 0;
  let rounds = 0;
  for (const path of files()) {
    for (const c of combatsOf(path)) {
      for (const o of friendlyHealers(c)) {
        rounds++;
        const spec = specToString(o.spec);
        const tree = heroBuildGroupOf(o.info?.talents);
        for (const e of cdPriorHoldEpisodes(o, c, (id) =>
          lookupCdTriggerPrior(spec, tree, id),
        )) {
          n++;
          const pk = bucket(e.endSec - e.tSec, [1, 3, 6, 10], ["0s", "1-2s", "3-5s", "6-9s", "10s+"]);
          persist[pk] = (persist[pk] ?? 0) + 1;
          const dk = bucket(e.ref.medianHpPct - e.minHpPct, [3, 6, 10], ["<3pp", "3-5pp", "6-9pp", "10pp+"]);
          depth[dk] = (depth[dk] ?? 0) + 1;
        }
      }
    }
  }
  console.log(`healer-owner rounds ${rounds}, episodes ${n} (before the per-round cap)`);
  console.log("persistence below the median (endSec − tSec):", persist);
  console.log("depth below the median (median − min):", depth);
}

async function examples(): Promise<void> {
  await ensureAnalysisData();
  const around = num("--around", 6);
  const max = num("--max", 3);
  let shown = 0;
  for (const path of files()) {
    if (shown >= max) break;
    for (const c of combatsOf(path)) {
      if (shown >= max) break;
      const units: any[] = Object.values(c.units ?? {});
      for (const owner of friendlyHealers(c)) {
        if (shown >= max) break;
        const friends = units.filter((u) => u.info && u.reaction === owner.reaction);
        const enemies = units.filter((u) => u.info && u.reaction !== owner.reaction);
        let ctx = "";
        try {
          ctx = buildMatchContext(c, friends, enemies, { owner });
        } catch {
          continue;
        }
        const lines = ctx.split("\n");
        const hits = lines
          .map((l, i) => (l.includes("  [CD PRIOR]   ") ? i : -1))
          .filter((i) => i >= 0);
        if (hits.length === 0) continue;
        shown++;
        console.log(`\n===== ${basename(path)} · ${owner.name} (${specToString(owner.spec)} · ${heroBuildGroupOf(owner.info?.talents)}) · ${c.startInfo?.bracket ?? "?"}`);
        for (const h of hits.slice(0, 2)) {
          console.log(`--- timeline ±${around} lines around line ${h + 1}`);
          for (let i = Math.max(0, h - around); i <= Math.min(lines.length - 1, h + around); i++)
            console.log((i === h ? ">> " : "   ") + lines[i]);
        }
      }
    }
  }
  if (shown === 0) console.log("no [CD PRIOR] line rendered in this slice");
}

(cmd === "stats" ? stats() : cmd === "examples" ? examples() : Promise.reject(new Error("usage: stats | examples"))).catch((e) => {
  console.error(e);
  process.exit(1);
});
