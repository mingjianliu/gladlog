import { LEGACY_TOPIC_TYPES } from "./candidateFindings";
import type { CandidateEvent } from "./types";

/**
 * How many findings the first-round prompt asks for, and what counts as one
 * "menu event" when it asks — one definition for the three places that need
 * it (CLAUDE.md shared-predicate rule): `buildFindingsPrompt` (the sentence),
 * `auditFindings` (what an eventId resolves to, and when two findings cite
 * the same thing) and `promptQualityCheck.ts`'s `checkFindingsCountFollowsMenu`
 * (the stated count re-derived from the rendered menu).
 *
 * L07 (user ruling 2026-10-11, options b + c): the prompt asked for "4-8
 * coaching findings" whatever the menu held, while 1,861 of 2,677 non-empty
 * menus on the 605 capture hold one to three events; in the stored Opus 5.5
 * outputs of that prompt (53 outputs, 195 findings) 34 findings were surplus
 * — more findings than distinct events cited — 17 of them a second finding on
 * exactly the same event ids as an earlier one.
 */

/** The count the prompt asks for once the menu can carry it. */
export const FINDINGS_COUNT_MIN = 4;
export const FINDINGS_COUNT_MAX = 8;

/**
 * What a finding may cite: the menu's events, one per DISTINCT candidate id.
 * This is the map `auditFindings` resolves every eventId through, so a menu's
 * size for the purpose of "how many findings" is this map's size, not its row
 * count: two rows that share an id (3 of 3,520 menus on the 605 capture — two
 * kicks or two dispels inside one rounded second) are one thing to cite, and
 * the later row's facts are the ones a finding gets, as before.
 */
export function citableEvents(
  candidates: readonly CandidateEvent[],
): Map<string, CandidateEvent> {
  return new Map(candidates.map((c) => [c.id, c]));
}

/** N of the count sentence — the number of distinct ids on the menu. */
export function citableEventCount(
  candidates: readonly Pick<CandidateEvent, "id">[],
): number {
  return new Set(candidates.map((c) => c.id)).size;
}

/**
 * The identity of what a finding cites: its event ids as a set (order and
 * repeats do not matter). Two findings of one reply with the same key say two
 * things about exactly the same events; `auditFindings` keeps the first.
 * A subset or a superset is a different key — a chain finding that adds a
 * second event to one already covered is not a repeat.
 */
export function eventIdSetKey(eventIds: readonly string[]): string {
  return [...new Set(eventIds)].sort().join("\u0000");
}

/** The line that opens the menu block; the rows follow it directly. */
// FT-T15 ① (user ruling 2026-10-10): the header states the citation rule
// only. It used to call the menu "the ONLY things that provably happened",
// while 3,793 of 8,017 rows on the 605 capture are facts about something
// that did NOT happen (a cooldown not pressed, a debuff not dispelled) and
// 2,322 carry corpus reference numbers. The constraint itself — cite menu
// ids only — is unchanged (see the ACCURACY NOTE in buildFindingsPrompt.ts).
export const EVENT_MENU_HEADER = `Event menu (the ONLY events and facts a finding may cite — every finding must reference these ids):`;

/** How a menu row opens. Written by `buildFindingsPrompt`, read back by
 * `menuEventIdsOfPrompt` — the id is everything between `id=` and ` type=`. */
export function menuRowHead(c: Pick<CandidateEvent, "id" | "type">): string {
  return `  - id=${c.id} type=${c.type}`;
}
const MENU_ROW_HEAD = /^ {2}- id=(.+?) type=\S+ t=/;

/**
 * The event ids of a rendered findings prompt's menu, in row order (repeats
 * kept — `citableEventCount` is what collapses them). `null` when the text is
 * not a findings prompt (the bare match context has no menu block).
 */
export function menuEventIdsOfPrompt(
  lines: readonly string[],
): string[] | null {
  const at = lines.indexOf(EVENT_MENU_HEADER);
  if (at < 0) return null;
  const ids: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const m = MENU_ROW_HEAD.exec(lines[i]!);
    if (!m) break;
    ids.push(m[1]!);
  }
  return ids;
}

/** Rendered into the selection-rule sentence below and shared with
 * auditFindings.ts's deterministic cap on the very same set — single-source
 * (CLAUDE.md shared-predicate rule), see LEGACY_TOPIC_TYPES's doc comment in
 * candidateFindings.ts. */
const LEGACY_TYPES_LIST = [...LEGACY_TOPIC_TYPES]
  .map((t) => `"${t}"`)
  .join(", ");

/** The two halves of the death sentence. The chain half is the prompt's one
 * description of a chain finding at the head (the "death-setup" legend says
 * how to anchor it); the cap half can only bind once more than two findings
 * may be written. */
const DEATH_ONLY_CAP = `At most 2 findings may be anchored solely on death events`;
const DEATH_CHAIN = `when a death has "death-setup" events, pair them into one chain finding instead of adding another death-only item`;

/**
 * The prompt's count-and-selection instruction — everything after "You are a
 * … coach reviewing a <spec>'s match." on its first line — for a menu of
 * `menuEvents` citable events (`citableEventCount`).
 *
 * - `FINDINGS_COUNT_MIN` events or more: the 4-8 sentence and its selection
 *   rules (spread over the match, the death cap, the legacy-type cap), as
 *   they were.
 * - One to three: "up to N, at most one per menu event". The selection rules
 *   choose WHICH events get a finding when the menu offers more than the
 *   count; with every event allowed its own finding there is nothing to
 *   choose, so they are not printed — except the death sentence, whose chain
 *   half needs two rows and whose cap of two can bind at three. A menu of
 *   one gets the count and "never fabricate" and no clause about whether its
 *   event supports a finding: the first wording had one ("write the finding
 *   only if that event genuinely supports one") and, in the real-model smoke
 *   of 2026-10-13, one of two single-event menus came back as an empty array
 *   where the 4-8 sentence had produced a finding — one sample, but an
 *   invitation the ruled sentence does not contain.
 * - Zero: the product never sends an empty menu to a model
 *   (`createAnalysisService`'s `no-candidates` fallback); the text is left as
 *   it was.
 */
export function findingsCountInstruction(menuEvents: number): string {
  if (menuEvents <= 0 || menuEvents >= FINDINGS_COUNT_MIN)
    return `Produce ${FINDINGS_COUNT_MIN}-${FINDINGS_COUNT_MAX} coaching findings as JSON — as many as the event menu genuinely supports; never fabricate, but prefer covering MORE distinct menu events over polishing few. Spread coverage across the whole match: when the menu has early/mid-game events (missed-cleanse, missed-purge, kick-eaten, bursts, kicks, targeting), do not spend every finding on the final seconds, and cover at least two non-death event types when present. ${DEATH_ONLY_CAP}; ${DEATH_CHAIN}. Prioritize covering DIFFERENT event types over repeating the same one: of ${LEGACY_TYPES_LIST}, at most 3 findings TOTAL (combined across both, not 3 each) may draw from that group even when the menu offers more of them — spend your remaining picks on other types instead.`;
  if (menuEvents === 1)
    return `Produce up to 1 coaching finding as JSON — at most one per menu event, and the menu holds a single event; never fabricate.`;
  const death =
    menuEvents > 2
      ? `${DEATH_ONLY_CAP}; ${DEATH_CHAIN}.`
      : `${DEATH_CHAIN[0]!.toUpperCase()}${DEATH_CHAIN.slice(1)}.`;
  return `Produce up to ${menuEvents} coaching findings as JSON — at most one per menu event, covering as many of the menu's ${menuEvents} events as genuinely support one; never fabricate. ${death}`;
}

/** The first line of a findings prompt for this spec and menu size. */
export function findingsPromptHead(
  specName: string,
  menuEvents: number,
): string {
  return `You are a World of Warcraft arena coach reviewing a ${specName}'s match. ${findingsCountInstruction(menuEvents)}`;
}
