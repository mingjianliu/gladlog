import type { CandidateEvent } from "./types";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import {
  isHealerSpec,
  extractMajorCooldowns,
  type IMajorCooldownInfo,
} from "../utils/cooldowns";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Map never-used major cooldowns to cd-waste candidate events. Pure (no combat
 * traversal) so the mapping rule is unit-testable with hand-built cooldown
 * fixtures; the extractMajorCooldowns integration is exercised on real matches.
 *
 * Rule: emit for a cooldown that was never used AND is a pure survival wall.
 * Throughput CDs (isThroughput — e.g. Power Infusion) are excluded: a never-used
 * throughput CD is a different, weaker coaching point than a never-used defensive.
 */
export function cdWasteEvents(
  cds: Pick<
    IMajorCooldownInfo,
    "spellId" | "spellName" | "neverUsed" | "isThroughput"
  >[],
  healer: { id: string; name: string },
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  for (const cd of cds) {
    if (cd.neverUsed && !cd.isThroughput) {
      out.push({
        id: `cd-waste:${healer.id}:${cd.spellId}`,
        type: "cd-waste",
        t: 0, // whole-round observation, not time-specific
        unitNames: [healer.name],
        spell: cd.spellName,
        facts: { spell: cd.spellName, unit: healer.name },
      });
    }
  }
  return out;
}

/**
 * Structured, verifiable candidate events for the findings pipeline. Built on
 * the parsed combat directly (NOT a refactor of buildMatchContext). Extensible
 * by pushing more typed events.
 *
 * Current menu:
 *  - death (all units, tagged friendly/enemy so the LLM knows kill vs loss)
 *  - cd-waste (the Friendly healer's never-used DEFENSIVE major cooldowns)
 */
export function extractCandidateFindings(combat: any): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const units = Object.values(combat?.units ?? {}) as any[];
  const start = combat?.startTime ?? 0;

  // --- player deaths, tagged friendly/enemy ---
  // Players only: every arena combatant emits COMBATANT_INFO (u.info); pets,
  // totems, and guardians do not. A pet death is noise (they die and resummon
  // constantly) and would mislead the coach if tagged as a "friendly death".
  for (const u of units) {
    if (!u.info) continue;
    for (const d of (u.deathRecords ?? []) as any[]) {
      const t = ((d.timestamp ?? 0) - start) / 1000;
      const side =
        u.reaction === CombatUnitReaction.Friendly ? "friendly" : "enemy";
      out.push({
        id: `death:${u.id}:${Math.round(t)}`,
        type: "death",
        t,
        unitNames: [u.name],
        facts: { t: fmt(t), unit: u.name, side },
      });
    }
  }

  // --- cd-waste: the Friendly healer's never-used defensive cooldowns ---
  const healer = units.find(
    (u) =>
      u.info &&
      u.reaction === CombatUnitReaction.Friendly &&
      isHealerSpec(u.spec),
  );
  if (healer) {
    let cds: IMajorCooldownInfo[] = [];
    try {
      cds = extractMajorCooldowns(healer, combat);
    } catch {
      cds = [];
    }
    out.push(...cdWasteEvents(cds, healer));
  }

  return out;
}
