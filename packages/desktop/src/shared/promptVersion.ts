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
export const PROMPT_VERSION = 54;
