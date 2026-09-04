/**
 * Cooldown-timing candidate producers — `missed-sync-window`,
 * `unsynced-burst`, `cd-hoarded` and `cd-spent-idle`, plus the enemy-healer
 * CC window and friendly-crisis predicates they all key off.
 *
 * Split out of `candidateFindings.ts` on 2026-08-16 (mechanical split by
 * theme); logic moved verbatim. All four ask the same question from different
 * angles — was this button pressed at the moment the team's window wanted it —
 * which is why the shared window predicates live here with them.
 */
import { costNormPhrase } from "../../data/curatedAbilityFacts";
import { spellEffectData } from "../../data/spellEffectData";
import { reachesAlly } from "../../data/spellTargeting";
import {
  syncRefClearsMinContrast,
  type SyncWindowPriorRef,
} from "../../data/syncWindowPrior";
import { burstCastSpan } from "../../utils/burstLedger";
import {
  canHelpAnotherUnit,
  cdAvailableAt,
  DEFENSIVE_TAGS,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  type IMajorCooldownInfo,
  isHealerSpec,
  isProcOnlyActivation,
  SELF_CAST_NOOP_EXTERNAL_IDS,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
} from "../../utils/cooldowns";
import {
  analyzeOutgoingCCChains,
  DR_CATEGORY_MAP,
} from "../../utils/drAnalysis";
import { castFailedInWindow, type RawStreams } from "../../utils/rawStreams";
import { renderedWindowSeconds, toRenderSecond } from "../../utils/renderGrid";
import { type MatchThreatLevel } from "../../utils/threatAssessment";
import { type DecisionPoint, RESPONSE_PRE_MS } from "../crisisDecisionPoints";
import { fmtFactNum as fmt } from "../factFormat";
import { CandidateEvent } from "../types";
import { filterIntentGuardEvidence, formatAttemptedFact } from "./shared";

/**
 * HARD_CC_CATEGORIES (P1 sync-lens, 2026-08-15, `missedSyncWindowEvents` /
 * `unsyncedBurstEvents`): the DR categories that count as "the enemy healer
 * is locked out of casting" — mirrors `DR_CATEGORY_MAP`'s full PvP-relevant
 * label set (drAnalysis.ts's `SCM_CATEGORY_LABELS` already excludes
 * 'taunt'/'root' at the source, "not relevant for PvP CC analysis") minus
 * "Root" defensively (currently a no-op — no spell maps to it — kept in case
 * a future DR-category addition ever does). Two existing precedents back this
 * exact split, not a fresh invention:
 *  - `ccBreakAnalysis.ts`'s `rootBreakCount` bucket: "kept in its own bucket,
 *    never mixed into hard CC (a broken root is often a tactically correct
 *    trade, not a mistake to coach)".
 *  - `matchArchetype.ts`'s `classifiedFriendlyCCEvents`: CC events whose
 *    spell IS in the DR category map are already this file's established
 *    "hard CC" measurement; the remainder ("roots, minor incapacitates, or
 *    unmapped spells") is explicitly documented as "not hard CC".
 * Every application `analyzeOutgoingCCChains` returns is already restricted
 * to `ccSpellIds` (spellCategories' `type === "cc"`, the same set
 * `isCastBlockingAuraType` treats as cast-blocking) — this filter narrows
 * that further to the subset with recognized DR bookkeeping, matching the
 * matchArchetype.ts precedent rather than re-deriving a parallel "hard CC"
 * notion from spellCategories directly.
 */
export const HARD_CC_CATEGORIES: ReadonlySet<string> = new Set(
  Object.values(DR_CATEGORY_MAP).filter((category) => category !== "Root"),
);

export interface IEnemyHealerCcWindow {
  fromSeconds: number;
  toSeconds: number;
  spellName: string;
  spellId: string;
  healerName: string;
}

/**
 * Shared "敌治疗硬控窗" extraction (CLAUDE.md shared-predicate rule): both
 * `missedSyncWindowEvents` and `unsyncedBurstEvents` consume the exact same
 * windows so a "the healer was locked" fact can never disagree between the
 * two candidate types. Built on `analyzeOutgoingCCChains` — the same
 * outgoing-CC data source `dr-clipped-cc` already reads — filtered to
 * targets `isHealerSpec` classifies as the enemy healer, then narrowed to
 * `HARD_CC_CATEGORIES` (see its doc comment for the category decision).
 * `friends`/`enemies` decide caster/target sides exactly as every other
 * `teamPlayEvents` caller passes them; matching a chain to "the enemy healer"
 * is by `targetName` because `IOutgoingCCChain` does not carry a target unit
 * id (analyzeOutgoingCCChains' own return shape).
 *
 * Exported (review fix round 1, 2026-08-15): originally file-private, kept
 * exported so tests can call it directly instead of re-deriving its logic.
 * `missedSyncWindowEvents`/`unsyncedBurstEvents` are wired into
 * `teamPlayEvents` (candidateFindings.ts) and both flags have been ON since
 * 2026-08-15 — see docs/predicate-index.md's `Feature flag state` table for
 * the current expected value of every flag.
 */
export function enemyHealerCcWindows(
  friends: any[],
  enemies: any[],
  combat: any,
): IEnemyHealerCcWindow[] {
  const healerNames = new Set(
    enemies.filter((e) => isHealerSpec(e.spec)).map((e) => e.name as string),
  );
  if (healerNames.size === 0) return [];
  const out: IEnemyHealerCcWindow[] = [];
  for (const chain of analyzeOutgoingCCChains(friends, enemies, combat)) {
    if (!healerNames.has(chain.targetName)) continue;
    for (const app of chain.applications) {
      if (!HARD_CC_CATEGORIES.has(app.drInfo.category)) continue;
      out.push({
        fromSeconds: app.atSeconds,
        toSeconds: app.atSeconds + app.durationSeconds,
        spellName: app.spellName,
        spellId: app.spellId,
        healerName: chain.targetName,
      });
    }
  }
  return out.sort((a, b) => a.fromSeconds - b.fromSeconds);
}

/** Lowest HP% across all enemy players sampled at every rendered second inside
 * [fromSeconds, toSeconds] (inclusive) — the ACCELERATOR-only fact
 * `missed-sync-window` attaches (B8: never a gate). Render-grid discipline
 * (CLAUDE.md): the query instants are `toRenderSecond`-floored before
 * sampling, same as `trinketTeamMinHpPctAt`, so this cannot contradict the
 * whole-second [STATE] HP the prompt timeline separately renders. Returns
 * null only when NO sample succeeded anywhere in the window (no advanced
 * logging) — the caller must treat null as "omit the fact", never as "0%".
 */
export function enemyMinHpPctInWindow(
  enemies: any[],
  combat: { startTime: number },
  fromSeconds: number,
  toSeconds: number,
  hpLookup: (
    unit: any,
    timestampMs: number,
    maxDtMs: number,
  ) => number | null = getUnitHpAtTimestamp,
): number | null {
  const fromR = toRenderSecond(fromSeconds);
  const toR = toRenderSecond(toSeconds);
  let min: number | null = null;
  for (let t = fromR; t <= toR; t++) {
    for (const e of enemies) {
      const hp = hpLookup(e, combat.startTime + t * 1000, HP_SAMPLE_RADIUS_MS);
      if (hp === null) continue;
      if (min === null || hp < min) min = hp;
    }
  }
  return min;
}

/** Per-match cap for missed-sync-window. <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed at 2, unchanged — full-corpus scan (1028
 * matches/3441 rounds, at B8's fixed no-HP-gate definition, which Task 5 has
 * no threshold lever over) measured 场均条数(capped) 1.37 (raw pre-cap 3.20),
 * comfortably inside the 0.5–2 target band; the cap is doing real
 * truncation work (raw > capped), not sitting idle. 发生率 76.4% sits above
 * every OTHER type's precedent (max 63.6%) — but that is a property of B8's
 * user-ruled "no HP gate" design already locked before Task 5, not a
 * threshold this constant can move; a lower cap would only shrink how many
 * of an already-firing round's windows get reported, not how often the type
 * fires at all. 双向误差注: a lower cap would drop real, distinct missed
 * windows from an already-high-occurrence round (each window is an
 * independent "we had the lock and didn't press it" fact); a higher cap
 * would let a single grindy round dominate the menu even more than the
 * 3.20 raw average already implies it wants to. */
const MISSED_SYNC_WINDOW_CAP = 2; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>

/**
 * missed-sync-window (P1 起爆-1, 2026-08-15; REDESIGNED 2026-09-02 — the
 * GH #13 resurrection, user-approved): a window where the enemy healer sat in
 * hard CC (`enemyHealerCcWindows`) while >=1 friendly canonical offensive
 * major cooldown was ready (`cdAvailableAt` at the window's start) AND no
 * friendly canonical offensive major was cast in [start−2s, end] (the team
 * had the lock and the tool, and did not press it).
 *
 * What the resurrection changed vs the 2026-08-15 predicate (each item is
 * shared with syncWindowScan.ts — the reference table and the candidate are
 * about the same population by construction, CLAUDE.md shared-predicate
 * rule):
 *   - CD table: caller now filters on `OFFENSIVE_CD_SPELL_IDS`
 *     (spellDanger.ts, chg9 canonical 47) instead of `isThroughput`, which
 *     had been listing Tiger's Lust / Berserker Shout / racials as "ready
 *     offensive CDs".
 *   - Eligibility: rendered duration >= SYNC_WINDOW_MIN_DUR_S; rendered
 *     start >= SYNC_WINDOW_MIN_T_S (opener/setup windows excluded); windows
 *     containing an enemy death are excluded (a kill already converting
 *     without CDs is not a missed sync).
 *   - entered: the press may lead the lock by up to SYNC_ENTER_LEAD_S — a CD
 *     opened 1 s before the stun lands is sync, not a miss.
 *   - Reference + door: the bracket's corpus cell (syncWindowPrior.ts) is
 *     quoted in facts, and a bracket whose entered/unentered kill contrast
 *     is under `SYNC_REF_MIN_CONTRAST_PP` (or whose cell misses the n floor)
 *     produces NO candidates — this is what keeps the flood GH #13
 *     documented (74% fire rate, mostly Solo Shuffle) from returning
 *     without hand-coding a bracket list.
 *
 * B8 red line (user-ruled, non-negotiable, CI-pinned by a dedicated test):
 * NO HP gate — unchanged by the resurrection. Enemy HP is carried in facts
 * as an accelerator only; `minHp === null` (no advanced logging) still
 * emits. (The death-in-window exclusion above is an outcome-event gate, not
 * a blood threshold: the 93%-to-dead B1 finale case B8 protects has no
 * enemy death BEFORE the sync and still fires.)
 *
 * Fact/suggestion split (CLAUDE.md decision-point-card discipline): facts
 * carry only what happened plus the corpus reference numbers — "you should
 * have burst" lives in buildFindingsPrompt's legend text.
 *
 * Severity/cap: sorted by rendered window length (a longer lock is a bigger
 * missed opportunity), then capped at MISSED_SYNC_WINDOW_CAP.
 */
export const SYNC_WINDOW_MIN_T_S = 30;
export const SYNC_WINDOW_MIN_DUR_S = 3;
export const SYNC_ENTER_LEAD_S = 2;
export function missedSyncWindowEvents(
  ccWindows: Pick<
    IEnemyHealerCcWindow,
    "fromSeconds" | "toSeconds" | "spellName" | "spellId" | "healerName"
  >[],
  offensiveCds: Pick<
    IMajorCooldownInfo,
    "spellId" | "spellName" | "casts" | "cooldownSeconds" | "neverUsed" | "charges"
  >[],
  probes: {
    /** Wired to enemyMinHpPctInWindow in production. Accelerator-only, see
     * the B8 doc comment above — must NEVER gate the candidate. */
    enemyMinHpPctAt: (fromSeconds: number, toSeconds: number) => number | null;
    /** seconds (match-relative) of every enemy deathRecord. */
    enemyDeathS: number[];
    /** The bracket's reference cell, or null when the bracket has no cell,
     * misses the n floor, or fails the min-contrast door — null silences
     * the type for the whole round (the resurrection's bracket gate). */
    ref: SyncWindowPriorRef | null;
  },
  // Calibration-only override, same rationale as cdHoardedEvents' — defaults
  // to the module constant, production call sites unaffected.
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? MISSED_SYNC_WINDOW_CAP;
  const ref = probes.ref;
  if (ref === null || !syncRefClearsMinContrast(ref)) return [];
  const candidates: Array<{
    w: (typeof ccWindows)[number];
    ready: string[];
    minHp: number | null;
  }> = [];
  for (const w of ccWindows) {
    const t = toRenderSecond(w.fromSeconds);
    if (t < SYNC_WINDOW_MIN_T_S) continue;
    if (toRenderSecond(w.toSeconds) - t < SYNC_WINDOW_MIN_DUR_S) continue;
    if (
      probes.enemyDeathS.some(
        (d) => d >= w.fromSeconds && d <= w.toSeconds,
      )
    )
      continue;
    const ready = offensiveCds
      .filter((cd) => cdAvailableAt(cd, w.fromSeconds))
      .map((cd) => cd.spellName);
    if (ready.length === 0) continue;
    const castDuring = offensiveCds.some((cd) =>
      cd.casts.some(
        (c) =>
          c.timeSeconds >= w.fromSeconds - SYNC_ENTER_LEAD_S &&
          c.timeSeconds <= w.toSeconds,
      ),
    );
    if (castDuring) continue;
    candidates.push({
      w,
      ready,
      // B8: this value only ever feeds `facts` below — it is read AFTER the
      // ready/castDuring gates above have already decided emission.
      minHp: probes.enemyMinHpPctAt(w.fromSeconds, w.toSeconds),
    });
  }
  return candidates
    .sort(
      (a, b) =>
        renderedWindowSeconds(b.w.fromSeconds, b.w.toSeconds) -
        renderedWindowSeconds(a.w.fromSeconds, a.w.toSeconds),
    )
    .slice(0, cap)
    .map(({ w, ready, minHp }) => {
      const t = toRenderSecond(w.fromSeconds);
      const windowEndT = toRenderSecond(w.toSeconds);
      return {
        // spellId disambiguates two CC windows on the same healer that floor
        // to the same rendered second (review fix round 2, 2026-08-15) — the
        // menu id is the eventIds reference key, so a collision here corrupts
        // adoption attribution, not just cosmetics.
        id: `missed-sync-window:${w.healerName}:${w.spellId}:${t}`,
        type: "missed-sync-window",
        t,
        unitNames: [w.healerName],
        spell: w.spellName,
        spellId: w.spellId,
        facts: {
          t: String(t),
          windowEndT: String(windowEndT),
          healer: w.healerName,
          cc: w.spellName,
          // Render-grid anchoring (CLAUDE.md 门规谓词即规范): derived from the
          // ALREADY-floored t/windowEndT, not the raw fractional seconds.
          durationS: String(windowEndT - t),
          readyCds: ready.join("、"),
          ...(minHp !== null ? { enemyMinHpPct: fmt(minHp) } : {}),
          // Corpus reference (syncWindowPrior.ts) — the gate
          // (checkSyncWindowRefConsistency) redoes the lookup from cellKey
          // and re-checks every one of these numbers plus the door.
          refN: String(ref.nEntered + ref.nUnentered),
          refKillEntered: String(ref.killEnteredPct),
          refKillUnentered: String(ref.killUnenteredPct),
          cellKey: ref.cellKey,
        },
      };
    });
}

/** Per-match cap for unsynced-burst. <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed at 2, unchanged — same full-corpus scan as
 * `MISSED_SYNC_WINDOW_CAP` above, this type's own definition equally fixed
 * before Task 5 (no HP gate, complements `unconverted-burst` deliberately).
 * 场均条数(capped) 1.17 (raw pre-cap 1.98), inside the 0.5–2 band; 发生率
 * 69.5%, same "already-locked definition, not a Task 5 lever" caveat as
 * MISSED_SYNC_WINDOW_CAP's doc comment. 双向误差注: same shape as that
 * constant's — a lower cap drops real independent unsynced presses from an
 * already-firing round; a higher cap lets one round's raw ~2 average
 * dominate the menu further. */
const UNSYNCED_BURST_CAP = 2; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>;at-cap 体检 2026-08-26:223/393(57%)—— 承重,ba31cd05 摘 105 条净减 66 即此 cap 回填所致

/**
 * unsynced-burst (P1 起爆-2, 2026-08-15, user-ruled definition): a friendly
 * offensive major cooldown was cast whose effect window contained ZERO hard
 * CC on the enemy healer — the burst went out with the enemy healer free to
 * answer it. Complements the existing `unconverted-burst` (an OUTCOME fact:
 * the target didn't die) — this type is CAUSE-level (no sync happened at
 * all) and is deliberately NOT deduped against it: the same cast can produce
 * both candidates (their `id`s/eventIds are independent) because "didn't
 * convert" and "wasn't synced" are two different coaching facts about the
 * same button press.
 *
 * Effect window: `burstCastSpan` — the exact predicate the burst ledger
 * already uses for "how long is this CD's effect active", built from
 * `spellEffectData[spellId].durationSeconds` with a documented fallback
 * (`MIN_BURST_SPAN_S` = `BURST_CLUSTER_SECONDS`, enemyCDs.ts/burstLedger.ts's
 * own established default for a CD whose buff duration is unknown/instant) —
 * reused here rather than inventing a second duration-with-fallback rule.
 *
 * Severity/cap: sorted by the cooldown's own length (`cooldownSeconds`
 * descending) — the biggest-cooldown CDs are the highest-value presses to
 * burn unsynced (a 30s CD misfiring is routine; a 3-minute CD misfiring is
 * not), ties broken chronologically (stable sort). Capped per the constant's
 * doc comment above.
 *
 * `healerNames` (§29b fix, 2026-08-15): the "no hard CC overlapped this
 * cast" gate below reads `ccWindows`, which `enemyHealerCcWindows` already
 * pools across EVERY enemy healer (its `Pick<..., "fromSeconds" |
 * "toSeconds">` signature drops which healer each window belongs to on
 * purpose — this function only ever asks "was ANY enemy healer locked
 * during this span"). A pass (no window overlaps) therefore proves ALL
 * enemy healers were free, not just one — so the fact must name the full
 * set, not `enemies.find(...)`'s first match. Before this fix the wiring
 * call site passed only the first enemy healer's name, which in a
 * dual-healer comp could point at a healer who was never the one actually
 * free to answer (or omit a second healer who also was) — see BACKLOG
 * §29(b). `healerNames.length === 0` (no enemy healer on the roster) still
 * returns [] — same "no object to talk sync about" rationale the previous
 * single-name null check had.
 */
export function unsyncedBurstEvents(
  casts: Array<{
    ownerName: string;
    spellId: string;
    spellName: string;
    castTimeSeconds: number;
    cooldownSeconds: number;
  }>,
  ccWindows: Pick<IEnemyHealerCcWindow, "fromSeconds" | "toSeconds">[],
  healerNames: string[],
  /** Feasibility gate (2026-08-22 corpus adjudication): did the TEAM have any
   * hard CC off cooldown when this cooldown went out? The advice is "line the
   * cooldown up with CC on their healer next time", which is not advice if the
   * CC was down — you cannot spend a resource you do not have. */
  teamCcReadyAt: (tSeconds: number) => boolean,
  // Calibration-only override, same rationale as cdHoardedEvents' — defaults
  // to the module constant, production call sites unaffected.
  overrides?: { cap?: number },
): CandidateEvent[] {
  if (healerNames.length === 0) return [];
  const cap = overrides?.cap ?? UNSYNCED_BURST_CAP;
  const candidates: Array<{
    cast: (typeof casts)[number];
    windowEndT: number;
  }> = [];
  for (const cast of casts) {
    const span = burstCastSpan({
      spellId: cast.spellId,
      spellName: cast.spellName,
      castTimeSeconds: cast.castTimeSeconds,
      cooldownSeconds: cast.cooldownSeconds,
      availableAgainAtSeconds: cast.castTimeSeconds + cast.cooldownSeconds,
      buffEndSeconds:
        cast.castTimeSeconds +
        (spellEffectData[cast.spellId]?.durationSeconds ?? 0),
    });
    // 2026-08-23 用户裁定「重复吧」:这条指控印的是「**你的**爆发 CD 出去时对面
    // 治疗没被控」,而一个**给出去的** buff 不是施法者自己的爆发 —— 能量灌注是牧师
    // 按在法师身上让**法师**爆发的,法师那一下已经被单独指控过一次,把它同时记在
    // 牧师头上就是同一次爆发数两遍。实测(S2 归档 120 文件、治疗视角 375 条指控):
    // 能量灌注 66 条,其中与另一条 ±3s 同窗的 8 条。
    // 同一把尺子顺带兜住三个**根本不是爆发**的:黑暗 196718(40% 团减)、猛虎之志
    // 116841(给队友的解控/加速)、恢复萨的升腾 114052 —— 它们只是被打了 Offensive
    // 牌子才混进 teamOffensiveCds,「你的黑暗没和控制对齐」不是一句能成立的话。
    // 元素/增强萨的升腾(114050/114051)不够得着队友,照旧留在指控范围内。
    if (reachesAlly(cast.spellId)) continue;
    const hasHardCc = ccWindows.some(
      (w) => w.fromSeconds < span.to && w.toSeconds > span.from,
    );
    if (hasHardCc) continue;
    // 2026-08-22, ~278 sampled instances of the 12.1 archive: in **0%** of them
    // had the team failed to CC the enemy healer at all that round — every
    // accused team did sync elsewhere (median 13-18s away), so "you don't line
    // burst up with CC" was never the actual failure. The type fired on 66-70%
    // of all offensive cooldowns with a flat skill gradient (-0.1pp), i.e. it
    // was describing normal play: CC and burst cooldowns run independently and
    // cannot always overlap. Only accuse when a hard CC was actually ready.
    if (!teamCcReadyAt(cast.castTimeSeconds)) continue;
    candidates.push({ cast, windowEndT: toRenderSecond(span.to) });
  }
  return candidates
    .sort(
      (a, b) =>
        b.cast.cooldownSeconds - a.cast.cooldownSeconds ||
        a.cast.castTimeSeconds - b.cast.castTimeSeconds,
    )
    .slice(0, cap)
    .map(({ cast, windowEndT }) => {
      const t = toRenderSecond(cast.castTimeSeconds);
      return {
        id: `unsynced-burst:${cast.ownerName}:${cast.spellId}:${t}`,
        type: "unsynced-burst",
        t,
        unitNames: [cast.ownerName, ...healerNames],
        spell: cast.spellName,
        spellId: cast.spellId,
        facts: {
          t: String(t),
          windowEndT: String(windowEndT),
          owner: cast.ownerName,
          spell: cast.spellName,
          // §29b fix: the gate proves ALL enemy healers were free (see the
          // function doc comment), so the fact names the full set — same
          // "、"-joined convention missedSyncWindowEvents' readyCds uses,
          // not an arbitrary first match.
          healer: healerNames.join("、"),
        },
      };
    });
}

/** cd-hoarded: the own-team HP floor a hoarded window's worst moment must
 * have crossed to count as a "crisis" happened during the hoard, not just
 * "someone took a scratch". Deliberately a separate number/constant from
 * `CD_WASTE_PRESSURE_HP_PCT` — that gate asks "was the WHOLE ROUND
 * pressured", this one asks "was THIS SPECIFIC hoarded window a crisis" —
 * same shape as the cd-waste/cd-hoarded split documented on
 * `THREAT_LEVEL_LOW_MIN_HP_PCT` in threatAssessment.ts. <标定定稿 2026-08-15,
 * 报告 p1p2-calibration.md>: lowered from the 45% placeholder to 35%.
 * 双向误差注: a higher bar (45%, the placeholder) admits moderate-pressure
 * dips that are not really a "crisis"; a bar below 35% (untested) would
 * start excluding real near-death windows that bottomed out in the
 * high-20s/low-30s rather than under 35.
 *
 * NOT cd-hoarded's own gate any more (2026-08-30, GH #34 decision-point
 * rewrite): `cdHoardedEvents` below now keys its crisis moment on
 * `crisisDecisionPoints`' own `CRISIS_HP_PCT` (40%, crisisDecisionPoints.ts)
 * — the same predicate `crisis-no-response` uses, so "was there a crisis"
 * is one shared fact instead of two competing HP floors. This constant is
 * kept, exported, and UNCHANGED for its one remaining consumer:
 * `mdCycloneWindowEvents` (candidates/massDispel.ts), which still gates on
 * `friendlyCrisisMomentInWindow` + this 35% floor for its own, unrelated
 * four-gate criterion (GH #25). Do not fold the two back together — they
 * are independently calibrated for different candidate types that happen to
 * share a number by coincidence, not by predicate. */
export const CD_HOARD_CRISIS_HP_PCT = 35; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>; consumer since 2026-08-30 is md-cyclone-window only

/** Per-match cap for cd-hoarded. Carried forward from the retired
 * window-shaped predicate's <标定定稿 2026-08-15,报告 p1p2-calibration.md>
 * (kept at 2 to match every other per-round-capped type in this file) — the
 * 2026-08-30 decision-point rewrite (GH #34) changes WHAT fires, not the
 * shipping cap, and has not itself been re-swept against a fresh corpus
 * (docs/BACKLOG.md #34 tracks that follow-up). at-cap 体检 2026-08-26
 * (pre-rewrite): 302/482 有产出回合打到上限(63%)。 */
const CD_HOARD_CAP = 2;

/** cd-hoarded's own "was the ready cooldown actually pressed" window
 * (2026-08-30 decision-point rewrite, GH #34; 3,000-match outcome probe
 * "cd-hoarded", eval-private/reports/signal-outcomes-2026-08-30/report.md):
 * a press landing up to `RESPONSE_PRE_MS` (crisisDecisionPoints.ts, the same
 * "a response landed just before the sampled crossing still counts"
 * convention) BEFORE the crossing still counts as answering it, through
 * this many seconds AFTER. This is cd-hoarded's own, corpus-measured number
 * — deliberately not crisisDecisionPoints' 3s `RESPONSE_WINDOW_MS` (a
 * different question: "did the crisis unit do ANYTHING" vs. "did the OWNER
 * spend THIS specific ready cooldown"). */
export const CD_HOARD_RESPONSE_S = 5;

/**
 * Corpus-derived outcome reference for cd-hoarded (2026-08-30, GH #34):
 * 3,000-match outcome probe "cd-hoarded"
 * (eval-private/reports/signal-outcomes-2026-08-30/report.md). Decision
 * point = every friendly crisis (`crisisDecisionPoints` on the owner for
 * their own crises, and on each teammate as owner for theirs; HP crossed
 * <=40%, 5s merge — `CRISIS_HP_PCT`/`CRISIS_WINDOW_GAP_MS`,
 * crisisDecisionPoints.ts) at which the owner had >=1 usable major
 * Defensive cooldown ready (a personal wall or a self-castable external for
 * the owner's own crisis; any cooldown `canHelpAnotherUnit` says can reach
 * the crisis unit for a teammate's). Across 16,960 such decision points,
 * the crisis unit died within 10s **4.5%** of the time when a ready
 * cooldown was spent within `CD_HOARD_RESPONSE_S` vs **11.4%** when every
 * ready cooldown was held (share acted 29%; 3v3 5.2% vs 22.2%; own-crisis
 * 4.0% vs 16.8%; teammate-crisis 4.7% vs 10.5%).
 *
 * Descriptive, never causal — the legend (buildFindingsPrompt.ts) says so
 * explicitly and the reference does not identify WHICH cooldown mattered.
 * Corpus-derived, not typed in from intuition; a table-based refresh (the
 * same shape as `data/behaviorPriorGenerated.json`) is the follow-up, not
 * yet built — until then this is a fixed constant block, not a per-cell
 * lookup keyed on bracket/role/damage the way that table is.
 */
export const CD_HOARDED_OUTCOME_REF = {
  refDeathSpent: "4.5",
  refDeathHeld: "11.4",
  refN: "16960",
} as const;

/** One crisis-decision-point SOURCE cd-hoarded scans: the unit in crisis
 * (the owner or a named teammate), whether it is the OWNER's own crisis,
 * and that unit's full (UNFILTERED) `crisisDecisionPoints` output —
 * `cdHoardedEvents` applies its own `dangerous && !inCC` filter itself (see
 * its doc comment for why not the fuller `feasible` flag: gate 4,
 * death-in-window, must NOT exclude a crisis unit who died inside the
 * window — a crisis unit who died within the response window is exactly
 * the shape this type exists to catch). Only the seven fields the predicate
 * actually reads are required, not the whole `DecisionPoint` shape, so a
 * caller/test never has to hand-build the entire interface. */
export interface ICdHoardedCrisisSource {
  crisisUnit: { id: string; name: string };
  /** true when crisisUnit IS the cd-hoarded owner (their own crisis). */
  own: boolean;
  points: Pick<
    DecisionPoint,
    | "tSec"
    | "hpPct"
    | "dmg2s"
    | "attackers2s"
    | "enemyBurst"
    | "inCC"
    | "dangerous"
  >[];
}

/** The shape `cdHoardedEvents` needs from each of the owner's cooldowns —
 * `tag` required (the base gate hard-requires `=== "Defensive"`, unlike the
 * retired predicate's optional hint-only tag). */
type CdHoardCandidateCd = Pick<
  IMajorCooldownInfo,
  "spellId" | "spellName" | "casts" | "cooldownSeconds" | "neverUsed" | "tag"
> &
  Partial<Pick<IMajorCooldownInfo, "isThroughput" | "charges">>;

/** The shape `isSpendableDefensiveCd` / `readyDefensiveCds` read. Exported
 * so the cohort-prior engine (`analysis/cdTriggerPrior.ts`) can type its
 * input against the same pick rather than re-listing the fields. */
export type SpendableDefensiveCd = CdHoardCandidateCd;

/**
 * "Is this one of the owner's SAVE cooldowns at all" — the time-independent
 * half of `readyDefensiveCds`'s gate: Defensive-tagged, not a throughput CD,
 * and something the player can actually press (not a proc). Exported
 * (2026-09-04, GH #54 (f) / BACKLOG #38 (a)) so the `[CD PRIOR]` cohort
 * engine and its corpus scan count exactly the cooldowns `cd-hoarded` would
 * accuse over — one roster, both consumers (CLAUDE.md shared-predicate rule);
 * `readyDefensiveCds` below is now written through it.
 */
export function isSpendableDefensiveCd(
  cd: Pick<SpendableDefensiveCd, "spellId" | "tag" | "isThroughput">,
): boolean {
  return (
    cd.tag === "Defensive" &&
    !cd.isThroughput &&
    !isProcOnlyActivation(cd.spellId)
  );
}

/** Base "can this Defensive CD be pressed at all right now" gate — the part
 * of the readiness predicate that does NOT depend on whose crisis this is;
 * `helps` layers the own-crisis-vs-teammate-crisis distinction on top. */
function readyDefensiveCds(
  cds: CdHoardCandidateCd[],
  tSec: number,
  helps: (cd: CdHoardCandidateCd) => boolean,
): CdHoardCandidateCd[] {
  return cds.filter(
    (cd) => isSpendableDefensiveCd(cd) && cdAvailableAt(cd, tSec) && helps(cd),
  );
}

/**
 * cd-hoarded (2026-08-30 rewrite, GH #34, decision-point shaped): "a
 * teammate (or you) hit a crisis while you had a usable major defensive CD
 * ready and you did not spend it within `CD_HOARD_RESPONSE_S`". Replaces
 * the retired `availableWindows`-shaped predicate ("a CD sat ready >=45s
 * while a friendly crossed <35%"), whose own intent-guard measurement found
 * 35.6% of its accusations wrong (the player DID press) — this version
 * anchors on the same `crisisDecisionPoints` moment `crisis-no-response`
 * already uses, so "was there a crisis" is one shared predicate instead of
 * a second HP-floor gate invented just for this type.
 *
 * Scope narrows on purpose versus the retired predicate: only
 * Defensive-tagged, non-throughput cooldowns count now (`readyDefensiveCds`'s
 * base gate) — the old version could cite ANY major CD, offensive or
 * defensive (Avenging Wrath was its own flagship example). The 3,000-match
 * outcome probe behind `CD_HOARDED_OUTCOME_REF` was run against this
 * narrower, Defensive-only shape, so widening back out would attach the
 * reference numbers to a candidate they were never measured against.
 *
 * `own` decides which help-gate applies at each source's points (GH #28's
 * lesson, carried into the rewrite): for the OWNER's own crisis, a
 * cooldown only counts if it is not a confirmed self-cast no-op
 * (`!SELF_CAST_NOOP_EXTERNAL_IDS.has`, e.g. Blessing of Sacrifice's
 * damage-redirect is a mechanical no-op when self-targeted) — the same
 * "does this help ME" predicate `findCheaperDefensiveAlternatives`
 * (cooldowns.ts) already uses in its own self-cast-context branch, reused
 * rather than re-derived from a curated membership list (a `bigDefensive
 * SpellIds`/`externalDefensiveSpellIds` membership check would silently
 * reject a real self-wall the two lists haven't caught up with yet — e.g.
 * Ultimate Penitence, a runtime-injected pure self-absorb that is in
 * NEITHER list; caught while writing `cdHoardedSelfOnly.test.ts`, see
 * CLAUDE.md's Curated-List Completeness Rule). For a TEAMMATE's crisis, a
 * cooldown only counts if `canHelpAnotherUnit` says it can reach somebody
 * other than the owner — the exact guard `cdHoardedSelfOnly.test.ts` exists
 * to pin (a self-only heal like Desperate Prayer can never answer a
 * teammate's crisis).
 *
 * "Spent" is a press of any READY cooldown (not just the first one found)
 * inside `[tSec - RESPONSE_PRE_MS/1000, tSec + CD_HOARD_RESPONSE_S]` — a
 * press landing just before the sampled crossing still counts, the same
 * convention `crisisDecisionPoints`' own response window uses.
 *
 * Severity/cap: sorted by the SAME danger order `crisisNoResponseEvents`
 * uses (enemyBurst, then attackers2s, then dmg2s — NEVER by outcome; this
 * function must not read `diedWithin10s`/`friendDiedWithin15s`, and
 * `ICdHoardedCrisisSource.points` is typed narrowly enough that it cannot),
 * capped at `CD_HOARD_CAP`, then re-sorted chronologically for display
 * (every sibling producer in `candidates/` reports in time order regardless
 * of how it selected the capped set — see `crisisNoResponseEvents`'s own
 * 2026-08-29 ruling).
 */
export function cdHoardedEvents(
  sources: ICdHoardedCrisisSource[],
  ownerCds: CdHoardCandidateCd[],
  owner: { id: string; name: string },
  overrides?: { cap?: number },
  /** Intent guard (BACKLOG #26 Task 2), unchanged in spirit from the
   * retired predicate: a CAST_FAILED hit on any READY cooldown inside the
   * same response window downgrades "hoarded" to "attempted but rejected"
   * (see `facts.attempted` and auditFindings.ts's matching severity
   * downgrade). */
  rawStreams?: RawStreams,
  /** #29 (2026-08-17): the owner's own successful-cast instants (seconds),
   * consumed only by `filterIntentGuardEvidence`'s gcd-locked exclusion —
   * same convention as every other guard-carrying builder in this file. */
  ownCastSuccessSeconds?: number[],
): CandidateEvent[] {
  const cap = overrides?.cap ?? CD_HOARD_CAP;
  const candidates: Array<{
    crisisUnit: { id: string; name: string };
    own: boolean;
    point: ICdHoardedCrisisSource["points"][number];
    ready: CdHoardCandidateCd[];
  }> = [];
  for (const src of sources) {
    for (const p of src.points) {
      // "only dangerous && !inCC points" (spec 2026-08-30): dangerous is
      // gate 5 (a real damage floor), inCC is gate 1 — both describe the
      // CRISIS UNIT's own state. Deliberately NOT `p.feasible` (which also
      // requires !diedInWindow and hasTool): a crisis unit who died within
      // the response window is exactly the case this type exists to catch,
      // and `hasTool` answers a different question (could the crisis unit
      // help THEMSELF) than the one this predicate asks (did the OWNER have
      // a ready cooldown for THEM).
      if (!p.dangerous || p.inCC) continue;
      const ready = readyDefensiveCds(ownerCds, p.tSec, (cd) =>
        src.own
          ? !SELF_CAST_NOOP_EXTERNAL_IDS.has(cd.spellId)
          : canHelpAnotherUnit(cd.spellId, cd.tag),
      );
      if (ready.length === 0) continue;
      const spent = ready.some((cd) =>
        cd.casts.some(
          (c) =>
            c.timeSeconds >= p.tSec - RESPONSE_PRE_MS / 1000 &&
            c.timeSeconds <= p.tSec + CD_HOARD_RESPONSE_S,
        ),
      );
      if (spent) continue;
      candidates.push({
        crisisUnit: src.crisisUnit,
        own: src.own,
        point: p,
        ready,
      });
    }
  }
  return candidates
    .sort(
      (a, b) =>
        Number(b.point.enemyBurst) - Number(a.point.enemyBurst) ||
        b.point.attackers2s - a.point.attackers2s ||
        b.point.dmg2s - a.point.dmg2s,
    )
    .slice(0, cap)
    .map(({ crisisUnit, own, point, ready }) => {
      const t = toRenderSecond(point.tSec);
      const windowFromS = point.tSec - RESPONSE_PRE_MS / 1000;
      const windowToS = point.tSec + CD_HOARD_RESPONSE_S;
      // Intent guard: any of the READY cooldowns' own spellIds with a
      // rejected cast inside the same response window — merged across every
      // ready cooldown (not just one), since the accusation now names up to
      // three (`facts.readyCds`), not a single spell.
      const failedHits = rawStreams
        ? ready.flatMap((cd) =>
            filterIntentGuardEvidence(
              castFailedInWindow(
                rawStreams,
                owner.id,
                windowFromS,
                windowToS,
                Number(cd.spellId),
              ),
              cd.casts.map((c) => c.timeSeconds),
              { ownCastSuccessSeconds },
            ),
          )
        : [];
      const attempted = formatAttemptedFact(failedHits);
      return {
        id: `cd-hoarded:${owner.id}:${crisisUnit.id}:${t}`,
        type: "cd-hoarded",
        t,
        unitNames: [owner.name, crisisUnit.name],
        // Presentation only (types.ts: "for a multi-spell event only the
        // first is taken") — `facts.readyCds` carries the full list.
        spell: ready[0]?.spellName,
        spellId: ready[0]?.spellId,
        facts: {
          t: String(t),
          crisisUnit: crisisUnit.name,
          crisisHpPct: String(point.hpPct),
          dmg2sPct: String(Math.round(point.dmg2s * 100)),
          readyCds: ready
            .slice(0, 3)
            .map((cd) => cd.spellName)
            .join("; "),
          own: own ? "yes" : "no",
          ...CD_HOARDED_OUTCOME_REF,
          ...(attempted ? { attempted } : {}),
        },
      };
    })
    .sort((a, b) => a.t - b.t);
}

/** A single citable "crisis moment" inside a window: the worst HP% any
 * friendly reached, which friendly it was, and the rendered second it
 * happened on — cd-hoarded's fact needs a point to cite ("ally at 34% at
 * 6:30"), not just a floor value. */
export interface ICrisisMoment {
  t: number;
  unitName: string;
  hpPct: number;
}

/**
 * Worst HP% any friendly reached inside [fromSeconds, toSeconds], render-grid
 * sampled at every rendered second — same scan shape as `enemyMinHpPctInWindow`
 * (Task 2), mirrored onto the owner's own team and extended to carry back
 * WHICH unit and WHICH render second produced the worst reading (cd-hoarded's
 * crisis fact needs a citable moment, not just a number). Render-grid
 * discipline (CLAUDE.md): the caller must pass already-`toRenderSecond`-floored
 * `fromSeconds`/`toSeconds` (cd-hoarded's own `readyT`/`castT`) so the scanned
 * range can never disagree with the window shown in facts; this function
 * floors again defensively but that must be a no-op on an already-floored
 * input, never load-bearing. Returns null only when NO sample anywhere in the
 * window succeeded (no advanced logging) — the caller must treat null as
 * "cannot confirm a crisis happened", never as "0%".
 */
export function friendlyCrisisMomentInWindow(
  friends: any[],
  combat: { startTime: number },
  fromSeconds: number,
  toSeconds: number,
  hpLookup: (
    unit: any,
    timestampMs: number,
    maxDtMs: number,
  ) => number | null = getUnitHpAtTimestamp,
  /** GH #28: restrict the scan to ONE unit. md-cyclone-window (the sole
   *  production caller since the 2026-08-30 cd-hoarded rewrite — see
   *  `CD_HOARD_CRISIS_HP_PCT`'s doc comment) passes this when a hoarded
   *  cooldown cannot help anybody else, so a teammate's dip can never become
   *  the crisis that a self-only tool is accused of ignoring. Absent = scan
   *  every friendly, the behaviour every other caller keeps. */
  onlyUnitName?: string,
): ICrisisMoment | null {
  const fromR = toRenderSecond(fromSeconds);
  const toR = toRenderSecond(toSeconds);
  const scanned =
    onlyUnitName === undefined
      ? friends
      : friends.filter((f) => f.name === onlyUnitName);
  let worst: ICrisisMoment | null = null;
  for (let t = fromR; t <= toR; t++) {
    for (const f of scanned) {
      const hp = hpLookup(f, combat.startTime + t * 1000, HP_SAMPLE_RADIUS_MS);
      if (hp === null) continue;
      if (worst === null || hp < worst.hpPct) {
        worst = { t, unitName: f.name, hpPct: hp };
      }
    }
  }
  return worst;
}

/** Per-match cap for cd-spent-idle. <标定定稿 2026-08-15,报告
 * p1p2-calibration.md>: confirmed at 2, unchanged — full-corpus scan
 * measured 场均条数(capped) only 0.14 (raw 0.15, essentially uncapped —
 * B6's red line already does almost all the limiting: 35.1% of rounds are
 * "low" threat and return `[]` before any cast is even probed), 发生率 just
 * 11.9%, the lowest of the four new types and well under every precedent.
 * 双向误差注: a lower cap has essentially no effect (raw already sits at
 * 0.15, nowhere near 2); a higher cap likewise has no effect for the same
 * reason — this type's volume is governed by the B6 threat gate, not by
 * this cap, so there is no evidence for moving it off the shared
 * per-round-cap default. */
const CD_SPENT_IDLE_CAP = 2; // <标定定稿 2026-08-15,报告 p1p2-calibration.md>;at-cap 体检 2026-08-26:21/83(25%)

/**
 * cd-spent-idle (P2 起爆-2, 2026-08-15, deep-dive-derived definition): a
 * defensive/survival major cooldown was cast at a moment with no active
 * enemy threat (圣佑/Blessing-of-Sanctuary blind-cast shape: pressing a
 * survival tool into dead air instead of holding it for the next real
 * window).
 *
 * "Defensive/survival CD" identification follows the exact filter this
 * file's own `slowDefensiveResponseEvents` wiring already uses in
 * `teamPlayEvents` (`DEFENSIVE_TAGS.has(cd.tag) && !cd.isThroughput` —
 * `DEFENSIVE_TAGS` = Defensive ∪ External spell tags, cooldowns.ts) rather
 * than inventing a second definition of "defensive".
 *
 * Threat gate is `threatAssessment.ts`'s single-source predicates, consumed
 * (never re-implemented) via injected probes:
 *  - per-cast gate: `probes.threatActiveAt(t)` false at the (render-floored)
 *    cast instant → candidate; true → no candidate.
 *  - **Red line B6** (non-negotiable, user-ruled): if `matchThreat` — the
 *    caller's already-computed `matchThreatLevel(...)` for the whole match —
 *    is `"low"`, this function returns `[]` before even looking at any cast,
 *    and `probes.threatActiveAt` is never invoked (pinned by a dedicated
 *    spy test: in a low-threat match, using CDs on cooldown is correct play,
 *    not a coaching point).
 *
 * Render-grid anchoring (CLAUDE.md): the cast instant is floored via
 * `toRenderSecond` BEFORE it is used for the threat gate or written into
 * facts — the same instant must decide both, or the fact could disagree
 * with the gate that produced it.
 *
 * Cost-norm guard (#25 precedent, same as `cdHoardedEvents` above): a
 * cost_norm ability spent into a lull still carries `costNorm` in facts so
 * the prompt can explain the "last resort only" caveat rather than reading
 * as a routine "you cast into nothing" callout.
 *
 * Severity/cap: sorted chronologically (earliest idle spend first — no
 * damage-value data is wired in here, mirroring `unsyncedBurstEvents`'
 * documented no-new-CD-logic constraint), capped at `CD_SPENT_IDLE_CAP`
 * (see that constant's own doc comment for the 2026-08-15 corpus
 * calibration).
 */
export function cdSpentIdleEvents(
  cds: Pick<
    IMajorCooldownInfo,
    "spellId" | "spellName" | "tag" | "isThroughput" | "casts"
  >[],
  owner: { id: string; name: string },
  matchThreat: MatchThreatLevel,
  probes: {
    /** Wired to threatAssessment.ts's threatActiveAt in production. */
    threatActiveAt: (tSeconds: number) => boolean;
  },
  // Calibration-only override, same rationale as cdHoardedEvents' — defaults
  // to the module constant, production call sites unaffected.
  overrides?: { cap?: number },
): CandidateEvent[] {
  if (matchThreat === "low") return []; // B6 red line — never even probes.
  const cap = overrides?.cap ?? CD_SPENT_IDLE_CAP;
  // GH #29 阶段 2b:这条指控是「你把**保命大 CD** 按在了没威胁的空气里」。
  // `!isThroughput` 只等于「不是 Offensive-tagged」,挡不住那些挂着 Defensive
  // 牌子、实为**治疗产出强化**的 CD —— 而产出 CD 本来就该在安全窗口 pump,
  // 那是正确操作,不是浪费。签字册 kind `throughput_role` 就是这一维的单源
  // (用户 2026-08-22 裁定:神圣显灵是治疗大技能;复仇十字军随专精,奶骑是
  // 主要治疗)。250 场 / 312 治疗轮实测:cd-spent-idle 46 → 43,去掉的 3 条
  // 全是复仇十字军;光环大师那 5 条**保留**(用户同日裁定 20% 全团减伤,
  // 已进 MITIGATION_OVERRIDES,它是真墙)。
  const defensiveCds = cds.filter(
    (cd) =>
      DEFENSIVE_TAGS.has(cd.tag) &&
      !cd.isThroughput &&
      // 空放/攥着不放都是「你当时的选择」,被动触发的能力没有这个选择。
      !isProcOnlyActivation(cd.spellId) &&
      !THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(cd.spellId),
  );
  const candidates: Array<{ cd: (typeof cds)[number]; t: number }> = [];
  for (const cd of defensiveCds) {
    for (const cast of cd.casts) {
      const t = toRenderSecond(cast.timeSeconds);
      if (probes.threatActiveAt(t)) continue;
      candidates.push({ cd, t });
    }
  }
  return candidates
    .sort((a, b) => a.t - b.t)
    .slice(0, cap)
    .map(({ cd, t }) => {
      const costNorm = costNormPhrase(cd.spellId);
      return {
        id: `cd-spent-idle:${owner.id}:${cd.spellId}:${t}`,
        type: "cd-spent-idle",
        t,
        unitNames: [owner.name],
        spell: cd.spellName,
        spellId: cd.spellId,
        facts: {
          t: String(t),
          spell: cd.spellName,
          unit: owner.name,
          ...(costNorm ? { costNorm } : {}),
        },
      };
    });
}
