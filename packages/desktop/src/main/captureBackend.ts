/**
 * 采集端抽象(design doc §6 修订版)。设计文档旧版 `onChunkOpened` 返回
 * `void`;这里是修订版——改成返回退订函数(复核 M9),因为托管 backend 的监听器是
 * 常驻的(obs-websocket-js 没有 `off`),调用方必须能在自己生命周期结束时不再被
 * 回调打扰。
 *
 * 复核 I2 记录的单实现 seam:一期状态机(`recorder.ts`)不经这个接口,继续走
 * `ObsClientLike`(旁路)。托管 backend 的接线是 Task 5 的工作,这里刻意零消费者
 * ——两套实现共存到旁路退役评估那天再合并,不在本任务范围内提前做。
 */

/** 一个分片(连续录制里,一次 SplitRecordFile 切出的一段;可能承载多场对局)。 */
export interface CaptureChunk {
  videoPath: string;
  /** backend 侧盖的墙钟时间——调用方不再自己盖时间戳,这正是 design doc §2.6
   * 那个"缺头 clamp 成 0"bug 的根(startedAt 曾经在别处、比事件到达晚盖)。 */
  startedAt: number;
  /** 分片仍在录制中(还没被下一次分片或 StopRecord 关闭)时为 null。 */
  stoppedAt: number | null;
}

export interface BackendHealth {
  ready: boolean;
  /** stage 1 固定 "obs_x264"(没有 websocket 编码器枚举 API);未连接/未配置时
   * 为 null。 */
  encoder: string | null;
  /** 采集源是否真的挂上了画面(黑帧探针的结果)。 */
  sourceActive: boolean;
  lastError: string | null;
  /** true once the backend has been shut down for good (managed OBS, GH
   * #213: shutdown() is terminal). A caller still finishing setup work that
   * began before the shutdown -- the managed assembly's configureSession()
   * during app quit -- stops there instead of reporting "not ready" or
   * starting the WoW watcher. Absent = not disposed. */
  disposed?: boolean;
}

export interface CaptureBackend {
  /** WoW 在跑 → 开始连续录。幂等——已经在连续录时再调用是no-op。 */
  startContinuous(): Promise<void>;
  /** 停止连续录,返回刚关闭的分片(没有分片时为 null)。 */
  stopContinuous(): Promise<CaptureChunk | null>;
  /** 切一刀,返回刚被关闭的分片(还没有分片时为 null)。backend 自己从不主动分片
   * ——分片时机完全由调用方(Task 5 的对局边界检测)掌握。 */
  splitChunk(): Promise<CaptureChunk | null>;
  /** 订阅分片开启(首个分片 / 每次 RecordFileChanged)。返回退订函数。 */
  onChunkOpened(cb: (c: CaptureChunk) => void): () => void;
  /** hybrid_mp4 章节标记,U3;失败静默(纯增强,从不影响录制主链路)。 */
  markChapter(name: string): Promise<void>;
  probe(): Promise<BackendHealth>;
  shutdown(): Promise<void>;
}
