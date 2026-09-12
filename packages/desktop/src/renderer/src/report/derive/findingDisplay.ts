import type {
  CandidateEvent,
  Finding,
  FindingCategory,
} from "@gladlog/analysis";
import { normalizeFindingCategory } from "@gladlog/analysis";

/**
 * Render labels for findings/candidates (P0-2):
 * - severity is a closed enum, mapped to Chinese on the render side (the EN
 *   reply mode keeps English); category is a free-form model string AND the
 *   mistakes-notebook aggregation key, so no vocabulary is built on the render
 *   side (turning it into an enum is a separate task, gated by an eval A/B).
 * - the evidence chip's short label is derived the same way as the deep-dive
 *   pack chips: spell name first, otherwise the event type.
 */

const SEV_ZH: Record<Finding["severity"], string> = {
  high: "高",
  med: "中",
  low: "低",
};

export const severityLabel = (
  sev: Finding["severity"],
  lang: "zh" | "en",
): string => (lang === "en" ? sev : (SEV_ZH[sev] ?? sev));

/** category slug (single-sourced from the analysis enum) → Chinese label.
 * Anything outside the vocabulary (free-form words in legacy caches, or a model
 * ignoring instructions) is first normalized through normalizeFindingCategory;
 * if it is still unknown it is displayed verbatim. */
const CATEGORY_ZH: Record<FindingCategory, string> = {
  survival: "生存",
  cooldowns: "冷却使用",
  positioning: "站位",
  "target-selection": "目标选择",
  cc: "控制",
  interrupts: "打断",
  dispels: "驱散",
  offense: "进攻",
};

export function categoryLabel(cat: string, lang: "zh" | "en"): string {
  const slug = normalizeFindingCategory(cat);
  if (lang === "en") return slug;
  return (CATEGORY_ZH as Record<string, string>)[slug] ?? cat;
}

/** The full set of candidateFindings.ts types (UI fallback text; a new type
 * without a mapping falls back to the raw value). */
const TYPE_LABEL: Record<string, string> = {
  death: "死亡",
  "death-setup": "死亡铺垫",
  "cd-waste": "整场未用",
  "missed-cleanse": "漏解",
  "missed-purge": "漏偷",
  "cc-locked": "被控",
  "kick-eaten": "施法被断",
  "unconverted-burst": "爆发未转化",
  "burst-into-immunity": "打进免伤",
  "burst-into-mitigation": "打进大减伤",
  "off-target-in-window": "窗口外目标",
  "juked-kick": "被骗打断",
  "dr-clipped-cc": "DR 冲突",
  "death-unused-defensive": "死亡时保命技可用",
  "external-unused": "外减可用未给",
  "wasted-trinket": "浪费饰品",
  // Signal-expansion batch 1 (2026-08-06, BACKLOG #18 second batch).
  "healing-gap": "治疗空窗",
  "position-mistake": "走位失误",
  "cc-held": "压手未放",
  // DEFENSIVE-001 (2026-08-07, BACKLOG #18 second batch).
  "cc-avoidable": "规避手段可用未用",
  // DEFENSIVE-003 (2026-08-11).
  "slow-defensive-response": "敌方开大应对迟缓",
  // Task 5 (spec 2026-08-29, healer-only crisis threshold).
  "crisis-no-response": "危机无应对",
  // GH #80 (2026-09-12).
  "backlash-dispel": "解反噬 DoT",
  "backlash-dispel-window": "可解未解",
};

const MAX_LABEL = 12;

/** Evidence chip short label: spell name first (in the log's language),
 * falling back to the type label when there is no spell; truncated when too
 * long (the chip's title carries the full text). */
export function candidateShortLabel(c: CandidateEvent): string {
  // Candidates from test stubs / legacy data may lack a type — fall back to an
  // empty string rather than letting the whole card throw on mount
  const base = c.spell || TYPE_LABEL[c.type] || c.type || "";
  return base.length > MAX_LABEL ? `${base.slice(0, MAX_LABEL)}…` : base;
}
