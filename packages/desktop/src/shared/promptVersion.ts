/** Version key of the analysis cache: the main process writing the cache, the
 *  main process reading it, and E2E seeding it all share this one constant.
 *
 *  Single-source predicate — a hardcoded copy fails silently on a version bump:
 *  getCached discards the cache, the panel sits idle, and E2E only reports the
 *  undirected failure "there are no findings".
 *
 *  v3: candidate menu expanded — deaths tagged friendly/enemy (side fact) and
 *  cd-waste events (never-used defensive cooldowns) added; prompt gained an
 *  event legend and whole-round time display.
 *  v4 (D2): the point of view became the log recorder (owner) — a DPS recorder
 *  switched from the healer's point of view to their own, so old caches (the
 *  healer-POV result for the same matchId) must be invalidated; the DPS owner
 *  menu gained four event classes (burst-into-immunity / off-target-in-window /
 *  juked-kick / dr-clipped-cc) plus the <burst_ledger> block. The healer
 *  recorder's prompt is byte-identical, but its cache key rotates with the
 *  version anyway.
 *  v9: HP / short names; v10: teachable-signal gate + owner anchoring + leaving
 *  clean windows blank;
 *  v11: positioning signals (a fourth class); v12: offensive deep dives
 *  (non-death findings);
 *  v13: three team-coordination event classes (death-unused-defensive /
 *  external-unused / wasted-trinket) wired into the prompt's event legend and
 *  mistake list; the menu composition changed, so old caches are void;
 *  v14: the low-pressure guard note (lowPressureUnusedDefensiveNote) — in rounds
 *  where the owner was never attacked, the loadout's owner [UNUSED] mitigation
 *  tags are explicitly declared not to be a teaching point, which also voids the
 *  old caches' false positives of "blamed for unused mitigation despite taking
 *  ≈0 damage".
 *  v15: feasibility gate on dispel blame (user's call, 2026-08-02) — missed
 *  cleanses where the dispeller was CC'd or locked out, or had no line of sight
 *  or was out of range, no longer enter the candidate menu; the timeline
 *  [UNCLEANSED DEBUFF] / [MISSED PURGE OPPORTUNITY] lines gained an exemption
 *  suffix, and windows with fully fresh DR plus evidence of a follow-up CC carry
 *  a cautionary note; false positives of the "blamed for not dispelling
 *  Dragon's Breath / Binding Shot" class in old caches are void.
 *  v16: moment deep dive snapshot opt-in (2026-08-05) -- the deep dive pack
 *  gained a `snapshot` mode (castFlow / GCD-gap context added to the window
 *  pack); the default (non-snapshot) path stays byte-identical, but the pack
 *  *shape* the prompt builder accepts changed, so this counts as a
 *  prompt-generation change under this cache's own rule and the version rolls
 *  regardless of whether a given cached entry happens to be a
 *  snapshot-affected one. Note this is orthogonal to the window cache's own
 *  `:snap` windowKey suffix (see analysis.ts's analyzeWindow) -- that suffix
 *  keeps snapshot-on/off runs of the *same* window from colliding with each
 *  other; this version bump is what invalidates *every* previously-cached
 *  window/run/deepen/coach-chat-resume entry (all consumers of
 *  PROMPT_VERSION), snapshot or not, because they were all produced by the
 *  pre-v16 prompt builder.
 *  v19 (2026-08-06, agy 27/27-dropped attribution): window mode's output
 *  contract line now writes `"findingIndex": 0` (was `"findingIndex":
 *  number`) — agy misread "1-4 entries" as an instruction to number entries
 *  1, 2, 3… and every one of its window-mode deep dives died to
 *  `auditDeepDives`' unknown-finding-index gate; window mode only ever
 *  builds one pack, so the field carried zero information anyway. Paired
 *  with `auditDeepDives`' new single-pack remap (see its own doc comment) —
 *  the prompt change is belt-and-suspenders on top of the code-side fix, not
 *  load-bearing by itself, but the version still rolls because the prompt
 *  text changed.
 *  v17: two deep-dive format hard rules (retest-prep 2026-08-05, fixing the
 *  two format-only death causes the first B-vs-A pass silently ate): never
 *  write a pack key (e.g. p3) as bare prose text (only {{pN.field}}
 *  placeholders are citable), and JSON string values must quote with 「」
 *  rather than unescaped ". Both rules apply in every deep-dive mode (window
 *  and finding, snapshot and non-snapshot alike) -- old deep-dive caches are
 *  void because the prompt text changed, not because of a semantic gate.
 *  v18: window-multi-finding (2026-08-05) -- window-mode deep dives may now
 *  return up to 4 entries per window (was 1) and each entry gains a required
 *  `title`; the window-analysis cache entry shape changed from a single
 *  `text`/`chips` pair to an `entries` list, so old cache entries (the
 *  pre-v18 shape) must miss on read rather than being misread as an empty
 *  `entries` array -- this version bump is what forces that miss.
 *  v20: signal-expansion batch 1 (2026-08-06, BACKLOG #18 second batch) --
 *  three new candidate-menu types (healing-gap / position-mistake / cc-held)
 *  plus a `latencyS` fact added to some missed-cleanse events (a cleanse that
 *  landed, but late) -- both the event menu and the event legend changed, so
 *  old caches (built from the pre-v20 menu/legend) are void.
 *  v21: DEFENSIVE-001 (2026-08-07, BACKLOG #18 second batch) -- a fourth
 *  candidate-menu type, cc-avoidable (a healer ate a full-DR CC of >=3s with
 *  a non-trinket avoidance tool evidenced-and-available beforehand; excludes
 *  instances already covered by cc-locked/wasted-trinket's
 *  trinketState=available_unused to avoid double-charging the same instant)
 *  -- both the event menu and the event legend changed, so old caches are
 *  void.
 *  v22: selection-layer diversity (2026-08-11) -- a four-backend baseline
 *  (.superpowers/sdd/2026-08-05-window-multi-finding/diversity-baseline-report.md)
 *  found all four generation backends over-selecting the legacy missed-
 *  cleanse/missed-purge/cc-locked/wasted-trinket group at +3.4~+7.5pt above
 *  their menu share; buildFindingsPrompt's selection-rule paragraph gained a
 *  sentence capping that group at 2 findings total, so the prompt text
 *  changed -- old cached findings were produced by the pre-cap prompt and are
 *  void, independent of auditFindings' new deterministic backstop (an
 *  audit-layer change, not a prompt-text one, so it alone would not need this
 *  bump -- it rides along with the prompt change).
 *  v23: OFFENSIVE-002 (2026-08-11, BACKLOG #18 second batch) -- a fifth
 *  DPS-owner candidate-menu type, burst-into-mitigation (a burst went into a
 *  target with a major non-immune mitigation cooldown running while a softer
 *  target existed at that same instant) -- both the event menu and the event
 *  legend changed, so old caches are void.
 *  v24: DEFENSIVE-003 (2026-08-11) -- a new healer-owner candidate-menu type,
 *  slow-defensive-response (the enemy opened a pressured offensive-CD burst
 *  window -- damageRatio >= 1.5x the match-average rate -- while the owner had
 *  a defensive off cooldown and was not CC'd, and the first defensive/
 *  external/trinket/mobility/CC response came >8s in or never; dedupe gate
 *  suppresses windows already covered nearby by another candidate) -- both
 *  the event menu and the event legend changed, so old caches are void.
 *  v25 (2026-08-19, covers two prompt changes that land together — the first
 *  SHOULD have bumped this yesterday and was missed, recorded honestly here):
 *  (a) the [KILL ATTEMPTS] block (stun-anchored team kill attempts with
 *  opportunity tier / team focus / failure attribution) plus the
 *  attempt-into-trinket candidate + legend (2026-08-18 wiring, main 740181f7);
 *  (b) off-target-in-window retired from the candidate menu (per-person
 *  exclusivity over 80%-overlapping windows produced mutually-contradictory
 *  accusations; team-level replacement is (a)), and the vulnerability-window
 *  block dropped its CAPITALISED/NOT-CAPITALISED verdict + "× match avg"
 *  ratio (unreachable denominator: 4/3486 windows ever cleared it) — facts
 *  only. Old caches contain the pre-attempts prompt AND findings of a retired
 *  type, so they are void twice over.
 *  v26 (2026-08-19): unconverted-burst retired from the candidate menu (user
 *  ruling C — superseded by the [KILL ATTEMPTS] per-attempt outcome; the type
 *  had 92.1% incidence with no damage floor on what counted as a "burst").
 *  Menu composition changed again, so v25 caches are void. */
// v27 (2026-08-19): missed-sync-window 下架(flag→false,GH #13:归一化转化
// 率持平)+ juked-kick 退役(GH #15:检测无罪但建议不可执行,盲评 2.9/5)。
// 两类候选从菜单消失 → prompt 变 → 旧缓存作废。
// v28 (2026-08-19): cc-locked 退役(GH #14,用户裁定:机会归一化转化率反向
// −4.7pp,赢家更常捂徽章不交;出面事件 98.5% 无已验证可教动作)。菜单少一类、
// LEGACY_TOPIC_TYPES 四族缩三族 → 挑选指令措辞变 → prompt 变 → 旧缓存作废。
// v29 (2026-08-19): wasted-trinket 退役(GH #14 B 组复测,用户裁定:出面事件
// 94.5% 是治疗解自己身上的控 —— healerInCCAt 对 owner 恒 false 的盲区;按使用
// 次数归一化后反向 12.0% vs 10.4%)。菜单再少一类、LEGACY_TOPIC_TYPES 缩为
// 二族 → 挑选指令措辞变 → prompt 变 → 旧缓存作废。
// v30 (2026-08-19): spellEffectData 双层合并的 dispelType 字段级修复 —— override
// 整对象替换曾吞掉 7 个官方 dispelType(冰箱/神圣之盾/沉默/反制射击/法术护佑/
// 天启 Magic + 死亡印记 Bleed;12.1 实战 147 场冰箱被群驱 30 次抓出)。恢复后
// missed-cleanse 194→214 / missed-purge 1507→1534(n=300 验收,其余 17 类零
// 变化)→ 菜单变 → prompt 变 → 旧缓存作废。DB2 真空缺口另见 GH #25。
// v31 (2026-08-20): dr-clipped-cc 退役(GH #17,用户裁定:判据集 {25%,Immune}
// 无合法定义域 —— 25% 档 12.0 已从游戏移除,Immune 档实测两轮全是链窗模型
// 伪影且判别力反向)。同批删除 CC Chains 上下文块的「N immune ⚠ hit immune」
// 提示(同一伪影谓词,向模型断言假事实)→ 菜单与 context 文本双变 →
// 旧缓存作废。
// v32 (2026-08-20): burst-into-immunity 退役(GH #17,用户裁定:伪影修复后
// 按爆发归一化判别力持平 7.1% vs 6.8%,#13 同形)。菜单再少一类 → prompt 变
// → 旧缓存作废。#17 六类处置至此全部收口。
// v33 (2026-08-20): STAYED_IN 代价门接地收紧(GH #16,用户裁定):hpMin<35
// (剂量-反应唯一膝点)替换 85/15 豁免线 —— position-mistake 175→14(−92%),
// 被打掉的 91% 指控实测无结果关联。菜单变 → prompt 变 → 旧缓存作废。
// v34 (2026-08-20): CC_AVOIDABLE_MIN_S 接地收紧 3→4(GH #16,用户裁定:膝点
// 在 4s,3–4s 段 259 条与背景无异)。菜单变 → prompt 变 → 旧缓存作废。
// severity 两处调整(questionable-external→minor / unsynced-burst→average)
// 是 UI 侧标签,不影响 prompt,随本版顺带。
// v35 (2026-08-20): 击杀尝试 v2 —— 大招锚定路径落地(用户裁定 建:击杀覆盖
// 20.1%→80.5%,全部复用既有常量)+ 旧 ENEMY VULNERABILITY WINDOWS 块下架
// (被证伪的 36s 窗单位,v25 已去评判化,本次连事实行摘除)。
// [KILL ATTEMPTS] 头行/行格式/Summary 均变 + context 少一块 → 旧缓存作废。
// v36 (2026-08-21): PURGE_BLOCKLIST 双向完备性检查新增三条(用户机制裁定:
// 牺牲祝福/Time Stop 根本不可驱、萨满版自然迅捷瞬发来不及)—— 12.1 语料
// 2114 回合零实驱证据 + 官方 Magic 假阳性。missed-purge 窗口构成换血
// (12.1 原始 −1444 窗)→ prompt 变 → 旧缓存作废。
// v37 (2026-08-29): crisis-no-response 候选上线(治疗视角,行为先验参照表
// behaviorPriorGenerated.json,spec 2026-08-29);death-unused-defensive 加
// facts.precededBy。菜单变 → prompt 变 → 旧缓存作废。
// v38 (2026-08-29): death-unused-defensive 退役(GH #58,用户裁定)—— 菜单少
// 一类 → prompt 变 → 旧缓存作废;crisis-no-response 的 precededBy 标记随之摘除。
// v39 (2026-08-29): crisis-no-response legend gains refOutcome (Solo Shuffle reference = any friendly death within 15 s, §1c) → prompt 变 → 旧缓存作废。
// v40 (2026-08-29): crisis-no-response follow-up — facts.refOutcome is now a
// human phrase (data/behaviorPrior.ts's outcomePhrase), never the bare enum
// token, so a coaching model can no longer paste "teamDeath15s" verbatim
// into prose; the enum travels separately as facts.refOutcomeKey for the
// gate/desktop branch. Legend wording changed to match → prompt 变 → 旧缓存
// 作废。
// v41 (2026-08-29): crisis-no-response DPS role dimension (spec §1d, GH
// #59) — the legend's "healers who did/did not respond…" wording became
// role-neutral ("players of the same role in this bracket who did/did not
// respond…") and gained a sentence explaining the DPS vs. healer outcome
// split; OUTCOME_PHRASE.ownDeath10s changed from "this healer died within
// 10 s" to "this player died within 10 s" (it is now also the outcome for
// every DPS crossing, not just a healer's non-Solo-Shuffle one). Product
// output is otherwise unchanged for existing healer rounds until the dps
// behavior-prior scan lands (no `|dps|` cells exist yet, so
// lookupBehaviorPrior(bracket, "dps", …) always returns null and no DPS
// crisis-no-response event can fire) → prompt 变 → 旧缓存作废。
// v42 (2026-08-30): [ROOT] context facts in the timeline (GH #24, user
// ruling: root value = reachability, not DR) + three legend lines. Only roots
// whose target could not reach anyone for >= ROOT_UNREACHABLE_MIN_S (3 s)
// render; no candidate/accusation → prompt 变 → 旧缓存作废。
// v43 (2026-08-30): five A/B-approved menu changes land together (GH #34).
// 1. healing-gap (HEAL-001) regated on the lowest friendly HP% reached during
//    the gap instead of gap seconds — 3,000-match outcome probe:
//    friendly-death-within-10s is flat across gap length but keyed on lowest
//    HP <=40% 13.0% vs 40-70% 2.8% vs >70% 0.8%. HEAL_GAP_FREE_MIN_S (>=4s)
//    replaced by HEAL_GAP_CRISIS_HP_PCT (<=40%, the same line as
//    crisisDecisionPoints' CRISIS_HP_PCT); events gained facts.lowestAllyHp
//    and sort by lowest HP ascending instead of damage descending; the legend
//    now also states facts.t is the gap START.
// 2. cd-hoarded rewritten decision-point shaped (3,000-match outcome probe) —
//    "a teammate (or you) hit a crisis while a usable major defensive CD was
//    ready and it wasn't spent within 5 s", replacing the retired
//    availableWindows/CD_HOARD_MIN_LATE_S shape whose own intent guard
//    measured 35.6% of accusations wrong. facts change completely (lateS/
//    crisisT/castT/unresolved gone; t/crisisUnit/crisisHpPct/dmg2sPct/
//    readyCds/own/refDeathSpent/refDeathHeld/refN new) and only
//    Defensive-tagged, non-throughput cooldowns count now.
//    Crisis decision points are additionally re-anchored onto the prompt's
//    render grid (crisisDecisionPoints' anchorToRenderGrid + the shared
//    `gridHpPct` sampler in utils/cooldowns.ts, the same one matchTimeline's
//    [STATE] tick uses): cd-hoarded's `crisisHpPct` / crisis-no-response's
//    `hpPct` are now the [STATE] tick's own reading at the displayed second
//    instead of the raw advancedAction sample, `t` is a whole second on both
//    types (crisis-no-response used to render one decimal, e.g. `t=116.9`),
//    and a crossing no whole second can see is dropped. Measured
//    contradiction against the same-second [STATE] line over the 309-prompt
//    A/B corpus: cd-hoarded 155/167 covered lines → 0, crisis-no-response
//    7/8 → 0 (packages/eval/scripts/crisisHpStateScan.ts).
// 3. cd-spent-idle retired from the candidate menu (signal outcome probe
//    2026-08-30, user ruling — no measurable cost): CANDIDATE_TYPE_FLAGS
//    .cdSpentIdle = false, so the menu loses one type.
// 4. attempt-into-trinket cites the corpus outcome contrast (6.8% vs 3.8%) —
//    data/outcomeRefs.ts renders the reference numbers into the fact line and
//    the legend, gated by checkOutcomeRefConsistency.
// 5. candidate-menu time facts floor to the render grid instead of rounding
//    past it (kick-eaten `t`, death `t`, missed-cleanse `t`, death-setup
//    `deathT`), so a menu line's second can never sit one second ahead of the
//    `fmtTime`-floored timeline marker it points at.
// 菜单构成变(少一类)+ 多类 facts/legend 全变 → prompt 变 → 旧缓存作废。
//
//  v44 (2026-09-01, GH #60 phase 2): slow-defensive-response rewritten to
//  decision-point form. The type name is unchanged and every fact under it is
//  new: the retired predicate judged the UNBOUNDED enemy-CD builder window
//  (corpus p50 21.6 s) with `damageRatio >= 1.5`, asked only whether the
//  HEALER OWNER reacted within 8 s, and rendered
//  enemyCds/windowEndT/damageK/dmgRatio/reacted/delayS/reactSpell. The new one
//  (analysis/burstWindowDecisionPoints.ts + candidates/burstWindowResponse.ts)
//  judges a per-exchange BOUNDED window, asks whether ANY friendly answered,
//  gates feasibility on the PRESSURED friendly (their own tool, or a
//  teammate's ally-reaching one, and that unit not hard-CC'd for the whole
//  8 s), triages on that friendly reaching CRISIS_HP_PCT or a death in the
//  window, and renders
//  t/leadCd/leadCdId/casterSpec/caster/extras/pressured/pressuredHpPct/
//  pressuredHpT/diedInWindow plus the corpus reference
//  (refN/refDeathResp/refDeathNoResp/refTop/cellKey/fellBack) from
//  data/burstWindowPriorGenerated.json. Power Infusion (10060) can no longer
//  open a window at all. Old caches carry the retired facts under the same
//  type name, which the new legend does not describe — they must be void.
//
//  v45 (2026-09-01, GH #60 phase 2c): two approved doors narrow which burst
//  windows reach the menu. The facts are unchanged — the POPULATION is not,
//  so a v44 cache carries slow-defensive-response lines this build refuses to
//  produce (and one of the two, the contrast door, is now a hardFailure in
//  checkBurstWindowRefConsistency, i.e. a v44 line replayed against a v45 gate
//  goes red).
//  1. Minimum-contrast door (data/burstWindowPrior.ts's
//     BURST_REF_MIN_CONTRAST_PP = 3 + burstRefClearsMinContrast, imported by
//     both the producer and the gate): a window only becomes a candidate when
//     the reference cell it would quote — after fallback resolution — shows
//     the no-response population dying at least 3 pp more often. On the v44
//     corpus build 8 of 56 rendered lines (14%) quoted a flat or REVERSED
//     contrast, i.e. cited numbers arguing against their own accusation.
//     The lookup also moved BEFORE the per-round cap, so a door-failing
//     window no longer consumes one of the two slots.
//  2. HP-drop door (BURST_TRIAGE_MIN_HP_DROP_PP = 15, in the engine): triage
//     additionally requires the pressured friendly to have LOST >= 15 points
//     of maximum health inside the window (new BurstFriendlyOutcome.startHpPct
//     / startHpSec, same gridHpPct sampler as minHpPct). Without it the type
//     fired on somebody who was already low when the burst opened — a
//     sentence about the previous exchange. The reference table is untouched:
//     it is built over FEASIBLE windows and never reads `triaged`.
//
//  v46 (2026-09-01, GH #60 follow-up — the POSITIVE side): the match timeline
//  gained `[BURST ANSWERED]` context lines. Same engine, opposite sign: a
//  window that `burstWindowDecisionPoints` marks feasible AND answered (the
//  exact complement of what makes slow-defensive-response fire) is credited
//  with one descriptive line at its start second —
//  "enemy opened <leadCd>(+<extras>) (<spec> <caster>): <responder> answered
//  with <spell> in <latency>s; <pressured> bottomed at <minHp>%", plus
//  "— <name> still died" when the pressured friendly died anyway. It is NOT a
//  candidate, carries NO corpus reference numbers (the kick-eaten A/B showed
//  per-line references inflate whatever they touch) and never reaches the
//  menu, mistakes.ts or any verdict surface.
//  Volume is capped: 71.4% of bounded windows are answered, so
//  context/burstAnswered.ts renders at most BURST_ANSWERED_CAP = 2 per round,
//  selected by danger (a death in the window first, then the lowest grid min
//  HP), and only when the pressured friendly's min HP reached
//  BURST_ANSWERED_MAX_HP_PCT = 60 or lower. A two-line legend is appended to
//  the timeline header only when at least one such line renders.
//  Measured on the 309-prompt findings corpus: 205 of 309 prompts gain lines
//  (89 with one, 116 with two), 321 lines total, +0.86% tokens; every other
//  byte of every prompt is unchanged (diff: 731 insertions, 0 deletions).
//  The prompt text changed, so the version rolls; old caches carry no
//  [BURST ANSWERED] lines and must be void.
//  v47 (2026-09-02, GH #60 tail — chg9): three coupled changes, all of which
//  move rendered text or the candidate population, so v46 caches are void.
//  1. Teammate reachability gate on burst-window feasibility branch (b):
//     a teammate's ready ally-reaching tool now counts only if the teammate
//     could DELIVER it to the pressured friendly at the window-start render
//     second — `canReachTargetAt` (the [ROOT] work's per-second reach
//     predicate, rootReachability.ts) with per-spell official range
//     (`externalReachYards`) and LoS-not-disproven; missing position data
//     fails OPEN (missing data must not manufacture infeasibility).
//     Archive: feasibility 90.6% → 88.8% (windows with no new-table id:
//     88.7%). Corpus: slow-defensive-response 39 → 36 lines; the same gate
//     also narrows which windows earn [BURST ANSWERED] credit.
//  2. ONE canonical offensive-cooldown table (`OFFENSIVE_CD_SPELL_IDS`,
//     spellDanger.ts): union of the two former disjoint tables (41 ∪ 34,
//     overlap 19) minus 9 corpus-dead ids = 47, read by isOffensiveSpell
//     (the enemy-CD window builder → [ENEMY CD] lines gain 6 previously
//     invisible lead CDs: Empower Rune Weapon, Ascendance (Elemental),
//     Invoke Xuen, Metamorphosis, Bladestorm, Summon Demonic Tyrant), by
//     `hasOffensiveSpellActive`/`threatActiveAt` (richer aura evidence:
//     missed-cleanse's timing door exempts more whole-threat windows,
//     58 → 50 corpus lines) and by the position/kill-attempt threat gates
//     (position-mistake 4 → 5). Closed docs/predicate-index.md's open
//     "Not yet unified" divergence.
//  3. `burstWindowPriorGenerated.json` regenerated on the 2026-09-02 rescan
//     (18,134 matches, 71,332 windows, 106 → 121 cells) — every
//     slow-defensive-response line's refN/refDeathResp/refDeathNoResp/refTop
//     comes from the new table, and a v46 cached line's reference numbers
//     are hardFailures under the v47 `checkBurstWindowRefConsistency` gate.
//  v48 (2026-09-02, GH #34 chg10): behaviorPriorGenerated.json regenerated on
//  the render-grid-anchored decision-point population — v43 item 2's
//  anchorToRenderGrid changed which crossings exist (16,040 → 13,364 decision
//  points over the same 18,134-match archive; a dip no whole rendered second
//  can see no longer produces a point), so the shipped table had drifted from
//  the predicate that now feeds it. Same 9 cells, no death-contrast sign flip
//  (max move 3 pp), but every cell's nNoResp/nResp changed and refTop's
//  composition changed in 3 of 9 cells — every crisis-no-response line's
//  refNNoResp/refDeathNoResp/refNResp/refDeathResp/refTop now comes from the
//  new table, and a v47 cached line's reference numbers are hardFailures
//  under checkBehaviorPriorConsistency. Scan artifacts:
//  eval-private/reports/behavior-prior-2026-09-02/.
//  v49 (2026-09-02, GH #13 resurrection): missed-sync-window back on by
//  default, redesigned — canonical offensive table, t>=30s / rendered dur>=3s /
//  enemy-death-in-window exclusion, per-bracket corpus reference facts
//  (refN/refKillEntered/refKillUnentered/cellKey) with a >=3pp min-contrast
//  door; its legend rewritten to explain the reference.
//  v50 (2026-09-02, GH #31 ②): kill-window defensive roster single-sourced as
//  KW_MAJOR_DEFENSIVE_IDS (− Apotheosis, + Ancient of Lore) — [KILL WINDOW]/
//  [VULNERABLE] spans shift slightly on affected comps; official-face
//  replacement measured and reverted (negative result in abilityProfile.ts).
//  v51 (2026-09-02, GH #31 ①③): kill-window killability facts — [KILL WINDOW]
//  lines carry team-offensive-CD-ready / reachability / enemy-healer-state
//  facts, [VULNERABLE] accusations pass an accountability gate (acquitted
//  spans say why), and the DPS view gains the lean <kill_windows> block.
//  v52 (2026-09-04, GH #54 (f) / BACKLOG #38 (a)(h), user ruling option 1):
//  [CD PRIOR] context lines + legend — a healer owner's held save cooldown
//  quoted against the cohort (spec × hero tree) median trigger HP from the
//  corpus; context fact only, no candidate. Timeline text changes for healer
//  prompts wherever a cohort cell exists.
//  v53 (2026-09-04, GH #63): healer save-cooldown roster generated from
//  official data + corpus (healerSaveCdGenerated.json, 42 spells, user-signed
//  save_role/not_save_role) replaces the hand catalog for healer specs —
//  cd-hoarded / cd-waste / the [RES] ledger / [CD PRIOR] all see Healing
//  Tide, Lay on Hands, Revival, Chi-Ji, Rewind, Divine Toll…; [RES] snapshot
//  instants floored to the render grid (about 60% of [RES] lines change by
//  ±1 s); [CD PRIOR] reference table regenerated over the new roster.
//  v54 (2026-09-04, BACKLOG #41, user ruling "PvP 值为官方值"): official-PvP
//  data batch — (2) kick school-lockout now reads the kick's own DB2 PvP
//  duration first (Counterspell 6 → 5 s, Axe Toss 3.5 → 3 s in the [RES]
//  `-Ns[kick]` field, kick-eaten lockout fact and cannot-cast exemptions);
//  (1) mitigation / talent-mitigation / healing-received percentages
//  multiplied by SpellEffect.PvpMultiplier (Divine Protection 20 → 35 %,
//  AMZ 15 → 30 %, PW:Barrier 20 → 40 %, …); (3) SimC hotfix overlay. One
//  bump for the whole batch.
//  v55 (2026-09-04, BACKLOG #41 (8), user rulings): usable-while-stunned table
//  reads the NAMED SpellMisc bits (163 ∪ 378) instead of the searched
//  5#3 ∪ 10#13 — 213 observed long cooldowns (Bloodlust, Tranquility, Lay on
//  Hands, …) stop being "usable while stunned"; Divine Shield / Ice Block /
//  Icebound Fortitude re-ruled not usable. [RES] locked-out CD lists, the
//  death candidates' usable_in_cc exemption and kill-window tiering all move.
//  v56 (2026-09-04, BACKLOG #41 (8), user ruling "改吧"): kill-opportunity
//  gated door = ANY 20–99 % wall in hand (was: stun-usable wall only) —
//  [kill-opportunity: …] tags, [KILL ATTEMPTS] tier labels and the
//  attempt-into-trinket legend change wording and membership.
//  v57 (2026-09-12, GH #80, user approval): new candidate types
//  backlash-dispel / backlash-dispel-window with their legends; the [DISPEL]
//  annotations for a Vampiric Touch dispel now pair the real backlash aura
//  (87204 Sin and Punishment) instead of the stale 34914.
//  v58 (2026-09-12, EliteDamit claim audit, user ruling "第一条可以按你说的做"):
//  talent-shared personal walls are priced on the unit that CARRIES the aura
//  (`IMitigationEntry.pctOnOthers` / `mitigationPctFor`): a Flameshaper's
//  Obsidian Scales on an ally is 15 %, not the caster's 30 % — burst-into-
//  mitigation stops firing on the ally copy, [KILL ATTEMPTS] stops reporting
//  it as "popped Obsidian Scales", the death-window mitigation audit backs
//  out 15/85 instead of 30/70.
//  v59 (2026-09-12, GH #78, user rulings): kick-priority-missed /
//  kick-priority-team candidate types + legends; the interrupt kit behind
//  [ENEMY KICK] is now the official per-player table (a Holy Paladin no
//  longer shows Rebuke, a Retribution Paladin only when the node is taken).
//  v60 (2026-09-13, GH #96 M0, user "有相应消费但没有引用的地方要补上"):
//  talent cooldown modifiers — Monk / Demon Hunter / Evoker class-mask
//  SpellMods now match (class set 53/107/224, was 126/127/128), aura 454
//  charge-recovery % is read, temporary-buff sources (Berserk, Incarnation,
//  Avatar) no longer apply permanently. <cooldowns> values move (Darkness
//  300 → 180 s, Paralysis 45 → 30 s, Leg Sweep 60 → 50 s, Oppressing Roar
//  120 → 90 s, Tip the Scales 120 → 90 s …) and false "2 Charges" inferred
//  from casts shorter than the old wrong cooldown disappear.
//  v61 (2026-09-14, GH #96 M4/M5): crisis-no-response credits a healer's own
//  Power Word: Shield / Void Shield, Fade, Spirit of Redemption, Reversion and
//  Divine Hymn as a response (user ruling "这 5 个技能我觉得都算是"), and its
//  reference table is rebuilt over the full new-season archive (63,303 files)
//  with the new "protective" category; talent duration modifiers Trueshot +2 s,
//  Demonic Tyrant +5 s and Boneshaker Shockwave stun +1 s change [BUFF FADED]
//  expiry labels and CC-break remaining time.
//  v62 (2026-09-14, GH #96, user rulings "天赋那边可以打开" / "30% 左右"):
//  talent mitigation ON — Barkskin + Oakskin 30 %, Unending Resolve + Strength
//  of Will 40 %, Pain Suppression 50 %, Obsidian Scales 40 %, Astral Shift 60 %,
//  Cloak physical 20 %, Blessing of Protection magic 15 % priced for holders;
//  death-window "Mitigation audit" amounts grow accordingly; burst-into-
//  mitigation requires the wall to cover >= 30 % of the burst (provisional,
//  BACKLOG #42).
//  v63 (2026-09-14, GH #96 M4 second ruling "一里的都算,二里的都不算" + follow-up
//  rules): crisis-no-response also credits Tree of Life, Bear Form, Ancient of
//  Lore, Ultimate Penitence, Tranquility; a trinket / break racial counts only
//  when a credited action follows within 3 s of the press, mobility / Blessing
//  of Freedom only when distance opens within 3 s of the press. Reference
//  table rebuilt over the full archive.
//  v64 (2026-09-14, GH #96 M6): cooldown SpellMods keyed by SpellCategory
//  (aura 341) and SpellLabel (aura 218 / 219) are compiled — <cooldowns> and
//  [RES] move for holders: Desperate Prayer 90 → 70 s, Dark Pact 60 → 45 s,
//  The Hunt 90 → 75 s, Totemic Surge totems −5 s, Counterspell −5 s …; a false
//  "Dark Pact 2 Charges" inferred from casts faster than the old cooldown
//  disappears.
//  v65 (2026-09-12/15, GH #78 / #80, codex rounds 1–2 + n=78 pre-registered
//  A/B ab/2026-09-12-backlash-kick-n100): kick-priority eligibility from the
//  corpus hardcast-heal table (outcome-independent; nominal cast length for
//  feasibility, longest continuous castable stretch for reach / lockout);
//  direction pre-worded facts `healTrend` / `selfDmgTrend` (backlash) and the
//  copy-able `refContrast` sentence (kick-priority) — 10 of the treatment
//  arm's 19 refuted claims were models inverting a direction the numbers
//  stated; kick legends no longer say the heal was "on your kill target"
//  (`healedWhom` is the only recipient claim), backlash legend words the
//  corpus cells as observed differences; VT accusations silenced by the
//  symmetric ledger guard; interrupt kit → official table; auditFindings drops
//  a finding without eventIds instead of crashing.
//  v66 (2026-09-15, GH #78 / #80, user ruling after the n=78 healer breakdown
//  "可以,都可以"): backlash-dispel no longer renders the four raw before/after
//  numbers (the two trend strings carry them), kick-priority-team teammates
//  render as "name distance" without the interrupt's name — healer treatment
//  responses audited 2.37 claims per finding vs 1.83 in control on an
//  unchanged old-line error rate, so the new lines' surface is cut.
//  v67 (2026-09-15, first Opus 5 baseline, run 2026-09-15-baseline): a
//  [DMG SPIKE] whose endpoints hide a crisis-line trough prints `, low N%
//  @m:ss` instead of `— healed through` (73/309 prompts); KILL ATTEMPTS
//  `popped …` / `saved by external (…)` and the [ROOT] `(from …)` caster no
//  longer print client-locale (CJK) names (230/309 prompts); the HEALER
//  OFFENSE [KILL WINDOW] list is chronological (112/309 were not).
//  v69 (2026-09-15, GH #93, user ruling 2026-09-15): the crisis response
//  taxonomy splits what was one "selfHeal" arm into selfHeal (healing from
//  spells pressed INSIDE the window) and carriedHeal (a HoT pressed earlier),
//  and one "kite" arm into kite and attackerMoved (the attackers walked away).
//  Both new arms still count as answered — no new accusations — so
//  crisis-no-response / slow-defensive-response counts do not move; the
//  reference tables' response mix does (2v2 selfHeal 0.55 → 0.24 + carriedHeal
//  0.31), and those shares are quoted in the candidate line.
//  v70 (2026-09-16, confirmatory A/B ab/2026-09-16-backlash-kick-confirm, n=40
//  Opus): two candidate-menu facts stop carrying a literal ", " — kick-eaten
//  `postKick` qualifier "(Fade; instant or channel)" (was ", "), missed-cleanse
//  `ownerCastingSpells` "Mind Control、Mind Blast" (was ", ") — because every
//  text-side facts parser splits on ", " and truncated them (13 + 2 of 40
//  prompts, both arms); `checkFactsBlockIntegrity` (18th hardFailure class)
//  now enforces the invariant, and `serializeFactsBlock` (the one facts→text
//  serializer) turns any remaining ", " inside a value — spell names such as
//  "Invoke Chi-Ji, the Red Crane", 6/288 prompts — into comma + no-break space.
//  The backlash-dispel `refCcExposureS` gate check
//  compares on the producer's `fmtFactNum` grid (was raw String → 34 + 15
//  false hard failures across the two runs). No candidate counts move.
//  v71 (2026-09-16, GH #99): timeline deduplication / noise reduction —
//  covers GH #99 items 1, 2, 4 (already landed 2026-09-16: Lay on Hands
//  dedupe, verdict labels → conditions, [OFFENSIVE WINDOW] marker) and item 3
//  (timeline event folding: [CC CAST] folds full target list into cast line;
//  self-buff [ENEMY BUFF] folds into [ENEMY CD]; [MISSED PURGE OPPORTUNITY]
//  folds unpurged duration and feasibility exemption into [ENEMY BUFF] or
//  chained [ENEMY CD]).
//  v72 (2026-09-17, GH #95, user rulings 2026-09-13/16/17): new healer
//  candidate `teammate-crisis-idle` (a TEAMMATE crossed the crisis line while
//  the healer was free through the window, ≤40 yd, in LoS, with mana, and
//  cast nothing; carried HoT ticks count as answered; reference table
//  teammateCrisisPriorGenerated.json, same exclusions on both populations —
//  codex R2) with its legend, and a new `[STACKED DEFENSIVES]` context line
//  (two major defensives from two players on one friendly: who cast each,
//  overlap seconds, what the later one blocked — a fact, no "one would have
//  sufficed" claim). New hardFailure class checkTeammateCrisisRefConsistency.
//  Enemy burst on the new card is a cue only when the press was ≥2 s before
//  the drop (facts.burstCue), never a counterfactual.
//  v73 (2026-09-17, BACKLOG #43 + #45, user rulings 2026-09-17): the crisis
//  response taxonomy gains `proc` — a low-HP talent that fired on its own
//  (Well-Honed Instincts 382912 → Frenzied Regeneration, detected by its
//  marker aura; Dream Guide 1278914 turned out to be a hand-out buff, not a
//  marker, and stays out) answers the crisis, its cast / heal is subtracted
//  from the owner's presses, and the crisis-no-response legend explains the
//  "proc" / "carriedHeal" refTop tokens. The Hunt's arena
//  cooldown is patched to 60 s (CORPUS_COOLDOWN_PATCHES, talents included).
//  v74 (2026-09-17, BACKLOG #43 second pass, user 「好 可以 看看效果」): the
//  proc arm grows from one marker to six after a per-id archive check
//  (Blood Draw, Nature's Guardian, Veteran Vitality, Golden Val'kyr join
//  Well-Honed Instincts as `proc`; Cauterize and Cheat Death form the new
//  `cheatDeath` arm — a killing blow converted, phrased as the talent saving
//  the player, never "nothing else needed"); heal-shaped markers supported;
//  the crisis-no-response legend names both tokens. Defy Fate / Purgatory /
//  Last Resort / Battle-Scarred Veteran / Elixir / Whirling Steel rejected
//  (0–15 archive events or the wrong HP shape).
//  v75 (2026-09-17, GH #95 hand-read): crisisDecisionPoints' `enemyBurst`
//  now reads the canonical 47-id OFFENSIVE_CD_SPELL_IDS instead of its own
//  34-id classMetadata set (the fourth consumer the 2026-09-02 unification
//  missed) — crisis-no-response `facts.burst` and the teammate-crisis-idle
//  `burst` / `burstCue` facts flip to "yes" where the enemy really pressed a
//  cooldown; crisis-no-response's danger ordering (enemyBurst first) can
//  reorder which ≤2 points survive the cap. Reference cells do not key on it.
//  v76 (2026-09-17, GH #95 question 4 + BACKLOG #43, user rulings 「1 我觉得
//  可以」「2 可以免 如果人没死的话」): new healer candidate
//  `teammate-crisis-triage` (the healer spent the crisis window casting on a
//  friendly who was NOT in crisis; reference = teammate death when the
//  recipient was not in crisis vs was, same feasibility door as the idle
//  twin; only Solo Shuffle clears the 50 floor today) with legend, desktop
//  card and the shared gate; cd-hoarded no longer accuses when a low-HP proc
//  / cheat-death answered the crisis and the crisis unit was still alive
//  CD_HOARD_RESPONSE_S later. teammateCrisisPriorGenerated.json gains the
//  triage cells (same 116,063-round scan, no re-scan).
//  v77 (2026-09-18, user ruling "法术反只改成6秒"): Counterspell school
//  lockout 5 → 6 s as an explicit override over the DB2 PvP duration (corpus
//  mode 6, p50 6.10; the only kick whose p50 sits > 1 s above its official
//  value) — the [RES] `-Ns[kick]` field, the kick-eaten lockout fact and the
//  cannot-cast exemptions (dispel locked-out gate, healing-gap free time)
//  gain one second for Counterspell victims. No other kick moves.
//  v78 (2026-09-18, Curated-List gap): Zenith 1249625 — the Windwalker burst
//  that took Storm, Earth, and Fire's slot (137639 sits in
//  OFFENSIVE_CD_DEAD_IDS; the successor had never been listed) — joins the
//  canonical OFFENSIVE_CD_SPELL_IDS (47 → 48). Every consumer of "the enemy
//  opened a cooldown" now sees a Windwalker's go: enemy-CD windows, burst
//  windows, threatActiveAt, crisis `burst` facts. Local library, 88 rounds
//  with an enemy Zenith (331 casts): candidate menu 519 → 515, the whole diff
//  being 4 missed-cleanse accusations that fell entirely inside a Zenith and
//  are now exempt under the existing no-calm-second gate.
export const PROMPT_VERSION = 78;
