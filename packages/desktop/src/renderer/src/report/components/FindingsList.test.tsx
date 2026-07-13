// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FindingsList } from "./FindingsList";

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
