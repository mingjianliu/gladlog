# SP-B2 Pro Comparison Compare Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the desktop "your play vs the 2300+ cohort" feature on SP-B1.5's build-aware corpus — a main-process pipeline that looks up the user's build-aware cohort cell, computes per-dimension percentiles, and produces a hallucination-proof narrative via template interpolation, rendered in a new report panel.

**Architecture:** Pure compare logic lives in `packages/analysis/src/compare/` (corpus read-types, cell lookup with 4-level fallback, verifiedComparison + facts dictionary, exemplar prompt, claimChecker + interpolation). `packages/desktop/src/main/compare.ts` orchestrates it, mirroring `createAiService` (injectable `AnthropicLike`, generational cancel, cache, atomic write). IPC + preload expose it; a new renderer `ProComparisonVerified` panel renders it alongside the existing AI panel. The model only emits `{{placeholders}}`; main interpolates true values, so numeric/verdict hallucination is impossible by construction.

**Tech Stack:** TypeScript, vitest; Electron (electron-vite + electron-builder), React (renderer); `@gladlog/analysis`; `@anthropic-ai/sdk`.

## Global Constraints

- Bundle-only corpus (no CDN — that's SP-B2.1). The compare feature reads a bundled static `reference_vectors.json`.
- **Trust boundary in main**: claimChecker + interpolation run in the main process, never the renderer.
- **claimChecker = template interpolation**: the model writes named `{{key}}` placeholders for all numbers AND verdict labels; main deterministically substitutes from the facts dictionary. claimChecker verifies every `{{key}}` resolves and scans for stray raw stat-digits outside placeholders. On any violation → drop the prose, render the deterministic numbers-only table.
- **fail-open** (SP-B1.5 contract): if `corpus.wowPatchVersion` major ≠ the bundled game-data manifest `build`, OR a `buildGroups[spec].keystoneNodeIds` node is absent from the talent data → that spec reverts to `buildGroup="*"`. Never crash, never evaluate a dead node id.
- **4-level fallback**: `archetype×buildGroup` → `*×buildGroup` → `archetype×*` → `*×*`; skip cells flagged `insufficient`.
- **Compliance**: old-fork extraction only from audit-CLEAN files (verifiedComparison / exemplar / claimChecker logic); NEEDS_SCRUB UI (`icons.tsx` etc.) is controller-extracted and scrubbed; subagents/agy never read the old fork — they get clean interfaces + this plan.
- `packages/analysis` must NOT import `@gladlog/corpus-tools` (corpus-tools depends on analysis; keep it acyclic). Compare defines its own corpus read-types.
- Cache key: `(matchId, corpus.wowPatchVersion, PROMPT_VERSION)`.

---

## File Structure

- `packages/analysis/src/compare/corpusTypes.ts` (**create**) — read-side corpus types + `assignBuildGroup`.
- `packages/analysis/src/compare/cellLookup.ts` (**create**) — `lookupCell` 4-level fallback.
- `packages/analysis/src/compare/verifiedComparison.ts` (**create**) — per-dim percentile + verdict + facts dictionary.
- `packages/analysis/src/compare/buildExemplarLedPrompt.ts` (**create**) — placeholder-forcing prompt.
- `packages/analysis/src/compare/claimChecker.ts` (**create**) — `interpolate` + `claimChecker`.
- `packages/analysis/src/index.ts` (**modify**) — re-export the compare surface.
- `packages/desktop/src/main/compare.ts` (**create**) — `createCompareService`.
- `packages/desktop/src/main/corpusLoader.ts` (**create**) — resolve + read the bundled corpus and game-data build.
- `packages/desktop/src/main/ipc.ts` (**modify**) — register `gladlog:compare:*`.
- `packages/desktop/src/main/index.ts` (**modify**) — wire `createCompareService`.
- `packages/desktop/src/preload/api.ts` (**modify**) — `GladlogApi.compare` bridge.
- `packages/desktop/src/preload/index.ts` (**modify**) — implement the bridge.
- `packages/desktop/electron-builder.yml` (**modify**) — bundle the corpus via `extraResources`.
- `packages/desktop/src/renderer/src/report/components/ProComparisonVerified.tsx` (**create**) — the panel.
- `packages/desktop/src/renderer/src/report/components/MatchReport.tsx` (**modify**) — mount the panel + build the compare input.

---

### Task 1: Corpus read-types + cell lookup (4-level fallback)

**Files:**

- Create: `packages/analysis/src/compare/corpusTypes.ts`
- Create: `packages/analysis/src/compare/cellLookup.ts`
- Test: `packages/analysis/src/compare/cellLookup.test.ts`

**Interfaces:**

- Produces: `ReferenceCorpus`, `ReferenceCell`, `BuildGroupDecl`, `MetricDist` types; `assignBuildGroup(talents: number[], decl: BuildGroupDecl): string`; `lookupCell(corpus: ReferenceCorpus, sel: { spec: string; bracket: string; archetype: string; buildGroup: string }, nFloor: number): { cell: ReferenceCell | null; fellBackTo: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/compare/cellLookup.test.ts
import { describe, expect, it } from "vitest";
import { lookupCell, assignBuildGroup } from "./cellLookup";
import type { ReferenceCorpus, ReferenceCell } from "./corpusTypes";

function cell(p: Partial<ReferenceCell>): ReferenceCell {
  return {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "offensive",
    sampleN: 40,
    insufficient: false,
    metrics: {},
    exemplarCrises: [],
    ...p,
  };
}
function corpus(cells: ReferenceCell[]): ReferenceCorpus {
  return {
    wowPatchVersion: "12.1.0",
    builtAt: "now",
    sourceFloor: 2300,
    buildGroups: {},
    cells,
  };
}
const sel = {
  spec: "Discipline Priest",
  bracket: "3v3",
  archetype: "hybrid",
  buildGroup: "offensive",
};

describe("assignBuildGroup", () => {
  const decl = {
    keystoneNodeIds: [82585],
    match: "any" as const,
    groupPresent: "offensive",
    groupAbsent: "standard",
  };
  it("returns groupPresent on any keystone match", () => {
    expect(assignBuildGroup([1, 82585], decl)).toBe("offensive");
    expect(assignBuildGroup([1, 2], decl)).toBe("standard");
  });
});

describe("lookupCell 4-level fallback", () => {
  it("prefers the full archetype×buildGroup cell", () => {
    const c = corpus([
      cell({}),
      cell({ archetype: "*", buildGroup: "offensive", sampleN: 100 }),
    ]);
    const r = lookupCell(c, sel, 30);
    expect(r.cell!.archetype).toBe("hybrid");
    expect(r.fellBackTo).toBe("archetype×buildGroup");
  });
  it("falls back to *×buildGroup when the full cell is missing", () => {
    const c = corpus([
      cell({ archetype: "*", buildGroup: "offensive", sampleN: 100 }),
    ]);
    expect(lookupCell(c, sel, 30).fellBackTo).toBe("*×buildGroup");
  });
  it("falls back to archetype×* then *×*", () => {
    const c = corpus([cell({ buildGroup: "*", sampleN: 100 })]);
    expect(lookupCell(c, sel, 30).fellBackTo).toBe("archetype×*");
    const c2 = corpus([
      cell({ archetype: "*", buildGroup: "*", sampleN: 100 }),
    ]);
    expect(lookupCell(c2, sel, 30).fellBackTo).toBe("*×*");
  });
  it("skips insufficient cells and keeps falling back", () => {
    const c = corpus([
      cell({ insufficient: true, sampleN: 5 }),
      cell({ archetype: "*", buildGroup: "offensive", sampleN: 100 }),
    ]);
    expect(lookupCell(c, sel, 30).fellBackTo).toBe("*×buildGroup");
  });
  it("returns null when nothing sufficient exists", () => {
    const c = corpus([cell({ insufficient: true, sampleN: 5 })]);
    expect(lookupCell(c, sel, 30).cell).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/analysis && npx vitest run src/compare/cellLookup.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```typescript
// packages/analysis/src/compare/corpusTypes.ts
export interface MetricDist {
  p10: number;
  p50: number;
  p90: number;
  n: number;
}
export interface BuildGroupDecl {
  keystoneNodeIds: number[];
  match: "any" | "all";
  groupPresent: string;
  groupAbsent: string;
}
export interface ReferenceCell {
  spec: string;
  bracket: string;
  archetype: string;
  buildGroup: string;
  sampleN: number;
  insufficient: boolean;
  metrics: Record<string, MetricDist>;
  exemplarCrises: string[][];
}
export interface ReferenceCorpus {
  wowPatchVersion: string;
  builtAt: string;
  sourceFloor: number;
  buildGroups: Record<string, BuildGroupDecl>;
  cells: ReferenceCell[];
}
```

```typescript
// packages/analysis/src/compare/cellLookup.ts
import type {
  ReferenceCorpus,
  ReferenceCell,
  BuildGroupDecl,
} from "./corpusTypes";

/** Boolean keystone assignment — the read-side twin of the corpus builder's gate. */
export function assignBuildGroup(
  talents: number[],
  decl: BuildGroupDecl,
): string {
  const set = new Set(talents);
  const present =
    decl.match === "all"
      ? decl.keystoneNodeIds.every((id) => set.has(id))
      : decl.keystoneNodeIds.some((id) => set.has(id));
  return present ? decl.groupPresent : decl.groupAbsent;
}

export function lookupCell(
  corpus: ReferenceCorpus,
  sel: { spec: string; bracket: string; archetype: string; buildGroup: string },
  nFloor: number,
): { cell: ReferenceCell | null; fellBackTo: string } {
  // build-preferring 4-level fallback; each tier is (archetype, buildGroup) keys.
  const tiers: Array<[string, string, string]> = [
    [sel.archetype, sel.buildGroup, "archetype×buildGroup"],
    ["*", sel.buildGroup, "*×buildGroup"],
    [sel.archetype, "*", "archetype×*"],
    ["*", "*", "*×*"],
  ];
  for (const [a, b, label] of tiers) {
    const cell = corpus.cells.find(
      (c) =>
        c.spec === sel.spec &&
        c.bracket === sel.bracket &&
        c.archetype === a &&
        c.buildGroup === b &&
        !c.insufficient &&
        c.sampleN >= nFloor,
    );
    if (cell) return { cell, fellBackTo: label };
  }
  return { cell: null, fellBackTo: "none" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/analysis && npx vitest run src/compare/cellLookup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/compare/corpusTypes.ts packages/analysis/src/compare/cellLookup.ts packages/analysis/src/compare/cellLookup.test.ts
git commit -m "feat(analysis): compare corpus read-types + cell lookup fallback (SP-B2 T1)"
```

---

### Task 2: verifiedComparison + facts dictionary

**Files:**

- Create: `packages/analysis/src/compare/verifiedComparison.ts`
- Test: `packages/analysis/src/compare/verifiedComparison.test.ts`

**Interfaces:**

- Consumes: `ReferenceCell`, `MetricDist` (Task 1).
- Produces: `interface PerDim { key: string; value: number | null; p10: number; p50: number; p90: number; percentile: number; verdict: string }`; `interface VerifiedComparison { dims: PerDim[]; facts: Record<string, string> }`; `function verifiedComparison(metrics: Record<string, number | null>, cell: ReferenceCell): VerifiedComparison`; `function percentileRank(value: number, d: { p10: number; p50: number; p90: number }): number`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/compare/verifiedComparison.test.ts
import { describe, expect, it } from "vitest";
import { verifiedComparison, percentileRank } from "./verifiedComparison";
import type { ReferenceCell } from "./corpusTypes";

describe("percentileRank (piecewise-linear over p10/p50/p90)", () => {
  const d = { p10: 0.2, p50: 0.49, p90: 0.7 };
  it("maps p50 to ~50 and clamps the ends", () => {
    expect(percentileRank(0.49, d)).toBeCloseTo(50, 0);
    expect(percentileRank(0.2, d)).toBeCloseTo(10, 0);
    expect(percentileRank(0.7, d)).toBeCloseTo(90, 0);
    expect(percentileRank(0.05, d)).toBe(10); // below p10 clamps to 10
    expect(percentileRank(0.9, d)).toBe(90); // above p90 clamps to 90
  });
});

describe("verifiedComparison", () => {
  const cell: ReferenceCell = {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "offensive",
    sampleN: 40,
    insufficient: false,
    metrics: { offensiveIndex: { p10: 0.2, p50: 0.49, p90: 0.7, n: 40 } },
    exemplarCrises: [],
  };
  it("emits a dim + facts entries for a present metric", () => {
    const vc = verifiedComparison({ offensiveIndex: 0.31 }, cell);
    const dim = vc.dims.find((x) => x.key === "offensiveIndex")!;
    expect(dim.value).toBe(0.31);
    expect(dim.percentile).toBeGreaterThan(10);
    expect(dim.percentile).toBeLessThan(50);
    expect(dim.verdict).toMatch(/quartile|mid-pack/);
    expect(vc.facts["offensiveIndex"]).toBe("0.31");
    expect(vc.facts["offensiveIndex.cohortMedian"]).toBe("0.49");
    expect(vc.facts["offensiveIndex.verdict"]).toBe(dim.verdict);
  });
  it("skips metrics the cell has no distribution for, and null user values", () => {
    const vc = verifiedComparison({ offensiveIndex: null, ccDensity: 1 }, cell);
    expect(vc.dims.find((x) => x.key === "offensiveIndex")).toBeUndefined();
    expect(vc.dims.find((x) => x.key === "ccDensity")).toBeUndefined(); // no dist in cell
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/analysis && npx vitest run src/compare/verifiedComparison.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/analysis/src/compare/verifiedComparison.ts
import type { ReferenceCell } from "./corpusTypes";

export interface PerDim {
  key: string;
  value: number | null;
  p10: number;
  p50: number;
  p90: number;
  percentile: number;
  verdict: string;
}
export interface VerifiedComparison {
  dims: PerDim[];
  facts: Record<string, string>;
}

/** Piecewise-linear percentile from the 3 stored anchors; clamped to [10,90]. */
export function percentileRank(
  value: number,
  d: { p10: number; p50: number; p90: number },
): number {
  if (value <= d.p10) return 10;
  if (value >= d.p90) return 90;
  if (value <= d.p50) {
    const t = (value - d.p10) / (d.p50 - d.p10 || 1);
    return 10 + t * 40;
  }
  const t = (value - d.p50) / (d.p90 - d.p50 || 1);
  return 50 + t * 40;
}

// Direction-neutral rank band — states WHERE you rank, never good/bad.
function verdictFor(percentile: number): string {
  if (percentile < 25) return "bottom quartile of your cohort";
  if (percentile > 75) return "top quartile of your cohort";
  return "mid-pack in your cohort";
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function verifiedComparison(
  metrics: Record<string, number | null>,
  cell: ReferenceCell,
): VerifiedComparison {
  const dims: PerDim[] = [];
  const facts: Record<string, string> = {};
  for (const [key, dist] of Object.entries(cell.metrics)) {
    const value = metrics[key];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    const percentile = Math.round(percentileRank(value, dist));
    const verdict = verdictFor(percentile);
    dims.push({
      key,
      value,
      p10: dist.p10,
      p50: dist.p50,
      p90: dist.p90,
      percentile,
      verdict,
    });
    facts[key] = fmt(value);
    facts[`${key}.cohortMedian`] = fmt(dist.p50);
    facts[`${key}.p10`] = fmt(dist.p10);
    facts[`${key}.p90`] = fmt(dist.p90);
    facts[`${key}.percentile`] = `${percentile}th percentile`;
    facts[`${key}.verdict`] = verdict;
  }
  return { dims, facts };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/analysis && npx vitest run src/compare/verifiedComparison.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/compare/verifiedComparison.ts packages/analysis/src/compare/verifiedComparison.test.ts
git commit -m "feat(analysis): verifiedComparison + facts dictionary (SP-B2 T2)"
```

---

### Task 3: interpolation + claimChecker

**Files:**

- Create: `packages/analysis/src/compare/claimChecker.ts`
- Test: `packages/analysis/src/compare/claimChecker.test.ts`

**Interfaces:**

- Produces: `function interpolate(text: string, facts: Record<string, string>): string`; `function claimChecker(rawText: string, facts: Record<string, string>): { ok: boolean; violations: string[] }`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/compare/claimChecker.test.ts
import { describe, expect, it } from "vitest";
import { interpolate, claimChecker } from "./claimChecker";

const facts = {
  offensiveIndex: "0.31",
  "offensiveIndex.cohortMedian": "0.49",
  "offensiveIndex.verdict": "bottom quartile of your cohort",
};

describe("interpolate", () => {
  it("substitutes known placeholders with their true values", () => {
    const out = interpolate(
      "You hit {{offensiveIndex}} vs {{offensiveIndex.cohortMedian}}.",
      facts,
    );
    expect(out).toBe("You hit 0.31 vs 0.49.");
  });
  it("leaves an unknown placeholder as a marker (claimChecker will flag it)", () => {
    expect(interpolate("x {{bogus}} y", facts)).toContain("{{bogus}}");
  });
});

describe("claimChecker", () => {
  it("passes prose that only uses known placeholders + conversational numbers", () => {
    const r = claimChecker(
      "You landed {{offensiveIndex}} — {{offensiveIndex.verdict}}. In the first 2 minutes you improved.",
      facts,
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it("flags an unknown {{key}}", () => {
    const r = claimChecker("You hit {{fabricated}} damage.", facts);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => /fabricated/.test(v))).toBe(true);
  });
  it("flags a raw stat-like number outside a placeholder (the model wrote a bare stat)", () => {
    const r = claimChecker("Your offensive index of 0.85 is high.", facts);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => /0\.85/.test(v))).toBe(true);
  });
  it("flags a bare percentage outside a placeholder", () => {
    const r = claimChecker("You are in the 85% percentile.", facts);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/analysis && npx vitest run src/compare/claimChecker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/analysis/src/compare/claimChecker.ts

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Replace every {{key}} present in facts with its value; unknown keys stay literal. */
export function interpolate(
  text: string,
  facts: Record<string, string>,
): string {
  return text.replace(PLACEHOLDER, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(facts, key) ? facts[key] : m,
  );
}

// A "stat-like" bare number: a decimal (0.85), or an integer immediately tied to
// a stat context (% or "percentile"). Conversational integers ("2 minutes") are
// allowed. Runs AFTER removing all placeholder spans.
const DECIMAL = /(?<!\{\{[^}]*)\b\d+\.\d+\b/;
const STAT_PCT = /\b\d+\s*%/;
const PERCENTILE_NUM = /\b\d+(st|nd|rd|th)?\s*percentile/i;

export function claimChecker(
  rawText: string,
  facts: Record<string, string>,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  // 1. every {{key}} must resolve
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER.source, "g");
  while ((m = re.exec(rawText)) !== null) {
    if (!Object.prototype.hasOwnProperty.call(facts, m[1]))
      violations.push(`unknown placeholder {{${m[1]}}}`);
  }
  // 2. strip placeholder spans, then scan the prose for raw stat-like numbers
  const prose = rawText.replace(PLACEHOLDER, " ");
  for (const [label, rx] of [
    ["decimal", DECIMAL],
    ["percentage", STAT_PCT],
    ["percentile", PERCENTILE_NUM],
  ] as const) {
    const hit = prose.match(rx);
    if (hit)
      violations.push(`raw ${label} outside placeholder: "${hit[0].trim()}"`);
  }
  return { ok: violations.length === 0, violations };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/analysis && npx vitest run src/compare/claimChecker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/compare/claimChecker.ts packages/analysis/src/compare/claimChecker.test.ts
git commit -m "feat(analysis): template interpolation + claimChecker gate (SP-B2 T3)"
```

---

### Task 4: exemplar-led prompt + analysis exports

**Files:**

- Create: `packages/analysis/src/compare/buildExemplarLedPrompt.ts`
- Modify: `packages/analysis/src/index.ts`
- Test: `packages/analysis/src/compare/buildExemplarLedPrompt.test.ts`

**Interfaces:**

- Consumes: `VerifiedComparison` (Task 2), `ReferenceCell` (Task 1).
- Produces: `function buildExemplarLedPrompt(vc: VerifiedComparison, cell: ReferenceCell, specName: string): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/compare/buildExemplarLedPrompt.test.ts
import { describe, expect, it } from "vitest";
import { buildExemplarLedPrompt } from "./buildExemplarLedPrompt";
import type { VerifiedComparison } from "./verifiedComparison";
import type { ReferenceCell } from "./corpusTypes";

const vc: VerifiedComparison = {
  dims: [
    {
      key: "offensiveIndex",
      value: 0.31,
      p10: 0.2,
      p50: 0.49,
      p90: 0.7,
      percentile: 30,
      verdict: "bottom quartile of your cohort",
    },
  ],
  facts: {
    offensiveIndex: "0.31",
    "offensiveIndex.cohortMedian": "0.49",
    "offensiveIndex.verdict": "bottom quartile of your cohort",
  },
};
const cell = {
  spec: "Discipline Priest",
  bracket: "3v3",
  archetype: "hybrid",
  buildGroup: "offensive",
  sampleN: 40,
  insufficient: false,
  metrics: {},
  exemplarCrises: [
    [
      "At 33.8s (Teammate Havoc Demon Hunter HP: 39%): Pain Suppression -> Flash Heal",
    ],
  ],
} as ReferenceCell;

describe("buildExemplarLedPrompt", () => {
  it("instructs placeholder-only output, lists the allowed keys, and includes exemplars", () => {
    const p = buildExemplarLedPrompt(vc, cell, "Discipline Priest");
    expect(p).toMatch(/\{\{offensiveIndex\}\}/); // shows the available placeholders
    expect(p).toMatch(/placeholder/i);
    expect(p).toMatch(/Pain Suppression/); // exemplar crisis included
    expect(p).toMatch(/Discipline Priest/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/analysis && npx vitest run src/compare/buildExemplarLedPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/analysis/src/compare/buildExemplarLedPrompt.ts
import type { VerifiedComparison } from "./verifiedComparison";
import type { ReferenceCell } from "./corpusTypes";

export function buildExemplarLedPrompt(
  vc: VerifiedComparison,
  cell: ReferenceCell,
  specName: string,
): string {
  const keyLines = Object.keys(vc.facts)
    .map((k) => `  {{${k}}}`)
    .join("\n");
  const exemplars = cell.exemplarCrises
    .flat()
    .slice(0, 8)
    .map((c) => `  - ${c}`)
    .join("\n");
  return [
    `You are a World of Warcraft arena coach. Write 2-3 short paragraphs comparing this ${specName}'s play to their skill cohort (bracket ${cell.bracket}, comp ${cell.archetype}, build group ${cell.buildGroup}, N=${cell.sampleN}).`,
    ``,
    `HARD RULES:`,
    `- Refer to EVERY number and every performance judgement ONLY through the placeholders below. Never write a raw statistic, percentage, or percentile yourself — write the placeholder and it will be substituted.`,
    `- Do not invent spells, numbers, or cohort facts. Use only what is provided.`,
    ``,
    `Available placeholders (use verbatim, in double braces):`,
    keyLines,
    ``,
    `How strong players in this cohort handled crisis moments (for qualitative guidance only):`,
    exemplars || "  (none available)",
    ``,
    `Write the coaching narrative now, using the placeholders.`,
  ].join("\n");
}
```

Then in `packages/analysis/src/index.ts`, add re-exports:

```typescript
export * from "./compare/corpusTypes";
export * from "./compare/cellLookup";
export * from "./compare/verifiedComparison";
export * from "./compare/claimChecker";
export * from "./compare/buildExemplarLedPrompt";
```

- [ ] **Step 4: Run the test + the whole analysis suite**

Run: `cd packages/analysis && npx vitest run src/compare/ && npx vitest run`
Expected: PASS (compare suite + no regressions).

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/compare/buildExemplarLedPrompt.ts packages/analysis/src/compare/buildExemplarLedPrompt.test.ts packages/analysis/src/index.ts
git commit -m "feat(analysis): exemplar-led prompt + compare exports (SP-B2 T4)"
```

---

### Task 5: main-process compare service

**Files:**

- Create: `packages/desktop/src/main/compare.ts`
- Test: `packages/desktop/src/main/compare.test.ts`

**Interfaces:**

- Consumes: `lookupCell`, `assignBuildGroup`, `verifiedComparison`, `buildExemplarLedPrompt`, `interpolate`, `claimChecker`, `ReferenceCorpus` from `@gladlog/analysis`; `AnthropicLike`, `realClientFactory`, `PROMPT_VERSION` from `./ai`.
- Produces: `type CompareInput = { matchId: string; healerMetrics: Record<string, number | null>; spec: string; talents: number[]; bracket: string; archetype: string; wowBuild: string }`; `type CompareResult = { verifiedComparison: VerifiedComparison; report: string | null; droppedReason: string | null; cellMeta: { spec: string; bracket: string; archetype: string; buildGroup: string; sampleN: number; fellBackTo: string } | null }`; `createCompareService(deps): { run(input: CompareInput): Promise<void>; cancel(): Promise<void>; getCached(matchId: string): Promise<CompareResult | null> }`.

**Global constraints for this task (verbatim):** fail-open (stale corpus major version OR keystone node absent from talent data → buildGroup="*"); claimChecker violation OR no API key → drop prose, still return the verifiedComparison (numbers-only); cache key = `(matchId, corpus.wowPatchVersion, PROMPT_VERSION)`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/desktop/src/main/compare.test.ts
import { describe, expect, it, vi } from "vitest";
import { createCompareService } from "./compare";
import type { ReferenceCorpus } from "@gladlog/analysis";

const corpus: ReferenceCorpus = {
  wowPatchVersion: "12.1.0.68629",
  builtAt: "now",
  sourceFloor: 2300,
  buildGroups: {
    "Discipline Priest": {
      keystoneNodeIds: [82585],
      match: "any",
      groupPresent: "offensive",
      groupAbsent: "standard",
    },
  },
  cells: [
    {
      spec: "Discipline Priest",
      bracket: "3v3",
      archetype: "hybrid",
      buildGroup: "offensive",
      sampleN: 40,
      insufficient: false,
      metrics: { offensiveIndex: { p10: 0.2, p50: 0.49, p90: 0.7, n: 40 } },
      exemplarCrises: [],
    },
  ],
};

function svc(
  streamText: string,
  opts?: { apiKey?: string | null; build?: string },
) {
  const emitted: Array<{ ch: string; p: any }> = [];
  const s = createCompareService({
    getSettings: () => ({
      anthropicApiKey: opts?.apiKey ?? "k",
      anthropicModel: "claude-sonnet-5",
      wowDirectory: null,
    }),
    clientFactory: () => ({
      async *stream() {
        yield { delta: streamText };
      },
    }),
    loadCorpus: () => corpus,
    gameBuild: () => opts?.build ?? "12.1.0.68629",
    matchesDir: "/tmp/nonexistent-" + Math.random(),
    emit: (ch, p) => emitted.push({ ch, p }),
  });
  return { s, emitted };
}
const input = {
  matchId: "m1",
  healerMetrics: { offensiveIndex: 0.31 },
  spec: "Discipline Priest",
  talents: [82585],
  bracket: "3v3",
  archetype: "hybrid",
  wowBuild: "12.1.0.68629",
};

describe("createCompareService", () => {
  it("interpolates placeholders and returns a verified report for the offensive build", async () => {
    const { s, emitted } = svc(
      "You hit {{offensiveIndex}} vs {{offensiveIndex.cohortMedian}}.",
    );
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBe("You hit 0.31 vs 0.49.");
    expect(done.p.result.droppedReason).toBeNull();
    expect(done.p.result.cellMeta.buildGroup).toBe("offensive");
  });
  it("drops prose and returns numbers-only on a claimChecker violation", async () => {
    const { s, emitted } = svc("Your index of 0.85 is great.");
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBeNull();
    expect(done.p.result.droppedReason).toMatch(/claim/i);
    expect(done.p.result.verifiedComparison.dims.length).toBeGreaterThan(0);
  });
  it("fail-open: a stale corpus major version forces buildGroup='*'", async () => {
    const { s, emitted } = svc("ok {{offensiveIndex}}", {
      build: "13.0.0.99999",
    });
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.cellMeta.buildGroup).toBe("*");
  });
  it("no API key: returns numbers-only without error", async () => {
    const { s, emitted } = svc("unused", { apiKey: null });
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBeNull();
    expect(
      emitted.find((e) => e.ch === "gladlog:compare:error"),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/desktop && npx vitest run src/main/compare.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/desktop/src/main/compare.ts
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import {
  assignBuildGroup,
  lookupCell,
  verifiedComparison,
  buildExemplarLedPrompt,
  interpolate,
  claimChecker,
  type ReferenceCorpus,
  type VerifiedComparison,
} from "@gladlog/analysis";
import { PROMPT_VERSION, realClientFactory, type AnthropicLike } from "./ai";

const N_FLOOR = 30;

export type CompareInput = {
  matchId: string;
  healerMetrics: Record<string, number | null>;
  spec: string;
  talents: number[];
  bracket: string;
  archetype: string;
  wowBuild: string;
};
export type CompareResult = {
  verifiedComparison: VerifiedComparison;
  report: string | null;
  droppedReason: string | null;
  cellMeta: {
    spec: string;
    bracket: string;
    archetype: string;
    buildGroup: string;
    sampleN: number;
    fellBackTo: string;
  } | null;
};

const major = (v: string) => v.split(".").slice(0, 2).join(".");

export type CompareService = ReturnType<typeof createCompareService>;

export function createCompareService(deps: {
  getSettings: () => {
    anthropicApiKey: string | null;
    anthropicModel: string | null;
    wowDirectory: string | null;
  };
  clientFactory?: (key: string) => AnthropicLike;
  loadCorpus: () => ReferenceCorpus | null;
  gameBuild: () => string;
  matchesDir: string;
  emit: (channel: string, payload: unknown) => void;
}) {
  let generation = 0;

  async function run(input: CompareInput): Promise<void> {
    const myGen = ++generation;
    const corpus = deps.loadCorpus();
    if (!corpus) {
      deps.emit("gladlog:compare:error", {
        matchId: input.matchId,
        message: "NO_CORPUS",
      });
      return;
    }

    // fail-open build-group assignment
    const decl = corpus.buildGroups[input.spec];
    const staleCorpus =
      major(corpus.wowPatchVersion) !== major(deps.gameBuild());
    let buildGroup = "*";
    if (decl && !staleCorpus)
      buildGroup = assignBuildGroup(input.talents, decl);

    const { cell, fellBackTo } = lookupCell(
      corpus,
      {
        spec: input.spec,
        bracket: input.bracket,
        archetype: input.archetype,
        buildGroup,
      },
      N_FLOOR,
    );
    if (!cell) {
      const result: CompareResult = {
        verifiedComparison: { dims: [], facts: {} },
        report: null,
        droppedReason: "NO_COHORT",
        cellMeta: null,
      };
      deps.emit("gladlog:compare:done", { matchId: input.matchId, result });
      return;
    }

    const vc = verifiedComparison(input.healerMetrics, cell);
    const cellMeta = {
      spec: cell.spec,
      bracket: cell.bracket,
      archetype: cell.archetype,
      buildGroup: cell.buildGroup,
      sampleN: cell.sampleN,
      fellBackTo,
    };
    const settings = deps.getSettings();

    const finish = (report: string | null, droppedReason: string | null) => {
      const result: CompareResult = {
        verifiedComparison: vc,
        report,
        droppedReason,
        cellMeta,
      };
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, "compare.json.tmp");
        writeFileSync(
          tmp,
          JSON.stringify({
            schemaVersion: 1,
            corpusVersion: corpus.wowPatchVersion,
            promptVersion: PROMPT_VERSION,
            createdAt: Date.now(),
            result,
          }),
          "utf-8",
        );
        renameSync(tmp, join(dir, "compare.json"));
      } catch {
        /* cache write best-effort */
      }
      deps.emit("gladlog:compare:done", { matchId: input.matchId, result });
    };

    if (!settings.anthropicApiKey || vc.dims.length === 0) {
      finish(null, settings.anthropicApiKey ? "NO_DIMS" : "NO_API_KEY");
      return;
    }

    try {
      const client = deps.clientFactory
        ? deps.clientFactory(settings.anthropicApiKey)
        : realClientFactory(settings.anthropicApiKey);
      const prompt = buildExemplarLedPrompt(vc, cell, input.spec);
      let raw = "";
      const stream = client.stream({
        model: settings.anthropicModel ?? "claude-sonnet-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      for await (const ev of stream) {
        if (myGen !== generation) return;
        if (ev.delta) {
          raw += ev.delta;
          deps.emit("gladlog:compare:delta", {
            matchId: input.matchId,
            text: interpolate(ev.delta, vc.facts),
          });
        }
      }
      if (myGen !== generation) return;
      const check = claimChecker(raw, vc.facts);
      if (!check.ok)
        finish(null, `claimChecker: ${check.violations.join("; ")}`);
      else finish(interpolate(raw, vc.facts), null);
    } catch (err) {
      if (myGen !== generation) return;
      deps.emit("gladlog:compare:error", {
        matchId: input.matchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    run,
    async cancel(): Promise<void> {
      generation++;
    },
    async getCached(matchId: string): Promise<CompareResult | null> {
      const fp = join(deps.matchesDir, matchId, "compare.json");
      if (!existsSync(fp)) return null;
      try {
        return JSON.parse(readFileSync(fp, "utf-8")).result as CompareResult;
      } catch {
        return null;
      }
    },
  };
}
```

Note: the streaming `interpolate(ev.delta, ...)` interpolates per-delta for the live UI; a placeholder split across two deltas will interpolate on the final full-text `interpolate(raw, ...)` in `finish`. The per-delta pass is display-only; correctness comes from the final interpolate + claimChecker on `raw`. (This is acceptable: the live stream may briefly show a raw `{{key}}` that the final render resolves.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/desktop && npx vitest run src/main/compare.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/compare.ts packages/desktop/src/main/compare.test.ts
git commit -m "feat(desktop): main-process compare service with fail-open + claimChecker (SP-B2 T5)"
```

---

### Task 6: corpus loader + IPC + preload wiring

**Files:**

- Create: `packages/desktop/src/main/corpusLoader.ts`
- Modify: `packages/desktop/src/main/ipc.ts`, `packages/desktop/src/main/index.ts`, `packages/desktop/src/preload/api.ts`, `packages/desktop/src/preload/index.ts`, `packages/desktop/electron-builder.yml`
- Test: `packages/desktop/src/main/corpusLoader.test.ts`

**Interfaces:**

- Consumes: `CompareService` (Task 5), `ReferenceCorpus` (Task 1).
- Produces: `corpusLoader.ts` exports `loadBundledCorpus(resolve: () => string): () => ReferenceCorpus | null` (memoizing) and `gameBuildFromManifest(manifest: { build?: string }): string`.

- [ ] **Step 1: Write the failing test (loader memoization + parse)**

```typescript
// packages/desktop/src/main/corpusLoader.test.ts
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadBundledCorpus, gameBuildFromManifest } from "./corpusLoader";

describe("corpusLoader", () => {
  it("reads + memoizes the corpus, returns null on missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "corpus-"));
    const p = join(dir, "reference_vectors.json");
    writeFileSync(
      p,
      JSON.stringify({
        wowPatchVersion: "12.1.0",
        builtAt: "now",
        sourceFloor: 2300,
        buildGroups: {},
        cells: [],
      }),
    );
    let calls = 0;
    const load = loadBundledCorpus(() => {
      calls++;
      return p;
    });
    expect(load()!.wowPatchVersion).toBe("12.1.0");
    expect(load()!.cells).toEqual([]);
    expect(calls).toBe(1); // memoized: resolver called once
    const missing = loadBundledCorpus(() => join(dir, "nope.json"));
    expect(missing()).toBeNull();
  });
  it("reads the build from a game-data manifest", () => {
    expect(gameBuildFromManifest({ build: "12.1.0.68629" })).toBe(
      "12.1.0.68629",
    );
    expect(gameBuildFromManifest({})).toBe("0.0.0.0");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/desktop && npx vitest run src/main/corpusLoader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the loader**

```typescript
// packages/desktop/src/main/corpusLoader.ts
import { existsSync, readFileSync } from "fs";
import type { ReferenceCorpus } from "@gladlog/analysis";

export function loadBundledCorpus(
  resolvePath: () => string,
): () => ReferenceCorpus | null {
  let cached: ReferenceCorpus | null | undefined;
  return () => {
    if (cached !== undefined) return cached;
    try {
      const p = resolvePath();
      cached = existsSync(p)
        ? (JSON.parse(readFileSync(p, "utf-8")) as ReferenceCorpus)
        : null;
    } catch {
      cached = null;
    }
    return cached;
  };
}

export function gameBuildFromManifest(manifest: { build?: string }): string {
  return manifest.build ?? "0.0.0.0";
}
```

- [ ] **Step 4: Register IPC**

In `packages/desktop/src/main/ipc.ts`: import `type { CompareService } from "./compare"`, add `compare: CompareService` to the `registerIpc` deps object, and add handlers alongside the `gladlog:ai:*` block:

```typescript
ipcMain.handle("gladlog:compare:run", (_e, input) => deps.compare.run(input));
ipcMain.handle("gladlog:compare:cancel", () => deps.compare.cancel());
ipcMain.handle("gladlog:compare:getCached", (_e, matchId: string) =>
  deps.compare.getCached(matchId),
);
```

- [ ] **Step 5: Wire the service in `index.ts`**

In `packages/desktop/src/main/index.ts`, next to `createAiService`, add:

```typescript
import { createCompareService } from "./compare";
import { loadBundledCorpus, gameBuildFromManifest } from "./corpusLoader";
import datagenManifest from "@gladlog/analysis/src/data/datagen-manifest.json"; // build stamp
import { app } from "electron";
import { join } from "path";

// resolve the bundled corpus: packaged → resourcesPath; dev → workspace file
const corpusPath = () =>
  app.isPackaged
    ? join(process.resourcesPath, "reference_vectors.json")
    : join(__dirname, "../../../corpus-tools/data/reference_vectors.json");

const compare = createCompareService({
  getSettings: () => settings.get(), // same settings source as ai
  matchesDir: join(userData(), "matches"),
  loadCorpus: loadBundledCorpus(corpusPath),
  gameBuild: () => gameBuildFromManifest(datagenManifest as { build?: string }),
  emit: (ch, p) => win?.webContents.send(ch, p),
});
```

Then add `compare` to the existing `registerIpc({ ... })` call. (Use the same `settings`, `userData()`, `win`/emit references already present for `ai`.)

- [ ] **Step 6: Preload bridge**

In `packages/desktop/src/preload/api.ts`, add to `GladlogApi`:

```typescript
  compare: {
    run(input: {
      matchId: string; healerMetrics: Record<string, number | null>; spec: string;
      talents: number[]; bracket: string; archetype: string; wowBuild: string;
    }): Promise<void>;
    cancel(): Promise<void>;
    getCached(matchId: string): Promise<unknown | null>;
    onDelta(cb: (d: { matchId: string; text: string }) => void): () => void;
    onDone(cb: (d: { matchId: string; result: unknown }) => void): () => void;
    onError(cb: (d: { matchId: string; message: string }) => void): () => void;
  };
```

In `packages/desktop/src/preload/index.ts`, implement `compare` mirroring the existing `ai` bridge (ipcRenderer.invoke for run/cancel/getCached; ipcRenderer.on subscriptions returning an unsubscribe for onDelta/onDone/onError on channels `gladlog:compare:delta|done|error`).

- [ ] **Step 7: Bundle the corpus**

In `packages/desktop/electron-builder.yml`, add:

```yaml
extraResources:
  - from: ../corpus-tools/data/reference_vectors.json
    to: reference_vectors.json
```

- [ ] **Step 8: Verify**

Run: `cd packages/desktop && npx vitest run src/main/corpusLoader.test.ts && npx vitest run && npx tsc --noEmit -p .`
Expected: loader tests pass; full desktop suite green; type-check clean (the `datagen-manifest.json` import resolves; if the tsconfig disallows importing outside `src`, instead read the manifest via `corpusLoader` from a resolved path and adjust the test accordingly).

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/main/corpusLoader.ts packages/desktop/src/main/corpusLoader.test.ts packages/desktop/src/main/ipc.ts packages/desktop/src/main/index.ts packages/desktop/src/preload/api.ts packages/desktop/src/preload/index.ts packages/desktop/electron-builder.yml
git commit -m "feat(desktop): corpus loader + compare IPC/preload wiring + bundling (SP-B2 T6)"
```

---

### Task 7: ProComparisonVerified panel

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/ProComparisonVerified.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/MatchReport.tsx`
- Test: `packages/desktop/src/renderer/src/report/components/ProComparisonVerified.test.tsx`

**Interfaces:**

- Consumes: `window.gladlog.compare` (Task 6); the parsed match (to derive `{ healerMetrics, spec, talents, bracket, archetype }` via `@gladlog/analysis`'s `computeHealerMetrics`, `specToString`, `enemyCompArchetype`).
- Produces: a React component `<ProComparisonVerified match={...} />`.

- [ ] **Step 1: Write the failing test (render states)**

```tsx
// packages/desktop/src/renderer/src/report/components/ProComparisonVerified.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProComparisonVerified } from "./ProComparisonVerified";

const result = {
  verifiedComparison: {
    dims: [
      {
        key: "offensiveIndex",
        value: 0.31,
        p10: 0.2,
        p50: 0.49,
        p90: 0.7,
        percentile: 30,
        verdict: "bottom quartile of your cohort",
      },
    ],
    facts: {},
  },
  report: "You landed 0.31 offense.",
  droppedReason: null,
  cellMeta: {
    spec: "Discipline Priest",
    bracket: "3v3",
    archetype: "hybrid",
    buildGroup: "offensive",
    sampleN: 40,
    fellBackTo: "archetype×buildGroup",
  },
};

beforeEach(() => {
  (globalThis as any).window.gladlog = {
    compare: {
      getCached: vi.fn().mockResolvedValue(result),
      run: vi.fn(),
      cancel: vi.fn(),
      onDelta: () => () => {},
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

describe("ProComparisonVerified", () => {
  it("renders the verified report and the per-dim comparison + cohort meta", async () => {
    render(<ProComparisonVerified match={{ id: "m1" } as any} />);
    expect(
      await screen.findByText(/You landed 0.31 offense/),
    ).toBeInTheDocument();
    expect(screen.getByText(/offensiveIndex/i)).toBeInTheDocument();
    expect(screen.getByText(/offensive/)).toBeInTheDocument(); // build group shown
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/desktop && npx vitest run src/renderer/src/report/components/ProComparisonVerified.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `ProComparisonVerified.tsx`: on mount, call `window.gladlog.compare.getCached(match.id)`; if null and an API is available, derive the compare input from the parsed match — compute the Friendly healer's metrics with `computeHealerMetrics`, `spec = specToString(healer.spec)`, `talents = healer.info.talents.map(t => t.id1)`, `archetype = enemyCompArchetype(enemies)`, `bracket = match.startInfo.bracket`, `wowBuild` from a bundled constant — and call `compare.run(input)`, subscribing to `onDelta`/`onDone`/`onError`. Render: a heading "vs your cohort", the cohort meta line (`{spec} · {bracket} · {archetype} · {buildGroup} build · N={sampleN}`), a per-dimension row list (each: metric name, the user value, a bar showing p10–p90 with the user's marker + `{percentile}th`), and below it either the verified `report` prose or, when `report === null`, a note ("Showing measured numbers only" + the `droppedReason` in a subtle style) with the numbers table. When `cellMeta === null`, render "Not enough cohort data for this build and comp yet." Keep styling consistent with the existing `AIAnalysisPanel`. Do NOT copy any NEEDS_SCRUB old-fork UI verbatim — this is a fresh component; the controller supplies any scrubbed snippets.

- [ ] **Step 4: Mount it in `MatchReport.tsx`**

Add `<ProComparisonVerified match={match} />` as a new section after the existing `<AIAnalysisPanel />` (complement, not replace).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/desktop && npx vitest run src/renderer/src/report/components/ProComparisonVerified.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/src/report/components/ProComparisonVerified.tsx packages/desktop/src/renderer/src/report/components/ProComparisonVerified.test.tsx packages/desktop/src/renderer/src/report/components/MatchReport.tsx
git commit -m "feat(desktop): ProComparisonVerified panel (SP-B2 T7)"
```

---

## Notes for the executor

- Tasks 1–5 are pure/service logic with injected deps — subagent-friendly, no Electron runtime, deterministic tests. Task 6 touches Electron wiring + build config; Task 7 is React with a mocked `window.gladlog`.
- **Compliance**: the controller performs any old-fork CLEAN extraction and hands subagents only the clean interfaces above. Subagents/agy never read the old fork. The UI (Task 7) is a fresh component; any NEEDS_SCRUB snippet is controller-scrubbed before use.
- After Task 7, run the full repo suite (`npm test`) before the final whole-branch review.
- Work on a branch (e.g. `sp-b2-compare`), not `main`.
- The renderer needs a `wowBuild` constant for the compare input — source it from the same bundled `datagen-manifest.json` build (import at renderer build time), matching what the main-process fail-open check uses.
