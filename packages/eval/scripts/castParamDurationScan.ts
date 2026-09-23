/**
 * castParamDurationScan.ts — aura lifetime as a function of a parameter OF THE
 * CAST that produced it (GH #65 item 1, 2026-09-23; user ruling 2026-09-22:
 * empower-scaled and combo-point-scaled durations are one shape, done together).
 *
 * Two parameters, both read from the log, never inferred:
 *  - empower level — `SPELL_EMPOWER_END` (unit.empowerEnds, 1-based level)
 *    of the caster within `--window` ms BEFORE the application;
 *  - combo points — the `powers` entry with powerType 4 on the caster's
 *    advanced sample at the finisher's SPELL_CAST_SUCCESS timestamp (the
 *    cast snapshot is taken BEFORE the cost, and the combo-point ledger
 *    closes 97.2 % — docs/log-observability-audit.md direction 3), capped by
 *    that sample's max.
 * Segments: clean APPLIED → REMOVED, no REFRESH / DOSE (buffDurationScan's
 * rule). Output per aura: parameter value → lifetime histogram (top 3).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/castParamDurationScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 60]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CAST_PARAM_DURATIONS } from "@gladlog/analysis/src/data/castParamDurations";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import {
  CAST_PARAM_WINDOW_MS,
  castParamAt,
} from "@gladlog/analysis/src/utils/castParam";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  type ICombatUnit,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "60"));

if (!manifest) {
  console.error(
    "usage: castParamDurationScan.ts --manifest <path> [--every N] [--window ms]",
  );
  process.exit(1);
}

// The table and the parameter reader are the PRODUCT's (single predicate,
// 2026-09-23): this scan measures with exactly what buffFullDurationForCaster
// prices with. To measure a candidate aura, add it to CAST_PARAM_DURATIONS
// with baseSeconds/perUnitSeconds 0 first.
const AURAS = CAST_PARAM_DURATIONS;

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

/** aura → "param" → lifetime → n */
const hist = new Map<string, Map<string, Map<number, number>>>();
let rounds = 0;
/** aura → applications with a readable parameter whose lifetime the product
 * predicate reproduces within 0.6 s (the ROT verdict tolerance). */
const repro = new Map<
  string,
  { ok: number; n: number; longer: number; oldOk: number }
>();

function paramAt(caster: ICombatUnit, auraId: string, t: number): string {
  const p = castParamAt(caster, auraId, t);
  if (p === null) return "?";
  return `${AURAS[auraId]!.param === "empower" ? "L" : "CP"}${p}`;
}

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
        { t: number; clean: boolean; p: string; pred?: number; old?: number }
      >();
      for (const e of unit.auraEvents) {
        const spellId = e.spellId;
        const cfg = spellId ? AURAS[spellId] : undefined;
        if (!spellId || !cfg || e.destUnitId !== unit.id) continue;
        const key = `${e.srcUnitId ?? ""}|${spellId}`;
        const ev = e.logLine.event as string;
        const t = e.logLine.timestamp as number;
        if (ev === LogEvent.SPELL_AURA_APPLIED) {
          const caster = units[e.srcUnitId ?? ""];
          open.set(key, {
            t,
            clean: true,
            p: caster ? paramAt(caster, spellId, t) : "?",
            // the PRODUCT's answer for this application (formula + talents)
            pred: caster ? buffFullDurationForCaster(spellId, caster, t) : undefined,
            // the answer BEFORE this change (no application time)
            old: caster ? buffFullDurationForCaster(spellId, caster) : undefined,
          });
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
          if (o.p !== "?" && o.pred !== undefined) {
            const r = repro.get(spellId) ?? { ok: 0, n: 0, longer: 0, oldOk: 0 };
            r.n++;
            if (Math.abs(d - o.pred) <= 0.6) r.ok++;
            // LONGER than the prediction cannot be an early removal (Rule 7)
            if (d > o.pred + 0.6) r.longer++;
            if (o.old !== undefined && Math.abs(d - o.old) <= 0.6) r.oldOk++;
            repro.set(spellId, r);
          }
          const byP =
            hist.get(spellId) ?? new Map<string, Map<number, number>>();
          const h = byP.get(o.p) ?? new Map<number, number>();
          h.set(d, (h.get(d) ?? 0) + 1);
          byP.set(o.p, h);
          hist.set(spellId, byP);
        }
      }
    }
  }
}

console.log(`files=${files.length} rounds=${rounds} window=${CAST_PARAM_WINDOW_MS}ms`);
for (const [aura, byP] of hist) {
  console.log(
    `\n== ${aura} ${getEnglishSpellName(aura, "")} (${AURAS[aura]!.param})`,
  );
  for (const [p, h] of [...byP].sort()) {
    const tot = [...h.values()].reduce((s, n) => s + n, 0);
    const top = [...h]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([v, n]) => `${v}s×${n}`)
      .join(" ");
    console.log(`  ${p.padEnd(6)} n=${String(tot).padStart(5)}  ${top}`);
  }
  const r = repro.get(aura);
  if (r)
    console.log(
      `  → product predicate reproduces ${r.ok}/${r.n} (${((100 * r.ok) / r.n).toFixed(0)} %) of parameter-known lifetimes (±0.6 s); LONGER than predicted ${r.longer}; the pre-2026-09-23 answer (no atMs) reproduced ${r.oldOk}/${r.n}`,
    );
}
