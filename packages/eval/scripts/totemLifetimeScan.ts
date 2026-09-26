/**
 * totemLifetimeScan.ts — how long does a totem actually stand, measured by its
 * OWN last event (GH #65 / BACKLOG §51, 2026-09-22).
 *
 * 12.x logs write no despawn for totems, and a kill time is right-censored, so
 * the clean lifetime of a pulsing totem is summon → its last own event (a
 * Healing Stream Totem heals every ~2 s until it expires). Split by the
 * OWNER's rank in a candidate duration talent — leg (c) for a SpellLabel
 * modifier on the SUMMON spell (Totemic Focus 382201: +3 s on Healing Stream,
 * +10 s on Earthbind / Earthgrab, by the M6 inventory). Totems that were
 * killed (overkill) are excluded: their last event is the kill, not expiry.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/totemLifetimeScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt \
 *     [--npcs 3527:5394,60561:51485] [--talent 382201] [--every 60]
 *   (npcId:summonSpellId pairs)
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  getNpcIdFromGuid,
  nonPlayerUnitKill,
  summonedAtMs,
} from "@gladlog/analysis/src/context/timelineHelpers";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { talentRankOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "60"));
const talent = arg("--talent", "382201");
const npcs = new Map(
  arg("--npcs", "3527:5394,60561:51485")
    .split(",")
    .map((p) => p.split(":") as [string, string]),
);
if (!manifest) {
  console.error(
    "usage: totemLifetimeScan.ts --manifest <path> [--npcs id:spell,…] [--talent id] [--every N]",
  );
  process.exit(1);
}

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

/** "npcId|rN" → lifetime (0.5 s floor bins) → count */
const hist = new Map<string, Map<number, number>>();
let rounds = 0;
let killedSkipped = 0;

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
    rounds++;
    const units = legacy.units as Record<string, ICombatUnit>;
    for (const u of Object.values(units)) {
      const npcId = getNpcIdFromGuid(u.id);
      if (!npcId || !npcs.has(npcId)) continue;
      const owner = units[u.ownerId ?? ""];
      if (!owner?.info) continue;
      const summonMs = summonedAtMs(u);
      if (summonMs === null) continue;
      if (nonPlayerUnitKill(u)) {
        killedSkipped++;
        continue;
      }
      const own = [
        ...u.healOut.map((e) => e.logLine.timestamp as number),
        ...u.damageOut.map((e) => e.logLine.timestamp as number),
        ...(u.spellCastEvents ?? []).map((e) => e.logLine.timestamp as number),
      ].filter((t) => t >= summonMs);
      if (own.length === 0) continue;
      // Censored by round end: a totem still pulsing in the last 2 s says nothing.
      const last = Math.max(...own);
      if (last > legacy.endTime - 2000) continue;
      const life = Math.floor(((last - summonMs) / 1000) * 2) / 2;
      const k = `${npcId}|r${talentRankOf(owner, talent)}`;
      const h = hist.get(k) ?? new Map<number, number>();
      h.set(life, (h.get(life) ?? 0) + 1);
      hist.set(k, h);
    }
  }
}

console.log(
  `files=${files.length} rounds=${rounds} killed-excluded=${killedSkipped} talent=${talent}`,
);
for (const [k, h] of [...hist].sort()) {
  const [npcId, rk] = k.split("|");
  const spell = npcs.get(npcId!)!;
  const tot = [...h.values()].reduce((s, n) => s + n, 0);
  const top = [...h]
    .sort((p, q) => q[1] - p[1])
    .slice(0, 4)
    .map(([v, n]) => `${v}s×${n}`)
    .join(" ");
  const maxLife = Math.max(...h.keys());
  console.log(
    `  npc ${npcId} (${spellEffectData[spell]?.name ?? spell}, DB2 ${spellEffectData[spell]?.durationSeconds ?? "?"} s) ${rk}: n=${tot} last-own-event top ${top}  max ${maxLife}s`,
  );
}
