import { describe, expect, it } from "vitest";

import { rankKeystoneCandidates, type StudyRow } from "./keystoneDiscovery";

describe("rankKeystoneCandidates", () => {
  it("ranks a planted fork node first by |metric separation|", () => {
    const rows: StudyRow[] = [];
    // 20% of records have node 777 and high offensiveIndex; rest low.
    for (let i = 0; i < 20; i++)
      rows.push({
        spec: "X",
        archetype: "hybrid",
        talents: [1, 2, 777],
        offensiveIndex: 0.5,
        ccDensity: 0,
      });
    for (let i = 0; i < 80; i++)
      rows.push({
        spec: "X",
        archetype: "hybrid",
        talents: [1, 2, 3],
        offensiveIndex: 0.2,
        ccDensity: 0,
      });
    const cands = rankKeystoneCandidates(rows, "X", "offensiveIndex");
    expect(cands[0].nodeId).toBe(777);
    expect(cands[0].diff).toBeGreaterThan(0.2);
    expect(cands[0].prevalence).toBeCloseTo(0.2, 2);
  });
  it("returns no candidate node with near-universal or ultra-rare prevalence", () => {
    const rows: StudyRow[] = [];
    for (let i = 0; i < 100; i++)
      rows.push({
        spec: "X",
        archetype: "hybrid",
        talents: [1],
        offensiveIndex: 0.3,
        ccDensity: 0,
      });
    // node 1 is 100% prevalent → excluded from candidates
    const cands = rankKeystoneCandidates(rows, "X", "offensiveIndex");
    expect(cands.find((c) => c.nodeId === 1)).toBeUndefined();
  });
});
