/**
 * mitigationStackPairScan.ts — how do TWO percentage damage reductions
 * combine? (GH #95, user 2026-09-13: "先从两个技能叠加开始看起"; the double-up
 * verdict — "if you'd only given one, which is worth more" — needs the rule.)
 *
 * The product never modelled stacking (counterfactual.ts prices entries
 * independently; BACKLOG #41 (6) left it that way for death counterfactuals).
 * The only rule on hand is TrinityCore's reverse-engineered one (different
 * auras multiply, same SpellGroup takes the max), never checked against logs.
 *
 * Method (per the Game-Behaviour Rule: measure, don't assume):
 *  - every damage line carries `amount` and `baseAmount` (decodeDamage). The
 *    per-hit ratio (amount + absorbed + blocked) / baseAmount is what the game
 *    let through after its reductions.
 *  - Normalise by the SAME target's median ratio, same round, same school class
 *    (physical vs magic), over hits with no MITIGATION_TABLE aura active — that
 *    cancels armor, versatility, passives and PvP modifiers constant per target.
 *  - Group normalised ratios by the set of table auras active at the hit
 *    (school mask must cover the hit): none / exactly one A / exactly two A+B.
 *  - Step 0 validates the semantics: a single aura's median should land near
 *    1 − pct/100. Only then compare a pair's observed median with
 *    multiplicative m_A·m_B, additive 1 − (1−m_A) − (1−m_B), and max min(m_A,m_B),
 *    using the observed single medians (not the table) as inputs.
 *  - Also: physical hits taken while Cloak of Shadows (31224) is the only table
 *    aura up — the user recalls a talent adding physical reduction to Cloak.
 *
 * Baseline 2026-09-13 (S2 archive every 30: 605 files, 1,270 rounds, 3.2 M
 * hits, baseAmount joined on all but 162):
 *  - Step 0 holds: single-aura medians match the table where no talent
 *    applies (Defensive Stance 0.85, Ironbark 0.80, Divine Protection 0.65,
 *    Astral Shift 0.60, Dispersion 0.25); talented ones measure stronger
 *    (Barkskin 0.61–0.70 vs 0.80, Unending Resolve 0.60 vs 0.75, Pain
 *    Suppression 0.50–0.57 vs 0.60). Time Dilation reads 1.0 (absorb, added
 *    back); Avatar's 3 % is not visible.
 *  - Within-unit, pairs where BOTH auras measurably reduce (51 pairs, 311
 *    units): multiplicative closest for 190 units, additive 70, max 51;
 *    median |error| mult 0.026 / add 0.096 / max 0.126. E.g. Aura Mastery +
 *    Divine Protection 0.474 (mult 0.478, add 0.386, max 0.643); Survival of
 *    the Fittest + Pain Suppression 0.373 (mult 0.381, add 0.249, max 0.53).
 *    Pairs with a non-reducing side (Avatar, Time Dilation) cannot tell the
 *    rules apart and are excluded from that count.
 *  - Cloak of Shadows, physical hits with Cloak the only table aura up, split
 *    by talentOwnershipOf(457034 Bait and Switch): holders 0.813 (n 367),
 *    non-holders 0.965 (n 2,928) → the hero talent's 20 % is real; the
 *    table's magic-only Cloak entry misses it for holders.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/mitigationStackPairScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt [--every 30] [--crit-only-non]
 * Output: $GLADLOG_EVAL_HOME/reports/mitigation-stacking-2026-09-13/{pairs.json,pairs.md}
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  MITIGATION_TABLE,
  mitigationPctFor,
} from "@gladlog/analysis/src/data/mitigationData";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { talentOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch, parseLine } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

const CLOAK = "31224";
/** Bait and Switch (hero talent, Rogue): DB2 457034 aura107 SpellModOp 23
 * −20 on Cloak's class mask 0x10000 — fills Cloak effect #2 (aura87 physical,
 * base 0) → 20 % physical reduction while cloaked. */
const BAIT_AND_SWITCH = "457034";
const MIN_SINGLE_N = 30;
const MIN_PAIR_N = 20;

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { manifest: "", every: 30, archiveDir: process.cwd() };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
  }
  if (!out.manifest) {
    console.error(
      "usage: mitigationStackPairScan.ts --manifest <path> [--every N]",
    );
    process.exit(1);
  }
  return out;
}

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const args = parseArgs();
await ensureAnalysisData();
const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

const arith = Object.entries(MITIGATION_TABLE).filter(
  ([, e]) => e.pct > 0 && e.pct < 100 && !e.positional,
);
const arithIds = new Set(arith.map(([id]) => id));

// key → normalised ratios, split by crit / non-crit
const singles = new Map<string, { non: number[]; crit: number[] }>();
const pairs = new Map<string, { non: number[]; crit: number[] }>();
const cloakPhys = { non: [] as number[], crit: [] as number[] };
const cloakPhysByTalent: Record<string, number[]> = {
  yes: [],
  no: [],
  unknown: [],
};
/** Within-unit comparison (the pooled singles mix players with different
 * talents): for each pair A+B, every unit that took ≥ WITHIN_MIN non-crit hits
 * under A alone, B alone AND A+B contributes one row of medians. */
const WITHIN_MIN = 3;
const within = new Map<
  string,
  Array<{ mA: number; mB: number; mAB: number; nAB: number }>
>();
const noneCheck = { non: [] as number[], crit: [] as number[] };
let rounds = 0,
  hits = 0,
  usable = 0,
  baseMissing = 0;

const push = (
  m: Map<string, { non: number[]; crit: number[] }>,
  k: string,
  crit: boolean,
  v: number,
) => {
  let b = m.get(k);
  if (!b) m.set(k, (b = { non: [], crit: [] }));
  (crit ? b.crit : b.non).push(v);
};

for (const f of files) {
  const p = f.startsWith("/") ? f : resolve(args.archiveDir, f);
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
  // The parser slims every event's advanced tail at compose time
  // (slim.ts SLIM_PARAMS_KEEP) — baseAmount and the crit flag are gone from
  // the match doc. Decode them from the raw lines and join back by
  // timestamp|src|dest|spell|amount.
  const tails = new Map<
    string,
    {
      base: number;
      crit: boolean;
      absorbed: number;
      blocked: number;
      school: number;
      amount: number;
    }
  >();
  for (const line of text.split("\n")) {
    parser.push(line);
    if (!line.includes("_DAMAGE,")) continue;
    const pl = parseLine(line);
    if (!pl?.damage || !pl.base || pl.eventName === "DAMAGE_SPLIT") continue;
    const sid = pl.spell?.spellId ?? 0;
    tails.set(
      `${pl.timestamp}|${pl.base.srcGuid}|${pl.base.destGuid}|${sid}|${pl.damage.amount}`,
      {
        base: pl.damage.baseAmount,
        crit: pl.damage.critical,
        absorbed: pl.damage.absorbed,
        blocked: pl.damage.blocked,
        school: pl.damage.school,
        amount: pl.damage.amount,
      },
    );
  }
  parser.end();
  for (const m of items) {
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const combat = { startTime: legacy.startTime, endTime: legacy.endTime };
    const { friends, enemies } = splitTeams(legacy);
    for (const u of [...friends, ...enemies] as ICombatUnit[]) {
      const ivs = buildAuraIntervals(u, combat).filter(
        (iv) => arithIds.has(iv.spellId) || iv.spellId === CLOAK,
      );
      // decode every hit once
      const rows: Array<{
        tS: number;
        phys: boolean;
        school: number;
        crit: boolean;
        ratio: number;
      }> = [];
      const glad = (m as any).units?.[u.id];
      for (const d of glad?.damageIn ?? []) {
        const ev = d.eventName as string | undefined;
        if (!ev || ev === "DAMAGE_SPLIT" || !ev.endsWith("_DAMAGE")) continue;
        if (d.srcId === u.id) continue;
        const t = tails.get(
          `${d.timestamp}|${d.srcId}|${d.destId}|${d.spellId}|${d.amount}`,
        );
        hits++;
        if (!t) {
          baseMissing++;
          continue;
        }
        const dd = {
          baseAmount: t.base,
          amount: t.amount,
          absorbed: t.absorbed,
          blocked: t.blocked,
          school: t.school,
          critical: t.crit,
        };
        if (!(dd.baseAmount > 0) || !(dd.amount >= 0)) {
          baseMissing++;
          continue;
        }
        const through =
          dd.amount + Math.max(dd.absorbed, 0) + Math.max(dd.blocked, 0);
        rows.push({
          tS: (d.timestamp - legacy.startTime) / 1000,
          phys: dd.school === 1,
          school: dd.school,
          crit: dd.critical,
          ratio: through / dd.baseAmount,
        });
      }
      if (!rows.length) continue;
      const activeAt = (tS: number, school: number) =>
        ivs.filter(
          (iv) =>
            iv.fromS <= tS &&
            iv.toS >= tS &&
            ((iv.spellId === CLOAK && true) ||
              (MITIGATION_TABLE[iv.spellId]!.schoolMask & school) !== 0),
        );
      // baseline per school class: hits with no table aura (and no Cloak) up
      const base = { phys: [] as number[], magic: [] as number[] };
      const tagged = rows.map((r) => ({ r, act: activeAt(r.tS, r.school) }));
      for (const { r, act } of tagged)
        if (!act.length && !r.crit)
          (r.phys ? base.phys : base.magic).push(r.ratio);
      const bPhys = median(base.phys),
        bMagic = median(base.magic);
      const unitBuckets = new Map<string, number[]>();
      for (const { r, act } of tagged) {
        const b = r.phys ? bPhys : bMagic;
        const nb = r.phys ? base.phys.length : base.magic.length;
        if (!(b > 0) || nb < 5) continue;
        const v = r.ratio / b;
        usable++;
        const ids = [...new Set(act.map((iv) => iv.spellId))];
        if (!ids.length) {
          (r.crit ? noneCheck.crit : noneCheck.non).push(v);
          continue;
        }
        if (ids.length === 1 && ids[0] === CLOAK) {
          if (r.phys) (r.crit ? cloakPhys.crit : cloakPhys.non).push(v);
          if (r.phys && !r.crit)
            cloakPhysByTalent[talentOwnershipOf(u, BAIT_AND_SWITCH)]?.push(v);
          continue;
        }
        if (ids.includes(CLOAK)) continue;
        // pct depends on who carries it (pctOnOthers); key by id + pct
        const keyOf = (id: string) => {
          const iv = act.find((x) => x.spellId === id)!;
          const pct = mitigationPctFor(
            MITIGATION_TABLE[id]!,
            iv.srcUnitName === u.name,
          );
          return `${id}@${pct}`;
        };
        const keys = ids.map(keyOf).sort();
        const cls = r.phys ? "phys" : "magic";
        if (keys.length === 1) push(singles, `${keys[0]}|${cls}`, r.crit, v);
        else if (keys.length === 2)
          push(pairs, `${keys[0]}+${keys[1]}|${cls}`, r.crit, v);
        if (!r.crit && keys.length <= 2) {
          const uk = `${keys.join("+")}|${cls}`;
          let arr = unitBuckets.get(uk);
          if (!arr) unitBuckets.set(uk, (arr = []));
          arr.push(v);
        }
      }
      for (const [uk, ab] of unitBuckets) {
        const [set, cls] = uk.split("|");
        const parts = set!.split("+");
        if (parts.length !== 2 || ab.length < WITHIN_MIN) continue;
        const a = unitBuckets.get(`${parts[0]}|${cls}`);
        const b = unitBuckets.get(`${parts[1]}|${cls}`);
        if (!a || !b || a.length < WITHIN_MIN || b.length < WITHIN_MIN)
          continue;
        let arr = within.get(uk);
        if (!arr) within.set(uk, (arr = []));
        arr.push({
          mA: median(a),
          mB: median(b),
          mAB: median(ab),
          nAB: ab.length,
        });
      }
    }
  }
}

const nameOf = (k: string) => {
  const [id, pct] = k.split("@");
  return `${getEnglishSpellName(id!) ?? id} ${pct}%`;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const singleRows = [...singles]
  .filter(([, v]) => v.non.length >= MIN_SINGLE_N)
  .map(([k, v]) => {
    const [aura, cls] = k.split("|");
    const pct = Number(aura!.split("@")[1]);
    return {
      key: k,
      name: `${nameOf(aura!)} (${cls})`,
      n: v.non.length,
      observed: r3(median(v.non)),
      table: r3(1 - pct / 100),
      nCrit: v.crit.length,
      observedCrit: r3(median(v.crit)),
    };
  })
  .sort((a, b) => b.n - a.n);
const singleMed = new Map(singleRows.map((s) => [s.key, s.observed]));

const pairRows = [...pairs]
  .filter(([, v]) => v.non.length >= MIN_PAIR_N)
  .map(([k, v]) => {
    const [set, cls] = k.split("|");
    const [a, b] = set!.split("+");
    const mA = singleMed.get(`${a}|${cls}`);
    const mB = singleMed.get(`${b}|${cls}`);
    const obs = median(v.non);
    const pa = Number(a!.split("@")[1]) / 100,
      pb = Number(b!.split("@")[1]) / 100;
    const out: any = {
      pair: `${nameOf(a!)} + ${nameOf(b!)} (${cls})`,
      n: v.non.length,
      observed: r3(obs),
      tableMult: r3((1 - pa) * (1 - pb)),
      tableAdd: r3(Math.max(0, 1 - pa - pb)),
      tableMax: r3(1 - Math.max(pa, pb)),
    };
    if (mA !== undefined && mB !== undefined) {
      out.singleA = mA;
      out.singleB = mB;
      out.predMult = r3(mA * mB);
      out.predAdd = r3(Math.max(0, mA + mB - 1));
      out.predMax = r3(Math.min(mA, mB));
      const errs = {
        mult: Math.abs(obs - mA * mB),
        add: Math.abs(obs - Math.max(0, mA + mB - 1)),
        max: Math.abs(obs - Math.min(mA, mB)),
      };
      out.closest = Object.entries(errs).sort((x, y) => x[1] - y[1])[0]![0];
    }
    return out;
  })
  .sort((a, b) => b.n - a.n);

// within-unit verdicts: per unit, which rule predicts its A+B median best;
// pooled over every pair, plus the median signed error of each rule
const withinRows = [...within]
  .map(([k, rows]) => {
    const [set, cls] = k.split("|");
    const [a, b] = set!.split("+");
    const err = {
      mult: [] as number[],
      add: [] as number[],
      max: [] as number[],
    };
    const wins = { mult: 0, add: 0, max: 0 };
    for (const w of rows) {
      const e = {
        mult: w.mAB - w.mA * w.mB,
        add: w.mAB - Math.max(0, w.mA + w.mB - 1),
        max: w.mAB - Math.min(w.mA, w.mB),
      };
      err.mult.push(e.mult);
      err.add.push(e.add);
      err.max.push(e.max);
      const best = (Object.entries(e) as [keyof typeof wins, number][]).sort(
        (x, y) => Math.abs(x[1]) - Math.abs(y[1]),
      )[0]![0];
      wins[best]++;
    }
    return {
      pair: `${nameOf(a!)} + ${nameOf(b!)} (${cls})`,
      units: rows.length,
      medianA: r3(median(rows.map((w) => w.mA))),
      medianB: r3(median(rows.map((w) => w.mB))),
      medianAB: r3(median(rows.map((w) => w.mAB))),
      medianErr: {
        mult: r3(median(err.mult)),
        add: r3(median(err.add)),
        max: r3(median(err.max)),
      },
      medianAbsErr: {
        mult: r3(median(err.mult.map(Math.abs))),
        add: r3(median(err.add.map(Math.abs))),
        max: r3(median(err.max.map(Math.abs))),
      },
      wins,
    };
  })
  .sort((x, y) => y.units - x.units);
const withinTotals = withinRows.reduce(
  (acc, r) => {
    acc.units += r.units;
    acc.mult += r.wins.mult;
    acc.add += r.wins.add;
    acc.max += r.wins.max;
    return acc;
  },
  { units: 0, mult: 0, add: 0, max: 0 },
);

const summary = {
  withinUnitWins: withinTotals,
  files: files.length,
  rounds,
  hits,
  baseAmountMissing: baseMissing,
  usableNormalisedHits: usable,
  noneNormalisedMedian: {
    non: r3(median(noneCheck.non)),
    crit: r3(median(noneCheck.crit)),
    nCrit: noneCheck.crit.length,
  },
  cloakPhysicalByBaitAndSwitch: Object.fromEntries(
    Object.entries(cloakPhysByTalent).map(([k, v]) => [
      k,
      { n: v.length, median: r3(median(v)) },
    ]),
  ),
  cloakPhysicalOnly: {
    n: cloakPhys.non.length,
    median: r3(median(cloakPhys.non)),
    nCrit: cloakPhys.crit.length,
    medianCrit: r3(median(cloakPhys.crit)),
  },
  closestCounts: pairRows.reduce((acc: Record<string, number>, r) => {
    if (r.closest) acc[r.closest] = (acc[r.closest] ?? 0) + 1;
    return acc;
  }, {}),
};

const outDir = join(
  process.env.GLADLOG_EVAL_HOME ??
    join(process.env.HOME ?? "", "code/gladlog-eval-private"),
  "reports/mitigation-stacking-2026-09-13",
);
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "pairs.json"),
  JSON.stringify(
    { summary, singles: singleRows, pairs: pairRows, within: withinRows },
    null,
    1,
  ),
);
console.log(JSON.stringify(summary, null, 1));
console.log("\nSINGLES (non-crit median vs table)");
for (const s of singleRows.slice(0, 40))
  console.log(
    `${s.name.padEnd(48)} n=${String(s.n).padStart(6)} obs ${s.observed} table ${s.table}`,
  );
console.log("\nPAIRS (non-crit)");
for (const r of pairRows)
  console.log(
    `${r.pair.padEnd(70)} n=${String(r.n).padStart(5)} obs ${r.observed} | from singles: mult ${r.predMult} add ${r.predAdd} max ${r.predMax} → ${r.closest ?? "-"} | table mult ${r.tableMult} add ${r.tableAdd} max ${r.tableMax}`,
  );
console.log("\nWITHIN-UNIT (same player: A alone, B alone, A+B)");
for (const r of withinRows)
  console.log(
    `${r.pair.padEnd(70)} units=${String(r.units).padStart(4)} A ${r.medianA} B ${r.medianB} AB ${r.medianAB} | |err| mult ${r.medianAbsErr.mult} add ${r.medianAbsErr.add} max ${r.medianAbsErr.max} | wins m${r.wins.mult}/a${r.wins.add}/x${r.wins.max}`,
  );
