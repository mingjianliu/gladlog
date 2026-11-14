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
 *    whose holder is the unit that died — a `[KILL]` of the first death
 *    second after the line names it — while a control or silence an enemy
 *    put on it (APPLIED before the death, closed by its own caster's
 *    REMOVED) was REMOVED inside its death teardown
 *    (`deathTeardownWindowsMs` / `removedInDeathTeardown`) and not at its
 *    natural end (official length at a DR step). Such a control held to the
 *    death, so no stretch before it was free. A stun counts only against a
 *    spell the usable-while-stunned table does not let through, a silence
 *    only against a silenceable one. Kind = the stripped aura's name.
 */
import {
  ccFullDurationSeconds,
  getEnglishSpellName,
} from "@gladlog/analysis/src/data/spellEffectData";
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
  auraRanItsLength,
  deathTeardownWindowsMs,
  removedInDeathTeardown,
} from "@gladlog/analysis/src/utils/unitDeath";

import { APPLIED, ev, type IRoundCtx, REMOVED, secOf, tsOf } from "./ctx";

export const CHECKS = ["freeAfterDeathStrip"] as const;

const AVAILABLE =
  /^\s*(\d+:\d\d)\s+\[DEFENSIVE AVAILABLE\]\s+(\d+)\([^)]*\): (.+?)(?: \([^)]*\))? available but unused \(free to press it for the last ([\d.]+)s before the death\)/;

const KILL = /^\s*(\d+:\d\d)\s+\[KILL\]\s+(\d+)\(/;

/** The deaths the `[DEFENSIVE AVAILABLE]` line at `idx` is about: the
 * `[KILL]` lines of the first death second after it (codex 85-tk-L-T101-1
 * #3: a line about a mate's death is not about the holder's own later
 * one). */
function killsAfter(
  lines: readonly string[],
  idx: number,
): { sec: number; pids: string[] } | undefined {
  let sec: number | undefined;
  const pids: string[] = [];
  for (let j = idx + 1; j < lines.length; j++) {
    const k = KILL.exec(lines[j]!);
    if (!k) continue;
    const s = secOf(k[1]!);
    if (sec !== undefined && s !== sec) break;
    sec = s;
    pids.push(k[2]!);
  }
  return sec === undefined ? undefined : { sec, pids };
}

export function run(ctx: IRoundCtx): void {
  const C = "freeAfterDeathStrip";
  ctx.lines.forEach((line, idx) => {
    const m = AVAILABLE.exec(line);
    if (!m) return;
    const freeS = Number(m[4]);
    const unit = ctx.unitOfPid(m[2]);
    if (!unit) return;
    // the holder is not the unit that died: none of its auras were stripped
    const kills = killsAfter(ctx.lines, idx);
    if (!kills?.pids.includes(m[2]!)) return;
    const death = ((unit.deathRecords ?? []) as any[])
      .map((d) => d.timestamp as number)
      .find((t) => Math.floor((t - ctx.start) / 1000) === kills.sec);
    if (death === undefined) return;
    ctx.bump(C);
    if (freeS <= 0) return;
    const spellId = (
      extractMajorCooldowns(unit, ctx.legacy, {
        withBaselineOnly: true,
      }) as any[]
    ).find((cd) => cd.spellName === m[3])?.spellId as string | undefined;
    if (spellId === undefined) return;
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
      // closed by its own caster's REMOVED (codex 85-tk-L-T101-1 #4: two
      // Hammers of Justice overlap); a break ends it whoever broke it
      const end = auras
        .slice(i + 1)
        .find(
          (r) =>
            String(r.spellId) === id &&
            ((ev(r) === REMOVED && r.srcUnitId === a.srcUnitId) ||
              String(ev(r)).startsWith("SPELL_AURA_BROKEN")),
        );
      if (!end || ev(end) !== REMOVED) return;
      const r = tsOf(end);
      // stripped by the death, whenever in its teardown: the control held
      // to the death, so no stretch before it was free, whatever else ended
      // earlier (codex 85-tk-L-T101-1 #5) — unless the removal is its
      // natural end at a DR step
      if (r > death || !removedInDeathTeardown(windows, r)) return;
      const fullS = ccFullDurationSeconds(id);
      if (
        fullS !== undefined &&
        [1, 0.5, 0.25].some((f) =>
          auraRanItsLength(r, tsOf(a) + fullS * f * 1000),
        )
      )
        return;
      hit = id;
    });
    if (!hit) return;
    ctx.violate(
      C,
      getEnglishSpellName(hit, hit),
      death,
      `${unit.id}#${spellId}#${death}`,
      `${m[3]} free ${freeS}s before the death, but ${getEnglishSpellName(hit, hit)} was stripped by the death teardown`,
      line.trim(),
    );
  });
}
