/**
 * Spell outcomes the log records and the timeline did not state — Grounding,
 * reflect and Sanctuary outcomes, the owner's rejected casts and similar
 * result lines, each naming who it happened to.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import {
  fmtTime,
  fmtWholeSeconds,
  fmtWholeSecondsOrZero,
  toRenderSecond,
} from "../../utils/renderGrid";
import {
  groundedControls,
  type IRejectRun,
  ownerRejectRuns,
  reflectedSpells,
  REJECT_WHY,
  sanctuaryRemovals,
} from "../spellOutcomeLines";
import { resolveSummonOwner } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function emitSpellOutcomeEntries(
  ctx: Pick<
    TimelineCtx,
    | "actorLabel"
    | "owner"
    | "_allUnits"
    | "matchEndSeconds"
    | "matchStartMs"
    | "friends"
    | "enemies"
    | "pid"
    | "enemyPid"
    | "addEntry"
    | "rawStreams"
  >,
): {
  /** The `[REJECTED]` runs that printed — what a `[CAST STOPPED]` line must
   * not say again (`rejectRunStatesRow`). */
  rejectRunsPrinted: IRejectRun[];
} {
  const {
    actorLabel,
    owner,
    _allUnits,
    matchEndSeconds,
    matchStartMs,
    friends,
    enemies,
    pid,
    enemyPid,
    addEntry,
    rawStreams,
  } = ctx;

  const unitLabel = (u: ICombatUnit): string =>
    actorLabel(
      u.name,
      u.reaction === owner.reaction ? "friendly" : "enemy",
      u.id,
    );
  const byId = new Map(_allUnits.map((u) => [u.id, u]));
  const inMatch = (t: number) => t >= 0 && t <= matchEndSeconds;
  for (const g of groundedControls(
    _allUnits,
    matchStartMs,
    new Set([owner.id]),
  )) {
    if (!inMatch(g.atSeconds)) continue;
    const caster = byId.get(g.casterId);
    const totemOwner = resolveSummonOwner({
      allUnits: _allUnits,
      friends,
      enemies,
      name: "",
      sourceId: g.totemId,
    });
    const totemOf = totemOwner
      ? `${friends.some((f) => f.id === totemOwner.id) ? pid(totemOwner.name) : enemyPid(totemOwner.name)}'s Grounding Totem`
      : "a Grounding Totem";
    addEntry(
      g.atSeconds,
      `${fmtTime(g.atSeconds)}  [GROUNDED]   ${caster ? unitLabel(caster) : "?"}'s ${g.spellName} was redirected into ${totemOf}`,
    );
  }
  for (const r of reflectedSpells(_allUnits, matchStartMs)) {
    if (!inMatch(r.atSeconds)) continue;
    const caster = byId.get(r.casterId)!;
    const reflector = byId.get(r.reflectorId)!;
    const back = r.isControl
      ? " (a control — sent back at the caster)"
      : ` (came back for ${Math.round(r.damageBack / 1000)}k)`;
    addEntry(
      r.atSeconds,
      `${fmtTime(r.atSeconds)}  [REFLECTED]   ${unitLabel(caster)}'s ${r.spellName} reflected${r.reflectCount >= 2 ? ` ×${r.reflectCount}` : ""} by ${unitLabel(reflector)}${back}`,
    );
  }
  for (const x of sanctuaryRemovals(_allUnits, matchStartMs)) {
    if (!inMatch(x.atSeconds)) continue;
    const pal = byId.get(x.paladinId)!;
    const target = byId.get(x.targetId)!;
    // by GUID (a summon resolves to its owner through actorLabel); the
    // CC came from the side opposing the unit it was removed from
    const srcLabel = x.ccSourceName
      ? actorLabel(
          x.ccSourceName,
          target.reaction === owner.reaction ? "enemy" : "friendly",
          x.ccSourceId,
        )
      : "";
    addEntry(
      x.atSeconds,
      // cc-dr F-CR1: how long it held and how much was left (the
      // [CC BROKEN] arithmetic; an unknown full duration says held only).
      // Whole seconds through the render grid's formatter: a control removed
      // 0.3 s in held `<1s`, not `0s`. What was left is clamped at zero by
      // `ccRemainingSeconds` — a control that had already run its full
      // length had nothing left, and that prints `~0s`, the fact it is; a
      // positive remainder under half a second prints `~<1s`.
      `${fmtTime(x.atSeconds)}  [CC REMOVED]   ${unitLabel(pal)}'s Blessing of Sanctuary removed ${srcLabel ? `${srcLabel}'s ` : ""}${x.ccSpellName} from ${unitLabel(target)}${
        x.heldSeconds === undefined
          ? ""
          : ` after ${fmtWholeSeconds(x.heldSeconds)}${
              x.leftSeconds != null
                ? ` (~${fmtWholeSecondsOrZero(x.leftSeconds)} of it left)`
                : ""
            }`
      }`,
    );
  }
  const rejectRunsPrinted: IRejectRun[] = [];
  if (rawStreams?.available) {
    // B15b: the owner's TEAMMATES' deaths — a reject in the 10 s before one
    // is stated whatever its count
    const teammateDeathSeconds = friends
      .filter((f) => f.id !== owner.id)
      .flatMap((f) =>
        (f.deathRecords ?? []).map((d) => (d.timestamp - matchStartMs) / 1000),
      );
    for (const run of ownerRejectRuns(
      rawStreams.castFailed,
      owner.id,
      teammateDeathSeconds,
    )) {
      if (!inMatch(run.fromSeconds)) continue;
      const why = REJECT_WHY[run.kind];
      const span =
        toRenderSecond(run.toSeconds) > toRenderSecond(run.fromSeconds)
          ? ` (${fmtTime(run.fromSeconds)}–${fmtTime(run.toSeconds)})`
          : "";
      if (
        addEntry(
          run.fromSeconds,
          `${fmtTime(run.fromSeconds)}  [REJECTED]   your ${run.spellName} ×${run.count} — ${why}${span}`,
        )
      )
        rejectRunsPrinted.push(run);
    }
  }
  return { rejectRunsPrinted };
}
