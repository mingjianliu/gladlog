// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FindingsList, findingKey } from "./FindingsList";

const findings = [
  {
    eventIds: ["e1"],
    severity: "high",
    category: "survival",
    title: "Death",
    explanation: "You died at 30s.",
  },
  {
    eventIds: ["e2"],
    severity: "low",
    category: "cd",
    title: "CD",
    explanation: "Held Barkskin.",
  },
];

describe("FindingsList", () => {
  it("renders finding cards in the given order with title + explanation + severity", () => {
    render(<FindingsList findings={findings as any} onSelect={() => {}} />);
    expect(screen.getByText(/You died at 30s/)).toBeTruthy();
    expect(screen.getByText(/Held Barkskin/)).toBeTruthy();
    expect(screen.getByText(/survival/i)).toBeTruthy();
    expect(screen.getByText(/high/i)).toBeTruthy();
  });
  it("renders an empty state when there are no findings", () => {
    render(<FindingsList findings={[]} onSelect={() => {}} />);
    expect(screen.getByText(/no findings|nothing/i)).toBeTruthy();
  });
  it("long explanation clamps to 2 lines with 展开全文/收起 toggle", () => {
    const long = [
      {
        eventIds: [],
        severity: "med",
        category: "positioning",
        title: "Spread",
        explanation: "站位".repeat(80),
      },
    ];
    const { container } = render(
      <FindingsList findings={long as any} onSelect={() => {}} />,
    );
    expect(container.querySelector(".rpt-finding-body.clamp")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /展开全文/ }));
    expect(container.querySelector(".rpt-finding-body.clamp")).toBeNull();
    expect(screen.getByRole("button", { name: /收起/ })).toBeTruthy();
  });
});

describe("finding 标记按钮(phase3 #3a)", () => {
  it("findingKey 语言无关(与 title 无关,eventIds 排序)", () => {
    const a = { eventIds: ["e2", "e1"], category: "survival", title: "死亡", severity: "high", explanation: "x" };
    const b = { eventIds: ["e1", "e2"], category: "survival", title: "Death", severity: "high", explanation: "y" };
    expect(findingKey(a as never)).toBe(findingKey(b as never));
  });

  it("点「已跟进」回调 done,再点清除;active 态跟随 flags", () => {
    const calls: Array<[string, string | null]> = [];
    const key = findingKey(findings[0] as never);
    const { rerender } = render(
      <FindingsList
        findings={findings as never}
        onSelect={() => {}}
        flags={{}}
        onFlag={(k, f) => calls.push([k, f])}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /已跟进/ })[0]!);
    expect(calls).toEqual([[key, "done"]]);
    rerender(
      <FindingsList
        findings={findings as never}
        onSelect={() => {}}
        flags={{ [key]: "done" }}
        onFlag={(k, f) => calls.push([k, f])}
      />,
    );
    const btn = screen.getAllByRole("button", { name: /已跟进/ })[0]!;
    expect(btn.className).toContain("active");
    fireEvent.click(btn);
    expect(calls[1]).toEqual([key, null]);
  });
});
