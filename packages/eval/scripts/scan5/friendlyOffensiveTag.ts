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
 *  - kind `noAuraLineUntagged`: an aura-less immunity line (`(immune, no
 *    aura logged)`) with no tag, while an offensive aura with a cooldown
 *    that the owner's side put up (on a friend, or as their debuff on an
 *    enemy) is up at both ends of the printed second — so at the press,
 *    whatever its millisecond (fact12 D14: that line form skipped the shared
 *    predicate under a warrior's Avatar + Recklessness);
 *  - kind `auraUntagged` (not in the total): the same reading on every other
 *    line form — a pointer list, not a defect count. Pipeline T30 (605 files,
 *    base cap aeddaf5f7): 198 facts while the scan kept an aura with no
 *    logged end up past its length; 154, all a Demonic form (162264 with no
 *    Metamorphosis press), once it asked the product's own window; 0 once
 *    an evidence aura also asks the tag's cooldown filter (user ruling
 *    2026-11-09: the tag reads spent cooldowns only).
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
  hasOffensiveSpellActive,
  isEnemyCdWindowSpell,
  offensiveCdOfAura,
  offensiveSummonActiveAt,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  ENEMY_DEF_NO_AURA_LOGGED,
  ENEMY_DEF_TAG_RE_SRC,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { OFFENSIVE_AURA_EVIDENCE } from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";
import { offensiveEffectCdId } from "@gladlog/analysis/src/utils/spellDanger";

import { APPLIED, ev, type IRoundCtx, REFRESH, tsOf } from "./ctx";

export const CHECKS = ["offensiveTagWrong"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "offensiveTagWrong|auraUntagged",
]);

const LINE = new RegExp(String.raw`^\s*(\d+):(\d\d)\s+${ENEMY_DEF_TAG_RE_SRC}`);
const TAG = "[friendly offensive CD active]";

/** the offensive cooldowns whose auras a unit carries at `ms`: an aura of
 * the owner's side applied to it by then that the product's own window
 * (`hasOffensiveSpellActive`, asked for that aura and its caster alone) also
 * reads up. The product's window, not a copy of it, decides when an aura
 * ends (its REMOVED, a BROKEN no REMOVED supersedes; with no end logged its
 * official length from its latest APPLIED / REFRESH; a pressed
 * Metamorphosis' occurrence from its press):
 * pipeline T30, 103 of `auraUntagged`'s 487 on 605 were a Colossus Smash /
 * Power Infusion / Deathmark … the scan read up 14–110 s after it was
 * applied (codex 85-tk-D-T30-1 / -1b: a re-implemented length missed the
 * press-backed Metamorphosis twice). The tag's own cooldown filter
 * (`isEnemyCdWindowSpell`) is asked of an evidence aura's occurrence only
 * (a Demonic form spends no cooldown); any other aura is read up whatever
 * its cooldown, which the readings below judge. */
function offensiveAurasUp(
  unit: any,
  ms: number,
  side: Set<string>,
  round: { startTime: number; endTime: number },
): string[] {
  const up = new Set<string>();
  for (const a of (unit.auraEvents ?? []) as any[])
    if (
      tsOf(a) <= ms &&
      a.spellId &&
      side.has(a.srcUnitId) &&
      (ev(a) === APPLIED || ev(a) === REFRESH)
    )
      up.add(`${a.spellId}|${a.srcUnitId}`);
  for (const key of up) {
    const [id, src] = key.split("|") as [string, string];
    // the aura, and the cooldown the product files its occurrence under (an
    // evidence aura's, or `offensiveCdOfAura`'s with the caster's spec:
    // 383410's generic occurrence is 194223's, codex 85-tk-D-T30-1c)
    const spec = src === unit.id ? unit.spec : undefined;
    // an aura neither the product nor the mapping below files under an
    // offensive cooldown is never one (and asking costs a pass over the
    // unit's rows: 605 files 210 s → 3597 s of module time without this)
    if (
      !OFFENSIVE_AURA_EVIDENCE.has(id) &&
      offensiveCdOfAura(id, spec) === undefined &&
      offensiveCdOfAura(id) === undefined
    ) {
      up.delete(key);
      continue;
    }
    const ids = new Set(
      [
        id,
        OFFENSIVE_AURA_EVIDENCE.get(id)?.cooldownId,
        offensiveCdOfAura(id, spec),
      ].filter((x): x is string => x !== undefined),
    );
    // an evidence aura is up as the product's occurrence of it, and the tag
    // counts an occurrence only when it spends a cooldown (its own filter,
    // `isEnemyCdWindowSpell`): a Demonic form, 162264 with no Metamorphosis
    // press, is no running cooldown (user ruling 2026-11-09, pipeline T30).
    // Other auras keep the bare ids: the tagged reading needs a cooldown-less
    // one (Archangel) to see `cdLessOnly`.
    const asked = OFFENSIVE_AURA_EVIDENCE.has(id)
      ? (s: string, sSpec?: unknown) =>
          ids.has(s) && isEnemyCdWindowSpell(s, sSpec)
      : (s: string) => ids.has(s);
    if (!hasOffensiveSpellActive(unit, ms, new Set([src]), asked, round))
      up.delete(key);
  }
  // an aura whose cast is logged apart (Arcane Surge 365362, Ascendance
  // 1219480, Summon Infernal 111685, Doom Winds 466772) is that cooldown's
  // effect: `offensiveCdOfAura` leaves those to their own table
  return [...up]
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
  // the bounds the product's tag reads (setup.ts `roundBounds`)
  const round = { startTime: ctx.start, endTime: ctx.end };
  // one answer per unit and instant in this context (a second's two ends are
  // asked for the untagged and the tagged reading alike)
  const memo = new Map<string, string[]>();
  const aurasUp = (u: any, ms: number): string[] => {
    const k = `${u.id}|${ms}`;
    let r = memo.get(k);
    if (r === undefined)
      memo.set(k, (r = offensiveAurasUp(u, ms, side, round)));
    return r;
  };
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
    if (!tagged) {
      const lit = (ms: number) =>
        new Set(
          [...friends, ...enemies]
            .flatMap((u: any) => aurasUp(u, ms))
            .filter(
              (id) => !!effectiveCooldownSeconds(offensiveEffectCdId(id) ?? id),
            ),
        );
      const atLo = lit(lo);
      const both = [...lit(hi)].filter((id) => atLo.has(id));
      if (both.length > 0)
        ctx.violate(
          "offensiveTagWrong",
          line.includes(`, ${ENEMY_DEF_NO_AURA_LOGGED})`)
            ? "noAuraLineUntagged"
            : "auraUntagged",
          lo,
          `${line.trim()}`,
          `up through the second: ${both.join(",")}`,
          line,
        );
    }
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
      ...aurasUp(u, lo),
      ...aurasUp(u, hi),
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
