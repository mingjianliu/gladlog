/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t181.ts — ticket T181 (round-14 D2 / D28 / D29): an accusation row
 * stands over a self-save its own unit pressed inside the judged window —
 * Alter Time (press or return) or Mass Invisibility
 * (`SELF_SAVE_ANSWER_IDS`), which are no percentage wall and sat in no
 * answer list.
 *
 *  - `slowResponseOverSelfSave`: a slow-defensive-response row the builder
 *    emits for a healer owner whose pressured unit has a SUCCESS cast of
 *    the set inside the engine's response span (`burstResponseSpanMs`). Kind = the spell. Counted: every row the
 *    builder emits.
 *  - `cdHoardedOverOwnReturn`: a cd-hoarded menu row about the owner's OWN
 *    crisis whose owner has a SUCCESS cast of the set inside [t −
 *    `RESPONSE_PRE_MS`, t + `CD_HOARD_RESPONSE_S`]. Kind = the spell.
 *    Counted: every own-crisis cd-hoarded row of the menu.
 */
import {
  burstResponseSpanMs,
  burstWindowDecisionPoints,
  SELF_SAVE_ANSWER_IDS,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { burstWindowResponseEvents } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { CD_HOARD_RESPONSE_S } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { RESPONSE_PRE_MS } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { lookupBurstWindowPrior } from "@gladlog/analysis/src/data/burstWindowPrior";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { LogEvent } from "@gladlog/parser-compat";

import { type IRoundCtx, nameOf, tsOf } from "./ctx";

export const CHECKS = [
  "slowResponseOverSelfSave",
  "cdHoardedOverOwnReturn",
] as const;

const savesOf = (unit: any, fromMs: number, toMs: number): any[] =>
  ((unit?.spellCastEvents ?? []) as any[]).filter(
    (c) =>
      c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      SELF_SAVE_ANSWER_IDS.has(String(c.spellId)) &&
      tsOf(c) >= fromMs &&
      tsOf(c) <= toMs,
  );

const HOARD_ROW =
  /id=cd-hoarded:\S+ type=cd-hoarded t=(\d+)s units=(\S+) facts=\{t=\d+, crisisUnit=([^,]+),/g;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  if (isHealerSpec(owner.spec)) {
    let points: ReturnType<typeof burstWindowDecisionPoints> = [];
    try {
      points = burstWindowDecisionPoints(ctx.legacy, {
        friendlyReaction: owner.reaction,
      });
    } catch {
      points = [];
    }
    const bracket: string = ctx.legacy?.startInfo?.bracket ?? "";
    const rows = burstWindowResponseEvents(points, owner, {
      lookup: (id: string) => lookupBurstWindowPrior(bracket, id),
    });
    for (const row of rows) {
      ctx.bump("slowResponseOverSelfSave");
      const t = Number(row.id.split(":").pop());
      const p = points.find((x) => x.tSec === t);
      if (!p?.pressured) continue;
      const unit = ctx.units.find((u: any) => u.id === p.pressured!.unitId);
      const tMs = ctx.start + t * 1000;
      // the engine's own span (its start from the opener's ms, R113)
      const span = burstResponseSpanMs(p.tMs, p.leadMs);
      const saves = savesOf(unit, span.w0, span.w1);
      if (saves.length === 0) continue;
      const first = saves[0];
      ctx.violate(
        "slowResponseOverSelfSave",
        `${nameOf(first.spellId, first.spellName)} ${first.spellId}`,
        tMs,
        `${ctx.roundKey}|${row.id}`,
        `window at ${t}s: the pressured unit pressed ${saves.map((c) => `${nameOf(c.spellId, c.spellName)} ${((tsOf(c) - tMs) / 1000).toFixed(1)}s`).join(", ")}; low ${p.pressured.minHpPct ?? "?"}%`,
      );
    }
  }
  for (const m of ctx.menu.matchAll(HOARD_ROW)) {
    if (m[3] !== ctx.ownerName) continue;
    ctx.bump("cdHoardedOverOwnReturn");
    const tMs = ctx.start + Number(m[1]) * 1000;
    const saves = savesOf(
      owner,
      tMs - RESPONSE_PRE_MS,
      tMs + CD_HOARD_RESPONSE_S * 1000,
    );
    if (saves.length === 0) continue;
    const first = saves[0];
    ctx.violate(
      "cdHoardedOverOwnReturn",
      `${nameOf(first.spellId, first.spellName)} ${first.spellId}`,
      tMs,
      `${ctx.roundKey}|${owner.id}|${m[1]}`,
      `own crisis at ${m[1]}s: the owner pressed ${saves.map((c) => `${nameOf(c.spellId, c.spellName)} ${((tsOf(c) - tMs) / 1000).toFixed(1)}s`).join(", ")}`,
    );
  }
}
