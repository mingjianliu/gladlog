# 日志可观测性:还有什么没用、什么不能删

公开文档 `docs/log-observability-audit.md`(+zh-CN)是 GH #100 的结论本体,字段覆盖账在 `fieldLedger.test.ts`。这里补决定层面的东西。

## 约束

- **raw.txt 保留约束**:审计列出的未物化字段有无损替代之前,不得删 / 截断 raw.txt(写在 `matchStore.ts`、`slim.ts` 头、审计文档)。没有 raw.txt 就没有重解析成 match.json 的路径(reparse 只重算 meta)。
- **本地对局库可能是旧解析**:库里的 `match.json` 是导入时的解析结果,app 从不重解析,也没有解析器版本号。某次之后新增的字段(missesOut / missesIn / healAbsorbsIn / empowerEnds 等)旧导入全缺。**评测、探针、HEAD 复查一律从 raw.txt 用当前解析器重解析**,别直接读库存 match.json(用户裁:开发用的库不做产品迁移)。
- 加 parser invariant 码要同改 `packages/desktop/src/shared/diagnosticLevel.ts`。

## 用户裁过的取值规则

- **[STATE] HP**(2026-09-23):同时间戳取该瞬间**最后一行**(游戏按处理顺序写);等距取较早时刻。
- 单排约 1/3 玩家回合间改配置,产品按回合读 COMBATANT_INFO,无缺陷。

## 各方向结论

- **朝向**:可解析;回放朝向刻度用户裁不做(「收益不大」),勿再提。
- **护盾余量**(高级块 +9):价值探针是负结果(掉到 40% 时盾早被吃光)。
- **资源**:法力 / 次级资源方向关闭(见 [coaching-rulings.md](coaching-rulings.md))。
- **NPC / 召唤物**:吸收事件物化攻击方法术(`attackSpellId/Name`,瘦身后仍在,旧存档不回填);战栗图腾只在起作用时写;`[ENEMY SUMMON]` 事实行 + 可行性(`summonReach`)。
- **宠物**:术士宠物 46% 被杀后整回合不回来(丢法术封锁等);可解析,未进 prompt。
- **假读 / 停读条**:SPELL_CAST_FAILED 只记录录制者,停读条 ≠ 假读,只有「打断打空」算假读证据。

## 坑

- NaN 永不渲染,任何文本门都看不见;JSON 存储把 NaN 变 null,compat 读成 0 → 新解析的 eval 工具与产品可能不一致,两条路都查。
- 任何扫描先看扫了多少(见 [verification.md](verification.md))。
- 档案普查:同一 lobby 的录像有重复(约 7%),按回合去重。

## 向用户呈裁决

用户回过「看不懂,举例子说明我要做什么决定」→ 直接说「你要决定的就一件事」+ 界面长什么样的例子 + 做 / 不做的后果 + 我的建议。把「那句话」和对局经过逐秒写出来,别只给代号。

相关:[combat-log-parsing.md](combat-log-parsing.md)、[range-los.md](range-los.md)
