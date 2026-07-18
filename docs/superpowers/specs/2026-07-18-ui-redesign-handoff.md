# Handoff: gladlog UI 重设计(战报 1c 方案 + 全模块优化)

## Overview
gladlog(WoW 竞技场日志分析桌面应用,Electron + React,renderer 位于
`packages/desktop/src/renderer/src/`)六个模块的 UI 重设计实施说明:

- **战报** → 采用「时间轴脊柱」方案(设计稿编号 1c)
- **对局列表** → 1e、**回放** → 1f、**AI 分析** → 1g、**战绩** → 1h、**设置** → 1i
- 一套新的全局设计 tokens(见 Design Tokens 节),替换现有石板黑 + 鎏金方案

## About the Design Files
本包中的 `模块优化设计稿.dc.html` 是 **HTML 设计参考稿**(静态 mockup,含现状复刻与改进稿并排),
不是可直接搬运的生产代码。任务是在 gladlog 现有环境(React + TypeScript,单一
`styles.css`,无 CSS-in-JS)里**重现这些设计**:改 `styles.css` 的 tokens 与类,
重构对应 `.tsx` 组件的结构。沿用现有约定:类名前缀 `rpt-`/`mlr-`/`mlf-`/`dash-`,
样式全部集中在 `packages/desktop/src/renderer/src/styles.css`。

## Fidelity
**High-fidelity**。设计稿中的颜色、字号、间距、圆角均为最终值,按像素重现。
设计稿每个模块下方的「问题 → 改法」注释是设计意图说明,实现时以 mockup 视觉为准。

## Design Tokens(第一步:改 `styles.css` 的 `:root`)

替换/新增(保留变量名,改值;新增 accent 族):

```css
:root {
  --bg: #161826;            /* 原 #0d0f12 */
  --surface: #1b1e2c;       /* 原 #14171c;卡片底 */
  --surface-2: #12141f;     /* 原 #1a1e25;输入框底/bar 轨道/内嵌底 */
  --hairline: #3f424d;      /* 原 #262b34;控件描边 */
  --hairline-soft: #292b31; /* 原 #1d2129;卡片外框、行分隔 */
  --ink: #e9e9ed;
  --ink-2: #b2b6ca;         /* 次级文字(原 #98a1b0) */
  --mute: #75798c;          /* 弱文字(原 #626b7a);更弱一档用 #595d6c */
  --accent: #9184d9;        /* 新增:交互/激活/链接/时间光标 */
  --accent-text: #d2cefd;   /* accent 上的文字/激活字色 */
  --accent-soft: #b5abfc;   /* 亮一档(评分↑、大招 chip 圆点) */
  --accent-fill: #2b2741;   /* 激活段控底、chip 底 */
  --accent-line: #5d5294;   /* accent 元素描边 */
  --gold: #d9a842;          /* 只保留数据语义:大招描边、击杀窗口、未按保命技 */
  --win: #7ac9a3;           /* 原 #4ade80,降饱和 */
  --loss: #e08585;          /* 原 #f87171,降饱和 */
  --font-ui: "Inter", system-ui, sans-serif;  /* 需引入 Inter 400/500/600/700 */
}
```

规则(全局执行,不再逐处列):
1. **数字不再用 monospace 字体**:`--font-data` 的用途全部改为
   `font-variant-numeric: tabular-nums`(Inter 支持),字体统一 Inter。
2. **激活/交互一律 accent**,金色 `--gold` 只出现在:大招 CD、击杀窗口色带、
   「可用未按」类数据判定。所有 `color: var(--gold)` 的按钮/tab/时间戳逐一改掉。
3. **两级控件形态**:页面级 tab = 下划线式(2px accent 底线);卡内切换 = 胶囊段控
   (激活态 `background: var(--accent-fill); color: var(--accent-text)`)。
   现有 `.rpt-view-tabs`(填充金)改为下划线式;`.rpt-mode-seg` 激活态由
   `--gold-dim` 填充改为 accent-fill。
4. **字号收敛为三档**:11px(辅助)/ 12.5px(正文、表格)/ 14px(标题)。
   删除 9/10/10.5/11.5px 的用法(徽章角标类 10px 可保留)。
5. **卡内分隔线用两端渐隐**:
   `background: linear-gradient(90deg, transparent, var(--hairline) 48px, var(--hairline) calc(100% - 48px), transparent); height: 1px;`
6. 职业色(`gameConstants.ts CLASS_COLORS`)不动 —— 数据层身份色。
7. 焦点态:`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`

## Screens / Views

### 1. 战报(方案 1c「时间轴脊柱」)— 改动最大
涉及:`MatchReport.tsx`、`ReportHeader.tsx`、`Timeline.tsx`、`Meters.tsx`、
`DeathRecapCard.tsx`、`BurstLedgerCard.tsx`(删除独立卡)、`vulnWindows.ts`(已有数据)。

**布局(自上而下):**
1. **页头一行**(替换现 `ReportHeader` 三栏比分头 + 独立 `.rpt-view-tabs` 两段):
   左:`胜利`(16px/600,--win)+ `3v3 · 纳格兰竞技场 · 4:52`(12px --mute);
   右:下划线式三 tab「战报 / 回放 / AI 分析」(13.5px,激活 500 字重 + 2px accent 底线,
   非激活 --mute)。玩家名/评分不再出现在页头(它们在榜单里)。
2. **主卡:生命曲线**(全宽,`--surface` 卡,padding 14px 16px):
   - SVG 高 240,y 轴 100%/50%/0% 网格线(--hairline-soft),x 轴时间刻度
     0:00/1:00/…(10px,#595d6c);
   - 击杀窗口色带 `rgba(217,168,66,.16)`、脆弱窗口 `rgba(224,133,133,.14)`;
   - 曲线 stroke-width 2,职业色;死亡点:5px 圆(--surface 底、--loss 描边、内 ✕)
     + 上方 9px 名字时间标注;
   - **回放光标投影**:回放视图当前时刻在此画 accent 虚线(3 3)+ 时间标签;
   - **窗口列表**(SVG 下方,每个 vulnBand 一行):
     `3px 竖色条(金/红) | 0:42–0:55 | 击杀尝试 → 昭明 | 团队伤害 812k · 被苦修护盾化解 | ▶ 回放`
     行样式:`--bg` 底、--hairline-soft 边、7px 圆角、12px 字、行距 6px,整行可点跳回放。
     数据来源 `deriveVulnBands` + `burstLedger` 的结局判定。
3. **下方两栏 grid(1fr 1fr, gap 16px)**:
   - 左:**榜单卡**(保留 `Meters` 四模式段控;行:17px 职业 glyph 方块
     (圆角 4,类色底,#10121c 字)+ 名字 12.5px + 8px 高圆角 4 进度条 + 右对齐数值;
     行距 8px;敌方名字 --ink-2;点名过滤曲线的行为保留,隐藏行 = 透明度 .45 +
     划线 + glyph 镂空描边);
   - 右:**死亡回顾常驻栏**(替换现浮层 `DeathRecapCard`):无死亡/未点选时显示
     占位提示「点击曲线上的 ✕ 查看死亡回顾」;有内容时:卡边框
     `1px solid rgba(224,133,133,.33)`,标题行 + 判定胶囊(「未按:守护天使」金字金边、
     「队友可给未给」灰字)+ 事件五列 grid(时间 44px | 类型 40px 色字:伤害--loss/
     治疗--win/控制--gold | 技能 1fr | 数额右对齐 | 来源 --mute),行距 5px。
     **不再把页面向下顶**(现状插入文档流导致布局跳动)。
4. **爆发账本**:独立卡取消,其「爆发对齐」数据合并进窗口列表(结局文案),
   「打断审计」并入统计模式表格的展开明细。若想保守,也可先保留账本卡但把
   `.rpt-ledger-row` 改为 4 列 grid(时间 78px | 组合 220px | 目标结果 1fr | 判定 190px)。

### 2. 对局列表(1e)
涉及:`MatchListRow.tsx`、`MatchListFilter.tsx`、`App.tsx`(列表分组)、styles.css。

- **行结构**:删除 WIN/LOSS 文字徽章;胜负 = 行左缘 2px 色线(--win/--loss)。
  第一行:地图名 12.5px/500 + 时长 11px --mute + 评分 11px 带涨跌
  (`2145 ↑` 涨 = --accent-soft,`2139 ↓` 跌 = --mute)。
  第二行:双方专精 glyph(17px 圆角 4 方块,类色底 #10121c 字,间距 3px)+
  9px「vs」+ 右侧时间只显示 `HH:MM`(tabular-nums)。行内边距 9px 12px。
- **日期分组头**:今天 / 昨天 / M月D日,10px 大写字距 .1em --mute,
  右侧当日小结 `6 场 · 4-2`(#595d6c)。按 `startTime` 本地日分组。
- **选中态**:亮底 `#1e2130` + 内缘 accent 线
  (`box-shadow: inset 3px 0 0 -1px var(--accent)`),与胜负左缘线共存。
- **筛选条**:三控件统一 26px 高、7px 圆角、同 --hairline 描边;段控激活 =
  accent-fill;「清除」为 accent 文字按钮,常驻右端(有筛选时才显示)。
- 评分涨跌需要相邻两场差值:在 meta 派生时计算(同 bracket 前一场比较),
  拿不到就不显示箭头。

### 3. 回放(1f)
涉及:`ReplayView.tsx`、`GcdSwimlane.tsx`、styles.css。

- **框体贴场地两侧**:场地列改为 grid `96px 1fr 96px`(左友方框体列、中 SVG、
  右敌方框体列),框体卡:2px 左缘(友 --win / 敌 --loss)、名字 11px、4px 血条、
  10px 百分比(色 = 血量三段:>60% --win / 30–60% --gold / <30% --loss);
  阵亡框体透明度 .55 显示「✝ 阵亡 + 时间」;爆发中的单位名字后加 9px --loss「爆发」
  角标。场地下方原 `.rpt-replay-frames-row` 删除。
- **控件条分组**(一条卡内,从左到右):
  `⏸ 暂停`(accent 描边主按钮)| 时间 `2:20.1 / 4:52`(紧跟播放键)|
  进度条(轨道 6px,已播 = accent 40% 填充,拇指 3px 亮条;击杀/脆弱色带透明度
  提到 .4/.35)| 衰减胶囊(--loss 字+边)| 1px 分隔 | 缩放 +/− | 速度段控。
  下方一行 11px #595d6c 快捷键提示:
  `空格 播放/暂停 · ← → ±5s · Shift ±1s · ⌘+滚轮 缩放 · 双击复位`。
- **GCD 泳道**:
  - 背景加横向 5s 分隔带(`repeating-linear-gradient`,每 5s 一条 1px --surface 线),
    刻度从 15s 加密到 5s;
  - 时间光标 1.5px accent 线 + 右端时间徽标(accent 底、--bg 字、9px、圆角 3);
  - 大招 chip:accent-fill 底 + --accent-line 描边 + 2px accent 左缘 +
    右端 9px「CD」(--accent-text);「最近一个 GCD」描边改金(--gold),
    与大招样式不再冲突;
  - 泳道头图例:`▮ 大招` 常驻(11px)。

### 4. AI 分析(1g)
涉及:`StructuredAnalysisPanel.tsx`、`KeyMomentAxis.tsx`、`FindingsList.tsx`、
`ProComparisonVerified.tsx`、`CohortDimsTable.tsx`、`MatchHero.tsx`(删除)。

- **操作区置顶**:`重新分析`(accent 描边主按钮)+ 中文/EN 段控 + 状态文字
  「已缓存 · 3 条 findings · 最高严重度 high」+ 右端「导出 ▾」。
  `MatchHero` 的信息并入这行状态文字。
- **本场目标**条:accent 淡底(`--accent-fill` 20% 透明)+ --accent-line 边框卡,
  目标为胶囊(--accent-text 字 + --accent-line 边)。
- **时刻轴改单侧左轨**:grid `52px 1fr`;时间列右对齐 11px --mute;轨道 = 2px
  竖线(--hairline,底部 48px 渐隐),每条目一个 8px 节点圆
  (--bg 底 + 2px 事件色描边:击杀窗口 --gold / 死亡敌方 --win 己方 --loss /
  finding 按严重度)。**取消左右交错**(删 `.rpt-axis-row.left/.right` 逻辑)。
- **finding 卡**:max-width 64ch;严重度 = 色底标签
  `HIGH · 目标选择`(10px/600 大写,HIGH: --loss 字 + `#e0858518` 底;MED: --gold;
  LOW: --mute);标题 13.5px/500 同行;正文 12.5px/1.65 --ink-2;
  操作行:Evidence + `⏱ 1:20` 证据 chips(11px 边框按钮)+ `▶ 回放此刻`(accent 文字);
  **跟进标记(✓/↻)移到卡右上角**。
- **空窗折叠**:>30s 间隔显示一行 10.5px `⏱ 63s 无关键事件 — 折叠`,不打断轨道。
- **cohort 表**:每维度三列 grid `150px 1fr 120px`:名称 | 分布条 | 判定。
  分布条:14px 高,轨道 --surface-2,p10–p90 = --hairline 圆角条,p50 = 1.5px 刻度,
  你的值 = 3px 游标(好 --win / 差 --loss / 持平 --ink-2);判定列
  `p64 · 高于中位`(同游标色,tabular-nums)。

### 5. 战绩(1h)
涉及:`StatsDashboard.tsx`、styles.css。

- **标题行**:`战绩` 14px/500 + 角色 chips(激活 accent-fill 胶囊,带场次小字)+
  右端时间段控(今天/7 天/全部)。
- **总览数字带**(替换三个 `.dash-stat` 小卡):全宽圆角 10 卡,
  底 `linear-gradient(135deg, #262a60, #353b80)`(全页唯一饱和色块),
  四格数字(34px/600 tabular-nums)+ 1px `#ffffff22` 竖分线:
  场次 | 胜率(`58% · 39-28`,胜 ≥50% 用 `#a8e6c4`)| 当前评分 + 7 天变化
  (`2145 ↑63`)| 时长中位。**「当前评分与变化」是新增数据**:取该 bracket
  最近一场本人评分,与时间范围起点前最近一场相减。
- **评分曲线**:补 x 轴日期刻度与 y 轴三档评分;每条 bracket 线端点加圆点 +
  当前分标注;系列色:3v3 = --accent,Solo Shuffle = --win,其余用
  `SERIES_COLORS` 顺延;图例移到卡头(12px 色线 + 名称)。
- **对阵敌方阵容表**:每行三列 grid:专精 glyph 组 | 8px 胜率横条
  (≥55% --win / ≤45% --loss / 其间 #9397ab)| `71% · 7场`(同条色 + 场次 #595d6c)。
  按场次排序;底部说明「点击行回列表筛选该阵容」。旧数据提示移到卡底 11px。
- **最常犯的问题**:行 = 标题 12.5px/500 + `×9` 计数 + ↻/✓ 色字(不用边框 chip)+
  行尾 `最近一场 →`(accent 文字链接)。

### 6. 设置(1i)
涉及:`SettingsPanel.tsx`、styles.css。

- 每分组卡内 **三列 grid**:`130px 1fr auto`(标签 | 值/输入 | 操作),gap 12px 16px,
  替换 `.settings-row` flex-wrap。
- 输入框统一:底 --surface-2、1px --hairline-soft 边、7px 圆角、padding 5px 10px、
  12px 字。
- **API key 行**:输入框前置「已设置」胶囊(--win 字 + 33% 透明 --win 边);
  「保存」普通边框按钮,「清除」= 红色纯文字按钮(--loss,无边框)。
- **保存反馈就地**:✓ 提示(11px --win)显示在对应分组标题行内,2s 消失
  (替换页顶 `.settings-saved`)。
- 「后端」下拉下方加 11px #595d6c 说明行:
  `调试可切 Claude CLI / agy(本地),不走网络`。
- WoW 目录路径 12px --mute 单行省略;「历史日志」行说明:`重复导入按场次自动去重`。

## Interactions & Behavior
- 所有既有交互保留:点名过滤曲线、点色带/证据/账本 ▶ 跳回放(`handleSeekEvent`
  管线不变)、统计表行展开、shuffle 回合 tab、键盘操控。
- 新增:战报窗口列表行点击 = 跳回放该窗口起点;死亡回顾从「浮层」变「右栏常驻位」
  (state 不变,渲染位置变);回放当前时刻在战报曲线投影(需把回放时钟 t 以低频
  同步到 MatchReport,或只在从回放切回战报时显示最后位置)。
- hover:按钮/行 hover 用 accent 淡色(`color-mix(in srgb, var(--accent) 12%, transparent)`
  底或 --accent 描边),不再用金色。
- 段控/tab 切换无动画;卡片无 transition 要求。

## State Management
无新增全局 state。改动点:
- `MatchReport`:`recap` 渲染进右栏而非浮层;可选新增 `lastReplayT`(投影光标)。
- `App`:列表按日分组是纯派生(`useMemo`),分组小结同。
- `StatsDashboard`:新增「当前评分/变化」派生函数(基于现有 metas)。

## Design Tokens 速查(mockup 用到的具体值)
- 底色:页 `#161826` / 卡 `#1b1e2c` / 输入与轨道 `#12141f` / 选中行 `#1e2130`
- 边线:卡框与行分隔 `#292b31` / 控件描边 `#3f424d`
- 文字:`#e9e9ed` / 次 `#b2b6ca` / 说明 `#9397ab` / 弱 `#75798c` / 最弱 `#595d6c`
- accent:`#9184d9`,字 `#d2cefd`,亮 `#b5abfc`,底 `#2b2741`,边 `#5d5294`
- 胜 `#7ac9a3` / 负 `#e08585` / 数据金 `#d9a842` / 战绩带 `#262a60→#353b80`
- 圆角:卡 8px / 控件 7px / chip 5px / 胶囊 999px;字体 Inter(数字 tabular-nums)
- 职业色不变:见 `report/data/gameConstants.ts`

## Assets
无新增图片资产。专精/职业标识用现有 glyph 回退方案(`classGlyph` 2 字母 + 类色方块,
改为圆角 4、字色 `#10121c`);spec 图标 CDN(`specIconUrl`)可继续用,加载成功时
替换 glyph 方块,失败回退不变。Inter 字体需在 `index.html` 或 CSS 引入
(Google Fonts,weights 400/500/600/700)。

## Files
- `模块优化设计稿.dc.html` — 设计参考稿(浏览器直接打开;含各模块现状复刻与
  改进稿并排、每稿「问题 → 改法」注释)。战报采纳其中 **1c**;其余模块采纳
  1e / 1f / 1g / 1h / 1i。1a(战报现状复刻)与 1b/1d 仅作对照,不实现。

## 建议实施顺序
1. Tokens + 全局规则(半天,全 App 变色但布局不动)
2. 设置 1i、对局列表 1e(小,先验证新语言)
3. 战绩 1h、AI 分析 1g
4. 回放 1f
5. 战报 1c(最大,最后做;可先落「窗口列表 + 死亡回顾右栏」,再删账本卡)
