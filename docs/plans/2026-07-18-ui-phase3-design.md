# UI 第三阶段设计:跨场统计 + 用户门槛 + 教练闭环(2026-07-18)

> 单场复盘 UI(backlog #6–#11 + 连续跟进)已收敛;本阶段三个方向:
> 场与场之间、装完就能用、教练从点评变跟进。实现顺序 1→2→3,回放小件随手。
> C3 HTML 导出**不在本阶段**(形态需用户拍板)。

## 已核实的代码事实(设计依据)

- `matches.list()` 返回全量内存索引(非分页)——仪表盘聚合直接吃 meta,零新 IO;
  富行字段 durationS/avgRating/teams 已在 meta(2026-07-17 #7),旧行缺字段。
- `arenaObstacles`(analysis arenaGeometry)= zoneId → circle{x,y,r}/polygon{vertices}
  世界坐标;回放已有 world→px 映射,画障碍是纯渲染。
- 历史导入:watcher 的 FilePipeline 是 tail/checkpoint 增量模型,不适合一次性
  回灌;main 进程可直接 `new GladLogParser()` 全文件跑(store.store 按 id 去重,
  重复导入天然幂等)。
- settings 面(get/save/redact)、目录选择(app.selectDirectory)都已有 IPC。

## 1. 战绩仪表盘(跨场统计)

- **入口**:App 顶栏改三态段控:对局 / 战绩 / 开发者(现在是单个开发者 toggle)。
- **数据**:`deriveDashboard(metas, period)` 纯函数(components 旁 `dashboard.ts`),
  period ∈ 今天/7 天/全部。产出:
  - 总览条:场次、胜率、时长中位数;
  - 评分曲线:avgRating 按 startTime 折线,**按 bracket 分线**(SVG,复用 Timeline 手法);
  - 敌方 comp 胜率表:meta.teams[1] 的 specId 排序拼签名 → {场次, 胜率},按场次降序,
    spec 图标渲染(复用 SpecDot);
  - 地图胜率表:zoneId 全行都有(旧行也计入)。
- **旧行处理**:无 teams 的行计入总览/地图,不计入 comp 表;表头注一句
  「N 场旧数据无阵容 —— 开发者视图可重建索引回填」。
- **联动**:comp 行 / 地图行点击 → 回对局列表并预置筛选(复用 ListFilter,
  App 持 filter state 已就位;comp→specId 筛选取签名第一个 spec 即可,v1 不做全 comp 匹配)。

## 2. 用户门槛三件套

- **设置页**:顶栏「设置」按钮(或战绩旁第四态)→ SettingsPanel:WoW 目录
  (selectDirectory)、Anthropic API key(masked,哨兵机制已有)、模型、AI 后端、
  回复语言。DevPanel 保留(调试),把用户项迁出。
- **首启引导**:metas 为空且 wowDirectory 为 null → 主区空态换引导卡:
  三步说明(选目录 → 打一场/导入历史 → 看战报),内嵌 选目录 与 导入历史 按钮。
- **历史导入**:main 新 IPC `logs:importFiles()`:showOpenDialog(多选 .txt / 或目录)
  → 逐文件 readFileSync + GladLogParser 全量跑 → store.store 收集
  {stored, dup} 计数;进度事件 `gladlog:import:progress {file, i, n, stored}`,
  完成事件带汇总。UI:设置页 + 引导卡里「导入历史日志…」按钮 + 进度条。
  大文件(整晚 ~50MB)一次性读入 main 可接受;逐文件串行。

## 3. 教练闭环

- **finding 标记**:FindingsList 每条卡尾加 「✓ 已跟进」/「↻ 还在犯」二态(可取消);
  落盘 `<matchesDir>/<matchId>/findingFlags.json`(key = `${category}:${title}` 哈希,
  语言无关——两种语言缓存共享标记)。IPC:`analysis:getFlags/setFlag`。
- **跨场聚合**:main IPC `analysis:aggregate()` 扫 `*/analysis-v2.*.json`(同一场
  两语言去重,取其一)→ category 计数 + 各类最近实例(matchId/title/severity/flag)。
  渲染进战绩仪表盘:「最常犯的问题」卡(前 3 类 + 各附最近一条,点击 → 跳该场 AI 视图
  —— App 需要 selectedId + 目标 view 的深链;v1 先跳该场即可)。
- **不做**(v1):自由文本笔记、跨场同类 finding 自动关联(靠 category 聚合近似)。

## 4. 回放小件(随手,各自独立小 commit)

- 键盘:空格播放/暂停、←/→ ±5s、Shift+←/→ ±1s;0.5× 加入速度段控。
- 障碍物:`arenaObstacles[zoneId]` 画半透明描边(circle→SVG circle,
  polygon→path),有真实底图时叠加,无底图时替代现在的抽象柱。
- AI 分析流式预览:analysis.ts stream 循环里 emit
  `gladlog:analysis:delta {matchId, text}`(compare 已有同款),面板 running 态
  显示灰字原文预览,done 后替换为结构化渲染。

## 实施顺序

1a 仪表盘骨架(段控 + deriveDashboard + 总览/评分曲线)→ 1b comp/地图表 + 列表联动
→ 2a 设置页 → 2b 引导卡 → 2c 历史导入 → 3a finding 标记 → 3b 聚合卡
→ 4 三件随手。每步独立 commit + 测试 + CI watch。
