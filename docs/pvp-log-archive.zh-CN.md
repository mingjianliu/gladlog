# PvP log 长期归档

[English](pvp-log-archive.md) · **中文**

`packages/corpus-tools` 下的 `scripts/archivePvpLogs.ts` 每 6 小时扫一次
wowarenalogs.com 公共 feed,把**归档 bracket 内**新出现的公开对局以**原始 gzip
字节**下载并归档到 Google Drive,按天分目录存放。只采集不加工——不解析、不算指标、不改动原始字节。
合规依据(数据源、条款、采集自律)见 [DATA-COMPLIANCE.zh-CN.md](DATA-COMPLIANCE.zh-CN.md);
设计与每个参数背后的实测数字见
`docs/superpowers/specs/2026-08-01-pvp-log-archive-design.md`。

## 归档哪些 bracket

`ARCHIVED_BRACKETS`(`src/pvpLogFetch.ts`)—— **3v3 与 Rated Solo Shuffle;
2v2 不归档**,这是 2026-09-04 的用户裁决。它喂养的语料工作此前已经把它排除了
(盲评真值回路按模式分,2v2 无价值影响;rotation study 2026-08-29 去掉了 2v2)。

省下来的到底是什么,按 2026-09-04 那一轮实测(该轮新建的三个日分片共 7,937 场、
5.38 GB):

| Bracket            | 场次  | 占比  | 字节    | 占比  |
| ------------------ | ----- | ----- | ------- | ----- |
| 2v2                | 2,765 | 34.8% | 0.70 GB | 13.0% |
| 3v3                | 3,872 | 48.8% | 1.98 GB | 36.8% |
| Rated Solo Shuffle | 1,300 | 16.4% | 2.70 GB | 50.2% |

省的是**墙钟时间,不是 Drive 续航**:一轮的耗时是每场一个
`DOWNLOAD_SLEEP_MS`,与这场多大无关,所以砍掉 34.8% 的场次约等于砍掉三分之一的
运行时长,却只让出 13% 的字节。Rated Solo Shuffle 是反过来的形状 —— 六分之一的
场次、一半的字节 —— 所以给这两者做容量估算时,bracket 的**场数占比和字节占比不
能互相替用**。

它是**独立于 `KNOWN_BRACKETS` 的常量,两者不能合并**。`KNOWN_BRACKETS` 陈述的是
服务端的事实 —— feed 只认这三个值 —— 所以拼错会直接报错,而不是静默查出空结果;
`ARCHIVED_BRACKETS` 陈述的是我们自己的采集策略。改窄 `KNOWN_BRACKETS` 会让显式
的、人工发起的 `BRACKET=2v2 npm run logs:fetch-public` 直接抛错,而那是另一条按
需拉取的路径,没人要求取消。子集关系由常量上的 `readonly Bracket[]` 类型标注保证
(服务端不认的 bracket 编译不过),外加 `src/pvpLogFetch.test.ts` 里的运行时用例。

每轮开跑会打印本轮覆盖的 bracket 集合,由这两个常量推导得出 —— 这样下面「每个
bracket 是不是都停在连续已知阈值上」的核对才知道该期待几行停页,被策略跳过的
bracket 也不会被读成被截断的:

```
本轮 bracket:3v3 / Rated Solo Shuffle(按采集策略不归档:2v2)
```

已经归档过的 2v2 日目录原样留在 Drive 上 —— 这条改的是**此后采集什么**,不是
已经采集过什么。

## 凭据

**这一节是既成事实的记录,不是待办。** 自 2026-08-23 起,`gdrive:` remote 走的是
**自建的 Google Drive client_id**,已经不是 rclone 内置的那个共享 client_id
(后者被 Google 定在 2026 年内退役)。

|              |                                                                       |
| ------------ | --------------------------------------------------------------------- |
| GCP 项目     | `gladlog-archive`                                                     |
| OAuth 客户端 | `gladlog-archive-desktop`,应用类型 **Desktop app**                    |
| 发布状态     | **In production**                                                     |
| Scope        | `.../auth/docs`、`.../auth/drive`、`.../auth/drive.metadata.readonly` |

验收判据就是一行输出:以前每次调用 rclone 都会打
`NOTICE: gdrive: This remote uses rclone's shared Google Drive client_id...`,
现在这行出现 **0** 次。`rclone config show gdrive:` 里应能看到 `client_id` 字段。

### 需要重做时(换机器、token 被吊销)

按 https://rclone.org/drive/#making-your-own-client-id 建好 OAuth 客户端,然后:

```bash
rclone config update gdrive client_id <ID> client_secret <SECRET> --non-interactive
printf 'y\ny\nn\n' | rclone config reconnect gdrive:
```

第一次做的时候有两件事会白花时间:

- **发布状态必须是 In production。** 留在 Testing 也能用,但**所有授权一周后过期**。
  对无人值守的归档器来说这不是「注意事项」,是七天后必然发生的静默失效。
- **`rclone config reconnect` 有三个交互提示,不是两个**:`refresh?` →
  `auto config?` → **`Shared Drive (Team Drive)?`**。第三个是在 `Got code`
  **之后**才问的,所以只答前两个会让进程在**授权已经成功之后**崩在
  `Failed to read line: EOF` 上 —— token 根本没写盘,而症状看起来跟「授权失败」
  一模一样。上面那条 `printf` 里的 `n` 就是给它准备的。

凭据这条路径值得如此小心的原因:它一坏,归档器这边的表现是**静默失败** ——
`rclone copy` 返回非零,本次运行保留本地暂存并等下次重试,于是暂存目录只涨不清。
下面的 20GB 剩余空间保护最终会让进程停下来,但那是**停机**,不是**告警**——没人会
知道原因。

## 怎么跑

```bash
cd packages/corpus-tools
npx tsx scripts/archivePvpLogs.ts
```

需要 `PATH` 上有 `rclone` 且已配置好 `gdrive` remote(或用 `RCLONE_REMOTE` 指向
其他已配置的 remote 名)。脚本会在**碰 feed 之前**先检查这两项,缺哪个就带着配置
说明退出 —— 否则它会从一个志愿者项目的存储里下走几万场,却一个字节都传不上去。

`DRY_RUN=1` 仍然会扫 feed、下载、写本地暂存(演练的意义正在于此),但**完全跳过
冲刷**:不上传、不往账本记 uploaded、不删任何本地文件。它**不是**「rclone 带
`--dry-run`」:`rclone copy --dry-run` 什么都没传却退 0,把它当成上传成功就会给
根本不在 Drive 上的场次写下 `uploaded: true`,而下一次正常运行会据此删掉本地字节、
并且永不重下。由于暂存不会被清空,`DRY_RUN` 跑完会把下载物留在盘上等下次正常运行
上传 —— 不想要的话手工删掉 `ARCHIVE_ROOT/staging`。

上面这个预检**验不到**的部分要说清楚:它只确认 `rclone` 在 `PATH` 上、且
`rclone listremotes` 里存在名为 `gdrive`(或 `RCLONE_REMOTE`)的 remote ——
从不触碰鉴权,token 过期或权限被收回照样静默通过。`DRY_RUN=1` 现在完全不走
rclone(见上),也顶不了鉴权演练。所以要直接手动验证鉴权 —— 但注意
`rclone lsd gdrive:` **单独一条并不够**:列目录只证明了只读的目录路径能走,而一次
冲刷依赖的是 `rclone cat`(读当天的云端 `index.jsonl`)和 `rclone copy`(上传本身)。
两条都要打:

```bash
# 读路径 —— flushDay 的第一步
rclone cat gdrive:gladlog-pvp-archive/2026/08/23/index.jsonl | wc -l
# 写路径 —— 传个探针上去、读回来、再删掉
mkdir -p /tmp/authcheck && date > /tmp/authcheck/probe.txt
rclone copy /tmp/authcheck gdrive:gladlog-pvp-archive/_authcheck
rclone cat gdrive:gladlog-pvp-archive/_authcheck/probe.txt
rclone purge gdrive:gladlog-pvp-archive/_authcheck
```

任一条报错,就先修好鉴权再启用定时任务。

## 环境变量

| 变量                | 默认                                      | 说明                                    |
| ------------------- | ----------------------------------------- | --------------------------------------- |
| `ARCHIVE_ROOT`      | `$HOME/code/gladlog-eval-private/archive` | 暂存与账本根目录                        |
| `RCLONE_REMOTE`     | `gdrive`                                  | rclone remote 名                        |
| `DOWNLOAD_SLEEP_MS` | `2000`                                    | 下载间隔,**别调成 0**(上游是志愿者项目) |
| `MAX_PAGES`         | `2000`                                    | 每 bracket 每次运行的翻页上限           |
| `DRY_RUN`           | 空                                        | `1` = 完全跳过冲刷(见下)                |

`DOWNLOAD_SLEEP_MS` 与 `MAX_PAGES` 经 `parseThrottleEnv`(`src/archivePlan.ts`)
处理,带**硬下限**,但两类「无效」待遇不同。**空串或压根没设**会被当成
「这个变量没配置」,静默退回默认值、不打印任何东西——这是变量单纯没设的正常
情况。**非数字、或低于下限的取值**待遇不同:同样退回默认值,但脚本会打印一条
`console.warn` 点名具体是哪个变量、什么取值,因为这种情况通常意味着变量被
设成了错的东西,而不是单纯没设。`DOWNLOAD_SLEEP_MS` 的下限是 250ms
(`MIN_DOWNLOAD_SLEEP_MS`);`MAX_PAGES` 的下限是 1。两种情况都不能静默变成
`0` 的原因:`Number("")` 是 `0`、`Number("2s")` 是 `NaN`,而
`setTimeout(r, NaN)` 表现等价 `0ms`——不拦截的话,两者都会静默取消对上游
feed 的礼貌节流。

## 为什么存压缩字节

GCS 侧每份日志本就以 gzip 存储(`content-encoding: gzip`)。下载并直接落盘压缩
字节、而不是先解压再存,实测在同一批对象上小 **11.4 倍**。这让一块 5TB 的
Google Drive 的可用时长从解压存的约 **27 周** 变成压缩存的约 **6 年**——是本设计
里收益最大的单点决定。背后的实测数字(feed 深度、单场体积、增速)见设计文档
「实测底数」一节。

## 装成定时任务(launchd)

plist 文件在 `packages/corpus-tools/ops/app.gladlog.pvp-archive.plist`,
**不会自动装载**——把它提交进仓库本身什么都不会发生。**什么时候启用由使用者
决定**,这篇文档不替你拍板。**截至 2026-08-23,它仍然刻意没有装**:目前是手工
起归档器,一边跑一边攒本赛季语料。这是一个明确的决定,不是遗漏 —— 别当成缺陷去
「补装」plist。

手工重复起是安全的:脚本带并发锁,检测到已有归档进程在跑会立刻退出。

装载:

```bash
sed 's|<仓库路径>|/绝对路径/到/gladlog|' \
  packages/corpus-tools/ops/app.gladlog.pvp-archive.plist \
  > ~/Library/LaunchAgents/app.gladlog.pvp-archive.plist
launchctl load ~/Library/LaunchAgents/app.gladlog.pvp-archive.plist
```

停用:

```bash
launchctl unload ~/Library/LaunchAgents/app.gladlog.pvp-archive.plist
```

一天跑 4 次(本机时间 01:00 / 07:00 / 13:00 / 19:00),日志写到
`/tmp/gladlog-pvp-archive.log` / `.err`。用 launchd 而不是 cron 是刻意选择:
合盖错过的任务 cron 直接跳过不补,而 launchd 的 `StartCalendarInterval`
会在唤醒后补跑。

## 运维注意

1. **新增 0 场要当故障看,不是「今天正好没有」。** 正常每次运行都该有上千场
   新增。0 说明 feed 挂了或查询失效(如上游改了 schema)——脚本会打一行明确的
   警告,但不会主动通知任何人。feed 检索窗口仅约 7 天,这种故障静默持续一周就是
   **永久**丢一周数据。
2. **启用时机由使用者决定,plist 不会自己动。** 当前状态(2026-08-23 起刻意手工
   跑、不装 launchd)见上面「装成定时任务」一节的说明与装载/停用命令。

## 已验证到什么程度

**已真机验证**(完整数字见
`.superpowers/sdd/2026-08-01-pvp-log-archive/task-6-report.md`):对活 feed 单页
扫描、下载并暂存压缩字节、上传到 Drive、账本只在上传确认成功后才写入、以及连续
两次运行间的账本去重(首轮:114 场确认上传,之后本地暂存清空,`rclone ls` 在
Drive 上看到 115 个文件 = 114 个 `.txt.gz` + 1 个 `index.jsonl`)。

**此后已在生产中验证**(2026-08-23 那轮:约 80 分钟新归档 1345 场,下载尝试
1345 次 → 1345 场入库,退出码 0,无 skip、无上传失败):

- **分批冲刷。** 全程观察到本地暂存涨到约 200 个文件又排空、如此反复,而不是
  一路堆到最后才传。
- **200 连续已知的停止翻页阈值。** 三个 bracket 全部以这种方式停页 —— 2v2 在
  237 连续已知、3v3 在 204、Rated Solo Shuffle 在 207。(那一轮早于上面
  2026-09-04 的裁决;此后每轮只扫两个 bracket,该期待两行而不是三行。)这也是
  读任何一份运行日志时该先看的一行:停在**已知阈值**上说明本轮追平了,而停在
  `queryLimitReached` 上说明深翻页被截断、这一轮可能有收集缺口。
- **`classifyIndexFetch` 的「ok」分支。** `rclone cat` 对真实云端索引
  (`2026/08/23/index.jsonl`,1653 行)读取并解析成功。

**仍无真机证据**:20GB 剩余空间保护、冲刷上一次运行遗留的暂存,以及另外单独一条
—— 下面要说的 `classifyIndexFetch` 的「索引不存在」分支。

**下次真机冒烟第一件事该核实的风险**:`classifyIndexFetch`
(`src/archiveUpload.ts`)靠一个匹配 `rclone` stderr 文本的正则,判断
`rclone cat` 失败的原因是「当日云端索引本就还不存在」(正常情况,按空索引继续)
还是「真的读失败」(必须放弃本次冲刷、保留本地暂存)。成功分支现在已在真机上确认
(见上),**但正则本身没有** —— 它从未对过 rclone 面对一个不存在的对象时真正吐出
的 stderr。两条命令就能了结:

```bash
rclone cat gdrive:gladlog-pvp-archive/2026/08/23/nosuchfile.jsonl   # 对象不存在、目录存在
rclone cat gdrive:gladlog-pvp-archive/1999/01/01/index.jsonl        # 目录不存在
```

两种误判后果**不对称**:把「读失败」误判为「不存在」会
用本地这一批**覆盖掉云端当天完整的索引**——这是不可逆的;反过来把「本就不存在」
误判为「读失败」是可恢复的那一侧:暂存保留、下轮重试。所以这个正则刻意收得很窄——
`object|directory|file not found`,对应 rclone 自己的 `ErrorObjectNotFound` /
`ErrorDirNotFound` 文案——其余一律判为读失败,包括文案里含 "no such host" 的 DNS
故障、以及 "didn't find section" 这类 rclone 配置错误。

但这份「窄」买来的残余风险要写清楚,它**不只是「少赚一次冲刷」**:如果 rclone 真实的
「不存在」文案不在这三个之内,那么**每一天的首次冲刷**都会被判成读失败,暂存永不排空,
归档器一场也传不上去——静默停摆,与「凭据」一节里描述的那种失败同形。
因此下次真机冒烟最先要核实的,就是对象不存在时 `rclone cat` 的实际 stderr 文案。

下次冒烟也应该改用 `MAX_PAGES=3` 或更多,并且**按 `logObjectUrl` 计重,不是按
match `id`**。Solo Shuffle 一场打 6 轮,6 轮共享同一个 GCS 日志对象但各有不同
的 id——按 id 计重对这整类重复是失明的。
