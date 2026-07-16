import { claimChecker,interpolate } from "../compare/claimChecker";
import { causalLint } from "./causalLint";
import type { AuditResult,CandidateEvent, Finding, RawFinding } from "./types";

const RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

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
    // deaths, each with its own t), the placeholder is ambiguous — a last-write
    // merge would silently mis-attribute. Drop such findings rather than guess.
    const facts: Record<string, string> = {};
    let collision = false;
    for (const r of refs as CandidateEvent[])
      for (const [k, v] of Object.entries(r.facts)) {
        if (k in facts && facts[k] !== v) collision = true;
        facts[k] = v;
      }
    if (collision) {
      dropped.push({
        finding: f,
        reason: "ambiguous: colliding fact keys across referenced events",
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
