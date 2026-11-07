/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/friendlyOffensiveTag.ts — class 12 of the round-7 audit (fact7 F21,
 * D11 / D72 / D79): what `[friendly offensive CD active]` claims on an
 * `[ENEMY DEF]` line.
 *
 * `offensiveTagWrong`, from the owner's side's own rows in the printed second:
 *  - kind `summonUntagged`: no tag, while a friend's offensive summon runs
 *    through all of the second (at both its ends);
 *  - kind `cdLessOnly`: a tag, while the only offensive aura on a friend that
 *    has no official cooldown (Archangel) is what is up: no friendly offensive
 *    aura WITH a cooldown, no summon at either end of the second, no debuff
 *    of theirs on an enemy.
 *  A summon has no aura, so whether one runs is the product's own reading
 *  (`offensiveSummonActiveAt`: an enemy-CD-window summon, its press plus the
 *  caster's length), asked at the second's two ends like the auras below
 *  (GH #173: a Force of Nature pressed at +85.52 s, 10 s, ran past the
 *  +95.165 s Greater Invisibility press the tag is about but not through the
 *  printed second 1:35 — the scan's own whole-second rule read it gone and
 *  filed the tag as Archangel's, 44333434 r1).
 */
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  offensiveCdOfAura,
  offensiveSummonActiveAt,
} from "@gladlog/analysis/src/utils/cooldowns";
import { ENEMY_DEF_TAG_RE_SRC } from "@gladlog/analysis/src/utils/enemyDefensives";
import { OFFENSIVE_AURA_EVIDENCE } from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";
import { offensiveEffectCdId } from "@gladlog/analysis/src/utils/spellDanger";

import { APPLIED, ev, type IRoundCtx, REMOVED, tsOf } from "./ctx";

export const CHECKS = ["offensiveTagWrong"] as const;

const LINE = new RegExp(String.raw`^\s*(\d+):(\d\d)\s+${ENEMY_DEF_TAG_RE_SRC}`);
const TAG = "[friendly offensive CD active]";

/** the offensive cooldowns whose auras a unit carries at `ms`, by its rows */
function offensiveAurasUp(unit: any, ms: number, side: Set<string>): string[] {
  const up = new Map<string, number>();
  for (const a of (unit.auraEvents ?? []) as any[]) {
    if (tsOf(a) > ms || !a.spellId || !side.has(a.srcUnitId)) continue;
    const key = `${a.spellId}|${a.srcUnitId}`;
    if (ev(a) === REMOVED) up.delete(key);
    else if (ev(a) === APPLIED) up.set(key, tsOf(a));
  }
  // an aura whose cast is logged apart (Arcane Surge 365362, Ascendance
  // 1219480, Summon Infernal 111685, Doom Winds 466772) is that cooldown's
  // effect: `offensiveCdOfAura` leaves those to their own table
  return [...up.keys()]
    .map((k) => k.split("|")[0]!)
    .map(
      (id) =>
        OFFENSIVE_AURA_EVIDENCE.get(id)?.cooldownId ?? offensiveCdOfAura(id),
    )
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
    const through = friends.find(
      (f: any) =>
        offensiveSummonActiveAt(f, lo) && offensiveSummonActiveAt(f, hi),
    );
    if (!tagged && through)
      ctx.violate(
        "offensiveTagWrong",
        "summonUntagged",
        lo,
        `${line.trim()}`,
        `summon of ${through.name} runs through the second`,
        line,
      );
    if (!tagged || through) continue;
    // the tag is a fact of the press instant inside the second: a summon
    // running at either end of it can be what it read
    if (
      friends.some(
        (f: any) =>
          offensiveSummonActiveAt(f, lo) || offensiveSummonActiveAt(f, hi),
      )
    )
      continue;
    // …and so can an aura up at either end
    const up = [...friends, ...enemies].flatMap((u: any) => [
      ...offensiveAurasUp(u, lo, side),
      ...offensiveAurasUp(u, hi, side),
    ]);
    if (up.length === 0) continue;
    // a charge's recharge is a cooldown (Ray of Frost, Soul Immolation, 60 s),
    // and an activation has its cooldown's (Radiant Glory's Avenging Wrath)
    if (
      up.every((id) => !effectiveCooldownSeconds(offensiveEffectCdId(id) ?? id))
    )
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
