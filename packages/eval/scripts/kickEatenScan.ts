/** kickEatenScan.ts — every enemy kick that landed on a friendly owner, one
 * JSON line per kick, with the kick-eaten line the product would print for it
 * **with the per-round cap bypassed** (triage 2026-09-29, kick-eaten theme).
 *
 * Why: `acceptanceCapture.ts` sees only the kicks that survive
 * `KICK_EATEN_CAP`, so a facts change on a kick the cap drops is invisible in
 * a before/after capture, and a change that reorders the cap looks like a
 * facts change. This scan asks the product's own builder
 * (`ownerKickEatenEvents`) about one kick at a time, and separately records
 * which kicks the capped menu kept (`listed`).
 *
 * Per row: file, round index and start, owner (name / spec / whether this
 * owner recorded the log — only the recorder has SPELL_CAST_FAILED), the
 * instance's classification fields, `facts` (null = harmless, not listed in
 * any case) and `listed`.
 *
 * Same walk as `acceptanceCapture.ts`: every round of every file, every
 * friendly owner, raw streams on. Run it before and after a change with the
 * same manifest and diff the two files by (file, round, owner, t).
 *
 * 用法:
 *   npx tsx packages/eval/scripts/kickEatenScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 30] \
 *     --out /path/kicks.jsonl
 *   manifest 行是绝对路径(.txt 或 .gz)或相对 --archive-dir 的路径。
 */
import {
  analyzePlayerCCAndTrinket,
  ensureAnalysisData,
  ownerKickEatenEvents,
  specToString,
} from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { roundRawStreams } from "../src/corpus/appCandidates";
import { splitTeams } from "../src/explore/storeAccess";
import { arg, argOf } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = argOf("--every", 1);
const archiveDir = arg("--archive-dir", "");
const outPath = arg("--out", "");
if (!manifest || !outPath) {
  console.error(
    "usage: kickEatenScan.ts --manifest <path> [--every N] [--archive-dir <dir>] --out <file.jsonl>",
  );
  process.exit(1);
}

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const rows: string[] = [];
let rounds = 0;
let kicks = 0;
let listed = 0;
for (const f of files) {
  const p = f.startsWith("/") ? f : resolve(archiveDir, f);
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(p);
    text = (p.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  let idx = 0;
  for (const m of items) {
    idx++;
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const { friends, enemies } = splitTeams(legacy);
    const enemyIds = new Set(enemies.map((u) => u.id));
    const enemyPets = (
      Object.values(legacy.units) as unknown as ICombatUnit[]
    ).filter((u) => u.ownerId && enemyIds.has(u.ownerId));
    const rawStreams = roundRawStreams(legacy, text);
    for (const owner of friends) {
      try {
        const cc = analyzePlayerCCAndTrinket(
          owner,
          enemies,
          legacy as never,
          enemyPets,
        );
        if (cc.interruptInstances.length === 0) continue;
        const ctx = { combat: legacy, owner, friends, enemies, rawStreams };
        const menuIds = new Set(
          ownerKickEatenEvents(ctx, cc.interruptInstances).map((e) => e.id),
        );
        const recorder =
          rawStreams?.castFailed.some((e) => e.unitGuid === owner.id) ?? false;
        for (const k of cc.interruptInstances) {
          const ev = ownerKickEatenEvents(ctx, [k])[0] ?? null;
          kicks++;
          const isListed = ev !== null && menuIds.has(ev.id);
          if (isListed) listed++;
          rows.push(
            JSON.stringify({
              file: f,
              round: idx,
              startTime: legacy.startTime,
              owner: owner.name,
              spec: specToString(owner.spec),
              recorder,
              at: Math.round(k.atSeconds * 1000) / 1000,
              kickSpellId: k.kickSpellId,
              interruptedSpellId: k.interruptedSpellId,
              postKick: k.postKick,
              switchWasHardCast: k.switchWasHardCast,
              listed: isListed,
              facts: ev?.facts ?? null,
            }),
          );
        }
      } catch {
        /* owner not analysable → excluded on both sides */
      }
    }
  }
}
writeFileSync(outPath, rows.join("\n") + "\n");
console.log(
  `files=${files.length} rounds=${rounds} kicks=${kicks} listed=${listed}`,
);
