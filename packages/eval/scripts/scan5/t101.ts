/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, deathRecords) */
/**
 * scan5/t101.ts — ticket T101: a control stripped by the death teardown read
 * as ended before the death. A dying unit's auras come off in a burst from
 * its lethal hit to its UNIT_DIED; a stun that would have run on is REMOVED
 * in that burst, some tens of ms before the UNIT_DIED, and a reader that
 * takes the REMOVED as the stun's end finds the holder "free" for that gap.
 * 77310154 r0 0:48: Terror of the Skies stripped at 48.707, UNIT_DIED
 * 48.772, `Alter Time … (free to press it for the last 0.1s before the
 * death)`.
 *
 *  - `freeAfterDeathStrip`: a `[DEFENSIVE AVAILABLE] X(…): S available but
 *    unused (free to press it for the last Fs before the death)` with F > 0
 *    about the unit that died, while a control or silence an enemy put on it
 *    (APPLIED before the death) was REMOVED inside its death teardown
 *    (`deathTeardownWindowsMs` / `removedInDeathTeardown`, the window
 *    lookup) no earlier than the printed stretch's start (death − F, half a
 *    printed digit of slack) — the stretch is the teardown gap, not free
 *    time. A stun counts only against a spell the usable-while-stunned table
 *    does not let through, a silence only against a silenceable one.
 *    Kind = the stripped aura's name.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  isHardCcAura,
  isSilenceEffectAura,
} from "@gladlog/analysis/src/utils/cannotCastIntervals";
import {
  extractMajorCooldowns,
  playerTalentIdSets,
  usableWhileStunned,
} from "@gladlog/analysis/src/utils/cooldowns";
import { isStunDrAura } from "@gladlog/analysis/src/utils/drAnalysis";
import { isUnsilenceableCast } from "@gladlog/analysis/src/utils/spellMechanics";
import {
  deathTeardownWindowsMs,
  removedInDeathTeardown,
} from "@gladlog/analysis/src/utils/unitDeath";

import { APPLIED, ev, type IRoundCtx, REMOVED, secOf, tsOf } from "./ctx";

export const CHECKS = ["freeAfterDeathStrip"] as const;

const AVAILABLE =
  /^\s*(\d+:\d\d)\s+\[DEFENSIVE AVAILABLE\]\s+(\d+)\([^)]*\): (.+?)(?: \([^)]*\))? available but unused \(free to press it for the last ([\d.]+)s before the death\)/;

export function run(ctx: IRoundCtx): void {
  const C = "freeAfterDeathStrip";
  for (const line of ctx.lines) {
    const m = AVAILABLE.exec(line);
    if (!m) continue;
    const freeS = Number(m[4]);
    const unit = ctx.unitOfPid(m[2]);
    if (!unit) continue;
    const sec = secOf(m[1]!);
    const death = ((unit.deathRecords ?? []) as any[])
      .map((d) => d.timestamp as number)
      // the KILL SEQUENCE line sits at its bracket's second, at or before the
      // death it is about
      .find((t) => {
        const d = Math.floor((t - ctx.start) / 1000);
        return d >= sec && d <= sec + 5;
      });
    // the holder is not the unit that died: none of its auras were stripped
    if (death === undefined) continue;
    ctx.bump(C);
    if (freeS <= 0) continue;
    const spellId = (
      extractMajorCooldowns(unit, ctx.legacy, { withBaselineOnly: true }) as any[]
    ).find((cd) => cd.spellName === m[3])?.spellId as string | undefined;
    if (spellId === undefined) continue;
    const enemy = new Set(
      ctx.units
        .filter((u) => u.reaction !== unit.reaction)
        .map((u) => u.id as string),
    );
    const windows = deathTeardownWindowsMs(unit);
    const pvp = playerTalentIdSets(unit).pvpTalentIds;
    const auras = ((unit.auraEvents ?? []) as any[]).filter(
      (a) => a.destUnitId === unit.id,
    );
    const stretchFrom = death - freeS * 1000 - 50;
    let hit: string | undefined;
    auras.forEach((a, i) => {
      if (hit || ev(a) !== APPLIED || !enemy.has(a.srcUnitId)) return;
      if (tsOf(a) >= death) return;
      const id = String(a.spellId ?? "");
      const stun = isStunDrAura(id);
      const blocks = isHardCcAura(id)
        ? !(stun && usableWhileStunned(spellId, pvp))
        : isSilenceEffectAura(id) && !isUnsilenceableCast(spellId);
      if (!blocks) return;
      const end = auras
        .slice(i + 1)
        .find((r) => ev(r) === REMOVED && String(r.spellId) === id);
      if (!end) return;
      const r = tsOf(end);
      if (r < stretchFrom || r > death) return;
      if (!removedInDeathTeardown(windows, r)) return;
      hit = id;
    });
    if (!hit) continue;
    ctx.violate(
      C,
      getEnglishSpellName(hit, hit),
      death,
      `${unit.id}#${spellId}#${death}`,
      `${m[3]} free ${freeS}s before the death, but ${getEnglishSpellName(hit, hit)} was stripped by the death teardown`,
      line.trim(),
    );
  }
}
