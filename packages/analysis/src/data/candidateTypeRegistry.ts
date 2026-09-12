/**
 * CANDIDATE TYPE REGISTRY — the one table every "is this candidate type live?"
 * consumer derives from (GH #76, user ruling 2026-09-12 「我同意」).
 *
 * Before this file a type could be dead FIVE different ways and no single
 * place listed them: `CANDIDATE_TYPE_FLAGS` false · emitter kept but no longer
 * called from the assembly · emitter deleted with the legend kept ·
 * `BRACKET_TYPE_ALLOWLIST` · the desktop's `IGNORED_CANDIDATE_TYPES`. Four
 * independent code-reading counts of the live set came out 49 → 47 → 37 → 31,
 * each missing a different mechanism; the coach-corpus tooling read the
 * desktop ignore set as a retirement list and its negative control skipped
 * the corpus's most-fired type (GH #74). Resurrecting a double-killed type by
 * flipping one switch silently did nothing and looked like "no data".
 *
 * Two axes, deliberately separate (they were conflated in one set before):
 *
 *   `status`  — lifecycle. `live` reaches the LLM menu; `retired` has an
 *               emitter (flag-gated or simply not called) but is off;
 *               `deleted` has no emitter at all, only legend / deep-dive text.
 *   `surface` — where a LIVE type shows. `card` = renders as a desktop mistake
 *               card AND enters the menu; `menu-only` = enters the LLM prompt
 *               only, never a card (a product stance, each with its ruling).
 *
 * Derived here, imported everywhere (never hand-copied):
 *   `CANDIDATE_TYPE_FLAGS`     ← entries with a `flag` (status live ⇒ true)
 *   `MENU_ONLY_TYPES`          ← surface menu-only
 *   `RETIRED_TYPES`            ← status retired | deleted
 *   `CARD_TYPES`               ← the exact set the desktop's MISTAKE_RULES must
 *                                cover (live ∧ card, plus flag-retired ∧ card
 *                                so an A/B flag flip renders without a code
 *                                change) — tested equal in report.mistakes.test
 *   `BRACKET_TYPE_ALLOWLIST`   ← kept as a per-bracket list on purpose: a new
 *                                type is EXCLUDED from a restricted bracket by
 *                                default, which is the safe direction for the
 *                                GH #18 2v2 ruling (per-entry `brackets` would
 *                                silently admit anything unlabeled)
 *   `tools/coach-corpus/common.py` reads the same table through
 *   `scripts/printCandidateTypeRegistry.ts`.
 *
 * Wiring is NOT asserted here — `candidateTypeRegistry.test.ts` pins the
 * literal `type: "…"` presence per status, and the corpus scan
 * (`packages/eval/scripts/candidateDiagnostics.ts` → `scanCandidateIncidence`)
 * remains the observational truth of what actually fires.
 *
 * What a status change DOES and DOES NOT do (codex review 2026-09-12 — the
 * first draft of this paragraph over-promised):
 *
 *   - Entries with a `flag`: the status IS the switch. `retired` → the derived
 *     flag turns false and the assembly skips the emitter; `live` → it fires.
 *     Plus the MISTAKE_RULES row if `surface: "card"` (the desktop test names
 *     the missing / surplus row). Nothing else to touch.
 *   - Entries WITHOUT a `flag` (cd-waste, death, healing-gap, …): the status is
 *     a RECORD, not a switch. Their emitters are assembled unconditionally, so
 *     retiring one means also unwiring or deleting the emitter in
 *     candidateFindings.ts — and the tests here cannot prove you did (a
 *     `status: "retired"` row whose emitter still fires passes every test in
 *     candidateTypeRegistry.test.ts; only the corpus scan shows it). The
 *     reverse holds for `retired` unwired types (cc-locked, wasted-trinket):
 *     flipping to `live` reconnects nothing until the assembly calls the
 *     producer again.
 *   - `deleted` is enforced: the test fails if a `type: "…"` literal is still
 *     produced anywhere a CandidateEvent is built.
 */

export type CandidateTypeStatus = "live" | "retired" | "deleted";
export type CandidateTypeSurface = "card" | "menu-only";
export type CandidateTypeOrigin = "candidate" | "desktop";
export type BracketKey = "2v2" | "3v3" | "solo";

/** The exhaustive flag-key list. The type is derived from it so the test can
 * check "every key has a registry entry" against a runtime value rather than
 * against another registry-derived object (codex review 2026-09-12). */
export const CANDIDATE_TYPE_FLAG_KEYS = [
  "missedSyncWindow",
  "unsyncedBurst",
  "cdHoarded",
  "cdSpentIdle",
  "attemptIntoTrinket",
  "mdCycloneWindow",
  "missedPurge",
  "ccHeld",
  "killReview",
  "backlashDispel",
  "kickPriority",
] as const;
export type CandidateTypeFlagKey = (typeof CANDIDATE_TYPE_FLAG_KEYS)[number];

export interface CandidateTypeEntry {
  status: CandidateTypeStatus;
  surface: CandidateTypeSurface;
  /** `candidate` = emitted by packages/analysis (candidateFindings.ts /
   * candidates/*.ts); `desktop` = a mistake row the renderer builds itself
   * from kickAudit / dispel summary (`MistakeRule.source` "kick" | "dispel"),
   * never a CandidateEvent. */
  origin: CandidateTypeOrigin;
  /** camelCase `CANDIDATE_TYPE_FLAGS` key that gates assembly; absent = the
   * emitter is assembled unconditionally when live. Several entries may share
   * one flag (backlash-dispel / -window); they must agree on status. */
  flag?: CandidateTypeFlagKey;
  /** True for a registry row that is not a `type: "…"` string of its own
   * (kill-review is the side=enemy half of `death`, gated by its flag). */
  virtual?: true;
  /** ISO date of the last status change. */
  since: string;
  /** Where the ruling lives (GH issue / BACKLOG item / A/B report). */
  issue: string;
  /** One line a reader can act on; the numbers stay here, not in a comment. */
  reason: string;
}

export const CANDIDATE_TYPE_REGISTRY: Readonly<
  Record<string, CandidateTypeEntry>
> = {
  // ─── live, card ──────────────────────────────────────────────────────────
  "attempt-into-trinket": {
    status: "live",
    surface: "card",
    origin: "candidate",
    flag: "attemptIntoTrinket",
    since: "2026-08-18",
    issue: "GH #16",
    reason:
      "击杀尝试重设计:打在有徽章目标上的失败尝试、且同刻存在 prime 目标(utils/killAttempts.ts)。用户当日拍板接线,三档模型 8,791 次晕落地验证在前 —— 判据本身即当日验证产物。",
  },
  "burst-into-mitigation": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-08-11",
    issue: "c277ca81 (BACKLOG #18 batch 2)",
    reason:
      "Offensive cooldowns opened into an active mitigation. Silent on the healer-perspective library (GH #75) — needs the DPS-owner slice, not a fix.",
  },
  "cd-waste": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-07-12",
    issue: "e867e507 (phase-2 candidate menu)",
    reason:
      "A Defensive-tagged major cooldown never pressed all round while the owner's HP fell below CD_WASTE_PRESSURE_HP_PCT. Candidate diagnostics 2026-08-17: +10.1pp.",
  },
  "cd-hoarded": {
    status: "live",
    surface: "card",
    origin: "candidate",
    flag: "cdHoarded",
    since: "2026-08-30",
    issue: "GH #34 (rewrite) / GH #18 (2v2 survivor)",
    reason:
      "Crisis-decision-point shape with corpus outcome reference; +25.4pp on 2026-08-17 diagnostics, 9/9 concrete in the GH #18 blind labels. Only type besides missed-cleanse kept in 2v2.",
  },
  "missed-sync-window": {
    status: "live",
    surface: "card",
    origin: "candidate",
    flag: "missedSyncWindow",
    since: "2026-09-02",
    issue: "GH #13 (retired 2026-08-19, reversed 2026-09-02)",
    reason:
      "下架 2026-08-19:判别力 −4.4pp 的根因是机会分母混杂,归一化后转化率胜 26.7% vs 负 27.8% 持平。2026-09-02 用户裁决复活:正典进攻表替代 isThroughput、t>=30s/时长>=3s/窗内敌亡除外、按 bracket 语料参照 + >=3pp 最小对比门(syncWindowPrior.ts;单排 ~0.7pp 自动静音)。证据轴换成击杀转化(3v3 进窗 17.8% vs 7.6%)+ 分段行为梯度(pct>=90 23.0% vs pct<30 16.2%)。",
  },
  "crisis-no-response": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-08-29",
    issue: "GH #58 (successor of death-unused-defensive)",
    reason:
      "Healer v1: incoming ≥10 % watershed + outcome reference, no rating line. Replaces death-unused-defensive.",
  },
  "external-unused": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-07-30",
    issue: "BACKLOG #17a",
    reason:
      "An ally-castable external was ready while a teammate died. Death-premised ⇒ discrimination is circular (candidateDiagnostics header), kept as a fact-bearing candidate.",
  },
  "questionable-external": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-08-20",
    issue: "BACKLOG #17a / GH #16 severity audit",
    reason:
      "External spent in a no-pressure window (high HP ∧ no spike ∧ no burst alignment). 0.52 % cast-level incidence; severity average→minor 2026-08-20.",
  },
  "healing-gap": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-08-07",
    issue: "8cc944ff (候选菜单扩容第一批)",
    reason:
      "Owner healer idle on GCDs while a teammate's HP fell. Signal outcome probe 2026-08-30: looks at HP, not seconds — kept.",
  },
  "position-mistake": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-08-07",
    issue: "8cc944ff (positioning signal, deep-dive value round)",
    reason:
      "Positioning scan predicates shared with the eval gate (positioningScan.ts aliases). 4.00/5 blind score, zero filler.",
  },
  "cc-avoidable": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-08-29",
    issue: "GH #50 (feasibility gate)",
    reason:
      "Was accusing instant-cast CC 75 % of the time; feasibility gate (reactable cast) cut it −68 %. Kept.",
  },
  "slow-defensive-response": {
    status: "live",
    surface: "card",
    origin: "candidate",
    since: "2026-08-30",
    issue: "GH #34 (burst-window decision points)",
    reason:
      "Defensive pressed late inside an enemy burst window, with corpus reference numbers (checkBurstWindowRefConsistency gate).",
  },
  "backlash-dispel": {
    status: "live",
    surface: "card",
    origin: "candidate",
    flag: "backlashDispel",
    since: "2026-09-12",
    issue: "GH #80",
    reason:
      "User approval after the archive cost/benefit model (180k opportunities): UA dispel at ≤ 2 stacks / ≥ 60 % target HP nets ≈ −200k HP and +1.4 s unanswerable CC unless it co-removed a CC; VT net-negative at ≥ 80 % target HP. Validation (real-model smoke + acceptance capture) done 2026-09-12.",
  },
  "backlash-dispel-window": {
    status: "live",
    surface: "card",
    origin: "candidate",
    flag: "backlashDispel",
    since: "2026-09-12",
    issue: "GH #80",
    reason:
      "Same flag as backlash-dispel. Wired but table-guarded silent: the product predicate's three positive cells all carry negative HP accounts (−36/−36/−14k), only the death-rate favours dispelling (selection bias).",
  },
  "kick-priority-missed": {
    status: "live",
    surface: "card",
    origin: "candidate",
    flag: "kickPriority",
    since: "2026-09-12",
    issue: "GH #78 (+ #88 range half)",
    reason:
      "User rulings 1/2/3 (sentence useful / 50 % HP gate / team form with distance). Enemy healer heal on our ≤ 50 % kill target inside a kill window while the owner's interrupt (official per-player kit) was off cooldown, unlocked and in range (melee 20 yd corpus-calibrated, ranged official + LoS). Archive 21k files: kicked → target dead 10 s 36 % vs completed 13 % (+23 pp, every bracket +22…+24); ~16 % of such heals get kicked. Validated 2026-09-12 (real-model smoke ×2, acceptance capture).",
  },
  "kick-priority-team": {
    status: "live",
    surface: "card",
    origin: "candidate",
    flag: "kickPriority",
    since: "2026-09-12",
    issue: "GH #78",
    reason:
      "Same flag and reference as kick-priority-missed; fires only when the owner could NOT kick and a teammate could (same feasibility predicate, distance included). Legend forces call-out phrasing.",
  },
  // desktop-derived mistake rows: not CandidateEvents, but the desktop's
  // MISTAKE_RULES and the coach-corpus roster both need them in the same table.
  "missed-kick": {
    status: "live",
    surface: "card",
    origin: "desktop",
    since: "2026-07-23",
    issue: "c59ba8ce (backlog #8 mistake engine)",
    reason:
      'mistakes.ts builds it from utils/kickAudit.ts analyzeKickAudit result="missed": a pressed interrupt that hit air. Not "you should have kicked" (that is GH #78, untyped).',
  },
  "missed-purge-kill-window": {
    status: "live",
    surface: "card",
    origin: "desktop",
    since: "2026-08-20",
    issue: "GH #19 (severity major→average)",
    reason:
      "mistakes.ts builds it from reconstructDispelSummary.missedPurgeWindows × annotateMissedPurgesWithKillWindows. +2.6pp weak-positive, was 92 % of the major bucket.",
  },

  // ─── live, menu-only (product stance: the LLM coaches it, no card) ───────
  "kick-eaten": {
    status: "live",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-08-19",
    issue: "GH #14",
    reason:
      '"A thing that happened TO you" — coachable (fake-casting is discriminative: +6.8~+10.9pp win/loss gap) but not an assertion of a mistake. User ruling: the LLM coaches it, the mistake list does not show it, and both are correct. Most-fired type in the corpus (44.2 % of 400 rounds).',
  },
  "md-cyclone-window": {
    status: "live",
    surface: "menu-only",
    origin: "candidate",
    flag: "mdCycloneWindow",
    since: "2026-08-21",
    issue: "GH #25",
    reason:
      'MD 特例:用户当日拍板四门判据(链条/压力/战略预留/可用)并签字 15s 缓冲与 CD_HOARD_CRISIS_HP_PCT 对齐。红线=默认不指控,四门缺一即静默;a strategic "window worth considering" must never render as a mistake card.',
  },
  death: {
    status: "live",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-07-12",
    issue: "e867e507 (SP-A T1 candidate-event types); death recap backlog #6",
    reason:
      "Neutral anchoring fact, not an accusation; the death recap panel renders it, a candidate card would double count. The side=enemy half (kill review) is the `kill-review` row below.",
  },
  "death-setup": {
    status: "live",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-07-18",
    issue: "cdb28cb5 (backlog #6 death recap)",
    reason:
      "The setup facts before a friendly death; rendered inside the death recap, never as its own card. Death-premised ⇒ discrimination is circular (+70.5pp is not a signal).",
  },
  "missed-cleanse": {
    status: "live",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-08-19",
    issue: "GH #20 (dispel family) / GH #18 (2v2 survivor)",
    reason:
      "DispelDashboard renders cleanse misses; the candidate card would double count. Three-tier dispel work took it 705→194. Kept in 2v2 with cd-hoarded.",
  },

  // ─── retired by flag (emitter wired, flag false; card row kept for A/B) ──
  "unsynced-burst": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    flag: "unsyncedBurst",
    since: "2026-08-29",
    issue: "GH #50 (a)",
    reason:
      "用户逐条裁定「降级为上下文事实」。技能梯度实验(12.1 首周 10,301 场 / 23,056 回合,单排 n=15,306):触发率 62–66%(每个进攻冷却)、分段梯度 +0.1 —— 它在描述常态;被指控队伍整轮从未控过敌方治疗的占 0%,平均只差 13–18s,可行性门(3ad24bbb)只解释 9.5%。时间线上的爆发/控场事实照旧,只撤掉指控。纯函数 unsyncedBurstEvents 与其测试保留。",
  },
  "cd-spent-idle": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    flag: "cdSpentIdle",
    since: "2026-08-30",
    issue: "signal outcome probe (CLAUDE.md Value-Gate rule 4)",
    reason:
      '19,019 个决策点(3,000 场新赛季归档)—— 威胁下按出之后 30s 内"被罚"(敌方进攻大 CD 命中且 10s 内有人阵亡)3.6%,空当按出之后仅 3.1%(Δ +0.5pp;前 10% 分段 −0.8pp;单排 −0.2pp)—— 指控没有可测量的代价。时间线冷却台账照旧;纯函数 cdSpentIdleEvents 与测试保留。数据:eval-private/reports/signal-outcomes-2026-08-30/report.md。',
  },
  "cc-held": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    flag: "ccHeld",
    since: "2026-08-29",
    issue:
      "GH #50 (d) / GH #77 (normalised form re-tested 2026-09-11, still retired)",
    reason:
      "用户裁定「梯度仍平则下架」。机会归一化后的技能梯度(12.1 首周归档 10,682 场 / 23,056 回合;分母=我方对齐爆发开启时自己的控场大招可用,cdAvailableAt):转化率各分段 20–25%,单排未转化率 82.8→88.2% 随分数上升,胜负差 +2–4pp、2400+ 反转;前置窗口变体 [−10,+5]s 每段一致 +6pp、梯度依旧平。GH #77 的 casts-forfeited 口径预注册门 <50% 失败(79.5% 回合弃投)。纯函数 ccHeldEvents 保留。",
  },
  "missed-purge": {
    status: "retired",
    surface: "menu-only",
    origin: "candidate",
    flag: "missedPurge",
    since: "2026-08-29",
    issue: "GH #50 (a)",
    reason:
      "用户逐条裁定「降级为上下文事实」:触发率 63–79%(有高价值可偷增益的回合)、梯度 +4.0 但非单调(峰在中段);可行性门(purgeWasOnCD / purgersLockedOut / losReachable)齐全,所以不是可行性问题 —— 高分玩家同样不偷,「值不值得偷」这个价值判断不在判据里(getPriority 是先验非后果)。formatDispelContextForAI 的 [PURGEABLE] 事实行照旧进 prompt。Was menu-only even while live (DispelDashboard renders purge misses; the card would double count) — that is why it is in both the flag file and the desktop ignore set, not a double-kill.",
  },
  "kill-review": {
    status: "retired",
    surface: "menu-only",
    origin: "candidate",
    flag: "killReview",
    virtual: true,
    since: "2026-08-30",
    issue: "GH #18 human labels, ruling (d)",
    reason:
      'Not a type string: the side=enemy half of `death` ("your kill is worth repeating"), gated in candidateFindings.ts by CANDIDATE_TYPE_FLAGS.killReview. 3/3 blind-labelled cards generic/non-actionable, low or no impact, one causal reading disputed by the player. Kills stay in the timeline; side=friendly deaths unaffected.',
  },

  // ─── retired by unwiring (emitter kept, assembly no longer calls it) ──────
  "cc-locked": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    since: "2026-08-19",
    issue: "GH #14 (v28)",
    reason:
      "Opportunity-normalised breakout conversion is REVERSE — winners sit through CC with the trinket in hand MORE than losers — so neither coaching claim held. Fired in 87 % of rounds with +2.6pp discrimination. Emitter kept for cached rounds; unwired from the assembly.",
  },
  "wasted-trinket": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    since: "2026-08-19",
    issue: "GH #14 B-group re-measurement (v29)",
    reason:
      '94.5 % of emitted events were the healer breaking CC on THEMSELVES — the healerInCCAt-always-false blind spot made "trinketing at high team HP" itself the accusation — and the waste-share of presses ran REVERSE, 12.0 % win vs 10.4 % loss. Unwired; emitter kept.',
  },
  "death-unused-defensive": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    since: "2026-08-29",
    issue: "GH #58",
    reason:
      "Superseded by crisis-no-response. Pooled −9.6pp was a bracket-composition artifact: +0.1pp inside Solo Shuffle alone (aggregateGradient refuses a pooled call). Unwired; emitter kept.",
  },
  "mana-pressure": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    since: "2026-08-21",
    issue: "BACKLOG #26 (declined 2026-08-16) → #33",
    reason:
      'Killed at the value gate on sight of one real output ("you used too much mana here", detached from whether enemy burst forced it). Menu/legend/calibration wiring removed 2026-08-21; pure function manaPressureEvents kept in candidates/mana.ts as raw material for #33.',
  },
  "mana-efficiency": {
    status: "retired",
    surface: "card",
    origin: "candidate",
    since: "2026-08-21",
    issue: "BACKLOG #26 (declined 2026-08-16) → #33",
    reason:
      "Same batch and reason as mana-pressure; manaEfficiencyEvents kept in candidates/mana.ts.",
  },

  // ─── deleted (no emitter; legend / deep-dive text may remain) ────────────
  "juked-kick": {
    status: "deleted",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-08-19",
    issue: "GH #15",
    reason:
      "A/B eliminated (deep-dive value round). Emitter and MISTAKE_RULES row removed the same batch; the kick audit's landed/juked/missed counts are unaffected.",
  },
  "dr-clipped-cc": {
    status: "deleted",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-08-20",
    issue: "GH #17 (v31)",
    reason:
      "Criterion set retired with WASTED_DR_LEVELS; deepDive.ts still branches on the string (harmless). GH #67 records that DR tracking now has zero live coverage.",
  },
  "burst-into-immunity": {
    status: "deleted",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-08-20",
    issue: "GH #17",
    reason:
      "User ruling after the artifact fix (the dual aura-interval builder, now unified in utils/auraIntervals.ts). Emitter deleted.",
  },
  "off-target-in-window": {
    status: "deleted",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-08-19",
    issue: "kill redesign 2026-08-18 (user ruling: 集火按全队算)",
    reason:
      "Off-target share 71 % — a value-gate problem, not a bug (GH #34 constants audit). Emitter deleted; [KILL ATTEMPTS] facts replace it.",
  },
  "unconverted-burst": {
    status: "deleted",
    surface: "menu-only",
    origin: "candidate",
    since: "2026-08-19",
    issue: "kill redesign (user ruling C)",
    reason:
      "Replaced by the [KILL ATTEMPTS] event stream and attempt-into-trinket. Emitter deleted.",
  },
};

/** Types that exist as their own `type: "…"` string (excludes virtual rows). */
export const CANDIDATE_TYPE_STRINGS: readonly string[] = Object.entries(
  CANDIDATE_TYPE_REGISTRY,
)
  .filter(([, e]) => !e.virtual)
  .map(([t]) => t);

function typesWhere(
  pred: (entry: CandidateTypeEntry, type: string) => boolean,
): ReadonlySet<string> {
  return new Set(
    Object.entries(CANDIDATE_TYPE_REGISTRY)
      .filter(([t, e]) => !e.virtual && pred(e, t))
      .map(([t]) => t),
  );
}

/** Live or retired types the LLM menu may carry but the desktop never renders
 * as a mistake card (product stance, one ruling per entry). */
export const MENU_ONLY_TYPES: ReadonlySet<string> = typesWhere(
  (e) => e.surface === "menu-only",
);

/** Types that no longer reach the user (status retired or deleted). Entries
 * stay in this table so cached rounds analysed before the retirement still
 * derive cleanly and so nobody "unifies" them back by mistake. */
export const RETIRED_TYPES: ReadonlySet<string> = typesWhere(
  (e) => e.status !== "live",
);

/** The exact set the desktop's `MISTAKE_RULES` must cover: every live card
 * type, plus flag-retired card types (their row stays so an A/B flag flip
 * renders without a code change). `report.mistakes.test` asserts equality. */
export const CARD_TYPES: ReadonlySet<string> = typesWhere(
  (e) =>
    e.surface === "card" &&
    (e.status === "live" || (e.status === "retired" && e.flag !== undefined)),
);

/**
 * Per-bracket candidate allow-list (GH #18 human-label ruling 2026-08-30 (a)).
 * Key = `bracketKey(startInfo.bracket)`; a bracket listed here keeps ONLY the
 * named types in its candidate menu, everything else becomes context. A
 * bracket not listed is untouched.
 *
 * 2v2: of the 6 blind-labelled 2v2 cards (one match, one player) 4 were
 * "no impact" and 1 was judged false ("22 直接干,没那么多策略"); the only
 * cards with adopt value across all 43 labelled were cd-hoarded (9/9 concrete)
 * and missed-cleanse. n is small — this is a reversible switch, not a law.
 *
 * Kept as a list rather than derived from a per-entry `brackets` field on
 * purpose: a newly registered type must be excluded from a restricted bracket
 * until someone rules it in, and a list defaults that way; a per-entry field
 * would admit anything nobody labelled.
 */
export const BRACKET_TYPE_ALLOWLIST: Readonly<
  Partial<Record<BracketKey, ReadonlySet<string>>>
> = {
  "2v2": new Set(["cd-hoarded", "missed-cleanse"]),
};

/**
 * Derive the mutable flag object from the registry. Mutable on purpose: the
 * A/B harness and tests flip fields directly (`CANDIDATE_TYPE_FLAGS.x = false`)
 * — the dispelFeatureFlags.ts precedent — so this returns a plain object, not
 * a frozen one. Two entries sharing a flag must agree on status.
 */
export function deriveCandidateTypeFlags(): Record<
  CandidateTypeFlagKey,
  boolean
> {
  const out: Partial<Record<CandidateTypeFlagKey, boolean>> = {};
  for (const [type, e] of Object.entries(CANDIDATE_TYPE_REGISTRY)) {
    if (!e.flag) continue;
    const live = e.status === "live";
    const prev = out[e.flag];
    if (prev !== undefined && prev !== live) {
      throw new Error(
        `candidateTypeRegistry: flag ${e.flag} is shared by entries that disagree on status (at ${type})`,
      );
    }
    out[e.flag] = live;
  }
  for (const key of CANDIDATE_TYPE_FLAG_KEYS) {
    if (out[key] === undefined) {
      throw new Error(
        `candidateTypeRegistry: flag ${key} is in CANDIDATE_TYPE_FLAG_KEYS but no registry entry carries it`,
      );
    }
  }
  return out as Record<CandidateTypeFlagKey, boolean>;
}
