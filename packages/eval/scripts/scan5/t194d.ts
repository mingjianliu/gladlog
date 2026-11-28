/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t194d.ts — pipeline T194, count first: two settling counts of the
 * triage list (items 207.9 and 207.12). Both only COUNT; neither is a gate.
 *
 *  - `sameSecondIdenticalLine` (207.9): a timeline line printed byte for byte
 *    more than once in one prompt. A line carries its own `m:ss` stamp, so
 *    two identical lines are two lines of one second. Pure text check.
 *    The timeline is the block from the `MATCH TIMELINE` head to its
 *    `[MATCH END]` line (or, without one, the first unindented line after the
 *    first event that is not an event line — the next section's head); an
 *    event line is an unindented `m:ss` / `m:ss–m:ss` stamp followed by one
 *    or more `[TAG]`s. Not read: the legend (indented, no stamp), the
 *    continuation rows under an event (`[RES]`, the death recap — indented,
 *    no stamp of their own) and every later section that prints stamped
 *    lines of its own (`[CONSEQ]`, `[CC BOOKMARK]`, KILL ATTEMPTS). `[STATE]`
 *    ticks ARE read: one per second by construction, so a repeat is a
 *    double print.
 *    Population (`bump`): the timeline's event lines of the owner context.
 *    Kind: the line's leading tag(s), e.g. `[ENEMY BUFF]`, `[YOU] [CAST]`.
 *    One row per duplicated text; its fact is the text itself, so a line
 *    three owners of a round see is one fact. The detail says how many
 *    copies, and whether they are adjacent or other lines sit between them
 *    (the timeline sorts by instant: copies apart are two instants of the
 *    second). The check cannot tell two real events of one second from one
 *    event printed twice — that is read off the log per kind.
 *
 *  - `stillUpAtRoundEndRemovedEarlier` (207.12): an `[ENEMY DEF]` line that
 *    says `still up when the round ended` against the aura's own REMOVED row.
 *    The line is tied to the producer's own event (`enemyDefensiveEvents` of
 *    its caster, called as `enemyDef.ts` calls it — the round's units, the
 *    round's end `roundEndMs` — and picked by the line's second, spell and
 *    holder among the events flagged `upAtRoundEnd`); the aura's end is then
 *    read from the holder's RAW aura rows, not from the event: the rows of
 *    the press's aura from its caster, walked from the application nearest
 *    the event to the REMOVED that leaves the aura off (an APPLIED / REFRESH
 *    at or before the round's end puts it back up).
 *    Population (`bump`): every such line of the owner context.
 *    Kinds:
 *     - `REMOVED before roundEndMs` — the aura came off more than
 *       `EARLY_MS` before the instant `roundEndMs` gives: the line is wrong.
 *    Out of the total (what the words mean, or nothing to read):
 *     - `REMOVED within 100 ms before roundEndMs` — a boundary reading;
 *     - `REMOVED at or after roundEndMs, before endTime` — the round ended
 *       on the aura and the log's trailing rows took it off (a Solo Shuffle
 *       round's ~2 s after its deciding death): the words as the legend
 *       defines them;
 *     - `no REMOVED row in the round` — still up at the log's end too;
 *     - `no aura row of that spell on the holder` — the scan found no row
 *       to read (its id mapping, not the product);
 *     - `line not tied to a producer event` — the scan could not find the
 *       `upAtRoundEnd` event behind the line.
 */
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { ENEMY_IMMUNITY_EXTERNAL_CASTS } from "@gladlog/analysis/src/data/spellIdLists";
import {
  ENEMY_DEF_TAG_RE_SRC,
  enemyDefensiveEvents,
  type IEnemyDefensiveEvent,
  wallTableIdOfAura,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  AURA_STILL_UP_AT_ROUND_END,
  roundEndMs,
} from "@gladlog/analysis/src/utils/roundEnd";

import { APPLIED, ev, type IRoundCtx, REFRESH, REMOVED, tsOf } from "./ctx";

const DUP = "sameSecondIdenticalLine";
const UP = "stillUpAtRoundEndRemovedEarlier";
export const CHECKS = [DUP, UP] as const;
/** whole checks out of the total (T314): it cannot tell two real events of one second from one printed twice (its own header) */
export const MEASURED_ONLY: ReadonlySet<string> = new Set([DUP]);

const K_BEFORE = "REMOVED before roundEndMs";
const K_EDGE = "REMOVED within 100 ms before roundEndMs";
const K_TRAILING = "REMOVED at or after roundEndMs, before endTime";
const K_NONE = "no REMOVED row in the round";
const K_NO_ROWS = "no aura row of that spell on the holder";
const K_NO_EVENT = "line not tied to a producer event";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [K_EDGE, K_TRAILING, K_NONE, K_NO_ROWS, K_NO_EVENT].map((k) => `${UP}|${k}`),
);

/** how far before the round's end a REMOVED must be to count as earlier */
const EARLY_MS = 100;
/** the application of the event's aura is looked for this far around the
 * event's instant (a press can precede its aura; an aura can precede its
 * cast row) */
const ON_BEFORE_MS = 500;
const ON_AFTER_MS = 2500;
const FACT_TEXT_MAX = 120;
const NO_SOURCE = "0000000000000000";

const TIMELINE_HEAD = "MATCH TIMELINE";
/** an event line: an unindented stamp, then the tag(s) — single-spaced, the
 * text after them is set off by two spaces or more */
const EVENT_LINE = /^(\d+):(\d\d)(?:–\d+:\d\d)?\s+(\[[^\]]+\](?: \[[^\]]+\])*)/;
const MATCH_END_TAG = "[MATCH END]";

/** `m:ss  [ENEMY DEF]   <pid>(…) (<spec>): <spell>[ → <pid>(…)] ([label, ]Ns
 * — still up when the round ended…` — the tag is the shared one, so a shield
 * merged onto an `[ENEMY CD]` line is read too */
const STILL_UP_LINE = new RegExp(
  String.raw`^(\d+):(\d\d)\s+${ENEMY_DEF_TAG_RE_SRC}\s+(\d+)\(\S+\) \([^)]*\): (.+?) \((?:[^()]*?, )?[\d.]+s — ${AURA_STILL_UP_AT_ROUND_END}`,
);
const RECIPIENT = / → (\d+)\(\S+\)$/;

function sameSecondIdenticalLine(ctx: IRoundCtx): void {
  const head = ctx.lines.indexOf(TIMELINE_HEAD);
  if (head < 0) return;
  // text -> [copies, index of the first copy, index of the last copy]
  const seen = new Map<string, [number, number, number]>();
  const tagsOf = new Map<string, { tags: string; sec: number }>();
  let events = 0;
  for (let i = head + 1; i < ctx.lines.length; i++) {
    const l = ctx.lines[i]!;
    if (l.trim() === "") continue;
    const m = EVENT_LINE.exec(l);
    if (!m) {
      // the legend above the first event is partly unindented; past the
      // first event an unindented line that is no event is the next section
      if (events > 0 && !/^\s/.test(l)) break;
      continue;
    }
    events++;
    const at = seen.get(l);
    if (at) {
      at[0]++;
      at[2] = events;
    } else {
      seen.set(l, [1, events, events]);
      tagsOf.set(l, { tags: m[3]!, sec: +m[1]! * 60 + +m[2]! });
    }
    if (m[3] === MATCH_END_TAG) break;
  }
  ctx.bump(DUP, events);
  for (const [text, [copies, first, last]] of seen) {
    if (copies < 2) continue;
    const { tags, sec } = tagsOf.get(text)!;
    ctx.violate(
      DUP,
      tags,
      ctx.start + sec * 1000,
      text.trim().slice(0, FACT_TEXT_MAX),
      `${copies} copies, ${last - first === copies - 1 ? "adjacent" : `${last - first + 1 - copies} other event line(s) between them`}`,
      text,
    );
  }
}

function stillUpAtRoundEnd(ctx: IRoundCtx): void {
  const legacy: any = ctx.legacy;
  const endMs = roundEndMs(legacy);
  const rel = (ms: number) => `+${Math.round(ms - ctx.start)} ms`;
  for (const line of ctx.lines) {
    const m = STILL_UP_LINE.exec(line);
    if (!m) continue;
    ctx.bump(UP);
    const sec = +m[1]! * 60 + +m[2]!;
    const atLineMs = ctx.start + sec * 1000;
    const caster: any = ctx.unitOfPid(m[3]);
    const toPid = RECIPIENT.exec(m[4]!)?.[1];
    const holder: any = toPid ? ctx.unitOfPid(toPid) : caster;
    const spellText = m[4]!;
    const lineKey = `${m[3]}>${toPid ?? m[3]}|${spellText}|${sec}`;
    if (!caster || !holder) {
      ctx.violate(UP, K_NO_EVENT, atLineMs, lineKey, "unit not found", line);
      continue;
    }
    // the producer's own event behind the line, as `enemyDef.ts` asks for
    // it: the caster's team, the round's units, the round's end
    const team = (ctx.players as any[]).filter(
      (p) => p.reaction === caster.reaction,
    );
    const d = (
      enemyDefensiveEvents(
        caster as never,
        team as never,
        legacy as never,
        endMs,
      ) as IEnemyDefensiveEvent[]
    ).find(
      (x) =>
        x.upAtRoundEnd === true &&
        Math.floor(x.atSeconds) === sec &&
        spellText.startsWith(x.spellName) &&
        (toPid === undefined
          ? x.kind !== "external" &&
            (x.recipientId === undefined || x.recipientId === caster.id)
          : x.kind === "external" && x.recipientId === holder.id),
    );
    if (!d) {
      ctx.violate(
        UP,
        K_NO_EVENT,
        atLineMs,
        lineKey,
        "no upAtRoundEnd event of that second, spell and holder",
        line,
      );
      continue;
    }
    const key = `${holder.id}|${d.spellId}|${Math.round(d.atSeconds * 1000)}`;
    const atMs = ctx.start + d.atSeconds * 1000;
    // the press's aura on its holder: the id itself, the immunity a summon
    // applies, an effect aura of the cast, the aura a wall-table id stands for
    const immunityAura = (
      ENEMY_IMMUNITY_EXTERNAL_CASTS as Record<string, string | undefined>
    )[d.spellId];
    const isPressAura = (id: string) =>
      id === d.spellId ||
      id === immunityAura ||
      castsOfEffectAura(id).includes(d.spellId) ||
      wallTableIdOfAura(id) === d.spellId;
    // from the caster, its summon, or a row written with no source; a team
    // proc's source is the teammate whose press put it up
    const fromCaster = (a: any) =>
      d.procSource !== undefined ||
      !a.srcUnitId ||
      a.srcUnitId === NO_SOURCE ||
      a.srcUnitId === caster.id ||
      (ctx.units as any[]).find((u) => u.id === a.srcUnitId)?.ownerId ===
        caster.id;
    const rows = ((holder.auraEvents ?? []) as any[]).filter(
      (a) => isPressAura(String(a.spellId)) && fromCaster(a),
    );
    if (rows.length === 0) {
      ctx.violate(UP, K_NO_ROWS, atMs, key, `${d.spellName}`, line);
      continue;
    }
    const isOn = (a: any) => ev(a) === APPLIED || ev(a) === REFRESH;
    const on = rows
      .filter(
        (a) =>
          isOn(a) &&
          tsOf(a) >= atMs - ON_BEFORE_MS &&
          tsOf(a) <= atMs + ON_AFTER_MS,
      )
      .sort((x, y) => Math.abs(tsOf(x) - atMs) - Math.abs(tsOf(y) - atMs))[0];
    // in log order from the application (an aura up since before the round
    // has none: from the event's instant)
    const after = on
      ? rows.slice(rows.indexOf(on) + 1)
      : rows.filter((a) => tsOf(a) >= atMs);
    let off: any;
    let reapplied = 0;
    for (const a of after) {
      if (ev(a) === REMOVED) {
        off = a;
        if (tsOf(a) >= endMs) break;
      } else if (isOn(a)) {
        // past the round's end it is no part of the round's reading
        if (tsOf(a) > endMs) break;
        if (off) reapplied++;
        off = undefined;
      }
    }
    const instants = `roundEndMs ${rel(endMs)}, endTime ${rel(legacy.endTime)}, aura on ${rel(on ? tsOf(on) : atMs)}${on ? "" : " (no application row)"}`;
    if (!off || tsOf(off) >= legacy.endTime) {
      ctx.violate(UP, K_NONE, atMs, key, `${d.spellName}: ${instants}`, line);
      continue;
    }
    const offMs: number = tsOf(off);
    const kind =
      offMs < endMs - EARLY_MS ? K_BEFORE : offMs < endMs ? K_EDGE : K_TRAILING;
    ctx.violate(
      UP,
      kind,
      offMs,
      key,
      `${d.spellName}: REMOVED ${rel(offMs)} (${Math.round(offMs - endMs)} ms from roundEndMs), ${instants}${reapplied ? `, re-applied ${reapplied}× before it` : ""}; the line prints ${d.observedSeconds?.toFixed(1) ?? "no"} s`,
      line,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  sameSecondIdenticalLine(ctx);
  stillUpAtRoundEnd(ctx);
}
