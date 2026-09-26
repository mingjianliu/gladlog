/* eslint-disable no-console */
/**
 * healerReachExampleGen.ts — value-gate example generator for GH #83 (owner ↔
 * ally geometry, first slice: "a teammate was in crisis while out of the
 * healer's reach or line of sight"). User go-ahead 2026-09-23 for the value
 * gate only: examples + firing rates, nothing wired.
 *
 * v1 (instant snapshot, one 40 yd reach for everyone) was weak on 300 files:
 * 125 out-of-range + 111 no-LoS of 2,597 crisis points, but 51 % of the
 * out-of-range ones within 45 yd, ~50 % still received a fresh heal from the
 * healer, 38 % had the healer CC'd, no consistent died-10s contrast.
 *
 * v2, user rulings 2026-09-23: "戒律牧是手长 是46码" and "可以严格一点".
 *  - Reach per healer from official data: every healer spec's core heals are
 *    SpellRange "Long Range" 40 yd except Preservation (Living Flame / Verdant
 *    Embrace / Emerald Blossom 25, Echo / Reversion / Time Dilation 30 — the
 *    longest single-target heal is taken). Range talents from the M6 talent
 *    inventory (SpellMod op 5): Phantom Reach 459559 +15 % on every priest
 *    heal (the user's 46 yd), Astral Influence 197524 +5 yd on druid heals,
 *    Arcane Reach 454983 +5 yd on evoker heals — applied only when
 *    `talentModifierOwnershipOf` says the healer holds it. PROBE TABLE: the
 *    product version must read SpellRange + the inventory, not this list.
 *  - Sustained: out of reach or out of LoS at the crossing AND 1, 2, 3 s
 *    after (every sample known).
 *  - Healer free: not CC'd / locked out at the crossing (`excluded`).
 *  - Nothing landed: no fresh heal, external or protective from the healer
 *    on the teammate in the window (a HoT already ticking does not count).
 * Every step of the funnel is printed.
 *
 * Decision points are the product's own `teammateCrisisPoints` (GH #95).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/healerReachExampleGen.ts --manifest <txt> [--offset 0] [--limit 300]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { teammateCrisisPoints } from "@gladlog/analysis/src/analysis/teammateCrisis";
import { getSortedAdvancedActions } from "@gladlog/analysis/src/utils/advancedActions";
import { binarySearchClosest } from "@gladlog/analysis/src/utils/binarySearch";
import {
  gridHpPct,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { hasLineOfSight } from "@gladlog/analysis/src/utils/losAnalysis";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { talentModifierOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const short = (n: string | undefined) => (n ?? "?").split("-")[0];

const TREND_S = 5;
const POS_TOL_MS = 1500;
/** seconds after the crossing that must ALSO be out of reach / LoS */
const SUSTAIN_S = [0, 1, 2, 3];
/** healReachGroundTruth.ts (420 files, 57,444 successful friendly casts):
 * casts land ~2 yd past the nominal range as a matter of course — positions
 * are model centres, the game measures to the hitbox (40 yd specs: p99
 * 41.6–42.2 yd). "Out of range" therefore means beyond reach + this. */
const RANGE_SLACK_YD = 2;
/** Same run: the LoS model says "blocked" on a cast the game accepted in
 * 10.75 % of casts on Ruins of Lordaeron (572, the walkable tomb) and 3.85 %
 * on Dalaran Sewers (617); every other map ≤ 0.93 %. No LoS verdict there. */
const LOS_UNRELIABLE_ZONES = new Set(["572", "617"]);

/** PROBE TABLE (see header): base heal reach and the range talent. */
const REACH: Record<
  string,
  {
    base: number;
    talent?: { id: string; name: string; pct?: number; flat?: number };
  }
> = {
  "Discipline Priest": {
    base: 40,
    talent: { id: "459559", name: "Phantom Reach", pct: 15 },
  },
  "Holy Priest": {
    base: 40,
    talent: { id: "459559", name: "Phantom Reach", pct: 15 },
  },
  "Restoration Druid": {
    base: 40,
    talent: { id: "197524", name: "Astral Influence", flat: 5 },
  },
  "Preservation Evoker": {
    base: 30,
    talent: { id: "454983", name: "Arcane Reach", flat: 5 },
  },
  "Restoration Shaman": { base: 40 },
  "Holy Paladin": { base: 40 },
  "Mistweaver Monk": { base: 40 },
};

function posAt(u: any, ms: number): { x: number; y: number } | null {
  const s: any = binarySearchClosest(
    getSortedAdvancedActions(u),
    ms,
    (a: any) => a.logLine.timestamp,
  );
  if (!s || s.advancedActorId !== u.id) return null;
  if (Math.abs(s.logLine.timestamp - ms) > POS_TOL_MS) return null;
  return { x: s.advancedActorPositionX, y: s.advancedActorPositionY };
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(Number(flag("--offset") ?? 0))
    .slice(0, Number(flag("--limit") ?? 300));

  let rounds = 0;
  const ownership = new Map<
    string,
    { yes: number; no: number; unknown: number }
  >();
  const funnel = {
    crisisPoints: 0,
    outAtCrossing40: 0,
    outAtCrossingSpec: 0,
    sustained: 0,
    healerFree: 0,
    nothingLanded: 0,
    nobodyDead: 0,
  };
  const died = { final: 0, finalN: 0, inReach: 0, inReachN: 0 };
  const byBracket = new Map<string, number>();
  const examples: string[] = [];

  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split(/\r?\n/)) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    for (const combat of combats) {
      rounds++;
      const bracket = String(combat.startInfo?.bracket ?? "?");
      const zoneId = String(combat.startInfo?.zoneId ?? "");
      const t0 = combat.startTime as number;
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      for (const healer of players) {
        if (!isHealerSpec(healer.spec)) continue;
        const spec = specToString(healer.spec);
        const rule = REACH[spec] ?? { base: 40 };
        let reachYd = rule.base;
        if (rule.talent) {
          const own = talentModifierOwnershipOf(healer, rule.talent.id);
          const o = ownership.get(spec) ?? { yes: 0, no: 0, unknown: 0 };
          o[own as "yes" | "no" | "unknown"]++;
          ownership.set(spec, o);
          if (own === "yes")
            reachYd = rule.talent.pct
              ? Math.round(rule.base * (1 + rule.talent.pct / 100))
              : rule.base + (rule.talent.flat ?? 0);
        }
        let points;
        try {
          points = teammateCrisisPoints(healer, combat);
        } catch {
          continue;
        }
        const byId = new Map(players.map((u) => [u.id, u]));
        for (const p of points) {
          funnel.crisisPoints++;
          const mate = byId.get(p.mateId);
          if (!mate) continue;
          if (
            p.distanceYd !== null &&
            (p.distanceYd > 40 || p.losClear === false)
          )
            funnel.outAtCrossing40++;

          // per-second reach samples over the crossing + SUSTAIN_S
          const samples = SUSTAIN_S.map((d) => {
            const ms = p.tMs + d * 1000;
            const a = posAt(healer, ms);
            const b = posAt(mate, ms);
            if (!a || !b)
              return { known: false, out: false, dist: null, los: null };
            const dist = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
            // LoS verdicts are not taken on maps where the model contradicts
            // the game's own successful casts too often (healReachGroundTruth)
            const los = LOS_UNRELIABLE_ZONES.has(zoneId)
              ? null
              : hasLineOfSight(zoneId, a, b);
            const out = dist > reachYd + RANGE_SLACK_YD || los === false;
            const known = out || los !== null;
            return { known, out, dist, los };
          });
          const outNow = samples[0]!.known && samples[0]!.out;
          if (!outNow) {
            if (samples[0]!.known) {
              died.inReachN++;
              if (p.diedWithin10s) died.inReach++;
            }
            continue;
          }
          funnel.outAtCrossingSpec++;
          if (!samples.every((s) => s.known && s.out)) continue;
          funnel.sustained++;
          if (p.excluded === "healerBlocked") continue;
          funnel.healerFree++;
          if (
            p.healerAnswers.some(
              (a) =>
                a === "freshHeal" || a === "external" || a === "protective",
            )
          )
            continue;
          funnel.nothingLanded++;
          if (p.priorDeathSide !== null) continue;
          funnel.nobodyDead++;
          byBracket.set(bracket, (byBracket.get(bracket) ?? 0) + 1);
          died.finalN++;
          if (p.diedWithin10s) died.final++;

          const hA = posAt(healer, p.tMs - TREND_S * 1000);
          const mA = posAt(mate, p.tMs - TREND_S * 1000);
          const before =
            hA && mA ? Math.round(Math.hypot(hA.x - mA.x, hA.y - mA.y)) : null;
          const track = samples
            .map(
              (s, i) =>
                `+${SUSTAIN_S[i]}s ${s.dist}yd${s.los === false ? " noLoS" : ""}`,
            )
            .join(", ");
          const why = samples.every(
            (s) => (s.dist ?? 0) > reachYd + RANGE_SLACK_YD,
          )
            ? `out of your ${reachYd} yd heal range`
            : samples.every((s) => s.los === false)
              ? "behind line-of-sight"
              : "out of range / line of sight";
          const trend =
            before === null ? "" : `, ${before} yd ${TREND_S}s earlier`;
          const what = `at ${Math.round(p.hpPct)}% (−${Math.round(p.dmg2s * 100)}% in 2s, ${p.attackerNames.length} attacking)`;
          const hpTrack = [-2, 0, 2, 4, 6]
            .map((d) => {
              const v = gridHpPct(mate, t0 + (p.tSec + d) * 1000);
              return `${fmtTime(p.tSec + d)} ${v ?? "–"}`;
            })
            .join(" · ");
          examples.push(
            `${path.split("/").at(-1)} · ${bracket} · zone ${zoneId} · ${short(healer.name)} (${spec}, reach ${reachYd} yd) → ${short(p.mateName)}\n` +
              `  healer view : ${fmtTime(p.tSec)}–${fmtTime(p.tSec + 3)}  [HEAL REACH]  ${short(p.mateName)} ${what} stayed ${why} for 3s (${track}${trend}); nothing of yours landed on them\n` +
              `  victim view : ${fmtTime(p.tSec)}–${fmtTime(p.tSec + 3)}  [HEAL REACH]  you were ${what} and stayed ${why.replace("your", "your healer's")} for 3s (${track}${trend})\n` +
              `  context     : ${short(p.mateName)} HP ${hpTrack} | healer cast elsewhere: ${p.busyOn ? `${p.busyOn.spellName} on ${short(p.busyOn.name)}` : "no"} | died within 10s (reader only): ${p.diedWithin10s ? "yes" : "no"}`,
          );
        }
      }
    }
  }

  const pct = (a: number, b: number) =>
    b ? `${((100 * a) / b).toFixed(1)}%` : "–";
  console.log(`files ${files.length} · rounds ${rounds}`);
  console.log("\nRange-talent ownership (healer-rounds): yes / no / unknown");
  for (const [s, o] of ownership)
    console.log(
      `  ${s} (${REACH[s]?.talent?.name}): ${o.yes} / ${o.no} / ${o.unknown}  → ${pct(o.yes, o.yes + o.no + o.unknown)} hold it`,
    );
  console.log("\nFunnel:");
  console.log(
    `  teammate crisis points                          ${funnel.crisisPoints}`,
  );
  console.log(
    `  out of reach/LoS at crossing (flat 40 yd, v1)   ${funnel.outAtCrossing40}`,
  );
  console.log(
    `  … with per-spec + talent reach                  ${funnel.outAtCrossingSpec}`,
  );
  console.log(
    `  … and still out at +1, +2, +3 s                 ${funnel.sustained}`,
  );
  console.log(
    `  … healer not CC'd / locked out                  ${funnel.healerFree}`,
  );
  console.log(
    `  … no fresh heal / external / protective landed  ${funnel.nothingLanded}`,
  );
  console.log(
    `  … nobody dead yet                               ${funnel.nobodyDead}  (${(funnel.nobodyDead / Math.max(1, rounds)).toFixed(3)} per round)`,
  );
  console.log(
    `  by bracket: ${[...byBracket].map(([b, n]) => `${b} ${n}`).join(" · ")}`,
  );
  console.log(
    `\nReader only — teammate died within 10s: final population ${died.final}/${died.finalN} (${pct(died.final, died.finalN)}) vs in reach at the crossing ${died.inReach}/${died.inReachN} (${pct(died.inReach, died.inReachN)})`,
  );
  console.log(
    `\n=== examples (${examples.length} total, up to 8 evenly spaced) ===\n`,
  );
  const step = Math.max(1, Math.floor(examples.length / 8));
  for (const e of examples.filter((_, i) => i % step === 0).slice(0, 8))
    console.log(e + "\n");
}
void main();
