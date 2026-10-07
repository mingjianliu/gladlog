# 性能:大 JSON 与对局库规模

## 大 JSON 走 JSON.parse

Vite 5 默认把 JSON 导入编译成 JS 对象字面量,V8 当源码解析。`spellNames.json`(41 万键)曾让首屏固定卡约 22 s,同数据 `JSON.parse` 42 ms。修法 `json: { stringify: true }`(electron.vite 三个目标 + `dev/vite.config.mts`)。

- 往 bundle 加大表前确认走 JSON.parse;定位首屏卡顿看「相邻网络请求间最大空档」。`[budget] coldStart / firstPaint` 守着。
- analysis barrel 里 data 模块的顶层 await 会让 tree-shaking 失效,谁静态碰 barrel 谁全款买单;大表已去 TLA 惰性化,契约在 `packages/analysis/src/data/ensure.ts`。
- renderer 生产构建要显式 `minify: 'esbuild'`。

## 对局库规模(2026-07-26 实测)

match.json 中位 77 MB、p75 167 MB、最大 442 MB(shuffle);raw.txt 中位 12.4 MB。

- **任何「整场文档 → stringify / DOM / IPC」的无上限路径都会冻死**。新 UI / IPC 面按中位 77 MB、最大 442 MB 估算,必须截断 / 分页 / 流式。442 MB 已逼近 V8 单字符串 512 MB 上限。
- 复现用 Playwright electron 探针 + `GLADLOG_E2E_USER_DATA` 指向临时 userData。

## 已修(勿重复)

renderer minify、main 不再启动即载大表(按需 import)、Timeline 降采样、图标表字典编码、泳道 / 事件表窗口化、回放二分采样、readNthLine 流式取行(**rawLines 字节精确是契约,不能用 readline,它吞 `\r`**)、rebuildIndex 异步、全库瘦身、doc 字节直传(get 1,244 ms → 37 ms)。

## 仍未做

spellNames 收敛到观测宇宙(会改可用法术名,做前需语料实证);React.lazy 路由分割;worker 解析完自己写盘只回传 meta(消掉约 90 MB IPC 克隆)。动手前沿用审计数字、同判据对比。

相关:[desktop-ui.md](desktop-ui.md)、[test-build-ci.md](test-build-ci.md)
