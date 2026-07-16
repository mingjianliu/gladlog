# update-wow-data — 游戏数据更新工作流

新 WoW retail build 发布或赛季更新时刷新 `packages/analysis/src/data/` 的生成数据。

## 步骤

### 1. 查当前数据的 build

读 `packages/analysis/src/data/datagen-manifest.json` 的 `build` 字段,记为 `CURRENT_BUILD`(文件不存在则视为需要全量更新)。

### 2. 查最新 retail build

GET `https://wago.tools/api/builds?branch=retail&product=wow`,取最高 `version`,记为 `LATEST_BUILD`。拉取失败则问用户当前最新 build 号。

### 3. 对比

`CURRENT_BUILD == LATEST_BUILD` → 报告"数据已最新",停止。否则继续。

### 4. 逐生成器跑批(顺序执行,失败即停)

repo 根目录,建议设 `DATAGEN_CACHE` 复用大表下载:

```bash
export DATAGEN_CACHE=$(mktemp -d)
# 1. 天赋树(raidbots;必须先跑——spellEffects 候选集读 talentIdMap)
npx tsx packages/analysis/scripts/datagen/fetchTalents.ts
# 2. 法术名(enUS 压缩)
npx tsx packages/analysis/scripts/datagen/genSpellNames.ts
# 3. 法术效果基础层(PvP 时长优先;候选集 = 策展目录 ∪ 天赋 ∪ PvpTalent)
npx tsx packages/analysis/scripts/datagen/genSpellEffects.ts
# 4. PvP 饰品 item id
npx tsx packages/analysis/scripts/datagen/genTrinketItemIds.ts
# 5. 天赋 CD 修正提取
npx tsx packages/analysis/scripts/datagen/genTalentModifiers.ts
# 6. 法术→职业映射
npx tsx packages/analysis/scripts/datagen/genSpellClassMap.ts
# 6b. 法术图标名(desktop 泳道/回放图标;SpellMisc→ManifestInterfaceData)
npx tsx packages/analysis/scripts/datagen/genSpellIcons.ts
# 7. manifest 汇总
npx tsx packages/analysis/scripts/datagen/writeManifest.ts
```

任一脚本非零退出:展示错误,停止,报告用户;不得继续跑后续脚本。

### 5. 策展目录校验(人工裁决门)

```bash
DATAGEN_CACHE=$DATAGEN_CACHE npx tsx packages/analysis/scripts/datagen/validateCatalogs.ts
```

非零退出 = 有策展 id 在新 build 失效。逐条人工裁决:

- 技能被移除但历史日志仍需要 → 加入 `validateCatalogs.ts` 的 `KNOWN_REMOVED_SPELLS`(注明技能名与裁决日期)
- 技能更名/换 id → 修对应策展目录
- 目录笔误 → 修目录

### 6. 回归门

```bash
npm test --workspaces && npm run typecheck --workspaces --if-present
```

必须全绿。4a 的数据校准断言若因新数据翻红:以人工校准值为准 → 把正确值补进 `SPELL_EFFECT_OVERRIDES`(覆盖层恒赢),不改测试。

### 7. 汇总

```bash
git diff --stat packages/analysis/src/data/
```

报告:变更文件、新旧 build、关键计数(mined 条目数、talentModifiers 技能数、spec 数)。提交信息注明 build 号。

## 注意

- 覆盖层维护税(spec 终判在案):PvP 时长/服务器端修正 DB2 不编码,发现偏差就地补 `SPELL_EFFECT_OVERRIDES` 条目。
- `spellNames.json` 12MB 属预期;dev 首载慢的优化是独立事项。
- 图标为运行时拉取+盘缓存,数据更新不涉及。
