# PROMPT_VERSION history

_English-only developer history; this file is not part of the bilingual docs set._

Moved verbatim from `packages/desktop/src/shared/promptVersion.ts` on 2026-09-26 (the file had grown to 1,159 lines around one constant). New `PROMPT_VERSION` bumps append an entry here; the `.ts` file keeps only the last few entries inline as a format sample.

Version key of the analysis cache: the main process writing the cache, the
main process reading it, and E2E seeding it all share this one constant.

Single-source predicate — a hardcoded copy fails silently on a version bump:
getCached discards the cache, the panel sits idle, and E2E only reports the
undirected failure "there are no findings".

## Entries

v3: candidate menu expanded — deaths tagged friendly/enemy (side fact) and
cd-waste events (never-used defensive cooldowns) added; prompt gained an
event legend and whole-round time display.

v4 (D2): the point of view became the log recorder (owner) — a DPS recorder
switched from the healer's point of view to their own, so old caches (the
healer-POV result for the same matchId) must be invalidated; the DPS owner
menu gained four event classes (burst-into-immunity / off-target-in-window /
juked-kick / dr-clipped-cc) plus the <burst_ledger> block. The healer
recorder's prompt is byte-identical, but its cache key rotates with the
version anyway.

v9: HP / short names; v10: teachable-signal gate + owner anchoring + leaving
clean windows blank;

v11: positioning signals (a fourth class); v12: offensive deep dives
(non-death findings);

v13: three team-coordination event classes (death-unused-defensive /
external-unused / wasted-trinket) wired into the prompt's event legend and
mistake list; the menu composition changed, so old caches are void;

v14: the low-pressure guard note (lowPressureUnusedDefensiveNote) — in rounds
where the owner was never attacked, the loadout's owner [UNUSED] mitigation
tags are explicitly declared not to be a teaching point, which also voids the
old caches' false positives of "blamed for unused mitigation despite taking
≈0 damage".

v15: feasibility gate on dispel blame (user's call, 2026-08-02) — missed
cleanses where the dispeller was CC'd or locked out, or had no line of sight
or was out of range, no longer enter the candidate menu; the timeline
[UNCLEANSED DEBUFF] / [MISSED PURGE OPPORTUNITY] lines gained an exemption
suffix, and windows with fully fresh DR plus evidence of a follow-up CC carry
a cautionary note; false positives of the "blamed for not dispelling
Dragon's Breath / Binding Shot" class in old caches are void.

v16: moment deep dive snapshot opt-in (2026-08-05) -- the deep dive pack
gained a `snapshot` mode (castFlow / GCD-gap context added to the window
pack); the default (non-snapshot) path stays byte-identical, but the pack
_shape_ the prompt builder accepts changed, so this counts as a
prompt-generation change under this cache's own rule and the version rolls
regardless of whether a given cached entry happens to be a
snapshot-affected one. Note this is orthogonal to the window cache's own
`:snap` windowKey suffix (see analysis.ts's analyzeWindow) -- that suffix
keeps snapshot-on/off runs of the _same_ window from colliding with each
other; this version bump is what invalidates _every_ previously-cached
window/run/deepen/coach-chat-resume entry (all consumers of
PROMPT_VERSION), snapshot or not, because they were all produced by the
pre-v16 prompt builder.

v19 (2026-08-06, agy 27/27-dropped attribution): window mode's output
contract line now writes `"findingIndex": 0` (was `"findingIndex":
number`) — agy misread "1-4 entries" as an instruction to number entries
1, 2, 3… and every one of its window-mode deep dives died to
`auditDeepDives`' unknown-finding-index gate; window mode only ever
builds one pack, so the field carried zero information anyway. Paired
with `auditDeepDives`' new single-pack remap (see its own doc comment) —
the prompt change is belt-and-suspenders on top of the code-side fix, not
load-bearing by itself, but the version still rolls because the prompt
text changed.

v17: two deep-dive format hard rules (retest-prep 2026-08-05, fixing the
two format-only death causes the first B-vs-A pass silently ate): never
write a pack key (e.g. p3) as bare prose text (only {{pN.field}}
placeholders are citable), and JSON string values must quote with 「」
rather than unescaped ". Both rules apply in every deep-dive mode (window
and finding, snapshot and non-snapshot alike) -- old deep-dive caches are
void because the prompt text changed, not because of a semantic gate.

v18: window-multi-finding (2026-08-05) -- window-mode deep dives may now
return up to 4 entries per window (was 1) and each entry gains a required
`title`; the window-analysis cache entry shape changed from a single
`text`/`chips` pair to an `entries` list, so old cache entries (the
pre-v18 shape) must miss on read rather than being misread as an empty
`entries` array -- this version bump is what forces that miss.

v20: signal-expansion batch 1 (2026-08-06, BACKLOG #18 second batch) --
three new candidate-menu types (healing-gap / position-mistake / cc-held)
plus a `latencyS` fact added to some missed-cleanse events (a cleanse that
landed, but late) -- both the event menu and the event legend changed, so
old caches (built from the pre-v20 menu/legend) are void.

v21: DEFENSIVE-001 (2026-08-07, BACKLOG #18 second batch) -- a fourth
candidate-menu type, cc-avoidable (a healer ate a full-DR CC of >=3s with
a non-trinket avoidance tool evidenced-and-available beforehand; excludes
instances already covered by cc-locked/wasted-trinket's
trinketState=available_unused to avoid double-charging the same instant)
-- both the event menu and the event legend changed, so old caches are
void.

v22: selection-layer diversity (2026-08-11) -- a four-backend baseline
(.superpowers/sdd/2026-08-05-window-multi-finding/diversity-baseline-report.md)
found all four generation backends over-selecting the legacy missed-
cleanse/missed-purge/cc-locked/wasted-trinket group at +3.4~+7.5pt above
their menu share; buildFindingsPrompt's selection-rule paragraph gained a
sentence capping that group at 2 findings total, so the prompt text
changed -- old cached findings were produced by the pre-cap prompt and are
void, independent of auditFindings' new deterministic backstop (an
audit-layer change, not a prompt-text one, so it alone would not need this
bump -- it rides along with the prompt change).

v23: OFFENSIVE-002 (2026-08-11, BACKLOG #18 second batch) -- a fifth
DPS-owner candidate-menu type, burst-into-mitigation (a burst went into a
target with a major non-immune mitigation cooldown running while a softer
target existed at that same instant) -- both the event menu and the event
legend changed, so old caches are void.

v24: DEFENSIVE-003 (2026-08-11) -- a new healer-owner candidate-menu type,
slow-defensive-response (the enemy opened a pressured offensive-CD burst
window -- damageRatio >= 1.5x the match-average rate -- while the owner had
a defensive off cooldown and was not CC'd, and the first defensive/
external/trinket/mobility/CC response came >8s in or never; dedupe gate
suppresses windows already covered nearby by another candidate) -- both
the event menu and the event legend changed, so old caches are void.

v25 (2026-08-19, covers two prompt changes that land together — the first
SHOULD have bumped this yesterday and was missed, recorded honestly here):
(a) the [KILL ATTEMPTS] block (stun-anchored team kill attempts with
opportunity tier / team focus / failure attribution) plus the
attempt-into-trinket candidate + legend (2026-08-18 wiring, main 740181f7);
(b) off-target-in-window retired from the candidate menu (per-person
exclusivity over 80%-overlapping windows produced mutually-contradictory
accusations; team-level replacement is (a)), and the vulnerability-window
block dropped its CAPITALISED/NOT-CAPITALISED verdict + "× match avg"
ratio (unreachable denominator: 4/3486 windows ever cleared it) — facts
only. Old caches contain the pre-attempts prompt AND findings of a retired
type, so they are void twice over.

v26 (2026-08-19): unconverted-burst retired from the candidate menu (user
ruling C — superseded by the [KILL ATTEMPTS] per-attempt outcome; the type
had 92.1% incidence with no damage floor on what counted as a "burst").
Menu composition changed again, so v25 caches are void.

v27 (2026-08-19): missed-sync-window 下架(flag→false,GH #13:归一化转化
率持平)+ juked-kick 退役(GH #15:检测无罪但建议不可执行,盲评 2.9/5)。
两类候选从菜单消失 → prompt 变 → 旧缓存作废。

v28 (2026-08-19): cc-locked 退役(GH #14,用户裁定:机会归一化转化率反向
−4.7pp,赢家更常捂徽章不交;出面事件 98.5% 无已验证可教动作)。菜单少一类、
LEGACY_TOPIC_TYPES 四族缩三族 → 挑选指令措辞变 → prompt 变 → 旧缓存作废。

v29 (2026-08-19): wasted-trinket 退役(GH #14 B 组复测,用户裁定:出面事件
94.5% 是治疗解自己身上的控 —— healerInCCAt 对 owner 恒 false 的盲区;按使用
次数归一化后反向 12.0% vs 10.4%)。菜单再少一类、LEGACY_TOPIC_TYPES 缩为
二族 → 挑选指令措辞变 → prompt 变 → 旧缓存作废。

v30 (2026-08-19): spellEffectData 双层合并的 dispelType 字段级修复 —— override
整对象替换曾吞掉 7 个官方 dispelType(冰箱/神圣之盾/沉默/反制射击/法术护佑/
天启 Magic + 死亡印记 Bleed;12.1 实战 147 场冰箱被群驱 30 次抓出)。恢复后
missed-cleanse 194→214 / missed-purge 1507→1534(n=300 验收,其余 17 类零
变化)→ 菜单变 → prompt 变 → 旧缓存作废。DB2 真空缺口另见 GH #25。

v31 (2026-08-20): dr-clipped-cc 退役(GH #17,用户裁定:判据集 {25%,Immune}
无合法定义域 —— 25% 档 12.0 已从游戏移除,Immune 档实测两轮全是链窗模型
伪影且判别力反向)。同批删除 CC Chains 上下文块的「N immune ⚠ hit immune」
提示(同一伪影谓词,向模型断言假事实)→ 菜单与 context 文本双变 →
旧缓存作废。

v32 (2026-08-20): burst-into-immunity 退役(GH #17,用户裁定:伪影修复后
按爆发归一化判别力持平 7.1% vs 6.8%,#13 同形)。菜单再少一类 → prompt 变
→ 旧缓存作废。#17 六类处置至此全部收口。

v33 (2026-08-20): STAYED_IN 代价门接地收紧(GH #16,用户裁定):hpMin<35
(剂量-反应唯一膝点)替换 85/15 豁免线 —— position-mistake 175→14(−92%),
被打掉的 91% 指控实测无结果关联。菜单变 → prompt 变 → 旧缓存作废。

v34 (2026-08-20): CC_AVOIDABLE_MIN_S 接地收紧 3→4(GH #16,用户裁定:膝点
在 4s,3–4s 段 259 条与背景无异)。菜单变 → prompt 变 → 旧缓存作废。
severity 两处调整(questionable-external→minor / unsynced-burst→average)
是 UI 侧标签,不影响 prompt,随本版顺带。

v35 (2026-08-20): 击杀尝试 v2 —— 大招锚定路径落地(用户裁定 建:击杀覆盖
20.1%→80.5%,全部复用既有常量)+ 旧 ENEMY VULNERABILITY WINDOWS 块下架
(被证伪的 36s 窗单位,v25 已去评判化,本次连事实行摘除)。
[KILL ATTEMPTS] 头行/行格式/Summary 均变 + context 少一块 → 旧缓存作废。

v36 (2026-08-21): PURGE_BLOCKLIST 双向完备性检查新增三条(用户机制裁定:
牺牲祝福/Time Stop 根本不可驱、萨满版自然迅捷瞬发来不及)—— 12.1 语料
2114 回合零实驱证据 + 官方 Magic 假阳性。missed-purge 窗口构成换血
(12.1 原始 −1444 窗)→ prompt 变 → 旧缓存作废。

v37 (2026-08-29): crisis-no-response 候选上线(治疗视角,行为先验参照表
behaviorPriorGenerated.json,spec 2026-08-29);death-unused-defensive 加
facts.precededBy。菜单变 → prompt 变 → 旧缓存作废。

v38 (2026-08-29): death-unused-defensive 退役(GH #58,用户裁定)—— 菜单少
一类 → prompt 变 → 旧缓存作废;crisis-no-response 的 precededBy 标记随之摘除。

v39 (2026-08-29): crisis-no-response legend gains refOutcome (Solo Shuffle reference = any friendly death within 15 s, §1c) → prompt 变 → 旧缓存作废。

v40 (2026-08-29): crisis-no-response follow-up — facts.refOutcome is now a
human phrase (data/behaviorPrior.ts's outcomePhrase), never the bare enum
token, so a coaching model can no longer paste "teamDeath15s" verbatim
into prose; the enum travels separately as facts.refOutcomeKey for the
gate/desktop branch. Legend wording changed to match → prompt 变 → 旧缓存
作废。

v41 (2026-08-29): crisis-no-response DPS role dimension (spec §1d, GH
#59) — the legend's "healers who did/did not respond…" wording became
role-neutral ("players of the same role in this bracket who did/did not
respond…") and gained a sentence explaining the DPS vs. healer outcome
split; OUTCOME_PHRASE.ownDeath10s changed from "this healer died within
10 s" to "this player died within 10 s" (it is now also the outcome for
every DPS crossing, not just a healer's non-Solo-Shuffle one). Product
output is otherwise unchanged for existing healer rounds until the dps
behavior-prior scan lands (no `|dps|` cells exist yet, so
lookupBehaviorPrior(bracket, "dps", …) always returns null and no DPS
crisis-no-response event can fire) → prompt 变 → 旧缓存作废。

v42 (2026-08-30): [ROOT] context facts in the timeline (GH #24, user
ruling: root value = reachability, not DR) + three legend lines. Only roots
whose target could not reach anyone for >= ROOT_UNREACHABLE_MIN_S (3 s)
render; no candidate/accusation → prompt 变 → 旧缓存作废。

v43 (2026-08-30): five A/B-approved menu changes land together (GH #34).

1. healing-gap (HEAL-001) regated on the lowest friendly HP% reached during
   the gap instead of gap seconds — 3,000-match outcome probe:
   friendly-death-within-10s is flat across gap length but keyed on lowest
   HP <=40% 13.0% vs 40-70% 2.8% vs >70% 0.8%. HEAL_GAP_FREE_MIN_S (>=4s)
   replaced by HEAL_GAP_CRISIS_HP_PCT (<=40%, the same line as
   crisisDecisionPoints' CRISIS_HP_PCT); events gained facts.lowestAllyHp
   and sort by lowest HP ascending instead of damage descending; the legend
   now also states facts.t is the gap START.
2. cd-hoarded rewritten decision-point shaped (3,000-match outcome probe) —
   "a teammate (or you) hit a crisis while a usable major defensive CD was
   ready and it wasn't spent within 5 s", replacing the retired
   availableWindows/CD_HOARD_MIN_LATE_S shape whose own intent guard
   measured 35.6% of accusations wrong. facts change completely (lateS/
   crisisT/castT/unresolved gone; t/crisisUnit/crisisHpPct/dmg2sPct/
   readyCds/own/refDeathSpent/refDeathHeld/refN new) and only
   Defensive-tagged, non-throughput cooldowns count now.
   Crisis decision points are additionally re-anchored onto the prompt's
   render grid (crisisDecisionPoints' anchorToRenderGrid + the shared
   `gridHpPct` sampler in utils/cooldowns.ts, the same one matchTimeline's
   [STATE] tick uses): cd-hoarded's `crisisHpPct` / crisis-no-response's
   `hpPct` are now the [STATE] tick's own reading at the displayed second
   instead of the raw advancedAction sample, `t` is a whole second on both
   types (crisis-no-response used to render one decimal, e.g. `t=116.9`),
   and a crossing no whole second can see is dropped. Measured
   contradiction against the same-second [STATE] line over the 309-prompt
   A/B corpus: cd-hoarded 155/167 covered lines → 0, crisis-no-response
   7/8 → 0 (packages/eval/scripts/crisisHpStateScan.ts).
3. cd-spent-idle retired from the candidate menu (signal outcome probe
   2026-08-30, user ruling — no measurable cost): CANDIDATE_TYPE_FLAGS
   .cdSpentIdle = false, so the menu loses one type.
4. attempt-into-trinket cites the corpus outcome contrast (6.8% vs 3.8%) —
   data/outcomeRefs.ts renders the reference numbers into the fact line and
   the legend, gated by checkOutcomeRefConsistency.
5. candidate-menu time facts floor to the render grid instead of rounding
   past it (kick-eaten `t`, death `t`, missed-cleanse `t`, death-setup
   `deathT`), so a menu line's second can never sit one second ahead of the
   `fmtTime`-floored timeline marker it points at.
   菜单构成变(少一类)+ 多类 facts/legend 全变 → prompt 变 → 旧缓存作废。

v44 (2026-09-01, GH #60 phase 2): slow-defensive-response rewritten to
decision-point form. The type name is unchanged and every fact under it is
new: the retired predicate judged the UNBOUNDED enemy-CD builder window
(corpus p50 21.6 s) with `damageRatio >= 1.5`, asked only whether the
HEALER OWNER reacted within 8 s, and rendered
enemyCds/windowEndT/damageK/dmgRatio/reacted/delayS/reactSpell. The new one
(analysis/burstWindowDecisionPoints.ts + candidates/burstWindowResponse.ts)
judges a per-exchange BOUNDED window, asks whether ANY friendly answered,
gates feasibility on the PRESSURED friendly (their own tool, or a
teammate's ally-reaching one, and that unit not hard-CC'd for the whole
8 s), triages on that friendly reaching CRISIS_HP_PCT or a death in the
window, and renders
t/leadCd/leadCdId/casterSpec/caster/extras/pressured/pressuredHpPct/
pressuredHpT/diedInWindow plus the corpus reference
(refN/refDeathResp/refDeathNoResp/refTop/cellKey/fellBack) from
data/burstWindowPriorGenerated.json. Power Infusion (10060) can no longer
open a window at all. Old caches carry the retired facts under the same
type name, which the new legend does not describe — they must be void.

v45 (2026-09-01, GH #60 phase 2c): two approved doors narrow which burst
windows reach the menu. The facts are unchanged — the POPULATION is not,
so a v44 cache carries slow-defensive-response lines this build refuses to
produce (and one of the two, the contrast door, is now a hardFailure in
checkBurstWindowRefConsistency, i.e. a v44 line replayed against a v45 gate
goes red).

1. Minimum-contrast door (data/burstWindowPrior.ts's
   BURST_REF_MIN_CONTRAST_PP = 3 + burstRefClearsMinContrast, imported by
   both the producer and the gate): a window only becomes a candidate when
   the reference cell it would quote — after fallback resolution — shows
   the no-response population dying at least 3 pp more often. On the v44
   corpus build 8 of 56 rendered lines (14%) quoted a flat or REVERSED
   contrast, i.e. cited numbers arguing against their own accusation.
   The lookup also moved BEFORE the per-round cap, so a door-failing
   window no longer consumes one of the two slots.
2. HP-drop door (BURST_TRIAGE_MIN_HP_DROP_PP = 15, in the engine): triage
   additionally requires the pressured friendly to have LOST >= 15 points
   of maximum health inside the window (new BurstFriendlyOutcome.startHpPct
   / startHpSec, same gridHpPct sampler as minHpPct). Without it the type
   fired on somebody who was already low when the burst opened — a
   sentence about the previous exchange. The reference table is untouched:
   it is built over FEASIBLE windows and never reads `triaged`.

v46 (2026-09-01, GH #60 follow-up — the POSITIVE side): the match timeline
gained `[BURST ANSWERED]` context lines. Same engine, opposite sign: a
window that `burstWindowDecisionPoints` marks feasible AND answered (the
exact complement of what makes slow-defensive-response fire) is credited
with one descriptive line at its start second —
"enemy opened <leadCd>(+<extras>) (<spec> <caster>): <responder> answered
with <spell> in <latency>s; <pressured> bottomed at <minHp>%", plus
"— <name> still died" when the pressured friendly died anyway. It is NOT a
candidate, carries NO corpus reference numbers (the kick-eaten A/B showed
per-line references inflate whatever they touch) and never reaches the
menu, mistakes.ts or any verdict surface.
Volume is capped: 71.4% of bounded windows are answered, so
context/burstAnswered.ts renders at most BURST_ANSWERED_CAP = 2 per round,
selected by danger (a death in the window first, then the lowest grid min
HP), and only when the pressured friendly's min HP reached
BURST_ANSWERED_MAX_HP_PCT = 60 or lower. A two-line legend is appended to
the timeline header only when at least one such line renders.
Measured on the 309-prompt findings corpus: 205 of 309 prompts gain lines
(89 with one, 116 with two), 321 lines total, +0.86% tokens; every other
byte of every prompt is unchanged (diff: 731 insertions, 0 deletions).
The prompt text changed, so the version rolls; old caches carry no
[BURST ANSWERED] lines and must be void.

v47 (2026-09-02, GH #60 tail — chg9): three coupled changes, all of which
move rendered text or the candidate population, so v46 caches are void.

1. Teammate reachability gate on burst-window feasibility branch (b):
   a teammate's ready ally-reaching tool now counts only if the teammate
   could DELIVER it to the pressured friendly at the window-start render
   second — `canReachTargetAt` (the [ROOT] work's per-second reach
   predicate, rootReachability.ts) with per-spell official range
   (`externalReachYards`) and LoS-not-disproven; missing position data
   fails OPEN (missing data must not manufacture infeasibility).
   Archive: feasibility 90.6% → 88.8% (windows with no new-table id:
   88.7%). Corpus: slow-defensive-response 39 → 36 lines; the same gate
   also narrows which windows earn [BURST ANSWERED] credit.
2. ONE canonical offensive-cooldown table (`OFFENSIVE_CD_SPELL_IDS`,
   spellDanger.ts): union of the two former disjoint tables (41 ∪ 34,
   overlap 19) minus 9 corpus-dead ids = 47, read by isOffensiveSpell
   (the enemy-CD window builder → [ENEMY CD] lines gain 6 previously
   invisible lead CDs: Empower Rune Weapon, Ascendance (Elemental),
   Invoke Xuen, Metamorphosis, Bladestorm, Summon Demonic Tyrant), by
   `hasOffensiveSpellActive`/`threatActiveAt` (richer aura evidence:
   missed-cleanse's timing door exempts more whole-threat windows,
   58 → 50 corpus lines) and by the position/kill-attempt threat gates
   (position-mistake 4 → 5). Closed docs/predicate-index.md's open
   "Not yet unified" divergence.
3. `burstWindowPriorGenerated.json` regenerated on the 2026-09-02 rescan
   (18,134 matches, 71,332 windows, 106 → 121 cells) — every
   slow-defensive-response line's refN/refDeathResp/refDeathNoResp/refTop
   comes from the new table, and a v46 cached line's reference numbers
   are hardFailures under the v47 `checkBurstWindowRefConsistency` gate.

v48 (2026-09-02, GH #34 chg10): behaviorPriorGenerated.json regenerated on
the render-grid-anchored decision-point population — v43 item 2's
anchorToRenderGrid changed which crossings exist (16,040 → 13,364 decision
points over the same 18,134-match archive; a dip no whole rendered second
can see no longer produces a point), so the shipped table had drifted from
the predicate that now feeds it. Same 9 cells, no death-contrast sign flip
(max move 3 pp), but every cell's nNoResp/nResp changed and refTop's
composition changed in 3 of 9 cells — every crisis-no-response line's
refNNoResp/refDeathNoResp/refNResp/refDeathResp/refTop now comes from the
new table, and a v47 cached line's reference numbers are hardFailures
under checkBehaviorPriorConsistency. Scan artifacts:
eval-private/reports/behavior-prior-2026-09-02/.

v49 (2026-09-02, GH #13 resurrection): missed-sync-window back on by
default, redesigned — canonical offensive table, t>=30s / rendered dur>=3s /
enemy-death-in-window exclusion, per-bracket corpus reference facts
(refN/refKillEntered/refKillUnentered/cellKey) with a >=3pp min-contrast
door; its legend rewritten to explain the reference.

v50 (2026-09-02, GH #31 ②): kill-window defensive roster single-sourced as
KW_MAJOR_DEFENSIVE_IDS (− Apotheosis, + Ancient of Lore) — [KILL WINDOW]/
[VULNERABLE] spans shift slightly on affected comps; official-face
replacement measured and reverted (negative result in abilityProfile.ts).

v51 (2026-09-02, GH #31 ①③): kill-window killability facts — [KILL WINDOW]
lines carry team-offensive-CD-ready / reachability / enemy-healer-state
facts, [VULNERABLE] accusations pass an accountability gate (acquitted
spans say why), and the DPS view gains the lean <kill_windows> block.

v52 (2026-09-04, GH #54 (f) / BACKLOG #38 (a)(h), user ruling option 1):
[CD PRIOR] context lines + legend — a healer owner's held save cooldown
quoted against the cohort (spec × hero tree) median trigger HP from the
corpus; context fact only, no candidate. Timeline text changes for healer
prompts wherever a cohort cell exists.

v53 (2026-09-04, GH #63): healer save-cooldown roster generated from
official data + corpus (healerSaveCdGenerated.json, 42 spells, user-signed
save_role/not_save_role) replaces the hand catalog for healer specs —
cd-hoarded / cd-waste / the [RES] ledger / [CD PRIOR] all see Healing
Tide, Lay on Hands, Revival, Chi-Ji, Rewind, Divine Toll…; [RES] snapshot
instants floored to the render grid (about 60% of [RES] lines change by
±1 s); [CD PRIOR] reference table regenerated over the new roster.

v54 (2026-09-04, BACKLOG #41, user ruling "PvP 值为官方值"): official-PvP
data batch — (2) kick school-lockout now reads the kick's own DB2 PvP
duration first (Counterspell 6 → 5 s, Axe Toss 3.5 → 3 s in the [RES]
`-Ns[kick]` field, kick-eaten lockout fact and cannot-cast exemptions);
(1) mitigation / talent-mitigation / healing-received percentages
multiplied by SpellEffect.PvpMultiplier (Divine Protection 20 → 35 %,
AMZ 15 → 30 %, PW:Barrier 20 → 40 %, …); (3) SimC hotfix overlay. One
bump for the whole batch.

v55 (2026-09-04, BACKLOG #41 (8), user rulings): usable-while-stunned table
reads the NAMED SpellMisc bits (163 ∪ 378) instead of the searched
5#3 ∪ 10#13 — 213 observed long cooldowns (Bloodlust, Tranquility, Lay on
Hands, …) stop being "usable while stunned"; Divine Shield / Ice Block /
Icebound Fortitude re-ruled not usable. [RES] locked-out CD lists, the
death candidates' usable_in_cc exemption and kill-window tiering all move.

v56 (2026-09-04, BACKLOG #41 (8), user ruling "改吧"): kill-opportunity
gated door = ANY 20–99 % wall in hand (was: stun-usable wall only) —
[kill-opportunity: …] tags, [KILL ATTEMPTS] tier labels and the
attempt-into-trinket legend change wording and membership.

v57 (2026-09-12, GH #80, user approval): new candidate types
backlash-dispel / backlash-dispel-window with their legends; the [DISPEL]
annotations for a Vampiric Touch dispel now pair the real backlash aura
(87204 Sin and Punishment) instead of the stale 34914.

v58 (2026-09-12, EliteDamit claim audit, user ruling "第一条可以按你说的做"):
talent-shared personal walls are priced on the unit that CARRIES the aura
(`IMitigationEntry.pctOnOthers` / `mitigationPctFor`): a Flameshaper's
Obsidian Scales on an ally is 15 %, not the caster's 30 % — burst-into-
mitigation stops firing on the ally copy, [KILL ATTEMPTS] stops reporting
it as "popped Obsidian Scales", the death-window mitigation audit backs
out 15/85 instead of 30/70.

v59 (2026-09-12, GH #78, user rulings): kick-priority-missed /
kick-priority-team candidate types + legends; the interrupt kit behind
[ENEMY KICK] is now the official per-player table (a Holy Paladin no
longer shows Rebuke, a Retribution Paladin only when the node is taken).

v60 (2026-09-13, GH #96 M0, user "有相应消费但没有引用的地方要补上"):
talent cooldown modifiers — Monk / Demon Hunter / Evoker class-mask
SpellMods now match (class set 53/107/224, was 126/127/128), aura 454
charge-recovery % is read, temporary-buff sources (Berserk, Incarnation,
Avatar) no longer apply permanently. <cooldowns> values move (Darkness
300 → 180 s, Paralysis 45 → 30 s, Leg Sweep 60 → 50 s, Oppressing Roar
120 → 90 s, Tip the Scales 120 → 90 s …) and false "2 Charges" inferred
from casts shorter than the old wrong cooldown disappear.

v61 (2026-09-14, GH #96 M4/M5): crisis-no-response credits a healer's own
Power Word: Shield / Void Shield, Fade, Spirit of Redemption, Reversion and
Divine Hymn as a response (user ruling "这 5 个技能我觉得都算是"), and its
reference table is rebuilt over the full new-season archive (63,303 files)
with the new "protective" category; talent duration modifiers Trueshot +2 s,
Demonic Tyrant +5 s and Boneshaker Shockwave stun +1 s change [BUFF FADED]
expiry labels and CC-break remaining time.

v62 (2026-09-14, GH #96, user rulings "天赋那边可以打开" / "30% 左右"):
talent mitigation ON — Barkskin + Oakskin 30 %, Unending Resolve + Strength
of Will 40 %, Pain Suppression 50 %, Obsidian Scales 40 %, Astral Shift 60 %,
Cloak physical 20 %, Blessing of Protection magic 15 % priced for holders;
death-window "Mitigation audit" amounts grow accordingly; burst-into-
mitigation requires the wall to cover >= 30 % of the burst (provisional,
BACKLOG #42).

v63 (2026-09-14, GH #96 M4 second ruling "一里的都算,二里的都不算" + follow-up
rules): crisis-no-response also credits Tree of Life, Bear Form, Ancient of
Lore, Ultimate Penitence, Tranquility; a trinket / break racial counts only
when a credited action follows within 3 s of the press, mobility / Blessing
of Freedom only when distance opens within 3 s of the press. Reference
table rebuilt over the full archive.

v64 (2026-09-14, GH #96 M6): cooldown SpellMods keyed by SpellCategory
(aura 341) and SpellLabel (aura 218 / 219) are compiled — <cooldowns> and
[RES] move for holders: Desperate Prayer 90 → 70 s, Dark Pact 60 → 45 s,
The Hunt 90 → 75 s, Totemic Surge totems −5 s, Counterspell −5 s …; a false
"Dark Pact 2 Charges" inferred from casts faster than the old cooldown
disappears.

v65 (2026-09-12/15, GH #78 / #80, codex rounds 1–2 + n=78 pre-registered
A/B ab/2026-09-12-backlash-kick-n100): kick-priority eligibility from the
corpus hardcast-heal table (outcome-independent; nominal cast length for
feasibility, longest continuous castable stretch for reach / lockout);
direction pre-worded facts `healTrend` / `selfDmgTrend` (backlash) and the
copy-able `refContrast` sentence (kick-priority) — 10 of the treatment
arm's 19 refuted claims were models inverting a direction the numbers
stated; kick legends no longer say the heal was "on your kill target"
(`healedWhom` is the only recipient claim), backlash legend words the
corpus cells as observed differences; VT accusations silenced by the
symmetric ledger guard; interrupt kit → official table; auditFindings drops
a finding without eventIds instead of crashing.

v66 (2026-09-15, GH #78 / #80, user ruling after the n=78 healer breakdown
"可以,都可以"): backlash-dispel no longer renders the four raw before/after
numbers (the two trend strings carry them), kick-priority-team teammates
render as "name distance" without the interrupt's name — healer treatment
responses audited 2.37 claims per finding vs 1.83 in control on an
unchanged old-line error rate, so the new lines' surface is cut.

v67 (2026-09-15, first Opus 5 baseline, run 2026-09-15-baseline): a
[DMG SPIKE] whose endpoints hide a crisis-line trough prints `, low N%
@m:ss` instead of `— healed through` (73/309 prompts); KILL ATTEMPTS
`popped …` / `saved by external (…)` and the [ROOT] `(from …)` caster no
longer print client-locale (CJK) names (230/309 prompts); the HEALER
OFFENSE [KILL WINDOW] list is chronological (112/309 were not).

v69 (2026-09-15, GH #93, user ruling 2026-09-15): the crisis response
taxonomy splits what was one "selfHeal" arm into selfHeal (healing from
spells pressed INSIDE the window) and carriedHeal (a HoT pressed earlier),
and one "kite" arm into kite and attackerMoved (the attackers walked away).
Both new arms still count as answered — no new accusations — so
crisis-no-response / slow-defensive-response counts do not move; the
reference tables' response mix does (2v2 selfHeal 0.55 → 0.24 + carriedHeal
0.31), and those shares are quoted in the candidate line.

v70 (2026-09-16, confirmatory A/B ab/2026-09-16-backlash-kick-confirm, n=40
Opus): two candidate-menu facts stop carrying a literal ", " — kick-eaten
`postKick` qualifier "(Fade; instant or channel)" (was ", "), missed-cleanse
`ownerCastingSpells` "Mind Control、Mind Blast" (was ", ") — because every
text-side facts parser splits on ", " and truncated them (13 + 2 of 40
prompts, both arms); `checkFactsBlockIntegrity` (18th hardFailure class)
now enforces the invariant, and `serializeFactsBlock` (the one facts→text
serializer) turns any remaining ", " inside a value — spell names such as
"Invoke Chi-Ji, the Red Crane", 6/288 prompts — into comma + no-break space.
The backlash-dispel `refCcExposureS` gate check
compares on the producer's `fmtFactNum` grid (was raw String → 34 + 15
false hard failures across the two runs). No candidate counts move.

v71 (2026-09-16, GH #99): timeline deduplication / noise reduction —
covers GH #99 items 1, 2, 4 (already landed 2026-09-16: Lay on Hands
dedupe, verdict labels → conditions, [OFFENSIVE WINDOW] marker) and item 3
(timeline event folding: [CC CAST] folds full target list into cast line;
self-buff [ENEMY BUFF] folds into [ENEMY CD]; [MISSED PURGE OPPORTUNITY]
folds unpurged duration and feasibility exemption into [ENEMY BUFF] or
chained [ENEMY CD]).

v72 (2026-09-17, GH #95, user rulings 2026-09-13/16/17): new healer
candidate `teammate-crisis-idle` (a TEAMMATE crossed the crisis line while
the healer was free through the window, ≤40 yd, in LoS, with mana, and
cast nothing; carried HoT ticks count as answered; reference table
teammateCrisisPriorGenerated.json, same exclusions on both populations —
codex R2) with its legend, and a new `[STACKED DEFENSIVES]` context line
(two major defensives from two players on one friendly: who cast each,
overlap seconds, what the later one blocked — a fact, no "one would have
sufficed" claim). New hardFailure class checkTeammateCrisisRefConsistency.
Enemy burst on the new card is a cue only when the press was ≥2 s before
the drop (facts.burstCue), never a counterfactual.

v73 (2026-09-17, BACKLOG #43 + #45, user rulings 2026-09-17): the crisis
response taxonomy gains `proc` — a low-HP talent that fired on its own
(Well-Honed Instincts 382912 → Frenzied Regeneration, detected by its
marker aura; Dream Guide 1278914 turned out to be a hand-out buff, not a
marker, and stays out) answers the crisis, its cast / heal is subtracted
from the owner's presses, and the crisis-no-response legend explains the
"proc" / "carriedHeal" refTop tokens. The Hunt's arena
cooldown is patched to 60 s (CORPUS_COOLDOWN_PATCHES, talents included).

v74 (2026-09-17, BACKLOG #43 second pass, user 「好 可以 看看效果」): the
proc arm grows from one marker to six after a per-id archive check
(Blood Draw, Nature's Guardian, Veteran Vitality, Golden Val'kyr join
Well-Honed Instincts as `proc`; Cauterize and Cheat Death form the new
`cheatDeath` arm — a killing blow converted, phrased as the talent saving
the player, never "nothing else needed"); heal-shaped markers supported;
the crisis-no-response legend names both tokens. Defy Fate / Purgatory /
Last Resort / Battle-Scarred Veteran / Elixir / Whirling Steel rejected
(0–15 archive events or the wrong HP shape).

v75 (2026-09-17, GH #95 hand-read): crisisDecisionPoints' `enemyBurst`
now reads the canonical 47-id OFFENSIVE_CD_SPELL_IDS instead of its own
34-id classMetadata set (the fourth consumer the 2026-09-02 unification
missed) — crisis-no-response `facts.burst` and the teammate-crisis-idle
`burst` / `burstCue` facts flip to "yes" where the enemy really pressed a
cooldown; crisis-no-response's danger ordering (enemyBurst first) can
reorder which ≤2 points survive the cap. Reference cells do not key on it.

v76 (2026-09-17, GH #95 question 4 + BACKLOG #43, user rulings 「1 我觉得
可以」「2 可以免 如果人没死的话」): new healer candidate
`teammate-crisis-triage` (the healer spent the crisis window casting on a
friendly who was NOT in crisis; reference = teammate death when the
recipient was not in crisis vs was, same feasibility door as the idle
twin; only Solo Shuffle clears the 50 floor today) with legend, desktop
card and the shared gate; cd-hoarded no longer accuses when a low-HP proc
/ cheat-death answered the crisis and the crisis unit was still alive
CD_HOARD_RESPONSE_S later. teammateCrisisPriorGenerated.json gains the
triage cells (same 116,063-round scan, no re-scan).

v77 (2026-09-18, user ruling "法术反只改成6秒"): Counterspell school
lockout 5 → 6 s as an explicit override over the DB2 PvP duration (corpus
mode 6, p50 6.10; the only kick whose p50 sits > 1 s above its official
value) — the [RES] `-Ns[kick]` field, the kick-eaten lockout fact and the
cannot-cast exemptions (dispel locked-out gate, healing-gap free time)
gain one second for Counterspell victims. No other kick moves.

v78 (2026-09-18, Curated-List gap): Zenith 1249625 — the Windwalker burst
that took Storm, Earth, and Fire's slot (137639 sits in
OFFENSIVE_CD_DEAD_IDS; the successor had never been listed) — joins the
canonical OFFENSIVE_CD_SPELL_IDS (47 → 48). Every consumer of "the enemy
opened a cooldown" now sees a Windwalker's go: enemy-CD windows, burst
windows, threatActiveAt, crisis `burst` facts. Local library, 88 rounds
with an enemy Zenith (331 casts): candidate menu 519 → 515, the whole diff
being 4 missed-cleanse accusations that fell entirely inside a Zenith and
are now exempt under the existing no-calm-second gate.

v79 (2026-09-18, offensiveCdGapScan first run, ruling delegated by the
user): OFFENSIVE_CD_SPELL_IDS 48 → 60 — Voidform (live successor of the
dead Dark Ascension), Bladestorm 446035 (the live id; 227847 is 5 % of
Arms rounds), Colossus Smash, Kingsbane, Volley, Breath of Sindragosa,
Doom Winds, Touch of the Magi, Grimoire: Imp Lord, Force of Nature, Fury
of Elune, Predator's Wake. Enemy-CD windows, [RES] `enemy:` field, burst
windows and threatActiveAt see them; owner-side they are tracked major
cooldowns. Library, 400 rounds × all owners (1,192 perspectives), rounds
where the type fired: missed-sync-window 417 → 450, position-mistake
158 → 177, slow-defensive-response 42 → 54, burst-into-mitigation
91 → 102, missed-cleanse 134 → 133; the other 16 types unchanged.

v80 (2026-09-18, codex astra review of v77–v79, 5 findings all adopted):
(1) one `effectiveCooldownSeconds` = max(cooldown, charge recharge)
replaces eleven inlined `cooldownSeconds ?? recharge` reads — Zenith
(16 / 90), Ravager, Guardian of the Forgotten Queen failed every 30 s gate,
so v78's claim that enemy-CD windows see Zenith was FALSE until now
(enemy-timeline entries on 400 library rounds: Zenith 0 → 75); (2) cast
ids with no DB2 duration get their effect aura's official duration
(Voidform 20, Colossus Smash 10, Touch of the Magi 12, Doom Winds 8, Force
of Nature 10 — zero-length windows before), Voidform aura 194249
registered for the aura-side consumers, Predator's Wake withdrawn (2 s,
no effect aura identified). Rounds where the type fired, 1,192
perspectives, v76 → v79 → v80: missed-sync-window 417 → 450 → 462,
position-mistake 158 → 177 → 179, slow-defensive-response 42 → 54 → 54,
burst-into-mitigation 91 → 102 → 100, death-setup 369 → 369 → 366.
syncWindowPriorGenerated.json is STALE against this membership until the
archive re-scan lands.

v81 (2026-09-19, commit 512470b0, codex review finding 4 closed): syncWindowPriorGenerated
re-scanned over the same archive (63,303 files) under the 60-id
OFFENSIVE_CD_SPELL_IDS (48 → 60) + effectiveCooldownSeconds — eligible windows
84,877 → 118,267 (more cooldowns count as "ready"), and the contrast the
candidate quotes barely moves: kill within 15 s, entered vs not — Solo
Shuffle 12.4 / 6.3 % → 12.1 / 6.6 %, 2v2 12.1 / 5.5 → 12.1 / 5.4, 3v3
11.8 / 5.7 → 11.4 / 5.7. missed-sync-window's reference numbers change.

v82 (2026-09-19, user ruling 「如果已经有人死了 就不要提示;其他时候可以出」):
teammateCrisisPoints excludes any crossing where a player on either side
was already dead (`priorDeath`). Full archive (63,303 files, 116,063
rounds) clean idle 534 → 39: 3v3 490 → 1 (469 of the removed points sat
behind a FRIENDLY death — the card had been describing a healer who
stopped playing a 2v3), Solo Shuffle 38 → 32, 2v2 6 → 6. No idle cell
clears the n ≥ 50 floor any more, so teammate-crisis-idle stops rendering
(user confirmed on the numbers). teammate-crisis-triage still renders in
Solo Shuffle only: 85 / 73 (44 % vs 21 %) → 71 / 60 (52 % vs 23 %).
teammateCrisisPriorGenerated.json re-scanned, predicateVersion 2.

v83 (2026-09-19, user ruling 「这个指控感觉有一点太难定义了 … 现在暂时也不做了吧」
after a two-round codex astra debate): teammate-crisis-idle and
teammate-crisis-triage retired behind one registry flag (teammateCrisis).
The only card still rendering was triage in Solo Shuffle; both reasons and
the numbers are in candidateTypeRegistry.ts. [STACKED DEFENSIVES] stays.

v84 (2026-09-20, user ruling 「修 这个功能很有帮助 图腾也可以写 … 尤其是战栗
链接和根基」, GH #100 direction 4): [UNIT DESTROYED] was dead on 12.x logs —
it keyed on UNIT_DIED, which the client writes for 5 of 13,439 listed
summoned units. It now keys on nonPlayerUnitKill (first damage event with
overkill > 0, else a bare UNIT_DIED) and names the killer from the final
blow. Same 605-match acceptance set: 24 lines (all Xuen / Darkglare, zero
totems) → 3,076, every one with a `killed by:`; 0 with an Unknown side. Also: the Grounding Totem
note on the owner's cast now renders at all (it was wired into the ledger
loop only, Grounding renders through the B38 promotion path) and reads
`[ABSORBED spells from: <caster>]` instead of printing the shield's own
name; NPC list: Psyfiend 121111 → 101398, Pit Lord 196111 → 228574,
105427 renamed Totem of Wrath, five units gone from the game removed.
Grounding note: 0 of 470 cast lines → 277. Candidate menu untouched
(findings hash and every per-type count identical).

v85 (2026-09-20, user-approved after the real-match example, GH #100):
`[CC ON TEAM]` lines gain `| Tremor Totem from N ended this CC after Ns
(cut short — it had not expired)` when a friendly Tremor Totem was cast
WHILE a fear was running and the fear ended within 500 ms of the cast
(tremorTotemBreak). The totem sources no log event; this is the one tremor
fact the log supports (removal lag p50 0 s, p90 0.02 s, 49/50). A totem
already up when the fear landed is deliberately not credited. Same
605-match acceptance set: 0 → 71 notes in 15 matches, [CC ON TEAM] line
count unchanged (69,508), findings hash and every candidate count identical.

v86 (2026-09-20, user ruling 「我觉得可以偶尔指控 另外 不指控 但是战栗 根基也可以打
看情况」, GH #100 / BACKLOG #51 — the FACT layer; the accusation is not built):
new `[ENEMY SUMMON]` line for an enemy Psyfiend / Spirit Link Totem that was
NOT killed (`not killed: 0 hits from your team` | `hit N× by …`); no lifetime
is claimed — the log has no despawn event. Tremor "depending on the
situation" = only when it did something: `[CC ON ENEMY]` gains `| enemy
Tremor Totem from N ended this CC after Ns`, and an owner fear ended that
way keeps its per-target line. Same 605-match acceptance set:
[ENEMY SUMMON] 0 → 406 lines in 52 matches (0 hits 359, hit-not-killed 47);
enemy tremor notes 0 → 124; [CC ON ENEMY] 61,812 → 61,854; findings hash
and every candidate count identical.

v87 (2026-09-20, user-approved IN PLACE OF a separate accusation candidate):
`[ENEMY SUMMON]` carries its own feasibility — `; N was in range and free to
act for Xs of its Ys` (summonReach: official DB2 duration of the summoning
spell, canReachTargetAt, buildCannotCastIntervals; healers never named;
only when the best teammate has >= 3 s). The judgement stays with the
reader. A candidate was measured first and declined: strict form 2 of 695
rounds, loose form 8 and mostly thin. Same 605-match acceptance set: 406
lines before and after, 332 now carry the clause (0-hit lines 288/359, hit
lines 44/47); findings hash and every candidate count identical.

v88 (2026-09-20, user: 「哪怕不用,也应该知道这个图腾吃掉了什么法术,所以做一下吧」):
the parser materialises the ATTACKER's spell on absorb events
(GladAbsorbEvent.attackSpellId/Name → IAbsorbEvent; spell-form only — the
event's own spellId is the shield, and slimming clears the raw params), so
the Grounding note names what was eaten: `[ABSORBED: Lava Burst (4(EShaman)),
…]`. Documents stored before this carry no such field and keep the
caster-only `[ABSORBED spells from: …]`. Same 605-match acceptance set: 277
notes, caster-only 277 → 0, spell-named 0 → 277, no other line changed;
findings hash and every candidate count identical.

v89 (2026-09-20, GH #67 S3 / BACKLOG B2, user approved): teammate DR clash
context lines and conditional timeline legend — `[DR CLASH]` surfaces when
a friendly CC landed at diminished DR (50%) within the DR reset window
(drResetMsAt, 16s/20s) because a teammate previously put the same target on
DR in that category. Capped at 3 per round; non-accusatory timing fact.
Synthetic Immune events excluded; candidate menu untouched.

v90 (2026-09-20, GH #99 item "Capacitor Totem stuns credited to a friendly
pet"): a summon-cast CC is attributed by the event's own source GUID
(ICCInstance/IRootInstance/IInterruptInstance/ICCAvoidedInstance now carry
`sourceId`), not by matching the unit NAME. Both teams field same-named
summons, so with a shaman on each side the name lookup returned whichever
"Capacitor Totem" the unit table held first: 48 lines across 16 of the 309
prompts of the 2026-09-15 Opus baseline credited the wrong side, including
`3(EShaman) ← Capacitor Totem (by 3(EShaman)'s pet)`. Library measurement
(60 matches / 195 rounds, petSideScan.ts): wrong-side credits 33 → 0;
pet-credited CC lines 583 → 622, exactly the 36 raw-name + 3 `[pet]`
credits the name path could not resolve at all; `(by N…)` player credits
7805 → 7805 and total credited lines 8427 → 8427 (no line gained or lost).
Gated by checkPetCreditSide.

v91 (2026-09-20, GH #99, second unverified contradiction — user picked
option A): the HEALER OFFENSE header no longer promises the slack gate for
the whole section. `[KILL WINDOW]` / `[VULNERABLE]` are enemy-vulnerability
spans with no own-team HP gate and `[CONTESTED]` is by construction the
70–85% band, so "slack-gated facts — team ≥85% HP …" was false for
1028/1109, 72/77 and 91/91 of those lines (288 of the 309 prompts in the
2026-09-15 baseline; 0/147 `[SLACK]` lines). The header now reads "each
line states the condition it holds under" and the gate moved onto the
`Slack time (team ≥85% HP, no enemy offensive CDs active, you un-CC-d):`
line itself, rendered from SLACK_TEAM_HP_THRESHOLD. 82-prompt local
rebuild: 82/82 prompts changed, the ONLY differing line shapes are those
two, all 370 `team min HP` tokens byte-identical; the new gate
checkHeaderHpPromise 335 violations / 73 prompts → 0.

v92 (2026-09-21, GH #69 / C2, user-approved): enriched [ENEMY DEF] and
[ENEMY TRINKET] timeline lines with factual context — [ENEMY TRINKET]
names broken CC via canonical bindBreakToWindow (±250ms tolerance,
longest duration window) and actor attribution, [ENEMY DEF] external
resolves recipient unit via recipientId, both report target HP% snapped to
displayed second (toRenderSecond) and friendly offensive cooldown presence
(requiredSourceIds = friendlyIds, debuffs filtered with isEnemyCdWindowSpell).
Timeline legends updated. promptQualityCheck extended with
checkSameSecondHpConsistency and checkPetCreditSide verification.

v93 (2026-09-22, user report): the [KILL ATTEMPTS] block no longer stamps
every attempt on a trinket-up target `locked (trinket up)` nor counts them
in its summary — at the 0:05 opener every trinket is up by definition and
the model turned that into "you should not have opened on someone with a
trinket" (user: absurd; forcing the trinket with the opener IS the play).
Lines now read `trinket up (no softer target)` or `trinket up (softer
target then: X — PRIME)` via the shared softerTargetAt predicate, the
header carries the rule, and the summary counts only attempts with a
softer alternative. `attempt-into-trinket` retired by flag. MATCH FACTS
`My team` / `Enemy team` now carry each player's name next to the spec.

v94 (2026-09-22, GH #99 item 5, user ruling): the timeline drops every
`[RES] rdy:Δ  cd:—` row whose facts the surviving text already states
(focus shown by a non-no-change neighbour, cc covered by its landing
line's duration, enemy CD derivable from an earlier [ENEMY CD] line) —
shared predicate resLedgerPrune.ts, re-checked by the 27th hardFailure
class checkResNoChangeRowsPruned. 82-prompt local rebuild: 954 → 237
no-change rows, 0 other lines lost, 146 focus / 103 CC unique facts kept.
Legend gains three lines explaining an absent row.

v95 (2026-09-22, GH #91, user value gate 「先通过了看看」): the [ENEMY DEF]
external line gains `| during it: …` — for every friendly who had hit the
recipient in the 3 s before, their damage on it while the external was up,
share of their enemy-player damage, direct/periodic split, seconds with
damage; burst-into-mitigation carries the owner's own as
facts.duringExternal when owner/target/aura interval coincide. Shared
predicate utils/externalDamage.ts, 28th hardFailure class
checkDuringExternalConsistency, flag TIMELINE_LINE_FLAGS.duringExternal.

v96 (2026-09-22, GH #91 round 2, user 「开着 做第二轮」): the during-it
contract admits school-limited walls (Anti-Magic Zone: `Nk (P%) of it in
the wall's school`), immunities (Blessing of Protection / Spellwarding:
`N hits immune`, counted as seconds) and Life Cocoon (absorbed field);
legend extended.

v97 (2026-09-22, GH #86, user rulings): summons narrowed to the functional
ones — (A) every `[UNIT DESTROYED]` line states how long the unit stood,
`, N s after it was summoned` (summon → kill; never an "expected"
lifetime, the log has no despawn); (C) the roster names a warlock's pet
by its function, `[pet: Felhunter — Spell Lock (kick), Devour Magic
(purge)]` (data/warlockPets.ts, predicate utils/warlockPet.ts). No new
line kinds; Shadowfiend / Mindbender get no "not killed" line (81 % of
casts on a 6 s pet would be noise — measured, GH #86).

v98 (2026-09-23, GH #100, user ruling): equally near samples resolve by
rule — same timestamp → the LAST line of that instant (the state after
it), equal distance → the earlier timestamp (binarySearchClosest, every
sampler). Before, array position decided and one extra sample anywhere
flipped a reading. 300 archive files: 2.46 % of [STATE] unit readings
change (median 1 pp, max 48 pp); candidate counts ±1–2. Same release:
ENVIRONMENTAL_DAMAGE parsed at its own offsets (new imports only).

v99 (2026-09-23, GH #103 class F): an enemy external seen only as the
recipient's aura (the caster's SPELL_CAST_SUCCESS missing from the log) now
gets its [ENEMY DEF] line, so KILL ATTEMPTS' "popped X" (which reads auras)
always has the timestamped line the gate expects. 605 archive files / 3,520
owner contexts: +442 [ENEMY DEF] lines, findings hash unchanged.
Same release, GH #103 A2: the dispel-backlash CC reads one table
(data/backlashCc.ts). The hardcoded "196364" || "34914" had made the
Vampiric Touch DoT itself a CC — 6,397 false lines (2,769 `[CC ON TEAM] …
[DISPEL BACKLASH CC]`, 3,628 `[CC ON ENEMY] … (0s)`) — and never saw the
real backlash, 87204 Sin and Punishment (+836 lines, 426 tagged). The tag
now names the CC: `[DISPEL BACKLASH CC: silence|horror]`. Candidates:
death-setup −12 (every one `ccAtDeath=Vampiric Touch`) +3 (healer-locked
on Sin and Punishment), position-mistake +1 (a fake 4 s VT "CC" had
exempted it). GH #103 A6: `[CC AVOIDED?] … <aura> (own|from <pid>) active`
names who provided the avoidance aura (2,667 lines: 2,586 own, 69 from a
teammate, 12 unknown — druid forms up at log start). The Grounding redirect
credit now needs the shaman's own cast within the totem's life (DB2 3 s +
0.5 s): 7 of 107 redirects were a teammate shaman's totem, −18 lines.

v100 (2026-09-23, GH #103 #216/#253, user ruling "if it came back within
a second the healer may not even have had the GCD — ignore anything
within 1 s"): every "X was ready and not pressed" claim goes through
cooldowns.ts `cdReadyInTimeAt` / deathOutcome `isReadyInTimeAt`
(REACTION_WINDOW_S = 1) — ready by t − 1 s and not pressed through t.
605 archive files: −35 `[DEATH] (Unused: …)` entries, −23 lines of
DEATHS WITH MISSED OPTIONS, −2 [DEFENSIVE AVAILABLE]; cd-hoarded −4/−4,
external-unused −3, cc-avoidable −1 (2 cap substitutions). 309-corpus
qualityCheck hard failures 2 → 0.

v101 (2026-09-23, GH #103 class A — facts the responder had to guess):
A1 `[DEATH] … | dampening: N%` (same getter as the [CD] lines; the model
quoted a neighbouring line's value); A3 an ENEMY `[KICK]` says `; back M:SS`
(official cooldown via the kicker's kit entry, as the "enemy interrupts UP"
ledger; no row → nothing); A4 `[SLACK] (…, team min HP N%)` via the shared
`teamMinHpPctOver` ("team ≥85%" had been paraphrased as "full HP"); A5
Defensive loadout entries `[…, lasts Ns]` (`buffFullDurationForCaster`;
"Cocoon covers exactly 0:47–0:54" had no duration behind it); A7 STAYED IN
lines add the nearest-enemy range when the window left the endpoint span.
605 archive files / 3,520 owner contexts: death 4,266 lines (all), kick
8,741, slack 618, loadout 18,334, stayed 1,780; 0 unexplained line
changes; findings hash unchanged; prompts +0.56 % chars.

v102 (2026-09-23, GH #103 class B): the findings prompt's HARD RULES gain
"no exclusive or universal claims (\"the only cooldown left\", \"nothing
left\", \"free the whole time\") unless the context shows nothing else
ready and nothing breaking that span" — same rule as the eval responder's
new EXCLUSIVITY DISCIPLINE (docs/commands/eval-baseline.md). Measured on the
responder only (50 matches, Opus 5.5, same regex + adjudication standard):
universal sentences 32 → 8, prompt-contradicted 7 → 1. The findings-prompt
copy is unmeasured (its explanations carry no digits and few such claims).

v103 (2026-09-23, found re-adjudicating GH #103 class B): HEALER TRAINED
lines print the healer's real CC share. "CC-locked through this" was
rendered whenever CC covered ≥ half the camp (and got quoted as "CC-locked
the whole time" beside the owner's own cast), and "no CC on the healer
during this window" whenever it covered less — including 1–4 s stuns.
605 archive files: 235 → `CC'd Ns of Ms — team must peel (mostly could
not self-reposition)`, 857 of 1,331 "no CC" lines were false → `CC'd Ns
of Ms`, 474 genuinely no CC unchanged; no other line changed.

v104 (2026-09-23, GH #83, user ruling "戒律牧46码必须修 看天赋修 … 其他射程
距离的也修"): every "could this player reach" range is the caster's —
official DB2 range + the range talents they hold (utils/spellRange.ts):
kicks, externals, cleanse / purge reach, healer reach. 602 archive files
(1,022 rounds, 2,827 owners), same code otherwise (measured on the v100
base, before GH #103's v101–v103 landed): 139 context lines gain
"no purger/dispeller had range/line of sight — not actionable" (Purge and
Dispel Magic are 30 yd, Preservation cleanses 25–30, not 40) and 5 lose it
(Purify 46 with Phantom Reach, druid cleanses 45); missed-cleanse
dps 269→267 / healer 260→257; kick-priority-missed dps 87→90,
kick-priority-team dps 70→71 / healer 67→69 (kick range talents: Charging
Bash, Improved Disrupt, Sniper's Advantage, …); 3 [BURST ANSWERED] lines
(a Pain Suppression from 40–46 yd now counts as reachable).
Same version, same batch — arena geometry checked against the game's own
verdicts (losGroundTruthScan.ts): Ruins of Lordaeron's walkable tomb
answers "unknown" when a unit stands inside its outline (false "blocked"
10.6 % → 2.8 % on a held-out sample), Dalaran Sewers' pillars redrawn as
diamonds (3.5 % → 0.9 %). Same 602 files: no candidate count moves; landed
[CC ON TEAM] lines stamped "LoS blocked" 419 → 269, "target unreachable"
148 → 126, LoS-break suggestion distances on those maps shift.

v105 (2026-09-23, GH #83, user "距离都可以算进来"): [HEALER EXPOSURE]
lists an enemy CC as a threat only within that CC's own reach plus how far
its casters close in during the 2 s before it lands (utils/spellRange.ts
ccThreatRadiusYards; per-spell p85 from ccCloseInScan.ts — Kidney Shot
+14.7, Psychic Scream +12.8, Polymorph +0), not a flat 40 yd. The
class-fallback CC list now keys on aura ids with DR categories from
DR_CATEGORY_MAP (Paladin Repentance — 0 occurrences in the season — →
Hammer of Justice; Evoker Landslide, a root → Sleep Walk). 602 files:
candidate counts and findings unchanged; [HEALER EXPOSURE] lines
6,712 → 6,153, IN-LoS threat entries 26,099 → 18,555 (Psychic Scream
2,092 → 864, Intimidating Shout 1,676 → 898, Dragon's Breath 1,147 → 567).

v106 (2026-09-24): Beast Mastery Hunter is no longer a melee spec
(cooldowns.ts MELEE_SPECS; ported upstream list had it). Corpus, 605 files:
median distance to the enemy it is damaging BM 17.8 yd, MM 18.0, SV 8.6,
melee specs 4–8. Same 605 files (1,270 rounds): HEALER TRAINED lines
1,134 → 1,078 (a BM was "melee camping" the healer), SPLIT PUSH 56 → 32,
[ROOT] 4,304 → 4,221 (a rooted BM still reaches at range),
[UNCLEANSED DEBUFF] 531 → 523, STAYED IN 1,264 → 1,294 (BM owners get the
ranged positioning block); candidates dps:position-mistake 621 → 622,
healer:missed-cleanse 284 → 280, every other type unchanged.

v107 (2026-09-24): deep-dive offensive legend drops the kind=off-target /
kind=dr-clip sentence — those pack items came only from the deleted
off-target-in-window / dr-clipped-cc candidate types, so they could never
appear. First-round prompt and candidate menu unchanged; only the window
analysis's offensive deep-dive prompt text is shorter.

v108 (2026-09-24, GH #103 follow-up, user "两个议题全做" after a codex
astra round): the reaction window reaches the decision-point generators,
shaped per codex's DO-DIFFERENTLY. (1) [CD PRIOR] needs
CD_PRIOR_MIN_PERSIST_S seconds that are castable AND reaction-ready, and
says `ready from M:SS` when the cooldown came back mid-dip; (2) DPS crisis
`hasTool` uses cdReadyInTimeAt; (3) burst-window feasibility is ONE
simultaneous second in the response window (not in CC + reaction-ready +
deliverable) — it used to combine "not CC'd for the whole window", "ready
at t" and "in range at t". Burst reference table regenerated over the full
63,303-file archive. 605 files: slow-defensive-response 150 → 116 (code
+8, all later-window opportunities checked by hand; table −42: 44 lead
CDs now have their own cell with a 0–2 pp contrast, 6 own cells fell
under 3 pp); [CD PRIOR] episodes 222 → 223, 4 say "ready from".

v109 (2026-09-24, GH #70, user rulings 2026-09-19 / 2026-09-24): the
findings prompt may state observable consequences and the reason behind
advice; it still may not pin a death / loss / win on one event, claim what
would certainly have happened in this match, or infer a state the context
does not show. New OBSERVED CONSEQUENCES section (context/
observedConsequences.ts): what a team's HP did while its healer was kicked
(inside the school lockout) or CC'd >= 2 s, both teams, [STATE]-grid
numbers. 605 files (3,520 owner contexts): 48,162 [CONSEQ] lines in 3,502
contexts (kick 5,066; "no teammate dropped" 23,489); context +5.73 %;
candidate counts unchanged. Gate checkConseqHpStateConsistency (29th
class): 0 failures; a +7 pp mutation of each file's first low is caught
in 2,215 / 3,399 files (the rest have no [STATE] tick in the span).

v110 (2026-09-24, GH #105, user "修"): a CC that landed is never also
rendered as `[CC AVOIDED?] … did not land`. The Blessing of Sacrifice /
Shadow Word: Death / Tremor Totem "break" paths are gone (a break is a
landed CC cut short), and both remaining avoidance paths (buff / mobility,
Grounding Totem) drop a cast when a same-id OR same-name CC aura started
on the player within 1.5 s (cast ≠ aura ids: Holy Word: Chastise → 200200,
Ring of Frost, Maim, Mortal Coil). 605 files: [CC AVOIDED?] lines 2,667 →
2,321; same-second landed-twin contradictions 334 → 0 (new 30th
hardFailure class checkCcAvoidedLandedConsistency). Candidate menu
unchanged by this.

v111 (2026-09-24, GH #96, user "用60 2v2不管"): burst-into-mitigation's
wall-coverage door 30 % → 60 %, read from data — only above 60 % does a
wall measurably shrink the burst's HP drop against bursts into no wall
(Solo Shuffle / 3v3; 2v2 shows no cost at any coverage and is left
alone). 605 files: dps:burst-into-mitigation 163 → 35, every other
candidate count and the context hash unchanged.

v112 (2026-09-24, GH #70 tail): the deep-dive round's causation rule is
aligned with the findings prompt's (v109) — what the evidence packs show
happened after an event and the reason behind advice are allowed; outcome
attribution, certain counterfactuals and states the packs do not show are
not (causalLint unchanged). Same 90 rounds / 141 deep dives, old vs new
rule, Opus 5.5, 1,463 sentences judged blind and mixed (eval-private
runs/2026-09-24-gh70-deepdive): deep dives with >= 1 overreach sentence
71/140 (50.7 %) → 41/141 (29.1 %); consequence sentences judged partly
62 → 26, fully supported 3 → 7; unsupported sentences 30 → 26; audit
drops 1 → 0. First-round prompt and candidate menu unchanged.

v113 (2026-09-24, GH #77, user rulings 2026-09-19 / 2026-09-24): new
PEEL OPTIONS section — an INSTANT CC a teammate (or the victim) had ready
for >= 3 s on the main attacker in the 10 s before a friendly death, with
the owner free (not CC'd, not in a casting lockout), the target in range
and LoS, not CC'd / immune / at Immune DR, and no ready breaker of the
target's own (Berserker Rage on a fear). Enemy dispels not considered.
Findings prompt: one rule — an option, never a verdict. 605 files: 239
lines, 200 / 702 friendly deaths (28.5 %), gate
checkPeelOptionConsistency 0 failures; every candidate count unchanged
(findings byte-identical apart from the new rule line).

v114 (2026-09-24, GH #77 follow-up): the PEEL OPTIONS header no longer
says "An option, not a verdict" — a 6-response Opus 5.5 smoke echoed it
verbatim to the player 3/6 times ("Team option (not a verdict)"). Now:
"Use it only as an extra way the player could have taken pressure off, in
your own words", same prohibitions. Re-run of those 3: 0/3 echoes, 0
boundary breaches (none in the first 6 either). Header text only.

v115 (2026-09-24, GH #77 fix): PEEL OPTIONS measured a targeted CC's
reach as range + splash radius (spellReachForCaster, the placed-area
reach of an external) — Storm Bolt 20 + 10 yd was offered on an attacker
27 yd away. Now ccThreatReachYards (cast range, else a caster-centred
radius). 605 files: lines 239 → 235 (Storm Bolt 19 → 16, Intimidating
Shout 16 → 14), deaths with a line 200 → 196; gate 0; candidates
unchanged.

v116 (2026-09-24, GH #77 fix, codex astra round 3): a [PEEL OPTION]'s
"N% of X's damage taken" divided by the damage mapped to enemy players
only; now by ALL damage X took in the window. 605 files: 23 of 235 lines
re-priced (median −7 pp, max −19 pp, e.g. 82 % → 75 %); same lines, gate
0, candidates unchanged. A CC with no DR category now renders "DR n/a"
instead of "DR Full" (0 lines today).

v117 (2026-09-24, GH #106 step 1, user "好 做" / orphan patches "改"):
static cooldown modifiers the model was missing — cooldown rows PvP-
scaled, spec passives (SpecializationSpells) as modifier sources, per-rank
talents by COMBATANT_INFO rank, Ashamane's Guidance, Pillar of Frost 45 s /
Summon Demonic Tyrant 60 s patches. Every changed major cooldown lands on
its corpus recast floor (Divine Toll Holy −15 → 0, Exhilaration −30 → 0,
Pillar −15 → 0, Ashamane −30 → 0, Fade −5 → 0, healer PvP trinket 90 s on
all 7 healer specs). 605 files: [RES] lines 68,182 → 68,690; dps /
healer missed-sync-window +24 / +12, cd-hoarded +8 / −8, healer
cc-avoidable +7, each traced to a verified shorter cooldown; gate
failure counts unchanged.

v118 (2026-09-24, GH #77 part 2, user "先留下来吧 … 我觉得是有一定价值的"
after four codex astra rounds): new CC USE section — the owner's CC
counts (completed casts); DPS owners also get at most 2 instant-CC
[CC BOOKMARK] lines (offense: own burst on a known non-healer × a CC-able
enemy healer; defense: a teammate's [DMG SPIKE] × an attacker with ≥ 60 %
of ALL its damage), each >= 5 consecutive seconds at Full DR, with the
distance / DR / trinket stated "at <first second>". PEEL OPTIONS and the
bookmarks share utils/ccTargetState.ts, which now applies a render-second
policy (an absent-state must be absent over the whole rendered second)
and reads the same CC instances the [CC ON …] lines render. 605 files:
CC USE in 3,122 / 3,520 prompts; bookmarks in 348 of 2,263 DPS prompts
(15.4 %), 430 lines; PEEL OPTIONS 235 → 208 lines (10 of the 27 removed
sat on a rendered [CC ON ENEMY] of their own attacker; 17 fell under the
3 s door once boundary seconds were excluded), deaths with a line
196 → 176; both gates 0; candidates unchanged.

v119 (2026-09-24, found by the GH #77 CC USE gate): a CC / root /
disarm with no REMOVED event was closed at the match end — a pre-gate Sap
rendered "(276s)", a Holy Word: Chastise "(8s)", a Freezing Trap "(55s)".
Now closed at the CC's full duration for that caster
(ccFullDurationForCaster), never later than the match end — the cap
buildAuraIntervals already applied. 605 files: 47 of 3,520 contexts
change — 44 [CC ON ENEMY] durations, 28 [CONSEQ] spans re-measured (e.g.
"Freezing Trap for 55s … low 45 %" → "for 6s … low 83 %"), 18
[ENEMY TRINKET] "out of" attributions (a trinket at 0:59 is out of the
Psychic Scream, not the phantom Sap); findings byte-identical, every
gate 0.

v120 (2026-09-24, GH #106 step 2, user "好，那我们做下一步吧"): casts that
were not button presses leave the cooldown ledger — a same-named id counts
only with a cooldown of its own (ticks, sub-effects, Doom Winds pulses,
the Stasis release are out), Doom Winds' press is its buff, Radiant Glory
makes Avenging Wrath proc-only for that player (never "ready", never
"unused", procs still enter windows), and the death analysis shares the
press predicate. 605 files: Ret Avenging Wrath recast floor −55 s → 0;
missed-sync-window 1,084 → 1,100 dps / 542 → 550 healer (Doom Winds'
exact press time), position-mistake 622 → 616; "had Blessing of
Sacrifice available" at a death after an Ultimate Sacrifice press and
"cheaper available: Renewing Blaze" gone; gate failures unchanged.

v121 (2026-09-24, reliability audit A1, user "先修 bug"): kick-eaten reads
the player's REJECTED presses (SPELL_CAST_FAILED strictly after the kick,
per spell through the shared filterIntentGuardEvidence). postKick no
longer says "no cast for 5s" / "waited out the lockout" while the player
was pressing: idle + presses → "no successful cast …; pressed Nx but
rejected (…)" and rank tier 1; "waited out" only when the first
successful cast is at/after the lockout end and nothing was pressed
inside it, else "pressed … inside the lockout" / "first cast Xs later".
Legend note: never describe rejected presses as doing nothing. New gate
checkKickWaitedOutConsistency. 605 files with raw streams (as the app):
1,535 kick-eaten lines, count unchanged; waited-out → pressed-in-lockout
111, waited-out → first-cast 89, idle → idle+pressed 51; 38 owners swap
which kicks make the cap (42 idle-with-presses out, other tier-1 in);
"waited out" with X < lockout 112 → 0; match contexts byte-identical.

v122 (2026-09-25, reliability audit A2 step 1, user rulings 2026-09-24
"加 改" + 2026-09-19 "该不该救 = 伤情 × 已有保护一起看"): cd-hoarded's
response set no longer requires the cooldown to be off cooldown at the
crossing (a save pressed in the 1.5 s before it now answers it), and a
major wall friendlies had up on the crisis unit at the crossing makes the
point abstain (never "responded", never "enough"; shared
majorWallIntervals with the [STACKED DEFENSIVES] line). 605 files:
emitted cd-hoarded 2,241 → 1,858 (dps 1,157 → 967, healer 1,084 → 891):
pre-press −237 (+62 cap substitutions), wall-active −280 (+72); every
addition is a cap substitution; all other candidate ids and the match
contexts byte-identical.

v123 (2026-09-25, GH #69 v1, user "1可以 3的话我觉得有点过于宽了" +
timeline only): QUICK FOLLOW-UPS — one [FORCED TRINKET] line per round
when an enemy spent their PvP trinket inside our kill attempt on them and
the owner's own CC landed on that enemy ≤ 3 displayed seconds later
(≥ 2 s observed). Credit is for the landing timing only — never forcing,
reacting, a "full" CC, or a kill/win. The selected CC keeps its
[CC ON ENEMY] aura line (the gate's only evidence). New gate
checkForcedTrinketConsistency. 605 files / 3,520 prompts: 146 lines
(dps 95/2,263 = 4.2 %, healer 51/1,257 = 4.1 %), 56 kept aura lines,
nothing else in any context changed; candidate counts unchanged; gate 0.

v124 (2026-09-25, found via a [CC BOOKMARK] that read as a contradiction):
the owner's [YOU] [CC] line now tags a CC that did not land — MISS /
REFLECT / PARRY / DODGE / EVADE / DEFLECT → "[MISSED on X]" /
"[REFLECTED by X]" …, the unit labelled by GUID (pets never leak a raw
localized name). ABSORB stays untagged (after an ABSORB the caster's CC
aura appeared on that target within 0.5 s 957/1,072; after MISS/REFLECT/
PARRY/DODGE 0/474). A miss now belongs to the latest same-spell cast at or
before it — also for the existing [IMMUNE] tag (codex astra: a reflect of
a second Polymorph used to tag the first, landed one). 605 files: 173
contexts gained tags (MISSED 181, REFLECTED 17, PARRIED 4, DODGED 2),
no [IMMUNE] tag moved, nothing else changed; candidate counts identical;
hardFailures 4 → 4 (pre-existing [STACKED DEFENSIVES] spans).

v125 (2026-09-25): a [MISSED on X] / [REFLECTED by X] tag names its
cause when the shared avoidance sweep (the enemy summary's
ccAvoidedInstances — the predicate behind [CC AVOIDED?]) found one for
that cast: "[MISSED on 5(HPriest) — Phase Shift was up]". 605 files: 88
contexts, Phase Shift 80, Spell Reflection 14, Aspect of the Turtle 2,
Psychic Shroud 1; nothing else changed; candidate counts identical;
hardFailures unchanged.

v126 (2026-09-25): [STACKED DEFENSIVES] labels its span with the
difference of the rendered endpoints (renderedWindowSeconds) instead of
the raw 1-dp overlap ("0:34–0:38 (4.3s)" → "(4s)"; a same-second overlap
→ "for under 1 s at m:ss"); checkWindowSpanConsistency now also parses
decimal labels. 605 files: 583 lines in 497 contexts, nothing else
changed; candidate counts identical; hardFailures 4 → 0 (widened gate:
583 → 0).

v127 (2026-09-25, GH #106 step 3, user "继续做"): tri-state cooldown
readiness. The [RES] ledger reads the shared predicate (cdAvailableAt,
talent-resolved charges) instead of its own "last N casts on the observed
charge maximum", and a cooldown combat shortens prints `(a–Ns)` (certainly
still down) or `(≤Ns)` (may already be back) — and `[a–b/N]` charges —
from a corpus floor learnt and hold-out-checked per spell and spec
(cdRecastFloorGenerated.json, 21 cells). Held-out files (1,813): real
presses the ledger called certainly on cooldown 10,199 / 91,252 (11.2 %)
→ 1,693 (1.9 %). 605 files: findings byte-identical (accusations still
read certain readiness); 15,614 `(a–Ns)`, 4,336 `(≤Ns)`, 349 charge
ranges, ~14.9k fake [k/N] suffixes gone, a recast during 'maybe' is no
longer swallowed by the delta form; three legend lines; gates unchanged.

v128 (2026-09-25, reliability audit A4 + B2a): cc-avoidable offers only a
tool the healer could have pressed — no cost_norm tool (Divine Shield /
Ice Block), and the cast bar must leave the 1 s reaction window with a
GCD-free instant for an on-GCD tool (user ruling 2026-09-24 「需要满足」);
the bar starts at the cast that LANDED. death-setup trinket-early /
defensive-early retired as accusations (user ruling 2026-09-24 「改」);
healer-locked stays. 605 files: healer cc-avoidable 89 → 62, death-setup
dps 907 → 579 / healer 454 → 290 (all removed events early-kind, all
healer-locked kept); nothing else changed.

v129 (2026-09-25, reliability audit A5 + A3 + B4a): missed-cleanse's
"owner was hard casting" facts end at a cancelled cast (34 lines
corrected on 605 files); kick-eaten postKick no longer calls a PvP
trinket / break racial "acting on another school" (24 → 0) and carries
ccInWindowS (481 lines); enemy self-saves render in [ENEMY DEF]
"(self-save)" (4,332 lines) and a survived kill attempt says
"self-saved (X)" (202). Candidate ids unchanged apart from 2 kick-eaten
cap swaps.

v130 (2026-09-25, GH #106 step 3 follow-up): the recast-floor table is
learnt over every 3rd archive file (6,045) instead of every 10th — 31
validated cells instead of 21, adding Pain Suppression, Ancient of Lore,
Fury Bladestorm, Adrenaline Rush, Frost Ice Block, Lay on Hands, Oppressing
Roar, Obsidian Scales. Disjoint held-out files (1,209): "certainly on
cooldown" at a real press 1.9 % → 1.4 % (Pain Suppression 13.7 → 0.2 %,
Ancient of Lore 92.9 → 1.2 %, Fury Bladestorm 96.7 → 1.7 %). 605 files:
findings byte-identical; `(a–Ns)` 15,614 → 18,485, `(≤Ns)` 4,336 → 4,875,
charge ranges 349 → 740.

v131 (2026-09-25, reliability audit B3iv + B3 + C6 + C5): outgoing DR in
apply order (102 labels, [DR CLASH] +297); missed-sync-window merges one
lock, needs an owner free to press and counts a running burst as entered
(unique 549 → 321), its reference table regenerated under that predicate
(SS contrast 5 → 3 pp, at the door); summon CC credited to its owner in
the outgoing chains (+18 windows); Cyclone / Incapacitating Roar follow
DB2 DR categories (3,704 labels).

v132 (2026-09-25, reliability audit D1 + A2b + D4 + D2): a form-shift
rider is never a [CLEANSE] nor a missed-cleanse window (−339 lines);
crisis-no-response abstains under a major wall (12 → 9); kick-eaten
names the locked school, drops "instant or channel", and allows
out-range coaching only when the spell out-reaches the kick
(yourReachYd / kickRangeYd); mana readings skip rage/energy samples and
stored matches without powers read the raw pass.

v133 (2026-09-25, GH #106 reference tables): burstWindowPriorGenerated
regenerated on the GH #106 cooldown model (full 09-14 archive, code at
a21d066c): same 157 cells, rates move ≤ 0.01, windows +0.4 % (The Hunt at
its real 60 s). 605 files: slow-defensive-response 116 → 118 (3 in / 1 out
across the 3 pp contrast door), its quoted reference figures updated;
context byte-identical; checkBurstWindowRefConsistency 0 on the new prompts.
(sync-window and cd-trigger prior are regenerated by the reliability-audit
batch, which runs on a main that already carries GH #106.)

v134 (2026-09-25, GH #106 follow-up): Bladestorm 227847 folds into the
live id 446035 (SPELL_CANONICAL_IDS) — both sat in the Warrior roster, so
every Arms / Fury Bladestorm rendered twice. 605 files: loadout lines
listing it twice 1,188 → 0, duplicated [CD] lines 1,246 → 0,
"Bladestorm、Bladestorm" in missed-sync-window facts 9 → 0; candidate ids
unchanged; gates unchanged.

v135 (2026-09-25, reliability audit side + B3b + C2 + A2 step 2 +
B3iii): Infernal Awakening renders as CC (1,048 lines, no raw DR key);
a merged enemy-healer lock is judged at each component start; Barkskin /
Frenzied Regeneration are response-only Restoration Druid saves (never
accused); a save given to another teammate no longer answers a crisis and
the cd-hoarded line says where it went (spentElsewhere, +21); a healer's
own CD counts as team burst only if it is Power Infusion; sync-window
reference regenerated (SS contrast 3 pp, at the door).

v136 (2026-09-25, reliability round 2 W1b): enemy silences (official DR
`silence` category, not hard CC — Garrote, Strangulate, Spider Venom,
Silence, Shield of Virtue) render as [SILENCE] lines on both sides, with a
trinket-broke suffix; the same auras buildCannotCastIntervals already
locked on. 605 files: 2,362 contexts gain 11,276 [SILENCE] lines + legend,
nothing else changes; candidates identical; hard failures 26 → 26 (all the
known Guardian Spirit [RES] regression, GH #106).

v137 (2026-09-25, reliability round 2 W1a): the owner must have been
able to act. cd-hoarded needs a free second of the owner (shared
cannot-cast predicate, before their death) around the crisis (−70);
a Solo Shuffle round's events after its first death are dropped (−16);
cc-avoidable counts the owner's own CC / silence / lockout during the bar
(−18); missed-cleanse ignores dead dispellers and late-cleanse windows
compute the dispellers' lockout (−19, one [UNCLEANSED DEBUFF] line).
605 files: +27 same-type cap refills, nothing new; context gates 26 → 26.

v138 (2026-09-25, reliability round 2 W1c): death-setup healer-locked
needs ≥ 3 s of the healer's CC inside the 12 s window (not a ≥ 3 s CC
touching its edge) and the victim paying for it — the [CONSEQ] line's own
test (mateHitDuringCc: a 10-point drop inside the CC, or a death). 605
files: healer-locked 869 → 525 (230 edge-only, 114 victim not hit);
nothing added; context byte-identical.

v139 (2026-09-25): the sync-window reference table rebuilt over the FULL
63,303-file archive (the corpus of the table it replaced, 512470b0) — the
two regens before it (1fcec5e9 / 41ef7d55) used the 18,134-file manifest.
Rendered contrasts: 2v2 7 → 5, 3v3 5 → 4, Solo Shuffle 5 → 4 pp.

v140 (2026-09-25): cdTriggerPrior reference regenerated for the C2 roster
(Restoration Druid Barkskin / Frenzied Regeneration cells, +6) and the
GH #106 press matching (Lay on Hands counted under the live 471195).

v141 (2026-09-25, GH #106 follow-up): the cooldown ledger drops presses
after the round's endTime — a Solo Shuffle round's units carry the next
round's preparation phase, whose pre-gate Stasis / Ice Barrier / Shadow
Blades counted as this round's presses (Stasis recast minimum 13.5 s →
85.0 s). Recast-floor table regenerated on that ledger under a lower
quantile ladder (down to the training minimum, floors ≥ 0.99 skipped,
≥ 1 % and ≥ 3 recasts must beat the model on each half): 31 → 33
cells, Life Cocoon now has one (held-out "certainly on cooldown" at a
real press 18.6 % → 2.1 %).

v142 (2026-09-25, GH #108): a passive proc (Reclamation …) is not a
press in cc-avoidable's GCD gate, kick-eaten's post-kick casts, the
hardcast-broken test, healing-gap / [INACTIVITY] activity, the healer
cast ratio, moment snapshots and teammate-crisis owner casts.

v143 (2026-09-25, reliability round 2 W1d): a charmed (Mind-Controlled)
teammate can be freed only by a friendly offensive purge, never a
cleanse and never by themselves (386/386 corpus removals offensive);
no "[totem/pet]" tag on a controlled player. 605 files: missed-cleanse
−18 Mind Control windows, +5 refills, +1 (a Spellsteal-able miss);
gates unchanged.

v144 (2026-09-25, reliability round 2 W1e, school half): cd-hoarded
names a school-limited save (MITIGATION_TABLE mask: Blessing of
Protection, Spellwarding, Cloak, Anti-Magic Zone) only when it covers
≥ 50 % of the crisis's 2 s of damage. 605 files: cd-hoarded −104
(+20 refills); kept lines drop the mismatched save; context unchanged.

v145 (2026-09-25, GH #111 + GH #114): the shared CC evaluator reads a
cast's DR through the aura it applies (Shockwave / Capacitor Totem /
Fear no longer Full DR forever) — 605 files: 30 Shockwave bookmark /
peel lines dropped, 14 re-rendered (5 at "DR 50%"); [ENEMY DEF] prices a
self wall through wallDoorPct, the burst-into-mitigation door value —
1,544 of 20,175 lines changed % (Barkskin 20 → 30, Unending Resolve
25 → 40, Obsidian Scales 30 → 40, Astral Shift 40 → 60, self Pain
Suppression 40 → 50); the [ENEMY DEF] legend says the % may include the
caster's talents. Candidate menu byte-identical.

v146 (2026-09-25, reliability round 2 W1h i): the burst ledger skips
defensive auras our side put on the target — the owner's own Touch of
Karma tether read as "Target had a major defensive up". 605 files: 49
lines removed in 40 contexts, menu unchanged.

v147 (2026-09-25, reliability audit C4): Guardian Spirit's expired
press (Guardian Angel) comes back 60 s after the BUFF ended (less a
measured 1 s logging lag), not 60 s after the press; the death block
reads the same per-cast cooldown as the [RES] ledger. 605 files:
cooldown-ledger-consistency gate 26 → 0 (all 26 Guardian Spirit);
cd-hoarded −29, external-unused −19; 4,335 context hunks all on
Guardian Spirit, plus 17 [BURST ANSWERED] / [CD PRIOR] lines whose
feasibility now sees it on cooldown.

v148 (2026-09-25, reliability round 2 W1a follow-up): a landed ground /
AoE control on a burst caster answers the burst, feasibility also reads
silences and kick lockouts, extras say "Ns later"; burst-window reference
regenerated (C2 included; C4 regen follows). 605 files:
slow-defensive-response −51 / +34, [BURST ANSWERED] reworded in 2,392
contexts.

v149 (2026-09-26, cdTriggerPrior regenerated at a3a23a04): the [CD
PRIOR] reference catches up with the round-end ledger cut (3eb635fb) and
the passive-proc press filter (ab68f275); C4 moved no cell (Holy Priest
Guardian Spirit cells identical). 27 of the table's n values change by
1–16 (Preservation Stasis −16, Holy Paladin −1..−4), no median moves;
the rendered `(n=…)` on [CD PRIOR] lines is the only prompt text that
can change.

v150 (2026-09-25, reliability round 3 W1j): one PvP-trinket readiness
predicate (pvpTrinketRemainingSecondsAt) for the [CC ON TEAM] note, the
[DEATH] line, [HEALER EXPOSURE] and the peel / bookmark target state; a
Medallion means a DB2 Medallion item equipped or a Medallion cast (else
"no PvP trinket"); Will to Survive locks the trinket 60 s (corpus), the
other racials 30 s. 605 files: 401 contexts, [DEATH] "(PvP Trinket
available)" −74; menu byte-identical; gates 0 → 0.

v151 (2026-09-25, GH #113): kick-eaten reads both sides' pressure during
the lockout (kickPressure.ts) — lowest unit at or below the crisis line,
first death up to 5 s after, the other side's offensive cooldowns running —
and, when neither side was pressed, which of our offensive cooldowns were
ready; a kick with both sides calm and no burst ready is not listed. 605
files: kick-eaten dps 1030 → 998, healer 506 → 475 (other types and the
match context byte-identical); 560 new HP facts, 241 with a same-second
[STATE] tick, 0 mismatches.

v152 (2026-09-25, reliability round 3 W1k): a kick after an officially
channelled spell (DB2 SpellMisc "Is Channelled") had gone out is a channel
kick — kick-eaten carries phase=channel + channelS instead of a clamped
kickDepthPct, and the legend / consequence rule no longer say it "never
landed" or invite fake-casting. 605 files: 273 of 1,536 kick-eaten lines
are channel kicks, 33 lose kickDepthPct; nothing else moves.

v153 (2026-09-26, GH #115): Radiant Glory's proc Avenging Wrath (454351)
is Avenging Wrath's EFFECT for every burst consumer (offensiveEffectCdId /
isOffensiveSpell; not a press) — weighted like 31884, its own 8 s, no
"available again"; our own Ret's proc into a wall is accused like a press
(user 2026-09-26 「指控」: 1,406 / 1,406 procs follow a Wake of Ashes press
within 0.02 s). 605 files at ccb3db74: slow-defensive-response healer
101 → 129 (+33 / −5, 28 led by 454351), position-mistake dps 615 → 654 /
healer 10 → 12 (57 stayed-in), burst-into-mitigation dps 35 → 44 (all
Avenging Wrath), missed-cleanse −4 (the 08-19 timing gate now sees the
burst), cd-hoarded 9 swapped; [ENEMY CD] Avenging Wrath lines appear.

v154 (2026-09-26, reliability round 2 W1g): control cooldowns enter the
ledger by their CAST id (Freezing Trap, Binding Shot, Intimidation,
Blinding Light, Capacitor Totem, Ring of Frost were listed by aura id and
never admitted) and 14 missing control cooldowns are listed; an unmapped
cast's DR is "n/a", never "Full"; CC USE counts every Control cooldown, a
disarm only on a melee target (user 2026-09-25). 605 files at 9a39c98c:
menu identical; 3,418 contexts change (loadouts / [RES] / cast lines gain
the control kit); [CC BOOKMARK] 412 → 733; context gates 0 → 0.

v155 (2026-09-26, fake-cast contrast): kick-eaten carries the log
recorder's own cast control for the round (castCancels.ts) — hardcasts
stopped by the player (estimated median depth), enemy kicks that went into
one of those stops (kickAudit juked, by GUID, same cast instance) and when
this line's kicker was baited; the legend says a stop alone is not a fake,
the counts are round-wide, never a recommended depth or an
opponent-adaptation claim. 605 files: 933 menus change (kick-eaten lines and
legend only; other types and the match context byte-identical); 560 of
1,482 kick-eaten lines carry the facts (124 with a baited kick, 70 with no
stop). A/B v1 INCONCLUSIVE (eval-private ab/2026-09-26-fakecast-contrast),
v3 targeted check 0 misuses in 14 responses; owner ruling 「比较基础 但是
还是有一点价值 先做出来」.

v156 (2026-09-26, kick-eaten legend fixes found in the fake-cast check):
a multi-school lockedSchool lists its schools ("Chaos (Fire + Nature +
Frost + Shadow + Arcane)") — the model told a Destruction Warlock Fire stays
open after a Chaos Bolt kick; burstReady says only that the cooldowns were
ready, never that the kick slowed the team's tempo. 605 files: 933 menus
change (kick-eaten lines and legend only; other types and the match context
byte-identical); 119 of 1,482 kick-eaten lines list a multi-school lock.
Targeted check (same prompts, 2 responses each): "slowed your tempo" 4/4 →
0/4 (074, 107); "Fire stays open" after a Chaos lock 2/2 → 0/2 (114).

v157 (2026-09-26, reliability round 2 W1g defensive roster + W1e charges): the
ledger admits Greater Invisibility, Alter Time, Survival of the Fittest,
Retribution Divine Protection, Lay on Hands, Spellwarden AMS and
Transcendence: Transfer; a cast / talent overrides a stale
SPEC_EXCLUSIVE_SPELLS row (13 rows fixed); a second charge pressed inside 2 s
is kept; a DB2 shared charge pool spends both spells (Spellwarding puts
Blessing of Protection on cooldown). 605 files at fe5c1714: cd-hoarded
−177 / +187, cd-waste +158, external-unused −13 / +9, questionable-external
+6, slow-defensive-response −5 / +2; context gates 0 → 0.

v158 (2026-09-26, reliability round 2 W1f): OFFENSIVE CD OUT OF RANGE measures
each cooldown against its own caster-aware reach plus hitbox slack, abstains
on summons (DB2 SpellEffect 28) and self / pet buffs, needs every enemy
positioned and beyond reach for the whole 5 s (exact closest approach between
position events); the line states "its reach N yd". 605 files at efc522b4:
rendered lines 516 → 2, menu cd-out-of-range −343 / +1; gates 0 → 0.

v159 (2026-09-26, reliability round 3 W1a 6954): kick-priority-missed / -team no
longer credit a melee kicker with a run he could not make — roots cut the run
budget, a kicker who could not move reaches only the kick's range + hitbox
slack, and the chance must exist before the heal actually landed; roots are the
DB2 root DR class ∪ official root auras (Ice Nova, Harpoon …). 605 files at
7c6488e1: kick-priority-missed −5 / +1, kick-priority-team −4 / +3, [ROOT]
+17 lines; gates 0 → 0.

v160 (2026-09-26, reliability round 3 W1a b12b): cc-avoidable's GCD test anchors a
hard cast at its bar START, so a bar the CC interrupted (no SPELL_CAST_SUCCESS)
no longer leaves a fake "free to react" gap. 605 files at 9eb859c9:
cc-avoidable −3 / +0, contexts unchanged.

v161 (2026-09-26, sync-window table regenerated after C4 + GH #115 + W1g):
full 63,303-file archive at 47f4279b (spot-checked equal at ab72caed on 600
files / 1,658 windows). 107,357 → 107,358 windows; Solo Shuffle nEntered
−1 / nUnentered +2, every rate and contrast unchanged to 0.1 pp; the only
rendered change is the Solo Shuffle refN (50,483 → 50,484).

v162 (2026-09-26, reliability round 3 wave 2, endpoint identity): POSITIONING
STAYED IN names whoever each distance was measured to ("from X→Y (X Dyd at the
end)" when another enemy is nearest at the end), KITED labels B as the peak
("(peak at m:ss[, from Z])"), and every rendered distance is sampled on the
render grid. 605 files at ab72caed: STAYED/KITED lines 4,165 → 4,079,
position-mistake(stayed-in) 295 → 298 (−36 / +39); positioningScan G4 end
violations 350 → 0.

v163 (2026-09-26, kick-priority reference table): regenerated at 9eb859c9 (the
rooted-kicker fix e8305ed2 and everything since the 2026-09-12 table) over the
same 21,101-file every-3rd archive subset: completed 7,060 → 7,327, kicked
1,110 → 1,191; kill-target death within 10 s 11 % completed / 32 → 33 %
kicked. The kick-priority facts quote the new rates.

v164 (2026-09-26, reliability round 3 wave 2, audit 121c): a [PEEL OPTION]
row's distance, DR and target-trinket facts are one snapshot stamped with the
span's first second ("| at m:ss: D yd, DR L[, T PvP trinket …]") — DR can reset
inside the span (52 of 744 rows on the 605-file capture). The legend says the
snapshot can change later; every counted second still passed every check.
Rows 744 → 744, nothing else moves.

v165 (2026-09-26, reliability round 3 wave 2, audit 1bad): Mind Control's
possession radius (100 yd on its single-target MOD_POSSESS row) no longer adds
to its reach — kick-eaten yourReachYd 135 → 35 (130 → 30 without Phantom
Reach). 605 files: 49 kick-eaten lines change, nothing else.

v166 (2026-09-26, reliability round 3 wave 2, audit 0e06): every time fact
`t` floors onto the timeline's second (fmtFactTime) — death-setup,
burst-into-mitigation, questionable-external, crisis-no-response, and the deep
dive's item times and window bounds. 605 files: 27 menu `t` values stop
pointing one second past their timeline row, 302 change only their tenths;
nothing else moves.

v167 (2026-09-26, range audit): kick-eaten's kickRangeYd reads the kick's
cast id (kickCastSpellId) — Skull Bash 100 → 13 yd, Solar Beam 105 → 45 yd
(the effect ids carry DB2's 100 yd placeholder). 605 files: 33 kick-eaten
lines change, nothing else.

v168 (2026-09-26, user-signed verdicts): Greater Invisibility (60 %) and
Retribution Divine Protection (20 %) join the big-defensive list and the
mitigation table (kill-live-gated); Lay on Hands is signed burst-answer (data
only). 605 files: cd-hoarded 1707 → 1700, slow-defensive-response 126 → 118,
[ENEMY DEF] +996 Divine Protection lines, kill-attempt rows name it; the two
new walls make no unused-self counterfactual claim (coverage unmodelled).

v168 (2026-09-26, reliability leftovers batch 1): (1) talent replacements — a
class / hero talent that replaces a button removes it from the ledger
(hand TALENT_REPLACES: Ancestral Swiftness → Nature's Swiftness; generated
TALENT_REPLACES_GENERATED from TraitDefinition.OverridesSpellID, 18 pairs);
605 files: cd-waste "never pressed Nature's Swiftness" 12 → 0, NS [UNUSED]
in Farseer loadouts 319 → 168, Doom Winds [UNUSED] 6 → 0,
missed-sync-window −93 / +15 (phantom "ready" Doom Winds / Avenging Wrath /
Berserk under Ascendance / Sentinel / Incarnation), cd-hoarded −9 / +3.
(2) two hand cooldowns that already held a talent's reduction (Astral Shift
90, Psychic Scream 30) go back to DB2 so CD_TALENT_MODIFIERS applies once:
loadout Astral Shift [60s] → [90s] ×1,159 and [90s] → [120s] ×229, Psychic
Scream [20s] → [30s] ×3,152 and [30s] → [40s] ×510; burst-into-mitigation
±1, cc-avoidable −2 / +1, kick-priority −4 / +6. (3) proc-only activations
render as [YOU]/[TEAM] [PROC] with a conditional legend line, no
cheaper-available / [UNNECESSARY] / while-CC tag / [HEALING] block, no
defensive-timing label, no SPEC BASELINES row: Renewing Blaze 191 owner +
160 teammate lines, Radiant Glory Avenging Wrath 757 owner + 1,484 teammate
lines, SPEC BASELINES rows Renewing Blaze 114 → 0 / Avenging Wrath 162 → 0;
candidates unchanged by (3). Perspective line now reads "actions and effects
on you".

v169 (2026-09-26, reliability leftovers batch 2): (1) [BUFF FADED] says
"(ended by your own shapeshift)" when a form-bound buff (Frenzied
Regeneration, Ironfur, Tiger's Fury) on the owner is removed within 250 ms of
the owner's form removal — 17 lines on 605 files, all Frenzied Regeneration;
(2) SPEC BASELINES names the owner's rating next to the ≥2100 bracket and,
below it, says the rates are what higher-rated players do, not a norm —
2,966 contexts below, 237 at or above, 308 without a rating; (3)
hardCastOccupancyWithin pairs each bar with its own success (event identity,
consumed only when the success ends the bar), treats a same-ms success as an
instant and drops any bar whose earliest end is > 12 s away — missed-cleanse
casting facts change on 80 windows (ownerCastingPreCommitted yes → no on 62,
no → yes on 58; ids unchanged), no other candidate moves.

v170 (2026-09-26, reliability leftovers batch 3): (1) [ENEMY HARD CAST]
renders only a bar that LANDED — the same spell's first SUCCESS ≥ 0.3 s and
≤ 12 s after the START, before any later START by that enemy, successes
consumed per bar in event order — and appends "(2.5s cast, landed)";
Hot Streak instants and aborted bars no longer render: 13,297 → 2,302 lines
on 605 files (Pyroblast 9,683 → 155, Chaos Bolt 3,614 → 2,147). (2) [TEAM] [CC]
lines carry the owner's IMMUNE tag, per caster's own SPELL_MISSED stream and
cast history: 0 → 1,450 tagged casts. (3) the burst ledger skips the
caster-side copy of a redirect external (Blessing of Sacrifice on the paladin
who gave it): "active ON THE TARGET" 546 → 436. (4) [BURST ANSWERED] states
when a friendly other than the pressured unit died inside the window
("— X died inside it"): 1,303 lines. (5) enemy burst windows read the
caster-aware duration (buffFullDurationForCaster) instead of the DB2 base:
enemy-window consumers move — slow-defensive-response +16 / −9, kick-eaten
window facts on 35 ids (ids ±2/4 cap), position-mistake −19 / +17,
questionable-external −6 / +3, burst-into-mitigation −2; Demonic Tyrant's
20 s (Reign of Tyranny) now reaches those windows.

v171 (2026-09-26, range audit, GH #120): the reach table's spec passives
carry `specIds` and are owned by spec (Preservation aura +5 yd, Holy
Paladin aura +10 yd on Divine Toll — dead on arrival before), a SpellMod
on a spell only a trigger reaches is an aura's and stays out (Sniper's
Advantage), and a triggered id's placeholder range (100 / 50000) yields to
its cast's. 605 files (base 28cbee6f): missed-cleanse dps 199 → 200 /
healer 260 → 262 (Preservation cleanse reach 30 → 35), kick-eaten
yourReachYd 25 → 30 on 13 Preservation lines; nothing else, the match
context is byte-identical.

v172 (2026-09-26, reliability leftovers batch 4): (1) Cauterizing Flame out
of the healer save roster (user ruling): cd-hoarded ready sets naming it
54 → 0, cd-waste −10; the roster re-emit also admits Discipline Fade and Holy
Paladin Divine Protection (verdicts landed since the 09-25 table; user chose
to keep both): cd-waste +2 Fade, cd-hoarded ready sets +2 Fade / +7 Divine
Protection, [TEAM] [CD] Fade +530 / Divine Protection +195 lines, [BUFF
FADED] +504; (2) cd-hoarded counts the owner's control cast (a peel) or any
friendly's team save inside the response window as an answer (user ruling):
dps 893 → 666, healer 801 → 702 (−433 / +107 refills, (1)+(2) together);
(3) missed-sync-window needs the owner free for at least half of the lock,
not 1 s of it (user ruling): dps 634 → 604, healer 317 → 302 (−69 / +24).
Measured on a tree whose reach change was equivalent to b3e24b29's (12
kick-eaten yourReachYd 25 → 30 belong to that commit). Tables: sync-window
(evaluateSyncWindow shared), cdTriggerPrior (roster) on GH #115.

v173 (2026-09-26, reliability leftovers batch 5): (1) external-unused needs the
external to reach the victim at some 0.5 s sample of the free window — a
caster-centred zone (Darkness, 8 yd around the owner) by its radius, a
targeted external by its cast reach; no reach / no positions = unchanged:
dps 87 → 82, healer 110 → 109 (Darkness −4, Ironbark −1, Blessing of
Protection −1); (2) kick-eaten measures a pet kicker (Felhunter Spell Lock,
Axe Toss) from the pet's own position: nearestKickerDistYd / kickersInRange
change on 128 kick-eaten facts, ids unchanged. Context byte-identical.

v174 (2026-09-26, reliability leftovers batch 6): (1) a trinket or break racial
binds to a CC only when cast ≤ 50 ms after the CC's removal (was 250;
trinketBreakOrderScan: the trinket's own removals land within ±25 ms of the
cast, removals earlier than that ended another way, every damage break falls
before the cast): [ENEMY TRINKET] "out of X" 11,191 → 10,975 lines,
cc-avoidable 43 → 42; (2) kick-eaten's "pressed N× but rejected" counts every
rejected press (was the intent-filtered set — HoJ pressed 4× read "1x"); the
ranking keeps the filtered set: facts change on 83 kick-eaten lines, ids
unchanged.

v175 (2026-09-26, reliability leftovers batch 7): death block (round 3 N13)
— the [KILL] line names the killing blow (the overkill hit) and the largest
5 s source separately, both through the roster id maps: 675 lines; top damage
sources include the unit's own damage — "deferred X (own)" for Time Dilation
/ Stretch Time, "X (own)" otherwise (reflected own spells, Refraction,
Tempered in Battle …): 466 deferred + 1,093 own mentions; a school-limited
immunity's mitigation audit reports all damage taken and the part outside
its school: 66 lines. Codex review of batches 4–5: cd-hoarded's team-save
answers use a real TEAM_SAVE_CD_IDS (team heals + Spirit Link, Barrier, Aura
Mastery, AMZ, Rallying Cry, Darkness, Zephyr): dps 666 → 642, healer
702 → 679 (−53 / +6); external-unused samples reach only while the owner is
free; a pet kicker must have its interrupt ready at cast start.

v176 (2026-09-26, reliability leftovers batch 8): (1) [BURST ANSWERED] credits
the first response that reached the pressured unit and was still up at its
trough (an external on another unit or one that expired before the trough no
longer counts), and its latency is measured from the raw lead cast, not the
floored window second: 4,572 → 4,299 lines, "before it opened" 716 → 802;
(2) the burst ledger's "Off-target" lines skip windows where the player's
damage followed the team's focus (the enemy taking the most friendly damage)
rather than the defenseless window target: 3,559 → 579 lines, the report
card's chip reads the same flag and the shared ON_TARGET_GOOD_PCT; (3) the
KILL ATTEMPTS summary says "kills inside an attempt" and states enemy deaths
outside every attempt window: 735 contexts. Candidate menu unchanged.

v177 (2026-09-26, reliability leftovers batch 9): an aura re-broadcast is one
aura — a same-ms REMOVED → APPLIED pair of the same spell, source and target
is dropped (`dropAuraRebroadcasts`, shared by the aura interval builder, the
CC / trinket builder and the buff-fade pairing), and a second APPLIED inside
the first application's official duration with no cast of the spell by its
source (leaving stealth) keeps the interval open: [ENEMY DEF] 21,171 →
20,162 lines, "ended early" 2,103 → 1,836, "removed early" 7,083 → 5,735,
[CC ON TEAM] 69,956 → 69,538; candidates +9 (death-setup +6,
burst-into-mitigation +2, cc-avoidable +1 — merged CCs / walls reach their
thresholds).

v178 (2026-09-26, reliability leftovers batch 10): position judgements know
who moved, and nine wording / fact fixes. KITED needs the owner's own
displacement to cover half the distance opened (1,965 → 1,556 lines);
STAYED IN states "you moved N yd yourself" (2,084 lines; gate G4b) and the
header says it is about the enemy staying close; HEALER TRAINED skips campers
under our CC and needs the healer to be the camper's top damage target
(2,579 → 1,399). Burst-ledger walls say "already up" (588) or "pressed Ns
after the burst opened" (2,922); burst-into-mitigation carries wallUp
(7 before-open / 37 after). The not-ready rejection matches five client
locales and CRLF logs; kick-eaten names own-cooldown / GCD presses outside
the locked school (266). [UNCLEANSED DEBUFF] "taken in the 5s after it
landed"; pillar hints "that enemy only"; damage sources name a summon by
its owner ("5's guardian"; bare [pet] 4,305 → 5).

v179 (2026-09-26, reliability leftovers batch 11): missed-sync-window
(round 3 W1a legs). A CD that hits an enemy is ready only if its owner came
within its own reach (cdOutOfRangeReachYards) of a non-healer enemy during
the free part of the lock (82a2, fd45); a hard-cast CD whose bar STARTS
inside the lock entered it (f4eb Demonic Tyrant); one held CD across several
locks is one accusation, the later locks listed as facts.alsoHeldAt (24b6).
Per-owner menu rows: dps 604 → 506, healer 302 → 253 (unique: 47 same-hold
locks folded, 11 unreachable / bar-started, 9 cap refills).

v180 (2026-09-26, reliability leftovers batch 12): (1) death-block top damage
sources count the absorbed part of each hit — "5 — Starsurge (151k; 108k of
it absorbed)" (round 3 N13, b12b; 33,462 mentions on the 605-file slice);
(2) burst-into-mitigation accuses only a wall already up when the burst
opened — user ruling, a wall the target pressed in response is not "opened
into" (dps 44 → 7); (3) an enemy's [KILL] line names it through the enemy
roster (433 lines printed the bare, often CJK / Cyrillic, character name).

v181 (2026-09-26, GH #119): enemy bursts see effects whose only evidence is
an aura — Havoc Metamorphosis (the 191427 button never logs; a press shows as
its 200166 landing), the Eye Beam Demonic form as a MINOR burst (user ruling
「算小爆发」: Eye Beam's 30 s weight 0 — joins aligned windows, opens none
alone), a Doom Winds with no logged press; an Ascendance-granted Doom Winds
stays Ascendance's. 605 files: [ENEMY CD] Metamorphosis lines 0 → 1,447,
Doom Winds 37 → 132, aligned burst windows 11,472 → 11,659; candidates
position-mistake dps 290 → 292, missed-cleanse dps 200 → 198 / healer
262 → 258, slow-defensive-response 125 → 128, kick-eaten dps 1001 → 1003 /
healer 483 → 487; kick-eaten burst facts name a Metamorphosis on 161 rows.

v182 (2026-09-26, reliability leftovers batch 13): four outcome fact lines
(user ruling): [GROUNDED] a control eaten by a Grounding Totem (504);
[REFLECTED] a reflected control, or a reflected damage spell that came back
for >= 5 % of the caster's max HP (672); [CC REMOVED] a control removed by
Blessing of Sanctuary (786); [REJECTED] the owner's runs of >= 3 presses
refused for range / movement / line of sight.

v183 (2026-09-26, reliability leftovers batch 14): [RES] lists the owner's
own interrupt (own or pet, official kit ownership) and a Death Knight's Death
Grip — user ruling; they sit under the major-CD floor and were invisible
(f4eb Spell Lock, f4da Counterspell). [RES]-only: no other consumer sees them.

v184 (2026-09-26, codex counterexamples to batch 10): HEALER TRAINED names
the in-radius camper with the most seconds whose main target was the healer
(a nearer off-target melee no longer hides it; 1,399 → 1,423 lines); a
summon's owner is never matched by a short name both rosters share.

v186 (2026-09-27, GH #119 follow-up, user 「都做了吧」): the aura twins of
three canonical casts are read — Summon Infernal 1122 → 111685, Arcane Surge
365350 → 365362, Elemental Ascendance 114050 → 1219480. A pressed twin
keeps its cast and takes the aura's end (Summon Infernal was 0.25 s — DB2's
cast row — now its 30 s), and the aura path sees all three; an aura with no
press is a minor burst "(no press)" (weight 0, availability ?). 605 files:
enemy Summon Infernal "(Ns left)" entries 16 → 1,283, "[friendly offensive
CD active]" 22,672 → 23,107, windows unchanged 11,659; missed-cleanse dps
194 → 190 / healer 257 → 255, kick-eaten dps 1003 → 1004 / healer 487 → 488,
position-mistake dps 292 → 293.

v187 (2026-09-27, agy review of batches 11–14): absorbed-hit attackers named
by GUID (1,228 "Unknown" → 11) and swing absorbs merged into the Melee line;
missed-sync-window folds a later lock only with the same ready set and needs
a living non-healer enemy; reflect damage counts only what the reflect sent
back ([REFLECTED] 773 → 728); Sanctuary CC caster by GUID.

v188 (2026-09-27, codex review of batches 8–9): group externals (Spirit Link,
Barrier) answer a burst; one latency clock for landed controls; "outside every
attempt window" is a time test; a cast whose aura has another id (Fear) is a
real recast; APPLIED-then-REMOVED at one ms is a real end.

v189 (2026-09-27, codex post-hoc review of batches 11–13, agy re-review of
batch 14): sync-window reach only while the owner can act, abstaining for a
target never positioned then; folded locks obey the Shuffle round end; the
wall-up-at-opening test on the raw offset; absorbs without an attack spell are
swings only on documents that record it; roster numbers by full name before
reaction flags; "redirected into" a Grounding Totem; one [REFLECTED] line per
channel; Sanctuary credit needs no competing break; [REJECTED] runs split by a
same-spell refusal of another kind; [RES] cooldowns and charges per owner.

v190 (2026-09-27, codex post-hoc review of batches 10 and 14): KITED needs the
owner's own opening; HEALER TRAINED names a camper for its own span; "you moved
N yd" shared with gate G4b at the rendered endpoints; a press inside the kick
lockout is never "waited out"; [RES] kicks and Death Grip carry charges and
event reductions.

v191 (2026-09-28, codex re-check of the PV189/190 judgment calls): KITED by the
owner's Shapley share of the gap change; one chain per reflected hit;
missed-sync reach abstains for a target never seen together with the free owner.

v192 (2026-09-30, triage 2026-09-29 cd-hoarded-waste H23 + H4): the
cannot-cast intervals pair an aura in log order (a same-millisecond
re-application no longer lasts 0 ms) and count enemy pets / totems as
sources (`enemySourceIds`); the cd-hoarded owner gate stops at the match
end / Solo Shuffle round-ending death. 605 files: cd-hoarded 679 → 665,
missed-cleanse 445 → 438, healing-gap 48 → 46, kick-priority −4 / +1.

v193 (2026-09-30, triage cd-hoarded-waste F-H1): cd-hoarded carries what
the owner gate saw — facts.ownerCc (the blocking CC / kick lockouts,
offsets from t) and facts.ownerFreeS (free seconds after t, cut at death
and the round end) — from the gate's own inputs (`actWindowFor`); the
legend says to coach only the free part. 605 files: ids and contexts
identical; 640 of 1,308 cd-hoarded lines gain ownerCc.

v194 (2026-09-30, triage cd-hoarded-waste F-W2 + F-W4): "never pressed"
(cd-waste, loadout [UNUSED], the low-pressure NOTE) counts a press of the
same DB2 charge pool (`cdNeverSpent`); the NOTE names only never-spent,
pressable, self-only defensives and no longer says "do NOT coach pressing
defensives". 605 files: cd-waste 983 → 938, [UNUSED] 27,145 → 26,642,
NOTE 1,033 → 938.

v195 (2026-09-30, triage cd-hoarded-waste F-H3): a crisis point's
dmg2s / attackers / school split sum the 2 s up to the HP reading
`gridHpPct` used (`gridHpSample`), never past the anchor second, instead
of the 2 s up to the whole second; legends say so. 605 files: cd-hoarded
+16 / −11 (10 up / 5 down across the dangerous floor, 6 swaps).

v196 (2026-09-30, triage cd-hoarded-waste F-S1): slow-defensive-response
carries facts.attempted — the owner's rejected presses of their
ally-reaching saves inside the judged window — with its own legend note
(the line's spell is the enemy opener). 605 files: ids identical, 4 of 131
lines gain attempted.

v197 (2026-09-30, triage cd-hoarded-waste F-H18 + F-H19 + F-H17): a
[STATE] tick at every friendly crisis anchor second (gate
checkCrisisStateTickPresent); the owner's casts on the crisis unit stay
unfolded inside a cd-hoarded window; Alter Time's return is rendered
(`| returned +Ns`, a [TEAM] return line). 605 files: menus identical;
crisis lines without a tick 735 → 0; [STATE] +2.1 %, [YOU] [CAST] +5.8 %;
returns rendered 0 → 553.

v198 (2026-09-30, triage cd-hoarded-waste F-H2 + F-H5 + F-H7 + F-H9,
user rulings of the same day): cd-hoarded states when a rejected press
happened and the free time after it (facts.attemptedAt,
facts.freeAfterAttemptS — the legend forbids "held" only below
REACTION_WINDOW_S), the window really left (facts.windowS), and saves
the crisis unit or another teammate pressed (facts.crisisUnitSaved,
facts.teamAnswered — stated, not credited). 605 files: ids identical,
634 of 1,313 lines gain facts.

v199 (2026-09-30, triage cd-hoarded-waste F-W1, ruling R7 = A): cd-waste
says "never successfully cast" and carries facts.attempted (rejected
presses up to the owner's playable end); audit downgrade. 605 files: ids
identical, 15 of 938 lines gain attempted.

v200 (2026-09-30, triage cd-hoarded-waste F-H21, ruling R11 = B): one
decision, one card — a cd-hoarded card for an external-unused card's
victim within 5 s of that death (on the render grid) is dropped; the
external-unused card stays. 605 files: cd-hoarded −63, nothing added.

v201 (2026-09-30, triage cd-hoarded-waste F-H6, ruling A8): a cooldown
the owner could not pay for at any mana sample in [t, t+5]
(`affordableWithin`, shared with [RES] F-C3) is not named ready by
cd-hoarded. 605 files: cd-hoarded −1, nothing added.

v202 (2026-09-30, triage cd-hoarded-waste F-H10, ruling A9-1): Emerald
Communion is a team heal / save (TEAM_HEAL_CD_IDS): its press answers a
teammate crisis and it can be named ready for one. 605 files:
cd-hoarded +9 / −10, slow-defensive-response −1.

v203 (2026-09-30, triage cd-hoarded-waste F-H16, ruling A9-2): Mass
Invisibility is a Defensive in the Mage ledger and can be accused; for a
teammate it counts only with PvP talent 415945 (`cdCanHelpAnotherUnit`).
605 files: cd-hoarded +31 / −13, cd-waste +51.

v204 (2026-09-30, triage cd-hoarded-waste H15, ruling A9-3): Feign Death
is in the Hunter ledger; its Survival Tactics aura is activation AND
ownership evidence (`AURA_ACTIVATION_PROVES_BUTTON_IDS`); it is a
response only (`RESPONSE_ONLY_DEFENSIVE_IDS`) — a press answers the
owner's own crisis, no accusation or `cheaper available:` names it.

v205 (2026-09-30, triage cd-hoarded-waste F-H16 follow-up, user ruling):
cd-waste never names Mass Invisibility (`CD_WASTE_EXCLUDED_IDS`) — it is
accusable in cd-hoarded only. 605 files: cd-waste −51.

v206 (2026-09-30, triage cd-hoarded-waste F-H20, user ruling): the
crisis school gate reads `saveSchoolMask` — the signed MITIGATION_TABLE
mask, else the DB2 absorb mask — so Anti-Magic Shell (0x7e) is a ready
save only for a crisis at least half magic. 605 files: cd-hoarded −7 / +3
(cap substitutions), 1 line loses AMS.

v207 (2026-09-30, triage G7-P1: enemy-def F-E10b + missed-cleanse F-P4):
Heroism 204362 (the Alliance PvP-talent twin of Bloodlust 204361) is an
offensive buff in SPELL_CATEGORIES — enemy Heroism renders as [ENEMY CD]
and feeds the offensive windows; a purge of it is High ([ENEMY PURGE]).

v208 (2026-10-01, the user's own 3v3 loss review, rulings 2026-09-30):
3v3 menu stops at the first friendly death (playableEndMs, healing gaps
clipped there too); [IMMUNE] only for a player / the cast's own target;
a Spirit of Redemption carrying Divine Hymn gets no `cheaper available:`;
KILL WINDOW free ≤ window; aura cap ranks offensive CDs; audit drops a
finding with no string title/explanation. Numbers in the commit.

v209 (2026-09-30, triage enemy-def F-E27): a control that reaches a
Grounding Totem as an IMMUNE miss with no cast aimed at the totem (a
trap) is a redirect too (`groundingRedirects`, shared by [GROUNDED] and
the shaman's [CC AVOIDED?] credit).

v210 (2026-09-30, triage enemy-def F-E14, ruling A30): a friendly whose
only hits on the target in the 3 s before an ally-applied external were
periodic now qualifies for `[ENEMY DEF] … | during it:` (and the owner's
burst-into-mitigation `facts.duringExternal`).

v211 (2026-09-30, triage enemy-def F-E28, ruling A28): a friendly
[DEATH] line's trinket tag reads `(PvP Trinket available; no breakable
CC in the last 10 s)` unless a [CC ON TEAM] instance on them rendered
≥ 2 s overlaps the 10 s before (`breakableCcBeforeDeath`, gate
`checkDeathTrinketCcConsistency`).

v212 (2026-09-30, triage sync-burst F-B3 / F-B7 / F-B4): [BURST ANSWERED]
prints its bottom's second (`bottomed at P% at M:SS`, gate
`checkBurstAnsweredBottomConsistency`); another friendly's self-only heal
CD is not credited; a pre-opener aimed control whose aura was gone at the
lead cast is not credited (`aimedControlUpAt`). `responded` unchanged.

v213 (2026-10-01, triage cd-hoarded-waste F-H12, ruling C1): a GCD reject
of a cooldown ready at that press and never cast later in the window is
an attempt in cd-hoarded's `facts.attempted` (accusation not waived).
605 files: 4 cd-hoarded lines gain it, no id changes.

v214 (2026-09-30, triage res-readiness F-C16 / F-C17): a legend line for
`next spike in Ns on X` (hindsight) whenever one is rendered; the
per-cast [YOU] [CAST] legend only for healer owners (its emitter's gate).

v215 (2026-09-30, triage G7-P3: res-readiness F-C2 + enemy-def F-E8 /
F-E10, rulings A26 = A, A27 = B): the [ENEMY CD] cast ordinal reads
`(cast k of N)` (`[k/N]` is the charges notation), with a legend line; an
enemy healer's throughput majors (ENEMY_HEAL_CD_IDS: the team heals,
Apotheosis, Serenity, Spirit of the Redeemer, Time Spiral, Stasis) and
Avenging Crusader render as `[ENEMY HEAL CD]`, outside every burst window.

v216 (2026-10-01, triage hp-state F-S1): a defensive whose official
targeting cannot reach an ally renders its HP part on the caster
(`rendersOnCaster`) — Survival of the Fittest's [YOU] [CD] line reads
`(self: N% HP, …)` instead of its cast target's HP. 605 files: 474 lines,
no id changes.

v217 (2026-10-01, triage hp-state F-L1 + other F-O3): the HP trail under a
death line reads `HP (T = m:ss, the death line's second): …` and samples
with HP_SAMPLE_RADIUS_MS; the missed-sync-window legend calls
facts.cellKey a game mode, not a rating tier. 605 files: 4,266 trail lines
reworded, 0 values, no id changes.

v218 (2026-10-01, triage position F-J1): [REJECTED] runs recognise the
zh-TW, es-MX, fr-FR and ru-RU client strings for out of range / moving /
line of sight (official GlobalStrings). 605 files: +69 lines in 31 owner
files, no id changes.

v219 (2026-10-01, triage other F-O8): Alter Time's loadout label reads
`lasts 10s` (the official duration of the aura 342246 the press 342245
applies; the press row's 20 s was printed). 605 files: 1,512 loadout
lines, no id changes.

v220 (2026-10-01, triage other F-O1, ruling A59 = C then A): no `[MATCH
PATTERN]` header — its labels came from a different clustering run than
the model (`ARCHETYPE_LABELS_MATCH_MODEL` false;
test/archetypeLabelAlignment.test.ts requires the flag to equal the
computed alignment).

v221 (2026-10-01, triage other F-O13 + F-O14): a Blessing of Freedom /
Tiger's Lust cast on a teammate is not the caster's own `[CC AVOIDED?]`
tool; a channel whose own aura ends within 250 ms after a CC lands on the
owner reads `[channel cut by CC after N.Ns]` on its [YOU] [CAST] line
instead of `[cast succeeded before CC landed]`.

v222 (2026-10-01, triage pets-summons F-PS1): the roster `[pet: …]` tag
lists every permanent pet a warlock ran, in order (`Sayaad — …; Felhunter
from 0:36 — …`), from Pet- GUIDs only — a temporary Creature- summon no
longer names the pet.

v223 (2026-10-01, triage crisis-external F-C1, ruling A48 = C):
crisis-no-response says "did not answer it by this measure", not "did
NOTHING", and its facts carry what the owner pressed — selfHealPct (fresh
self-heal landed, % of max HP), selfHealCasts and dampeningPct. Predicate,
ids and the reference table unchanged.

v224 (2026-10-01): triage kick-eaten F-K14a. An enemy interrupt the game
rejected as IMMUNE on a friendly player is a timeline line:
`[KICK] <kicker>'s <Kick> on <victim> missed — IMMUNE (<aura>)`. The
aura is named only when DB2 marks it interrupt-immune and it covered the
miss (shared pairing `buildAuraIntervals`); two at once are both named
("A + B"); none known = bare IMMUNE.

v225 (2026-09-30, triage death-kill F-B1): a [BUFF FADED] buff removed
from the owner ≤ DEATH_CASCADE_MS (100 ms, editorial) before the owner's
death reads `(removed at your death)`, not "ended early" / "own
shapeshift"; a removal from a teammate keeps its cause (codex c2).

v226 (2026-09-30, triage sync-burst F-B6 / F-B8): a death in a burst
window's last rendered second counts (`died`, hence `deathsInWindow` /
`anyFriendlyDeath` / the death suffix); a landed control is timed from a
cast aimed at its target (or of its own spell) before any untargeted cast.

v227 (2026-09-30, triage sync-burst F-S2 / F-S6 / F-S7): the
missed-sync-window line gains facts pressedAfter (a ready CD pressed ≤ 2 s
after the lock, A36 = A), readyFrom (a CD back within the 2 s lead or
mid-lock, raw return), holderCc (the holder's own cannot-cast intervals
in the lock) and enemyMinHpUnit, with legend sentences. Ids unchanged.

v228 (2026-09-30, triage sync-burst F-L4 / F-L7): a multi-CD burst
ledger header gives each CD its own span (`Name m:ss–m:ss`); the KILL
SEQUENCE `[ENEMY CD]` line gives each CD cast after the window's first
second its own `@m:ss`.

v229 (2026-09-30, triage missed-cleanse F-P3 / F-P2 / F-P1, ruling A18):
[MINOR DISPELS] parts list their casts (`Spell ×N (m:ss removed names; …,
+N)`, ×N = casts); a healer owner's cast line annotates every removal it
matched; the owner's Critical/High purges render as [PURGE] unless that
same match put them on a healer cast line (`purgeMatchesCast`).

v230 (2026-09-30, triage res-readiness F-C10, ruling A47): the kill /
vulnerable window's team damage (bursts, `team damage Nk`) counts owned
pets and guardians, attributed by source GUID (`summonOwnerById`).

v231 (2026-09-30, triage res-readiness F-C1, ruling A45 = A): a press
is spent from the second it is rendered at (`pressSpentBy`: floor(press)
≤ t, besides the 0.5 s slack) in every availability predicate — the
cdAvailableAt family, the [RES] ledger, lastCastBefore, isAvailableAt —
so the [RES] row under a cast line no longer lists that cast ready.

v232 (2026-09-30, triage G7-P9: res-readiness F-C20 + sync-burst F-S4,
ruling A′1 = A): Army of the Dead, Dark Transformation, Bloodlust 204361
and Heroism 204362 join the class rosters (loadout, [RES], kill-window
"ready", msw entered / ready); talentModifiers.json drops Shamanism's row
301624 (replace_spell → 8, no such spell), so the lusts are pressed
buttons, not procs; datagen rejects such rows.

v233 (2026-09-30, triage missed-cleanse F-C5, rulings A40 = B / U7): a
root missed-cleanse item carries rootReachProvenS=N/M when the [ROOT]
predicate's own sweep proved the rooted player could reach their targets
on every non-hard-CC second (hard-CC seconds leave N), with a legend
sentence; the [ROOT] line and menu membership are unchanged.

v234 (2026-09-30, triage missed-cleanse F-C11 + F-C17, ruling A43 = B):
one occupancy predicate (`occupancyWithin`: hard casts ∪ Ultimate
Penitence's self-aura ∪ drinking) for ownerCasting* and the new
dispellerCasting* (ownerCanDispel=no: the least-occupied eligible
dispeller), with a legend sentence; occupancy spell names are English.

v235 (2026-09-30, triage missed-cleanse F-C13 / F-C12 / F-C14 / F-C16):
missed-cleanse facts gain coRemovesBacklash (same-type backlash debuffs on
the target, `getDispelPenalty`, ruling A44), ownerDispelSpell (the
owner's button, talent-gated), attempted (rejected cleanse presses, the
intent-guard filter), with legend sentences; drChainRisk is no for ids
no DR family claims (curses), roots keep their self-DR.

v236 (2026-09-30, triage missed-cleanse F-C6 / F-C4 / F-C7 / F-C15;
rulings A41-签, A39 = B, U4 = B-all, U6): 16 signed dispel-verdict rows
(Polymorph / Hex variants, Void Tendrils, Deathmark exit); a signed id's
missed-cleanse item is admitted by and renders its 08-19 cell (worth=,
a zero-damage must shows worth), unsigned ids keep priority= plus
verdict=unsigned; the legend names worth / verdict, calls the debuff a
"CC, root or curse" and says the owner "has no dispel spell" for it.

v237 (2026-09-30, triage missed-cleanse F-B1 / F-B2): backlash-dispel's
"every cleanse still on cooldown" reads `cleanseRecoveryOf` per dispeller
(PvP +4 s Cleanse, Purify's 2nd charge), and the point gains
cdCcBlockedS (how long the CC ran with every cleanse down), in the legend.

v238 (2026-09-30, triage missed-cleanse F-P5 + F-P7, ruling A19 = C):
the Devourer DH and every Hunter spec are offensive purgers (talent-gated
like DH); the "Critical only" gate reads each purger's purge spell DB2
cooldown (`isCdGatedPurger`, replaces the CD_GATED_PURGERS spec list:
Greater Purge 12 s and Tranquilizing Shot 10 s now gate); a missed purge
says when the purge came back, from cooldown-consuming casts
(`purgeReadyAtSeconds`: "purge on cooldown for the whole buff" /
"… at application — ready at m:ss (Ns of the buff left)").

v239 (2026-09-30, triage G7-P2: enemy-def F-E19 + res-readiness F-C15):
one "used the PvP trinket" predicate (`pvpTrinketUses`: Medallion 336126
cast ∪ Adaptation's 283167 trigger aura — the 195756 cast id is dead) for
[TRINKET] / [ENEMY TRINKET], every trinket-readiness reader, KA and
Sanctuary; Adaptation's return is its 336139 lockout interval.

v240 (2026-09-30, triage missed-cleanse F-C8 / F-C9, ruling A42): the
dispel reach sweep samples round-relative whole seconds from
ceil(applyRel) (`dispelReachSweepStartMs`), and reads the zone from
`startInfo.zoneId` so line of sight is actually evaluated (also
momentSnapshot's facts.los).

v241 (2026-10-01, triage enemy-def F-E7 / F-E4 / F-E9, rulings A11 / A20 /
U3): an enemy's absorb / heal / avoidance self-saves (Dark Pact, Evasion,
Healthstone, Ice Barrier, Death Pact …), Lay on Hands and the grips /
redirects (Leap of Faith, Intervene, Roar of Sacrifice, Master's Call)
render as [ENEMY DEF] lines and are KILL ATTEMPTS failure causes, from
enemy-only id sets no friendly roster reads. Anti-Magic Shell follows with
its school gate. Menu ids unchanged.

v242 (2026-10-01, triage enemy-def F-E5 / F-E6 / F-E12, ruling A25):
[ENEMY DEF] prints Burrow, Time Stop, Mass Invisibility, Vanish, Feign
Death, Cheat Death, Cauterize, Nature's Guardian and Guardian of the
Forgotten Queen as `immune`, and KILL ATTEMPTS reads each as a forced
immunity; an aura re-announced with no REMOVED between is one press
(`joinReappliedIntervals`), not two lines. Menu ids unchanged.

v243 (2026-10-01, triage enemy-def F-E1a / F-E1b, crisis-external F-A1b,
ruling A15): an enemy Blur / Greater Invisibility renders and counts as a
popped wall (the logged aura is resolved to its cast-keyed table row);
Anti-Magic Zone, Darkness, Rallying Cry, Spirit Link Totem and Power
Word: Barrier render `X (area)` at the cast (rulings A15, P-E1b2).
Menu ids unchanged.

v244 (2026-10-02, triage missed-cleanse F-P5 forward check, rulings
P-P5b = C / P-P5b-land): removals that are not a spec's Magic purge count
inside their own scope (`scopedPurgeToolsOf`). A Warrior holding
Shattering Throw gets `[MISSED PURGE OPPORTUNITY]` lines for immunity
shields that lasted the 3 s reaction bar plus its 1.5 s cast, read off
the throw's own cooldown and reach ("your removal for it: Shattering
Throw (immunity shields only, 1.5s cast)"); the PURGE RESPONSIBILITY
header states the scope ("CANNOT offensive purge, except Shattering
Throw: …" / "except Arcane Torrent: …" for a player observed casting it).
Arcane Torrent and Shiv never produce a line. A purge landing at the
buff's end now counts (float boundary), so those buffs no longer read
"unpurged". General purgers' lines are otherwise unchanged.

v245 (2026-10-01, triage hp-state F-T1 + enemy-def F-E20): `cheaper
available:` offers a nil-destination team save (Spirit Link Totem, Aura
Mastery …) only tools that can help another unit, and a press made while
stunned — or the press that ended the stun — only cooldowns usable while
stunned; a [CC ON TEAM] instance ended by the unit's own immunity press
reads `| <spell> broke this CC after Ns`.

v246 (2026-10-01, triage kick-priority F-P1 / F-P2 / F-P3 / F-P5, rulings
A57 = A, A'3 = A): kick-priority facts state the defenseless span the
detector used (`windowFrom` / `windowTo`), the kick's range and the melee
reach tested (`kickRangeYd`, `reachYd`), how long the kick had been back
(`kickReadyForS`), and `rooted through the cast` instead of `out of range`
for a rooted owner; legends reworded. Detector unchanged.

v247 (2026-10-01, triage hp-state F-M1): the NOTE's "lowest HP this match"
and the cd-waste pressure gate read the round only (`matchMinHpPct(unit,
combat)`), not samples logged after its end.

v248 (2026-10-01, triage G7-P4: res-readiness F-C3 + menu-coverage F-MC1,
rulings A8 / A58 / U8 / P-G7P4): [RES] `rdy:` tags a ready cooldown the
owner cannot pay for, `X(no mana a/b)`, with a legend when one is
rendered; Darkness is a Defensive (cd-waste may name it), and a positional
wall is named for another unit — cd-hoarded, [DEFENSIVE AVAILABLE] — only
when its holder stood inside the zone; a burst window is not answerable on
seconds after the pressured friendly died.

v249 (2026-10-01): triage kick-eaten F-K7d / F-K7b / F-K7c / F-K7a
(rulings C5, A32, A23, A′18). `postKick`: a spell is locked only when
every school it belongs to is locked (Starsurge under a Nature lock is a
switch, and its not-ready presses are its own cooldown); the switched
line also prints the presses rejected inside the lock; a not-ready reject
≤ 0.3 s after the same spell succeeded is a key repeat and is not
counted; "inside the lockout" ends at the first successful cast of the
locked school (not on a cast that goes out inside a holding lock: Demonic
Circle: Teleport, Holy Fire, passive rows). "Not ready" is recognised in
fr / es / ru / zh-TW logs too. Legend updated to match.

v250 (2026-10-01): triage kick-eaten F-K3 / F-K9b (rulings A31 = A,
A33 = A). `enemyBurst` / `ourBurst` name only cooldowns already running
when the kick landed (one pressed inside the lockout afterwards is not
listed, so a kick can become harmless and leave the menu), and a unit's
ticks inside an immunity are not its low HP. Legend updated.

v251 (2026-10-01): triage kick-eaten F-K5a / F-K5b / F-K5d / F-K6a /
F-K6b / F-K6c / F-K6d (ruling A12 = B with U2). New kick-eaten facts at
cast start: `sourceDistYd`, `nearestKicker`, `maxKickRangeYd`,
`sourceKickReadyAtCastStart`, `youImmobileAtCastStart`, and the single
out-range verdict `outRangeable=yes|no (reason)` the legend now gates the
"cast from outside kick range" advice on (closed, among others, by a
gap-closer used or back up at any point of the cast, a kick during the
channel, a cast range that does not exceed the kick, and another kicker
in range whose kick came back during the cast); a kicker in
hard CC or a silence is no longer counted; no `yourReachYd` for a
caster-centred spell.

v252 (2026-10-01): triage kick-eaten F-K7f / F-K13 / F-K14b / F-K4
(rulings A′2 = B, U1). `postKick` presses carry their offset after the
kick ("Riptide×3 +0.2/+0.9/+1.4s"); an empowered switching cast reads
"empowered cast"; new fact `kickImmunityEnded`; the legend says which
side was under pressure, never whom the kick helped.

v253 (2026-10-01): triage G11 kick audit — other F-O4, sync-burst F-L6,
kick-priority F-B1, kick-eaten F-K10a / F-K10b (rulings A35, A′17).
`Kicks:` — one entry per kick (Skull Bash's two ids), a landed silence
reads "silenced <target> (no cast interrupted)" — or "(their <spell> cast
did not finish)" when the target was mid-cast — and a kick into a stopped
cast that was then recast is "JUKED", not "hit nothing". kick-eaten: new
fact `stoppedJustBefore`; a cast broken by an enemy displacement is not
one of `yourCancels`; `baitedKicks` follows the juke rule.

v254 (2026-10-01): triage G16, ruling A14 = B — `burstCastSpan` loses its
10 s floor for every reader: burst ledger groups / spans / `Aligned with`,
KILL ATTEMPTS burst clusters, kick-eaten `enemyBurst` / `ourBurst`. An
instant cooldown is no longer "running" for 10 s, and a zero-length burst
(Soul Fire) prints no "No damage dealt" line. The observed-aura half of
the ruling waits for the cast→effect table (G3).

v255 (2026-10-01): triage kick-eaten F-K2 (ruling C7). Empower Rune
Weapon 47568 is no longer an offensive cooldown: the 120 s / 20 s hand
override and the Offensive tag are gone (12.x: 2 charges / 30 s, a damage
button with no aura), so it opens no `[ENEMY CD]` / `[OFFENSIVE WINDOW]`
/ `enemyBurst` any more and leaves the Frost Death Knight ledger.

v256 (2026-10-01): triage kick-eaten F-K12a (ruling A34, and the user's
2026-10-01 ruling on the exempt pool). Inside a coachability tier the cap
orders kicks by pressure (death, crisis HP, burst running, burst ready),
then time; kicks with a death or a crisis-HP fact do not count toward
KICK_EATEN_CAP and have a cap of their own (2), so a round lists at most
2 + 2 kick-eaten lines.

v257 (2026-10-01, triage enemy-def F-E15): a trinket / racial break is
credited to the active CC with the most official time left
(`bindBreakToWindow`), not the longest-running one — [CC ON TEAM] `trinket
broke this CC` and [ENEMY TRINKET] `out of X` name that CC.

v258 (2026-10-01, triage G6: other F-O6 + missed-cleanse F-C10 + pets
F-PS2): (1) an owner empower that ended in SPELL_EMPOWER_INTERRUPT renders
`[EMPOWER not released — cut short after Ns]` on its press line (it
released nothing; the parser now keeps SPELL_EMPOWER_START / _INTERRUPT, so
fresh parses only; no cause is asserted — CC, kick, movement and an early
let-go all log the same event); (2) missed-cleanse `ownerCastingS` /
`ownerCastingSpells` / `ownerCastingPreCommitted` (and a teammate's
dispellerCasting*, through `occupancyWithin`) count empowered holds
(fresh parses) and channels (every document) — `castCommitSpans.ts` —
which have no SPELL_CAST_START bar; (3) a guardian with no SPELL_SUMMON in
the round takes its owner from its advanced block (fresh parses only), so
a totem's CC gets its [CC ON TEAM] line. 605 files: ids unchanged; 77
not-released tags, 4 [EMPOWER L?] tags move to the press that released, 38
missed-cleanse items change casting facts (25 owner, 13 teammate), +3
[CC ON TEAM] lines.

v259 (2026-10-01, triage death-kill F-K3, user-approved): a hit a shield
ate is damage to the unit that was HIT — the attacker's absorb rows named
the shield's owner, so a healer shielding a teammate became the "target".
605 files: +1 burst-into-mitigation (the burst's real target sat in an
external); KILL ATTEMPTS rows 29,055 -> 28,115 with the target changed in
117 rounds, burst-ledger `Target:` changed on 314 owner files; Off-target,
[KILL WINDOW] and [VULNERABLE] damage follow.

v260 (2026-10-01, triage missed-cleanse F-C2, ruling A38 = A — reverses
adjudication #13): a damage event's effectiveAmount is the health it
removed, `amount − overkill`. The log's `amount` is already net of the
absorb; subtracting `absorbed` again under-read every partly absorbed hit
(25.9 % of player hits; +6.96 % overall, up to +19 % for specs with their
own shields) and gave hits with absorbed > amount the wrong sign. Every
damage reading moves. 605 files: menu +22 / -17 (cd-hoarded +19 -5,
slow-defensive-response +1, position-mistake +2, missed-cleanse -6,
questionable-external -6), 683 fact-only changes, KILL ATTEMPTS outcome
flips in 219 rounds (healed through 4,479 -> 3,954).

v261 (2026-10-02, triage G4 dead-at: sync-burst F-S1 + F-KW2,
res-readiness F-C4, kick-eaten F-K7e): one dead-at predicate
(`utils/unitDeath.ts`). (1) A cooldown whose holder is dead at the instant
is not "ready" for a missed-sync-window lock nor on a [KILL WINDOW] /
[VULNERABLE] line — a span whose only ready cooldown was a dead player's
stops being accountable. (2) [RES] `rdy:` / `cd:` drop a holder's entries
from the second after its death, with no `-X` for them. (3) kick-eaten
`postKick` ends at the player's death: `no cast before dying Ns after the
kick`, and a button pressed after the death is not a rejected press.

v262 (2026-10-02, triage G4 kickers: kick-eaten F-K5c, res-readiness
F-C5 + F-C5b, ruling A′16): (1) kick-eaten's cast-start kicker facts
(`kickersInRange`, `nearestKicker*`, `maxKickRangeYd`) read a kicker's
cooldown from its kicks strictly BEFORE the cast start — a kick thrown in
the cast-start millisecond was ready when the cast began. (2) `enemy
interrupts UP` on a channeled [YOU] [CD] line and [CONTESTED] `enemy
interrupts ready: N` mean usable at that instant: a dead enemy is not
listed, and a kicker inside a cast-blocking CC (a silence only for a
silenceable kick; a pet kick is asked of the pet) is not UP — when every
off-cooldown kicker is held the note reads `no enemy interrupt usable
(CC'd: X)`. A legend line is printed with the note.

v263 (2026-10-02, triage G4 kill-window readiness: sync-burst F-KW1,
res-readiness F-C8 + F-C9 + F-C12, ruling A46): one grammar for the
readiness clause of [KILL WINDOW] / [VULNERABLE] lines — `team offensive
CDs ready at M:SS: <list | none>` followed, when there is anything to
say, by one parenthesis: `may already be back: X ≤Ns` (GH #106 step 3),
`pressed at start: X M:SS`, `back inside: X M:SS`, `pressed inside: X
M:SS`. Readiness is sampled on the span start's rendered second (A46),
not the fractional start; a proc-only entry is never "pressed"; a
[VULNERABLE] acquittal with a maybe-ready cooldown reads `no offensive CD
certainly ready (may already be back: …)`. The accusation gate still reads
the certain list only.

v264 (2026-10-02, triage position F-K1, ruling A61 = A): the kill-window
`target unreachable (positions recorded)` part and the [VULNERABLE]
acquittal `target unreachable` are decided over the whole span, one
rendered second at a time — reachable as soon as any living friendly could
reach the target on any second — instead of at the span's first instant.

v265 (2026-10-03, triage G7-P6: death-kill F-T1 + hp-state F-D1): the side
of a damage source is its roster's (a charm flips the per-event flags),
and a row that flags its source or victim as a charmed player is never
same-side; Top sources / the final-5 s block / [KILL] keep enemy damage
and a Mind-Controlled teammate's hits (named as that player,
mind-controlled); a team's own redistribution (Spirit Link, Void Leech) is
not incoming pressure for [DMG SPIKE], [OFFENSIVE WINDOW], the [YOU] DPS
part or [RES] focus.

v266 (2026-10-03, triage kick-priority F-P3 / F-P5 follow-ups):
kick-priority's facts.reachYd appears only when the kicker stood outside
the kick's range and had to run; legend: kickReadyForS is absent when the
kick was never used or never ran out of charges.

v267 (2026-10-03, triage G7-P4 follow-up): the [RES] legend says a delta
row carries the (no mana a/b) tag only where the cooldown is listed.

v268 (2026-10-02): triage kick-eaten F-K9b, user ruling F-K9b-B. Only a
FULL immunity (Ice Block, Divine Shield, Aspect of the Turtle) keeps a
unit from being read as low in kick-eaten's `ourLow*` / `theirLow*`; under
Blessing of Protection, Blessing of Spellwarding or Cloak of Shadows it is
read as low again, and the legend says so. Interim until enemy-def F-E24.

v269 (2026-10-03, triage G14: sync-burst F-L2 / F-L2b, position F-S1–F-S5,
rulings A'12 / A'13 = C / A60 = B / P-G14 / F-K9b-B): a POSITIONING line's
burst target is the one of its own span (the header spike only when it
covers half the span, else the most-pressured friendly); STAYED IN states
`CC'd Ns of Ns`, `rooted Ns` (with `(Ns in all)` when both), `(you could
not cast for Ns of it)` and `(HP stayed at or above 35%)` in place of `(no
real cost)`; windows mostly spent CC'd, rooted or inside the owner's own
FULL immunity are skipped; stayed-in menu facts gain endDist / minDist /
maxDist / endEnemy / ccS / rootS.

v270 (2026-10-02, triage G3 table, ruling A10 = both): the one cast →
effect-aura table (`data/castEffectAuras.ts`, DB2-nominated by name /
trigger chain, corpus-verified — 148 casts / 189 pairs) replaces the hand
list `CC_CAST_EFFECT_AURA`. Its readers — a cast's DR category, the
control-cast sets of the crisis and burst-window decision points, the
aura-interval rebroadcast test — now also know Storm Bolt → 132169,
Freezing Trap → 203337 (Diamond Ice) and the other verified pairs.

v271 (2026-10-02, triage G3 timeline tags: enemy-def F-E25b / F-E25a /
F-E26, cc-dr F-TM1 (A53) / F-NE1 (A55), crisis-external F-T1): an IMMUNE
/ MISS logged under a cast's effect id tags the cast; a line that names
its targets says `[IMMUNE: <pid>]` for an immune player it does not name
and nothing for an unnamed non-player; a non-CC hostile press into an
immunity is tagged; a teammate's CC that missed says `[MISSED on …]`; a
teammate's ally-reaching press on another friendly names it (` →
<pid>`); an aimed owner CC with no aura and no miss says `[no CC aura
logged]`.

v272 (2026-10-02, triage G3 table consumers: res-readiness F-C23,
sync-burst F-B1): healer offense counts an owner CC cast through the cast
→ effect table (Song of Chi-Ji, Lightning Lasso, Blinding Light …: "your
CC ready", "you cast CC", the CC counts), and `[BURST ANSWERED]` credits
an aimed control only when it landed (its own aura, an effect aura, or
for an interrupt the SPELL_INTERRUPT).

v273 (2026-10-02, triage G12 cannot-cast inputs: cc-dr F-SR1 (A52) +
F-BK1, kick-eaten F-K8 (A23)): a CC / silence a unit's reflect sent back
onto it locks it — `[CC ON TEAM] … (reflected back)` / `[SILENCE] …
(reflected back)` — and counts in its DR; the dispel-backlash silence /
horror (196364, 87204) locks the dispeller; a Storm Conduit holder's
interrupted Lightning Bolt / Chain Lightning locks for ×0.6 (kick-eaten
`lockout=`, [CONSEQ], [RES] `cc:[kick]`, cannot-cast feasibility).

v274 (2026-10-02, user ruling F-BI-full): the burst ledger's "⚠ Target
was IMMUNE" (and the desktop 打进免疫 chip) counts only a FULL immunity —
Ice Block, Divine Shield, Aspect of the Turtle (`FULL_IMMUNITY_IDS`, the
F-K9b-B split). Cloak of Shadows, Blessing of Protection and Blessing of
Spellwarding show as the target's defensive ("Target had a major
defensive up"); burst-into-mitigation still ignores them.

v275 (2026-10-02, triage G9 round end: cc-dr F-CI1 / F-HG1,
missed-cleanse F-C3): one round end (`roundEndMs`: a Solo Shuffle round's
first player death, else the combat end) for `[CC ON TEAM]` / `[CC ON
ENEMY]` windows, uncleansed windows and healing gaps — a CC applied at or
after it is dropped, a removal or activity after it no longer lengthens a
window or closes a gap.

v276 (2026-10-02, triage cc-dr F-RF1, ruling A51 = A): a REFRESH of a CC
whose source cast it (its own id or through the cast → effect table) in
the 3 s before is a new CC on both sides — `[CC ON TEAM]` / `[CC ON
ENEMY]` print the second cast with its own DR, and every reader of the
instances ([CONSEQ], [RES] `cc:`, death-setup, HEALER EXPOSURE, kill-window
enemy healer DR) sees two CCs.

v277 (2026-10-02, triage enemy-def F-E17 / F-E18, cc-dr F-DA1 (A54 =
A)): a silence a trinket broke is tagged when the press is logged up to
`TRINKET_BREAK_AFTER_REMOVAL_MS` after the removal; `[TRINKET] … used PvP
trinket out of <disarm> (by X)` when the press broke a disarm; a new
`[DISARM]` line (and legend) for a disarm on any player of our team, with
the same trinket-break tail.

v278 (2026-10-02, triage position F-L1 / F-D1): `[CC ON TEAM]` drops
"LoS blocked" when the CC's targeted cast succeeded on that unit just
before (GH #83: a landed cast proves LoS), and drops the caster distance
right after a Shadowstep when it is beyond the spell's reach (the log's
stale pre-teleport position).

v279 (2026-10-02, triage cc-dr F-DU1): one CC duration formatter
(`renderedCcSeconds`, whole seconds) — the `[DMG SPIKE]` "enemy CC in
window" list prints `(2s)`, not `(1.5s)`, matching `[CC ON TEAM]`;
`[CC ON ENEMY]`, `[CONSEQ]`, `[DISARM]` and FORCED TRINKET read it too.

v280 (2026-10-02, triage G5 death setup: death-kill F-S1 / F-L2 (A16),
crisis-external F-AS1 / F-D2 (A′5) / F-D3 (A49 = B)): healer-locked names
the qualifying CC that ends latest and carries `chain` / `chainFrom` /
`lockedS` / `freeBeforeDeathS` / `landedWhileLocked`; the legend says what
the lock was (the CROSS-THEME G5 sentence); a death or death-setup after
the log owner's own death leaves the menu.

v281 (2026-10-02, triage death-kill F-D1): the "death" legend prints
only when the menu has a death and no longer defines a side=enemy death
(kill review is retired).

v282 (2026-10-02, triage death-kill F-M1, ruling A′8): the
missed-options "caster in CC / was in CC" tags ask the cannot-cast
predicate (silences and kick lockouts lock a caster), and a CC the unit
trinketed out of counts until the press in the lockout window.

v283 (2026-10-02, triage death-kill F-M2): the missed-options tail says
the longest free stretch of the last 5 s and, when a cannot-cast interval
covers the death, `then in X from M:SS through the death` (a kick lockout:
`then school-locked (X) …`), in place of `was in CC` / `caster was free`.

v284 (2026-10-02, triage cc-dr F-KS1): KILL SEQUENCE `[HEALER CC]` names
the healer's lock chain (`A → B → C (locked N of the last 12s)`, the
death-setup chain's helper `deathLockChain`), and `[DEFENSIVE AVAILABLE]`
appends the holder's `(free Ns before the death)` (F-D2's helper).

v285 (2026-10-03, triage pets-summons F-PS3, ruling A17 = A): the ENEMY
CC KIT header and [HEALER EXPOSURE] credit a summon's landed CC (a
Capacitor Totem's stun, a pet's Intimidation) to its owner, so the owner
no longer falls back to a spec template; its reach is measured from the
owner (FLAG, predicate-index).

v286 (2026-10-03, triage cc-dr F-KT1, ruling A17 / R3 = A): the ENEMY CC
KIT header reads `threats to your healer <pid> at enemy burst windows`
when the log owner is not the healer, and a spec default the enemy was
never seen landing is marked `(spec default, not seen)`.

v287 (2026-10-03, triage cc-dr F-EX1, ruling A′19): a [HEALER EXPOSURE]
window that opens while the healer is in a CC says `healer already in X
until M:SS (the DR levels count it)` and drops the LoS-break advice.

v288 (2026-10-03, triage G7-P5: other F-O5 + cc-dr F-MA1): every
mitigation-audit line says its overlap is `in the final 10s`, and an
off-table row reads `(not in the mitigation table — not modeled in the
arithmetic)` — it no longer calls shields, dodges and heals a redirect.

v289 (2026-10-03, triage G7-P7: hp-state F-C1 + cc-dr F-CS1): a
[CONSEQ] line with no drop that names a death says `no surviving teammate
dropped …`; a healer silence (the [SILENCE] intervals, ≥ HEALER_CC_MIN_S)
gets its own `in X (silence) for Ns → during it` line; the rules line
reads "says no teammate dropped and names no death".

v290 (2026-10-03, triage cc-dr F-AO1): an owner AoE CC line whose
targets landed at different DR levels says each (`[DR: Disorient — 4(MHunter)
50%, 3(HPriest) Full]`); only the owner's own applications count.

v291 (2026-10-03, triage cc-dr F-CE1): a [CC ON ENEMY] line carries the
DR the outgoing chain holds for that landing (`(2s) [DR: Stun 50%]`; a
backlash aura has none); the [CC ON ENEMY] span gate and the FORCED
TRINKET cross-check accept the optional tag.

v292 (2026-10-03, triage cc-dr F-RT1): a [ROOT] line whose rooted unit
cast on another player inside the root says `cast N spell(s) on others
meanwhile (X → pid)` instead of "this stretch worked like hard CC".

v293 (2026-10-03, triage cc-dr F-CR1): a [CC REMOVED] line says how
long the CC held and how much was left (`after 3s (~1s of it left)`; the
[CC BROKEN] arithmetic, `ccRemainingSeconds`); an unknown full duration
says `after Ns` only.

v294 (2026-10-03, triage cc-dr F-DC1): the [DR CLASH] cap (3) keeps
the owner's own clashes first — owner diminished, then owner prior, then
the rest — and renders the kept ones in time order.

v295 (2026-10-03): triage G16, the observed-chain half of ruling A14 = B
(kick-eaten F-K1 × sync-burst F-L3). An offensive cooldown's span — and
every `buffEndSeconds` reader — ends where its effect aura was seen to
end (own id or a G3 cast→effect aura, any unit, applied by the caster,
re-applications within 0.5 s extend it), else at the official duration.
kick-eaten's silenced test reads the same cast→effect table.

v296 (2026-10-06, triage G7-P8: hp-state F-R8 + enemy-def F-E11, ruling
A21): the HP on a press line ([YOU] [CD] / [CC] / [PROC] / [CAST], [ENEMY
DEF], [ENEMY TRINKET]) is the HP at the press (`hpAtPress`: the last
reading before the press and before its own heal), not the [STATE] reading
of that second; legend says so; the gate exempts those tags
(`PRESS_HP_LINE_TAGS`). The ledger's cast.targetHpPct (the [UNNECESSARY]
threshold and note, questionable-external) is the same press reading; an
[ENEMY DEF] aura is read at its cast.

v297 (2026-10-06, triage G15: hp-state F-B1 / F-N5, sync-burst F-L5 /
F-L5b / F-L1, ruling A'14): the burst ledger's `Target: X A% → B%` is the
[STATE] grid reading of the printed seconds (0 when dead), prints `(low L%
at m:ss)` when the low is at least 10 points under both endpoints — the
same rule now decides [DMG SPIKE]'s `low N% @m:ss` — and names the burst's
other victim (`| also hit: Y DIED m:ss (+N.Ns)`); gate
`checkBurstTargetHpConsistency`.

v298 (2026-10-01, triage enemy-def F-E22 / F-E24 / F-E7 (AMS),
crisis-external F-E22b / F-A7; rulings A29, A30, A′4, A7-补): a KILL
ATTEMPTS failure cause is a save that went up INSIDE the attempt or was
already up when it began (`X [up since m:ss]`), not one pressed in the
kill-credit slack; a trinket counts only when it broke a control of that
attempt; a trinket plus an immunity names both; a school-limited immunity
is "full" only when ≥ 50 % of the damage aimed at the target (landed plus
absorbed, every source) was in its schools; Anti-Magic Shell renders
([ENEMY DEF]) and is credited under the same 50 % rule on its DB2 absorb
mask. An immunity already up counts only when its aura is the immunity
(the pct-100 rows, Time Stop, Guardian of the Forgotten Queen). One
legend line added to the block.

v299 (2026-10-01, triage crisis-external F-A9, enemy half): an enemy Holy
Paladin's Blessing of Sacrifice cast as 199448 (Ultimate Sacrifice) renders
as an [ENEMY DEF] external and counts in KILL ATTEMPTS. On the friendly
side 199448 is an alias of 6940 (ruling P-A9 = A): one roster row, no
second "Blessing of Sacrifice" line.

v300 (2026-10-01, triage enemy-def F-E21, ruling A′15): a racial or class
ability that removed a control (Will to Survive, Will of the Forsaken,
Blink, Berserker Shout …) renders `[ENEMY TRINKET] … used X out of <CC>`,
is the KILL ATTEMPTS cause `broke out (X)`, and on a friendly CC line
reads `X broke this CC` — only for a CC whose mechanic the ability's DB2
mechanic-immunity aura lists. Stoneform / Fireblood are read from their
buffs (a press line, the trinket lock; they name no CC). A [CC ON TEAM]
line states the trinket-equivalent racial is `ON CD` while its own
cooldown or a trinket press's shared lock runs. The kill-opportunity tier
does not read the racial's trinket lock (ruling P-b7).

v301 (2026-10-01, triage enemy-def F-E2 / F-E3, rulings A24 / A25): a
[KILL WINDOW] `defenseless` span ends at Blur, Greater Invisibility,
Burrow and Time Stop (not Mass Invisibility — ruling P-b8), and at an
external the target received (the [ENEMY DEF] line's rendered second
and printed length).
Removes kick-priority menu candidates whose window no longer exists —
counts in the commit.

v302 (2026-10-06, triage cd-hoarded F-W6, rulings C4 + P-W6 + P-W6b): a
spec's baseline defensives (DB2-generated table) stay in the cooldown
ledger in a round where they were not pressed — loadout, [RES], [UNUSED],
cd-hoarded's ready set; only cd-hoarded may name such a row
(extractMajorCooldowns returns it on request only); cd-hoarded's ready set
drops a save Forbearance blocks on its recipient and Touch of Karma with
no living enemy in reach.

v303 (2026-10-06, triage G2: cc-dr F-RB1, crisis-external F-K5,
sync-burst F-S3): an outgoing CC re-broadcast in the same millisecond is
one application (DR tags, KILL ATTEMPTS stun counts, [CC BROKEN]); a CC
never removed ends at its official length, not the round end; a
missed-sync-window line says what ended the healer's lock early
(`endedBy`), with one legend sentence.

v304 (2026-10-06, triage G2: death-kill F-K1 / F-K2 / F-K6, ruling A13
/ A′7, and the T2 one-death-one-KILL defect): a burst attempt covered by
a stun attempt that did not get the kill, and that alone reaches its
target's death, is kept as a KILL row; one enemy death is credited to one
KILL row; a death credited in an attempt's kill-credit slack is not
"outside every attempt window"; an enemy sitting in our own breakable CC
(Disorient / Incapacitate) is not named as the softer target.

v305 (2026-10-06, triage other F-O2): SPEC BASELINES and INCOMING DAMAGE
BASELINES call the bracket what it is — "≥2100 personal rating", "your
personal rating in this bracket is N" — instead of "MMR" (the number is
COMBATANT_INFO personalRating, not the lobby's matchmaking rating).
Wording only; the caveat's condition and every number are unchanged.

v306 (2026-10-06, triage other F-O12): a HEALER OFFENSE [KILL WINDOW] /
[VULNERABLE] line's `free Ns of Ms` counts the seconds the owner could
cast (buildCannotCastIntervals: hard CC, silences, kick lockouts, enemy
pets included) instead of the seconds outside a [CC ON TEAM] instance.
Only that number moves; slack lines and the menu are unchanged.

v307 (2026-10-06, triage missed-cleanse F-C1): a missed / late cleanse
window's post-CC damage (`[UNCLEANSED DEBUFF] … Nk taken`, missed-cleanse
`postCcDamageK`, the #39 consequence gate and the cap order) leaves out a
teammate's Spirit Link / Void Leech — the redistribution rule of the
pressure total (ruling A22 = B). A Critical window whose only damage was
redistribution demotes to High (the ruled zero-damage behaviour).

v308 (2026-10-06, triage kick-priority F-P4): a kick-priority line whose
`healK` sums more than one cast of the heal (an instant cast of the same
spell inside the half-second heal pairing after the hardcast) carries
`healCasts`; both legends say the amount is then a sum. Menu ids and the
cap order are unchanged.

v309 (2026-10-06, user ruling U-T2 on hp-state F-T1): the `cheaper
available:` note of a group save with no cast target (Aura Mastery) no
longer offers Blessing of Sacrifice when the owner was the only friendly
under fire at the press — it cannot be put on the caster. Timeline note
only; the menu is unchanged.

v310 (2026-10-06, user ruling U-KA2): cd-hoarded judges a school-limited
save (Blessing of Protection, Spellwarding, Cloak of Shadows, Anti-Magic
Shell) by what was aimed at the crisis unit in the 2 s before the
reading — hits that landed and hits a shield ate, a teammate's
redistribution left out (`incomingPressureBySchool`, the reading KILL
ATTEMPTS already had) — instead of landed damage only. `readyCds` of a
crisis under a shield can gain or lose such a save; counts in the commit.

v311 (2026-10-06, user ruling U-T1): Divine Shield, Ice Block and
Icebound Fortitude are usable while stunned again, and Blessing of
Protection on oneself under a physical stun — DB2's immunity route
("Immunity Purges Effect" + an own immunity covering the stun), which the
2026-09-04 named-bit table did not read. A unit that died stunned through
the lethal window can have them under `[DEATH] … Unused:`; a target
holding one counts as able to break a stun. Divine Shield and Ice Block
are never listed after `cheaper available:` (ruling P-FU-b7-DS, the
cost-norm sign-off book). Counts in the commit.

v312 (2026-10-06, user rulings U-KA3 / U-KA3b): a kill attempt that began
with the target already burrowed, vanished or under Mass Invisibility
reads `forced a full immunity [up since m:ss]`, as it does for a Divine
Shield that was already up — the three hold while their aura is up (a
DoT already on the unit, area damage and a hit in the aura's first second
still land, and are no evidence against it) — and only an aura the log
saw end counts: one closed at its official length because its REMOVED
was lost does not (ruling P-FU-b8). Cauterize, Cheat Death and Feign
Death stay a moment. Counts in the commit.

v313 (2026-10-06, user ruling P-FU-H23; triage H23, second leg): the
cannot-cast predicate pairs a CC / silence aura's removal with ITS
caster's application (`matchPendingCcKey`, the pairing `ccInstances`
uses). A second caster's same-id stun landing while the first is still up
no longer ends at the first one's removal, so its tail is no longer free
time for any reader — the cd-hoarded owner gate, healing gaps, HEALER
OFFENSE free seconds, kick-priority, the missed-cleanse / purge lock
tests, [RES] `cc:`. Counts in the commit.

v314 (2026-10-07, user rulings B2 / B11b of 2026-10-06; facts only, no
verdict or reference number changes): missed-sync-window gains
`enteredNextLock` (a ready cooldown whose first press after the lock
entered the next lock on the enemy healer — the verdict's own "entered"
test) and `setupBy` ("you" when the lock was the player's own control,
"you (X)" when the player cast only X of the chain); cd-hoarded gains
`ownBurstPressed` (the player's offensive cooldowns pressed in the 2 s
before the crisis reading, each with how long before it). Counts in the commit.

v315 (2026-10-07, user rulings B6 / B7b / B21b of 2026-10-06; facts and
one wording, no accusation added): kick-eaten gains `sameKicker`
("<kicker> ×N (<spell> ×n + …)", every kick on the player by this line's
kicker, unlisted ones included); kick-priority-missed gains
`youChannelling` (what the player was hard-casting or channelling while
the heal was cast — the missed-cleanse occupancy predicate); and the
burst ledger's `Kicks:` line says `JUKED — their X channel stopped Ns
before the kick` when the target stopped a channel at most 0.5 s before
the kick, instead of naming an older unfinished cast or "hit nothing".
Counts in the commit.

v316 (2026-10-07, user ruling B24b of 2026-10-06; a fact): a STAYED IN
line and its position-mistake (stayed-in) menu line name the enemy player
who dealt the most damage to the owner over the span — ` — most damage to
you in the span: <name> (Nk)` and `topDamager` — beside `enemy` /
`endEnemy`, which are only who stood nearest. The positioning gate
recomputes it (G4c). Counts in the commit.

v317 (2026-10-07, user ruling B21a of 2026-10-06; a fact): MATCH FACTS
gains `Lobby matchmaking rating (MMR): your team N | enemy team M` (the
two numbers without sides in Solo Shuffle) when the log's ARENA_MATCH_END
carries them — the parser now keeps that pair (`teamMmr`). The SPEC
BASELINES sentence and its "below the reference bracket" comparison stay
on personal rating. Counts in the commit.

v318 (2026-10-07, user rulings B15b / X5 / B15c-U11 of 2026-10-06; facts):
the owner's range / line-of-sight / moving rejects in the 10 s before a
teammate's death get their `[REJECTED]` line whatever their count (runs
elsewhere still need 3 presses); a reject for SPELL_FAILED_VISION_OBSCURED
is its own kind, `— vision obscured (Smoke Bomb)`, apart from a pillar's
line of sight (the German string leaves the line-of-sight list); and a
friendly death block gains `Killing blow: <source> — <spell> (an execute)`
when the killing blow was Touch of Death. Counts in the commit.

v319 (2026-10-07, user rulings B7a / B17a / B17b-U8 / B4a / B13d of
2026-10-06; timeline facts, no accusation): the owner's kick that stopped
nothing gets `[KICK] your X on N — JUKED by fake Y` / `hit nothing[ — Z's
kick had interrupted the Y Ns earlier]`; `[IMMUNE]` on our team's control
says why when the log shows it (`— DR: <family> Immune`, `— N's Cyclone
was on the target`, beside the existing immunity-aura note); an enemy
Death Grip on our team gets a `[GRIP]` line; `trinket: ON CD (Ns left)`
gains `; last used m:ss on X` with a legend guard (never "used too
early"); and a `[MISSED PURGE OPPORTUNITY]` line says `| you stole the
other copy at m:ss` when the owner took the same caster's other copy
meanwhile. Counts in the commit.

v320 (2026-10-07, user ruling B14a of 2026-10-06): on the [RES] row under
a friendly [DEATH], a positional cooldown (Darkness) whose holder stood
out of its reach of the dying player is left out of `rdy:` — the reach
predicate cd-hoarded and [DEFENSIVE AVAILABLE] read; a legend line says
so when it happened. Counts in the commit.

v321 (2026-10-07, user ruling B18 of 2026-10-06): a Guardian Spirit press
line ([YOU] [CD] / [TEAM] [CD] / [ENEMY DEF]) whose save triggered gains
`| save triggered Ns later (m:ss): a killing blow was prevented, healed
Nk` — the save heal the ledger's recovery already reads; a legend line
when one is rendered; KILL ATTEMPTS causes unchanged. A hardFailure class
checks the clause against its own line. Counts in the commit.

v322 (2026-10-07, user ruling B13e of 2026-10-07; the priority table is
untouched): our purge lines and missed-purge lines say how many purgeable
buffs — official dispel type Magic — the enemy carried at that moment
(`1 of N purgeable buffs on it`, `N purgeable buffs on it then`), and the
missed-purge menu row carries `purgeableOnTarget`; a legend line when
rendered. Counts in the commit.

v323 (2026-10-07, user ruling B1 of 2026-10-07, variant B of the 605
scan): cd-hoarded gains `otherAttempts` — defensives NOT among the ready
ones that the player pressed inside the response window and the game
rejected while they were on their own cooldown. A fact; the event is not
waived. Counts in the commit.

v324 (2026-10-07, found on the 605-file capture of B14b; a defect, no
ruling involved): the [RES] delta state is read at the second the row
renders — the row's own anchor — and a full row that printed nothing (the
ledger reports nothing in a round's first 5 s) is no longer the base of
the next row. A round's first [RES] row is always a full one, and a
cooldown the ledger had not reported yet shows up as `+X` instead of
never. Counts in the commit.

v325 (2026-10-07, user ruling B16b of 2026-10-06, "as A29: name both"): a
FAILED kill attempt that met the target's own save AND an external names
both — `popped X; saved by external (Y)` (and `; self-saved (Z)` when
that was there too) — instead of the wall alone. Without an external the
cause is unchanged. The [ENEMY DEF] reference gate reads the cause clause
by clause. Counts in the commit.

v326 (2026-10-07, user ruling B15c-U10 of 2026-10-06): our own Holy
Paladin's Avenging Wrath no longer anchors a kill attempt — it neither
opens a burst cluster (`Avenging Wrath burst (no stun)` rows go) nor
extends a teammate's. The enemy side (burst windows, crisis `enemyBurst`)
is untouched (ruling A27). Counts in the commit.

v327 (2026-10-07, user ruling X3 of 2026-10-06): kick-eaten's
`outRangeable=yes` needs the kicker to have stood farther beyond its kick
range than it could walk during the cast (cast length × 7 yd/s); a line
that fails only this reads `no (kicker N yd beyond kick range could walk
in during the Ts cast at 7 yd/s)`. No line gains a `yes`. Counts in the
commit.

v328 (2026-10-07, user ruling B15a of 2026-10-06, "the missing press line
is a defect"; ruling of 2026-10-07 on the 605 report: Lichborne is not a
defensive): Death Pact and Lichborne join the Death Knight roster — a
Death Knight owner's presses of them get their `[YOU] [CD]` line, loadout
row and [RES] entry. Death Pact is a defensive for every reader of the
ledger (ready defensives, `cheaper available`, `[DEATH] Unused`);
Lichborne is on the ledger only. Counts in the commit.

v329 (2026-10-07, user ruling B16c of 2026-10-06): Smoke Bomb (the PvP
talent's cast id 212182) joins the Rogue roster — press line, loadout
row, [RES] entry. Not a defensive (ruling of 2026-10-07 on the 605
report): no reader of "ready defensives" sees it. No [CONSEQ] line for it
yet. Counts in the commit.

v330 (2026-10-07, user ruling B3a of 2026-10-06, a consistency fix): the
`cheaper available:` note and the friendly `[DEATH] … (Unused: …)` list
read cd-hoarded's school rule — a school-limited save (Blessing of
Protection / Spellwarding, Anti-Magic Shell, Cloak of Shadows) is named
only when it covers at least half of what the unit was being hit with in
the 2 s before, absorbs included — and a Holy Paladin's Avenging Wrath is
never offered as the cheaper save. Counts in the commit.

v331 (2026-10-07, user ruling B15a step 2 of 2026-10-06, wording approved
2026-10-07): the owner's Death Pact press line says what its heal absorb
did — `| healed Nk · heal absorb Nk: ate Nk of healing (N heals — who)`
and how it ended (used up / ended with Nk unspent / unspent at death) —
and a death under the absorb quotes it in the death block (`Heal absorb:
own Death Pact …`). All read off the log (the aura row's amount, the
SPELL_HEAL_ABSORBED rows); nothing when a row is missing. Counts in the
commit.

v332 (2026-10-07, user ruling B20a of 2026-10-06/07): an enemy
Windwalker's `[ENEMY DEF] … Touch of Karma` line gains `| fed by …` —
per player the damage it absorbed from spells PRESSED 1 s or more after
it went up, ticks of effects already running apart, then (ruling of
2026-10-07, option B) hits of presses made before that and what has no
press at all (procs, auto-attacks, pets), each on its own,
the total, and what it sent back onto whom. A fact, never an accusation;
a legend line when rendered and a hardFailure class that the parts add
up. Counts in the commit.

v333 (2026-10-07, user ruling B14b of 2026-10-06/07): every [OFFENSIVE
WINDOW] header is followed by a full [RES] row — what the team had ready
at the second the enemy's burst began. The row bypasses the 2 s debounce
and does not start it for the rows after it; the delta chain restarts
from it. Counts in the commit.

v334 (2026-10-08, GH #115 batched regen #2, user ruling 2026-09-26 + 10-07):
every stale corpus reference table regenerated at 859883a6 on the corpus
of the table it replaces (sync-window, burst-window, behaviorPrior,
cdTriggerPrior, kick-priority + heal spells, healerSaveCd, backlashDispel,
cdRecastFloor, corpus-tools reference_vectors) and CD_HOARDED_OUTCOME_REF
re-measured (4.5 / 11.4 % n=16,960 → 5.8 / 13.0 % n=15,645). Reference
numbers quoted in facts move; counts in the commit.

v335 (2026-10-08, FT-T01, user approval 2026-10-08 "走 A"): a melee swing
the log wrote only its victim-side line for (SWING_DAMAGE_LANDED with no
SWING_DAMAGE twin — a guardian the client has no owner for, e.g. Unholy's
Lesser Ghoul) is a damage event; the parser used to drop it. Damage sums
that include such swings move ([DMG SPIKE], [OFFENSIVE WINDOW] peak, the
DPS on press lines) and a [KILL] line can name a killing blow it lacked.
Counts in the commit.

v336 (2026-10-09, FT-T02c, user approval 2026-10-09 "按你的建议做"): a
melee swing's damage event is its victim-side line (SWING_DAMAGE_LANDED)
whenever the log has one — where the two lines of a swing disagree, the
victim's health follows the LANDED amount (1,494 of 1,494). Swing damage
the attacker-side line reported and a shield in fact absorbed is no
longer counted as landed (and again as absorbed). Damage sums that
include such swings move. Counts in the commit.

v337 (2026-10-09, FT-T08 step 1, user approval 2026-10-09 "3 同意"): an
aura the game re-broadcasts (REMOVED then APPLIED of the same spell,
source and target, no new cast) is one aura when the two lines are up to
1 ms apart, not only in the same millisecond — the log's four-decimal
timestamps put the pair on either side of a millisecond boundary about
one time in ten. One application no longer prints as two CC lines with an
extra DR step, or as a buff that "ended early" and a second press.
Counts in the commit.

v338 (2026-10-09, FT-T08 step 2, user approval 2026-10-09 "3 同意"): an
aura ends at its SPELL_AURA_REMOVED; a SPELL_AURA_BROKEN[_SPELL] line the
REMOVED follows within 1 s is what hit it, not its end. Frost Nova, Ice
Nova and the Water Elemental's Freeze log one BROKEN_SPELL per damaging
hit and stay on about half a second longer — their roots (and every CC
window, by a few ms) now run to the real end. Counts in the commit.

v339 (2026-10-09, FT-T08 step 3a, user approval 2026-10-09 "3 同意"): a
[BUFF FADED] line states the end cause the log gives — `(dispelled by
N(X)'s Spell)`, `(stolen by …)`, `(its target died)`, `(used up —
absorbed Nk)` — and an absorb's `Nk absorbed, Mk left` on its expired /
dispelled / ended-early forms (absorbed = the SPELL_ABSORBED lines naming
it; left = its REMOVED line). What is left reads `(ended early — no
dispel logged)` (was "absorbed, dispelled, or cancelled"). Counts in the
commit.

v340 (2026-10-09, FT-T08 step 3b, same approval): an [ENEMY DEF] aura
that ended early states the cause the log gives in place of `— removed
early` — `— dispelled by N(X)'s Spell`, `— ended at death`, `— its
target died`, `— used up, absorbed Nk`; `— removed early` remains for an
early end with no logged cause, and the legend says so. Counts in the
commit.

v341 (2026-10-09, FT-T08 step 5, same approval): a channelled cooldown's
[YOU] [CD] line reads `(interrupted at Ns …)` only when a kick or a
control landed DURING the channel and the channel ended at its landing;
one pressed under a control, or one that outlasted it, reads
`(channeled Ns …)`. The [YOU] [CAST] `[channel cut by CC …]` note uses
the same predicate. Counts in the commit.

v342 (2026-10-09, FT-T08 step 4, same approval): Dampening reads its
stack decreases too (2v2, after a death: 19-20 points down) — the
`dampening: N%` notes, [MATCH END] `damp:` and the DAMPENING summary after
such a drop. Counts in the commit.

v343 (2026-10-09, FT-T08 step 3 follow-up, codex post-hoc review): an
[ENEMY DEF] aura that was still up when the round ended reads `— still
up when the round ended`, not `— removed early` (legend line added); a
dispel line the log cannot tie to this copy of a spell is stated beside
the death / used-up reading instead of being dropped. Counts in the
commit.

v344 (2026-10-09, FT-T02b + T02d, user ruling 2026-10-09 option B): damage
a Time Dilation / Stretch Time only DELAYED is counted once, when the
health is lost — the shield's SPELL_ABSORBED is no longer "absorbed"
([DMG SPIKE] totals and `(X absorbed)`, press-line DPS, Top sources'
"N of it absorbed"); `[ENEMY DEF] … during it` writes it as `+Dk deferred`;
the mitigation audit says `deferred ~Nk … — delayed, not prevented` with
the log's own amount. Legends state what each damage figure is: the
[DMG SPIKE] total, the INCOMING DAMAGE BASELINES rows, KILL ATTEMPTS'
`on target`, BURST LEDGER's `your damage`. Counts in the commit.

v345 (2026-10-09, FT-T02a): ABILITIES INTO IMMUNITY/DR lists the spells
that made at least 5 % of the caster's damage — the filter summed the
compat layer's negative amounts and kept exactly the spells BELOW 5 %
(filler listed, the main damage spells dropped). Lines appear, disappear
and change their spell lists. Counts in the commit.

v346 (2026-10-09, FT-T08 step 3c): [CC ON ENEMY] / [CC ON TEAM] /
[SILENCE] lines state how the control ended when the log says —
`| broken by N(X)'s Spell`, `| dispelled by N(X)'s Spell`, `| ended at
their death`. Counts in the commit.

v347 (2026-10-09, FT-T06 items 1 + 4, user approval 2026-10-09): a
[YOU] [STASIS RELEASE] line sits where the stored spells were replayed
(the ready aura's end), not where storing ended; a Stasis never replayed
in the round reads [YOU] [STASIS STORED] … (not released …), one stored
before the round is found and marked. `[UNUSED]` on a cooldown whose cast
bar the unit started without ever finishing says so (`[UNUSED — started
N×, never finished]`). Counts in the commit.

v348 (2026-10-09, FT-T06 item 2, same approval): an effect a talent
triggers (no button, no cooldown of its own — Radiant Glory's Avenging
Wrath, a Demonic Metamorphosis) reads `(proc k of N[, with X])` on its
[ENEMY CD] line instead of `(cast k of N)`, with a legend line; a button a
talent replaced by a passive prints `[PASSIVE]` in the kit without the
replaced button's cooldown. Burst windows are unchanged. Counts in the
commit.

v349 (2026-10-09, FT-T14a, user approval 2026-10-09): a summon beside its
owner's label is called what the log says it is — `6(RShaman)'s totem`,
`4(UDKnight)'s pet` (a Pet- GUID only), `5(SPriest)'s guardian` — on
control / kick / break / root lines and in the damage rows (one
predicate, `summonKindWord`). Two damage rows that differed only in that
word are one row now. Counts in the commit.

v350 (2026-10-09, FT-T14b, same approval): an un-aimed area control
(Psychic Scream, Howl of Terror, Leg Sweep, …) that put its aura on no
enemy player and logged no miss on one reads `[hit no enemy player]` on
its [YOU] [CC] line instead of nothing. Counts in the commit.

v351 (2026-10-09, FT-T05, same approval): an enemy Fortifying Brew is
found under the aura the log carries (120954 → table row 115203) — it
gets its [ENEMY DEF] line and KILL ATTEMPTS can say `popped Fortifying
Brew`. Counts in the commit.

v352 (2026-10-09, FT-T04, user approval 2026-10-09): [RES] `cd:` remaining
is floored onto the render grid (a 120 s cooldown no longer reads
`(121s)`); a `cc:` entry under half a second reads `-<1s`, not `-0s`;
Forbearance is read off the logged aura, and a Divine Shield off cooldown
under it reads `cd:Divine Shield(Forbearance Ns)` instead of `rdy:`.
Counts in the commit.

v353 (2026-10-09, FT-T14c, user approval 2026-10-09): five more instant
area controls (Dragon's Breath, Shockwave, Chaos Nova, Blinding Sleet,
Void Nova) list who they landed on, on [YOU] [CC] and [TEAM] [CC] lines,
and read `[hit no enemy player]` when they hit none. Counts in the commit.

v354 (2026-10-09, FT-T11a, same approval): a kick that interrupted
nothing carries the miss the log wrote — ` [REFLECTED by X]`,
` [IMMUNE: X]`, ` [MISSED on X]` — on `[KICK] your …` and the ledger's
`Kicks:` line. The landed / juked / missed verdict is unchanged.

v355 (2026-10-09, FT-T11b, same approval): Quell, Silence and
Counterspell cool down for DB2's 20 / 30 / 25 s (hand values 40 / 45 / 24
removed) — `[KICK] … back m:ss`, [RES], `enemy interrupts UP` and the
kick candidates' cooldown facts. Counts in the commit.

v356 (2026-10-09, FT-T11c, same approval): a kick that interrupts a cast
cools down sooner for a holder of Coldthirst (Mind Freeze −3 s) or Light
of the Sun (Solar Beam −15 s) — `[KICK] … back m:ss`, kick readiness and
the owner's [RES] kick entry read one per-press cooldown. Counts in the
commit.

v357 (2026-10-09, FT board, user ruling 2026-10-09): the kit entry of a
Guardian Spirit under Guardian Angel reads `[60s from when it expires
unused, 180s after a save, lasts 12s]`.

v358 (2026-10-09, FT board, same ruling): [BURST ANSWERED], [STACKED
DEFENSIVES], [CD PRIOR], [HEALER EXPOSURE], [ROOT], [DR CLASH] and the
`[UNNECESSARY — … target X …]` note name players by their roster label
(`3(AWarrior)`) instead of the character name. Counts in the commit.

v359 (2026-10-09, FT board, same ruling): a hunter's or warlock's
permanent pet being killed gets a [UNIT DESTROYED] line (when, whose,
which side, what killed it).

v360 (2026-10-09, FT board, same ruling): Capacitor Totem lists who its
stun landed on (read ~2 s after the cast) on [YOU] [CC] / [TEAM] [CC],
and reads `[hit no enemy player]` when it stunned none.

v361 (2026-10-09, FT board item 1, same ruling): a save the timeline
prints when an ENEMY presses it ([ENEMY DEF]: Crimson Vial, Healthstone,
Nether Ward, Intervene, Master's Call, Leap of Faith …) gets a press
line, a kit row and a [RES] entry when the owner or a teammate presses
it. A Utility row: no candidate reads it. Counts in the commit.

v362 (2026-10-09, FT board item 1, user ruling 2026-10-09 option ②): the
twelve offensive cooldowns the enemy side prints as [ENEMY CD] and no
class roster lists (Summon Infernal, Malevolence, Soul Fire, Frozen Orb,
Ray of Frost, Feral Frenzy, Boomstick, Takedown, Stormkeeper, Strike of
the Windlord, Soul Immolation, The Hunt's Devourer id) get a press line,
a kit row and a [RES] entry when pressed. Press-only: a press enters a
sync window and prints under `pressed inside` on [KILL WINDOW] /
[VULNERABLE]; no `ready` list and no missed-sync-window `readyCds` names
them. missed-sync-window loses the accusations over a lock such a press
was in. With it, three cooldown facts these rows (and Leap of Faith's,
v361) exposed: the recast-floor table is regenerated (7 new cells — the
[RES] `cd:` entry of Frozen Orb, Ray of Frost, Stormkeeper, Boomstick,
Soul Immolation and a Balance / Feral Frenzied Regeneration prints the
`(a–Ns)` / `(≤Ns)` forms); a Save the Day holder's second Leap of Faith
within 6 s is the talent's free recast; Savagery takes 15 s per rank off
Takedown (60 s at rank 2). Counts in the commit.

v363 (2026-10-10, FT-T09, user "Ok" 2026-10-10 to items 1–4): what a
control line says about its length and its end. `0s` prints `<1s`
([CC ON TEAM] / [CC ON ENEMY] / [DISARM] / [SILENCE], the break notes'
`after …`, the
[DMG SPIKE] `enemy CC in window` list). A control the round ended on —
clipped at the round end, or never closed by the log — prints
`still on them when the round ended, Ns in`, not the clip as its length.
A break the log writes after the aura's REMOVED, or with no source, is
printed (`| broken by Shadow Word: Death`). Every control the holder's
own press ended says `| ended by their PvP trinket` / `… their Blink` /
`… their Divine Shield` on its own line — a trinket press is bound to one
control, and the others it removed said nothing. No candidate changes.

v364 (2026-10-10, FT-T10, same "Ok"): a priest in Spirit of Redemption
form reads `unit:ghost` on [STATE] ticks, with a legend line when one
does. The token's code existed and nothing passed it its intervals.

v365 (2026-10-10, FT follow-up to v344 / v354): the burst ledger's
`Kicks:` line names a kick's miss target that is a summon as
`<owner>'s totem` / `pet` / `guardian` (the timeline's [KICK] wording),
not by its unit name — a totem's name is in the log's client language
(`[IMMUNE: 根基图腾]`). With it, gate only: the `during it:` gate reads the
`+Nk deferred` clause v344 added.

v366 (2026-10-10, FT-T09 item 6, user go-ahead 2026-10-10 after seeing
the example): a merged healer lock names a repeated control with its
count (`Hammer of Justice ×2`, was `Hammer of Justice`) in
missed-sync-window `cc` / `spell` and `enteredNextLock`; the legend says
that `durationS` is the whole lock on the whole-second grid.

v367 (2026-10-10, FT-T10, user ruling 2026-10-10 option B): a kick
lockout stops only the spells of the school it locked, for two gates —
cd-hoarded asks "could the owner press it" per ready cooldown (a Mage
Counterspelled on Polymorph can still Ice Block), and a sync-window
cooldown is "ready" unless a lockout on ITS school held its owner.
cd-hoarded `ownerCc` prints the locked school (`Counterspell lockout
(Arcane) …`) and `ownerFreeS` counts the time one of facts.readyCds could
be pressed; missed-sync-window `holderCc` lists only what stopped that
cooldown. Adds accusations (counts in the commit). The sync-window
reference table is stale by it (GH #115).

v368 (2026-10-10, FT-T03 / T07 / T10 / T12 / T13 / T15 / T16, user
rulings D1–D15 of 2026-10-10 and the two follow-ups of that day): the
fact lines of six themes, one batch.
T03 (D7): a number that claims the LOWEST HP of a window is the window's
true minimum, at the second it happened ([DMG SPIKE] `low`, [CONSEQ],
burst-ledger target line, [BURST ANSWERED] `bottomed at`, kick-eaten
`ourLowPct` / `theirLowPct`, STAYED IN `(min over window)` /
position-mistake `hpMin`, slow-defensive-response `pressuredHpPct`);
[STATE] readings and every decision stay on the grid; [STATE] gets a
legend. T07 (D8): [ENEMY DEF] prints Feign Death as an absorb and Nature's
Guardian / Cauterize / Cheat Death as the proc they are; KILL ATTEMPTS no
longer reads them as a full immunity. D9: Terror of the Skies under
Oppressing Roar reads its lengthened duration.
T12: a kill window ends at its target's death (D1) and its header at the
round's end; [DMG SPIKE] buckets close at the death / round end and say
when the target was healed through; an [OFFENSIVE WINDOW] names only a
spike that overlaps it, each spike once; KILL ATTEMPTS prints damage
inside the window and incl. the 5 s after; the burst ledger adds the
absorbed part and a second target; the top-5 [DMG SPIKE] cap is stated and
the dropped windows counted (D4); [BURST ANSWERED] names a control's
target and span and marks an answer pressed after the pressured unit
died. D2: a STAYED IN / KITED span and position-mistake measure distance
to the ONE enemy that hit the owner most in the span. D3: a control
answers a burst only when its target was hitting the pressured unit.
T13 (D10 / D11): 2v2 dampening has one start — no extrapolated number
before the first logged stack; the header and the press lines agree.
T15 (D5 / D6): the header says "only facts that may be cited"; an
[ENEMY DEF] aura whose removal the log never shows prints `end not
logged`, and KILL ATTEMPTS follows. T16 (D13 / D14): the owner's
[CC ON TEAM] / [SILENCE] line carries `| pressed during it: X ×N` (major
cooldowns pressed and refused under that control); a delayed-landing
ground control is matched to its cast. T10: the six remaining readers ask
a kick lockout per spell (purge / cleanse "locked", the kick run budget,
cc-avoidable, [CD PRIOR], burst-window feasibility, the death block's
option tags), and a lockout on the owner does not reach a spell its pet
casts. Legends and labels: [ROT PRESSURE] roster labels, `also on you for
Ns`, cd-waste / cd-hoarded fact wording. Candidate movement (counts in
the commit): kick-priority and position-mistake lose rows, cc-avoidable
gains one. The burst-window, kick-priority, cd-trigger and sync-window
reference tables are stale by it (GH #115).

v369 (2026-10-10, FT-T13 D11 as the user ruled it — v368 had shipped the
implementer's reading, "no number before the first logged stack"): a 2v2
round's dampening start is derived from the round's own first logged
stack, one dose below it (42 → 41, 22 → 21), and the header says so:
`started at 41% (derived: one 1% step below the first logged stack, 42%
at 0:11 — the log prints no value before that)`. Before that second the
press lines' `| dampening:` note, the [DEATH] note and the 0:00
[DAMPENING ALERT: 30%] read the derived value again; a round whose first
logged line is a stack drop, or that logged none, still states no start.
No candidate changes.

v370 (2026-10-10, FT-T16 D15 (a) + (d), user "按你的建议来" after the
real-match samples): two fact texts. The CC USE `Counts:` line gives a
control with a cast time whose cast bar was started more often than it
went off as `Cyclone cast bar started 4×, went off 0×` — an off-ledger
control that never went off had no entry at all — and the section says
that `went off` is the cast completing, not the control landing. A
`[CC AVOIDED?]` line whose cast has a SPELL_MISSED row in the log reads
`logged IMMUNE` / `logged MISS` / `logged REFLECT` where it read `did not
land`. With it, the kit's `[UNUSED — started N×, never finished]` note
reads the same cast bars as CC USE (a variant id of the same cooldown now
counts). No candidate changes. The other two D15 line kinds (an
uncompleted cast per line, a friendly control that was immune / missed)
are not in this version.

v371 (2026-10-10, FT-T16 D15 (b) + (c), user approval on real-match
samples, under new tags): two fact lines. `[CAST STOPPED]` — a cast bar
of a control the log owner began that neither went off nor was kicked,
with how the log shows it ended (`cast bar stopped after 0.8s; not
kicked; no control, silence or knockback landed on you then`, `… as a
control or silence landed on you`, `refused 0.9s in: vision obscured
(Smoke Bomb)`); never "cancelled" or "moved" — the log cannot tell. Not
printed for a refusal a [REJECTED] line already states. `[CC NOT LANDED]`
— a control of the owner's team on an enemy player that the log says did
not take effect and no other line states (`4(AWarrior) ← Polymorph (by
1(AMage)) — logged IMMUNE (Bladestorm was up)`); it is no [CC ON ENEMY]
line and feeds no DR state. A reflect stays on its [REFLECTED] line. Each
tag has a legend, printed when it occurs. No candidate changes.

v372 (2026-10-11, FT follow-ups; user "其他继续做" / "直接做吧", candidate
changes pushed and reported after): what the post-hoc reviews and four
corpus probes found. A STAYED IN / KITED span is never measured on the log
owner's corpse (no span whose last rendered second is after the death), a
span that ends on the death second reads 0 %, and its HP start / cost
minimum / printed minimum are the [STATE] ticks of the window the line
prints. A kill window ends at the round's end — Solo Shuffle's first death —
not at the log's ([KILL WINDOW] / [VULNERABLE], kick-priority). kick-eaten
`yourCancels` and its four sibling facts count every stopped cast bar the
way [CAST STOPPED] reads it. A spell the unit's CONTROLLED pet casts (Pet-
GUID) is asked of the pet's own cast-blocking auras and lockouts, not the
owner's. Oppressing Roar under its second id (406971) lengthens a control
too ([CC BROKEN] `Ns of CC wasted`). A duration or gap under half a second
prints `<1s` on the remaining lines (`next spike in <1s`, [CC REMOVED],
[DR CLASH] `<0.1s earlier`, [KILL WINDOW] `free <1s of Ns`); an exact zero
stays `0s`. A [DMG SPIKE] start reads the [STATE] tick (0 % on a dead
unit, capped at 100 %); a one-second spike is credited to the window that
holds it; a burst window opened after the round's end gets no header.
Counts in the commit.

v373 (2026-10-11, the next fact round — the FX board's remaining
fact-layer items, re-verified on raw logs first; fact lines and facts,
candidate rows only removed): kick-eaten — presses the log refused for
another reason leave the lockout list (`refused for another reason`), a
kick whose spell also silences says so (`kickSilence`), no placeholder
range, `kickLandedFromYd`, `kickDepthPct` against the player's own
completed bars (absent rather than clamped), a cast bar the owner's death
or the round's end broke is not a cancel; two legends reworded.
"JUKED by fake X" names the last cast bar before the kick and not one a
control may have broken. Lines that were missing: an enemy's Ultimate
Penitence ([ENEMY DEF]) and Incarnation: Tree of Life ([ENEMY HEAL CD]; a
shift back into the form is not a press), Champion's Spear presses; a
[MINOR DISPELS] rider with its own cast reads `(side effect of the cast)`.
Labels: Time Spiral is no heal CD; Time Dilation `delays damage on its
target`; an enemy's dispel-backlash silence is a [SILENCE] line; `Top
sources` names one ability once (`[Physical + Shadow]`); Ice Block under
Hypothermia is `cd:Ice Block(Hypothermia Ns)` and not "unused"; an
offensive cooldown is running only while its effect is on a PLAYER.
Ends: Touch of Karma's end is its absorb's; an aura the round's end cut
says `still up when the round ended`; missed-sync-window `durationS` is
the control line's number and stops at the round's end; `endedBy` names
the breaking hit as that; `ended early — cause not logged`; a control
line across a REFRESH says so. Roster labels keep their spec tag (`N(Spec)'s
pet's X`); STAYED IN's `you moved N yd` names a Death Grip / knockback
inside the span. Counts in the commit.

v374 (2026-10-11, four follow-ups the re-verification of v373 found on
its own lines): Champion's Spear's re-press (1271980) is not a second
press of the 90 s cooldown; an enemy's Ultimate Penitence prints the
shield the log shows — `(absorb Nk, Ts)` — not `(self-save)`, and KILL
ATTEMPTS words it `popped Ultimate Penitence`; a control whose REMOVED
shares its millisecond with a control immunity going up on the holder
reads `| ended by their Bladestorm`, not `cause not logged`; `[ENEMY DEF]
… still up when the round ended` reads the same round end as every other
line (Solo Shuffle: the first death), and one legend sentence says which
instant "the round ended" is. No candidate changes.

v375 (2026-10-11, FT F20, user ruling of that day on three cooldown
numbers shown with their evidence and their 605-file add / remove): a
Lethal Calibration holder's Boomstick comes back 2 s sooner for every
enemy a Wildfire Bomb hits; Born To Be Wild takes 15 s off Aspect of the
Turtle PER RANK (a rank-2 hunter's kit line reads 120s, was 135s); Ardent
Defender is the official 90 s (the hand table said 120). The [RES]
`cd:` / `rdy:` entries and the kit lines of those three follow. One
cd-hoarded row is added on the capture (a Turtle ready 3 s before a
crisis).

v376 (2026-10-11, FT, three user rulings of that day): (1) a buff still
up when the round ended prints no `[BUFF FADED]` / `[ENEMY BUFF END]`
line — those lines exist only for a buff that ended inside the round;
(2) Storm Conduit gives a Restoration holder 4 s a cast in a log from
before the 2026-08-18 hotfix and 2 s since (the `[RES]` `cd:` / `rdy:`
entries follow); (3) an enemy's own non-wall defensive is labelled by
what it DOES — `(absorb Nk, Ts)`, `(heal)`, `(dodge)`, `(spell reflect)`,
`(rewind)`, `(root / snare immunity)`, `(redirect)` … — never
`(self-save)`, and KILL ATTEMPTS words such a press `popped X` (a proc
keeps `self-saved (X)`). No candidate row is added or removed on the
605-file capture; one kick-eaten row names a different nearest kicker.

v377 (2026-10-11, FT, the user's "都做" on four open items): (1) a
missed-purge window ends at the round's end — `unpurged for Ns` on
[ENEMY BUFF] / [ENEMY CD] / [MISSED PURGE OPPORTUNITY] no longer counts
the strip after a Solo Shuffle round's ending death; (2) Roar of
Sacrifice pressed on oneself reads `(25%, Ts)` — the official reduction,
now with a corpus split behind it (hit multiplier 0.750 at the aura's
edges) — with a legend entry saying it is not a wall (v376 printed
`(redirect)`); (3) a Storm Conduit holder's interrupted Lightning Bolt
locks for x0.35 in a log from before the 2026-08-18 hotfix and x0.6
since ([CONSEQ] `school lockout` and kick-eaten `lockout=` follow), and
a modified lockout prints whole milliseconds; (4) Storm Conduit for an
Elemental holder was measured and stays DB2's 1 s. No candidate row is
added or removed on the 605-file capture; two kick-eaten rows read
`lockout=0.7` where they read 1.2.

v378 (2026-10-11, FT, the parked parser items + a codex post-hoc review):
(1) a cast event keeps the cost its SPELL_CAST_SUCCESS row states
(parser, optional `powerCosts`), and `(no mana have/cost)` on [RES] and
cd-hoarded's mana gate read it instead of DB2's percentage × the buffed
max (13.1k → 12.5k on a Mistweaver's Invoke Chi-Ji); (2) the log owner's
never-spent kit entry states refused presses — `[UNUSED — pressed 3×,
refused: under crowd control]`; (3) codex review 45-FT-101: a dated
Storm Conduit number takes its old value only 14 h clear of the cutover
(a line without a signed UTC offset can be dated that much early), and
one Wildfire Bomb credits each unit once for Lethal Calibration; (4) the
menu (user ruling 2026-10-11 on the judgment packet): a
missed-sync-window row says whose each ready cooldown is (`The Hunt
(Name-Realm's)`, `(yours)`), in Solo Shuffle it reaches an owner only
when a ready cooldown or the control is the owner's, and the unpressed
buttons of one shared cooldown are ONE cd-waste row (`Blessing of
Protection / Blessing of Spellwarding (one shared cooldown)`). Also in
the batch, no prompt change: the desktop dispel panel ends its windows at
the round's end like the prompt; `logLineInstantMs`. 605-file numbers in
the commit.

v379 (2026-10-13, FT, the rest of the user's 2026-10-11 rulings on the
judgment packet): KILL ATTEMPTS — a 20-99 % wall a unit owns and has not
pressed is in its hand (a target or a "softer target" with an `[UNUSED]`
wall is no longer PRIME), a wall already up is stated in the tier's
parenthesis (`…; Barkskin already up since 0:59`), an attempt that meets
our own Cyclone on its target says so (`| target in your team's Cyclone
0:42–0:47`), and no window or bracket runs across the target's pressed
Spirit of Redemption; cd-hoarded — the owner gate counts the span
`ownerFreeS` prints (from the crisis on) and both ask of each stun
whether it stops THAT cooldown; `[CONTESTED]` states cast risk only for
a control with a cast; `ENEMY CC KIT` lists every control that landed on
its unit, `(landed N×)`; line 1 asks for "up to N findings, at most one
per menu event" on a menu of one to three, and the audit drops a finding
that cites exactly the event ids of an earlier one. 605 files:
burst-into-mitigation -3, cd-hoarded -30 +7 (the 7 are cap refills, no
controlled owner among them); nothing else added.

v380 (2026-10-13, FT, the registered small items — user: "把后续那些小项
也都先给我做了"): (1) a `[KILL WINDOW]` / `defenseless` span is cut on the
20-99 % wall its target put up itself (Survival of the Fittest,
Retribution Divine Protection, a wall aura with no logged press) —
`defenseless 1:35–2:51` across a 2:04 wall reads `1:35–2:04` and
`2:12–2:51`; (2) Blessing of Spellwarding recovers with the charge pool
it shares with Blessing of Protection — 300 s, the hand 180 s is gone
(kit lines, `[RES]`, `cheaper available` notes follow); (3) the cooldown
ledger asserts no unproven cooldown for a unit whose talents are unknown
(no line moves for a parsed log). Desktop, no prompt change: the
missed-sync card names the holder in Chinese, the dispel panel reads
line of sight and pets as the prompt does, the stats table / replay /
death recap cut controls at a Solo Shuffle round's end, an empty reply
has its own panel sentence. 605 files: kick-priority-missed -5 +1,
kick-priority-team -7 +2 (the added are one cap refill seen by three
owners); no candidate moves on the Spellwarding step.

v381 (2026-10-13, FT, a gap found while doing v379's wall ownership): a
talent whose entry carries another spell id proves the button it grants
(DB2 TraitDefinition.VisibleSpellID) — a player who took Fortifying Brew,
Avenging Crusader, Incarnation: Chosen of Elune or Berserk and did not
press it has its kit row (`[UNUSED]`), and a Retribution / Protection
paladin's unpressed Lay on Hands too (344 player-rounds on 605 files had
no row at all). An enemy Monk holding an unpressed Fortifying Brew reads
`gated`, not PRIME. 605 files: cd-waste +77 (Fortifying Brew 9, Lay on
Hands 68), cd-hoarded +2 (a Retribution paladin's Lay on Hands ready at
a teammate's crisis); nothing removed.

v382 (2026-10-13, FT, the GH #115 batched regen + a codex post-hoc
review): (1) Quaking Palm is an incapacitate, as in DB2 — the hand DR
table filed it under Stun, so `[DR: …]` labels and DR clashes counted it
with stuns, an own team's damage breaking it was never `[CC BROKEN]`,
and the stun-only readers let a priest press Pain Suppression through
it (codex 45-FT-102); (2) the ten reference tables and
CD_HOARDED_OUTCOME_REF regenerated on the FT code (pinned d511b212) —
printed reference rates move by at most a few points, cd-hoarded's
only its n (15,645 → 15,656), Boomstick loses its recast floor. 605
files: (1) no candidate moves, 52 contexts (DR labels, +5 [CC BROKEN]);
(2) slow-defensive-response −14 (four burst-window cells fell under the
3-point contrast gate), every other change a cited reference number;
Boomstick's `[RES]` cooldown reads one number where it read a range
(`40–45s` → `45s`, 779 lines in 160 contexts).

v383 (2026-10-14, FT, the PV382 acceptance leftovers): (1) a cooldown
Storm Conduit / Lethal Calibration shortens prints `(a–Ns)` on `[RES]`
— N the bolts cast so far, a its real return — and the owner's kick
entry reads the same rule (it counted later bolts early); (2) a shield
eaten through, dispelled or ended by its holder's death inside its last
second says so (`— used up` …); (3) the `(rewind)` legend: returns to
the health it had then (up or down); (4) the shared-cooldown cd-waste
legend: "none went off" (a refused press is not a use); (5) SPLIT PUSH
prints the span it checked and holds "stayed >20yd away" at every
sampled instant of it; (6) the low-pressure NOTE and cd-waste's
pressure gate read the owner's lowest HP up to the round's end
(`roundEndMs`), not past a Solo Shuffle round's ending death; (7) the
missed-sync-window legend points `durationS` at the lock's [CONSEQ]
line. 605 files: cd-waste −5 (three Solo Shuffle owners whose only
reading under 60 % came after the round's end; the NOTE now prints),
nothing added; SPLIT PUSH lines 30 → 3; 234 `[ENEMY DEF]` lines gain
an end note; `[RES]` presses before a row's own low bound 124 → 78.

v384 (2026-10-14, FT, menu fact fields from the PV382 re-eval audits —
facts and legends only): missed-sync-window's enemyMinHpPct reads the
lock's trough as its [CONSEQ] line does, and gains refusedInLock (own
ready cooldowns that did not go out inside a held lock) and
ownerFollowUpCc; kick-eaten states castStartT / burstAfterCastStart,
the first cast before a switch, a channel as "channel", when a root
ended into the cast (youImmobileEndedS), and an idle row's not-ready
presses after the lock apart; refused presses are worded for the common
client texts (no target, invalid target, not enough <resource>, …);
missed-cleanse adds ownerDispelUsed and dispellerPressed, and a bar
another on-GCD success ended no longer runs on as "busy casting";
cd-hoarded adds pressedLate, Alter Time's return and "(broken +Ns)" to
crisisUnitSaved, and its lockout legend no longer says readyCds escaped
the lock; one Cyclone re-broadcast is one chain link; stayed-in rows
carry refusedPresses. 605 files: no candidate added or removed; facts
change on 2,403 rows (kick-eaten 1,556, missed-sync-window 300,
cd-hoarded 211, missed-cleanse 85, position-mistake 42, death-setup 6,
kick-priority-missed 2).

v385 (2026-10-14, FT, two post-hoc reviews): (1) the sync-window
reference table carries v382's Quaking Palm fix (codex 40-FT-81: it was
generated before it) — eight more Solo Shuffle / one more 3v3 lock in
the counts, every printed rate unchanged (refN 49,136 → 49,143 in Solo
Shuffle); (2) codex 40-FT-82 on v383: an aura that ran its full length
compares in whole ms (a float rest read "ended at death"), and SPLIT
PUSH is not claimed across an instant where either player is dead or
has no position.

v386 (2026-10-14, FT, two user rulings + codex 40-FT-83): (1) an
Evoker's own flying breath (Deep Breath 357210 / 433874, Breath of Eons 403631) is time the unit cannot cast, like a stun ("深呼吸算是不能施法");
(2) refusal reasons inside `attempted` (and mana's rejected count) are in
the prompt's language — "not ready yet", "under crowd control",
"silenced", … — not the client's own text (Q6-2: "只要和整体的语言一样
就可以了"); (3) codex 40-FT-83 on v384: one aura re-broadcast is merged
only when its two pieces meet exactly (a 1 ms gap is no longer covered),
a passive proc is not a dispeller's press, and stayed-in refusedPresses
are offset from facts.t. 605 files: missed-cleanse −1 (an Evoker blinded
then in Deep Breath for all but 2.9 s of a 5.4 s root, under the 3 s
gate), nothing added; facts change on 102 rows; 27 contexts.

v387 (2026-10-14, FT, work order 2 Part 2 — user "两项都落地" — and agy
40-FT-85 on v386): (1) kick-eaten's ourLow / theirLow are read inside
the lockout's printed seconds only (a tick up to 1 s after the lock used
to enter the low and the ≤ 40 test), with a gate holding LowT inside
floor(t)…floor(t + lockout); (2) a hard cast that logs a companion
SUCCESS first (Chrono Flames → Living Flame 2 ms earlier) is the switch
press — "Chrono Flames; hard cast"; (3) own flights pair per id and are
closed at their official length when the log shows no end; a death's
lock chain no longer names the unit's own Deep Breath as a CC. 605
files: kick-eaten −50 / +15 (−12 whose only pressure fact was the
post-lock low, −38 / +15 cap re-ranking); death-setup chain text 3 rows.

v388 (2026-10-14, FT, work order 3 Part 1 — facts only — and agy
40-FT-86 on v387): round end for [CONSEQ] silences / kicks, [CD PRIOR]
and summon reach; the mitigation audit runs to the death instant; even-
count cancel medians; kick-eaten names an in-lock press still refused
after the lock as its own cooldown, lists every in-lock press of a lock
longer than 5 s, dates a hard-cast switch at its bar; owner-cast control
lengths get their own [CC ON ENEMY] lines; ENEMY CC KIT "pressed N×,
never landed"; missed-cleanse dispellersCcS, ownerSelfRemoval (Cloak of
Shadows / Divine Shield / Ice Block by type), coRemovesBacklash over the
window and every dispel type the dispel removes; stayed-in snaredS;
slow-defensive windowEndT; cd-hoarded freeAfterAttemptS after the
owner's own GCD; enemy Ultimate Penitence names its channel target and
damage; friendly Cauterize / Cheat Death [PROC] lines; MINOR DISPELS
says whether an Unstable Affliction / Vampiric Touch backlash landed;
Seduction is a disorient in the pet kit; death lines say how long the
option had been off cooldown; Tremor Totem and Vanish on the roster
(Utility); enemy major-buff intervals merge re-broadcasts. agy: an own
flight that opens a death's lock run is named in the chain, and an
off-GCD instant is never a hard cast's companion row. 605 files: no
candidate added or removed.

v389 (2026-10-14, FT, work order 3 Part 2, user "都可以落地", Ice
Block edge "走 b"): one aura re-broadcast is one application
in the uncleansed / missed-purge / backlash windows, backlash stops at
the round end; Summon Infernal lasts as its 30 s triggered aura; a
locked-school cast bar ends a kick's lock and the kick-eaten pressure
facts read the lock to that end; kick-eaten ccInWindowS counts only
what stops every spell cast that round; a channelled control whose
caster was interrupted at its removal takes no trinket / press credit;
Faerie Swarm and Sticky Tar Bomb are disarms; a Stasis release's
replayed casts are not the post-kick switch; a burst's pressured
friendly is one its casters hit or found IMMUNE. 605 files:
missed-cleanse +6 / −2, kick-eaten −1.

v390 (2026-10-14, FT, FT-R1011c follow-up — facts only): a silence
stops a spell only when DB2 lets it (SpellCategories PreventionType
silence bit, or no row) — Stormstrike, Mortal Strike, Judgment, Barkskin
go out under a silence. Every can-act reader of a named spell takes it:
kick-eaten ccInWindowS, cd-hoarded ownerFreeS, missed-sync-window
holderCc / readyCds, [DEFENSIVE AVAILABLE] free seconds. 605 files: no
candidate added or removed.

v391 (2026-10-14, FT, work order 2026-10-14d Part 1 — facts only): a CC
re-APPLIED while still open (Mass Invisibility, a holder flag change) is
the same application in the holder windows, the outgoing chain / [CC
CAST] and [CC BROKEN]; Ultimate Penitence names where its bolts landed;
an enemy's Touch of Karma tether is not our mitigation; Stasis replays
are not the first post-kick cast; kick-eaten legend names its two spans
and the bar-start lock end; [SILENCE] legend; bursts / kickSilenceS /
duringExternal end at the round's end; [CAST STOPPED] words refusals in
the report's words; three aura pairings merge re-broadcasts; an enemy in
its own flight is no ready kicker. 605 files: no candidate added or
removed.

v392 (2026-10-14, FT, work order 2026-10-14d #13 — facts only): a cast-
blocking aura (silence, hard CC) whose REMOVED was lost closes at its
official length — no more 50 s silences in [CONSEQ] / [SILENCE]; agy
40-FT-90: the mitigation side reads players only, the [CAST STOPPED]
gate takes only what the producer prints. 605 files: no candidate added
or removed.

v393 (2026-10-14, FT, work order 2026-10-14d Part 2 + 3, user 「擦边不管
落地 飞行不能施法」): one "hit by the burst" predicate for the burst
engine and the POSITIONING burst target (legends say which friendly
each names); a disarm stops weapon-requiring spells; a press enters a
sync window by its observed effect end; the owner's own can-act in
teammate crises and external-unused is the shared cannot-cast reading;
Dream Flight and Breath of Eons 442204 are own flights. 605 files:
missed-sync-window +7 / −19, external-unused −7.

v394 (2026-10-15, FT, work order 2026-10-15 Part 1 — facts only): the
[BURST ANSWERED] / POSITIONING legends name each other's line only when
it is there, and the POSITIONING legend says what each burst-target
branch does; an answer covers a burst until its observed end; the intent
guard's success evidence has no Stasis replays; a death inside a lock
longer than 5 s bounds the press list;
PEEL OPTION / CC BOOKMARK ask about the control itself (lockout school,
silence bit, disarm); [HEALING] / [MANA] read the observed end. 605
files: no candidate added or removed.

v395 (2026-10-15, FT, work order 2026-10-15 Part 2, user 「好」): DR
history and the uncleansed windows read a re-APPLIED CC inside its
length as one application and cap a lost REMOVED; the disarm pairing
follows the CC pairings and the owner's act window reads disarms for
weapon spells; KILL ATTEMPTS "popped" skips the attacking side's auras;
kick-eaten's lock end, went-out list and rank read the whole lock;
POSITIONING names no burst target the burst's casters did not hit, and
MISSED_PUSH stops at the round end. 605 files: no candidate added or
removed.

v396 (2026-10-15, FT, agy 40-FT-96, user 「落地」): a CC an enemy pet
broke is broken by damage, not an uncleansed window (a BROKEN row's
source is the breaker). 605 files: missed-cleanse +1 / −2.

v397 (2026-10-15, FT, work order 6 Part 1 — facts only): a burst's
extra another enemy pressed names that enemy; [BUFF FADED] reads the
copy on the unit the press was on and states a logged break; the
death-setup chain prints each entry's span and [HEALER CC] the free time
between runs; legends: [STATE] `dead` in the death second, [RES] as of
m:ss.0 and `cc:`, msw alsoHeldAt, "defenseless" is the target's own;
[BURST ANSWERED] names a second friendly death; a Stasis release after
a kick is the player's press, not a replay. 605 files: no candidate
added or removed.

v398 (2026-10-15, FT, agy 40-FT-98 — facts only): each press of a
buff reads its own target's copy (a removal one press stepped over
stays for the next); the death-setup chain lists kick lockouts and
[HEALER CC] counts a lockout between two CCs as locked, not free. 605
files: no candidate added or removed.

v399 (2026-10-15, FT, agy 40-FT-99 — facts only): a buff pressed again
on the same unit while up was refreshed — no [BUFF FADED] line of its
own, and the copy that ends is the refreshing press's. 605 files: no
candidate added or removed.

v400 (2026-10-15, FT, work order 6 Part 2 n37, user 「按你的建议走」): a
burst's pressured friendly is the one the burst hit who died inside the
window (the first to die), else the lowest HP. 605 files:
slow-defensive-response −1.

v401 (2026-10-15, FT, agy 40-FT-101 — facts only): a dead pressured
friendly has no self-save after its death and is not read kiting off
its corpse; the [BURST ANSWERED] legend states the pressured pick and
the control rule exactly. 605 files: no candidate added or removed.
v402 (2026-10-16, data refresh 12.1.0.69587 → 12.1.5.70391, user
「可以先把数据刷新做一下」): every DB2 generator re-run at the new build
(hotfixes through 2026-10-15). Printed numbers move where the game moved:
Nature's Swiftness with Call of Ohn'ahra +30 s (DB2 −60; the hand −30
that duplicated DB2 is removed), Ice Block +30 s (Winter's Protection
PvpMultiplier 0.5), Merithra's Blessing is Arcane (castable in a Nature
lockout), PvP taunt / Ox Kick / Dark Simulacrum cooldowns, several
defensive durations; Ice Cold's node spell is 414658 and its presses stay
Ice Block's. Data stands for the current build on logs of any date (user
ruling). 605 files: cd-hoarded −1, kick-priority-team +2,
kick-priority-missed +1 (one new kill window: Ice Block on cooldown).
v403 (2026-10-16, user ruling 「沉默本身其实是一种控制。打断的话，实际上
主要是一个 cooldown trade-off 的问题」 — facts only): one "is this a kick"
predicate (`isKickSpellId`) for every reader that counts or audits kicks;
Garrote - Silence, Strangulate, Spider Venom and Tightening Grasp are
silence auras with no school lockout and leave it. A DK's own Strangulate
presses no longer sit in the kick audit (they stay as [SILENCE] / [CONSEQ]
control lines), and the stats table stops counting them as kicks. 605
files: no candidate added or removed; 93 files change — 249 Strangulate
entries leave the `Kicks:` lists (237 silenced, 12 hit nothing) and the
12 matching `[KICK] your Strangulate … hit nothing` lines go.
v404 (2026-10-16, F15 batch 1 — fact1215 deep dive C6 + C1, user-approved
605 preview 「Defensive,接受候选变动」/「接受」): three major cooldowns had no
friendly ledger row — Time Stop 378441 (Evoker roster, Defensive), Incarnation:
Tree of Life 33891 (Druid roster, Utility: the healer save table strips its
Defensive tag for Restoration Druid) and Havoc Metamorphosis (pressed as the
200166 landing → 191427 via SPELL_CANONICAL_IDS). Flameshaper Obsidian Scales
cast on an ally is read from the ally's own copy (`allyCopyRecipient`): the
`[YOU] [CD]` / `[TEAM] [CD]` line names the ally, `[ENEMY DEF]` prints the ally
copy as an external, cd-hoarded's teamAnswered counts it, and ABILITIES INTO /
KILL ATTEMPTS / `defenseless` spans do not read the 15 % copy as a wall. 605
files: cd-waste +8 and cd-hoarded +8 (Time Stop held / never pressed; 5 more
rows' facts change), missed-sync-window +4 net (+7 / −3, friendly
Metamorphosis now seen); lines: [ENEMY DEF] ally Obsidian Scales 0 → 73, press
lines naming the ally 0 → 102, ABILITIES INTO into Obsidian Scales 145 → 81,
Time Stop press lines 1 → 108, Tree of Life 185 → 652, Metamorphosis 0 → 377.

v405 (2026-10-16, F15 batch 2 — fact1215 R1, user ruling relayed by
round1+2: 「我现在只关心事实层的东西」 — every printed "lowest / low / team
min" is the true minimum; point readings keep the 2026-09-23 last-line rule):
`hpTroughInWindow` reads every line of an instant (a hit and the heal it
provoked share one ms — 332b9b2f printed 43 % over 36.8 %); the `[KILL
WINDOW]` team min reads `hpTroughInEventSpan` instead of whole-second ticks
(8cd58545 `team min HP 33%` over a paladin at 3.8 %); `[CD PRIOR]` "bottomed
at" prints the dip's trough (its ranking and gating stay on the grid).
Deliberately unchanged (predicate-index "Not yet unified"): `[SLACK]` /
`[CONTESTED]` team min (the grid band IS the segment), an event span's
first-second tick (62fdbf2e), `hpAtPress`. 605 files: no candidate added or
removed; 49 rows' HP facts move (kick-eaten 25, missed-sync-window 14,
slow-defensive-response 7, position-mistake 3); troughFactScan: [DMG SPIKE]
lows below the log 310 → 0 of 9,468, [KILL WINDOW] team min 2,224 → 0 of
3,891; two burst target lines gain a `(low …)` the same-ms dip now clears.
v406 (2026-10-16, F15 batch 3 — fact1215 R2 + R3, facts only): a pet's
dispel names the pet (`dispelActorLabel`: `5(AWarlock)'s pet` on [PURGE] /
[ENEMY PURGE] / [ENEMY CLEANSE] / [MINOR DISPELS], as the [KICK] lines
already did); what a PvP trinket press removed — the [ENEMY TRINKET] line
falls back from a CC to a disarm (`findBrokenDisarm`, the friendly line's
fallback) to a silence (`pressEndedSilence`, now the [SILENCE] tail's one
predicate, and enemy silences read the enemy's own presses); a press logged
after a removal the log gives another cause for (a damage break / a dispel,
`ccEndedByLoggedCause`) does not take that CC; KILL ATTEMPTS counts every CC
a press ended (`ccsRemovedByPress`), not only the bound one. Deliberately
unchanged: roots (a judgment), an enemy's reflected Cyclone (NYU). 605 files:
no candidate added or removed; breakFactScan: pet dispels credited to the
owner 1,952 → 0 of 2,438, enemy trinket presses that removed our CC /
disarm / silence with no `out of` 356 → 0 of 7,966, trinket credited after a
logged break / dispel 15 → 0 of 73; KILL ATTEMPTS `target trinketed out`
11 → 206 lines.
v407 (2026-10-17, F15 batch 4 — user rulings 2026-10-17 「只读事件开始之后」 and
「改成真最低」, 605 preview approved 「接受」): an event span's minimum reads
only what happened inside it — `hpTroughInWindow`'s span mode counts a tick
only when the sample it read lies inside the span (kick-eaten ourLow /
theirLow, [CONSEQ], missed-sync-window enemyMinHpPct, [KILL WINDOW] team
min; 62fdbf2e `theirLowPct=37` was the 1:51 tick read 0.5 s before the kick,
the in-lockout low 43 %). STAYED IN (a burst span whose line pairs its
minimum with the start second's tick) is left as it was (predicate-index
NYU). [SLACK] / [CONTESTED] `team min HP` is the true minimum inside the
span (`teamMinHpPctOver` → `hpTroughInWindow`), with a legend line saying
the span is judged on the whole-second readings. `checkCrisisHpStateConsistency`
does not adjudicate a kick-eaten trough on the lockout's edge seconds. 605
files: kick-eaten −9 (12 rows leave — their only ≤ 40 % low was read before
the kick — 3 kicks of the same rounds take the capped slots), 66 kick-eaten
and 68 msw rows' HP facts move, [CONSEQ] 250 / [KILL WINDOW] 232 lines;
troughFactScan: [SLACK] / [CONTESTED] team min above the log 502 → 0 of 919,
kick-eaten lows below every in-lockout reading 70 → 12 of 790 (the 12 are
the printed t / lockout rounding at the lock's last instant).
v408 (2026-10-17, F15 batch 5 — fact1215 R8, 605 preview approved 「接受」):
aura re-broadcasts and refreshes read as one aura. ABILITIES INTO's walls are
the shared `buildAuraIntervals` (09195b87: one Time Dilation split at a same-ms
REMOVED + APPLIED printed a second wall); a missed-purge window is not opened
again by a re-log inside a window already emitted for the same buff (62fdbf2e
Alter Time, 105-1 Power Infusion 0:18 + 0:21); an enemy cooldown pressed while
its aura was already up reads that aura's end (519781fd Malevolence 1:21–1:47,
not the official 20 s), and an end the builder clamped to the combat's end is
no observed end (26bfd4f3 Kingsbane / 101-5 Army of the Dead `6s left`). 605
files: position-mistake −4, missed-sync-window −2, kick-eaten +1 net,
slow-defensive-response +1; 87 duplicate [MISSED PURGE OPPORTUNITY] lines go;
ABILITIES INTO 156 lines, [RES] `s left` 2,881, burst / kill windows 132.
v409 (2026-10-17, F15 batch 6 — fact1215 C2, facts only): a school-limited
immunity's [ENEMY DEF] label names the schools it stops — `immune to magic`
(Cloak of Shadows, Blessing of Spellwarding) / `immune to physical` (Blessing
of Protection) — read off `limitedImmunitySchoolMask`, the mask KILL ATTEMPTS
gates the same aura on; the legend says so (0f894aee 5:00: Cloak `immune`
while 9 physical hits landed). 605 files: no candidate added or removed;
4,426 [ENEMY DEF] lines change label (4,341 magic, 85 physical); new gate
checkSchoolLimitedImmuneLabel 906 → 0.
v410 (2026-10-17, F15 batch 7 — fact1215 C9, facts only): "is this a stun"
reads the aura's official mechanic as well as its DR category
(`isStunDrAura` / `isStunCcInstance`): Infernal Awakening 22703 is a stun
(mechanic 12) with no DR family, and KILL ATTEMPTS said "(no stun)" over it
and the [RES] `cc:` slot gave it no [stun] (0b86016f, 15b4d4ec). The two
readers that hand-tested `"Stun"` (resourceSnapshot, killAttempts) read the
predicate. 605 files: no candidate added or removed; 232 contexts change —
KILL ATTEMPTS gains Infernal Awakening stun openers, [RES] `cc:` tags them.
v411 (2026-10-17, F15 batch 8 — fact1215 C10 item 91, facts only): the burst
ledger's "target had a major defensive up" matches a wall that logs under an
aura id other than its cast's (`SELF_WALL_AURA_TO_CAST_ID`: Greater
Invisibility 110960, Blur 212800, Fortifying Brew 120954) — 62fdbf2e Burst #2
missed Vizine's Greater Invisibility that KILL ATTEMPTS named. 605 files: no
candidate added or removed (burst-into-mitigation prices those aura ids at no
wall, as before); 504 ledger lines added (320 Greater Invisibility, 184 Blur /
Fortifying Brew).
v412 (2026-10-18, F15 — codex post-hoc 60-POSTHOC-02 U2 castability, facts
only): (1) a dispel backlash is a control for "could this unit cast now" —
Unstable Affliction's silence 196364 is a silence, Vampiric Touch's horror
87204 hard CC (`isHardCcAura` / `isSilenceOnlyAura` read
`BACKLASH_AURA_CC_TYPE`; neither has a DR family, and a kicker under either
read as ready); (2) `castBlockingAuraIntervals` filters the caster on the
APPLIED only, so a friendly breaker's BROKEN row (Blessing of Sacrifice) ends
the CC instead of the official length; (3) a set of spells is stopped while
every member is, read per time (`blockedForEverySpell`) — two overlapping
single-school locks used to be dropped as free. 605 files: no candidate added
or removed; one menu fact changes — 192-3-1144 kick-eaten @103.3
`ccInWindowS` 2.8 → 0.9 (the priest's UA backlash silence counted as hard CC;
it now stops only silenceable casts, the Seduction 0.9 s remains).
v413 (2026-10-18, F15 batch 9 — fact1215 R4 + C4, facts; user 「接受」 the
605 preview): who broke an aura (`breakerOfBrokenRow`) — a
SPELL_AURA_BROKEN_SPELL row naming the HOLDER takes the other unit whose hit
of the breaking spell landed just before (a Desperate Soul's Wrath of
Nathreza was "broken by 6(MMonk)'s Wrath of Nathreza") or the caster of that
damage-over-time; a Blessing of Sacrifice DAMAGE_SPLIT onto a paladin whose
own link is up is the paladin's spell (was credited to the protected ally).
Readers: the control lines' `broken by`, [BUFF FADED], `endedBy`, [CC
BROKEN]. And the paladin's own 6940 link aura is no protection on them
(`isCasterSideLinkAura`): [STACKED DEFENSIVES], cd-hoarded's "already
protected" abstain, crisis-no-response. 605 files: cd-hoarded +14 (dps +9,
healer +5), crisis-no-response +1, 3 cd-hoarded rows move to an earlier
crisis of the same context; 744 `broken by` lines change owner; +30 [CC
BROKEN]; [STACKED DEFENSIVES] −21 / +7. breakFactScan `brokenByHolder` 115
→ 0, `brokenBySplitAlly` 611 → 0.
v414 (2026-10-18, F15 batch 10 — codex post-hoc 60-POSTHOC-03 U3 burst,
facts only): (1) a burst window's outcome readings share one bound — the end
of its last rendered second (`outcomeLastMs`): who the burst hit, the damage
taken and the control-answer filter used to stop at the whole second while
the deaths ran to its end, so a friendly hit and dead in that last second
lost the death-first pressured pick; (2) the burst ledger drops a press after
the round's end before grouping (`Avatar 0:10–0:20 + Recklessness
0:21–0:20`); (3) a HoT tick on the owner is a fresh self-heal only when the
HoT was (re)applied on the owner inside the crisis window — a self-
Rejuvenation from before ticked on while the owner cast Rejuvenation on an
ally (`selfHealCasts` / `selfHealFreshPct`). 605 files: no candidate added or
removed; 2 ledger headers lose their post-round CD; [BURST ANSWERED] −14 /
+20 lines (a control on an enemy that hit the pressured friendly in the last
second now answers; one window newly listed). New gate
checkBurstLedgerSpellSpans 4 → 0.
v415 (2026-10-18, F15 batch 11 — fact1215 R5 + R6, facts only): which
control-avoidance aura was up when a control hit (`ccAvoidanceBuffsUpAt`):
read in log order up to the judged row (a Nullifying Shroud the IMMUNE miss
consumed is REMOVED after it in the same ms — the cause was missing), an
application the log never closes capped at its official length (a Phase
Shift with no REMOVED was "up" 56 s later and hid the DR cause), Druid forms
exclusive. A control that lands after its cast (Capacitor Totem, Sigil of
Misery, Ring of Frost) is read at the instant it hit — the player's miss
row, else a one-pulse control's first landing, else the cast — for the aura
credit and the mobility credit, and its [CC AVOIDED?] line sits at that
second (06aa443c: "Shroud active" for a pulse after the Shroud ran out).
605 files: no candidate added or removed; [CC NOT LANDED] / cast-line
`[IMMUNE — X was up]` causes added; [CC AVOIDED?] lines move to the hit
second, some credits drop (aura / mobility not up at the hit) and some
appear. breakFactScan `immuneCauseConsumed` 100/105 → 0, `delayedAvoidAtHit`
28/426 → 0. Folded in before push (codex 20-F15-21): a delayed control's
[CC AVOIDED?] line stamps its cast — `(by X; cast m:ss)` — and
checkCcAvoidedLandedConsistency anchors on that stamp (the producer's window
is the cast's); each cast reads its own pulse (from its earliest landing to
the caster's next cast of the spell); the aura reading skips dose rows,
takes only its own source's rows, and reads a same-ms REMOVED with no line
order as after the row. 605: 230 [CC AVOIDED?] lines gain the stamp, no
other line and no candidate changes.
v416 (2026-10-18, F15 batch 12 — fact1215 R9 + R10, facts only): (R10) a
press the game refused inside two controls goes to the control of the
mechanic its reason names (`CONTROL_REJECT_MECHANIC`, read off the 605
corpus: each reason text on one DB2 mechanic in ≥ 98 % of its single-control
rows), else the earliest-started; a dispel-backlash silence takes no
`control` press (09dda3c6: "while polymorphed" presses went to Asphyxiate;
06356dd9: "while stunned" presses went to the UA backlash silence). (R9) a
channelled control whose caster was interrupted at its removal says so —
`ended by <who>'s <kick> on its caster` (was `cause not logged` or nothing;
a pet caster such as a Succubus resolved too); a channel that puts no aura
on its caster (Arcane Missiles) counts as busy from its cast to its kick or
its own last tick, for missed-cleanse `ownerCastingS` and kick-priority's
`youChannelling`. 605 files: no candidate added or removed; +310 `on its
caster` ends (30 of them were `cause not logged`); `pressed during it`
clauses −38 / +42; 18 menu facts (ownerCastingS up where Ray of Frost, Mind
Flay: Insanity, Rapid Fire, Disintegrate … fell in the window). Folded in
before push (codex 20-F15-24): a kick ends the channel only when it
interrupted that channel (`extraSpellId`); a channel with no caster aura
ends at its caster's next press of anything else; a refused press of a kit
cooldown logged under a variant id (Stasis, Alter Time, Imprison, Stampeding
Roar, Lay on Hands …) counts under the kit's printed name. 605: 4 menu facts
(ownerCastingS 4.4 → 3.9 with a Mind Flay: Insanity tick past the next
press; 0.8 s of Crackling Jade Lightning → none), 27 contexts (`pressed during it` −9 / +42
and the clause's legend); no candidate added or removed; the two-way
breakFactScan `refusedPressMechanic` 23 → 0.
v417 (2026-10-18, F15 batch 13 — fact1215 C5, facts only): a wall aura with
no press of it logged (not of the button, not of a cast whose effect it is —
Vanish 1856 → 11327 now pairs) reads `[no press logged]` on its [ENEMY DEF]
line and is never `— removed early` on length alone (Smoke Screen's 3 s
Survival of the Fittest with Exhilaration read as a pressed 8 s SotF
"removed early"); the KILL ATTEMPTS legend says `popped X` states that X
went up. A friendly [PROC] activation says what it went out with, the enemy
side's reading (`procTriggerOf`): `Avenging Wrath (with Wake of Ashes)`; the
activation under another id is never its own trigger. Radiant Glory's
Avenging Wrath with no cast is an `(no press)` occurrence (weight 0), so it
has an [ENEMY CD] line. 605 files: no candidate added or removed;
pressFactScan `noPressCopy` 126 → 0, `procWith` 1,152 → 0, `auraOnlyAW` 93 →
0, `pressedNotTagged` 0 / 9,036. Folded in before push (codex 20-F15-25):
the round's trigger is printed only on an activation whose own ms has a cast
of it (`procTriggerAt`), each ledger activation anchored on its own cast row
(`activationCastMs`; the ledger can carry the aura's ms); an aura twin pairs
one cast with one application. 605: 391 `with X` labels removed (on [ENEMY
CD], [TEAM] / [YOU] [PROC]: activations with no such cast in their ms); no
candidate changes; the strict scans `noPressCopy` 3 / 126 (one Mass
Invisibility re-send the product joins), `procWith` 0 / 1,468.
v418 (2026-10-18, F15 batch 14 — fact1215 C10 rest, facts only): (1) a
SPELL_MISSED row says a control did not land only for a control's own id or
a cast whose control effect followed at least half of its corpus casts
(`missReportsControl`, reading the cast→effect table's hits / casts): Wake of
Ashes' stun 255941 takes demons and undead and follows 24 % of 255937's
casts, so the IMMUNE / MISS of its damage on any other player was a false
`[CC NOT LANDED]` (0f894aee 1:54). The cast-line `[IMMUNE …]` tags are
unchanged (they say the cast hit an immune target). (2) A warlock's offensive
purge follows the pet the log shows (`warlockRanPurgePet`, the roster's
`warlockPetFunctions`): a Sayaad / Felguard / Imp / Voidwalker warlock is
`CANNOT offensive purge`, is not a team purger and gets no missed purge
(1120cb61). (3) Ice Nova 157997 is a root (DB2 root aura, Magic; the one
official Magic root with no category entry): [ENEMY CLEANSE] / [CLEANSE]
lines, the [RES] cc column, and a [BURST ANSWERED] control answer as Frost
Nova (34204ef9 1:41). 605 files: slow-defensive-response 99 → 95 (−4, a burst
answered with Ice Nova — user approved 2026-10-18); no other candidate added
or removed; 60 `[CC NOT LANDED] … Wake of Ashes` lines removed; 68 [MISSED
PURGE OPPORTUNITY] lines removed; new gate checkWarlockPurgeFollowsPet 209 →
0; breakFactScan `conditionalControlMiss` 60/650 → 0.
v419 (2026-10-18, F15 batch 15 — fact1215 C7 fact half): an enemy's press of a
roster Utility row (`SpellTag.Utility`) that no other enemy family prints —
Champion's Spear, Smoke Bomb, Tremor Totem — gets a line,
`m:ss  [ENEMY UTILITY]   <pid> (<spec>): <Spell>[ (cast k of N)]` (user ruling
2026-10-18: a new tag, a fact line only; Champion's Spear stays a Utility row,
it opens no [OFFENSIVE WINDOW] and feeds no [ENEMY CD] / [RES] reader). Vanish
and Lichborne keep their [ENEMY DEF] line, Tree of Life its [ENEMY HEAL CD]
line (`enemyDefSpeaksForPress`). 605 files: 2,604 lines (Champion's Spear
1,316, Smoke Bomb 666, Tremor Totem 622) in 1,529 contexts with the legend;
no candidate added or removed; pressFactScan `enemyUtilityPress` 2,604 missing
→ 0.
v420 (2026-10-18, F15 batch 16 — fact1215 R7): "defenseless" says nothing was
up, and three kinds of save were up inside spans that said so. The span is now
also cut by the target's own immunity (`[ENEMY DEF] … (immune …)`: Vanish
inside `defenseless 1:27–2:21`, 3867e9ef) and absorb shield (a 494k
Anti-Magic Shell inside 0:29–0:55, 1120cb61) — `ownSaveSpanS`, the own-wall
reading — and by an area save whose effect aura the target carried (Rallying
Cry 97463 on the Death Knight 0:29.5–0:42.5, same round) — `areaSaveSpanOnS`.
A heal, a rewind or a proc save cuts nothing (the 1215 verification: Crimson
Vial / Healthstone, Alter Time). Unchanged on purpose (2026-10-13): a
defensive the target owns and never pressed does not end the span; a new
legend line under KILL WINDOWS says so (`a defensive it never pressed may
still have been in hand`). 605 files: kick-priority-missed 45 → 38,
kick-priority-team 67 → 58 (user approved 2026-10-18 with the 174-5-940
example: Rallying Cry 1:10 and Intervene 1:20 on the rogue, a 1:25.7 Healing
Wave no longer inside a defenseless window); [KILL WINDOW] lines −3,953 /
+4,614 (spans cut into more pieces), [VULNERABLE] −75 / +150; new gate
checkNoWindowAcrossOwnSave 3,368 → 0.
v421 (2026-10-18, F15 batch 17 — fact1215 R11 fact half, facts only): (1) a
spam fold `(xN over Ns)` counts the casts printed one by one inside a
friendly-death window, as its legend says (09dda3c6 r3: 13 Penance, the fold
said x10). (2) The [RES] `cc:` slot names, of the controls on a unit then,
the one that holds it longest (1120cb61 0:18: Blinding Sleet −<1s over a
Capacitor Totem stun that ran 2.3 s longer). (3) A dispel is matched to its
own press at an empowered cast's release (SPELL_EMPOWER_END) as well as at
its SUCCESS, which the log writes when the hold starts
(`buildCastMatchIndex`; 34204ef9: Fire Breath held 1.1–1.3 s, six dispels
read `(passive)`). (4) Dampening is read on the line's own team — the owner
side for the header, alerts, press lines, friendly deaths and [MATCH END],
the enemy side for an enemy [DEATH] line; the 2v2 / 3v3 rules from the whole
roster (3867e9ef: the enemy team ticks one stack ahead for seconds at a
time). (5) The cc-avoidable menu legend states its predicate: the player free
to act (off the GCD, not controlled) at some instant from one second into the
bar until it landed (was "at least a second of that bar"; `castBarSeen`
itself unchanged — a judgment item). 605 files: no candidate added or
removed; 2,686 dampening lines re-read (DAMPENING ALERT 762 → 752); spam
folds −555 / +574; dispel lines naming `(passive)` / `dispelled` −63 / +3; [RES] 1,195 lines;
the cc-avoidable legend in 35 menus. Checks: unit tests (r11aFacts.test.ts,
red on the parent) and the 605 diff; no new gate.
v422 (2026-10-19, F15 batch 18 — fact1215 R11 rest): (1) cd-hoarded's
response set ("did they answer") reads the owner's redirect saves for the
crisis unit — Roar of Sacrifice, Master's Call, Intervene, Leap of Faith
(`teamAnswers.ownerRedirectSaves`, cast on that unit, or on no one else when
it is the owner). They are never accused (rulings A20 + U3) and are outside
the ledger, so a press of one did not count as an answer either (5dd3d2d6
@86; 111-1-598 0:34: an Intervene on the rogue at 34 % beside "Rallying Cry
left in hand"). (2) A [MISSED PURGE OPPORTUNITY] line whose window saw a
purge of ours on that enemy take another buff says so — `| <pid>'s <purge>
at m:ss took <buff> instead` (519781fd 1:36: Devour Magic took Renew off the
warrior under Blessing of Protection). 605 files: cd-hoarded 1,273 → 1,249
(dps 663 → 648, healer 610 → 601; one re-timed) — user approved 2026-10-19
with the 111-1-598 example; no other candidate added or removed; 249
`took … instead` notes. Checks: responseOnlySave.test.ts (red on the
parent); the note is a render of `ourPurges`, no new gate.
v423 (2026-10-19, F15 batch 19 — fact1215 112-1, facts only): a control's
REMOVED and its APPLIED again inside the re-send gap (`AURA_REBROADCAST_GAP_MS`)
are two controls when the source recast the spell between the two
applications (`ccRecastSplitsResend`, drAnalysis.ts — ruling A51's cast-backed
REFRESH rule, now for a re-send too), read by the CC windows
(ccTrinketAnalysis), both DR histories (`buildCcCategoryHistory`, the
outgoing CC chains) and the break analysis. 112-1 0:54: Cheap Shot 07.118 →
11.131 ran its 4 s, the recast landed 11.132 and the Medallion took it at
12.015 — merged, the recast read as having run its course; now `0:53 … Cheap
Shot (1s) | ended by their PvP trinket` and `[ENEMY TRINKET] … out of Cheap
Shot`. 605 files: no candidate added or removed; 54 control lines become two
each (the second with its own DR: `Sleep Walk (1s) [DR: Disorient 50%]`); 27
KILL ATTEMPTS lines (`1 stun` → `2 stuns` where the rogue recast); breakFactScan
`recastResend` (new).
v424 (2026-10-19, F15 batch 20 — fact1215 R11, Solar Beam): the log writes
no aura for Solar Beam's silence (81261: 0 rows in 1,215 logs), so it had no
[SILENCE] line. The only evidence is the owner's own press refused as
silenced while no silence aura was on them (d64022ad 0:25.915: Flash Heal
refused after a 0:25.340 Solar Beam). Such a refusal is attributed to the
latest enemy cast whose official effect aura
(`nominatedEffectAurasOfCast`, DB2) is a silence, inside that aura's official
length (81261: DB2 SpellDuration 8000 ms, added to spellEffectOverrides), and
whose silence the log wrote on no one (Solar Beam is an area and is written on
no one, whoever it was aimed at); a cast whose silence is a
dispel backlash is not one. One line at the cast, no length: `m:ss  [SILENCE]
<pid> ← Solar Beam (by …) | no aura logged — silenced at m:ss (<press>
refused); length not logged` — the owner only (refusals are the recorder's).
User approved 2026-10-19. checkKickEatenKickSilence reads aura-backed silence
lines only (`kickSilence` is a length). 605 files: 25 lines, all Solar Beam;
no candidate added or removed; breakFactScan `solarBeamSilence` 25 → 0. A
refusal two such unlogged casts could explain (a Solar Beam and a Wailing Arrow)
names neither and gets no line. (Unpushed, folded in — codex 20-F15-36:) a source
counts only through a class-owned effect (`nominatedEffectAurasOfCast(…,
{ classOwned: true })`, the effect's DB2 SpellClassOptions: Arcane Torrent's
name nominated the TBC silence 33390); a refusal is covered, and a cast ruled
logged, by one silence reading (`isSilenceEffectAura` — a logged 81261 now
covers); two casters of the same spell are two sources; a refusal after the
owner's death in the round is none. 605: zero lines changed (b59).
v425 (2026-10-20, GH #115 batched regen #5 — data only): the reference
tables went stale across the fact1215 batches (PV389–PV424: re-broadcast
merges, ledger rows for Time Stop / Tree of Life / Havoc Metamorphosis,
kill-window cuts, kick and silence readings). Regenerated on the same
corpora as the 2026-10-13 regen at code cc8b22e8c: burstWindowPrior,
syncWindowPrior, behaviorPrior, cdTriggerPrior (Time Stop rows added),
kickPriorityPrior + heal spells, kickLockoutObserved, healerSaveCd,
backlashDispelPrior (opportunities 231,948 → 95,555 on the same 21,101
rounds — PV389's one-application-per-re-broadcast), dispelObserved,
cdRecastFloor (Tree of Life gains a floor of 0.463, Nature's Swiftness
0.803 → 0.59 — GH #154 tracks the missing mechanism), the reference
vectors, and CD_HOARDED_OUTCOME_REF's n (15,656 → 15,653; 5.8 / 13.0
unchanged). 605 files (b60-lint → b62-regen5b): slow-defensive-response
+1 / −1 (3v3 Avenging Wrath 8 vs 10 → 7 vs 10 crosses the 3-point
contrast door; the Solo Shuffle fallback cell 8 vs 11 → 8 vs 10 falls
under it), every other candidate unchanged; reference facts only:
cd-hoarded 1,249, missed-sync-window 501, slow-defensive-response 94,
backlash-dispel 62, kick-priority-team 58, kick-priority-missed 38,
crisis-no-response 5; contexts: 2,907 `[RES]` lines in 526 files (Tree of
Life / Nature's Swiftness cooldowns read a range). Gates: baseline residue
only. gate:full: 1,244 pairs, 0 new diffs.
v426 (2026-10-20, GH #154 — Druid cooldown talents): three scripted talent
effects the cooldown ledger did not model (user: "if you don't press them,
the cooldown afterwards gets shorter"). Control of the Dream 434249
(`IDLE_COOLDOWN_CREDITS`): the time Nature's Swiftness, Tree of Life,
Convoke, Force of Nature, Celestial Alignment / Chosen of Elune sat ready
comes off the cooldown of the next press, ≤ 15 s, press by press; a
round's first press gets the full 15 (ready through preparation);
multi-charge targets get nothing. Cenarius' Guidance 393371: Tree of Life
−5 s as each Grove Guardian fades (summon + 8 s, `triggerSummonIds`), and
Restoration Convoke −60 s (393374 dummy; hand row in
customTalentModifiers). Call of Ohn'ahra 1246126: Nature's Swiftness +30 s
in a log before 2026-09-22, +60 s after (`DATED_COOLDOWN_VALUES`).
ledgerImpossibleCastScan, 2,240 files / 405,569 presses (presses the
static model called not ready — impossible + floor-explained): Nature's
Swiftness 10 + 492 → 0 + 0, Force of Nature 0 + 736 → 0 + 0, Tree of Life
5 + 460 → 2 + 13, Convoke 18 + 148 → 7 + 0 (all Feral, pre-existing);
total impossible 612 → 588, no other spell changed. 605 files
(b62-regen5b → b63-druid154): missed-sync-window +7 (dps 366 → 371,
healer 135 → 137; Balance Force of Nature back inside a CC window — user
approved), none removed, two cd-hoarded findings list one more ready
cooldown (Convoke / Nature's Swiftness); 878 context files change in
readiness facts only. Gates: baseline residue only. cdRecastFloor still
carries the pre-fix Tree of Life / Nature's Swiftness floors (GH #115).

v427 (2026-10-20, F16 — fact2 round-2 audit, 67 confirmed defects by fact
class, and the v0.1.36 same-match retest): every cast-keyed reader resolves
an aura to the cast whose own effect it is (`castKeyOfAura`, fact2 C10);
kill-window team damage states absorbed hits, and they count in burst
detection (user ruling R7 option A: [KILL WINDOW] +412, [VULNERABLE] −217,
no candidate change); the [STATE] sampler reads the last row before the
second; ENERGIZE / DRAIN / LEECH rows carry an HP / position sample (parser);
a trough reads its unit's death second up to the death (user ruling R1,
gates relaxed to match); press HP under a HoT's first tick, a refresh and a
same-named heal; hard-cast outcomes paired to the latest completion;
kill-attempt target and anchor; Spell Reflection returns and their school;
school-limited immunities in ABILITIES INTO; kit controls in "your CC
ready"; [REJECTED] runs per spell. User rulings 2026-10-20 on the retest
(「我觉得都算」): Time Dilation's held-back damage is mitigation
([STACKED DEFENSIVES] prices it from its own absorb rows, the audit row no
longer says "not prevented"); a ready Alter Time is a major defensive in
hand for the kill-window span (`KW_IN_HAND_ONLY_DEFENSIVE_IDS`; pressed it
holds nothing, fact1215 R7); racial damage buffs (Blood Fury, Berserking,
Ancestral Call) and Ultimate Penitence are offensive cooldowns
(`OFFENSIVE_RACIAL_WINDOW_IDS`). 605 files (base fcde27b10 → b8 455fcfd51,
7,559 → 7,560 menu events): cd-hoarded dps 648 → 605 / healer 601 → 576
(owner controls recognised through C10 answer the crisis, ruling fa5e; an
owner's own 15 % Obsidian Scales copy), missed-cleanse dps 147 → 176 / healer
187 → 208 (an enemy-applied offensive DEBUFF no longer reads as the unit's
own threat), kick-eaten +4 / +2, missed-sync-window +2 / +3 and
slow-defensive-response +1 (racials and Ultimate Penitence as offensive
cooldowns), kick-priority −1 / +2, position-mistake −2 / +2, death-setup
+2 / +1, crisis-no-response +1. fact2Scan (605, 39 checks firing on the
base): 28 read 0; residuals stateTick 169, killTargetInside 12,
aoeMissAvoided 10, reflectedLine 6, repressLength 6, burstAbsorbed 4,
offensiveTag 3, riderPassive 3, hotPressHp 3, nonControlCount 3, sorImmune 2
(GH #153).
v428 (2026-10-20, cooldown mastery batch 1 — GH #124): a talent several
specs take carries one SpellEffect row per spec's version and only the
TOOLTIP says which is whose (`$?c2[… $s1 …]?c3[… $s3 …]`). The generator
now reads the branches (scripts/datagen/lib/tooltipSpecGates.ts: cN by
ChrSpecialization.OrderIndex, spec-passive auras definite, other conditions
unknown; an effect the text never names takes a sibling row's gate through
shared targets) and writes `onlySpecIds`; `applyCdModifiers` gives such a
row to those specs only (unknown spec: none — the longer cooldown). 45 rows
of 17 talents gated. Elemental Affinity 431067: Fire Dragon's Breath was
modelled 28 s against a corpus floor of 40.0 s (372 recasts, 2,240 files)
— now 40; Frost holders' Ring of Frost / Frost Nova / Ice Nova / Cone of
Cold no longer take the Fire mage's −30 %. Improved Feign Death 1258486 is
per rank (every holder rank 2; floor 20.1–20.2 s, none under 20.0): 25 →
20 s. Feral Convoke: Ashamane's Guidance's −50 % sits on 391538, which no
node names — hand row on 391548 (gaps 60.6–94.1 s): 120 → 60 s.
ledgerImpossibleCastScan (2,240 files): Feign Death floor-explained 1,058
→ 0, Convoke impossible 7 → 0, total impossible 588 → 581. 605 files
(b63 → b64, measured before F16 merged): no candidate added or removed; 1,337 context files change in
cooldown facts (kit seconds, `[RES]`, `[UNUSED]`); 3 `[PEEL OPTION]` lines
gone (a Fire mage's "Dragon's Breath usable 4 s, not used" — it was on
cooldown), 10 `[DEATH]` lines gain "Unused: Feign Death". Gates: baseline
residue only. New re-runnable scan: packages/eval/scripts/cooldownRecastScan.ts
(every cooldown read outside the ledger, against `unitCooldownOf`).
v429 (2026-10-20, cooldown mastery batch 1b — GH #124): the cooldown
generator reads the points DB2 really gives a talent effect
(scripts/datagen/lib/talentRankPoints.ts). TraitDefinitionEffectPoints +
CurvePoint: per purchased rank (operation 0 sets the curve value, 1
multiplies the base — "per rank"); emitted as `valueByRank`, read at the
unit's COMBATANT_INFO rank (unknown → rank 1). A spec passive's aura 218 /
219 with a PointsIndex op rewrites effect N of every spell carrying its
label: `valueBySpec`. Holy Paladin 1258016 effect 22 (+45 000 on label 2651
= Sacrifice of the Just): Holy's Blessing of Sacrifice 60 → 105 s (corpus
floor 104.0–105.0 s, 581 recasts; Retribution keeps 60). Call of the
Righteous 1241511: Avenging Crusader −7.5 / −15 s by rank (52.5 / 45 s, the
corpus floors exactly; was 30), Avenging Wrath −15 / −30. The DB2 tables
confirm every hand per-rank entry (PER_RANK_COOLDOWN_TALENTS, Static
Charge's user-ruled 10 s a rank) and add per-rank for Survival of the
Fittest, Born To Be Wild, Erratic Felheart and three more. 605 files (b65
clean base after F16 → b66): cd-hoarded 576 → 563 (−14 "Blessing of
Sacrifice was ready" that were not, +1 a Lay on Hands never pressed till
3:23 at a 1:50 crisis), external-unused 87 → 80, slow-defensive-response
−2 — user approved; 1,316 context files change in cooldown facts. Gates:
baseline residue only. Known and left: Safeguard's Arms / Fury rewrite
(+10 s on Intervene's recharge) is 12.1.5-only — the August (12.1.0)
corpus floors at 36.0 s, the October logs at ≥ 45 — so 39 August Intervene
recasts now read impossible (the safe side); Retribution's Blessing of
Sacrifice floors at 90 s in October logs (60 in August) with nothing in
DB2 70391 to explain it — open, needs a ruling.
v430 (2026-10-20, cooldown mastery batch 2 — GH #124): the readers outside
the major-cooldown ledger read one cooldown model. `buildCooldownEntry` is
the ledger's per-spell builder lifted out of `extractMajorCooldownsAll`
(press identification — variants, form re-shifts, passive procs, echo
copies, duplicates, the round end —, the talent-resolved cooldown and
charges, every per-press effect); `unitCooldownEntry(unit, combat, id)`
answers with the ledger's entry or the same builder on any spell, for any
unit (memoised). Migrated: `kitSpellReadyAt` (cc-avoidable options, kick
pressure's "burst ready", the CC sampler's target breaker), the enemy
cooldown timeline's "available again" (`pressReadyAgainAtSeconds`), kill-
window defensive state and walls in hand (`unitCooldownAvailableAt`),
defenseless windows (`entryAvailabilityTransitions`), the death recap's
fallback resolver (prompt, deep dive, desktop), contested-trade CC
readiness. Not migrated, for stated reasons: gap closers (priced per
button group), the Mass Dispel window (its own Cold Snap reset), the
interrupt family (its own on-interrupt give-back), cleanse / purge, trinket
and racials. Before, these readers paired their own cast lists with the
static `unitCooldownOf`: Power Infusion's two SUCCESS rows per press read as
two presses (6,678 "impossible" recasts on 2,240 files; 0 under the shared
model), and no per-press talent effect reached the enemy side.
cooldownRecastScan now reports both readings. 605 files (b66 → b67):
kick-priority-missed 39 → 38, kick-priority-team 27 → 26 (one match out,
another in), kick-eaten −2 ("The Hunt ready" while Predator's Wake had just
spent its shared cooldown; a Doom Winds press only the aura logs) — user
approved; 552 context files change in enemy cooldown / kill-window /
defenseless facts. Gates: baseline residue only.

v431 (2026-10-21, F16 follow-up — user rulings 2026-10-20 「都要」 on the
three questions F16 left open, the unpressed-kit scope narrowed by a second
ruling the same evening 「去掉治疗和只能给队友的」): Counterspell's ruled 6 s
is the Improved Counterspell holder's value — a kicker whose talents show
the node missing locks for DB2's 5 s (`KICK_LOCKOUT_KICKER_TALENTS`;
`kickLockoutSecondsFor` takes the kicker, the cannot-cast family takes the
round's units; 605 files: 4 non-holder Counterspells, the victim back in the
locked school at 4.93–5.00 s, 501 holder ones at p50 6.01 s). The kill-window
roster gains Survival of the Fittest 264735, Retribution's Divine Protection
403876 and Dark Pact 108416 (R08 1b). A roster defensive the kit tags
`[UNUSED]` keeps its owner out of every `defenseless` span (R08 2,
`unusedKitRows` — the ledger reading KILL ATTEMPTS' wall tier already used),
except a heal or an ally-only cooldown (`KW_UNPRESSED_NOT_IN_HAND_IDS`:
Desperate Prayer, Divine Hymn, Tranquility, Blessing of Sacrifice — 0 of 948
casts on the caster). Shield of Vengeance 184662, which rides every
Retribution Divine Protection with no cast of its own (654 of 654), gets an
`[ENEMY DEF]` absorb line (`RIDER_ABSORB_SAVE_AURAS`). 605 files (main
01643393b → this): [KILL WINDOW] lines 13,116 → 8,473, [VULNERABLE] 569 →
410, Shield of Vengeance lines 0 → 993; candidates kick-priority-missed dps
38 → 35, kick-priority-team dps 26 → 27 / healer 31 → 30 (windows on targets
holding an unpressed defensive go, and the per-round slots and window
attribution move) — user approved. fact2Scan: kitInHand 6,250 → 0,
ledgerRosterUp 844 → 0, riderShieldLine 996 → 0. Gates: baseline residue
only.
v432 (2026-10-21, cooldown mastery batch 3 — GH #124): cooldown reductions
driven by events are modelled (user ruling 2026-10-20, superseding #124's
"do not model"). New trigger kinds in `EVENT_COOLDOWN_REDUCTIONS`
(data/talentScriptedCooldowns.ts): interrupts, casts of a school, per-row
hits and a minimum hit count per use, power spent (with known cost
reductions; Anger Management, Red Thirst, Restless Blades), a consumed buff
× its stacks, the owner's aura ending, a self aura applied, attacks taken
(internal cooldown, not while an aura is up; Driven to Madness), and a
credit bonus while an aura is up or per talent rank (Apotheosis, Light of
the Naaru on the Holy Words); resets (Apotheosis, Cold Snap, Preparation,
Demonic Intensity, Violent Transformation). Charge spells run one
simulation with those reductions, resets and idle credit
(`simulateCharges`), and their availability flips run on the rate windows'
warped clock like `cdAvailableAt` (they did not: a charge spell under a
rate window read out longer on the defenseless-window path). Rate windows
come from carriers outside the talent inventory too (aura 148 by cooldown
or charge category, 143, 286; carriers observed in the corpus). Dated
values (`DATED_COOLDOWN_VALUES`): Retribution's Sacrifice of the Just and
Unbreakable Spirit from 2026-08-18, Protection's Sacrifice of the Just from
2026-08-25 (user ruling, FLAG), Safeguard, Winter's Protection and Improved
Conjuration per rank. 12.1.0 logs read the 12.1.0 talent map
(`talentsOf`: Holy Celerity / Ultimate Serenity traded definitions at
12.1.5). Doom Winds' re-applied aura is not a press. Ledger, 2,240 files /
416,091 presses: impossible 5,240 → 229, floor-explained 13,861 → 1,335
(spells with any 28 → 18). Too-short check — earliest recast over the
modelled recharge: Colossus Smash 0.998, Avatar 0.999, Voidform 1.005,
Recklessness 1.009; charge spells (new in cooldownRecastScan) at most 1.002
over 80 spells. 605 files: missed-sync-window dps 373 → 437 / healer
140 → 164 and kick-eaten +7 (cooldowns now ready on time: Colossus Smash,
Avatar, Bladestorm, Recklessness, Voidform, Adrenaline Rush, Chosen of
Elune, Soul Immolation), external-unused −9 (Blessing of Sacrifice after
its hotfix) +5 (Pain Suppression with Protector of the Frail, Time
Dilation under rate windows), cd-hoarded −4 +1 — user approved. Gates:
baseline residue only.

v433 (2026-10-21, GH #155 — user correction 「你们完全没有去读天赋……我们只需要
验证就行，不需要盲猜」): talent duration extensions are read off the talent
tooltips (`genTalentDurations.ts`: every talent whose zhCN tooltip says a
duration is extended, placeholders and spec branches resolved — 169 entries,
120 fixed / 48 per-event / 1 set, 17 sentences left unparsed rather than
guessed) and verified on the 605-file corpus (`talentDurationVerify.ts`:
holders' lifetimes that ran their course at base + extension, non-holders'
at the base). 43 entries confirmed; 24 of them the hand table already priced
(tooltip and table agree), 14 fixed rows the product priced at the base now
come from the tooltip (`TOOLTIP_DURATION_ROWS`: Apotheosis +12 s, Havoc +5,
Power Surge +5, Power Word: Shield +5 (Discipline), Immolate +3, Zenith +5,
Renew +40 % (Holy) / Atonement +4 (Discipline), Remorseless Winter +2,
450342 +3, Cloak of Shadows +2, Renewing Mist +2, Desperate Prayer +10,
Lightning Rod +4), and Spiritwalker's Momentum is priced per press
(`TOOLTIP_PER_EVENT_DURATIONS`: each press of a spell with a DB2 cast time
while the buff is up adds 1 s, up to 4 s — 131 of 159 holder applications
within 0.5 s; the loadout prints `lasts 15–19s`). Frost Nova +2 s (343183,
confirmed) is a control and stays official. 605 files (main 5dcd31c51 → this):
no candidate added or removed; 1,875 contexts change (loadout `lasts`, 25
kill-window lines shorter by the longer Cloak of Shadows); fact2Scan
kitTooltipLasts 2,484 → 0. Gates: baseline residue only.

v434 (2026-10-21, codex 20-F16-01..04 — 15 findings, 10 confirmed on main and
fixed, each with a regression test and an over-fixing control,
codexF16Group1A/B/C): a deferral shield's SPELL_ABSORBED (Time Dilation,
Stretch Time) is out of the kill-window bursts, the healer view's owner
absorbed figure, KILL ATTEMPTS' team damage and the channel's took figure
(`isDeferralAbsorb`); a friendly debuff is no enemy offensive threat after a
press; Grounding's `[CC AVOIDED?]` reads split-id controls (Lightning Lasso);
the kill-window acquittal states press-only and maybe-ready together; a
disarm or silence that ran its official length is not credited to a later
Medallion; opener [RES] rows honour Forbearance / Hypothermia; a suppressed
[RES] row keeps the delta state; a Spell Reflection return goes to the
nearest damaging reflected spell; effect-evidence presses group by the
effect's length; out-of-round casts no longer switch effect inference off.
605 files (main 82e7337a4 → this): no candidate added or removed; 220
contexts change ([REFLECTED] 42 → 52 lines, kill-window / KILL ATTEMPTS
team figures, [RES], [SILENCE] tails).

v435 (2026-10-21, the F16 same-round retest — round1+2's re-audit of the 30
fact2 rounds at v434: 66 of 67 fixed, 32 confirmed on the same yardstick, 5 of
them from F16 — plus codex 20-F16-07 / -08 and three user rulings). Fixed:
one `[CC AVOIDED?]` per ground-control hit (a Capacitor Totem's press and its
totem's pulse shared one MISS); a buff's early-end slack is at most half its
length (Vanish) and a form-bound buff ended by a shift reads so; a dead owner
holds no ready CC in a kill window and is not free; a rider shield
(Shield of Vengeance) is `[no press logged]`; kick-priority skips a cast
inside the Spirit of Redemption form (`auraBlocksInterrupt`; 233 casts in the
form, 0 kicked); the burst window's answers include the crisis readers'
(`BURST_EXTRA_ANSWER_IDS`); the burst ledger, KILL ATTEMPTS' bracket and
burst floor and the reflected return leave out deferral absorbs; Nether Ward
returns are the reflector's damage; a warlock purges only while the Felhunter
is out (`warlockPurgePetSpans`, the header says when); a removed disarm is a
High removal on the cleanse lines (not a missed-cleanse); an owner control
read by its aura (Terror of the Skies) is "CC cast" in HEALER OFFENSE; the
spam fold counts printed casts and Stasis-storing casts; a control from a
charmed holder's own team is a CC on it, tagged `[from its own team, while
charmed]`; Berserker Rage / Shout and Nullifying Shroud avoid by their DB2
mechanics; a stun chain ends at its latest-ending stun; a trinket that broke
any control inside a stun bracket is that attempt's; a trough reads a live
row in the death's own ms; a Roar-lengthened silence / disarm is judged on
its length as landed. User rulings 2026-10-21: [CONSEQ]'s start is the HP at
the landing instant (a third signed exception to "point readings read the
grid"), a quiet line prints its readings; Frost Nova is 8 s for an Improved
Frost Nova holder. 605 files (v434 → this): kick-priority-missed dps 35 → 29,
kick-priority-team dps 27 → 23 / healer 30 → 25, slow-defensive-response
88 → 69, death-setup +3 (one event), burst-into-mitigation −1 — user
approved; every context changes (legends). Gates: baseline residue only.

v436 (2026-10-21, user rulings on the F16 retest's three open questions):
(1) 「算」 — the target's own rotational absorb shield (Power Word: Shield 17,
Void Shield 1253593, applied by itself) ends a kill window's `defenseless`
span while its aura is up; (3) option A — an Intervene 147833 on the target
does too, for the aura's logged lifetime (still never an accusation, rulings
A20 + U3); both `KW_OWN_ROTATIONAL_ABSORB_AURA_IDS` /
`KW_REDIRECT_PROTECTION_AURA_IDS`, read in `computeOffensiveWindows`, no
`[ENEMY DEF]` line of their own; legend updated. (2) 「不算」 — a mage in Ice
Block is no ready kicker: `castBlockingAuraAt` reads the unit's casting
locks (`castingLockIntervalsOf`, kick-priority's reading) for kick-eaten's
kickers and "enemy interrupts UP". 605 files (v435 → this): kick-priority-missed
+1, kick-priority-team +2 (one event: a Discipline Priest's own shield cut her
span, the windows re-split) — user approved; [KILL WINDOW] 8,443 → 8,338
lines, [VULNERABLE] 411 → 435. Gates: baseline residue only.

v437 (2026-10-21, codex 20-F16-09 — the v0.1.36 retest group 1 review, 4 of
4 findings confirmed and fixed): a mechanic-limited avoidance (The Beast
Within) is named as an IMMUNE cause only for a control it stops; Touch of
Karma's window ends at the pressing monk's own redirect removal; a reflected
control the log shows broken by damage is not credited to a Medallion pressed
just after; controls into Aspect of the Turtle (no school mask) stay in
ABILITIES INTO IMMUNITY. 605 files (b22 → b23): no candidate added or
removed; 14 contexts change ([IMMUNE — The Beast Within was up] 27 → 24,
Turtle lines 79 → 81). Gates: baseline residue only.

v442 (2026-10-22, fact4 F17 batch 1 — the round-4 regressions and D28, user
approved 「A」/「批准」): Aspect of the Turtle is an own defensive again (a
deflection, `DEFLECTION_IDS`: `[ENEMY DEF]`, KILL ATTEMPTS `popped`; 03a355dcd
had left it in neither the immunity nor the wall set); a channel tick (Divine
Hymn 64844, `COPY_CAST_IDS`) is no burst answer; hard-cast results pair in
throw order (fact4 D21); crisis-no-response's "could act" is the cd-hoarded
owner gate's (`couldReactWithin` over `buildCannotCastIntervals` in
[t, t + 3 s]; was CC / lockout at the crossing instant — fact4 D28, legend
reworded) and its `burst` is an enemy burst RUNNING at t (`burstCastSpan`;
was a press in the last 8 s — D9). 605 files vs v441 (b46 → f1): healer
crisis-no-response +2 (silenced / stunned at the crossing, 1.5–2 s free after
it); cd-hoarded 28 points swapped under the cap by the enemy-burst ordering,
net −1 (the new pick failed the intent guard after the cap). Family diff:
`[ENEMY DEF]` Aspect of the Turtle 0 → 328, KILL ATTEMPTS 0 → 109.

v443 (2026-10-22/23, fact4 F17 batch 2 — controls removed and delayed, user
approved 「批准」): an ally's Blessing of Sanctuary removes the controls of DB2
mechanic Fear / Silence / Stun / Horror (210256's aura-232 rows;
`sanctuaryRemovalPairs`, shared) — `[CC REMOVED]` now names silences (was hard
CC + roots) and KILL ATTEMPTS reads an attempt whose control it removed as
`broke out (Blessing of Sanctuary)` (was `not enough damage` / `healed
through`); Freezing Trap (60.5 s), Binding Shot (10.5 s) and Snowdrift (6.5 s)
land over their area's life (`AOE_CC_LANDING_WINDOW_S`); Snowdrift's per-target
pulse rows 389823 / 390171 are no presses (`COPY_CAST_IDS`); one failed-control
row is claimed once (a family's casts, the backfill); a pet's or guardian's
control names its caster ("X's pet"); a Command Demon press and its pet's cast
are one control and one kick (`petCommands`, moved to utils). 605 files vs v442
(f1 → f2c): healer slow-defensive-response −1. corpusFactScan3 f1 → f2c:
avoidedImmuneRows 129 → 0, trapNotLanded 27 → 0, sanctuaryKillAttempt 170 → 0,
sanctuarySilenceLine 96 → 0, burstAnswerPress tick 6 → 0.

v444 (2026-10-23, fact4 F17 batch 3, user approved 「批准」): an advanced
sample's max HP that lags a max-HP change is read at the new max
(`laggingMaxHpCorrected`, parser-compat — every HP reader; 152 files: 1,784
lag runs, corrected reading within 0.05 pp of the row before at p50); a
Hypothermia applied later in the [RES] row's own second counts (D17), and a
`≤Ns` cooldown under Forbearance / Hypothermia prints `(≤Ns; <debuff> Ms)`
(D18); the [RES] legend states the ledger's half-second slack (D64); a line
about one unit reads that unit's Dampening (D53); Cauterize's own heal 1286444
marks its proc when the burn aura 87023 is not logged (D61; 211 of 1,011
procs); Burrow enters the friendly ledger (D38); a control family's snare-copy
miss is no control failing (D51 / D56); Mutilate's off-hand 27576 and
Germination's 774 companion are no presses (D24 / D47). 605 files vs v443
(f2c → f3b): dps cd-hoarded −1 (the crisis unit's own Cauterize, logged with
no burn aura, saved it). Gates = b15; corpusFactScan 1/2/3 unchanged or 0.
Family diff: Burrow 0 → 599 [RES] / 65 [TEAM] [CD] / 34 [YOU] [CD]; [CC
AVOIDED?] Metamorphosis 38 → 0 — all intended.

v445 (2026-10-23, fact4 F17 batch 4, user approved 「批准」): the healer save
roster's heal amplifiers — a `save_role` entry that is not `responseOnly` and
not an official self wall (`saveRoleReachesAlly`: Nature's Swiftness,
Evangelism, Stasis, Tip the Scales, Convoke the Spirits, Holy Avenging Wrath)
— can help an ally (`canHelpAnotherUnit`, every reader), so the low-pressure
NOTE no longer files them as `never-used self-only defensive cooldowns …
correctly HELD` (D45 / D58) and a press of one answers a teammate's crisis;
the NOTE's hold test counts the owner's refused presses too (D45: Nature's
Swiftness ×10 under Psychic Scream); a multi-charge cooldown's
`availableWindows` sample the [RES] ledger's `cdAvailableAt` every
`CHARGE_WINDOW_STEP_S` (D55: STAYED IN said `no defensive CD available`
beside `Survival of the Fittest[1/2]`). Codex 21-R12-a: the death window's
freedom ends at the round's end (`deathWindowFreedom` combat bounds); a
hidden buff never removed expires after its official duration + 1 s; a
`used up` charge removal needs the spender cast ≤ 100 ms before it;
inferred control ends settle in apply order with DR walked first. Codex
20-F16-15 #1: an own shield whose end is inferred runs to its last own
absorb row. 605 files vs v444 (f3b → f4): healer cd-hoarded 574 → 571 — 35
were answered by such a press within the window (0:36 Holy Avenging Wrath,
0:20 Nature's Swiftness, 0:35 Evangelism, 1:55 Stasis), 32 new (25 with only
such a cooldown ready: Nature's Swiftness 16, Evangelism 8, Convoke 1; 7 the
round's next crisis once the first was answered), 46 keep their crisis with
the amplifier added to `readyCds`. Gates = f3b; corpusFactScan2
defenselessSaveUp 3 → 1 (own Holy Bulwark absorbs past the inferred end
10 s → 0), corpusFactScan 1/2/3 otherwise unchanged or 0.

v446 (2026-10-23, fact4 F17 batch 5 — external review follow-ups, user
approved 「批准」): `laggingMaxHpCorrected` no longer rewrites a real heal or
hit — the max-change row's own current HP moving by the ratio, or a jump the
unit's logged heals and hits add up to (±2 %), is no lag (5c48e842 r1: a
73,971 heal to full read 90.9 %) — and the report's HP timeline and replay
read the same corrected samples (`correctedAdvancedSamples`); a line about
one unit reads its own Dampening only from its first own dose
(`dampeningReadersAt`); crisis feasibility ends at the last playable instant
(`playableEndMs`, moved to `utils/roundEnd.ts`); a control that logged its
own failed-control row on the player is answered only by a landing of that
trigger — its caster's (or the caster's summon's), with no later cast of it
by that caster before (fb198a1a r1: a trap's MISS hidden by the next trap
41 s on) — and the gate reads a `logged <TYPE>` line per caster at its own
hit second; a pet-executed kick's miss row pairs at the pet's instant; a
control the charmed holder's own team put on it locks its casting
(`charmedAt`); a warlock's purge is locked while no Felhunter is out, per
pet unit (`warlockPetChronology`, `purgePetAbsentSpansMs`); an unclosed
casting lock runs its official length; an own-wall gate line may carry the
deflect label. 605 files vs v445 (f4 → f5b): healer crisis-no-response 8 → 7
(s2/32-4-217: a crossing at 2:59, the round-ending death in that second);
`[CC AVOIDED?] … logged` lines 6,354 → 6,416, lines with no logged row
unchanged (740). Gates = f4 (the first capture, f5, showed 58
checkCcAvoidedLandedConsistency failures from the landing-attribution change
applied to unlogged lines and a gate keyed without the caster — both fixed
before f5b). Scans unchanged or 0; regression net aoeMissAvoided 8 → 3.

v447 (2026-10-23, fact4 F17 batch 6a — the cooldown model on one reading,
external review follow-ups): `cdRealisedSecondsUntilReady` counts the rate
windows after t (the warped ready instant's inverse), so a press's "back in
hand" (`pressReadyAgainAtSeconds`, `entryAvailabilityTransitions`, the enemy
cooldown timeline) and the [RES] row's low end agree with `cdAvailableAt`
(fact4 D10 / D12, 2d25d01a: `Emerald Communion(129s)` → `(119–129s)`,
`Rewind(163s)` → `(151–163s)`, both pressed inside the new range); event
reductions and resets are priced on the warped clock (`applyEventReductions`
with the entry's rate windows; `warpedView` maps a press's reductions — a
Preparation no longer resets Adrenaline Rush early); a charge entry's own
effects reach its multi-charge windows, death readiness and the sync
window's return (`cdChargesAvailableAt`); event triggers in the press's own
ms count (Rumbling Earth, 5b724629 r2: 40 s → 25 s); the trinket → Will to
Survive lock is the racial's own 60 s; the healer-offense facts hand the
round to the shared cooldown model (Holy Word: Chastise reductions); an own
shield's absorb evidence stops at its next application; a hidden-press or
self-aura run whose REMOVED was lost ends at its caster-resolved official
length, a logged REMOVED is its end even past it (an extended Voidform);
Stormkeeper's last charge spent by another spender is `charges_spent`;
crisis / DPS / benchmark Dampening read the unit's own doses; benchmark
purge rates count pets. 605 files vs v446 (f5b → f6b): no candidate added or
removed (the first capture, f6a, showed missed-sync-window +10 from a
self-aura cap that ignored a later REMOVED — fixed before f6b);
`[OPPORTUNITY] … Holy Word: Chastise ready` 17 → 37 (pressed again inside
the new readiness: 131-1-750 1:34 → 2:10). Gates = f5b; scans unchanged. Family diff: `[CD PRIOR]` Stasis 0 → 13, Tip the Scales 0 → 5
— intended.

v448 (2026-10-23, fact4 F17 batch 6b+6c — round-end clips, lost REMOVEDs,
affordability, external review follow-ups): facts about a window stop at
the round's end — the sync window's `ready` (`evaluateSyncWindow` on the
in-round part), kick priority's cast end (first death / round end), the
Innervate mana note, a silence's trinket and dispel reading, the
[CD PRIOR] trough (its HP and second from the lowest unit's own crossing),
offensive waste, kick pressure and its gate, Psyfiend reach, stacked
defensives, root reachability and the disarm `stillOnAtRoundEnd`; a buff
whose REMOVED was lost ends at its official length, a logged REMOVED is
its end (Spirit of Redemption's loop, Obsidian Mettle, Death Pact's heal
absorb, Power Infusion on the press line and enemy major buffs, dispel
windows per caster, friendly Cyclone), and an inferred end prints no
[ENEMY BUFF END]; Innervate's free casts make a spell affordable only while
it is up (`freeCastSpansMs`), and the death outcome tells "could not pay"
(`casterCouldNotPay`) from control (`controlFreeS`). Singles: a stun lets
through only what the game lets through it (silence / fear / lockout stop
a usable-while-stunned tool); an external is unused only when it was back
AND its caster free at the same time; an ally's trinket no longer removes
the owner's cast-gap lines; purge folding keys on the unit; a reflected
control that ran full length was not ended by the reflect; a Malevolence
refresh that ends at once; a kicked enemy bar is no hard cast, its target
falls back to the completion row (a summon by its English name — a
grounded bolt reads `→ Grounding Totem`); Mindgames 375901 kicks read
damage; the desktop death recap reads the prompt's death second and Key
Moments show Adaptation. New gate `checkCdPriorCrossingHp` ([CD PRIOR]'s
HP against the same second's [STATE]; 2 on f6b → 0). 605 files vs v447
(f6b → f7): external-unused 144 → 137 (dps 67 → 66, healer 77 → 71 —
each external came back so late that it was back and its caster free
together < 1.5 s of the last 5 s; one was already printed "off cooldown
only for the last 2.2s"). Hard-cast lines 1,260 → 1,239 (kicked bars).
Gates = f6b (+0 after the summon-name fix; f7 showed 9 checkCjkLeak from
a localized totem name); scans and regression net unchanged. Family diff:
`[ENEMY HARD CAST] … → Grounding Totem` 0 → 24 — intended.
