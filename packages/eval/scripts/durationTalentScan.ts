/**
 * durationTalentScan.ts — GH #96 M5: do the 35 DB2 talent duration modifiers
 * (aura 107 / 108, SpellModOp 1) that no code reads show up in how long the
 * target aura actually lasts on casters who hold the talent?
 *
 * Why: the talent catalog × gap audit (reports/talent-catalog-2026-09-13/
 * gapAudit.json `duration`) lists 35 (talent → aura) duration modifiers
 * outside BUFF_DURATION_TALENT_MODIFIERS / CC_DURATION_TALENT_MODIFIERS
 * (Ironbark +4 s, Rallying Cry +3 s, Darkness +3 s, …). buffDurationScan's GAP
 * half nominates by aura; it never splits by a specific talent. Game-Behaviour
 * Rule legs: DB2 row + mask are the audit; this is the corpus split.
 *
 * Cells (same as buffDurationScan, so the two scans agree on what a lifetime
 * is): one (aura, caster) per round; clean lifetimes APPLIED → REMOVED with no
 * REFRESH in between, rounded to 0.5 s; cell value = mode when ≥ 3 segments
 * and ≥ 60 % share one value. Ownership: `talentModifierOwnershipOf` (the
 * shared talent-modifier predicate — plain `talentOwnershipOf` reads another
 * spec's talent as baseline, M3b run 1).
 *
 * PREDECLARED RULE (written 2026-09-13 before the first run, committed with
 * this file):
 *  - base = the modal value among NON-holder cells if ≥ 10 of them, else
 *    `buffFullDurationForCaster(aura, undefined)` (the typical caster value);
 *  - expected for holders = base + value/1000 s for aura 107 (flat ms), or
 *    base × (1 + value/100) for aura 108 (percent);
 *  - PROMOTE when ≥ 20 holder cells and ≥ 50 % of holder cells sit within
 *    ±0.5 s of expected, and expected is LONGER than base (Game-Behaviour Rule
 *    7: a shorter observation can be early removal, so reductions are never
 *    promoted from lifetimes — they need a mechanism, and CC keeps its
 *    official number regardless);
 *  - otherwise: NOT PROMOTED, with the reason (few holders / holders at base /
 *    holders elsewhere / reduction / value 0 = scripted amount).
 * Cast → aura alias (added after run 1, before run 2; the rule above is
 * unchanged): 13 targets are CAST ids whose aura carries a different id
 * (Rallying Cry 97462 → 97463, Darkness 196718 → 209426), so run 1 saw no
 * cells for them. When the target id itself yields no cells, the scan measures
 * the aura the caster applies within 300 ms after casting the target, if one
 * aura holds ≥ 80 % of those co-applications. The alias is printed.
 *
 * A promotion is a candidate for the hand table; it still needs the rank
 * semantics read from COMBATANT_INFO (rule 4) before an entry is written.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/durationTalentScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt [--every 30]
 * Output: stdout + $GLADLOG_EVAL_HOME/reports/talent-integration-2026-09-13/durationTalent.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { talentModifierOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "30"));
// Sharding (added 2026-09-14 to cover the full 63k-file archive overnight):
// `--shard i --shards n` scans every n-th file of the slice, `--dump <file>`
// writes the raw per-shard state instead of reporting, and `--from-dumps a,b,c`
// merges shard dumps and runs the unchanged reporting below. `--tag` names the
// output file so a sharded run does not overwrite the recorded run.
const shard = Number(arg("--shard", "0"));
const shards = Number(arg("--shards", "1"));
const dumpTo = arg("--dump", "");
const fromDumps = arg("--from-dumps", "").split(",").filter(Boolean);
const tag = arg("--tag", "");

const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");

interface Candidate {
  talent: string;
  talentZh: string;
  target: string;
  targetZh: string;
  aura: "107" | "108";
  value: number;
}
// `--candidates <file.json>` (2026-09-15): an explicit candidate list in the
// same shape — for modifiers found outside the gap audit (M6 scripted queue:
// Tar-Coated Bindings, Focused Ire). The promotion rule is unchanged.
const candidatesPath = arg("--candidates", "");
const CANDIDATES: Candidate[] = (
  JSON.parse(
    readFileSync(
      candidatesPath ||
        join(home, "reports/talent-catalog-2026-09-13/gapAudit.json"),
      "utf8",
    ),
  )[candidatesPath ? "candidates" : "duration"] as Candidate[]
).map((c) => ({ ...c, aura: String(c.aura) as "107" | "108" }));
const TARGETS = new Set(CANDIDATES.map((c) => c.target));

type Own = "yes" | "no" | "unknown";
/** aura id → cells, each with the caster's ownership of every candidate talent */
const cellsByAura = new Map<
  string,
  Array<{ v: number; own: Record<string, Own> }>
>();
/** target cast id → aura id applied by the same caster within 300 ms → count */
const coApplied = new Map<string, Map<string, number>>();
const TALENTS = [...new Set(CANDIDATES.map((c) => c.talent))];

function modeOf(h: Map<number, number>): number | null {
  let best = -1;
  let bestN = 0;
  let total = 0;
  for (const [v, n] of h) {
    total += n;
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  if (total < 3 || bestN / total < 0.6) return null;
  return best;
}

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0)
  .filter((_, i) => i % shards === shard)
  .filter(() => fromDumps.length === 0);

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
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const hist = new Map<string, Map<number, number>>();
    // casts of a target id, per caster, for the alias pass
    const targetCasts = new Map<string, Array<{ t: number; id: string }>>();
    for (const unit of Object.values(legacy.units) as any[]) {
      for (const c of unit.spellCastEvents ?? []) {
        if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
        if (!TARGETS.has(String(c.spellId))) continue;
        const list = targetCasts.get(unit.id) ?? [];
        list.push({ t: c.timestamp, id: String(c.spellId) });
        targetCasts.set(unit.id, list);
      }
    }
    const aliasAuras = new Set<string>();
    for (const unit of Object.values(legacy.units) as any[]) {
      for (const e of unit.auraEvents ?? []) {
        if (e.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        if (!e.spellId || e.destUnitId !== unit.id) continue;
        const casts = targetCasts.get(e.srcUnitId ?? "");
        if (!casts) continue;
        const t = e.logLine.timestamp as number;
        for (const c of casts) {
          if (t < c.t || t > c.t + 300) continue;
          const m = coApplied.get(c.id) ?? new Map<string, number>();
          m.set(e.spellId, (m.get(e.spellId) ?? 0) + 1);
          coApplied.set(c.id, m);
          aliasAuras.add(e.spellId);
        }
      }
    }
    for (const unit of Object.values(legacy.units) as any[]) {
      const open = new Map<string, { t: number; clean: boolean }>();
      for (const e of unit.auraEvents ?? []) {
        const spellId = e.spellId;
        if (
          !spellId ||
          !(TARGETS.has(spellId) || aliasAuras.has(spellId)) ||
          e.destUnitId !== unit.id
        )
          continue;
        const key = `${e.srcUnitId ?? ""}|${spellId}`;
        const ev = e.logLine.event as string;
        const t = e.logLine.timestamp as number;
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
          const d = Math.round(((t - o.t) / 1000) * 2) / 2;
          if (d < 0 || d > 120) continue;
          const h = hist.get(key) ?? new Map<number, number>();
          h.set(d, (h.get(d) ?? 0) + 1);
          hist.set(key, h);
        }
      }
    }
    for (const [key, h] of hist) {
      const v = modeOf(h);
      if (v === null) continue;
      const [srcId, spellId] = key.split("|") as [string, string];
      const caster = legacy.units[srcId];
      if (!caster?.info) continue;
      const own: Record<string, Own> = {};
      for (const t of TALENTS) own[t] = talentModifierOwnershipOf(caster, t);
      const list = cellsByAura.get(spellId) ?? [];
      list.push({ v, own });
      cellsByAura.set(spellId, list);
    }
  }
}

const modal = (xs: number[]) => {
  const h = new Map<number, number>();
  for (const x of xs) h.set(x, (h.get(x) ?? 0) + 1);
  return [...h].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
};
type Dump = {
  files: number;
  rounds: number;
  cellsByAura: Record<string, Array<{ v: number; own: Record<string, Own> }>>;
  coApplied: Record<string, Record<string, number>>;
};
let scannedFiles = files.length;
if (dumpTo) {
  const d: Dump = {
    files: files.length,
    rounds,
    cellsByAura: Object.fromEntries(cellsByAura),
    coApplied: Object.fromEntries(
      [...coApplied].map(([k, m]) => [k, Object.fromEntries(m)]),
    ),
  };
  writeFileSync(dumpTo, JSON.stringify(d));
  console.log(`dumped ${files.length} files / ${rounds} rounds to ${dumpTo}`);
  process.exit(0);
}
for (const path of fromDumps) {
  const d = JSON.parse(readFileSync(path, "utf8")) as Dump;
  scannedFiles += d.files;
  rounds += d.rounds;
  for (const [aura, cells] of Object.entries(d.cellsByAura))
    cellsByAura.set(aura, [...(cellsByAura.get(aura) ?? []), ...cells]);
  for (const [t, m] of Object.entries(d.coApplied)) {
    const cur = coApplied.get(t) ?? new Map<string, number>();
    for (const [aura, n] of Object.entries(m))
      cur.set(aura, (cur.get(aura) ?? 0) + n);
    coApplied.set(t, cur);
  }
}

function auraFor(target: string): string | null {
  if (cellsByAura.get(target)?.length) return target;
  const m = coApplied.get(target);
  if (!m) return null;
  const total = [...m.values()].reduce((x, y) => x + y, 0);
  const [best, n] = [...m].sort(
    (p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1),
  )[0] ?? ["", 0];
  return best && n / total >= 0.8 ? best : null;
}
const out = CANDIDATES.map((c) => {
  const measuredAura = auraFor(c.target);
  const b = {
    yes: [] as number[],
    no: [] as number[],
    unknown: [] as number[],
  };
  for (const cell of measuredAura ? (cellsByAura.get(measuredAura) ?? []) : [])
    b[cell.own[c.talent]!].push(cell.v);
  const nonModal = modal(b.no)[0];
  const base =
    b.no.length >= 10 && nonModal
      ? nonModal[0]
      : buffFullDurationForCaster(measuredAura ?? c.target, undefined);
  const expected =
    base === undefined
      ? undefined
      : c.aura === "107"
        ? base + c.value / 1000
        : base * (1 + c.value / 100);
  const near =
    expected === undefined
      ? 0
      : b.yes.filter((x) => Math.abs(x - expected) <= 0.5).length;
  let verdict: string;
  if (c.value === 0) verdict = "not promoted: value 0 (scripted amount)";
  else if (expected === undefined || base === undefined)
    verdict = "not promoted: no base duration";
  else if (expected <= base)
    verdict = "not promoted: reduction (lifetimes cannot promote)";
  else if (b.yes.length < 20)
    verdict = `not promoted: ${b.yes.length} holder cells`;
  else if (near / b.yes.length >= 0.5) verdict = "PROMOTE";
  else if (
    b.yes.filter((x) => Math.abs(x - base) <= 0.5).length / b.yes.length >=
    0.5
  )
    verdict = "not promoted: holders at base";
  else verdict = "not promoted: holders elsewhere";
  return {
    ...c,
    targetEn: getEnglishSpellName(c.target, ""),
    measuredAura,
    base,
    expected,
    holders: { cells: b.yes.length, near, top: modal(b.yes).slice(0, 3) },
    nonHolders: { cells: b.no.length, top: modal(b.no).slice(0, 3) },
    unknown: b.unknown.length,
    verdict,
  };
});

const outDir = join(home, "reports/talent-integration-2026-09-13");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, `durationTalent${tag ? `.${tag}` : ""}.json`),
  JSON.stringify({ files: scannedFiles, rounds, rows: out }, null, 1),
);
console.log(`files ${scannedFiles} rounds ${rounds}`);
for (const r of out)
  console.log(
    `${r.verdict.padEnd(48)} ${r.targetEn || r.targetZh} ${r.target}${r.measuredAura && r.measuredAura !== r.target ? `→aura ${r.measuredAura}` : ""} ← ${r.talentZh} ${r.talent} (${r.aura === "107" ? `${r.value / 1000}s` : `${r.value}%`}) base ${r.base} exp ${r.expected} | holders ${r.holders.cells} near ${r.holders.near} top ${JSON.stringify(r.holders.top)} | non ${r.nonHolders.cells} top ${JSON.stringify(r.nonHolders.top)} | unknown ${r.unknown}`,
  );
