/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/friendlyOffensiveTag.ts — class 12 of the round-7 audit (fact7 F21,
 * D11 / D72 / D79): what `[friendly offensive CD active]` claims on an
 * `[ENEMY DEF]` line.
 *
 * `offensiveTagWrong`, from the owner's side's own rows in the printed second:
 *  - kind `summonUntagged`: no tag, while a friend's offensive summon pressed
 *    before the second runs through all of it on the spell's official length
 *    (a summon has no aura, so only the press and the length say so);
 *  - kind `cdLessOnly`: a tag, while the only offensive aura on a friend that
 *    has no official cooldown (Archangel) is what is up: no friendly offensive
 *    aura WITH a cooldown, no summon, no debuff of theirs on an enemy.
 */
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { SUMMON_SPELL_IDS } from "@gladlog/analysis/src/data/summonGenerated";
import { offensiveCdOfAura } from "@gladlog/analysis/src/utils/cooldowns";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";

import { APPLIED, ev, type IRoundCtx, REMOVED, successesOf, tsOf } from "./ctx";

export const CHECKS = ["offensiveTagWrong"] as const;

const LINE = /^\s*(\d+):(\d\d)\s+\[ENEMY DEF\]/;
const TAG = "[friendly offensive CD active]";

const summonRunning = (unit: any, lo: number, hi: number): any =>
  successesOf(unit).find((c: any) => {
    const id = String(c.spellId);
    const cd = spellEffectData[id]?.cooldownSeconds ?? 0;
    const d = spellEffectData[id]?.durationSeconds ?? 0;
    return (
      SUMMON_SPELL_IDS.has(id) &&
      OFFENSIVE_CD_SPELL_IDS.has(id) &&
      cd >= 30 &&
      d >= 2 &&
      tsOf(c) < lo &&
      tsOf(c) + d * 1000 > hi
    );
  });

/** the offensive cooldowns whose auras a unit carries at `ms`, by its rows */
function offensiveAurasUp(unit: any, ms: number, side: Set<string>): string[] {
  const up = new Map<string, number>();
  for (const a of (unit.auraEvents ?? []) as any[]) {
    if (tsOf(a) > ms || !a.spellId || !side.has(a.srcUnitId)) continue;
    const key = `${a.spellId}|${a.srcUnitId}`;
    if (ev(a) === REMOVED) up.delete(key);
    else if (ev(a) === APPLIED) up.set(key, tsOf(a));
  }
  return [...up.keys()]
    .map((k) => offensiveCdOfAura(k.split("|")[0]!))
    .filter((id): id is string => id !== undefined);
}

export function run(ctx: IRoundCtx): void {
  const friends = ctx.players.filter(
    (u: any) => u.info && u.reaction === ctx.owner?.reaction,
  );
  const enemies = ctx.players.filter((u: any) => !friends.includes(u));
  const side = new Set<string>(friends.map((u: any) => u.id));
  for (const line of ctx.lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    ctx.bump("offensiveTagWrong");
    const lo = ctx.start + (+m[1]! * 60 + +m[2]!) * 1000;
    const hi = lo + 999;
    const tagged = line.includes(TAG);
    const summon = friends
      .map((f: any) => summonRunning(f, lo, hi))
      .find(Boolean);
    if (!tagged && summon)
      ctx.violate(
        "offensiveTagWrong",
        "summonUntagged",
        lo,
        `${line.trim()}`,
        `summon ${summon.spellId} pressed +${tsOf(summon) - ctx.start}ms`,
        line,
      );
    if (!tagged || summon) continue;
    // the tag is a fact of the press instant inside the second: read both ends
    const up = [...friends, ...enemies].flatMap((u: any) => [
      ...offensiveAurasUp(u, lo, side),
      ...offensiveAurasUp(u, hi, side),
    ]);
    if (up.length === 0) continue;
    const pressedInSecond = friends.some((f: any) =>
      successesOf(f).some(
        (c: any) =>
          SUMMON_SPELL_IDS.has(String(c.spellId)) &&
          OFFENSIVE_CD_SPELL_IDS.has(String(c.spellId)) &&
          tsOf(c) >= lo &&
          tsOf(c) <= hi,
      ),
    );
    if (pressedInSecond) continue;
    if (up.every((id) => !spellEffectData[id]?.cooldownSeconds))
      ctx.violate(
        "offensiveTagWrong",
        "cdLessOnly",
        lo,
        `${line.trim()}`,
        `only up: ${[...new Set(up)].join(",")}`,
        line,
      );
  }
}
