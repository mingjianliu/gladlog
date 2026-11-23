# 界面语言(中 / 英)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个统一的语言设置(中 / 英)控制 gladlog 桌面端所有用户可见的文字(界面、报错、对话框、AI 指令和回复);安装时和设置页都能选。

**Architecture:** 在 `packages/desktop/src/shared/i18n/` 建扁平 key 的中英词典和纯函数 `translate`,main 和 renderer 共用。renderer 用 `LangProvider` + `useT()` 注入当前语言。设置里新增 `language: Language | null` 字段，替换掉 `aiLanguage`,不做迁移;`null` 表示还没选，此时弹首启选择框。用一条 AST 扫描测试锁住「源码里不准写死中文」,按目录分批迁移文案，每迁完一批就把该目录从待迁清单里删掉。

**Tech Stack:** TypeScript、React 19、Electron、vitest 2 + @testing-library/react 16、electron-builder 26(NSIS)、`typescript` 编译器 API(用于扫描)。

**Spec:** `docs/superpowers/specs/2026-11-23-ui-language-design.md`(执行者两份都要读;下文的 §x 都指 spec 的章节)

## Global Constraints

- 语言值只有 `"zh"` 和 `"en"`;`DEFAULTS.language` 必须是 `null`(§6.1)。
- 不读旧的 `aiLanguage`,下次保存时从磁盘删掉它(§6.1 第 2 步)。
- 送给模型的**数据正文**(`buildMatchContext` / `buildFindingsPrompt` 的产出)在 zh 和 en 设置下逐字节不变;zh 设置下所有 prompt 逐字节不变;en 设置下只有 deepDive 的 pack 标签和选段锚点会变(§6.5、§7)。
- analysis 包不能 import desktop 的词典(§6.5)。
- renderer 和 preload 从 `src/main/*` 只能 `import type`;共用的值放 `src/shared/`(desktop-dev 约定)。
- 英文术语沿用 prompt 和 `docs/user-guide.md` 里已有的说法，术语表要先给用户过目，再开始大规模翻译(§6.8)。
- 默认语言(测试里没有 provider 时)是 `zh`,已有测试的中文断言保持有效。
- 每个批次推送前跑 `npm run presubmit`(从仓库根目录跑，不要在复合命令里 `cd`);修复推送前要过 codex 审查(`.claude/skills/cross-ai-review`)。
- 直接 commit 并 push 到 main,只 `git add` 自己改的路径(`packages/desktop/.impeccable/hook.cache.json` 不是我们的，不要碰)。

## Review Focus

1. **还没选语言时就收到报错或 AI 请求**(首启选择框还没点，或者在 main 里先走到了需要语言的路径)→ 应该按 `app.getLocale()` 推断出语言，而且**不能**把推断结果写进设置。测试放在 Task 2。
2. **保存别的设置(比如改 WoW 目录)之后，`language` 被默认值填成非 null**→ 首启选择框就再也不会出现。测试放在 Task 2。
3. **英文模式下显示的是回退来的中文 AI 结果，用户却在上面点了深挖 / 选段**→ 结果会写进英文缓存，和旧内容拼在一起。显示回退内容时，只保留「用当前语言重新分析」这一个操作。测试放在 Task 8。
4. **在设置页切换语言的时候，战报正开着、AI 分析正在跑**→ 正在跑的那一轮按发起时的语言完成，写进发起时那种语言的缓存，不会写错文件。测试放在 Task 8。
5. **英文模式下技能名表还没加载完**(12MB 的 `spellNames.json` 是后台加载的)→ 先显示日志里的名字，表加载完后自动换成英文名，不需要重开战报。测试放在 Task 9。

---

### Task 1: 词典核心与术语表

**Files:**

- Create: `packages/desktop/src/shared/i18n/index.ts`
- Create: `packages/desktop/src/shared/i18n/zh/index.ts`、`packages/desktop/src/shared/i18n/en/index.ts`(把各命名空间文件合并起来)
- Create: `packages/desktop/src/shared/i18n/zh/common.ts`、`packages/desktop/src/shared/i18n/en/common.ts`(第一个命名空间，放 `common.*`)
- Create: `packages/desktop/src/shared/i18n/glossary.ts`
- Test: `packages/desktop/src/shared/i18n/i18n.test.ts`

**Interfaces:**

- Produces(`shared/i18n/index.ts`):
  - `type Language = "zh" | "en"`;`const LANGUAGES: readonly Language[] = ["zh", "en"]`
  - `type MessageParams = Record<string, string | number>`
  - `type MessageValue = string | ((p: MessageParams) => string)`
  - `type MessageKey = keyof typeof zhMessages`
  - `type Messages = { [K in MessageKey]: MessageValue }`(`en/index.ts` 用 `satisfies Messages`,漏 key 或多 key 都会 typecheck 失败)
  - `translate(lang: Language, key: MessageKey, params?: MessageParams): string`
  - `type TFn = (key: MessageKey, params?: MessageParams) => string`;`makeT(lang: Language): TFn`
  - `localeToLanguage(locale: string | null | undefined): Language`(匹配 `/^zh/i` 就是 `"zh"`,否则 `"en"`)
  - `htmlLang(lang: Language): "zh-CN" | "en"`;`intlLocale(lang: Language): "zh-CN" | "en-US"`
  - `const zhMessages`、`const enMessages`(给 Task 4 的扫描和测试用)
- Produces(`glossary.ts`):`const GLOSSARY: ReadonlyArray<{ id: string; zh: string; en: string; source: string }>`,`source` 写明英文是从哪里沿用来的(prompt tag、FindingCategory slug、user-guide 的某一节)。

- [ ] **Step 1: 写失败的测试** `i18n.test.ts`:
  - `translate("zh", "common.save") === "保存"`,`translate("en", "common.save") === "Save"`
  - 插值：词典里放 `"common.matchCount": "{n} 场"` / `"{n} matches"`,`translate("en", "common.matchCount", { n: 3 }) === "3 matches"`
  - 函数形式的值：`"common.matchCountPlural"` 在 en 侧写成 `(p) => p.n === 1 ? "1 match" : \`${p.n} matches\``,断言 n=1 和 n=2 两种输出
  - 缺参数时占位符原样保留：`translate("en", "common.matchCount") === "{n} matches"`
  - `localeToLanguage("zh-CN") === "zh"`、`("zh-TW") === "zh"`、`("en-US") === "en"`、`("ja") === "en"`、`(undefined) === "en"`
- [ ] **Step 2: 运行，确认失败**:`npx vitest run packages/desktop/src/shared/i18n/i18n.test.ts`,预期结果：找不到模块。
- [ ] **Step 3: 实现 `index.ts` 和 `common` 命名空间**。插值只替换 `\{(\w+)\}`;不引入任何依赖。
- [ ] **Step 4: 运行，确认通过**,然后跑 `npm run typecheck`。
- [ ] **Step 5: 写术语表 `glossary.ts` 初稿**:覆盖 `TYPE_LABEL` 的全部发现类型(`findingDisplay.ts`)、`CATEGORY_ZH` 的 8 个类别、严重度、`MISSED_KICK_TEXT` / `REFUSED_KICK_TEXT`,以及设置页的几个主要概念(AI 后端、自动分析、AI 自查、录像)。英文优先用 slug 和 prompt 里已有的说法。
- [ ] **Step 6: 提交并停下等用户**:`git add packages/desktop/src/shared/i18n && git commit -m "feat(i18n): dictionary core + glossary draft"`。把术语表整理成一张中英对照表发给用户过目;**用户确认之前不要开始 Task 5 及之后的文案迁移**(Task 2–4 可以先做)。

### Task 2: 设置字段 `language` 与 main 侧接线

**Files:**

- Modify: `packages/desktop/src/main/settingsStore.ts`(类型、`DEFAULTS`、`sanitizeSettingsPatch`、`SettingsStore.save`)
- Create: `packages/desktop/src/main/language.ts`
- Modify: `packages/desktop/src/main/index.ts`(构造 getSettings 的地方，以及首启读取安装器文件)
- Modify: `packages/desktop/src/main/ai.ts:58`、`analysis.ts`、`coachChat.ts`、`learning.ts`、`compare.ts`、`localAiBackends.ts:250`(把 `aiLanguage` 全部改成 `language`)
- Modify: `packages/desktop/src/renderer/src/fixtureBridge.ts:42`
- Test: `packages/desktop/src/main/settingsStore.test.ts`(已有，追加用例)、`packages/desktop/src/main/language.test.ts`

**Interfaces:**

- Consumes:Task 1 的 `Language`、`LANGUAGES`、`localeToLanguage`。
- Produces:
  - `GladlogSettings.language: Language | null`(`aiLanguage` 从类型里删除);`settingsStore.ts` 保留 `export type AiLanguage = Language` 作为别名
  - `main/language.ts`:`effectiveLanguage(s: { language?: Language | null }, systemLocale: string): Language`;`withEffectiveLanguage<T extends { language: Language | null }>(s: T, systemLocale: string): Omit<T, "language"> & { language: Language }`;`readInstallerLanguage(exeDir: string): Language | null`(读 `<exeDir>/installer-language.txt`,内容 trim 后只认 `zh` / `en`,其他情况一律返回 null,不抛异常)
  - 各服务 deps 的 `getSettings` 类型从 `{ aiLanguage?: AiLanguage }` 改成 `{ language?: Language | null }`,读取处统一写成 `settings.language ?? "zh"`(测试桩不传时的兜底);index.ts 传进去的是 `() => withEffectiveLanguage(settings.get(), app.getLocale())`,所以生产环境里一定有值。

- [ ] **Step 1: 写失败的测试**(`settingsStore.test.ts` 追加):
  - 磁盘上只有 `{"aiLanguage":"en"}` → `get().language === null`
  - `save({ wowDirectory: "/x" })` 之后，读文件 JSON:`language` 是 `null`,并且**没有** `aiLanguage` 这个 key(Review Focus 2)
  - `save({ language: "en" })` 之后 `get().language === "en"`
  - `sanitizeSettingsPatch({ language: "fr" as never })` 会丢掉这个字段;`{ language: null }` 会保留(允许回到「未选择」)
- [ ] **Step 2: 写失败的测试**(`language.test.ts`):
  - `effectiveLanguage({ language: null }, "zh-CN") === "zh"`;`({ language: "en" }, "zh-CN") === "en"`(Review Focus 1)
  - `readInstallerLanguage(dir)`:文件内容是 `"en\r\n"` 返回 `"en"`;`"fr"` 返回 null;文件不存在返回 null
- [ ] **Step 3: 运行，确认失败**:`npx vitest run packages/desktop/src/main/settingsStore.test.ts packages/desktop/src/main/language.test.ts`
- [ ] **Step 4: 实现**。`save()` 在写盘前 `delete onDisk.aiLanguage`。index.ts 在 app ready 之后、创建窗口之前:如果 `settings.get().language === null`,并且 `process.platform === "win32"` 且 `readInstallerLanguage(dirname(app.getPath("exe")))` 有值，就 `settings.save({ language })`。
- [ ] **Step 5: 把所有 `aiLanguage` 读取处改成 `language`**,改完用 `grep -rn "aiLanguage" packages/desktop/src` 核对，应该只剩注释(renderer 的三处由 Task 3 处理，这一步先只改类型使之通过编译)。AI 缓存文件名里的语言部分保持 `zh` / `en` 不变。
- [ ] **Step 6: 跑测试和 typecheck**:`npx vitest run packages/desktop/src/main` 和 `npm run typecheck`,全部通过。
- [ ] **Step 7: 提交**:`git commit -m "feat(i18n): language setting replaces aiLanguage (no migration)"`

### Task 3: renderer 接入 —— LangProvider、首启选择框、设置页、去掉 AI 卡片切换

**Files:**

- Create: `packages/desktop/src/renderer/src/i18n/LangProvider.tsx`
- Create: `packages/desktop/src/renderer/src/i18n/LanguagePicker.tsx`
- Create: `packages/desktop/src/renderer/src/i18n/format.ts`
- Modify: `packages/desktop/src/renderer/src/main.tsx`(用 provider 包住 App)
- Modify: `SettingsPanel.tsx:568-579`(语言选项移到最上面)
- Modify: `StructuredAnalysisPanel.tsx:260-295`(删掉 `switchLang`、`langSwitches` 和切换按钮)
- Modify: `ProComparisonVerified.tsx:100-106`、`MatchReport.tsx:795-816`(改用 `useT().lang`)
- Modify: renderer 里 11 处 `toLocale*` / `Intl.*`(改用 `format.ts`)
- Test: `packages/desktop/test/i18n.provider.test.tsx`

**Interfaces:**

- Consumes:Task 1 的 `makeT`、`TFn`、`Language`、`htmlLang`、`intlLocale`;Task 2 的 `GladlogSettings.language`。
- Produces:
  - `LangProvider({ children })`
  - `useT(): { t: TFn; lang: Language; setLang(l: Language): Promise<void>; namesVersion: number }`。在 provider 外调用时返回 zh、no-op 的 `setLang` 和 `namesVersion: 0`,所以已有测试不用包 provider。
  - `setLang` 会调用 `bridge().settings.save({ language })` 并更新 context,同时设置 `document.documentElement.lang = htmlLang(l)`。
  - `format.ts`:`formatDateTime(ms: number, lang: Language, opts?: Intl.DateTimeFormatOptions): string`、`formatNumber(n: number, lang: Language, opts?: Intl.NumberFormatOptions): string`,时区处理和原来的调用保持一致。

- [ ] **Step 1: 写失败的测试** `i18n.provider.test.tsx`(bridge 桩用 `window.__gladlogFixture`):
  - 桩里 `language: null` → 渲染出选择框，同时显示「选择语言」和「Choose language」两种文字;点「English」之后，桩的 `settings.save` 被调用，参数是 `{ language: "en" }`,选择框消失，`document.documentElement.lang === "en"`
  - 桩里 `language: "en"` → 不显示选择框，用 `useT()` 的测试组件拿到 `lang === "en"`
  - 在设置页点「中文」→ `useT().lang` 立即变成 `"zh"`,不需要重新挂载
  - 渲染 `StructuredAnalysisPanel` 后，找不到 aria-label 或文字为「中文」/「EN」的切换按钮
- [ ] **Step 2: 运行，确认失败**:`npx vitest run packages/desktop/test/i18n.provider.test.tsx`
- [ ] **Step 3: 实现 provider、选择框和 format.ts**。选择框里默认高亮的按钮是 `localeToLanguage(navigator.language)`。选择框是 §6.9 里唯一允许双语写死的文件。
- [ ] **Step 4: 改 SettingsPanel、StructuredAnalysisPanel、ProComparisonVerified、MatchReport 和 11 处格式化调用**。MatchReport 里原来的 `aiLang` state 和读 settings 的 effect 删掉，改从 `useT().lang` 取;`makeRichText(source, lang)` 的 memo 依赖改成 `lang`。
- [ ] **Step 5: 跑测试**:`npx vitest run packages/desktop`,全部通过(原来断言了 AI 卡片语言切换的测试，按 §6.12 删掉或改写)。
- [ ] **Step 6: 提交**:`git commit -m "feat(i18n): LangProvider, first-run picker, settings placement, drop AI-card toggle"`

### Task 4: 确定性检查(扫描 + 词典完整性)

**Files:**

- Create: `packages/desktop/test/i18n.noCjkLiterals.test.ts`
- Create: `packages/desktop/test/i18n.pendingFiles.ts`(待迁清单：现在还含中文字面量的文件，只能减少)
- Create: `packages/desktop/test/i18n.cjkAllowlist.ts`(永久例外，每一条都要写理由)
- Modify: `packages/desktop/src/shared/i18n/i18n.test.ts`(加完整性检查)

**Interfaces:**

- Consumes:Task 1 的 `zhMessages`、`enMessages`;从 `@gladlog/analysis` 引入的 `CJK_LEAK`(单一来源;如果 index 里没导出，就从 `@gladlog/analysis/src/utils/localizedText` 引入)。
- Produces:
  - `PENDING_FILES: readonly string[]`(相对仓库根目录的路径)
  - `CJK_ALLOWLIST: ReadonlyArray<{ file: string; snippet: string; reason: string }>`
  - 扫描函数 `findCjkLiterals(file: string): Array<{ line: number; text: string }>`:导出它，给变异测试用

- [ ] **Step 1: 写扫描测试**:用 `ts.createSourceFile` 遍历 `packages/desktop/src/{renderer,main,shared}` 下的非测试 `.ts` / `.tsx` 文件，收集包含 CJK 的 `StringLiteral`、`NoSubstitutionTemplateLiteral`、`TemplateHead/Middle/Tail`、`JsxText` 节点(注释天然不会被收集)。排除 `shared/i18n/zh/**`、`glossary.ts`、`LanguagePicker.tsx`。断言：命中的文件 ⊆ `PENDING_FILES`,或者命中的内容在 `CJK_ALLOWLIST` 里;并且 `PENDING_FILES` 里的每个文件确实还有命中(防止清单该删没删)。`console.*` 的参数和只给开发者看的 `throw` 放进 allowlist,要逐条写理由。
- [ ] **Step 2: 写变异测试**(同一个文件里):对一段内存里的源码 `const a = "中文";` 跑 `findCjkLiterals`,应该命中 1 条;`// 中文注释` 应该命中 0 条。
- [ ] **Step 3: 生成初始的 `PENDING_FILES`**(跑一次扫描把结果写进清单)。运行 `npx vitest run packages/desktop/test/i18n.noCjkLiterals.test.ts`,预期通过。
- [ ] **Step 4: 加词典完整性测试**(§6.9 第 2–4 条):`enMessages` 里每个字符串值，以及函数值用 `{ n: 1 }` 和 `{ n: 2 }` 跑出的结果，都不能匹配 `CJK_LEAK`;每个 key 的 en 值都不等于 zh 值(除非这个 key 在显式的 `IDENTICAL_OK` 集合里);每个 key 中英两侧的 `{name}` 占位符集合相同。
- [ ] **Step 5: 运行并提交**:`git commit -m "test(i18n): CJK literal scan + dictionary completeness gates"`

### Task 5–7 的公共做法(文案迁移批次)

每个批次都按同一个循环做，**下面不再重复**:

1. 选一个文件，把里面的中文字面量换成 `t("<ns>.<key>")`(组件里)或 `translate(lang, ...)`(纯 derive / main 里)。zh 文本**原样**搬进 `zh/<ns>.ts`,英文写进 `en/<ns>.ts`,术语按 Task 1 用户确认过的术语表。
2. 纯 derive 函数如果还没有 `lang` 参数，就加一个 `lang: Language = "zh"` 的参数，由组件把 `useT().lang` 传进去。函数的导出名不改(`packages/eval/test/predicateIndex.test.ts` 钉住了这些符号)。
3. 把这个文件从 `PENDING_FILES` 里删掉。
4. 每个批次至少加一个英文模式的渲染测试：用 `LangProvider` 包住、桩里 `language: "en"`,断言 `container.textContent` 不匹配 `CJK_LEAK`(玩家名用 fixture 里的 ASCII 名字)。
5. 跑 `npx vitest run packages/desktop` 和 `npm run typecheck`,通过后提交，提交信息写成 `feat(i18n): migrate <批次名>`。

### Task 5: 迁移 —— 应用外壳与设置页

**Files:** `App.tsx`、`components/` 下除 `DevPanel.tsx` 和 `StatsDashboard.tsx` 以外的所有文件(包括 `SettingsPanel.tsx`、`MatchListFilter.tsx`、对局列表)、`batch/`、`update/`、录像相关横幅;命名空间用 `nav`、`settings`、`matchList`、`batch`、`update`、`recorder`。
**Test:** `packages/desktop/test/i18n.en.shell.test.tsx`(对局列表 + 设置页的英文渲染)

- [ ] **Step 1–5:** 按公共做法逐个文件迁移，然后提交。

### Task 6: 迁移 —— 战报(derive 和组件)

**Files:** `report/derive/*.ts(x)`(包括 `mistakes.ts`、`findingDisplay.ts`、`kickText.ts`、`aiRunStatus.ts`、`cohortDims.ts`)和 `report/components/*.tsx`;命名空间用 `report.<卡片名>`。

- `findingDisplay.ts` 里的 `SEV_ZH`、`CATEGORY_ZH`、`TYPE_LABEL` 迁进词典(`report.severity.*`、`report.category.*`、`report.findingType.*`);`severityLabel`、`categoryLabel` 的签名不变。
- `kickText.ts`:签名改成 `missedKickLabel(k, lang: Language = "zh")`;`MISSED_KICK_TEXT` 保留为 `translate("zh", "report.kick.missed")`,这样 `packages/eval/scripts/scan5/t196.ts` 不用改，仍然固定比对中文(§6.5b)。
- `mistakes.ts` 的 `candidateDetail` 只迁句子框架，嵌进去的分析层英文事实短语原样保留(§6.14)。
  **Test:** `packages/desktop/test/i18n.en.report.test.tsx`,用 `test/fixtures/real-match-sample.json` 渲染战报;死亡相关的卡片按 `report.deathrecap.test` 的方式注入合成死亡事件。

- [ ] **Step 1–5:** 按公共做法迁移。这一批文件多，可以拆成「derive」和「components」两次提交。
- [ ] **Step 6:** 运行 `npx tsx packages/eval/scripts/scan5/t196.ts --help`(或者按它自己注释里的用法跑一次小样本),确认它还能跑，输出和改动前一致。

### Task 7: 迁移 —— 统计、DevPanel、main、shared

**Files:** `StatsDashboard.tsx` 及 `stats` 相关文件、`DevPanel.tsx`、main 里会显示给用户的文字(`localAiBackends.ts`、`deepseekClient.ts`、`coachChat.ts`、`ipc.ts`、`exportImage.ts`、`corpusLoader.ts` 等)、`shared/` 里的 6 行;命名空间用 `stats`、`dev`、`errors`、`dialogs`。

- main 里取语言统一写成 `translate(effectiveLanguage(deps.getSettings(), app.getLocale()), key, params)`;对于 deps 里已经通过 `withEffectiveLanguage` 拿到 `language` 的服务，直接用 `settings.language ?? "zh"`。
- `console.*` 和只给开发者看的断言放进 `CJK_ALLOWLIST`,并写明理由。
  **Test:** `packages/desktop/src/main/localAiBackends.test.ts` 追加用例：设置为 en 时，「找不到命令」的报错不匹配 `CJK_LEAK`;`i18n.en.stats.test.tsx` 测统计页的英文渲染。

- [ ] **Step 1–5:** 按公共做法迁移。
- [ ] **Step 6:** 断言 `PENDING_FILES` 已经为空。把扫描测试改成 `expect(PENDING_FILES).toEqual([])`,并删掉清单文件，然后提交。

### Task 8: 旧语言 AI 内容的标签与重新分析(§6.13)

**Files:**

- Modify: `packages/desktop/src/main/analysis.ts`(`readSlottedDoc` 约 185 行、getCached 的返回值、`readAnalyzedMatchDirs` 的结果、聚合视图 / 笔记本视图的条目，约 1630 和 1721 行)
- Create: `packages/desktop/src/renderer/src/report/components/ContentLangBadge.tsx`
- Modify: `StructuredAnalysisPanel.tsx`、聚合 / 笔记本视图的组件
- Test: `packages/desktop/src/main/analysis.test.ts`(追加)、`packages/desktop/test/i18n.contentLang.test.tsx`

**Interfaces:**

- Produces:
  - `contentLangOfCacheFile(fileName: string): Language`:`analysis-v2.zh.json` 是 zh,`analysis-v2.en.json` 和旧的 `analysis-v2.json` 是 en
  - getCached 的结果增加 `contentLang: Language`;聚合视图的 `recent[]` 和笔记本条目也各加一个 `contentLang: Language`
  - `ContentLangBadge({ contentLang }: { contentLang: Language })`:如果 `contentLang === useT().lang`,渲染为空;否则显示 `report.contentLang.otherZh` / `report.contentLang.otherEn`

- [ ] **Step 1: 写失败的测试**(main):
  - 只有 `analysis-v2.zh.json` 时，用 en 设置调用 getCached → 能返回结果，并且 `contentLang === "zh"`
  - 同样只有 zh 缓存时，`listAnalyzed`(批量分析里「已分析」的判断)在 en 设置下**不把**这一场算作已分析，保持现有的按语言判断
  - 在 zh 设置下发起一轮分析，运行过程中把设置改成 en → 结果写进 `analysis-v2.zh.json`(Review Focus 4)
- [ ] **Step 2: 写失败的测试**(renderer):en 模式下，单局卡片显示的是回退来的 zh 内容时，能看到标签和「Re-analyze in English」按钮，但**看不到**深挖 / 选段 / 问教练这些入口(Review Focus 3);点按钮会触发和现在「分析」按钮相同的 IPC。
- [ ] **Step 3: 运行，确认失败**
- [ ] **Step 4: 实现**。单局只在当前语言没有命中时才读另一种语言的文件，而且只读不写;发起分析时就把语言固定下来，一直传到写缓存那一步。
- [ ] **Step 5: 运行，确认通过，然后提交**:`git commit -m "feat(i18n): label other-language AI content + re-analyze"`

### Task 9: 英文模式下的技能名(§8 第 1 条)

**Files:**

- Create: `packages/desktop/src/renderer/src/report/derive/spellLabel.ts`
- Modify: `LangProvider.tsx`(en 模式下等 `ensureSpellNames()` 完成后让 `namesVersion` 加一)
- Modify: 显示日志技能名的组件(`DeathRecapCard`、`GcdSwimlane`、`ReplayView`、`BurstLedgerCard`、`EventsPanel`、`AuraUptimeCard`、`ProComparisonVerified`、`CCChainPanel`,以及在字符串里拼技能名的 derive;用 `grep -rn "spellName" packages/desktop/src/renderer/src/report` 列全)
- Test: `packages/desktop/src/renderer/src/report/derive/spellLabel.test.ts`、`packages/desktop/test/i18n.spellNames.test.tsx`

**Interfaces:**

- Consumes:analysis 的 `getEnglishSpellName(spellId, fallback)`、`ensureSpellNames()`。
- Produces:`spellLabel(spellId: string, logName: string, lang: Language): string`。zh 返回 `logName`;en 返回 `getEnglishSpellName(spellId, logName)`。

- [ ] **Step 1: 写失败的测试**:`spellLabel("<某个在 spellNames.json 里有的 id>", "真言术:障", "en")` 返回英文名(id 和英文名从 json 里挑一个固定的);`lang` 是 `"zh"` 时返回原样;id 查不到时返回 `logName`。
- [ ] **Step 2: 写失败的测试**(Review Focus 5):先在名字表没加载时渲染一个用到 `spellLabel` 的组件，显示的是日志名;让 `ensureSpellNames` 的 promise resolve 之后，不重新挂载，显示自动变成英文名。
- [ ] **Step 3: 实现**,然后逐个改组件，组件里调用时把 `namesVersion` 放进 memo 依赖。
- [ ] **Step 4: 运行，确认通过，然后提交**

### Task 10: analysis 包里显示给用户的文字与 deepDive(§6.5)

**Files:**

- Modify: `packages/analysis/src/analysis/deepDive.ts`(`buildDeepDivePack`、`buildOffensiveDeepDivePack`、`buildWindowPack`、`buildWindowAnchorFinding`,以及 412/487/521/537/606–609 行的标签、1430 行的 `PACK_ITEM_KIND_ZH`)
- Modify: `packages/analysis/src/analysis/momentSnapshot.ts:261-266` 和 `packages/analysis/src/utils/cooldowns.ts:7281`(`selfCastNoopAnnotatedName`)
- Modify: deepDive 的调用方(`packages/desktop/src/main/analysis.ts:1421` 一带，以及用 grep 找到的其他调用处)
- Test: `packages/analysis/src/analysis/deepDive.test.ts`(已有或新建)

**Interfaces:**

- Produces:在 `deepDive.ts` 本地定义 `type PackLang = "zh" | "en"`;上面四个函数都在末尾加一个参数 `lang: PackLang = "zh"`;新增 `PACK_ITEM_KIND_EN: Record<PackItem["kind"], string>`(原来的 `PACK_ITEM_KIND_ZH` 名字不改)。`selfCastNoopAnnotatedName(cd, lang: "zh" | "en" = "zh")`,en 时的后缀是 ` (ally-only, cannot self-cast)`。

- [ ] **Step 1: 先锁住中文输出**:在**改代码之前**写测试，用现有的 fixture 构造 pack,把 `buildWindowAnchorFinding(...)` 和各个 pack 的 `label` 存成 inline snapshot,然后提交(`test(deepDive): pin zh labels before i18n`)。
- [ ] **Step 2: 写失败的测试**:同样的输入传 `"en"`,产出里不匹配 `CJK_LEAK`;传 `"zh"` 时和 Step 1 的 snapshot 逐字节相同。
- [ ] **Step 3: 实现**。调用方传当前的有效语言;如果某个函数也在 prompt 路径上被调用，而那条路径不属于「指令」层，就固定传 `"zh"`,保证字节不变。按照 §6.5,builder 先用 grep 列出 renderer 和 main 引入的所有会显示给用户的 analysis 函数，写在提交信息里;已知还需要处理的只有 `momentSnapshot` 这一处。
- [ ] **Step 4: 运行 `npx vitest run packages/analysis/src/analysis`,确认通过，然后提交**

### Task 11: Windows 安装器(§6.6)

**Files:**

- Modify: `packages/desktop/package.json` 的 `build.nsis`(`multiLanguageInstaller: true`、`installerLanguages: ["en_US", "zh_CN"]`、`include: "build/installer.nsh"`)
- Create: `packages/desktop/build/installer.nsh`
- Test: `packages/desktop/test/releaseConfig.test.ts`(已有，追加断言)

- [ ] **Step 1: 写失败的测试**:`releaseConfig.test.ts` 断言 `build.nsis` 里有上面三个配置项;读取 `installer.nsh` 的文本，断言里面有 `customInstall` 宏、有 `IfSilent`(静默安装跳过写文件)、写的是 `$INSTDIR\installer-language.txt`。
- [ ] **Step 2: 实现**。`$LANGUAGE == 2052` 写 `zh`,其余写 `en`;静默安装时跳过。builder 要对照 electron-builder 26 的文档，确认配置项名字和宏名。
- [ ] **Step 3: 运行，确认通过，然后提交**
- [ ] **Step 4: 真机验证**(§7):用 `.claude/skills/release` 里的 workflow_dispatch 方式打一个 Windows 包(不要打 tag),在 Windows 机器上按 §7 的四种情况各装一次，把结果截图或记录下来。如果没有 Windows 机器，就停下请用户来验。

### Task 12: 文档、issue 和最终验收

**Files:**

- Modify: `docs/user-guide.md` 和 `docs/user-guide.zh-CN.md`(加「语言 / Language」一节，两个版本等价)
- Modify: `CHANGELOG.md` 和 `CHANGELOG.zh-CN.md`(按 §6.11 的措辞)

- [ ] **Step 1: 写文档**,然后跑 `node scripts/check-markdown-links.mjs`,确认没有新的报错。
- [ ] **Step 2: 开 GH issue**,标题 "zh mode: translate analysis-layer English fact phrases embedded in report sentences",内容按 §6.14 写，不要放私密数据。
- [ ] **Step 3: prompt 字节验收**:用 `pipe.py slot run` 跑 `packages/eval/scripts/acceptanceCapture.ts`,覆盖 605 采集，改动前(用 Task 1 之前的 commit)和改动后各跑一次。数据正文的哈希必须完全相同。另外写一个一次性的 vitest(放进 `packages/desktop/src/main/analysis.test.ts`,跑完保留):在 zh 设置下，同一个 fixture 构造出来的 findings prompt、选段 prompt、coach 系统指令，和 Task 1 之前的 commit 逐字节相同(先在旧 commit 上生成 golden 文件，再提交)。
- [ ] **Step 4: 英文界面验收**:用 run-ui 测试床(`.claude/skills/run-ui`)打开 `real-match-sample` 的战报、对局列表、设置页、统计页，切到 en,统计渲染出来的 DOM 文本里匹配 `CJK_LEAK` 的字符数。改动前和改动后的数字都要报出来;改动后除了 spec §7 列出的例外，应该是 0。
- [ ] **Step 5: 跑 `npm run presubmit`**(从仓库根目录跑),全绿。
- [ ] **Step 6: codex 审查**:按 `.claude/skills/cross-ai-review` 的方式送审整个分支的 diff,处理完审查意见后再推送。
- [ ] **Step 7: 推送**,然后用 `gh run watch <run id> --exit-status` 等 CI;报结果前核对 run id、headSha 和最终结论。如果改了战报 UI 导致 `report-*` 视觉基线变化，按 desktop-dev 的配方重新生成基线。
