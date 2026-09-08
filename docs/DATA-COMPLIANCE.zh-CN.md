# 数据与许可合规

[English](DATA-COMPLIANCE.md) · **中文**

这篇记录 gladlog 从外部拿了什么、依据是什么条款、以及哪些做法被我们明确排除。
写下来是为了不用每次从零调研 —— 也因为本仓在这件事上已经错过一次(早先的注记
把 wowarenalogs feed 写成「自有产品」,它不是)。

除另有注明外,以下结论均于 **2026-08-01** 核实。承重的每一条都带日期,因为条款会变,
而代码不会察觉。

## 1. 上游数据源

`wowarenalogs.com` 是**第三方志愿者项目**(法律实体 Alotof Technology LLC,
Kirkland WA;联络 `privacy@wowarenalogs.com`;维护者渠道为其
[Discord](https://discord.gg/NFTPK9tmJK))。我们与其无隶属关系。它的 Firestore
读取与 Cloud Storage 出口流量记在他们账上,不是我们的。

约束该站使用的文件,全部在此:

| 文件                                                    | 说什么                                                                                                                                                 | 对我们的影响                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| [privacy.html](https://wowarenalogs.com/privacy.html)   | 明文写「Your contributions to the Service are intended for public consumption and are therefore viewable by the public, **including your game logs**」 | 上传者已同意其 log 公开。这是我们最强的立足点。 |
| `robots.txt`                                            | `User-agent: * / Disallow:` —— 全放行,无 `Crawl-delay`                                                                                                 | 自动化访问不违反 robots。                       |
| [LICENSE](https://github.com/wowarenalogs/wowarenalogs) | `CC BY-NC-ND 4.0`,措辞为覆盖「WoW Arena Logs and **all other code** in this repository」                                                               | 只管**代码**,不管上传的日志数据。               |

**不存在 Terms of Service。** `tos.html` 返回 404,仓库里也没有任何 terms 文件,
只有 `packages/web/public/privacy.html`。所以既没有禁止自动化访问的合同条款,
也没有明示许可。我们的克制是一种选择,不是合规义务。

## 2. 我们用的接口,以及拒绝使用的那个

**使用 —— 公开 GraphQL feed。** `POST https://wowarenalogs.com/api/graphql`,
匿名,`latestMatches(...)` 带服务端 `bracket` / `minRating` / `compQueryString`
过滤,分页 cap 50;随后对返回的 `logObjectUrl` 做一次普通 GET。这就是他们自己
的前端在用的接口。

**拒绝 —— bucket 列举。** GCS bucket `wowarenalogs-log-files-prod` 把
`storage.objects.list` 授予了 `allUsers`,于是
`GET https://storage.googleapis.com/wowarenalogs-log-files-prod?max-keys=1`
对任何人返回全量对象清单,且不受 feed 那个 ~7 天窗口的限制。他们的前端从不需要
列举 bucket,所以这几乎肯定是配置疏漏,而非对外提供的接口。

**我们不用它。** 公开可访问 ≠ 意图公开,在一个项目实际发布的界面之外取数,不是
我们想依赖的东西。2026-08-01 决定:不使用,也不告知。记在这里是为了它不会被
重新「发现」后悄悄用上。

## 3. 采集自律(`packages/corpus-tools`)

- **可识别的 User-Agent**,覆盖每一个出站请求(feed 与 GCS 一视同仁),挂在
  `src/feedClient.ts` 的唯一咽喉 `fetchWithRetry` 上。没有它,我们在对方日志里
  跟任意爬虫无法区分,而对方唯一可用的处置就是整段封 IP,连带误伤别人。
- **按代价分开计额。** 翻页打的是 Firestore 读;单场下载打的是 GCS 出口带宽,
  一场 Solo Shuffle 可达 ~30MB。页间隔 500ms,下载间隔 2s(`DOWNLOAD_SLEEP_MS`),
  串行,绝不并发。下载计数器计的是**尝试**而非成功 —— 被丢弃的不完整下载同样
  已经消耗了对方带宽。
- **有界翻页**,但两个脚本干的活不同,上限也不同:`scripts/fetchPvpLogs.ts`
  (按专精/分数定向取样)的 `MAX_PAGES` 默认 **40**;`scripts/archivePvpLogs.ts`
  (顺序全量扫整个 feed)默认 **2000** —— 它必须能翻到约 39,000 条 stub 那个窗口的
  尽头才停。两者都会在短页、空页时提前停。服务端回 `queryLimitReached` 目前只有
  归档器处理(`scripts/archivePvpLogs.ts:342`):收到即 warn,处理完本页后就停止
  该 bracket 的翻页。`scripts/fetchPvpLogs.ts:134` 仍会整个丢弃这个标志
  (`const { stubs } = await fetchDetailedStubs(...)`)——不是疏漏而是尚未接入:
  它是维护者手动跑的一次性工具,`MAX_PAGES=40` 已经兜住了深翻页的上限。归档器
  另外还会在连续 200 场已知时停止。
- **断点续传,重跑绝不重下**:`fetchPvpLogs` 靠 `manifest.json`,归档器靠按天分片的
  账本。两者都按 `id` **与** `logObjectUrl` 双键去重 —— 一场 Solo Shuffle 的 6 轮
  共享同一个 GCS 对象,却有 6 个不同的 match id。
- **只对 429/5xx/网络错误重试**,指数退避封顶 15s。

feed 只留约 7 天(GCS 对象约 30 天),所以攒语料靠的是长期轮询,不是一次猛拉。

**2026-08-01 起,它已按常驻定时任务建成** —— 原先那句「哪天变成常驻定时任务就回来
重看本节」的支票现在兑现。(建成,不等于启用 —— 见下面最后一条。)`scripts/archivePvpLogs.ts` 顺序全量扫 feed、归档每一场新出现的
公开对局;`packages/corpus-tools/ops/app.gladlog.pvp-archive.plist` 用 launchd
**每 6 小时跑一次、一天 4 次**(本机时间 01:00 / 07:00 / 13:00 / 19:00)。
具体数字,以及我们为什么认为可接受:

- **节流参数与上面那条完全一致** —— 页间 500ms、下载间 2s、严格串行、同一时刻只有一个
  进程(按 pid 的运行锁:首次全量要约 22 小时,不加锁会与下一次调度启动重叠)。
  跑得勤于跑得久是刻意的:对方总负担不变,但拆得更碎、也更不容易因笔记本睡眠而丢。
- **我们拿走多少**:约 5,570 场/天、约 2.4GB/天的 GCS 出口流量,累积约
  **860GB/年**(gzip,即他们发出来的原样字节)。
- **对方要花多少**:按公开的 GCS 出口费率约 **$100–200/年**,记在一个志愿者项目账上。
  用户已知情并接受这个数字。以后真要压这笔钱,可动的杠杆是频率而不是压缩 ——
  我们存的已经就是他们发出来的那份字节。
- **它自始至终没有挂上调度。** plist 提交进仓库本身什么都不会发生,也从来没有人装载过
  它 —— 2026-08-23 的裁决是改为手工起。所以上面三条里的每一个数字都只是一个**从未
  真正跑过的频率的推算**;实际发生了什么,见下面的实测。启用/停用命令与运维注意见
  [pvp-log-archive.zh-CN.md](pvp-log-archive.zh-CN.md)。

若采集频率高于每 6 小时一次,或归档器不再是唯一的定时消费方,回来重看本节与 §1。

### 我们实际拿走了多少、让对方花了多少 —— 2026-09-08 实测

**2026-09-08,上游关停了 match search,我们已停止采集。** `latestMatches` 现在对任何
查询(带不带 bracket 都一样)都返回 **HTTP 200 加一条 GraphQL error**,
`extensions.code = SEARCH_DISABLED`:

> Automated scraping of search results has driven our hosting costs up sharply,
> so match search is discontinued until we can find a way to prevent it. Your
> own uploaded matches and any match shared with you by link are still
> available.

用户同日裁决:停,不重试、不找别的入口、不挂调度。另外记下这个故障的形状,免得下一个
来排查的人绕路 —— GraphQL 的错误不走 HTTP 状态码,所以 `fetchWithRetry` 既不重试也不
告警,归档器只会把它表现成一句笼统的 `feed-detailed: empty latestMatches response`。
下结论之前先把原始响应体打出来。

归档器手工跑的区间是 **2026-08-13 到 2026-09-05** —— 连续 24 个日分片,中间无缺口。
以下数字来自归档本身的实测,不是推算:

| 项目             | 数量                                        |
| ---------------- | ------------------------------------------- |
| 下载对局数       | 63,309 场                                   |
| 从对方桶里取走的字节 | 41.96 GiB —— 原始 gzip,即他们发出来的原样字节 |
| feed 翻页请求    | 约 1,200–1,500 次,每页 50 条 stub          |

按 GCP 公开标价(北美 → 互联网)折算对方的成本:

| 成本项                      | 用量           | 单价         | 估算      |
| --------------------------- | -------------- | ------------ | --------- |
| GCS 出站流量                | 41.96 GiB      | 约 $0.12/GiB | **约 $5.0** |
| GCS Class B 操作(对象 GET) | 63,309 次      | $0.004/万次  | $0.03     |
| Firestore 文档读(feed 查询) | 约 150–250 万次 | $0.06/10 万  | 约 $1–1.5 |
| API 侧计算与出站            | 约 1,400 次请求 | —            | < $0.5    |

**合计约 $7–10;把归档器上线之前那些零散拉取也算进去,不超过 $20。** 有两件事是这张
表本身说不出来的:

- **我们的翻页方式恰好是最伤的那种。** `archivePvpLogs.ts` 用
  `offset: page * 50, count: 50` 翻页,而 Firestore 对 `offset()` **跳过的**文档照样
  计费。翻 P 页的读数是 `50 × P(P+1)/2` 而不是 `50 × P` —— 光 2026-09-04 那一轮
  (11,872 场新对局)就约 53 万次读,而不是 2.4 万次。上表 Firestore 那行已经是放大后
  的数;如果他们的 resolver 并没有把 offset 直接透传,实际还会更低。谁要是哪天复活这个
  采集器,第一件事是换成游标分页 —— 这对对方是净省钱,对我们零代价。
- **金额小不代表占比小。** wowarenalogs 的用户是在浏览器里看解析好的对局,几乎没人去
  拉原始 gzip 对象。三周半、单一客户端、41.96 GiB,很可能已经是那个桶原始对象出站里
  数一数二的一份。「我们只花了对方十来美元」和「我们是这条成本线的主要来源」这两句话
  同时成立。

对方公告里说的是 *search results*,即查询路径而不是下载路径 —— 而那恰恰是我们的
offset 翻页最糟糕的地方。

## 4. 日志里的个人数据

战斗日志含角色名、服务器,以及 `Player-realmID-hexID` 形式的 GUID。GUID 跨角色
稳定,因此在 GDPR 下属于假名化个人数据,不是匿名数据。上传者同意了公开(见 §1);
同场其他玩家并未同意 —— 除游戏本身向参与者广播的那部分之外。

当前策略(2026-08-01 决定):**原样存储,不做假名化。** 理由:parser 需要 GUID
关联单位,且数据本就公开。这是有意选择,不是疏漏。

我们刻意**不**采集的:GCS 对象 meta header `x-goog-meta-ownerid`,它携带上传者的
账号 id。两个采集脚本都走同一个 `buildGcsMeta`,只取 `wow-version`、
`client-timezone`、`client-year`、`starttime-utc` —— 重建绝对时间所必需的字段,
因为 log 时间戳无年份且为上传者本地时区。`fetchPvpLogs` 把它们存进 `manifest.json`,
归档器存进账本以及 Drive 上按天的 `index.jsonl`;GCS 对象本身约 30 天后就消失,
下载时没采到的字段以后再也拿不回来。

下载物与 `manifest.json` 默认落在仓外(`$GLADLOG_EVAL_HOME`),严禁提交进公开仓库。

## 5. 代码许可 —— 真正要紧的那部分

gladlog 是 MIT。wowarenalogs 的代码是 **CC BY-NC-ND 4.0**,既禁商用**又**禁衍生。
两者不相容:MIT 再分发不可能叠在 ND 许可之上,而且光加署名并不能解决。

`packages/parser-compat/src/enums.ts` 在 2026-08-01 之前是逐行照抄他们的
`packages/parser/src/types.ts` —— 连他们的代码风格、以及把暴雪的 "Brewmaster"
误写成 `Monk_BrewMaster` 都一并抄了过来。

**修法:** `CombatUnitSpec` 与 `CombatUnitClass` 现在由
`packages/analysis/scripts/datagen/genCombatUnitEnums.ts` 从暴雪自己的 DB2 表
(`ChrSpecialization`、`ChrClasses`)生成,命名规则由本仓自定并写明。其余枚举各自
锚定到一项暴雪事实:`LogEvent` 的值就是日志格式里逐字出现的事件记号,
`CombatUnitPowerType` 对应客户端 API 的 `Enum.PowerType`,旗标掩码是公开的
`COMBATLOG_OBJECT_*` 常量。

关于这次改动做到了什么、没做到什么,得说实话。与他们文件的逐行重合**并没有下降** ——
归一化引号后是 108 → 115 行,因为 51 行 `LogEvent` 和 39 行 `专精名 = "暴雪id"`
本就是任何正确实现都必须表达的同一批事实。立论是独立推导与 merger,不是文本差异。
真正改掉的是**非事实**的那部分:

- `CombatUnitClass`:13/13 个取值全部替换。他们那套编号是自造的(`Hunter = 2`),
  我们还专门维护一张 `BLIZZARD_CLASS_TO_LEGACY` 翻译表去迁就它。现在取值**就是**
  暴雪的 `ChrClasses.ID`(`Hunter = 3`),翻译表已删除。
- 成员顺序:原本 41/41 个位置与他们相同,现在 1/41。
- 出处:取值随每个游戏版本从 DB2 重新生成,不再有任何从他们仓库手工誊抄的路径。

`packages/parser-compat/data/legacy-enum-manifest.json` 保留,且**不是**问题:
它是在旧包上运行时 dump 出来的(M4 计划明文禁止读他们源码),记录的是观察到的
互操作事实。为互操作而复制接口事实属于受青睐的情形,不是被否定的情形。差分预言机
不比 `class` 字段(其 `NormUnit` 只取 `spec`/`reaction`/`type`),所以这次改号
碰不到那道门。

## 6. 暴雪的美术素材,以及他们的 CDN

战斗日志是客户端生成的文本,玩家自行开启并上传;Warcraft Logs 以同一模式运营了
十几年。风险实际在**美术素材**,不在日志数据。

2026-08-01 之前,出货 App 在运行时热链 `images.wowarenalogs.com` 取专精图标与
竞技场小地图 —— 每个安装都在花志愿者项目的带宽,拿的还是他们二次托管的暴雪美术。

- **专精图标:已修。** `specIconName()` 现在把暴雪的
  `ChrSpecialization.SpellIconFileID` 解析成图标基名(`genSpecIcons.ts`,40/40
  全部解析成功),渲染走既有的主进程 `iconCache` —— 与技能图标同一条路,带永久
  磁盘缓存与会话级取图预算。
- **竞技场小地图:整个删除。** 它们一度被打进安装包 —— 那是在真正打开看之前
  做的决定。这些文件不是地图美术:每张都是 95–98% 全透明的 PNG,唯一的不透明
  内容是几个方块,而那些方块**就是本仓已经在用矢量画的同一批障碍物** ——
  连通块分析显示逐个同位(zone 1505:4↔4、1911:3↔3、2547:4↔4,位置差几像素)。
  那层底图是在 `arenaObstacles` 上又蒙了一遍 `arenaObstacles`。

  所以热链与内置都没换来任何视觉收益,各自却都有代价:前者花志愿者项目的带宽,
  后者把 15 个来源不明的二进制放进 MIT 仓库。两者均已移除。回放的地面表现全部
  来自自有数据:轮廓取自 `arenaFloors.json`(位置采样挖掘),障碍物取自
  `@gladlog/analysis` 的 `arenaObstacles` —— 与 LoS 谓词同源,覆盖 16 个 zone,
  比那批 PNG 还多一个。

现在 App **完全不再于运行时请求 `images.wowarenalogs.com`**。视觉回归会守住这条:
`qa/support/stubExternal.ts` 不再为任何外部主机放行,新增 CDN 依赖会指名道姓地
把用例打红,而不是留一条飘忽的基线。取图发生在主进程,Playwright 的 `page.route`
拦不到,所以 `iconCache` 增加了由 `GLADLOG_E2E=1` 置位的 `offline` 开关。

## 待决事项

- **定时轮询**(BACKLOG #19)—— **2026-09-08 被上游关停**,对方对所有人停掉了
  match search。采集已停止;我们拿走了多少、让对方花了多少,实测数字写在 §3。调度
  从来没有装载过,所以没有什么需要停用。2026-08-01「不联系维护者」的决定仍然有效、
  未重新审议;若哪天改主意,§3 里已经备好了可以直接摆出来的具体数字(63,309 场、
  41.96 GiB)。
- **技能与专精图标**仍在运行时取自 Wowhead 的 CDN(`wow.zamimg.com`),落盘缓存。
  那些美术属于暴雪且未授权给我们,建立在暴雪对同人工具的普遍容忍之上。这是仅剩
  的美术素材暴露点,也是每一个战斗日志工具都同样背着的那一个。
