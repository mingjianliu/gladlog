/**
 * `[BURST ANSWERED]` — the POSITIVE side of the burst-window work
 * (GH #60 follow-up, user-approved 2026-09-01).
 *
 * This is **not** a candidate and **not** an accusation. It is a descriptive
 * timeline context fact that credits a correct reaction: the enemy opened a
 * burst window, somebody answered it inside the response horizon, and the
 * person under it bottomed out at a stated HP. Nothing here reaches the
 * candidate menu, `mistakes.ts`, or any verdict surface.
 *
 * **One engine, both signs.** Every window this module renders came out of
 * `burstWindowDecisionPoints` with the same `feasible` gate the
 * `slow-defensive-response` candidate uses, and is disqualified from that
 * candidate by exactly the field this one requires (`responded`). So the
 * population that can be credited and the population that can be blamed are
 * complementary halves of one predicate rather than two independent
 * derivations of "was this answered" (CLAUDE.md shared-predicate rule). Which
 * windows earn a line, which answer is credited and in what order they rank
 * are decided on the engine's `gridHpPct` readings (`minHpPct` / `minHpSec`,
 * the `[STATE]` tick's sampler). The bottom the line PRINTS is the engine's
 * trough (`troughHpPct` / `troughHpSec`, `hpTroughInWindow`): the true
 * minimum inside the window, at the second it happened — FT-T03, user ruling
 * 2026-10-10 (D7). `tSec` and both seconds are the ones `fmtTime` displays.
 *
 * **No corpus reference numbers on these lines, deliberately.** The
 * kick-eaten A/B (GH #34) showed per-line corpus references inflate whatever
 * they touch; a credit line quoting `n=` would be arguing a case. One clause,
 * descriptive, no numbers beyond the facts of the moment itself.
 */
import {
  BURST_RESPONSE_WINDOW_SEC,
  burstExtrasLabel,
  type BurstResponseCast,
  type BurstWindowDecisionPoint,
  type ControlLandingAura,
} from "../analysis/burstWindowDecisionPoints";
import { HEALING_VERDICTS } from "../data/healingVerdicts";
import {
  type IPlayerCCTrinketSummary,
  renderedCcSpan,
} from "../utils/ccTrinketAnalysis";
import { fmtTime } from "../utils/renderGrid";

/** A healing CD whose official effect heals only its caster (Divine
 *  Protection, Exhilaration, Desperate Prayer …). Keyed on the response
 *  CATEGORY `healCd` at the call site, not on this set alone: Guardian Spirit
 *  and Life Cocoon are also `healsOthers:false` but classify as `external`
 *  first (triage sync-burst F-B7). */
function healsOnlyItsCaster(spellId: string): boolean {
  return HEALING_VERDICTS[spellId]?.official.healsOthers === false;
}

export const BURST_ANSWERED_TAG = "[BURST ANSWERED]";

/**
 * At most this many `[BURST ANSWERED]` lines per round.
 *
 * **Volume control is the whole reason this constant exists.** 71.4% of
 * bounded burst windows are answered (GH #60 phase-2 archive scan, 36,649
 * rounds / 68,756 windows), so rendering every one of them would bury the
 * timeline in praise and dilute everything around it. Two is also the cap
 * every sibling producer in this repo uses (`BURST_WINDOW_RESPONSE_CAP`,
 * `crisisNoResponse`) — the number a coach can act on.
 *
 * Selection is by DANGER, not by time: a window somebody died in first, then
 * the lowest grid min HP reached. Emission order is time, the same
 * select-by-danger / emit-by-time split every sibling producer makes.
 */
export const BURST_ANSWERED_CAP = 2;

/**
 * The pressured friendly's grid min HP must have reached at least this low
 * for the window to be worth a credit line.
 *
 * A "you answered that" line about a window where nobody dropped below 60% is
 * noise: nothing was at stake, so nothing was saved, and the sentence teaches
 * the reader that the bar for praise is meaninglessly low. This is
 * deliberately LOOSER than the candidate's own severity door
 * (`CRISIS_HP_PCT_RENDERED` = 40, plus a 15-point drop): a window answered
 * WELL never reaches the crisis line precisely because it was answered, so
 * reusing the accusation's triage would select for the answers that barely
 * worked and hide the ones that worked.
 */
export const BURST_ANSWERED_MAX_HP_PCT = 60;

/** Legend lines, emitted only when at least one `[BURST ANSWERED]` line is.
 * The second one is load-bearing: with `BURST_ANSWERED_CAP` = 2 the list is
 * not exhaustive, and an unqualified list reads as one (the same
 * "only such roots are listed" clause GH #24 had to add to `[ROOT]`). */
export const BURST_ANSWERED_LEGEND = [
  `  ${BURST_ANSWERED_TAG} = an enemy burst window the team DID answer inside ${BURST_RESPONSE_WINDOW_SEC}s — context, not a mistake.`,
  `    At most ${BURST_ANSWERED_CAP} of them are listed per round (the most dangerous first), so this is NOT a full list of answered bursts.`,
  // FT-T03 (ruling D7): the bottom is off the grid
  "    `bottomed at N% at m:ss` = the lowest HP the log shows for that player inside the window, at the second it happened (the true",
  "    minimum between the ticks: it can sit below the [STATE] number of that second).",
];

/** The clause a line ends on when the pressured unit died in the window. */
export const BURST_ANSWERED_STILL_DIED = "still died";

/** One control target as the line prints it: `5(RPaladin)` or
 * `5(RPaladin) (2s)`. */
const CONTROL_TARGET_RE_SRC = String.raw`\S+(?: \([^)]*\))?`;
const BURST_ANSWERED_LINE_RE = new RegExp(
  String.raw`^\s*(\d+):(\d{2})\s+\[BURST ANSWERED\].*: (\S+) answered with (.+?)` +
    String.raw`(?: on (${CONTROL_TARGET_RE_SRC}(?: and ${CONTROL_TARGET_RE_SRC})*))? ` +
    String.raw`(?:in (\d+\.\d)s|(\d+\.\d)s before it opened); ` +
    String.raw`(\S+) bottomed at (\d+)%(?: at (\d+):(\d{2}))?` +
    // `a friendly died inside it` when the dead unit has no name
    String.raw`(?: — (.+?) (${BURST_ANSWERED_STILL_DIED}|died inside it))?$`,
);
export interface ParsedBurstAnsweredLine {
  /** the line's own second (the window's opening) */
  atSec: number;
  answerer: string;
  spellName: string;
  /** a control answer's ` on <target>[ (<span>)][ and …]`; empty otherwise */
  controlOn: Array<{ target: string; span?: string }>;
  /** seconds from the lead cast to the answer, one decimal; negative = before */
  latencySec: number;
  pressured: string;
  /** the line ends on `— <pressured> still died` */
  pressuredDied: boolean;
}
/**
 * A rendered `[BURST ANSWERED]` line (with its `m:ss` prefix) read back — the
 * producer's own reader, for the gates (`promptQualityCheck`), so the wording
 * and its parse cannot drift apart. `latencySec` is negative for
 * `Ns before it opened`. Null for any other line.
 */
export function parseBurstAnsweredLine(
  line: string,
): ParsedBurstAnsweredLine | null {
  const m = line.match(BURST_ANSWERED_LINE_RE);
  if (!m) return null;
  return {
    atSec: Number(m[1]) * 60 + Number(m[2]),
    answerer: m[3]!,
    spellName: m[4]!,
    controlOn: (m[5]?.split(" and ") ?? []).map((t) => {
      const [, target, span] = t.match(/^(\S+)(?: \(([^)]*)\))?$/)!;
      return { target: target!, ...(span !== undefined ? { span } : {}) };
    }),
    latencySec: m[6] !== undefined ? Number(m[6]) : -Number(m[7]),
    pressured: m[8]!,
    pressuredDied: m[13] === BURST_ANSWERED_STILL_DIED && m[12] === m[8],
  };
}

/** One more legend line, emitted only when a rendered line names a control's
 * target (T12 ⑧ i). It states what the clause is and — the point of the
 * ruling — that it is not a judgment of the target. */
export const BURST_ANSWERED_CONTROL_LEGEND =
  "    A control answer names the enemy it landed on and, in brackets, how long it stayed on them (the [CC ON ENEMY] reading; no brackets when the log gives none — a root, an interrupt). What happened, not whether that was the right target.";

export interface BurstAnsweredEntry {
  /** whole second the window opened — already on `fmtTime`'s grid */
  atSeconds: number;
  /** the line WITHOUT its timestamp prefix (the caller adds `fmtTime`) */
  line: string;
  /** the line carries a control's ` on <target>` clause — decides
   * `BURST_ANSWERED_CONTROL_LEGEND` */
  namesControlTarget?: true;
}

/**
 * Which windows earn a line. Exported so a test can pin the gate rather than
 * re-deriving it, and so it reads as one predicate at the call site.
 *
 * `responseCasts.length > 0` is required on top of `responded`: a kite-only
 * answer has no spell and no cast instant, and the sentence's shape ("answered
 * with X in Ns") cannot be written for it. Those windows are silently skipped
 * in v1 rather than rendered in a second wording.
 */
/**
 * The response the line credits: the first one that reached the pressured
 * unit and was still up at its trough (reliability round 3: 4446 credited a
 * Guardian Spirit that went on another unit; 6954 one that expired before the
 * trough). An external must target the pressured unit; a personal wall must
 * be the pressured unit's own; healing CDs and control answer the window as a
 * whole. An effect with a known end must reach the trough second.
 *
 * T12 ⑧ (i) (user ruling 2026-10-10): a response pressed at or after the
 * pressured unit's death — the engine's `afterPressuredDeath`, `isDeadAt` on
 * the raw instants, the UNIT_DIED's own millisecond included — answered
 * nothing for that unit and is never the credited one (483f7433: the warrior
 * died at 1:50.385, Emerald Communion went out at 1:50.636, the line read
 * "answered with Emerald Communion in 5.1s … still died"). With no other
 * creditable response the window gets no line. `responded` — the
 * slow-defensive-response candidate's half — does not read the mark.
 */
export function creditedAnswer(p: BurstWindowDecisionPoint) {
  const pr = p.pressured;
  if (!pr) return undefined;
  return p.responseCasts.find((r) => answersPressured(pr, r));
}

/** `creditedAnswer`'s rule for one response — also asked of the other burst
 * casters the credited control's own press landed on. */
function answersPressured(
  pr: NonNullable<BurstWindowDecisionPoint["pressured"]>,
  r: BurstResponseCast,
): boolean {
  if (r.afterPressuredDeath) return false;
  // an external aimed at another unit went to the wrong unit; an
  // untargeted / ground destination (Spirit Link, Barrier — the empty GUID
  // "0000000000000000") is a group effect and may cover the pressured unit
  // (codex review of batch 8)
  if (
    r.category === "external" &&
    r.destId !== undefined &&
    !/^0+$/.test(r.destId) &&
    r.destId !== pr.unitId
  )
    return false;
  if (
    r.category === "wall" &&
    r.casterId !== undefined &&
    r.casterId !== pr.unitId
  )
    return false;
  // F-B7: a self-only heal CD answers only its caster's own pressure — the
  // wall rule, carried to `healCd` (06bb9860: Qqii's Dark Pact credited for
  // Bumbiing's dip; 3df6ccf8: Shawts' Exhilaration for Invios's).
  if (
    r.category === "healCd" &&
    healsOnlyItsCaster(r.spellId) &&
    r.casterId !== undefined &&
    r.casterId !== pr.unitId
  )
    return false;
  // F-B4: an aimed control pressed before the opener answers it only if it
  // was still on the target when the lead cast went out (95127ab4: the
  // Paralysis was trinketed 0.5 s before the Zenith).
  if (r.category === "control" && r.preOpenerStillUp === false) return false;
  // F-B1: an aimed control that did not land answered nothing (9c6ab747:
  // an Imprison with no aura; 8c5b6ec5: a Hammer of Justice into an
  // immunity; 9d899d10: a reflected Counterspell).
  if (r.category === "control" && r.landed === false) return false;
  if (
    (r.category === "external" || r.category === "wall") &&
    r.effectEndSec !== undefined &&
    pr.minHpSec !== null &&
    r.effectEndSec < pr.minHpSec
  )
    return false;
  return true;
}

/**
 * How long one control application stayed on its target, as the text the
 * `[CC ON ENEMY]` line of that application prints — or undefined when no CC
 * instance carries it (a root, an interrupt, a re-application the CC walk
 * kept inside one window).
 */
export type ControlSpanLookup = (
  unitName: string,
  aura: ControlLandingAura,
) => string | undefined;

/**
 * `ControlSpanLookup` over the summaries the `[CC ON ENEMY]` lines render
 * (`analyzePlayerCCAndTrinket` per enemy). The join is the application
 * itself — same holder, same aura id, same SPELL_AURA_APPLIED instant
 * (`ICCInstance.atSeconds` is that instant) — and the text is the one CC
 * formatter's (`renderedCcSpan` → `renderedCcDuration`), so the credit line
 * and the `[CC ON ENEMY]` line cannot print two lengths for one control.
 */
export function ccSpanLookup(
  enemyCCSummaries:
    | ReadonlyArray<Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">>
    | undefined,
  matchStartMs: number,
): ControlSpanLookup {
  return (unitName, aura) => {
    for (const s of enemyCCSummaries ?? []) {
      if (s.playerName !== unitName) continue;
      const cc = s.ccInstances.find(
        (c) =>
          c.spellId === aura.spellId &&
          Math.abs(matchStartMs + c.atSeconds * 1000 - aura.atMs) < 1,
      );
      if (cc) return renderedCcSpan(cc);
    }
    return undefined;
  };
}

/**
 * T12 ⑧ (i), second half (user ruling 2026-10-10): ` on <target>[ (<span>)]`
 * for a credited CONTROL — who it landed on and for how long; a fact, with no
 * word on whether that was the right target (the notes' second example: an
 * Avatar answered with a Hex on the enemy paladin, broken after 2 s, read
 * "answered with Hex in 1.2s"). Every burst caster the same press landed on
 * is named (an AoE stun on two of them is one answer), each with the span of
 * its own application when the CC walk has one. Empty for any other answer.
 */
function controlTargetClause(
  p: BurstWindowDecisionPoint,
  first: BurstResponseCast,
  enemyLabel: (name: string) => string,
  spanOf: ControlSpanLookup | undefined,
): string {
  if (first.category !== "control" || !first.controlOn) return "";
  const pr = p.pressured!;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const r of p.responseCasts) {
    if (
      r.category !== "control" ||
      !r.controlOn ||
      r.casterName !== first.casterName ||
      r.spellName !== first.spellName ||
      r.latencySec !== first.latencySec ||
      !answersPressured(pr, r) ||
      seen.has(r.controlOn.unitId)
    )
      continue;
    seen.add(r.controlOn.unitId);
    const on = r.controlOn;
    let span: string | undefined;
    for (const a of on.auras) {
      span = spanOf?.(on.unitName, a);
      if (span !== undefined) break;
    }
    parts.push(
      `${enemyLabel(on.unitName)}${span !== undefined ? ` (${span})` : ""}`,
    );
  }
  return ` on ${parts.join(" and ")}`;
}

function isCreditable(p: BurstWindowDecisionPoint): boolean {
  return (
    p.feasible &&
    p.responded &&
    creditedAnswer(p) !== undefined &&
    p.pressured !== null &&
    p.pressured.minHpPct !== null &&
    p.pressured.minHpPct <= BURST_ANSWERED_MAX_HP_PCT
  );
}

/** How a context-fact line names a player: the timeline's roster label
 * (`3(AWarrior)`), resolved by the caller. FT board item (user ruling
 * 2026-10-09): these lines printed raw character names
 * (`Lawrelin-Stormrage-US answered with Dragon's Breath`) while every other
 * line of the timeline used the label — 201 lines in the 60 re-eval prompts.
 * Absent (tests, other callers) = the name as it is. */
export interface ContextFactLabels {
  friendly: (name: string) => string;
  enemy: (name: string) => string;
}

export function formatBurstAnsweredLines(
  points: BurstWindowDecisionPoint[],
  overrides?: { cap?: number },
  labels?: ContextFactLabels,
  /** the length of a control application, read off the `[CC ON ENEMY]`
   * instances (`ccSpanLookup`); absent = targets are named without one */
  controlSpan?: ControlSpanLookup,
): BurstAnsweredEntry[] {
  const friendly = labels?.friendly ?? ((n: string) => n);
  const enemy = labels?.enemy ?? ((n: string) => n);
  const cap = overrides?.cap ?? BURST_ANSWERED_CAP;
  const eligible = points.filter(isCreditable);
  // Danger order — a window somebody died in first, then the deepest HP dip.
  // `anyFriendlyDeath` is the engine's own field (the same predicate the
  // candidate's cap ordering and the corpus reference's death outcome use),
  // not a second death derivation.
  const ranked = [...eligible].sort(
    (a, b) =>
      Number(b.anyFriendlyDeath) - Number(a.anyFriendlyDeath) ||
      (a.pressured!.minHpPct ?? 101) - (b.pressured!.minHpPct ?? 101),
  );
  return ranked
    .slice(0, cap)
    .map((p) => {
      // Only the CDs inside the response horizon this line talks about, each
      // offset from the opener — the same helper as `burstWindowResponseEvents`.
      const extras = burstExtrasLabel(p);
      const extrasPart = extras ? ` (+${extras})` : "";
      const first = creditedAnswer(p)!;
      // Latency is an INTERVAL between two instants, not a grid-anchored
      // instant, so one decimal is legitimate here where a rendered timestamp
      // would have to be floored (the engine already rounds it to 0.1s).
      // It can be negative down to `-BURST_RESPONSE_PRE_MS`: a wall pressed
      // just before the opener is a pre-wall, and "in -0.8s" is not English.
      const when =
        first.latencySec < 0
          ? `${Math.abs(first.latencySec).toFixed(1)}s before it opened`
          : `in ${first.latencySec.toFixed(1)}s`;
      const pressured = p.pressured!;
      // FT-T03: the printed bottom is the trough — the true minimum, not the
      // lowest whole-second tick. The door, the ranking and `creditedAnswer`
      // above keep the grid pair (a line neither appears nor disappears).
      const bottomPct = pressured.troughHpPct ?? pressured.minHpPct;
      const bottomSec = pressured.troughHpSec ?? pressured.minHpSec;
      // Reliability round 3 N4 (483f): a friendly OTHER than the pressured
      // unit died inside the window and the line said nothing — the window
      // read as a clean answer. Same observable-consequence shape as the
      // pressured suffix (GH #70), never a verdict on the answer.
      const otherDeathName =
        !pressured.died && p.anyFriendlyDeath
          ? p.friendlyOutcomes.find((f) => f.died)?.name
          : undefined;
      const otherDeath =
        !pressured.died && p.anyFriendlyDeath
          ? otherDeathName !== undefined
            ? friendly(otherDeathName)
            : "a friendly"
          : null;
      const diedPart = pressured.died
        ? ` — ${friendly(pressured.name)} ${BURST_ANSWERED_STILL_DIED}`
        : otherDeath
          ? ` — ${otherDeath} died inside it`
          : "";
      const onPart = controlTargetClause(p, first, enemy, controlSpan);
      return {
        atSeconds: p.tSec,
        ...(onPart ? { namesControlTarget: true as const } : {}),
        line:
          `${BURST_ANSWERED_TAG}   enemy opened ${p.leadCd.spellName}${extrasPart} ` +
          // the label carries the spec (`4(AWarrior)`); the long form stays
          // only where the caller gave no labels
          `(${labels ? labels.enemy(p.leadCd.casterName) : `${p.leadCd.casterSpec} ${p.leadCd.casterName}`}): ` +
          `${friendly(first.casterName)} answered with ${first.spellName}${onPart} ${when}; ` +
          `${friendly(pressured.name)} bottomed at ${bottomPct}%` +
          // F-B3: the bottom is the minimum over the whole bounded window (up
          // to 55 s) — its second says whether it belongs to this go. The
          // render second of the instant it happened.
          `${bottomSec !== null ? ` at ${fmtTime(bottomSec)}` : ""}${diedPart}`,
      };
    })
    .sort((a, b) => a.atSeconds - b.atSeconds);
}
