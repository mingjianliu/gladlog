// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CohortDimsTable } from "../src/renderer/src/report/components/CohortDimsTable";
import {
  cohortDims,
  type CohortDim,
} from "../src/renderer/src/report/derive/cohortDims";
import { checkFaithful } from "../src/renderer/src/report/derive/faithfulness";

const dims: CohortDim[] = [
  {
    key: "offensiveIndex",
    value: 0.31,
    p10: 0.2,
    p50: 0.49,
    p90: 0.7,
    percentile: 30,
    verdict: "low",
  },
  {
    key: "uptime",
    value: 0.95,
    p10: 0.6,
    p50: 0.8,
    p90: 0.9,
    percentile: 96,
    verdict: "high",
  },
];

describe("checkFaithful: cohort", () => {
  it("faithful render has no divergences", () => {
    const model = cohortDims(dims);
    const { container } = render(<CohortDimsTable rows={model} />);
    expect(checkFaithful("cohort", container, model)).toEqual([]);
  });

  it("HAS TEETH: a fabricated value text is caught (view-faithful)", () => {
    const model = cohortDims(dims);
    const { container } = render(<CohortDimsTable rows={model} />);
    const valEl = container.querySelector<HTMLElement>(
      '[data-dim-key="offensiveIndex"] .rpt-cohort-value',
    );
    valEl!.textContent = "9.99 (99th)"; // lie
    const divs = checkFaithful("cohort", container, model);
    expect(
      divs.some(
        (d) =>
          d.element === "offensiveIndex" && d.invariant === "view-faithful",
      ),
    ).toBe(true);
  });

  it("HAS TEETH: a value below p10 shown at a high percentile is caught (order-consistent)", () => {
    // Model itself lies: value 0.1 <= p10 0.2 but percentile claims 80.
    const lyingModel = cohortDims([
      {
        key: "offensiveIndex",
        value: 0.1,
        p10: 0.2,
        p50: 0.49,
        p90: 0.7,
        percentile: 80,
        verdict: "?",
      },
    ]);
    const { container } = render(<CohortDimsTable rows={lyingModel} />);
    const divs = checkFaithful("cohort", container, lyingModel);
    expect(divs.some((d) => d.invariant === "order-consistent")).toBe(true);
  });
});
