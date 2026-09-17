/**
 * doubleDefensiveProbe.ts — GH #95 "给重了" in the user's strict sense
 * (2026-09-16): two MAJOR defensives from two DIFFERENT friendlies stacked on
 * the same target at the same time, when one would have been enough — "牧师给了
 * 痛苦压制,奶僧给了复苏之茧,那两个有一个其实就够了". Small cooldowns (Fade,
 * Power Word: Shield) never count.
 *
 * Major = externalDefensiveSpellIds ∪ bigDefensiveSpellIds (the lists the
 * product already treats as major). Any friendly target, any two casters
 * (self + healer, two healers, a DPS external such as Blessing of Protection).
 *
 * For each overlapping pair (ordered by application time; overlap =
 * [second.from, min(first.to, second.to)]) the SECOND aura's contribution over
 * the overlap is priced the way the product prices mitigation:
 *  - percentage aura: D × b / (1 − b), D = damage the target actually took
 *    during the overlap, b = resolveMitigation pctMin (talent-aware,
 *    carrier-aware); multiplicative stacking (measured 2026-09-13);
 *  - absorb aura: the absorbed amounts the log credits to the second caster
 *    during the overlap (victim-keyed absorbsIn);
 *  - immunity or off-table: unpriced (reported).
 * "One would have been enough" (candidate rule, for the user to judge): the
 * target's lowest HP during the overlap, with the second aura's contribution
 * added back as damage, still stays above the crisis line (40 %).
 *
 * Usage: npx tsx packages/eval/scripts/doubleDefensiveProbe.ts --manifest <m> [--every 10]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { CRISIS_HP_PCT } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  resolveMitigation,
  strongestComponentPct,
} from "@gladlog/analysis/src/data/mitigationComponents";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "10"));

const MAJOR = new Set<string>([
  ...spellIdLists.externalDefensiveSpellIds.map(String),
  ...spellIdLists.bigDefensiveSpellIds.map(String),
]);
const nameOf = (id: string) => getEnglishSpellName(id, "") || id;

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const t = {
  files: files.length,
  rounds: 0,
  pairs: 0,
  priced: 0,
  unpriced: 0,
  unpricedReason: {} as Record<string, number>,
  oneSufficed: 0,
  oneSufficedDied: 0,
  bothNeeded: 0,
  bothNeededDied: 0,
  secondContribPct: [] as number[],
  pairKinds: {} as Record<string, number>,
  /** was the target actually in crisis (<= 40 % at some point from 3 s before
   * the second aura to the end of the overlap) or was the stack pre-emptive? */
  oneSufficedInCrisis: 0,
  oneSufficedPreemptive: 0,
  bothNeededInCrisis: 0,
  bothNeededPreemptive: 0,
  byBracket: {} as Record<
    string,
    { rounds: number; pairs: number; oneSufficed: number }
  >,
};
const examples: Array<Record<string, unknown>> = [];

const hpSamples = (u: any) =>
  ((u.advancedActions ?? []) as any[])
    .filter((s) => (s.advancedActorMaxHp ?? 0) > 0)
    .map((s) => ({
      t: s.timestamp,
      hp: s.advancedActorCurrentHp / s.advancedActorMaxHp,
    }));

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
    t.rounds++;
    const bracket = String(legacy.startInfo?.bracket ?? "?");
    const b = (t.byBracket[bracket] ??= {
      rounds: 0,
      pairs: 0,
      oneSufficed: 0,
    });
    b.rounds++;
    const players = (Object.values(legacy.units ?? {}) as any[]).filter(
      (u) => u.info,
    );
    const byName = new Map(players.map((u) => [u.name, u]));
    const byId = new Map(players.map((u) => [u.id, u]));
    for (const target of players) {
      const friends = new Set(
        players
          .filter((u) => u.reaction === target.reaction)
          .map((u) => u.name),
      );
      const maxHp = Math.max(
        1,
        ...((target.advancedActions ?? []) as any[]).map(
          (x) => x.advancedActorMaxHp ?? 0,
        ),
      );
      const ivs = buildAuraIntervals(target, legacy, byId)
        .filter((iv) => MAJOR.has(iv.spellId) && friends.has(iv.srcUnitName))
        .sort((x, y) => x.fromS - y.fromS);
      const samples = hpSamples(target);
      const deaths = ((target.deathRecords ?? []) as any[]).map(
        (d) => d.timestamp as number,
      );
      for (let i = 0; i < ivs.length; i++) {
        for (let j = i + 1; j < ivs.length; j++) {
          const first = ivs[i]!,
            second = ivs[j]!;
          if (second.fromS >= first.toS) break;
          if (second.srcUnitName === first.srcUnitName) continue;
          const oFrom = second.fromS;
          const oTo = Math.min(first.toS, second.toS);
          if (oTo - oFrom < 0.5) continue;
          t.pairs++;
          b.pairs++;
          const kind = `${nameOf(first.spellId)} + ${nameOf(second.spellId)}`;
          t.pairKinds[kind] = (t.pairKinds[kind] ?? 0) + 1;
          const caster2 = byName.get(second.srcUnitName);
          const res = resolveMitigation(second.spellId, {
            carrierIsCaster: second.srcUnitName === target.name,
            caster: caster2,
          });
          const pct = res
            ? strongestComponentPct(res, { includeImmunity: true })
            : undefined;
          const fromMs = legacy.startTime + oFrom * 1000;
          const toMs = legacy.startTime + oTo * 1000;
          const dmg = ((target.damageIn ?? []) as any[])
            .filter((d) => d.timestamp >= fromMs && d.timestamp <= toMs)
            .reduce(
              (n, d) => n + Math.abs(d.effectiveAmount ?? d.amount ?? 0),
              0,
            );
          const absorbed = ((target.absorbsIn ?? []) as any[])
            .filter(
              (e) =>
                e.timestamp >= fromMs &&
                e.timestamp <= toMs &&
                (e.srcUnitName === second.srcUnitName ||
                  e.srcUnitId === caster2?.id),
            )
            .reduce((n, e) => n + (e.absorbedAmount ?? 0), 0);
          let contrib: number | null = null;
          let how = "";
          if (
            res &&
            !res.positional &&
            pct &&
            pct.pctMin > 0 &&
            pct.pctMin < 100
          ) {
            contrib = (dmg * pct.pctMin) / (100 - pct.pctMin);
            how = `pct ${pct.pctMin}%`;
          } else if (absorbed > 0) {
            contrib = absorbed;
            how = "absorb";
          } else if (pct && pct.pctMin >= 100) {
            t.unpricedReason["immunity"] =
              (t.unpricedReason["immunity"] ?? 0) + 1;
          } else if (!res) {
            const r = `off-table:${nameOf(second.spellId)}`;
            t.unpricedReason[r] = (t.unpricedReason[r] ?? 0) + 1;
          } else {
            t.unpricedReason["positional-or-zero"] =
              (t.unpricedReason["positional-or-zero"] ?? 0) + 1;
          }
          const died = deaths.some((d) => d > fromMs && d <= toMs + 10_000);
          if (contrib === null) {
            t.unpriced++;
            continue;
          }
          t.priced++;
          const contribPct = contrib / maxHp;
          t.secondContribPct.push(Math.round(contribPct * 1000) / 10);
          const inOverlap = samples.filter((s) => s.t >= fromMs && s.t <= toMs);
          const minHp = inOverlap.length
            ? Math.min(...inOverlap.map((s) => s.hp))
            : null;
          const sufficed = minHp !== null && minHp - contribPct > CRISIS_HP_PCT;
          const crisisWindow = samples.filter(
            (s) => s.t >= fromMs - 3000 && s.t <= toMs,
          );
          const inCrisis = crisisWindow.some((s) => s.hp <= CRISIS_HP_PCT);
          if (sufficed) {
            if (inCrisis) t.oneSufficedInCrisis++;
            else t.oneSufficedPreemptive++;
          } else if (inCrisis) t.bothNeededInCrisis++;
          else t.bothNeededPreemptive++;
          if (sufficed) {
            t.oneSufficed++;
            b.oneSufficed++;
            if (died) t.oneSufficedDied++;
            if (examples.length < 12)
              examples.push({
                file: f.split("/").slice(-1)[0],
                bracket,
                target: `${target.name} (${target.spec})`,
                first: `${nameOf(first.spellId)} by ${first.srcUnitName} @${Math.round(first.fromS)}s`,
                second: `${nameOf(second.spellId)} by ${second.srcUnitName} @${Math.round(second.fromS)}s`,
                overlapS: Math.round((oTo - oFrom) * 10) / 10,
                damageDuringOverlapPct: Math.round((dmg / maxHp) * 100),
                secondContributionPct: Math.round(contribPct * 100),
                how,
                minHpDuringOverlapPct: Math.round(minHp! * 100),
                died,
              });
          } else {
            t.bothNeeded++;
            if (died) t.bothNeededDied++;
          }
        }
      }
    }
  }
}
const home =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const m = [...t.secondContribPct].sort((x, y) => x - y);
const q = (p: number) => (m.length ? m[Math.floor(p * (m.length - 1))] : null);
const summary = {
  ...t,
  secondContribPct: undefined,
  secondContribQuantiles: {
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
  },
  pairKinds: Object.fromEntries(
    Object.entries(t.pairKinds)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 25),
  ),
  unpricedReason: Object.fromEntries(
    Object.entries(t.unpricedReason)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 15),
  ),
};
writeFileSync(
  join(home, "reports/teammate-crisis-2026-09-16-double.json"),
  JSON.stringify({ ...summary, examples }, null, 1),
);
console.log(JSON.stringify(summary, null, 1));
