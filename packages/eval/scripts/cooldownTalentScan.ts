/**
 * cooldownTalentScan.ts — GH #96 M6: do the cooldown modifiers recovered from
 * SpellLabel (aura 218 / 219) and SpellCategory (aura 341) SpellMods show up
 * in how soon holders recast the target spell?
 *
 * Why: genTalentModifiers now compiles those two encodings (Angel's Mercy
 * Desperate Prayer −20 s, Frequent Donor Dark Pact −15 s, Eternal Hunt The Hunt
 * −15 s, …). DB2 row + target resolution are two legs of the Game-Behaviour
 * Rule; this is the corpus leg.
 *
 * Cells: one (spell, caster) per round with ≥ 2 SPELL_CAST_SUCCESS; the cell
 * value is its shortest gap between consecutive casts. Spells with more than
 * one charge (spellEffectData `charges` > 1) are skipped — a charge makes the
 * gap meaningless. Ownership: talentModifierOwnershipOf.
 *
 * PREDECLARED RULE (written 2026-09-14 before the first run, committed with
 * this file). base = DB2 cooldown (spellEffectData.cooldownSeconds, PvP-aware);
 * expected = base − s (reduce_cd) or base × (1 − p/100) (reduce_cd_pct);
 * tolerance 1 s (GCD / latency).
 *  - SUPPORTED when ≥ 20 holder cells, at least one holder cell gap lies in
 *    [expected − 1, base − 1) — shorter than the untalented cooldown allows —,
 *    ≤ 2 % of holder cells lie below expected − 1, and ≤ 2 % of NON-holder
 *    cells lie below base − 1 (a reset effect shared by everyone would make
 *    short gaps meaningless);
 *  - otherwise NOT SUPPORTED with the reason. Increases (negative reduce_cd)
 *    are reported but never "supported" by gaps: a longer cooldown cannot be
 *    shown by players waiting longer.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/cooldownTalentScan.ts --manifest <manifest> [--every 5]
 *     [--shard i --shards n --dump f | --from-dumps a,b] [--before <talentModifiers.before.json>]
 * `--before` limits the report to rows absent from that file (the new rows).
 * Output: stdout + $GLADLOG_EVAL_HOME/reports/talent-integration-2026-09-13/cooldownTalent[.tag].json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import talentModifiers from "@gladlog/analysis/src/data/talentModifiers.json";
import { talentModifierOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "5"));
const shard = Number(arg("--shard", "0"));
const shards = Number(arg("--shards", "1"));
const dumpTo = arg("--dump", "");
const fromDumps = arg("--from-dumps", "").split(",").filter(Boolean);
const tag = arg("--tag", "");
const beforePath = arg("--before", "");

type Mod = {
  talentSpellId: string;
  effect: string;
  value: number;
  sourceRowId?: string;
};
const MODS = talentModifiers as unknown as Record<string, Mod[]>;
const before: Record<string, Mod[]> = beforePath
  ? JSON.parse(readFileSync(beforePath, "utf8"))
  : {};
const key = (t: string, m: Mod) =>
  `${t}|${m.talentSpellId}|${m.effect}|${m.value}|${m.sourceRowId ?? ""}`;
const beforeKeys = new Set(
  Object.entries(before).flatMap(([t, ms]) => ms.map((m) => key(t, m))),
);
const CANDIDATES: Array<{ target: string } & Mod> = [];
for (const [t, ms] of Object.entries(MODS))
  for (const m of ms) {
    if (m.effect !== "reduce_cd" && m.effect !== "reduce_cd_pct") continue;
    if (beforePath && beforeKeys.has(key(t, m))) continue;
    const e = spellEffectData[t] as any;
    if (!e?.cooldownSeconds || (e.charges ?? 1) > 1) continue;
    CANDIDATES.push({ target: t, ...m });
  }
const TARGETS = new Set(CANDIDATES.map((c) => c.target));
const TALENTS = [...new Set(CANDIDATES.map((c) => c.talentSpellId))];

type Own = "yes" | "no" | "unknown";
type Cell = { gap: number; own: Record<string, Own> };
const cellsBySpell = new Map<string, Cell[]>();

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
    for (const u of Object.values(legacy.units) as any[]) {
      if (!u.info) continue;
      const bySpell = new Map<string, number[]>();
      for (const c of u.spellCastEvents ?? []) {
        if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
        const id = String(c.spellId ?? "");
        if (!TARGETS.has(id)) continue;
        const l = bySpell.get(id) ?? [];
        l.push(c.timestamp);
        bySpell.set(id, l);
      }
      if (!bySpell.size) continue;
      const own: Record<string, Own> = {};
      for (const t of TALENTS) own[t] = talentModifierOwnershipOf(u, t);
      for (const [id, ts] of bySpell) {
        if (ts.length < 2) continue;
        ts.sort((x, y) => x - y);
        let gap = Infinity;
        for (let i = 1; i < ts.length; i++)
          gap = Math.min(gap, (ts[i]! - ts[i - 1]!) / 1000);
        const l = cellsBySpell.get(id) ?? [];
        l.push({ gap: Math.round(gap * 10) / 10, own });
        cellsBySpell.set(id, l);
      }
    }
  }
}

let scanned = files.length;
if (dumpTo) {
  writeFileSync(
    dumpTo,
    JSON.stringify({
      files: files.length,
      rounds,
      cells: Object.fromEntries(cellsBySpell),
    }),
  );
  console.log(`dumped ${files.length} files / ${rounds} rounds`);
  process.exit(0);
}
for (const p of fromDumps) {
  const d = JSON.parse(readFileSync(p, "utf8"));
  scanned += d.files;
  rounds += d.rounds;
  for (const [id, cells] of Object.entries(d.cells as Record<string, Cell[]>))
    cellsBySpell.set(id, [...(cellsBySpell.get(id) ?? []), ...cells]);
}

const out = CANDIDATES.map((c) => {
  const base = (spellEffectData[c.target] as any).cooldownSeconds as number;
  const expected =
    c.effect === "reduce_cd" ? base - c.value : base * (1 - c.value / 100);
  const cells = cellsBySpell.get(c.target) ?? [];
  const holders = cells.filter((x) => x.own[c.talentSpellId] === "yes");
  const non = cells.filter((x) => x.own[c.talentSpellId] === "no");
  const inBand = holders.filter(
    (x) => x.gap >= expected - 1 && x.gap < base - 1,
  ).length;
  const holderViolations = holders.filter((x) => x.gap < expected - 1).length;
  const nonShort = non.filter((x) => x.gap < base - 1).length;
  let verdict: string;
  if (expected >= base) verdict = "increase: not testable by gaps";
  else if (holders.length < 20)
    verdict = `not supported: ${holders.length} holder cells`;
  else if (inBand === 0)
    verdict = "not supported: no holder gap below the untalented cooldown";
  else if (holderViolations / holders.length > 0.02)
    verdict = "not supported: holders recast faster than the talented cooldown";
  else if (non.length && nonShort / non.length > 0.02)
    verdict = "not supported: non-holders also recast early (reset effect?)";
  else verdict = "SUPPORTED";
  const minGap = (xs: Cell[]) =>
    xs.length ? Math.min(...xs.map((x) => x.gap)) : null;
  return {
    target: c.target,
    targetName: getEnglishSpellName(c.target, ""),
    talent: c.talentSpellId,
    talentName: getEnglishSpellName(c.talentSpellId, ""),
    effect: c.effect,
    value: c.value,
    base,
    expected: Math.round(expected * 10) / 10,
    holders: holders.length,
    holdersInBand: inBand,
    holderViolations,
    holderMinGap: minGap(holders),
    nonHolders: non.length,
    nonHoldersShort: nonShort,
    nonHolderMinGap: minGap(non),
    verdict,
  };
});
const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
writeFileSync(
  join(
    home,
    `reports/talent-integration-2026-09-13/cooldownTalent${tag ? `.${tag}` : ""}.json`,
  ),
  JSON.stringify({ files: scanned, rounds, rows: out }, null, 1),
);
console.log(`files ${scanned} rounds ${rounds} candidates ${out.length}`);
for (const r of out.filter((r) => r.holders + r.nonHolders > 0))
  console.log(
    `${r.verdict.padEnd(62)} ${r.targetName} ${r.target} ← ${r.talentName} ${r.talent} ${r.effect} ${r.value} | base ${r.base} exp ${r.expected} | holders ${r.holders} inBand ${r.holdersInBand} viol ${r.holderViolations} min ${r.holderMinGap} | non ${r.nonHolders} short ${r.nonHoldersShort} min ${r.nonHolderMinGap}`,
  );
