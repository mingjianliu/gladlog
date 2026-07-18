import { toLegacyMatch } from "@gladlog/parser-compat";
import type { GladMatch } from "@gladlog/parser";

import type { ReportSource } from "./types";

/** convert.ts 无条件迭代的单位事件数组(裁剪版 doc/fixture 可能缺项)。 */
const UNIT_ARRAYS = [
  "absorbsIn",
  "absorbsOut",
  "actionsIn",
  "actionsOut",
  "advancedSamples",
  "auraEvents",
  "casts",
  "damageIn",
  "damageOut",
  "deaths",
  "healIn",
  "healOut",
  "petCasts",
] as const;

const cache = new WeakMap<ReportSource, ReturnType<typeof toLegacyMatch>>();

/**
 * 安全版 toLegacyMatch:给缺失的单位事件数组补空数组再转换。
 * 渲染测试 fixture 为控体积剥掉了 healIn/absorbsIn/actionsIn/Out,裸转换会
 * 直接抛(fixture 模式下所有 analysis 派生 UI 就静默消失)。生产 doc 全量,
 * 此垫片零影响。
 */
export function toLegacySafe(source: ReportSource) {
  const cached = cache.get(source);
  if (cached) {
    return cached;
  }
  const units = Object.fromEntries(
    Object.entries(source.units).map(([id, u]) => {
      const padded: Record<string, unknown> = { ...u };
      for (const k of UNIT_ARRAYS) {
        if (!Array.isArray(padded[k])) padded[k] = [];
      }
      return [id, padded];
    }),
  );
  const result = toLegacyMatch({
    ...source,
    units,
    rawLines: [],
  } as unknown as GladMatch);
  cache.set(source, result);
  return result;
}
