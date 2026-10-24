/**
 * `[CAST STOPPED]` — one line per cast bar of a CONTROL the log owner began
 * and that did not go off, saying how the log shows it ended (FT-T16 D15
 * "2b", user approval 2026-10-10 on real-match samples — with a tag of its
 * own: the prototype borrowed `[YOU] [CAST]`, a press line that carries HP):
 *
 *   0:47  [CAST STOPPED]   Cyclone — cast bar stopped after 0.5s; not kicked; no control, silence or knockback landed on you then
 *   0:49  [CAST STOPPED]   Cyclone — refused 0.9s in: vision obscured (Smoke Bomb)
 *
 * 539b6ed0: a Balance Druid began four Cyclone bars, finished none, and the
 * timeline had no line for any of them.
 *
 * Which bars: `ownerControlCastBars` — the bars CC USE's `cast bar started
 * N×` counts, under the same spell name. How a bar ended:
 * `ownerCastBarOutcomes` — the reading `ownerCastCancels` counts cancels
 * with. No line for
 *  - a bar that went off;
 *  - a kicked bar: it has its `[KICK]` line (and stays in `started N×`);
 *  - a bar whose refusing SPELL_CAST_FAILED row a `[REJECTED]` line already
 *    states (`statedByRejected` — one row of the log, one line; the
 *    `[REJECTED]` family, ruling 2026-09-26, is not touched);
 *  - a bar the log has no end row for before the next bar or the cast-bar
 *    cap (`none`), unless the round ended on it;
 *  - a bar the owner's own death ended (`near === "death"`): the `[DEATH]`
 *    line of that second states the death, and the player did not stop the
 *    bar (FT I11 — it read "not kicked; no control, silence or knockback
 *    landed on you then", a cancel);
 *  - a bar begun at or after the round's end (`roundEndMs`: a Solo Shuffle
 *    round is over at its first player death, ~2 s before the log's end of
 *    it) — it is not the round's;
 *  - any owner but the log's recorder: SPELL_CAST_FAILED is written for the
 *    recorder alone, and without it "how it ended" cannot be said.
 *
 * Nothing here is a verdict: no threshold, no "should have". The log does not
 * tell stopping a cast by hand from moving, so the line says neither; and a
 * SPELL_CAST_START row names no target, so neither does the line.
 */
import {
  type CastBarOutcome,
  isCancelInRound,
  ownerCastBarOutcomes,
} from "../../utils/castCancels";
import { CANCEL_CC_NEAR_S } from "../../utils/castStopEvidence";
import { JUKE_LOOKBACK_MS } from "../../utils/kickAudit";
import type { CastFailedEvent } from "../../utils/rawStreams";
import { fmtTime } from "../../utils/renderGrid";
import type { IControlCastBar } from "../ccUse";
import {
  REFUSAL_WHY_WORDS,
  refusalWhy,
  REJECT_WHY_BAR_STOPPED,
  REJECT_WHY_UNWORDED,
} from "../spellOutcomeLines";
import type { TimelineCtx } from "./ctx";

/** The tag — also what the legend and the gate
 * (`promptQualityCheck.checkCastStoppedLines`) look for. Not one of
 * `PRESS_HP_LINE_TAGS`: the line prints no HP. */
export const CAST_STOPPED_TAG = "[CAST STOPPED]";

/** What stands for a refusal reason the product does not word
 * (`refusalWhy` → `REJECT_WHY_UNWORDED`), in brackets. */
export const CAST_REFUSED_OTHER_REASON = `(${REJECT_WHY_UNWORDED})`;

/** The wordings `refused N.Ns in: <reason>` can carry — `refusalWhy`'s, less
 * the two it never prints there: the unworded marker (bracketed instead,
 * `CAST_REFUSED_OTHER_REASON`) and the interruption wording (an
 * interruption row ends the bar as `stopped`, `castBarOutcomes.ts`). The
 * gate (`checkCastStoppedLines`) reads this list (agy 40-FT-90). */
export const CAST_STOPPED_REFUSAL_WORDS: readonly string[] =
  REFUSAL_WHY_WORDS.filter(
    (w) => w !== REJECT_WHY_UNWORDED && w !== REJECT_WHY_BAR_STOPPED,
  );

/** `cast bar stopped after N.Ns` + this, per what landed on the owner within
 * `CANCEL_CC_NEAR_S` of the stop (`CastBarEnd.near`). */
export const CAST_STOPPED_NEAR_TEXT = {
  none: "; not kicked; no control, silence or knockback landed on you then",
  cc: " as a control or silence landed on you",
  displaced: " as an enemy knockback or pull landed on you",
  dodged:
    "; not kicked; an enemy pressed Shadowmeld or Transcendence: Transfer then",
} as const;

/** Printed once, when a `[CAST STOPPED]` line rendered. */
export const CAST_STOPPED_LEGEND = [
  `  ${CAST_STOPPED_TAG} = you began a cast bar of that control at that second and it did not go off, and no enemy kick ended it (a`,
  "    kicked cast is on its [KICK] line). `cast bar stopped after Ns` = the log shows the bar interrupted N s in, with no kick:",
  "    you stopped it or you moved — the log cannot tell which, so claim neither. `as a control or silence landed on you` /",
  `    \`as an enemy knockback or pull landed on you\` = one landed within ${CANCEL_CC_NEAR_S} s of the stop; \`an enemy pressed Shadowmeld or`,
  `    Transcendence: Transfer then\` = one of those, which drop a targeted cast, was pressed within ${CANCEL_CC_NEAR_S} s of it; \`no control, silence or knockback`,
  "    landed on you then` = none did. `refused Ns in: <reason>` = the client failed the cast N s in for that reason",
  `    (\`${CAST_REFUSED_OTHER_REASON}\` = for another reason, which is not printed). \`no end logged; the round ended …\` = the round ended`,
  "    before the log showed how the bar ended. The log names no target for a cast bar, so the line has none. These bars are",
  "    among CC USE's `cast bar started N×`. The log records this for you alone: a teammate's stopped cast bar has no line.",
];

const elapsed = (fromS: number, toS: number) =>
  `${Math.max(0, toS - fromS).toFixed(1)}s`;

/**
 * The text after `<Spell> — `, or null for a bar that gets no line.
 * `roundEndS` = the round's end (`roundEndMs`, in seconds since the match
 * start — a Solo Shuffle round's ending death, else the log's end),
 * `nextBarS` = the owner's next cast bar (any spell). A bar with no end row
 * inside the round, whose window (`ownerCastBarOutcomes`: to the next bar or
 * `JUKE_LOOKBACK_MS`) the round's end cut, says that and nothing about how
 * it ended — an end row at or after the round's end is not the round's
 * (`isCancelInRound`, the ledger's own test, is what keeps "not kicked; no
 * control …" for the bars the ledger counts).
 */
export function castStoppedText(
  o: CastBarOutcome,
  roundEndS: number,
  nextBarS: number | undefined,
  statedByRejected: ReadonlySet<CastFailedEvent>,
): string | null {
  const { end } = o;
  if (o.t >= roundEndS) return null;
  if (end.kind === "none" || end.atS >= roundEndS)
    return roundEndS <
      Math.min(o.t + JUKE_LOOKBACK_MS / 1000, nextBarS ?? Infinity)
      ? `no end logged; the round ended ${elapsed(o.t, roundEndS)} after it began`
      : null;
  if (end.kind === "completed" || end.kind === "kicked") return null;
  if (end.kind === "stopped") {
    if (end.near === "death") return null;
    const near = isCancelInRound(o, roundEndS) ? "none" : end.near;
    // unreachable by construction (a stop before the round's end with
    // nothing near it IS a cancel); no wording is guessed for it
    if (near === null) return null;
    return `cast bar stopped after ${elapsed(o.t, end.atS)}${CAST_STOPPED_NEAR_TEXT[near]}`;
  }
  if (statedByRejected.has(end.row)) return null;
  // the report's words for every reason it has words for (`refusalWhy`,
  // FT-R1014b) — work order 2026-10-14d #8: 2c6e85ec 1:21 Cyclone, raw
  // "Invalid target", still printed "(client reason not translated)"
  const why = refusalWhy(end.row.reason);
  const at = `refused ${elapsed(o.t, end.atS)} in`;
  return why === REJECT_WHY_UNWORDED
    ? `${at} ${CAST_REFUSED_OTHER_REASON}`
    : `${at}: ${why}`;
}

/** The whole line: the second the bar BEGAN, the tag, the spell under its CC
 * USE entry's name, the text. The gate
 * (`promptQualityCheck.checkCastStoppedLines`) re-parses it. */
export function castStoppedLine(
  startS: number,
  entryName: string,
  text: string,
): string {
  return `${fmtTime(startS)}  ${CAST_STOPPED_TAG}   ${entryName} — ${text}`;
}

export function emitCastStoppedEntries(
  ctx: Pick<
    TimelineCtx,
    "owner" | "matchStartMs" | "rawStreams" | "addEntry" | "enemies"
  > & {
    /** The round's end, seconds since `matchStartMs` (`roundEndMs`). */
    roundEndSeconds: number;
    /** `ownerControlCastBars` of this round (buildMatchContext). */
    controlCastBars: readonly IControlCastBar[];
    /** The SPELL_CAST_FAILED rows the printed `[REJECTED]` lines state. */
    statedByRejected: ReadonlySet<CastFailedEvent>;
  },
): void {
  const {
    owner,
    matchStartMs,
    roundEndSeconds,
    rawStreams,
    addEntry,
    controlCastBars,
    statedByRejected,
  } = ctx;
  if (controlCastBars.length === 0) return;
  const outcomes = ownerCastBarOutcomes({
    owner,
    startMs: matchStartMs,
    rawStreams,
    enemies: ctx.enemies,
  });
  if (!outcomes) return;
  // one bar = one SPELL_CAST_START row: its spell id and its instant
  const key = (b: { id: string; t: number }) => `${b.id}|${b.t}`;
  const entryNameOf = new Map(
    controlCastBars.map((b) => [key(b), b.entryName]),
  );
  outcomes.forEach((o, i) => {
    const name = entryNameOf.get(key(o));
    if (name === undefined) return;
    const text = castStoppedText(
      o,
      roundEndSeconds,
      outcomes[i + 1]?.t,
      statedByRejected,
    );
    if (text === null) return;
    addEntry(o.t, castStoppedLine(o.t, name, text));
  });
}
