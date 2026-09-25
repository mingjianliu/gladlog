/**
 * OBSERVED CONSEQUENCES — `[CONSEQ]` lines (GH #70).
 *
 * User rulings: 2026-09-19 — describe what actually happened, kept separate
 * from causal attribution; 2026-09-24 — ship the kick and healer-CC facts
 * now, "forced" later with GH #69 (agy review concurred: "forced" lines were
 * used 3/37 times without a menu anchor).
 *
 * Two facts, both measurements, never verdicts:
 *  - a healer was kicked → what their teammates' HP did inside the school
 *    lockout (and who died in it);
 *  - a healer was CC'd ≥ HEALER_CC_MIN_S → what their teammates' HP did
 *    inside the CC.
 * Both teams' healers: an enemy healer locked while their DPS dropped is the
 * praise side of the same fact.
 *
 * Every HP number is the `[STATE]` grid reading (`gridHpPct` /
 * `gridHpMinInWindow` on whole render seconds), so a line can never disagree
 * with a `[STATE]` tick for the same unit and second; the gate
 * `checkConseqHpStateConsistency` (promptQualityCheck.ts) re-parses the
 * rendered text against those ticks. The CC instances are the same
 * `analyzePlayerCCAndTrinket` summaries the `[CC ON TEAM]` / `[CC ON ENEMY]`
 * lines render.
 *
 * Probe that justified it (40 rounds × 2 arms, Opus 5.5, blind judge;
 * eval-private runs/2026-09-24-gh70-consequence): consequence sentences
 * 17 → 41, fully supported 6 → 21; the dropped "next completed cast" clause
 * counted auto-cast procs (Shadowy Apparition 0 s after a kick).
 */
import {
  IArenaMatch,
  ICombatUnit,
  IShuffleRound,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  getEnglishSpellName,
  kickLockoutSeconds,
} from "../data/spellEffectData";
import { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import { gridHpMinInWindow, gridHpPct, isHealerSpec } from "../utils/cooldowns";
import { fmtTime } from "../utils/renderGrid";

/** A CC shorter than this is a GCD-sized blip — nothing to report inside it. */
export const HEALER_CC_MIN_S = 2;
/** A teammate's drop is named only from this many HP points (start → low). */
export const CONSEQ_DROP_MIN_PCT = 10;

export const CONSEQ_SECTION_HEADER =
  "OBSERVED CONSEQUENCES — what the log shows happened to a team's HP while its healer was kicked (inside the school lockout) or CC'd. `A% → low B% at m:ss` = that unit's [STATE] reading at the start and its lowest reading inside the span. Measurements, not verdicts: they say what happened, not why the round went the way it did.";

interface Labels {
  friendly: (name: string) => string;
  enemy: (name: string) => string;
}

/**
 * One teammate's HP across a span of whole render seconds: the `[STATE]`
 * reading at `fromSec` and the lowest reading inside `[fromSec, toSec]`.
 * Null when the grid has no sample to read.
 */
export function mateHpAcross(
  mate: ICombatUnit,
  matchStartMs: number,
  fromSec: number,
  toSec: number,
): { h0: number; lo: { pct: number; atSec: number } } | null {
  const h0 = gridHpPct(mate, matchStartMs + fromSec * 1000);
  const lo = gridHpMinInWindow(mate, matchStartMs, fromSec, toSec);
  if (h0 === null || !lo) return null;
  return { h0, lo };
}

/**
 * Did this teammate pay for the healer's CC — the `[CONSEQ]` line's own
 * test: a drop of `CONSEQ_DROP_MIN_PCT` from the CC's first rendered second
 * to its lowest reading inside the CC, or a death inside it. Shared with
 * death-setup `healer-locked` (reliability round 2 W1c), so the menu never
 * says "the healer was CC'd through the kill window" next to a `[CONSEQ]`
 * line saying nobody dropped during that CC (be835950).
 */
export function mateHitDuringCc(
  mate: ICombatUnit,
  matchStartMs: number,
  cc: { atSeconds: number; durationSeconds: number },
): boolean {
  const died = (mate.deathRecords ?? []).some((d) => {
    const s = (d.timestamp - matchStartMs) / 1000;
    return s >= cc.atSeconds && s <= cc.atSeconds + cc.durationSeconds;
  });
  if (died) return true;
  const hp = mateHpAcross(
    mate,
    matchStartMs,
    Math.floor(cc.atSeconds),
    Math.floor(cc.atSeconds + cc.durationSeconds),
  );
  return hp !== null && hp.h0 - hp.lo.pct >= CONSEQ_DROP_MIN_PCT;
}

function teamDrops(
  mates: ICombatUnit[],
  label: (name: string) => string,
  matchStartMs: number,
  fromSec: number,
  toSec: number,
): { parts: string[]; measured: number } {
  const parts: string[] = [];
  let measured = 0;
  for (const mate of mates) {
    const hp = mateHpAcross(mate, matchStartMs, fromSec, toSec);
    if (!hp) continue;
    const { h0, lo } = hp;
    measured++;
    if (h0 - lo.pct >= CONSEQ_DROP_MIN_PCT)
      parts.push(
        `${label(mate.name)} ${Math.round(h0)}% → low ${Math.round(lo.pct)}% at ${fmtTime(lo.atSec)}`,
      );
  }
  return { parts, measured };
}

function diedIn(
  team: ICombatUnit[],
  label: (name: string) => string,
  matchStartMs: number,
  fromS: number,
  toS: number,
): string {
  const died = team.filter((u) =>
    u.deathRecords.some((d) => {
      const s = (d.timestamp - matchStartMs) / 1000;
      return s >= fromS && s <= toS;
    }),
  );
  return died.length
    ? `; died inside it: ${died.map((u) => label(u.name)).join(", ")}`
    : "";
}

export function formatObservedConsequences(params: {
  combat: IArenaMatch | IShuffleRound;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  friendlyCC: IPlayerCCTrinketSummary[];
  enemyCC: IPlayerCCTrinketSummary[];
  labels: Labels;
}): string[] {
  const { combat, friends, enemies, friendlyCC, enemyCC, labels } = params;
  const start = combat.startTime;
  const entries: { atS: number; line: string }[] = [];
  const sideOf = (u: ICombatUnit) =>
    friends.some((f) => f.id === u.id)
      ? { team: friends, label: labels.friendly, who: "friendly healer" }
      : { team: enemies, label: labels.enemy, who: "enemy healer" };

  // 1) A healer kicked → the team's HP inside the school lockout.
  const healers = [...friends, ...enemies].filter((u) => isHealerSpec(u.spec));
  const byId = new Map(healers.map((u) => [u.id, u]));
  const seen = new Set<string>();
  for (const unit of Object.values(combat.units ?? {}) as ICombatUnit[]) {
    for (const a of unit.actionOut ?? []) {
      if (a.logLine.event !== LogEvent.SPELL_INTERRUPT) continue;
      const victim = byId.get(a.destUnitId);
      if (!victim) continue;
      const key = `${a.timestamp}|${a.destUnitId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = (a.timestamp - start) / 1000;
      if (t < 0) continue;
      const lockS = kickLockoutSeconds(String(a.spellId ?? ""));
      const { team, label, who } = sideOf(victim);
      const from = Math.floor(t);
      const to = Math.floor(t + lockS);
      const mates = team.filter((m) => m.id !== victim.id);
      const { parts, measured } = teamDrops(mates, label, start, from, to);
      const died = diedIn(mates, label, start, t, t + lockS);
      if (!measured && !died) continue;
      const stopped =
        a.extraSpellId !== undefined
          ? getEnglishSpellName(a.extraSpellId, a.extraSpellName ?? "")
          : "a cast";
      const body = parts.length
        ? parts.join(", ")
        : `no teammate dropped ${CONSEQ_DROP_MIN_PCT}% or more`;
      entries.push({
        atS: t,
        line: `${fmtTime(t)}  [CONSEQ]   ${who} ${label(victim.name)} kicked (${stopped}; ${lockS}s school lockout) → inside the lockout: ${body}${died}`,
      });
    }
  }

  // 2) A healer CC'd → the team's HP inside the CC.
  const unitByName = new Map([...friends, ...enemies].map((u) => [u.name, u]));
  for (const summary of [...friendlyCC, ...enemyCC]) {
    const healer = unitByName.get(summary.playerName);
    if (!healer || !isHealerSpec(healer.spec)) continue;
    const { team, label, who } = sideOf(healer);
    const mates = team.filter((m) => m.id !== healer.id);
    for (const cc of summary.ccInstances) {
      if (cc.durationSeconds < HEALER_CC_MIN_S) continue;
      const from = Math.floor(cc.atSeconds);
      const to = Math.floor(cc.atSeconds + cc.durationSeconds);
      const { parts, measured } = teamDrops(mates, label, start, from, to);
      const died = diedIn(
        mates,
        label,
        start,
        cc.atSeconds,
        cc.atSeconds + cc.durationSeconds,
      );
      if (!measured && !died) continue;
      const body = parts.length
        ? parts.join(", ")
        : `no teammate dropped ${CONSEQ_DROP_MIN_PCT}% or more`;
      entries.push({
        atS: cc.atSeconds,
        line: `${fmtTime(cc.atSeconds)}  [CONSEQ]   ${who} ${label(healer.name)} in ${cc.spellName} for ${cc.durationSeconds.toFixed(0)}s → during it: ${body}${died}`,
      });
    }
  }

  if (entries.length === 0) return [];
  entries.sort((x, y) => x.atS - y.atS);
  return [CONSEQ_SECTION_HEADER, ...entries.map((e) => e.line)];
}
