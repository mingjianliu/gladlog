import { describe, expect, it } from "vitest";
import { auditFindings } from "./auditFindings";
import type { CandidateEvent, RawFinding } from "./types";

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
];
const base: RawFinding = {
  eventIds: ["death:a:30"],
  severity: "high",
  category: "survival",
  title: "Death",
  explanation: "You died at {{t}}s.",
};

describe("auditFindings", () => {
  it("keeps a grounded, numerically-clean, non-causal finding and interpolates it", () => {
    const r = auditFindings([base], candidates);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].explanation).toBe("You died at 30s.");
  });
  it("drops a finding with a fabricated bare INTEGER outside a placeholder", () => {
    // The real death is at t=30; "47s" is fabricated. Integers are the analysis
    // fabrication surface, so a raw digit outside a placeholder must be dropped.
    const r = auditFindings(
      [{ ...base, explanation: "You died at 47s." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/raw digit|numeric/i);
  });
  it("drops an unanchored finding with empty eventIds (grounding)", () => {
    const r = auditFindings(
      [{ ...base, eventIds: [], explanation: "Play more defensively." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ground|unanchored/i);
  });
  it("drops a finding citing a non-existent event (grounding)", () => {
    const r = auditFindings(
      [{ ...base, eventIds: ["death:zzz:99"] }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ground/i);
  });
  it("drops a finding with a raw stat-digit outside a placeholder (numeric)", () => {
    const r = auditFindings(
      [{ ...base, explanation: "Your uptime was 0.85 there." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/numeric|claim/i);
  });
  it("drops a finding with strong causal attribution (causal lint)", () => {
    const r = auditFindings(
      [{ ...base, explanation: "You died because you greeded." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/causal/i);
  });
  it("sorts survivors by severity (high → low)", () => {
    const low: RawFinding = { ...base, severity: "low", title: "Low" };
    const r = auditFindings([low, base], candidates);
    expect(r.findings.map((f) => f.severity)).toEqual(["high", "low"]);
  });
});
