/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t130.ts — pipeline T130 (CXA13 D33, 54251a4b r0 0:16): an enemy
 * Restoration Druid's Nature's Cure removed Earthgrab and Wither with no
 * SPELL_CAST_SUCCESS row (source flags 0x528 — reaction neutral, the unit
 * not yet resolved; its auras re-broadcast at 0x548 33 ms later) and
 * `[MINOR DISPELS]` filed it `Nature's Cure (passive)`.
 *
 * Re-derived from the raw rows, then checked against the rendered line (not
 * the product's classifier):
 *  - a SPELL_DISPEL / SPELL_STOLEN row whose source reaction bits are
 *    neutral (`flags & 0xf0 === 0x20`), with no SPELL_CAST_SUCCESS of the
 *    same spell (id or name) by the same GUID within
 *    `DISPEL_CAST_MATCH_WINDOW_MS`, of a spell that GUID casts elsewhere in
 *    the round;
 *  - `pressRenderedPassive`: no press of the spell in the
 *    `UNSEEN_PRESS_REPEAT_GUARD_MS` before it — a press the recorder did not
 *    see; a violation when the source's `[MINOR DISPELS]` press list
 *    (`<spell> ×N (m:ss …; …)`) does not name its second (a list cut with
 *    `+N` is judged up to its MINOR_DISPEL_CASTS_SHOWN-th entry — the
 *    time-ordered head; a backlash press past it is listed out of order);
 *  - `repeatRenderedPress`: a press in that window before it — the press's
 *    delayed effect (Improved Spellsteal repeats 4 s after the cast; codex
 *    T130-1: 081952f3 r1, f55b2412 r5); a violation when the press list
 *    names its second and no cast row of the spell falls in that second.
 * A Critical / High removal (`removedDispelPriority`) goes to `[CLEANSE]` /
 * `[PURGE]` and is not judged here, nor is a source whose line does not
 * list the spell.
 */
import {
  MINOR_DISPEL_CAST_MERGE_S,
  MINOR_DISPEL_CASTS_SHOWN,
} from "@gladlog/analysis/src/context/timelineSections/minorDispels";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { removedDispelPriority } from "@gladlog/analysis/src/utils/dispelAnalysis";
import {
  DISPEL_CAST_MATCH_WINDOW_MS,
  UNSEEN_PRESS_REPEAT_GUARD_MS,
} from "@gladlog/analysis/src/utils/dispelKind";
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";

import { fmtS, type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["pressRenderedPassive", "repeatRenderedPress"] as const;

interface IRow {
  ms: number;
  src: string;
  flags: number;
  spellId: string;
  spellName: string;
  /** a removal row's removed aura (params[11]) */
  removed: string;
}

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function run(ctx: IRoundCtx): void {
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
      flags: Number.parseInt(p[2] ?? "0", 16),
      spellId: p[8] ?? "",
      spellName: p[9] ?? "",
      removed: p[11] ?? "",
    };
    (e === "SPELL_CAST_SUCCESS" ? casts : dispels).push(row);
  }
  const same = (c: IRow, d: IRow): boolean =>
    c.src === d.src &&
    ((!!d.spellId && c.spellId === d.spellId) ||
      (!!d.spellName && c.spellName === d.spellName));
  const unitByGuid = new Map<string, any>(
    (ctx.units as any[]).map((u) => [u.id, u]),
  );
  const seen = new Set<string>();
  for (const d of dispels) {
    if (d.ms < ctx.start || d.ms > ctx.roundEndAt) continue;
    if ((d.flags & 0xf0) !== 0x20) continue;
    if (!d.src.startsWith("Player-")) continue;
    // a Critical / High removal goes to [CLEANSE] / [PURGE], not the fold
    // (the fold's own test: minorDispels.ts)
    const pr = removedDispelPriority(d.removed);
    if (pr === "Critical" || pr === "High") continue;
    const key = `${d.src}|${d.spellId}|${d.ms}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const own = casts.filter((c) => same(c, d));
    if (own.length === 0) continue;
    if (own.some((c) => Math.abs(c.ms - d.ms) <= DISPEL_CAST_MATCH_WINDOW_MS))
      continue;
    const repeat = own.some(
      (c) => c.ms < d.ms && d.ms - c.ms <= UNSEEN_PRESS_REPEAT_GUARD_MS,
    );
    const unit = unitByGuid.get(d.src);
    const pid = unit ? ctx.pidOf(unit.name) : undefined;
    if (!pid) continue;
    const spell = getEnglishSpellName(d.spellId, d.spellName);
    const lineRe = new RegExp(
      String.raw`^\s*\d+:\d\d\s+\[MINOR DISPELS\]\s+${escapeRe(pid)}\(`,
    );
    const listRe = new RegExp(String.raw`${escapeRe(spell)} ×\d+ \(([^)]*)\)`);
    // the deliberate parts share one line; a non-deliberate part has its
    // own (codex T130-2: a passive line first hid the press list)
    const srcLines = ctx.lines.filter(
      (l) => lineRe.test(l) && l.includes(`${spell} `),
    );
    if (srcLines.length === 0) continue;
    const line = srcLines.find((l) => listRe.test(l)) ?? srcLines[0]!;
    const listM = listRe.exec(line);
    const list = listM?.[1] ?? "";
    const truncated = /, \+\d+$/.test(list);
    const shown = list
      .split("; ")
      .map((seg) => /^(\d+:\d\d) /.exec(seg.replace(/, \+\d+$/, ""))?.[1])
      .filter((x): x is string => !!x);
    const secs = new Set(shown);
    // the first MINOR_DISPEL_CASTS_SHOWN entries are the time-ordered head;
    // a backlash press past them is listed too, out of that order
    const head = shown.slice(0, MINOR_DISPEL_CASTS_SHOWN);
    const lastShown = head.length ? secOf(head[head.length - 1]!) : -1;
    const sec = fmtS((d.ms - ctx.start) / 1000);
    const check = repeat ? "repeatRenderedPress" : "pressRenderedPassive";
    ctx.bump(check);
    // one press's removals the renderer merges (MINOR_DISPEL_CAST_MERGE_S)
    // may straddle a second: the press is listed at the first one's
    // (codex T130-3: 16.990 / 17.010 render as one `0:16` press)
    const named = dispels.some(
      (o) =>
        o.src === d.src &&
        o.spellId === d.spellId &&
        Math.abs(o.ms - d.ms) <= MINOR_DISPEL_CAST_MERGE_S * 1000 &&
        secs.has(fmtS((o.ms - ctx.start) / 1000)),
    );
    // the list is in time order and cut only at its tail: a second at or
    // before its last shown entry is judged even when it is cut
    const judgeable = !truncated || secOf(sec) <= lastShown;
    if (!repeat && !named && judgeable)
      ctx.violate(
        check,
        spell,
        d.ms,
        `${d.src}:${d.ms}`,
        `${unit.name} ${spell} at ${sec} (flags 0x${d.flags.toString(16)}, no cast row): not in the press list`,
        line.trim().slice(0, 240),
      );
    if (repeat && named) {
      const castInSec = own.some(
        (c) => fmtS((c.ms - ctx.start) / 1000) === sec,
      );
      if (!castInSec)
        ctx.violate(
          check,
          spell,
          d.ms,
          `${d.src}:${d.ms}`,
          `${unit.name} ${spell} at ${sec}: a press's delayed repeat listed as a press`,
          line.trim().slice(0, 240),
        );
    }
  }
}
