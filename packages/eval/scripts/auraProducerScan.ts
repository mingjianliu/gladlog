/**
 * auraProducerScan.ts — WHICH ability put this aura on, and how long does each
 * producer's copy last? (GH #65 items 2 / 3 / 5, 2026-09-22.)
 *
 * Game-Behaviour Rule 6: an aura produced by a proc or by a DIFFERENT ability
 * carries that producer's length, not its own row's. Every "unexplained" tier
 * the duration scans flagged after the 2026-09-22 inventory pass had no talent
 * modifier in either SpellMod encoding, so this asks the other question: for
 * each clean application (APPLIED → REMOVED, no REFRESH / DOSE — same segment
 * rule as buffDurationScan), which cast of the SAME caster landed within
 * `--window` ms before it? The producer is that cast's spell id ("none" when
 * no cast is that close — a passive proc or a pre-gate application).
 *
 * Worked example that motivated it: Survival of the Fittest 264735. Smoke
 * Screen 430709 (Dark Ranger hero talent): "Exhilaration grants you 3 s of
 * Survival of the Fittest" — so a Marksmanship 3.0 s tier is Exhilaration-
 * produced, not a spec base, and a cast copy is 6 + 2 (Lone Survivor) = 8.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/auraProducerScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt \
 *     --auras 264735,121471 [--every 60] [--window 300]
 * Output: per aura → producer × caster spec → lifetime histogram (top 3).
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  type ICombatUnit,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const auras = new Set(arg("--auras", "").split(",").filter(Boolean));
const every = Number(arg("--every", "60"));
const windowMs = Number(arg("--window", "300"));
if (!manifest || auras.size === 0) {
  console.error(
    "usage: auraProducerScan.ts --manifest <path> --auras <id,id> [--every N] [--window ms]",
  );
  process.exit(1);
}

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

/** aura → "producer|spec" → lifetime(0.5 s bins) → count */
const hist = new Map<string, Map<string, Map<number, number>>>();
let rounds = 0;

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
    for (const unit of Object.values(units)) {
      const open = new Map<
        string,
        { t: number; clean: boolean; producer: string }
      >();
      for (const e of unit.auraEvents) {
        const spellId = e.spellId;
        if (!spellId || !auras.has(spellId) || e.destUnitId !== unit.id)
          continue;
        const key = `${e.srcUnitId ?? ""}|${spellId}`;
        const ev = e.logLine.event as string;
        const t = e.logLine.timestamp as number;
        if (ev === LogEvent.SPELL_AURA_APPLIED) {
          const caster = units[e.srcUnitId ?? ""];
          let producer = "none";
          let best = Infinity;
          for (const c of caster?.spellCastEvents ?? []) {
            if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
            const dt = t - c.logLine.timestamp;
            if (dt >= 0 && dt <= windowMs && dt < best) {
              best = dt;
              producer = String(c.spellId);
            }
          }
          open.set(key, { t, clean: true, producer });
        } else if (
          ev === LogEvent.SPELL_AURA_REFRESH ||
          ev === LogEvent.SPELL_AURA_APPLIED_DOSE
        ) {
          const o = open.get(key);
          if (o) o.clean = false;
        } else if (
          ev === LogEvent.SPELL_AURA_REMOVED ||
          ev === LogEvent.SPELL_AURA_BROKEN ||
          ev === LogEvent.SPELL_AURA_BROKEN_SPELL
        ) {
          const o = open.get(key);
          open.delete(key);
          if (!o || !o.clean) continue;
          const d = Math.round(((t - o.t) / 1000) * 2) / 2;
          if (d < 0 || d > 120) continue;
          const caster = units[e.srcUnitId ?? ""];
          if (!caster?.info) continue;
          const k = `${o.producer}|${specToString(caster.spec)}`;
          const byK =
            hist.get(spellId) ?? new Map<string, Map<number, number>>();
          const h = byK.get(k) ?? new Map<number, number>();
          h.set(d, (h.get(d) ?? 0) + 1);
          byK.set(k, h);
          hist.set(spellId, byK);
        }
      }
    }
  }
}

console.log(`files=${files.length} rounds=${rounds} window=${windowMs}ms`);
for (const [aura, byK] of hist) {
  console.log(`\n== ${aura} ${getEnglishSpellName(aura, "")}`);
  const lines = [...byK]
    .map(([k, h]) => {
      const tot = [...h.values()].reduce((s, n) => s + n, 0);
      const top = [...h]
        .sort((p, q) => q[1] - p[1])
        .slice(0, 3)
        .map(([v, n]) => `${v}s×${n}`)
        .join(" ");
      const [producer, spec] = k.split("|");
      const pname =
        producer === "none"
          ? "(no cast ≤ window)"
          : `${producer} ${getEnglishSpellName(producer!, "")}`;
      return {
        line: `  ${pname.padEnd(36)} ${spec!.padEnd(24)} n=${String(tot).padStart(5)}  ${top}`,
        tot,
      };
    })
    .sort((p, q) => q.tot - p.tot);
  for (const l of lines) console.log(l.line);
}
