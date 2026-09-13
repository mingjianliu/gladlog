/**
 * GH #95 probe — teammate crises for a healer owner (user ruling 2026-09-13:
 * "不管重复不重复 队友被打也要算进去").
 *
 * Today `crisisDecisionPoints(owner, combat, "healer")` only finds crossings
 * on the healer's own HP. This probe reuses the SAME crossing / danger rule on
 * every other friendly (`crisisDecisionPoints(teammate, …)`: CRISIS_HP_PCT,
 * CRISIS_MIN_DMG2S, the render-grid anchor) and then scores the HEALER's
 * answers toward that teammate. Nothing here ships; it measures incidence,
 * feasibility, answer rates and overlap with the product's existing teammate
 * signals, and dumps rows for a value-gate example.
 *
 * v2 after codex astra R1 (PARTIAL): crossing-sample max HP, teammate death in
 * window excluded, usable-opportunity interval instead of a single instant,
 * delivered support vs attempted action split, danger-persisted gate.
 *
 * Healer answer prototype v1 (superseded in part, kept for the record):
 *   heal     owner's healing into the teammate in (t, t+3 s] ≥ SELF_HEAL_BIG
 *            of the teammate's max HP (absorbs are NOT in healIn — reported
 *            separately as `castsOnVictim`, the looser measure)
 *   external owner cast an external-defensive id on the teammate in
 *            [t − 1.5 s, t + 3 s]
 *   control  owner cast cc ∪ root ∪ interrupt on one of the teammate's
 *            attackers (2 s damage sources, pets resolved) in the same window
 * Feasibility: owner alive, not in CC, not locked out (interrupt ≤ 1.5 s or a
 * silence), and the teammate reachable at t (40 yd + LoS not disproven —
 * `canReachTargetAt`, unknown counts as reachable).
 *
 * Baseline 2026-09-13, user library, 399 healer rounds:
 *   healer's own dangerous crises 135; teammate dangerous crises 1,099
 *   → teammate alive through window 1,039 → healer had ≥ 1 s usable 872
 *   → danger persisted 707 → < 15 % healing delivered 227
 *   → no attempt either ("accusable", v2) 83 → v3 strict 13 (7 died ≤ 10 s).
 *   Hand review of 7 rows (4 from v2, 3 from v3): 0 clean "did nothing".
 *   Causes: round ended 0.4 s after the crossing; healer saving someone else
 *   (Divine Shield + Lay on Hands); a heal landed just before or after the
 *   window; the healer at 18 % in their own crisis; Preservation empowers
 *   (Dream Breath) absent from spellCastEvents so "no cast" was false; one
 *   unexplained (no casts for 10 s at 12 yd, 78 % HP).
 *
 * Usage: npx tsx packages/eval/scripts/teammateCrisisProbe.ts [--limit N]
 * Output: $GLADLOG_EVAL_HOME/reports/teammate-crisis-2026-09-13/probe.json
 */
import {
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import {
  CRISIS_HP_PCT_RENDERED,
  CRISIS_MIN_DMG2S,
  crisisDecisionPoints,
  LOCKOUT_LOOKBACK_MS,
  RESPONSE_PRE_MS,
  RESPONSE_WINDOW_MS,
  SELF_HEAL_BIG,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import {
  ccSpellIds,
  rootSpellIds,
  spells as spellMeta,
} from "@gladlog/analysis/src/data/spellTags";
import { drCategoryIds } from "@gladlog/analysis/src/utils/drAnalysis";
import { getUnitPositionAtTime } from "@gladlog/analysis/src/utils/losAnalysis";
import { LOS_SWEEP_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";
import { canReachTargetAt } from "@gladlog/analysis/src/utils/rootReachability";
import { buildFilteredAuraIntervals } from "@gladlog/analysis/src/utils/utils";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

const HEAL_REACH_YARDS = 40;
const OVERLAP_S = 5;
const OVERLAP_TYPES = [
  "cd-hoarded",
  "external-unused",
  "healing-gap",
  "slow-defensive-response",
  "crisis-no-response",
];

const argNum = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};

const EXTERNAL_IDS = new Set(
  spellIdLists.externalDefensiveSpellIds.map(String),
);
const INTERRUPT_IDS = new Set(
  Object.entries(spellMeta)
    .filter(([, m]) => m.type === "interrupts")
    .map(([id]) => id),
);
const CONTROL_IDS = new Set([...ccSpellIds, ...rootSpellIds, ...INTERRUPT_IDS]);
let SILENCE_IDS: Set<string>;
try {
  SILENCE_IDS = new Set([...INTERRUPT_IDS, ...drCategoryIds("silence")]);
} catch {
  SILENCE_IDS = new Set(INTERRUPT_IDS);
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const limit = argNum("--limit", 400);
  const outDir = join(
    process.env.GLADLOG_EVAL_HOME ??
      join(process.env.HOME ?? "", "code/gladlog-eval-private"),
    "reports/teammate-crisis-2026-09-13",
  );
  mkdirSync(outDir, { recursive: true });

  const metas = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);
  let healerRounds = 0;
  const rows: any[] = [];
  const ownCrises = { dangerous: 0, feasible: 0 };

  for (const meta of metas) {
    let legacy: any;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, owner } = splitTeams(legacy);
    if (!owner || owner.id !== legacy.playerId || !isHealerSpec(owner.spec))
      continue;
    healerRounds++;
    const start: number = legacy.startTime;
    const zoneId = String(legacy.startInfo?.zoneId ?? "") || undefined;
    const unitById = new Map<string, any>(
      Object.values(legacy.units as Record<string, any>).map((u) => [u.id, u]),
    );

    try {
      for (const p of crisisDecisionPoints(owner, legacy, "healer")) {
        if (!p.dangerous) continue;
        ownCrises.dangerous++;
        if (p.feasible) ownCrises.feasible++;
      }
    } catch {
      /* not computable */
    }

    const ownerCc = buildFilteredAuraIntervals(owner, ccSpellIds, legacy);
    const ownerSilence = buildFilteredAuraIntervals(owner, SILENCE_IDS, legacy);
    const interruptsOnOwner = ((owner as any).actionIn ?? [])
      .filter((a: any) => a.logLine?.event === "SPELL_INTERRUPT")
      .map((a: any) => a.timestamp as number);
    const ownerDeaths = ((owner as any).deathRecords ?? []).map(
      (d: any) => d.timestamp as number,
    );
    const ownerCasts = ((owner as any).spellCastEvents ?? []).map((c: any) => ({
      t: c.timestamp as number,
      id: String(c.spellId ?? ""),
      dest: c.destUnitId as string,
    }));

    let candidates: any[] = [];
    try {
      candidates = extractCandidateFindings(legacy, owner.id) as any[];
    } catch {
      candidates = [];
    }

    for (const mate of friends) {
      if (mate.id === owner.id) continue;
      let points;
      try {
        points = crisisDecisionPoints(mate, legacy, "healer");
      } catch {
        continue;
      }
      const mateSamples = ((mate as any).advancedActions ?? [])
        .filter((a: any) => (a.advancedActorMaxHp ?? 0) > 0)
        .sort((a: any, b: any) => a.timestamp - b.timestamp);
      const sampleAt = (ms: number) => {
        let last: any = null;
        for (const a of mateSamples) {
          if (a.timestamp > ms) break;
          last = a;
        }
        return last;
      };
      for (const p of points) {
        if (!p.dangerous) continue;
        const t = p.tMs;
        const w0 = t - RESPONSE_PRE_MS;
        const w1 = t + RESPONSE_WINDOW_MS;
        const inWin = (x: number) => x >= w0 && x <= w1;
        // codex R1 (A): the crossing sample's max HP, never the round maximum
        const crossing = sampleAt(t);
        const mateMax = crossing?.advancedActorMaxHp ?? 0;
        if (!mateMax) continue;

        // the teammate's attackers, pets resolved to their owner
        const attackers = new Set<string>();
        for (const d of (mate as any).damageIn ?? []) {
          if (d.timestamp <= t - 2000 || d.timestamp > t) continue;
          const src = unitById.get(d.srcUnitId);
          if (!src) continue;
          const pid = src.info
            ? src.id
            : src.ownerId && unitById.get(src.ownerId)?.info
              ? src.ownerId
              : null;
          if (pid && unitById.get(pid)?.reaction !== owner.reaction)
            attackers.add(pid);
        }

        // support DELIVERED (codex A): healing from the healer, split direct vs
        // periodic, at the crossing's max HP
        let direct = 0,
          periodic = 0;
        for (const h of (mate as any).healIn ?? []) {
          if (h.timestamp <= t || h.timestamp > w1 || h.srcUnitId !== owner.id)
            continue;
          const a = Math.abs(h.effectiveAmount ?? h.amount ?? 0) / mateMax;
          if (h.logLine?.event === "SPELL_PERIODIC_HEAL") periodic += a;
          else direct += a;
        }
        const delivered = direct + periodic >= SELF_HEAL_BIG;

        // action ATTEMPTED (codex A): any healer cast on the teammate in
        // (t, t+3 s] (heals, shields, externals), or control on an attacker
        const castsIn = ownerCasts.filter((c: any) => inWin(c.t));
        const answers = {
          castOnMate: ownerCasts.some(
            (c: any) => c.t > t && c.t <= w1 && c.dest === mate.id,
          ),
          external: castsIn.some(
            (c: any) => EXTERNAL_IDS.has(c.id) && c.dest === mate.id,
          ),
          control: castsIn.some(
            (c: any) => CONTROL_IDS.has(c.id) && attackers.has(c.dest),
          ),
        };
        const attempted =
          answers.castOnMate || answers.external || answers.control;

        // usable opportunity over the window (codex C): 250 ms steps in
        // [t, t+3 s], healer alive / free / not locked out AND the teammate
        // reachable (40 yd + LoS not disproven); unknown reach cannot
        // establish "could act"
        let usableSteps = 0,
          unknownSteps = 0,
          freeSteps = 0;
        for (let ms = t; ms <= w1; ms += 250) {
          const free =
            !ownerDeaths.some((d: number) => d <= ms) &&
            !ownerCc.some((i) => i.startMs <= ms && i.endMs >= ms) &&
            !ownerSilence.some((i) => i.startMs <= ms && i.endMs >= ms) &&
            !interruptsOnOwner.some(
              (x: number) => x >= ms - LOCKOUT_LOOKBACK_MS && x <= ms,
            );
          if (!free) continue;
          freeSteps++;
          const pos = getUnitPositionAtTime(owner, ms, LOS_SWEEP_GAP_MS);
          const r = pos
            ? canReachTargetAt(pos, mate, ms, zoneId, HEAL_REACH_YARDS, true)
            : null;
          if (r === true) usableSteps++;
          else if (r === null) unknownSteps++;
        }
        const usableS = usableSteps * 0.25;
        const opportunity = usableS >= 1;

        // danger persisted (codex B): still at/under the crisis line at t+3 s,
        // or took another ≥ CRISIS_MIN_DMG2S of max HP inside (t, t+3 s]
        const end = sampleAt(w1);
        const hpEndPct = end
          ? Math.round(
              (100 * end.advancedActorCurrentHp) / end.advancedActorMaxHp,
            )
          : null;
        const dmgAfter =
          ((mate as any).damageIn ?? [])
            .filter((d: any) => d.timestamp > t && d.timestamp <= w1)
            .reduce(
              (n: number, d: any) =>
                n + Math.abs(d.effectiveAmount ?? d.amount ?? 0),
              0,
            ) / mateMax;
        const dangerPersisted =
          (hpEndPct !== null && hpEndPct <= CRISIS_HP_PCT_RENDERED) ||
          dmgAfter >= CRISIS_MIN_DMG2S;

        // v3 — hand review of 4 v2 "accusable" rows found none real: round
        // over inside the window, a cast-time heal finishing just after it, a
        // heal just before it, the healer saving someone else. Measured here.
        const roundEndS = (legacy.endTime - t) / 1000;
        const roundEndedInWindow = legacy.endTime <= w1;
        const allOwnerEvents = ((owner as any).spellCastEvents ?? []) as any[];
        const castStartOnMate = allOwnerEvents.some(
          (c) =>
            c.logLine?.event === "SPELL_CAST_START" &&
            c.timestamp >= w0 &&
            c.timestamp <= w1 &&
            c.destUnitId === mate.id,
        );
        const anyCastStartInWin = allOwnerEvents.some(
          (c) => c.logLine?.event === "SPELL_CAST_START" && inWin(c.timestamp),
        );
        const onMateWide = ownerCasts.some(
          (c: any) => c.t >= t - 3000 && c.t <= t + 5000 && c.dest === mate.id,
        );
        const onOthersInWin = ownerCasts.some(
          (c: any) =>
            inWin(c.t) &&
            c.dest &&
            c.dest !== mate.id &&
            unitById.get(c.dest)?.reaction === owner.reaction,
        );
        const anyCastInWin = ownerCasts.some((c: any) => inWin(c.t));
        const healAnyPct = Math.round((direct + periodic) * 100);

        const accusable =
          !p.diedInWindow &&
          opportunity &&
          dangerPersisted &&
          !delivered &&
          !attempted;
        const strict =
          accusable &&
          !roundEndedInWindow &&
          !castStartOnMate &&
          !onMateWide &&
          !onOthersInWin &&
          healAnyPct < 5;

        const tSec = p.tSec;
        const overlap = OVERLAP_TYPES.filter((type) =>
          candidates.some(
            (c) =>
              c.type === type &&
              Math.abs(Number(c.t) - tSec) <= OVERLAP_S &&
              (JSON.stringify(c.unitNames ?? []).includes(mate.name) ||
                JSON.stringify(c.facts ?? {}).includes(mate.name)),
          ),
        );

        rows.push({
          matchId: meta.id,
          bracket: legacy.startInfo?.bracket ?? "?",
          ownerSpec: specToString(owner.spec),
          mateSpec: specToString(mate.spec),
          mateName: mate.name,
          tSec,
          mateHpPct: p.hpPct,
          dmg2sPct: Math.round(p.dmg2s * 100),
          attackers: attackers.size,
          enemyBurst: p.enemyBurst,
          mateDiedInWindow: p.diedInWindow,
          freeS: freeSteps * 0.25,
          usableS,
          unknownReachS: unknownSteps * 0.25,
          opportunity,
          directHealPct: Math.round(direct * 100),
          periodicHealPct: Math.round(periodic * 100),
          delivered,
          answers,
          attempted,
          hpEndPct,
          dmgAfterPct: Math.round(dmgAfter * 100),
          dangerPersisted,
          accusable,
          strict,
          roundEndS: Math.round(roundEndS * 10) / 10,
          roundEndedInWindow,
          castStartOnMate,
          anyCastStartInWin,
          onMateWide,
          onOthersInWin,
          anyCastInWin,
          healAnyPct,
          mateDiedWithin10s: p.diedWithin10s,
          overlap,
          startTime: start,
        });
      }
    }
  }

  const pct = (n: number, d: number) =>
    d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : `${n}/0`;
  const died = (xs: any[]) =>
    pct(xs.filter((r) => r.mateDiedWithin10s).length, xs.length);
  const live = rows.filter((r) => !r.mateDiedInWindow);
  const opp = live.filter((r) => r.opportunity);
  const persisted = opp.filter((r) => r.dangerPersisted);
  const accusable = rows.filter((r) => r.accusable);
  const summary = {
    healerRounds,
    ownCrisesDangerous: ownCrises.dangerous,
    ownCrisesFeasible: ownCrises.feasible,
    funnel: {
      teammateCrisesDangerous: rows.length,
      mateAliveThroughWindow: live.length,
      healerHadUsableSecond: opp.length,
      unknownReachOnly: live.filter(
        (r) => !r.opportunity && r.unknownReachS >= 1,
      ).length,
      dangerPersisted: persisted.length,
      noDeliveredHealing: persisted.filter((r) => !r.delivered).length,
      noAttemptEither_accusable: accusable.length,
    },
    amongPersistedWithOpportunity: {
      delivered: persisted.filter((r) => r.delivered).length,
      attempted: persisted.filter((r) => r.attempted).length,
      deliveredOnlyPeriodic: persisted.filter(
        (r) => r.delivered && r.directHealPct < 15 && !r.attempted,
      ).length,
    },
    diedWithin10s: {
      accusable: died(accusable),
      notAccusable_persistedWithOpportunity: died(
        persisted.filter((r) => !r.accusable),
      ),
    },
    accusableOverlap: Object.fromEntries(
      OVERLAP_TYPES.map((type) => [
        type,
        accusable.filter((r) => r.overlap.includes(type)).length,
      ]),
    ),
    v3AccusableBreakdown: {
      roundEndedInWindow: accusable.filter((r) => r.roundEndedInWindow).length,
      castStartOnMate: accusable.filter((r) => r.castStartOnMate).length,
      castOnMateWithin3sBefore5sAfter: accusable.filter((r) => r.onMateWide)
        .length,
      castOnOtherFriendInWindow: accusable.filter((r) => r.onOthersInWin)
        .length,
      healDelivered5to14pct: accusable.filter((r) => r.healAnyPct >= 5).length,
      noCastAtAllInWindow: accusable.filter(
        (r) => !r.anyCastInWin && !r.anyCastStartInWin,
      ).length,
      strictSurvivors: accusable.filter((r) => r.strict).length,
      strictDiedWithin10s: died(accusable.filter((r) => r.strict)),
      strictNoExistingSignal: accusable.filter(
        (r) => r.strict && r.overlap.length === 0,
      ).length,
    },
    accusableNoExistingSignal: accusable.filter((r) => r.overlap.length === 0)
      .length,
  };
  writeFileSync(
    join(outDir, "probe.json"),
    JSON.stringify({ summary, rows }, null, 1),
  );
  console.log(JSON.stringify(summary, null, 1));
}

void main();
