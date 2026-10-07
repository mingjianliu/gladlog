/**
 * [UNCLEANSED DEBUFF] and [CLEANSE] — friendly debuffs that stayed on while a
 * cleanse was available, the owner's missed purges that GH #99 did not fold into
 * another line ([MISSED PURGE]), and our cleanses (Critical / High only, F163;
 * same-second same-source merge, B14).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { getEnglishSpellName } from "../../data/spellEffectData";
import {
  canRemoveFrom,
  formatMissedCleanseExemption,
  formatMissedPurgeExemption,
  type IDispelEvent,
  ownerRemovedOtherCopy,
  POST_CC_PRESSURE_WINDOW_S,
} from "../../utils/dispelAnalysis";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitCleanseEntries(
  ctx: Pick<
    TimelineCtx,
    | "dispelSummary"
    | "owner"
    | "addEntry"
    | "pid"
    | "qualifyingMissedPurges"
    | "consumedMissedPurges"
    | "enemyPid"
    | "enemies"
    | "matchStartMs"
  >,
): void {
  const {
    dispelSummary,
    owner,
    addEntry,
    pid,
    qualifyingMissedPurges,
    consumedMissedPurges,
    enemyPid,
    enemies,
    matchStartMs,
  } = ctx;

  for (const miss of dispelSummary.missedCleanseWindows) {
    // B16: only emit if the log owner's spec can actually remove this debuff
    // type — from a charmed teammate only by an offensive purge (W1d, a5a8d31b)
    if (
      !canRemoveFrom(
        owner,
        miss.dispelType,
        miss.targetCharmed,
        miss.targetName,
      )
    )
      continue;
    // postCcDamage is the first POST_CC_PRESSURE_WINDOW_S after the debuff
    // landed, not its lifetime — "taken during" beside a 16 s duration was
    // retold as "took 247k during the 16 s" (reliability round 2, 539f: the
    // real 16 s figure was 568k).
    const dmgK = Math.round(miss.postCcDamage / 1000);
    const spellName = getEnglishSpellName(miss.spellId, miss.spellName);
    addEntry(
      miss.timeSeconds,
      // Exemption context (Fix 5): a missed cleanse while the cleanse was on CD
      // is still rendered (the fact layer hides nothing), but carries a context
      // suffix so the model stops blaming an infeasible dispel as a mistake.
      `${fmtTime(miss.timeSeconds)}  [UNCLEANSED DEBUFF]   ${spellName} on ${pid(miss.targetName)} | ${miss.durationSeconds.toFixed(0)}s | ${dmgK}k taken in the ${POST_CC_PRESSURE_WINDOW_S}s after it landed | dispel: ${miss.dispelType}${formatMissedCleanseExemption(miss)}`,
    );
  }

  // B117: only the log owner's decisions are actionable, so a "missed purge" is noise unless the
  // owner can actually offensive-purge. Mistweaver/Evoker/Holy Priest/Paladin etc. spammed this tag
  // for enemy buffs (e.g. Power Infusion) they had no tool to remove — the weakest, lowest-confidence
  // findings in the corpus. Gate the whole block to owners who can purge.
  // (P-P5b = C: `qualifyingMissedPurges` is already the owner's — an owner
  // with no removal for the buff has none.)
  for (const miss of qualifyingMissedPurges) {
    if (consumedMissedPurges.has(miss)) continue;
    // B13d: the owner took the same caster's other copy meanwhile
    const other = ownerRemovedOtherCopy(
      miss,
      owner.name,
      dispelSummary.ourPurges,
      enemies ?? [],
      matchStartMs,
    );
    const otherNote = other
      ? ` | you ${other.isSpellSteal ? "stole" : "purged"} the other copy at ${fmtTime(other.atSeconds)}`
      : "";
    addEntry(
      miss.timeSeconds,
      `${fmtTime(miss.timeSeconds)}  [MISSED PURGE OPPORTUNITY]   ${miss.spellName} active on ${enemyPid(miss.enemyName)} (unpurged for ${Math.round(miss.durationSeconds)}s)${formatMissedPurgeExemption(miss)}${otherNote}`,
    );
  }

  // B14: Consolidate same-second same-source cleanses (e.g. Mass Dispel) into one line.
  // F163: Filter out low/medium priority cleanses to de-noise the timeline.
  {
    const cleanseGroups = new Map<string, IDispelEvent[]>();
    for (const cleanse of dispelSummary.allyCleanse) {
      if (cleanse.priority !== "Critical" && cleanse.priority !== "High")
        continue;
      // D1 (2026-09-25): a rider (form shift, movement ability) is not a
      // cleanse — it folds into the "(passive)" minor line below instead.
      if (cleanse.dispelKind === "rider") continue;
      const key = `${Math.round(cleanse.timeSeconds)}|${cleanse.sourceName}`;
      const group = cleanseGroups.get(key) ?? [];
      group.push(cleanse);
      cleanseGroups.set(key, group);
    }
    for (const group of cleanseGroups.values()) {
      const first = group[0];
      const petTag = group.some((c) => c.isPetDispel) ? " (pet)" : "";
      const fatalCleanse = group.find((c) => c.wasFatal);
      const fatalTag = fatalCleanse
        ? ` [FATAL DISPEL: ${pid(fatalCleanse.fatalUnitName ?? fatalCleanse.sourceName)}]`
        : "";
      const removedSpellName = getEnglishSpellName(
        first.removedSpellId,
        first.removedSpellName,
      );
      // T5 (dispel coverage): name the dispel spell — "what it was dispelled
      // with" is where coaching advice (cooldown, priority) lands, and it is the
      // match key for deterministic coverage.
      const viaTag = first.dispelSpellName ? ` (${first.dispelSpellName})` : "";
      if (group.length === 1) {
        addEntry(
          first.timeSeconds,
          `${fmtTime(first.timeSeconds)}  [CLEANSE]   ${pid(first.sourceName)} dispelled ${removedSpellName} off ${pid(first.targetName)}${viaTag}${petTag}${fatalTag}`,
        );
      } else {
        const effects = group
          .map(
            (c) =>
              `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${pid(c.targetName)}`,
          )
          .join(", ");
        addEntry(
          first.timeSeconds,
          `${fmtTime(first.timeSeconds)}  [CLEANSE]   ${pid(first.sourceName)} dispelled ${group.length} effects: ${effects}${viaTag}${petTag}${fatalTag}`,
        );
      }
    }
  }
}
