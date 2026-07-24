import type { FileStatus } from "../shared/protocol";
import type { GladlogSettings } from "../main/settingsStore";
import type { StoredMatchMeta } from "../main/matchStore";

export interface LogsStatusSnapshot {
  watching: boolean;
  logsDir: string;
  files: FileStatus[];
}
export interface DiagnosticEntry {
  fileKey?: string;
  code: string;
  detail?: string;
  at: number;
}

export interface GladlogApi {
  logs: {
    getStatus(): Promise<LogsStatusSnapshot | null>;
    onStatusChanged(cb: (s: LogsStatusSnapshot) => void): () => void;
    onMatchStored(cb: (meta: StoredMatchMeta) => void): () => void;
    onDiagnostic(cb: (d: DiagnosticEntry) => void): () => void;
    /** 历史日志导入:弹文件选择框 → 逐文件解析入库;取消 → null。 */
    importFiles(): Promise<{
      files: number;
      stored: number;
      dup: number;
      failed: number;
    } | null>;
    onImportProgress(
      cb: (p: {
        file: string;
        i: number;
        n: number;
        stored: number;
        dup: number;
      }) => void,
    ): () => void;
  };
  matches: {
    list(): Promise<StoredMatchMeta[]>;
    get(id: string): Promise<unknown | null>;
    page(opts: { before?: number; limit: number }): Promise<StoredMatchMeta[]>;
    /** 一次性回填富行字段(逐目录读 match.json 重铸 meta),用户主动触发。 */
    rebuildIndex(): Promise<{ updated: number; failed: number }>;
    /** B2 溯源:事件 lineIndex → raw.txt 原始行(shuffle 传轮 sequenceNumber)。
     * 旧档无 lineIndex / 行不存在 → null,UI 降级隐藏。 */
    rawLine(
      id: string,
      opts: { roundSeq?: number | null; lineIndex: number },
    ): Promise<{ line: string; fileLine: number } | null>;
    /** C3 导出图片:离屏窗口渲染同一 renderer 后整页截图。savePath 仅
     * E2E/脚本直传;UI 调用省略 → 弹系统保存框。取消/失败 → null。 */
    exportImage(opts: {
      matchId: string;
      roundSeq?: number | null;
      range?: { fromS: number; toS: number } | null;
      savePath?: string;
    }): Promise<{ path: string; width: number; height: number } | null>;
  };
  settings: {
    get(): Promise<GladlogSettings>;
    save(partial: Partial<GladlogSettings>): Promise<GladlogSettings>;
  };
  app: {
    getVersion(): Promise<string>;
    selectDirectory(): Promise<string | null>; // 返回选中目录;取消 → null。选中即自动 save wowDirectory 并重启监控
    openExternal(url: string): Promise<void>;
  };
  compare: {
    run(input: {
      matchId: string;
      healerMetrics: Record<string, number | null>;
      spec: string;
      talents: number[];
      bracket: string;
      archetype: string;
      wowBuild: string;
    }): Promise<void>;
    cancel(): Promise<void>;
    getCached(matchId: string): Promise<unknown | null>;
    onDelta(cb: (d: { matchId: string; text: string }) => void): () => void;
    onDone(cb: (d: { matchId: string; result: unknown }) => void): () => void;
    onError(cb: (d: { matchId: string; message: string }) => void): () => void;
  };
  analysis: {
    run(input: {
      matchId: string;
      candidates: any[];
      richContext: string;
      spec: string;
    }): Promise<void>;
    cancel(): Promise<void>;
    /** 重挂时的单次原子查询:缓存 + 是否在跑。分两次问会漏掉恰好此刻完成的那轮。 */
    getState(
      matchId: string,
    ): Promise<{ cached: unknown | null; running: boolean }>;
    getCached(matchId: string): Promise<unknown | null>;
    getFlags(matchId: string): Promise<Record<string, string>>;
    /** 跨场 finding 聚合(category 计数 + 最近实例 + 标记统计)。 */
    aggregate(): Promise<
      Array<{
        category: string;
        count: number;
        recurring: number;
        done: number;
        recent: Array<{
          matchId: string;
          title: string;
          severity: string;
          createdAt: number;
        }>;
      }>
    >;
    /** 错题本:全部已分析对局的 findings 按类型分组(含 meta 与标记)。 */
    notebook(): Promise<
      Array<{
        category: string;
        count: number;
        recurring: number;
        done: number;
        entries: Array<{
          matchId: string;
          flagKey: string;
          flag: string | null;
          title: string;
          explanation: string;
          severity: string;
          startTime: number;
          zoneId?: string;
          result?: string;
          bracket?: string;
        }>;
      }>
    >;
    /** 深挖轮(自动追问):初轮 done 后由 renderer 触发,证据包在 renderer 确定性构建。 */
    deepen(input: {
      matchId: string;
      findings: unknown[];
      packs: unknown[];
      spec: string;
      ownerName?: string;
    }): Promise<void>;
    setFlag(
      matchId: string,
      key: string,
      flag: "done" | "recurring" | null,
    ): Promise<Record<string, string>>;
    onDelta(cb: (d: { matchId: string; text: string }) => void): () => void;
    onDone(cb: (d: { matchId: string; result: unknown }) => void): () => void;
    onError(cb: (d: { matchId: string; message: string }) => void): () => void;
  };
  icon: {
    get(name: string): Promise<string | null>;
  };
  /** 开发者页:最近 10 次 AI 调用的 prompt 与原始返回(仅内存)。 */
  debug: {
    aiCalls(): Promise<
      Array<{
        kind: "analysis" | "compare";
        matchId: string;
        at: number;
        model: string;
        prompt: string;
        raw: string;
      }>
    >;
  };
}
declare global {
  interface Window {
    gladlog: GladlogApi;
  }
}
