/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * t29 (pipeline 2026-11-08) class check — T29.
 *
 *  - pressEffectRefusedListed: a `[RES]` row's `enemy:` entry `X/<spec>(Ns
 *    left)` whose holder's latest press of X at or before the row is one the
 *    game refused — the product's own predicate, `pressEffectRefusedAtCast`
 *    (a SPELL_MISSED of the cast or an effect id by the caster in the
 *    press's start window, nothing of it landed) — on a row after the
 *    press's second: a refused press ran for no time. b74d7bf6 r1 2:45:
 *    Deathmark met two IMMUNE and put no 360194 on anyone; `[RES]` listed it
 *    to 3:00. Kind: `refused <missType>` (the first miss's type). Counted:
 *    every enemy entry (no `(no press)` tag) whose holder — spec unique on
 *    the roster — has a press of X at or before the row.
 */
import {
  parseResRow,
  splitResList,
} from "@gladlog/analysis/src/context/resRow";
import { effectSpanIdsOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { pressEffectRefusedAtCast } from "@gladlog/analysis/src/utils/enemyCDs";

import { type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["pressEffectRefusedListed"] as const;

export function run(ctx: IRoundCtx): void {
  pressEffectRefusedListed(ctx);
}

const ROSTER =
  /<unit\s+id="(\d+)"\s+name="[^"]+"\s+spec="([^"]+)"\s+role="enemy"/;
const ENTRY = /^(.*)\/([^/]+?)\((\d+)s left\)$/;

function pressEffectRefusedListed(ctx: IRoundCtx): void {
  const lines = ctx.text.split("\n");
  const pidsOfSpec = new Map<string, string[]>();
  for (const l of lines) {
    const r = ROSTER.exec(l);
    if (r) pidsOfSpec.set(r[2]!, [...(pidsOfSpec.get(r[2]!) ?? []), r[1]!]);
  }
  const combat = { units: ctx.legacy.units };
  let atS = 0;
  for (const l of lines) {
    const t = /^(\d+:\d{2})\s/.exec(l);
    if (t) atS = secOf(t[1]!);
    const enemy = parseResRow(l)?.enemy;
    if (!enemy) continue;
    for (const entry of splitResList(enemy)) {
      const e = ENTRY.exec(entry.trim());
      if (!e || / \(no press\)$/.test(e[1]!)) continue;
      const pids = pidsOfSpec.get(e[2]!) ?? [];
      if (pids.length !== 1) continue;
      const holder = ctx.unitOfPid(pids[0]);
      if (!holder) continue;
      const rowEndMs = ctx.start + (atS + 1) * 1000 - 1;
      const presses = successesOf(holder)
        .filter((c: any) => nameOf(c.spellId, c.spellName) === e[1])
        .sort((x: any, y: any) => tsOf(x) - tsOf(y));
      const i = presses.reduce(
        (last: number, c: any, k: number) => (tsOf(c) <= rowEndMs ? k : last),
        -1,
      );
      if (i < 0) continue;
      ctx.bump("pressEffectRefusedListed");
      const press = presses[i];
      const p = tsOf(press);
      // a row in the press's own second may list it
      if (Math.floor((p - ctx.start) / 1000) >= atS) continue;
      const next = presses
        .slice(i + 1)
        .find((c: any) => String(c.spellId) === String(press.spellId));
      const id = String(press.spellId);
      if (
        !pressEffectRefusedAtCast(
          holder,
          id,
          p,
          next ? tsOf(next) : Infinity,
          combat,
        )
      )
        continue;
      const miss = ((holder.missesOut ?? []) as any[]).find(
        (m) =>
          m.srcUnitId === holder.id &&
          m.missType !== "ABSORB" &&
          effectSpanIdsOfCast(id).has(String(m.spellId)) &&
          tsOf(m) >= p,
      );
      const kind = `refused ${miss?.missType ?? "?"}`;
      ctx.violate(
        "pressEffectRefusedListed",
        kind,
        ctx.start + atS * 1000,
        `${holder.name}:${Math.floor((p - ctx.start) / 1000)}:${e[1]}`,
        `${holder.name}: ${e[1]} pressed at ${((p - ctx.start) / 1000).toFixed(3)}s, refused (${kind}); [RES] ${atS}s lists ${entry.trim()}`,
        l.trim().slice(0, 220),
      );
    }
  }
}
