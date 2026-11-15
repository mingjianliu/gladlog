/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t108.ts — ticket T108 (fact13 D24): a vision-obscured refusal named
 * a cause the fight did not have. Every SPELL_FAILED_VISION_OBSCURED row
 * read "vision obscured (Smoke Bomb)" from a fixed wording; ec49887a r0 1:12
 * had no Rogue and its nine refusals sat inside an enemy Shaman's Burrow.
 *
 * Truth is read off the log's own rows, loosely, against the generated
 * official tables (`visionObscuringAuraGenerated.ts`: aura-322 auras, and
 * the same-name area casts — Smoke Bomb):
 *
 *  - `namedAbsent`: a `[REJECTED]` / `[CAST STOPPED]` line names cause X,
 *    and no row of X (an aura row of an X aura on anyone, or an X cast) lies
 *    between 6 s before the line's span and 1 s after it.
 *  - `namedAbsentRound`: the context or the menu names X anywhere (a kit
 *    `[UNUSED … refused: …]` note, a kick-eaten `postKick`, a menu fact), and
 *    the round holds no row of X at all.
 *  - `unnamedPresent`: a `[REJECTED]` line says "vision obscured" with no
 *    cause, while every one of the owner's vision-obscured refusals inside
 *    its span lies inside an obscuring aura on an enemy of the owner — an
 *    aura-322 aura interferes with its holder's enemies' targeting, so an
 *    aura row counts only on the owner's other side, here and for the two
 *    checks above (APPLIED → its
 *    REMOVED, the official length without one) or inside a Smoke Bomb's
 *    official 5 s — a cause the line left out.
 */
import { REJECT_REASONS } from "@gladlog/analysis/src/context/spellOutcomeLines";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import {
  VISION_OBSCURING_AREA_CASTS,
  VISION_OBSCURING_AURAS,
} from "@gladlog/analysis/src/data/visionObscuringAuraGenerated";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "namedAbsent",
  "namedAbsentRound",
  "unnamedPresent",
] as const;

const VO = new Set(REJECT_REASONS["vision obscured"]);
const REJECTED_RE =
  /^(\d+:\d{2})\s+\[REJECTED\]\s+your (.+?) ×\d+ — vision obscured(?: \(([^()0-9][^()]*)\))?(?: \((\d+:\d{2})–(\d+:\d{2})\))?$/;
const STOPPED_RE =
  /^(\d+:\d{2})\s+\[CAST STOPPED\]\s+.* refused ([\d.]+)s in: vision obscured \(([^()0-9][^()]*)\)/;
/** a cause bracket (a span bracket starts with a digit) */
const NAMED_ANY_RE = /vision obscured \(([^()0-9][^()]*)\)/g;
/** a findings-schema legend row of the menu prompt */
const LEGEND_ROW_RE = /^- "[a-z-]+":/;

interface IMark {
  ms: number;
  /** an aura's end; a cast's official end */
  to: number;
  name: string;
  holder?: string;
}

/** both on a side (friendly 1 / hostile 2), and not the same one */
const opposed = (a: unknown, b: unknown): boolean =>
  (a === 1 || a === 2) && (b === 1 || b === 2) && a !== b;

function marksOf(ctx: IRoundCtx): IMark[] {
  const out: IMark[] = [];
  for (const u of ctx.units) {
    // an aura-322 aura interferes with its holder's ENEMIES' targeting: only
    // one on the owner's other side can have obscured the owner's target
    const auras = ((u.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.destUnitId === u.id &&
        opposed(u.reaction, ctx.owner.reaction) &&
        VISION_OBSCURING_AURAS[String(a.spellId)] !== undefined,
    );
    auras.forEach((a, i) => {
      if (ev(a) !== APPLIED) return;
      const id = String(a.spellId);
      const off = auras
        .slice(i + 1)
        .find((r) => String(r.spellId) === id && ev(r) === REMOVED);
      const lengthMs = (spellEffectData[id]?.durationSeconds ?? 0) * 1000;
      out.push({
        ms: tsOf(a),
        to: off ? tsOf(off) : tsOf(a) + lengthMs,
        name: VISION_OBSCURING_AURAS[id]!,
        holder: u.id,
      });
    });
    for (const c of successesOf(u)) {
      const id = String(c.spellId);
      const name = VISION_OBSCURING_AREA_CASTS[id];
      if (name === undefined) continue;
      out.push({
        ms: tsOf(c),
        to: tsOf(c) + (spellEffectData[id]?.durationSeconds ?? 0) * 1000,
        name,
      });
    }
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  let marks: IMark[] | undefined;
  const near = (name: string, fromMs: number, toMs: number) =>
    (marks ??= marksOf(ctx)).some(
      (m) => m.name === name && m.ms <= toMs && m.to >= fromMs,
    );
  for (const line of ctx.lines) {
    const t = line.trim();
    const rj = REJECTED_RE.exec(t);
    const st = rj ? null : STOPPED_RE.exec(t);
    if (!rj && !st) continue;
    const head = (rj?.[4] ?? rj?.[1] ?? st?.[1])!;
    const fromS = secOf(head);
    // a [CAST STOPPED] refusal lands "refused N s in" after the cast's start
    const toS =
      rj?.[5] !== undefined
        ? secOf(rj[5])
        : st
          ? fromS + Math.ceil(Number(st[2]))
          : fromS;
    const named = rj ? rj[3] : st![3];
    const fromMs = ctx.start + fromS * 1000;
    const toMs = ctx.start + (toS + 1) * 1000;
    if (named !== undefined) {
      const C = "namedAbsent";
      ctx.bump(C);
      if (!near(named, fromMs - 6000, toMs))
        ctx.violate(
          C,
          named,
          fromMs,
          `${ctx.owner.id}#${fromS}#${named}`,
          `names ${named}, and no ${named} row lies within 6 s before ${head} to 1 s after the span`,
          t,
        );
      continue;
    }
    // a [REJECTED] line with no cause
    const C = "unnamedPresent";
    ctx.bump(C);
    const rows = ctx
      .rawStreams()
      .castFailed.filter(
        (h) =>
          h.unitGuid === ctx.owner.id &&
          VO.has(h.reason) &&
          h.tSeconds >= fromS &&
          h.tSeconds < toS + 1,
      );
    if (rows.length === 0) continue;
    const all = (marks ??= marksOf(ctx));
    const causeOf = (tS: number) => {
      const ms = ctx.start + tS * 1000;
      return all.find(
        (m) => m.holder !== ctx.owner.id && m.ms <= ms && ms <= m.to,
      )?.name;
    };
    const causes = rows.map((h) => causeOf(h.tSeconds));
    if (causes.every((c) => c !== undefined))
      ctx.violate(
        C,
        causes[0]!,
        fromMs,
        `${ctx.owner.id}#${fromS}#${rj![2]}`,
        `${rows.length} vision-obscured refusal(s) in the span, every one inside ${[...new Set(causes)].join(" / ")}; the line names no cause`,
        t,
      );
  }
  // anywhere else in the context or the menu: a cause the round never had
  const C = "namedAbsentRound";
  const seen = new Set<string>();
  for (const text of [ctx.text, ctx.menu])
    for (const row of text.split("\n")) {
      // a schema legend (`- "kick-eaten": …`) lists every wording the
      // producer can print, not a claim about this round
      if (LEGEND_ROW_RE.test(row)) continue;
      for (const m of row.matchAll(NAMED_ANY_RE)) seen.add(m[1]!);
    }
  for (const name of seen) {
    ctx.bump(C);
    if (!near(name, -Infinity, Infinity))
      ctx.violate(
        C,
        name,
        ctx.start,
        `${ctx.owner.id}#round#${name}`,
        `"vision obscured (${name})" printed; the round has no ${name} row`,
      );
  }
}
