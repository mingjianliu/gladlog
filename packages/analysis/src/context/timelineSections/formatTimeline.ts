/**
 * Sort and format — the time-stable sort of every entry, the NOTABLE STATES
 * summary, the MATCH TIMELINE legends (each conditional on what actually
 * rendered), the per-second lines, and the [RES] zero-loss pruning shared with
 * the eval gate. The last step of buildMatchTimeline; its return value is the
 * timeline text.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { backlashCcTag } from "../../data/backlashCc";
import {
  DEATH_WINDOW_S,
  TIMELINE_LINE_FLAGS,
} from "../../data/timelineLineFlags";
import {
  DEFERRAL_ROLE_TAG,
  HP_SAMPLE_RADIUS_MS,
  HP_TROUGH_MIN_DROP_PTS,
} from "../../utils/cooldowns";
import {
  ENEMY_DEF_DEFLECTS_WORDS,
  ENEMY_DEF_END_NOT_LOGGED,
  ENEMY_DEF_NO_PRESS_TAG,
  ENEMY_DEF_UNSEEN_PRESS_TAG,
  selfSaveReductionNames,
} from "../../utils/enemyDefensives";
import { ROUND_ENDED_WORDS, roundEndLegend } from "../../utils/roundEnd";
import { selfDefensiveLabelLegends } from "../../utils/selfDefensiveMechanism";
import {
  BURST_ANSWERED_CONTROL_LEGEND,
  BURST_ANSWERED_LEGEND,
} from "../burstAnswered";
import { CD_PRIOR_LEGEND } from "../cdPrior";
import { PRESSED_DURING_NOTE_HEAD } from "../controlRejectedPresses";
import {
  dmgSpikeListLegend,
  formatDmgSpikesNotListed,
  ROT_PRESSURE_LEGEND,
} from "../matchTimelineSections";
import { NO_CREDITED_SPIKE_CLAUSE } from "../peakSpikePlacement";
import { pruneZeroLossResRows } from "../resLedgerPrune";
import {
  RES_FORBEARANCE_RE_SRC,
  RES_HYPOTHERMIA_RE_SRC,
} from "../resourceSnapshot";
import { STACKED_DEFENSIVES_LEGEND } from "../stackedDefensives";
import {
  buildKillSequenceBlock,
  buildMatchEndBlock,
  HEALING_BLOCK_LEGEND,
  OWN_AURA_CLAUSE_LEGEND,
  OWN_AURA_CLAUSE_PREFIX,
  TOP_SOURCE_MIXED_SCHOOL_LEGEND,
  TOP_SOURCE_MIXED_SCHOOL_RE,
} from "../timelineHelpers";
import { CAST_STOPPED_LEGEND, CAST_STOPPED_TAG } from "./castStopped";
import { DR_CLASH_LEGEND } from "./contextFacts";
import type { TimelineCtx } from "./ctx";
import { CC_NOT_LANDED_LEGEND, CC_NOT_LANDED_TAG } from "./setup";

/** A [STATE] tick carrying a `unit:ghost` token (`state.ts`). */
const STATE_GHOST_TOKEN_RE = /\[STATE\].*:ghost\b/;
/** A [STATE] tick line as `state.ts` emits it: `0:21  [STATE]   friends …`. */
const STATE_TICK_LINE_RE = /^\d+:\d{2}\s+\[STATE\]\s/;

/**
 * The `[STATE]` legend (FT-T03, user ruling 2026-10-10, decision D7 — the
 * "say it plainly" half). No line of the prompt defined `[STATE]` before:
 * other legends only pointed at it. Three things the tick does not say by
 * itself, each measured on the 605-file capture (T03-notes):
 *  - WHEN the number was read: it is the sample nearest `m:ss.000`
 *    (`gridHpPct`), while every event line under the same `m:ss` is floored
 *    there from somewhere in `[m:ss.000, +1 s)` — so the events of a second
 *    come AFTER its tick. 7.9 % of printed readings sat 10+ points above the
 *    lowest reading inside their own second, mostly this one-second offset;
 *  - that a missing unit is not a statement of full health: a unit at 100 %
 *    and a unit with no sample within `HP_SAMPLE_RADIUS_MS` are both left
 *    out (27 % of the left-out living units were the second kind);
 *  - that the `enemies` half is printed only inside a pressure window.
 * The readings themselves do not move — this is wording only. The notes'
 * optional `unit:?` token is deliberately NOT implemented.
 */
export const STATE_LEGEND = [
  `  [STATE] \`m:ss … unit:N\` = that unit's HP % at the START of second m:ss (the last log reading at or before m:ss.0; with none in the ${HP_SAMPLE_RADIUS_MS / 1000} s before it, the first one after). The other lines`,
  "    printed under the same `m:ss` happen during that second, AFTER the tick: a hit or a heal inside it is not in the tick's",
  "    number. A later tick shows where the unit ended up; a `low N%` on a window line is the lowest point in between.",
  `    A unit missing from a printed half is at full health or has no HP reading within ${HP_SAMPLE_RADIUS_MS / 1000} s of that second — not necessarily at`,
  "    100%. `unit:dead` = the unit died during second m:ss or before it: the second a unit dies in reads dead from its start, so",
  "    a line under that same second from before the death (a press, a hit) can still show the unit alive with HP left.",
  "    A tick with no `enemies` half says nothing about the enemies.",
];

export function formatTimeline(
  ctx: Pick<
    TimelineCtx,
    | "entries"
    | "shapeshiftIntervals"
    | "owner"
    | "pid"
    | "silenceLineCount"
    | "disarmLineCount"
    | "trinketLastUsedCount"
    | "gripLineCount"
    | "resOutOfReachRows"
    | "enemyTrinketCount"
    | "enemyCdRender"
    | "isHealer"
    | "burstAnsweredEntries"
    | "cdPriorEntries"
    | "stackedDefensiveEntries"
    | "drClashEntries"
    | "procLinesEmitted"
    | "ownerSpec"
    | "matchStartMs"
    | "matchEndSeconds"
    | "friends"
    | "enemies"
    | "ownerCDs"
    | "teammateCDs"
    | "enemyCDTimeline"
    | "ccTrinketSummaries"
    | "friendlyDeaths"
    | "enemyDeaths"
    | "actorLabel"
    | "playerIdMap"
    | "enemyIdMap"
    | "summonOwners"
    | "unitNames"
    | "rosterSides"
    | "allUnits"
    | "matchEndMs"
    | "bracket"
    | "enemyPid"
    | "pressureWindowsNotListed"
  >,
): string {
  const {
    entries,
    shapeshiftIntervals,
    owner,
    pid,
    silenceLineCount,
    disarmLineCount,
    trinketLastUsedCount,
    gripLineCount,
    resOutOfReachRows,
    enemyTrinketCount,
    enemyCdRender,
    isHealer,
    burstAnsweredEntries,
    cdPriorEntries,
    stackedDefensiveEntries,
    drClashEntries,
    procLinesEmitted,
    ownerSpec,
    matchStartMs,
    matchEndSeconds,
    friends,
    enemies,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    friendlyDeaths,
    enemyDeaths,
    actorLabel,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    allUnits,
    matchEndMs,
    bracket,
    enemyPid,
    pressureWindowsNotListed,
  } = ctx;

  entries.sort((a, b) => a.timeSeconds - b.timeSeconds);

  // D4 (user ruling 2026-10-10): the windows the [DMG SPIKE] cap dropped,
  // counted in one line under the legend sentence that states the cap.
  const dmgSpikesNotListedLine = formatDmgSpikesNotListed({
    notListed: pressureWindowsNotListed ?? [],
    matchEndSeconds,
    pid,
  });

  const summaryLines: string[] = [];
  if (shapeshiftIntervals.length > 0) {
    summaryLines.push("## NOTABLE STATES");
    for (const { player, intervals } of shapeshiftIntervals) {
      const bearTime = intervals
        .filter((i) => i.form === "Bear")
        .reduce((acc, i) => acc + (i.endSeconds - i.startSeconds), 0);
      const catTime = intervals
        .filter((i) => i.form === "Cat")
        .reduce((acc, i) => acc + (i.endSeconds - i.startSeconds), 0);
      const pLabel = player.id === owner.id ? "YOU" : pid(player.name);

      if (bearTime > 0)
        summaryLines.push(
          `- ${pLabel} spent ${Math.round(bearTime)}s in Bear Form.`,
        );
      if (catTime > 0)
        summaryLines.push(
          `- ${pLabel} spent ${Math.round(catTime)}s in Cat Form.`,
        );
    }
    if (summaryLines.length > 1) {
      summaryLines.push("");
    } else {
      summaryLines.length = 0; // Empty if no valid times found
    }
  }

  // F-C3 (triage res-readiness): the `(no mana a/b)` tag on a [RES] `rdy:`
  // entry is legended only when a row carries it (snapshots are resolved to
  // strings above).
  const noManaRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes("(no mana ")),
  );
  const RES_FORBEARANCE_RE = new RegExp(RES_FORBEARANCE_RE_SRC);
  // FT-T04: `cd:Divine Shield(Forbearance Ns)` is legended only when a row
  // carries it (the same convention).
  // FT-T10: `unit:ghost` is legended only when a [STATE] tick carries it.
  const ghostRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && STATE_GHOST_TOKEN_RE.test(l)),
  );
  // FT-T03 (ruling D7): the tick's own legend, whenever a tick is printed
  const stateRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && STATE_TICK_LINE_RE.test(l)),
  );
  const forbearanceRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && RES_FORBEARANCE_RE.test(l)),
  );
  // FT F22: `cd:Ice Block(Hypothermia Ns)`, the same convention
  const RES_HYPOTHERMIA_RE = new RegExp(RES_HYPOTHERMIA_RE_SRC);
  const hypothermiaRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && RES_HYPOTHERMIA_RE.test(l)),
  );
  // FT F22: a `Top sources` entry summed over an ability's spell ids names
  // every school its damage came in — legended when one is printed.
  const mixedSchoolSourceRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && TOP_SOURCE_MIXED_SCHOOL_RE.test(l),
    ),
  );
  // FT F22: an enemy's dispel-backlash silence renders as [SILENCE] with
  // the backlash tag (`ccOnEnemy.ts`); the tag is legended when one does.
  const backlashSilenceLineRendered = entries.some((e) =>
    e.lines.some(
      (l) =>
        typeof l === "string" &&
        l.includes("  [SILENCE]   ") &&
        l.includes(backlashCcTag("silence")),
    ),
  );
  // FT F01: the deferral role tag on a press line (Time Dilation) is
  // legended only when a line carries it.
  const deferralTagRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && l.includes(`[${DEFERRAL_ROLE_TAG}]`),
    ),
  );
  // F-C16 (triage res-readiness): the `next spike in Ns on X` suffix on
  // [YOU] [CD] lines is hindsight — legend it whenever one is rendered. It
  // follows the dampening note (`, next spike in`) or, where no dampening is
  // stated (a 2v2 round that logged no stack), opens the clause itself
  // (` | next spike in`).
  const nextSpikeRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && /(?:,| \|) next spike in /.test(l),
    ),
  );
  // …and its `in <1s` form (`fmtWholeSeconds`: the spike's first hit under
  // half a second after the press — it printed `in 0s`) is explained only
  // where a line carries it.
  const nextSpikeSubSecondRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && /(?:,| \|) next spike in <1s /.test(l),
    ),
  );
  // B18 (user ruling 2026-10-06): the Guardian Spirit save clause is
  // legended only when a press line carries it.
  const guardianSaveRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && l.includes(" | save triggered "),
    ),
  );
  // B20a (user ruling 2026-10-06/07): the Touch of Karma feed clause is
  // legended only when a line carries it.
  const karmaFeedRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes(" | fed by")),
  );
  // FT-T16 (D13): the owner's refused presses on a control line are legended
  // only when a line carries the clause.
  const pressedDuringRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && l.includes(PRESSED_DURING_NOTE_HEAD),
    ),
  );
  // FT-T16 D15 "2b" / "3b": the two tags are legended only when a line of
  // the family rendered.
  const castStoppedRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes(CAST_STOPPED_TAG)),
  );
  const ccNotLandedRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes(CC_NOT_LANDED_TAG)),
  );
  // 2026-10-11: which instant "the round ended" is, said once — when a line
  // of the timeline says the round ended (`ROUND_ENDED_WORDS`).
  const roundEndStatedRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes(ROUND_ENDED_WORDS)),
  );
  // B13e (user ruling 2026-10-07): the purgeable-buff count is legended only
  // when a line carries it.
  const purgeableCountRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes(" purgeable buff")),
  );
  // FT-T15 M5: two line families that had no definition at all — legended
  // only when a line of the family rendered (the convention above).
  const healingBlockRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes("[HEALING]")),
  );
  // FT-T15 ④: the "also on you" clause is legended only when a line carries it.
  const ownAuraClauseRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && l.includes(OWN_AURA_CLAUSE_PREFIX),
    ),
  );
  const rotPressureRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes("[ROT PRESSURE]")),
  );
  // F-C5b (triage res-readiness, ruling A′16): "UP" means usable at that
  // instant, which the bare word does not say — legend it when rendered.
  const interruptNoteRendered = entries.some((e) =>
    e.lines.some(
      (l) =>
        typeof l === "string" &&
        (l.includes(" | enemy interrupts UP: ") ||
          l.includes(" | no enemy interrupt usable (")),
    ),
  );
  // The `[ENEMY DEF]` lines as rendered — which mechanism labels the legend
  // has to explain (user ruling 2026-10-11).
  const enemyDefLines = entries.flatMap((e) =>
    e.lines.filter(
      (l): l is string => typeof l === "string" && l.includes("[ENEMY DEF]"),
    ),
  );
  const outputLines: string[] = [
    ...summaryLines,
    "MATCH TIMELINE",
    "  Units: M = Million damage (1,000,000), k = Thousand damage (1,000)",
    // 2026-07-18 baseline: two independent responders read [DR: Full] backwards
    // as "fully diminished / CC useless" — one legend line disambiguates it
    // (Full = no DR = full duration = the best moment to land CC).
    "  [DR: <category> <level>] on CC lines = diminishing returns state when it LANDED:",
    "    Full = NO diminishing returns yet (full duration — the best time to land CC);",
    "    50% = duration reduced to half; Immune = DR'd to zero.",
    // 2026-07-20 eval: 9/50 matches were judged "notation without a legend" —
    // the same notation could be read with the opposite meaning. The four lines
    // below each address one ambiguity the judge cited.
    "  [n/m] after a spell = CHARGES REMAINING / total (so [1/2] = one charge left, one on cooldown); `[a–b/m]` =",
    "    a to b charges left on a cooldown combat shortens.",
    // Class D (2026-07-20 eval): the ledger did not list Lay on Hands while
    // DEATHS WITH MISSED OPTIONS said it was available — the judge read this as
    // two judgements contradicting each other. In fact the ledger simply does
    // **not track** that ability (1 cast across a thousand-match corpus, no
    // empirical basis for tracking it), and "not listed" was indistinguishable
    // from "not available".
    "  [RES] lists TRACKED major cooldowns (plus your own interrupt and Death Grip) — an ability absent from both `rdy:` and `cd:`",
    "    is one this ledger does not track, NOT one that was unavailable. Other sections may still cite it.",
    ...(resOutOfReachRows > 0
      ? [
          "  On the [RES] row under a friendly [DEATH], a positional cooldown (Darkness: it covers only a small area around its",
          "    caster) whose holder stood out of its reach of the dying player is left out of `rdy:` — it was off cooldown, but",
          "    could not have covered them from there; never count it as an unused save for that death.",
        ]
      : []),
    // WO6 #6 (n34, 9e9f9565): the row is read at its floored second (GH #63)
    // — "at that instant" let a press 0.33 s later read as made inside it
    "  [RES] = the ledger at its second m:ss: a press anywhere in that second is already spent on it (the row printed under a press shows that press on cooldown), while a cooldown coming back later in that second is not yet ready on it.",
    "    `cc:N/<spell>-Rs` = friendly N was under that control then, about R s of it left (`[stun]` a stun, `[trinketed]` a stun",
    "    they pressed a PvP trinket within 1 s of, `[root]` a root — they could still cast, `[disarm]` a disarm, `[kick]` a school",
    "    lockout); several are comma-separated.",
    "  [RES] rdy: = abilities READY then. `rdy:Δ` = unchanged since the previous [RES];",
    // res-readiness F-C3 (ruling res R2 = A): off cooldown, but not payable —
    // legended only when a row carries the tag (the F-C16 convention)
    ...(noManaRendered
      ? [
          "    `X(no mana a/b)` = X is off cooldown but your mana (a) was below its cost (b) at that second — not pressable as it stood.",
          "    The tag is printed where X is listed: a full `rdy:` row or the `Δ` row where X came back. A later `Δ` row that",
          "    does not list X says nothing about its mana.",
        ]
      : []),
    "    a leading `-<spell>` marks one that just LEFT the ready set. `cd:<spell>(Ns)` = seconds until it returns.",
    // GH #106 step 3: cooldowns combat shortens (rage spent, resets, procs)
    // print a range — the static number is only the latest they can return.
    "    `cd:<spell>(a–Ns)` = a cooldown that combat shortens: back in a to N s. `cd:<spell>(≤Ns)` = back in at",
    "    most N s and it MAY ALREADY BE BACK — never state that such a spell was certainly unavailable.",
    ...(forbearanceRendered
      ? [
          "    `cd:<spell>(Forbearance Ns)` = <spell> is off cooldown, but its holder is under Forbearance for N more seconds and",
          "    cannot press it until then.",
        ]
      : []),
    ...(hypothermiaRendered
      ? [
          "    `cd:<spell>(Hypothermia Ns)` = <spell> is off cooldown, but its holder is under Hypothermia for N more seconds and",
          "    cannot press it until then.",
        ]
      : []),
    // GH #99 item 5: a bare `rdy:Δ  cd:—` row survives only when it states a
    // fact no other line does (resLedgerPrune.ts); tell the reader so an
    // absent ledger row is not misread as "nothing was tracked here".
    "  A `rdy:Δ  cd:—` row is printed only when it carries a fact no other line states (a focus target no",
    "    surviving [RES] shows, a CC no [CC ON …] line covers at that second, an enemy CD with no [ENEMY CD] line);",
    "    a `rdy:Δ  cd:—` row whose facts are all stated elsewhere is omitted, so its absence means nothing changed.",
    ...(stateRendered ? STATE_LEGEND : []),
    // FT-T15 ②: the bounds are toRenderSecond (floor) of a window that starts
    // on a damage event, and A / B are sampled on those whole seconds — the
    // reading the [STATE] tick prints (the gate re-checks exactly that).
    "  [DMG SPIKE] `START–END` = the window's bounds in whole seconds (each rounded down; the damage is summed over the",
    "    unrounded window); its `A% -> B% HP` = the [STATE] readings of those two seconds.",
    // FT-T03 (user ruling 2026-10-10, D7): the low is a trough — the true
    // minimum, off the grid.
    `    \`low N% @m:ss\` = the lowest HP the log shows for that unit anywhere inside the window, at the second it happened — printed when it is ${HP_TROUGH_MIN_DROP_PTS}+ points`,
    "    under both A and B. It is the true minimum between the ticks, so it can sit below every [STATE] number of that window.",
    // T12 ① c (user ruling 2026-10-10): a bucket closes at its victim's
    // death / the round's end — the line no longer always reads `in 10s`.
    "    A window is 10 s, cut short where that unit died (`B` then reads 0%) or the round ended.",
    // D4 (user ruling 2026-10-10): the list is capped (signed 2026-08-23,
    // unchanged) — say so, by the ranking the selection uses, and count what
    // the cap dropped this round.
    dmgSpikeListLegend(),
    ...(dmgSpikesNotListedLine ? [dmgSpikesNotListedLine] : []),
    // FT-T02d / T02b: one stated definition of the spike's total.
    "    Its `N in Ks` = the health that unit lost to hits in the window plus what its shields absorbed (`(X absorbed)` is",
    "    that part). Damage a Time Dilation / Stretch Time held back counts when it lands (a `deferred …` source), not as absorbed.",
    ...(mixedSchoolSourceRendered ? [TOP_SOURCE_MIXED_SCHOOL_LEGEND] : []),
    // A21 (user ruling 2026-09-30): HP on press lines is read at the press
    // (worded without the literal line tags: tests and scans find press
    // lines by their tag)
    "  HP printed on your own press lines (the lines tagged [YOU]) — `(self: N% HP …)`, `→ X (N% HP …)`, `lowest ally N% HP`,",
    "    `(N% HP)` — is that unit's HP at the moment of the press (just before the press's own heal), not the [STATE]",
    "    reading of that second; the two can differ, and inside one second the press value is the one to quote about the press.",
    "    The `at N% HP` inside a cooldown line's unnecessary-press note is the same press reading — on your own lines",
    "    and on a teammate's cooldown line alike.",
    ...(deferralTagRendered
      ? [
          `  \`[${DEFERRAL_ROLE_TAG}]\` after a cooldown's name = it does not heal: while it is up, part of each hit on that unit is`,
          "    held back and lands later as that unit's own periodic damage (the `deferred …` sources, `+Dk deferred`).",
        ]
      : []),
    "  Window durations `(Ns)` are computed from the displayed start/end timestamps, so they always match what you see.",
    // GH #24 (2026-08-30): roots carry no DR and are not hard CC; a [ROOT]
    // line appears only when the rooted player could not reach anyone.
    "  [ROOT] = a root that left its target unable to reach anyone (melee: no enemy in melee range; healer: a damaged",
    "    ally out of range/LoS; ranged: no enemy in range/LoS) for the stated seconds — only such roots are listed; roots",
    "    that changed nothing are omitted. Roots have no DR tier and are not hard CC (the rooted player can still cast).",
    "  [OFFENSIVE WINDOW] `X on <unit>` = damage DEALT TO that unit (it is the victim, not the dealer);",
    "    its `peak spike` figure covers the spike's own sub-window, printed after it — not the whole offensive window.",
    // T12 ③ (user ruling 2026-10-10): which spike a header names —
    // `creditSpikesToWindows`, re-run by checkOffensiveWindowSpikeCredit.
    "    Each listed [DMG SPIKE] is credited to ONE offensive window — the one its sub-window overlaps longest on the displayed",
    "    seconds (the earlier window on a tie) — and never to a window it does not overlap; `peak spike` = the largest one credited",
    "    to this window. `(runs past window)` = that sub-window ends after the offensive window; it can also begin before it — read",
    `    the printed bounds. \`${NO_CREDITED_SPIKE_CLAUSE}\` = none of this timeline's [DMG SPIKE] lines overlaps the window, or the`,
    "    one that does overlaps another window longer — a statement about the listed lines, not that no damage landed.",
    "    The full [RES] row under an [OFFENSIVE WINDOW] header = what your team had ready at the whole second the window opened (a press of your team's inside that second is already spent on it);",
    "    the opener itself, pressed inside that second, is on the header's `CDs:` list and may be missing from that row's `enemy:` column.",
    ...(TIMELINE_LINE_FLAGS.enemyDef === "timeline"
      ? [
          "  [ENEMY DEF] = an enemy pressed a defensive at that second: `(N%, Ts)` = official damage reduction (with the",
          "    caster's own talents where the log shows them) and the OBSERVED duration in this round;",
          // Ruling D6 (2026-10-10): what stands there when the log has no end.
          `    \`${ENEMY_DEF_END_NOT_LOGGED}\` in place of Ts = the log never shows that aura end (an enemy who goes invisible takes the`,
          "    line with them) — how long it lasted is unknown: it is NOT the full duration, and the unit may have been hit seconds later.",
          "    `immune` = full immunity, or the unit could not be hit while it lasted (Burrow, Time Stop, Mass Invisibility, Vanish);",
          `    \`${ENEMY_DEF_DEFLECTS_WORDS}\` = Aspect of the Turtle: no immunity — attacks and spells aimed at the unit are deflected, damage already ticking on it lands;`,
          "    `immune to magic` / `immune to physical` = an immunity to those schools only — the other school still hits (Cloak of Shadows, Blessing of Protection, Blessing of Spellwarding);",
          "    `(absorb Nk, Ts)` = a shield, not an immunity — the unit can still be hit; Nk = what it absorbed while up (no",
          "    figure = the log shows none; a bare `(absorb)` states the mechanism only). `(heal proc)` = Nature's Guardian",
          "    healed its owner; `(cheat-death proc)` = Cheat Death / Cauterize refused a killing blow — passives nobody pressed,",
          "    and the unit can still be hit. KILL ATTEMPTS counts an `immune` line as a forced immunity (an `immune to …` one only against a go in its schools), names the three procs",
          "    `self-saved (X)` and words a unit's own press of anything else here `popped X`.",
          "    An aura that ended before its full duration says why when the log does: `— dispelled by X's Spell` /",
          "    `— stolen by …`, `— ended at death` / `— its target died`, `— used up, absorbed Nk` / `— used up` (an absorb eaten through);",
          "    `— removed early` = it ended early and the log gives no cause (cancelled, broken or replaced);",
          `    \`${ENEMY_DEF_NO_PRESS_TAG}\` = the aura went up with no press of it in the log — a copy a talent or proc put up (Exhilaration's 3 s`,
          "    Survival of the Fittest, Ancient of Lore), or a shield that rides another press (Shield of Vengeance with Divine Protection);",
          "    a copy's length is its own, so it never reads `— removed early` on length alone.",
          `    \`${ENEMY_DEF_UNSEEN_PRESS_TAG}\` = pressed while the unit was out of the log's sight (the press row is lost); the line stands where`,
          "    the log showed the aura again, the latest the press can have been.",
          "    `— still up when the round ended` = the round ended before it did;",
          "    `— its bolts hit X: Nk of the Mk damage they took over it` = a save that is a channel whose damage landed on our",
          "    player X (Ultimate Penitence; several units, largest first): Nk = what the channel dealt X, landed plus absorbed;",
          "    Mk = everything X took while it ran; `(its cast row names Y)` = the cast row's target was someone else — the log",
          "    shows where the damage went, not whether the channel was re-aimed;",
          "    `X → unit` = an external put on that unit; one with no duration is an instant heal (Lay on Hands) or a grip /",
          "    redirect (Leap of Faith, Intervene, Roar of Sacrifice, Master's Call); `(area)` = an area save pressed at that",
          "    second (Anti-Magic Zone, Darkness, Rallying Cry, Spirit Link Totem, Power Word: Barrier) — who was inside it is not stated. Absent = not pressed.",
          // User ruling 2026-10-11: a label says what the ability DOES, never
          // why it was pressed (it read `(self-save)`); each label form is
          // explained only when a line carries it (`selfDefensiveLabelLegends`).
          // A pressed self defensive that prints a percentage (Roar of
          // Sacrifice, 2026-10-11) has the wall's form and is no wall: its
          // own entry says so, by name (`selfReductionLegend`).
          "    Any other word in that parenthesis = what the ability does, from the game's data — not why it was pressed, and not",
          "    that it saved anyone.",
          ...selfDefensiveLabelLegends(
            enemyDefLines,
            selfSaveReductionNames(),
          ).map((l) => `    ${l}`),
          "    `[friendly offensive CD active]` indicates at least one friendly offensive cooldown was active at the instant of the press.",
          "    `(at N% HP)` / `(target at N% HP)` reflects the target's HP at the press (just before the press's own",
          "    heal), not the [STATE] reading of that second.",
          ...(TIMELINE_LINE_FLAGS.duringExternal === "annotate"
            ? [
                "    `| during it: A Nk on target · X% of their enemy-player damage · direct/periodic · damage in K of M s` = what each",
                "    friendly who had hit that unit in the 3 s before the external kept doing while it was up — from the aura going up to its removal (damage on it, share of",
                "    their damage on enemy players, seconds with damage; `(+Ak absorbed)` = eaten by the target's shields;",
                "    `+Dk deferred` = held back by a Time Dilation / Stretch Time on the target — it lands later as that unit's",
                "    own damage; for a school-limited wall, how much of it was in the wall's school; `N hits immune` = hits the",
                "    target was immune to).",
                "    A measurement, not a verdict — the team's CC lines say whether they could act.",
              ]
            : []),
        ]
      : []),
    ...(ghostRendered
      ? [
          "  `unit:ghost` on a [STATE] line = that priest is in Spirit of Redemption form at that second (pressed, or the",
          "    on-death proc): the form has no HP reading, so none is printed.",
        ]
      : []),
    ...(silenceLineCount > 0
      ? [
          "  [SILENCE] = that player was silenced from that second for the stated time: no spell a silence stops — most spells;",
          "    the abilities the game data marks as not stopped by a silence (many melee strikes, forms, some defensives and",
          "    racials) still go out (the [CC ON TEAM] / [CC ON ENEMY] lines do not include silences). `trinket broke this silence` =",
          "    a PvP trinket ended it early.",
          ...(backlashSilenceLineRendered
            ? [
                `    \`${backlashCcTag("silence").trim()}\` on it = the silence a dispel of that debuff puts on the player who dispelled it.`,
              ]
            : []),
        ]
      : []),
    ...(disarmLineCount > 0
      ? [
          "  [DISARM] = a disarm on a player of your team: weapon abilities are locked, spells are not. `trinket broke this disarm` = a PvP trinket ended it early.",
        ]
      : []),
    ...(gripLineCount > 0
      ? [
          "  [GRIP] = an enemy Death Knight's Death Grip on that player: it is pulled to the Death Knight at that second. A",
          "    displacement with no control aura, so it is on no [CC ON TEAM] line; `did not land (…)` = the pull failed.",
        ]
      : []),
    // B4a (user ruling 2026-10-06): the clause states where the cooldown
    // went; the guard is part of the ruling ("不得据此说饰品交早了")
    ...(trinketLastUsedCount > 0
      ? [
          "  `trinket: ON CD (Ns left; last used m:ss on X)` = when that player's PvP trinket was last pressed and the control or",
          "    disarm it broke (no `on X` = the log ties no control to that press). It says where the cooldown went, nothing",
          "    more: never write from it that the trinket was used too early, wasted or should have been saved — breaking a",
          "    control to keep a burst or a heal going is a normal use.",
        ]
      : []),
    ...(pressedDuringRendered
      ? [
          "  `| pressed during it: X ×N` on a [CC ON TEAM] / [SILENCE] line of yours = you pressed X (one of your `<cooldowns>`) N",
          "    times while that control was on you, and the game refused every one of those presses because of the control —",
          "    nothing was cast. A press refused only because X was still on cooldown is not counted. The log records refused",
          "    presses for you alone: a teammate's line never carries the clause, whatever they pressed.",
        ]
      : []),
    // one definition of "the round ended" for every line that says it
    ...(roundEndStatedRendered ? roundEndLegend(bracket) : []),
    ...(castStoppedRendered ? CAST_STOPPED_LEGEND : []),
    ...(ccNotLandedRendered ? CC_NOT_LANDED_LEGEND : []),
    ...(guardianSaveRendered
      ? [
          "  `| save triggered Ns later (m:ss)` on a Guardian Spirit line = at m:ss the buff absorbed a hit that would have",
          "    killed its target and healed it (`healed Nk` = what reached that target; absent when the log shows none). A",
          "    Guardian Spirit line without the clause logged no such save.",
        ]
      : []),
    ...(purgeableCountRendered
      ? [
          "  `N purgeable buffs on it then` / `1 of N purgeable buffs on it` (purge and missed-purge lines) = how many Magic buffs a",
          "    purge could remove were on that enemy at that moment, the named one included (raid buffs count). A purge removes",
          "    ONE of them and the player does not pick which: with N on the target, one press takes a given buff about 1 time",
          "    in N. Read a missed purge, and a purge that took the buff you wanted, with that in mind.",
        ]
      : []),
    ...(karmaFeedRendered
      ? [
          "  `| fed by …` on a Touch of Karma line = your team's damage that Touch of Karma absorbed (it sends damage back onto",
          "    the player the monk cast it on). Per player: only damage from spells PRESSED 1 s or more after it went up — a",
          "    lower bound, the log ties a hit to a press only by spell; `DoTs already ticking` = ticks of effects applied",
          "    before that; `pressed before that` = hits of spells pressed before then (a cast under way, a ground effect or",
          "    missile already out — nothing left to hold back); `procs / auto-attacks / pets` = what has no press at all. The",
          "    four add up to `absorbed Nk in all`. `sent back` = Karma damage that landed, and on whom. A fact about where",
          "    the damage went — not a verdict on anyone.",
        ]
      : []),
    ...(enemyTrinketCount > 0
      ? [
          "  [ENEMY TRINKET] = an enemy used PvP trinket; `out of <spell> (by <source>)` indicates breaking out of that CC.",
          "    `used <ability>` in place of `PvP trinket` = a racial press (Will to Survive, Will of the Forsaken, Stoneform and",
          "    Fireblood also lock the trinket for 30–60 s; Escape Artist locks nothing) or a class ability (Blink, Berserker",
          "    Shout, Icebound Fortitude …) that removed that CC.",
          "    `[friendly offensive CD active]` indicates at least one friendly offensive cooldown was active at the instant of the press.",
          "    `(target at N% HP)` reflects the target's HP at the press, not the [STATE] reading of that second.",
        ]
      : []),
    // F-C2 (triage res-readiness): the cast ordinal has its own notation
    ...(enemyCdRender.ordinalRendered
      ? [
          "  `(cast k of N)` on [ENEMY CD] / [ENEMY HEAL CD] / [ENEMY UTILITY] = the k-th of N casts of that spell this round (not charges).",
        ]
      : []),
    // FT-T06: an effect a talent triggers is not a cast
    ...(enemyCdRender.procRendered
      ? [
          "  `(proc k of N[, with X])` on [ENEMY CD] = an effect a talent triggers: it has no button and no cooldown of its",
          "    own; `with X` = the cast it came with. It is still a burst effect on that unit.",
        ]
      : []),
    // corpusFactScan hiddenPressUnused: a press made while the enemy was unseen
    ...(enemyCdRender.unseenRendered
      ? [
          `  \`${ENEMY_DEF_UNSEEN_PRESS_TAG}\` on [ENEMY CD] / [ENEMY HEAL CD] = pressed while the enemy was out of the log's sight (the press row is lost); the line stands where the log showed its aura again, the latest the press can have been.`,
        ]
      : []),
    // fact1215 C7: an enemy's utility press, a fact line only
    ...(enemyCdRender.utilityRendered
      ? [
          "  [ENEMY UTILITY] = an enemy pressed a utility cooldown (Champion's Spear, Smoke Bomb, Tremor Totem, …): when it",
          "    was pressed, nothing more. It is not an offensive burst or a defensive and opens no [OFFENSIVE WINDOW].",
        ]
      : []),
    // F-E8 (A26 = A): the healer throughput tag, outside the burst windows
    ...(enemyCdRender.healCdRendered
      ? [
          "  [ENEMY HEAL CD] = an enemy healer pressed a major healing / throughput cooldown (Divine Hymn, Apotheosis,",
          "    Avenging Crusader, …); it is not an offensive burst and opens no [OFFENSIVE WINDOW].",
        ]
      : []),
    ...(nextSpikeRendered
      ? [
          "  `next spike in Ns on X` on a [YOU] [CD] line = the next damage spike after that press, known only in hindsight —",
          `    the player could not see it coming.${
            nextSpikeSubSecondRendered
              ? " `in <1s` = its first hit landed within half a second of the press."
              : ""
          }`,
        ]
      : []),
    ...(interruptNoteRendered
      ? [
          "  `enemy interrupts UP: X` on a channeled [YOU] [CD] line = enemy kicks that were off cooldown AND usable at that",
          "    instant (the kicker alive and not in a cast-blocking CC); `no enemy interrupt usable (CC'd: X)` = off cooldown,",
          "    but the kicker was crowd-controlled or silenced right then.",
        ]
      : []),
    ...(healingBlockRendered ? HEALING_BLOCK_LEGEND : []),
    ...(ownAuraClauseRendered ? OWN_AURA_CLAUSE_LEGEND : []),
    ...(rotPressureRendered ? ROT_PRESSURE_LEGEND : []),
    // F-C17 (triage res-readiness): the per-cast lines come from the healer
    // gap filler only, so only a healer owner gets their legend.
    ...(isHealer && TIMELINE_LINE_FLAGS.deathWindowUnfold === "perCast"
      ? [
          `  [YOU] [CAST] lines inside the ${DEATH_WINDOW_S}s before a friendly death are printed per cast with the target's HP`,
          "    at the press, even for spells that are folded `(xN over Ns)` elsewhere; the fold still counts them.",
        ]
      : []),
    ...(isHealer && TIMELINE_LINE_FLAGS.deathWindowUnfold === "summary"
      ? [
          `  [YOU] [HEALS] = every cast you made in the ${DEATH_WINDOW_S}s before a friendly death, counted by spell and target.`,
        ]
      : []),
    // Conditional: a round with no such line pays no tokens for its legend.
    ...(burstAnsweredEntries.length > 0 ? BURST_ANSWERED_LEGEND : []),
    ...(burstAnsweredEntries.some((e) => e.namesControlTarget)
      ? [BURST_ANSWERED_CONTROL_LEGEND]
      : []),
    ...(cdPriorEntries.length > 0 ? CD_PRIOR_LEGEND : []),
    ...(stackedDefensiveEntries.length > 0 ? STACKED_DEFENSIVES_LEGEND : []),
    ...(drClashEntries.length > 0 ? DR_CLASH_LEGEND : []),
    ...(procLinesEmitted
      ? [
          "[PROC] = an automatically applied effect (a passive or a talent-replaced button); no button of ITS OWN was pressed at that second. `(with X)` = it went out in the same millisecond as that player's press of X, as it did again and again this round (Radiant Glory's Avenging Wrath with Wake of Ashes) — its timing is X's press; without it, it is never a timing or choice to judge. `(cheat-death proc)` = Cauterize / Cheat Death refused a killing blow on that player — a passive, not a press, and they could still be hit.",
        ]
      : []),
    "",
    `[PERSPECTIVE: Log Owner - ${ownerSpec}]`,
    `(You are the ${ownerSpec} in this match. Your actions and effects on you are marked with [YOU].)`,
    "",
  ];
  for (const entry of entries) {
    outputLines.push(...(entry.lines as string[]));
  }

  outputLines.push(
    ...buildKillSequenceBlock({
      matchStartMs,
      matchEndSeconds,
      owner,
      friends,
      enemies: enemies ?? [],
      ownerCDs,
      teammateCDs,
      enemyCDTimeline,
      ccTrinketSummaries,
      friendlyDeaths,
      enemyDeaths,
      isHealer,
      pid,
      actorLabel,
      playerIdMap,
      enemyIdMap,
      summonOwners,
      unitNames,
      rosterSides,
      allUnits,
    }),
  );

  outputLines.push(
    ...buildMatchEndBlock({
      matchStartMs,
      matchEndMs,
      matchEndSeconds,
      bracket,
      owner,
      friends,
      enemies: enemies ?? [],
      friendlyDeaths,
      enemyDeaths,
      pid,
      enemyPid,
    }),
  );

  // GH #99 item 5 (user ruling 2026-09-22): drop the no-change [RES] rows
  // whose every fact the surviving text already states — same predicate the
  // eval gate `checkResNoChangeRowsPruned` re-applies to the rendered prompt.
  return pruneZeroLossResRows(outputLines).join("\n");
}
