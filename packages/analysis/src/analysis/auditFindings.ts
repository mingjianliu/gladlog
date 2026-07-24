import { claimChecker, interpolate } from "../compare/claimChecker";
import { causalLint } from "./causalLint";
import type { AuditResult, CandidateEvent, Finding, RawFinding } from "./types";

/** 严重度排序单源(high > med > low):审计排序与深挖选择共用。 */
export const SEVERITY_RANK: Record<string, number> = {
  high: 0,
  med: 1,
  low: 2,
};
const RANK = SEVERITY_RANK;

export function auditFindings(
  raw: RawFinding[],
  candidates: CandidateEvent[],
): AuditResult {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const findings: Finding[] = [];
  const dropped: AuditResult["dropped"] = [];

  for (const f of raw) {
    // Layer 1: grounding — the finding must anchor to >=1 event, and every
    // eventId must resolve. (Empty eventIds is unanchored → drop.)
    const refs = f.eventIds.map((id) => byId.get(id));
    if (f.eventIds.length === 0 || refs.some((r) => !r)) {
      dropped.push({
        finding: f,
        reason: "grounding: unanchored / unknown eventId",
      });
      continue;
    }
    // Facts the explanation may cite = the union of the referenced events' facts.
    // If two referenced events share a fact key with DIFFERING values (e.g. two
    // deaths, each with its own t), that placeholder is ambiguous — a last-write
    // merge would silently mis-attribute. 2026-07-24 精化:只有当解释**实际
    // 使用**了冲突键才丢 —— 旧规则只要冲突键存在就整条丢,把 prompt 明确
    // 鼓励的多事件链条(death+setup、多次漏解)一并误杀(smoke 实测 3/7 条
    // 死于此)。防误归因性质不变:任何被渲染的占位符仍必须唯一解析。
    const facts: Record<string, string> = {};
    const colliding = new Set<string>();
    for (const r of refs as CandidateEvent[])
      for (const [k, v] of Object.entries(r.facts)) {
        if (k in facts && facts[k] !== v) colliding.add(k);
        facts[k] = v;
      }
    const usedKeys = [
      ...f.explanation.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g),
    ].map((m) => m[1]!);
    const ambiguous = usedKeys.filter((k) => colliding.has(k));
    if (ambiguous.length > 0) {
      dropped.push({
        finding: f,
        reason: `ambiguous: placeholder(s) ${ambiguous.join(",")} collide across referenced events`,
      });
      continue;
    }
    // Layer 2: numeric. claimChecker validates {{key}} resolution + flags raw
    // decimals/percentages. But analysis fabrication is integer-heavy (times,
    // damage, "90k"), and the shared checker allows bare integers — unsafe here.
    // So additionally forbid ANY raw digit outside a placeholder: the prompt
    // mandates every number be a {{placeholder}}, so a bare digit = fabrication
    // or a disobeyed instruction. (Do not fork the shared checker; add the
    // stricter rule at the audit layer.)
    const check = claimChecker(f.explanation, facts);
    if (!check.ok) {
      dropped.push({
        finding: f,
        reason: `numeric: ${check.violations.join("; ")}`,
      });
      continue;
    }
    // Strip placeholders, then bracket/format terms (1v1, 2v2, 3v3 — never a
    // fabricated stat), then flag any remaining raw digit.
    const prose = f.explanation
      .replace(/\{\{[^}]*\}\}/g, " ")
      .replace(/\b\d+v\d+\b/gi, " ");
    if (/\d/.test(prose)) {
      dropped.push({
        finding: f,
        reason: "numeric: raw digit outside placeholder",
      });
      continue;
    }
    // Layer 3: causal-language lint.
    const causal = causalLint(f.explanation);
    if (causal.length > 0) {
      dropped.push({ finding: f, reason: `causal: ${causal.join("; ")}` });
      continue;
    }
    findings.push({ ...f, explanation: interpolate(f.explanation, facts) });
  }

  findings.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  return { findings, dropped };
}
