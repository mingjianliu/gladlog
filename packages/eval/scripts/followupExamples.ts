/**
 * Value-gate examples for the follow-up wirings, from real archive rounds:
 *   1. `[CC BROKEN]` prompt lines (#36(e))
 *   2. kick-eaten candidate facts with the new postKick behavior (#36(b))
 * Each found prompt is also saved whole to the out dir so the model smoke
 * (`smokeTags.ts`) can run on exactly what was shown.
 *
 * Usage: npx tsx packages/eval/scripts/followupExamples.ts <archiveRoot> <outDir>
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  analyzePlayerCCAndTrinket,
  buildMatchContext,
  ensureAnalysisData,
  isHealerSpec,
  kickEatenEvents,
  specToString,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch } from "@gladlog/parser-compat";

await ensureAnalysisData();

const root = process.argv[2];
const outDir = process.argv[3] ?? ".";
mkdirSync(outDir, { recursive: true });

function newSeasonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = path.join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".txt.gz")) out.push(p);
    }
  };
  walk(dir);
  return out
    .filter((p) => {
      const m = /\/2026\/08\/(\d{2})\//.exec(p);
      return m != null && Number(m[1]) >= 12;
    })
    .sort();
}

let ccBrokenShown = 0;
let kickShown = 0;
let roundsSeen = 0;
const WANT = 3;

outer: for (const file of newSeasonFiles(root)) {
  if (ccBrokenShown >= WANT && kickShown >= WANT) break;
  const items: GladMatch[] = [];
  try {
    const text = gunzipSync(readFileSync(file)).toString("utf8");
    const p = new GladLogParser();
    p.on("match", (m: GladMatch) => items.push(m));
    p.on("shuffle", (sh) => {
      for (const r of sh.rounds) items.push(r as never);
    });
    for (const line of text.split("\n")) p.push(line);
    p.end();
  } catch {
    continue;
  }
  for (const m of items) {
    roundsSeen++;
    if (roundsSeen > 400) break outer;
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    const owner = friends.find((u) => isHealerSpec(u.spec));
    if (!owner) continue;

    // #36(b): kick-eaten facts through the real candidate path
    if (kickShown < WANT) {
      try {
        const summary = analyzePlayerCCAndTrinket(
          owner,
          enemies,
          legacy as never,
        );
        const idle = summary.interruptInstances.filter(
          (k) => k.postKick === "idle",
        );
        if (idle.length > 0) {
          const evts = kickEatenEvents(summary.interruptInstances, {
            id: owner.id,
            name: owner.name,
          });
          kickShown++;
          console.log(
            `\n══════ kick-eaten example ${kickShown}  file=${path.basename(file)}  owner=${specToString(owner.spec)}`,
          );
          for (const e of evts) {
            console.log(`  facts: ${JSON.stringify(e.facts)}`);
          }
        }
      } catch {
        /* skip */
      }
    }

    // #36(e): [CC BROKEN] prompt lines
    if (ccBrokenShown < WANT) {
      let prompt: string;
      try {
        prompt = buildMatchContext(legacy, friends, enemies, { owner });
      } catch {
        continue;
      }
      const lines = prompt.split("\n");
      const hits = lines
        .map((l, i) => [l, i] as const)
        .filter(([l]) => l.includes("[CC BROKEN]"));
      if (hits.length === 0) continue;
      ccBrokenShown++;
      console.log(
        `\n══════ [CC BROKEN] example ${ccBrokenShown}  file=${path.basename(file)}  owner=${specToString(owner.spec)}`,
      );
      for (const [, i] of hits.slice(0, 4)) {
        for (
          let j = Math.max(0, i - 1);
          j <= Math.min(lines.length - 1, i + 1);
          j++
        ) {
          console.log(`  ${lines[j]}`);
        }
        console.log("  ---");
      }
      writeFileSync(
        path.join(outDir, `prompt_ccbroken_${ccBrokenShown}.txt`),
        prompt,
      );
    }
  }
}

console.log(
  `\nrounds scanned=${roundsSeen}, ccBroken examples=${ccBrokenShown}, kick examples=${kickShown}`,
);
