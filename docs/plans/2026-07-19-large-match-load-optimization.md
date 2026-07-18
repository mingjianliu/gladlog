# 超长对局 match.json 加载优化(设计,待实现)

## 背景

UI 压测样本池(2026-07-19)实测:10 分钟野生对局的 match.json 达 **227MB**
(正式 app 存储同量级;5.5 分钟 CN 局 64MB)。headless derive 冒烟全过,
但加载路径有三重成本。

## 加载路径 trace(已确认)

1. `matchStore.get(id)`(`packages/desktop/src/main/matchStore.ts` 末尾):
   **主进程同步** `readFileSync` + `JSON.parse` —— 227MB 时冻住主进程,
   期间所有 IPC(包括其它窗口消息)停摆数秒。
2. `ipcMain.handle("gladlog:matches:get")`(`ipc.ts`)把整个对象
   structured-clone 序列化过 IPC —— 第二次全量遍历。
3. renderer 侧再持有一份完整拷贝;全部 `report/derive/*` 消费完整事件数组
   (faithfulness 门禁禁止丢事件,不能瘦身存储格式)。

## 方案(推荐 A)

- **A. 解析挪出主线程 + 缓存(低风险,推荐)**:`get` 改 async;读文件与
  `JSON.parse` 放进已有的 `workerHost.ts` worker;主进程加 1-2 条目的 LRU
  (重复打开同一场免重解析)。IPC/renderer 契约不变(`invoke` 本就是
  Promise)。消除主进程冻结;IPC clone 成本保留。
- B. 自定义二进制/分节格式(mmap 式懒加载)——收益最大但动存储格式与
  全部 derive,重构级。
- C. renderer 端 Web Worker 解析 —— 只救 renderer 帧率,救不了主进程冻结,
  且 IPC 传原始字符串需改契约。

## 验收

- stress-long-3v3.json(227MB)打开期间主进程可响应其它 IPC(加探针测);
- `smokeStressFixtures.ts` 全过;desktop 225 测试 + typecheck + lint 绿;
- 打开耗时 before/after 记录在本文档。
