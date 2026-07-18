// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";

import { MatchListRow } from "../src/renderer/src/components/MatchListRow";
import type { StoredMatchMeta } from "../src/main/matchStore";

const base: StoredMatchMeta = {
  id: "m1",
  kind: "match",
  bracket: "3v3",
  zoneId: "1505",
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_145_000,
  result: "win",
  storedAt: 1,
};

describe("MatchListRow(backlog #7)", () => {
  it("旧 meta(无 teams)回退纯文本样式", () => {
    render(<ul><li><MatchListRow meta={base} /></li></ul>);
    expect(screen.getByText(/3v3/)).toBeTruthy();
    expect(screen.getByText(/\[match\]/)).toBeTruthy();
  });

  it("富 meta:胜负 + 地图名 + 时长 + 评分 + 两组 spec", () => {
    const rich: StoredMatchMeta = {
      ...base,
      durationS: 145,
      avgRating: 2500,
      teams: [
        [
          { specId: 105, classId: 11 },
          { specId: 71, classId: 1 },
        ],
        [{ specId: 64, classId: 8 }],
      ],
    };
    const { container } = render(<ul><li><MatchListRow meta={rich} /></li></ul>);
    expect(container.querySelector(".mlr-win")).toBeTruthy(); // 胜负=左缘色线类,无文字徽章(1e)
    expect(screen.getByText("Nagrand Arena")).toBeTruthy();
    expect(screen.getByText("2:25")).toBeTruthy();
    expect(screen.getByText("2500")).toBeTruthy();
    // 3 个 spec 图标(img 或 fallback 字形)
    expect(container.querySelectorAll(".mlr-spec").length).toBe(3);
    expect(screen.getByText("vs")).toBeTruthy();
  });

  it("未知 spec id 回退职业字形点", () => {
    const rich: StoredMatchMeta = {
      ...base,
      durationS: 60,
      avgRating: null,
      teams: [[{ specId: 999999, classId: 1 }], []],
    };
    const { container } = render(<ul><li><MatchListRow meta={rich} /></li></ul>);
    const fb = container.querySelector(".mlr-spec-fallback");
    expect(fb?.textContent).toBe("WA");
  });
});
