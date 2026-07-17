# collect-logs — 日志收集通道总览

四条通道,一个入口(root `npm run logs:*`)。原始日志是一切的源头:
战报/回放/AI 都从 `WoWCombatLog*.txt` 解析。

## 1. 本机实时(desktop 内置,无需命令)

应用监控 WoW `Logs/` 目录,打完自动入库;历史日志用应用内
「导入历史日志…」(设置页/首启引导),按场次去重。

## 2. 跨机中继(打游戏的机器 ≠ 分析的机器)

```bash
npm run logs:stream    # 游戏机:tail 日志 → Google Drive(断点续传)
npm run logs:collect   # 本机:从 Drive 字节精确重建日志文件
```

实现:`packages/log-pipeline`(独立部署包,状态/清理/心跳自带)。

## 3. 公开对局抓取(eval 语料;wowarenalogs 公开通道)

```bash
export GLADLOG_EVAL_HOME=~/code/gladlog-eval-private
npm run logs:fetch-public -- --count 60                       # 最新公开对局,过滤:记录者=DPS + 高级日志 + 仅 arena
npm run logs:fetch-public -- --count 60 --bracket 3v3 --min-rating 1600
```

- 产物:`$GLADLOG_EVAL_HOME/corpus/public-dps/<matchId>.txt` + `manifest-recorder-dps.txt`,
  直接喂 `buildCorpus --manifest ... --owner recorder`。
- **minRating 必须与 --bracket 同传**(服务端 Firestore 复合索引;单传 500)。
- 客户端 = `@gladlog/corpus-tools` 的共享 feedClient(与 pro 对比语料同一
  端点/重试/分页,`fetchDetailedStubs`/`downloadLogText`)——改查询只改一处。

## 4. pro 对比语料(cell 聚合)

`packages/corpus-tools`:同一 feedClient 拉高分段对局,聚合成 spec×bracket
基准 cell(verified comparison 用)。见 `corpus-tools/src/feedClient.ts`。

## 约定

- eval manifest = 每行一个日志绝对路径的纯文本;人手维护的主 manifest 在
  `$GLADLOG_EVAL_HOME/corpus/manifest*.txt`,抓取器产物自带 manifest。
- 所有 wowarenalogs 网络访问都过 `fetchWithRetry`(429/5xx 指数退避)+
  礼貌延时;GraphQL 的 combats 是接口类型,**必须**用
  `... on ArenaMatchDataStub` 内联片段选字段(直接选 400)。

## 5. 高手基准语料(reference corpus)刷新

```bash
# 全量重建(2300+,三个 bracket 各 1200 场,~1h;LOG_CACHE_DIR 缓存原始日志加速复跑)
WOW_PATCH=12.1.0.68629 LOG_CACHE_DIR=$HOME/code/gladlog-eval-private/corpus/logcache \
  npm run corpus:build-reference
```

产物 `packages/corpus-tools/data/reference_vectors.json`(dev 直读;打包进 release
resources)。含治疗 6 维 + DPS 7 维(爆发转化/免疫占比/协同/on-target/kick 等,
谓词=爆发账本三件套)。

**周度自动刷新(需自己安装,一条命令)**:

```bash
cat > ~/Library/LaunchAgents/com.gladlog.corpus-refresh.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.gladlog.corpus-refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd $HOME/code/gladlog &amp;&amp; WOW_PATCH=12.1.0.68629 LOG_CACHE_DIR=$HOME/code/gladlog-eval-private/corpus/logcache npm run corpus:build-reference >> /tmp/gladlog-corpus-refresh.log 2>&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
PLIST
launchctl load ~/Library/LaunchAgents/com.gladlog.corpus-refresh.plist
```

卸载:`launchctl unload ~/Library/LaunchAgents/com.gladlog.corpus-refresh.plist && rm 同文件`。
