// Baseline (zh) dictionary for the match report's components
// (src/renderer/src/report/components/*), `report.<card>.*` keys. Text moved
// verbatim from the components.
export const zhReportCards = {
  // ── shared across report cards ──
  "report.common.replayHere": "回放此刻",
  "report.common.all": "全部",
  "report.common.clear": "清除",
  "report.common.retry": "重试",
  "report.common.wholeMatch": "全场",
  "report.common.player": "玩家",
  "report.common.target": "目标",
  "report.common.spell": "技能",
  "report.common.close": "关闭",
  "report.common.kill": "击杀",
  "report.common.analyzing": "分析中…",
  "report.common.passiveDispelTitle": "被动触发 / 位移附带的驱散,不计入决策",
  "report.common.burstWindow": "击杀尝试",
  "report.common.vulnWindow": "脆弱",
  "report.common.thisMatchNoRecords": "本场无记录。",
  "report.common.thisRoundNoRecords": "本轮无记录。",
  "report.common.listSep": "、",

  // ── AuraUptimeCard.tsx ──
  "report.aura.title": "光环 uptime",
  "report.aura.windowBasis": "占比按窗口 {s}s 口径",
  "report.aura.kind.offense": "进攻",
  "report.aura.kind.defense": "防御",
  "report.aura.kind.cc": "控制",
  "report.aura.inferredStart": "(开局前已挂,推断)",
  "report.aura.inferredEnd": "(未见掉落,推断至场终)",
  "report.aura.hasInferred": "含推断段(虚线)",
  "report.aura.moreRows": "+{n} 更低占比光环",

  // ── BreakdownTable.tsx ──
  "report.breakdown.empty": "无数据",
  "report.breakdown.col.spell": "技能",
  "report.breakdown.col.total": "总量",
  "report.breakdown.col.share": "占比",
  "report.breakdown.col.hits": "次数",
  "report.breakdown.col.crit": "暴击",
  "report.breakdown.col.overheal": "过量",
  "report.breakdown.col.maxHit": "最大一击",
  "report.breakdown.absorb": "吸收",
  "report.breakdown.rest": "其余 {n} 个(合计)",

  // ── CCChainPanel.tsx ──
  "report.ccChain.title": "敌方 CC 链",
  "report.ccChain.empty":
    "本场未对敌方造成过控制链 —— 长局中此处显示每个敌方目标的控制链长度/ 总时长与 DR 降级情况。",
  "report.ccChain.col.chainLen": "链长",
  "report.ccChain.col.totalCc": "总控时长",
  "report.ccChain.wasted": "浪费",

  // ── CohortDimsTable.tsx ──
  "report.cohortTable.overall": "综合评分",
  "report.cohortTable.bestWorst":
    " · 最强:{best}({bestScore})· 最弱:{worst}({worstScore})",
  "report.cohortTable.scoreTitle":
    "评分 {score}(方向修正)· p10 {p10} · p50 {p50} · p90 {p90}",
  "report.cohortTable.measured": "实测 {value}",

  // ── kick outcomes (BurstLedgerCard.tsx / KickDashboard.tsx) ──
  "report.kicks.landed": "打断 {spell}",
  "report.kicks.jukedChannel": "被骗掉({spell} 引导刚停)",
  "report.kicks.jukedFake": "被假读条骗掉({spell})",
  "report.kicks.silencedOpen": "沉默生效({spell} 读条未完成)",
  "report.kicks.silenced": "沉默生效(未打断读条)",
  "report.kicks.unknown": "旧档无读条数据",

  // ── BurstLedgerCard.tsx ──
  "report.burstLedger.title": "爆发账本",
  "report.burstLedger.noData": "本场无爆发窗口数据。",
  "report.burstLedger.alignment": "爆发对齐",
  "report.burstLedger.noDamage": "未打出伤害",
  "report.burstLedger.intoImmunity": "打进免疫 {spell} {s}s",
  "report.burstLedger.intoWall": "对方减伤 {spell} {s}s",
  "report.burstLedger.synced": "协同 {names}",
  "report.burstLedger.solo": "单开",
  "report.burstLedger.noBursts": "本场无爆发窗口记录。",
  "report.burstLedger.noTargeting": "本场无窗口目标纪律记录。",
  "report.burstLedger.targeting": "窗口目标纪律",
  "report.burstLedger.windowTarget": "窗口目标 {name}",
  "report.burstLedger.onTarget": "命中 {pct}%",
  "report.burstLedger.topOffTarget": "最大分流 {name}({dmg})",
  "report.burstLedger.betterTarget": "该打 {name}({spec})",
  "report.burstLedger.noKicks": "本场无打断记录。",
  "report.burstLedger.kickAudit": "打断审计",

  // ── KickDashboard.tsx ──
  "report.kickDash.title": "打断面板",
  "report.kickDash.empty":
    "本场双方 0 次打断施放 —— 长局中此处显示两队打断命中/被骗/落空审计。",
  "report.kickDash.col.casts": "施放",
  "report.kickDash.col.landed": "打断",
  "report.kickDash.col.juked": "被骗",
  "report.kickDash.col.missed": "落空",
  "report.kickDash.col.rate": "命中率",
  "report.kickDash.silencedN": "({n} 沉默生效)",
  "report.kickDash.refusedN": "(落空含 {n} 次被免疫/反射)",
  "report.kickDash.unknownN": "({n} 未知)",
  "report.castControl.line":
    " 读条 {hardcasts} 次 · 自己停手 {cancels} 次{median} · 被打断 {kicked} 次 · 骗掉对方打断 {baited} 次",
  "report.castControl.median": "(中位读到 {pct}%)",
  "report.castControl.expand": "展开被骗掉的打断",
  "report.castControl.baited": " 的 {kick} 被你停手的 {bait} 骗掉",

  // ── DeathRecapCard.tsx ──
  "report.deathCard.kind.dmg": "伤害",
  "report.deathCard.kind.heal": "治疗",
  "report.deathCard.kind.cc": "控制",
  "report.deathCard.kind.def_used": "防御",
  "report.deathCard.kind.dispel": "驱散",
  "report.deathCard.school.physical": "物理",
  "report.deathCard.school.magic": "魔法",
  "report.deathCard.school.holy": "神圣",
  "report.deathCard.school.fire": "火焰",
  "report.deathCard.school.nature": "自然",
  "report.deathCard.school.frost": "冰霜",
  "report.deathCard.school.shadow": "暗影",
  "report.deathCard.school.arcane": "奥术",
  "report.deathCard.schoolName": "{spell}({schools}伤害)",
  "report.deathCard.mit.arith": "{name} 挡了 ~{k}k{pct},覆盖 {s}s",
  "report.deathCard.mit.pctMaxHp": "(≈{pct}% maxHp)",
  "report.deathCard.mit.deferred":
    "{name} 暂时挡下 ~{k}k{pct},覆盖 {s}s(之后以自身伤害落地)",
  "report.deathCard.mit.immunity": "{name} 免疫覆盖 {s}s(期内观测承伤 ~{k}k)",
  "report.deathCard.mit.deflection":
    "{name} 偏转直接攻击 {s}s(持续伤害照常落地;期内观测承伤 ~{k}k)",
  "report.deathCard.mit.absorb": "{name} 吸收 ~{k}k{pct},覆盖 {s}s",
  "report.deathCard.mit.other": "{name} 激活 {s}s,机制特殊,不参与缺口算术",
  "report.deathCard.cf.subject": "{caster} 的 {spell}",
  "report.deathCard.cf.line":
    "若{subject}覆盖此窗,该段伤害约降至致死线下(余量 >{margin}% 最大血量)——算术口径,单因素",
  "report.deathCard.panicTitle": "恐慌性使用:未见明显敌方威胁/目标未受压下按下",
  "report.deathCard.panic": "⚠恐慌",
  "report.deathCard.ticks": " ×{ticks} 跳/{s}s",
  "report.deathCard.foldExpand": "展开被折叠的小额事件",
  "report.deathCard.foldCollapse": "收起被折叠的小额事件",
  "report.deathCard.foldLabel":
    "已折叠 {n} 行小额事件(合计 {dmg} 伤害 / {heal} 治疗)",
  "report.deathCard.empty": "死前 {s}s 无记录事件。",
  "report.deathCard.titleEnemy": "终结回顾",
  "report.deathCard.title": "死亡回顾",
  "report.deathCard.showAllTitle": "逐跳原始事件流(不过滤不合并)",
  "report.deathCard.showAll": "显示全部",
  "report.deathCard.replayHere": "▶ 回放此刻",
  "report.deathCard.unpressed": "死亡时可用而未按:",
  "report.deathCard.wasInCc": "(当时被控)",
  "report.deathCard.cheaper": " · 更省替代:{list}",
  "report.deathCard.missedExternals": "队友可给未给:",
  "report.deathCard.casterSpell": "{caster}:{spell}",
  "report.deathCard.casterCc": "(被控)",
  "report.deathCard.casterOom": "(蓝不够)",
  "report.deathCard.mitTitle":
    "减伤核算(死亡窗内已激活,逐条独立口径,不建模叠加):",
  "report.deathCard.timelineAria": "死前事件时间线(可滚动)",

  // ── DispelDashboard.tsx ──
  "report.dispelCard.title": "驱散面板",
  "report.dispelCard.empty": "本场无驱散/偷取事件。",
  "report.dispelCard.col.cleanses": "解队友",
  "report.dispelCard.col.steals": "偷",
  "report.dispelCard.col.passive": "被动",
  "report.dispelCard.missedPurges": "漏掉的 purge 机会({n})",
  "report.dispelCard.missedCleanses": "漏掉的解控/解 debuff({n})",
  "report.dispelCard.ccRate": "友方可解 CC 解除率",
  "report.dispelCard.counts": "解 {cleansed} / 漏 {missed}",
  "report.dispelCard.broken": " / 被伤害打破 {n}",
  "report.dispelCard.rate": " — 解除率 {pct}%",

  // ── EngagementPanel.tsx (tab labels shared with ReportSkeleton.tsx) ──
  "report.engage.tab.kick": "打断",
  "report.engage.tab.dispel": "驱散",
  "report.engage.tab.aura": "光环",
  "report.engage.tab.cc": "CC链",
  "report.engage.tab.break": "破控",
  "report.engage.friendlyBreaks":
    "资敌打破 —— 己方伤害打断了挂在敌人身上的控制({n})",
  "report.engage.enemyBreaks":
    "敌方自误 —— 对面自己打断了给我方上的控制({n},正面信号)",
  "report.engage.rootBreaks":
    "另有定身(root)被打破 {n} 次 —— 定身常被刻意打破换位置,单列不计教学。",

  // ── MistakesCard.tsx / KpiChips.tsx (mistake severity: WoWAnalyzer's minor / average / major) ──
  "report.mistakeSev.major": "重大",
  "report.mistakeSev.average": "一般",
  "report.mistakeSev.minor": "轻微",
  "report.mistakesCard.title": "失误清单",
  "report.mistakesCard.emptyMatch": "本场未检出失误 —— 干净局。",
  "report.mistakesCard.allN": "全部 {n}",
  "report.mistakesCard.source": "确定性规则直出",
  "report.mistakesCard.emptyOwn": "你本人未检出失误 —— 干净局。",
  "report.mistakesCard.folded": "+{n} 个时刻已折叠 —— 点击展开",
  "report.mistakesCard.mates": "队友 {n} 个时刻 {toggle}",
  "report.mistakesCard.collapse": "▲ 收起",
  "report.mistakesCard.expand": "▼ 展开",
  "report.mistakesCard.sameWave": " ＋同一波:{list}",

  // ── KpiChips.tsx ──
  "report.kpi.findings": "失误",
  "report.kpi.majorN": "{n} 重大",
  "report.kpi.restN": "{n} 一般",
  "report.kpi.bursts": "爆发窗",
  "report.kpi.converted": "{done}/{total} 转化",
  "report.kpi.kicks": "打断",
  "report.kpi.dispels": "驱散",
  "report.kpi.passiveN": "+{n} 被动",

  // ── MatchArcLine.tsx ──
  "report.arc.early": "早期",
  "report.arc.mid": "中期",
  "report.arc.late": "后期",
  "report.arc.jumpTurningPoint": "跳转到转折点 {t}",
  "report.arc.sep": " ｜ ",

  // ── Meters.tsx (glossary report.meter.*) ──
  "report.meters.mode.damage": "伤害",
  "report.meters.mode.healing": "治疗",
  "report.meters.mode.taken": "承伤",
  "report.meters.mode.stats": "统计",
  "report.meters.modeLabel": "榜单模式",

  // ── ReportHeader.tsx ──
  "report.header.result.win": "胜利",
  "report.header.result.loss": "败北",
  "report.header.result.draw": "平局",
  "report.header.finisherTitle": "跳到终结时刻回放",
  "report.header.finisher": "终结",
  "report.header.turning": "转折",

  // ── report shell (MatchReport.tsx / ReportSkeleton.tsx) ──
  "report.view.report": "战报",
  "report.view.replay": "回放",
  "report.view.events": "事件",
  "report.view.video": "录像",
  "report.view.ai": "AI 分析",
  "report.side.recap": "回顾",
  "report.side.chat": "问教练",
  "report.timeRange.label": "时间窗",
  "report.timeline.label": "曲线",
  "report.shell.loadingMatch": "读取对局…",
  "report.shell.loadingRound": "读取回合…",

  // ── ShuffleReport.tsx ──
  "report.shuffle.roundOf": "回合 {i}/{n}",
  "report.shuffle.title": "Solo Shuffle · {n} 回合 · {result}",
  "report.shuffle.round": "回合 {i}",
  "report.shuffle.won": " · 胜",
  "report.shuffle.lost": " · 负",

  // ── StatsTable.tsx ──
  "report.statsTable.kicksCast": "打断施放",
  "report.statsTable.kicksTaken": "被打断",
  "report.statsTable.ccTaken": "被控",
  "report.statsTable.dispels": "驱散",
  "report.statsTable.purges": "偷/purge",

  // ── kill / vulnerability windows (TimeRangeBar.tsx / WindowList.tsx / UncoveredHighlightsCard.tsx) ──
  "report.band.burstTo": "击杀尝试 → {name}",
  "report.band.vuln": "{name} 脆弱",
  "report.band.vulnUnpunished": "{name} 脆弱且未被惩罚",
  "report.common.analyzeSpan": "AI 分析此段",
  "report.uncoveredCard.title": "未覆盖亮点",
  "report.timeRange.pickTitle": "选一个窗口(或在曲线上拖选)",
  "report.timeRange.hint": "在曲线上拖选可聚焦时间段",
  "report.windows.aria": "击杀/脆弱窗口列表",
  "report.windows.teamDamage": "团队伤害 {k}k",
  "report.windows.teamDamageOnly": "团队伤害仅 {k}k",
  "report.windows.absorbed": " (+{k}k 被吸收)",
  "report.windows.replay": "▶ 回放",

  // ── MatchReport.tsx ──
  "report.match.windowAiTitle":
    "对当前选段做一次 AI 深挖(无可教信号时不调用模型)",
  "report.match.copyMd": "复制 Markdown",
  "report.match.copyMdTitle": "导出当前(窗口)口径的战报 Markdown",
  "report.match.exportImg": "导出图片",
  "report.match.exportImgTitle": "导出战报图片(离屏渲染同一页面后整页截图)",
  "report.match.reportBug": "报告问题",
  "report.match.reportBugTitle":
    "打包本场原始 log + AI 调用记录 + 你的描述,生成报告包",
  "report.match.recapPlaceholder": "点击曲线上的 ✕ 查看死亡回顾",
  "report.bug.title": "报告问题 —— 本场",
  "report.bug.hint":
    "会打包:本场原始 log、最近 AI 调用的 prompt 与返回、下面这段 描述。落在 gladlog-sync 同步盘时会自动上传。",
  "report.bug.placeholder": "哪里不对?比如:教练怪我没驱散龙息,但我当时被变形了",
  "report.bug.sending": "打包中…",
  "report.bug.submit": "生成报告包",
  "report.bug.done": "已生成",
  "report.bug.synced": "(在同步盘,会自动上传)",
  "report.bug.local": "(本地保存,已在文件管理器打开)",
  "report.bug.error": "生成失败 —— 稍后再试",
};
