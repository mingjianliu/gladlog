/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t253.ts — pipeline T253 (ruling R106, user 2026-11-22; GH #225-A2):
 * a teammate's kick, or a teammate's pet's, the log refused IMMUNE on an
 * enemy player printed nothing, while the same kick by an enemy on our team
 * prints `[KICK]   X's Skull Bash on <unit> missed — IMMUNE[ (aura)]`.
 *
 * The rows are the producer's own selection (`immuneKickRows` with
 * `teammateKickerUnit`, the pair `emitKickEntries` prints from) — never a
 * second reading of the miss rows — up to the round's end of play
 * (`roundEndAt`), where the timeline stops.
 *
 *  - `teammateImmuneKickLine`, kinds (a line and a row pair off one to one,
 *    by second, kicking player, kick and target)
 *    - `noLine`: a selected row with no `[KICK] <that teammate>['s pet]'s
 *      <kick> on <that enemy> missed — IMMUNE` line left for it in its second;
 *    - `lineNoRow`: such a line on an enemy with no selected row left for it.
 */
import {
  immuneKickRows,
  teammateKickerUnit,
} from "@gladlog/analysis/src/context/timelineSections/kick";
import { SUMMON_KIND_RE_SRC } from "@gladlog/analysis/src/utils/summonKind";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { fmtS, type IRoundCtx, nameOf, secOf } from "./ctx";

export const CHECKS = ["teammateImmuneKickLine"] as const;

/** 1 = m:ss, 2 = the kicking player's pid, 3 = the kick, 4 = the target's pid */
const LINE = new RegExp(
  String.raw`^(\d+:\d\d) {2}\[KICK\] {3}(\d+)\([^()]*\)(?:'s ${SUMMON_KIND_RE_SRC})?'s (.+) on (\d+)\([^()]*\) missed — IMMUNE`,
);

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  // the capture's own sides (`splitTeams`): the owner's reaction and the
  // opposite one, never a neutral unit
  const other =
    owner.reaction === CombatUnitReaction.Friendly
      ? CombatUnitReaction.Hostile
      : CombatUnitReaction.Friendly;
  const friends = ctx.players.filter((p: any) => p.reaction === owner.reaction);
  const enemies = ctx.players.filter((p: any) => p.reaction === other);
  const sides = { friends, enemies, allUnits: ctx.units, owner };
  const playerOf = (name: string, unitId?: string) =>
    teammateKickerUnit(sides, name, unitId);
  const rows = immuneKickRows({
    victims: enemies,
    kickerPlayerOf: playerOf,
    units: ctx.units,
    fromMs: ctx.start,
  }).filter((r) => r.m.timestamp <= ctx.roundEndAt);
  const enemyPids = new Set(enemies.map((e: any) => ctx.pidOf(e.name)));
  const left = new Map<string, string[]>();
  for (const l of ctx.lines) {
    const m = LINE.exec(l.trim());
    if (!m || !enemyPids.has(m[4])) continue;
    const key = `${secOf(m[1]!)}|${m[2]}|${m[3]}|${m[4]}`;
    left.set(key, [...(left.get(key) ?? []), l.trim()]);
  }
  for (const r of rows) {
    const s = Math.floor((r.m.timestamp - ctx.start) / 1000);
    const spell = nameOf(r.m.spellId, r.m.spellName ?? "interrupt");
    const by = playerOf(r.m.srcUnitName, r.m.srcUnitId);
    const key = `${s}|${by ? ctx.pidOf(by.name) : "?"}|${spell}|${ctx.pidOf(r.victim.name)}`;
    ctx.bump("teammateImmuneKickLine");
    const lines = left.get(key);
    if (lines?.length) {
      lines.shift();
      continue;
    }
    ctx.violate(
      "teammateImmuneKickLine",
      "noLine",
      r.m.timestamp,
      `${r.kicker.id}|${r.victim.id}|${r.m.timestamp}`,
      `${r.kicker.name}'s ${spell} refused IMMUNE on ${r.victim.name} at ${fmtS(s)}: no line`,
    );
  }
  for (const [key, lines] of left)
    for (const line of lines)
      ctx.violate(
        "teammateImmuneKickLine",
        "lineNoRow",
        ctx.start + Number(key.split("|")[0]) * 1000,
        `${owner.id}|${key}`,
        `line with no refused teammate kick left for it in its second`,
        line,
      );
}
