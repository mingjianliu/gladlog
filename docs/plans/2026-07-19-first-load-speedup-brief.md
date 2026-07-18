# 首次加载提速任务书(交 agy 实现)

日期:2026-07-19。实测环境:M 系 Mac,`packages/desktop/dev/local/stress-long-3v3.json`(217MB,10 分钟局;用户真实库里典型 doc 为 64-80MB)。

## 实测基线(打开一场对局的全链路)

| 段                                                                                                   | 227MB            | ~70MB 典型 |
| ---------------------------------------------------------------------------------------------------- | ---------------- | ---------- |
| 主进程 `store.get`:readFileSync + JSON.parse(**冻结主进程**)                                         | 786ms            | ~410ms     |
| IPC structured clone                                                                                 | 701ms            | ~325ms     |
| renderer 首屏 derives 合计                                                                           | ~1330ms          | 估 ~500ms  |
| 其中重复 `toLegacySafe`(statsTable 489 + vulnBands 395 + burstLedger 424,各自内含一次 ~430ms 的转换) | —                | —          |
| renderer bundle 19MB parse/eval(每次启动)                                                            | 未单测,估 0.5-1s | 同         |

bundle 构成:`packages/analysis/src/data/spellNames.json`(12M)+ `talentIdMap.json`(3.1M)静态 import 进 analysis,被 renderer 整包吞下 ≈ bundle 的 80%。

## 三个改法(按 ROI 顺序,逐项独立提交)

### 1. `toLegacySafe` WeakMap 记忆化(renderer,最小改动最大收益)

`packages/desktop/src/renderer/src/report/derive/legacySource.ts`:
以 `source` 对象为键的 module 级 `WeakMap` 缓存转换结果。renderer 里 doc 不可变
(bridge 返回后从不修改),同一 source 的 N 次派生共享一次转换。
首屏 ~1.3s → ~0.5s,且切回放/AI 视图时的再转换全部消失。
加一条单测:同一 source 两次调用返回同一实例;不同 source 不串。

### 2. 主进程 parse 下沉 worker + LRU(设计已批,见 docs/plans/2026-07-19-large-match-load-optimization.md 方案 A)

`matchStore.get` 改 async:读文件 + JSON.parse 放进已有的 `workerHost.ts` 基建
(或一个专用 `parseWorker`),主进程加 2 条目 LRU(同一场重复打开免重解析)。
`ipc.ts` 的 handle 本就是 Promise,renderer 契约不变。
验收:打开 227MB 期间主进程能响应其它 IPC(写个探针:get 未决时发一个
matches:page 应 <100ms 返回);matchStore.test 全绿(get 调用点改 await)。

### 3. bundle 瘦身:两个巨型 JSON 拆出主 chunk(实验项,允许降级)

首选:`spellEffectData.ts` / `talentStrings.ts` / `utils/talents.ts` 对
`spellNames.json`、`talentIdMap.json` 改 **top-level await 动态 import**
(vite 会拆独立 chunk,主 chunk 少 ~15MB 的 JS parse/eval;Electron 的 Chromium
支持 TLA)。必须验证 `npm run build --workspace=packages/desktop`(electron-vite
生产构建)通过且 main 进程侧(analysis 也被 main 用)不炸 —— main 是 CJS 打包的话
TLA 会失败,此时降级方案:vite `manualChunks` 把两个 JSON 拆 chunk(仍启动即载但
JSON.parse 快于 JS eval),或仅把 `spellNames` 的消费改为可选延迟加载(fallback
名字先用 spellId,加载完成后无需重渲——它只是 prompt/文本 fallback)。
做不动就在提交信息里写明结论,不硬上。

## 验收门(每项提交前)

```bash
npm test --workspace=packages/desktop && npm test --workspace=packages/analysis \
  && npm run typecheck && npx eslint packages/desktop/src --quiet \
  && npm run build --workspace=packages/desktop \
  && npx tsx packages/desktop/scripts/smokeStressFixtures.ts
```

另跑复测脚本(改完对比基线,数字写进提交信息):

```bash
npx tsx -e "
import { deriveStatsTable } from './packages/desktop/src/renderer/src/report/derive/statsTable';
import { deriveVulnBands } from './packages/desktop/src/renderer/src/report/derive/vulnWindows';
import { deriveBurstLedger } from './packages/desktop/src/renderer/src/report/derive/burstLedger';
import { readFileSync } from 'fs';
const doc = JSON.parse(readFileSync('packages/desktop/dev/local/stress-long-3v3.json','utf8'));
const src = doc.data ?? doc;
for (const [n, f] of [['stats', deriveStatsTable], ['vuln', deriveVulnBands], ['ledger', deriveBurstLedger]] as const) {
  const t0 = Date.now(); (f as (s: unknown) => unknown)(src); console.log(n, Date.now() - t0, 'ms');
}
"
```

## 红线

- 谓词/派生语义零变化:只动缓存与加载时机,不动任何计算。
- renderer 不得值引入 `src/main/*`(v0.0.4 构建事故);跨界常量走 `src/shared/`。
- 每项独立 commit,格式 `perf(desktop): …`;不打 tag 不发版。
