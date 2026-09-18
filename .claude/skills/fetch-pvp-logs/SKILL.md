---
name: fetch-pvp-logs
description: 按专精/分数过滤,在 wowarenalogs 的登录额度(每账号每天 15 个日志)内下载其他玩家的 WoW PvP 原始 combat log。Use when asked to 下载他人对局/拉外部 log/找某专精高分场次样本。不是语料采集工具 —— 归档器 2026-09-15 已退役。
---

# 下载他人 PvP combat log(按专精/分数过滤,额度内定向抽样)

数据源:wowarenalogs.com(**第三方志愿者项目**;本仓只 fork 过其代码,数据并非自有)。
2026-07 全渠道普查结论:**这是全生态唯一**收集并公开分发他人 PvP 原始 combat log
的渠道——Warcraft Logs 无 PvP 且不提供原文,Blizzard API 只有排行榜,其余社区站
(Murlok/Drustvar/check-pvp/RatedTracker/PvPLogs/REFlex)全是记分板元数据。

下载物 = 标准 WoWCombatLog 单场片段(`ARENA_MATCH_START` → `ARENA_MATCH_END`),
gladlog parser 直接可解析。

## 2026-09-13 起的访问模型(先读这段)

上游因为「bots have been scraping combat logs in bulk」改了接口(他们的源码
`packages/shared/src/utils/accessLimits.ts`、`graphql-server/utils/accessGuard.ts`,
2026-09-15 对线上 API 实测):

| 面                              | 现在                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| 搜索 `latestMatches`            | 必须带 Battle.net 登录态;匿名 → `UNAUTHENTICATED`;最近 1 小时的场次不可见;翻页不计量但按用户记日志 |
| 原始日志                        | 桶已私有(裸 `logObjectUrl` 403);走 `logDownloadUrl(matchId)` 拿 **10 分钟**签名地址        |
| 额度                            | **每账号每 UTC 日 15 个不同日志**,固定值无分档、无付费档;同日重开同一 id 不扣;`admin` 豁免、`blocked` 全拒 |
| 拒绝                            | HTTP 200 + GraphQL error `LOG_QUOTA_EXCEEDED`,原话 "You've reached today's limit of 15 matches … resets at midnight UTC." |

**这条额度是对方专门为了挡批量抓取设的,我们按它给的用:一个账号、服务端说停就停。**
多账号 / 共享会话 / 换 UA / 任何找回旧量级的做法都不做(`docs/DATA-COMPLIANCE.md` §3)。
全量归档器 `archivePvpLogs.ts` 已退役并拒绝启动;要量,只有 BACKLOG #19 的自建采集一条路。

## 用法

一次性:在 Chrome 登录 https://wowarenalogs.com(Battle.net OAuth),
DevTools → Application → Cookies → `https://wowarenalogs.com` → 复制
`__Secure-next-auth.session-token` 的值,写到 `~/.gladlog/wal-session-cookie`(`chmod 600`;
这是凭据,**别放进任何仓库、别贴进聊天**),或临时 `WAL_COOKIE=<值>`。

```bash
cd packages/corpus-tools
SPEC=Shaman_Restoration MIN_RATING=2100 npx tsx scripts/fetchPvpLogs.ts
```

| 环境变量          | 默认                                                      | 说明                                                                                                              |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `WAL_COOKIE`      | 空                                                        | 会话 token(裸值或完整 Cookie 头);为空则读 `WAL_COOKIE_FILE`                                                       |
| `WAL_COOKIE_FILE` | `~/.gladlog/wal-session-cookie`                           | 存 token 的文件;两者都没有则直接退出并打印取法                                                                       |
| `BRACKET`         | `3v3`                                                     | `2v2` / `3v3` / `Rated Solo Shuffle`                                                                              |
| `MIN_RATING`      | 0(不过滤)                                                 | **只有 1400/1800/2100/2400 四档生效**(服务端按场均 MMR 分档;传 2700 等效 2400)                                    |
| `SPEC`            | 空(不过滤)                                                | 逗号分隔,数字 specId 或 `CombatUnitSpec` 枚举名(如 `Shaman_Restoration,105`)。多 spec = 同一队同时含这些专精      |
| `SPEC_ROLE`       | `recorder`                                                | `recorder`=上传者本人是该专精(advanced logging 视角最优,做该专精分析用这个);`any`=场上任意玩家(敌我不限,样本量大) |
| `LIMIT`           | 15                                                        | 本次运行**新下**的场数上限;真正的硬闸是服务端计数,到了就停;同日已满则零请求退出                                        |
| `OUT_DIR`         | `$GLADLOG_EVAL_HOME/downloads/<bracket>-<rating>-<spec>/` | 落盘目录                                                                                                          |
| `MAX_PAGES`       | 40                                                        | 翻页兜底(spec 的 recorder 细筛在客户端,冷门条件别无限翻——翻页读费记在志愿者项目账上)                                |

产物:每场 `<matchId>.txt` + `manifest.json`(bracket、`playerTeamRating`、双方 MMR、
胜负、时长、记录者与全员的 spec/个人 CR、GCS meta 时区/年份——log 内时间戳无年份
且为上传者本地时区,重建绝对时间必须用 manifest 里的 `gcsMeta`)。每场之后打印
`quota <used>/<quota>`,收尾打印剩余额度和 UTC 重置时间。

专精 id 速查(治疗):105 奶德 / 270 奶僧 / 65 奶骑 / 256 戒律 / 257 神牧 / 264 奶萨 / 1468 奶龙。
全表见 `packages/parser-compat/src/enums.ts` 的 `CombatUnitSpec`。

## 每日定额拉取(用户裁定 2026-09-15,launchd 已装)

每天把 15 个额度用在**过滤能到的最高档 2100+、任意专精、任意上传者**上:先 **Solo Shuffle 10 盘**
(一盘 = 6 轮 = 1 个额度,实测),再 **3v3 补满剩下的 5**(shuffle 没凑够 10 时 3v3 多拿;
09-15 当天从 5/10 改成 10/5)。
专精抓取时不筛,事后按 manifest 的 `players[].spec` 筛(用户不用 wowarenalogs,
`SPEC_ROLE` 的 recorder 语义与用户本人无关)。

```bash
cd packages/corpus-tools
npm run logs:daily          # 驱动:scripts/dailyPull.ts → 每步一次 fetchPvpLogs.ts
npm run logs:daily:status   # 最近 7 次运行 + 今日额度 + cookie 写入时间
```

落盘:`$GLADLOG_EVAL_HOME/downloads/RatedSoloShuffle-r2100-allspecs/` 与 `3v3-r2100-allspecs/`
(各自 manifest 断点续传);运行记录 `downloads/daily-pull/runs.jsonl`(每次一行:各步
bracket/limit/fresh/exit、结束时额度、状态 ok / auth-expired / error)。

「小心」由脚本自己保证,不靠人记:

- 额度状态记在 `downloads/wal-quota-state.json`(按账号不按过滤条件),
  **同一 UTC 日额度已满时再次启动零请求直接退出**;跨日自动作废。驱动每步之后从这个
  状态重新规划,不会多要一个;规划按 **UTC 日**而非进程——同日重跑(或合盖后补跑)会从
  `runs.jsonl` 读到今天已做完的 bracket,剩余额度直接给 3v3,不会再给 shuffle 发一份
  (2026-09-16..18 三天只拿到 10/15、3v3 一次没跑,就是这个再规划 bug,09-17 修)。
- 每页 50 个 stub 通常一页就够;只有新场不足才翻下一页,每步上限 3 页;步骤严格串行。
- 下载间隔 2s、页间隔 500ms;服务端计数是硬闸,本地只是提前刹车。

**cookie 到期**:fetchPvpLogs 以退出码 3 报「无可用会话」,驱动记 `auth-expired` 并弹 macOS
通知「登录已过期」;`logs:daily:status` 末行也会提示。处理 = 浏览器重新登录、把新的
`__Secure-next-auth.session-token` 写回 `~/.gladlog/wal-session-cookie`。next-auth 会话
30 天滚动续期,每天跑一次正常不会过期。

**launchd**(2026-09-15 已装载):`ops/app.gladlog.daily-pull.plist` → `~/Library/LaunchAgents/`,
每天本地 21:00(UTC 0 点重置后,冬夏令时都过了),合盖错过的在唤醒后补跑。
stdout/stderr 在 `downloads/daily-pull/launchd.log`。
重装:`launchctl bootout gui/$(id -u)/app.gladlog.daily-pull; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.gladlog.daily-pull.plist`。

## 已知坑

登录额度路径(2026-09-15 实证):

- **grant 在申请时扣额度,不在下载成功时。** 下载失败也已经花掉一个;同日重申请同一 id
  免费,所以脚本重跑不会二次扣。永远在下载前一刻申请,别攒一批地址再慢慢下(10 分钟过期)。
- **grant 的 matchId 是 GCS 对象名**(`logObjectUrl` 最后一段,`logObjectIdFromUrl`),
  不是 stub 的 `id`:Solo Shuffle 六轮共享一个对象,拿轮 id 去申请会签出不存在的对象。
  顺带:一场 shuffle 只扣一个额度。
- **GraphQL 错误在 HTTP 200 里**,`fetchWithRetry` 不重试不告警;`fetchDetailedStubs`/
  `requestLogGrant` 现在会先分类 `errors[0].extensions.code`(`UNAUTHENTICATED` /
  `LOG_QUOTA_EXCEEDED` / 其他)再读 `data`,别再手写 `json.data` 直取。
- cookie 过期表现为 `UNAUTHENTICATED`;脚本会打印取法后退出 1。next-auth 的会话是
  数据库会话,浏览器里重新登录即可拿到新值。
- 最近 1 小时的场次搜不到(服务端禁运期),不是过滤条件写错。

feed 语义(2026-07-29 实证,未变):

- **feed 只覆盖最近约 7 天**(服务端 stub 7 天过期;GCS log 对象约 30 天)。攒样本
  要隔几天重跑同一命令——断点续传保证只增不重。没凑满 LIMIT ≠ 出错,是近期就这么多。
- `MIN_RATING` 必须与 `BRACKET` 同传(裸 minRating → Firestore FAILED_PRECONDITION);
  脚本已处理,手写 GraphQL 时注意。
- comp 索引是 specId **字符串字典序**(`["263","1468"]` → `"1468_263"`),不是数值序;
  用 `buildCompQueryString`,别手拼。
- Solo Shuffle 一场 6 轮共用一个 log 文件,脚本按 `logObjectUrl` 去重,一场只下一份。
- 单场 log 可达 ~30MB(SS 整场)。
- 评分语义:过滤档位按**场均 MMR**;manifest 里 `playerTeamRating` 是上传者队伍分、
  `players[].personalRating` 是个人 CR——三者可能略有出入(如 minRating=2100 会出现
  teamRating 2097 的场次),按需自行二次过滤 manifest。
- 礼貌频率:翻页仍是志愿者项目的 Firestore 账单,别并发轰、别翻空页。

## 归档到 Google Drive(rclone,2026-07-30)

feed 只留 ~7 天、每天只能拿 15 场,下载物要长期留存 → 同步进 Google Drive
(`<remote>:gladlog-pvp-logs/<slug>/`,与本地 downloads 目录镜像,两边互为备份)。

一次性配置:`brew install rclone`(win:`winget install Rclone.Rclone`)→
`rclone config` 新建名为 `gdrive` 的 Google Drive remote(client id 留空用内置,
浏览器授权一次)。

日常两条:

```bash
cd packages/corpus-tools
SPEC=... MIN_RATING=... npx tsx scripts/fetchPvpLogs.ts   # 攒
npx tsx scripts/syncPvpLogsToDrive.ts                     # 归档(增量)
```

`DRY_RUN=1` 先看清单;`REMOTE=`/`SRC=`/`DEST=` 可改。增量语义是裸 `rclone copy`
(size+modtime):log 不可变天然跳过,`manifest.json` 每次变大会重传——**别**改成
`--ignore-existing`,manifest 会在云端变陈旧。

## 直接查 feed(不落盘)

GraphQL endpoint `https://wowarenalogs.com/api/graphql`,POST 需带会话 cookie,introspection 开放。
复用 `packages/corpus-tools/src/feedClient.ts` 的 `fetchDetailedStubs({ ..., cookie })`(服务端
bracket/minRating/compQueryString 过滤,分页 cap 50)与 `requestLogGrant`,加 `src/pvpLogFetch.ts`
的纯函数(`parseSpecArg` / `matchesSpecFilter` / `dedupeByLogObject` / `logObjectIdFromUrl`)。
别绕开它们手写谓词。查 stub 不扣额度,只有 grant 扣。

## 替代渠道(均已核实,别再调研)

- Blizzard PvP leaderboard API:只有名字/rating/胜负,无 log;可当「按 spec/rating
  圈定目标玩家」的筛选器用。
- wowarenalogs GitHub 仓库 `packages/parser/test/testlogs/`:个位数真实样本,无评分元数据。
- Warcraft Logs / Murlok / Drustvar / check-pvp / RatedTracker / PvPLogs / REFlex /
  SquadOV(已关站):拿不到原始 log,不用再看。
