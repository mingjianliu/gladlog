/**
 * GH #99 item 3, Rule A — AoE CC folding: the AoE CC events from the outgoing
 * CC chains, the shared set of the ones already folded into a friendly cast line,
 * and the two helpers the cast-line emitters call (find-and-consume, and the
 * `→ a, b [n enemies]` target part). Renders nothing itself; [YOU] [CD],
 * [TEAM] [CD], the healer gap-filler and [CC CAST] use what it returns.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`, and the four results come back
 * to the caller (the two helpers keep closing over the same
 * `consumedAoeEvents` set). Output is pinned by the 605-file acceptanceCapture
 * context hash.
 */
import { extractAoeCCEvents, type IAoeCCEvent } from "../../utils/drAnalysis";
import { toRenderSecond } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function prepareAoeCcFolding(
  ctx: Pick<TimelineCtx, "outgoingCCChains" | "owner" | "pid" | "enemyPid">,
) {
  const { outgoingCCChains, owner, pid, enemyPid } = ctx;

  const aoeCCEvents =
    outgoingCCChains && outgoingCCChains.length > 0
      ? extractAoeCCEvents(outgoingCCChains)
      : [];
  const consumedAoeEvents = new Set<IAoeCCEvent>();

  function findAndConsumeAoeCC(
    castTimeSeconds: number,
    casterName: string,
    spellName: string,
    isOwnerCast: boolean,
  ): IAoeCCEvent | undefined {
    const castSec = toRenderSecond(castTimeSeconds);
    for (const aoe of aoeCCEvents) {
      if (consumedAoeEvents.has(aoe)) continue;
      if (toRenderSecond(aoe.atSeconds) !== castSec) continue;
      if (aoe.spellName !== spellName) continue;
      const aoeIsOwner =
        aoe.casterName === owner.name ||
        aoe.casterName.split("-")[0] === owner.name.split("-")[0] ||
        pid(aoe.casterName) === pid(owner.name);
      if (isOwnerCast) {
        if (!aoeIsOwner) continue;
      } else {
        if (aoeIsOwner) continue;
        const matchCaster =
          aoe.casterName === casterName ||
          aoe.casterName.split("-")[0] === casterName.split("-")[0] ||
          pid(aoe.casterName) === pid(casterName);
        if (!matchCaster) continue;
      }
      consumedAoeEvents.add(aoe);
      return aoe;
    }
    return undefined;
  }

  // The cast line keeps its own target part verbatim (primary target plus any
  // HP / velocity note) and the AoE landing list is appended after it; the
  // primary target stays first even when it is absent from the landed list
  // (immune / missed — 2/309 prompts on the first fold, both Intimidating
  // Shout), so no (second, caster, spell, target) fact is lost by folding.
  function formatAoeTargetPart(
    aoe: IAoeCCEvent,
    existingTargetPart: string,
  ): string {
    const labels = aoe.targets.map((t) => enemyPid(t.name));
    const primary = existingTargetPart.match(/→ (\S+)/)?.[1] ?? "";
    const others = primary ? labels.filter((l) => l !== primary) : labels;
    const total =
      primary && !labels.includes(primary) ? labels.length + 1 : labels.length;
    const countNote = total > 1 ? ` [${total} enemies]` : "";
    if (!existingTargetPart) return ` → ${others.join(", ")}${countNote}`;
    if (others.length === 0) return `${existingTargetPart}${countNote}`;
    return `${existingTargetPart}, ${others.join(", ")}${countNote}`;
  }

  // exported: returned to the caller (GH #116)
  return {
    aoeCCEvents,
    consumedAoeEvents,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
  };
}
