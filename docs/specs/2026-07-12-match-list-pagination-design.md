# 战报列表分页 + 快启动索引 设计

日期:2026-07-12
状态:待用户审阅

## 背景与目标

用户 WoW 日志历史巨大(数千~数万场),桌面 App 启动「加载很久」。定位两处随对局总数 N 线性增长的成本:

1. **启动**:`MatchStore.init()` 对每个对局目录同步 `readFileSync(meta.json)` —— N 次同步读阻塞主进程,窗口迟迟不可用。
2. **渲染**:`App.tsx` 用 `metas.map(...)` 一次渲染全部 N 行 `<li>` —— 无窗口化,数千 DOM 节点拖慢首屏 + 滚动卡顿。

摄取(ingestion)已确认高效:checkpoint(`checkpoints.json` + 字节 offset),启动只解析新日志,不重解析历史 —— **不动摄取**。

目标:启动一次读、首屏只渲染最近 100 场;更早对局随下滑增量加载。

## 用户确认的决策

- 方案 A(分页数据 + 无限滚动渲染)。
- 首屏 = 最近 100 场(count-based),下滑每次加载再 100。
- **仅分页,不做虚拟化**(常规使用足够;仅当刻意滚穿数年历史才会重新堆积行,可接受)。
- 不动摄取/解析核心。

## 组件一:MatchStore —— append-only NDJSON 索引 + 分页

### 快启动索引(append-only NDJSON)

新增单文件 `_index.ndjson`(每行一条 `StoredMatchMeta` 的 JSON)。

- `init()`:若 `_index.ndjson` 存在 → **一次读**,逐行 parse,按 `id` 去重(后写覆盖)建内存索引。若不存在(旧安装)→ 一次性从各目录 `meta.json` 重建并写出 `_index.ndjson`(迁移,仅一次)。
- `store()`:先原子写对局目录(现有 tmp→rename),**再向 `_index.ndjson` 追加一行**(O(1),不重写整文件 → 无主线程停顿)。顺序保证:崩溃至多留「有目录、无索引行」,绝不「有索引行、无目录」。
- **对账**(崩溃安全,廉价):`init()` 另做一次 `readdir`(仅目录名,单 syscall,不逐文件读);对不在索引中的目录,仅读那几个 `meta.json` 补入并追加行;丢弃无对应目录的索引项。常态下零额外读。
- store() 按 `id` 去重(现有 `this.index.has(id)` 守卫)→ NDJSON 每个对局恰一行,不无界增长,无需压缩。

### 分页方法

`page(opts: { before?: number; limit: number }): StoredMatchMeta[]` —— 从内存索引(按 `startTime` 降序)返回 `startTime < before`(省略则最近)的至多 `limit` 条。纯内存切片,零磁盘 IO。保留 `list()`(DevPanel/测试仍用)。

### debate 采纳的取舍(agy 仪式)

2026-07-12 对「合并索引」跑 debate-open(conversation `8cd406a8`,OPPOSE)。采纳与裁决:

- **采纳**:原设计 store() 每次重写整份 `_index.json` 是 O(N) 写、会阻塞主线程 → 改 **append-only NDJSON**,store() 恒 O(1) 追加。
- **裁决保留(低风险,记录)**:`safeName` 有损映射可致两个不同 id 撞同一目录 → 幻影重复。此为**现存 store 行为**(非本次引入),且 WoW GUID 为字母数字+连字符不会撞;不在本次修。
- **裁决保留(低风险,记录)**:索引作为缓存不感知 `meta.json` 的带外编辑 → 陈旧。但对局库在 App 私有 `userData`(非同步文件夹),`meta.json` 写入后不被外部编辑;可接受。
- **驳回 steelman(SQLite/better-sqlite3)**:引入原生编译依赖、复杂化 electron-builder 打包,对「让列表快些」过度工程;append-only NDJSON 已同时拿到 O(1) 启动 + O(1) 写,零新依赖。

## 组件二:IPC + bridge

`ipc.ts` 加 `ipcMain.handle("gladlog:matches:page", (_e, opts) => store.page(opts))`;preload/bridge 暴露 `bridge().matches.page(opts)`。`matches:list`/`get` 不变。

## 组件三:渲染端(App.tsx)

- 启动:`matches.page({ limit: 100 })` 取首屏(替代 `list()`);仍自动选中最新一场。
- 无限滚动:侧栏滚动接近底部且 `hasMore` 时,取 `page({ before: oldestLoaded.startTime, limit: 100 })` 追加。`hasMore` = 上一页恰好返回 `limit` 条。底部在拉取中显示「加载更早…」行。
- 新对局入库 → 前插(现有 `onMatchStored` 不变)。

## 数据流

启动 → init 一次读 `_index.ndjson`(+ 廉价 readdir 对账)→ 内存索引 → 渲染端 `page({limit:100})` → 首屏 100 行。下滑 → `page({before, limit:100})` → 追加。

## 错误处理

- `_index.ndjson` 缺失/损坏行 → 跳过坏行;整体缺失 → 从目录重建。
- 对账修复崩溃期的索引/目录分歧。
- `page` 入参防御:`limit` 下限 1、上限(如 500);`before` 非法 → 视为最近。
- 渲染端拉取失败 → 保留已加载,允许重试(不清空)。

## 测试策略(vitest)

- `matchStore.page()`:降序、`before` 边界(严格 `<`)、`limit`、空尾、无 `before` 取最近。
- 索引:append-only 追加 + init 去重(后写覆盖)、缺失时从目录重建迁移、readdir 对账(有目录无索引行 → 补入;有索引行无目录 → 丢弃)。
- 原子性:store 顺序(目录先、索引行后)。
- 渲染:初始 `page` 请求有界页;滚到底追加更早 metas;`hasMore` 终止(短页不再拉)。desktop 现有测试(matchStore/ipc/App)绿。

## 范围外

- 列表虚拟化(仅分页)。
- 摄取/解析改动。
- SQLite 迁移(如日后写入成热点或需复杂查询再议)。

## 未决事项

无(所有决策已确认)。
