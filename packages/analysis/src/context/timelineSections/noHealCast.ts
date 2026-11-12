/**
 * [YOU] [NO HEAL CAST] — a stretch before the round's first death (a
 * teammate's) in which the healer owner pressed no heal while free to
 * (T88, ruling R27). A fact line: it states the stretch and the dying
 * teammate's HP at its two ends, and names a form the log shows the healer
 * in. The reading is `noHealStretchesBeforeFirstDeath`.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { MANA_PRESSURE_LOW_PCT } from "../../analysis/candidates/mana";
import { noHealStretchesBeforeFirstDeath } from "../../utils/noHealCast";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitNoHealCastEntries(
  ctx: Pick<
    TimelineCtx,
    | "isHealer"
    | "owner"
    | "friends"
    | "enemies"
    | "_allUnits"
    | "matchStartMs"
    | "friendlyDeaths"
    | "enemyDeaths"
    | "rawStreams"
    | "addEntry"
    | "pid"
  > & { zoneId: string | undefined },
): void {
  if (!ctx.isHealer) return;
  const sec = (ms: number) => (ms - ctx.matchStartMs) / 1000;
  for (const s of noHealStretchesBeforeFirstDeath({
    owner: ctx.owner as ICombatUnit,
    friends: ctx.friends ?? [],
    enemies: ctx.enemies ?? [],
    allUnits: ctx._allUnits,
    startMs: ctx.matchStartMs,
    friendlyDeaths: ctx.friendlyDeaths,
    enemyDeaths: ctx.enemyDeaths,
    zoneId: ctx.zoneId,
    rawStreams: ctx.rawStreams,
    lowManaPct: MANA_PRESSURE_LOW_PCT,
  })) {
    const form = s.form
      ? `; in ${s.form.name}${s.form.fromMs === null ? "" : ` from ${fmtTime(Math.max(0, sec(s.form.fromMs)))}`}`
      : "";
    const hp =
      s.hpFromPct === null || s.hpToPct === null
        ? ""
        : ` ${Math.round(s.hpFromPct)}% → ${Math.round(s.hpToPct)}%`;
    ctx.addEntry(
      sec(s.fromMs),
      `${fmtTime(sec(s.fromMs))}–${fmtTime(sec(s.toMs))}  [YOU] [NO HEAL CAST]   ${((s.toMs - s.fromMs) / 1000).toFixed(1)}s with no heal pressed (free to cast${form}) — ${ctx.pid(s.targetName)}${hp}`,
    );
  }
}
