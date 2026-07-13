import type { MeterRow } from "./meterRows";

export interface Divergence {
  component: "meters" | "cohort" | "timeline";
  element: string;
  rendered: string;
  expected: string;
  invariant: string;
  sourceRef: string;
}

const TOL = 1e-6;
const approxEq = (a: number, b: number): boolean => Math.abs(a - b) <= TOL;

function checkMeters(root: HTMLElement, rows: MeterRow[]): Divergence[] {
  const out: Divergence[] = [];
  const rowEls = Array.from(
    root.querySelectorAll<HTMLElement>(".rpt-meter-row"),
  );
  if (rowEls.length !== rows.length) {
    out.push({
      component: "meters",
      element: "(count)",
      rendered: String(rowEls.length),
      expected: String(rows.length),
      invariant: "missing",
      sourceRef: "meterRows.length",
    });
  }
  const n = Math.min(rowEls.length, rows.length);
  const domWidths: number[] = [];
  for (let i = 0; i < n; i++) {
    const el = rowEls[i]!;
    const row = rows[i]!;
    const bar = el.querySelector<HTMLElement>(".rpt-meter-bar");
    const valEl = el.querySelector<HTMLElement>(".rpt-meter-value");
    if (!bar || !valEl) {
      out.push({
        component: "meters",
        element: row.unitId,
        rendered: "",
        expected: "bar + value elements",
        invariant: "missing",
        sourceRef: `meterRows[${i}]`,
      });
      continue;
    }
    const widthPct = parseFloat(bar.style.width);
    const label = (valEl.textContent ?? "").trim();
    // (A) view-faithful: rendered == selector
    if (Number.isNaN(widthPct) || !approxEq(widthPct, row.widthPct)) {
      out.push({
        component: "meters",
        element: row.unitId,
        rendered: String(bar.style.width),
        expected: `${row.widthPct}%`,
        invariant: "view-faithful",
        sourceRef: `meterRows[${i}].widthPct`,
      });
    }
    if (label !== row.label) {
      out.push({
        component: "meters",
        element: row.unitId,
        rendered: label,
        expected: row.label,
        invariant: "view-faithful",
        sourceRef: `meterRows[${i}].label`,
      });
    }
    // (B) range
    if (!(widthPct >= -TOL && widthPct <= 100 + TOL)) {
      out.push({
        component: "meters",
        element: row.unitId,
        rendered: String(widthPct),
        expected: "[0,100]",
        invariant: "range",
        sourceRef: `meterRows[${i}].widthPct`,
      });
    }
    // (B) format round-trip: parse "1,234" -> 1234 == Math.round(value)
    const parsed = Number(label.replace(/,/g, ""));
    if (Number.isNaN(parsed) || parsed !== Math.round(row.value)) {
      out.push({
        component: "meters",
        element: row.unitId,
        rendered: label,
        expected: String(Math.round(row.value)),
        invariant: "format-roundtrip",
        sourceRef: `meterRows[${i}].value`,
      });
    }
    domWidths.push(widthPct);
  }
  // (B) monotonic: widths are non-increasing (rows are sorted desc by value)
  for (let i = 1; i < domWidths.length; i++) {
    if (domWidths[i]! > domWidths[i - 1]! + TOL) {
      out.push({
        component: "meters",
        element: rows[i]!.unitId,
        rendered: String(domWidths[i]),
        expected: `<= ${domWidths[i - 1]}`,
        invariant: "monotonic",
        sourceRef: `meterRows[${i}].widthPct`,
      });
    }
  }
  // (B) max value row == 100% (guarded: only when the max value >= 1, i.e. a
  // non-degenerate meter; all-zero and sub-unit meters are exempt).
  const maxValue = Math.max(0, ...rows.map((r) => r.value));
  if (maxValue >= 1 && domWidths.length > 0 && !approxEq(domWidths[0]!, 100)) {
    out.push({
      component: "meters",
      element: rows[0]!.unitId,
      rendered: String(domWidths[0]),
      expected: "100",
      invariant: "max-100",
      sourceRef: "meterRows[0].widthPct",
    });
  }
  return out;
}

export function checkFaithful(
  kind: "meters",
  root: HTMLElement,
  selectorOutput: MeterRow[],
): Divergence[];
export function checkFaithful(
  kind: string,
  root: HTMLElement,
  selectorOutput: unknown,
): Divergence[] {
  switch (kind) {
    case "meters":
      return checkMeters(root, selectorOutput as MeterRow[]);
    default:
      throw new Error(`checkFaithful: unknown kind "${kind}"`);
  }
}
