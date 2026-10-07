# OBS 录像

托管 OBS 的一切只能在 Windows 真机上验——每次改完写清「待真机」和判据。

## 一期(外控)

parser segmentOpen / close → recorderService(obs-websocket 起停,串行链 + 安全阀)→ `recordings.ndjson` 时间窗关联(独立目录,绝不进 matches/)→ `vod://` Range 供片。

- 单排六轮共享 lobby 录像,录像查询走 videoMatchId(meta id 是首轮 id)。
- 自动检测读 OBS 的 websocket config **只读不写**(OBS 退出会回写整文件)。
- 「录像打完不停」的三个根因(断连后 doClose 门禁 no-op、fs.watch 无新事件不 flush、OBS 调用裸 await 悬挂)已修:3 min 静默阀、15 s 超时。
- 对账只清有正向证据(weStartedRecording)的自有录像,别误停用户手动录像。

## 二期(托管便携 OBS,勿再翻案)

- noobs 实为 GPL-2.0,所以托管一份便携 OBS、**首次运行从 obsproject 官方下载**,gladlog 分发物零 GPL 字节。
- 便携包没有 ffmpeg → 不裁剪:WoW 在跑就连续录,每场结束 `SplitRecordFile` 切一刀,纯挂机分片删;播放用 `computeVideoWindow` 夹到 [对局开始, 结束]。一个 mp4 带最多 10 分钟赛前大厅是设计如此(`IDLE_SPLIT_MS`,斗内绝不切)。
- spawn 必须带 `--disable-shutdown-check`(否则硬杀后下次卡「安全模式」框)。
- 用户设置单源 `src/shared/managedObsPrefs.ts`、`resolveRecordingDir`;设备枚举靠建一个隐藏探针输入再删,录制中拒绝枚举。

## 真机抓到的 bug(都已修)

- 4K 只录左上角 1/4:场景项无 transform → `SetSceneItemTransform` + `OBS_BOUNDS_SCALE_INNER`,画布 `MANAGED_CANVAS` 单源。
- 没声音:Advanced 录制音频编码器键从没写过;桌面声音通道改为先 `GetSpecialInputs` 问再补。
- global.ini `LastVersion` 写成版本串 → OBS 按 int 读 → 每次启动弹迁移错误框(改成整数 `OBS_API_VERSION`)。`[AdvOut] RecAudioEncoder` 要编码器 id `ffmpeg_aac` 而不是 "aac"(未知 id 返回占位对象不报错,到录制才失败)。**旧单测把两个 bug 一起 pin 住了**——新测试复刻 OBS 侧的读法。
- `StartRecord` 立刻回 200 不等输出,要再问 `GetRecordStatus`。
- 查法:`git clone --filter=blob:none --sparse` 拉 obs-studio 对应 tag 读源码;OBS locale ini 能把截图里的中文框反查成错误键。

## 教训

- 同一校验形状套到语义相反的字段会出事(keepCount 的 0 是宽松,maxBytes 的 0 是删光全库)。
- 复核要编译 shipped 代码用恶意输入实跑。
- 同一产物里「验证过的机制」和「没验证的机制」并存时,让没验证的向验证过的对齐。
- 只在更高分辨率暴露的 bug,1080p 门测天然瞎。

相关:[desktop-ui.md](desktop-ui.md)
