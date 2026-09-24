/**
 * crisisAnswerEvidence — step 2 of the temporal-evidence experiment (GH #94,
 * spec docs/superpowers/specs/2026-09-13-temporal-evidence-experiment.md,
 * amendment 1).
 *
 * Question (user ruling 2026-09-13, holistic): at this healer crisis, was the
 * situation answered — by everything active on the player plus anything done in
 * the window — or not, or is the evidence insufficient? This module returns ONE
 * provenance-tagged evidence list and NO verdict. A human reads it and judges.
 *
 * Information cutoffs are enforced structurally, not by care: every fact about
 * the instant t is computed on a copy of the round truncated at t, every fact
 * about the window on a copy truncated at t + 3 s. `truncateRound` filters EVERY
 * timestamped top-level array on every unit and clamps the round's endTime, so a
 * stream nobody remembered to filter still cannot leak (the invariance test in
 * packages/eval/test/crisisAnswerEvidence.test.ts mutates events after each
 * cutoff and requires field-by-field equality).
 *
 * Sources are the shared predicates only: resolveMitigation (MITIGATION_TABLE components),
 * abilityProfile (absorbs / immunity / healing-received), ccSpellIds,
 * buildAuraIntervals, getUnitPositionAtTime with the INTERP_MAX_GAP_MS freshness
 * bound. Nothing here is a new spell list; an aura none of them classifies is
 * reported as unclassified, never dropped as irrelevant.
 */
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import {
  resolveMitigation,
  strongestComponentPct,
} from "@gladlog/analysis/src/data/mitigationComponents";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { ENEMY_BURST_LOOKBACK_MS } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import {
  getUnitPositionAtTime,
  getUnitRawPositionAtTime,
  hasLineOfSight,
} from "@gladlog/analysis/src/utils/losAnalysis";
import {
  INTERP_MAX_GAP_MS,
  LOS_SWEEP_GAP_MS,
} from "@gladlog/analysis/src/utils/positionSampling";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import type { ICombatUnit } from "@gladlog/parser-compat";

export const WINDOW_MS = 3000;
const PRIOR_DAMAGE_MS = 2000;

type EvidenceStatus = "known" | "estimated" | "unknown";
type EvidencePhase = "at-t" | "window";
type EvidenceKind =
  | "pressure"
  | "mitigation"
  | "immunity"
  | "absorb"
  | "hot"
  | "healing-received-modifier"
  | "cc-on-owner"
  | "healing"
  | "absorbed-damage"
  | "aura-applied"
  | "cast"
  | "cc-on-attacker"
  | "movement"
  | "unclassified"
  | "enemy-offensive-active"
  | "enemy-offensive-cast"
  | "los";

/** Zones GH #83 records as traced from minimaps, never void-analysis calibrated. */
const MINIMAP_TRACED_ZONES: ReadonlySet<string> = new Set([
  "1911", // Mugambala
  "980", // Tol'viron
  "2167", // Robodrome
  "2547", // Enigma Crucible
]);

interface EvidenceItem {
  phase: EvidencePhase;
  kind: EvidenceKind;
  status: EvidenceStatus;
  text: string;
  /** Observation timestamps (ms) this item rests on — all within the phase cutoff. */
  atMs: number[];
  /** Which shared predicate / event stream the item comes from. */
  source: string;
  spellId?: string;
  srcName?: string;
  amount?: number;
  /** Structured fields for renderers that must not parse `text`. */
  detail?: Record<string, unknown>;
}

interface CrisisAnswerEvidence {
  ownerId: string;
  ownerName: string;
  tMs: number;
  tSec: number;
  windowEndMs: number;
  items: EvidenceItem[];
  /** Spell ids of auras active on the owner at t that no shared predicate classifies. */
  unclassifiedAuraIds: string[];
  /** Top-level unit arrays whose elements carried no timestamp (cannot be cut). */
  untimedStreams: string[];
}

type Round = {
  startTime: number;
  endTime: number;
  units: Record<string, ICombatUnit>;
  [k: string]: any;
};

function tsOf(el: any): number | undefined {
  const t = el?.logLine?.timestamp ?? el?.timestamp;
  return typeof t === "number" ? t : undefined;
}

/**
 * A copy of the round holding only observations at or before `cutoffMs`.
 * Every top-level array on every unit is filtered by its elements' timestamp;
 * the round's endTime is clamped; raw lines are dropped. Streams whose elements
 * carry no timestamp are kept and reported in `untimed`.
 */
export function truncateRound(
  round: Round,
  cutoffMs: number,
): { round: Round; untimed: string[] } {
  const untimed = new Set<string>();
  const units: Record<string, ICombatUnit> = {};
  for (const [id, u] of Object.entries(round.units)) {
    const copy: any = { ...u };
    for (const [key, val] of Object.entries(u)) {
      if (!Array.isArray(val)) continue;
      copy[key] = val.filter((el) => {
        const t = tsOf(el);
        if (t === undefined) {
          untimed.add(key);
          return true;
        }
        return t <= cutoffMs;
      });
    }
    units[id] = copy;
  }
  return {
    round: {
      ...round,
      units,
      endTime: Math.min(round.endTime, cutoffMs),
      rawLines: [],
    },
    untimed: [...untimed].sort(),
  };
}

const k = (x: number): string => `${Math.round(x / 1000)}k`;
const relS = (round: Round, ms: number): string =>
  `${((ms - round.startTime) / 1000).toFixed(1)}s`;
const nameOf = (id: string, raw: string): string =>
  getEnglishSpellName(id, raw ?? "");

/** Official function of a spell, for casts and applied auras. */
function functionOf(spellId: string): string[] {
  const p = abilityProfile(spellId);
  const f: string[] = [];
  const selfRes = resolveMitigation(spellId, { carrierIsCaster: true });
  if (selfRes)
    f.push(
      `${strongestComponentPct(selfRes, { includeImmunity: true })!.pctMin}% mitigation`,
    );
  // Target-side immunity flags on enemy-directed spells (Cyclone immunes its
  // victim) are not protection for the caster — abilityProfile records that
  // semantic trap itself.
  if (!p.hitsEnemy && p.immuneSchools !== undefined)
    f.push(`school immunity (mask ${p.immuneSchools})`);
  else if (!p.hitsEnemy && (p.immuneMechanics?.length ?? 0) > 0)
    f.push(`mechanic immunity (ids ${p.immuneMechanics!.join(", ")})`);
  if (p.absorbs) f.push("absorb");
  if (p.healingReceivedPct !== undefined)
    f.push(`+${p.healingReceivedPct}% healing received`);
  if (p.healsSelf || p.healsOthers) f.push("heals");
  if (ccSpellIds.has(spellId)) f.push("crowd control");
  if (p.dealsDamage) f.push("damage");
  return f;
}

export function buildCrisisAnswerEvidence(
  fullRound: Round,
  ownerId: string,
  tSec: number,
  teams: { friendIds: string[]; enemyIds: string[] },
): CrisisAnswerEvidence {
  const tMs = fullRound.startTime + tSec * 1000;
  const windowEndMs = tMs + WINDOW_MS;
  const atT = truncateRound(fullRound, tMs);
  const win = truncateRound(fullRound, windowEndMs);
  const ownerAtT = atT.round.units[ownerId]!;
  const ownerWin = win.round.units[ownerId]!;
  const friendIds = new Set(teams.friendIds);
  const enemyIds = new Set(teams.enemyIds);
  const nameById = new Map(
    Object.values(fullRound.units).map((u) => [u.id, u.name]),
  );
  // Pets fold to their owner for "who attacked".
  const playerOf = (id: string): string =>
    fullRound.units[id]?.ownerId &&
    fullRound.units[fullRound.units[id]!.ownerId]
      ? fullRound.units[id]!.ownerId
      : id;
  const items: EvidenceItem[] = [];

  // ── at t: pressure ─────────────────────────────────────────────────────────
  const samples = ownerAtT.advancedActions ?? [];
  const last = samples[samples.length - 1];
  if (
    last &&
    tMs - last.timestamp <= INTERP_MAX_GAP_MS &&
    last.advancedActorMaxHp > 0
  ) {
    items.push({
      phase: "at-t",
      kind: "pressure",
      status: "known",
      text: `HP ${Math.round((100 * last.advancedActorCurrentHp) / last.advancedActorMaxHp)}% (latest sample ${((tMs - last.timestamp) / 1000).toFixed(1)} s before t)`,
      atMs: [last.timestamp],
      detail: {
        hpPct: Math.round(
          (100 * last.advancedActorCurrentHp) / last.advancedActorMaxHp,
        ),
      },
      source: "advancedActions (latest sample ≤ t)",
    });
  } else {
    items.push({
      phase: "at-t",
      kind: "pressure",
      status: "unknown",
      text: "HP at t: no sample within the freshness bound",
      atMs: [],
      source: "advancedActions",
    });
  }
  const priorDmg = (ownerAtT.damageIn ?? []).filter(
    (d) =>
      d.timestamp >= tMs - PRIOR_DAMAGE_MS &&
      d.logLine.event !== "SPELL_ABSORBED" &&
      d.effectiveAmount < 0,
  );
  const attackers = new Map<string, number>();
  for (const d of priorDmg) {
    const who = playerOf(d.srcUnitId);
    if (!enemyIds.has(who)) continue;
    attackers.set(who, (attackers.get(who) ?? 0) - d.effectiveAmount);
  }
  const maxHp = last?.advancedActorMaxHp ?? 0;
  const dmgTotal = [...attackers.values()].reduce((a, b) => a + b, 0);
  items.push({
    phase: "at-t",
    kind: "pressure",
    status: "known",
    text: `${k(dmgTotal)} damage taken in the 2 s before t${maxHp ? ` (${Math.round((100 * dmgTotal) / maxHp)}% of max HP)` : ""} from ${[...attackers.entries()].map(([id, v]) => `${nameById.get(id) ?? id} ${k(v)}`).join(", ") || "no identified enemy player"}`,
    atMs: priorDmg.map((d) => d.timestamp),
    detail: {
      dmgPct: maxHp ? Math.round((100 * dmgTotal) / maxHp) : null,
      attackers: [...attackers.entries()].map(([id, v]) => ({
        name: nameById.get(id) ?? id,
        amount: v,
      })),
    },
    source: "damageIn [t − 2 s, t], pets folded to owners",
  });

  // ── at t: auras on the owner ───────────────────────────────────────────────
  const tRel = tSec;
  const heals = ownerAtT.healIn ?? [];
  const unclassified: string[] = [];
  const seenAura = new Set<string>();
  for (const iv of buildAuraIntervals(ownerAtT, atT.round)) {
    if (!(iv.fromS <= tRel && iv.toS >= tRel)) continue;
    const key = `${iv.spellId}|${iv.srcUnitName}`;
    if (seenAura.has(key)) continue;
    seenAura.add(key);
    const appliedMs = atT.round.startTime + iv.fromS * 1000;
    const status: EvidenceStatus = iv.inferredStart ? "estimated" : "known";
    const src = iv.srcUnitName;
    const fromSelf = src === ownerAtT.name;
    const nm = nameOf(iv.spellId, iv.spellName);
    const who = fromSelf ? "self" : src;
    const base = {
      phase: "at-t" as const,
      status,
      atMs: [appliedMs],
      spellId: iv.spellId,
      srcName: src,
    };
    const mit = resolveMitigation(iv.spellId, { carrierIsCaster: fromSelf });
    const prof = abilityProfile(iv.spellId);
    const srcIsEnemy = [...enemyIds].some((id) => nameById.get(id) === src);
    if (
      !srcIsEnemy &&
      (prof.immuneSchools !== undefined ||
        (prof.immuneMechanics?.length ?? 0) > 0)
    ) {
      items.push({
        ...base,
        kind: "immunity",
        text: `${nm} (${prof.immuneSchools !== undefined ? `school immunity, mask ${prof.immuneSchools}` : `mechanic immunity, ids ${prof.immuneMechanics!.join(", ")} — not damage protection`}) from ${who}, applied ${relS(atT.round, appliedMs)}`,
        source: "abilityProfile.immuneSchools/immuneMechanics",
      });
      continue;
    }
    if (!srcIsEnemy && mit) {
      const pct = strongestComponentPct(mit, { includeImmunity: true })!.pctMin;
      items.push({
        ...base,
        kind: "mitigation",
        amount: pct,
        text: `${nm} (${pct}% mitigation) from ${who}, applied ${relS(atT.round, appliedMs)}`,
        source: "resolveMitigation (MITIGATION_TABLE components)",
      });
      continue;
    }
    if (!srcIsEnemy && prof.absorbs) {
      items.push({
        ...base,
        kind: "absorb",
        text: `${nm} (absorb, remaining capacity unknown) from ${who}, applied ${relS(atT.round, appliedMs)}`,
        source: "abilityProfile.absorbs",
      });
      continue;
    }
    if (!srcIsEnemy && prof.healingReceivedPct !== undefined) {
      items.push({
        ...base,
        kind: "healing-received-modifier",
        amount: prof.healingReceivedPct,
        text: `${nm} (+${prof.healingReceivedPct}% healing received) from ${who}, applied ${relS(atT.round, appliedMs)}`,
        source: "abilityProfile.healingReceivedPct",
      });
      continue;
    }
    if (!srcIsEnemy) {
      const ticks = heals.filter(
        (h) =>
          h.logLine.event === "SPELL_PERIODIC_HEAL" &&
          String(h.spellId) === iv.spellId &&
          h.srcUnitName === src &&
          h.timestamp >= appliedMs &&
          h.timestamp <= tMs,
      );
      if (ticks.length > 0) {
        const lastTick = ticks[ticks.length - 1]!.timestamp;
        items.push({
          ...base,
          kind: "hot",
          atMs: [appliedMs, ...ticks.map((h) => h.timestamp)],
          text: `${nm} (HoT) from ${who}, applied ${relS(atT.round, appliedMs)}, ${ticks.length} tick(s) observed before t, last ${((tMs - lastTick) / 1000).toFixed(1)} s before t`,
          source:
            "auraIntervals + healIn SPELL_PERIODIC_HEAL (same spell, same source, ≤ t)",
        });
        continue;
      }
    }
    if (srcIsEnemy && ccSpellIds.has(iv.spellId)) {
      items.push({
        ...base,
        kind: "cc-on-owner",
        text: `${nm} (crowd control) on the owner from ${src}, applied ${relS(atT.round, appliedMs)}`,
        source: "ccSpellIds",
      });
      continue;
    }
    unclassified.push(iv.spellId);
  }
  if (unclassified.length)
    items.push({
      phase: "at-t",
      kind: "unclassified",
      status: "unknown",
      text: `${unclassified.length} other aura(s) on the owner not classified by any shared predicate (ids in the ledger)`,
      atMs: [],
      source: "auraIntervals",
    });

  // ── at t: enemy offensive state (amendment 2) ─────────────────────────────
  const attackerIds = [...attackers.keys()];
  const attackerNameSet = new Set(attackerIds.map((id) => nameById.get(id)));
  const seenOff = new Set<string>();
  const pushOffensive = (
    iv: ReturnType<typeof buildAuraIntervals>[number],
    recipient: string,
  ) => {
    if (!OFFENSIVE_CD_SPELL_IDS.has(iv.spellId)) return;
    if (!(iv.fromS <= tRel && iv.toS >= tRel)) return;
    const key = `${iv.spellId}|${iv.srcUnitName}|${recipient}`;
    if (seenOff.has(key)) return;
    seenOff.add(key);
    const appliedMs = atT.round.startTime + iv.fromS * 1000;
    const ageS = Math.round((tMs - appliedMs) / 100) / 10;
    items.push({
      phase: "at-t",
      kind: "enemy-offensive-active",
      status: iv.inferredStart ? "estimated" : "known",
      spellId: iv.spellId,
      srcName: iv.srcUnitName,
      atMs: [appliedMs],
      detail: { recipient, source: iv.srcUnitName, ageS, remaining: null },
      text: `${nameOf(iv.spellId, iv.spellName)} active on ${recipient === ownerAtT.name ? "the owner" : recipient} (from ${iv.srcUnitName}), applied ${ageS} s before t; remaining duration not rendered`,
      source: "auraIntervals (truncated at t) ∩ OFFENSIVE_CD_SPELL_IDS",
    });
  };
  // Only the ENEMY team's own offensive effects on an attacker: our side's
  // offensive debuffs on them (Curse of Weakness, Deathmark…) are in the same
  // canonical union and must not read as "the enemy had burst open".
  const enemyTeamNames = new Set(
    Object.values(fullRound.units)
      .filter((u) => enemyIds.has(playerOf(u.id)))
      .map((u) => u.name),
  );
  for (const aid of attackerIds) {
    const au = atT.round.units[aid];
    if (!au) continue;
    for (const iv of buildAuraIntervals(au, atT.round))
      if (enemyTeamNames.has(iv.srcUnitName)) pushOffensive(iv, au.name);
  }
  for (const iv of buildAuraIntervals(ownerAtT, atT.round)) {
    if (attackerNameSet.has(iv.srcUnitName)) pushOffensive(iv, ownerAtT.name);
  }
  const offensiveCasts = (
    round: Round,
    fromMs: number,
    toMs: number,
    phase: EvidencePhase,
  ) => {
    for (const eid of enemyIds) {
      const eu = round.units[eid];
      if (!eu) continue;
      for (const c of eu.spellCastEvents ?? []) {
        if (
          c.logLine.event !== "SPELL_CAST_SUCCESS" ||
          !OFFENSIVE_CD_SPELL_IDS.has(c.spellId)
        )
          continue;
        if (!(c.timestamp > fromMs && c.timestamp <= toMs)) continue;
        const isAttacker = attackers.has(eid);
        items.push({
          phase,
          kind: "enemy-offensive-cast",
          status: "known",
          spellId: c.spellId,
          srcName: eu.name,
          atMs: [c.timestamp],
          detail: {
            source: eu.name,
            isAttacker,
            ageS:
              phase === "at-t"
                ? Math.round((tMs - c.timestamp) / 100) / 10
                : null,
            atS:
              phase === "window"
                ? Math.round((c.timestamp - tMs) / 100) / 10
                : null,
          },
          text:
            phase === "at-t"
              ? `${eu.name}${isAttacker ? " (attacker)" : ""} cast ${nameOf(c.spellId, c.spellName)} ${Math.round((tMs - c.timestamp) / 100) / 10} s before t — a cast, not proof the effect is still running`
              : `${eu.name}${isAttacker ? " (attacker)" : ""} cast ${nameOf(c.spellId, c.spellName)} at t + ${Math.round((c.timestamp - tMs) / 100) / 10} s — enemy activity, not necessarily aimed at the owner`,
          source: `spellCastEvents SPELL_CAST_SUCCESS ∩ OFFENSIVE_CD_SPELL_IDS (${phase === "at-t" ? "[t − 8 s, t]" : "(t, t + 3 s]"})`,
        });
      }
    }
  };
  offensiveCasts(atT.round, tMs - ENEMY_BURST_LOOKBACK_MS - 1, tMs, "at-t");

  // ── line of sight + distance per identified attacker (amendment 2) ────────
  const zoneId = String(fullRound.startInfo?.zoneId ?? "");
  const zoneNote = !zoneId
    ? "no zone id"
    : MINIMAP_TRACED_ZONES.has(zoneId)
      ? "minimap-derived geometry, accuracy unvalidated"
      : "estimated geometry";
  const losAt = (round: Round, ms: number, phase: EvidencePhase) => {
    const ou = round.units[ownerId]!;
    const oRaw = getUnitRawPositionAtTime(ou, ms, LOS_SWEEP_GAP_MS);
    const oPos = getUnitPositionAtTime(ou, ms, INTERP_MAX_GAP_MS);
    for (const aid of attackerIds) {
      const au = round.units[aid];
      if (!au) continue;
      const aRaw = getUnitRawPositionAtTime(au, ms, LOS_SWEEP_GAP_MS);
      const aPos = getUnitPositionAtTime(au, ms, INTERP_MAX_GAP_MS);
      const los =
        zoneId && oRaw && aRaw ? hasLineOfSight(zoneId, aRaw, oRaw) : null;
      const distance =
        oPos && aPos
          ? Math.round(Math.hypot(aPos.x - oPos.x, aPos.y - oPos.y))
          : null;
      items.push({
        phase,
        kind: "los",
        status: los === null && distance === null ? "unknown" : "estimated",
        srcName: au.name,
        atMs: [],
        detail: { attacker: au.name, los, distance, zoneNote },
        text: `${au.name} → owner at ${phase === "at-t" ? "t" : "t + 3 s"}: line of sight ${los === null ? "unknown" : los ? "open" : "blocked"} (${zoneNote}), distance ${distance === null ? "unknown" : `${distance} yd`}`,
        source: `hasLineOfSight on getUnitRawPositionAtTime (${LOS_SWEEP_GAP_MS} ms) + getUnitPositionAtTime; round truncated at ${phase === "at-t" ? "t" : "t + 3 s"}`,
      });
    }
  };
  losAt(atT.round, tMs, "at-t");

  // ── window: healing received (any caster) ─────────────────────────────────
  const inWin = (ts: number) => ts > tMs && ts <= windowEndMs;
  const healGroups = new Map<
    string,
    {
      amount: number;
      n: number;
      ts: number[];
      spellId: string;
      src: string;
      periodic: boolean;
    }
  >();
  for (const h of ownerWin.healIn ?? []) {
    if (!inWin(h.timestamp) || h.effectiveAmount <= 0) continue;
    const periodic = h.logLine.event === "SPELL_PERIODIC_HEAL";
    const key = `${h.srcUnitName}|${h.spellId}|${periodic}`;
    const g = healGroups.get(key) ?? {
      amount: 0,
      n: 0,
      ts: [],
      spellId: String(h.spellId),
      src: h.srcUnitName,
      periodic,
    };
    g.amount += h.effectiveAmount;
    g.n++;
    g.ts.push(h.timestamp);
    healGroups.set(key, g);
  }
  // Sources under SMALL_HEAL_SHARE of max HP each are collapsed into one line so
  // they cannot bury the real ones; their total still counts. With no max HP
  // reading, nothing is collapsed.
  const SMALL_HEAL_SHARE = 0.02;
  const sortedHeals = [...healGroups.values()].sort(
    (a, b) => b.amount - a.amount,
  );
  const small = maxHp
    ? sortedHeals.filter((g) => g.amount < SMALL_HEAL_SHARE * maxHp)
    : [];
  const smallSummary: EvidenceItem | null =
    small.length > 1
      ? (() => {
          const total = small.reduce((s, g) => s + g.amount, 0);
          return {
            phase: "window",
            kind: "healing",
            status: "known",
            amount: total,
            atMs: small.flatMap((g) => g.ts),
            detail: {
              collapsedSources: small.length,
              pctMaxHp: Math.round((100 * total) / maxHp),
            },
            text: `${k(total)} more healing from ${small.length} smaller sources, each under ${SMALL_HEAL_SHARE * 100}% of max HP (${Math.round((100 * total) / maxHp)}% of max HP combined)`,
            source: "healIn (t, t + 3 s], effective amount",
          };
        })()
      : null;
  const collapsed = new Set(smallSummary ? small : []);
  for (const g of sortedHeals.filter((x) => !collapsed.has(x))) {
    items.push({
      phase: "window",
      kind: "healing",
      status: "known",
      amount: g.amount,
      spellId: g.spellId,
      srcName: g.src,
      atMs: g.ts,
      detail: {
        periodic: g.periodic,
        pctMaxHp: maxHp ? Math.round((100 * g.amount) / maxHp) : null,
        self: g.src === ownerWin.name,
      },
      text: `${k(g.amount)} ${g.periodic ? "periodic" : "non-periodic"} healing from ${nameOf(g.spellId, "")} by ${g.src === ownerWin.name ? "self" : g.src} (${g.n} event(s))${maxHp ? `, ${Math.round((100 * g.amount) / maxHp)}% of max HP` : ""}`,
      source: "healIn (t, t + 3 s], effective amount",
    });
  }
  if (smallSummary) items.push(smallSummary);

  // ── window: damage absorbed on the owner ──────────────────────────────────
  const absorbGroups = new Map<string, { amount: number; ts: number[] }>();
  for (const a of ownerWin.absorbsIn ?? []) {
    if (!inWin(a.timestamp) || !(a.absorbedAmount > 0)) continue;
    const key = a.shieldSpellId ?? a.spellId ?? "?";
    const g = absorbGroups.get(key) ?? { amount: 0, ts: [] };
    g.amount += a.absorbedAmount;
    g.ts.push(a.timestamp);
    absorbGroups.set(key, g);
  }
  for (const [sid, g] of absorbGroups)
    items.push({
      phase: "window",
      kind: "absorbed-damage",
      status: "known",
      amount: g.amount,
      spellId: sid,
      atMs: g.ts,
      text: `${k(g.amount)} damage absorbed by ${nameOf(sid, "")}`,
      source: "absorbsIn (t, t + 3 s]",
    });

  // ── window: relevant auras applied to the owner ───────────────────────────
  for (const a of ownerWin.auraEvents ?? []) {
    if (
      !inWin(a.timestamp) ||
      a.logLine.event !== "SPELL_AURA_APPLIED" ||
      a.destUnitId !== ownerId
    )
      continue;
    const f = functionOf(a.spellId).filter(
      (x) => x !== "damage" && x !== "heals",
    );
    if (f.length === 0 || [...enemyIds].includes(playerOf(a.srcUnitId)))
      continue;
    items.push({
      phase: "window",
      kind: "aura-applied",
      status: "known",
      spellId: a.spellId,
      srcName: a.srcUnitName,
      atMs: [a.timestamp],
      detail: { functions: f, self: a.srcUnitName === ownerWin.name },
      text: `${nameOf(a.spellId, a.spellName)} (${f.join(", ")}) applied by ${a.srcUnitName === ownerWin.name ? "self" : a.srcUnitName} at ${relS(win.round, a.timestamp)}`,
      source: "auraEvents SPELL_AURA_APPLIED (t, t + 3 s]",
    });
  }

  // ── window: owner casts with their official function ──────────────────────
  for (const c of ownerWin.spellCastEvents ?? []) {
    if (!inWin(c.timestamp) || c.logLine.event !== "SPELL_CAST_SUCCESS")
      continue;
    const f = functionOf(c.spellId);
    const tgt =
      c.destUnitName && c.destUnitName !== "nil"
        ? ` → ${c.destUnitId === ownerId ? "self" : c.destUnitName}`
        : "";
    items.push({
      phase: "window",
      kind: "cast",
      status: "known",
      spellId: c.spellId,
      atMs: [c.timestamp],
      detail: {
        functions: f,
        target:
          c.destUnitName && c.destUnitName !== "nil"
            ? c.destUnitId === ownerId
              ? "self"
              : c.destUnitName
            : null,
      },
      text: `cast ${nameOf(c.spellId, c.spellName)}${tgt} at ${relS(win.round, c.timestamp)}${f.length ? ` [${f.join(", ")}]` : " [no official function recorded]"}`,
      source:
        "spellCastEvents SPELL_CAST_SUCCESS (t, t + 3 s] + abilityProfile",
    });
  }

  // ── window: CC landed on an identified attacker ───────────────────────────
  for (const aid of attackers.keys()) {
    const au = win.round.units[aid];
    if (!au) continue;
    for (const a of au.auraEvents ?? []) {
      if (
        !inWin(a.timestamp) ||
        a.logLine.event !== "SPELL_AURA_APPLIED" ||
        !ccSpellIds.has(a.spellId)
      )
        continue;
      if (!friendIds.has(playerOf(a.srcUnitId))) continue;
      items.push({
        phase: "window",
        kind: "cc-on-attacker",
        status: "known",
        spellId: a.spellId,
        srcName: a.srcUnitName,
        atMs: [a.timestamp],
        detail: { target: au.name, self: a.srcUnitName === ownerWin.name },
        text: `${nameOf(a.spellId, a.spellName)} landed on attacker ${au.name} by ${a.srcUnitName === ownerWin.name ? "self" : a.srcUnitName} at ${relS(win.round, a.timestamp)}`,
        source: "auraEvents on attackers, ccSpellIds",
      });
    }
  }

  // ── window: enemy offensive casts and LoS at t + 3 s (amendment 2) ─────────
  offensiveCasts(win.round, tMs, windowEndMs, "window");
  losAt(win.round, windowEndMs, "window");

  // ── window: owner displacement vs attacker displacement ───────────────────
  const posAt = (u: ICombatUnit | undefined, ms: number) =>
    u ? getUnitPositionAtTime(u, ms, INTERP_MAX_GAP_MS) : null;
  const o0 = posAt(ownerAtT, tMs);
  const o1 = posAt(ownerWin, windowEndMs);
  if (!o0 || !o1) {
    items.push({
      phase: "window",
      kind: "movement",
      status: "unknown",
      text: "owner position at t or t + 3 s: no sample within the freshness bound",
      atMs: [],
      source: "advancedActions",
    });
  } else {
    const ownerMoved = Math.hypot(o1.x - o0.x, o1.y - o0.y);
    const parts: string[] = [];
    const attackerMoves: Array<Record<string, unknown>> = [];
    for (const aid of attackers.keys()) {
      const a0 = posAt(atT.round.units[aid], tMs);
      const a1 = posAt(win.round.units[aid], windowEndMs);
      if (!a0 || !a1) {
        parts.push(`${nameById.get(aid) ?? aid}: position unknown`);
        attackerMoves.push({ name: nameById.get(aid) ?? aid, unknown: true });
        continue;
      }
      const d0 = Math.hypot(a0.x - o0.x, a0.y - o0.y);
      const d1 = Math.hypot(a1.x - o1.x, a1.y - o1.y);
      const aMoved = Math.hypot(a1.x - a0.x, a1.y - a0.y);
      attackerMoves.push({
        name: nameById.get(aid) ?? aid,
        d0: Math.round(d0),
        d1: Math.round(d1),
        moved: Math.round(aMoved),
      });
      parts.push(
        `${nameById.get(aid) ?? aid}: distance ${d0.toFixed(0)} → ${d1.toFixed(0)} yd, attacker moved ${aMoved.toFixed(0)} yd`,
      );
    }
    items.push({
      phase: "window",
      kind: "movement",
      status: "estimated",
      amount: ownerMoved,
      atMs: [],
      detail: { ownerMoved: Math.round(ownerMoved), attackers: attackerMoves },
      text: `owner moved ${ownerMoved.toFixed(0)} yd between t and t + 3 s${parts.length ? `; ${parts.join("; ")}` : ""}`,
      source: `getUnitPositionAtTime (freshness ${INTERP_MAX_GAP_MS} ms) on the truncated rounds`,
    });
  }

  return {
    ownerId,
    ownerName: ownerAtT.name,
    tMs,
    tSec,
    windowEndMs,
    items,
    unclassifiedAuraIds: unclassified.sort(),
    untimedStreams: [...new Set([...atT.untimed, ...win.untimed])].sort(),
  };
}

/** Every supporting timestamp within its phase cutoff (at-t ≤ t, window ≤ t + 3 s). */
export function cutoffViolations(e: CrisisAnswerEvidence): EvidenceItem[] {
  return e.items.filter((it) =>
    it.atMs.some((ms) => ms > (it.phase === "at-t" ? e.tMs : e.windowEndMs)),
  );
}

export function renderEvidence(e: CrisisAnswerEvidence): string {
  const lines: string[] = [];
  for (const phase of ["at-t", "window"] as const) {
    lines.push(phase === "at-t" ? "At the crossing:" : "In the next 3 s:");
    for (const it of e.items.filter((x) => x.phase === phase))
      lines.push(`  [${it.status}] ${it.text}`);
  }
  lines.push("No corpus comparison is available for this combined assessment.");
  return lines.join("\n");
}
