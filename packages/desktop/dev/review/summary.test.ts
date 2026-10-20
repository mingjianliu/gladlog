import { describe, expect, it } from "vitest";

import type {
  ReviewAnswer,
  ReviewCard,
  ReviewSession,
} from "../../../eval/src/explore/reviewTypes";
import { summarize } from "./summary";

const card = (cardId: string, source: "deep" | "baseline"): ReviewCard => ({
  cardId,
  source,
  claim: "c",
  anchorT: 10,
  unitNames: [],
  evidence: [],
});
const session: ReviewSession = {
  schemaVersion: 1,
  name: "s",
  matchId: "m",
  createdAt: 1,
  cards: [
    card("c0", "deep"),
    card("c1", "deep"),
    card("c2", "baseline"),
    card("c3", "baseline"),
  ],
};
const ans = (cardId: string, over: Partial<ReviewAnswer>): ReviewAnswer => ({
  cardId,
  truth: "true",
  awareness: "knew",
  actionable: "concrete",
  adopt: "yes",
  impact: "low",
  note: "",
  answeredAt: 1,
  ...over,
});

describe("summarize", () => {
  it("counts answered per source and novelValuable by the operational definition", () => {
    const answers = [
      ans("c0", { awareness: "unaware", impact: "med" }), // deep: novel & valuable
      ans("c1", { awareness: "unaware", impact: "low" }), // impact 不够,不算
      ans("c2", { truth: "false", awareness: "unaware", impact: "high" }), // 不属实,不算
    ];
    const s = summarize(session, answers);
    expect(s.bySource.deep.answered).toBe(2);
    expect(s.bySource.deep.novelValuable).toBe(1);
    expect(s.bySource.baseline.answered).toBe(1);
    expect(s.bySource.baseline.novelValuable).toBe(0);
    expect(s.bySource.baseline.total).toBe(2);
  });
});
