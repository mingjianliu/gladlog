import type { MessageParams } from "../index";

// Baseline (zh) dictionary for the match report's components
// (src/renderer/src/report/components/*), `report.<card>.*` keys. Text moved
// verbatim from the components.
export const zhReportAi = {
  // ── FindingsList.tsx / KeyMomentAxis.tsx (glossary report.followup.*) ──
  "report.finding.habitTitle": "跨对局稳定模式(确定性统计,非 AI 判断)",
  "report.finding.deepTag": "深挖",
  "report.finding.collapse": "收起 ▴",
  "report.finding.expand": "展开全文 ▾",
  "report.finding.jumpTo": "跳到 {t} 的回放",
  "report.finding.replayHere": "▶ 回放此刻",
  "report.finding.inspectTitle": "在事件视图里查看该时刻的原始事件",
  "report.finding.inspect": "⛏ 原始事件",
  "report.finding.markDone": "标记为已改进",
  "report.finding.done": "✓ 已跟进",
  "report.finding.markRecurring": "标记为还在犯",
  "report.finding.recurring": "↻ 还在犯",

  // ── KeyMomentAxis.tsx ──
  "report.axis.kind.death": "死亡",
  "report.axis.kind.burst-band": "爆发",
  "report.axis.kind.defensive": "防御",
  "report.axis.kind.dispel": "驱散",
  "report.axis.kind.cc": "控制",
  "report.axis.kind.heal-gap": "空窗",
  "report.axis.kind.position": "走位",
  "report.axis.gap": "⏱ {s}s 无关键事件 — 折叠",
  "report.axis.collapseMinor": "− 收起次要时刻",
  "report.axis.moreMinor": "+{n} 次要时刻",

  // ── CoachChatCard.tsx ──
  "report.chat.needsCli": "对话教练需要本地 CLI 后端",
  "report.chat.notReady": "开始 AI 分析后才能对话",
  "report.chat.thinking": "教练思考中…",
  "report.chat.sendFailed": "发送失败 · ",
  "report.chat.placeholder": "问教练…",
  "report.chat.inputAria": "向教练提问",
  "report.chat.stop": "停止",
  "report.chat.send": "发送",
  "report.chat.disclaimer": "回答基于日志推理,可能有误",

  // ── WindowAnalysisCard.tsx ──
  "report.windowAi.title": "选段分析 {from}–{to}",
  "report.windowAi.cachedTitle": "本窗口的分析结果来自缓存",
  "report.windowAi.cached": "(缓存)",
  "report.windowAi.loading": "分析中…(约 10–30s)",
  "report.windowAi.none":
    "这段未检出可教信号(无受控/防御施放/敌方爆发/HP 骤降等)。",
  "report.windowAi.auditEmpty": "模型输出未通过审计。",
  "report.windowAi.error": "分析失败(网络或服务异常)。",
  "report.windowAi.noClient": "未配置 AI(设置里填 API Key 后可用)。",
  "report.windowAi.busy": "该窗口的分析仍在进行中——稍候点重试查看结果。",

  // ── ProComparisonVerified.tsx (en values are the panel's previous inline English) ──
  "report.pro.noInput":
    "无法从本场日志推出对比所需的指标(找不到记录者/指标计算失败),暂无法对比。",
  "report.pro.running": "对比中…",
  "report.pro.again": "重新对比",
  "report.pro.run": "vs 高分群体",
  "report.pro.heading": "vs 同水平高手",
  "report.pro.sameComp": "对阵同阵容({comp})的高手场 · ",
  "report.pro.sampleN": "样本 {n} 场",
  "report.pro.durationMedian": " · 时长中位 ",
  "report.pro.firstKill": " · {pct}% 先杀 {spec}",
  "report.pro.measuredOnly": "仅展示实测数据(AI 解说未生成)",
  "report.pro.reason": "原因:",
  "report.pro.notEnough": "该专精/阵容的高手参照样本还不够,暂无法对比。",
  "report.pro.comparing": "正在与同水平高手对比…",
  "report.pro.elapsed": "已 {t}",
  "report.pro.autoRan": "本场已有 AI 分析但缺对比,已自动补跑",
  "report.pro.empty":
    "本场还没有群体对比结果 —— 点上方「AI 分析」一键同跑,或点下面的按钮单独对比。",
  "report.pro.healingGaps": "本场治疗空窗 {s}s · {n} 次",

  // ── StructuredAnalysisPanel.tsx ──
  "report.ai.reanalyze": "重新分析",
  "report.ai.preparing": "正在准备分析数据…",
  "report.ai.pickModel": "选用其他模型分析",
  "report.ai.default": " (默认)",
  "report.ai.demoTitle": "用一份演示数据看看分析长什么样(与本场无关)",
  "report.ai.demoBtn": "看一个演示分析",
  "report.ai.staleSlot": "旧版本槽 · 无可用结果",
  "report.ai.cached": "已缓存 · {n} 条 findings",
  "report.ai.maxSeverity": " · 最高严重度 {sev}",
  "report.ai.goals": "本场目标 —— 你标记过「还在犯」的问题:",
  "report.ai.goalLast": "(上次:{title})",
  "report.ai.demoBanner":
    "演示数据 · 与本场无关 · 在「设置 → AI 分析」配置 API key 或本地 CLI 后即可分析本场",
  "report.ai.staleTag": "旧版",
  "report.ai.staleNote":
    "该槽为旧版本分析(提示词已升级,或 AI 自查设置已切换),重新分析后可查看",
  "report.ai.wholeRound": "整场观察",
  "report.ai.runningWith": "{model} 分析中",
  "report.ai.retrying": "首轮输出解析失败,已自动重试一次(总时长会翻倍)",
  "report.ai.reviewing": "首轮已出结果,正在 AI 自查(多一次 AI 调用)",

  // ── StructuredAnalysisPanel.tsx (running status) ──
  "report.ai.running": "分析中",
  // ── fix round 1: English left in migrated files ──
  "report.finding.evidence": "证据",
  "report.finding.none": "本场没有失误。",
  "report.ai.heroFindings": (p: MessageParams) => `${p.n} 条失误`,

  // ── ContentLangBadge.tsx / StructuredAnalysisPanel.tsx (spec §6.13) ──
  "report.contentLang.otherZh": "中文分析",
  "report.contentLang.otherEn": "英文分析",
  "report.contentLang.title":
    "这份分析是用另一种语言生成的。用当前语言重新分析后，才能深挖、选段分析和问教练",
  "report.contentLang.reanalyze": "用中文重新分析",
};
