/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, healIn, advancedActions) */
/**
 * scan5/t189.ts — pipeline T189 (fact14 D12): the HP an `[ENEMY DEF]` line
 * prints for a press that is a cast of another spell than the line's aura
 * (Peaceweaver 353319 put up by Restoral 388615 / Revival 115310 — on the
 * monk and on each teammate it covers) is the HP just before that press's
 * own heal, as on every other press line (signed exception (1), ruling
 * 2026-11-01: the press's own direct heal row is the cut).
 *
 *  - `enemyDefTriggerPressHp`: every event of the producer's own selection
 *    (`enemyDefensiveEvents` of the owner's enemies, read to the round's
 *    end) that names its press as another cast (`pressSpellId`) or another
 *    unit's (`pressSrcUnitId`), with a direct heal of that cast's id from
 *    the presser on the line's unit logged in the `PRESS_EFFECT_LEAD_MS`
 *    before the press. Truth is read off the rows: the unit's last HP
 *    reading logged before the earliest such heal row — or, on a carrier
 *    of another unit's press with no heal of anyone's on it in that lead,
 *    before that press's cast row (`pressLineIndex`; codex
 *    85-tk-L1-T189-1 #1, 517810f2 r6 0:42). The printed number
 *    is the rendered line's `(at N% HP)`; a violation when it differs or
 *    the line prints none
 *    (65145d1c r0: the monk's own Peaceweaver printed 100 %, the reading
 *    before Restoral's heal row 94 %). Kind = the aura's name ← the press's.
 */
import {
  getSortedAdvancedActions,
  hpReadingMaxHp,
} from "@gladlog/analysis/src/utils/advancedActions";
import {
  HP_SAMPLE_RADIUS_MS,
  PRESS_EFFECT_LEAD_MS,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  enemyDefensiveEvents,
  type IEnemyDefensiveEvent,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  type AtomicArenaCombat,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { fmtS, type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["enemyDefTriggerPressHp"] as const;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function run(ctx: IRoundCtx): void {
  const C = "enemyDefTriggerPressHp";
  if (!ctx.owner) return;
  const combat = ctx.legacy as AtomicArenaCombat;
  const enemies = ctx.players.filter(
    (u) => u.reaction !== ctx.owner.reaction,
  ) as ICombatUnit[];
  const used = new Set<number>();
  for (const enemy of enemies) {
    const events: IEnemyDefensiveEvent[] = enemyDefensiveEvents(
      enemy,
      enemies,
      combat,
      ctx.roundEndAt,
    );
    for (const d of events) {
      if (d.pressSeconds === undefined) continue;
      if (d.pressSpellId === undefined && d.pressSrcUnitId === undefined)
        continue;
      if (d.kind !== "self" && d.kind !== "immune") continue;
      const pressId = d.pressSpellId ?? d.spellId;
      const presser = d.pressSrcUnitId ?? enemy.id;
      const pressMs = combat.startTime + Math.round(d.pressSeconds * 1000);
      const heals = ((enemy.healIn ?? []) as any[])
        .filter(
          (h) =>
            h.spellId === pressId &&
            h.srcUnitId === presser &&
            h.logLine.event !== LogEvent.SPELL_PERIODIC_HEAL &&
            h.logLine.timestamp <= pressMs &&
            h.logLine.timestamp >= pressMs - PRESS_EFFECT_LEAD_MS &&
            h.logLine.lineIndex !== undefined,
        )
        .sort(
          (a, b) =>
            a.logLine.timestamp - b.logLine.timestamp ||
            a.logLine.lineIndex - b.logLine.lineIndex,
        );
      const heal = heals[0];
      // no heal of the press's: on a carrier of another unit's press with
      // no heal of anyone's in the lead, the cut is that press's cast row
      // (ruling 2026-10-23, read on the carrier)
      const cut =
        heal !== undefined
          ? {
              ms: heal.logLine.timestamp as number,
              line: heal.logLine.lineIndex as number,
              what: `the press's own ${nameOf(pressId, pressId)} heal row`,
            }
          : d.pressLineIndex !== undefined &&
              !((enemy.healIn ?? []) as any[]).some(
                (h) =>
                  h.logLine.timestamp <= pressMs &&
                  h.logLine.timestamp >= pressMs - PRESS_EFFECT_LEAD_MS,
              )
            ? {
                ms: pressMs,
                line: d.pressLineIndex,
                what: `the presser's ${nameOf(pressId, pressId)} cast row`,
              }
            : undefined;
      if (!cut) continue;
      // the unit's last reading logged before the cut
      const before = getSortedAdvancedActions(enemy)
        .filter(
          (a) =>
            a.advancedActorId === enemy.id &&
            a.advancedActorMaxHp > 0 &&
            a.logLine.lineIndex !== undefined &&
            (a.logLine.timestamp < cut.ms ||
              (a.logLine.timestamp === cut.ms &&
                a.logLine.lineIndex < cut.line)),
        )
        .at(-1);
      if (!before || pressMs - before.logLine.timestamp > HP_SAMPLE_RADIUS_MS)
        continue;
      // capped as every printed HP is (a reading over the max reads 100)
      const truth = Math.min(
        100,
        Math.round(
          (before.advancedActorCurrentHp / hpReadingMaxHp(enemy, before)) * 100,
        ),
      );
      const pid = ctx.pidOf(enemy.name);
      if (pid === undefined) continue;
      // the event's own rendered line — each line stands for one event
      // (two presses of one second on one unit), found with or without an
      // HP: a line that prints none where the log has the reading is a miss
      const re = new RegExp(
        `^\\s*${esc(fmtS(d.atSeconds))}\\s+\\[ENEMY DEF\\]\\s+${esc(pid)}\\([^)]*\\) \\([^)]*\\): ${esc(d.spellName)} \\((?:.*\\(at (\\d+)% HP\\))?`,
      );
      const at = ctx.lines.findIndex((l, i) => !used.has(i) && re.test(l));
      if (at < 0) continue;
      used.add(at);
      const printed = re.exec(ctx.lines[at]!)?.[1] ?? "no";
      ctx.bump(C);
      if (printed !== String(truth))
        ctx.violate(
          C,
          `${d.spellName} ← ${nameOf(pressId, pressId)}`,
          pressMs,
          `${ctx.roundKey}|${enemy.id}|${d.spellId}|${pressMs}`,
          `${enemy.name} ${d.spellName} at +${d.pressSeconds.toFixed(3)} s: printed ${printed}% HP, ${truth}% before ${cut.what}`,
        );
    }
  }
}
