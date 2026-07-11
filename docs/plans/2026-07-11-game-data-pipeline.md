# 子项目 5:游戏数据管线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wago.tools DB2 CSV + raidbots 天赋 JSON → `packages/analysis/scripts/datagen/` 生成器族,产物原位替换占位/手工数据(消费方零改动);UI 接线具名天赋 + 图标(盘缓存)。

**Architecture:** 纯变换函数(fixture CSV 切片离线测)与网络 fetch 分离;emit 层形状断言不合格不落盘;真实拉取只在跑批步骤(控制器执行)。4 个生成器清洁室新写(不读上游源;需求只来自 gladlog 既有形状 + 本计划钉死的真实列名),2 个自有件控制器交付移植。Spec:`docs/specs/2026-07-11-game-data-pipeline-design.md`。

**Tech Stack:** TypeScript ESM、vitest、tsx CLI、node fetch(内置)、fs-extra。

## Global Constraints

- **合规(硬性)**:任何人(含控制器)不读旧 fork 的 4 个上游生成器源码(generateSpellIdLists/generateSpellsData/generateSpellClassMap/update_statics);自有 2 件(generateTrinketItemIds CLEAN、generateTalentModifiers NEEDS_SCRUB)由控制器核验审计后经 /tmp staging 交付,实现者不访问旧 fork。
- **形状锁定**:产物必须与既有消费面同形状——`IMinedSpell`(packages/analysis/src/data/spellEffectData.ts)、`talentIdMap.json`(talentStrings.ts 的 RaidBotsTalentData)、`trinketItemIds.json`、`talentModifiers.json`。消费方源码除本计划点名处不得改动。
- **真实列名(2026-07-11 探针,build 12.1.0.68629)**:SpellName=`ID,Name_lang`;SpellCooldowns=`ID,DifficultyID,CategoryRecoveryTime,RecoveryTime,…,SpellID`;SpellDuration=`ID,Duration,MaxDuration,…`;SpellCategories=`ID,DifficultyID,Category,DefenseType,DiminishType,DispelType,Mechanic,…,ChargeCategory,SpellID`;SpellMisc 含 `DurationIndex,PvPDurationIndex,SpellIconFileDataID,SpellID,DifficultyID`;SpellCategory=`ID,Name_lang,Flags,UsesPerWeek,MaxCharges,ChargeRecoveryTime,TypeMask`;PvpTalent 含 `SpellID`;SkillLineAbility 含 `Spell,ClassMask`。
- **dispelType 枚举**(wowdev.wiki,golden 钉死):DispelType 1=Magic 2=Curse 3=Disease 4=Poison;其余→不可驱散(undefined)。
- **PvP 时长优先**:SpellMisc.PvPDurationIndex≠0 时用它查 SpellDuration,否则 DurationIndex;`SPELL_EFFECT_OVERRIDES` 恒为最终覆盖层。
- 时间单位:DB2 毫秒 → IMinedSpell 秒(除以 1000)。
- 网络失败/CSV 头不符预期 → 非零退出零落盘;fixture 测试全离线;真实跑批 = 控制器步骤。
- ESM、TS strict、vitest、测试在 `packages/analysis/test/datagen/`;根全仓测试绿 = 每次数据替换的回归门;TDD、每任务一 commit。

## 提取清单(控制器专用)

```
旧 packages/tools/src/generateTrinketItemIds.ts  (CLEAN)      → 经 /tmp 交付 → scripts/datagen/genTrinketItemIds.ts
旧 packages/tools/src/generateTalentModifiers.ts (NEEDS_SCRUB) → 控制器按审计行刮迁后经 /tmp 交付 → scripts/datagen/genTalentModifiers.ts
旧 packages/tools/src/customTalentModifiers.ts   (CLEAN)      → 若被上件 import 则一并交付
旧 docs/commands/update-wow-data.md              (CLEAN)      → 控制器改写 → docs/commands/update-wow-data.md
禁读:generateSpellIdLists.ts / generateSpellsData.ts / generateSpellClassMap.ts / scripts/update_statics.js(上游)
```

---

### Task 1: datagen 公共层(wagoCsv + emit)

**Files:** Create `packages/analysis/scripts/datagen/lib/wagoCsv.ts`、`lib/emit.ts`、`packages/analysis/test/datagen/lib.test.ts`、fixture 目录 `packages/analysis/test/datagen/fixtures/`(本任务先放 `mini.csv`)

**Interfaces:** Produces `parseCsv(text: string): { header: string[]; rows: Record<string, string>[] }`(RFC4180 引号/内嵌逗号/内嵌换行正确);`fetchLatestBuild(): Promise<string>`(GET `https://wago.tools/api/builds?branch=retail&product=wow`,取最高 version);`fetchTable(table: string, build: string, cacheDir?: string): Promise<string>`(GET `https://wago.tools/db2/<table>/csv?build=<build>`,cacheDir 命中直读);`assertMinRows(rows, n, what)`、`assertColumns(header, required: string[], table)`(不符 throw);`writeArtifact(path, content: string)`。

- [ ] Step 1(契约):`lib.test.ts` — parseCsv 三例:`a,b\n1,"x,y"\n` → rows[0].b==="x,y";引号内换行;空文件 → rows []。assertColumns 缺列 throw 且 message 含表名与缺列名。assertMinRows 不足 throw。
- [ ] Step 2: 跑测 FAIL → 实现两个 lib → PASS + typecheck。
- [ ] Step 3: Commit `feat(datagen): wago csv + emit foundations`。

---

### Task 2: fetchTalents(raidbots → talentIdMap.json)+ 激活天赋解码

**Files:** Create `scripts/datagen/fetchTalents.ts`;Test `test/datagen/talents.test.ts`;Modify(数据)`src/data/talentIdMap.json`

**Interfaces:** Produces `validateTalentData(data: unknown): asserts` —— 数组、length≥13×3−ε(≥30 个 spec 对象)、每 spec 有 `classNodes/specNodes` 数组、抽样 entry 有 `spellId:number`+`name:string`+`icon:string`;CLI:fetch `https://www.raidbots.com/static/data/live/talents.json` → validate → 原样(2 空格)写 `src/data/talentIdMap.json`。

- [ ] Step 1(契约):fixture `fixtures/mini-talents.json`(控制器造:2 个 spec 的极简合法结构)→ validate 通过并落盘;缺 classNodes 的变体 → throw 不落盘。
- [ ] Step 2: 实现 → 测试+typecheck 绿。
- [ ] Step 3(控制器,真实跑批):`npx tsx packages/analysis/scripts/datagen/fetchTalents.ts` → 真 talentIdMap.json 落盘;`npm test -w @gladlog/analysis` 全绿(talentStrings/talents.ts 首次吃到真数据——若解码断言暴露形状漂移,按 BLOCKED 上报控制器裁决)。
- [ ] Step 4: Commit `feat(datagen): raidbots talent fetch + real talentIdMap (activates named-talent decoding)`。

---

### Task 3: genSpellNames(SpellName.csv → spellNames.json)

**Files:** Create `scripts/datagen/genSpellNames.ts`;Test `test/datagen/spellNames.test.ts`;Modify(数据)`src/data/spellNames.json`

**Interfaces:** Produces `transformSpellNames(csvText: string): Record<string, string>`(ID→Name_lang,全量不过滤);CLI:fetchTable("SpellName") → transform → assertMinRows(≥100000)→ 压缩单行 JSON 写盘,文件头无法加注释(JSON)——build 版本记录进 Task 7 的 `datagen-manifest.json`。

- [ ] Step 1(契约):fixture `fixtures/SpellName.mini.csv`(真实头 + 10 行,含带逗号引号名)→ transform golden;行数断言用小阈值参数化(`assertMinRows(rows, min)` 由 CLI 传 100000、测试传 5)。
- [ ] Step 2: 实现 → 绿。
- [ ] Step 3(控制器):真实跑批 → 新 spellNames.json(压缩)替换;`ls -la` 对比体积记录;全仓测试绿(回归门)。
- [ ] Step 4: Commit `feat(datagen): spell names regenerated from wago (enUS, minified)`。

---

### Task 4: genSpellEffects(候选集挖掘 → 生成基础层)

**Files:** Create `scripts/datagen/genSpellEffects.ts`、`scripts/datagen/lib/candidates.ts`;Test `test/datagen/spellEffects.test.ts`;Create(数据)`src/data/spellEffectGenerated.ts`

**Interfaces:**

- `collectCandidateIds(): Set<string>` —— 并集:`SPELL_CATEGORIES` 键、`classMetadata` 全 abilities spellId、`spellIdLists` 三表、`spellClassMap.diminishingReturns` 全类目、`SPELL_EFFECT_OVERRIDES` 键、talentIdMap 全 entries 的 `spellId`(type==="active" 优先但全收)、PvpTalent.csv 的 `SpellID` 列。
- `mineSpellEffects(csv: { spellMisc, spellDuration, spellCooldowns, spellCategories, spellCategory, spellName }, candidates: Set<string>): Record<string, IMinedSpell>` —— 每候选 id:name ← SpellName;duration ← SpellMisc(DifficultyID=0 行)`PvPDurationIndex||DurationIndex` → SpellDuration.Duration(ms→s;0/缺省→undefined);cooldownSeconds ← SpellCooldowns(DifficultyID=0)`max(RecoveryTime, CategoryRecoveryTime)`(0→undefined);charges ← SpellCategories.ChargeCategory→SpellCategory `{charges: MaxCharges, chargeCooldownSeconds: ChargeRecoveryTime/1000}`(MaxCharges 0→undefined);dispelType ← SpellCategories.DispelType 枚举映射(1..4,其余 undefined)。无任何字段命中的候选仍产出 `{spellId, name}`(若 name 也无则跳过)。
- CLI:真实拉 6 表 → mine → `writeArtifact` 生成 `src/data/spellEffectGenerated.ts`:`export const SPELL_EFFECTS_GENERATED: Record<string, IMinedSpell> = {…}`(文件头注释:generatedAt/build/候选数/命中数)。

- [ ] Step 1(控制器):制作 6 张 fixture 切片(真实表头;行覆盖:Polymorph 118 → DispelType 1;Curse of Tongues 1714 → DispelType 2;一个带 PvPDurationIndex≠0 的 CC;一个带 ChargeCategory→MaxCharges 2;一个纯 CD 技能)。写入 `fixtures/*.mini.csv`。
- [ ] Step 2(契约):goldens —— `mine(...)["118"].dispelType === "Magic"`;`["1714"].dispelType === "Curse"`;PvP 时长行选中 PvPDurationIndex 对应秒数;charges 例 `{charges: 2, chargeCooldownSeconds: 20}`;纯 CD 例 `cooldownSeconds` 正确且无 duration;候选集函数并入伪 PvpTalent 切片的 SpellID。
- [ ] Step 3: 实现 → 绿。
- [ ] Step 4(控制器):真实跑批(6 表下载注意 SpellMisc 体积,用 cacheDir)→ 产物落盘;`head` 抽查 3 个已知技能对照 wowhead 事实;全仓测试绿。
- [ ] Step 5: Commit `feat(datagen): spell effects miner (PvP-duration-aware) + generated base layer`。

---

### Task 5: 双层合并接线(generated 基座 + overrides 覆盖)

**Files:** Modify `src/data/spellEffectData.ts`;Test `test/datagen/spellEffectMerge.test.ts`

**Interfaces:** `spellEffectData` 变为 `{...SPELL_EFFECTS_GENERATED, ...SPELL_EFFECT_OVERRIDES}`;导出面(`spellEffectData`、`getEnglishSpellName`、`IMinedSpell`)不变。

- [ ] Step 1(契约):同 id 两层并存 → overrides 值胜(取一个真实重叠 id 断言,若无重叠则用测试内构造的合并函数语义单测 + 断言真实数据中 overrides 全部键仍逐字保留于合并结果)。
- [ ] Step 2: 实现 → `npm test --workspaces` 全绿(4a 校准断言 = 回归门,发现分歧一律 override 层裁决并记录)。
- [ ] Step 3: Commit `feat(analysis): two-layer spell effect data (generated base, curated overrides win)`。

---

### Task 6: 自有生成器移植(trinket + talentModifiers)

**Files:** Create `scripts/datagen/genTrinketItemIds.ts`、`scripts/datagen/genTalentModifiers.ts`(+ 若依赖则 `scripts/datagen/customTalentModifiers.ts`);Test `test/datagen/ownGenerators.test.ts`;Modify(数据)`src/data/trinketItemIds.json`、`src/data/talentModifiers.json`

- [ ] Step 1(控制器):CLEAN/刮迁核验 → 三件经 /tmp 交付;告知实现者改写规则(路径面:输出到 src/data/;fetch 面:换用 lib/wagoCsv fetchTable;其余零逻辑改动)。
- [ ] Step 2(契约):trinket —— fixture ItemSparse 切片(含 1 行 Sigil of Adaptation、1 行 Relentless、1 行无关)→ 产物两类 id 正确分桶;talentModifiers —— 用 Task 2 mini-talents + Task 4 mini spellEffects 跑出非空且形状同现 talentModifiers.json 顶层。
- [ ] Step 3: 实现(机械改造)→ 绿。
- [ ] Step 4(控制器):真实跑批 → 两 json 替换 → 全仓绿。
- [ ] Step 5: Commit `feat(datagen): own generators ported (trinkets, talent modifiers) + regenerated artifacts`。

---

### Task 7: genSpellClassMap + validateCatalogs + datagen manifest

**Files:** Create `scripts/datagen/genSpellClassMap.ts`、`scripts/datagen/validateCatalogs.ts`;Test `test/datagen/classMapValidate.test.ts`;Create(数据)`src/data/spellClassMapGenerated.ts`、`src/data/datagen-manifest.json`

**Interfaces:**

- `classesForSpell(skillLineAbilityRows, spellId): CombatUnitClass[]` —— ClassMask 位解码(bit n = classId n+1,用 parser-compat 的 CombatUnitClass 序);产物 `SPELL_TO_CLASSES: Record<string, number[]>`(只含候选集内 id,避免巨表)。
- `validateCatalogs(spellNameRows, catalogs): { missing: {catalog, id}[]; renamed: [] }` —— 策展目录(spellCategories/classSpells/spellIdLists/drCategories/overrides)每 id 必须在 SpellName 存在;缺失非零退出并打印清单。
- `datagen-manifest.json`:`{ build, generatedAt, artifacts: {文件: 行数/条目数} }`(每个真实跑批 CLI 追写自己的条目)。

- [ ] Step 1(契约):ClassMask golden(mask 16397 → 期望职业数组,按位展开断言);validateCatalogs 对 fixture SpellName 切片 + 含一个假 id 的目录 → missing 命中。
- [ ] Step 2: 实现 → 绿。
- [ ] Step 3(控制器):真实跑批;validateCatalogs 对全部真实策展目录跑一遍——**输出的缺失清单如非空,逐条人工裁决并修目录**(记录到账本);全仓绿。
- [ ] Step 4: Commit `feat(datagen): spell-class map, catalog validation, datagen manifest`。

---

### Task 8: UI 具名天赋(UnitPanel)

**Files:** Modify `packages/desktop/src/renderer/src/report/components/UnitPanel.tsx`;`packages/analysis/src/index.ts`(导出 talentStrings 解码入口);Test `packages/desktop/test/report.talents.test.tsx`

**Interfaces:** Consumes talentStrings 的既有解码导出(以源码为准,BLOCKED 上报若无可用入口);UnitPanel 天赋区变为:解码成功 → 具名天赋列表(名称 + 层级),失败/空 → 现状计数展示(不回归)。

- [ ] Step 1(契约):jsdom 测试 —— 用 desktop fixture 单位的 `info.talents`/天赋串跑解码入口;fixture 是脱敏 2v2(spec=undefined)则用 mini-talents 构造已知天赋串断言解码产名;UnitPanel 渲染断言含具名节点或优雅回退。
- [ ] Step 2: 实现 → desktop 测试全绿。
- [ ] Step 3: Commit `feat(report): named talents in unit panel`。

---

### Task 9: SpellIcon + 主进程图标盘缓存

**Files:** Create `packages/desktop/src/main/iconCache.ts`、renderer `report/components/SpellIcon.tsx`;Modify `src/main/ipc.ts`、preload、UnitPanel(天赋图标)+ Meters/Timeline(目录内法术图标);Test `packages/desktop/test/iconCache.test.ts`、`report.spellicon.test.tsx`

**Interfaces:** `createIconCache(deps: { cacheDir: string; fetchImpl?: typeof fetch }): { get(iconName: string): Promise<string | null> }` —— 命中读 `<cacheDir>/<safe-name>.jpg` → data URL;未命中 GET `https://wow.zamimg.com/images/wow/icons/large/<iconName>.jpg`(2xx 才落盘);失败记忆(会话内同名不重试)返回 null。IPC `gladlog:icon:get(iconName) → string|null`;renderer `SpellIcon({ icon, label })` null → 首字母块。

- [ ] Step 1(契约):iconCache —— fake fetch 三态(命中盘/拉取成功落盘/失败 null 且二次调用不再 fetch);SpellIcon —— dataURL 渲染 img、null 渲染字母块(mock bridge)。
- [ ] Step 2: 实现 + 接线(天赋列表图标用 talentIdMap entries.icon;法术图标 v1 仅目录内:SPELL_EFFECT 数据无 icon 名——v1 图标源只用 talent entries.icon,时间轴/meters 暂不接,降 scope 记录)。**Scope 澄清(计划裁决)**:法术图标名需要 ManifestInterfaceData 表(几十万行)映射 FDID→名,v1 不做;本任务交付 = 天赋图标 + SpellIcon 组件 + 缓存设施,时间轴图标挂遗留。
- [ ] Step 3: desktop 全绿 → Commit `feat(report): talent icons with local disk cache (zamimg, offline-degrading)`。

---

### Task 10: update-wow-data 工作流 + 收官

**Files:** Create `docs/commands/update-wow-data.md`、`.claude/commands/update-wow-data.md`;Modify `README.md`、`.superpowers/progress.md`

- [ ] Step 1(控制器):CLEAN 改写工作流文档:fetchLatestBuild 对比 datagen-manifest.json 的 build → 逐 CLI(fetchTalents→genSpellNames→genSpellEffects→genTrinketItemIds→genTalentModifiers→genSpellClassMap)失败即停 → validateCatalogs → 全仓测试 → git diff --stat 汇报。薄指针进 .claude/commands。
- [ ] Step 2(控制器):端到端验收 —— dev 模式看 UnitPanel 具名天赋 + 图标(截图);dmg 重打;全仓 test/tc 绿。
- [ ] Step 3: 双 review(agy 降级链):T1-7 datagen 合并 review + 全分支终审;findings 闭环。
- [ ] Step 4: 账本子项目 5 完成条目 + README 勾选 + Commit `docs: sub-project 5 complete`。

## Self-Review 记录

- Spec 覆盖:六生成器(T2-7)、判断层校验(T7)、双层合并(T5)、PvP 时长优先(T4)、UI 两件(T8-9)、工作流(T10)、图标缓存降级(T9)、错误处理(T1 emit/各 CLI 非零退出)、测试策略五条全对应。✔
- 占位符扫描:无 TBD;T9 的 scope 澄清是显式裁决非占位。✔
- 类型一致性:IMinedSpell 单源(spellEffectData.ts);SPELL_EFFECTS_GENERATED 命名 T4 定义 T5 消费;candidates/emit 接口 T1/T4 一致。✔
- 已知风险记录:raidbots JSON 形状漂移(T2 BLOCKED 路径)、SpellMisc 体积(cacheDir)、fixture 需覆盖 DifficultyID≠0 行的过滤。
