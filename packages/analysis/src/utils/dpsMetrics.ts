import {
  AtomicArenaCombat,
  CombatUnitType,
  ICombatUnit,
} from "@gladlog/parser-compat";

import { analyzeBurstLedger, auditWindowTargeting } from "./burstLedger";
import { analyzeKickAudit } from "./kickAudit";
import { computeOffensiveWindows } from "./offensiveWindows";

/** 爆发"转化"判定:窗口内主目标死了,或净掉血 ≥ 此百分点。 */
const CONVERTED_HP_DROP_PT = 20;

/**
 * DPS 高手对比指标(pro-comparison P1)。与爆发账本/战报卡完全同谓词
 * (analyzeBurstLedger / auditWindowTargeting / analyzeKickAudit)——
 * cell 里聚合的是什么,用户账本里看到的就是什么。
 * 全部为有界标量(比率 0–1、秒、次数),无需 winsorize。
 */
export interface IDpsMetrics {
  /** 爆发次数(进攻大 CD 分组后)。 */
  burstCount: number;
  /** 转化的爆发占比(主目标死亡或净掉血 ≥20 个百分点);无爆发 → null。 */
  burstConversionRate: number | null;
  /** 主目标挂着免疫/大减伤的爆发占比;无爆发 → null。 */
  burstIntoDefensiveRatio: number | null;
  /** 有队友进攻 CD 重叠的爆发占比;无爆发 → null。 */
  alignedBurstRatio: number | null;
  /** kill window 内命中窗口目标的伤害占比(跨窗口加总);无窗口 → null。 */
  onTargetPct: number | null;
  /** 打断命中率(landed / 有结论的 kick,unknown 不计);无 kick → null。 */
  kickLandedRate: number | null;
  /** 被假读条骗掉的 kick 次数。 */
  kicksJukedCount: number;
  /** 开场到首次爆发的秒数;无爆发 → null。 */
  firstBurstSeconds: number | null;
}

export function computeDpsMetrics(
  combat: AtomicArenaCombat,
  playerName: string,
): IDpsMetrics {
  const allUnits = Object.values(combat.units) as ICombatUnit[];
  const players = allUnits.filter(
    (u) => u.type === CombatUnitType.Player && u.info,
  );
  const player = players.find((u) => u.name === playerName);
  const empty: IDpsMetrics = {
    burstCount: 0,
    burstConversionRate: null,
    burstIntoDefensiveRatio: null,
    alignedBurstRatio: null,
    onTargetPct: null,
    kickLandedRate: null,
    kicksJukedCount: 0,
    firstBurstSeconds: null,
  };
  if (!player) return empty;

  const allies = players.filter(
    (u) => u.reaction === player.reaction && u.id !== player.id,
  );
  const enemies = players.filter((u) => u.reaction !== player.reaction);
  if (enemies.length === 0) return empty;

  const bursts = analyzeBurstLedger(player, allies, enemies, combat);
  const burstCount = bursts.length;
  let converted = 0;
  let intoDefensive = 0;
  let aligned = 0;
  for (const b of bursts) {
    const t = b.dominantTarget;
    const dropped =
      t !== null &&
      (t.died ||
        (t.hpStartPct !== null &&
          t.hpEndPct !== null &&
          t.hpStartPct - t.hpEndPct >= CONVERTED_HP_DROP_PT));
    if (dropped) converted++;
    if (t && t.defensivesHit.length > 0) intoDefensive++;
    if (b.allyCDsOverlapping.length > 0) aligned++;
  }

  // 同一 reaction 视角的 kill window(与战报卡 deriveBurstLedger 同口径)
  const windows = computeOffensiveWindows(
    enemies,
    players.filter((u) => u.reaction === player.reaction),
    combat,
  );
  const targeting = auditWindowTargeting(player, windows, enemies, combat);
  const dmgTotal = targeting.reduce((s, w) => s + w.playerDamageTotal, 0);
  const dmgOnTarget = targeting.reduce((s, w) => s + w.playerDamageToTarget, 0);

  const kicks = analyzeKickAudit(player, enemies, combat);
  const decided = kicks.filter((k) => k.result !== "unknown");
  const landed = decided.filter((k) => k.result === "landed").length;

  return {
    burstCount,
    burstConversionRate: burstCount > 0 ? converted / burstCount : null,
    burstIntoDefensiveRatio: burstCount > 0 ? intoDefensive / burstCount : null,
    alignedBurstRatio: burstCount > 0 ? aligned / burstCount : null,
    onTargetPct: dmgTotal > 0 ? dmgOnTarget / dmgTotal : null,
    kickLandedRate: decided.length > 0 ? landed / decided.length : null,
    kicksJukedCount: kicks.filter((k) => k.result === "juked").length,
    firstBurstSeconds: burstCount > 0 ? bursts[0].fromSeconds : null,
  };
}
