/**
 * What a kit entry's `[UNUSED]` tag says beside "never went off this round"
 * (`resourceSnapshot.ts` → `buildPlayerLoadout`):
 *
 *   Hex [15s] [UNUSED — started 2×, never finished]
 *   Fade [20s, lasts 10s] [UNUSED — pressed 3×, refused: under crowd control]
 *   Power Infusion [120s] [UNUSED — pressed 6×, refused: target not in line of sight ×5, under crowd control ×1]
 *
 * `started N×, never finished` (FT-T06) counts cast bars begun
 * (SPELL_CAST_START, any unit). `pressed N×, refused: …` (FT board F09,
 * 2026-10-11) counts SPELL_CAST_FAILED rows — the game refusing a press —
 * which the log writes for its recorder alone, so only the log owner's kit can
 * carry it. A cooldown whose only presses were refused read "never pressed":
 * 605-file slice, 2,245 `[UNUSED…]` entries on the recorder's own kit, 160
 * with at least one such row for that cooldown in the round.
 *
 * Nothing here is a verdict and nothing reads it back: the cooldown stays
 * never spent (`cdNeverSpent`) for every candidate, [RES] and the
 * low-pressure note exactly as before. Only the tag's text changes.
 *
 * Which rows are a press of the cooldown: the ledger's own relation
 * (`isPressOfCooldown`), as for its cast bars (`castBarsOfCooldown`). Which
 * are left out:
 *  - a row whose reason is an interruption (`CAST_INTERRUPTED_REASONS`): the
 *    bar had begun — it is one of `started N×`, not a refused press;
 *  - a row after the round was over for that unit (`untilS`: the round's end
 *    — `roundEndMs` — or the unit's own death, whichever came first): a key
 *    pressed while dead or between rounds is not a press of a button they
 *    had. `[CAST STOPPED]` draws the same line for cast bars.
 * Nothing else is filtered — no count threshold, no key-repeat or
 * global-cooldown exclusion: the cooldown never went off, so no press of it
 * was "the one that then succeeded".
 *
 * The reasons are the product's words, never the client's text (which is in
 * the client's language): `refusalWhy` — the four `[REJECTED]` kinds, "under
 * crowd control" / "silenced", else "client reason not translated" — and
 * `KIT_NOT_READY_WHY` for the "not ready" answer, which `refusalWhy` leaves to
 * its caller.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { NOT_READY_REASONS } from "../analysis/candidates/shared";
import { CAST_INTERRUPTED_REASONS } from "../utils/castCancels";
import { isPressOfCooldown, talentReplacementsOf } from "../utils/cooldowns";
import type { CastFailedEvent } from "../utils/rawStreams";
import {
  REFUSAL_WHY_WORDS,
  refusalWhy,
  REJECT_WHY_BAR_STOPPED,
} from "./spellOutcomeLines";

/** What the note says of a press the client answered "not ready"
 * (`NOT_READY_REASONS`). The client gives that one answer during the global
 * cooldown, under a school lockout and on a cooldown still recovering, and the
 * log does not say which — so neither does the note (the legend says so). */
export const KIT_NOT_READY_WHY = "not ready yet";

/** Every reason a `pressed N×, refused: …` note can print. */
export const KIT_REFUSED_WHY_WORDS: readonly string[] = [
  KIT_NOT_READY_WHY,
  ...REFUSAL_WHY_WORDS.filter((w) => w !== REJECT_WHY_BAR_STOPPED),
];

export interface IKitRefusedPresses {
  /** every refused press of the cooldown the note counts */
  count: number;
  /** by reason, in order of first press */
  reasons: Array<{ why: string; count: number }>;
}

/**
 * The unit's refused presses of cooldown `cd` (`castFailed` is
 * `rawStreams.castFailed`: seconds since the round's start, the recorder's
 * rows only), up to and including `untilS`. null when there is none.
 */
export function kitRefusedPressesOf(
  castFailed: readonly CastFailedEvent[],
  unit: ICombatUnit,
  cd: { spellId: string; spellName: string },
  untilS: number,
): IKitRefusedPresses | null {
  const replacements = talentReplacementsOf(unit);
  const ms = (s: number) => Math.round(s * 1000);
  const reasons: IKitRefusedPresses["reasons"] = [];
  let count = 0;
  const hits = castFailed
    .filter(
      (h) =>
        h.unitGuid === unit.id &&
        h.tSeconds >= 0 &&
        // whole milliseconds, the log's own grid
        ms(h.tSeconds) <= ms(untilS) &&
        !CAST_INTERRUPTED_REASONS.has(h.reason) &&
        isPressOfCooldown(
          {
            spellId: String(h.spellId),
            logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
          },
          cd.spellId,
          cd.spellName,
          replacements,
        ),
    )
    .sort((a, b) => a.tSeconds - b.tSeconds);
  for (const h of hits) {
    const why = NOT_READY_REASONS.has(h.reason)
      ? KIT_NOT_READY_WHY
      : refusalWhy(h.reason);
    const cur = reasons.find((r) => r.why === why);
    if (cur) cur.count++;
    else reasons.push({ why, count: 1 });
    count++;
  }
  return count > 0 ? { count, reasons } : null;
}

/**
 * The text between `[UNUSED` and `]`: "" for neither, else ` — ` and the
 * `started` part, the `pressed` part, or both joined by `; `. A single reason
 * carries no count of its own (it is N).
 */
export function formatKitUnusedNote(
  started: number,
  refused: IKitRefusedPresses | null,
): string {
  const parts: string[] = [];
  if (started > 0) parts.push(`started ${started}×, never finished`);
  if (refused)
    parts.push(
      `pressed ${refused.count}×, refused: ${
        refused.reasons.length === 1
          ? refused.reasons[0]!.why
          : refused.reasons.map((r) => `${r.why} ×${r.count}`).join(", ")
      }`,
    );
  return parts.length > 0 ? ` — ${parts.join("; ")}` : "";
}

/**
 * A kit entry's `[UNUSED…]` tag as `formatKitUnusedNote` writes it, for the
 * gate (`promptQualityCheck`): group 1 = the `started` count; group 2 / 3 =
 * the `pressed` count and its reason list after a `started` part, group 4 / 5
 * = the same when the note has the `pressed` part alone. The closing `]` may
 * be missing: the gate splits the kit on `], `.
 */
export const KIT_UNUSED_NOTE_RE_SRC = String.raw`\[UNUSED(?: — started (\d+)×, never finished(?:; pressed (\d+)×, refused: ([^\]]+))?| — pressed (\d+)×, refused: ([^\]]+))?(?:\]|$)`;

/** Printed once in `<player_loadout>`, when a `pressed N×, refused` note
 * rendered. */
export const KIT_REFUSED_PRESS_LEGEND =
  "  NOTE: `[UNUSED — pressed N×, refused: …]` on your kit = that cooldown never went off this round, but the log has N presses of it that the client refused, for the reasons listed. `not ready yet` is the client's one answer to a press during the global cooldown, under a school lockout and on a cooldown still recovering — the log does not say which, so claim none. `client reason not translated` = a reason this report has no wording for. A key pressed after your death or after the round's end is not counted. The log records refused presses for its recorder alone: an [UNUSED] on anyone else's kit says nothing about presses.";
