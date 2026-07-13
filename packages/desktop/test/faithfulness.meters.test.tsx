// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Meters } from "../src/renderer/src/report/components/Meters";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { meterRows } from "../src/renderer/src/report/derive/meterRows";
import { checkFaithful } from "../src/renderer/src/report/derive/faithfulness";
import { loadMatchFixture } from "./fixtures/loadFixture";

const m = loadMatchFixture();
const rows = deriveSummary(m);

describe("checkFaithful: meters", () => {
  it("real fixture render is faithful (no divergences)", () => {
    const model = meterRows(rows, "damage");
    const { container } = render(<Meters rows={rows} mode="damage" />);
    expect(checkFaithful("meters", container, model)).toEqual([]);
  });

  it("HAS TEETH: a mis-scaled bar width is caught", () => {
    const model = meterRows(rows, "damage");
    const { container } = render(<Meters rows={rows} mode="damage" />);
    const bar = container.querySelector<HTMLElement>(".rpt-meter-bar");
    expect(bar).toBeTruthy();
    bar!.style.width = "999%"; // deliberate lie: out of range AND != selector
    const divs = checkFaithful("meters", container, model);
    expect(divs.length).toBeGreaterThan(0);
    expect(divs.some((d) => d.invariant === "view-faithful")).toBe(true);
    expect(divs.some((d) => d.invariant === "range")).toBe(true);
  });

  it("HAS TEETH: a fabricated number label is caught", () => {
    const model = meterRows(rows, "damage");
    const { container } = render(<Meters rows={rows} mode="damage" />);
    const valEl = container.querySelector<HTMLElement>(".rpt-meter-value");
    expect(valEl).toBeTruthy();
    valEl!.textContent = "9,999,999"; // fabricated
    const divs = checkFaithful("meters", container, model);
    expect(
      divs.some(
        (d) =>
          d.invariant === "view-faithful" || d.invariant === "format-roundtrip",
      ),
    ).toBe(true);
  });

  it("HAS TEETH: a px width (not %) is caught (parseFloat would strip the unit)", () => {
    const model = meterRows(rows, "damage");
    const { container } = render(<Meters rows={rows} mode="damage" />);
    const bar = container.querySelector<HTMLElement>(".rpt-meter-bar");
    // Same numeric value, wrong unit: a visually-broken 50px bar.
    bar!.style.width = `${model[0]!.widthPct}px`;
    const divs = checkFaithful("meters", container, model);
    expect(divs.some((d) => d.invariant === "unit")).toBe(true);
  });

  it("HAS TEETH: a fabricated tooltip is caught", () => {
    const model = meterRows(rows, "damage");
    const { container } = render(<Meters rows={rows} mode="damage" />);
    const row = container.querySelector<HTMLElement>(".rpt-meter-row");
    row!.setAttribute("title", "Someone: 42"); // fabricated tooltip number
    const divs = checkFaithful("meters", container, model);
    expect(
      divs.some(
        (d) =>
          d.invariant === "view-faithful" && d.sourceRef.endsWith(".title"),
      ),
    ).toBe(true);
  });
});
