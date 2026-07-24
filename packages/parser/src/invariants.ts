import { parseLine } from "./l1/parseLine";
import type { GladMatchBase, GladUnit } from "./l3/model";

/**
 * A2 parser 不变量(可验证性路线图):对**任何**成功解析的对局都应成立的
 * 物性断言。measure-then-lock:先由 packages/eval/scripts/parserInvariants.ts
 * 在全量语料上量出各断言的违规数,归零(或逐条 adjudicate)后由测试锁死。
 * 与 A1 差分预言机互补 —— A1 对旧 parser,这里对物理事实本身。
 */

export interface InvariantViolation {
  /** 稳定断言码(报告聚合按它分组)。 */
  code:
    | "time-bounds"
    | "monotonic"
    | "hp-range"
    | "death-has-damage"
    | "pet-owner-resolves"
    | "start-before-end"
    | "line-resolves";
  unitId?: string;
  detail: string;
}

/** 事件允许越界的宽限(ms)。2026-07-23 全语料(1245 场)实测定界:
 *  - match:事件从不越过 endTime(最大越界 0ms)、开局侧最大早 1ms → 2s 宽限纯余量;
 *  - shuffleRound:轮间隙事件归前一轮,最大拖尾 34.1s → 上界放 60s。 */
const TIME_GRACE_MS = 2_000;
const ROUND_TRAILING_GRACE_MS = 60_000;
/** 时间戳回退容忍(ms):真实日志存在乱序抖动,全语料实测最大回退 2084ms;
 * 超过 5s 才算真乱序。 */
const MONOTONIC_TOLERANCE_MS = 5_000;
/** hp 允许超过 maxHp 的倍数:血量上限增减的时序会让瞬时 hp 高于当前 maxHp,
 * 全语料实测 3841 个样本、p99=1.49、max=1.58 → 上界 1.75(超过即真坏)。 */
const HP_OVER_MAX_RATIO = 1.75;
/** 死亡前多少秒内必须见到承伤(「每个死亡有来源」)。 */
const DEATH_DAMAGE_LOOKBACK_S = 10;

const EVENT_ARRAYS = [
  "damageOut",
  "damageIn",
  "healOut",
  "healIn",
  "absorbsOut",
  "absorbsIn",
  "casts",
  "castStarts",
  "petCasts",
  "auraEvents",
  "actionsOut",
  "actionsIn",
  "deaths",
  "unconsciousEvents",
  "advancedSamples",
] as const;

export function checkParserInvariants(m: GladMatchBase): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  if (!(m.startTime < m.endTime)) {
    out.push({
      code: "start-before-end",
      detail: `startTime ${m.startTime} !< endTime ${m.endTime}`,
    });
  }
  const isRound = (m as { kind?: string }).kind === "shuffleRound";
  const lo = m.startTime - TIME_GRACE_MS;
  const hi = m.endTime + (isRound ? ROUND_TRAILING_GRACE_MS : TIME_GRACE_MS);

  const unitIds = new Set(Object.keys(m.units));

  for (const [id, u] of Object.entries(m.units) as [string, GladUnit][]) {
    for (const key of EVENT_ARRAYS) {
      const arr = (u[key] ?? []) as { timestamp: number }[];
      let prev = -Infinity;
      for (const e of arr) {
        if (e.timestamp < prev - MONOTONIC_TOLERANCE_MS) {
          out.push({
            code: "monotonic",
            unitId: id,
            detail: `${key} 时间戳回退 ${prev} → ${e.timestamp}(超 ${MONOTONIC_TOLERANCE_MS}ms 容忍)`,
          });
          break; // 每个数组最多报一次,防刷屏
        }
        prev = Math.max(prev, e.timestamp);
        if (e.timestamp < lo || e.timestamp > hi) {
          out.push({
            code: "time-bounds",
            unitId: id,
            detail: `${key} 事件越界 ${e.timestamp} ∉ [${lo}, ${hi}]`,
          });
          break;
        }
      }
    }

    for (const s of u.advancedSamples ?? []) {
      if (!(s.maxHp > 0) || s.hp < 0 || s.hp > s.maxHp * HP_OVER_MAX_RATIO) {
        out.push({
          code: "hp-range",
          unitId: id,
          detail: `advancedSample hp=${s.hp} maxHp=${s.maxHp} @${s.timestamp}`,
        });
        break;
      }
    }

    if (u.ownerId && !unitIds.has(u.ownerId)) {
      out.push({
        code: "pet-owner-resolves",
        unitId: id,
        detail: `ownerId ${u.ownerId} 不在 units 里`,
      });
    }

    // 「每个事件可回源」(B2 溯源深链的门规):事件必须带 lineIndex,且
    // rawLines[lineIndex] 重解析后 eventName/timestamp 与事件一致 ——
    // 抓分段器 records/rawLines 错位与 lineIndex 丢失(advancedSamples 是
    // 合成样本无源行,豁免)。每单位每数组只验首个事件:对齐是结构性质,
    // 首个错位即全错位,全量重解析在 1245 场语料上是 O(全事件) 的浪费。
    for (const key of EVENT_ARRAYS) {
      if (key === "advancedSamples") continue;
      const e = (
        (u[key] ?? []) as {
          timestamp: number;
          eventName?: string;
          lineIndex?: number;
        }[]
      )[0];
      if (!e) continue;
      if (e.lineIndex == null) {
        out.push({
          code: "line-resolves",
          unitId: id,
          detail: `${key}[0] 缺 lineIndex(@${e.timestamp})`,
        });
        continue;
      }
      const raw = m.rawLines[e.lineIndex];
      const reparsed = raw === undefined ? null : parseLine(raw);
      if (
        !reparsed ||
        reparsed.eventName !== e.eventName ||
        reparsed.timestamp !== e.timestamp
      ) {
        out.push({
          code: "line-resolves",
          unitId: id,
          detail: `${key}[0] lineIndex=${e.lineIndex} 与 rawLines 不对齐(事件 ${e.eventName}@${e.timestamp} vs 行 ${reparsed?.eventName}@${reparsed?.timestamp})`,
        });
      }
    }

    // 「每个死亡有来源」:玩家真死(非 unconscious)前 10s 内必须有承伤
    if (u.kind === "Player") {
      for (const d of u.deaths ?? []) {
        if (d.unconscious) continue;
        const hasDamage = (u.damageIn ?? []).some(
          (e) =>
            e.timestamp <= d.timestamp &&
            e.timestamp >= d.timestamp - DEATH_DAMAGE_LOOKBACK_S * 1000,
        );
        if (!hasDamage) {
          out.push({
            code: "death-has-damage",
            unitId: id,
            detail: `死亡 @${d.timestamp} 前 ${DEATH_DAMAGE_LOOKBACK_S}s 无任何承伤事件`,
          });
        }
      }
    }
  }

  return out;
}
