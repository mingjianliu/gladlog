# 桌面端与报告 UI 的定论和坑

日常约定在仓库 skill `desktop-dev` / `run-ui`。这里只记别翻案的定论和会再踩的坑。

## 架构模式

- renderer 可直调 analysis:`report/derive/*` 里 `toLegacySafe(source)` → analysis 谓词函数(垫片给缺失的单位事件数组补空,裁剪 fixture 用裸 `toLegacyMatch` 会抛)。渲染层零白名单、零常量复制。
- **VISION 忠实性模式**:渲染数学抽成 `report/derive/` 纯选择器,组件是哑渲染,`checkFaithful` 走 DOM 比对;**绝不重新推导聚合或重算分位(循环论证)**;每个检查都有「故意撒谎的渲染必须被抓」的 has-teeth 测试(`npm run verify:vision`)。每个检查都要能被 agent 无头调用并输出机读 diff。
- finding 标记键 = `category|sorted(eventIds)`,**语言无关**,`findingKey` 在 `src/shared/` main / renderer 共用;category 是英文枚举 slug + 渲染侧词表,别让模型直接输出中文类目。
- 回放时钟是 ReplayView 局部 state,跨视图 seek 用 nonce 请求 prop,别提升热 state。
- 泳道 / prompt 同源要有 parity 测试(泳道数 = prompt 行数),红了说明谓词分叉,收敛到共享符号而不是放松测试。Timeline viewBox 宽与 `TIMELINE_BUCKETS` 是配对不变量。
- **renderer 禁止 import `analysisCache.ts`**(Node 依赖);纯槽逻辑在 `shared/analysisSlots.ts`。只有 electron-vite 生产构建能抓这类泄漏。
- 窗口 bounds 记在 `userData/window-state.json`,别并进 settingsStore(有密钥加密不变式)。

## 布局 / 视觉

- 4K 屏在 macOS 默认缩放下是 **1920 CSS px** 视口;双栏断点 ≥1440 px;视觉基线三档 1280 / 1440 / 1920。
- topbar 实测 55 px;修高度的作用域用 `:has(.app-layout), :has(.dev-wb)`,**不能直接把 `.app-container` 变 flex**(战绩页 `.dash` 会退成 shrink-to-fit 变窄,单测看不出)。
- 贴底别用 `margin-top: auto`(组件可能不渲染),让有内容的元素 `flex: 1`。
- 验收必须过真实数据:fixture 短名掩盖了跨服全名把右栏顶出横滚。
- 隐藏标签页里 IntersectionObserver / scroll 事件被节流,事件表加载用容器 onScroll 近底判定。
- 新增无可聚焦元素的滚动容器要 `tabIndex={0}` + aria-label,否则 axe 红。

## fixture / 测试台

- 日常迭代 report UI 首选 `npm run dev:ui` 测试台(端口 5199,`?scene=…`、`?review=…`);`VITE_FIXTURE_MODE=1 npm run dev` 走完整 App。真实 log 喂 dev:ui 的配方写到 `dev/local/full-match.json`(gitignored,用完别留)。
- `installAppShellFixture` 是多个场景共用的,场景专用补丁拆成独立函数按场景名调用。
- 图标 fixture 别拿 spellId=1 当「无图标」(有占位图标),用 3 或 999999999;真名表里有 "Death"、单字符 "s" 之类的垃圾名。

## 功能定论

- **批量分析**:规范路径在 renderer,复用 `report/derive/analysisInput.ts`;单元级并发池 3;**shuffle 的 meta.id = 首回合 id,不可按 analyzed set 预过滤**,驱动器逐回合查缓存。自动分析只响应 `matchStored{live:true}`,导入洪峰不触发。
- **问教练**:聊天不自己播种,直接 resume 那次分析的 CLI session;三个 CLI 的 session 接口各不相同(codex 必须去掉 `--ephemeral`)。session 行为桩不出来,必须真 CLI smoke。
- **「分析中卡很久、去别的页回来突然有了」** 根因 = CLI 假流式 + 卸载重挂载从 getState 回填,**不是事件丢失**,别往那修。
- **自学习**:台账前向积累、不随 PROMPT_VERSION 作废;库里几乎没有分析缓存时 UI 看不到规则是数据现实不是 bug。
- **Windows 自动更新**(NSIS):mac / zip 结构性不启用;变异测试才是真验收。
- 平台类(Windows CLI 检测、托管 OBS、选段 AI 的点击层)模拟够不着,只能确定性单测 + E2E,每次改完写清「待真机」。

## 用户已裁的有意偏离(勿再提)

无录像对局的「录像」tab 保持隐藏;失误行左边框色 / 轻微无条件折叠不做;开发者页不做「解析器版本」(版本号不随改动 bump,摆出来是伪装成溯源的常量)。**采纳外部评审前先核前提**(一次评审四个前提是错的,如事件表其实已虚拟化)。

相关:[perf.md](perf.md)、[test-build-ci.md](test-build-ci.md)、[obs-recording.md](obs-recording.md)
