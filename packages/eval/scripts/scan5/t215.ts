/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t215.ts — pipeline T215 (round-14 D31, ae1d0895 r0): a mage pressed
 * Kleptomania 198100 three times; the channel's aura fired Spellsteal
 * 1231112 every half second (ten SPELL_STOLEN rows, no cast row of 1231112)
 * and `[MINOR DISPELS]` filed them `Spellsteal (side effect of the cast) x2,
 * Spellsteal (passive) x8`.
 *
 * Re-derived from the raw rows, then checked against the rendered line:
 *  - a SPELL_DISPEL / SPELL_STOLEN row of a spell some pressed aura fires on
 *    a period (`CHANNEL_TICK_DISPEL_IDS`, official), whose source GUID logged
 *    a SPELL_CAST_SUCCESS of that aura at or before it, no longer ago than
 *    the aura's official duration plus `DISPEL_CAST_MATCH_WINDOW_MS`;
 *  - `channelTickFiledPassive`: a violation when the source's
 *    `[MINOR DISPELS]` lines carry the spell as a `(passive)` or
 *    `(side effect of the cast)` part, or carry no press list of it;
 *  - `channelTickPressUnlisted`: with a press list, a violation when the
 *    list does not name the second of the channel's first minor tick (a list
 *    cut with `+N` is judged up to its MINOR_DISPEL_CASTS_SHOWN-th entry).
 * A Critical / High removal (`removedDispelPriority`) goes to `[PURGE]` and
 * is not judged here. A source that also has a removal of the same spell
 * name outside every channel (a real proc of that name) is not judged by the
 * tag (`channelTickMixedSource` counts those rows).
 */
import {
  MINOR_DISPEL_CASTS_SHOWN,
  MINOR_DISPEL_PASSIVE_TAG,
  MINOR_DISPEL_RIDER_TAG,
} from "@gladlog/analysis/src/context/timelineSections/minorDispels";
import { CHANNEL_TICK_DISPEL_IDS } from "@gladlog/analysis/src/data/channelTickDispelsGenerated";
import {
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { removedDispelPriority } from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  DISPEL_CAST_MATCH_WINDOW_MS,
  DISPEL_RIDES_PRESS_MS,
} from "@gladlog/analysis/src/utils/dispelKind";
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";

import { fmtS, type IRoundCtx, secOf } from "./ctx";

export const CHECKS = [
  "channelTickFiledPassive",
  "channelTickPressUnlisted",
  "channelTickMixedSource",
] as const;

interface IRow {
  ms: number;
  src: string;
  spellId: string;
  spellName: string;
  removed: string;
}

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** the press list of `spell` on a `[MINOR DISPELS]` line: its seconds, and
 * whether it was cut with `+N`. The list is read to its matching `)`: a
 * removed buff's name can carry its own parentheses (`Rejuvenation
 * (Germination)`). */
export function pressListOf(
  line: string,
  spell: string,
): { secs: string[]; truncated: boolean } | undefined {
  const m = new RegExp(String.raw`${escapeRe(spell)} ×\d+ \(`).exec(line);
  if (!m) return undefined;
  const from = m.index + m[0].length;
  let depth = 1;
  let at = from;
  for (; at < line.length && depth > 0; at++) {
    if (line[at] === "(") depth++;
    else if (line[at] === ")") depth--;
  }
  if (depth !== 0) return undefined;
  const list = line.slice(from, at - 1);
  return {
    truncated: /, \+\d+$/.test(list),
    secs: list
      .split("; ")
      .map((seg) => /^(\d+:\d\d) /.exec(seg.replace(/, \+\d+$/, ""))?.[1])
      .filter((x): x is string => !!x),
  };
}

/** the `[MINOR DISPELS]` lines of one player's own removals — `N(Spec):`,
 * not a summon's `N(Spec)'s guardian:` line (the audited log's mage had
 * both) */
export function ownMinorDispelLineRe(pid: string): RegExp {
  return new RegExp(
    String.raw`^\s*\d+:\d\d\s+\[MINOR DISPELS\]\s+${escapeRe(pid)}\([^)]*\): `,
  );
}

/** does a `[MINOR DISPELS]` line file `spell` as a non-deliberate part */
export function filedAsNotPressed(line: string, spell: string): boolean {
  return (
    line.includes(`${spell} ${MINOR_DISPEL_PASSIVE_TAG}`) ||
    line.includes(`${spell} ${MINOR_DISPEL_RIDER_TAG}`)
  );
}

export function run(ctx: IRoundCtx): void {
  const tickIds = new Map<string, string[]>();
  for (const [press, ticks] of CHANNEL_TICK_DISPEL_IDS)
    for (const t of ticks) tickIds.set(t, [...(tickIds.get(t) ?? []), press]);
  const pressIds = new Set(CHANNEL_TICK_DISPEL_IDS.keys());
  const casts: IRow[] = [];
  const dispels: IRow[] = [];
  for (const l of ctx.rawLines) {
    if (
      !l.includes("SPELL_CAST_SUCCESS") &&
      !l.includes("SPELL_DISPEL") &&
      !l.includes("SPELL_STOLEN")
    )
      continue;
    const parts = splitRawLine(l);
    if (!parts) continue;
    const e = parts.eventName;
    if (
      e !== "SPELL_CAST_SUCCESS" &&
      e !== "SPELL_DISPEL" &&
      e !== "SPELL_STOLEN"
    )
      continue;
    const ms = parseRawTimestamp(parts.datePart);
    if (ms === null) continue;
    const p = parts.params;
    const row: IRow = {
      ms,
      src: p[0] ?? "",
      spellId: p[8] ?? "",
      spellName: p[9] ?? "",
      removed: p[11] ?? "",
    };
    if (e === "SPELL_CAST_SUCCESS") {
      if (pressIds.has(row.spellId)) casts.push(row);
    } else dispels.push(row);
  }
  if (casts.length === 0) return;
  const pressOf = (d: IRow): IRow | undefined => {
    let found: IRow | undefined;
    for (const press of tickIds.get(d.spellId) ?? []) {
      const lastsMs = (spellEffectData[press]?.durationSeconds ?? 0) * 1000;
      for (const c of casts) {
        if (c.src !== d.src || c.spellId !== press) continue;
        if (c.ms > d.ms + DISPEL_RIDES_PRESS_MS) continue;
        if (d.ms - c.ms > lastsMs + DISPEL_CAST_MATCH_WINDOW_MS) continue;
        if (!found || c.ms > found.ms) found = c;
      }
    }
    return found;
  };
  const unitByGuid = new Map<string, any>(
    (ctx.units as any[]).map((u) => [u.id, u]),
  );
  const inRound = (d: IRow): boolean =>
    d.ms >= ctx.start && d.ms <= ctx.roundEndAt;
  const minor = (d: IRow): boolean => {
    const pr = removedDispelPriority(d.removed);
    return pr !== "Critical" && pr !== "High";
  };
  // per source + spell name: its channel ticks by press
  const seen = new Set<string>();
  for (const d of dispels) {
    if (!inRound(d) || !tickIds.has(d.spellId) || !minor(d)) continue;
    const press = pressOf(d);
    if (!press) continue;
    const unit = unitByGuid.get(d.src);
    const pid = unit ? ctx.pidOf(unit.name) : undefined;
    if (!pid) continue;
    const spell = getEnglishSpellName(d.spellId, d.spellName);
    const lineRe = ownMinorDispelLineRe(pid);
    const srcLines = ctx.lines.filter(
      (l) => lineRe.test(l) && l.includes(`${spell} `),
    );
    if (srcLines.length === 0) continue;
    // a removal of the same name by this source outside every channel is a
    // part of its own; the tag on the line may be that one's
    const mixed = dispels.some(
      (o) =>
        o.src === d.src &&
        inRound(o) &&
        minor(o) &&
        getEnglishSpellName(o.spellId, o.spellName) === spell &&
        !pressOf(o),
    );
    if (mixed) {
      ctx.bump("channelTickMixedSource");
      continue;
    }
    ctx.bump("channelTickFiledPassive");
    const tagged = srcLines.find((l) => filedAsNotPressed(l, spell));
    const listed = srcLines
      .map((l) => ({ l, list: pressListOf(l, spell) }))
      .find((x) => x.list !== undefined);
    const sec = fmtS((d.ms - ctx.start) / 1000);
    if (tagged || !listed)
      ctx.violate(
        "channelTickFiledPassive",
        spell,
        d.ms,
        `${d.src}:${d.ms}`,
        `${unit.name} ${spell} at ${sec}: a tick of ${getEnglishSpellName(press.spellId, press.spellName)} pressed at ${fmtS((press.ms - ctx.start) / 1000)}, filed as not pressed`,
        (tagged ?? srcLines[0]!).trim().slice(0, 240),
      );
    // the press is listed once, at its first minor tick
    const pressKey = `${d.src}|${press.ms}`;
    if (seen.has(pressKey)) continue;
    seen.add(pressKey);
    if (!listed?.list) continue;
    ctx.bump("channelTickPressUnlisted");
    const head = listed.list.secs.slice(0, MINOR_DISPEL_CASTS_SHOWN);
    const lastShown = head.length ? secOf(head[head.length - 1]!) : -1;
    const judgeable = !listed.list.truncated || secOf(sec) <= lastShown;
    if (judgeable && !listed.list.secs.includes(sec))
      ctx.violate(
        "channelTickPressUnlisted",
        spell,
        d.ms,
        `${d.src}:${press.ms}`,
        `${unit.name} ${spell}: the channel pressed at ${fmtS((press.ms - ctx.start) / 1000)} (first tick ${sec}) is not in the press list`,
        listed.l.trim().slice(0, 240),
      );
  }
}
