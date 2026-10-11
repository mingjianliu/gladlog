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
 *  - any owner but the log's recorder: SPELL_CAST_FAILED is written for the
 *    recorder alone, and without it "how it ended" cannot be said.
 *
 * Nothing here is a verdict: no threshold, no "should have". The log does not
 * tell stopping a cast by hand from moving, so the line says neither; and a
 * SPELL_CAST_START row names no target, so neither does the line.
 */
import {
  type CastBarOutcome,
  ownerCastBarOutcomes,
} from "../../utils/castCancels";
import { CANCEL_CC_NEAR_S } from "../../utils/castStopEvidence";
import { JUKE_LOOKBACK_MS } from "../../utils/kickAudit";
import type { CastFailedEvent } from "../../utils/rawStreams";
import { fmtTime } from "../../utils/renderGrid";
import type { IControlCastBar } from "../ccUse";
import { REJECT_WHY, rejectKindOf } from "../spellOutcomeLines";
import type { TimelineCtx } from "./ctx";

/** The tag — also what the legend and the gate
 * (`promptQualityCheck.checkCastStoppedLines`) look for. Not one of
 * `PRESS_HP_LINE_TAGS`: the line prints no HP. */
export const CAST_STOPPED_TAG = "[CAST STOPPED]";

/** What stands for a refusal reason that is not one of the four kinds the
 * product words (`REJECT_WHY`). The client's own text is not quoted: it is in
 * the client's language, and the repo has no reading of "this log is in
 * English" to quote it under. */
export const CAST_REFUSED_OTHER_REASON = "(client reason not translated)";

/** `cast bar stopped after N.Ns` + this, per what landed on the owner within
 * `CANCEL_CC_NEAR_S` of the stop (`CastBarEnd.near`). */
export const CAST_STOPPED_NEAR_TEXT = {
  none: "; not kicked; no control, silence or knockback landed on you then",
  cc: " as a control or silence landed on you",
  displaced: " as an enemy knockback or pull landed on you",
} as const;

/** Printed once, when a `[CAST STOPPED]` line rendered. */
export const CAST_STOPPED_LEGEND = [
  `  ${CAST_STOPPED_TAG} = you began a cast bar of that control at that second and it did not go off, and no enemy kick ended it (a`,
  "    kicked cast is on its [KICK] line). `cast bar stopped after Ns` = the log shows the bar interrupted N s in, with no kick:",
  "    you stopped it or you moved — the log cannot tell which, so claim neither. `as a control or silence landed on you` /",
  `    \`as an enemy knockback or pull landed on you\` = one landed within ${CANCEL_CC_NEAR_S} s of the stop; \`no control, silence or knockback`,
  "    landed on you then` = none did. `refused Ns in: <reason>` = the client failed the cast N s in for that reason",
  `    (\`${CAST_REFUSED_OTHER_REASON}\` = for another reason, which is not printed). \`no end logged; the round ended …\` = the round ended`,
  "    before the log showed how the bar ended. The log names no target for a cast bar, so the line has none. These bars are",
  "    among CC USE's `cast bar started N×`. The log records this for you alone: a teammate's stopped cast bar has no line.",
];

const elapsed = (fromS: number, toS: number) =>
  `${Math.max(0, toS - fromS).toFixed(1)}s`;

/**
 * The text after `<Spell> — `, or null for a bar that gets no line.
 * `roundEndS` = the round's length, `nextBarS` = the owner's next cast bar
 * (any spell). A bar with no end row inside the round, whose window
 * (`ownerCastBarOutcomes`: to the next bar or `JUKE_LOOKBACK_MS`) the round's
 * end cut, says that and nothing about how it ended.
 */
export function castStoppedText(
  o: CastBarOutcome,
  roundEndS: number,
  nextBarS: number | undefined,
  statedByRejected: ReadonlySet<CastFailedEvent>,
): string | null {
  const { end } = o;
  if (end.kind === "none" || end.atS > roundEndS)
    return roundEndS <
      Math.min(o.t + JUKE_LOOKBACK_MS / 1000, nextBarS ?? Infinity)
      ? `no end logged; the round ended ${elapsed(o.t, roundEndS)} after it began`
      : null;
  if (end.kind === "completed" || end.kind === "kicked") return null;
  if (end.kind === "stopped")
    return `cast bar stopped after ${elapsed(o.t, end.atS)}${CAST_STOPPED_NEAR_TEXT[end.near ?? "none"]}`;
  if (statedByRejected.has(end.row)) return null;
  const kind = rejectKindOf(end.row.reason);
  const at = `refused ${elapsed(o.t, end.atS)} in`;
  return kind
    ? `${at}: ${REJECT_WHY[kind]}`
    : `${at} ${CAST_REFUSED_OTHER_REASON}`;
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
    "owner" | "matchStartMs" | "matchEndSeconds" | "rawStreams" | "addEntry"
  > & {
    /** `ownerControlCastBars` of this round (buildMatchContext). */
    controlCastBars: readonly IControlCastBar[];
    /** The SPELL_CAST_FAILED rows the printed `[REJECTED]` lines state. */
    statedByRejected: ReadonlySet<CastFailedEvent>;
  },
): void {
  const {
    owner,
    matchStartMs,
    matchEndSeconds,
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
      matchEndSeconds,
      outcomes[i + 1]?.t,
      statedByRejected,
    );
    if (text === null) return;
    addEntry(o.t, castStoppedLine(o.t, name, text));
  });
}
