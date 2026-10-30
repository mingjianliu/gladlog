/**
 * talentDurationVerify.ts — GH #155 (2026-10-21): the verifying half of
 * `genTalentDurations.ts`. The tooltip says what a talent does to a duration;
 * this asks the log whether it is so.
 *
 * Per (tooltip entry, target aura the corpus has seen): the clean lifetimes of
 * that aura (APPLIED → REMOVED with no REFRESH in between — buffDurationScan's
 * cell semantics; `buildAuraIntervals` is not used, its cap is the number
 * under test), split by the caster: a HOLDER (`talentModifierOwnershipOf` =
 * yes, spec among the specs the tooltip branch is read for) or a NON-HOLDER
 * (no). Buffs are often consumed or cancelled, so the question is whether the
 * LONGEST lifetimes reach what the tooltip promises:
 *   predicted = base + amount (s) · base × (1 + amount / 100) (%) · amount (set)
 *   confirmed     holders n ≥ 5, some lifetime within 0.5 s of predicted,
 *                 none beyond predicted + 0.6, non-holders not beyond
 *                 base + 0.6 (or none seen)
 *   never-reached holders n ≥ 20, longest < predicted − 0.5
 *   beyond        a holder lifetime > predicted + 0.6, or a non-holder one
 *                 > base + 0.6 when the holders' is not — another effect moves it
 *   insufficient  otherwise
 * `model` is the median of `buffFullDurationForCaster` for the holders — the
 * product's current answer — so "already modelled" is visible next to it.
 *
 * Per-event entries are verified by their own counting rule; implemented:
 * Spiritwalker's Momentum 443425 (each hard cast — a SPELL_CAST_SUCCESS with
 * the same spell's SPELL_CAST_START before it — during the buff adds the
 * amount, up to the cap): per holder application, observed vs predicted.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/talentDurationVerify.ts --manifest <file> [--every N] [--out <json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import tooltips from "@gladlog/analysis/src/data/talentDurationTooltipsGenerated.json";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { talentModifierOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";

interface Entry {
  talentSpellId: string;
  specs: string[];
  kind: "fixed" | "per-event" | "set";
  unit: "s" | "pct";
  amount: number;
  cap?: number;
  capUnit?: string;
  sentence: string;
  qualifyingSpellIds?: string[];
  targets: Array<{
    name: string;
    matchedBy: string;
    observedIds: string[];
    baseSeconds: Record<string, number>;
  }>;
}

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const manifest = arg("--manifest");
if (!manifest) {
  console.error(
    "usage: talentDurationVerify.ts --manifest <file> [--every N] [--out <json>]",
  );
  process.exit(2);
}
const every = Number(arg("--every") ?? 1);
const outPath = arg("--out");

await ensureAnalysisData();
const entries = (tooltips as { entries: Entry[] }).entries;

/** watched aura id → the (entry, base) pairs it verifies */
const watch = new Map<string, Array<{ e: Entry; base: number; key: string }>>();
for (const e of entries) {
  if (e.kind === "per-event" && e.talentSpellId !== "443425") continue;
  for (const t of e.targets)
    for (const id of t.observedIds) {
      const base = t.baseSeconds[id];
      if (!base) continue;
      const key = `${e.talentSpellId}|${id}|${e.kind}|${e.amount}${e.unit}`;
      const l = watch.get(id) ?? [];
      if (!l.some((x) => x.key === key)) l.push({ e, base, key });
      watch.set(id, l);
    }
}

interface Acc {
  e: Entry;
  auraId: string;
  base: number;
  holders: number[];
  nonHolders: number[];
  model: number[];
  /** per-event: observed − predicted per holder application */
  perEventErr: number[];
  /** per-event: the qualifying events counted per holder application */
  perEventHard: number[];
}
const acc = new Map<string, Acc>();
const accOf = (w: { e: Entry; base: number; key: string }, auraId: string) => {
  let a = acc.get(w.key);
  if (!a) {
    a = {
      e: w.e,
      auraId,
      base: w.base,
      holders: [],
      nonHolders: [],
      model: [],
      perEventErr: [],
      perEventHard: [],
    };
    acc.set(w.key, a);
  }
  return a;
};

const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);
let rounds = 0;
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
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
    for (const unit of Object.values(legacy.units)) {
      const open = new Map<string, { t: number; clean: boolean }>();
      for (const a of unit.auraEvents) {
        const spellId = a.spellId;
        if (!spellId || a.destUnitId !== unit.id || !watch.has(spellId))
          continue;
        const key = `${a.srcUnitId ?? ""}|${spellId}`;
        const ev = a.logLine.event as string;
        const t = a.logLine.timestamp as number;
        if (ev === LogEvent.SPELL_AURA_APPLIED)
          open.set(key, { t, clean: true });
        else if (ev === LogEvent.SPELL_AURA_REFRESH) {
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
          const life = Math.round((t - o.t) / 100) / 10;
          if (life <= 0 || life > 180) continue;
          const caster = legacy.units[a.srcUnitId ?? ""];
          if (!caster?.info) continue;
          for (const w of watch.get(spellId)!) {
            if (!w.e.specs.includes(String(caster.spec))) continue;
            const own = talentModifierOwnershipOf(caster, w.e.talentSpellId);
            if (own === "unknown") continue;
            const ac = accOf(w, spellId);
            if (own === "no") {
              ac.nonHolders.push(life);
              continue;
            }
            ac.holders.push(life);
            const model = buffFullDurationForCaster(spellId, caster, o.t);
            if (model) ac.model.push(model);
            if (w.e.kind === "per-event") {
              // Spiritwalker's Momentum: hard casts during the buff — a
              // SPELL_CAST_SUCCESS with that spell's bar (`castStartEvents`,
              // SPELL_CAST_START) shortly before it
              const startsOf = new Map<string, number[]>();
              for (const c of caster.castStartEvents ?? []) {
                const ct = c.logLine.timestamp;
                if (ct < o.t - 10000 || ct > t) continue;
                const l = startsOf.get(c.spellId ?? "") ?? [];
                l.push(ct);
                startsOf.set(c.spellId ?? "", l);
              }
              let hard = 0;
              // the tooltip's own definition when the generator gives it:
              // a press of a spell whose DB2 cast time is > 0, instant or not
              const qualifying = w.e.qualifyingSpellIds
                ? new Set(w.e.qualifyingSpellIds)
                : undefined;
              for (const c of caster.spellCastEvents) {
                const ct = c.logLine.timestamp;
                if (ct < o.t || ct > t) continue;
                if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
                if (qualifying) {
                  if (qualifying.has(c.spellId ?? "")) hard++;
                  continue;
                }
                const l = startsOf.get(c.spellId ?? "");
                const i = l
                  ? l.findIndex((st) => st < ct && ct - st <= 10000)
                  : -1;
                if (i >= 0) {
                  hard++;
                  l!.splice(i, 1);
                }
              }
              ac.perEventHard.push(hard);
              const predicted =
                w.base + Math.min(w.e.cap ?? Infinity, hard * w.e.amount);
              ac.perEventErr.push(Math.round((life - predicted) * 10) / 10);
            }
          }
        }
      }
    }
  }
}

const q = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
};
const rows = [...acc.values()].map((a) => {
  const { e } = a;
  const predicted =
    e.kind === "set"
      ? e.amount
      : e.unit === "pct"
        ? a.base * (1 + e.amount / 100)
        : a.base + e.amount;
  // where the lifetimes that ran their course land: at the tooltip's value
  // or at the base (±0.3 s) — consumed, cancelled or pandemic-merged ones
  // fall in neither and say nothing about the duration
  const near = (xs: number[], v: number) =>
    xs.filter((x) => Math.abs(x - v) <= 0.3).length;
  const hAtPred = near(a.holders, predicted);
  const hAtBase = near(a.holders, a.base);
  const nAtPred = near(a.nonHolders, predicted);
  const nAtBase = near(a.nonHolders, a.base);
  let verdict: string;
  if (e.kind === "per-event") {
    const exact = a.perEventErr.filter((x) => Math.abs(x) <= 0.5).length;
    verdict =
      a.perEventErr.length < 5
        ? "insufficient"
        : exact / a.perEventErr.length >= 0.8
          ? "confirmed"
          : "per-event-mismatch";
  } else if (Math.abs(predicted - a.base) < 0.6) verdict = "too-small-to-tell";
  else if (
    hAtPred >= 5 &&
    hAtPred >= 3 * hAtBase &&
    nAtPred <= Math.max(1, 0.2 * nAtBase)
  )
    verdict = "confirmed";
  else if (hAtBase >= 5 && hAtPred <= 0.1 * hAtBase) verdict = "holders-at-base";
  else if (hAtPred + hAtBase < 5) verdict = "insufficient";
  else verdict = "mixed";
  return {
    talentSpellId: e.talentSpellId,
    auraId: a.auraId,
    target: e.targets.find((t) => t.observedIds.includes(a.auraId))?.name,
    matchedBy: e.targets.find((t) => t.observedIds.includes(a.auraId))
      ?.matchedBy,
    kind: e.kind,
    amount: `${e.amount}${e.unit === "pct" ? "%" : "s"}${e.cap !== undefined ? ` cap ${e.cap}${e.capUnit === "s" ? "s" : "% of base"}` : ""}`,
    base: a.base,
    predicted: Math.round(predicted * 10) / 10,
    holders: {
      n: a.holders.length,
      p50: q(a.holders, 0.5),
      p95: q(a.holders, 0.95),
      max: q(a.holders, 1),
      atPredicted: hAtPred,
      atBase: hAtBase,
    },
    nonHolders: {
      n: a.nonHolders.length,
      p50: q(a.nonHolders, 0.5),
      max: q(a.nonHolders, 1),
      atPredicted: nAtPred,
      atBase: nAtBase,
    },
    model: q(a.model, 0.5),
    ...(e.kind === "per-event"
      ? {
          perEvent: {
            n: a.perEventErr.length,
            within05: a.perEventErr.filter((x) => Math.abs(x) <= 0.5).length,
            errP50: q(a.perEventErr, 0.5),
            eventsP50: q(a.perEventHard, 0.5),
            /** the observed extension (life − base) by events counted */
            byEvents: Object.fromEntries(
              ["0", "1", "2", "3", "4+"].map((k) => {
                const ext = a.perEventHard
                  .map((h, i) => ({
                    h,
                    ext:
                      Math.round(
                        (a.perEventErr[i]! +
                          Math.min(a.e.cap ?? Infinity, h * a.e.amount)) *
                          2,
                      ) / 2,
                  }))
                  .filter(({ h }) => (k === "4+" ? h >= 4 : h === Number(k)))
                  .map(({ ext }) => ext);
                const hist = new Map<number, number>();
                for (const x of ext) hist.set(x, (hist.get(x) ?? 0) + 1);
                return [
                  k,
                  [...hist]
                    .sort((x, y) => y[1] - x[1])
                    .slice(0, 3)
                    .map(([x, c]) => `+${x}s×${c}`)
                    .join(" "),
                ];
              }),
            ),
          },
        }
      : {}),
    verdict,
    sentence: e.sentence,
  };
});
rows.sort(
  (x, y) => x.verdict.localeCompare(y.verdict) || y.holders.n - x.holders.n,
);
console.log(`files=${files.length} rounds=${rounds} rows=${rows.length}`);
const byVerdict = new Map<string, number>();
for (const r of rows)
  byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);
console.log([...byVerdict].map(([k, v]) => `${k} ${v}`).join(" · "));
for (const r of rows)
  console.log(
    `${r.verdict.padEnd(18)} ${r.talentSpellId}→${r.auraId} ${r.target} [${r.matchedBy}] ${r.kind} ${r.amount} base ${r.base} → ${r.predicted} | holders n=${r.holders.n} @pred=${r.holders.atPredicted} @base=${r.holders.atBase} | non n=${r.nonHolders.n} @pred=${r.nonHolders.atPredicted} @base=${r.nonHolders.atBase} | model ${r.model === null ? null : Math.round(r.model * 10) / 10}${r.perEvent ? ` | per-event ${r.perEvent.within05}/${r.perEvent.n} ${JSON.stringify(r.perEvent.byEvents)}` : ""}`,
  );
if (outPath)
  writeFileSync(
    outPath,
    JSON.stringify({ files: files.length, rounds, rows }, null, 1),
  );
