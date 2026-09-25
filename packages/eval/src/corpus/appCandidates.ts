/**
 * The candidate menu exactly as the app builds it: extractCandidateFindings
 * WITH the round's raw streams (SPELL_CAST_FAILED + mana, parsed straight
 * from the log text by `parseRawStreams`).
 *
 * Reliability audit E1 (user ruling 2026-09-25 「嗯」): eval paths called
 * extractCandidateFindings(legacy, ownerId) without the optional third
 * argument, so every corpus build, acceptance capture and A/B measured a
 * degraded menu — no rejected-press facts, no intent guard. On 605 files the
 * difference is 198 menu lines (162 kick-eaten, 36 cd-hoarded) and 42 ids
 * swapped by cap order. It went unnoticed because a missing stream degrades
 * silently by design (old archives have no raw.txt). Every eval entry point
 * goes through here; `test/rawStreamsEntrypoints.test.ts` fails on a new
 * direct call that drops the streams.
 *
 * `rawText` is the whole log (a match / round is sliced out by its own start
 * and duration); null / undefined = no raw text available (a stored match
 * without raw.txt) → the same degraded menu the app shows for it.
 */
import {
  type CandidateEvent,
  extractCandidateFindings,
  parseRawStreams,
} from "@gladlog/analysis";

type LegacyCombat = Parameters<typeof extractCandidateFindings>[0];

let lastKey: { text: string; startMs: number; durS: number } | null = null;
let lastStreams: ReturnType<typeof parseRawStreams> | null = null;

/** The round's raw streams, parsed once per (text, round): every owner of the
 * same round reuses them. */
export function roundRawStreams(
  combat: LegacyCombat,
  rawText: string | null | undefined,
): ReturnType<typeof parseRawStreams> | undefined {
  if (!rawText) return undefined;
  const c = combat as unknown as { startTime?: number; endTime?: number };
  const startMs = c.startTime ?? 0;
  const durS = ((c.endTime ?? 0) - startMs) / 1000;
  if (
    lastKey &&
    lastStreams &&
    lastKey.text === rawText &&
    lastKey.startMs === startMs &&
    lastKey.durS === durS
  )
    return lastStreams;
  lastStreams = parseRawStreams(rawText, startMs, durS);
  lastKey = { text: rawText, startMs, durS };
  return lastStreams;
}

export function candidatesAsTheAppRuns(
  combat: LegacyCombat,
  ownerId: string | undefined,
  rawText: string | null | undefined,
): CandidateEvent[] {
  return extractCandidateFindings(
    combat,
    ownerId,
    roundRawStreams(combat, rawText),
  );
}
