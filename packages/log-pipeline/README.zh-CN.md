# @gladlog/log-pipeline

[English](README.md) · **中文**

跨机战斗日志中继:打游戏的机器把不断增长的 `WoWCombatLog*.txt` 流式写进一个共享文件夹(实践中是 Google Drive for Desktop 的文件夹),做分析的机器在自己这边重建出逐字节一致的副本。它是维护者工具 —— 从不进桌面应用的包 —— 并且和 `@gladlog/parser` 一样**不声明任何运行时依赖**(只用 Node 标准库)。

## 两个 bin

`package.json` 提供两条命令,都接到根脚本上(`npm run logs:stream` / `npm run logs:collect`;见 `docs/commands/collect-logs.md` §2):

| Bin               | 入口                | 跑在哪     | 做什么                                                                                                                                                                                                       |
| ----------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gladlog-stream`  | `src/streamCli.ts`  | 打游戏的机器 | 监视 `<wowDirectory>/Logs`,每 `flushIntervalMs`(默认 60 秒,且需先安静 `quietPeriodMs`)把上次检查点之后新增的字节 gzip 成一个 segment 文件写进存储文件夹。每次 flush 后写一条心跳。                              |
| `gladlog-collect` | `src/collectCli.ts` | 做分析的机器 | 轮询同一个文件夹,按 (主机, 文件, 代次) 给 segment 排序,按偏移顺序追加到 `outputDir/<name>.txt`,遇到缺口就等,并可选删除已完整应用且超过 7 天的 segment(`cleanup: true`)。                                        |

两者都接 `--config <file>`;streamer 要求文件名以 `.config.json` 结尾,因为它由这个后缀推导检查点文件(`*.state.json`);`gladlog-stream --check` 只校验配置与存储,不进入监视。

## 它靠什么保证正确

- **segment 键**(`src/protocol/segments.ts`):`raw/<host>/<logFile>/<gen8>/<start>_<length>.seg`。`gen8` 是文件第一行的哈希(`src/protocol/identity.ts`),所以同名重建的日志会被识别成新一代,而不是被当作损坏的续写。
- **可续传、幂等的 flush**(`src/flusher.ts`、`src/state.ts`):检查点按文件保存 `{offset, firstLineChecksum}`;状态文件丢失或损坏只会导致重传,而 collector 能容忍重传。
- **感知重叠的重建**(`src/protocol/reconstruct.ts`):在覆盖当前大小的 segment 里,collector 选伸得最远的那个,所以重复 flush 造成的重叠会自愈,而缺口会让它等待,而不是写入垃圾。
- **存储适配器**(`src/storage/`):四个方法的契约(`put` / `list` / `get` / `delete`),`localDir` 实现对应共享文件夹,内存实现用于测试。`diagnose` 让 collector 能解释同步客户端尚未拉取实体的「仅云端」占位文件。

## 与其它包的关系

这里不解析日志。重建出的 `.txt` 就是普通战斗日志,由桌面应用导入(`docs/commands/collect-logs.md` §1),并由 `@gladlog/corpus-tools` 归档到 Drive(`npm run logs:archive-own`)。桌面应用自己的实时 tail 是另一套代码,在 `packages/desktop/src/worker/`。

## 测试

```bash
npm test --workspace=packages/log-pipeline
```

Vitest,与源码同目录的 `*.test.ts`:适配器契约(`storage/adapters.test.ts`)、segment 键与重建(`protocol/*.test.ts`)、flusher、cleanup,以及走内存适配器的端到端 `roundtrip.test.ts`。
