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
  it("drops a multi-event finding whose referenced events collide on a fact key with differing values", () => {
    const two: CandidateEvent[] = [
      candidates[0],
      {
        id: "death:b:40",
        type: "death",
        t: 40,
        unitNames: ["Ally"],
        facts: { t: "40", unit: "Ally" },
      },
    ];
    const r = auditFindings(
      [
        {
          ...base,
          eventIds: ["death:a:30", "death:b:40"],
          explanation: "Two deaths, both around {{t}}s.",
        },
      ],
      two,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ambiguous|collid/i);
  });
  it("keeps a finding referencing a bracket/format term (2v2) — not a fabricated digit", () => {
    const r = auditFindings(
      [
        {
          ...base,
          explanation: "In the 2v2 you went down at {{t}}s; play safer.",
        },
      ],
      candidates,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].explanation).toBe(
      "In the 2v2 you went down at 30s; play safer.",
    );
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

describe("跨事件 facts 键冲突(2026-07-24 精化:只丢实际使用了冲突键的)", () => {
  const two: CandidateEvent[] = [
    {
      id: "missed-cleanse:X:20",
      type: "missed-cleanse",
      t: 20,
      unitNames: ["X"],
      facts: { t: "20.0", cc: "Fear", duration: "5.0" },
    },
    {
      id: "missed-cleanse:X:80",
      type: "missed-cleanse",
      t: 80,
      unitNames: ["X"],
      facts: { t: "80.0", cc: "Sheep", duration: "6.0" },
    },
  ];
  const multi: RawFinding = {
    eventIds: ["missed-cleanse:X:20", "missed-cleanse:X:80"],
    severity: "med",
    category: "dispel",
    title: "Cleanses missed twice",
    explanation: "High-value CC sat on your ally twice without a dispel.",
  };

  it("引用冲突事件但解释未用冲突键 → 保留(旧规则会误杀)", () => {
    const r = auditFindings([multi], two);
    expect(r.findings).toHaveLength(1);
  });

  it("HAS TEETH:解释用了冲突键 {{t}} → 丢,理由点名该键", () => {
    const r = auditFindings(
      [{ ...multi, explanation: "At {{t}}s the CC sat without a dispel." }],
      two,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0]!.reason).toMatch(/placeholder.*t.*collide/);
  });

  it("用的是非冲突键(仅一事件含 deathT 类独有键)→ 保留并插值", () => {
    const withUnique: CandidateEvent[] = [
      two[0]!,
      {
        ...two[1]!,
        id: "death-setup:X:90",
        facts: { t: "80.0", deathT: "90.0", kind: "healer-locked" },
      },
    ];
    const r = auditFindings(
      [
        {
          ...multi,
          eventIds: ["missed-cleanse:X:20", "death-setup:X:90"],
          explanation:
            "The setup happened earlier; the death followed at {{deathT}}s.",
        },
      ],
      withUnique,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.explanation).toContain("90.0s");
  });
});
