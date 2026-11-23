# 界面语言(中 / 英)设计稿

日期:2026-11-23 · 状态：用户已批准(2026-11-23)

## 1. 意图

用户可以在**安装时**和**设置页**选择中文或英文。选定之后,用户在 app 里看到的**所有文字**都是这种语言:界面、报错、对话框、AI 回复、问教练。

为什么要做:用户没明说,这里按「让英文玩家也能用」理解(README 和用户文档已经是中英双语)。如果理解错了,不影响下面的设计。

## 2. 目标 / 非目标 / 反目标

**目标**

- 一个统一的「语言」设置(`zh` | `en`),同时管界面和 AI 回复。
- renderer、main、shared 里所有**会显示给用户**的文字都走词典,中英两份,不能有遗漏。用户已确认一次全部改完(包括 DevPanel)。
- 设置页切换语言**立即生效**,不需要重启。
- Windows 安装器可以选语言;macOS 在第一次启动时选。
- 加确定性 CI 检查,防止以后又写死中文。

**非目标**

- **送给模型的数据正文不翻译**。时间线、`[YOU] [CD]`、`[CONSEQ]` 等事实行保持英文(这是英文契约:门规会重新解析英文文本,`CJK_LEAK` 也会拦中文)。用户已确认只做「给模型的指令和回复」这一层。
- 不做第三种语言,也不为第三种语言预留抽象。
- 不翻译 eval / analysis 的内部注释、签字记录(`note` / `source` 字段)、日志(`console.*`)、开发脚本。
- 玩家名、录像文件名这类数据本身不翻译。

**反目标**(功能能跑也算失败的情况)

- 英文模式下界面里还残留中文,或者中文模式下出现没翻译的 key 名或英文。有两类明确豁免:(1) 中文模式下，战报句子里嵌入的分析层英文事实短语(§6.14);(2) 以前用另一种语言生成、现在加了语言标签显示的 AI 内容(§6.13)。
- 改动让 prompt 正文或门规行为发生任何变化(prompt 哈希必须不变,见 §7)。
- 英文术语和 prompt / 文档里已有的英文说法对不上(例如界面写 "missed dispel",prompt 写 `missed-cleanse`)。

## 3. 现状(2026-11-23 实测)

- `settingsStore.ts` 已有 `aiLanguage: "zh" | "en"`(默认 `zh`)。`analysis.ts` / `coachChat.ts` / `learning.ts` / `compare.ts` / `localAiBackends.ts` / `ai.ts:74` 会读它，来决定回复语言和缓存键。这部分**保留**,只是改读新字段。
- renderer 里有约 1080 行写死的中文(不含注释和测试),main 里约 80 行(报错、对话框标题),shared 里 6 行。最多的几个文件:SettingsPanel(146)、report/derive/mistakes.ts(133)、DevPanel(70)、StatsDashboard(61)、EventsPanel(54)、MatchReport(49)。
- 少数 derive 已经接收 `lang: "zh" | "en"` 参数：`findingDisplay.ts`(severityLabel / categoryLabel / TYPE_LABEL)、`inlineRich.tsx`、`cohortDims.ts`、`aiRunStatus.ts`、FindingsList / KeyMomentAxis / CohortDimsTable。lang 现在的来源是 MatchReport 自己读一次 settings(`MatchReport.tsx:799`),不是全局的。
- analysis 包里也有一些会显示给用户的文字，已经带 lang 参数：`metricLabel` / `verdictLabel`(compare/metricLabels.ts)、`habitBadgeText`(learning/matchRules.ts)、`distillRules`。还有写死中文的，例如 `selfCastNoopAnnotatedName`(cooldowns.ts,拼出 `(仅可施于队友,不可自保)`),需要逐个排查(见 §6.5)。
- 技能名：中文模式下，`inlineRich.tsx:146` 用的是日志名 → `SPELL_NAMES_ZH_GENERATED` → 原名;英文模式直接用原名。用中文客户端录的日志，原名本来就是中文。
- 专精名：中文模式用 `SPEC_NAMES_ZH`,英文模式用原名(本来就是英文)。
- 没有全局的语言 context。renderer 现有的 context 只有 `pageActive.ts` 和 `UnitName.tsx`。App 在从设置页 / 开发页返回时，会通过 `reportEpoch` 重新挂载战报(`App.tsx:337`)。
- 安装器:electron-builder 的 NSIS,`oneClick: false`,没有自定义 `.nsh`。
- `index.html` 的 `<html>` 没有 `lang` 属性。
- renderer 里有 11 处用了 `toLocale*` / `Intl.*`。
- 198 个测试文件断言了中文文案。

## 4. 做法(用户已选 B)

|             | 做法                                                       | 取舍                                                                                 |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A           | 就地双语 `L("中","En")`                                    | 中英并排、不用起 key、迁移量最小;将来加语言要重构                                    |
| **B(已选)** | **词典文件 + 有类型的 key `t("settings.language.label")`** | 翻译集中，方便通读和交给别人翻译;要给约 1100 处文案起 key 名，读代码时看不到实际文字 |
| C           | i18next                                                    | 功能最全，但对两种语言来说太重，同样要起 key;不选                                    |

用户选了 B。

## 5. 已经定下的(用户决定)

1. 只翻「给模型的指令 + 回复 + 界面」,数据正文保持英文。
2. 界面一次性全部改完。
3. 用 B:词典文件加 key。
4. 统一成一个语言设置;安装器可选;设置页可以随时改。
5. 战报 AI 卡片里的「中文 / EN」小切换**去掉**,语言只在设置页改(§6.12)。
6. 中文模式下句子里夹的分析层英文短语，这一轮**先不管**,开 GH issue 记下(§6.14)。
7. 切换语言后，旧语言的 AI 结果**照常显示，并加语言标签和「用当前语言重新分析」按钮**(§6.13)。
8. 老版本的设置不迁移：语言存在新字段里，老用户升级后也要走一遍语言选择(§6.1);设置页上的语言选项移到最上面(§6.11b)。

## 6. 设计

### 6.1 设置字段与迁移

- `GladlogSettings` 新增 `language: "zh" | "en" | null`,把 `aiLanguage` **替换**掉，不做迁移。**`DEFAULTS.language` 必须是 `null`**:`save()` 每次都会写出完整设置，如果默认值是 `"zh"`,用户还没选就会被写死成中文，首启选择框也就永远不会出现(旧的 `aiLanguage` 就是这样失去「是否用户选的」这个信息的)。只有用户在选择框或设置页里明确选了，才写入非 null 的值。类型 `AiLanguage` 改名为 `Language`(保留 `AiLanguage` 作为别名，减少改动)。
- 读取顺序:
  1. `settings.json` 里有 `language`,直接用。
  2. **不读旧的 `aiLanguage`**(用户决定 2026-11-23:「老版本不用管，新版本更新设置位置，激活这个功能」)。语言存在新字段 `language` 里，旧字段 `aiLanguage` 在下一次保存时删掉。老用户升级后和全新安装一样，继续往下走第 3、4 步。
  3. 否则用安装器写入的值(§6.6)。全新安装和手动覆盖安装都会写这个值。
  4. 否则标记为「未选择」,renderer 首次启动时弹出选择框(§6.7),默认值按 `app.getLocale()` 判断:以 `zh` 开头就是 zh,其余是 en。
- 结果：自动更新上来的老用户，首次启动新版本时会看到语言选择框(自动更新是静默安装，不会写安装器的值，见 §6.6);手动下载安装包覆盖安装的老用户，直接使用安装器里选的语言。
- 在第 3、4 步得出语言之前，main 侧需要语言的地方(报错、AI 回复)临时按 `app.getLocale()` 推断，不写入设置。
- 所有现在读 `settings.aiLanguage` 的地方改读「有效语言」(`language ?? 按 locale 推断`)。AI 缓存键的语言部分**值不变**(仍然是 `zh` / `en`),所以已有缓存继续可用。

### 6.2 词典结构

```
packages/desktop/src/shared/i18n/
  zh.ts          # 基准，嵌套对象，按区域分命名空间
  en.ts          # 类型为 Messages(= 由 zh 推导出的结构),漏一个 key 就 typecheck 失败
  index.ts       # Language 类型、translate(lang, key, params)、Key 类型
  glossary.ts    # 术语表(§6.8)
```

- 命名空间按界面区域划分:`common`、`nav`、`settings`、`matchList`、`report.*`(下面再按卡片划分:`report.mistakes`、`report.deathRecap`、`report.events` …)、`stats`、`batch`、`update`、`recorder`、`dev`、`errors`(main 的报错)、`dialogs`(main 的对话框标题)。
- `Key` 是由 `zh` 推导出的点路径联合类型(模板字面量类型),所以 `t("settigns.x")` 这种拼写错误在 typecheck 阶段就会报出来。
- 值的形式：普通字符串，支持 `{name}` 插值。需要复数或语序变化时，值可以写成 `(p) => string`,zh 和 en 两侧各自实现。
- `translate` 是纯函数，没有副作用，放在 `shared/`,main 和 renderer 都能 import(符合 desktop-dev「跨进程共用的放 src/shared/」)。
- 现有 derive 里的私有映射表(`SEV_ZH`、`CATEGORY_ZH`、`TYPE_LABEL` 等)迁到词典里;derive 的 `lang` 参数保留，内部改成调用 `translate`。

### 6.3 renderer 接入

- 新增 `LangProvider`(包在 App 根上)和 `useT()` hook。`useT()` 返回 `{ t, lang }`,`t` 已经绑定了当前语言。
- Provider 启动时读一次 settings。SettingsPanel 保存 `language` 时，通过 provider 暴露的 `setLang` 同步更新，所以不需要 main 再广播。如果其他地方也会改语言，由 builder 决定是否另外加 `gladlog:settings:changed` 事件。
- 现在 MatchReport 自己读 `aiLanguage` 的逻辑(`aiLang` state)改为从 `useT().lang` 取。`reportEpoch` 重新挂载的机制保留。
- 切换语言时设置 `document.documentElement.lang`(`zh-CN` / `en`),窗口标题也跟着换。
- 日期和数字格式化(11 处 `toLocale*` / `Intl.*`)改用当前语言对应的 locale(`zh-CN` / `en-US`)。时区规则不变(那段注释里说的固定时区行为保持原样)。

### 6.4 main 进程

- main 里会显示给用户的文字(`localAiBackends.ts` 的「未检测到 xx 命令」、`deepseekClient.ts` 的超时、`coachChat.ts` 的「已停止」、`ipc.ts` / `exportImage.ts` 的对话框标题等)改成 `translate(getSettings().language, key, params)`,在抛出或显示的时候按当前语言取值。
- 已经写进缓存或文件的报错文本(比如分析失败时存下来的 message),保持写入时的语言，不回头翻译。
- `console.*` 日志、`throw` 出来只给开发者看的内部断言(比如 `e2eEnv.ts`),不在本次范围内。判断标准：会不会进入 renderer 显示。
- 如果有应用菜单 / 托盘 / 系统通知，也一并处理(目前代码里没找到，由 builder 确认)。

### 6.5 analysis 包里会显示给用户的文字

- builder 先列出 renderer 和 main 从 `@gladlog/analysis` import、**并且会显示出来**的函数，再看每个函数是否会产出中文。已知的有 `selfCastNoopAnnotatedName`。
- 处理原则:analysis 包**不依赖** desktop 的词典。有两种改法:(a) 改成返回结构化结果(例如 `{ name, selfCastNoop: true }`),由 renderer 去翻译;(b) 和 `metricLabel` 一样接收 `lang` 参数。如果函数**也被 prompt 构建使用**,只能用 (a),或者给 prompt 路径固定传 `en`,确保 prompt 字节完全不变(§7)。
- 已经带 lang 参数的(`metricLabel`、`habitBadgeText`、`distillRules`)不动，只改调用方，从 `useT().lang` 传入。
- **选段(窗口)分析的 prompt**(Claude 的决定):`deepDive.ts` 的 `buildWindowAnchorFinding`(`用户选段 …` / `该窗口由用户手动选取…`,基于 `PACK_ITEM_KIND_ZH`)以及 deepDive pack 标签(`敌 X(…)`、`走位:…`),现在不管哪种语言都会把中文发给模型(`main/analysis.ts:1421` 调用)。这些属于「给模型的指令」这一层，改成跟随语言：英文模式发英文，中文模式保持原来的字节不变。所以 §7 的「prompt 不变」只冻结**数据正文**(`buildMatchContext` 产出的时间线和事实行),以及中文模式下全部 prompt 的字节。

### 6.5b 依赖界面文案的语料门规

- `eval/scripts/scan5/t196.ts` 会从 `desktop/src/renderer/src/report/derive/kickText` import `MISSED_KICK_TEXT` / `missedKickLabel`,检查战报的中文措辞(Claude 的决定):这类门规**继续固定检查中文**,改成通过 `translate("zh", key)` 从词典取同一个值(单一来源);英文措辞的正确性交给 §6.9 的检查。builder 用 grep 找出 eval 里所有 import desktop 文案的地方，一并按这个方式处理。

### 6.6 Windows 安装器

- electron-builder `nsis`:`multiLanguageInstaller: true`,`installerLanguages: ["en_US", "zh_CN"]`。安装器一开始会让用户选语言，安装器自己的界面也会变成对应语言。
- 新增 `build/installer.nsh`,在 `customInstall` 宏里按 `$LANGUAGE`(2052 → zh,其余 → en)写入 `HKCU\Software\gladlog\InstallerLanguage`。main 在 §6.1 第 3 步读取它(只在 win32 上读，读失败当作不存在)。
- **静默安装(自动更新)时不写注册表**(在 `customInstall` 里用 `${If} ${Silent}` 跳过),否则 `$LANGUAGE` 会取一个用户没选过的默认值，静默地替老用户做了决定。只有交互式安装才写。
- 即使注册表里有值，§6.1 也只在 settings 的 `language` 为 null 时才读它，所以已经选过语言的用户以后再覆盖安装也不受影响。
- builder 负责确认 electron-builder 当前版本里这些选项的名字和宏的写法，并在 Windows 打包产物上实际安装验证(§7)。

### 6.7 首次启动选择框(macOS / 没有安装器记录的情况)

- 如果 §6.1 得到的是「未选择」,renderer 在显示主界面之前弹出一个小窗口：两个按钮「中文」「English」,默认高亮按系统语言判断的那个，选完立即写入设置。
- 这个窗口本身用双语显示(同时写「选择语言 / Choose language」),因为这时候还不知道用户读哪种语言。

### 6.8 术语一致性

- `glossary.ts` 列出核心术语的中英对照(发现类型 `cd-waste` / `missed-cleanse` / `missed-purge` …、类别、严重度、界面里常见的概念)。英文**优先沿用 prompt 和英文文档(docs/user-guide.md)里已有的说法**,例如 FindingCategory 的英文 slug 和 `TYPE_LABEL` 的 key。
- 词典里的英文值从术语表引用或者和它保持一致。builder 给出一份初版英文，在开始大规模翻译之前，**先把术语表交给用户过目**(只需要看这一份，不用逐条看 1100 处)。

### 6.9 确定性检查(CI)

放在 `packages/desktop` 的测试里，随 presubmit 运行:

1. **不允许写死中文**:用 TypeScript AST 扫描 `src/renderer`、`src/main`、`src/shared` 下的非测试源码，找出包含 CJK 字符的字符串字面量、模板字面量和 JSX 文本，排除 `shared/i18n/zh.ts`、`glossary.ts` 和 §6.7 的双语选择框。剩下的允许清单(比如 `console.*` 参数、内部断言)要写清每一条的理由，并且只允许减少。注释不算。
2. **英文词典里不能有中文**:`en.ts` 的所有值(包括函数形式的执行结果，用样例参数跑)都不能包含 CJK 字符。
3. **不能漏翻**:`en.ts` 的值不能和 `zh.ts` 对应的值完全相同(纯数字、符号、专有名词放进显式的豁免列表)。
4. **插值占位符一致**:同一个 key 在中英两侧的 `{name}` 占位符集合必须相同。

### 6.10 测试

- 默认语言保持 `zh`,已有的 198 个测试文件断言的中文应该基本不用改;如果文案搬进词典后有改动，测试也跟着改。
- 新增：主要页面(设置、对局列表、战报各卡片、统计、批量)各有至少一个英文模式的渲染测试，断言里不含 CJK 字符(复用 §6.9 的 CJK 正则，正则来自 analysis 的 `CJK_LEAK`,单一来源)。
- 新增：settingsStore 语言解析的单测，覆盖以下情况：有 `language`;只有旧的 `aiLanguage`(必须被忽略);有安装器的值;什么都没有(返回「未选择」);保存其他设置后 `language` 仍然是 null。

### 6.11 文档

- `docs/user-guide.md` 和 `docs/user-guide.zh-CN.md` 增加「语言」一节，两个版本要等价(双语文档规则)。
- `CHANGELOG.md` 和 `.zh-CN` 写明：统一语言设置;老用户升级后首次启动会被要求选一次语言，原来的「教练回复语言」设置不再沿用。
- 如果 README 里有关于界面语言的描述，一并更新。

### 6.11b 设置页上的位置(用户决定)

- 语言选项从「AI 分析」那一栏(现在叫「教练回复语言」)移到设置页**最上面**,作为通用设置，标签改为「语言 / Language」,双语显示，选项是「中文」「English」,保存后立即生效。

### 6.12 去掉 AI 卡片里的语言切换(用户决定)

- 删掉 `StructuredAnalysisPanel.tsx` 里的「中文 / EN」切换(`switchLang`、`langSwitches` 等)。卡片的语言改从 `useT().lang` 取，缓存查询仍然按语言取键。
- `ProComparisonVerified.tsx:104` 自己读 `aiLanguage` 的地方，也改成 `useT().lang`。
- 用 grep 确认 renderer 里没有其他地方直接写 `settings.save({ aiLanguage })`。

### 6.13 旧语言的 AI 内容(用户决定)

- 保留现在的跨语言回退(`analysis.ts` 的 `crossMatchCandidatePaths`、`learning.ts` 的 `collectExamples`、legacy `analysis-v2.json`)。
- 显示的内容如果是用**另一种语言**生成的(包括单局分析、汇总 / 笔记本 / 学习视图里的条目、学到的规则、问教练的历史记录),就在旁边标上语言标签(例如英文模式下标「Analyzed in Chinese」,中文模式下标「英文分析」)。单局分析卡片上再给一个「用当前语言重新分析」按钮，走现有的重新分析流程，写入当前语言的缓存。
- 返回值要带上内容的生成语言：缓存路径和文件本身已经能区分语言(legacy `analysis-v2.json` 当作 en,沿用现有约定，由 builder 确认)。学到的规则和聊天记录如果没有存语言字段，就新增一个;旧记录没有这个字段的，用 `CJK_LEAK` 判断文本内容来推断。
- 汇总视图里一条条混在一起的列表，只标条目，不提供逐条重新分析的按钮。

### 6.14 句子里夹的英文事实短语(用户决定：这一轮不管)

- 中文模式下 `report/derive/mistakes.ts` 的 `candidateDetail` 等，把分析层的英文事实短语(`mitDefers`、`ownerWhy`、`othersFeasible`、`selfDmgTrend`、`refTop`、`extras`、`postKick` 一类)原样嵌进中文句子。这一轮保持原样，句子框架的中文照常搬进词典(英文模式下框架是英文，嵌进去的短语本来就是英文，正好一致)。
- 开一个 GH issue 记录「中文模式下事实短语的翻译」,写明可能的做法(分析层输出结构化枚举，同时不改 prompt 字节)。

## 7. 验收

- **prompt 不变**:对同一批对局(用 605 采集里的固定子集或测试夹具),改动前后:(1) 在 `zh` 和 `en` 两种设置下，送给模型的 prompt **数据正文**哈希完全相同;(2) `zh` 设置下所有 prompt(包括系统指令和选段分析)的字节完全相同。`en` 设置下只有选段分析的锚点和 pack 标签会有意变化(§6.5),变化要列出来。
- **英文模式没有中文**:用 run-ui 测试床打开代表性战报，英文模式下渲染出来的 DOM 文本里 CJK 字符数为 0。除外的只有：玩家名、日志里查不到英文名的技能名(§8 第 1 条),以及带了语言标签的旧语言 AI 内容(§6.13)。报出改动前后的数字。
- **CI 检查**:§6.9 的四条检查通过，并且先做变异测试(故意写一处中文字面量，确认检查会变红)。
- **安装器**:在 Windows 打包产物上实际安装两次(分别选中文、英文),首次启动的语言都正确;在一个装了旧版本的系统上，自动更新后首次启动会弹出选择框，手动覆盖安装则直接使用安装器里选的语言;已经选过语言之后再覆盖安装，设置不变。
- presubmit 全绿。

## 8. 留给 builder 的决定(我已经定了的，标为 Claude 的决定)

1. **英文模式下的技能名**(Claude 的决定):用中文客户端录的日志，英文模式下技能名改用 prompt 路径在用的英文名查表(`getEnglishSpellName` 那一路，单一来源);查不到就显示原名。中文模式保持现在的行为。
2. key 的具体命名和命名空间划分细节。
3. 是否加 `settings:changed` 广播(§6.3)。
4. 迁移的顺序和批次怎么分。建议：先搭好框架、设置和首启选择框，再按目录逐批迁移，每一批迁完就把那个目录加进 §6.9 的扫描范围;全部迁完后扫描覆盖全量。
5. DevPanel 一起翻译(用户说了全部改)，但优先级最低。
