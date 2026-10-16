import { findingKey } from "../../../../shared/findingKey";

type NoteFinding = {
  category: string;
  eventIds?: string[];
  severity: string;
  title: string;
  explanation: string;
};

/** The renderer's view of main's SelfReviewRecord (analysis.ts) — only the
 * fields the note reads. */
export type SelfReviewView = {
  status: "reviewed" | "failed" | "skipped";
  original?: NoteFinding[];
};

/**
 * The quiet one-line note under the analysis header for the AI self-review
 * (user 2026-10-15). Counted from the stored findings, not from the model's
 * own change log: a finding counts as changed when its title, explanation or
 * severity differs from the first round's; dropped = first-round findings no
 * longer shown. null = nothing to say (review off, or nothing to review).
 */
export function selfReviewNote(result: {
  findings: NoteFinding[];
  selfReview?: SelfReviewView;
}): string | null {
  const r = result.selfReview;
  if (!r || r.status === "skipped") return null;
  if (r.status === "failed") return "未自查 · AI 自查没有成功,显示的是原始结果";
  const original = r.original ?? [];
  const shown = new Map(result.findings.map((f) => [findingKey(f), f]));
  let changed = 0;
  let dropped = 0;
  for (const o of original) {
    const f = shown.get(findingKey(o));
    if (!f) dropped++;
    else if (
      f.title !== o.title ||
      f.explanation !== o.explanation ||
      f.severity !== o.severity
    )
      changed++;
  }
  if (changed === 0 && dropped === 0) return "已 AI 自查 · 没有改动";
  return [
    "已 AI 自查",
    changed > 0 ? `${changed} 条结论有改动` : null,
    dropped > 0 ? `删去 ${dropped} 条` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
