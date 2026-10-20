// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import type { StoredMatchMeta } from "../src/main/matchStore";
import { MatchListRow } from "../src/renderer/src/components/MatchListRow";

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
    render(
      <ul>
        <li>
          <MatchListRow meta={base} />
        </li>
      </ul>,
    );
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
    const { container } = render(
      <ul>
        <li>
          <MatchListRow meta={rich} />
        </li>
      </ul>,
    );
    expect(container.querySelector(".mlr-win")).toBeTruthy(); // win/loss = left-edge color class, no text badge (1e)
    expect(screen.getByText("Nagrand Arena")).toBeTruthy();
    expect(screen.getByText("2:25")).toBeTruthy();
    expect(screen.getByText("2500")).toBeTruthy();
    // 3 spec icons (either img or the fallback glyph)
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
    const { container } = render(
      <ul>
        <li>
          <MatchListRow meta={rich} />
        </li>
      </ul>,
    );
    const fb = container.querySelector(".mlr-spec-fallback");
    expect(fb?.textContent).toBe("WA");
  });

  // 批量勾选(2026-08-04):勾选框点击只切换选择,不能把整行的「打开对局」
  // 也触发了 —— stopPropagation 挂在 label 上,勾选框整块都不冒泡。
  it("勾选框:点击回调 onToggleCheck,且不冒泡到行 onClick(不打开对局)", () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(
      <ul>
        <li onClick={onOpen}>
          <MatchListRow meta={base} checked={false} onToggleCheck={onToggle} />
        </li>
      </ul>,
    );
    const box = container.querySelector(
      "[data-testid='mlr-check']",
    ) as HTMLInputElement;
    expect(box).toBeTruthy();
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("不传 onToggleCheck(旧调用点)→ 不渲染勾选框", () => {
    const { container } = render(
      <ul>
        <li>
          <MatchListRow meta={base} />
        </li>
      </ul>,
    );
    expect(container.querySelector("[data-testid='mlr-check']")).toBeNull();
  });
});
