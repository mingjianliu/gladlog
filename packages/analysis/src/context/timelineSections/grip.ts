/**
 * [GRIP] (B-tier B17b-U8, user ruling 2026-10-06) — an enemy's Death Grip on
 * a player of our team. A grip is a displacement with no control aura, so it
 * was on no line at all: 7d1f14af 0:46 (the owner gripped), 2c6e85ec 1:51
 * (the healer gripped) — the prompt named Death Grip only in a legend. It
 * explains where the player suddenly stood; it is a fact line, nothing is
 * judged from it.
 *
 * `gripLineCount` is threaded like the other legend counters: the caller
 * passes its current value and assigns back the returned one (the [GRIP]
 * legend needs > 0).
 */
import { LogEvent } from "@gladlog/parser-compat";

import { fmtTime } from "../../utils/renderGrid";
import { DEATH_GRIP_ID } from "../resUtilityCds";
import type { TimelineCtx } from "./ctx";

/** A SPELL_MISSED row of the grip sits within this of its cast row. */
const GRIP_MISS_PAIR_MS = 200;

export function emitGripEntries(
  ctx: Pick<
    TimelineCtx,
    | "friends"
    | "enemies"
    | "matchStartMs"
    | "pid"
    | "actorLabel"
    | "addEntry"
    | "gripLineCount"
  >,
): Pick<TimelineCtx, "gripLineCount"> {
  const { friends, enemies, matchStartMs, pid, actorLabel, addEntry } = ctx;
  // threaded: read from ctx, returned to the caller (GH #116)
  let { gripLineCount } = ctx;

  const friendById = new Map(friends.map((f) => [f.id, f]));
  for (const dk of enemies ?? []) {
    for (const c of dk.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (c.spellId !== DEATH_GRIP_ID) continue;
      const victim = friendById.get(c.destUnitId ?? "");
      if (!victim) continue;
      const castMs = c.logLine.timestamp;
      const at = (castMs - matchStartMs) / 1000;
      // a grip the target was immune to (or that missed) moved nobody
      const miss = (victim.missesIn ?? []).find(
        (m) =>
          m.spellId === DEATH_GRIP_ID &&
          m.srcUnitId === dk.id &&
          Math.abs(m.timestamp - castMs) <= GRIP_MISS_PAIR_MS,
      );
      const tail = miss ? ` — did not land (${miss.missType})` : "";
      if (
        addEntry(
          at,
          `${fmtTime(at)}  [GRIP]   ${pid(victim.name)} ← Death Grip (by ${actorLabel(dk.name, "enemy", dk.id)})${tail}`,
        )
      )
        gripLineCount++;
    }
  }
  return { gripLineCount };
}
