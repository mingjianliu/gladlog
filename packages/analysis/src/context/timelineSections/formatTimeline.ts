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
import {
  DEATH_WINDOW_S,
  TIMELINE_LINE_FLAGS,
} from "../../data/timelineLineFlags";
import { BURST_ANSWERED_LEGEND } from "../burstAnswered";
import { CD_PRIOR_LEGEND } from "../cdPrior";
import { pruneZeroLossResRows } from "../resLedgerPrune";
import { STACKED_DEFENSIVES_LEGEND } from "../stackedDefensives";
import { buildKillSequenceBlock, buildMatchEndBlock } from "../timelineHelpers";
import { DR_CLASH_LEGEND } from "./contextFacts";
import type { TimelineCtx } from "./ctx";

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
  } = ctx;

  entries.sort((a, b) => a.timeSeconds - b.timeSeconds);

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
  // F-C16 (triage res-readiness): the `next spike in Ns on X` suffix on
  // [YOU] [CD] lines is hindsight — legend it whenever one is rendered.
  const nextSpikeRendered = entries.some((e) =>
    e.lines.some(
      (l) => typeof l === "string" && l.includes(", next spike in "),
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
  // B13e (user ruling 2026-10-07): the purgeable-buff count is legended only
  // when a line carries it.
  const purgeableCountRendered = entries.some((e) =>
    e.lines.some((l) => typeof l === "string" && l.includes(" purgeable buff")),
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
    "  [RES] rdy: = abilities READY at that instant. `rdy:Δ` = unchanged since the previous [RES];",
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
    // GH #99 item 5: a bare `rdy:Δ  cd:—` row survives only when it states a
    // fact no other line does (resLedgerPrune.ts); tell the reader so an
    // absent ledger row is not misread as "nothing was tracked here".
    "  A `rdy:Δ  cd:—` row is printed only when it carries a fact no other line states (a focus target no",
    "    surviving [RES] shows, a CC no [CC ON …] line covers at that second, an enemy CD with no [ENEMY CD] line);",
    "    a `rdy:Δ  cd:—` row whose facts are all stated elsewhere is omitted, so its absence means nothing changed.",
    "  [DMG SPIKE] `START–END` = the window's exact bounds; its `A% -> B% HP` maps directly to those two timestamps.",
    // FT-T02d / T02b: one stated definition of the spike's total.
    "    Its `N in 10s` = the health that unit lost to hits in the window plus what its shields absorbed (`(X absorbed)` is",
    "    that part). Damage a Time Dilation / Stretch Time only delayed counts when it lands (a `deferred …` source), never as absorbed.",
    // A21 (user ruling 2026-09-30): HP on press lines is read at the press
    // (worded without the literal line tags: tests and scans find press
    // lines by their tag)
    "  HP printed on your own press lines (the lines tagged [YOU]) — `(self: N% HP …)`, `→ X (N% HP …)`, `lowest ally N% HP`,",
    "    `(N% HP)` — is that unit's HP at the moment of the press (just before the press's own heal), not the [STATE]",
    "    reading of that second; the two can differ, and inside one second the press value is the one to quote about the press.",
    "    The `at N% HP` inside a cooldown line's unnecessary-press note is the same press reading — on your own lines",
    "    and on a teammate's cooldown line alike.",
    "  Window durations `(Ns)` are computed from the displayed start/end timestamps, so they always match what you see.",
    // GH #24 (2026-08-30): roots carry no DR and are not hard CC; a [ROOT]
    // line appears only when the rooted player could not reach anyone.
    "  [ROOT] = a root that left its target unable to reach anyone (melee: no enemy in melee range; healer: a damaged",
    "    ally out of range/LoS; ranged: no enemy in range/LoS) for the stated seconds — only such roots are listed; roots",
    "    that changed nothing are omitted. Roots have no DR tier and are not hard CC (the rooted player can still cast).",
    "  [OFFENSIVE WINDOW] `X on <unit>` = damage DEALT TO that unit (it is the victim, not the dealer);",
    "    its `peak spike` figure covers the spike's own sub-window, printed after it — not the whole offensive window; a marker means the spike's sub-window extends past the offensive window (the +5 s allowance).",
    "    The full [RES] row under an [OFFENSIVE WINDOW] header = what your team had ready at the whole second the window opened;",
    "    the opener itself, pressed inside that second, is on the header's `CDs:` list and may be missing from that row's `enemy:` column.",
    ...(TIMELINE_LINE_FLAGS.enemyDef === "timeline"
      ? [
          "  [ENEMY DEF] = an enemy pressed a defensive at that second: `(N%, Ts)` = official damage reduction (with the",
          "    caster's own talents where the log shows them) and the OBSERVED duration in this round; `immune` = full",
          "    immunity, or the unit could not be hit or killed for that moment (Burrow, Time Stop, Mass Invisibility, Vanish,",
          "    Feign Death, a Cheat Death / Cauterize / Nature's Guardian proc) — KILL ATTEMPTS counts each as a forced",
          "    immunity; an aura that ended before its full duration says why when the log does: `— dispelled by X's Spell` /",
          "    `— stolen by …`, `— ended at death` / `— its target died`, `— used up, absorbed Nk` (an absorb eaten through);",
          "    `— removed early` = it ended early and the log gives no cause (cancelled, broken or replaced);",
          "    `— still up when the round ended` = the round ended before it did;",
          "    `X → unit` = an external put on that unit; one with no duration is an instant heal (Lay on Hands) or a grip /",
          "    redirect (Leap of Faith, Intervene, Roar of Sacrifice, Master's Call); `(area)` = an area save pressed at that",
          "    second (Anti-Magic Zone, Darkness, Rallying Cry, Spirit Link Totem, Power Word: Barrier) — who was inside it is not stated. Absent = not pressed.",
          "    `(self-save)` = the enemy's own save that carries no damage reduction — an absorb, a heal or avoidance (Guardian",
          "    Spirit on itself, Desperate Prayer, Touch of Karma, Dark Pact, Evasion, Healthstone, Ice Barrier…) — KILL",
          "    ATTEMPTS `self-saved (X)` names these.",
          "    `[friendly offensive CD active]` indicates at least one friendly offensive cooldown was active at that displayed second.",
          "    `(at N% HP)` / `(target at N% HP)` reflects the target's HP at the press (just before the press's own",
          "    heal), not the [STATE] reading of that second.",
          ...(TIMELINE_LINE_FLAGS.duringExternal === "annotate"
            ? [
                "    `| during it: A Nk on target · X% of their enemy-player damage · direct/periodic · damage in K of M s` = what each",
                "    friendly who had hit that unit in the 3 s before the external kept doing while it was up (damage on it, share of",
                "    their damage on enemy players, seconds with damage; `(+Ak absorbed)` = eaten by the target's shields;",
                "    `+Dk deferred` = only delayed by a Time Dilation / Stretch Time on the target — it lands later as that unit's",
                "    own damage; for a school-limited wall, how much of it was in the wall's school; `N hits immune` = hits the",
                "    target was immune to).",
                "    A measurement, not a verdict — the team's CC lines say whether they could act.",
              ]
            : []),
        ]
      : []),
    ...(silenceLineCount > 0
      ? [
          "  [SILENCE] = that player was silenced from that second for the stated time: no spells (the [CC ON TEAM] / [CC ON ENEMY]",
          "    lines do not include silences). `trinket broke this silence` = a PvP trinket ended it early.",
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
          "    `[friendly offensive CD active]` indicates at least one friendly offensive cooldown was active at that displayed second.",
          "    `(target at N% HP)` reflects the target's HP at the press, not the [STATE] reading of that second.",
        ]
      : []),
    // F-C2 (triage res-readiness): the cast ordinal has its own notation
    ...(enemyCdRender.ordinalRendered
      ? [
          "  `(cast k of N)` on [ENEMY CD] / [ENEMY HEAL CD] = the k-th of N casts of that spell this round (not charges).",
        ]
      : []),
    // FT-T06: an effect a talent triggers is not a cast
    ...(enemyCdRender.procRendered
      ? [
          "  `(proc k of N[, with X])` on [ENEMY CD] = an effect a talent triggers: it has no button and no cooldown of its",
          "    own; `with X` = the cast it came with. It is still a burst effect on that unit.",
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
          "    the player could not see it coming.",
        ]
      : []),
    ...(interruptNoteRendered
      ? [
          "  `enemy interrupts UP: X` on a channeled [YOU] [CD] line = enemy kicks that were off cooldown AND usable at that",
          "    instant (the kicker alive and not in a cast-blocking CC); `no enemy interrupt usable (CC'd: X)` = off cooldown,",
          "    but the kicker was crowd-controlled or silenced right then.",
        ]
      : []),
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
    ...(cdPriorEntries.length > 0 ? CD_PRIOR_LEGEND : []),
    ...(stackedDefensiveEntries.length > 0 ? STACKED_DEFENSIVES_LEGEND : []),
    ...(drClashEntries.length > 0 ? DR_CLASH_LEGEND : []),
    ...(procLinesEmitted
      ? [
          "[PROC] = an automatically applied effect (a passive or a talent-replaced button); no button was pressed at that second, so it is never a timing or choice to judge.",
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
