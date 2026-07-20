import { join } from "path";

import { PROMPT_VERSION } from "./promptVersion";

/** 分析缓存的落盘信封。主进程写、主进程读、E2E 播种,三处共用同一形状。 */
export interface AnalysisCacheDoc<T> {
  schemaVersion: 1;
  promptVersion: number;
  language: string;
  createdAt: number;
  result: T;
}

/**
 * 分析缓存文件路径。谓词单源 —— 文件名散在写侧、读侧、播种侧三处的话,
 * 改名时漏掉一处的表现是「缓存静默未命中」:没有报错,只是面板停在空闲态。
 */
export function analysisCachePath(
  matchesDir: string,
  matchId: string,
  lang: string,
): string {
  return join(matchesDir, matchId, `analysis-v2.${lang}.json`);
}

/** 按上面的信封包装结果。`createdAt` 由调用方注入,便于测试固定时间。 */
export function analysisCacheDoc<T>(
  lang: string,
  result: T,
  createdAt: number = Date.now(),
): AnalysisCacheDoc<T> {
  return {
    schemaVersion: 1,
    promptVersion: PROMPT_VERSION,
    language: lang,
    createdAt,
    result,
  };
}
