/**
 * QUICK FOLLOW-UPS — `[FORCED TRINKET]` lines (GH #69 first version).
 *
 * User rulings 2026-09-24: shape ① only — an enemy spent their PvP trinket
 * inside one of our team's kill attempts on them (the GH #70 rule: a trinket
 * inside our attempt counts as forced, no HP gate), and the LOG OWNER's own CC
 * landed on that same enemy right after; the "13 s later" shape and the
 * broader "your CC on their healer while an enemy dropped" shape were not
 * taken. Trinket only for now (no walls / externals). Timeline-only credit,
 * the same channel as [BURST ANSWERED] — not a finding card.
 *
 * codex astra (two rounds) shaped the contract:
 *  - one time predicate on the render grid: the gap is rendered seconds,
 *    floor(CC landing) − floor(trinket), 0 … FORCED_FOLLOWUP_MAX_GAP_S, with
 *    the landing strictly after the trinket; the duration is the [CC ON …]
 *    line's own rounding (`durationSeconds.toFixed(0)`), at least
 *    FORCED_FOLLOWUP_MIN_DUR_S (only to drop an instantly broken CC — the
 *    line states the observed duration, never "full");
 *  - credit is for the follow-up LANDING that fast — not for forcing the
 *    trinket (the team's attempt), not for "seeing it and reacting" (the cast
 *    may have started before the trinket);
 *  - any of the owner's CCs in the window counts, not just the first CC.
 * The trinket times and CC instances are the enemy `analyzePlayerCCAndTrinket`
 * summaries the [ENEMY TRINKET] / [CC ON ENEMY] lines render; the attempts are
 * the same array the [KILL ATTEMPTS] block renders. The timeline keeps the
 * selected CC's [CC ON ENEMY] line (`keepOwnerCcOnEnemy`) even for an owner CC
 * that normally renders on its [YOU] [CC] cast line only: the gate verifies
 * the landing second, target, caster, spell and duration against that aura
 * line, never against the cast line (codex astra implementation review — a
 * cast line cannot show the landing or the duration). The 3 s window is
 * editorial (the gap distribution has no knee; 5 s was the reported
 * alternative).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import type { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import type { IKillAttempt } from "../utils/killAttempts";
import { fmtTime } from "../utils/renderGrid";

/** Rendered seconds from the trinket to the owner's CC landing, at most. */
export const FORCED_FOLLOWUP_MAX_GAP_S = 3;
/** The follow-up's rendered duration (the [CC ON …] line's rounding), at least. */
export const FORCED_FOLLOWUP_MIN_DUR_S = 2;
/** At most this many lines per round. */
export const FORCED_FOLLOWUP_CAP = 1;

/** The rendered gap passes: 0 … FORCED_FOLLOWUP_MAX_GAP_S displayed seconds.
 * Shared with the gate, which re-parses both rendered times. */
export function forcedFollowUpGapOk(
  trinketRenderedS: number,
  ccRenderedS: number,
): boolean {
  const gap = ccRenderedS - trinketRenderedS;
  return gap >= 0 && gap <= FORCED_FOLLOWUP_MAX_GAP_S;
}

/** The rendered duration (the [CC ON …] line's `toFixed(0)`) passes the door. */
export function forcedFollowUpDurOk(renderedDurS: number): boolean {
  return renderedDurS >= FORCED_FOLLOWUP_MIN_DUR_S;
}

/** A rendered second lies inside a rendered attempt span. The producer also
 * requires the raw trinket time inside the raw span, which implies this
 * (floor is monotone) — so the gate's check never rejects a produced line on
 * flooring alone. */
export function renderedInsideSpan(
  s: number,
  fromS: number,
  toS: number,
): boolean {
  return s >= fromS && s <= toS;
}

export const FORCED_TRINKET_SECTION_HEADER = `QUICK FOLLOW-UPS — an enemy used their PvP trinket inside one of your team's kill attempts on them (see [ENEMY TRINKET] and [KILL ATTEMPTS]), and your own CC landed on that same enemy at most ${FORCED_FOLLOWUP_MAX_GAP_S} displayed seconds later (times are shown in whole seconds, so the real gap can be up to just under ${FORCED_FOLLOWUP_MAX_GAP_S + 1} s). Credit the player for the follow-up landing that fast — not for forcing the trinket (that was the team's attempt), not for reacting to it (the cast may have started before the trinket), and not for a "full" CC (the duration shown is what was observed). Never say it caused a kill or a win.`;

export interface IForcedFollowUp {
  targetName: string;
  trinketS: number;
  attemptFromS: number;
  attemptToS: number;
  spellId: string;
  spellName: string;
  ccAtS: number;
  /** As the [CC ON …] line renders it. */
  durationS: number;
}

export function forcedTrinketFollowUps(params: {
  owner: ICombatUnit;
  enemyCC: ReadonlyArray<IPlayerCCTrinketSummary>;
  /** The SAME array the [KILL ATTEMPTS] block renders. */
  killAttempts: ReadonlyArray<IKillAttempt>;
}): IForcedFollowUp[] {
  const { owner, enemyCC, killAttempts } = params;
  const all: IForcedFollowUp[] = [];
  for (const s of enemyCC) {
    for (const t of s.trinketUseTimes) {
      const attempt = killAttempts.find(
        (a) =>
          a.targetName === s.playerName &&
          t >= a.fromSeconds &&
          t <= a.toSeconds &&
          renderedInsideSpan(
            Math.floor(t),
            Math.floor(a.fromSeconds),
            Math.floor(a.toSeconds),
          ),
      );
      if (!attempt) continue;
      const followUps = s.ccInstances
        .filter((cc) => {
          if (cc.sourceName !== owner.name || !(cc.atSeconds > t)) return false;
          return (
            forcedFollowUpGapOk(Math.floor(t), Math.floor(cc.atSeconds)) &&
            forcedFollowUpDurOk(Number(cc.durationSeconds.toFixed(0)))
          );
        })
        .sort((a, b) => a.atSeconds - b.atSeconds);
      const cc = followUps[0];
      if (!cc) continue;
      all.push({
        targetName: s.playerName,
        trinketS: t,
        attemptFromS: attempt.fromSeconds,
        attemptToS: attempt.toSeconds,
        spellId: cc.spellId,
        spellName: cc.spellName,
        ccAtS: cc.atSeconds,
        durationS: Number(cc.durationSeconds.toFixed(0)),
      });
    }
  }
  return all
    .sort(
      (a, b) =>
        a.ccAtS - a.trinketS - (b.ccAtS - b.trinketS) ||
        a.trinketS - b.trinketS,
    )
    .slice(0, FORCED_FOLLOWUP_CAP)
    .sort((a, b) => a.trinketS - b.trinketS);
}

export function formatForcedTrinketFollowUps(
  items: IForcedFollowUp[],
  enemyLabel: (name: string) => string,
): string[] {
  if (items.length === 0) return [];
  const lines = [FORCED_TRINKET_SECTION_HEADER];
  for (const f of items) {
    const target = enemyLabel(f.targetName);
    const gap = Math.floor(f.ccAtS) - Math.floor(f.trinketS);
    lines.push(
      `${fmtTime(f.trinketS)}  [FORCED TRINKET]  ${target} used PvP trinket inside your team's kill attempt [${fmtTime(f.attemptFromS)}–${fmtTime(f.attemptToS)}] on them → ${fmtTime(f.ccAtS)} your ${f.spellName} landed on ${target} ${gap} s later (${f.durationS}s)`,
    );
  }
  return lines;
}
