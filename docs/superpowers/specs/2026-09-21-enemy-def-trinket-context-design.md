# Design: Enemy Defensive & Trinket Context Enrichment (GH #69 / C2)

## 1. Problem Statement & Background

- **Context**: Coaching evaluations show ~22.6% (475/2,100) of human coaching verdicts are positive/praise (e.g. "baited defensive", "forced trinket", "cross-CC"). Currently, Gladlog has only one positive timeline context tag: `[BURST ANSWERED]` (GH #60), covering ~3% of praise moments.
- **Goal**: Enrich existing `[ENEMY DEF]` and `[ENEMY TRINKET]` lines in the prompt timeline with grounded, factual context (CC broken, target HP, and friendly burst pressure).
- **Architecture Principle**:
  - Follow the **"one line owns each event"** rule (PROMPT_VERSION 71, GH #99 item 3). Instead of adding redundant separate lines or accusation candidates, the existing event lines own their context.
  - Follow the **shared-predicate rule** (CLAUDE.md). Use existing canonical functions:
    - `getHpPercentAtTime` for HP sampling.
    - `hasOffensiveSpellActive` for friendly burst pressure.
    - `enemyCCSummaries` and `ccInstances` for broken CC matching.
  - Purely descriptive, non-judgmental facts. Never label an event with subjective judgements like "panicked" or "wasted".

---

## 2. Technical Specification

### 2.1 Target HP Sampling
- **Function**: `getHpPercentAtTime(targetUnit: ICombatUnit, tSec: number, matchStartMs: number): number | null`
- **Application**:
  - `[ENEMY DEF]` (self/immune): target is `enemy` (the caster). Rendered as `(at N% HP)`.
  - `[ENEMY DEF]` (external): target is `recipient` (`enemies.find(e => e.id === cast.destUnitId)`). Rendered as `(target at N% HP)`.
  - `[ENEMY TRINKET]`: target is `enemy` (the trinketer). Rendered as `(target at N% HP)`.
- **Null handling**: If `getHpPercentAtTime` returns `null` (e.g. no position/health logs at that instant), omit the HP clause entirely. Never emit `null%` or `undefined%`.

### 2.2 Friendly Burst Pressure Context
- **Function**: `hasOffensiveSpellActive(unit: ICombatUnit, tMs: number, enemyIds: string[] | null): boolean`
- **Application**:
  - At `tMs = matchStartMs + Math.round(tSec * 1000)`:
  - Check if any unit in `friends` satisfies `hasOffensiveSpellActive(f, tMs, null)`.
  - If true, append `[friendly burst]`. If false, emit nothing.

### 2.3 Trinket CC Identification
- **Data Source**: `summary.ccInstances: ICCInstance[]` from `enemyCCSummaries`.
- **Predicate**:
  - Find all CC instances on `summary.playerName` where `cc.atSeconds <= t && t <= cc.atSeconds + cc.durationSeconds + 0.5`.
  - If multiple match, select the one with the latest `atSeconds` (or longest original duration).
  - Resolve caster with `actorLabel(cc.sourceName, "friendly", cc.sourceId)`.
  - Format: `out of ${cc.spellName} (by ${actorLabel})`.
  - If no CC matches: format as `off-CC`.

---

## 3. Timeline Output Format

### 3.1 `[ENEMY TRINKET]`
- **In-CC**:
  `${fmtTime(t)}  [ENEMY TRINKET]   ${enemyPid(name)} used PvP trinket out of ${ccSpell} (by ${caster})${burstPart}${hpPart}`
  Example:
  `0:42  [ENEMY TRINKET]   2(ERogue) used PvP trinket out of Kidney Shot (by 1(You)) [friendly burst] (target at 31% HP)`
- **Off-CC**:
  `${fmtTime(t)}  [ENEMY TRINKET]   ${enemyPid(name)} used PvP trinket off-CC${burstPart}${hpPart}`
  Example:
  `0:42  [ENEMY TRINKET]   2(ERogue) used PvP trinket off-CC (target at 68% HP)`

### 3.2 `[ENEMY DEF]`
- **Self / Immune**:
  `${fmtTime(d.atSeconds)}  [ENEMY DEF]   ${who}: ${d.spellName} (${strength}${dur})${burstPart}${hpPart}`
  Example:
  `0:45  [ENEMY DEF]   2(ERogue) (Subtlety): Cloak of Shadows (immune, 5.0s) [friendly burst] (at 28% HP)`
- **External**:
  `${fmtTime(d.atSeconds)}  [ENEMY DEF]   ${who}: ${d.spellName} → ${enemyPid(recipient)}${dur}${burstPart}${hpPart}`
  Example:
  `0:46  [ENEMY DEF]   3(EPriest) (Discipline): Pain Suppression → 2(ERogue) (8.0s) [friendly burst] (target at 24% HP)`

### 3.3 Legend Entries in `matchTimeline.ts`
Update existing `[ENEMY DEF]` and `[ENEMY TRINKET]` legend lines:
- Explain that `[friendly burst]` indicates an active friendly offensive cooldown at that second.
- Explain that `(at N% HP)` / `(target at N% HP)` is the target's HP at the instant the ability was used.

---

## 4. Verifiability & Testing Plan

1. **Unit Tests**:
   - Create `packages/analysis/test/context.enemyDefTrinketContext.test.ts`.
   - Test cases:
     1. Enemy trinkets while in friendly stun during friendly burst -> verifies CC name, caster, `[friendly burst]`, and target HP.
     2. Enemy trinkets off-CC without burst -> verifies `off-CC` and target HP.
     3. Enemy casts self defensive during friendly burst -> verifies `[friendly burst]` and `(at N% HP)`.
     4. Enemy casts external defensive on teammate during friendly burst -> verifies `[friendly burst]` and `(target at N% HP)`.
     5. Missing HP data -> verifies graceful omission without formatting artifacts.
2. **Typecheck & Presubmit**:
   - `npm run typecheck` across all packages.
   - `npx vitest run --root packages/analysis test/context.enemyDefTrinketContext.test.ts`.
3. **Version Bump**:
   - Bump `PROMPT_VERSION = 92` in `packages/desktop/src/shared/promptVersion.ts`.
   - Update `docs/predicate-index.md` (+ zh-CN).
