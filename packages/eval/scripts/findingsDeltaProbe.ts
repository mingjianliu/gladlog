/**
 * findingsDeltaProbe.ts — attribute a findings-prompt hash delta to the data
 * change that caused it, in ONE process (2026-09-22, GH #65 batch 2).
 *
 * Why: acceptanceCapture only records hashes + per-type counts. When the
 * findings hash moves but every count is unchanged, the change is inside the
 * rendered facts, and the capture cannot say where. This probe runs the same
 * findings build twice per owner — arm A with a runtime rollback of the data
 * change (durations put back, table keys removed), arm B as shipped — and
 * diffs the two texts, so every changed owner is explained by line.
 *
 * Rollback here = the 2026-09-22 batch-2 duration change (edit ROLLBACK when
 * reusing): no-caster durations restored to their pre-batch values and the
 * new BUFF_DURATION_TALENT_MODIFIERS keys removed.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/findingsDeltaProbe.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 90]
 */
import {
  buildFindingsPrompt,
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
} from "@gladlog/analysis";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "90"));
// `--dump <file>`: skip the in-process rollback and write one JSON line per
// owner {key, text} of the findings prompt AS SHIPPED — run it in two checkouts
// (before / after a commit) and diff the two files when the change cannot be
// rolled back at runtime (e.g. table membership consumed at module load).
const dumpTo = arg("--dump", "");

/** no-caster durations before batch 2 (patch values that were deleted / added) */
const ROLLBACK_DURATIONS: Record<string, number> = {
  "382024": 9, // Earthliving Weapon — patch deleted
  "373277": 24, // Thing from Beyond — patch deleted
  "1280172": 6, // Shadowfiend — patch deleted
  "374349": 8, // Renewing Blaze — patch added (DB2 8 before)
};
const NEW_KEYS = [
  "774",
  "703",
  "382024",
  "212431",
  "1280172",
  "373277",
  "466772",
  "1269042",
  "445584",
  "374349",
  "155625",
  "439531",
  "439530",
  "1271863",
  "48438",
  "450538",
  "55095",
  "25771",
  "11426",
  "235313",
  "235450",
  "1241786",
  "61295",
  "393831",
];

await ensureAnalysisData();
const saved = new Map<
  string,
  (typeof BUFF_DURATION_TALENT_MODIFIERS)[string]
>();
const savedDur = new Map<string, number | undefined>();
const table = BUFF_DURATION_TALENT_MODIFIERS as Record<
  string,
  (typeof BUFF_DURATION_TALENT_MODIFIERS)[string]
>;
const effects = spellEffectData as Record<string, { durationSeconds?: number }>;
function rollback() {
  for (const k of NEW_KEYS) {
    if (table[k]) {
      saved.set(k, table[k]!);
      delete table[k];
    }
  }
  for (const [id, d] of Object.entries(ROLLBACK_DURATIONS)) {
    savedDur.set(id, effects[id]?.durationSeconds);
    if (effects[id]) effects[id]!.durationSeconds = d;
  }
}
function restore() {
  for (const [k, v] of saved) table[k] = v;
  saved.clear();
  for (const [id, d] of savedDur)
    if (effects[id]) effects[id]!.durationSeconds = d;
  savedDur.clear();
}

const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

let owners = 0;
let changed = 0;
const dumpLines: string[] = [];
const byType = new Map<string, number>();
const samples: string[] = [];
for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const { friends } = splitTeams(legacy);
    for (const owner of friends) {
      owners++;
      const build = () => {
        try {
          const cands = extractCandidateFindings(legacy, owner.id);
          return {
            text: buildFindingsPrompt(cands, "", owner.spec),
            types: cands.map((c) => c.type),
          };
        } catch {
          return null;
        }
      };
      if (dumpTo) {
        const only = build();
        if (only)
          dumpLines.push(
            JSON.stringify({
              key: `${f}|${owner.id}|${owner.name}`,
              text: only.text,
            }),
          );
        continue;
      }
      rollback();
      const before = build();
      restore();
      const after = build();
      if (!before || !after || before.text === after.text) continue;
      changed++;
      const bl = before.text.split("\n");
      const al = after.text.split("\n");
      const role = isHealerSpec(owner.spec) ? "healer" : "dps";
      for (let i = 0; i < Math.max(bl.length, al.length); i++) {
        if (bl[i] === al[i]) continue;
        // attribute to the nearest preceding candidate header ("### <type>" or "[type]")
        let t = "?";
        for (let j = i; j >= 0; j--) {
          const mm = /^\s*(?:###\s*|\[)([a-z][a-z-]+)/.exec(
            al[j] ?? bl[j] ?? "",
          );
          if (mm) {
            t = mm[1]!;
            break;
          }
        }
        byType.set(`${role}:${t}`, (byType.get(`${role}:${t}`) ?? 0) + 1);
        if (samples.length < 12)
          samples.push(`- ${bl[i] ?? "(none)"}\n+ ${al[i] ?? "(none)"}`);
      }
    }
  }
}
if (dumpTo) {
  writeFileSync(dumpTo, dumpLines.join("\n") + "\n");
  console.log(
    `files=${files.length} owners=${owners} dumped=${dumpLines.length} → ${dumpTo}`,
  );
  process.exit(0);
}
console.log(
  `files=${files.length} owners=${owners} owners-with-changed-findings=${changed}`,
);
console.log("changed lines by role:type:");
for (const [k, n] of [...byType].sort((p, q) => q[1] - p[1]))
  console.log(`  ${k}: ${n}`);
console.log("samples:");
for (const s of samples) console.log(s);
