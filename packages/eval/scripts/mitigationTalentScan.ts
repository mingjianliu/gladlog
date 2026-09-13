/**
 * mitigationTalentScan.ts — do talent value-modifiers on percentage defensives
 * show up in the damage the game actually let through?
 *
 * Why (2026-09-13, talent integration): `mitigationPctFor` prices every
 * MITIGATION_TABLE aura at its DB2 base and ignores talents. The talent catalog
 * × gap audit found 12 DB2 value-modifiers (aura 107, SpellModOp on the very
 * effect index that carries the reduction) that no code reads, 8 of them taken
 * by >= 96 % of their spec (pick-rate scan). Game-Behaviour Rule: DB2 row +
 * class mask are automated; this is the corpus split and the arithmetic check.
 *
 * Method (same per-hit ratio as mitigationStackPairScan.ts): (amount + absorbed
 * + blocked) / baseAmount from the raw damage lines, normalised by the same
 * target's median over hits with no table aura up (same round, same school
 * class). For each candidate (aura A, talent K, school the modifier touches):
 * hits where A is the ONLY table aura up and the school matches, split by
 * `talentOwnershipOf(caster of A, K)`. Expect holders ≈ 1 − (base + mod) and
 * non-holders ≈ 1 − base.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/mitigationTalentScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt [--every 30]
 * Output: $GLADLOG_EVAL_HOME/reports/talent-integration-2026-09-13/mitigationTalent.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { talentOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser, type GladMatch, parseLine } from "@gladlog/parser";
import { type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

/** (aura, talent, school mask the modified effect covers, DB2 base %, modifier %) */
const CANDIDATES: Array<{
  aura: string;
  name: string;
  talent: string;
  talentName: string;
  school: number;
  basePct: number;
  modPct: number;
}> = [
  {
    aura: "22812",
    name: "Barkskin",
    talent: "449191",
    talentName: "Oakskin",
    school: 127,
    basePct: 20,
    modPct: 10,
  },
  {
    aura: "22812",
    name: "Barkskin",
    talent: "393618",
    talentName: "Reinforced Fur",
    school: 127,
    basePct: 20,
    modPct: 10,
  },
  {
    aura: "498",
    name: "Divine Protection",
    talent: "1261562",
    talentName: "复仇之盾",
    school: 127,
    basePct: 35,
    modPct: 10,
  },
  {
    aura: "33206",
    name: "Pain Suppression",
    talent: "440738",
    talentName: "洞悉大局",
    school: 127,
    basePct: 40,
    modPct: 10,
  },
  {
    aura: "264735",
    name: "Survival of the Fittest",
    talent: "472707",
    talentName: "龟壳庇护",
    school: 127,
    basePct: 25,
    modPct: 10,
  },
  {
    aura: "363916",
    name: "Obsidian Scales",
    talent: "441180",
    talentName: "Hardened Scales",
    school: 127,
    basePct: 30,
    modPct: 10,
  },
  {
    aura: "104773",
    name: "Unending Resolve",
    talent: "317138",
    talentName: "Strength of Will",
    school: 127,
    basePct: 25,
    modPct: 15,
  },
  {
    aura: "31224",
    name: "Cloak of Shadows (physical)",
    talent: "457034",
    talentName: "Bait and Switch",
    school: 1,
    basePct: 0,
    modPct: 20,
  },
  {
    aura: "1022",
    name: "Blessing of Protection (magic)",
    talent: "387801",
    talentName: "回响祝福",
    school: 126,
    basePct: 0,
    modPct: 15,
  },
  {
    aura: "108271",
    name: "Astral Shift",
    talent: "377933",
    talentName: "Astral Bulwark",
    school: 127,
    basePct: 40,
    modPct: 20,
  },
  {
    aura: "186265",
    name: "Aspect of the Turtle",
    talent: "1267218",
    talentName: "甲壳壁垒",
    school: 127,
    basePct: 30,
    modPct: 20,
  },
];
const TRACK = new Set([
  ...Object.keys(MITIGATION_TABLE),
  ...CANDIDATES.map((c) => c.aura),
]);

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "30"));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const buckets = new Map<
  string,
  { yes: number[]; no: number[]; unknown: number[] }
>();
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
    tails.set(
      `${pl.timestamp}|${pl.base.srcGuid}|${pl.base.destGuid}|${pl.spell?.spellId ?? 0}|${pl.damage.amount}`,
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
    const players = [...friends, ...enemies] as ICombatUnit[];
    const byName = new Map(players.map((p) => [p.name, p]));
    for (const u of players) {
      const ivs = buildAuraIntervals(u, combat).filter((iv) =>
        TRACK.has(iv.spellId),
      );
      const rows: Array<{
        tS: number;
        phys: boolean;
        school: number;
        ratio: number;
      }> = [];
      const glad = (m as any).units?.[u.id];
      for (const d of glad?.damageIn ?? []) {
        const ev = d.eventName as string | undefined;
        if (
          !ev ||
          ev === "DAMAGE_SPLIT" ||
          !ev.endsWith("_DAMAGE") ||
          d.srcId === u.id
        )
          continue;
        const t = tails.get(
          `${d.timestamp}|${d.srcId}|${d.destId}|${d.spellId}|${d.amount}`,
        );
        if (!t || !(t.base > 0) || t.crit) continue;
        rows.push({
          tS: (d.timestamp - legacy.startTime) / 1000,
          phys: t.school === 1,
          school: t.school,
          ratio:
            (t.amount + Math.max(t.absorbed, 0) + Math.max(t.blocked, 0)) /
            t.base,
        });
      }
      if (!rows.length) continue;
      const active = (tS: number) =>
        ivs.filter((iv) => iv.fromS <= tS && iv.toS >= tS);
      const base = { phys: [] as number[], magic: [] as number[] };
      const tagged = rows.map((r) => ({ r, act: active(r.tS) }));
      for (const { r, act } of tagged)
        if (!act.length) (r.phys ? base.phys : base.magic).push(r.ratio);
      const bP = median(base.phys),
        bM = median(base.magic);
      for (const { r, act } of tagged) {
        const ids = [...new Set(act.map((iv) => iv.spellId))];
        if (ids.length !== 1) continue;
        const b = r.phys ? bP : bM;
        if (!(b > 0) || (r.phys ? base.phys.length : base.magic.length) < 5)
          continue;
        for (const c of CANDIDATES) {
          if (c.aura !== ids[0] || (c.school & r.school) === 0) continue;
          const iv = act[0]!;
          const caster = byName.get(iv.srcUnitName) ?? u;
          const own = talentOwnershipOf(caster, c.talent);
          const key = `${c.aura}|${c.talent}`;
          const bk = buckets.get(key) ?? { yes: [], no: [], unknown: [] };
          bk[own].push(r.ratio / b);
          buckets.set(key, bk);
        }
      }
    }
  }
}

const out = CANDIDATES.map((c) => {
  const bk = buckets.get(`${c.aura}|${c.talent}`) ?? {
    yes: [],
    no: [],
    unknown: [],
  };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    ...c,
    expectedWith: r3(1 - (c.basePct + c.modPct) / 100),
    expectedWithout: r3(1 - c.basePct / 100),
    holders: { n: bk.yes.length, median: r3(median(bk.yes)) },
    nonHolders: { n: bk.no.length, median: r3(median(bk.no)) },
    unknown: { n: bk.unknown.length, median: r3(median(bk.unknown)) },
  };
});
const dir = join(
  process.env.GLADLOG_EVAL_HOME ??
    join(process.env.HOME ?? "", "code/gladlog-eval-private"),
  "reports/talent-integration-2026-09-13",
);
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "mitigationTalent.json"),
  JSON.stringify({ files: files.length, rounds, candidates: out }, null, 1),
);
for (const r of out)
  console.log(
    `${r.name.padEnd(34)} +${r.talentName.padEnd(18)} expect with ${r.expectedWith} / without ${r.expectedWithout} | holders ${r.holders.median} (n ${r.holders.n}) non ${r.nonHolders.median} (n ${r.nonHolders.n}) unknown ${r.unknown.median} (n ${r.unknown.n})`,
  );
