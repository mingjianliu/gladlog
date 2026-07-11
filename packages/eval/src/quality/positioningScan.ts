/**
 * positioningScan — 几何 grounding 扫描器(backlog #3 先行子任务)。
 *
 * 从 prompt 文本抽取带坐标可复算锚点的几何主张,对照原始 advanced-logging 坐标
 * 独立复算,任何超容差的主张即 violation。硬门:全语料 0-violation 才允许
 * POSITIONING 类 feature 进 A/B。
 *
 * 覆盖的主张类:
 *  G1 CC_DISTANCE   — "[CC ON TEAM] … | N.Nyd from caster":复算施法者→目标距离。
 *  G2 TRAINED       — "HEALER TRAINED … camped by <name> (closest N.Nyd)":窗口内
 *                     最近距离复算,且必须 ≤ 8yd(定义)。
 *  G3 CD_RANGE      — "OFFENSIVE CD OUT OF RANGE … cast Nyd from nearest enemy":
 *                     复算施放时刻与最近敌人的距离。
 *  G4 STAYED/KITED  — "[X burst] A→Byd from <name>":复算窗口起点与该敌人的距离(A)。
 *  G5 LOS_BREAK     — "LoS break ~N.Nyd away (pillar-blocks <name>)":该地图必须有
 *                     障碍物数据,且此刻 owner 与该敌人确实互见(在 LoS 里才谈得上
 *                     "去打破");否则即幻觉主张。
 *  G6 IMPOSSIBLE_CC — 任何 G1 主张的复算距离 > 50yd(竞技场技能射程物理上限)。
 *
 * 容差:距离 |claim−recomputed| ≤ max(3yd, 25%·claim);时间锚 ±2s 内取最优采样。
 * 距离无法复算(坐标缺采样)不算 violation,单独计为 unverifiable 并在报告陈列。
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import {
  arenaObstacles,
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
} from "@gladlog/analysis";

export type GeoClaimKind =
  "CC_DISTANCE" | "TRAINED" | "CD_RANGE" | "STAYED_OR_KITED" | "LOS_BREAK";

export interface GeoClaim {
  kind: GeoClaimKind;
  lineNo: number;
  atSeconds: number;
  toSeconds?: number;
  distanceYards: number;
  /** 主张涉及的对方单位全名(caster / camper / nearest enemy / pillar-blocked enemy) */
  unitName?: string;
  /** G1:被 CC 的我方单位(行内 "X ←" 的 pid 标签) */
  targetName?: string;
  raw: string;
}

export interface GeoViolation {
  claim: GeoClaim;
  code: string;
  detail: string;
}

export interface GeoCheckResult {
  checked: number;
  unverifiable: number;
  violations: GeoViolation[];
}

const IMPOSSIBLE_CC_YARDS = 50;
const TRAINED_MAX_YARDS = 8;
const TIME_SLACK_SECONDS = 2;
const POSITION_MAX_GAP_MS = 3_000;

function parseTime(t: string): number {
  const [m, s] = t.split(":").map(Number);
  return m * 60 + s;
}

function tolerance(claimYd: number): number {
  return Math.max(3, claimYd * 0.25);
}

export interface GeoExtraction {
  claims: GeoClaim[];
  /** prompt 自带的权威 pid→全名映射(<unit id="N" name="..."/>) */
  unitIdMap: Map<number, string>;
}

/** 从 prompt 文本抽取几何主张 + 单位 id 映射。 */
export function extractGeoClaims(promptText: string): GeoExtraction {
  const claims: GeoClaim[] = [];
  const unitIdMap = new Map<number, string>();
  const lines = promptText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const um = line.match(/<unit id="(\d+)" name="([^"]+)"/);
    if (um) {
      unitIdMap.set(Number(um[1]), um[2]);
      continue;
    }

    // G1: 0:08  [CC ON TEAM]   3(HDHunter) ← Paralysis (by 5(WMonk)) | 3s [DR: …] | 23.4yd from caster
    let m = line.match(
      /^(\d+:\d{2}) {2}\[CC ON TEAM\] +(\S+) ← .*\(by (\d+\([^)]*\)|[^)]+)\).*?\| ([\d.]+)yd from caster/,
    );
    if (m) {
      claims.push({
        kind: "CC_DISTANCE",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[4]),
        unitName: m[3],
        targetName: m[2],
        raw: line,
      });
      continue;
    }

    // G2: 1:13–1:21 you were camped by Rockxtv-Illidan-US (closest 1.3yd) — …
    m = line.match(
      /^ +(\d+:\d{2})[–-](\d+:\d{2}) (?:you were|your healer \([^)]*\) was) camped by (\S+) \(closest ([\d.]+)yd\)/,
    );
    if (m) {
      claims.push({
        kind: "TRAINED",
        lineNo,
        atSeconds: parseTime(m[1]),
        toSeconds: parseTime(m[2]),
        distanceYards: Number(m[4]),
        unitName: m[3],
        raw: line,
      });
      continue;
    }

    // G3: 0:40 Chaos Nova cast 32yd from nearest enemy (still >…)
    m = line.match(/^ +(\d+:\d{2}) (.+?) cast ([\d.]+)yd from nearest enemy/);
    if (m) {
      claims.push({
        kind: "CD_RANGE",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[3]),
        raw: line,
      });
      continue;
    }

    // G4: 0:17 [High burst] 5→3yd from Rockxtv-Illidan-US … / opened 4→18yd from …
    m = line.match(
      /^ +(\d+:\d{2}) \[[^\]]+ burst\] (?:opened )?([\d.]+)→([\d.]+)yd from (\S+)/,
    );
    if (m) {
      claims.push({
        kind: "STAYED_OR_KITED",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[2]),
        unitName: m[4],
        raw: line,
      });
      continue;
    }

    // G5: 0:07  [HEALER EXPOSURE] … LoS break ~12.3yd away (pillar-blocks Oldchill-Proudmoore-US) …
    m = line.match(
      /^(\d+:\d{2}) {2}\[HEALER EXPOSURE\].*LoS break ~([\d.]+)yd away \(pillar-blocks ([^)]+)\)/,
    );
    if (m) {
      claims.push({
        kind: "LOS_BREAK",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[2]),
        unitName: m[3],
        raw: line,
      });
      continue;
    }
  }

  return { claims, unitIdMap };
}

interface CheckContext {
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  zoneId: string;
  matchStartMs: number;
  /** prompt 的权威 pid→全名映射 */
  unitIdMap?: Map<number, string>;
}

/** 名称解析:prompt 全名(Name-Realm-US)→ 单位。pid 标签形式(5(WMonk))→ 按 id 前缀。 */
function resolveUnit(name: string, ctx: CheckContext): ICombatUnit | null {
  const all = [...ctx.friends, ...ctx.enemies];
  const exact = all.find((u) => u.name === name);
  if (exact) return exact;
  // pid 形式 "5(WMonk)" / "5" — 用 prompt 自带的 <unit id=.. name=..> 权威映射解析
  const pidMatch = name.match(/^(\d+)/);
  if (pidMatch && ctx.unitIdMap) {
    const full = ctx.unitIdMap.get(Number(pidMatch[1]));
    if (full) {
      const byMap = all.find((u) => u.name === full);
      if (byMap) return byMap;
    }
  }
  const short = name.split("-")[0];
  return all.find((u) => u.name.split("-")[0] === short) ?? null;
}

/**
 * 一致性检验语义(跨度):prompt 时间戳 floor 到秒,真实事件在 [t, t+1),单位在
 * 移动;取 t±slack 内逐秒采样的距离区间 [min, max]——主张落在区间 ±tol 内即
 * grounded(亚秒时刻的真实距离必在单位实际轨迹的跨度里),顶出区间才是 violation。
 * (取单点 min 或 closest-to-claim 都被 cycle-3 实测证伪:前者系统性偏低,
 * 后者让 +15yd 变异在快速移动场景大量逃逸。)
 */
function windowDistanceSpan(
  a: ICombatUnit,
  b: ICombatUnit,
  atSeconds: number,
  ctx: CheckContext,
): { min: number; max: number } | null {
  // 采样时刻集合 = 窗口边界整秒 + 两单位在窗口内的全部真实 advanced 采样时刻。
  // 只查整秒会漏掉亚秒低谷(管线在事件精确时刻取值,而事件时刻必有采样)。
  const fromMs = ctx.matchStartMs + (atSeconds - TIME_SLACK_SECONDS) * 1000;
  const toMs = ctx.matchStartMs + (atSeconds + TIME_SLACK_SECONDS) * 1000;
  const instants = new Set<number>([fromMs, toMs]);
  for (const u of [a, b]) {
    for (const act of (u as any).advancedActions ?? []) {
      if (act.timestamp >= fromMs && act.timestamp <= toMs) instants.add(act.timestamp);
    }
  }
  let min: number | null = null;
  let max: number | null = null;
  for (const ts of instants) {
    const pa = getUnitPositionAtTime(a, ts, POSITION_MAX_GAP_MS);
    const pb = getUnitPositionAtTime(b, ts, POSITION_MAX_GAP_MS);
    if (!pa || !pb) continue;
    const d = distanceBetween(pa, pb);
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  return min === null || max === null ? null : { min, max };
}

function inSpan(claim: number, span: { min: number; max: number }, tol: number): boolean {
  return claim >= span.min - tol && claim <= span.max + tol;
}

/** 窗口内两单位最小距离(逐秒采样)——G2 TRAINED 的 "closest" 语义。 */
function minDistanceInWindow(
  a: ICombatUnit,
  b: ICombatUnit,
  fromSeconds: number,
  toSeconds: number,
  ctx: CheckContext,
): number | null {
  const fromMs = ctx.matchStartMs + Math.floor(fromSeconds) * 1000;
  const toMs = ctx.matchStartMs + Math.ceil(toSeconds + 1) * 1000;
  const instants = new Set<number>();
  for (let t = Math.floor(fromSeconds); t <= Math.ceil(toSeconds); t++)
    instants.add(ctx.matchStartMs + t * 1000);
  for (const u of [a, b]) {
    for (const act of (u as any).advancedActions ?? []) {
      if (act.timestamp >= fromMs && act.timestamp <= toMs) instants.add(act.timestamp);
    }
  }
  let min: number | null = null;
  for (const ts of instants) {
    const pa = getUnitPositionAtTime(a, ts, POSITION_MAX_GAP_MS);
    const pb = getUnitPositionAtTime(b, ts, POSITION_MAX_GAP_MS);
    if (!pa || !pb) continue;
    const d = distanceBetween(pa, pb);
    if (min === null || d < min) min = d;
  }
  return min;
}

export function checkGeoClaims(
  claims: GeoClaim[],
  ctx: CheckContext,
): GeoCheckResult {
  const violations: GeoViolation[] = [];
  let unverifiable = 0;
  let checked = 0;

  for (const claim of claims) {
    switch (claim.kind) {
      case "CC_DISTANCE": {
        // 主张:施法者与被 CC 者(行内 "X ←")当时相距 N yd。
        const caster = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        const target = claim.targetName ? resolveUnit(claim.targetName, ctx) : null;
        if (!caster || !target) {
          unverifiable++;
          continue;
        }
        const span = windowDistanceSpan(caster, target, claim.atSeconds, ctx);
        if (span === null) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        if (!inSpan(claim.distanceYards, span, tol)) {
          violations.push({
            claim,
            code: "G1_DISTANCE_MISMATCH",
            detail: `claimed ${claim.distanceYards}yd caster→target; window span [${span.min.toFixed(1)}, ${span.max.toFixed(1)}]yd (tol ${tol.toFixed(1)})`,
          });
        }
        if (claim.distanceYards > IMPOSSIBLE_CC_YARDS) {
          violations.push({
            claim,
            code: "G6_IMPOSSIBLE_CC",
            detail: `claimed CC from ${claim.distanceYards}yd > ${IMPOSSIBLE_CC_YARDS}yd physical cap`,
          });
        }
        break;
      }

      case "TRAINED": {
        const camper = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        if (!camper) {
          unverifiable++;
          continue;
        }
        const min = minDistanceInWindow(
          ctx.owner,
          camper,
          claim.atSeconds,
          claim.toSeconds ?? claim.atSeconds,
          ctx,
        );
        if (min === null) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        // 单侧检验:只惩罚「声称比物理事实更近」(捏造逼近);声称值高于亚秒真实
        // 最小值是整秒采样的固有保守偏差,不算假主张。
        if (claim.distanceYards < min - tol) {
          violations.push({
            claim,
            code: "G2_TRAINED_DISTANCE",
            detail: `claimed closest ${claim.distanceYards}yd is closer than physically observed min ${min.toFixed(1)}yd (tol ${tol.toFixed(1)})`,
          });
        }
        if (claim.distanceYards > TRAINED_MAX_YARDS) {
          violations.push({
            claim,
            code: "G2_TRAINED_DEFINITION",
            detail: `claimed closest ${claim.distanceYards}yd violates trained definition (≤${TRAINED_MAX_YARDS}yd)`,
          });
        }
        break;
      }

      case "CD_RANGE": {
        const spans = ctx.enemies
          .map((e) => windowDistanceSpan(ctx.owner, e, claim.atSeconds, ctx))
          .filter((sp): sp is { min: number; max: number } => sp !== null);
        if (spans.length === 0) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        // 最近敌人语义:任一敌人的跨度覆盖主张即 grounded
        if (!spans.some((sp) => inSpan(claim.distanceYards, sp, tol))) {
          const nearest = Math.min(...spans.map((sp) => sp.min));
          violations.push({
            claim,
            code: "G3_RANGE_MISMATCH",
            detail: `claimed ${claim.distanceYards}yd from nearest enemy; no enemy span covers it (nearest span-min ${nearest.toFixed(1)}yd, tol ${tol.toFixed(1)})`,
          });
        }
        break;
      }

      case "STAYED_OR_KITED": {
        const enemy = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        if (!enemy) {
          unverifiable++;
          continue;
        }
        const span = windowDistanceSpan(ctx.owner, enemy, claim.atSeconds, ctx);
        if (span === null) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        if (!inSpan(claim.distanceYards, span, tol)) {
          violations.push({
            claim,
            code: "G4_START_DISTANCE",
            detail: `claimed window-start ${claim.distanceYards}yd from ${claim.unitName}; window span [${span.min.toFixed(1)}, ${span.max.toFixed(1)}]yd (tol ${tol.toFixed(1)})`,
          });
        }
        break;
      }

      case "LOS_BREAK": {
        // 幻觉检测两连:1) 地图必须有障碍物数据;2) 此刻 owner 与该敌人须互见
        // (已经不互见还建议 "去打破 LoS" 即为假主张)。
        if (
          !arenaObstacles[ctx.zoneId] ||
          arenaObstacles[ctx.zoneId].length === 0
        ) {
          checked++;
          violations.push({
            claim,
            code: "G5_NO_GEOMETRY",
            detail: `pillar-blocks claim on zone ${ctx.zoneId} which has no obstacle data`,
          });
          break;
        }
        const enemy = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        if (!enemy) {
          unverifiable++;
          continue;
        }
        // ±slack 内任一采样互见即 grounded(柱边亚秒抖动不算假主张)
        let sawAny = false;
        let sawLoS = false;
        for (let dt = -TIME_SLACK_SECONDS; dt <= TIME_SLACK_SECONDS; dt++) {
          const ts = ctx.matchStartMs + (claim.atSeconds + dt) * 1000;
          const po = getUnitPositionAtTime(ctx.owner, ts, POSITION_MAX_GAP_MS);
          const pe = getUnitPositionAtTime(enemy, ts, POSITION_MAX_GAP_MS);
          if (!po || !pe) continue;
          sawAny = true;
          if (hasLineOfSight(ctx.zoneId, po, pe) !== false) sawLoS = true;
        }
        if (!sawAny) {
          unverifiable++;
          continue;
        }
        checked++;
        if (!sawLoS) {
          violations.push({
            claim,
            code: "G5_ALREADY_BROKEN",
            detail: `LoS-break suggested vs ${claim.unitName} but LoS is already broken throughout ${claim.atSeconds}±2s`,
          });
        }
        break;
      }
    }
  }

  return { checked, unverifiable, violations };
}

/** 变异测试:对主张施加已知破坏,断言扫描器检出。返回 [mutated, detected]。 */
export function mutationDetectionRate(
  claims: GeoClaim[],
  ctx: CheckContext,
): { mutated: number; detected: number } {
  let mutated = 0;
  let detected = 0;
  const baseline = checkGeoClaims(claims, ctx);
  const cleanClaims = claims.filter(
    (c) => !baseline.violations.some((v) => v.claim === c),
  );
  for (const c of cleanClaims) {
    if (c.kind === "LOS_BREAK") continue; // 距离变异对 G5 语义不适用
    // 距离 +15yd:tol = max(3, 0.25·claim) < 15 对 claim < 45yd 恒成立,应 100% 检出
    const m1: GeoClaim = { ...c, distanceYards: c.distanceYards + 15 };
    const r1 = checkGeoClaims([m1], ctx);
    if (r1.checked > 0) {
      mutated++;
      if (r1.violations.length > 0) detected++;
    }
  }
  return { mutated, detected };
}
