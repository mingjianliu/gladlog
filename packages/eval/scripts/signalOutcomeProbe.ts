/**
 * signalOutcomeProbe.ts — exploratory (2026-08-30): apply the "decision point
 * → behaviour → outcome contrast" method (the one behaviorPriorScan.ts uses
 * for `crisis-no-response`) to seven EXISTING coaching signals, so each one
 * can be asked the only question that matters before it keeps its place in
 * the menu: **at the moments this signal talks about, does the behaviour it
 * praises/blames actually change the outcome?**
 *
 * This is analysis tooling, not product code. It never re-derives a
 * predicate: every decision point, every "acted" test and every state field
 * is read out of the product's own exported functions (CLAUDE.md
 * shared-predicate rule). Which predicate each probe consumes:
 *
 *   1. cd-hoarded            crisisDecisionPoints (analysis/crisisDecisionPoints.ts)
 *                            + extractMajorCooldowns / cdAvailableAt /
 *                              canHelpAnotherUnit / isProcOnlyActivation /
 *                              DEFENSIVE_TAGS (utils/cooldowns.ts)
 *   2. attempt-into-trinket  extractKillAttempts (utils/killAttempts.ts)
 *                            + analyzePlayerCCAndTrinket (utils/ccTrinketAnalysis.ts)
 *   3. healer-locked window  enemyHealerCcWindows (analysis/candidates/cooldownTiming.ts)
 *                            + classMetadata SpellTag.Offensive (data/classSpells.ts)
 *   3b. offcd-into-healer-cc same two, reversed (cast-anchored instead of window-anchored)
 *   4. kick-eaten            analyzePlayerCCAndTrinket().interruptInstances —
 *                            the exact input kickEatenEvents (candidateFindings.ts)
 *                            consumes — vs. the owner's raw castStartEvents
 *   5. cd-spent-idle         threatActiveAt / matchThreatLevel (utils/threatAssessment.ts)
 *                            + the same defensive-CD filter cdSpentIdleEvents
 *                              (analysis/candidates/cooldownTiming.ts) applies
 *   6. healing-gap           detectHealingGaps (utils/healingGaps.ts)
 *                            + friendlyCrisisMomentInWindow (cooldownTiming.ts)
 *   7. crisis-no-response    crisisDecisionPoints (control / known-good reference row)
 *
 * Rank is NOT absolute rating: percentile of the match's rating within
 * (bracket, ISO week of startTime) — same construction as behaviorPriorScan,
 * because a season's ratings inflate as it goes on.
 *
 *   scan    tsx signalOutcomeProbe.ts scan --manifest <file> --ledger <dir>
 *             --out <file.jsonl> [--offset N] [--limit N] [--only sig,sig]
 *   report  tsx signalOutcomeProbe.ts report --in <file.jsonl>
 */
import {
  analyzePlayerCCAndTrinket,
  canHelpAnotherUnit,
  cdAvailableAt,
  classMetadata,
  DEFENSIVE_TAGS,
  detectHealingGaps,
  ensureAnalysisData,
  extractKillAttempts,
  extractMajorCooldowns,
  type IMajorCooldownInfo,
  isHealerSpec,
  isProcOnlyActivation,
  matchThreatLevel,
  specToString,
  SpellTag,
  threatActiveAt,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
  toRenderSecond,
} from "@gladlog/analysis";
import {
  enemyHealerCcWindows,
  friendlyCrisisMomentInWindow,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import {
  crisisDecisionPoints,
  type DecisionPoint,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { gunzipSync } from "zlib";

import { isoWeek, rankLedger } from "../src/explore/ratingPercentile";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

/** One row per DECISION POINT (not per fired event): the denominator is the
 * opportunity set, the `acted` flag is the behaviour, `outcome.hit` is the
 * canonical outcome the report contrasts. */
interface Row {
  signal: string;
  matchId: string;
  seq: number | null;
  bracket: string;
  week: string;
  rating: number | null;
  pct: number | null; // percentile within (bracket, week), 0–100
  ownerSpec: string;
  tSec: number;
  state: Record<string, unknown>;
  acted: boolean;
  outcome: Record<string, unknown> & { hit: boolean };
}

/** Human-readable note per signal for the report header — what `acted` and
 * `hit` MEAN for that signal (they differ, and a bare percentage is
 * unreadable without it). */
const SIGNAL_LEGEND: Record<string, string> = {
  "cd-hoarded":
    "acted = a usable major defensive CD was cast within 5s of the crisis; hit = the crisis unit died within 10s",
  "attempt-into-trinket":
    "acted = the target's PvP trinket was NOT ready at attempt start; hit = the target died within 15s",
  "healer-locked-window":
    "acted = own team pressed an offensive major CD inside the window (or 2s before); hit = an enemy died within 15s of window start",
  "offcd-into-healer-cc":
    "acted = the enemy healer was in hard CC at the instant of the cast; hit = an enemy died within 15s",
  "kick-eaten":
    "acted = the hard cast WAS interrupted; hit = owner or any friendly died within 10s of the cast start",
  "cd-spent-idle":
    "acted = the defensive CD was cast while threat was ACTIVE (i.e. not spent idle); hit = 'punished' — an enemy offensive CD landed in the next 30s while the CD was still down AND someone died within 10s of it",
  "healing-gap":
    "acted is always false (N/A — a gap is not an action); hit = any friendly died within 10s of gap end",
  "crisis-no-response":
    "CONTROL. acted = DecisionPoint.responded; hit = DecisionPoint.diedWithin10s (feasible & dangerous points only)",
};

// ---------------------------------------------------------------------------
// Ledger / ranking (same construction as behaviorPriorScan.ts)
// ---------------------------------------------------------------------------

function loadLedger(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.id) out.set(String(r.id), r);
      } catch {
        /* torn */
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared per-round scaffolding
// ---------------------------------------------------------------------------

/** Offensive major CDs, built exactly the way crisisDecisionPoints.ts builds
 * its own OFFENSIVE_CD_IDS (classMetadata × SpellTag.Offensive) — that set is
 * file-private there, so the construction is mirrored rather than the value
 * re-invented. */
const OFFENSIVE_CD_IDS = new Set<string>(
  classMetadata.flatMap((c: any) =>
    (c.abilities ?? [])
      .filter((a: any) => (a.tags ?? []).includes(SpellTag.Offensive))
      .map((a: any) => String(a.spellId)),
  ),
);

interface RoundCtx {
  combat: any;
  startMs: number;
  units: any[];
  players: any[];
  friends: any[];
  enemies: any[];
  friendlyPets: any[];
  enemyPets: any[];
  owner: any; // the friendly healer
  ownerSpec: string;
  /** seconds (match-relative) of every friendly deathRecord */
  friendDeathS: number[];
  /** seconds (match-relative) of every enemy deathRecord */
  enemyDeathS: number[];
  deathsOf: (u: any) => number[];
}

function buildCtx(combat: any): RoundCtx | null {
  const units: any[] = Object.values(combat?.units ?? {});
  const players = units.filter((u) => u.info);
  const healers = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly && isHealerSpec(u.spec),
  );
  const owner = healers[0];
  if (!owner) return null; // healer-owner perspective — no healer, skip round
  const friends = players.filter((u) => u.reaction === owner.reaction);
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  if (!friends.length || !enemies.length) return null;
  const friendIds = new Set(friends.map((u) => u.id));
  const enemyIds = new Set(enemies.map((u) => u.id));
  const startMs: number = combat.startTime;
  const deathsOf = (u: any): number[] =>
    ((u?.deathRecords ?? []) as any[]).map(
      (d) => ((d.timestamp as number) - startMs) / 1000,
    );
  return {
    combat,
    startMs,
    units,
    players,
    friends,
    enemies,
    friendlyPets: units.filter((u) => u.ownerId && friendIds.has(u.ownerId)),
    enemyPets: units.filter((u) => u.ownerId && enemyIds.has(u.ownerId)),
    owner,
    ownerSpec: specToString(owner.spec),
    friendDeathS: friends.flatMap(deathsOf).sort((a, b) => a - b),
    enemyDeathS: enemies.flatMap(deathsOf).sort((a, b) => a - b),
    deathsOf,
  };
}

const anyIn = (xs: number[], from: number, to: number): boolean =>
  xs.some((x) => x > from && x <= to);

/** A row factory bound to one round; probes only supply the varying fields. */
type Emit = (
  signal: string,
  tSec: number,
  state: Record<string, unknown>,
  acted: boolean,
  outcome: Record<string, unknown> & { hit: boolean },
) => void;

// ---------------------------------------------------------------------------
// Probe 1 — cd-hoarded
// ---------------------------------------------------------------------------
/**
 * Decision point: every friendly crisis crossing — the owner's own AND each
 * teammate's — taken verbatim from `crisisDecisionPoints` (so the crossing
 * rule, the 5s merge, dmg2s, enemyBurst and both death outcomes are the
 * product's, not this file's), restricted to crossings where the owner had at
 * least one MAJOR DEFENSIVE CD READY (`extractMajorCooldowns` ledger,
 * `DEFENSIVE_TAGS`, `cdAvailableAt`, proc-only excluded). For a TEAMMATE's
 * crisis the CD must additionally pass `canHelpAnotherUnit` — a self-only wall
 * cannot answer someone else's crisis (GH #28's predicate).
 *
 * Deviation from the brief: the "any teammate HP sample ≤40%, merged 5s"
 * variant is obtained by calling `crisisDecisionPoints` with the TEAMMATE as
 * owner instead of hand-rolling a second HP-sampling/merge rule — same
 * threshold (CRISIS_HP_PCT = 0.4), same CRISIS_WINDOW_GAP_MS = 5000, and it
 * carries the outcome fields already. Role is passed as "healer" for every
 * unit because role only affects `hasTool`, which this probe does not read.
 *
 * acted = one of those READY CDs was actually cast within [t, t+5s].
 * outcome.hit = the crisis unit died within 10s (DecisionPoint.diedWithin10s).
 */
function probeCdHoarded(ctx: RoundCtx, emit: Emit): void {
  let cds: IMajorCooldownInfo[];
  try {
    cds = extractMajorCooldowns(ctx.owner, ctx.combat);
  } catch {
    return;
  }
  const defensive = cds.filter(
    (cd) => DEFENSIVE_TAGS.has(cd.tag) && !isProcOnlyActivation(cd.spellId),
  );
  if (!defensive.length) return;
  const allyCapable = defensive.filter((cd) =>
    canHelpAnotherUnit(cd.spellId, cd.tag),
  );

  for (const unit of ctx.friends) {
    const isSelf = unit.id === ctx.owner.id;
    const pool = isSelf ? defensive : allyCapable;
    if (!pool.length) continue;
    let points: DecisionPoint[];
    try {
      points = crisisDecisionPoints(unit, ctx.combat, "healer");
    } catch {
      continue;
    }
    for (const p of points) {
      const ready = pool.filter((cd) => cdAvailableAt(cd, p.tSec));
      if (!ready.length) continue; // no tool ready → not a decision point
      const acted = ready.some((cd) =>
        cd.casts.some(
          (c) => c.timeSeconds >= p.tSec && c.timeSeconds <= p.tSec + 5,
        ),
      );
      emit(
        "cd-hoarded",
        p.tSec,
        {
          crisisUnit: isSelf ? "self" : "teammate",
          crisisSpec: specToString(unit.spec),
          hpPct: p.hpPct,
          dmg2s: p.dmg2s,
          attackers2s: p.attackers2s,
          enemyBurst: p.enemyBurst,
          dangerous: p.dangerous,
          readyCds: ready.length,
          readyNames: ready.map((c) => c.spellName).slice(0, 4),
        },
        acted,
        { hit: p.diedWithin10s, friendDied15s: p.friendDiedWithin15s },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Probe 2 — attempt-into-trinket
// ---------------------------------------------------------------------------
/**
 * Decision point: every kill attempt the owner's team made on an enemy target
 * (`extractKillAttempts(friends, enemies, combat)` — team-level, so no DPS
 * owner iteration is needed; the row's ownerSpec stays the healer's for
 * consistency with every other probe).
 *
 * acted = the target's PvP trinket was NOT ready when the attempt opened
 * (i.e. the attempt was NOT thrown into a ready trinket). Trinket state is
 * read from `analyzePlayerCCAndTrinket(target, friends, combat, friendlyPets)`
 * — the product predicate — preferring the `ICCInstance.trinketState` of the
 * CC instance nearest the attempt start (that IS the state the product would
 * render), and falling back to the summary's own `trinketUseTimes` +
 * `trinketCooldownSeconds` when the attempt has no CC instance in range
 * (burst-anchored attempts). The fallback does NOT model the category-1166
 * racial shared lockout (`trinketCooldownRemainingMs` is file-private), so it
 * can over-report "ready"; `state.stateSource` marks which path was used.
 * `passive_trinket` (Relentless) is its own state and counts as NOT ready —
 * there is no button to press.
 *
 * outcome.hit = the target died within 15s of attempt start.
 */
function probeAttemptIntoTrinket(ctx: RoundCtx, emit: Emit): void {
  const attempts = extractKillAttempts(ctx.friends, ctx.enemies, ctx.combat);
  if (!attempts.length) return;
  const summaries = new Map<string, any>();
  const summaryOf = (target: any): any => {
    if (!summaries.has(target.id)) {
      summaries.set(
        target.id,
        analyzePlayerCCAndTrinket(
          target,
          ctx.friends,
          ctx.combat,
          ctx.friendlyPets,
        ),
      );
    }
    return summaries.get(target.id);
  };
  for (const a of attempts) {
    const target = ctx.enemies.find((e) => e.id === a.targetUnitId);
    if (!target) continue;
    let s: any;
    try {
      s = summaryOf(target);
    } catch {
      continue;
    }
    // nearest CC instance whose application sits inside the attempt span
    // (±1s slack for the stun that anchors it).
    let near: any = null;
    for (const cc of s.ccInstances as any[]) {
      if (cc.atSeconds < a.fromSeconds - 1 || cc.atSeconds > a.toSeconds + 1)
        continue;
      if (
        near === null ||
        Math.abs(cc.atSeconds - a.fromSeconds) <
          Math.abs(near.atSeconds - a.fromSeconds)
      )
        near = cc;
    }
    let trinketState: string;
    let stateSource: string;
    if (near) {
      trinketState = near.trinketState;
      stateSource = "ccInstance";
    } else {
      stateSource = "ledger";
      if (s.trinketType === "Relentless") trinketState = "passive_trinket";
      else {
        const last = (s.trinketUseTimes as number[])
          .filter((t) => t <= a.fromSeconds)
          .pop();
        trinketState =
          last !== undefined && a.fromSeconds - last < s.trinketCooldownSeconds
            ? "on_cooldown"
            : "available_unused";
      }
    }
    const trinketReady = trinketState === "available_unused";
    const died = anyIn(
      ctx.deathsOf(target),
      a.fromSeconds - 0.001,
      a.fromSeconds + 15,
    );
    emit(
      "attempt-into-trinket",
      a.fromSeconds,
      {
        trinketReady,
        trinketState,
        stateSource,
        trinketType: s.trinketType,
        anchor: a.anchor,
        opportunity: a.opportunity?.tier ?? a.opportunity ?? null,
        openingDrLevel: a.openingDrLevel ?? null,
        teamOnTargetPct: Math.round(a.teamOnTargetPct),
        targetSpec: specToString(target.spec),
      },
      !trinketReady,
      { hit: died, attemptKilled: a.killed },
    );
  }
}

// ---------------------------------------------------------------------------
// Probe 3 — healer-locked kill window (+ 3b reverse)
// ---------------------------------------------------------------------------
/**
 * Decision point: every enemy-healer hard-CC window at least 3s long, from
 * `enemyHealerCcWindows` — the SAME windows `missed-sync-window` and
 * `unsynced-burst` consume.
 * acted = the owner's team cast at least one offensive major CD inside
 * [from - 2s, to].
 * outcome.hit = any enemy died within 15s of window start.
 *
 * 3b (reverse probe): anchored on the CAST instead of the window — every
 * friendly offensive major CD cast, state `healerCcActive` = the instant sits
 * inside one of those windows, outcome = any enemy died within 15s. The two
 * probes share the exact same window list and the same offensive-CD id set,
 * so their denominators are directly comparable.
 */
function probeHealerLockedWindow(ctx: RoundCtx, emit: Emit): void {
  const windows = enemyHealerCcWindows(
    ctx.friends,
    ctx.enemies,
    ctx.combat,
  ).filter((w) => w.toSeconds - w.fromSeconds >= 3);
  const offCasts: { t: number; name: string; unit: string }[] = [];
  for (const f of ctx.friends) {
    for (const c of (f.spellCastEvents ?? []) as any[]) {
      if (!OFFENSIVE_CD_IDS.has(String(c.spellId ?? ""))) continue;
      offCasts.push({
        t: (c.timestamp - ctx.startMs) / 1000,
        name: String(c.spellName ?? c.spellId),
        unit: f.name,
      });
    }
  }
  for (const w of windows) {
    const inside = offCasts.filter(
      (c) => c.t >= w.fromSeconds - 2 && c.t <= w.toSeconds,
    );
    emit(
      "healer-locked-window",
      w.fromSeconds,
      {
        windowS: Math.round((w.toSeconds - w.fromSeconds) * 10) / 10,
        ccSpell: w.spellName,
        healer: w.healerName,
        offCdsInWindow: inside.length,
        offCdNames: inside.map((c) => c.name).slice(0, 4),
      },
      inside.length > 0,
      {
        hit: anyIn(ctx.enemyDeathS, w.fromSeconds - 0.001, w.fromSeconds + 15),
      },
    );
  }
  // 3b — the same fact, cast-anchored.
  for (const c of offCasts) {
    const active = windows.some(
      (w) => w.fromSeconds <= c.t && w.toSeconds >= c.t,
    );
    emit(
      "offcd-into-healer-cc",
      c.t,
      { spell: c.name, caster: c.unit, healerCcActive: active },
      active,
      { hit: anyIn(ctx.enemyDeathS, c.t - 0.001, c.t + 15) },
    );
  }
}

// ---------------------------------------------------------------------------
// Probe 4 — kick-eaten
// ---------------------------------------------------------------------------
/**
 * Decision point: every hard cast the owner STARTED (`castStartEvents` — the
 * only log evidence a hard cast existed; a round whose archive predates
 * cast-start data contributes nothing, never a fabricated zero).
 *
 * Deviation from the brief: `analyzeKickAudit` is the OWNER-AS-KICKER audit
 * ("did MY interrupt land"), which is the wrong side for kick-eaten. The
 * kick-eaten producer (`kickEatenEvents`, candidateFindings.ts) consumes
 * `analyzePlayerCCAndTrinket(owner, …).interruptInstances` — kicks landed ON
 * the owner — so that is what this probe consumes too.
 *
 * `acted` here means "the cast WAS interrupted" (the brief marks acted N/A for
 * this signal; the report's acted-vs-not contrast is therefore exactly the
 * interrupted-vs-not-interrupted contrast the brief asks for).
 * outcome.hit = the owner or any friendly died within 10s of the cast start.
 */
function probeKickEaten(ctx: RoundCtx, emit: Emit): void {
  const starts = (ctx.owner.castStartEvents ?? []) as any[];
  if (!starts.length) return; // no cast-start data in this archive
  let interrupts: any[] = [];
  try {
    interrupts = analyzePlayerCCAndTrinket(
      ctx.owner,
      ctx.enemies,
      ctx.combat,
      ctx.enemyPets,
    ).interruptInstances;
  } catch {
    return;
  }
  for (const st of starts) {
    const t = (st.timestamp - ctx.startMs) / 1000;
    const hit = interrupts.find(
      (i) =>
        String(i.interruptedSpellId) === String(st.spellId ?? "") &&
        i.atSeconds >= t - 0.2 &&
        i.atSeconds <= t + 5,
    );
    emit(
      "kick-eaten",
      t,
      {
        spell: String(st.spellName ?? st.spellId ?? ""),
        interrupted: Boolean(hit),
        lockoutS: hit ? hit.lockoutDurationSeconds : null,
        postKick: hit ? hit.postKick : null,
        kickSpell: hit ? hit.kickSpellName : null,
      },
      Boolean(hit),
      { hit: anyIn(ctx.friendDeathS, t - 0.001, t + 10) },
    );
  }
}

// ---------------------------------------------------------------------------
// Probe 5 — cd-spent-idle
// ---------------------------------------------------------------------------
/**
 * Decision point: every cast of one of the owner's defensive major CDs, using
 * the EXACT filter `cdSpentIdleEvents` applies (`DEFENSIVE_TAGS.has(tag) &&
 * !isThroughput && !isProcOnlyActivation && !THROUGHPUT_EMPOWER_DEFENSIVE_IDS`).
 * The cast instant is render-floored (`toRenderSecond`) BEFORE the threat gate
 * runs, exactly as the producer does.
 *
 * `acted` = `threatActiveAt(t)` — the CD was spent while threat was ACTIVE
 * (the behaviour the signal endorses). `acted === false` is precisely the
 * cd-spent-idle accusation.
 *
 * outcome.hit = "punished": an enemy offensive major CD was cast at some
 * instant te ∈ (t, t+30] while THIS cooldown was still down
 * (`!cdAvailableAt(cd, te)`), AND the owner or a friendly died within 10s of
 * te. The B6 `matchThreatLevel` red line is NOT applied as a filter here (it
 * would delete the whole low-threat half of the denominator); it is recorded
 * in `state.matchThreat` so the report can be read with or without it.
 */
function probeCdSpentIdle(ctx: RoundCtx, emit: Emit): void {
  let cds: IMajorCooldownInfo[];
  try {
    cds = extractMajorCooldowns(ctx.owner, ctx.combat);
  } catch {
    return;
  }
  const defensive = cds.filter(
    (cd) =>
      DEFENSIVE_TAGS.has(cd.tag) &&
      !cd.isThroughput &&
      !isProcOnlyActivation(cd.spellId) &&
      !THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(cd.spellId),
  );
  if (!defensive.length) return;
  let matchThreat = "unknown";
  try {
    matchThreat = matchThreatLevel(ctx.enemies, ctx.friends, ctx.combat);
  } catch {
    /* leave unknown */
  }
  const enemyOffCasts: number[] = [];
  for (const e of ctx.enemies) {
    for (const c of (e.spellCastEvents ?? []) as any[]) {
      if (OFFENSIVE_CD_IDS.has(String(c.spellId ?? "")))
        enemyOffCasts.push((c.timestamp - ctx.startMs) / 1000);
    }
  }
  enemyOffCasts.sort((a, b) => a - b);

  for (const cd of defensive) {
    for (const cast of cd.casts) {
      const t = toRenderSecond(cast.timeSeconds);
      let active: boolean;
      try {
        active = threatActiveAt(t, ctx.enemies, ctx.friends, ctx.combat);
      } catch {
        continue;
      }
      const punished = enemyOffCasts.some(
        (te) =>
          te > t &&
          te <= t + 30 &&
          !cdAvailableAt(cd, te) &&
          anyIn(ctx.friendDeathS, te - 0.001, te + 10),
      );
      emit(
        "cd-spent-idle",
        t,
        {
          spell: cd.spellName,
          spellId: cd.spellId,
          threatActive: active,
          matchThreat,
          cooldownS: cd.cooldownSeconds,
        },
        active,
        { hit: punished },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Probe 6 — healing-gap (threshold sweep)
// ---------------------------------------------------------------------------
/**
 * Decision point: every healer free-cast gap from `detectHealingGaps` with
 * `freeCastSeconds >= 2`.
 *
 * Deviation from the brief: `detectHealingGaps` itself only emits gaps that
 * already cleared its own three gates (≥3s idle, ≥1.5s free, a pressured
 * teammate), so "≥2s" here is a filter ON TOP of the product's own detector
 * rather than a wider net; the product's `healingGapEvents` mapper adds a
 * stricter `HEAL_GAP_FREE_MIN_S` door on top of that, which this probe
 * deliberately does NOT apply — the point is to sweep the threshold.
 *
 * The lowest friendly HP inside the gap comes from
 * `friendlyCrisisMomentInWindow` (the same render-grid scan cd-hoarded uses),
 * so the sweep's HP bins are on the rendered grid.
 *
 * acted is always false (a gap is not an action).
 * outcome.hit = any friendly died within 10s of gap END.
 */
function probeHealingGap(ctx: RoundCtx, emit: Emit): void {
  let gaps: any[];
  try {
    gaps = detectHealingGaps(
      ctx.owner,
      ctx.friends,
      ctx.enemies,
      ctx.combat,
    ) as any[];
  } catch {
    return;
  }
  for (const g of gaps) {
    if (g.freeCastSeconds < 2) continue;
    let lowest: number | null = null;
    try {
      lowest =
        friendlyCrisisMomentInWindow(
          ctx.friends,
          ctx.combat,
          g.fromSeconds,
          g.toSeconds,
        )?.hpPct ?? null;
    } catch {
      lowest = null;
    }
    const gapBin =
      g.freeCastSeconds < 4 ? "2-4" : g.freeCastSeconds < 6 ? "4-6" : "6+";
    const hpBin =
      lowest === null
        ? "no-data"
        : lowest <= 40
          ? "<=40"
          : lowest <= 70
            ? "40-70"
            : ">70";
    emit(
      "healing-gap",
      g.fromSeconds,
      {
        freeCastSeconds: Math.round(g.freeCastSeconds * 10) / 10,
        durationSeconds: Math.round(g.durationSeconds * 10) / 10,
        mostDamagedAmount: Math.round(g.mostDamagedAmount),
        mostDamagedName: g.mostDamagedName,
        lowestHpPct: lowest,
        gapBin,
        hpBin,
      },
      false,
      { hit: anyIn(ctx.friendDeathS, g.toSeconds - 0.001, g.toSeconds + 10) },
    );
  }
}

// ---------------------------------------------------------------------------
// Probe 7 — crisis-no-response (control)
// ---------------------------------------------------------------------------
/**
 * The known-good reference row: the healer owner's own `crisisDecisionPoints`,
 * restricted to `feasible && dangerous` (the product's own firing condition),
 * acted = `responded`, outcome = `diedWithin10s`. Any magnitude the other six
 * probes report should be read against this one.
 */
function probeCrisisNoResponse(ctx: RoundCtx, emit: Emit): void {
  let points: DecisionPoint[];
  try {
    points = crisisDecisionPoints(ctx.owner, ctx.combat, "healer");
  } catch {
    return;
  }
  for (const p of points) {
    if (!p.feasible || !p.dangerous) continue;
    emit(
      "crisis-no-response",
      p.tSec,
      {
        hpPct: p.hpPct,
        dmg2s: p.dmg2s,
        attackers2s: p.attackers2s,
        enemyBurst: p.enemyBurst,
        responses: p.responses,
      },
      p.responded,
      { hit: p.diedWithin10s, friendDied15s: p.friendDiedWithin15s },
    );
  }
}

const PROBES: [string, (ctx: RoundCtx, emit: Emit) => void][] = [
  ["cd-hoarded", probeCdHoarded],
  ["attempt-into-trinket", probeAttemptIntoTrinket],
  ["healer-locked-window", probeHealerLockedWindow],
  ["kick-eaten", probeKickEaten],
  ["cd-spent-idle", probeCdSpentIdle],
  ["healing-gap", probeHealingGap],
  ["crisis-no-response", probeCrisisNoResponse],
];

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest");
  const ledgerDir = flag("--ledger");
  const out = flag("--out");
  if (!manifestPath || !ledgerDir || !out) {
    console.error(
      "usage: scan --manifest <file> --ledger <dir> --out <file.jsonl> [--offset N] [--limit N] [--only sig,sig]",
    );
    process.exit(1);
  }
  const only = flag("--only")
    ? new Set(
        flag("--only")!
          .split(",")
          .map((s) => s.trim()),
      )
    : null;
  await ensureAnalysisData();
  const ledger = loadLedger(ledgerDir);
  const pctOf = rankLedger(ledger);
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        done.add(JSON.parse(l).matchId);
      } catch {
        /* torn */
      }
    }
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (limit) files = files.slice(0, limit);

  let scanned = 0,
    oldSeason = 0,
    rows = 0;
  const perSignal = new Map<string, number>();
  const failures = new Map<string, number>();

  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    if (done.has(matchId)) continue;
    const meta = ledger.get(matchId);
    if (
      !meta ||
      !meta.startTime ||
      meta.startTime < PATCH_121_GOLIVE_EPOCH_MS
    ) {
      oldSeason++;
      continue;
    }
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
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    scanned++;
    const pct = pctOf.get(matchId) ?? null;
    const bracket = meta?.bracket ?? "?";
    const week = isoWeek(meta.startTime);
    let seq = 0;
    const lines: string[] = [];

    for (const combat of combats) {
      const mySeq = combats.length > 1 ? seq++ : null;
      let ctx: RoundCtx | null = null;
      try {
        ctx = buildCtx(combat);
      } catch {
        ctx = null;
      }
      if (!ctx) continue;
      for (const [signal, fn] of PROBES) {
        if (only && !only.has(signal)) continue;
        const emit: Emit = (sig, tSec, state, acted, outcome) => {
          const row: Row = {
            signal: sig,
            matchId,
            seq: mySeq,
            bracket,
            week,
            rating: meta?.playerTeamRating ?? null,
            pct,
            ownerSpec: ctx!.ownerSpec,
            tSec: Math.round(tSec * 10) / 10,
            state,
            acted,
            outcome,
          };
          lines.push(JSON.stringify(row));
          rows++;
          perSignal.set(sig, (perSignal.get(sig) ?? 0) + 1);
        };
        // Each probe is independently guarded: one signal blowing up must
        // never drop the other six for this round.
        try {
          fn(ctx, emit);
        } catch {
          failures.set(signal, (failures.get(signal) ?? 0) + 1);
        }
      }
    }
    // Always record the match as done, even with zero rows (resumability).
    if (!lines.length) lines.push(JSON.stringify({ matchId, empty: true }));
    appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 25 === 0)
      console.error(
        `… ${scanned} matches, ${rows} rows, ${oldSeason} skipped (old season/no ledger)`,
      );
  }
  console.error(`done: scanned=${scanned} rows=${rows} skipped=${oldSeason}`);
  for (const [s] of PROBES)
    console.error(`  ${s.padEnd(22)} ${perSignal.get(s) ?? 0}`);
  if (failures.size)
    console.error(
      `probe failures: ${[...failures].map(([s, n]) => `${s}=${n}`).join(" ")}`,
    );
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function pctStr(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "—";
}

/** outcome rate among acted / among not-acted, and their difference */
function contrast(rows: Row[]): string {
  const a = rows.filter((r) => r.acted);
  const na = rows.filter((r) => !r.acted);
  const ra = a.length
    ? (100 * a.filter((r) => r.outcome.hit).length) / a.length
    : NaN;
  const rn = na.length
    ? (100 * na.filter((r) => r.outcome.hit).length) / na.length
    : NaN;
  const d =
    Number.isFinite(ra) && Number.isFinite(rn)
      ? `${(ra - rn >= 0 ? "+" : "") + (ra - rn).toFixed(1)}pp`
      : "—";
  return `${pctStr(a.filter((r) => r.outcome.hit).length, a.length)} | ${pctStr(
    na.filter((r) => r.outcome.hit).length,
    na.length,
  )} | ${d}`;
}

function report(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <file.jsonl>");
    process.exit(1);
  }
  const rows: Row[] = [];
  let emptyMatches = 0;
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      if (r.empty) {
        emptyMatches++;
        continue;
      }
      rows.push(r);
    } catch {
      /* torn */
    }
  }
  const matches = new Set(rows.map((r) => r.matchId)).size + emptyMatches;
  const out: string[] = [];
  out.push(`# signal outcome probe — decision point → behaviour → outcome\n`);
  out.push(`matches ${matches}, decision-point rows ${rows.length}.\n`);
  out.push(
    `Columns: n | share acted | outcome rate ACTED | outcome rate NOT-acted | Δ (acted − not).\n`,
  );

  const signals = [...new Set(rows.map((r) => r.signal))].sort();
  for (const sig of signals) {
    const rs = rows.filter((r) => r.signal === sig);
    out.push(`\n## ${sig} — ${rs.length} decision points`);
    out.push(`\n_${SIGNAL_LEGEND[sig] ?? "—"}_\n`);
    out.push(`| slice | n | share acted | hit·acted | hit·not-acted | Δ |`);
    out.push(`|---|---|---|---|---|---|`);
    const line = (label: string, sub: Row[]) =>
      out.push(
        `| ${label} | ${sub.length} | ${pctStr(
          sub.filter((r) => r.acted).length,
          sub.length,
        )} | ${contrast(sub)} |`,
      );
    line("ALL", rs);
    const brackets = [...new Set(rs.map((r) => r.bracket))].sort();
    for (const b of brackets)
      line(
        b,
        rs.filter((r) => r.bracket === b),
      );
    // the required 2-row rank split
    line(
      "rank pct>=90",
      rs.filter((r) => r.pct != null && r.pct >= 90),
    );
    line(
      "rank pct<30",
      rs.filter((r) => r.pct != null && r.pct < 30),
    );

    // healing-gap is a threshold sweep, not an acted/not contrast: print the
    // bins the brief asks for instead of an all-false `acted` column.
    if (sig === "healing-gap") {
      out.push(`\n| gap-length bin | n | friendly death ≤10s after gap end |`);
      out.push(`|---|---|---|`);
      for (const b of ["2-4", "4-6", "6+"]) {
        const sub = rs.filter((r) => (r.state as any).gapBin === b);
        out.push(
          `| ${b}s | ${sub.length} | ${pctStr(sub.filter((r) => r.outcome.hit).length, sub.length)} |`,
        );
      }
      out.push(
        `\n| lowest-friendly-HP bin | n | friendly death ≤10s after gap end |`,
      );
      out.push(`|---|---|---|`);
      for (const b of ["<=40", "40-70", ">70", "no-data"]) {
        const sub = rs.filter((r) => (r.state as any).hpBin === b);
        out.push(
          `| ${b} | ${sub.length} | ${pctStr(sub.filter((r) => r.outcome.hit).length, sub.length)} |`,
        );
      }
    }
    if (sig === "cd-hoarded") {
      out.push(
        `\n| crisis owner | n | share acted | hit·acted | hit·not-acted | Δ |`,
      );
      out.push(`|---|---|---|---|---|---|`);
      for (const b of ["self", "teammate"]) {
        const sub = rs.filter((r) => (r.state as any).crisisUnit === b);
        out.push(
          `| ${b} | ${sub.length} | ${pctStr(sub.filter((r) => r.acted).length, sub.length)} | ${contrast(sub)} |`,
        );
      }
    }
    if (sig === "attempt-into-trinket") {
      out.push(`\n| trinket state at attempt start | n | target died ≤15s |`);
      out.push(`|---|---|---|`);
      const states = [
        ...new Set(rs.map((r) => String((r.state as any).trinketState))),
      ].sort();
      for (const b of states) {
        const sub = rs.filter((r) => (r.state as any).trinketState === b);
        out.push(
          `| ${b} | ${sub.length} | ${pctStr(sub.filter((r) => r.outcome.hit).length, sub.length)} |`,
        );
      }
    }
  }
  process.stdout.write(out.join("\n") + "\n");
}

if (cmd === "scan") await scan();
else if (cmd === "report") report();
else {
  console.error("usage: signalOutcomeProbe.ts scan|report ...");
  process.exit(1);
}
