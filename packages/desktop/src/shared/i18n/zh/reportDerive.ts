import type { MessageParams } from "../index";

// Baseline (zh) dictionary for the report's derive layer (`report.*` keys
// produced by src/renderer/src/report/derive/*). Text moved verbatim from the
// derive files; keys are grouped by the card / derive that renders them.
export const zhReportDerive = {
  // ── ExportReportPage.tsx (off-screen image export page) ──
  "report.exportPage.notFound": "对局 {matchId} 不存在",
  "report.exportPage.noRounds": "shuffle 无回合数据",
  "report.exportPage.loading": "加载中…",

  // ── findingDisplay.ts (glossary: severity / category / finding type) ──
  "report.severity.high": "高",
  "report.severity.med": "中",
  "report.severity.low": "低",
  "report.category.survival": "生存",
  "report.category.cooldowns": "冷却使用",
  "report.category.positioning": "站位",
  "report.category.target-selection": "目标选择",
  "report.category.cc": "控制",
  "report.category.interrupts": "打断",
  "report.category.dispels": "驱散",
  "report.category.offense": "进攻",
  "report.findingType.death": "死亡",
  "report.findingType.death-setup": "死亡铺垫",
  "report.findingType.cd-waste": "整场未用",
  "report.findingType.missed-cleanse": "漏解",
  "report.findingType.missed-purge": "漏偷",
  "report.findingType.kick-eaten": "施法被断",
  "report.findingType.burst-into-mitigation": "打进大减伤",
  "report.findingType.external-unused": "外减可用未给",
  "report.findingType.healing-gap": "治疗空窗",
  "report.findingType.position-mistake": "走位失误",
  "report.findingType.cc-held": "压手未放",
  "report.findingType.cc-avoidable": "规避手段可用未用",
  "report.findingType.slow-defensive-response": "敌方开大应对迟缓",
  "report.findingType.crisis-no-response": "危机无应对",
  "report.findingType.teammate-crisis-idle": "队友危机未出手",
  "report.findingType.teammate-crisis-triage": "队友危机救错人",
  "report.findingType.backlash-dispel": "解反噬 DoT",
  "report.findingType.backlash-dispel-window": "可解未解",
  "report.findingType.kick-priority-missed": "该踢没踢",
  "report.findingType.kick-priority-team": "队友能踢",

  // ── kickText.ts (glossary: kick outcomes) ──
  "report.kick.missed": "落空",
  "report.kick.immune": "目标免疫打断",
  "report.kick.reflected": "被目标反射",

  // ── aiRunStatus.ts ──
  "report.aiRun.cliWaitHint": "CLI 后端整段返回、无中途进度,通常需要一到几分钟",

  // ── cohortDims.ts ──
  "report.cohort.percentile": "第 {n} 百分位",
  "report.cohort.aboveMedian": "高于本分档中位",
  "report.cohort.belowMedian": "低于本分档中位",
  "report.cohort.atMedian": "处于本分档中位",

  // ── zeroFindingText.ts ──
  "report.zeroFinding.dropped": (p: MessageParams) =>
    `模型输出了 ${p.n} 条,但全部未通过审计(裸数字/编造事件/因果断言)被丢弃 —— 可点「重新分析」再试。`,
  "report.zeroFinding.noCandidates":
    "本场无可指摘事件(无人阵亡、资源使用无明显问题)—— 这是好事,不硬编教练意见。",
  "report.zeroFinding.noClient":
    "未配置 AI(设置里填 API key 或本地 CLI 后端),仅展示确定性事件。",
  "report.zeroFinding.badJson":
    "模型返回格式异常,已回退为确定性展示 —— 可点「重新分析」再试。",
  "report.zeroFinding.emptyReply":
    "分析已完成:模型看过本场的候选事件,没有哪一件值得写成教练意见 —— 时间线与各项统计照常可看。",
  "report.zeroFinding.stale": "未生成解说(旧版本缓存),点「重新分析」重新生成。",

  // ── selfReviewNote.ts ──
  "report.selfReview.failed": "未自查 · AI 自查没有成功,显示的是原始结果",
  "report.selfReview.noChanges": "已 AI 自查 · 没有改动",
  "report.selfReview.reviewed": "已 AI 自查",
  "report.selfReview.changed": (p: MessageParams) => `${p.n} 条结论有改动`,
  "report.selfReview.dropped": (p: MessageParams) => `删去 ${p.n} 条`,

  // ── teamSide.ts ──
  "report.teamSide.friendly": "我方",
  "report.teamSide.enemy": "敌方",
  "report.teamSide.unknown": "未知",

  // ── flowSeries.ts (curve metric dropdown) ──
  "report.curveMetric.hp": "血量",
  "report.curveMetric.damage": "伤害",
  "report.curveMetric.healing": "治疗",
  "report.curveMetric.taken": "承伤",
  "report.curveMetric.healed": "被治疗",

  // ── eventsView.ts ──
  "report.eventKind.damage": "伤害",
  "report.eventKind.heal": "治疗",
  "report.eventKind.cast": "施放",
  "report.eventKind.aura": "光环",
  "report.eventKind.dispel": "驱散",
  "report.eventKind.interrupt": "打断",
  "report.eventKind.death": "死亡",
  "report.events.auraGained": "+获得",
  "report.events.petOf": "{owner} 的宠物",
  "report.events.auraLost": "−失去",
  "report.events.dispelled": "驱掉 {spell}",
  "report.events.interrupted": "打断 {spell}",
  "report.events.died": "死亡",

  // ── shared spell fallbacks (ccBreakDash.ts / detailBreakdown.ts) ──
  "report.spell.melee": "近战",
  "report.spell.absorb": "吸收",

  // ── pressureLanes.ts (healer-exposure hover text) ──
  "report.pressure.trinketAvailable": "饰品在手",
  "report.pressure.trinketPassive": "被动饰品",
  "report.pressure.trinketOnCd": "饰品转 CD",
  "report.pressure.losCover": ";LoS 掩体 ~{yd} 码",
  "report.pressure.exposureTitle":
    "治疗暴露({label})· {n} 威胁在 LoS · {trinket}{los}",

  // ── ccBreakDash.ts ──
  "report.ccBreak.remaining": "(剩 {s}s)",
  "report.ccBreak.friendly":
    "{breaker} 的 {breakSpell} 打破了 {caster} 给 {holder} 上的 {ccSpell}{remain}",
  "report.ccBreak.enemy":
    "敌方 {breaker} 的 {breakSpell} 提前打破了 {holder} 身上的 {ccSpell}{remain}",

  // ── deathRecap.ts (dispel rows of the recap) ──
  "report.deathRecap.selfDispel": "{removed}(自解)",
  "report.deathRecap.stolenFromVictim": "{removed}(被偷走)",
  "report.deathRecap.dispelledOffVictim": "{removed}(被驱散)",
  "report.deathRecap.victimStole": "{removed}(偷走 {target})",
  "report.deathRecap.victimDispelled": "{removed}(驱散 {target})",

  // ── statsTable.ts ──
  "report.stats.kickTaken": "{kick} 打断 {spell}({source})",

  // ── uncoveredHighlights.ts ──
  "report.uncovered.kindCount": "{n} 次{label}",

  // ── dispelDash.ts ──
  "report.dispel.blockedSeconds": " {s} 秒",
  "report.dispel.noReach": "(无视线/超射程)",
  "report.dispel.noReachUntil": "({t} 前无视线/超射程)",
  "report.dispel.scopedMissed":
    "{spell} 挂在 {enemy} 身上 {s}s 未被打掉 · 可用 {tool}({holder}){locked}{reach}{cd}{notActionable}",
  "report.dispel.holderLocked": "(持有者被控/被锁{blocked})",
  "report.dispel.toolOnCdThroughout": "(技能全程在 CD)",
  "report.dispel.notActionable": " · 当时做不到",
  "report.dispel.instance":
    "{dispelSpell} {verb} {removed}({target}){fatal}{passive}",
  "report.dispel.verbSteal": "偷走",
  "report.dispel.verbDispel": "驱散",
  "report.dispel.fatal": " ☠致命",
  "report.dispel.passive": "(被动)",
  "report.dispel.missedPurge":
    "{spell} 挂在 {enemy} 身上 {s}s 未被驱散{killWindow}{cd}{locked}{reach}",
  "report.dispel.inKillWindow": "(我方击杀窗口内)",
  "report.dispel.purgeOnCd": "(驱散在 CD)",
  "report.dispel.dispellersLocked": "(驱散者被控/被锁{blocked})",
  "report.dispel.missedCleanse":
    "{target} 挂 {spell} {s}s 未被解{cd}{locked}{reach}{dr}",
  "report.dispel.cleanseOnCd": "(解法在 CD)",
  "report.dispel.drChainRisk": "(对方 DR 未递减,解了易被续控)",

  // ── keyMoments.ts (key-moment axis) ──
  "report.keyMoment.died": "阵亡",
  "report.keyMoment.kill": "击杀",
  "report.keyMoment.burstConverted": "爆发(已转化)",
  "report.keyMoment.burstUnconverted": "爆发(未转化)",
  "report.keyMoment.enemyBurst": "敌方爆发",
  "report.keyMoment.panicUse": "恐慌性使用",
  "report.keyMoment.trinket": "交饰品",
  "report.keyMoment.dispelled": "解掉 {spell}",
  "report.keyMoment.ccTaken": "被控:{spell}",
  "report.keyMoment.trinketedOut": " · 交饰品解",
  "report.keyMoment.ccLanded": "控制成功:{spell}",
  "report.keyMoment.healGap": "治疗空窗 {s}s",
  "report.keyMoment.healGapDetail": "{spec}({name})承受 {k}k",
  "report.keyMoment.stayedIn": "顶着爆发硬扛",
  "report.keyMoment.missedPush": "该压没压",
  "report.keyMoment.outOfRange": "CD 距离外",
  "report.keyMoment.stayedInDetail": "{from}→{to}yd 贴 {enemy}{danger}{hp}",
  "report.keyMoment.danger": " · {label}爆发",
  "report.keyMoment.missedPushDetail": ">{yd}yd 脱节",
  "report.keyMoment.outOfRangeDetail": "{spell} · {yd}yd 外",

  // ── exportReport.ts (Markdown export) ──
  "report.export.title": "# gladlog 战报 — {bracket} · {result}",
  "report.export.window": " · 窗口 {from}–{to}({s}s)",
  "report.export.outputHeading": "## 输出/治疗",
  "report.export.outputHeader": "| 玩家 | 伤害 | 治疗 | 承伤 | 死亡 |",
  "report.export.statsHeading": "## 统计",
  "report.export.statsHeader":
    "| 玩家 | 打断施放 | 被打断 | 被控秒 | 驱散 | purge |",
  "report.export.kicksHeading": "## 打断",
  "report.export.kicksHeader":
    "| 玩家 | 施放 | 打断 | 沉默生效 | 被骗 | 落空 |",
  "report.export.refused": "(含 {n} 次被免疫/反射)",
  "report.export.mistakesHeading": "## 失误清单({n} 条,确定性规则直出)",
  "report.export.wholeRound": "全场",

  // ── mistakes.ts: rule labels (one per MISTAKE_RULES row) ──
  "report.mistakes.rule.burst-into-mitigation": "爆发打进大减伤",
  "report.mistakes.rule.cd-waste": "保命 CD 整场未用",
  "report.mistakes.rule.missed-kick": "打断空放",
  "report.mistakes.rule.missed-purge-kill-window": "击杀窗口内漏 purge",
  "report.mistakes.rule.crisis-no-response": "危机 3 秒无应对",
  "report.mistakes.rule.backlash-dispel": "解反噬 DoT 得不偿失",
  "report.mistakes.rule.backlash-dispel-window": "可解的反噬 DoT 没解",
  "report.mistakes.rule.kick-priority-missed": "该踢的治疗没踢",
  "report.mistakes.rule.kick-priority-team": "队友能踢的治疗没人踢",
  "report.mistakes.rule.external-unused": "队友阵亡时外减可用未给",
  "report.mistakes.rule.questionable-external": "无压力窗口交出外减",
  "report.mistakes.rule.healing-gap": "治疗空窗",
  "report.mistakes.rule.position-mistake": "走位失误",
  "report.mistakes.rule.cc-avoidable": "规避手段可用未用",
  "report.mistakes.rule.slow-defensive-response": "敌方开大应对迟缓",
  "report.mistakes.rule.missed-sync-window": "锁死未起爆",
  "report.mistakes.rule.cd-hoarded": "大 CD 囤积过久",

  // ── mistakes.ts: sentence frames. The {…} values are the analysis layer's
  // facts, embedded as-is (spec §6.14). ──
  "report.mistakes.listSep": "、",
  "report.mistakes.syncYours": "{spell}(你的)",
  "report.mistakes.syncHolder": "{spell}({holder} 的)",
  "report.mistakes.healCasts": ",{n} 次施法合计",
  "report.mistakes.burstIntoMitigation":
    "{spell} 打进 {target} 的 {mitSpell}({mit}),当时 {betterTarget} 是更软的目标",
  "report.mistakes.mitDefers": "延后 {amount} 伤害",
  "report.mistakes.mitPct": "减伤 {pct}%",
  "report.mistakes.cdWaste": "{spell} 整场未按",
  "report.mistakes.crisisOutcomeTeam":
    "此状态下无应对者 {noResp}% 十五秒内我方有人阵亡,有应对者 {resp}%",
  "report.mistakes.crisisOutcomeOwn":
    "此状态下无应对者 {noResp}% 十秒内死亡,有应对者 {resp}%",
  "report.mistakes.crisisNoResponse":
    "血量 {hpPct}% 后 3 秒无应对({outcome},出手者常见应对:{refTop})",
  "report.mistakes.externalUnused": "{victim} 阵亡时 {external} 可用",
  "report.mistakes.questionableExternal":
    "{spell} 给 {target}({targetHp}% HP,距最近爆发窗 {gap}s)",
  "report.mistakes.slowDefensiveResponse":
    "{leadCd}{extras} 开启后 8 秒内全队无应对,{pressured} 被打到 {hpPct}%{died}",
  "report.mistakes.extras": "(+{extras})",
  "report.mistakes.diedInWindow": "、窗口内阵亡",
  "report.mistakes.missedSyncWindow":
    "{healer} 被 {cc} 控 {durationS}s,{readyCds} 均 ready 未按",
  "report.mistakes.cdHoarded":
    "{crisisUnit} 在 {t}s 掉到 {hpPct}%{own}时,{readyCds} 均可用却 5 秒内未按",
  "report.mistakes.ownSelf": "(自己)",
  "report.mistakes.backlashDispel":
    "{t}s 给 {targetHpPct}% 血的 {target} 解掉 {debuff}{stacks},自己吃 {backlash},4 秒内承伤 {selfDmgTrend}、治疗 {healTrend}{cdCc}",
  "report.mistakes.backlashCdCc":
    ";驱散 CD 里 {target} 吃了 {durationS}s {spell} 无人能解",
  "report.mistakes.kickPriorityMissed":
    "{t}s {healer} 读 {castS}s {heal} 奶 {targetHpPct}% 血的击杀目标 {target}(+{healK}k{healCasts}),你的 {kick} 空着、{reach},没踢{others}",
  "report.mistakes.reachPet": "{kicker} {yd} 码内",
  "report.mistakes.reachMelee":
    "距离 {yd} 码(近战踢 {range} 码,读条期间跑得到)",
  "report.mistakes.reachInRange": "{yd} 码内",
  "report.mistakes.othersFeasible": ";{others} 也能踢",
  "report.mistakes.kickPriorityTeam":
    "{t}s {healer} 读 {castS}s {heal} 奶 {targetHpPct}% 血的击杀目标 {target}(+{healK}k{healCasts}),你踢不了({ownerWhy}),{teammates} 能踢,没人踢",
  "report.mistakes.backlashWindowImmune":
    "{t}s {target}({targetHpPct}%)身上的 {debuff} 可解:你当时有 {immuneBuff},反噬控制无效",
  "report.mistakes.backlashWindowWorth":
    "{t}s {target}({targetHpPct}%,{dots} 个 DoT)身上的 {debuff} 值得解,之后 15 秒又吃了 {k}k",
  "report.mistakes.kickRefused": "{kick} 打在 {castSpell} 读条上",
  "report.mistakes.kickMissed": "{kick} 空放",
  "report.mistakes.purgeMissed": "{spell} 挂在 {enemy} 身上 {s}s 未被驱散",
};
