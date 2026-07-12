import type { CandidateEvent, RawFinding, Finding, AuditResult } from "./types";
import { causalLint } from "./causalLint";
import { interpolate, claimChecker } from "../compare/claimChecker";

const RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

export function auditFindings(
  raw: RawFinding[],
  candidates: CandidateEvent[],
): AuditResult {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const findings: Finding[] = [];
  const dropped: AuditResult["dropped"] = [];

  for (const f of raw) {
    // Layer 1: grounding — every eventId must resolve.
    const refs = f.eventIds.map((id) => byId.get(id));
    if (refs.some((r) => !r)) {
      dropped.push({ finding: f, reason: "grounding: unknown eventId" });
      continue;
    }
    // Facts the explanation may cite = the union of the referenced events' facts.
    const facts: Record<string, string> = {};
    for (const r of refs as CandidateEvent[]) Object.assign(facts, r.facts);
    // Layer 2: numeric claimChecker (reused from compare).
    const check = claimChecker(f.explanation, facts);
    if (!check.ok) {
      dropped.push({
        finding: f,
        reason: `numeric: ${check.violations.join("; ")}`,
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
