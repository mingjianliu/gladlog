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

  /** The two names are one player. Two full names (`Name-Realm`) that differ
   * are two players — same-named characters from two realms on one team,
   * whose landings a delayed control (`landing`) would otherwise hand to
   * whichever cast line asks first. The character-name / roster-label
   * comparison is the fallback for a name that carries no realm. */
  const sameCaster = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (a.includes("-") && b.includes("-")) return false;
    return a.split("-")[0] === b.split("-")[0] || pid(a) === pid(b);
  };

  function findAndConsumeAoeCC(
    castTimeSeconds: number,
    casterName: string,
    spellName: string,
    isOwnerCast: boolean,
    /** a delayed control's landing window after the cast
     * (`AOE_CC_LANDING_WINDOW_S`); absent = it lands in the cast's own
     * rendered second */
    landing?: { fromS: number; toS: number },
  ): IAoeCCEvent | undefined {
    const castSec = toRenderSecond(castTimeSeconds);
    for (const aoe of aoeCCEvents) {
      if (consumedAoeEvents.has(aoe)) continue;
      if (landing) {
        const after = aoe.atSeconds - castTimeSeconds;
        if (after < landing.fromS || after > landing.toS) continue;
      } else if (toRenderSecond(aoe.atSeconds) !== castSec) continue;
      if (aoe.spellName !== spellName) continue;
      const aoeIsOwner = sameCaster(aoe.casterName, owner.name);
      if (isOwnerCast) {
        if (!aoeIsOwner) continue;
      } else {
        if (aoeIsOwner) continue;
        if (!sameCaster(aoe.casterName, casterName)) continue;
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
