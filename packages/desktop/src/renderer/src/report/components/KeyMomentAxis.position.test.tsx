// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { KeyMoment } from "../derive/keyMoments";
import { KeyMomentAxis } from "./KeyMomentAxis";

// #10 T4: the position kind is added to KIND_ICON/KIND_ZH (no emoji — a text
// glyph ⇄ and the label 「走位」), and clicking a minor positioning node fires
// onSeek(jumpT, unitNames).
const positionMoment: KeyMoment = {
  t: 12,
  kind: "position",
  weight: "minor",
  side: "friendly",
  title: "该压没压",
  detail: ">30yd 脱节",
  unitNames: ["PlayerB-Test"],
  jumpT: 12,
};

describe("KeyMomentAxis — position kind (#10 T4)", () => {
  it("走位事件用 ⇄ 图标渲染,点击触发 onSeek(jumpT, unitNames)", () => {
    const onSeek = vi.fn();
    render(
      <KeyMomentAxis
        moments={[positionMoment]}
        findings={[]}
        candidates={[]}
        onSeek={onSeek}
        onSelectEvidence={vi.fn()}
      />,
    );
    const node = screen.getByTestId("axis-node-minor");
    expect(node.textContent).toContain("⇄");
    expect(node.textContent).toContain("该压没压");
    node.click();
    expect(onSeek).toHaveBeenCalledWith(12, ["PlayerB-Test"]);
  });
});
