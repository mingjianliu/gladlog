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

v438 (2026-10-21, round-3 fact audit fix batch + corpusFactScan batch 1 +
user rulings): IMMUNE causes (no magic-only / reflect-only avoidance for a
control it cannot stop, no mobility credit once a miss row proves the hit,
Command Squadron off the avoidance list); presses made while unseen are
presses (`[pressed while unseen]`); DR'd no-REMOVED ends; reflect returns
(own DoT out, damage-id / pre-REFLECT rows in); Turtle, Mass Invisibility,
Phase Shift, Intervene, Vanish in the kill windows (user rulings);
kick-priority judges every overlapping window; dispel backlash silences as
[SILENCE]; Medallion / break presses at their own aura; Intervene 3 s,
Berserk / Celestial Alignment 15 s, AMS 444741 6 s. 605 files vs v437:
kick-priority-missed +17, kick-priority-team +22, kick-eaten +1,
position-mistake +1, questionable-external −6, cd-waste −6, cd-hoarded +1,
external-unused −9, backlash-dispel −1. (Entry restored 2026-10-24 from the
bump's inline note in promptVersion.ts — 82795e7 did not append it here.)

v439 (2026-10-22, fix-F16 regression net + corpusFactScan residue): reflect
returns (backlash excluded, one chain per spell by id or name, the reflected
copy logged reflector → caster, a reflector's own hits after the
projectile's flight, own-id rows by the nearest REFLECT row, Fel Lance's
return); hidden presses vetoed only by a same-id re-statement, found by the
press's own effect aura (Alter Time); castless Blessing of Sacrifice; an
enemy break racial out of a reflected control; offensive aura runs paired
per source; a trinket after a logged cause in the removal's ms. 605 files vs
v438: cd-waste −1, cd-hoarded −1 (one castless Blessing of Sacrifice, 103-2
0:58). (Entry restored 2026-10-24 from d1593db's inline note.)

v440 (2026-10-22, GH #153 leftovers + corpusFactScan2 batch-2 inputs): press
HP reads a HoT's first tick up to the aura-before-cast lag; the kit's
rate-warped range; Divine Toll reaches allies; Blessing of the Bronze speeds
Leap of Faith (aura-454 category carriers, ally-applied, from
COMBATANT_INFO); defenseless ends under an own PRESSED absorb shield within
a minute of its press; an IMMUNE control / silence row on our player is
stated with its log cause; DB2-explained avoidance auras (facts only);
Herald's proc bundle is no hidden press; a ground control's go-off bounds
the move credited with dodging it. 605 files vs v439 (b39 → b45): healer
cd-hoarded +8 (14 new, all Holy Paladin Divine Toll ready while a teammate
was in crisis; 9 removed where the pressed Divine Toll now answers it).
(Entry restored 2026-10-24 from 3b40263's inline note.)

v441 (2026-10-22, user rulings 「可以」): the DB2-explained avoidance buttons
(Blink, Icebound Fortitude, Lichborne, Demolish, Aura Mastery, Unending
Resolve, Obsidian Scales, Zen Focus Tea) are cc-avoidable tools;
backlash-dispel's target HP is read at the decision instant (fact3 D45, the
fourth signed exception). 605 files vs v440 (b45 → b46): backlash-dispel −1
(two crossed out of the HP band, one in), 39 HP facts re-read; cc-avoidable
unchanged. (Entry restored 2026-10-24 from 5df0c06's inline note.)

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

v449 (2026-10-23, fact4 F17 batches 7+8 — fades, control state, counts):
[BUFF FADED] — a press whose own row MISSED and whose aura never went up
has no estimated fade (190bbc57 2:51, Roar of Sacrifice into Time Stop);
Alter Time ended by its return press in the REMOVED's ms reads `(ended by
your own Alter Time return)` (0 → 185 lines; they read `ended early — no
dispel logged` or `expired`); a channel that ran under
`CHANNEL_STOPPED_MAX_SHARE` of its official length reads `(ended early —
the channel stopped after N.Ns)` (0 → 84: Divine Hymn 59, Tranquility 25).
Divine Hymn and Tranquility lose their hand 8 s and read DB2's 5 s / 6 s
(605 files: complete channels ≤ 4.7 s / ≤ 5.1 s; kit `lasts 8s` 12,836 →
9,807), which also puts kick audit's "the channel stopped" bound on the
real length. Control state — `ccSamplerFor` (CC bookmarks, peel options)
reads an immunity the press line's `[IMMUNE — X was up]` names for that
control (`applicableCCAvoidanceIds`, keyed by the cast and its control
aura: Anti-Magic Shell against Freezing Trap 3355) and Mass Invisibility /
Phase Shift to the kill windows' end (`untargetableEndS`, shared); an
enemy's own control reflected back onto it is DR history on both DR walks
(the paladin's reflected Hammer of Justice puts a later Terror of the
Skies at 50 %); a [CONTESTED] span needs `MIN_SLACK_SECONDS` of [STATE]
seconds with the enemy healer free (435 → 312); an interrupt-immune aura
APPLIED in the IMMUNE miss's ms but after its row is not the reason
(Precognition triggered by the kick). Counts — GCD / action-in-progress
refusals neither count nor split a `[REJECTED]` run (`Execute ×4` →
`×6`); [MINOR DISPELS] removals are grouped by the dispeller's own press
(`Tranquilizing Shot ×9` → `×8`). Press HP — a direct heal the press
triggers, logged in its aura's ms before it, is cut (Invigorating Fury,
Holy Ritual: Blessing of Spellwarding `73 %` → `54 %`). Also: an
ally-copied self wall answers a burst as an external (`answered with
Obsidian Scales in 0.8s`); a cast bar stopped within `CANCEL_CC_NEAR_S` of
an enemy Shadowmeld / Transcendence: Transfer reads so and is no cancel of
the owner's (18 lines); a warlock with Grimoire of Sacrifice and no pet
has no offensive purge; a control aura of the cast's own id put on another
unit is press evidence (a stealthed Blind no longer `[UNUSED]`). 605 files
vs v448 (f7 → f8): no candidate added or removed; gates = f7; scans and
regression net unchanged.

v450 (2026-10-24, fact4 F17 final batch — user rulings of 2026-10-23): a
self-only wall a talent lets its caster put on an ally reaches allies for
that player (`ALLY_REACH_GRANTED_BY_TALENT`: Obsidian Scales ← Lifecinders
444322, registered in curatedIdRegistry; `cdCanHelpAnotherUnit` reads
`allyReach: true`) — cd-hoarded counts it ready for a teammate's crisis
(ruling D57), and an ally-copied press still answers the caster's own
crisis (the log puts a copy on each; the first preview's 149-4-936 @129
own-crisis row was that and is gone); a root the owner landed on an enemy
is offensive output on [SLACK] / "zero offensive output" (ruling D26,
3f433db1 0:14–0:22: 19 s → 11 s idle); a channel its own re-cast took over
(SUCCESS + aura REFRESH before the removal) was not cut by CC (ecfb3a7f
2:19 Disintegrate). 605 files vs v449 (f8 → f9b): healer cd-hoarded 571 →
573, healer slow-defensive-response 68 → 69 (each an evoker's Obsidian
Scales in hand for the teammate; user-approved preview), 10 existing
cd-hoarded rows list Obsidian Scales ready; gates = f8; scans and
regression net unchanged. The press-HP ruling D31 is not in this version:
reading the press's own millisecond needs the samples' log order (the
first preview read Dark Pact's post-cost HP, 100 % → 88 %).

v451 (2026-10-24, fact4 F17 D31 — user ruling 2026-10-23): the parser keeps
each advanced sample's source line (`GladAdvancedSample.lineIndex`, optional;
parser-compat `IAdvancedAction.logLine.lineIndex`; stored documents grow
~0.7 %), and `hpAtPress` takes a reading of the press's own millisecond
logged BEFORE the press's cast row when no one healed the unit in
`PRESS_EFFECT_LEAD_MS` — the HP at the press where the last earlier sample
was stale (4accb068 r0 0:07.98: Spirit Walk 96 % from a 0.7 s-old sample →
95 %, the Shadow Word: Pain tick logged just before the cast row). The cast
row itself and later rows carry the press's own cost and never count (the
first preview, which took any same-ms reading, read Dark Pact's post-cost
100 % → 88 % and moved 2,517 press HPs; reverted). A document without lines
keeps the strict-before rule. 605 files vs v450 (f9b → f10): no candidate
added or removed; gates, scans and regression net unchanged; 226 press HPs
change, all lower (median −1, 12 by ≥ 5 points: a hit in that millisecond),
and 58 [YOU] [CD] lines gain an HP they had no sample for.

v452 (2026-10-24, fact4 F17 — external review follow-ups 20-F17-05..11,
the readers each unification had missed): the max-HP lag reading is not
ruled out by a logged hit of the max's ratio on the max-change row, nor
stopped by one in between (8e2dab45 r0 85.823 s 28.13 → 32.34 %, 0284fcd9
r3 115.453 s 46.35 → 50.99 %); `cdChargesAvailableAt` / `cdChargeStateAt`
read the recovery-rate clock (002653dc r0: Time Dilation 1 charge at 164 s,
as [RES] said; death readiness had 0); the countdown's pulled-in triggers
include the press's own ms (Stormkeeper); reflected DR reaches the
expected-length walk (2742ff5d: Sleep Walk expected 3 s, not 6); Spirit of
Redemption's lost-REMOVED cap is the priest's own (Afterlife 9 s); the
[ENEMY DEF] press HP finds its press by cast or effect aura (9bf3a95f r3
Blur 62 → 42 %); a re-cast channel starts at its REFRESH (ecfb3a7f 2:21
`channel cut by CC after 0.6s`); `casterCouldNotPay` reaches the deep dive
and the desktop death card; ready ∩ free reads every not-ready span; a
talent-shared wall given to an ally stays its caster's wall (burst
response, `crisisUnitSaved`), each half reading its own copy's end. 605
files vs v451 (f10 → f11): no candidate added or removed; gates, scans and
regression net unchanged; [RES] Stormkeeper ranges, `ghost` ticks, [ENEMY
DEF] HPs and DEATHS WITH MISSED OPTIONS Time Dilation lines move as above.

v453 (2026-10-24, weekly review of the 2026-10-17…10-24 commits): an
unseen-end invisibility / stealth (`SAVE_AURA_END_UNSEEN_IDS`: Greater /
Mass Invisibility, Vanish, Burrow) is over at its holder's own successful
press or own direct hit (`holderFirstOwnActionAfterMs`) — no longer at a
pet's hit (parser-compat folds those into the owner's `damageOut`) or a
DoT tick — for the kill windows / CC samplers (`untargetableEndS`) and the
burst ledger's "Target had a major defensive up", which also stops cutting
an aura whose REMOVED the log showed. The uncredited `[CC AVOIDED?] …
logged IMMUNE (a Cyclone was on them)` reads the `[CC NOT LANDED]` note's
Cyclone walk (`damageImmuneControlUpAt`), lost-REMOVED cap included.
`ccAvoidanceRate` drops the facts-only avoidances (not in the prompt). No
605-file numbers: the session that made it had no corpus — unit tests
only (burstLedger 3 → 0 failing, untargetableEnd 2 → 0,
matchTimeline.ccImmuneCyclone 1 → 0); the kill-window reference tables
were not regenerated.

v454 (2026-10-24, the first run of the full pipeline over real logs — the
public wowarenalogs testlogs, read at runtime, not committed): a
COMBATANT_INFO whose interesting-auras list is three (caster, spellId) pairs
decodes — `length % 3` had read it as two triples and dropped the player
from the round's roster (21 of 165 lines; rounds ran 3v2, the missing
player's lines printed a bare name); a client-locale (CJK) log name is never
`getEnglishSpellName`'s fallback — the id is (`痛苦動盪` on [KICK] lines, the
gate's own `CJK_LEAK`); a rider shield (Shield of Vengeance) prints `[no
press logged]` only when the log has no press of it (an older patch logs
one 1 ms after the aura); an unseen-end invisibility no longer ends at its
own press's cast row logged after the aura (found by the log-shape matrix).
13 public arena logs, every round, healer / dps / recorder owner views:
checkMatch hardFailures 16 / 16 / 16 → 0 / 0 / 0; prompts built 35 / 39 /
37 → 39 / 40 / 40; bare unmapped player names on prompt lines 21 → 0;
corpusFactScan auraCastGap violations 27 → 0. No 605-file numbers — the
session had no corpus; the reference tables were not regenerated.

v455 (2026-10-24, the predicate-index "Not yet unified" pass): an absorbed
hit's school has one reading (`absorbedHitSchoolMask`: the SPELL_ABSORBED
line's attack-school field, else the attack spell's official mask) for the
school split and the `Top sources` / `killed by` tag — `4 — Starsurge` now
reads `4 — Starsurge [Nature/Arcane]`; a channel is one `channelSpans` span
per cast (a re-cast ends the first as `recast`), its aura may lead the
success by `AURA_BEFORE_CAST_ROW_MAX_MS`, and `[channel cut by CC after Ns]`
reads it; the [HEALER EXPOSURE] / [ROOT] labels use `rosterLabelByName`.
13 public wowarenalogs arena logs, every owner: Top sources entries without
a school tag 13 → 2, 14 of 116 contexts change (school tags only),
candidate counts unchanged; the channel and label changes are
byte-identical there. No 605-file numbers.

v456 (2026-10-24, the user's rulings on the predicate-index entries,
「全按建议」): a Solo Shuffle round ends at its deciding death for every
timeline event (A1, gate `checkNoEventAfterRoundEnd`), for roots (A2), the
slack sweep (A3) and Stasis' "not released" (A4); the KILL ATTEMPTS `target
in your team's Cyclone` clause and its legend read the bracket and the
`KILL_CREDIT_SLACK_S` after it (B4); `Top sources` / `Top damage` /
`killing blow` / `most damage` entries and `[YOU] [CAST]` / `[YOU] [CC]`
targets carry the roster label (D3); `[EMPOWER Ln]` reads the released
hold's level (D2); plus engine-side readings that leave the public logs'
prompts unchanged (B1–B9, C1, C3, D1, D4–D7). 13 public wowarenalogs arena
logs, healer / dps / recorder views: 63 of 119 prompts change — 460 lines
by the roster label only, and 9 lines gone that sat in the deciding
death's second after it; candidates unchanged; every checkMatch gate
passes. No 605-file numbers; `behaviorPriorGenerated.json` was not
regenerated after B5 (it needs the private corpus).

v457 (2026-10-25, fact5 round-5 fixes, batch 1 — the recurring fact classes):
a spell's casts are matched to its damage share by the spell, not the row id
(Execute's cast 281000 lands as 260798; an empowered cast counts at its
release, a hold never released counts nowhere); Fel Armor joins the deferral
shields (its absorb rows are delays, its 387846 ticks the damage); Tempered
in Battle joins the redistribution ids (user ruling 2026-10-25); a
GCD-refused press of a ready cooldown that is never cast afterwards is
`attempted` on cd-waste, missed-cleanse and slow-defensive-response (ruling
C1, extended 2026-10-25); `[INACTIVITY]` and the healing-gap row name the
healer's refused presses inside the gap; an enemy offensive cooldown's own
aura with no press is a `(no press)` `[ENEMY CD]` occurrence, weight 0 (ruling
2026-10-25, the C5 precedent); an unseen press is read through its
same-named press variants; every aura-only external save is an `[ENEMY DEF]`
line (a redirect without a duration); `[CONTESTED]` / `[OPPORTUNITY]` "X ready
on enemy healer" needs the CC to reach that healer at some second of the span;
an external pressed on an ally no longer counts as protection on its caster;
the pressed Spirit of Redemption is a kill-window major defensive in hand;
STAYED IN `no defensive CD available` names a defensive back inside the span.
605-file capture (PV455 base → batch): candidate deltas kick-eaten +6,
kick-priority +3, burst-into-mitigation +1, position-mistake −3 (user-approved
preview); gates unchanged; the new corpusFactScan4 checks read 0 except the
residuals listed in the commit message.

v458 (2026-10-26, fact5 round-5 fixes, batch 2): a player's side is its
COMBATANT_INFO team rather than the flag vote (a Solo Shuffle round had read
four against two, an enemy filed as a teammate); an enemy healer's healing
majors on the save-cooldown roster print `[ENEMY HEAL CD]` for that healer spec
(Evangelism, Tip the Scales, Nature's Swiftness, Divine Toll, Celestial
Conduit, Frenzied Regeneration, Convoke — a forward check over the generated
roster pins it); Roar of Sacrifice ends a `defenseless` span while its aura is
up, like Intervene (user ruling 2026-10-25); a burst counts as answered by a
control only on a caster of the cooldowns inside its 8 s; a cleanse is "on
cooldown" only for a dispel that removes the debuff's type; a teammate's aimed
control with no control aura and no control miss says so; a ground control's
pulse row is its go-off for the dodge reading. 605 / second-corpus capture
(main → batch): slow-defensive-response +15 / +34, missed-cleanse +3 / +13,
kick-priority −3 / −3, cd-waste 0 / −1 (user-approved preview); gates and the
older scans unchanged.

v459 (2026-10-26, fact5 round-5 fixes, batches 3+4): an aimed control that put
no control aura on its target and logged no miss names the avoidance aura up on
that target at the cast (`[no CC aura logged — Phase Shift was up]`); a
triggered aura of ≤ 100 ms is a cleanse on cast, not its parent's standing
immunity (Spirit Walk, Vengeful Retreat, Wraith Walk and one more now read
their movement — DB2 duration index 407, corpus roots landing inside); a DoT
tick a shield ate (a SPELL_ABSORBED or SPELL_PERIODIC_MISSED of a spell the
holder ticks) no longer ends a Mass / Greater Invisibility or a stealth wall;
Spell Reflection is a Warrior Utility press (user 2026-10-26); a channel's
cast row naming the caster's own teammate is said; a PvP trinket press names
the root it removed unless a dispel ended it first (user 2026-10-26); a 20–99 %
wall pressed after an attempt opened was in hand at its start; a pet's dispel
its owner commanded is deliberate, not `(passive)`; the external window's
absorbed part counts the ally's summons as its landed part does; an enemy
cooldown's span runs on the aura its effect lives on (The Hunt's DoT, not its
root); the aura an unseen press was restated from is no second `(no press)`
line; a recast channel is its own span; a save pressed at or after the round's
end is no kill attempt's cause. 605 / second-corpus capture (PV458 → batch):
kick-eaten +1 / 0, burst-into-mitigation 0 / +1 (accepted by the user);
checkEnemyDefRefConsistency 3 → 0 / 24 → 0, other gates unchanged.

v460 (2026-10-27, fact5 round-5 fixes, batch 5 — user rulings of 2026-10-26):
a stealth-only control (Rake's stun) is a `[HEALER EXPOSURE]` threat only with a
stealth state up (Prowl / Shadowmeld until the holder's first action, Incarnation,
Sudden Ambush) or a means to it in hand (Incarnation taken or pressed, Shadowmeld
pressed this round, off cooldown) — tooltip "While stealthed", 441 of 460 corpus
Rake stuns with a stealth state up; KILL ATTEMPTS names a teammate's area save
whose aura was on the target (Spirit Link Totem, Rallying Cry, Anti-Magic Zone,
Darkness, Power Word: Barrier) as an external; Die by the Sword keeps its
unconditional verdict for melee and reads as its 30 % wall (kill-live-gated) for
spells; Transcendence: Transfer prints an `[ENEMY UTILITY]` line. 605 /
second-corpus capture: candidates and gates unchanged; `[HEALER EXPOSURE]` Rake
mentions 1,836 → 822 on the second corpus.

v461 (2026-10-27, F19 — fixes from the codex reader inventory, approved by the
user on 2026-10-27): every reader of "this round" stops at a Solo Shuffle
round's ending death (`roundEndMs`): the cooldown ledger, cast bars, CC breaks,
outgoing CC chains, HEALER TRAINED, aura uptime, kick-eaten's post-kick window
and CC USE; a death's options leave out a save the victim was locked out of just
before the death (Forbearance, Hypothermia — `lockoutDebuffStopsPressAtDeath`)
or that does not cover what was killing them (`saveCoversPressureOn`), and take
an owned Blessing of Spellwarding; enemy pets and totems are enemy sources for
CC USE, PEEL OPTIONS and summon reach; a friendly's Spirit Link Totem is a
stacked wall, named for its shaman; Grounding is credited by the totem that was
hit; cast/aura aliases read as one press (Blur's second charge splits, Lightning
Lasso's channel phase, a re-announced Guardian Spirit, Greater Invisibility's
two success rows); a kick lockout does not stop a cast DB2 says a silence does
not prevent; a control that ran its official length was not ended by a trinket
pressed in its last ms; deep-dive and desktop lows read the trough; an enemy
offensive aura with no REMOVED lasts its official length; charge flips are keyed
on whole ms; [CONTESTED] / [OPPORTUNITY] need the CC ready and in reach in the
same second; a folded lock the owner set up is the missed-sync row's owner part
(`alsoHeldSetupBy`, with a legend sentence); the kick-eaten cast-time median
reads the recorder's failure rows; `checkEnemyDefRefConsistency` reads an
`(area)` line as reaching its target until the press plus the caster kit's
`lasts` (user ruling 2026-10-27, option A). 605 / second-corpus capture
(PV460 → batch): cd-hoarded +7 / +5, cd-waste +9 / +45, external-unused −23 /
−32, missed-cleanse +3 / +9, missed-sync-window +11 / +27, crisis-no-response
0 / −1; gates unchanged on 605; on the second corpus
`checkSelfOnlyDefensiveClaims` 28 → 25 and `checkEnemyDefRefConsistency`
3 → 0.

v462 (2026-10-27, GH #163 item 1): a Restoration druid's Barkskin is priced 40 %,
not 30 % — the Restoration PvP aura 1256995 (effect #10, aura 646, the flat PvP
modifier) adds 10 points to Barkskin 20 + Oakskin 10, owned by spec membership
(`specIds`, like the cooldown and reach models). Corpus split by spec on the 605
slice: Restoration holders take 0.600 (90 % 0.600–0.603, 123 units / 95 players),
Balance 0.704, Feral 0.700. 605 capture (PV460 base → batch): candidates and
findings unchanged, gates unchanged; 268 `[ENEMY DEF]` Barkskin lines 30 % → 40 %
(Balance 303 / Feral 174 lines stay 30 %), 8 mitigation-audit and 2
`[STACKED DEFENSIVES]` blocked amounts ×1.56. Wide corpus (728 files, PV461 base →
batch): candidate counts and the 100 gates unchanged; 906 Restoration `[ENEMY DEF]`
Barkskin lines 30 % → 40 % (Balance 1,254 / Feral 585 lines stay 30 %), 36
mitigation-audit and 12 `[STACKED DEFENSIVES]` blocked amounts, 2
burst-into-mitigation facts `mitPct` 30 → 40 — every changed line is Barkskin.

v463 (2026-10-28, the second-corpus gate residue and the round-5 items F18 /
F19 left, user rulings of 2026-10-27): a talent-granted Obsidian Scales says
`(on an ally — Lifecinders)` on `[DEFENSIVE AVAILABLE]` and the self-only gate
reads it; a logged control failure whose caster's recast landed within 1.5 s
says `— recast landed +N.Ns` and the avoided/landed gate lets that landing
answer it; a miss of one control in the same rendered second as one already
stated is not stated again; `[DMG SPIKE]` cover cites no zero-length control
(`rendersCcOnTeamLine`); a form cooldown's re-listed form aura is no hidden
press while its buff is up; the peel gate reads a second's line order; Master's
Call is labelled `(removes roots / snares)` — the corpus does not bear out its
official immunity (`MECHANIC_IMMUNITY_REMOVAL_ONLY_IDS`); a self-save aura its
holder put on itself with no press of it (Guardian Spirit while channeling
Divine Hymn, Ice Barrier with Blazing Barrier, Frenzied Regeneration from
Well-Honed Instincts; never a Blessing of Sacrifice caster link) prints its
`[ENEMY DEF]` line `[no press logged]` and counts in KILL ATTEMPTS; Stasis
skips a copy cast (one Verdant Embrace, two rows 746 ms apart); `[REFLECTED] …
reflected ×N`, counted by cast (`reflectCount`: a row with a cast of the
spell in the 10 s before it is that cast's, a new cast between two rows starts
the next; a row no cast covers is a proc of its own); `[CC AVOIDED?] … pressed
+N.Ns` for a move made after the control hit, never for a ground control that
went off after the move; a legend for `[no CC aura logged]`. A 20.2 s DR reset window was
tried and reverted (second corpus: landed controls labelled Immune 42 → 150).
605 / second-corpus capture (PV461 → batch): candidates unchanged; gates
unchanged on 605, the second corpus's 7 failing classes (49 lines) → 0;
corpusFactScan4 mechanicImmunityLanded 13 → 0 / 61 → 0. Review follow-ups on 605
(candidates, gates, scans and body lines unchanged): 44 `[REFLECTED]` lines
recounted (×N lines 75 → 81), 40 ground-control `[CC AVOIDED?]` lines `pressed
+N.Ns` → `active`.

v464 (2026-10-29, fact6 F20 — the round-6 double audit's 30 fact items, fixed
by fact class, user rulings of 2026-10-28): each class got a corpus-wide count
check first (`corpusFactScan5`, one module per class, and six new
`promptQualityCheck` hard failures), then every reader of the fact. Own
absorbs: a talent shield that came with one of the unit's presses (Void
Shield from Unfolding Vision, Chi Cocoon, Reversion riding Merithra's
Blessing — `ownShieldLinksGenerated.json`, DB2 trigger edges) ends
`defenseless`; a passive talent absorb does not. Trinket lock: Will to
Survive locks the PvP trinket for 90 s (60 s for a healer, by role), a racial
locks no Adaptation holder's trinket. Area controls: one that reached enemy
players and put no control on them says `[no CC aura logged — hit X; DR:
<family> Immune]`, never `hit no enemy player`; Havoc Metamorphosis' landing
stun 200166 is no control on a player (players are Dazed, 247121). Pets: a
kick on a summon lands; a pet's control times by the pet's own row; a kill
credits the side that dealt the blow (Roar of Sacrifice's share is a
transfer; an overkill row the player lived through is no killing blow; a
summon's side is its owner's roster side, so a Mind Controlled recorder's
totems stay friendly); a pet command prints once. Immunity: Spirit of
Redemption and refused presses read as immunity on the bookmark, burst-anchor
and press-tag readers; Peaceweaver is an `[ENEMY DEF]` line on each carrier
and ends `defenseless`. DR: one chain walk for every reader
(`buildCcCategoryHistory`), same-ms landings in the log's order; a press's
follow-up impact row carries the press's IMMUNE (charge-trigger edges from
DB2). Singles: an ally-only save is no self-save; a reflected DoT counts its
whole run; one break press can end several disarms (`[DISARM] … trinket
broke this disarm`, only on a logged removal within 10 ms of the press); a death-cut
breakable control says when it landed; an override variant counts with its
base spell under its own name (The Hunt / Predator's Wake); one `[RES]`
window per enemy press; Grounding's eaten redirects are named; a purge
press's `k of N` counts the distinct buffs it removed.
605 (cap-base d760bad3d → batch, 3519 owner files): the 8 failing gate
classes (228 lines) → 0; corpusFactScan5 27 classes 8,697 violations → 16
(immunityBurstAnchor 11 needs new wording, Phase Shift 3 and Ice Cold 2 to
GH #167); corpusFactScan reflectReturn 64 → 0. Wide (cap-m463 c027aef94 →
batch, 10039 owner files): gate failures 528 → 15 (all checkDisarmTrinketTail,
gate-side: the disarm ended 0.25–2.0 s before the press, the same rendered
second); corpusFactScan5 30,661 → 24; reflectReturn 285 → 0.

v465 (2026-10-30, GH #167 — the F20 leftovers): Capacitor Totem: the
totem's pulse row of its owner's ground control is the press's go-off and a
landing of it, never a second `[CC AVOIDED?]` (a pulse owns the rows its own
source logs within 100 ms of the go-off). `[RES]` enemy `(Ns left)` of an
effect its holder's death later cut short is the official end, run from the
press's own application (the line is written at the press and cannot know of
the death). A kill window's "was the kit pressed" counts a press only at or
before the round's end, the ledger's own cut, so a unit whose kit says
`[UNUSED]` gets no `defenseless` span (user ruling 2026-10-20 idx 60). A
shared-cooldown variant press reads its own aura on `[BUFF FADED]`
(Predator's Wake no longer prints `The Hunt (expired, estimated)`). Intervene
and Leap of Faith join the ally-only self-cast no-op list.
605 (PV464 cap-final2 → batch, 3519 owner files): gates unchanged; kitInHand
17 → 0; duplicate Capacitor `[CC AVOIDED?]` pairs 9 → 0; estimated The Hunt
fades 55 → 0; `[RES]` entries ending within 1 s of the holder's death 3,010 →
1,065 (proxy, natural ends included); corpusFactScan5 24,174 → 24,130. Wide
(10,039 owner files): gates unchanged; kitInHand 32 → 0; duplicate pairs 30 →
0; estimated The Hunt fades 163 → 0; fadedWhileUp 9 → 8; `[RES]` proxy 7,210 →
2,969; corpusFactScan5 68,110 → 67,970.

v466 (2026-10-30, Time Dilation by what it held back — user: no 50 % in the
prompt, tell the model how much damage was actually taken). Measured on 138
October arena files with a Preservation Evoker (eval-private
runs/pevoker-pvp-2026-10-29, `probes/td_phase.py`, `td_sim.py`): the take-back
361029 starts ~1 s after the first hit the shield holds (84 % of 10,562
episodes ≤ 1.0 s), a tick after a new absorb is pending / 8 and one with none
repeats the last, so 43 % of it lands while the buff is still up — the 07-30
basis ("re-settled ~10 s later") does not hold. Run from the absorbs alone the
rule reproduces the log (92 deaths: 17.66 M simulated vs 18.08 M still held
back; per unit median 0.02 %, p90 7.7 %). The `[ENEMY DEF]` line prints
`defers Nk` (the unit's own SPELL_ABSORBED rows while the aura was up) in place
of `50%`, with a legend entry; `checkEnemyDefSaveEffect` reads it, and only a
deferral may (`deferralWallNames`). A missed / unused Time Dilation's
counterfactual (`savedByTimeDilation`) is what it would still hold back at the
death, pressed when the 10 s window opens — or when the spell came off
cooldown, if later — for its caster's talented length, a hit on the death's
own millisecond covered; a decisive line says which. burst-into-mitigation
carries `facts.mitDefers` (`defers Nk` over the burst) in place of `mitPct`
for it, with a legend clause, and the desktop card says 延后 Nk 伤害. The
table's 50 stays as the share each hit defers and the wall door. 605 (PV464
base → this): candidates unchanged; the findings prompt differs only by the
burst-into-mitigation legend clause (8 owner files carry that type, none of
them Time Dilation); 27 `[ENEMY DEF]` lines `(50%, Ts)` → `(defers 9k–696k,
Ts)`; the 9 Time Dilation counterfactual lines (3 deaths × 3 owners) gone;
gates checkEnemyDefSaveEffect 27 → 0, every other class unchanged. Codex
review (three rounds): the press-time, death-boundary and burst-into-mitigation
findings, then readiness over the whole 10 s window
(`offCooldownForLastSecondsBy`, `IMissedExternal.offCooldownSinceS`, slack-aware;
the [DEATH] line's own 5 s walk unchanged) and the unused-self path — all
fixed here, context unchanged by them on the 605.

v467 (2026-11-01, the round-7 fact fixes). Audit of 15 fresh rounds at PV465
found 79 defects (11 high, 41 medium, 27 low; 9 regressions). Each was fixed by
fact class with every reader, after a `corpusFactScan5` check for the class ran
on the base capture. Wording, coaching rules and open rulings are on GitHub and
unchanged. The class groups: when an effect ended and why (channels, charges,
walls by the later REMOVED, a death-cut effect keeping its official end for
earlier countdowns); hidden presses and full resets; override and pet presses;
absorbed hits counted as hits; kill-attempt openers, `trinket up` and reach
subjects; control and silence filing; spike and burst windows; a press's own
landing in ABILITIES INTO; rot DoTs from DB2; a parry's reach from DB2
DefenseType with the melee-speed clause. User rulings 2026-10-30 / 31: Spell
Reflection gets friendly press lines and stays Utility; a shield an ally pressed
ends defenseless (shown on the 605 first); Silence 15487 is no kick in any
reader; `trinket up` inside a shared lock and for a target with no PvP trinket
change only the printed words; a wall holds to the later REMOVED; Deep Breath
keeps the fact line only; D66's reach words name who they speak for.

Candidates: 605 7639 → 7630 (kick-priority-team −6, kick-priority-missed −3,
the D37 span cut, previewed and kept); wide 23474 → 23440 (kick-priority-team
−23 +3, kick-priority-missed −14 +1, crisis-no-response −1). Gates against the
PV465 base: every class unchanged (605 checkCjkLeak 12; wide checkCjkLeak 38,
checkDisarmTrinketTail 15 from #167); checkFindingsCountFollowsMenu holds its
per-file count. Base numbers include PV466's Time Dilation relabelling.

Scan 5, base → after, violations (distinct facts), 605 / wide:
nextSpikeNotNearest 15861 → 0 / 47417 → 0; duringExternalShare 2885 (1024) → 0 /
23765 (7917) → 24 (8); spikeAbsorbedPart 6008 → 0 / 13767 → 0;
controlRemovalFiled 3598 → 0 / 10270 → 0; friendlyReflectLine 1799 → 0 / 6726 →
3 (2); kitRangeBelowSeen 1340 → 0 / 2319 → 0; allyShieldDefenseless 1052 (588) →
4 (2) / 3621 (1811) → 12 (6); rotDotCount 1000 → 0 / 3092 → 6 (2);
killAnchorSkippedOpener 805 → 3 (1) / 2235 → 0; killTrinketUpNoTrinket 705 → 0 /
1224 → 0; intoDefenseLanded 546 → 0 / 1910 (637) → 21 (7); killTrinketUpLocked
456 → 0 / 1089 → 0; controlListedWhileSpent 444 → 0 / 1293 → 0;
reachStatedWholeBuff 380 → 1 / 1153 → 8; overhealPrinted 374 → 0 / 764 → 0;
offensiveTagWrong 356 → 0 / 2982 → 3 (1); teamProcSourceDropped 284 → 0 / 1533 →
0; allyOverlapDeferral 231 → 4 / 1166 → 23; troughOnStaleMaxRow 200 → 0 / 489 →
0; stackedWallPrice 182 → 0 / 798 → 0; postCcAbsorbedUnsaid 159 → 0 / 394 → 0;
killFocusOverSpan 136 → 0 / 149 → 0; unseenPressStillUp 116 (40) → 0 / 474 (158)
→ 12 (4); channelOutlived 101 → 0 / 594 → 0; conseqDroppedWithReadings 95 → 0 /
195 → 0; listGapPress 140048 → 129558 / 434556 → 400106 (the rest is the list's
own gap classes, on GitHub). Unchanged by decision: drHalfLengthFull 88, the
accepted cost of the 2026-10-27 ruling; immunityBurstAnchor 11 (4), #167.

Rises, each read against the raw log: overrideVariantPressMissing 2 → 8 (3) /
0 → 15 (5) is the check's reading of Deep Breath's two ids (one Ice Cold row is
unclassified, on GitHub); noPressCopy 3 → 12 / 9 → 12 is a real press on a copy
applied just before it. castDamageIdSplit fell, 72 (25) → 17 (6) / 165 (53) →
96 (32); what is left is reflected bolts under another id, post-round presses
and kill-live walls, with 4 no-line cases unverified. talentWallPrinted 849 →
867 / 2596 → 2533 is a per-round reading, not a defect count. Review: twelve
batches, each fixed or moved to GitHub; five defects of this round's own
batches found at the final run were fixed and rechecked.

v468 (2026-11-01, F22 — a spell a talent replaced is not in the kit). User report:
the coach blamed a Lightsmith Holy Paladin for not pressing Divine Toll, which
that build does not have: Holy Armaments takes the button. DB2 does not say so on
the talent. TraitDefinition 141558 has OverridesSpellID 0 and its tooltip has no
replacement sentence; the edge sits on aura-332 carriers (1289890 over Divine
Toll, 1289892 over Holy Prism) joined to the talent by name alone. Ancestral
Swiftness has the same shape and was a hand row. `genTalentReplaces` now joins the
carriers, so the generated table holds both and the hand row is gone. Corpus, in
player-rounds: Lightsmith with the node taken 0 Divine Toll in 306 (605) and 292
(wide), Herald 110/117 and 178/187.

605 base (PV467): cd-waste 1032 → 983 (49 gone, all Divine Toll), cd-hoarded 19
gone, 39 lose Divine Toll from readyCds, 2 appear in the freed CD_HOARD_CAP slot.
Wide: cd-waste 109 gone, cd-hoarded 36 gone, 49 changed, 5 appear. Candidates 7630
→ 7564 / 23440 → 23300. Context lines, 605: 659 kit, 1552 [RES], 535 `cheaper
available`, 44 [DEATH], 41 [CD PRIOR], 15 [DEFENSIVE AVAILABLE]; 4 rounds now have
an empty menu. Gates unchanged.

Class check `replacedSpellListed`, base → after on the 605: 2318 (419) → 0 (kit
659, [RES] 1552, menu 107). Scans 1–5 and the nets moved only where a removed row
was the denominator. Wide stopped early by user decision: candidates, gates and
scans 1–5 only; the class check and two nets did not finish there. Spellsteal
under Kleptomania stays off the ledger: synthetic, 0 on the 605, GH #174. Review:
three rounds, the last APPROVE.

v469 (2026-11-01, F23 — round-8 fact fixes). Round 8 of the fact audit, run on
PV467, confirmed 51 defects; 41 are fixed here across 11 classes and 10 stay on
GitHub. Strafing Run's free Deep Breath and Wingleader reach the ledger, the kit
and [RES]; Cull the Weak and the 12.1 tier sets read by `classSetBonuses` join the
cooldown model. A major aura with no press row gets a `(no press)` line; `[RES]`
writes `~X[k/N]` for a charge spell partly back. An external on a unit is filed by
source GUID, and the wall of a talent-shared cast is written on its caster plus the
copy (user ruling). Six self-saves join `KW_MAJOR_DEFENSIVE_IDS` (user ruling after
the 605 preview). `hpAtPress` cuts at the press's own direct heal; a first periodic
tick keeps the sample before its millisecond. DoT spans read `buildAuraIntervals`.
`[HEALER EXPOSURE]` lists every ready control that reaches.

Base → after, same check code on both, 605 / wide: resCdBeforeNextPress 1156 → 398
/ 3857 → 1066, auraActivationNoLine 4283 → 52 / 11458 → 186, externalFiledAsPopped
692 → 0 / 4381 → 0, allyShieldDefenseless 254 → 4 / 2189 → 12, racialPressNoLine 631
→ 0 / 2054 → 3, silenceImmuneNoLine 444 → 0 / 1056 → 0, reflectReturn 39 → 3 / 243
→ 15, ledgerOnePressTwice 52 → 0 / 142 → 1, kitInHand 140 → 0 / 185 → 0. Gates
unchanged. Candidates 7564 → 7547 / 23300 → 23271: kick-priority rows from the
self-saves (-18 / -30, previewed and approved), +1 missed-cleanse from a lost
REMOVED on each corpus.

Two checks rose for real, both from the new silence IMMUNE lines and open on GitHub:
drReaderAgreement 0 → 6 / 0 → 3 (Garrote - Silence, the DR note and the check's
reader disagree) and immuneCauseUnnamed 0 → 3 / 3 → 6 (Spider Venom under a full
immunity names no cause). Three rose as check lag: reflectDotRun, castDamageIdSplit,
allyScales. No independent rerun: both sides read by the same check code, every
rise signed. Review: eight rounds, the last APPROVE, then a ninth for the last check
edit.

v470 (2026-11-02, G1 — GH #168, #126 row 243, #166, #162). A channel's
`interrupt-immune (X)` note, kick-priority, the kick lines and the CC/trinket
reader read one window builder, `interruptImmuneWindows` (talentBehaviors.ts):
DB2's interrupt immunities (`auraBlocksInterrupt`) on the shared aura lifecycle
(`buildAuraIntervals`: BROKEN closes, official length caps a lost REMOVED,
half-open end). Obsidian Scales is an immunity only on its holder's own press
with Obsidian Mettle: on six files, 28 kicks — own copy with Mettle 0 landed / 6
refused, own copy without 5 / 0, an ally's copy 17 / 0. Zen Focus Tea reads its
own 5 s buff 209584 instead of Thunder Focus Tea (#168); the Divine Favor and
Spiritwalker's Aegis rows go (#126 row 243). Life Cocoon's periodic-only healing
bonus is flagged in the ability profile (#166; 0 printed lines change, it is
read first as an absorb). The SimC hotfix map gains fields 9 and 25 (#162; the
overlay is not regenerated, no live row uses them).

Base → after, same check code (scan5 `kickImmune`), 605 / wide: kickImmuneNote
358 → 0 / 406 → 0 (checked 5,843 → 5,847 / 16,250 → 16,246; upWhileImmune 356 → 0 / 393 → 0, kickInsideWindow 2 →
0 / 13 → 0). 605: 302 of 3,519 contexts change — 360 channel lines (Spirit
of Redemption 316, Precognition 23, Unending Resolve 12, Sanctified Ground 9), the
`enemy interrupts UP` legend leaves 243 prompts that no longer print it, 19
toolkit rows reword Zen Focus Tea; every other scan and the regression nets are
identical. Wide: 383 of 10,039 contexts change, the same families plus 9 kick
lines that no longer name a talentless Obsidian Scales. Candidates unchanged per
class on both. Wide scans 1–4 were stopped for memory and not rerun (605 showed
them identical). Review: three rounds, the last two APPROVE.

v471 (2026-11-02, G2 — GH #173, #125, #174). Ultimate Penitence (user ruling
2026-11-02: one line, named an offensive cooldown as on 2026-10-28) prints its
shield and bolts on its `[ENEMY CD]` line, ahead of any `(cast k of N)`; the
same-second `[ENEMY DEF]` line goes, and a legend line says the readings moved.
The defensive readers (`checkEnemyDefRefConsistency`, the press-HP exemption,
four scan5 selectors) read the shared `ENEMY_DEF_TAG_RE_SRC` /
`isShieldOnEnemyCdLine`, so a mislabelled shield on the merged line still
fails. Fortifying Brew reads 30 % for Ironshell Brew 388814 holders (promoted
talent-mitigation row; newseason every 10: Windwalker holders 0.700 over 98
units, non-holders 0.800; Mistweaver holders 0.700 over 5, non-holders 0.804;
the table's 20 % is the talentless value, user's choice-node reading). A
Kleptomania holder's purge readiness follows Kleptomania's 20 s cooldown, and an
observed Spellsteal no longer reopens it (#174).

Base → after on 605, same check code: `[ENEMY DEF]` Ultimate Penitence 369 → 0,
`[ENEMY CD]` lines carrying the shield 0 → 369 (none left plain), legend in 366
prompts; duplicateLine 369 / 393 → 0 / 24. Fortifying Brew 20 % lines 272 →
144, 30 % 0 → 128, with 3 mitigation-audit and 4 stacked-defensives lines
re-reading the larger share. 464 of 3,519 contexts change; one menu gains a
`burst-into-mitigation` candidate (mitPct 30 crosses its threshold), every other
menu is unchanged. Gates identical; 205 of 209 rise-ledger checks unchanged, 1
fell, 0 rose. Review: three codex rounds, the last APPROVE.

v472 (2026-11-02, user ruling after the 605 preview: 「直接写免疫还剩多久、读条多长」,
then 「照你建议的来做」). The owner's channel line writes the seconds its
interrupt immunity has left, through back-to-back immunities:
`interrupt-immune (Spirit of Redemption, 8.5s left)` (the channel's own length
is already on the line). Under 0.5 s left (`INTERRUPT_IMMUNE_MIN_LEFT_S`) the
line gives the enemy interrupt state instead, as on a channel with no
immunity. Analysis and scan5 `kickImmuneNote` read one predicate,
`interruptImmuneNoteAt` (talentBehaviors.ts); the check's new kind
`immuneLeftWrong` compares the printed note with it.

Base → after on the 152 files of the 605 set whose prompts print the note
(the only lines that can change), same check code: kickImmuneNote 362 / 2,821
→ 0 / 2,821 (354 notes without the seconds, 8 under 0.5 s). 285 of 1,343
contexts change: 354 notes gain the seconds, 8 lines give the kicks instead
(two of them are Dark Harvests interrupted at 1.3 s and 1.6 s, after the
immunity ran out) and 7 prompts gain the kick-note legend. Findings
unchanged; gates identical; 208 of 209 rise-ledger checks unchanged, 1 fell.

v473 (2026-11-02, GH #176, user rulings 「先用 45 秒的…把所有天赋的时间、持续时间、
缩短这些东西先算清楚…再去把它打印出来」 and, after the one-match preview,
「可以，按你说的这样做」). A press of an official cooldown of 45 s or more that no
hand roster names and no other press family prints gets a `[PRESS]` line
(`[YOU] [PRESS]` for the owner): `Sprint (lasts 12s, 60s cd, back 1:00)`,
`Holy Word: Serenity (2 charges, 40s cd, a charge left)`. The numbers are the
shared cooldown ledger's (`unitCooldownEntry`, `pressReadyAgainAtSeconds`) and
the caster's talented duration (`buffFullDurationForCaster`, `pressed`).
Before the line was printed the model was checked against the corpus
(`offListPressScan`: `back` after the unit's next press, `lasts` shorter than
the logged life) and gained Light of the Sun / Coldthirst on-interrupt
cooldowns, Time Spiral free presses, Death's Arrival, Stasis replays, two
Gladiator's Badges, Restless Blades' Triple Threat / Jackpot boost, charge
give-back carry-over, Preeminence, Catlike Reflexes, pressed vs proc
Ascendance, no `lasts` on a refresh, and no press for a Stasis replay
(`isStasisReplayCast`: helpful casts only, one replay per stored cast) or a
row echoing a Time Spiral free press (`timeSpiralEchoMs`, ≤ 0.5 s):
backAfterNextPress 787 / 17,700 → 83 / 17,633, lastsBeyond 305 / 14,467 →
53 / 14,092, notAPress 5 → 2. The rest is GH #179.

605 set, base f4009b807 → after: 3,494 of 3,519 contexts change; body lines
1,656,238 → 1,710,479 (+48,569 `[PRESS]`, +5,672 `[YOU] [PRESS]`, nothing
else), one `[RES]` line re-reads Ice Barrier's charges. Findings
byte-identical. Gates identical; 207 of 210 rise-ledger checks unchanged,
listGapPress 129,287 → 78,671 / 445,496 and resCdBeforeNextPress 398 → 386
fell, the new scan5 `offListPressLine` 0 → 169 / 50,748 (66 facts, all GH #179
model gaps) signed. The codex review's fixes (Stasis replay predicate, the
echo row, the gate's per-press free reading and its Stasis exclusion) were
measured on the 132 files of the set that log a Time Spiral or Stasis aura —
every file they can touch — against the pre-review commit: 6 echo lines
gone, nothing else in 1,716 contexts changes, findings identical,
offListPressLine 50 → 47 (3 Stasis replays no longer read as the next
press).

v474 (2026-11-02, F24 batch 1 — round-9 audit fact9 D30 / D32 / D21 / D6).
kick-eaten's kicker sweep reads a pet kick (Felhunter Spell Lock) through
`interruptCasterAt`, the reading `enemy interrupts UP` takes: the pet out at
cast start, its own position, range and control state, the owner's cooldown.
Before, a ready pet counted only when it landed the kick (dcff7ebb r0 2:06: a
Felhunter 0.5 yd away, the row named a Mage 25.1 yd off). The burst ledger's
"Target had a major defensive up" no longer names heals or control-only
immunity — Lichborne, Death Pact, Exhilaration, Desperate Prayer, Divine Hymn,
Tranquility (`KW_NOT_UP_AS_DEFENSE_IDS`, user ruling 2026-11-02); the span
state machine keeps them. A Nether Ward own-id return goes to the reflect its
own millisecond names (`netherWardNamedSpells`; 14bb43b3 r0 2:40: the
reflected Haunt's 92k had been added to an Agony reflected 110 ms later).

Cover set (117 archives, 1,140 contexts), base f4009b807 (v472, before
v473 landed) → after, same check code: petKickerMissed 8 → 0,
ledgerDefNoEffect 73 → 0, wardReturnMisnamed 0 → 0 (15 audited rounds
1 → 0); 213 checks: 210 unchanged, 2 fell, 0 rose.
Gates identical; body lines 535,633 → 535,560.

v475 (2026-11-03, F24 batch 2 — round-9 audit fact9 class 1: D8 / D9 / D12 /
D10 / D11 / D5). kick-eaten's `postKick` reads the round's other enemy kicks
on the player. A SPELL_CAST_FAILED interruption row another kick ended (same
spell, within 50 ms, one row per kick) is "kicked again Nx (<spell> +Ns by
<kick>)", no longer "refused for another reason — its cast bar began and was
stopped" (1d6eee5f 0:58.9: Pyroblast, Mind Freeze 1 ms after its row). A "not
ready" press outside this lock whose school another kick still had locked is
"inside a later kick's lockout" or "still inside an earlier kick's lockout"
(1d6eee5f r1 Pyroblast / Blazing Barrier under Mind Freeze's Fire lock; r5
Pyroblast under a Rebuke's), not "its own cooldown or the GCD"; that other
lock ends early on a success in it, as this one does. An unsilenceable spell
of the locked school is "a spell the lock does not stop", not "outside the
locked school" (1eb4dd55 Heart of the Wild under a Nature Skull Bash). User
rulings 2026-11-02 / 11-03 on all four wordings; the gate counts each clause.
`castBlockingAuraIntervals` keeps an "interrupts"-typed aura only when it is
hard control or a silence (`blocksAsControlOrSilence`): Shambling Rush's root
91807 had read as a cast block. A landed Death Grip on the player
(`gripsOn`, its cast row; a miss of it moves nobody) is cast-stop evidence
(`forcedStopInstantsMs.gripped`), so the stop beside it is no self-cancel.
The kick-eaten legend's full-immunity list is Ice Block and Divine Shield
(FULL_IMMUNITY_IDS); Aspect of the Turtle moves to the partial list.

Cover set (117 archives, 1,140 contexts), clean base 53739731c (v474) →
after, same check code: kickedBarAsRefusal 10 → 0, pressOutsideButLocked
38 → 0, rootAuraCastBlock 8 → 0, gripStopAsCancel 5 → 0; 218 checks: 213
unchanged, 4 fell, 0 rose. Gates identical; body lines 553,175 → 553,175;
no candidate row added or removed (35 kick-eaten rows reworded).

v476 (2026-11-03, GH #179 — the `[PRESS]` line's model gaps left by v473).
Ancient of Lore 473909 is the PvP talent that replaces Tree of Life (PvpTalent
5739 OverridesSpellID 33891, the same class mask), and both of Tree of Life's
scripts follow the slot: Cenarius' Guidance (−5 s as each Grove Guardian
fades, 8 s after its summon) and Control of the Dream (≤ 15 s of ready time
off the next cooldown). Restless Blades gives back 1.0 s per combo point, the
dummy's base 10 — DB2 leaves 1.0 or 0.8 (PvpMultiplier) and the corpus picks
1.0. The line's `lasts` and its gate read one row, `pressDuration`: the cast's
target's copy first (within 4 s — a Holy Armament travels, 360 of 370 land
within 2 s, the latest 3.8 s — and never past the caster's next press of the
spell), anyone else's within 1 s; none on a REFRESH or a same-millisecond
second copy (a Holy Armament cast on oneself that also arms the caster runs
40 s). Before, line and gate each took the first unit holding a row, often
the paladin's own copy that later procs stretch to 26–48 s.

offListPressScan, same check code, subsets of the 605 set: Ancient of Lore
`back` after the next press 35 → 0 (13 files); Restless Blades kit 39 → 3
(13 Outlaw files, every 5th of the 08-28 manifest) and on a hold-out (12
files, every 5th from the 3rd) 23 → 2; Holy Armaments `lasts` beyond the
logged life 28 → 1 (22 files), lives checked 1,214 → 1,284.

Cover set (117 archives, 1,140 contexts), clean base b7b656bdf (v475) →
after: offListPressLine 72 → 54 / 16,479 (27 → 18 facts); 218 checks: 217
unchanged, 1 fell, 0 rose. Gates identical; body lines 553,175 → 553,175;
findings unchanged. 409 lines reworded: `[PRESS]` back times of the Outlaw
kit, Adrenaline Rush's `[KILL WINDOW]` / `[VULNERABLE]` "may already be back"
bound and `[RES]` cooldowns (Restless Blades); `lasts` moved to the target's
copy on Holy Bulwark / Sacred Weapon, Rescue now the ally's 1 s carry
(370665, logged ≤ 1.0 s) not the Evoker's 3 s flight (370666, logged ≤
2.0 s), Bull Rush without a `lasts`.

v477 (2026-11-03, round-9 fact audit classes 2–7: D1 D2 D3 D4 D7 D13 D14
D15 D16 D17 D18 D19 D20 D22 D23 D24 D25 D26 D27 D28 D29 D31 D33). Fact-layer
fixes only — what the log says and which type a thing is filed under; one
user ruling changes a candidate set (D7).

- Class 2: Aspect of the Turtle is a deflection, not an immunity (audit and
  stacked-defensive lines say "deflects direct attacks"); Tranquility, Divine
  Hymn, Desperate Prayer, Death Pact and Exhilaration are heals, not major
  defensives, in every reader that called them one (`isHealNotMajorDefensive`)
  — they leave the ready sets and stay in the response sets
  (`isDefensiveCdResponse`); Serenity leaves `[ENEMY HEAL CD]` (an enemy's
  prints `[PRESS]`, as a friendly's did); KILL SEQUENCE lists only cooldowns
  pressed before the death.
- Class 3: a triggered heal belongs to a press only when paired with the
  press's own cast rows; a press at the round's end stays in the round; a
  split copy obeys the round-end cut.
- Class 4: an aura first seen in its holder's re-statement batch starts at
  the source's last press within its official length; a peel's usable
  seconds leave out a target that vanished or a dead caster's second; a
  channel the log shows no effect of ends at the channel's end.
- Class 5: control-miss tags read the caster's summons' miss rows; a
  targeted control's landing is its own id or same-named aura; grounding
  lead, immune hits (a melee swing's `SWING_MISSED` IMMUNE counts), and
  absorbs with a nil attacker.
- Class 6: Snowdrift is a Frost Mage's and Void Nova a Devourer Demon
  Hunter's (roster class); Frozen Orb 198149 (Concentrated Coolness) is a
  Frozen Orb press on both sides (`TALENT_REPLACE_VARIANT_IDS`); Absolute
  Zero is ready only when Frostwyrm's Fury is; Dark Harvest is a major
  offensive cooldown (user ruling 2026-11-03: a 60 s cooldown is major).
- Class 7: an aura's `during it` window ends at its REMOVED row in log order
  (a hit of that millisecond logged before it is inside); the kill-credit
  5 s after a bracket stop at the round's end.

605 set (3,519 contexts), class 2 preview (base b7b656bdf): cd-waste 983 →
862, cd-hoarded 1,162 → 1,110, 9,799 enemy Serenity lines `[ENEMY HEAL CD]`
→ `[PRESS]`. Classes 6/7 preview (base = classes 1–5), each against its
own deterministic scan: Snowdrift roster misses 50 → 0, Frozen Orb variant
presses unprinted 52 → 0, Absolute Zero listed on cooldown 156 → 52, during-it
same-ms misses 69 → 3, kill credit past the round's end 1,001 → 245. Every
residual was the scan's scope (a 3v3 round end read as the deciding friendly
death, a press later in the line's second, `healer already in …` read as a
listing, a window the round's end closed first) or a second roster miss (Void
Nova, fixed after the preview); with the scans corrected the cover set reads
0 on all five, not re-run on the 605. Candidate rows: missed-sync-window +49, kick-eaten +1,
questionable-external −3, slow-defensive-response +1, position-mistake +1,
almost all from Dark Harvest entering the ready and burst sets. Cover set
(117 archives, 1,140 contexts) after the last commit: 240 checks, 234
unchanged, 1 fell, 0 rose.

v478 (2026-11-03, GH #187). Fact layer only. Evangelism 472433 casts Power
Word: Radiance at its target, and that triggered Radiance writes its own
194509 cast row 0–63 ms before the Evangelism row; it was read as a second
press — a `[YOU] [CAST] Power Word: Radiance` line in the Evangelism second.
`COMPANION_CAST_ROWS` gains 194509 → 472433 (`COMPANION_LEAD_MS` 100 ms ahead,
5 ms after, same target, the nearest row only); the desktop cast lanes drop the
same rows. 30 October 3v3 logs with Evangelism (90 owner contexts): such lines
60 → 0, `[YOU]` Radiance presses 169 → 96, `[CD] Evangelism` 80 → 80; no other
context line changed; findings-prompt hash unchanged.

v479 (2026-11-04, GH #183). `[PRESS]` lines for the 33 buttons under 45 s the
user picked (`PRESS_LINE_WHITELIST_IDS`, Pierce the Veil 1245483 and Eternity
Surge 382411 included), and the model their numbers need — a first 605 pass
with the whitelist alone put `offListPressLine` at 4,765, so the ids waited
for it (user: "B"). Empowered presses: SPELL_CAST_SUCCESS is the empower
START, a hold ending in SPELL_EMPOWER_INTERRUPT or released at level 0 spends
nothing and prints no line (`unreleasedHoldMs`, read by the renderer and the
gate), Tip the Scales releases at max level. Cooldowns: Causality (Disintegrate
ticks on the cast's target, by log order; Pyre hits), Instability Matrix −6 s
on the breaths, Temporal Burst 0.5 % per stack as it decays
(`STACKED_RATE_CARRIERS`), Cycle of Hatred per press (`PER_PRESS_STACK_COOLDOWNS`),
Chaotic Transformation and Time Walk resets, Barrier Diffusion on every mage
barrier, Impish Instincts on direct Physical hits taken, Demonic Circle:
Teleport freed by Time Spiral. Durations: Burn to Ash +2 s per own crit tick
(the parser now reads the crit flag of an ABSORB miss, and hits' and
misses' flags reach the legacy rows).

offListPressScan, same check code, dev subsets (scan0 → final): `back` after
the next press — evoker 439 → 22, havoc 375 → 3, mage 215 → 10, misc 315 → 24;
`lasts` beyond the logged life — 388 → 13, 111 → 3, 44 → 0, 200 → 13.
Hold-out subsets (never looked at while modelling): `back` 327 → 16, 443 →
5, 299 → 7, 233 → 3; `lasts` 361 → 11, 97 → 1, 75 → 2, 70 → 4.

605 files, clean base 647aa6649 (v478) → after: `offListPressLine` 90 /
60,500 → 161 / 96,339 — the 90 unchanged, 71 rows (24 facts) on the new ids,
signed `real` in the rise ledger and left in GH #179: Explosive Shot `lasts`
5 (3 under the target's Time Stop, which freezes its debuffs; 2 log stalls),
reductions not read yet on Eternity Surge 5, Demonic Circle: Teleport 5,
Shimmer 3, Wake of Ashes 2, Dream Breath / Prismatic Barrier / Essence Break /
Flying Serpent Kick 1. `listGapPress` 78,554 → 42,770 / 445,496 (the whitelist
states those presses now). 239 checks: 231 unchanged, 1 fell, 1 rose (signed); gates
identical; body lines 1,709,946 → 1,752,827 (`[PRESS]` lines and the legend
naming the examples). Findings: one candidate's facts — a cd-hoarded at 1:37
now lists Tip the Scales ready, the decaying Temporal Burst giving it 2.2 s
more recovery than the flat ×1.005 did (ready 95.4 s; pressed again 106.9 s).
`docs/talent-coverage-gaps.md` is stale until the next full talent scan.

v480 (2026-11-04, fact10 batch 1 — the round-10 audit's eight high defects and
their classes): Breath of Eons 403631 and Frostwyrm's Fury 279302 join the
major offensive cooldowns (user ruling; Maneuverability's 442204 is a press of
the 403631 row, Chosen of Frostbrood's free recast 1265384 an effect
activation of 279302, never a cooldown press) — missed-sync-window's ready
set, the loadout, [RES], bursts and kill attempts see them (D2–D4, D31).
Burrow 409293 is a Shaman Defensive row, ready on the ledger when talented
(D13); Spirit Walk 58875 leaves the ready / accusation set and still answers a
crisis when pressed (D12). A control removed in the millisecond another unit's
control immunity went up on the holder is ended by it: a later trinket or
break racial did not break it (D8). Of a press's triggered auras a DB2 root is
no effect-span chain head (The Hunt / Predator's Wake, D11 D27). A kick into a
cast bar its caster had left — another press or bar more than 0.5 s before
the kick — or whose likely target died first is a miss, not a juke (D22 D5).
The burst ledger's `low` and `[DMG SPIKE]`'s low stop at the round's end
(`roundClippedTroughSpan`, D30). An effect activation shares its cooldown's
[RES] window (one Frostwyrm's Fury, not two).

v481 (2026-11-04, fact10 batches 2/3 — the round-10 audit's other fact
defects and their readers): Wingleader halves Breath of Eons' cooldown (D1);
the [RES] check reads a cooldown range's low end (D16). Blessing of the
Bronze's label variants price the movement cooldowns, and a free press stands
on its opener's priced cooldown (D6). Blessing of the Forge's Sacred Weapon is
no hidden Holy Armaments press, and the `[PRESS]` back check reads the DB2
charge pool (D7). A charge press's impact row stands in for its press in
ABILITIES INTO (D28). Freezing Rain proves a Frozen Orb pressed while unseen
(D23). Pack's Endurance and Tomorrow, Today lengthen their auras, and a hasted
length past the round's end reads the unit's own run (D14 D17 D20). A
periodic-trigger aura's last trigger logged within 100 ms after its REMOVED
ends the effect (D29). A control landing in the 20 s DR reset band reads its
own length only when nothing but the game ended it; a control that landed is
never Immune (D9). A totem killed before its first pulse never went off
(D10). `[CONSEQ]` reads an enemy healer's own control reflected onto it (D21).
A PvP trinket that took off a silence, disarm or root — every one, not only
the one the `[ENEMY TRINKET]` line names — is the kill attempt's trinket
(D24). A stale-max HP row reads over the new maximum (D18 D33). An unseen
press shows through its own aura on other units (D19). Time Dilation is a
deferral, not a wall, in ABILITIES INTO (D26). Angelic Bulwark 114214 prints
an `[ENEMY DEF]` fact line — no KILL ATTEMPTS cause, no defenseless cut
(D25, user ruling).

605 candidate rows, batches 2/3 alone: position-mistake 160 → 159 (a Frozen
Orb pressed unseen at 0:09 merged the offensive windows, and the stayed-in
row at 0:16 went); one kick-eaten row's `enemyBurst` None → Frozen Orb; one
position-mistake `hpStart` 69 → 68. cd-hoarded, cd-waste and kick-eaten totals
are unchanged.

v482 (2026-11-04, GH #146 item 2, GH #148 item 4). An external that was
already up when a kill attempt began is named in `FAILED: saved by external`
only when the log's damage shows the target would have died without it (user
rulings 2026-11-03 / 2026-11-04: strictly, no margin; taken away one at a
time; absorbs count). `killAttemptSaveAccount.ts` puts each one back on the
attempt's hits inside the credit window — a percentage row divides every hit
it covered (its school, while its aura was up) by its own factor, as damage
reductions multiply (measured through `damage.baseAmount`, the pre-reduction
amount: Ironbark + Die by the Sword 0.55 of base landed vs 0.56 multiplied /
0.50 added; three more pairs the same way), a shield adds what its own
`SPELL_ABSORBED` rows ate (divided by the removed reductions on that hit's
school) — builds a deficit that overhealing pays back, and asks whether any
HP reading of the target's own, minus the deficit, reaches 0. None deciding
it alone but all of them together (the target's own already-up walls
included): `X [up since m:ss] + Y together`. Not accounted, named whenever up
as before: everything that is no percentage and no shield (Guardian Spirit,
Blessing of Protection, Rallying Cry …), Time Dilation (a deferral),
Blessing of Sacrifice and its talented Ultimate Sacrifice 199448 (transfers;
199448's DB2 row carries an absorb, and the first 605 pass dropped one),
Spirit Link Totem; and every external when the target has no HP reading of
its own in the window. An external taken off this way cannot drop the
target's own saves: they are all named, as beside an external (B16b). `X
already up since m:ss` in the opportunity clause goes with the FAILED stamp
(the R08(c) gate pairs them both ways). The quality gate reads the
`together` item's names. Kick-eaten ids: two kicks on one player rounding to
one second shared an id; the later one now gets `#2`.

605 files, base 4d60faecf (v479): distinct attempts naming an already-up
external — Pain Suppression 27 → 1, Ironbark 16 → 0, Life Cocoon 8 → 0,
Anti-Magic Shell 1 → 0; Guardian Spirit 87, Blessing of Sacrifice 63,
Rallying Cry 28, Time Dilation 9, Spirit Link Totem 1, Gift of the Naaru 1
unchanged. 68 distinct attempts changed (191 owner lines in 170 contexts): 62
lose the external — 24 now name the target's own save, 21 `not enough
damage`, 17 `healed through` — and 6 keep another external; no `together`
occurs in the 605. 108 contexts lose the legend line for `already up since`.
Kick-eaten duplicate ids: 2 findings files → 0. 239 checks: 238 unchanged, 0
fell, 0 rose; gates identical; body lines unchanged. The Ultimate Sacrifice
fix, rechecked on the 176 archives with an already-up external (1,911
contexts): only that attempt's 3 owner lines moved back. Rebased onto v481
(d75078e75), the same 176 archives, base vs after: 490 changed lines, line
for line the v479 delta.

v483 (2026-11-05, GH #164, GH #126 row 203). Havoc's Blur is priced 35 %:
Desperate Instincts 205411 (aura 107 misc 23 on 212800's −25) is a promoted
`TALENT_MITIGATION_MODIFIERS` row keyed by 198589 (605 new-season files:
Havoc holders 0.650, 90 % 0.650–0.652, 139 units / 82 players; Devourer
non-holders 0.750, 46 units). Fade's 10 % is Translucent Image 373446's:
the table row keeps the signed 10 with `wholeReductionTalentId`, and
`resolveMitigation` prices a caster without the talent 0 (holders 0.900 on
all three priest specs, 320 units; non-holders 1.000, 617 units); the
mitigation audit leaves a 0 % component out instead of printing "blocked
~0k". 605 files, base c05e223af: `[ENEMY DEF]` Blur `(25%` 531 → 131 (the
Devourer lines), `(35%` 0 → 400 (every Havoc line); `Mitigation audit: Fade`
rows 60 → 41; 21 of 27 Blur audit rows re-priced; findings byte-identical.

v484 (2026-11-05, GH #128 item 1). A hunter's pet-carried presses (Master's
Call 272682, Roar of Sacrifice 53480, Intimidation 19577 —
`PET_COMMAND_SPELL_IDS`) leave the `[RES]` line, neither ready nor on
cooldown, while `ownerPetGoneAt` says the hunter's pet is gone (its
UNIT_DIED or Dismiss Pet). A summon / revive cast by the owner after that
end (`PET_SUMMON_SPELL_IDS`, DB2 effects 56 / 109) puts the pet back from
the cast, not from the new pet unit's first row (a Revive Pet at 1:16 had
its pet's first own row 15 s later). Corpus check: 3,562 presses of the
three spells (605 files + downloads), 0 while the owner's pet was gone.
The row where a pet-carried entry first goes is printed in full (codex
review: a dead holder's entries leave a delta without `-X` because the death
has its own row and ends the gate's reading; a pet has neither, so a delta
would leave the entry ready in the reader's picture and owe its return).
605 files, base eda327c53: 18 context files changed, `[RES]` rows −51 / +51
(24 of them a delta row turned full at the first row after a pet death, the
rest a pet-gone row without the presses or the row after the revive listing
them again); findings byte-identical; the text gates' counts unchanged
(`checkResReturnAnnounced` 0 → 0).

v485 (2026-11-05, GH #179 batch 3a). A `[PRESS]` line's `lasts` reads what
the game did to the application (`pressDuration`): an Oppressing Roar on the
unit at the landing lengthens a control / slow / root it covers by 30 % (the
CC lines' own reading — Chimaeral Sting 3 → 3.9 s, Landslide 6 → 7.8 s,
Flying Serpent Kick 4 → 5.2 s), and a Time Stop on the holder that starts
while the aura is still up adds its own length (`timeStopHeldSeconds`:
Gladiator's Badge 15 → 20 s, Explosive Shot 4 → 9 s, Spirit Walk 8 → 9.3 s,
Spiritwalker's Grace 19 → 24 s, Dream Breath 16 → 21 s, each checked against
the aura's logged REMOVED). A candidate row inside a re-stating batch (≥ 6
APPLIED on the unit within 5 ms) more than 1 s after the press is the unit
coming back into sight, not the press's application: the next candidate is
the same aura on another unit, which may be logged up to 150 ms ahead of the
cast row (Holy Bulwark on a Vanished target: `lasts 20s` for a 29.9 s life
is gone; Holy Bulwark on a target out of sight reads the caster's own 432496,
not the shield 432607 it re-lays every 2 s). A batch in the press's own
millisecond is the press's bundle (the first cut dropped `lasts` off 447
lines — Gladiator's Badge beside wings and procs). 605 files, base 12fddc281:
36 context files, `[PRESS]` −39 / +39 and `[YOU]` −8 / +8 (45 longer, 2
without `lasts`); findings byte-identical; the text gates unchanged;
corpusFactScan5 `offListPressLine` 132 → 118 facts (14 lastsBeyond gone,
0 new).

v486 (2026-11-05, GH #179 batch 3b). A press that did nothing spends no
cooldown and prints no `[PRESS]` line, the same reading as a hold never
released (`cutHolds` → `unreleasedHoldMs` / the ledger's free press): an
Eternity Surge (359073 / 382411) released with no row of its damage 359077
by the caster — SPELL_DAMAGE, SPELL_MISSED or a SPELL_ABSORBED whose
`attackSpellId` it is — within 1.5 s of the release (`DEAD_RELEASE_EFFECT_IDS`;
605 files: 5 such releases each pressed again 3.1–9.8 s later, 223 with a hit
none before 16.2 s), and a Cauterizing Flame (374251) with no SPELL_DISPEL of
its own within 50 ms (`COOLDOWN_ON_DISPEL_IDS`; 9 such presses, the 4 with a
next press pressed again 1.9–20.2 s later). scan5 `listGapPress` owes such a
press no line (it imports `unreleasedHoldMs`). 605 files, base 1c658ff3f:
28 context files, `[PRESS]` −24 and `[YOU]` −4 (Eternity Surge ×4 matches,
Cauterizing Flame ×7); findings byte-identical; the text gates unchanged;
corpusFactScan5 `offListPressLine` 118 → 110 facts (backBeforeNextPress
Eternity Surge 5 and Cauterizing Flame 3 gone, 0 new); `listGapPress`
`offList/*` 123 → 2 (121 were holds never released and these presses — the
gate had owed them a line the renderer rightly never printed).

v487 (2026-11-05, GH #179 batch 3c). Two cooldown readings the log
already carried. (1) Death's Arrival's free Grappling Hook window is the life
of its aura 457343 (`windowAuraId`, `freeRecastWindowEndSeconds`): applied
when the hook lands 0.55–0.84 s after the press, removed in the free press's
own millisecond or 3 s after its APPLIED — the 605 files' one holder: 6 free
presses, one 3.09 s after its opener (2.43 s into the aura) that the 3 s
from the press had left a full-cooldown press. (2) A "when X is removed"
give-back (Barrier Diffusion, Time Walk) also reads an end the log left out
of the unit's own aura (`ownAuraEndTimesMs`): at its next own APPLIED, no
later than the DB2 duration after the open one (the last one its duration
after its APPLIED), never past the round's end, which the ledger passes in; an APPLIED inside a re-state batch (`isResyncBatchAt`, now in the leaf
module `utils/resyncBatch.ts`, re-exported by `hiddenPress.ts`) is the same
aura still up — 83 of the 106 such re-applies in the 605 files. Lead the
Charge (469780) stays unmodelled: dummy effects only, no mask or label, and
the corpus does not single out a spell list or a range. 605 files, base
9b5d334d2: 15 context files, `[PRESS]` −38 / +38 and `[YOU]` −1 / +1, every
one a `back` that came earlier (Blazing / Prismatic Barrier, Shimmer — a
stolen Alter Time never REMOVED, d510865c r5) or the hook's `free press`; findings byte-identical; the text gates unchanged;
corpusFactScan5 `offListPressLine` facts 3 gone (Shimmer, Grappling Hook,
Prismatic Barrier `backBeforeNextPress`), 0 new.

v488 (2026-11-05, GH #179, user ruling 2026-11-05 cat1 #10). An Augmentation
evoker's Timewalker mastery (406380 effect 1: aura 108 misc 1, a percent
duration SpellMod on class mask [0, 0, 8, 0], basePoints 0 — scaled by
mastery, which the log does not give as a number) lengthens 33 auras past
their official length (Spatial Paradox 10 × 1.083; Obsidian Scales 12.20–12.88 s
on Augmentation against 12.02 s on the other specs). The printed length is
now a floor: `lasts 10s+` on the `[PRESS]` line (`pressDuration`'s `floor`)
and `lasts 12s+` in the `<cooldowns>` kit (`buffDurationIsFloorForCaster`,
`TIMEWALKER_LENGTHENED_IDS`, pinned to the inventory row). The number every
reader gets is unchanged. scan5 `lastsBeyond` does not hold a floor to the
aura's logged life; `kitLifetimesById` and fact2Scan read `Ns+` as N.
605 files, base e959fd8c3: 18 context files, 18 kit `Obsidian Scales … lasts
12s+` and 3 `[PRESS]` `Spatial Paradox (lasts 10s+ …)`; findings
byte-identical; the text gates unchanged; corpusFactScan5 `offListPressLine`
308 → 305 rows (107 → 106 facts: the Spatial Paradox `lastsBeyond` 10.8 s, 0
new).

v489 (2026-11-05, GH #191 F25 leftovers, GH #190; user rulings 2026-11-05).
The DR reset tick band (`DR_RESET_TICK_MS` after the 20 s window) reads a
control's logged length only when the game alone ended it
(`ccLengthIsDrEvidence`, now on all three walks: the outgoing chains through
`outgoingCcChains.ts`, the holder's history `buildCcCategoryHistory` behind
`[CC BROKEN]` / `[CC REMOVED]` time left and the dispel DR, and the incoming
walk). New clauses: an ally's Blessing of Sanctuary that took it off
(`sanctuaryRemovalPairs`), the holder's death cascade (`removedByDeath`), and
the aura's own source (a pet, not the owner it is credited to). On a chain of
two, a half length in the band reads as the second. Troughs past the round's
end: `[BURST ANSWERED] bottomed at` and STAYED IN `(min over window)` /
position-mistake `hpMin` skip seconds after `roundEndMs`
(`secondsPastRoundEnd`); `killWasLive` clips at the round's end. An enemy
healer's own control reflected back onto it is a healer lock
(`enemyHealerCcWindows`: missed-sync-window, unsynced-burst, `[KILL WINDOW]`
`enemy healer hard-CC'd`; `healerCcAt`). A control immunity another unit put
on the healer in the control's REMOVED millisecond is the lock's `endedBy`
(`control immunity: X (who)`). Shield Charge (385952) is Utility, not a
defensive (Spiritwalker's Grace precedent). Stampeding Roar 77761 gets its
talented 10 s row. 605 files, base ec4f3a94a (checks re-read on the base
capture): candidate rows +0 / −0; one row's facts gain `endedBy=control
immunity: Berserker Shout (…)`; the missed-sync-window legend gains two
sentences (562 files); context: `[BURST ANSWERED]` 18 lines, STAYED IN 2,
`[KILL WINDOW]` 2, a Blinding Light our own Highlord's Judgment broke at half
its length reads Full (9 lines + 3 new `[CC BROKEN]`), Shield Charge 3 lines.
corpusFactScan5: troughPastRoundEndReaders 26 → 6 (the 6 left: the owner died
at the round's end and the line prints that death's 0 %), drBandForcedEnd
3 → 0, drHalfLengthFull 6 → 3, drResetBandLength 6 → 3; one rise,
drReaderAgreement 6 → 9 (a Cheap Shot cut by its holder's death read 50 %),
fixed after the run by the death-cascade clause: on those two files every DR
check is 0 and the line is back to base (`Full | ended at their death`); the
remaining drHalfLengthFull / drResetBandLength rows (a Psychic Scream
removed after the round's deciding death) are read as cut by the round's end
in the checks too. The `syncWindowPriorGenerated` table is stale (the healer
lock set changed) — GH #115.
Cross-review follow-ups (same version): a control a REFRESH cut is no band
evidence on any walk; a removal past the round's end is none either
(`buildCcCategoryHistory`'s `roundEndAtMs`, passed by the dispel DR, the
`[CC MISS]` Immune note and the control target state); a kicked pet channel is
checked against the pet; the incoming history-only path (a reflected control)
is gated, round-bounded, reads the whole roster and carries `drFullSeconds`,
which `[CC AVOIDED?]`'s DR cause keeps. Cover set, base ec4f3a94a → aeab16340:
267 checks, 0 rises, troughPastRoundEndReaders 19 → 0, the new
reflectedHealerLockUnread 14 → 0 (14 with the reflected-lock reader off); the
follow-ups change no output line on the cover set.

v490 (2026-11-05, GH #157, GH #184 part A, GH #126 Elusiveness; user
2026-11-05 「按你说的做」): three data rows.
(1) Retribution's Divine Protection 403876 with Shield of Vengeance 1261562:
a promoted talent modifier, priced by the log's date (`datedModPct`,
`HOTFIX_2026_08_25_EPOCH_MS` 15:00 UTC, `logDatedNumberAt`): +5 → 25 % on a
log certainly before the hotfix, +10 → 30 % from it on and inside the 14 h
zone uncertainty. The date is `IMitigationContext.atMs`, else the caster's
earliest cast or aura row (`unitLogEpochMs`). Corpus: holders 0.758 per day
08-14…08-24, 0.701 from 08-26 (= DB2 20 + 10); Holy's 498 control flat
0.62–0.66.
(2) Ravager 228920 and Execution Sentence 343527 are roster Offensive (out
of `OFFENSIVE_PRESS_FACT_IDS`).
(3) Feint 1966 / Evasion 5277 leave `NO_MITIGATION_IDS` for
`MITIGATION_OVERRIDES` at 20 %, the whole of it Elusiveness 79008's
(`wholeReductionTalentId`); verdicts Feint `never`, Evasion `unconditional`
against what a parry stops and `never` against spells. A talent-whole row is
out of `MITIGATION_WALL_IDS` (predicate-index "Not yet unified", GH #135).
scan5 `abilityIntoWallShare` treats a `never` spell verdict as the gated one.
605 files against tw1 (ec4f3a94a): findings — 37 files, all part (2):
position-mistake 82 → 81 and 70 → 69, kick-eaten burst lists naming
Execution Sentence; part (1) adds 0 (the undated 30 % added 2
burst-into-mitigation on these pre-hotfix logs; dated, 0). Context — 987
`[ENEMY DEF]` Divine Protection 20 → 25 %, 34 `[STACKED DEFENSIVES]`; 207
`ABILITIES INTO IMMUNITY/DR` lines into Evasion (167 files); 256 mitigation
audits priced (Feint 218, Evasion 38) where they read "not in the
mitigation table". Gates unchanged; corpusFactScan5 `talentWallPrinted` 870
→ 864, `noDefensiveButPressed` 5 → 6 (an existing class: Execution Sentence
starts a window at 1:22 whose STAYED IN span holds a Death Pact).

v491 (2026-11-05, GH #184 part B; user rulings 2026-11-05: Divine Toll only
for Retribution, Convoke only for Balance / Feral; window option 「a」).
`SPEC_GATED_OFFENSIVE_CD_IDS` (spellDanger.ts): Divine Toll 375576 is a major
offensive cooldown in a Retribution's hands, Convoke the Spirits 391528 in a
Balance's or a Feral's. Readers that know the unit pass its spec
(`isOffensiveCdFor`, `offensiveEffectCdId(id, spec)`, `isEnemyCdWindowSpell`,
`offensiveCdOfAura`); the ledger tags the row Offensive in that spec
(`isOffensiveLedgerCd`). Holy's / Restoration's stay `[ENEMY HEAL CD]`,
Protection's / Guardian's stay press facts. Divine Toll is instant in DB2;
its window is Divine Resonance 1266308 as logged (`TALENT_EFFECT_AURAS_OF_CAST`,
castEffectAuras.ts — read only by the observed effect end). 150 files: 248
Retribution presses, 173 applications, all on Retribution, median 13.5 s
(DB2 30 s, consumed by Judgments). A press with none logged has no span:
`[RES]` drops its 8 s fallback for it. 605 files against PV490
(ff53cc390): findings missed-sync-window 660 → 666 (Divine Toll ready at an
own-team healer control; −5 where its Resonance ran through the control),
kick-eaten 1847 → 1854 (+ ~150 burst-list fields), position-mistake 157 →
154 (windows merged). Context: Divine Toll in 1,343 `[OFFENSIVE WINDOW]`,
1,627 `[RES]` enemy entries; Convoke in 2 windows. Burst spans: 78 at 0–5 s
(no talent), 196 at 10–20 s, 20 at 30 s. Gates unchanged; corpusFactScan5
resCdBeforeNextPress 632 → 626, troughPastRoundEndReaders 6 → 5,
allyOverlapDeferral 4 → 5 (the existing summedByMagnitude class, a new
Divine Toll overlap line). codex review: the ledger's Offensive promotion
runs outside the healer-roster branch, a Resonance whose end the round does
not show gives the aura's official length (`talentEffectAuraAtPress`),
`hasOffensiveSpellActive` passes the aura caster's spec; recapture — same
finding counts, 14 burst-list fields and 38 context files more name Divine
Toll. Not unified (predicate-index): the aura readers do not resolve
Divine Resonance to Divine Toll.

v492 (2026-11-06, GH #179 batch 3d). `pressDuration` (offListPress.ts): when
no unit has a row of the press's aura at or after its cast row, a row the
log wrote up to `AURA_BEFORE_CAST_ROW_MAX_MS` (150 ms) ahead of it is the
press's own (Divine Steed, Blazing / Prismatic Barrier, Gladiator's Badge,
Sprint, Fade … 1 ms before their SUCCESS). Only then: widening every press
(trial b3a3) moved 87 lines that had read a row of their own — a Holy
Armament's self REFRESH 1 ms ahead hid the ally's APPLIED, a Tip the Scales
Dream Breath read 2 s. Such a row is priced at the press (`castParamAt`
looks back from the instant it is given: the cast comes after the row), and
among several rows ahead the first logged in the latest millisecond is taken
(Holy Bulwark's 432496, not its shield 432607 re-laid every 2 s). 605 files
against PV491 (be3637d6d): 2,671 context files, 8,712 `[PRESS]` lines gain
`lasts Ns` (Divine Steed 1,725, Blazing Barrier 883, Demonic Circle:
Teleport 792, Prismatic Barrier 777, Gladiator's Badge 563, Sprint 554,
Death Charge 523, Fade 465 …), no line loses or changes one; findings
byte-identical; text gates identical. scan5 `offListPressLine` 305 → 324
rows (106 → 113 facts, 0 gone): the 7 new are open classes already on #179
— Spiritwalker's Grace past its Momentum cap ×3, Between the Eyes stacks /
an unexplained 22 s ×3, a Sprint at 14.1 s ×1. The scan's life reader now
stops at a later stack (`SPELL_AURA_APPLIED_DOSE`) and no longer reads an
overshoot off a REMOVED of the press's own millisecond; its new
`lastsOvershoot` kind (out of the total) counts lines whose aura was removed
— not purged or stolen — before half its printed length (2,698 facts on this
capture, mostly consumed or broken buffs: Thunder Focus Tea, Camouflage, Eye
Beam). codex review: an aura row ahead of its cast row keeps its own instant
for per-event extensions (`buffFullDurationForCaster`'s new `paramAtMs`
moves only the cast-parameter read: a Lightning Bolt between Spiritwalker's
Grace's row and its SUCCESS still adds Momentum's 1 s; 0 lines of the 605
capture move), and a dispelled aura is no overshoot.

v493 (2026-11-06, fact11 batch 1: D2 D7 D10 D20 D21 D22 D25 D26 D27 D29 D32
D39 D44; user rulings 2026-11-05 「以后这种都按日期分版本」, Doom Winds a
proc from 12.1.5, Predator's Wake its own 90 s before 12.1.5, D26 「Add,
preview first」).
(1) Channels (D2 D39): `rowIsPressEndingCast` — a button press
(`isButtonPress`: DB2 SpellCooldowns row), not riding along, no copy / tick /
companion / impact row (`isNoPressRow`) — is the one reading of a cast row
that ends a running channel (`nextPressEndingChannelMs`, kickAudit). A
channel the game refused at its press (`channelRefusedAtCast`: its own MISS
within 50 ms, no effect row after) has length 0.
(2) Dated game data (`ILogDated` / `logDatedAt`, logEra.ts): Doom Winds
384352's aura stands for a press before 12.1.5 and is a proc from it
(`AURA_PRESS_BY_ERA`, auraActivationEra.ts; careful side the press);
Predator's Wake 1259431 is its own 90 s offensive cooldown before 12.1.5 and
The Hunt's button from it (`OVERRIDE_VARIANT_SHARES_BY_ERA`,
overrideVariantEra.ts; `canonicalSpellId` / `spellAliasIds` take the date).
Before 12.1.5 the Wake's The Hunt effect aura 1246168 is the Wake's own, no
evidence of a press of The Hunt (`effectEvidenceCastSeconds`). An enemy's
hidden-press reading reads the same date (`hiddenPressMs`).
(3) Immunity (D10 D20 D21 D32 D27): a press with a hit of its own on the
unit in the IMMUNE row's own instant (`pressLandedOn`,
`PRESS_LANDED_SAME_INSTANT_MS`, follow-up cast ids included) landed — one
component refused, no `[IMMUNE]`; `immunityStopsSpellSchool` (DB2 aura-39
mask) — a school the immunity does not stop is no waste and no IMMUNE
cause; a hit through a pct-100 wall is no press into it
(`landedThroughWall`); a damage spell's IMMUNE cause is a pct-100 wall
covering its school (`immunityStopsDamageSpell`); a healer in an immunity
form lists no control threats.
(4) D26: Devourer's The Hunt 1246167 is a roster offensive cooldown. On a
12.1.5 log a press of Predator's Wake proves The Hunt's button
(`activatedSpellIds` takes a dated override variant's canonical id), so a
Devourer who pressed only the Wake keeps the row without decoded talents.
605 files, base ff53cc390 rescanned with these checks → this tree: no FATAL;
274 checks 237 unchanged, 11 fell, 1 rose. Fell: variantSpentButton 368 → 25
(→ 0 on the 17 Wake files after (2)'s effect rule), channelEndOnOwnRow 412 →
20 (Ultimate Penitence, as at the base), intoDefenseLanded 288 → 0,
intoImmunityLanded 223 → 0, doomWindsNoPressReading 117 → 0,
exposureThreatOnFormHealer 88 → 0, immuneCauseCannotStopDamage 79 → 0,
pressImmuneTagLanded 68 → 0, channelSpanUnrun 3 → 0. Rose:
resCdBeforeNextPress 632 → 713 — The Hunt 142 → 0, Predator's Wake 13 → 236,
all August (12.1.0) logs, where the Wake is re-pressed 43–68 s apart against
its own 90 s (old patch only: recorded on GitHub, user ruling 2026-11-05).
Family diff: `[PROC] Doom Winds` 123 → 0 (an unlogged press before 12.1.5;
scan5 `auraActivationNoLine` lists them as `unlogged press (dated)`, out of
the total); `[KILL WINDOW]` / `[VULNERABLE]` on Predator's Wake 30 → 0;
`[RES] Predator's Wake` 295 → 802; ABILITIES INTO Cloak of Shadows 259 → 78.
Candidates 7428 → 7430: missed-sync-window +2 (one fact, The Hunt ready on a
12.1.0 Devourer), none removed.
Cover set (117 files, mixed 12.1.0 / 12.1.5), against the same tree before
(4)'s activation proof and (2)'s effect rule: no FATAL; 275 checks 268
unchanged, 0 fell, 0 rose; missed-sync-window gains The Hunt in 5 places on
12.1.5 Devourer logs (2 new candidates, 3 list it in readyCds).

v494 (2026-11-06, fact11 F26 classes 3–8). Readers that disagreed about one
fact now read it once. (1) D16: a Holy Paladin's Avenging Wrath 31884 is a
healing cooldown (`HEALER_HELD_OFFENSIVE_SPEC`, `[ENEMY HEAL CD]`), never an
enemy burst — the enemy CD timeline, offensive windows, crisis bursts and
the threat reads gate it by spec, on both sides. (2) D4: Apotheosis joins
`HEAL_NOT_MAJOR_DEFENSIVE_IDS` (no `readyCds`, no "defensive CD
available"). (3) D46: Prismatic Barrier 235450 and Blazing Barrier 235313
are ledger saves like Ice Barrier (`ENEMY_SELF_SAVE_ONLY_IDS`): `[PRESS]`
becomes `[YOU]` / `[TEAM] [CD]` and `[ENEMY DEF]`. (4) D5: `landedControlsForKit`
counts the silences the `[SILENCE]` lines print (`silenceIntervalsInRound`,
the owner's `unloggedSilencesOnOwner`), a dispel backlash aside; the kit gate
counts `[SILENCE]` lines the same way. (5) D6: a silence the log wrote no
aura for (`unloggedSilencesOnOwner`, moved out of the `[SILENCE]` section)
stops a cast bar (`ownerCastBarOutcomes` → `near` = cc): `[CAST STOPPED]`
and the cancel ledger. (6) D9: `unrowedSpellReflections` reads a Spell
Reflection return logged only as a 23920 row as a reflect of the caster's
latest damaging cast at the reflector (`reflectedSpells` and corpusFactScan
`reflectReturn`). (7) D15 / D17 / D19: an area save's nil-source aura of the
cast's name counts; Aura Mastery reaches Devotion Aura holders
(`AURA_EMPOWERING_WALLS`, `empoweredAuraSpansOnS`; the `[ENEMY DEF]` gate
reads it like an area save); a shield whose run starts in a re-stated batch
starts at its first absorb. (8) D24 / D30 / D41 / D33 / D28 / D3 / D14:
overlap and save-press spans stop at the aura's own end, a summon's old
pulse is no answer, a cast row with no button (toys, passive procs:
Sanctified Ground) is no `[YOU] [CAST]`. (9) D8 / D40 / D1 / D13: a healer
owner's control into a Grounding Totem is printed; Stormstream Totem is a
critical summon; STAYED IN's top damager stops at the round's end; a
trough's second is the lower unrounded reading's.
19 audited rounds, base → after: castStopUnderUnloggedSilence 1/7 → 0/6,
kit gate 11/19 → 0/19, ownerGroundedUnstated 2/2 → 0/2, reflectReturn 1/7 →
0/7, healerRosterAsEnemyBurst 4/22 → 0/18, areaCarryInDefenseless 4/48 →
0/47, allyOverlapPastAura 4/5 → 0/3, savePressRunsOverlap 1/46 → 0/53.
Cover set (117 files), base rescanned → this tree: no FATAL; 288 checks 206
unchanged, 13 fell, 4 rose. Fell: healerRosterAsEnemyBurst 75 → 0,
areaCarryInDefenseless 26 → 0, savePressRunsOverlap 12 → 0,
answeredByOldSummonPulse 9 → 0, allyOverlapPastAura 16 → 3, castLineNoButton
569 → 441, pressedInsideNeverBack 257 → 199, ownerGroundedUnstated 9 → 1,
reflectReturn 3 → 0, kit gate 420 → 0 (with the backlash rule). Rose:
checkEnemyDefRefConsistency 0 → 46 (Aura Mastery on holders; the gate now
reads the wall like an area save → 0), noDefensiveButPressed 1 → 2 (the
scan counted Apotheosis; it now reads `isNotMajorDefensive`),
resCdBeforeNextPress +3 (the known 12.1.0 Predator's Wake re-press on a new
`[RES]` line) and staleDipWithDamage +3 (an existing grid tick, newly
printed beside a barrier press). Candidates 2652 → 2646: cd-hoarded −10
(Apotheosis-only rows), missed-sync-window +3 (one fact: the pressed Soul
Immolation's burst now ends at 2:22, before the enemy healer's 2:25 control),
slow-defensive-response +1 (the window now opens at Malevolence, not the
paladin's Avenging Wrath).

v495 (2026-11-06, GH #123): `CC_DURATION_TALENT_MODIFIERS["2094"]` and
`["427773"]` (both Blind ids on the same DB2 mask) —
Airborne Irritant 200733 shortens Blind by 35 % (DB2 row 1102512, aura 108
−70 % × PvpMultiplier 0.5; tooltip "…$s2% reduced duration…"), so a holder's
Blind is priced at 3.25 s, not 5 s. User ruling 2026-11-06: add it on DB2 and
the tooltip alone. 605 files: 0 of 276 rogue loadouts hold the talent (entry
117740), so no rendered line changes; the entry carries `corpusPending`, and
the season run of `durationTalentScan.ts --candidates` prints it under
PENDING with its verdict until holders are measured
(`durationCandidatesFromInventory.ts` keeps `corpusPending` pairs as
candidates instead of dropping them as registered).

v496 (2026-11-06, codex 20-F26-03 #1, fact11 D34 D45 D42 D38 D47 D11).
(1) P1, B3iii: `killWindowFacts.ts` builds the `[KILL WINDOW]` /
`[VULNERABLE]` ready, maybe-back and back-inside lists from
`countsAsTeamBurst` (a healer's own offensive cooldown is team burst only
when it is Power Infusion). `pressed inside` still names every offensive
press (Ultimate Penitence, ruling 2026-10-20). (2) D34: an immunity save
pressed with no aura logged prints `(immune, no aura logged)`
(`immunityPressesWithoutAura`). (3) D45: an immunity's slot names the
allies the same press covered, `; also on N(X), …` (`immunityAlsoOn`). It
is written by `enemyDefAlsoOnClause` and read through
`ENEMY_DEF_ALSO_ON_RE_SRC`. (4) D42: Rain from Above 206803 is an aura-only
activation (DB2 NO_CAST_LOG), so its aura prints a `[PRESS]` line. (5) D38:
Essence Break's debuff 320338 lasts 5 s (corpus patch, n=205). (6) D47 (user
2026-11-06): an unseen-end invisibility its holder ended with its own action
is no "forced a full immunity". (7) D11 (user 2026-11-06, wording only):
`PRIME (…; Will to Survive ready)` with a legend line, read with the [CC]
line's `trinketRacialReadyMs`. Cover set (117 files, 1,140 owners) against
e950156df: no FATAL, 0 of 1,140 findings files change, gates unchanged, and
the six new class checks fall to 0 except immunityCopyUnstated, which keeps
3/618 (one fact).

v497 (2026-11-07, GH #188 #179 #173 #167; user rulings 2026-11-07). (1)
GH #188: companion cast rows (`isNoPressRow`) no longer count as presses in
`healerMetrics`, `momentSnapshot`, `teammateCrisis`, `healingGaps` and
`cannotCastIntervals`; 0 rendered lines change on the 605 set. (2) GH #179:
Violent Transformation 452409 resets Voidblade 1245412 / Pierce the Veil
1245483 on entering Void Metamorphosis 1217607 (holders with an entry
between two presses: 87/126 gaps under 29 s; holders without one 0/64;
non-holders 0/7); 272 press lines change their back time. (3) GH #173: a
`[BUFF FADED]` early end with no logged cause reads `(ended after N of M s
— …)` instead of `(ended early — …)` (1,302 lines). (4) GH #167: a heal or
buff into an enemy's Cyclone on our player reads `[IMMUNE — Cyclone was up]`
(57 lines). A KILL ATTEMPTS burst opener whose every press of the anchor
into the target was refused IMMUNE keeps its anchor and adds `| every X
press into the target logged IMMUNE` with a legend
(`killAttemptAllImmuneClause`; 5 attempts, 14 lines). `landedAnywayOn`
stops at the caster's next press of the same spell id, so a later press's
hit no longer lands a refused one (1d9b0cbe 2:17: Fury of Elune →
Incarnation: Chosen of Elune, 3 lines). 605 set against 8d72336ad: 1,035
of 3,519 context files change, 0 findings files; immunityBurstAnchor 17 (6)
→ 0, offListPressLine 306 → 68 (same scanner).

v499 (2026-11-07, GH #192–#198 — fact11 leftovers, user ruling 2026-11-07
"都修了吧"): an old DoT's tick is not a new press landing, and a channel
refused at its next press reads refused (#192); Ultimate Penitence's channel
stays its bolt phase and the line adds "; its aura until M:SS" (#194); a
single-target direct hit on Vanish / Burrow / Mass Invisibility more than
1 s in ends the immunity — the [ENEMY DEF] line prints the cut length with
"— ended by a hit" (conditional legend) and KILL ATTEMPTS no longer reads it
as a forced full immunity (#195); 12.1.0 Violent Transformation resets The
Hunt and Predator's Wake, its Soul Immolation reset is dated from 12.1.5,
and the 12.1.0 Doom Winds unlogged press gets its line (#193); Havoc 4pc
Essence Break 5 s / 30 s (#197); a Fang Strike Dispatch spends the maximum
combo points for Restless Blades (#198); re-pressed ally spans (#196). Cover
set (293 checks): 277 unchanged, 6 fell, 0 rose — stealthImmuneThroughHit
24/75 → 0/314, immunityBaitedSelfBroken 27/622 → 3/595, Predator's Wake
resCdBeforeNextPress 137 → 0, Essence Break backBeforeNextPress 111 → 3.
Candidates (cover set; no 605 preview, user approved): missed-sync-window ::
The Hunt 8 → 28 files, [VULNERABLE] :: The Hunt 3 → 12, missed-sync-window
:: Binding Shot 1 → 5 — The Hunt ready again after the 12.1.0 reset. The
cooldown-model change leaves the PV498 reference tables stale for The Hunt
(GH #115).

v498 (2026-11-07, GH #115 batched regen #6 — data only): the reference
tables went stale across the fact8–fact11 / F21–F26 rounds (PV425–PV495:
heals off the major-defensive set, more answers recognised, the F24/F25
offensive-cooldown additions, event-based cooldown reductions). Regenerated
on the same corpora as the 2026-10-20 regen at code e950156df:
burstWindowPrior (1,630 → 2,162 leaves: cells for Blood Fury 20572 and Dark
Harvest 1257052), syncWindowPrior, behaviorPrior, cdTriggerPrior,
kickPriorityPrior + heal spells, kickLockoutObserved, healerSaveCd (Fade 586
leaves the Holy / Discipline rosters: eda327c53 made its base profile 0 %
without Translucent Image), backlashDispelPrior, dispelObserved,
cdRecastFloor (39 → 18 floors: 24 drop — Bladestorm, Avatar, Recklessness,
Shockwave, Colossus Smash, Feign Death, Paralysis, Ice Block, … — because the
cooldown model now explains their early recasts, hold-out share under 0.99
below 1 %; 3 added: Predator's Wake, Odyn's Fury, Prismatic Barrier), the
reference vectors, and CD_HOARDED_OUTCOME_REF (5.8 / 13.0 / 15,653 → 5.3 /
13.8 / 16,061). 605 files (cap-before e00f0525 → cap-after ceece3ea):
the six reference-consistency gates that the stale tables tripped fall to 0
(backlash 244, behaviorPrior 40, burstWindow 291, cdPrior 174, kickPriority
279, syncWindow 668 → 0; CjkLeak 12 and FindingsCountFollowsMenu 3,519
unchanged). Healer candidates: slow-defensive-response 86 → 109 (+37 / −14: the
3-point contrast door — Solo Shuffle Avenging Wrath 5 vs 7 → 5 vs 8 and
Summon Darkglare 7 vs 8 → 7 vs 10 cross it, Blood Fury / Dark Harvest get
their own cells, Army of the Dead 12 vs 15 → 12 vs 14 falls under it),
cd-hoarded 423 → 420 (all roles 1,011 → 1,008), cd-waste 157 → 151 (all
roles 888 → 882); missed-sync-window 664,
backlash-dispel 61, kick-priority-team 54, kick-priority-missed 36 change
reference numbers only. Context: cooldown ranges narrow where a floor went
([26–40s] → [40s] Shockwave), so a Shockwave on cooldown leaves the
[HEALER EXPOSURE] and ENEMY CC KIT threat lists; the "Fade correctly HELD"
NOTE goes with Fade's roster entry. Built before #123 (Airborne Irritant,
605 byte-identical) and before the F26 batch 3 / cat4 / #150 commits; those
land after this regen and are not in these tables.

v500 (2026-11-07, GH #138 #126 #128 #157 #173 + Darkness; user rulings
2026-11-07). (1) GH #138: `getLowestHpPercentInWindow` reads the shared
trough `hpTroughInEventSpan` (validity rules, whole percent, a death inside
the window reads 0) under `matchMinHpPct`, threat assessment, the moment
snapshot and the healing-gap low; 344 NOTE hunks on the 605 set move by
rounding (84 % → 85 %). Where the old raw minimum was 59.5–59.99 % the
rendered trough is 60 %, so the cd-waste pressure gate (anchored on the
rendered value — user ruling 2026-11-07, 「可以」) drops 9 menu rows:
111-1-598 Die by the Sword; 160-6-1001 Evasion and Cloak of Shadows;
171-3-1066 Evasion and Cloak of Shadows; 39-6-238 Blessing of Spellwarding
and Lay on Hands; 68-1-398 Astral Shift; 96-3-513 Die by the Sword. The
GH #70 consequence probe prints the `[CONSEQ]` line's own readings
(`teamDrops`). (2) Darkness 196718 lasts 8 s + Long Night 389781 3 s +
Cover of Darkness 357419 4 s (PvP) — 89 kit lines 8 s → 11 s, a kill
window's `defenseless` start moves 2:21 → 2:24. (3) GH #126: a Magic CC or
debuff landing on a unit under Prismatic Barrier 235450 or the Merely a
Setback 449336 it leaves when it falls runs 0.85 of its length in PvP (DB2
aura 245 misc0 1, −25 × 0.6); `ccFullDurationForApplication` takes an
`ICcLandingState` {roar, prismaticBarrier}, read by `ccLandingStateAt` in
the product and the DR gate alike. 605: [CC BROKEN] 18 hunks (Howl of
Terror 5.0 → 4.1 s wasted, Psychic Scream 4.2 → 3.3 s, five Dragon's Breath
breaks fall under the 2 s print threshold), [PRESS] 36 (Wake of Ashes 11 →
9.4 s, Flying Serpent Kick 4 → 3.4 s). (4) GH #128: npc 58965 (the Felguard
on its Wrathguard model) is a Felguard — 15 roster lines gain the pet, and
6 lines stop naming that Demonology Warlock a purger. (5) GH #157: Improved
Mass Dispel 426438 (Mass Dispel 120 → 60 s before, 45 s since) and Call of Al'Akir 1246131 (Nature's Swiftness 60 → 90 s before, 80 s since)
are dated at the 2026-10-06 15:00Z PvP hotfix (0 holders in 605 + wide; 0
lines). (6) GH #173: the offensiveTagWrong gate reads the product's
`offensiveSummonActiveAt` (scanner only).

v501 (2026-11-08, fact12 D34 D14; pipeline batch B3). (1) fact12 D34:
Ray of Frost 205021 is proven by its channel buff 269748 in
`PRESS_PROOF_AURA_IDS`, so a press channelled out of invisibility is on the
enemy press list ([ENEMY CD] numbering, cooldown ledger, windows); the 605
capture is byte-identical (no unseen Ray of Frost there). (2) fact12 D14:
the aura-less immunity line of [ENEMY DEF] asks
`friendlyOffensiveCdActiveAt` like the aura line (one `burstTagAt`
closure); cover set: 3 [ENEMY DEF] lines gain the tag, 0 menu changes.
(3) GH #134 (c) was already fixed at PV394: a pin test only. Batch verified
on tests + codex (user 11-08); the 605 / cover / wide verification runs at
the end of the wave.

v502 (2026-11-08, fact12 D30 D28; pipeline batch B4). (1) fact12 D30: new
shared predicate `castMissRows.isTwinMissRow` (same miss type within
CAST_MISS_LEAD_MS, or the same English name in one rendered second, as
Intimidation 24394 + 474421); `aimedControlsForKit` dedupes twins, so the
ENEMY CC KIT header's 'aimed at you / them N×' counts presses, and the
[CC NOT LANDED] fold reads the same predicate. Cover set: 3 KIT lines
(Maim 2× → 1×), 0 menu changes. (2) fact12 D28: backlash-dispel decision
points take only a deliberate dispel (`isDeliberateDispel`, the predicate
[MINOR DISPELS] folds on); a rider removal such as Fortifying Brew's side
effect ends the decision with no row. New gate
`checkBacklashDispelWasPressed`, which checks every backlash candidate's
context (605: 43/43). 605: the 61 backlash rows are unchanged; the round-12
repro row (cf63da4a r0, UA t=103.5) goes. Batch verified on tests + codex
(user 11-08); 605 / cover / wide run at the end of the wave.

v503 (2026-11-08, fact12 D16, GH #141 item 5; pipeline batch B5). (1) fact12
D16: Nether Ward logs a returned spell's damage row in the caster's own press
millisecond, ahead of the REFLECT row that names it; `pairNetherWardReturns`
now pairs such a lead row with the first free REFLECT row of the pressed spell
after it (`netherWardPressedSpells`), so "Fire Blast reflected ×2" no longer
hides a Pyroblast. New scan5 check `wardLeadReturn`: repro 2/2 → 0/2, cover
set 8/8 → 0/8 (one [REFLECTED] line × 3 views), 0 menu changes. (2) GH #141
item 5 (user ruling 11-08: official 20 yd reach plus line of sight):
`enemyTargetReaches` (Touch of Karma) drops an in-reach enemy proven out of
sight; unknown line of sight still counts. 605: 0 of 7,400 menu rows and 0
context lines change. Batch verified on tests + codex (user 11-08); 605 /
cover / wide run at the end of the wave.

v504 (2026-11-08, fact12 D18 A15/B19 D8 D22, GH #173.3; pipeline batch B6).
(1) fact12 D18: the [RES] death cut ends an enemy effect only for the caster's
own death or the Solo Shuffle round's end, and only when no copy the caster
put on any unit (pets included) outlives cut + 100 ms (`casterAuraOutlives`,
shared with the scan). 605 resEnemyEffectAfterDeath: holder dead 764 → 23,
round over 692 → 515; the B1 regression (an enemy press in the death's own
second) stays 0; findings 0 changed. (2) fact12 A15/B19: an HP row read across
a max-HP step up reads over the new max; heals between two HP rows are read
in the log's line order inside one millisecond (`loggedBetween`, one predicate
for every reader). 605 hpStaleMaxStepUp 2093 → 0; candidate delta exactly
ruling R02 (+1 position-mistake 3e26e29c r1 t=82, −1 backlash-dispel
cf63da4a r0 t=103.5). (3) fact12 D8: a silenced target is no "not CC'd"
second for [CC BOOKMARK] / [PEEL OPTION]; checkCcSuggestionInsideSilence
49 → 0. (4) GH #173.3: an interrupted channel's [BUFF FADED] prints "ended
after N of M s — the channel stopped", not an expiry;
checkChannelInterruptedFadeExpired 18 → 0. (5) fact12 D22 (ruling R01): a
Solo burst line a healer's Avenging Wrath overlapped says
`(a healer's Avenging Wrath is not counted)`; checkBurstSoloHealerHeldNote
40 → 0. Batch verified on tests + codex (user 11-08); 605 / cover / wide run
at the end of the wave.

v505 (2026-11-08, fact12 D29, GH #123.2 #136.3; pipeline batch B7).
(1) fact12 D29: `[ROOT] … (from X's totem)` resolves the owner from the root
aura's own source GUID, not the first same-named summon on the side (two
shamans on one team). (2) GH #123.2: Assimilation 374383 adds 2 s to
Anti-Magic Zone (DB2 row 1245953, aura 107, mask covers 51052 / 145629;
605 holders 7 of 17 at 8 s, non-holders 0 of 265 past 6 s). New scan5
module fact12c: rootSummonOwner 3/302 → 0/302, kitLastsUnderAreaAura
17/1014 → 0/1014 on 605; 0 findings files changed. (3) GH #136.3 (ruling R06):
the re-announce join moves into `buildAuraIntervals`, so every reader sees one
interval for an aura re-APPLIED with no REMOVED between. 605 reannounceSplit
13,863 → 77 of 50,310; −8 phantom [ENEMY CD] lines; 0 menu rows. Batch
verified on tests + codex (user 11-08); 605 / cover / wide run at the end of
the wave.

v506 (2026-11-08, fact12 D19 D31, GH #139 item 2; pipeline batch B8).
(1) fact12 D19: the [ENEMY DEF] channel clause's "damage they took" (Ultimate
Penitence) reads `sumIncomingPressure`, so victim-sourced rows (a deferred
Time Dilation tick, a reflected spell) count. (2) fact12 D31: at a death
teardown the game logs the REMOVEDs, PARTY_KILL, then the lethal hit in one
millisecond; the new shared `auraCloseRow` moves the close row past that hit
for every `toRow` consumer. 605 damageBasis: channelTookBasis 93 views → 0,
duringLethalHit 23 → 0, duringExternalShare 2 → 0; 0 findings files; 412
context lines change (352 Penitence clauses, 60 during-it figures).
(3) GH #139 item 2 (ruling R05, option B): a hunter's `UNIT_DIED
unconscious=1` with no Survival Tactics aura is a Feign Death press in the
cooldown ledger (605: +29 presses, 9 [RES] lines no longer call it ready on
cooldown), but such a Feign Death is never a death save left unpressed:
[DEATH] (Unused: Feign Death) 12 → 0 and [DEFENSIVE AVAILABLE] 3 → 0 against
attempt 1; 0 menu rows. Batch verified on tests + codex (user 11-08); 605 /
cover / wide run at the end of the wave.

v507 (2026-11-08, fact12 D3 D7; pipeline batch B12). (1) fact12 D3: kickAudit
pairs a kick's SPELL_MISSED row through `castMissRows.missBelongsToCast` (the
cast lines' 2.5 s window, no later press of the same kick before the row, at
the kick or its pet's execution) instead of its own ±100 ms, and by the kick's
English name under another id (Solar Beam 78675 → 97547): `[KICK] your Rebuke
… — hit nothing` gains `[IMMUNE: …]`, as does the burst ledger's Kicks: entry.
(2) fact12 D7: new `castPress.pressRowOfLedgerId` (exact id, else the same
English name), shared by the immune tag and the `[no CC aura logged — X was
up]` tag (ledger Imprison 217832 vs logged 221527). New scan5 module t11
(refusedControlRead): repro 7 → 0; 605 (attempt's first run) 17 → 2, the two
Solar Beam rows fixed since; findings byte-identical. (v507 was allocated to
batches B9, B10 and B11 first; all were abandoned before push.) Batch verified
on tests + codex (user 11-08); 605 / cover / wide run at the end of the wave.

v508 (2026-11-08, GH #126 rows 170 / 171 / 234; pipeline batch B13, T27).
(1) Echoing Blessings 387801: Blessing of Sacrifice 6940 is a mitigation row
worth 15 % on the ally end of a holder's blessing, 0 on the paladin's own link,
and keeps the off-table mechanic when the talent is not held; its Echoing
Protection 387804 linger (15 %, every school) is priced. Both signed `never` in
the verdict book (user ruling R07). (2) Bait and Switch 457034 gives Evasion its
own magic slot (physical 20 / magic 32 with Elusiveness, multiplied, measured
0.68). (3) A split row prices each hit once (`componentForSchool`; an immunity
ranks first only when it covers every school of the hit,
`immunityMaskStopsSchool`); the burst-into-mitigation door picks a split wall's
component from the ledger's own damage while the wall was up
(`burstDamageBySchoolOn`, `absorbedHitSchoolMask`). 605: menu rows 7,401 →
7,401 (+0 / −0; ruling R08 replaced R07's +1); context +45 / −26 (death audit
+11 Echoing Protection rows, 6 Blessing of Sacrifice rows priced). Batch
verified on tests + codex (user 11-08); 605 / cover / wide run at the end of
the wave.

v509 (2026-11-08, fact12 D5 D6 D9; pipeline batch B14, T12). New
`utils/pressRow.ts` `isNoPlayerPressRow` (an auto-attack replacement swing or a
passive proc, `isAutomaticCastRow`, or a copy / companion / impact row,
`isNoPressRow`) is the one predicate for "a button the player pressed": the
kick-eaten `postKick` (ccTrinketAnalysis) and the missed-cleanse
`dispellerPressed` (candidateFindings) read it, and ABILITIES INTO
(offensiveWasteAnalysis) with its gate (scan5 damageBasis `abilityIntoWallShare`)
drops `isAutomaticCastRow`. Sundering 467283 joins `COPY_CAST_IDS` (605: 92 / 92
rows 0–545 ms after the same caster's Lava Lash, no target). New scan5 module
t12 (pressNamedRead): repro 11 → 0, 605 1,618 → 0. 605: menu rows +0 / −0
(facts on 19 rows: kick-eaten 14, missed-cleanse 5); ABILITIES INTO lines 709 →
549, all Crusading Strikes (160 Retribution lines under the 3-cast floor).
Batch verified on tests + codex (user 11-08); 605 / cover / wide run at the end
of the wave.

v510 (2026-11-08, fact12 D15 D24 D25; pipeline batch B15, T02). enemyDef's
`channelTargetClause` ("— its bolts hit X: Nk of the Mk …", legend "a save that
is a channel") ran for every enemy self-save with a SUCCESS row, so Blazing
Barrier's reactive 235314 hits read as channel bolts and its Overpowered Barrier
pulse 1220755 was left out of the total. New shared predicate
`timelineHelpers.isChannelledPress` (DB2 `CHANNELED_SPELL_IDS` or
`CHANNELED_CD_SPELL_IDS`; Ultimate Penitence's press 421453 stays a channel)
gates the clause; anything else ends at "(at N% HP)". New scan5 module t02
(boltsClauseOnNoChannel): repro 42 → 0; on the 605 base 967 such lines, every
one Blazing Barrier 235313 (Ultimate Penitence's 288 unchanged). Menu rows +0 /
−0 (repro). Batch verified on tests + codex (user 11-08); 605 / cover / wide run
at the end of the wave.

v511 (2026-11-08, fact12 A12 B14 C13 C14; pipeline batch B16, T07). A Spirit of
Redemption second is a ghost, not live HP. `cooldowns.gridEndpointHpPct` checks
ghost before death (the `[STATE]` precedence of `statusOf`). A window whose last
second is ghost and whose first is live (`isGhostEndWindow`) prints "A% → ghost"
and keeps its trough (`ghostEndTroughInWindow`) in `[DMG SPIKE]` and the burst
ledger's Target: line; every spike / burst trough reads `windowTroughOffGhost`
(`hpTroughInWindow` without the ghost seconds). The gates
checkHealedThroughConsistency, checkBurstTargetHpConsistency,
BURST_TARGET_DAMAGE and SPIKE_HP read the ghost end. `[ROT PRESSURE]` needs
positive damage (`rotPressureDamageInWindow`, shared with scan5
rotPressureNoDamage). New scan5 module fact12d (ghostReadAsHp,
rotPressureNoDamage, ghostEndTroughDropped): cover set 5 → 0
ghostEndTroughDropped, 0 → 0 for the other two; 2 burst Target: and 3
`[DMG SPIKE]` lines gain "→ ghost"; findings 0 of 1,140 differ. (v511's T07
first went into batch B9, abandoned before push.) Batch verified on tests +
codex (user 11-08); 605 / cover / wide run at the end of the wave.

v512 (2026-11-08; pipeline batch B17, T32). New
`deathOutcomeAnalysis.freeToPressMsBefore`: the `[DEFENSIVE AVAILABLE]` "(free
to press it for the last Ns before the death)" figure is clipped to how long the
ledger entry had been off cooldown (`offCooldownForLastSecondsBy` on
`cdAvailableAt`, the walk behind the death lines' "off cooldown only for the
last Ns"); the scan5 castThroughStun gate freeToPressBelowLog clips the same way.
`death.ts` freeBeforeDeathS and the missed-options "longest stretch free to cast
it" are unchanged. New scan5 module t32 (freeToPressPastReturn): the ticket's
one real case (a Feign Death, 7.8 s printed, back 1.7 s before the death) was
already removed by v506 (T24, ruling R05); cover set 0 of 199 → 0 of 199, capture
byte-identical. Batch verified on tests + codex (user 11-08); 605 / cover / wide
run at the end of the wave.

v513 (2026-11-09, fact12 D32 D33; pipeline batch B22, T08). (1) D32: an aura
stripped in a dying unit's lethal-hit millisecond is the death, not "removed
early": `deathTeardownWindowsMs` (unitDeath.ts) opens each death's window at
its lethal hit (the earliest overkill row the unit did not survive, at most
`LETHAL_HIT_DEATH_LAG_MS` before UNIT_DIED; `aliveAfterRow` now exported from
killingBlow.ts) and `removedInDeathTeardown` is read by every death-end reader
(auraEndCause, timelineHelpers `[BUFF FADED]` / target died, ccTrinketAnalysis,
cooldowns Forbearance / Hypothermia, enemyCDs `deathCutOfficialEnd`). (2) D33
(ruling R11): a STAYED IN / KITED span whose last rendered second is at or
after the round's end is dropped (`burstSpanSampledPastRoundEnd`); positioningScan
G4f asks the same of every printed second. New scan5 module t08. 605:
deathTeardownEarly 3 views / 1 fact → 0; burst spans past the round end 35 of
2,218 → 0 of 2,168; menu rows 7,401 → 7,398 (−3 stayed-in, the R11 rows, +0);
no other scan5 class rises. (v513 was allocated to batches B20 and B21 first,
both abandoned before push.) Batch verified on tests + codex (user 11-08); 605 /
cover / wide run at the end of the wave.

v514 (2026-11-09, fact12 A6 B7 C19; pipeline batch B23, T05). A Havoc
Metamorphosis press is dated at its own activation on both sides:
`metamorphosisPressActivationMs` (offensiveAuraOccurrences) — the unit's own
162264 APPLIED / REFRESH within `PRESS_LANDING_LAG_S` before the 200166 landing
row of the form instance still up at the landing, skipping a row an Eye Beam
explains (`EYE_BEAM_BEFORE_S` 4 → 0.1 s), else the landing — and
`castRowActivationMs` backdates only a 200166 landing row (a logged 191427 row
keeps its own instant). The friendly ledger (`buildCooldownEntry`: round cut,
`cdAvailableAt`, the press line) and the enemy occurrence read the same
instant, so a Metamorphosis up before a Solo Shuffle round's deciding death
is that round's press, not `[UNUSED]`. New scan5 module t05
(unusedPressedBeforeRoundEnd), calling `castRowActivationMs`. 605 menu rows:
−5 owner rows (3 distinct, all missed-sync-window: the lock sits inside the
Meta burst the context prints; ruling R10), +0; facts changed in 4 rows;
unusedPressedBeforeRoundEnd repro 3 → 0; every other scan5 count identical.
(T05 first went into batches B11 and B19, both abandoned before push.) Batch
verified on tests + codex (user 11-08); 605 / cover / wide run at the end of
the wave.

v515 (2026-11-09, GH #134; pipeline batch B24, T26). kick-priority judges a
friendly pet's kick (Spell Lock) from the pet out at the cast start: the pet's
own control and casting locks (`kickBlockedOf`; the owner's locks are not
read — 605 corpus: 82 of 720 pet Spell Locks were cast while the owner was
under a cast-blocking aura, against a 9.2 % base rate), its presence
(`petReplacedBySummonAt` / `petLastPresenceRow` in petPresence.ts: an owner's
later pet summon sends the pet away unless it shows itself after it in log
order; an aura removal is no presence), and its raw-sample line of sight
(`rawLineOfSightAt`, also read by `enemyTargetReaches`). A pet's kick prints
`kicker=<owner>'s Felhunter` and `kickerYd`; the team form names the pet in
its `teammates=` entry and in the `ownerWhy` parentheses (ruling R04); the
missed legend no longer says a pet's kick would have cut the player's own
cast. 605 menu rows 7,393 → 7,399 (+6 / −0, exactly the R04 rows), context
lines 0 changed. (T26 first went into batches B10, B18b and B21, all
abandoned before push.) Batch verified on tests + codex (user 11-08); 605 /
cover / wide run at the end of the wave.

v516 (2026-11-09, ruling R13; pipeline batch B27, T31). `ccReachAt`
(ccTargetState.ts — the reach test behind PEEL OPTIONS, `[CC BOOKMARK]`, CC USE
and the healer-offense `[OPPORTUNITY]` / `[CONTESTED]` "X ready on enemy
healer" lines) reads line of sight on the nearest raw position samples
(`rawLineOfSightAt`, as the losAnalysis contract, kick-priority and
`enemyTargetReaches` do) instead of the interpolated points its distance
reads; distance still interpolates. The predicate-index OPEN entry of
2026-10-01 stays open for the other interpolated LoS readers (`[ROOT]`,
`rootReachProvenS`, the burst-window gate, the healer-exposure sweep). 605
(caps/576387789-605): candidate rows 7,399 → 7,399,
findings byte-identical; context lines move both ways in 27 owner files —
`[PEEL OPTION]` 899 → 902, `[CC BOOKMARK]` 4,255 → 4,256, `[OPPORTUNITY]` 154 →
153, 2 `[CONTESTED]` lines name another ready control; rendered reach instants
whose raw sample pair is LoS-blocked (new scan5 module t31, ccReachRawLos) 4
of 1,643 → 0 of 1,647. Example: s2/7-1 r1 0:39 Freezing Trap → RDruid peel
option gone (raw pair pillar-blocked, the interpolated point 1.2 yd off read
clear); s0/144-1 r1 2:53–2:55 Freezing Trap → FMage peel option added. Batch
verified on tests + codex (user 11-08); 605 / cover / wide run at the end of
the wave.

v517 (2026-11-09, ruling R07 item 5; pipeline batch B28, T33). A split
defensive's death-audit component rows (Evasion / Cloak of Shadows with Bait
and Switch, Blessing of Protection's physical immunity beside its magic
reduction) printed under the same name over the same seconds, so the reader
could not tell which school each row priced. `computeMitigationAudit`
(counterfactual.ts) sets `schoolMask` on every component row of an entry with
more than one component; `formatMitigationAuditLine` (prompt) and
DeathRecapCard (desktop, Chinese) render the name as "X (physical damage)" /
"X (magic damage)" through `immunitySchoolWords`, in the arith, immunity and
deflection forms; one-component entries are unchanged. Example (605 s2/120-3):
"Mitigation audit: Cloak of Shadows immunity covered 0.3s …" + "Mitigation
audit: Cloak of Shadows blocked ~52k …" → "Cloak of Shadows (magic damage)
immunity covered 0.3s …" + "Cloak of Shadows (physical damage) blocked ~52k …".
New scan5 module t33 (auditSplitLabel): unlabelled same-name same-seconds
groups 12 of 1,833 audit lines → 0 (caps/98cca55f1-605; 4 events × 3 owners);
fact9c strips the label before its deflection-name lookup. Candidate rows
7,399 → 7,399, findings byte-identical. Out of scope, recorded: 9 duplicate
off-table Touch of Karma audit rows (two same-name auras read as the victim's).
Batch verified on tests + codex (user 11-08); 605 / cover / wide run at the end
of the wave.

v518 (2026-11-09; pipeline batch B30: T28 fact12, T30 ruling R12). (1) T28: an
enemy effect due to run past a Solo Shuffle round's end (`shuffleRoundEndMs`; a
3v3 deciding death ends no enemy effect), or pressed after it, is cut at that
end (`cutAtRoundEnd` / `roundEndEndsEffect` in enemyCDs.ts) when the log has an
in-combat aura of its name by that caster and none outlives the end +
`DEATH_CASCADE_MS` (`casterAuraOutlives`, shared with T03's death cut). The cut
moves `buffEndSeconds` (the official end kept in `deathCutOfficialEndSeconds`,
as T03's cut does), so `[RES]`, `burstCastSpan` and the aligned burst windows
end together. An aura applied within `EFFECT_START_AFTER_S` after the cut and
running past it outlives it; a later caster-death cut gives way to the earlier
round end. scan5 fact12 resEnemyEffectAfterDeath reads `shuffleRoundEndMs` and
singles2 exempts a press the round end ended, so the two checks agree. 605
(caps/98cca55f1-605): resEnemyEffectAfterDeath 240 / 69 distinct → 14 / 6
(round over 217 → 0; the 14 left are presses whose effect never landed, T29);
205 `[RES]` rows drop `enemy:` entries past the round end (e.g. "Power
Infusion/Discipline Priest(10s left)"); 29 further context lines in 12 owner
files (9 `[HEALER EXPOSURE]` and 1 STAYED IN burst level rise — the same damage
over a window now ending at the round end — and 2 STAYED IN windows listed);
candidate rows 7,399 → 7,399, findings byte-identical. Two synthetic review
findings stay recorded with their 605 counts (an orphan post-combat REMOVED
inferring survival: 0 orphans, the 36 verdicts it would flip are genuine
survivals; fact12 preferring a later caster death over the round end: 0 of
180). (2) T30 (ruling R12): `[friendly offensive CD active]` on `[ENEMY DEF]` /
`[CC ON ENEMY]` stays for spent cooldowns only — a Demonic form 162264 with no
Metamorphosis press does not light it; the product is unchanged, the 09-26
docstring now says so, and scan5 friendlyOffensiveTag calls the producer's
`hasOffensiveSpellActive` / `isEnemyCdWindowSpell` instead of re-implementing
the window: auraUntagged 482 views / 198 facts → 376 / 154 with the window
unified (106 views were auras with no logged end the scan read as up too long)
→ 0 / 0 under R12 (the 376 were Demonic-only occurrences); in-total kinds 0 → 0. Batch verified on tests + codex (user 11-08); 605 / cover / wide run at the
end of the wave.

v519 (2026-11-09, fact12 D4 D17; pipeline batch B31c, T16). Two event-reduction
rows under-reduced, so the ledger's back time and the kit's `[a–Ns]` sat above
logged recasts. (1) Essence Break 258860 (Cycle of Hatred): the press's own
dose, logged a few ms after the cast, now counts (`ownDoseCounts`,
`ownStacksBefore` read at press + `PER_PRESS_OWN_DOSE_MS`). (2) White Out
1281638 on Frozen Orb: 0.5 s per landed Ice Lance hit 228598 (`hitsCountEachRow`)
plus 0.1 s per own Freezing 1221389 stack lost at the ms of an own landed Ice
Lance / Shatter hit (`triggerOwnAuraStacksLost`), through `eventTriggersFor`
(ledger, `[RES]` ranges, kit); the landed-hit predicate `landedHitRows` is
shared with the existing hit path. New scan5 module t16 (kitSoonestAboveRecast)
reads its presses from the ledger entry the kit entry is rendered from (new
export `unitCooldownLedger`), never from `unitCooldownEntry`'s fallback — a
Stasis release, a Hunt or Time Stop echo is no press; a press with no cast row
is timed at the latest it can have been (`ICooldownCast.timedAtLatest`, read
only by the scan) and anchors no gap. `unitCooldownLedger`, `landedHitRows` and
`ownAuraStacksLostTimesMs` are in the predicate-index (en + zh-CN) and pinned.
605 (caps/aeddaf5f7-605 vs the branch on it; cooldown-model output, unaffected
by main's later context-only changes): kitSoonestAboveRecast all spells 105 /
37 distinct → 102 / 36 (Frozen Orb 5 → 2, the residue a 12.1.0 Spellfrost
Teachings log, out of scope); repro logs 1d26a991 + 64e9a3f3 3 → 0; menu rows
7,393 → 7,393. (T16 first went into batches B20 and B31b, abandoned before
push.) Batch verified on tests + codex (user 11-08); 605 / cover / wide run at
the end of the wave.

v520 (2026-11-09, GH #129.1 ruling Q3; pipeline batch B32, T17). A DB2
percentage mana cost is a share of base mana (`BASE_MANA` 250,000), not of the
reading's max: `manaCostForCast(spellId, specId)` returns `pctManaCost(pct,
base)` = float32(pct × base / 100) rounded half to even, the game's own
arithmetic (Math.round priced Holy Word: Sanctify 34861 at 8,313 against the
log's 8,312). Every consumer goes through `costFor` (resourceAt.ts), which reads
the round's stated cost first for a percentage row (`statedManaCostInRound`, the
highest stated cost inside the round): `affordableAt` for the `[RES]` "(no mana
a/b)" tag, `unaffordableIntervals` for the death lines and scan5 castThroughStun,
`affordableWithin` for cd-hoarded. Probe over 584 downloaded 12.1.5 logs: the
fallback price within tolerance of the mana the press took 176,297 → 284,775 of
352,476 presses (casters whose max differs from 250,000: 55,196 → 163,674 of
205,283); the stated cost of a percentage row equals the predicate's price
401,548 / 401,548. New scan5 module t17 (noManaCostOffBase) checks a rendered
tag's b against the log — a flat row's price, else the owner's stated cost in
the round through `statedManaCostInRound`, else the DB2 percentage of the base
mana the owner's other rows state through the shared `pctManaCost` — 0 / 15 →
0 / 15; 605 capture byte-identical (every rendered tag has a stated cost in its
round, so the fallback decides no 605 line); menu rows 7,399 → 7,399.
`pctManaCost` and `statedManaCostInRound` are in the predicate-index (en +
zh-CN) and pinned; docs/talent-coverage-gaps.md regenerated (percentage cost
reductions stay FLAGged open). (T17 first went into batch B31b, abandoned before
push.) Batch verified on tests + codex (user 11-08); 605 / cover / wide run at
the end of the wave.

v521 (2026-11-09, rulings R14 + R15; pipeline batch B34b, T29). A press the game
refused (a full miss row on its own target: IMMUNE, EVADE, …) is read on two
layers. Effect layer: the refused press runs for no time — `[RES]` enemy /
ally effects, aligned bursts, the burst ledger, the kill sequence, the replay
highlights, kick-eaten `ourBurst` and missed-sync `enteredNextLock` drop it, and
its caster's death cuts a press-only window. Intent layer: the press was still
made, so kill attempts keep it on the end main gave it and the missed-sync
facts name it with a marker — `pressedAfter=<spell> +Ns (refused: <MISS TYPE>;
cooldown spent)` / `(…; cooldown not spent)` / `(refused: <MISS TYPE>)`, the
cooldown clause printed only where the log decides it — plus the new fact
`priorPress=<spell> at <s> (refused: …)` (`syncPriorRefusedPresses`). Spent /
not spent is one exported predicate, `refusedPressCooldownState`
(utils/refusedPress.ts), read by the renderer and by scan5 t29, on the ledger's
own availability (`cdAvailableAt`): not spent = the spell is unavailable at
some press counting every press and available at all of them with this one
dropped, no other refused press does the same, and no not-ready cast failure
of the recorder falls where the spell would then have been available
(conflicting evidence decides nothing); spent = every press available and the
recorder's own not-ready cast failure of the spell (outside any GCD answer)
falls where only this press explains it; otherwise no clause.
`pressRefusalMissRow` returns the refusing miss row (`pressRefusalMissType` its
type), and scan5 t29 reads that row rather than searching for one. The missed-sync glossary
gains the marker and priorPress sentences (the findings header changes in every
file with a missed-sync row). `refusedPressCooldownState`, `refusedPressMarker`,
`REFUSED_PRESS_MARKER_RE`, `syncPriorRefusedPresses`, `pressRefusalMissType` and
`pressRefusalMissRow` are in the predicate-index (en + zh-CN) and pinned. 605 (caps/0e0ca1e0c-605 =
main at v520 vs the branch on it): menu rows 7,399 → 7,401 (+3 / −1) and six
more rows change facts, the R15 bar exactly — three missed-sync rows now read
`pressedAfter=Touch of the Magi +0.6s (refused: IMMUNE; cooldown spent)`, two
added rows carry `priorPress=Touch of the Magi at 64 (refused: IMMUNE; cooldown
spent)`; kill-attempt context lines differing from main 0; context 453 diff
lines in 77 owner files, effect layer only. scan5 t29: refusedPressMarker 0
markers → 5 checked / 0; refusedPressUnmarked 156 / 3 → 153 / 0;
refusedNotSpentReadiness 0 disagreements ("cooldown not spent" markers on 605:
0); pressEffectRefusedListed 28 → 0; resEnemyEffectAfterDeath 14 → 2 (one
distinct, a DoT logged under another spell's name, out of scope);
allyOverlapPastAura 8 → 7; a gate mutation on three copied owner files (miss
type changed, spent → not spent, marker removed) trips all three checks; every
other scan5 check's violation total and the text gates identical (checked
denominators move with the dropped presses, e.g. trinketReadyVsPress 59,116 →
59,117). The capture is of the tree before the batch-review fixes (a refund
contradicted by a not-ready failure prints no clause; the scan reads the
producer's row): the first can only remove a "cooldown not spent" clause, of
which the capture has 0, and the scan re-run on the same capture is identical
on every check. Not changed: the cooldown ledger's readiness still counts a
refused press as spent (GH #158). Batch
verified on tests + codex (user 11-08); 605 / cover / wide run at the end of
the wave.

v522 (2026-11-09, GH #175 rows 1–17; pipeline batch B33b, T18 + T35). The 12.1
class-set bonuses that move a duration or a cooldown are priced, behind one
gate, `setBonusHeld` (classSetBonuses.ts: the unit's spec is the bonus's and its
COMBATANT_INFO lists at least the row's pieces). Durations: Fury 2pc (1296645)
extends a running Recklessness 2 s per landed Raging Blow, up to 6 s — the walk
runs on the caster's own logged aura run (`ownAuraRuns` / `ownAuraRunAt`,
re-broadcasts dropped, a pressed re-APPLIED a new run through
`sourcePressedAuraNear`, shared with `buildAuraIntervals`), also on the
unreadable-talent fallback length; Marksmanship 2pc (1296633) Explosive Shot
+0.5 s; Feral 4pc (1296606) Berserk +5 s. Cooldowns (`SET_BONUS_COOLDOWN_ROWS`,
folded into the flat reduction before percentages): Protection 4pc (1296648)
Ravager −15 s, Augmentation 2pc (1296637) Upheaval −5 s, Shadow 2pc (1296579)
Tentacle Slam −3 s; Devastation 4pc (1296640) adds 0.05 s to each Causality
give-back. Havoc 4pc's Essence Break cooldown row (already priced) now goes
through the same gate (`wearsSetBonus`, spec 577) instead of comparing pieces
itself; no rendered change. The rows with no product reader of their target are
listed with reasons in the classSetBonuses header and stay unpriced. On 605:
Recklessness clean lifetimes equal to the predicate, 2pc holders 5 → 32 of 48
(0–1 pieces 113 → 113 of 187; Enduring Rage's +5 s stays unpriced); Tentacle
Slam re-presses impossible under the model, 2+ pieces 67 → 0 of 134 (0–1 pieces
0 of 815); Explosive Shot lifetimes exact, 2 pieces 0 → 119 of 119 (117 at
4.5 s; 2 at 3.5 s, holders without Precision Detonation). Ravager, Upheaval,
Berserk and Causality have no 605 corpus leg (no holder, or one round) and land
on DB2 + mask / label / charge category alone. Rendered change, a 605 capture
of the batch's code against the capture of v521's tree: menus 0 lines (7,401 →
7,401 rows); 72 context files differ, every changed line one of: 186 `[PRESS] …
Explosive Shot` lines (183 `lasts 4s` → `4.5s`, 3 `3s` → `3.5s`); 9 Devastation
`[PRESS] … back` 1 s earlier (one round, three recorders); one estimated
Recklessness fade 3:16 → 3:22 and one gone past its round's end; 6 `[RES]`
lines in that first round (two per recorder: the `cd:` lower bound of
Recklessness / Avatar 34 → 37 s and 15 → 18 s — Anger Management credits the
cheaper Rampages of the longer Recklessness). New scan5 modules t18
(setExtendedFade, 56 checked / 2 violations → 55 / 0) and t35 (setCooldownBack
12 / 0 on both sides; setFadeWhileUp 0 checked — no Feral 4pc Berserk fade on
605); the other 204 checks' checked and violation counts are identical. Both
modules pair a printed fade with the producer's press and that press's own run
(scan5/producerPress.ts → `ownAuraRunAt`). `buffDurationScan --per-app` reads
clean runs (scripts/lib/auraRuns.ts) and splits by pieces; `cooldownRecastScan
--spells / --no-gear`. An import cycle buffDuration ↔ auraIntervals is broken
by the leaf utils/auraRebroadcast.ts (moved unchanged, re-exported).
`setBonusHeld`, `sourcePressedAuraNear`, `ownAuraRuns` / `ownAuraRunAt` are in
the predicate-index (en + zh-CN) and pinned; the new id tables are in
curatedIdRegistry. (Earlier attempts went into batches B25 and B33, both
abandoned before push.) Batch verified on tests + codex (user 11-08); cover /
wide run at the end of the wave.

v523 (2026-11-10; pipeline batch B35, T46 + T49 + T59; GH #201). Three
fact-layer fixes, no new line type and no new wording.
(1) T46 — an interrupt's school lockout stops a pacify-only spell of its
school. `intervalBlocksSpell` and kick-eaten's post-kick split exempted every
cast DB2 gives no silence bit; by `SpellCategories.PreventionType` on 605
(presses of a locked-school spell in the first half of the lock, went out vs
refused "not ready"): silence bit 7 / 1,371; 2 (pacify alone: Judgment, Blade
of Justice, Hammer of Wrath, Rushing Wind Kick) 0 / 33; 6 (Gladiator's Badge,
Voidblade) 4 / 0; 4 alone 0 / 2 and 0: 7 / 4 (too thin, exemption kept).
`spellMechanicsGenerated.json` gains `pacifyOnly`; one predicate pair
`isSchoolLockExemptCast` / `isSchoolLockableCast` (spellMechanics.ts,
predicate-index en + zh-CN) is read by the lockout branch, the healer lock
intervals and the post-kick fact. On 605, rendered kick-eaten "a spell the lock
does not stop" clauses / presses / files 18 / 43 / 16 → 7 / 7 / 7 (the rest
PreventionType 4, not moved); scan5 t46 `notStoppedNeverOut` 39 checked / 25
violations → 6 / 0. Candidate rows 0 added, 0 removed.
(2) T49 — the burst ledger wrote `(pressed Zs after the burst opened)` for a
wall aura no press put up (a granted copy), while its `[ENEMY DEF]` line says
`[no press logged]`. The ledger reads that producer's own `noPressLogged` and
prints `(Zs after the burst opened [no press logged])`, the existing tag
reused verbatim. scan5 t49 `ledgerPressedNoPress` on the 605 base 25 rows / 21
facts; on the ticket's round 3 → 0; the 605 after-count is left to the
wave-end run. No candidate reads the field.
(3) T59 — one Touch of Karma press puts up two auras off the mitigation table
and the death audit printed the same "active Ns in the final 10s" row twice;
`computeMitigationAudit` applies the burst ledger's one-press twin rule to its
off-table rows. scan5 `auditSplitLabel` kind=duplicate on 605: 9 rows / 3 facts
→ 0 on the 3 archives that hold all of them; findings files identical there.
Correction to v522: "the other 204 checks" should read 210. Batch verified on
tests + codex (user 11-08); 605 / cover / wide run at the end of the wave.

v524 (2026-11-10; pipeline batch B36, T49 follow-up). No rendered change; the
number moves only because a pipeline batch carries one. v523's burst-ledger
no-press reading called `enemyDefensiveEvents` for every enemy once per burst,
which put the ×12 report first-paint check over its budget on CI (frontend-qa
red on v523's commit). `analyzeBurstLedger` now reads those events once, lazily.
20 rounds rendered on v523 and on this commit: 285 owner contexts and their
findings files byte-identical; the ×12 MatchReport render 66.1 s → 31.9 s (same
machine, back to back, single runs under other load).

v525 (2026-11-10; pipeline batch B37, T39). No rendered change. The ×12 report
first-paint ratio on CI stood at 5.397 after v524 (budget 5.2; 4.953 on v522).
Read once instead of per row: `prevRunEndMs` and `nextApplicationMs` are lazy
and indexed (`computeOffensiveWindows` 12.1 → 4.0 s of the profiled render),
press seconds are memoised in `saveAuraIntervals` (7.9 → 3.2 s),
`hasOffensiveSpellActive` resolves its unit-only rows once, and
`getPressureThreshold` reads max HP once. 20 rounds rendered on v524 and on
this commit: 285 owner contexts and their findings files byte-identical. The
×12 render under a CPU profile, same machine back to back: v522 35.2 s, v524
34.7 s, this commit 16.7 s.

v526 (2026-11-11; pipeline batch B38, GH #115 regen #7). The reference tables
went stale across the pipeline wave PV500–522. Regenerated at code 4882aca85
(v522) on the same corpora as regen #6: burstWindowPrior (2,162 leaves, 179
changed, largest rate move 0.030), syncWindowPrior (143,759 → 148,478 windows;
12 leaves changed, 0.002), behaviorPrior (5 of 99 leaves, 0.010),
cdTriggerPrior (27 of 378 leaves), kickPriorityPrior (2 of 4 leaves; 18,153 →
18,162 points) and its heal spells (6 of 24 leaves), backlashDispelPrior (20 of
46 leaves, 0.020; 94,485 → 94,431 opportunities), cdRecastFloor (18 → 17
floors: Predator's Wake's 0.413 floor goes, Soul Immolation 0.659 → 0.613),
the reference vectors (414 of 90,934 leaves), and — date stamps only —
kickLockoutObserved, healerSaveCd and dispelObserved. The hand-pinned
CD_HOARDED_OUTCOME_REF re-measures to the same 5.3 / 13.8 / 16,061 and is not
touched. On 605 (both captures at 4882aca85, 3,519 owner files): the five
reference-consistency gates the stale tables tripped fall to 0 (backlash 305,
burstWindow 102, cdPrior 40, kickPriority 198, syncWindow 687); CjkLeak 12 and
FindingsCountFollowsMenu 3,519 unchanged. Menu rows 7,401 → 7,401, 0 ids added,
0 removed; 738 menu files and 228 context files differ, in reference numbers
and cooldown ranges only (`[RES]` / `<cooldowns>` rows of Predator's Wake and
Soul Immolation, `[CD PRIOR]`); captureFamilyDiff flags 0 families (body lines
1,755,250 → 1,755,253). Not in these tables: the commits after 4882aca85 (v523
T46's school-lock reading feeds the kick tables and the recast floors; v523
T49 / T59 and v524–525 read none of them).

v527 (2026-11-11; pipeline batch B39, T72 + T47; user ruling R19). (1) T72 — five 45 s damage
buttons with no use condition are major offensive cooldowns: Reaper's Mark
439843, Odyn's Fury 385059, Meteor 153561, Goremaw's Bite 426591, Mindgames
375901 — roster Offensive rows, out of `OFFENSIVE_PRESS_FACT_IDS`, so members
of `OFFENSIVE_CD_SPELL_IDS` (75 → 80); these five only. Window lengths:
Reaper's Mark / Goremaw's Bite / Odyn's Fury run on their effect auras (12 /
14 / 4 s; an application the log never closes keeps the official length, read
on player wearers, never the next application's end), Mindgames on its own
7 s, Meteor has no effect aura and takes the instant member's existing forms
(8 s in `[RES] enemy:`, a zero-length burst-ledger span, as Soul Fire). No new
line type or wording. Example: a kill-window line `team offensive CDs ready at
2:36: none (… pressed inside: Avatar 2:45、Recklessness 2:45)` now reads `ready
at 2:36: Odyn's Fury (… pressed inside: Avatar 2:45、Recklessness 2:45、Odyn's
Fury 2:46)`. On 605 (branch capture against the capture of v522's tree): scan5
t72 `ruledOffensivePress` 890 of 890 presses → 0 (Meteor 306, Goremaw's Bite
296, Odyn's Fury 166, Reaper's Mark 117, Mindgames 5);
`killWindowRuledPressUnnamed` 260 of 260 → 0. Candidate rows 7,401 → 7,430:
missed-sync-window 687 → 709 (+46 −24; of the 24, 19 gained an entering press
or effect and 5 were displaced by the candidate cap), kick-eaten 1,855 → 1,857
(+5 −3), position-mistake 154 → 158 (+6 −2), slow-defensive-response 109 → 110
(+1). 821 context and 142 menu files differ. Known and left: Mindgames is 4
Discipline presses of its 5 on 605 — the team-ready list leaves a healer's
out, the enemy side shows it as an offensive cooldown (R19 rules the button in
without a spec split); `pressInsideLockNotEntered` reads 3 facts at the scan's
own −2 s / +1 s edges. The burst-window and sync-window reference tables were
generated with the five outside the offensive set (GH #115). The capture
predates v526's tables. (2) T47 — a cast bar the unit's next bar replaced with no row of its
spell in between is a cancel. A stop-casting restart writes no `Interrupted`
SPELL_CAST_FAILED row, so `castBarOutcomesOf` read the bar `none` and the
cancel ledger never saw it; `none` gains `superseded` (an instant START
supersedes nothing; a failure row in the START's own millisecond, or another
player's death inside the stretch, keeps the old reading), counted as an
unlogged cancel only when the round has a completed bar of the same spell
(`castCancels.isUnloggedCancelInRound`). Readers: kick-eaten `yourCancels` /
`yourCancelMedianPct` / `baitedKicks` / `baitedThisKickerT` /
`stoppedJustBefore`, and the desktop cast-control view (an unlogged cancel is
placed at its bar's start). No line type or wording added. On the audited
round: three kick-eaten rows `yourCancels=0, baitedKicks=0` → `yourCancels=4,
baitedKicks=2`. On 605: scan5 t47 `unloggedStopNotCancel` 37 of 37 → 0;
`jukedNotBaited` 5 of 258 → 1; 44 kick-eaten rows in 18 files change facts
(`yourCancels` +48 summed, `baitedKicks` in 4); candidate ids 0 added, 0
removed; 0 of 3,519 context files differ. Batch verified on tests + codex (user 11-08); 605 /
cover / wide run at the end of the wave.

v528 (2026-11-12; pipeline batch B40, T38 + T52). (1) T38 (GH #206) —
`canReachTargetAt` reads raw line-of-sight samples for the unit standing at
`from` ([ROOT], kill-window and summon reach, the burst-window delivery gate),
and the [HEALER EXPOSURE] sweep and its gate share one exported function,
`rawLosSweepInSight`. 605: exposure claims contradicting the raw sweep 26 /
11,862 -> 0; 26 [HEALER EXPOSURE], 14 [ROOT] and 5 [ENEMY SUMMON] lines
change; candidate rows 0. (2) T52 — a `missed` kick with a miss row whose
target had a bar running at the refusal prints the miss tag alone
(`— [IMMUNE: N]`) instead of "hit nothing", in the [KICK] line and the
burst-ledger Kicks: row. 605: 53 / 108 tagged kick lines -> 0; candidate rows 0. The burst-window reference table is formally stale with the delivery gate
(GH #115).

v529 (2026-11-13; pipeline batch B41, T64 + T69 + T68). (1) T64 — an
immunity pressed in the miss row's own millisecond (the IMMUNE row first, the
aura's APPLIED and the press after it) is the miss's cause; one exported test
shared with scan2's immuneCause check. 605: immuneCauseUnnamed 3 / 148 -> 0 /
145; 3 of 30,448 immunity / avoidance lines gain `(Ice Block was up)`;
candidate rows 0. (2) T69 (GH #134) — an aura on the kick victim changes the
lockout: DB2 aura 232 (mechanic duration, misc 26) with its PvpMultiplier —
Concentration Aura x0.799, Oppressing Roar x1.3 — applied inside
kickLockoutSecondsFor, and one lock end for the kick-eaten text and the
pressure window. 605 raw pairs: Concentration Aura holders casting before the
modelled end 23 / 43 -> 8 / 43, Oppressing Roar still refused after it 1 / 7
-> 0 / 7; 39 [CONSEQ] lines, 15 [RES] lines, 6 kick-eaten rows and 3
death-setup rows change their lockout length; candidate rows added 0, removed 0. Open FLAG kept in the table's comment: two pairs of one Warlock fit x0.7
(the row without its PvP multiplier). (3) T68 (GH #132) — the disarm DR
family comes from DB2 (DiminishType 128): Faerie Swarm and Sticky Tar Bomb
join Disarm / Dismantle / Grapple Weapon and the hand list is deleted; the
sync-window scan, its calibration copy and the candidate share one round-end
cut. 605: 3 press lines gain `DR: Disarm Immune`, [CC BOOKMARK] +9 lines / -2
displaced; candidate rows 0. The sync-window reference table is formally
stale with the round-end cut (GH #115).

v530 (2026-11-13; pipeline batch B42, T48 + T36 + T79). (1) T48 (GH #123.10)
— talents that shorten an effect reach the duration model:
BUFF_DURATION_TALENT_MODIFIERS gains Gift of the Celestials -> Chi-Ji /
Yu'lon -13 s, Frost Conditioning -> Hypothermia -10 s, Circle of Life and
Death -> Rake / Thrash / Feral Frenzy / Moonfire -20 % and Rejuvenation
-15 %, Veinripper -> Rake +25 %, Chi Wave -> Path of Resurgence -50 %,
Hatefury Rituals -> Wither -15 % and Absolute Corruption -> Wither 24 s
against players. 605: scan5 shortenedDuration 444 rows -> 169 (Virulent
Plague 149 and Dread Plague 14 stay flagged: DB2's -25 % is not unconditional
on the corpus); 93 context files differ — 66 kit lines `lasts 25s` -> `lasts
12s`, 35 `[RES] enemy:` Feral Frenzy windows 1-2 s shorter, 12 [RES] lines
`Ice Block(Hypothermia Ns)` 10 s shorter; candidate rows 0. (2) T36 (GH #203)
— eval only: five scan checks consume the producer's predicate
(castDamageIdSplit 46 -> 22 rows, wardReturnMisnamed 3 -> 0,
pressedInsideNeverBack 961 -> 125). (3) T79 — dead code removed
(extractShapeshiftIntervals and the NOTABLE STATES plumbing, the two retired
mana candidates, TIMELINE_LINE_FLAGS' non-default positions) and
PRESS_TRIGGERED_CAST_IDS generated from DB2; 0 of 285 owner contexts and 0 of
285 findings prompts differ on the 20 audited rounds.

v531 (2026-11-13; pipeline batch B43, T87 + T80 + T81). (1) T87 (ruling R26)
— Song of Chi-Ji "can reach" is 15 yd, not the cast's 40: one ruled table
(CC_THREAT_REACH_RULED_YD, registered in curatedIdRegistry) read first by
ccThreatReachYards, so the CC sampler, healer-offense, the healer-exposure
radius and the eval scans move together; kick readers keep DB2's 40. On the
72 Mistweaver archives of the 605 manifest (414 contexts): [HEALER EXPOSURE]
lines naming Song 163 -> 87, ENEMY CC KIT lines naming it 117 -> 105,
[CONTESTED] 3 -> 1; candidate rows 0. (2) T80 — desktop only: whole-match
derive results are kept by source identity across mounts and offscreen match
rows skip layout; returning to the matches page with a large match open 1441
ms -> 124 ms on a 1,100-match library. (3) T81 (GH #145) — performance only:
whole-round readings are computed once per round and shared by every asker,
and the CPU-calibrated first-paint gate is locked at 3.9; AI view first entry
on a large 3v3 match 2152 ms -> 749 ms; 0 of 285 owner contexts and 0 of 285
findings prompts differ on the 20 audited rounds.

v532 (2026-11-13; pipeline batch B44, T43 + T44 + T37 + T42 + T60 + T78 +
T58). 605 "before" counts are on the 4882aca85 base capture; where the
"after" was measured on the repro only, the corpus number comes from the
wave-end 605 run. (1) T43 — `[BURST WINDOW] … answered with X … in N s` is
timed from the cast that produced the landed control, read up to
AIMED_CONTROL_LANDING_LEAD_MS past its aura (a real line printed `in 3.7s`
for a Rake cast 3.891 s after the opener). 605 before: 8 rows / 25 lines;
repro 3 -> 0. (2) T44 — a STAYED IN span's root seconds read rootIntervalsOf
(ROOT_SPELL_IDS), so a Charge or Shambling Rush root gains its `rooted`
clause and the candidate row its rootS. 605 before: 43 / 169; repro 1 -> 0.
(3) T37 — rows of one name within CAST_MISS_LEAD_MS are one press whatever
their miss types (Holy Word: Chastise logs IMMUNE and MISS 1 ms apart):
ENEMY CC KIT `aimed at them 2x` -> `1x`. 605 before: 3 rows / 823; repro
3 -> 0. (4) T42 — a burst-anchored KILL ATTEMPTS line is named for a press
whose cast row names a teammate (Power Infusion, PvP Bloodlust / Heroism)
when it opened the bracket. 605 before: 285 rows / 103 facts / 7963 lines;
repro 6 -> 0. (5) T60 (GH #202 item 1) — the death mitigation audit takes
the Power Word: Shield family from OWN_SHIELD_RULING_FAMILY_IDS: 520 rows /
186 deaths of 725 with such a shield and no audit row -> 0; 544 audit rows
gained. (6) T78 — a player logged under a bare and a realm name form
carries the realm form on the unit and every converted row (3 of 7,040
player-rounds; 93 lines replaced one for one); candidate rows 0. (7) T58 —
scan only: resEnemyEffectAfterDeath 2 rows -> 0.
