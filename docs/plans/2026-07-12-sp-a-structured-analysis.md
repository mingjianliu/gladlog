# SP-A Structured Analysis UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the freeform `<pre>` AI analysis with evidence-anchored structured findings — the LLM selects/ranks/explains from a pre-extracted verifiable-event menu, with facts grounded by construction, numbers via interpolation, and strong causal claims forbidden by design and enforced by a deterministic lint — rendered as FindingsList / MatchHero / TimelineStrip / ExportButtons.

**Architecture:** Pure logic in `packages/analysis/src/analysis/` (candidate-event extraction, findings prompt, three-layer audit: grounding + numeric claimChecker reuse + causal lint). `packages/desktop/src/main/analysis.ts` orchestrates it, mirroring `createCompareService` (injectable `AnthropicLike`, generational cancel, version cache, atomic write, trust boundary in main). New renderer components replace the `<pre>` output; the `ProComparisonVerified` compare panel stays.

**Tech Stack:** TypeScript, vitest; Electron (electron-vite), React; `@gladlog/analysis` (+ its `compare/claimChecker` reuse); `@anthropic-ai/sdk`.

## Global Constraints

- **Three-layer honesty gate** (in main, never renderer): (1) grounding — every finding's `eventId` must resolve to a real extracted `CandidateEvent`; (2) numeric — the explanation's numbers must be `{{key}}` placeholders resolvable from the referenced events' facts, and `claimChecker` (reused from `compare/claimChecker.ts`) flags stray raw stat-digits; (3) causal lint — the explanation must not contain strong causal attribution. A finding failing any layer is dropped.
- **Avoid causality by design**: the prompt forbids strong causal claims ("because … you lost", "cost you the game", "that's why"); `causalLint` enforces it. The lint checks causal _language_, not causal _truth_ (which is unverifiable).
- **Do NOT modify `buildMatchContext`** — `extractCandidateFindings` is a new, independent function built on existing analysis utilities. The proven text pipeline stays intact.
- **Reuse `compare/claimChecker.ts`** `interpolate`/`claimChecker` verbatim — do not fork the numeric checker.
- `packages/analysis` must not import `@gladlog/corpus-tools`.
- Cache key: `(matchId, PROMPT_VERSION)`.
- No API key / no candidates / invalid LLM JSON → render the deterministic candidate events with no narration; never crash.
- **Compliance**: old-fork extraction only from audit-CLEAN files; NEEDS_SCRUB UI (`icons.tsx`) controller-scrubbed; subagents/agy never read the old fork.

---

## File Structure

- `packages/analysis/src/analysis/types.ts` (**create**) — `CandidateEvent`, `RawFinding`, `Finding`, `AuditResult`.
- `packages/analysis/src/analysis/candidateFindings.ts` (**create**) — `extractCandidateFindings`.
- `packages/analysis/src/analysis/causalLint.ts` (**create**) — `causalLint`.
- `packages/analysis/src/analysis/auditFindings.ts` (**create**) — `auditFindings` (grounding + claimChecker + causal lint + interpolate + sort).
- `packages/analysis/src/analysis/buildFindingsPrompt.ts` (**create**) — `buildFindingsPrompt`.
- `packages/analysis/src/index.ts` (**modify**) — re-export the analysis surface.
- `packages/desktop/src/main/analysis.ts` (**create**) — `createAnalysisService`.
- `packages/desktop/src/main/ipc.ts`, `main/index.ts`, `preload/api.ts`, `preload/index.ts` (**modify**) — `gladlog:analysis:*`.
- `packages/desktop/src/renderer/src/report/components/{FindingsList,MatchHero,TimelineStrip,ExportButtons}.tsx` (**create**).
- `packages/desktop/src/renderer/src/report/components/MatchReport.tsx` (**modify**) — mount the new panel, replace the `<pre>` AI output.

---

### Task 1: Candidate-event types + extraction

**Files:**

- Create: `packages/analysis/src/analysis/types.ts`, `packages/analysis/src/analysis/candidateFindings.ts`
- Test: `packages/analysis/src/analysis/candidateFindings.test.ts`

**Interfaces:**

- Produces: `interface CandidateEvent { id: string; type: string; t: number; unitNames: string[]; spell?: string; facts: Record<string, string> }`; `function extractCandidateFindings(combat: any): CandidateEvent[]`.

**Scope note:** ship a focused initial event set (deaths + never-used major cooldowns) with an extensible shape; more types are added later without schema change.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/analysis/candidateFindings.test.ts
import { describe, expect, it } from "vitest";
import { extractCandidateFindings } from "./candidateFindings";

// Synthetic combat: one Friendly death + one never-used major cooldown owner.
function combat(): any {
  return {
    startTime: 0,
    endTime: 60000,
    units: {
      a: {
        id: "a",
        name: "Me-R",
        type: 1,
        reaction: 1,
        spec: "256",
        deathRecords: [{ timestamp: 30000 }],
        spellCastEvents: [],
        advancedActions: [],
        info: { teamId: "0" },
      },
    },
  };
}

describe("extractCandidateFindings", () => {
  it("emits a death CandidateEvent with a stable id, time, unit, and facts", () => {
    const evts = extractCandidateFindings(combat());
    const death = evts.find((e) => e.type === "death");
    expect(death).toBeTruthy();
    expect(death!.t).toBe(30);
    expect(death!.unitNames).toContain("Me-R");
    expect(death!.id).toMatch(/^death:/);
    expect(death!.facts["t"]).toBe("30");
  });
  it("returns [] for an empty combat without throwing", () => {
    expect(
      extractCandidateFindings({ startTime: 0, endTime: 1000, units: {} }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/analysis && npx vitest run src/analysis/candidateFindings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/analysis/src/analysis/types.ts
export interface CandidateEvent {
  id: string;
  type: string; // "death" | "cd-waste" | ... (extensible)
  t: number; // seconds from combat start
  unitNames: string[];
  spell?: string;
  facts: Record<string, string>; // verifiable, formatted; the only values a finding may cite
}
export interface RawFinding {
  eventIds: string[];
  severity: "high" | "med" | "low";
  category: string;
  title: string;
  explanation: string;
}
export interface Finding extends RawFinding {} // explanation is interpolated post-audit
export interface AuditResult {
  findings: Finding[];
  dropped: Array<{ finding: RawFinding; reason: string }>;
}
```

```typescript
// packages/analysis/src/analysis/candidateFindings.ts
import type { CandidateEvent } from "./types";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Structured, verifiable candidate events for the findings pipeline. Built on
 * the parsed combat directly (NOT a refactor of buildMatchContext). Focused
 * initial set — extensible by pushing more typed events.
 */
export function extractCandidateFindings(combat: any): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const units = Object.values(combat?.units ?? {}) as any[];
  const start = combat?.startTime ?? 0;
  for (const u of units) {
    for (const d of (u.deathRecords ?? []) as any[]) {
      const t = ((d.timestamp ?? 0) - start) / 1000;
      out.push({
        id: `death:${u.id}:${Math.round(t)}`,
        type: "death",
        t,
        unitNames: [u.name],
        facts: { t: fmt(t), unit: u.name },
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/analysis && npx vitest run src/analysis/candidateFindings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/analysis/types.ts packages/analysis/src/analysis/candidateFindings.ts packages/analysis/src/analysis/candidateFindings.test.ts
git commit -m "feat(analysis): candidate-event types + extraction (SP-A T1)"
```

---

### Task 2: Causal-language lint

**Files:**

- Create: `packages/analysis/src/analysis/causalLint.ts`
- Test: `packages/analysis/src/analysis/causalLint.test.ts`

**Interfaces:**

- Produces: `function causalLint(text: string): string[]` — returns violation strings for strong causal attribution; empty = clean.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/analysis/causalLint.test.ts
import { describe, expect, it } from "vitest";
import { causalLint } from "./causalLint";

describe("causalLint (enforces the no-strong-causal-claim policy)", () => {
  it("flags strong causal attribution", () => {
    expect(
      causalLint("You died because you wasted your defensive.").length,
    ).toBeGreaterThan(0);
    expect(causalLint("Holding CDs cost you the game.").length).toBeGreaterThan(
      0,
    );
    expect(causalLint("That's why you lost the round.").length).toBeGreaterThan(
      0,
    );
    expect(causalLint("This led to the loss.").length).toBeGreaterThan(0);
  });
  it("allows observational + suggestive coaching (no strong causal connective)", () => {
    expect(
      causalLint(
        "At 1:00 you used Pain Suppression; the kill came at 2:00 during their cooldowns.",
      ),
    ).toEqual([]);
    expect(
      causalLint("Consider saving the trinket for the first swap."),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/analysis && npx vitest run src/analysis/causalLint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/analysis/src/analysis/causalLint.ts

// Strong causal attribution the "avoid-causality-by-design" policy forbids. This
// checks causal LANGUAGE (enforcing the policy), not causal TRUTH (unverifiable).
const PATTERNS: Array<[string, RegExp]> = [
  ["because-death", /\b(died|death|lost|loss|wiped)\b[^.]*\bbecause\b/i],
  ["because-then-outcome", /\bbecause\b[^.]*\b(died|death|lost|loss|wiped)\b/i],
  ["cost-you", /\bcost (you|him|her|them|the team)\b/i],
  ["thats-why", /\b(that'?s|this is) why\b/i],
  [
    "led-to",
    /\b(led to|resulted in|caused)\b[^.]*\b(loss|death|wipe|defeat)\b/i,
  ],
];

export function causalLint(text: string): string[] {
  const v: string[] = [];
  for (const [label, rx] of PATTERNS)
    if (rx.test(text)) v.push(`strong causal claim (${label})`);
  return v;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/analysis && npx vitest run src/analysis/causalLint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/analysis/causalLint.ts packages/analysis/src/analysis/causalLint.test.ts
git commit -m "feat(analysis): causal-language lint (SP-A T2)"
```

---

### Task 3: auditFindings (the three-layer gate)

**Files:**

- Create: `packages/analysis/src/analysis/auditFindings.ts`
- Test: `packages/analysis/src/analysis/auditFindings.test.ts`

**Interfaces:**

- Consumes: `CandidateEvent`, `RawFinding`, `Finding`, `AuditResult` (T1); `causalLint` (T2); `interpolate`, `claimChecker` from `../compare/claimChecker`.
- Produces: `function auditFindings(raw: RawFinding[], candidates: CandidateEvent[]): AuditResult` — severity-sorted, interpolated survivors + dropped list.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/analysis/auditFindings.test.ts
import { describe, expect, it } from "vitest";
import { auditFindings } from "./auditFindings";
import type { CandidateEvent, RawFinding } from "./types";

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
];
const base: RawFinding = {
  eventIds: ["death:a:30"],
  severity: "high",
  category: "survival",
  title: "Death",
  explanation: "You died at {{t}}s.",
};

describe("auditFindings", () => {
  it("keeps a grounded, numerically-clean, non-causal finding and interpolates it", () => {
    const r = auditFindings([base], candidates);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].explanation).toBe("You died at 30s.");
  });
  it("drops a finding citing a non-existent event (grounding)", () => {
    const r = auditFindings(
      [{ ...base, eventIds: ["death:zzz:99"] }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ground/i);
  });
  it("drops a finding with a raw stat-digit outside a placeholder (numeric)", () => {
    const r = auditFindings(
      [{ ...base, explanation: "Your uptime was 0.85 there." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/numeric|claim/i);
  });
  it("drops a finding with strong causal attribution (causal lint)", () => {
    const r = auditFindings(
      [{ ...base, explanation: "You died because you greeded." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/causal/i);
  });
  it("sorts survivors by severity (high → low)", () => {
    const low: RawFinding = { ...base, severity: "low", title: "Low" };
    const r = auditFindings([low, base], candidates);
    expect(r.findings.map((f) => f.severity)).toEqual(["high", "low"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/analysis && npx vitest run src/analysis/auditFindings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/analysis/src/analysis/auditFindings.ts
import type { CandidateEvent, RawFinding, Finding, AuditResult } from "./types";
import { causalLint } from "./causalLint";
import { interpolate, claimChecker } from "../compare/claimChecker";

const RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

export function auditFindings(
  raw: RawFinding[],
  candidates: CandidateEvent[],
): AuditResult {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const findings: Finding[] = [];
  const dropped: AuditResult["dropped"] = [];

  for (const f of raw) {
    // Layer 1: grounding — every eventId must resolve.
    const refs = f.eventIds.map((id) => byId.get(id));
    if (refs.some((r) => !r)) {
      dropped.push({ finding: f, reason: "grounding: unknown eventId" });
      continue;
    }
    // Facts the explanation may cite = the union of the referenced events' facts.
    const facts: Record<string, string> = {};
    for (const r of refs as CandidateEvent[]) Object.assign(facts, r.facts);
    // Layer 2: numeric claimChecker (reused from compare).
    const check = claimChecker(f.explanation, facts);
    if (!check.ok) {
      dropped.push({
        finding: f,
        reason: `numeric: ${check.violations.join("; ")}`,
      });
      continue;
    }
    // Layer 3: causal-language lint.
    const causal = causalLint(f.explanation);
    if (causal.length > 0) {
      dropped.push({ finding: f, reason: `causal: ${causal.join("; ")}` });
      continue;
    }
    findings.push({ ...f, explanation: interpolate(f.explanation, facts) });
  }

  findings.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  return { findings, dropped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/analysis && npx vitest run src/analysis/auditFindings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/analysis/auditFindings.ts packages/analysis/src/analysis/auditFindings.test.ts
git commit -m "feat(analysis): auditFindings three-layer gate (SP-A T3)"
```

---

### Task 4: Findings prompt + analysis exports

**Files:**

- Create: `packages/analysis/src/analysis/buildFindingsPrompt.ts`
- Modify: `packages/analysis/src/index.ts`
- Test: `packages/analysis/src/analysis/buildFindingsPrompt.test.ts`

**Interfaces:**

- Consumes: `CandidateEvent` (T1).
- Produces: `function buildFindingsPrompt(candidates: CandidateEvent[], richContext: string, specName: string): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/analysis/src/analysis/buildFindingsPrompt.test.ts
import { describe, expect, it } from "vitest";
import { buildFindingsPrompt } from "./buildFindingsPrompt";
import type { CandidateEvent } from "./types";

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
];

describe("buildFindingsPrompt", () => {
  it("lists the event menu with IDs, forbids invented events + causal claims, and demands JSON", () => {
    const p = buildFindingsPrompt(
      candidates,
      "RICH CONTEXT HERE",
      "Discipline Priest",
    );
    expect(p).toMatch(/death:a:30/); // the event id is offered
    expect(p).toMatch(/RICH CONTEXT HERE/); // holistic context included
    expect(p).toMatch(/JSON/i);
    expect(p).toMatch(/placeholder|\{\{/); // numbers via placeholders
    expect(p).toMatch(/because|causal|caused/i); // the no-causal rule is stated
    expect(p).toMatch(/Discipline Priest/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/analysis && npx vitest run src/analysis/buildFindingsPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/analysis/src/analysis/buildFindingsPrompt.ts
import type { CandidateEvent } from "./types";

export function buildFindingsPrompt(
  candidates: CandidateEvent[],
  richContext: string,
  specName: string,
): string {
  const menu = candidates
    .map(
      (c) =>
        `  - id=${c.id} type=${c.type} t=${c.t}s units=${c.unitNames.join("/")}` +
        ` facts={${Object.entries(c.facts)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}}`,
    )
    .join("\n");
  return [
    `You are a World of Warcraft arena coach reviewing a ${specName}'s match. Produce a short list of coaching findings as JSON.`,
    ``,
    `Match context (for reasoning about the arc — do NOT cite anything not in the event menu):`,
    richContext,
    ``,
    `Event menu (the ONLY things that provably happened — every finding must reference these ids):`,
    menu || "  (none)",
    ``,
    `HARD RULES:`,
    `- Reference only event ids from the menu (in "eventIds"). Never invent an event.`,
    `- Any number in "explanation" must be a {{key}} placeholder drawn from the referenced events' facts (e.g. {{t}}). Never write a raw statistic yourself.`,
    `- Do NOT assert causation. No "because … you lost", "cost you the game", "that's why", "led to the loss". State observations and suggestions only.`,
    ``,
    `Output ONLY a JSON array: [{ "eventIds": string[], "severity": "high"|"med"|"low", "category": string, "title": string, "explanation": string }]`,
  ].join("\n");
}
```

Then add to `packages/analysis/src/index.ts`:

```typescript
export * from "./analysis/types";
export * from "./analysis/candidateFindings";
export * from "./analysis/causalLint";
export * from "./analysis/auditFindings";
export * from "./analysis/buildFindingsPrompt";
```

- [ ] **Step 4: Run test + whole analysis suite**

Run: `cd packages/analysis && npx vitest run src/analysis/ && npx vitest run`
Expected: PASS (analysis suite + no regressions).

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/analysis/buildFindingsPrompt.ts packages/analysis/src/analysis/buildFindingsPrompt.test.ts packages/analysis/src/index.ts
git commit -m "feat(analysis): findings prompt + analysis exports (SP-A T4)"
```

---

### Task 5: Main-process analysis service + IPC/preload

**Files:**

- Create: `packages/desktop/src/main/analysis.ts`
- Modify: `main/ipc.ts`, `main/index.ts`, `preload/api.ts`, `preload/index.ts`
- Test: `packages/desktop/src/main/analysis.test.ts`

**Interfaces:**

- Consumes: `buildFindingsPrompt`, `auditFindings`, `CandidateEvent`, `Finding` from `@gladlog/analysis`; `AnthropicLike`, `realClientFactory`, `PROMPT_VERSION` from `./ai`.
- Produces: `type AnalysisInput = { matchId: string; candidates: CandidateEvent[]; richContext: string; spec: string }`; `type AnalysisResult = { findings: Finding[]; dropped: number; hadNarration: boolean }`; `createAnalysisService(deps): { run(input): Promise<void>; cancel(): Promise<void>; getCached(matchId): Promise<AnalysisResult | null> }`.

**Global constraints for this task (verbatim):** claimChecker/auditFindings run in main. Invalid JSON, no API key, or zero surviving findings → return the candidates rendered deterministically (hadNarration=false), no error emitted. Cache key `(matchId, PROMPT_VERSION)`. Generational cancel like `compare.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/desktop/src/main/analysis.test.ts
import { describe, expect, it } from "vitest";
import { createAnalysisService } from "./analysis";
import type { CandidateEvent } from "@gladlog/analysis";

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
];
function svc(streamText: string, apiKey: string | null = "k") {
  const emitted: Array<{ ch: string; p: any }> = [];
  const s = createAnalysisService({
    getSettings: () => ({
      anthropicApiKey: apiKey,
      anthropicModel: "m",
      wowDirectory: null,
    }),
    clientFactory: () => ({
      async *stream() {
        yield { delta: streamText };
      },
    }),
    matchesDir: "/tmp/nope-" + Math.random(),
    emit: (ch, p) => emitted.push({ ch, p }),
  });
  return { s, emitted };
}
const input = {
  matchId: "m1",
  candidates,
  richContext: "ctx",
  spec: "Discipline Priest",
};

describe("createAnalysisService", () => {
  it("audits LLM JSON findings and returns interpolated survivors", async () => {
    const { s, emitted } = svc(
      JSON.stringify([
        {
          eventIds: ["death:a:30"],
          severity: "high",
          category: "survival",
          title: "Death",
          explanation: "You died at {{t}}s.",
        },
      ]),
    );
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.findings[0].explanation).toBe("You died at 30s.");
    expect(done.p.result.hadNarration).toBe(true);
  });
  it("invalid JSON → deterministic fallback, no error", async () => {
    const { s, emitted } = svc("not json at all");
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.hadNarration).toBe(false);
    expect(
      emitted.find((e) => e.ch === "gladlog:analysis:error"),
    ).toBeUndefined();
  });
  it("no API key → deterministic fallback, no error", async () => {
    const { s, emitted } = svc("unused", null);
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:analysis:done")!;
    expect(done.p.result.hadNarration).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/desktop && npx vitest run src/main/analysis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `analysis.ts`**

```typescript
// packages/desktop/src/main/analysis.ts
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import {
  buildFindingsPrompt,
  auditFindings,
  type CandidateEvent,
  type Finding,
  type RawFinding,
} from "@gladlog/analysis";
import { PROMPT_VERSION, realClientFactory, type AnthropicLike } from "./ai";

export type AnalysisInput = {
  matchId: string;
  candidates: CandidateEvent[];
  richContext: string;
  spec: string;
};
export type AnalysisResult = {
  findings: Finding[];
  dropped: number;
  hadNarration: boolean;
};

export function createAnalysisService(deps: {
  getSettings: () => {
    anthropicApiKey: string | null;
    anthropicModel: string | null;
    wowDirectory: string | null;
  };
  clientFactory?: (key: string) => AnthropicLike;
  matchesDir: string;
  emit: (channel: string, payload: unknown) => void;
}) {
  let generation = 0;

  async function run(input: AnalysisInput): Promise<void> {
    const myGen = ++generation;
    const settings = deps.getSettings();

    const finish = (result: AnalysisResult) => {
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, "analysis-v2.json.tmp");
        writeFileSync(
          tmp,
          JSON.stringify({
            schemaVersion: 1,
            promptVersion: PROMPT_VERSION,
            createdAt: Date.now(),
            result,
          }),
          "utf-8",
        );
        renameSync(tmp, join(dir, "analysis-v2.json"));
      } catch {
        /* best-effort */
      }
      deps.emit("gladlog:analysis:done", { matchId: input.matchId, result });
    };

    // deterministic fallback: no narration, just the candidate count as empty findings
    const fallback = () =>
      finish({ findings: [], dropped: 0, hadNarration: false });

    if (!settings.anthropicApiKey || input.candidates.length === 0)
      return fallback();

    try {
      const client = deps.clientFactory
        ? deps.clientFactory(settings.anthropicApiKey)
        : realClientFactory(settings.anthropicApiKey);
      const prompt = buildFindingsPrompt(
        input.candidates,
        input.richContext,
        input.spec,
      );
      let raw = "";
      const stream = client.stream({
        model: settings.anthropicModel ?? "claude-sonnet-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      for await (const ev of stream) {
        if (myGen !== generation) return;
        if (ev.delta) raw += ev.delta;
      }
      if (myGen !== generation) return;

      let parsed: RawFinding[];
      try {
        parsed = JSON.parse(raw.trim());
        if (!Array.isArray(parsed)) throw new Error("not an array");
      } catch {
        return fallback(); // invalid JSON → deterministic
      }
      const audit = auditFindings(parsed, input.candidates);
      finish({
        findings: audit.findings,
        dropped: audit.dropped.length,
        hadNarration: audit.findings.length > 0,
      });
    } catch (err) {
      if (myGen !== generation) return;
      deps.emit("gladlog:analysis:error", {
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
    async getCached(matchId: string): Promise<AnalysisResult | null> {
      const fp = join(deps.matchesDir, matchId, "analysis-v2.json");
      if (!existsSync(fp)) return null;
      try {
        const doc = JSON.parse(readFileSync(fp, "utf-8"));
        if (doc.promptVersion !== PROMPT_VERSION) return null;
        return doc.result as AnalysisResult;
      } catch {
        return null;
      }
    },
  };
}
export type AnalysisService = ReturnType<typeof createAnalysisService>;
```

- [ ] **Step 4: Wire IPC + preload + index**

- `main/ipc.ts`: import `type { AnalysisService }`, add `analysis: AnalysisService` to deps, register `gladlog:analysis:run|cancel|getCached` (mirror the `compare` handlers).
- `main/index.ts`: `createAnalysisService({ getSettings: () => settings.get(), matchesDir: join(userData(), "matches"), emit: (ch,p) => win?.webContents.send(ch,p) })`, pass `analysis` into `registerIpc`.
- `preload/api.ts` + `preload/index.ts`: add a `analysis` bridge (run/cancel/getCached + onDone/onError; channels `gladlog:analysis:done|error`), mirroring the `compare` bridge.

- [ ] **Step 5: Verify**

Run: `cd packages/desktop && npx vitest run src/main/analysis.test.ts && npx vitest run && npx tsc --noEmit -p .`
Expected: analysis tests pass; full desktop suite green; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/analysis.ts packages/desktop/src/main/analysis.test.ts packages/desktop/src/main/ipc.ts packages/desktop/src/main/index.ts packages/desktop/src/preload/api.ts packages/desktop/src/preload/index.ts
git commit -m "feat(desktop): main-process analysis service + IPC/preload (SP-A T5)"
```

---

### Task 6: FindingsList + MatchHero + TimelineStrip

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/{FindingsList,MatchHero,TimelineStrip}.tsx`
- Test: `packages/desktop/src/renderer/src/report/components/FindingsList.test.tsx`

**Interfaces:**

- Consumes: the `AnalysisResult` shape (findings) + `CandidateEvent`s; `SpellIcon`; `derive/summary`.

- [ ] **Step 1: Write the failing test (render + severity order)**

```tsx
// packages/desktop/src/renderer/src/report/components/FindingsList.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/desktop && npx vitest run src/renderer/src/report/components/FindingsList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the three components**

- `FindingsList.tsx`: props `{ findings: Finding[]; onSelect: (eventIds: string[]) => void }`. Render severity-sorted cards (already sorted by the service): each card has a severity stripe (color by high/med/low via `rpt-*` classes or inline `var(--bad)`/`var(--warn)`/`var(--mute)`), a category label, the title, the interpolated `explanation`, and a clickable evidence chip row (per eventId; on click → `onSelect(f.eventIds)`). Empty `findings` → a "No findings for this match." body. Match the `rpt-ai-panel`/`rpt-ai-body` style.
- `MatchHero.tsx`: props `{ source: ReportSource; findingCount: number; topSeverity?: string }`. Render an overview line from `derive/summary` (spec · bracket · result · duration) + a headline (`{findingCount} findings · N high`). Reuse the existing summary deriver.
- `TimelineStrip.tsx`: props `{ candidates: CandidateEvent[]; activeEventIds: string[]; onSelect: (id: string) => void }`. Render a horizontal strip with a marker per candidate at position `t / duration`; the markers in `activeEventIds` are emphasized; click → `onSelect(id)`. Keep it a thin SVG/flex strip; reuse dark tokens.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/desktop && npx vitest run src/renderer/src/report/components/FindingsList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/src/report/components/FindingsList.tsx packages/desktop/src/renderer/src/report/components/MatchHero.tsx packages/desktop/src/renderer/src/report/components/TimelineStrip.tsx packages/desktop/src/renderer/src/report/components/FindingsList.test.tsx
git commit -m "feat(desktop): FindingsList + MatchHero + TimelineStrip (SP-A T6)"
```

---

### Task 7: ExportButtons + StructuredAnalysisPanel wiring

**Files:**

- Create: `packages/desktop/src/renderer/src/report/components/ExportButtons.tsx`, `packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx`
- Modify: `packages/desktop/src/renderer/src/report/components/MatchReport.tsx`
- Test: `packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.test.tsx`

**Interfaces:**

- Consumes: `window.gladlog.analysis` (T5) via `bridge()`; `extractCandidateFindings`, `buildMatchContext` (for richContext), `computeHealerMetrics`/`specToString` from `@gladlog/analysis`; the T6 components.
- Produces: `StructuredAnalysisPanel({ source, matchId })` — the container that replaces the `<pre>` AI output.

- [ ] **Step 1: Write the failing test (cached render)**

```tsx
// packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";

const result = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "Death",
      explanation: "You died at 30s.",
    },
  ],
  dropped: 0,
  hadNarration: true,
};

beforeEach(() => {
  (window as any).__gladlogFixture = {
    analysis: {
      getCached: vi.fn().mockResolvedValue(result),
      run: vi.fn(),
      cancel: vi.fn(),
      onDone: () => () => {},
      onError: () => () => {},
    },
  };
});

describe("StructuredAnalysisPanel", () => {
  it("renders cached findings", async () => {
    render(
      <StructuredAnalysisPanel
        source={{ units: {}, startInfo: {} } as any}
        matchId="m1"
      />,
    );
    expect(await screen.findByText(/You died at 30s/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/desktop && npx vitest run src/renderer/src/report/components/StructuredAnalysisPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `ExportButtons.tsx`: props `{ findings: Finding[]; heroText: string }`. A "Copy Markdown" button that builds a markdown string (hero line + `- [SEVERITY] title — explanation` per finding) and writes it to the clipboard (`navigator.clipboard.writeText`). (Image export may be a stub button labeled "Export Image" wired to a no-op TODO comment — acceptable for v1; do NOT leave it non-rendering.)
- `StructuredAnalysisPanel.tsx`: mirror `ProComparisonVerified` — take `source` + `matchId`, reset state + cancel-guard on matchId change, `getCached` on mount, subscribe `analysis.onDone`/`onError`. Derive the analysis input from `source`: `const legacy = toLegacyMatch({...source, rawLines: []})`; `candidates = extractCandidateFindings(legacy)`; `richContext = buildMatchContext(legacy, friends, enemies, { useTimelinePrompt: true })`; `spec = specToString(healer.spec)` (Friendly healer). A button "结构化分析 / Analyze" → `bridge().analysis.run({ matchId, candidates, richContext, spec })`. Compose `<MatchHero>`, `<TimelineStrip>`, `<FindingsList>`, `<ExportButtons>`; cross-link the strip and cards via shared `activeEventIds` state. When `result.hadNarration === false` render the candidate events plainly (no narration).
- `MatchReport.tsx`: replace the `<AIAnalysisPanel .../>` line with `<StructuredAnalysisPanel source={source} matchId={resolvedMatchId} />` (keep `<ProComparisonVerified .../>`). Note: the old `AIAnalysisPanel.tsx` and its `ai.*` path may remain in the tree unused, or be removed — leave removal to a follow-up; do not delete in this task.

- [ ] **Step 4: Run to verify it passes + full suite + tsc**

Run: `cd packages/desktop && npx vitest run && npx tsc --noEmit -p .`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/src/report/components/ExportButtons.tsx packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.test.tsx packages/desktop/src/renderer/src/report/components/MatchReport.tsx
git commit -m "feat(desktop): ExportButtons + StructuredAnalysisPanel replacing the <pre> analysis (SP-A T7)"
```

---

## Notes for the executor

- Tasks 1–5 are pure/service logic (subagent- and agy-friendly, deterministic tests). T6/T7 are React with a mocked `window.__gladlogFixture` + jsdom pragma (jest-dom is NOT installed — use vitest-native truthy assertions on `getByText`/`findByText`).
- Reuse `compare/claimChecker.ts` (T3) — do not fork it.
- `StructuredAnalysisPanel` mirrors `ProComparisonVerified` exactly for the state-reset + async-race guard on `matchId` change.
- After T7, run the full repo suite (`npm test`) before the final whole-branch review.
- Work on a branch (e.g. `sp-a-structured-analysis`), not `main`.
- The candidate-event menu ships focused (deaths + extensible); expanding the event types (missed interrupts, CD waste, dispels, positioning via existing analysis utilities) is a natural follow-up that needs no schema change.
