import type { CohortDimRow } from "./cohortDims";
import type { MeterRow } from "./meterRows";
import type { TimelineMarks } from "./timelineMarks";

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
    const widthRaw = bar.style.width.trim();
    const widthPct = parseFloat(widthRaw);
    const label = (valEl.textContent ?? "").trim();
    // (B) unit: the bar width must be a percentage. parseFloat happily strips
    // "px"/"em", so a mis-unit'd (visually broken) render would otherwise pass.
    if (!widthRaw.endsWith("%")) {
      out.push({
        component: "meters",
        element: row.unitId,
        rendered: widthRaw,
        expected: "a % value",
        invariant: "unit",
        sourceRef: `meterRows[${i}].widthPct`,
      });
    }
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
    // (A) view-faithful: the tooltip carries the same name + number.
    const title = el.getAttribute("title") ?? "";
    const expectedTitle = `${row.name}: ${row.label}`;
    if (title !== expectedTitle) {
      out.push({
        component: "meters",
        element: row.unitId,
        rendered: title,
        expected: expectedTitle,
        invariant: "view-faithful",
        sourceRef: `meterRows[${i}].title`,
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

function checkTimeline(root: HTMLElement, model: TimelineMarks): Divergence[] {
  const out: Divergence[] = [];
  const markEls = Array.from(
    root.querySelectorAll<HTMLElement>('[data-testid="timeline-mark"]'),
  );
  const byId = new Map(model.marks.map((m) => [m.id, m]));
  if (markEls.length !== model.marks.length) {
    out.push({
      component: "timeline",
      element: "(count)",
      rendered: String(markEls.length),
      expected: String(model.marks.length),
      invariant: "missing",
      sourceRef: "timelineMarks.marks.length",
    });
  }
  for (const el of markEls) {
    const id = el.getAttribute("data-mark-id") ?? "";
    const mark = byId.get(id);
    if (!mark) {
      out.push({
        component: "timeline",
        element: id,
        rendered: id,
        expected: "an id present in timelineMarks.marks",
        invariant: "maps-to-event",
        sourceRef: "timelineMarks.marks[].id",
      });
      continue;
    }
    const leftRaw = el.style.left.trim();
    const leftPct = parseFloat(leftRaw);
    // (B) unit: the offset must be a percentage (parseFloat would strip px/em).
    if (!leftRaw.endsWith("%")) {
      out.push({
        component: "timeline",
        element: id,
        rendered: leftRaw,
        expected: "a % value",
        invariant: "unit",
        sourceRef: `timelineMarks.marks[${id}].leftPct`,
      });
    }
    // (A) view-faithful
    if (Number.isNaN(leftPct) || !approxEq(leftPct, mark.leftPct)) {
      out.push({
        component: "timeline",
        element: id,
        rendered: String(el.style.left),
        expected: `${mark.leftPct}%`,
        invariant: "view-faithful",
        sourceRef: `timelineMarks.marks[${id}].leftPct`,
      });
    }
    // (A) view-faithful: the tooltip carries the same type + time.
    const title = el.getAttribute("title") ?? "";
    const expectedTitle = `${mark.type} at ${mark.t}s`;
    if (title !== expectedTitle) {
      out.push({
        component: "timeline",
        element: id,
        rendered: title,
        expected: expectedTitle,
        invariant: "view-faithful",
        sourceRef: `timelineMarks.marks[${id}].t`,
      });
    }
    // (B) bounds: a mark cannot claim a time beyond the axis max. The lower side
    // is intentionally unbounded — the original strip renders pre-combat
    // (negative t) marks off the left edge, and C1 must not false-fail that.
    if (mark.t > model.maxT + TOL) {
      out.push({
        component: "timeline",
        element: id,
        rendered: String(mark.t),
        expected: `<= ${model.maxT}`,
        invariant: "bounds",
        sourceRef: `timelineMarks.marks[${id}].t`,
      });
    }
    // (B) leftPct == t/maxT*100 (selector internal consistency; non-circular:
    // re-derives the derived leftPct from the more-primitive t and maxT)
    const expLeft = (mark.t / model.maxT) * 100;
    if (!approxEq(leftPct, expLeft)) {
      out.push({
        component: "timeline",
        element: id,
        rendered: String(leftPct),
        expected: String(expLeft),
        invariant: "leftpct",
        sourceRef: `timelineMarks.marks[${id}]`,
      });
    }
  }
  return out;
}

function checkCohort(root: HTMLElement, rows: CohortDimRow[]): Divergence[] {
  const out: Divergence[] = [];
  const els = Array.from(
    root.querySelectorAll<HTMLElement>('[data-testid="cohort-dim"]'),
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  if (els.length !== rows.length) {
    out.push({
      component: "cohort",
      element: "(count)",
      rendered: String(els.length),
      expected: String(rows.length),
      invariant: "missing",
      sourceRef: "cohortDims.length",
    });
  }
  for (const el of els) {
    const key = el.getAttribute("data-dim-key") ?? "";
    const row = byKey.get(key);
    if (!row) {
      out.push({
        component: "cohort",
        element: key,
        rendered: key,
        expected: "a key present in cohortDims",
        invariant: "maps-to-event",
        sourceRef: "cohortDims[].key",
      });
      continue;
    }
    const valText = (
      el.querySelector(".rpt-cohort-value")?.textContent ?? ""
    ).trim();
    // (A) view-faithful: "value (Nth)" == selector labels
    const expected = `${row.valueLabel} (${row.percentileLabel})`;
    if (valText !== expected) {
      out.push({
        component: "cohort",
        element: key,
        rendered: valText,
        expected,
        invariant: "view-faithful",
        sourceRef: `cohortDims[${key}]`,
      });
    }
    // (B) order-consistency vs p10/p50/p90 (NOT a percentile recompute). Skip
    // when value is null (N/A dim — nothing to compare).
    if (row.value !== null) {
      const v = row.value;
      const p = row.percentile;
      // Strict outer bands only: a value strictly above p90 must sit at >=90th,
      // strictly below p10 at <=10th. On the boundaries (v == an anchor) the
      // percentile is ambiguous under ties, so the inclusive middle band
      // [10,90] applies — this avoids false-failing a clustered cohort where
      // p10==p50==p90 (agy review finding #1).
      let ok: boolean;
      if (v > row.p90) ok = p >= 90;
      else if (v < row.p10) ok = p <= 10;
      else ok = p >= 10 && p <= 90;
      if (!ok) {
        out.push({
          component: "cohort",
          element: key,
          rendered: `pct=${p}`,
          expected: `consistent with value ${v} vs p10=${row.p10}/p90=${row.p90}`,
          invariant: "order-consistent",
          sourceRef: `cohortDims[${key}].percentile`,
        });
      }
    }
  }
  return out;
}

export function checkFaithful(
  kind: "meters",
  root: HTMLElement,
  selectorOutput: MeterRow[],
): Divergence[];
export function checkFaithful(
  kind: "timeline",
  root: HTMLElement,
  selectorOutput: TimelineMarks,
): Divergence[];
export function checkFaithful(
  kind: "cohort",
  root: HTMLElement,
  selectorOutput: CohortDimRow[],
): Divergence[];
export function checkFaithful(
  kind: string,
  root: HTMLElement,
  selectorOutput: unknown,
): Divergence[] {
  switch (kind) {
    case "meters":
      return checkMeters(root, selectorOutput as MeterRow[]);
    case "timeline":
      return checkTimeline(root, selectorOutput as TimelineMarks);
    case "cohort":
      return checkCohort(root, selectorOutput as CohortDimRow[]);
    default:
      throw new Error(`checkFaithful: unknown kind "${kind}"`);
  }
}
