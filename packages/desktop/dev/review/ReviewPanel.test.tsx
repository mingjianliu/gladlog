// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  ReviewAnswer,
  ReviewCard,
  ReviewSession,
} from "../../../eval/src/explore/reviewTypes";
import { ReviewPanel } from "./ReviewPanel";

// session 复用 summary.test 的构造思路:2 卡(deep, baseline),evidence 各 1 条
// verdict: "verified" — the verdict/source must never surface until every
// card in the session is answered (the blind-review invariant under test).
const card = (cardId: string, source: "deep" | "baseline"): ReviewCard => ({
  cardId,
  source,
  claim: `claim for ${cardId}`,
  anchorT: 10,
  unitNames: [],
  evidence: [
    { cmd: "cd --t 10", line: `evidence line ${cardId}`, verdict: "verified" },
  ],
});

const twoCardSession: ReviewSession = {
  schemaVersion: 1,
  name: "s",
  matchId: "m",
  createdAt: 1,
  cards: [card("c0", "deep"), card("c1", "baseline")],
};

const ans = (
  cardId: string,
  over: Partial<ReviewAnswer> = {},
): ReviewAnswer => ({
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

// c0 (deep) answered "knew", c1 (baseline) answered "vague" — deliberately
// different awareness values so the dims-breakdown assertion below can tell
// deep and baseline counts apart (a session where every card agrees on every
// dimension can't distinguish "reads the right cell" from "reads any cell").
const fullAnswersForBoth: ReviewAnswer[] = [
  ans("c0", { awareness: "knew" }),
  ans("c1", { awareness: "vague" }),
];

describe("ReviewPanel", () => {
  it("gates 下一张 on all five answers and reports the answer", () => {
    const onSave = vi.fn();
    render(
      <ReviewPanel
        session={twoCardSession}
        answers={[]}
        onSave={onSave}
        onSeek={() => {}}
      />,
    );
    expect(screen.getByText(/1\s*\/\s*2/)).toBeTruthy();
    const next = screen.getByRole("button", { name: "下一张" });
    expect(next).toHaveProperty("disabled", true);
    for (const label of ["属实", "知道", "有具体动作", "会", "中"])
      fireEvent.click(screen.getByRole("button", { name: label }));
    expect(next).toHaveProperty("disabled", false);
    fireEvent.click(next);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0][0].cardId).toBe(
      twoCardSession.cards[0].cardId,
    );
  });

  it("seeks on anchor chip click and hides source until finished", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <ReviewPanel
        session={twoCardSession}
        answers={[]}
        onSave={() => {}}
        onSeek={onSeek}
      />,
    );
    fireEvent.click(screen.getByText("0:10")); // fmtTime(anchorT)
    expect(onSeek.mock.calls[0][0].cardId).toBe(twoCardSession.cards[0].cardId);
    // 盲评期间无来源徽章 — no source text anywhere in the DOM
    expect(screen.queryByText(/深挖|baseline|deep/)).toBeNull();
    // …and no per-evidence verdict text either (verdict is source-adjacent
    // information: which query "won" tells you which pipeline produced the
    // card just as surely as a source label would)
    expect(screen.queryByText(/verified|mismatch|unverifiable/)).toBeNull();
    // Non-text channels too — className/data-* hooks would let a reviewer (or
    // their browser devtools) read source/verdict off the DOM even with the
    // visible text hidden, defeating the blind review just as completely.
    expect(
      container.querySelector(
        '[class*="source"],[class*="verdict"],[data-source],[data-verdict]',
      ),
    ).toBeNull();
    // Belt-and-suspenders: the two source-name substrings must not appear
    // anywhere in the markup at all (attributes, comments, whitespace-split
    // text nodes — anything queryByText's node-scoped matching could miss).
    // Safe against false positives here because the fixture's claim/evidence
    // text ("claim for c0/c1", "evidence line c0/c1") never contains "deep"
    // or "baseline" as a substring; a real claim that happened to mention
    // "deep" in English would trip this, which is why this check stays
    // scoped to this fixture rather than becoming a general-purpose lint.
    expect(container.innerHTML).not.toContain("baseline");
    expect(container.innerHTML).not.toContain("deep");
  });

  it("shows reveal summary with source badges and dims breakdown after all cards answered", () => {
    const { container } = render(
      <ReviewPanel
        session={twoCardSession}
        answers={fullAnswersForBoth}
        onSave={() => {}}
        onSeek={() => {}}
      />,
    );
    expect(screen.getByText(/验真新发现/)).toBeTruthy();
    expect(screen.getAllByText(/深挖|现有管线/).length).toBeGreaterThan(0);
    // 各维分布: awareness 行按 source 分列计数 — c0 (deep) answered "knew",
    // c1 (baseline) answered "vague", so each cell should read exactly the
    // one card that produced it, not a blanket 0/1 that any wiring bug would
    // also produce by accident.
    expect(
      container.querySelector('[data-testid="review-dim-awareness-knew-deep"]')
        ?.textContent,
    ).toBe("1");
    expect(
      container.querySelector(
        '[data-testid="review-dim-awareness-knew-baseline"]',
      )?.textContent,
    ).toBe("0");
    expect(
      container.querySelector('[data-testid="review-dim-awareness-vague-deep"]')
        ?.textContent,
    ).toBe("0");
    expect(
      container.querySelector(
        '[data-testid="review-dim-awareness-vague-baseline"]',
      )?.textContent,
    ).toBe("1");
  });
});
