/**
 * scan5/t108.ts — ticket T108 (fact13 D24): a vision-obscured refusal named
 * a cause the fight did not have. Every SPELL_FAILED_VISION_OBSCURED row
 * read "vision obscured (Smoke Bomb)" from a fixed wording; ec49887a r0 1:12
 * had no Rogue and its nine refusals sat inside an enemy Shaman's Burrow.
 *
 * The cause of each of the owner's refusals is the producer's own selection
 * (`withVisionObscuredCauses` over the round's raw streams and the legacy
 * match, the call `buildMatchContext` / `extractCandidateFindings` make —
 * never replayed here); the checks hold the rendered text to it:
 *
 *  - `namedAbsent`: a `[REJECTED]` / `[CAST STOPPED]` line names cause X,
 *    and no owner refusal in its span (a `[CAST STOPPED]` refusal lands
 *    "refused N s in" after the line's second) carries X.
 *  - `namedAbsentRound`: the context or the menu names X anywhere else (a
 *    kit `[UNUSED … refused: …]` note, a kick-eaten `postKick`, a menu fact;
 *    the schema legend excluded), and no refusal of the round carries X.
 *  - `unnamedPresent`: a `[REJECTED]` line says "vision obscured" with no
 *    cause, while every owner refusal in its span carries one.
 */
import { REJECT_REASONS } from "@gladlog/analysis/src/context/spellOutcomeLines";
import type { CastFailedEvent } from "@gladlog/analysis/src/utils/rawStreams";
import { withVisionObscuredCauses } from "@gladlog/analysis/src/utils/visionObscured";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = [
  "namedAbsent",
  "namedAbsentRound",
  "unnamedPresent",
] as const;

const VO = new Set(REJECT_REASONS["vision obscured"]);
/** a cause bracket never starts with a digit; a span bracket always does */
const REJECTED_RE =
  /^(\d+:\d{2})\s+\[REJECTED\]\s+your (.+?) ×\d+ — vision obscured(?: \(([^()0-9][^()]*)\))?(?: \((\d+:\d{2})–(\d+:\d{2})\))?$/;
const STOPPED_RE =
  /^(\d+:\d{2})\s+\[CAST STOPPED\]\s+.* refused ([\d.]+)s in: vision obscured \(([^()0-9][^()]*)\)/;
const NAMED_ANY_RE = /vision obscured \(([^()0-9][^()]*)\)/g;
/** a findings-schema legend row of the menu prompt */
const LEGEND_ROW_RE = /^- "[a-z-]+":/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  let rows: CastFailedEvent[] | undefined;
  /** every vision-obscured refusal of the round, tagged by the producer */
  const tagged = () =>
    (rows ??= (
      withVisionObscuredCauses(ctx.rawStreams(), ctx.legacy)?.castFailed ?? []
    ).filter((h) => VO.has(h.reason)));
  const ownerIn = (fromS: number, toS: number) =>
    tagged().filter(
      (h) =>
        h.unitGuid === ctx.owner.id && h.tSeconds >= fromS && h.tSeconds < toS,
    );
  for (const line of ctx.lines) {
    const t = line.trim();
    const rj = REJECTED_RE.exec(t);
    const st = rj ? null : STOPPED_RE.exec(t);
    if (!rj && !st) continue;
    const head = (rj?.[4] ?? rj?.[1] ?? st?.[1])!;
    const fromS = secOf(head);
    const toS =
      rj?.[5] !== undefined
        ? secOf(rj[5])
        : st
          ? fromS + Math.ceil(Number(st[2]))
          : fromS;
    const named = rj ? rj[3] : st![3];
    const atMs = ctx.start + fromS * 1000;
    const span = ownerIn(fromS, toS + 1);
    if (named !== undefined) {
      const C = "namedAbsent";
      ctx.bump(C);
      if (!span.some((h) => h.obscuredBy === named))
        ctx.violate(
          C,
          named,
          atMs,
          `${ctx.owner.id}#${fromS}#${named}`,
          `names ${named}; the producer gives the ${span.length} refusal(s) in the span: ${[...new Set(span.map((h) => h.obscuredBy ?? "no cause"))].join(" / ") || "—"}`,
          t,
        );
      continue;
    }
    const C = "unnamedPresent";
    ctx.bump(C);
    if (span.length > 0 && span.every((h) => h.obscuredBy !== undefined))
      ctx.violate(
        C,
        span[0]!.obscuredBy!,
        atMs,
        `${ctx.owner.id}#${fromS}#${rj![2]}`,
        `${span.length} refusal(s) in the span, every one with a cause (${[...new Set(span.map((h) => h.obscuredBy))].join(" / ")}); the line names none`,
        t,
      );
  }
  const C = "namedAbsentRound";
  const seen = new Set<string>();
  for (const text of [ctx.text, ctx.menu])
    for (const row of text.split("\n")) {
      if (LEGEND_ROW_RE.test(row)) continue;
      for (const m of row.matchAll(NAMED_ANY_RE)) seen.add(m[1]!);
    }
  for (const name of seen) {
    ctx.bump(C);
    if (!tagged().some((h) => h.obscuredBy === name))
      ctx.violate(
        C,
        name,
        ctx.start,
        `${ctx.owner.id}#round#${name}`,
        `"vision obscured (${name})" printed; no refusal of the round has that cause`,
      );
  }
}
