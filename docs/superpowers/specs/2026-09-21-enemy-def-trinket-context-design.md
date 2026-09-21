# Design: Enemy Defensive & Trinket Context Enrichment (GH #69 / C2)

## 1. Problem Statement & Background

- **Context**: Coaching evaluations show ~22.6% (475/2,100) of human coaching verdicts are positive/praise (e.g. "baited defensive", "forced trinket", "cross-CC"). Currently, Gladlog has only one positive timeline context tag: `[BURST ANSWERED]` (GH #60), covering ~3% of praise moments.
- **Goal**: Enrich existing `[ENEMY DEF]` and `[ENEMY TRINKET]` lines in the prompt timeline with grounded, factual context (CC broken, target HP, and friendly offensive cooldown presence).
- **Architecture Principles**:
  - **"One line owns each event"** (PROMPT_VERSION 71, GH #99 item 3): The existing event lines own their context; no duplicate or parallel praise lines.
  - **Shared-predicate rule** (CLAUDE.md):
    - **Render-grid alignment**: HP and friendly offensive CD queries snap to `tSec = toRenderSecond(t)`, matching the displayed second on `[STATE]` ticks.
    - **Raw-event alignment for CC break**: CC break attribution uses the **original/raw event timestamp** `t` with the canonical B111 predicate (`TRINKET_BREAK_TOLERANCE_MS = 250`, longest window tie-break) extracted from `ccTrinketAnalysis.ts`. It does **not** snap `t` to whole seconds, preserving sub-second accuracy for CC breaks.
    - **Canonical predicates**: Friendly offensive CD detection uses `hasOffensiveSpellActive`. External defensive recipient resolution uses `recipientId` plumbed through `IEnemyDefensiveEvent`.
  - **Purely descriptive, non-judgmental**:
    - Say `[friendly offensive CD active]` rather than claiming focused "burst".
    - If no hard CC was broken, omit the clause rather than falsely asserting `off-CC` (roots and unobserved CC cannot be ruled out).
    - Report facts without editorializing.

---

## 2. Technical Specification

### 2.1 Render Grid Snapping & Target HP Sampling
- **Grid Snapping**:
  - Given event timestamp `t` in seconds: `tSec = toRenderSecond(t)`.
  - HP and CD lookups occur at `tSec` (or `matchStartMs + tSec * 1000`), ensuring exact consistency with the `[STATE]` sampler at that displayed second.
- **HP Sampling**:
  - Function: `getHpPercentAtTime(targetUnit, tSec, matchStartMs)`.
  - For `[ENEMY DEF]` (self/immune): target is `enemy` (the caster). Rendered as `(at N% HP)`.
  - For `[ENEMY DEF]` (external): target is resolved via `d.recipientId` (`enemies.find(e => e.id === d.recipientId)`). Rendered as `(target at N% HP)`.
  - For `[ENEMY TRINKET]`: target is `enemy` (`enemies.find(e => e.name === summary.playerName)`). Rendered as `(target at N% HP)`.
  - Rounding: `toFixed(0)` matching `[STATE]`.
  - Null handling: If `getHpPercentAtTime` returns `null`, omit the HP clause entirely. Never emit `null%` or `undefined%`.

### 2.2 Friendly Offensive Cooldown Context
- **Function**: `hasOffensiveSpellActive(unit: ICombatUnit, tMs: number, enemyIds: Set<string> | null): boolean`
- **Application**:
  - Sampled at `tMs = matchStartMs + tSec * 1000` where `tSec = toRenderSecond(t)`.
  - Query: `friends.some(f => hasOffensiveSpellActive(f, tMs, null))`.
  - Format: When true, append `[friendly offensive CD active]`. When false, omit.

### 2.3 Trinket CC Identification
- **Predicate Sharing**:
  - Extract the B111 break-binding helper from `ccTrinketAnalysis.ts` into a shared export:
    ```typescript
    export const TRINKET_BREAK_TOLERANCE_MS = 250;

    export interface ICCBreakableWindow {
      applyMs: number;
      removeMs: number;
    }

    /**
     * B111: Binds a break cast timestamp to the single longest-active CC window
     * that covers castTs within ±toleranceMs.
     */
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
  - For `summary.ccInstances: ICCInstance[]` in `matchTimeline.ts`:
    Adapt `ICCInstance` to `ICCBreakableWindow` using exact event timing:
    `applyMs = matchStartMs + Math.round(cc.atSeconds * 1000)` and
    `removeMs = matchStartMs + Math.round((cc.atSeconds + cc.durationSeconds) * 1000)`.
  - **Caller Unification**: Both `ccTrinketAnalysis.ts`'s existing B111 path (trinket and racial breaks) and the new `findBrokenCC` helper MUST call the shared `bindBreakToWindow` export; the original inline binding logic in `ccTrinketAnalysis.ts` is replaced by this shared function.
  - Query: `findBrokenCC(summary.ccInstances, matchStartMs + Math.round(t * 1000))` where `t` is the **original unfloored** trinket timestamp in seconds.
  - Caster resolution uses `actorLabel(cc.sourceName, "friendly", cc.sourceId)`.
  - Format when matched: `out of ${cc.spellName} (by ${actorLabel})`.
  - Format when unmatched: Omit the clause (do NOT claim `off-CC`, since roots and unindexed CCs cannot be excluded).

### 2.4 Plumbing in `enemyDefensives.ts`
- Extend `IEnemyDefensiveEvent`:
  ```typescript
  export interface IEnemyDefensiveEvent {
    // ... existing fields ...
    recipientId?: string; // unit ID of external defensive recipient
  }
  ```
- In `enemyDefensiveEvents`, assign `recipientId: recipient.id` for external defensives.
- Preserve existing `observedSeconds` and `removedEarly` fields.

---

## 3. Timeline Output Format

### 3.1 `[ENEMY TRINKET]`
- **When breaking a matched hard CC**:
  `${fmtTime(t)}  [ENEMY TRINKET]   ${enemyPid(name)} used PvP trinket out of ${ccSpell} (by ${caster})${burstPart}${hpPart}`
  Example:
  `0:42  [ENEMY TRINKET]   2(ERogue) used PvP trinket out of Kidney Shot (by 1(You)) [friendly offensive CD active] (target at 31% HP)`
- **When no matched hard CC**:
  `${fmtTime(t)}  [ENEMY TRINKET]   ${enemyPid(name)} used PvP trinket${burstPart}${hpPart}`
  Example:
  `0:42  [ENEMY TRINKET]   2(ERogue) used PvP trinket [friendly offensive CD active] (target at 68% HP)`

### 3.2 `[ENEMY DEF]`
- **Self / Immune**:
  `${fmtTime(d.atSeconds)}  [ENEMY DEF]   ${who}: ${d.spellName} (${strength}${dur})${burstPart}${hpPart}`
  Example:
  `0:45  [ENEMY DEF]   2(ERogue) (Subtlety): Cloak of Shadows (immune, 5.0s) [friendly offensive CD active] (at 28% HP)`
- **External**:
  `${fmtTime(d.atSeconds)}  [ENEMY DEF]   ${who}: ${d.spellName} → ${enemyPid(recipient)}${dur}${burstPart}${hpPart}`
  Example:
  `0:46  [ENEMY DEF]   3(EPriest) (Discipline): Pain Suppression → 2(ERogue) (8.0s) [friendly offensive CD active] (target at 24% HP)`

### 3.3 Legend Entries in `matchTimeline.ts`
Update existing `[ENEMY DEF]` and `[ENEMY TRINKET]` legend lines:
- Explain that `[friendly offensive CD active]` indicates at least one friendly offensive cooldown was active at that displayed second.
- Explain that `(at N% HP)` / `(target at N% HP)` reflects the target's HP at the displayed second.

---

## 4. Verifiability, Quality Gates & Testing Plan

1. **Deterministic Quality Gates**:
   - Update `packages/eval/src/quality/promptQualityCheck.ts`:
     - Update HP consistency regex to recognize `(at N% HP)` and `(target at N% HP)` suffixes on `[ENEMY DEF]` and `[ENEMY TRINKET]`.
     - Update pet credit / actor label check (`checkPetCreditSide`) to validate `[ENEMY TRINKET]   ... (by ...)` lines, rejecting wrong-side or raw localized pet name leaks.
     - Add gate-level rejection tests in `packages/eval/test/promptQualityCheck.test.ts` for:
       - External-recipient HP contradiction against `[STATE]`.
       - Wrong-side pet attribution on `[ENEMY TRINKET]`.
2. **Unit & Adversarial Tests**:
   - Create `packages/analysis/test/context.enemyDefTrinketContext.test.ts`:
     - Test 1: Enemy trinkets out of friendly CC during friendly offensive CD -> checks exact line format, caster resolution, and HP.
     - Test 2: Enemy trinkets without matching hard CC -> checks clause omission (no false `off-CC`).
     - Test 3: Fractional-second timestamp: verifies that HP and CD sample at `toRenderSecond(t)`, while CC break attribution evaluates at raw `t` with `TRINKET_BREAK_TOLERANCE_MS = 250`.
     - Test 4: Overlapping CCs broken by trinket -> verifies B111 longest-duration selection.
     - Test 5: External defensive recipient resolution using `recipientId` -> verifies correct recipient HP even when multiple enemies share spec/class.
     - Test 6: Missing HP data -> verifies graceful omission without formatting artifacts or `undefined`.
3. **Presubmit & Acceptance**:
   - Run `npm run presubmit` (typecheck + eslint + all workspace tests + verify:vision + electron build).
   - Verify zero regressions in candidate counts or existing prompt quality checks across the local corpus.
4. **Documentation & Version Bump**:
   - Bump `PROMPT_VERSION = 92` in `packages/desktop/src/shared/promptVersion.ts`.
   - Update `docs/predicate-index.md` (+ `.zh-CN.md`).
