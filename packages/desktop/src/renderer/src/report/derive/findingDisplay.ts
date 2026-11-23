import type {
  CandidateEvent,
  Finding,
  FindingCategory,
} from "@gladlog/analysis";
import { normalizeFindingCategory } from "@gladlog/analysis";

import {
  type Language,
  type MessageKey,
  translate,
} from "../../../../shared/i18n";

/**
 * Render labels for findings/candidates (P0-2):
 * - severity is a closed enum, mapped to the UI language through the
 *   dictionary (`report.severity.*`); category is a free-form model string AND the
 *   mistakes-notebook aggregation key, so no vocabulary is built on the render
 *   side (turning it into an enum is a separate task, gated by an eval A/B).
 * - the evidence chip's short label is derived the same way as the deep-dive
 *   pack chips: spell name first, otherwise the event type.
 */

const SEVERITY_KEY: Record<Finding["severity"], MessageKey> = {
  high: "report.severity.high",
  med: "report.severity.med",
  low: "report.severity.low",
};

export const severityLabel = (
  sev: Finding["severity"],
  lang: Language,
): string => {
  // A severity outside the enum (stale cache, model drift) is shown verbatim.
  const key = SEVERITY_KEY[sev] as MessageKey | undefined;
  return key ? translate(lang, key) : sev;
};

/** category slug (single-sourced from the analysis enum) → display label.
 * Anything outside the vocabulary (free-form words in legacy caches, or a model
 * ignoring instructions) is first normalized through normalizeFindingCategory;
 * if it is still unknown it is displayed verbatim (en: the normalized slug). */
const CATEGORY_KEY: Record<FindingCategory, MessageKey> = {
  survival: "report.category.survival",
  cooldowns: "report.category.cooldowns",
  positioning: "report.category.positioning",
  "target-selection": "report.category.target-selection",
  cc: "report.category.cc",
  interrupts: "report.category.interrupts",
  dispels: "report.category.dispels",
  offense: "report.category.offense",
};

export function categoryLabel(cat: string, lang: Language): string {
  const slug = normalizeFindingCategory(cat);
  const key = (CATEGORY_KEY as Record<string, MessageKey | undefined>)[slug];
  if (key) return translate(lang, key);
  return lang === "en" ? slug : cat;
}

/** The full set of candidateFindings.ts types (UI fallback text; a new type
 * without a mapping falls back to the raw value). */
const TYPE_LABEL_KEY: Record<string, MessageKey> = {
  death: "report.findingType.death",
  "death-setup": "report.findingType.death-setup",
  "cd-waste": "report.findingType.cd-waste",
  "missed-cleanse": "report.findingType.missed-cleanse",
  "missed-purge": "report.findingType.missed-purge",
  "kick-eaten": "report.findingType.kick-eaten",
  "burst-into-mitigation": "report.findingType.burst-into-mitigation",
  "external-unused": "report.findingType.external-unused",
  // Signal-expansion batch 1 (2026-08-06, BACKLOG #18 second batch).
  "healing-gap": "report.findingType.healing-gap",
  "position-mistake": "report.findingType.position-mistake",
  "cc-held": "report.findingType.cc-held",
  // DEFENSIVE-001 (2026-08-07, BACKLOG #18 second batch).
  "cc-avoidable": "report.findingType.cc-avoidable",
  // DEFENSIVE-003 (2026-08-11).
  "slow-defensive-response": "report.findingType.slow-defensive-response",
  // Task 5 (spec 2026-08-29, healer-only crisis threshold).
  "crisis-no-response": "report.findingType.crisis-no-response",
  // GH #95 (2026-09-17).
  "teammate-crisis-idle": "report.findingType.teammate-crisis-idle",
  "teammate-crisis-triage": "report.findingType.teammate-crisis-triage",
  // GH #80 (2026-09-12).
  "backlash-dispel": "report.findingType.backlash-dispel",
  "backlash-dispel-window": "report.findingType.backlash-dispel-window",
  // GH #78 (2026-09-12).
  "kick-priority-missed": "report.findingType.kick-priority-missed",
  "kick-priority-team": "report.findingType.kick-priority-team",
};

const MAX_LABEL = 12;

/** Evidence chip short label: spell name first (in the log's language),
 * falling back to the type label when there is no spell; truncated when too
 * long (the chip's title carries the full text). */
export function candidateShortLabel(
  c: CandidateEvent,
  lang: Language = "zh",
): string {
  // Candidates from test stubs / legacy data may lack a type — fall back to an
  // empty string rather than letting the whole card throw on mount
  const typeKey = TYPE_LABEL_KEY[c.type] as MessageKey | undefined;
  const base =
    c.spell || (typeKey ? translate(lang, typeKey) : "") || c.type || "";
  return base.length > MAX_LABEL ? `${base.slice(0, MAX_LABEL)}…` : base;
}
