# 战报 UI —— 当前状态(2026-07-13)

报表 UI 经历了「初版三项(#3/#4/#5)→ 设计交接重设计(4 phase)→ 若干迭代」,
本文是**现状的单一事实源**。同目录早前的
`2026-07-12-report-ui-design-brief.md` / `-review-handoff.md` 是设计过程记录,
描述的是**重设计前**的状态,已被本文取代。

代码在 `packages/desktop/src/renderer/src/report/`,样式全在 `.../src/styles.css`。

## 顶层:三视图(填充金色段控 tab)

`MatchReport.tsx` 顶部一排 segmented 段控:**战报 / 回放 / AI 分析**。

## 战报(report)

- 全宽,**无右侧单位详情侧栏**(初版 View B 已按设计删除)。
- **榜单卡片**(`Meters`):卡头右上是「榜单模式」+ 伤害/治疗/承伤 段控(模式切换
  下沉进卡头,不再和顶层 tab 叠成两排)。友方名 `--ink` / 敌方名 `--ink-2`。
- **每行名字可点** → select/unselect 该玩家,过滤下方生命曲线;取消的行变暗+划线、
  职业色圆点镂空。
- **生命曲线**(`Timeline`):全宽 HP 时间轴,只画选中玩家 + 死亡标记。

## 回放(replay)—— 竞技场 + GCD 泳道,1:2 布局

`ReplayView` = 左竞技场 : 右 GCD 泳道 = **1 : 2**(grid `1fr 2fr`,中间 8px)。
两者共享同一播放时钟(t/playing/speed/selUnits)。

**竞技场:**

- 按 `zoneId` 铺该竞技场**真实 minimap**(`arenaMaps.ts` 存 15 张竞技场的世界
  坐标包围盒;底图从 wowarenalogs CDN 运行时加载,不入仓库)。无底图的 zone 回退
  抽象地面。坐标系:有底图时用竞技场真实包围盒对齐,否则按样本包围盒。
- 单位 = 职业色圆点 + 队伍色描边 + 2 字母职业字形 + 下方血条(按血量变色)+ 名字;
  近 6s 走位尾迹;阵亡留残影 + ✕。
- 控件条:金色播放键 + scrubber + 时钟 + 1×/2×/4× 段控(全宽)。图例药丸。

**GCD 泳道(`GcdSwimlane`):**

- 每玩家一列(206px),施法 chip 只显示**技能名**(+ 大招金色 CD 标),**目标在
  hover 的 title 里**;碰撞避让堆叠(密集不重叠);金色时间光标横贯所有列;
  暂停时全亮、播放时压暗未来动作;玩家 chip 切换列显隐;纵向滚 + 播放时跟随光标。

## AI 分析(ai)

双栏:左 findings 严重度色卡(high/med/low 左边框,2 行折叠 + 展开/收起,~72ch
阅读宽)+ 右 cohort「vs your cohort」sticky 卡(percentile)。

## 本地预览 / 迭代

- **`npm run dev:ui`**(端口 5199)——纯浏览器渲染 report,HMR,免 Electron;
  fixture 下拉可切:真实 3v3(裁剪匿名)/ 合成 / 完整真实局(本地 `dev/local`,
  gitignored)。见 `.claude/skills/run-ui`。
- **`VITE_FIXTURE_MODE=1 npm run dev`**——真 Electron App + 免真数据 fixture 预览
  (已修好,能走完整 App)。

## 数据

- `test/fixtures/real-match-sample.json`——真实 3v3(匿名、裁前 90s),入库供渲染
  测试(`report.realmatch.test.tsx`)。
- `dev/local/full-match.json`——一场完整真实局(真名,gitignored,仅本机)。

## 关键文件

`report/components/`:`MatchReport` `Meters` `Timeline` `ReplayView` `GcdSwimlane`
`UnitPanel`(现仅被直测/备用) `StructuredAnalysisPanel` `ProComparisonVerified`
`FindingsList`。`report/derive/`:`summary` `meterRows` `timeline` `casts`
(`deriveUnitTimeline`/`isMajorCd`) `replay`。`report/data/`:`gameConstants`
(`classColor`/`classGlyph`) `arenaMaps`。
