/**
 * F16 same-round retest (2026-10-21), dispel facts:
 * - idx 13 (0c8b1932 1:11): a removed disarm (Faerie Swarm) was filed Low,
 *   under the [MINOR DISPELS] fold, below the DoT the line named.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  purgePriorityForTest,
  removedDispelPriority,
} from "../src/utils/dispelAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("F16 retest — a disarm's dispel priority", () => {
  it("a removed Faerie Swarm 209749 / Disarm 236077 is High, as a removed root is; the missed-cleanse tier stays Low", () => {
    expect(removedDispelPriority("209749")).toBe("High");
    expect(removedDispelPriority("236077")).toBe("High");
    // an uncleansed disarm is no missed-cleanse (no signed verdict row)
    expect(purgePriorityForTest("209749")).toBe("Low");
    expect(removedDispelPriority("999999999")).toBe("Low");
  });
});
