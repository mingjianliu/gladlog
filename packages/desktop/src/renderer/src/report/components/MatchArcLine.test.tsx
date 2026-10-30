// @vitest-environment jsdom
import type { IMatchArcPhase } from "@gladlog/analysis/src/context/matchNarrative";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MatchArcLine } from "./MatchArcLine";

// #10 T4: the match-tempo header line. Three phases plus clickable turning
// points (onSeek receives tS); a short match with two phases and no turning
// point must still render; an empty array renders no line at all (the mounting
// side consumes deriveMatchArc's stub-safe [] directly).

const threePhases: IMatchArcPhase[] = [
  {
    phase: "early",
    fromS: 0,
    toS: 12,
    prose: "No coordinated enemy burst in opening phase.",
    turningPoint: { tS: 12, label: "PlayerA's Barkskin" },
  },
  {
    phase: "mid",
    fromS: 12,
    toS: 40,
    prose:
      "PlayerA's Barkskin committed — limited major CD coverage remaining.",
    turningPoint: { tS: 40, label: "PlayerB died" },
  },
  {
    phase: "late",
    fromS: 40,
    toS: 90,
    prose:
      "Pressure continued with limited defensive options → PlayerB died at 1:30.",
  },
];

const twoPhases: IMatchArcPhase[] = [
  {
    phase: "early",
    fromS: 0,
    toS: 7,
    prose: "Early pressure established — no recovery window.",
  },
  {
    phase: "late",
    fromS: 7,
    toS: 15,
    prose: "PlayerB died at 0:15 — speed kill.",
  },
];

describe("MatchArcLine", () => {
  it("渲染三相位(早期/中期/后期),含两个可点转折点", () => {
    render(<MatchArcLine phases={threePhases} onSeek={vi.fn()} />);
    const line = screen.getByTestId("match-arc-line");
    expect(line.textContent).toContain("早期");
    expect(line.textContent).toContain("中期");
    expect(line.textContent).toContain("后期");
    expect(screen.getAllByRole("button").length).toBe(2);
  });

  it("复核修复:不渲染英文 prose(纯 zh UI 不该混英文长句)", () => {
    render(<MatchArcLine phases={threePhases} onSeek={vi.fn()} />);
    const line = screen.getByTestId("match-arc-line");
    expect(line.textContent).not.toContain("No coordinated enemy burst");
    expect(line.textContent).not.toContain("PlayerA's Barkskin committed");
    expect(line.textContent).not.toContain("Pressure continued");
  });

  it("转折点按钮:zh aria-label + 只显时刻,英文 label 只在 title 提示条", () => {
    const onSeek = vi.fn();
    render(<MatchArcLine phases={threePhases} onSeek={onSeek} />);
    const first = screen.getByRole("button", { name: "跳转到转折点 0:12" });
    expect(first.textContent).toBe("⟶ 0:12");
    expect(first.getAttribute("title")).toBe("PlayerA's Barkskin");
    first.click();
    expect(onSeek).toHaveBeenCalledWith(12, []);

    const second = screen.getByRole("button", { name: "跳转到转折点 0:40" });
    expect(second.getAttribute("title")).toBe("PlayerB died");
    second.click();
    expect(onSeek).toHaveBeenCalledWith(40, []);
  });

  it("短场(<90s)两相位:早期/后期,无转折点不渲染按钮", () => {
    render(<MatchArcLine phases={twoPhases} />);
    const line = screen.getByTestId("match-arc-line");
    expect(line.textContent).toContain("早期");
    expect(line.textContent).toContain("后期");
    expect(screen.queryAllByRole("button").length).toBe(0);
  });

  it("空相位数组 → 整行不渲染", () => {
    const { container } = render(<MatchArcLine phases={[]} />);
    expect(
      container.querySelector('[data-testid="match-arc-line"]'),
    ).toBeNull();
  });

  it("未传 onSeek 时转折点不渲染成死按钮(agy 复核:看着能点却点不动)", () => {
    render(<MatchArcLine phases={threePhases} />);
    expect(screen.queryAllByRole("button").length).toBe(0);
  });
});
