// Baseline (zh) dictionary for the match report's components
// (src/renderer/src/report/components/*), `report.<card>.*` keys. Text moved
// verbatim from the components.
export const zhReportReplay = {
  // ── ReportOverflowMenu.tsx ──
  "report.overflow.more": "更多操作",
  "report.overflow.moreTitle": "更多操作:复制 Markdown / 导出图片 / 报告问题",

  // ── ReplayZoomControls.tsx / ReplayMapResizer.tsx / ReplaySplitter.tsx ──
  "report.zoom.inTitle":
    "放大(也可 ⌘/Ctrl+滚轮;放大后普通滚轮即可继续缩放,拖拽平移)",
  "report.zoom.outTitle": "缩小",
  "report.zoom.resetTitle": "复位缩放(或双击地图)",
  "report.zoom.reset": "⤢ {z}× 复位",
  "report.replay.resizeMap": "调整地图高度",
  "report.replay.resizeSplit": "调整地图与 GCD 泳道的宽度",

  // ── VideoBattleTimeline.tsx / VideoMomentList.tsx / VideoMomentStrip.tsx ──
  "report.video.battleTimelineAria": "战斗时间轴(点击或拖动定位录像)",
  "report.video.beforeRecording": "该时刻在录像开始之前",
  "report.video.seekMoment": "定位到该时刻",
  "report.video.clickToSeek": "{label}(点击定位)",

  // ── shared by the replay / GCD / events views ──
  "report.common.died": "阵亡",
  "report.common.clickDeathRecap": "点击看死亡回顾",
  "report.common.clickToSeek": "(点击定位)",

  // ── GcdSwimlane.tsx ──
  "report.gcd.title": "GCD 模式 · 每 GCD 谁做了什么",
  "report.gcd.legendMajor": "▮ 大招",
  "report.gcd.density.standard": "标准",
  "report.gcd.density.compact": "紧凑",
  "report.gcd.sharedAxis": "与地图共享时间轴",
  "report.gcd.bandChipTitle": "点击定位(地图同步)",
  "report.gcd.scrollAria": "GCD 泳道(可滚动)",

  // ── ReplayView.tsx ──
  "report.replay.hintKeys":
    "空格 播放/暂停 · ← → ±5s · Shift ±1s · ⌘/Ctrl+滚轮 缩放(放大后滚轮可继续)· 双击复位 · 分隔条可拖(聚焦后 ← →)",
  "report.replay.hintLegend":
    "虚线空心 = 该时刻日志里还没有此人坐标(跑动不进战斗日志,要等他施法、挨打或被治疗才会暴露位置)",
  "report.replay.layout.split": "地图 + GCD",
  "report.replay.layout.map": "纯地图",
  "report.replay.layout.gcd": "纯 GCD",
  "report.replay.noPositions":
    "无位置数据 —— 该场没有高级战斗日志(advancedSamples),无法回放走位。",
  "report.replay.deathTitle": "{name} 阵亡",
  "report.replay.deathClick": " — 点击看死亡回顾",
  "report.replay.bursting": "{name} 爆发中:{spell}",
  "report.replay.focusFire": "集火:{n} 人同秒打击 {name}",
  "report.replay.rooted": "{name} 被定身:{spell}(剩 {s}s)",
  "report.replay.ccd": "{name} 被控制:{spell}(剩 {s}s)",
  "report.replay.ccLeft": "{spell} 剩{s}s",
  "report.replay.unknownPos":
    "{name}:该时刻日志里还没有他的坐标(跑动不产生战斗日志记录)。圆点画在他首次卷入战斗的位置,不代表他此刻在这儿。",
  "report.replay.castBar": "读条:{spell}",
  "report.replay.castCut": "(被掐)",
  "report.replay.burstTag": "爆发",
  "report.replay.dead": "✝ 阵亡 {t}",
  "report.replay.pause": "⏸ 暂停",
  "report.replay.replayAgain": "↻ 重放",
  "report.replay.play": "▶ 播放",
  "report.replay.bandBurst": "击杀尝试 on {name}(团队伤害 {k}k)",
  "report.replay.bandVuln": "{name} 无大防御且未被惩罚(团队伤害仅 {k}k)",
  "report.replay.scrubAria": "回放时间轴",
  "report.replay.dampTitle": "治疗衰减(dampening)",
  "report.replay.damp": "衰减 {pct}%",
  "report.replay.diveTitle": "对当前时刻前后 10s 做一次 AI 深挖(密集快照)",
  "report.replay.dive": "深挖此刻",
  "report.replay.helpAria": "快捷键与图例说明",

  // ── Timeline.tsx ──
  "report.timeline.metricAria": "曲线指标",
  "report.timeline.metricTitle":
    "每人一条曲线;伤害/治疗/承伤/被治疗为每秒量的 {s} 秒滑动平均(全场口径,时间窗只高亮不裁剪)",
  "report.timeline.bandBurst": "击杀尝试 on {name}(团队伤害 {k}k)",
  "report.timeline.bandVuln": "{name} 脆弱且未被惩罚",
  // the timeline's dampening-lane tooltip (zh kept byte-identical to the
  // pre-i18n "Dampening N%", distinct from the replay badge's report.replay.damp)
  "report.timeline.dampLane": "Dampening {pct}%",
  "report.timeline.clickReplay": "(点击回放)",
  "report.timeline.flowTotal": "{name} — 全场{metric} {amount}",
  "report.timeline.flowEmpty": "本场无「{metric}」数据",
  "report.timeline.pressure": "{from}–{to} {name} 承压 {m}M({k}k DPS)",
  "report.timeline.pressureClick": "(点击设为时间窗)",
  "report.timeline.death": "{name} 死亡 @ {s}s",
  "report.timeline.cursor": "回放 {s}s",
  "report.timeline.showAllTitle": "显示全部单位的曲线",
  "report.timeline.friendlyOnlyTitle": "只保留我方曲线(敌方仍可单独点开)",
  "report.timeline.friendlyOnly": "只看我方",

  // ── EventsPanel.tsx ──
  "report.eventsPanel.col.time": "时间",
  "report.eventsPanel.col.kind": "类型",
  "report.eventsPanel.col.src": "来源",
  "report.eventsPanel.col.dest": "目标",
  "report.eventsPanel.col.spell": "技能",
  "report.eventsPanel.col.amount": "详情",
  "report.eventsPanel.sortBy": "按{col}排序",
  "report.eventsPanel.key": "关键",
  "report.eventsPanel.kindAria": "类型过滤",
  "report.eventsPanel.openRecapTitle": "打开死亡回顾",
  "report.eventsPanel.openRecap": "▶ 死亡回顾",
  "report.eventsPanel.rawTitle": "查看原始日志行",
  "report.eventsPanel.rawUnavailable":
    "原始行不可用(旧档无行号或 raw.txt 缺失)",
  "report.eventsPanel.presetsAria": "事件预设",
  "report.eventsPanel.keyTitle": "伤害 · 打断 · 驱散 · 死亡",
  "report.eventsPanel.keyN": "关键 {n}",
  "report.eventsPanel.allN": "全部 {n}",
  "report.eventsPanel.anchorTitle":
    "窗口锚定:全场,或跳到一个已经算好的窗口(与下面「时间」列的输入框是同一个窗口)",
  "report.eventsPanel.custom": "自定义 {from}–{to}",
  "report.eventsPanel.global": "全局时间窗 {from}–{to}",
  "report.eventsPanel.trace": "溯源 {name}(来源或目标)",
  "report.eventsPanel.traceClear": "清除溯源单位过滤",
  "report.eventsPanel.clearFilters": "清除筛选({n})",
  "report.eventsPanel.count": "{matched} / {total} 条",
  "report.eventsPanel.timeAria": "时间窗过滤,例如 0:30-1:10",
  "report.eventsPanel.timeTitle":
    "留空 = 全场。也可以用上面的窗口下拉挑一个算好的窗口。",
  "report.eventsPanel.srcAria": "来源过滤",
  "report.eventsPanel.destAria": "目标过滤",
  "report.eventsPanel.spellAria": "技能名过滤",
  "report.eventsPanel.spellPlaceholder": "技能名…",
  "report.eventsPanel.amountAria": "数值下限",
  "report.eventsPanel.amountPlaceholder": "≥ 数值",
  "report.eventsPanel.amountTitle":
    "只看数值不小于该值的行;施放/光环/死亡这类没有数值的行会被排除",
  "report.eventsPanel.auraFlood": "{name} {n} 个光环同时消失",
  "report.eventsPanel.deathClear": "死亡清场",

  // ── VideoTab.tsx ──
  "report.video.missingHead": "缺头 {s} 秒 —— 录像比开场晚,这段没有画面",
  "report.video.playbackFailed":
    "无法播放该录像(建议 OBS 录制格式设为 Hybrid MP4)",
  "report.video.noFootage":
    "本轮不在这段录像范围内(录像已经结束,比如 OBS 提前停录)—— 没有画面可放。下方战斗时间轴与右侧时刻清单来自战斗日志,仍可查看。",
  "report.video.controlsAria": "录像播放控制",
  "report.video.pause": "暂停",
  "report.video.play": "播放",
  "report.video.progressAria": "播放进度(本轮范围内)",
  "report.video.unmute": "取消静音",
  "report.video.mute": "静音",
  "report.video.fullscreen": "全屏",
  "report.video.battleTimeline": "战斗时间轴 —— 点/拖定位录像",
  "report.video.tab.feed": "播放 feed",
  "report.video.tab.all": "全部时刻 {n}",
  "report.video.tab.ai": "AI 发现 {n}",
  "report.video.feedEmpty": "无画面可播 —— 看「全部时刻」清单。",
  "report.video.aiEmpty":
    "尚无 AI 发现 —— 跑一次 AI 分析后,时间轴 finding 会出现在这里。",
  "report.video.hint":
    "标记条:金带 = 爆发窗,✕ = 死亡,⚠ = 失误,✦ = AI 发现,点击定位; 战斗时间轴是主 seek 面,控制条细进度条做精确微调。",
  // ── fix round 1: English left in migrated files ──
  "report.eventsPanel.ticks": "×{n} 跳",
};
