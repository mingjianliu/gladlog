# Enemy Defensive & Trinket Context Enrichment (GH #69 / C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich existing `[ENEMY DEF]` and `[ENEMY TRINKET]` timeline context lines with grounded details (CC broken, target HP, and friendly offensive cooldown presence) conforming to "one line owns each event", with render-grid aligned sampling and unified B111 break binding.

**Architecture:** 
1. Extract the canonical B111 break binding logic into a shared generic export `bindBreakToWindow<T extends ICCBreakableWindow>` in `ccTrinketAnalysis.ts` and unify both existing B111 consumers and the new `findBrokenCC` helper.
2. Plumb `recipientId` on `IEnemyDefensiveEvent` in `enemyDefensives.ts` to ensure external defensive target resolution is unambiguous.
3. In `matchTimeline.ts`, enrich `[ENEMY DEF]` and `[ENEMY TRINKET]` using snapped seconds `toRenderSecond(t)` for HP and friendly offensive CD checks (`hasOffensiveSpellActive`), while using raw timestamps for `findBrokenCC`.
4. Update quality gates (`promptQualityCheck.ts`) to recognize the new line shapes and add adversarial tests.
5. Bump `PROMPT_VERSION = 92` and update bilingual `predicate-index.md`.

**Tech Stack:** TypeScript, Vitest, Node.js

---

### Task 1: Extract `bindBreakToWindow` and Unify B111 CC Break Attribution

**Files:**
- Modify: `packages/analysis/src/utils/ccTrinketAnalysis.ts`
- Test: `packages/analysis/test/ccTrinketAnalysis.test.ts`

- [ ] **Step 1: Write failing unit test for `bindBreakToWindow` and `findBrokenCC`**

In `packages/analysis/test/ccTrinketAnalysis.test.ts`, add test cases verifying:
1. Break cast within `±250ms` binds to the active window.
2. Multiple overlapping windows: binds to the one with longest duration.
3. Cast outside `±250ms`: returns `undefined`.

```typescript
describe("bindBreakToWindow & findBrokenCC", () => {
  it("binds to the longest active window within ±250ms tolerance", () => {
    const windows = [
      { applyMs: 1000, removeMs: 3000, id: "short" },
      { applyMs: 1000, removeMs: 6000, id: "long" },
    ];
    // Cast at 2000ms is within both; should pick "long" (5000ms duration vs 2000ms)
    const bound = bindBreakToWindow(windows, 2000);
    expect(bound?.id).toBe("long");
  });

  it("respects ±250ms tolerance boundaries", () => {
    const windows = [{ applyMs: 1000, removeMs: 3000, id: "w1" }];
    expect(bindBreakToWindow(windows, 750)?.id).toBe("w1");
    expect(bindBreakToWindow(windows, 749)).toBeUndefined();
    expect(bindBreakToWindow(windows, 3250)?.id).toBe("w1");
    expect(bindBreakToWindow(windows, 3251)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/analysis test/ccTrinketAnalysis.test.ts`
Expected: FAIL (cannot find `bindBreakToWindow`).

- [ ] **Step 3: Implement `bindBreakToWindow` and export `findBrokenCC`**

In `packages/analysis/src/utils/ccTrinketAnalysis.ts`:
1. Export `TRINKET_BREAK_TOLERANCE_MS = 250`.
2. Define and export `ICCBreakableWindow`:
```typescript
export interface ICCBreakableWindow {
  applyMs: number;
  removeMs: number;
}
```
3. Export generic `bindBreakToWindow`:
```typescript
export function bindBreakToWindow<T extends ICCBreakableWindow>(
  windows: T[],
  castTs: number,
  toleranceMs = TRINKET_BREAK_TOLERANCE_MS,
): T | undefined {
  let primary: T | undefined;
  let primaryDurationMs = -1;
  for (const w of windows) {
    const activeAtCast =
      castTs >= w.applyMs - toleranceMs &&
      castTs <= w.removeMs + toleranceMs;
    if (!activeAtCast) continue;
    const durationMs = w.removeMs - w.applyMs;
    if (durationMs > primaryDurationMs) {
      primaryDurationMs = durationMs;
      primary = w;
    }
  }
  return primary;
}
```
4. Define and export `findBrokenCC`:
```typescript
export function findBrokenCC(
  instances: ICCInstance[],
  matchStartMs: number,
  castTsMs: number,
): ICCInstance | undefined {
  const breakable = instances.map((cc) => ({
    cc,
    applyMs: matchStartMs + Math.round(cc.atSeconds * 1000),
    removeMs: matchStartMs + Math.round((cc.atSeconds + cc.durationSeconds) * 1000),
  }));
  return bindBreakToWindow(breakable, castTsMs)?.cc;
}
```
5. Replace the inline `bindBreakToWindow` closure in `ccTrinketAnalysis.ts` to call the shared function.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/analysis test/ccTrinketAnalysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/utils/ccTrinketAnalysis.ts packages/analysis/test/ccTrinketAnalysis.test.ts
git commit -m "refactor(analysis): extract and export canonical bindBreakToWindow (GH #69)"
```

---

### Task 2: Plumb `recipientId` on `IEnemyDefensiveEvent`

**Files:**
- Modify: `packages/analysis/src/utils/enemyDefensives.ts`
- Test: `packages/analysis/test/enemyDefensives.test.ts`

- [ ] **Step 1: Write failing test for `recipientId` in `enemyDefensives.test.ts`**

Add a test case in `packages/analysis/test/enemyDefensives.test.ts` verifying that external defensive events include `recipientId: recipient.id`.

```typescript
it("carries recipientId for external defensives", () => {
  const caster = createMockUnit("priest-1", "Priest", "Hostile");
  const target = createMockUnit("rogue-2", "Rogue", "Hostile");
  // cast Pain Suppression from priest-1 to rogue-2
  const events = enemyDefensiveEvents(caster, [caster, target], combat);
  const ext = events.find((e) => e.kind === "external");
  expect(ext?.recipientId).toBe("rogue-2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/analysis test/enemyDefensives.test.ts`
Expected: FAIL (`recipientId` is undefined or not on type).

- [ ] **Step 3: Update `IEnemyDefensiveEvent` and populate `recipientId`**

In `packages/analysis/src/utils/enemyDefensives.ts`:
1. Add `recipientId?: string;` to `IEnemyDefensiveEvent`.
2. In `enemyDefensiveEvents`, assign `recipientId: recipient.id` when pushing an external defensive event.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/analysis test/enemyDefensives.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/utils/enemyDefensives.ts packages/analysis/test/enemyDefensives.test.ts
git commit -m "feat(analysis): plumb recipientId on IEnemyDefensiveEvent (GH #69)"
```

---

### Task 3: Implement Context Enrichment in `matchTimeline.ts`

**Files:**
- Modify: `packages/analysis/src/context/matchTimeline.ts`
- Create: `packages/analysis/test/context.enemyDefTrinketContext.test.ts`

- [ ] **Step 1: Write comprehensive unit & adversarial tests in `context.enemyDefTrinketContext.test.ts`**

Cover the 6 spec scenarios:
1. `[ENEMY TRINKET]` broken hard CC with friendly offensive CD active and target HP.
2. `[ENEMY TRINKET]` with no matching hard CC (omits `out of ...`, does NOT emit `off-CC`).
3. Fractional-second snapping: HP and CD sample at `toRenderSecond(t)`, CC break attribution uses raw `t`.
4. Overlapping CCs broken by trinket: B111 longest window chosen.
5. `[ENEMY DEF]` self/immune: includes `(at N% HP)` and `[friendly offensive CD active]`.
6. `[ENEMY DEF]` external: uses `d.recipientId` for target lookup and renders `(target at N% HP)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/analysis test/context.enemyDefTrinketContext.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement enrichment in `matchTimeline.ts`**

In `packages/analysis/src/context/matchTimeline.ts`:
1. Import `findBrokenCC` from `../utils/ccTrinketAnalysis`.
2. In `[ENEMY DEF]` section (~line 2304):
   - For each defensive event `d`:
     - `const tSec = toRenderSecond(d.atSeconds);`
     - `const tMs = matchStartMs + tSec * 1000;`
     - `const hasBurst = friends.some((f) => hasOffensiveSpellActive(f, tMs, null));`
     - `const burstStr = hasBurst ? " [friendly offensive CD active]" : "";`
     - Determine target: for self/immune, target is `enemy`; for external, `enemies.find(e => e.id === d.recipientId)`.
     - `const hpPct = targetUnit ? getHpPercentAtTime(targetUnit, tSec, matchStartMs) : null;`
     - Format:
       - Self/Immune: `... (${strength}${dur})${burstStr}${hpPct !== null ? ` (at ${hpPct.toFixed(0)}% HP)` : ""}`
       - External: `... → ${enemyPid(d.recipientName ?? "")}${dur ? ` (${dur})` : ""}${burstStr}${hpPct !== null ? ` (target at ${hpPct.toFixed(0)}% HP)` : ""}`
3. In `[ENEMY TRINKET]` section (~line 2488):
   - For each trinket timestamp `t`:
     - `const tSec = toRenderSecond(t);`
     - `const tMs = matchStartMs + tSec * 1000;`
     - `const rawCastMs = matchStartMs + Math.round(t * 1000);`
     - `const brokenCC = findBrokenCC(summary.ccInstances, matchStartMs, rawCastMs);`
     - `const ccPart = brokenCC ? ` out of ${brokenCC.spellName} (by ${actorLabel(brokenCC.sourceName, "friendly", brokenCC.sourceId)})` : "";`
     - `const hasBurst = friends.some((f) => hasOffensiveSpellActive(f, tMs, null));`
     - `const burstPart = hasBurst ? " [friendly offensive CD active]" : "";`
     - `const enemyUnit = enemies.find((e) => e.name === summary.playerName);`
     - `const hpPct = enemyUnit ? getHpPercentAtTime(enemyUnit, tSec, matchStartMs) : null;`
     - `const hpPart = hpPct !== null ? ` (target at ${hpPct.toFixed(0)}% HP)` : "";`
     - Line: `${fmtTime(t)}  [ENEMY TRINKET]   ${enemyPid(summary.playerName)} used PvP trinket${ccPart}${burstPart}${hpPart}`
4. Update legend entries for `[ENEMY DEF]` and `[ENEMY TRINKET]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/analysis test/context.enemyDefTrinketContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis/src/context/matchTimeline.ts packages/analysis/test/context.enemyDefTrinketContext.test.ts
git commit -m "feat(analysis): enrich [ENEMY DEF] and [ENEMY TRINKET] timeline lines with context (GH #69 / C2)"
```

---

### Task 4: Quality Gate & Rejection Tests

**Files:**
- Modify: `packages/eval/src/quality/promptQualityCheck.ts`
- Modify: `packages/eval/test/promptQualityCheck.test.ts`

- [ ] **Step 1: Write failing quality gate tests**

In `packages/eval/test/promptQualityCheck.test.ts`:
1. Test rejection of external-recipient HP contradiction on `[ENEMY DEF]`.
2. Test rejection of wrong-side pet attribution on `[ENEMY TRINKET]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/eval test/promptQualityCheck.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `promptQualityCheck.ts`**

1. Update HP consistency parser to extract `(at N% HP)` and `(target at N% HP)` from `[ENEMY DEF]` and `[ENEMY TRINKET]` lines.
2. Update `checkPetCreditSide` to check `[ENEMY TRINKET]` lines containing `(by ...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/eval test/promptQualityCheck.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/quality/promptQualityCheck.ts packages/eval/test/promptQualityCheck.test.ts
git commit -m "feat(eval): update promptQualityCheck for enemy def and trinket context lines (GH #69)"
```

---

### Task 5: Version Bump, Predicate Index & Presubmit Verification

**Files:**
- Modify: `packages/desktop/src/shared/promptVersion.ts`
- Modify: `docs/predicate-index.md`
- Modify: `docs/predicate-index.zh-CN.md`

- [ ] **Step 1: Bump `PROMPT_VERSION = 92`**

In `packages/desktop/src/shared/promptVersion.ts`:
Bump `PROMPT_VERSION` from 91 to 92 with changelog entry for GH #69 (enemy defensive & trinket context).

- [ ] **Step 2: Update `docs/predicate-index.md` and `.zh-CN.md`**

Register the new predicate rows:
- `findBrokenCC` / `bindBreakToWindow`
- `[ENEMY DEF]` & `[ENEMY TRINKET]` context clauses

- [ ] **Step 3: Run full typecheck and presubmit**

Run: `npm run typecheck && npm run test`
Expected: All clean.

- [ ] **Step 4: Commit & Push**

```bash
git add packages/desktop/src/shared/promptVersion.ts docs/predicate-index.md docs/predicate-index.zh-CN.md
git commit -m "docs(analysis): bump PROMPT_VERSION to 92 and register enemy def/trinket context in predicate-index"
```
