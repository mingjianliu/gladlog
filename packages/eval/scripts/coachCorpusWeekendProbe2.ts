/**
 * Coach-corpus weekend probe, batch 2 (2026-09-11 overnight). Measurement
 * only — nothing here is a candidate or a gate. Each section is the step-1
 * "how big is the population / does the premise hold" number for one GH issue:
 *
 *   (D) GH #88 — how often is an enemy's interrupt NEVER observed in a round
 *       (the "never-observed = ready" modelling assumption's exposure).
 *   (E) GH #87 — press depth of landed owner kicks: (interrupt − cast start)
 *       ÷ the spell's own observed completed cast duration (median, per spell,
 *       corpus-wide). No DB2 cast time needed.
 *   (F) GH #79 — what a landed owner kick was SPENT on: extraSpellId tiered by
 *       SPELL_CATEGORIES type and by whether the victim is the enemy healer.
 *   (G) GH #80 — owner dispels: backlash (DISPEL_PENALTY_SPELLS), cleanse vs
 *       purge, and the a-priori priority tier of what was removed.
 *   (H) GH #81 — forfeited casts on OFFENSIVE majors (same floor(idle/cd)
 *       metric as #77's section A) and "never cast in a round longer than cd".
 *   (I) GH #85 — target-swap counts from damageOut (3 s buckets, dominant
 *       enemy-player target, transitions between non-empty buckets).
 *   (J) GH #72 — DR level of the hard-CC applications that define
 *       enemyHealerCcWindows: how many "windows" opened on a half/quarter
 *       duration CC.
 *
 * Shared predicates: interrupts via SPELL_CATEGORIES type "interrupts" and
 * kickerIds including pets (kickAudit.ts); enemy interrupt kit via
 * computeEnemyInterruptAvailability; offensive majors via OFFENSIVE_CD_SPELL_IDS
 * ∩ extractMajorCooldowns; dispel priority via purgePriorityForTest (the
 * exported getPriority); healer windows via enemyHealerCcWindows itself.
 *
 *   npx tsx packages/eval/scripts/coachCorpusWeekendProbe2.ts [--n N]
 */
import { ensureAnalysisData, extractMajorCooldowns } from "@gladlog/analysis";
import { enemyHealerCcWindows } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { SPELL_CATEGORIES } from "@gladlog/analysis/src/data/spellCategories";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import {
  DISPEL_PENALTY_SPELLS,
  purgePriorityForTest,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { analyzeOutgoingCCChains } from "@gladlog/analysis/src/utils/drAnalysis";
import { computeEnemyInterruptAvailability } from "@gladlog/analysis/src/utils/enemyInterrupts";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

const SPELLS = SPELL_CATEGORIES as Record<string, { type: string }>;

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const pct = (a: number, b: number) =>
  b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
const bump = (m: Map<string, number>, k: string, by = 1) =>
  m.set(k, (m.get(k) ?? 0) + by);
const top = (m: Map<string, number>, n = 12) =>
  [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const en = (id: string, name: string) => getEnglishSpellName(id, name);

interface Legacy {
  startTime: number;
  endTime: number;
  units?: Record<string, ICombatUnit>;
}

async function main(): Promise<void> {
  const limit = argOf("--n", 100000);
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);

  // (D)
  let dEnemyWithKit = 0,
    dNeverCast = 0;
  const dNeverCastDur: number[] = [];
  // (E) two passes: 1) observed completed durations per spell; 2) depth
  const castDur = new Map<string, number[]>();
  const depthBuckets = new Map<string, number>();
  let eLanded = 0,
    eNoStart = 0,
    eNoRef = 0;
  const depths: number[] = [];
  // (F)
  let fLanded = 0,
    fOnHealer = 0;
  const fByType = new Map<string, number>();
  const fBySpell = new Map<string, number>();
  const fHealerBySpell = new Map<string, number>();
  // (G)
  let gDispels = 0,
    gCleanse = 0,
    gPurge = 0,
    gBacklash = 0;
  const gTier = new Map<string, number>();
  const gBacklashBySpell = new Map<string, number>();
  const gLowBySpell = new Map<string, number>();
  // (H)
  let hRounds = 0,
    hRoundsWithOff = 0,
    hRoundsForfeit = 0,
    hTotalForfeit = 0,
    hNeverCastLongRound = 0,
    hOffMajors = 0;
  const hBySpell = new Map<string, number>();
  // (I)
  let iPlayers = 0,
    iSwaps = 0,
    iMinutes = 0;
  const iSwapsPerMin: number[] = [];
  const iByRole = new Map<
    string,
    { players: number; swaps: number; minutes: number }
  >();
  // (J)
  let jWindows = 0;
  const jLevel = new Map<string, number>();
  const jBySpellHalfOrWorse = new Map<string, number>();

  // Two passes over the store, each streaming one round at a time — holding
  // all 1046 legacy rounds resident OOMs node at the 4 GB default heap.
  let roundsSeen = 0;
  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies, owner } = splitTeams(legacy);
    if (!owner || enemies.length === 0) continue;
    roundsSeen++;

    // (E) pass 1 — completed cast durations, all players, both teams
    for (const u of [...friends, ...enemies]) {
      if (!u.info) continue;
      const starts = (u.castStartEvents ?? []).filter(
        (e) => e.logLine.event === LogEvent.SPELL_CAST_START,
      );
      const succ = u.spellCastEvents.filter(
        (e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
      );
      let si = 0;
      for (const s of starts) {
        while (
          si < succ.length &&
          succ[si].logLine.timestamp < s.logLine.timestamp
        )
          si++;
        const next = succ
          .slice(si)
          .find(
            (c) =>
              c.spellId === s.spellId &&
              c.logLine.timestamp - s.logLine.timestamp <= 10000,
          );
        if (!next) continue;
        // the next start of ANY spell must not sit between (a cancelled-then-recast pair would otherwise read as one long cast)
        const nextStart = starts.find(
          (o) =>
            o.logLine.timestamp > s.logLine.timestamp &&
            o.logLine.timestamp < next.logLine.timestamp,
        );
        if (nextStart) continue;
        const d = next.logLine.timestamp - s.logLine.timestamp;
        if (d >= 300) {
          const arr = castDur.get(s.spellId ?? "") ?? [];
          arr.push(d);
          castDur.set(s.spellId ?? "", arr);
        }
      }
    }
  }
  const refDur = new Map<string, number>();
  for (const [id, xs] of castDur)
    if (xs.length >= 5) refDur.set(id, median(xs));

  for (const meta of rows) {
    let raw;
    try {
      ({ legacy: raw } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies, owner } = splitTeams(raw);
    if (!owner || enemies.length === 0) continue;
    const legacy = raw as unknown as Legacy;
    const startMs = legacy.startTime;
    const durS = (legacy.endTime - legacy.startTime) / 1000;
    const enemyPlayers = enemies.filter((e) => e.info);
    const healerNames = new Set(
      enemyPlayers.filter((e) => isHealerSpec(e.spec)).map((e) => e.name),
    );

    // ---------- (D) ----------
    for (const e of enemyPlayers) {
      const kit = computeEnemyInterruptAvailability([e], startMs)[0];
      if (!kit) continue;
      dEnemyWithKit++;
      const cast = e.spellCastEvents.some(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          SPELLS[c.spellId ?? ""]?.type === "interrupts",
      );
      if (!cast) {
        dNeverCast++;
        dNeverCastDur.push(durS);
      }
    }

    // ---------- (E)+(F) ----------
    const kickerIds = new Set<string>([owner.id]);
    for (const u of Object.values(legacy.units ?? {}))
      if (u.ownerId === owner.id) kickerIds.add(u.id);
    for (const victim of enemyPlayers) {
      const starts = (victim.castStartEvents ?? []).filter(
        (e) => e.logLine.event === LogEvent.SPELL_CAST_START,
      );
      for (const a of victim.actionIn) {
        if (
          a.logLine.event !== LogEvent.SPELL_INTERRUPT ||
          !kickerIds.has(a.srcUnitId)
        )
          continue;
        const stopped = a.extraSpellId ?? "";
        const stoppedName = en(stopped, a.extraSpellName ?? stopped);
        // (F)
        fLanded++;
        bump(fByType, SPELLS[stopped]?.type ?? "unlisted");
        bump(fBySpell, stoppedName);
        if (healerNames.has(victim.name)) {
          fOnHealer++;
          bump(fHealerBySpell, stoppedName);
        }
        // (E)
        eLanded++;
        const st = [...starts]
          .reverse()
          .find(
            (s) =>
              s.spellId === stopped &&
              s.logLine.timestamp <= a.logLine.timestamp &&
              a.logLine.timestamp - s.logLine.timestamp <= 10000,
          );
        if (!st) {
          eNoStart++;
          continue;
        }
        const ref = refDur.get(stopped);
        if (!ref) {
          eNoRef++;
          continue;
        }
        const frac = (a.logLine.timestamp - st.logLine.timestamp) / ref;
        depths.push(frac);
        const b =
          frac < 0.25
            ? "<25%"
            : frac < 0.5
              ? "25–50%"
              : frac < 0.75
                ? "50–75%"
                : frac < 0.9
                  ? "75–90%"
                  : frac <= 1.1
                    ? "90–110%"
                    : ">110% (ref too short / haste)";
        bump(depthBuckets, b);
      }
    }

    // ---------- (G) ----------
    const friendIds = new Set(friends.map((f) => f.id));
    for (const a of owner.actionOut) {
      if (a.logLine.event !== LogEvent.SPELL_DISPEL) continue;
      gDispels++;
      const removed = a.extraSpellId ?? "";
      const removedName = en(removed, a.extraSpellName ?? removed);
      const isCleanse = friendIds.has(a.destUnitId);
      if (isCleanse) gCleanse++;
      else gPurge++;
      if (DISPEL_PENALTY_SPELLS.has(removed)) {
        gBacklash++;
        bump(gBacklashBySpell, removedName);
      }
      const tier = purgePriorityForTest(removed);
      bump(gTier, `${isCleanse ? "cleanse" : "purge"}:${tier}`);
      if (tier === "Low")
        bump(gLowBySpell, `${isCleanse ? "C" : "P"} ${removedName}`);
    }

    // ---------- (H) ----------
    hRounds++;
    let ownerCds: ReturnType<typeof extractMajorCooldowns>;
    try {
      ownerCds = extractMajorCooldowns(owner, legacy as never);
    } catch {
      ownerCds = [];
    }
    const off = ownerCds.filter((cd) => OFFENSIVE_CD_SPELL_IDS.has(cd.spellId));
    if (off.length > 0) hRoundsWithOff++;
    let rf = 0;
    for (const cd of off) {
      hOffMajors++;
      const cdS = cd.cooldownSeconds;
      if (!cdS || cdS <= 0) continue;
      for (const w of cd.availableWindows ?? []) {
        const f = Math.floor(w.durationSeconds / cdS);
        if (f > 0) {
          rf += f;
          bump(hBySpell, cd.spellName, f);
        }
      }
      const casts = owner.spellCastEvents.filter(
        (c) =>
          c.spellId === cd.spellId &&
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
      ).length;
      if (casts === 0 && durS > cdS) hNeverCastLongRound++;
    }
    hTotalForfeit += rf;
    if (rf > 0) hRoundsForfeit++;

    // ---------- (I) ----------
    const enemyPlayerIds = new Set(enemyPlayers.map((e) => e.id));
    for (const f of friends) {
      if (!f.info) continue;
      const byBucket = new Map<number, Map<string, number>>();
      for (const d of f.damageOut) {
        // SIGN BUG FIXED 2026-09-12 (codex review of GH #85): in the legacy
        // shape real damage is NEGATIVE (convert.ts: effectiveAmount =
        // -(effective - absorbed)) and SPELL_ABSORBED rows are POSITIVE. The
        // original `<= 0` filter therefore kept absorbs and dropped damage —
        // on 10 library rounds 5,497 of 5,675 retained rows were absorbs.
        // Every swap number posted on GH #85 before this date is invalid.
        if (
          !enemyPlayerIds.has(d.destUnitId) ||
          d.logLine.event === "SPELL_ABSORBED" ||
          d.effectiveAmount >= 0
        )
          continue;
        const b = Math.floor((d.logLine.timestamp - startMs) / 3000);
        const m = byBucket.get(b) ?? new Map<string, number>();
        bump(m, d.destUnitId, -d.effectiveAmount);
        byBucket.set(b, m);
      }
      if (byBucket.size === 0) continue;
      let prev: string | null = null,
        swaps = 0;
      for (const b of [...byBucket.keys()].sort((x, y) => x - y)) {
        const dom = top(byBucket.get(b)!, 1)[0][0];
        if (prev !== null && dom !== prev) swaps++;
        prev = dom;
      }
      const role = isHealerSpec(f.spec) ? "healer" : "dps";
      iPlayers++;
      iSwaps += swaps;
      iMinutes += durS / 60;
      iSwapsPerMin.push(swaps / (durS / 60));
      const r = iByRole.get(role) ?? { players: 0, swaps: 0, minutes: 0 };
      r.players++;
      r.swaps += swaps;
      r.minutes += durS / 60;
      iByRole.set(role, r);
    }

    // ---------- (J) ----------
    let wins: ReturnType<typeof enemyHealerCcWindows> = [];
    try {
      wins = enemyHealerCcWindows(friends, enemies, legacy);
    } catch {
      wins = [];
    }
    if (wins.length > 0) {
      // re-derive the DR level of each window's application from the same chain analysis
      let chains: ReturnType<typeof analyzeOutgoingCCChains> = [];
      try {
        chains = analyzeOutgoingCCChains(friends, enemies, legacy as never);
      } catch {
        chains = [];
      }
      for (const w of wins) {
        jWindows++;
        const app = chains
          .find((c) => c.targetName === w.healerName)
          ?.applications.find(
            (a) => a.atSeconds === w.fromSeconds && a.spellId === w.spellId,
          );
        const lvl = app ? String(app.drInfo.level) : "?";
        bump(jLevel, lvl);
        if (app && app.drInfo.sequenceIndex >= 1)
          bump(jBySpellHalfOrWorse, w.spellName);
      }
    }
  }

  console.log(`rounds ${roundsSeen}`);
  console.log(
    "\n==================== (D) GH #88 never-observed enemy interrupt ====================",
  );
  console.log(
    `enemy players with an interrupt in kit ${dEnemyWithKit} | never cast it in the round ${dNeverCast} (${pct(dNeverCast, dEnemyWithKit)})`,
  );
  console.log(
    `  median round length when never cast: ${median(dNeverCastDur).toFixed(0)}s  (>= 24s = at least one full cooldown elapsed)`,
  );
  console.log(
    `  never-cast in rounds >= 60s: ${dNeverCastDur.filter((d) => d >= 60).length}  |  >= 120s: ${dNeverCastDur.filter((d) => d >= 120).length}`,
  );

  console.log(
    "\n==================== (E) GH #87 press depth of landed owner kicks ====================",
  );
  console.log(
    `landed ${eLanded} | no matching SPELL_CAST_START within 10s ${eNoStart} | stopped spell has no reference duration (<5 completed casts) ${eNoRef}`,
  );
  console.log(
    `measured ${depths.length} | median depth ${(median(depths) * 100).toFixed(0)}% of the spell's own median completed cast`,
  );
  for (const k of [
    "<25%",
    "25–50%",
    "50–75%",
    "75–90%",
    "90–110%",
    ">110% (ref too short / haste)",
  ])
    console.log(
      `  ${k.padEnd(30)} ${String(depthBuckets.get(k) ?? 0).padStart(5)}  ${pct(depthBuckets.get(k) ?? 0, depths.length)}`,
    );

  console.log(
    "\n==================== (F) GH #79 what a landed owner kick stopped ====================",
  );
  console.log(
    `landed ${fLanded} | on the enemy healer ${fOnHealer} (${pct(fOnHealer, fLanded)})`,
  );
  console.log("by SPELL_CATEGORIES type of the stopped spell:");
  for (const [k, v] of top(fByType, 12))
    console.log(
      `  ${k.padEnd(22)} ${String(v).padStart(5)}  ${pct(v, fLanded)}`,
    );
  console.log("top stopped spells (all):");
  for (const [k, v] of top(fBySpell, 15)) console.log(`  ${k.padEnd(30)} ${v}`);
  console.log("top stopped spells (healer victim):");
  for (const [k, v] of top(fHealerBySpell, 10))
    console.log(`  ${k.padEnd(30)} ${v}`);

  console.log(
    "\n==================== (G) GH #80 owner dispels ====================",
  );
  console.log(
    `owner SPELL_DISPEL ${gDispels} | cleanse (friendly dest) ${gCleanse} | purge (enemy dest) ${gPurge}`,
  );
  console.log(
    `backlash dispels (DISPEL_PENALTY_SPELLS) ${gBacklash} (${pct(gBacklash, gDispels)})`,
  );
  for (const [k, v] of top(gBacklashBySpell, 5))
    console.log(`  ${k.padEnd(30)} ${v}`);
  console.log(
    "a-priori priority tier of the removed aura (purgePriorityForTest, no comp context):",
  );
  for (const [k, v] of top(gTier, 10))
    console.log(
      `  ${k.padEnd(22)} ${String(v).padStart(5)}  ${pct(v, gDispels)}`,
    );
  console.log("top Low-tier removals (C=cleanse P=purge):");
  for (const [k, v] of top(gLowBySpell, 15))
    console.log(`  ${k.padEnd(34)} ${v}`);

  console.log(
    "\n==================== (H) GH #81 forfeited OFFENSIVE casts ====================",
  );
  console.log(
    `rounds ${hRounds} | owner has an offensive major ${hRoundsWithOff} | offensive majors total ${hOffMajors}`,
  );
  console.log(
    `rounds with >= 1 forfeited offensive cast ${hRoundsForfeit} (${pct(hRoundsForfeit, hRoundsWithOff)}) | total forfeited ${hTotalForfeit} (${(hTotalForfeit / Math.max(hRoundsWithOff, 1)).toFixed(2)}/round)`,
  );
  console.log(
    `offensive majors never cast although the round outlasted their cooldown ${hNeverCastLongRound} (${pct(hNeverCastLongRound, hOffMajors)})`,
  );
  for (const [k, v] of top(hBySpell, 12)) console.log(`  ${k.padEnd(30)} ${v}`);

  console.log(
    "\n==================== (I) GH #85 target swaps (3s buckets, dominant enemy-player target) ====================",
  );
  console.log(
    `player-rounds ${iPlayers} | swaps ${iSwaps} | ${(iSwaps / Math.max(iMinutes, 1)).toFixed(2)} per minute | median per player-round ${median(iSwapsPerMin).toFixed(2)}/min`,
  );
  for (const [k, r] of iByRole)
    console.log(
      `  ${k.padEnd(8)} player-rounds ${String(r.players).padStart(5)}  swaps/min ${(r.swaps / Math.max(r.minutes, 1)).toFixed(2)}`,
    );

  console.log(
    "\n==================== (J) GH #72 DR level of enemy-healer hard-CC windows ====================",
  );
  console.log(`windows ${jWindows}`);
  for (const [k, v] of [...jLevel].sort())
    console.log(
      `  DR level ${k.padEnd(4)} ${String(v).padStart(5)}  ${pct(v, jWindows)}`,
    );
  console.log(
    "windows opened by a DR'd (sequenceIndex >= 1) application, by spell:",
  );
  for (const [k, v] of top(jBySpellHalfOrWorse, 10))
    console.log(`  ${k.padEnd(30)} ${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
