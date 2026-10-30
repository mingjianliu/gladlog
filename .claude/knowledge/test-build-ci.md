# 测试、构建、CI 与发版的坑

typecheck 只用 `npm run typecheck`、lint 在仓库根、presubmit 全套——见 CLAUDE.md。发版流程见 skill `release`。

## ensureAnalysisData

每个构建 prompt / 候选的入口先 `await ensureAnalysisData()`(`packages/analysis/src/data/ensure.ts`;spellNames / talentIdMap 后台加载)。不等的话进程启动头几秒的对局冷却 / 充能 / 技能名全错;语料脚本不等会让**绝对值**全错(候选 2,105 vs 正确 2,533,前后差值仍有效)。`packages/eval/test/ensureAnalysisDataEntrypoints.test.ts` 守新入口。怀疑时同一场隔 20 秒各跑一次比对。

## desktop 的工作区依赖

`externalizeDepsPlugin` 默认把 package.json 声明的依赖外部化成运行时 `require`,而 `@gladlog/*` 的 `main` 指向 `.ts` 源码 → 打包后崩窗口。要么不声明(打进 bundle),要么声明 + 加进 main 与 preload 两处 exclude。`test` 绿 + `frontend-qa` / E2E 红 = 打包 / 启动问题。只有 `electron-vite build`(presubmit 里)能抓到 renderer 值导入 main 模块的泄漏。

## vitest

- 本地混合隔离:`test/support/runVitest.ts` 两遍调用,名单 `vitest.shared.json` fail-closed;CI 与 `GLADLOG_TEST_ISOLATE=all` 全隔离。坑:vitest 2.1 forks 池只看根配置的 isolate;setup 文件静态 import 重模块会让测试文件的 `vi.mock` 失效(setup 里用 beforeAll 动态 import);改开关的测试一律 save / restore。
- desktop 要在包目录里跑(根目录跑不加载 `packages/desktop/vitest.config.ts`);单文件直跑会绕过 workspace 配置出伪影,拿不准就 `npm test --workspace=packages/<pkg>`。
- 改广泛构造的类型前 grep 出全部构造点(含 `test/`、`dev/`、`qa/`)。仓库没装 jest-dom。
- 多会话同时跑 presubmit 时 parser 的 parseBudget 会因负载超时(负载问题,不是代码错)。

## flaky 只在 CI 满载红

根因形状:「复位状态」的被动 effect 排在交互之后,交互被静默撤销;RTL waitFor 的 setTimeout(0) 与 React setImmediate 竞速只在高负载出现。确定性复现:`IS_REACT_ACT_ENVIRONMENT=false` + `createRoot().render` + MutationObserver 微任务里交互(`packages/desktop/test/support/untilDom.ts`)。**绝不制造整机负载复现。**

## `tsc -b` 污染

若 `src/` 里出现与 `.ts` 同名的 `.js`,那是 tsc emit——删掉每个有 `.ts` 兄弟的未跟踪 `.js` 和 `packages/*/tsconfig.tsbuildinfo`,否则 vite / vitest 会解析到旧 `.js`,改动像没生效。

## CI 判读

- 后台 `gh run watch … && echo GREEN || echo RED` 这类包装永远退出 0。收到完成通知后先读输出,核对 run id 的 headSha 与本次推送一致、结论行是什么,才对外报(一次凭旧 run 缓存误报全绿,main 红了 3 小时)。看失败日志用 `gh run view <id> --attempt 1 --log-failed`。
- **tag 推了却没有 run**:GitHub push 事件偶尔不投递。约 1 分钟没见新 run 且按 head_sha 查为 0 → `gh workflow run build.yml --ref v0.x.y`(dispatch 跑在 tag ref 上,Release 步骤照常)。不要重推 tag。

## 前端质检

- **本机绝不跑 `npm run test:visual`**:基线 linux 单源,缺基线时 Playwright 会把 mac 截图写成基线。本机只跑 `test:visual:smoke`。更新基线走 `visual-baseline.yml` workflow → 下载 artifact → 人眼审图 → 只提交真变了的那几张。
- 截图容差 `threshold 0.05 + maxDiffPixels 100` 是校准过的;改前做守门验证(故意改一处配色看 CI 是否红)。
- **只挂 firstPaint** 时它测的是 runner 当天的状态(同一 commit 4,722 / 5,154 ms):`gh run rerun <id> --failed` 同 SHA 重跑,绿即证伪;**不要调高预算**(放宽门规是用户的决定)。真怀疑变慢先查 bundle 里有没有新增大 JSON。

## 打包(electron-builder 26)

pin `build.electronVersion`(不接受范围);**不要加限制性 `files`**(会丢外部化的依赖);运行时按路径读的数据进 `extraResources`;`--win` 默认宿主架构,要 `--x64`;mac ad-hoc 签名靠 `afterSign` 钩子 `codesign --force --deep --sign -`(`CSC_IDENTITY_AUTO_DISCOVERY=false` 会产出坏签名);版本号要和 tag 对上;加了 `build.publish` 后打包脚本必须 `--publish never`;NSIS `artifactName` 用点不用空格(空格会让自动更新 404);上传 glob 收窄成 `latest*.yml`。

相关:[shell-and-git-traps.md](shell-and-git-traps.md)、[desktop-ui.md](desktop-ui.md)
