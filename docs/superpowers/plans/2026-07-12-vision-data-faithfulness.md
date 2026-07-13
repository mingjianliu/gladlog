# C1 — VISION Data-Faithfulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that every rendered meter bar/number, cohort percentile, and timeline mark in the gladlog report UI is faithful to the data its component was given — no fabricated, mis-scaled, or mismatched visuals — with a headless, machine-readable check an agent can invoke.

**Architecture:** Extract the inline render-math from `Meters`, `TimelineStrip`, and `ProComparisonVerified` into pure, unit-tested selectors under `report/derive/`. The components become dumb renderers of the selector output. A new `report/derive/faithfulness.ts` walks the rendered DOM and compares each rendered value against the selector output (view-faithful) plus non-circular structural invariants (bounds/monotonicity/order-consistency/format round-trip), emitting `Divergence[]`. A `verify:vision` script runs the checks headlessly and prints structured diffs.

**Tech Stack:** TypeScript (ESM, strict), React 19, vitest + @testing-library/react (jsdom), react-dom/server + jsdom for the headless script, tsx runner.

## Global Constraints

- **Scope is exactly three components:** Meters, cohort panel (ProComparisonVerified), TimelineStrip. Nothing else.
- **Isolate the view layer. Do NOT re-derive aggregation or percentile.** Never re-sum `deriveSummary` (it includes pet damage — a naive re-sum false-fails Hunters/Warlocks/DKs) and never recompute the cohort percentile from p10/p50/p90 (circular: `f(x)==f(x)`). Aggregation/percentile/parser correctness belong to the LOG/PROMPT pillars, not C1.
- **Selectors are pure functions in `packages/desktop/src/renderer/src/report/derive/`.** Components contain no arithmetic after refactor.
- **Divergence shape (JSON-serializable):** `{ component, element, rendered, expected, invariant, sourceRef }`.
- **Float comparisons use tolerance `1e-6`.**
- **Behavior equivalence:** the existing desktop test suite must stay green — the refactored components must render byte-identically for real inputs.
- **Tests:** vitest; any test that renders/touches the DOM has `// @vitest-environment jsdom` as its FIRST line; import test helpers from `"vitest"`. Fixture-integration tests live in `packages/desktop/test/` and import `./fixtures/loadFixture`; pure selector unit tests are colocated next to the selector in `derive/`.
- **Typecheck via `npm run typecheck` (= `tsc --noEmit`). NEVER `tsc -b`** — it emits `.js` into `src/` and shadows the `.ts` sources.
- **`verify:vision`** runs headlessly, prints JSON `Divergence[]`, and exits non-zero when any divergence is found.
- **Do NOT enter or handle the Anthropic API key.** No task requires it.

Run a single desktop test file with: `npm -w @gladlog/desktop test -- <path-fragment>` (vitest treats trailing args as filename filters).

---

### Task 1: Meters vertical slice (selector + dumb renderer + faithfulness checker)

**Files:**

- Create: `packages/desktop/src/renderer/src/report/derive/meterRows.ts`
- Create: `packages/desktop/src/renderer/src/report/derive/meterRows.test.ts`
- Create: `packages/desktop/src/renderer/src/report/derive/faithfulness.ts`
- Create: `packages/desktop/test/faithfulness.meters.test.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/Meters.tsx`

**Interfaces:**

- Consumes: `UnitTotals` from `../derive/summary`; `classColor` from `../data/gameConstants`; `deriveSummary` + `loadMatchFixture` in the integration test.
- Produces:
  - `type MeterMode = "damage" | "healing" | "taken"`
  - `interface MeterRow { unitId: string; name: string; classId: number; value: number; widthPct: number; label: string; color: string }`
  - `function meterValue(r: UnitTotals, mode: MeterMode): number`
  - `function meterRows(rows: UnitTotals[], mode: MeterMode): MeterRow[]`
  - `interface Divergence { component: "meters" | "cohort" | "timeline"; element: string; rendered: string; expected: string; invariant: string; sourceRef: string }`
  - `function checkFaithful(kind: "meters", root: HTMLElement, selectorOutput: MeterRow[]): Divergence[]` (overloaded; timeline/cohort added in later tasks)

- [ ] **Step 1: Write the failing selector unit test**

Create `packages/desktop/src/renderer/src/report/derive/meterRows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { meterRows, meterValue } from "./meterRows";
import type { UnitTotals } from "./summary";

function u(partial: Partial<UnitTotals>): UnitTotals {
  return {
    unitId: "id",
    name: "X",
    classId: 1,
    specId: 0,
    teamId: 0,
    damageDone: 0,
    healingDone: 0,
    absorbsDone: 0,
    damageTaken: 0,
    deaths: 0,
    dps: 0,
    hps: 0,
    ...partial,
  };
}

describe("meterValue", () => {
  it("selects the field for the mode; healing sums heal + absorbs", () => {
    const row = u({
      damageDone: 100,
      healingDone: 30,
      absorbsDone: 20,
      damageTaken: 7,
    });
    expect(meterValue(row, "damage")).toBe(100);
    expect(meterValue(row, "healing")).toBe(50);
    expect(meterValue(row, "taken")).toBe(7);
  });
});

describe("meterRows", () => {
  it("sorts desc, scales width to the max, formats the label with thousands separators", () => {
    const rows = [
      u({ unitId: "a", name: "A", classId: 2, damageDone: 500 }),
      u({ unitId: "b", name: "B", classId: 3, damageDone: 2000 }),
    ];
    const out = meterRows(rows, "damage");
    expect(out.map((r) => r.unitId)).toEqual(["b", "a"]);
    expect(out[0].widthPct).toBe(100);
    expect(out[1].widthPct).toBe(25);
    expect(out[0].label).toBe("2,000");
    expect(out[1].value).toBe(500);
  });

  it("all-zero meter yields widthPct 0 for every row (no divide-by-zero)", () => {
    const out = meterRows(
      [u({ unitId: "a", damageDone: 0 }), u({ unitId: "b", damageDone: 0 })],
      "damage",
    );
    expect(out.every((r) => r.widthPct === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @gladlog/desktop test -- report/derive/meterRows.test.ts`
Expected: FAIL — cannot find module `./meterRows`.

- [ ] **Step 3: Implement the selector**

Create `packages/desktop/src/renderer/src/report/derive/meterRows.ts`:

```ts
import type { UnitTotals } from "./summary";
import { classColor } from "../data/gameConstants";

export type MeterMode = "damage" | "healing" | "taken";

export interface MeterRow {
  unitId: string;
  name: string;
  classId: number;
  value: number;
  widthPct: number;
  label: string;
  color: string;
}

export function meterValue(r: UnitTotals, mode: MeterMode): number {
  return mode === "damage"
    ? r.damageDone
    : mode === "healing"
      ? r.healingDone + r.absorbsDone
      : r.damageTaken;
}

export function meterRows(rows: UnitTotals[], mode: MeterMode): MeterRow[] {
  const sorted = [...rows].sort(
    (a, b) => meterValue(b, mode) - meterValue(a, mode),
  );
  const max = Math.max(1, ...sorted.map((r) => meterValue(r, mode)));
  return sorted.map((r) => {
    const value = meterValue(r, mode);
    return {
      unitId: r.unitId,
      name: r.name,
      classId: r.classId,
      value,
      widthPct: (value / max) * 100,
      label: Math.round(value).toLocaleString("en-US"),
      color: classColor(r.classId),
    };
  });
}
```

- [ ] **Step 4: Run the selector test to verify it passes**

Run: `npm -w @gladlog/desktop test -- report/derive/meterRows.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor Meters.tsx to a dumb renderer**

Replace the entire contents of `packages/desktop/src/renderer/src/report/components/Meters.tsx` with:

```tsx
import { meterRows, type MeterMode } from "../derive/meterRows";
import type { UnitTotals } from "../derive/summary";

export function Meters({
  rows,
  mode,
}: {
  rows: UnitTotals[];
  mode: MeterMode;
}) {
  const items = meterRows(rows, mode);
  return (
    <div className="rpt-meters">
      {items.map((r) => (
        <div
          key={r.unitId}
          className="rpt-meter-row"
          title={`${r.name}: ${r.label}`}
        >
          <span className="rpt-meter-name">{r.name}</span>
          <span className="rpt-meter-bar-track">
            <span
              className="rpt-meter-bar"
              style={{ width: `${r.widthPct}%`, background: r.color }}
            />
          </span>
          <span className="rpt-meter-value">{r.label}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Verify no regression + typecheck**

Run: `npm -w @gladlog/desktop test -- report && npm -w @gladlog/desktop run typecheck`
Expected: all existing report tests PASS, typecheck clean (0 errors).

- [ ] **Step 7: Write the failing faithfulness integration + has-teeth test**

Create `packages/desktop/test/faithfulness.meters.test.tsx`:

```tsx
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
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npm -w @gladlog/desktop test -- faithfulness.meters`
Expected: FAIL — cannot find module `../src/renderer/src/report/derive/faithfulness`.

- [ ] **Step 9: Implement faithfulness.ts (Divergence + meters checker + dispatch)**

Create `packages/desktop/src/renderer/src/report/derive/faithfulness.ts`:

```ts
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
```

- [ ] **Step 10: Run the faithfulness test to verify it passes**

Run: `npm -w @gladlog/desktop test -- faithfulness.meters`
Expected: PASS (3 tests: faithful render === [], and both has-teeth cases caught).

- [ ] **Step 11: Typecheck + commit**

Run: `npm -w @gladlog/desktop run typecheck`
Expected: 0 errors.

```bash
git add packages/desktop/src/renderer/src/report/derive/meterRows.ts \
        packages/desktop/src/renderer/src/report/derive/meterRows.test.ts \
        packages/desktop/src/renderer/src/report/derive/faithfulness.ts \
        packages/desktop/test/faithfulness.meters.test.tsx \
        packages/desktop/src/renderer/src/report/components/Meters.tsx
git commit -m "feat(vision): meters selector + faithfulness checker (C1)"
```

---

### Task 2: Timeline vertical slice (selector + dumb renderer + faithfulness checker)

**Files:**

- Create: `packages/desktop/src/renderer/src/report/derive/timelineMarks.ts`
- Create: `packages/desktop/src/renderer/src/report/derive/timelineMarks.test.ts`
- Create: `packages/desktop/test/faithfulness.timeline.test.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/TimelineStrip.tsx`
- Modify: `packages/desktop/src/renderer/src/report/derive/faithfulness.ts` (add timeline branch)

**Interfaces:**

- Consumes: `CandidateEvent` (type) from `@gladlog/analysis`; `Divergence` + `checkFaithful` from Task 1.
- Produces:
  - `interface TimelineMark { id: string; t: number; leftPct: number; type: string }`
  - `interface TimelineMarks { marks: TimelineMark[]; maxT: number }`
  - `function timelineMarks(candidates: CandidateEvent[]): TimelineMarks`
  - overload `checkFaithful(kind: "timeline", root: HTMLElement, selectorOutput: TimelineMarks): Divergence[]`
- Note: the spec's `timelineMarks(candidates, start, end)` signature is simplified to `timelineMarks(candidates)` — the component scales by an internal `maxT` (behavior-equivalence requirement; match start/end are not available at this layer), so the timeline bounds invariant is `t ∈ [0, maxT]`.

- [ ] **Step 1: Write the failing selector unit test**

Create `packages/desktop/src/renderer/src/report/derive/timelineMarks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { timelineMarks } from "./timelineMarks";
import type { CandidateEvent } from "@gladlog/analysis";

function ev(id: string, t: number, type = "death"): CandidateEvent {
  return { id, type, t, unitNames: [], facts: { t: String(t) } };
}

describe("timelineMarks", () => {
  it("keeps only point events (facts.t defined), scales leftPct to maxT", () => {
    const marks = timelineMarks([ev("a", 10), ev("b", 40)]);
    expect(marks.maxT).toBe(40);
    expect(marks.marks.map((m) => m.id)).toEqual(["a", "b"]);
    expect(marks.marks[0].leftPct).toBe(25);
    expect(marks.marks[1].leftPct).toBe(100);
  });

  it("drops whole-round events with no facts.t", () => {
    const cdWaste: CandidateEvent = {
      id: "c",
      type: "cd-waste",
      t: 0,
      unitNames: [],
      facts: {},
    };
    const marks = timelineMarks([ev("a", 10), cdWaste]);
    expect(marks.marks.map((m) => m.id)).toEqual(["a"]);
  });

  it("empty input yields no marks and maxT >= 1 (no divide-by-zero)", () => {
    const marks = timelineMarks([]);
    expect(marks.marks).toEqual([]);
    expect(marks.maxT).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @gladlog/desktop test -- report/derive/timelineMarks.test.ts`
Expected: FAIL — cannot find module `./timelineMarks`.

- [ ] **Step 3: Implement the selector**

Create `packages/desktop/src/renderer/src/report/derive/timelineMarks.ts`:

```ts
import type { CandidateEvent } from "@gladlog/analysis";

export interface TimelineMark {
  id: string;
  t: number;
  leftPct: number;
  type: string;
}

export interface TimelineMarks {
  marks: TimelineMark[];
  maxT: number;
}

export function timelineMarks(candidates: CandidateEvent[]): TimelineMarks {
  // Only point-in-time events belong on a time axis. Whole-round observations
  // (e.g. cd-waste, t=0, no facts.t) would otherwise plot at the far left.
  const points = candidates.filter((c) => c.facts.t !== undefined);
  const maxT = Math.max(1, ...points.map((c) => c.t));
  const marks = points.map((c) => ({
    id: c.id,
    t: c.t,
    leftPct: (c.t / maxT) * 100,
    type: c.type,
  }));
  return { marks, maxT };
}
```

- [ ] **Step 4: Run the selector test to verify it passes**

Run: `npm -w @gladlog/desktop test -- report/derive/timelineMarks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor TimelineStrip.tsx to a dumb renderer**

Replace the entire contents of `packages/desktop/src/renderer/src/report/components/TimelineStrip.tsx` with:

```tsx
import type { CandidateEvent } from "@gladlog/analysis";
import { timelineMarks } from "../derive/timelineMarks";

export function TimelineStrip({
  candidates,
  activeEventIds,
  onSelect,
}: {
  candidates: CandidateEvent[];
  activeEventIds: string[];
  onSelect: (id: string) => void;
}) {
  const { marks } = timelineMarks(candidates);
  if (marks.length === 0) return null;

  return (
    <div
      style={{
        height: "24px",
        position: "relative",
        background: "var(--bg-2, #1f2937)",
        borderRadius: "4px",
        margin: "12px 0",
        border: "1px solid var(--border, #374151)",
      }}
    >
      {marks.map((m) => {
        const isActive = activeEventIds.includes(m.id);
        return (
          <div
            key={m.id}
            data-testid="timeline-mark"
            data-mark-id={m.id}
            onClick={() => onSelect(m.id)}
            style={{
              position: "absolute",
              left: `${m.leftPct}%`,
              top: 0,
              bottom: 0,
              width: "4px",
              marginLeft: "-2px", // center the marker
              background: isActive
                ? "var(--accent, #60a5fa)"
                : "var(--border, #4b5563)",
              cursor: "pointer",
              zIndex: isActive ? 2 : 1,
              transition: "background 0.2s",
            }}
            title={`${m.type} at ${m.t}s`}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Verify no regression + typecheck**

Run: `npm -w @gladlog/desktop test -- report && npm -w @gladlog/desktop run typecheck`
Expected: existing report tests (incl. TimelineStrip) PASS, typecheck clean.

- [ ] **Step 7: Write the failing faithfulness + has-teeth test**

Create `packages/desktop/test/faithfulness.timeline.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TimelineStrip } from "../src/renderer/src/report/components/TimelineStrip";
import { timelineMarks } from "../src/renderer/src/report/derive/timelineMarks";
import { checkFaithful } from "../src/renderer/src/report/derive/faithfulness";
import type { CandidateEvent } from "@gladlog/analysis";

function ev(id: string, t: number, type = "death"): CandidateEvent {
  return { id, type, t, unitNames: [], facts: { t: String(t) } };
}
const candidates = [ev("a", 10), ev("b", 25), ev("c", 40)];

describe("checkFaithful: timeline", () => {
  it("faithful render has no divergences", () => {
    const model = timelineMarks(candidates);
    const { container } = render(
      <TimelineStrip
        candidates={candidates}
        activeEventIds={[]}
        onSelect={() => {}}
      />,
    );
    expect(checkFaithful("timeline", container, model)).toEqual([]);
  });

  it("HAS TEETH: a mis-placed mark (wrong left%) is caught", () => {
    const model = timelineMarks(candidates);
    const { container } = render(
      <TimelineStrip
        candidates={candidates}
        activeEventIds={[]}
        onSelect={() => {}}
      />,
    );
    const mark = container.querySelector<HTMLElement>('[data-mark-id="a"]');
    expect(mark).toBeTruthy();
    mark!.style.left = "88%"; // lie: model says 25%
    const divs = checkFaithful("timeline", container, model);
    expect(
      divs.some((d) => d.element === "a" && d.invariant === "view-faithful"),
    ).toBe(true);
  });

  it("HAS TEETH: a phantom mark id (not in the model) is caught", () => {
    const model = timelineMarks(candidates);
    const { container } = render(
      <TimelineStrip
        candidates={candidates}
        activeEventIds={[]}
        onSelect={() => {}}
      />,
    );
    const mark = container.querySelector<HTMLElement>('[data-mark-id="a"]');
    mark!.setAttribute("data-mark-id", "ghost");
    const divs = checkFaithful("timeline", container, model);
    expect(divs.some((d) => d.invariant === "maps-to-event")).toBe(true);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npm -w @gladlog/desktop test -- faithfulness.timeline`
Expected: FAIL — `checkFaithful: unknown kind "timeline"` thrown.

- [ ] **Step 9: Add the timeline branch to faithfulness.ts**

In `packages/desktop/src/renderer/src/report/derive/faithfulness.ts`, add the import at the top (after the existing `MeterRow` import):

```ts
import type { TimelineMarks } from "./timelineMarks";
```

Add this function immediately before the `checkFaithful` overload declarations:

```ts
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
    const leftPct = parseFloat(el.style.left);
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
    // (B) bounds: t in [0, maxT]
    if (!(mark.t >= -TOL && mark.t <= model.maxT + TOL)) {
      out.push({
        component: "timeline",
        element: id,
        rendered: String(mark.t),
        expected: `[0,${model.maxT}]`,
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
```

Add the overload declaration (before the implementation signature) and the switch case:

```ts
export function checkFaithful(
  kind: "timeline",
  root: HTMLElement,
  selectorOutput: TimelineMarks,
): Divergence[];
```

```ts
    case "timeline":
      return checkTimeline(root, selectorOutput as TimelineMarks);
```

- [ ] **Step 10: Run the faithfulness test to verify it passes**

Run: `npm -w @gladlog/desktop test -- faithfulness.timeline`
Expected: PASS (3 tests).

- [ ] **Step 11: Typecheck + commit**

Run: `npm -w @gladlog/desktop run typecheck`
Expected: 0 errors.

```bash
git add packages/desktop/src/renderer/src/report/derive/timelineMarks.ts \
        packages/desktop/src/renderer/src/report/derive/timelineMarks.test.ts \
        packages/desktop/src/renderer/src/report/derive/faithfulness.ts \
        packages/desktop/test/faithfulness.timeline.test.tsx \
        packages/desktop/src/renderer/src/report/components/TimelineStrip.tsx
git commit -m "feat(vision): timeline selector + faithfulness checker (C1)"
```

---

### Task 3: Cohort vertical slice (selector + pure sub-component + faithfulness checker)

**Files:**

- Create: `packages/desktop/src/renderer/src/report/derive/cohortDims.ts`
- Create: `packages/desktop/src/renderer/src/report/derive/cohortDims.test.ts`
- Create: `packages/desktop/src/renderer/src/report/components/CohortDimsTable.tsx`
- Create: `packages/desktop/test/faithfulness.cohort.test.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/ProComparisonVerified.tsx`
- Modify: `packages/desktop/src/renderer/src/report/derive/faithfulness.ts` (add cohort branch)

**Interfaces:**

- Consumes: `Divergence` + `checkFaithful` from prior tasks.
- Produces:
  - `interface CohortDim { key: string; value: number | null; p10: number; p50: number; p90: number; percentile: number; verdict: string }`
  - `interface CohortDimRow { key: string; value: number | null; valueLabel: string; percentile: number; percentileLabel: string; verdict: string; p10: number; p50: number; p90: number }`
  - `function cohortDims(dims: CohortDim[]): CohortDimRow[]`
  - `function CohortDimsTable({ rows }: { rows: CohortDimRow[] }): JSX.Element | null`
  - overload `checkFaithful(kind: "cohort", root: HTMLElement, selectorOutput: CohortDimRow[]): Divergence[]`

- [ ] **Step 1: Write the failing selector unit test**

Create `packages/desktop/src/renderer/src/report/derive/cohortDims.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cohortDims, type CohortDim } from "./cohortDims";

const dim = (partial: Partial<CohortDim>): CohortDim => ({
  key: "offensiveIndex",
  value: 0.31,
  p10: 0.2,
  p50: 0.49,
  p90: 0.7,
  percentile: 30,
  verdict: "bottom quartile",
  ...partial,
});

describe("cohortDims", () => {
  it("formats value + percentile labels, passes anchors through", () => {
    const [row] = cohortDims([dim({})]);
    expect(row.valueLabel).toBe("0.31");
    expect(row.percentileLabel).toBe("30th");
    expect(row.p90).toBe(0.7);
    expect(row.verdict).toBe("bottom quartile");
  });

  it("renders null value as N/A", () => {
    const [row] = cohortDims([dim({ value: null })]);
    expect(row.valueLabel).toBe("N/A");
    expect(row.value).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w @gladlog/desktop test -- report/derive/cohortDims.test.ts`
Expected: FAIL — cannot find module `./cohortDims`.

- [ ] **Step 3: Implement the selector**

Create `packages/desktop/src/renderer/src/report/derive/cohortDims.ts`:

```ts
export interface CohortDim {
  key: string;
  value: number | null;
  p10: number;
  p50: number;
  p90: number;
  percentile: number;
  verdict: string;
}

export interface CohortDimRow {
  key: string;
  value: number | null;
  valueLabel: string;
  percentile: number;
  percentileLabel: string;
  verdict: string;
  p10: number;
  p50: number;
  p90: number;
}

export function cohortDims(dims: CohortDim[]): CohortDimRow[] {
  return dims.map((d) => ({
    key: d.key,
    value: d.value,
    valueLabel: d.value !== null ? String(d.value) : "N/A",
    percentile: d.percentile,
    percentileLabel: `${d.percentile}th`,
    verdict: d.verdict,
    p10: d.p10,
    p50: d.p50,
    p90: d.p90,
  }));
}
```

- [ ] **Step 4: Run the selector test to verify it passes**

Run: `npm -w @gladlog/desktop test -- report/derive/cohortDims.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the pure CohortDimsTable component**

Create `packages/desktop/src/renderer/src/report/components/CohortDimsTable.tsx`:

```tsx
import type { CohortDimRow } from "../derive/cohortDims";

export function CohortDimsTable({ rows }: { rows: CohortDimRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div data-testid="cohort-dims" style={{ marginBottom: "16px" }}>
      {rows.map((dim) => (
        <div
          key={dim.key}
          data-testid="cohort-dim"
          data-dim-key={dim.key}
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "13px",
          }}
        >
          <span className="rpt-cohort-key">{dim.key}</span>
          <span className="rpt-cohort-value">
            {dim.valueLabel} ({dim.percentileLabel})
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Wire CohortDimsTable into ProComparisonVerified**

In `packages/desktop/src/renderer/src/report/components/ProComparisonVerified.tsx`, add these imports near the top (after the existing `import type { ReportSource }` line):

```tsx
import { cohortDims } from "../derive/cohortDims";
import { CohortDimsTable } from "./CohortDimsTable";
```

Replace this block (the inline dims rendering, currently lines ~166-185):

```tsx
{
  result.verifiedComparison.dims.length > 0 && (
    <div style={{ marginBottom: "16px" }}>
      {result.verifiedComparison.dims.map((dim) => (
        <div
          key={dim.key}
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "13px",
          }}
        >
          <span>{dim.key}</span>
          <span>
            {dim.value !== null ? dim.value : "N/A"} ({dim.percentile}
            th)
          </span>
        </div>
      ))}
    </div>
  );
}
```

with:

```tsx
<CohortDimsTable rows={cohortDims(result.verifiedComparison.dims)} />
```

- [ ] **Step 7: Verify no regression + typecheck**

Run: `npm -w @gladlog/desktop test -- ProComparisonVerified && npm -w @gladlog/desktop run typecheck`
Expected: existing `ProComparisonVerified` test PASS (still finds `offensiveIndex`, the report text, and the build meta), typecheck clean.

- [ ] **Step 8: Write the failing faithfulness + has-teeth test**

Create `packages/desktop/test/faithfulness.cohort.test.tsx`:

```tsx
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
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npm -w @gladlog/desktop test -- faithfulness.cohort`
Expected: FAIL — `checkFaithful: unknown kind "cohort"` thrown.

- [ ] **Step 10: Add the cohort branch to faithfulness.ts**

In `packages/desktop/src/renderer/src/report/derive/faithfulness.ts`, add the import (with the other type imports at the top):

```ts
import type { CohortDimRow } from "./cohortDims";
```

Add this function before the `checkFaithful` overload declarations:

```ts
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
      let ok: boolean;
      if (v >= row.p90) ok = p >= 90;
      else if (v <= row.p10) ok = p <= 10;
      else ok = p > 10 && p < 90; // p10 < v < p90
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
```

Add the overload declaration (with the others) and the switch case:

```ts
export function checkFaithful(
  kind: "cohort",
  root: HTMLElement,
  selectorOutput: CohortDimRow[],
): Divergence[];
```

```ts
    case "cohort":
      return checkCohort(root, selectorOutput as CohortDimRow[]);
```

- [ ] **Step 11: Run the faithfulness test to verify it passes**

Run: `npm -w @gladlog/desktop test -- faithfulness.cohort`
Expected: PASS (3 tests).

- [ ] **Step 12: Typecheck + commit**

Run: `npm -w @gladlog/desktop run typecheck`
Expected: 0 errors.

```bash
git add packages/desktop/src/renderer/src/report/derive/cohortDims.ts \
        packages/desktop/src/renderer/src/report/derive/cohortDims.test.ts \
        packages/desktop/src/renderer/src/report/components/CohortDimsTable.tsx \
        packages/desktop/src/renderer/src/report/derive/faithfulness.ts \
        packages/desktop/test/faithfulness.cohort.test.tsx \
        packages/desktop/src/renderer/src/report/components/ProComparisonVerified.tsx
git commit -m "feat(vision): cohort selector + faithfulness checker (C1)"
```

---

### Task 4: Headless `verify:vision` script (cross-agent output)

**Files:**

- Create: `packages/desktop/scripts/verifyVision.ts`
- Modify: `packages/desktop/package.json` (add `verify:vision` script)

**Interfaces:**

- Consumes: `loadMatchFixture`, `deriveSummary`, `meterRows`, `timelineMarks`, `cohortDims`, `checkFaithful`, `Meters`, `TimelineStrip`, `CohortDimsTable` from the prior tasks; `renderToStaticMarkup` (react-dom/server) + `JSDOM` (jsdom) for headless rendering.
- Produces: an executable script that prints `{ component, divergences }` JSON per component and exits non-zero on any divergence. (`scripts/` is excluded from `tsc` per `tsconfig.json` `include`, so a jsdom→HTMLElement cast is fine.)

- [ ] **Step 1: Implement the script**

Create `packages/desktop/scripts/verifyVision.ts`:

```ts
// Headless data-faithfulness check (C1). Renders each report component to
// static HTML, parses it with jsdom, runs checkFaithful, prints structured
// diffs, and exits non-zero if anything diverged. Cross-agent primitive:
//   npm -w @gladlog/desktop run verify:vision
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadMatchFixture } from "../test/fixtures/loadFixture";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { meterRows } from "../src/renderer/src/report/derive/meterRows";
import { timelineMarks } from "../src/renderer/src/report/derive/timelineMarks";
import {
  cohortDims,
  type CohortDim,
} from "../src/renderer/src/report/derive/cohortDims";
import {
  checkFaithful,
  type Divergence,
} from "../src/renderer/src/report/derive/faithfulness";
import { Meters } from "../src/renderer/src/report/components/Meters";
import { TimelineStrip } from "../src/renderer/src/report/components/TimelineStrip";
import { CohortDimsTable } from "../src/renderer/src/report/components/CohortDimsTable";
import type { CandidateEvent } from "@gladlog/analysis";

function rootOf(html: string): HTMLElement {
  const dom = new JSDOM(
    `<!doctype html><body><div id="root">${html}</div></body>`,
  );
  return dom.window.document.getElementById("root") as unknown as HTMLElement;
}

// Timeline + cohort inputs aren't part of the match fixture (they come from
// candidate extraction and the compare service); use deterministic fixtures so
// the check is self-contained and reproducible.
const candidates: CandidateEvent[] = [
  {
    id: "d1",
    type: "death",
    t: 12,
    unitNames: ["PlayerA-Test"],
    facts: { t: "12" },
  },
  {
    id: "d2",
    type: "death",
    t: 47,
    unitNames: ["PlayerB-Test"],
    facts: { t: "47" },
  },
];
const cohortFixture: CohortDim[] = [
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

function main(): void {
  const match = loadMatchFixture();
  const results: { component: string; divergences: Divergence[] }[] = [];

  const meterModel = meterRows(deriveSummary(match), "damage");
  results.push({
    component: "meters",
    divergences: checkFaithful(
      "meters",
      rootOf(
        renderToStaticMarkup(
          createElement(Meters, { rows: deriveSummary(match), mode: "damage" }),
        ),
      ),
      meterModel,
    ),
  });

  const tlModel = timelineMarks(candidates);
  results.push({
    component: "timeline",
    divergences: checkFaithful(
      "timeline",
      rootOf(
        renderToStaticMarkup(
          createElement(TimelineStrip, {
            candidates,
            activeEventIds: [],
            onSelect: () => {},
          }),
        ),
      ),
      tlModel,
    ),
  });

  const cohortModel = cohortDims(cohortFixture);
  results.push({
    component: "cohort",
    divergences: checkFaithful(
      "cohort",
      rootOf(
        renderToStaticMarkup(
          createElement(CohortDimsTable, { rows: cohortModel }),
        ),
      ),
      cohortModel,
    ),
  });

  console.log(JSON.stringify(results, null, 2));
  const total = results.reduce((a, r) => a + r.divergences.length, 0);
  if (total > 0) {
    console.error(`verify:vision FAILED — ${total} divergence(s)`);
    process.exit(1);
  }
  console.error("verify:vision OK — 0 divergences");
}

main();
```

- [ ] **Step 2: Add the npm script**

In `packages/desktop/package.json`, add to `"scripts"`:

```json
    "verify:vision": "tsx scripts/verifyVision.ts"
```

- [ ] **Step 3: Run the script — expect a clean pass**

Run: `npm -w @gladlog/desktop run verify:vision`
Expected: prints a JSON array of 3 components each with `"divergences": []`, then `verify:vision OK — 0 divergences`, exit code 0.

- [ ] **Step 4: Prove it has teeth end-to-end (temporary lie, then revert)**

Temporarily break one component to confirm the script catches it. In `Meters.tsx`, change `width: \`${r.widthPct}%\`` to `width: \`${r.widthPct * 2}%\``.

Run: `npm -w @gladlog/desktop run verify:vision; echo "exit=$?"`
Expected: JSON shows `meters` divergences (view-faithful + range), stderr `verify:vision FAILED`, `exit=1`.

Then revert the change:

```bash
git checkout -- packages/desktop/src/renderer/src/report/components/Meters.tsx
```

Re-run to confirm clean again:

Run: `npm -w @gladlog/desktop run verify:vision; echo "exit=$?"`
Expected: `verify:vision OK`, `exit=0`.

- [ ] **Step 5: Full suite + typecheck + commit**

Run: `npm -w @gladlog/desktop test && npm -w @gladlog/desktop run typecheck`
Expected: all tests PASS, typecheck clean.

```bash
git add packages/desktop/scripts/verifyVision.ts packages/desktop/package.json
git commit -m "feat(vision): headless verify:vision script (C1)"
```

---

## Self-Review

**1. Spec coverage:**

- 组件一 selectors `meterRows`/`timelineMarks`/`cohortDims` → Tasks 1/2/3 Steps 1-4. Components become dumb renderers → Tasks 1/2/3 Steps 5-6. ✓
- 组件二 `faithfulness.ts` `checkFaithful(kind, renderedRoot, selectorOutput): Divergence[]` → built across Tasks 1/2/3. View-faithful (A) + structural invariants (B): meters range/monotonic/max-100/format-roundtrip (Task 1 Step 9); cohort order-consistent (Task 3 Step 10); timeline bounds/leftpct/maps-to-event (Task 2 Step 9). ✓
- 组件三 cross-agent output: `Divergence` shape `{component,element,rendered,expected,invariant,sourceRef}` (Task 1 Step 9); per-component vitest asserting `=== []` (each Task's faithfulness test); `verify:vision` headless + JSON + non-zero exit (Task 4). ✓
- 测试策略: selector unit tests (Tasks 1/2/3 Step 1); faithfulness `=== []` (each faithfulness test); **has-teeth** deliberately-lying render (Task 1 Steps `999%`/fabricated label; Task 2 wrong-left/phantom-id; Task 3 fabricated value/order-lie; Task 4 Step 4 end-to-end). No-regression checks (Tasks 1/2/3 Step 6/7). ✓
- 错误处理: missing element → `invariant:"missing"` (all three checkers); `max=0` all-zero meter → widthPct 0, invariants pass (Task 1 selector test + `maxValue>=1` guard); cohort `value=null` → order check skipped (Task 3 checker + selector test). ✓
- 范围外 (no aggregation/percentile/parser recompute): honored — checkers read the DOM and the selector output only; the one recomputation (timeline `t/maxT`) is selector-internal-consistency on more-primitive fields, explicitly non-circular. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step has complete code. ✓

**3. Type consistency:** `MeterRow`/`MeterMode`/`meterValue`/`meterRows`, `TimelineMark`/`TimelineMarks`/`timelineMarks`, `CohortDim`/`CohortDimRow`/`cohortDims`, `Divergence`/`checkFaithful` are used identically across tasks. `checkFaithful` overloads are added incrementally (meters → timeline → cohort) and the switch's `default` throws until each case exists — consistent with the failing-test-first ordering. DOM contracts match: `.rpt-meter-row`/`.rpt-meter-bar`/`.rpt-meter-value` (unchanged classes), `[data-testid="timeline-mark"][data-mark-id]`, `[data-testid="cohort-dim"][data-dim-key] .rpt-cohort-value` — each written by the component step and read by the checker step. ✓

**Deviation flagged:** the spec's `timelineMarks(candidates, start, end)` is implemented as `timelineMarks(candidates)` with an internal `maxT`, because the component scales by `maxT` (behavior equivalence) and match start/end aren't available at this layer; the timeline bounds invariant is therefore `t ∈ [0, maxT]`. Recorded in Task 2's Interfaces note.
