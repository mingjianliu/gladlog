/**
 * roundEnd.ts — when a round ends, for everything that pairs an event with a
 * removal or a later event (triage 2026-09-29: CROSS-THEME §3 "Round end").
 *
 * A Solo Shuffle round is over at its first player death; the log keeps going
 * until `ARENA_MATCH_END` (the next round's prep, the scoreboard). A CC that
 * was still up then paired with a removal logged after it and printed its
 * full length (ba8c0510: a Polymorph that ran 0.6 s in the round read "6s" and
 * an uncleansed window), and healer activity logged after it closed a healing
 * gap that never was. Leaf module: `ccTrinketAnalysis`, `dispelAnalysis`,
 * `healingGaps` and the candidate layer all read it.
 */

/** The bracket whose rounds end at their first player death, as
 * `startInfo.bracket` spells it — and as the prompt's header prints it
 * (`Bracket: Rated Solo Shuffle`), which is how the gate that re-reads a
 * round's end off the prompt (`checkKillWindowWithinRound`) knows the rule
 * applies. */
export const SOLO_SHUFFLE_BRACKET = "Rated Solo Shuffle";

/** What an aura-end line says of an aura the round's end cut (its REMOVED is
 * logged at or after `roundEndMs`, or the log has none and the round ended
 * inside its official length): the `[ENEMY DEF]` duration note, and — F02b —
 * `[BUFF FADED]` and `[ENEMY BUFF END]`, which printed `expired` /
 * `ended early` / a bare end for it. A control line says
 * `CC_STILL_ON_AT_ROUND_END`. Read back by `checkAuraEndWithinRound`. */
export const AURA_STILL_UP_AT_ROUND_END = "still up when the round ended";

/**
 * The words every timeline line that states the round's end carries — one
 * instant, `roundEndMs`, whatever the line: `still up when the round ended`
 * (`AURA_STILL_UP_AT_ROUND_END`: `[BUFF FADED]`, `[ENEMY BUFF END]`,
 * `[ENEMY DEF]`), `still on them when the round ended, Ns in` (the control
 * lines, `CC_STILL_ON_AT_ROUND_END`), `still channeling when the round
 * ended`, `no end logged; the round ended …` (`[CAST STOPPED]`), `not
 * released before the round ended` (Stasis). What the legend's presence test
 * (`formatTimeline`) and the gate (`checkAuraEndWithinRound`) key on; a unit
 * test holds each phrase to it.
 */
export const ROUND_ENDED_WORDS = "the round ended";

/**
 * The legend sentence that says — once — which instant "the round ended" is
 * on every line that says it, printed when a timeline line carries
 * `ROUND_ENDED_WORDS` (2026-10-11). `roundEndMs`'s rule in words: a Solo
 * Shuffle round is over at its first player death (the log runs on: a
 * round's `endTime` is at most that death + 2 s — the `[MATCH END]` line is
 * 2 s after the first `[DEATH]` line in 1,993 of the 605 capture's 2,395
 * Solo Shuffle prompts, 0–1 s in 399 — and its units keep the lines that
 * follow); any other bracket ends where its log does.
 *
 * Before it the prompt showed two: `[ENEMY DEF] … (Ns — still up when the
 * round ended)` counted to the LOG's end while `[BUFF FADED]` /
 * `[ENEMY BUFF END]` / the control lines stopped at the death — 360 of the
 * 432 such `[ENEMY DEF]` lines of the 605-file capture's Solo Shuffle rounds
 * end outside the death's second.
 */
export function roundEndLegend(bracket: string | undefined): string[] {
  return bracket === SOLO_SHUFFLE_BRACKET
    ? [
        "  `the round ended` on any line (`still up …`, `still on them …`, `still channeling …`, `no end logged; …`) = one instant:",
        "    this Solo Shuffle round's first player death — the round is over there, though the log can run a couple of seconds",
        "    on (a round with no death: the end of the log).",
      ]
    : [
        // not the bracketed tag: readers find the MATCH END line by it
        "  `the round ended` on any line (`still up …`, `still on them …`, `still channeling …`, `no end logged; …`) = one instant:",
        "    the end of the log, the second the timeline's last line (MATCH END) prints.",
      ];
}

/** Solo Shuffle only: the round-ending (first) player death, epoch ms, or
 * undefined for other brackets / a round with no player death. The one
 * definition behind `afterShuffleRoundEnd` and the owner gate's round-end
 * clip (moved here from candidateFindings.ts, which re-exports it). */
export function shuffleRoundEndMs(
  combat: { startInfo?: { bracket?: string } } | undefined,
  units: ReadonlyArray<{
    info?: unknown;
    deathRecords?: ReadonlyArray<{ timestamp?: number }>;
  }>,
): number | undefined {
  if (combat?.startInfo?.bracket !== SOLO_SHUFFLE_BRACKET) return undefined;
  let firstDeathMs = Infinity;
  for (const u of units) {
    if (!u.info) continue;
    for (const d of u.deathRecords ?? [])
      firstDeathMs = Math.min(firstDeathMs, d.timestamp ?? 0);
  }
  return Number.isFinite(firstDeathMs) ? firstDeathMs : undefined;
}

/**
 * The round's end, epoch ms: a Solo Shuffle round's ending death, else the
 * combat's end (`ARENA_MATCH_END`). `units` defaults to `combat.units` — the
 * round's every unit, players filtered by `info`. The one round end of cc-dr
 * F-CI1 (`[CC ON TEAM]` / `[CC ON ENEMY]` windows), missed-cleanse F-C3
 * (uncleansed windows) and cc-dr F-HG1 (healing gaps): events at or after it
 * are not in the round.
 */
export function roundEndMs(
  combat: {
    endTime: number;
    startInfo?: { bracket?: string };
    units?: Record<string, unknown> | ReadonlyArray<unknown>;
  },
  units?: ReadonlyArray<{
    info?: unknown;
    deathRecords?: ReadonlyArray<{ timestamp?: number }>;
  }>,
): number {
  const all =
    units ??
    ((combat.units ? Object.values(combat.units) : []) as ReadonlyArray<{
      info?: unknown;
      deathRecords?: ReadonlyArray<{ timestamp?: number }>;
    }>);
  return shuffleRoundEndMs(combat, all) ?? combat.endTime;
}
