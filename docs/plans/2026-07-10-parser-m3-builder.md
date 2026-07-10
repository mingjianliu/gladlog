# Parser M3:L3 对局构建器 — 实施计划

> 工作方式同 M1/M2:契约测试=控制者写;实现=agy exec(降级 haiku);禁读旧 parser 源码;逐任务 commit。

**Goal:** `buildMatch(segment) / buildShuffle(close)`:L2 段 → spec 数据模型的 `GladMatch` / `GladShuffle`,按维度 reducer 分文件。

## 关键判定规则(暴雪事实,写死为契约)

- **unitFlags 位义**(wowpedia UnitFlag):affiliation `0x1`=MINE/`0x2`=PARTY/`0x4`=RAID/`0x8`=OUTSIDER;reaction `0x10`=FRIENDLY/`0x20`=NEUTRAL/`0x40`=HOSTILE;type `0x100`=PLAYER 控制/`0x200`=NPC 控制;object type `0x400`=PLAYER/`0x800`=NPC/`0x1000`=PET/`0x2000`=GUARDIAN/`0x4000`=OBJECT。
- **日志所有者** = 段内首个 (flags & 0xF)===0x1 且 GUID 前缀 `Player-` 的单位。
- **unit.kind**:GUID 前缀优先(`Player-`/`Pet-`/`Creature-`),object-type 位交叉验证;`Creature-` 且 `0x2000` → Guardian。
- **unit.reaction**:该单位在段内出现的 flags 的 reaction 位多数决;与 teamId 交叉验证(owner 的 teamId 侧=Friendly)。
- **真死亡** = `UNIT_DIED` 且末参=0 且 dest.kind=Player;末参=1(假死)入 `unconsciousEvents` 不入 `deaths`。
- **胜负**:match → END winningTeamId vs playerTeamId → Win/Lose;255/缺失 → Unknown。shuffleRound → 该回合首个真死亡的对侧队伍胜;无死亡 → Unknown。shuffle 整场 result 挂 END。
- **classId/specId**:specId 来自该单位 CI;classId 由 specId→class 映射表(暴雪事实,~40 项写死在 `data/specToClass.ts`)。CI 缺失(如宠物/未知)→ 0。
- **宠物归属 ownerId**:advanced 载荷的 ownerGuid(非 0 值)。

## 任务(每个 = 契约测试 + agy 实现 + 验收 + commit)

1. **types + specToClass 表**:`src/l3/model.ts`(spec 的 GladUnit/GladMatch/GladShuffleRound/GladShuffle/事件对象类型)+ `src/l3/data/specToClass.ts`。测试:映射表抽查(257→Priest 等 10 个)+ 类型编译。
2. **flags 工具 + roster reducer**:`src/l3/flags.ts`(decodeFlags→{affiliation,reaction,kind})+ `src/l3/roster.ts`(注册单位、owner 判定、reaction 多数决、宠物归属)。合成测试 + DAMAGE/CAST 真实行断言(owner=Vierforfear 等)。
3. **事件收集 reducers**:`src/l3/collect.ts`(hp/aura/cast/extraSpell/absorb/death/advanced 各自装入对应单位的数组,含 petCasts 归主)。合成行断言各数组内容与 effectiveAmount 透传。
4. **outcome + composeMatch**:`src/l3/outcome.ts` + `src/l3/compose.ts`(buildMatch/buildShuffle,内容哈希=rawLines 的 FNV/sha 简化实现,linesTotal/linesDropped 从 GladLogParser stats 注入)。合成测试:胜负规则全分支(Win/Lose/255/无死亡 round)。
5. **fixture 黄金断言 + API 升级**:GladLogParser 事件升级为 `match`(GladMatch)/`shuffle`(GladShuffle)(保留段级事件为内部);fixture 测试:one_solo_shuffle → 6 回合各自 units=6 玩家、round1 真死亡=Kyberz@22:13:22、3 个假死不入 deaths、每回合 teamId 重分;early_leaver → 2 回合、整场 result Unknown;two_matches → 2 场胜负正确。
6. **10 文件真实日志冒烟**:tsx 脚本跑 playstyle-cache 前 10 个文件,断言 0 异常、每场 units 数合理(2v2=4/3v3=6/shuffle 回合=6)、诊断计数打印。结果记 ledger。

## 完成定义

- 全部任务绿 + typecheck;fixture 黄金断言过;冒烟 0 异常。
