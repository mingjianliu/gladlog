import { CombatUnitReaction } from "@gladlog/parser-compat";

import { DEATH_CC_LOOKBACK_S } from "../context/criticalMoments";
import { lastCastBefore } from "../context/timelineHelpers";
import {
  analyzeBurstLedger,
  auditWindowTargeting,
  ON_TARGET_GOOD_PCT,
} from "../utils/burstLedger";
import { analyzePlayerCCAndTrinket } from "../utils/ccTrinketAnalysis";
import {
  annotateDefensiveTimings,
  extractMajorCooldowns,
  type IMajorCooldownInfo,
  isHealerSpec,
} from "../utils/cooldowns";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";
import { isBurstConverted } from "../utils/dpsMetrics";
import { analyzeOutgoingCCChains } from "../utils/drAnalysis";
import { analyzeKickAudit } from "../utils/kickAudit";
import { computeOffensiveWindows } from "../utils/offensiveWindows";
import { fmtFactNum as fmt } from "./factFormat";
import type { CandidateEvent } from "./types";

/**
 * Map never-used major cooldowns to cd-waste candidate events. Pure (no combat
 * traversal) so the mapping rule is unit-testable with hand-built cooldown
 * fixtures; the extractMajorCooldowns integration is exercised on real matches.
 *
 * Rule: emit for a cooldown that was never used AND is a pure survival wall.
 * Throughput CDs (isThroughput — e.g. Power Infusion) are excluded: a never-used
 * throughput CD is a different, weaker coaching point than a never-used defensive.
 */
export function cdWasteEvents(
  cds: Pick<
    IMajorCooldownInfo,
    "spellId" | "spellName" | "neverUsed" | "isThroughput"
  >[],
  healer: { id: string; name: string },
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  for (const cd of cds) {
    if (cd.neverUsed && !cd.isThroughput) {
      out.push({
        id: `cd-waste:${healer.id}:${cd.spellId}`,
        type: "cd-waste",
        t: 0, // whole-round observation, not time-specific
        unitNames: [healer.name],
        spell: cd.spellName,
        spellId: cd.spellId,
        facts: { spell: cd.spellName, unit: healer.name },
      });
    }
  }
  return out;
}

/**
 * Structured, verifiable candidate events for the findings pipeline. Built on
 * the parsed combat directly (NOT a refactor of buildMatchContext). Extensible
 * by pushing more typed events.
 *
 * Current menu:
 *  - death (all units, tagged friendly/enemy so the LLM knows kill vs loss)
 *  - death-setup (all owners): 友方死亡的前因链事件(healer-locked /
 *    trinket-early / defensive-early),每死亡 ≤2 条,时刻在死亡之前
 *  - cd-waste (the owner's — default: the Friendly healer's — never-used
 *    DEFENSIVE major cooldowns)
 *  - DPS owner only: burst-into-immunity / off-target-in-window /
 *    juked-kick / dr-clipped-cc / unconverted-burst
 */
export function extractCandidateFindings(
  combat: any,
  ownerId?: string,
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const units = Object.values(combat?.units ?? {}) as any[];
  const start = combat?.startTime ?? 0;

  // --- player deaths, tagged friendly/enemy ---
  // Players only: every arena combatant emits COMBATANT_INFO (u.info); pets,
  // totems, and guardians do not. A pet death is noise (they die and resummon
  // constantly) and would mislead the coach if tagged as a "friendly death".
  for (const u of units) {
    if (!u.info) continue;
    for (const d of (u.deathRecords ?? []) as any[]) {
      const t = ((d.timestamp ?? 0) - start) / 1000;
      const side =
        u.reaction === CombatUnitReaction.Friendly ? "friendly" : "enemy";
      out.push({
        id: `death:${u.id}:${Math.round(t)}`,
        type: "death",
        t,
        unitNames: [u.name],
        facts: { t: fmt(t), unit: u.name, side },
      });
    }
  }

  // --- death-setup:友方死亡的前因链(推理链证据,所有 owner 视角)---
  try {
    out.push(...extractDeathSetups(combat, units, start));
  } catch {
    /* 任何分析抛错都不应拖垮既有菜单 */
  }

  // --- cd-waste: the owner's never-used defensive cooldowns ---
  // ownerId 缺省时回退到友方治疗(既有行为,治疗管线菜单不变)。
  const healer = units.find(
    (u) =>
      u.info &&
      u.reaction === CombatUnitReaction.Friendly &&
      isHealerSpec(u.spec),
  );
  const owner =
    (ownerId ? units.find((u) => u.info && u.id === ownerId) : undefined) ??
    healer;
  if (owner) {
    let cds: IMajorCooldownInfo[] = [];
    try {
      cds = extractMajorCooldowns(owner, combat);
    } catch {
      cds = [];
    }
    out.push(...cdWasteEvents(cds, owner));
  }

  // --- DPS owner events (D2) — healer owners skip this whole branch ---
  if (owner && !isHealerSpec(owner.spec)) {
    try {
      out.push(...dpsOwnerEvents(combat, owner, units));
    } catch {
      /* 任何分析抛错都不应拖垮既有菜单 */
    }
  }

  return out;
}

/** death-setup 集成:逐友方死亡装配 parts(摘要按 victim 惰性算一次)。 */
function extractDeathSetups(
  combat: any,
  units: any[],
  start: number,
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  if (friends.length === 0 || enemies.length === 0) return out;
  const enemyIds = new Set(enemies.map((e) => e.id));
  const enemyPets = units.filter((u) => u.ownerId && enemyIds.has(u.ownerId));
  const healer = friends.find((u) => isHealerSpec(u.spec));

  const ccMemo = new Map<
    string,
    ReturnType<typeof analyzePlayerCCAndTrinket>
  >();
  const ccOf = (u: any) => {
    let v = ccMemo.get(u.id);
    if (!v) {
      v = analyzePlayerCCAndTrinket(u, enemies, combat, enemyPets);
      ccMemo.set(u.id, v);
    }
    return v;
  };
  // timing 审计需要敌方 CD 时间线(整场算一次);extractMajorCooldowns 的
  // casts 不自带 timingLabel,必须过 annotateDefensiveTimings 才有 Early
  // 判定(agy 复核 #1:漏标注则 defensive-early 生产上永不触发)。
  let enemyTl: ReturnType<typeof reconstructEnemyCDTimeline> | null = null;
  const cdMemo = new Map<string, IMajorCooldownInfo[]>();
  const cdsOf = (u: any) => {
    let v = cdMemo.get(u.id);
    if (!v) {
      enemyTl = enemyTl ?? reconstructEnemyCDTimeline(enemies, combat);
      v = annotateDefensiveTimings(
        extractMajorCooldowns(u, combat),
        u,
        combat,
        enemyTl,
      );
      cdMemo.set(u.id, v);
    }
    return v;
  };

  for (const u of friends) {
    for (const d of (u.deathRecords ?? []) as any[]) {
      const deathT = ((d.timestamp ?? 0) - start) / 1000;
      const parts: DeathSetupParts = {
        deathT,
        victim: { id: u.id, name: u.name },
      };
      // 各摘要独立容错:合成 fixture 缺 startInfo/事件数组时单项缺席,
      // 不影响其它前因判定(与菜单整体 try/catch 双层)。
      try {
        parts.victimCC = ccOf(u);
      } catch {
        /* 摘要不可算 → 该前因类缺席 */
      }
      try {
        parts.victimCDs = cdsOf(u);
      } catch {
        /* 同上 */
      }
      if (healer && healer.id !== u.id) {
        try {
          parts.healerCC = {
            healerName: healer.name,
            ccInstances: ccOf(healer).ccInstances,
          };
        } catch {
          /* 同上 */
        }
      }
      out.push(...deathSetupEvents(parts));
    }
  }
  return out;
}

/** 25%/Immune = wasted(镜像 IOutgoingCCChain.hasWastedApplications 的定义)。 */
const WASTED_DR_LEVELS = new Set(["25%", "Immune"]);

/** death-setup:前因事件距死亡的最大回溯(秒)——更早的资源消耗与该死亡因果太弱。 */
export const DEATH_SETUP_LOOKBACK_S = 90;
/** death-setup:治疗被控的最小时长(秒)——短失能不构成击杀窗口无解。 */
const HEALER_LOCK_MIN_S = 3;
/** 每个死亡最多带的前因事件数(优先级 healer-locked > trinket-early > defensive-early)。 */
const SETUPS_PER_DEATH = 2;

export interface DeathSetupParts {
  deathT: number;
  victim: { id: string; name: string };
  /** victim 的 CC/饰品摘要(analyzePlayerCCAndTrinket 的相关切片)。 */
  victimCC?: {
    ccInstances: Array<{
      atSeconds: number;
      durationSeconds: number;
      spellName: string;
      trinketState: string;
    }>;
    trinketUseTimes: number[];
  };
  /** victim 的大 CD(extractMajorCooldowns)。 */
  victimCDs?: Array<
    Pick<
      IMajorCooldownInfo,
      | "spellId"
      | "spellName"
      | "tag"
      | "cooldownSeconds"
      | "casts"
      | "neverUsed"
    >
  >;
  /** 友方治疗(非 victim)的 CC 摘要。 */
  healerCC?: {
    healerName: string;
    ccInstances: Array<{
      atSeconds: number;
      durationSeconds: number;
      /** 可选:真实调用方传的是带 id 的 ICCInstance,测试夹具可省(仅供图标)。 */
      spellId?: string;
      spellName: string;
      sourceName: string;
    }>;
  };
}

/**
 * death-setup 候选(推理链):把一个友方死亡回溯到更早的前因时刻,给模型
 * 可引用的"链条另一端"。纯函数(hand-built 可单测);判定全部镜像
 * buildDeathRootCauseTrace 的既有谓词:
 *  - healer-locked:治疗的 CC 覆盖死亡前 DEATH_CC_LOOKBACK_S 窗口(同一窗口常量);
 *  - trinket-early:victim 死亡窗口内被控且 trinketState=on_cooldown(trace 的
 *    CC 行),前因时刻 = 更早的那次饰品施放;
 *  - defensive-early:victim 的大防御在死亡时 ON COOLDOWN 且上次使用被 timing
 *    审计标为 Early(trace 的 [last use: EARLY] 行),前因时刻 = 那次施放。
 */
export function deathSetupEvents(parts: DeathSetupParts): CandidateEvent[] {
  const { deathT, victim } = parts;
  const out: CandidateEvent[] = [];
  const inWindow = (cc: { atSeconds: number; durationSeconds: number }) =>
    cc.atSeconds <= deathT &&
    cc.atSeconds + cc.durationSeconds >= deathT - DEATH_CC_LOOKBACK_S;

  // healer-locked:治疗在击杀窗口内被 ≥3s 控且早于死亡时刻
  const lock = parts.healerCC?.ccInstances.find(
    (cc) =>
      inWindow(cc) &&
      cc.durationSeconds >= HEALER_LOCK_MIN_S &&
      cc.atSeconds < deathT,
  );
  if (lock) {
    out.push({
      id: `death-setup:${victim.id}:${Math.round(deathT)}:healer-locked`,
      type: "death-setup",
      t: lock.atSeconds,
      unitNames: [parts.healerCC!.healerName, victim.name],
      spell: lock.spellName,
      spellId: lock.spellId,
      facts: {
        t: fmt(lock.atSeconds),
        kind: "healer-locked",
        deathT: fmt(deathT),
        victim: victim.name,
        healer: parts.healerCC!.healerName,
        cc: lock.spellName,
        duration: lock.durationSeconds.toFixed(1),
      },
    });
  }

  // trinket-early:死亡窗口内被控且饰品在 CD;前因 = 更早的那次饰品施放
  const deadInCC = parts.victimCC?.ccInstances.find(
    (cc) => inWindow(cc) && cc.trinketState === "on_cooldown",
  );
  if (deadInCC) {
    const trinketT = [...(parts.victimCC?.trinketUseTimes ?? [])]
      .filter(
        (t) => t < deadInCC.atSeconds && t >= deathT - DEATH_SETUP_LOOKBACK_S,
      )
      .pop();
    if (trinketT !== undefined) {
      out.push({
        id: `death-setup:${victim.id}:${Math.round(deathT)}:trinket-early`,
        type: "death-setup",
        t: trinketT,
        unitNames: [victim.name],
        facts: {
          t: fmt(trinketT),
          kind: "trinket-early",
          deathT: fmt(deathT),
          victim: victim.name,
          ccAtDeath: deadInCC.spellName,
          gapS: fmt(deathT - trinketT),
        },
      });
    }
  }

  // defensive-early:死亡时 ON COOLDOWN 且上次使用被 timing 审计标 Early
  for (const cd of parts.victimCDs ?? []) {
    if (cd.tag !== "Defensive" || cd.neverUsed) continue;
    const last = lastCastBefore(cd as IMajorCooldownInfo, deathT);
    if (!last) continue;
    const readyAt = last.timeSeconds + cd.cooldownSeconds;
    if (readyAt <= deathT) continue; // 死亡时可用 → 不是"提前用掉"链
    if (last.timingLabel !== "Early") continue;
    if (last.timeSeconds < deathT - DEATH_SETUP_LOOKBACK_S) continue;
    out.push({
      id: `death-setup:${victim.id}:${Math.round(deathT)}:defensive-early`,
      type: "death-setup",
      t: last.timeSeconds,
      unitNames: [victim.name],
      spell: cd.spellName,
      spellId: cd.spellId,
      facts: {
        t: fmt(last.timeSeconds),
        kind: "defensive-early",
        deathT: fmt(deathT),
        victim: victim.name,
        spell: cd.spellName,
        gapS: fmt(deathT - last.timeSeconds),
      },
    });
    break; // 一个死亡最多一条 defensive-early(取第一个命中的大防御)
  }

  return out.slice(0, SETUPS_PER_DEATH);
}

function dpsOwnerEvents(
  combat: any,
  owner: any,
  units: any[],
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  const players = units.filter((u) => u.info);
  const friends = players.filter((u) => u.reaction === owner.reaction);
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  if (enemies.length === 0) return out;
  const allies = friends.filter((u) => u.id !== owner.id);

  const ledger = analyzeBurstLedger(owner, allies, enemies, combat);

  // unconverted-burst:爆发窗口没转化(目标没死、净掉血不足)——用户反馈
  // findings 全是死亡/击杀窗口,爆发账本的信息没有证据 id 可引。转化谓词
  // 与 dpsMetrics.burstConversionRate 同源(isBurstConverted)。免疫场景归
  // burst-into-immunity 不重复;按伤害取前 2 个,避免刷屏小爆发。
  const unconverted = ledger
    .filter((b) => {
      const t = b.dominantTarget;
      return (
        t !== null &&
        !isBurstConverted(t) &&
        !t.defensivesHit.some((d) => d.isImmunity)
      );
    })
    .sort(
      (a, b) =>
        (b.dominantTarget?.damage ?? 0) - (a.dominantTarget?.damage ?? 0),
    )
    .slice(0, 2);
  for (const b of unconverted) {
    const t = b.dominantTarget!;
    const def = t.defensivesHit[0];
    out.push({
      id: `unconverted-burst:${owner.id}:${Math.round(b.fromSeconds)}`,
      type: "unconverted-burst",
      t: b.fromSeconds,
      unitNames: [owner.name, t.unitName],
      spell: b.spells[0]?.spellName,
      spellId: b.spells[0]?.spellId,
      facts: {
        t: fmt(b.fromSeconds),
        spell: b.spells.map((s) => s.spellName).join(" + "),
        target: t.unitName,
        damageM: (t.damage / 1_000_000).toFixed(2),
        ...(t.hpStartPct !== null && t.hpEndPct !== null
          ? {
              hpStart: String(t.hpStartPct),
              hpEnd: String(t.hpEndPct),
            }
          : {}),
        ...(def ? { defensive: def.spellName } : {}),
        allyAligned: b.allyCDsOverlapping.length > 0 ? "yes" : "no",
      },
    });
  }

  // burst-into-immunity:主目标在爆发内挂着免疫(纯减伤不报,留给 prompt 块叙述)
  for (const b of ledger) {
    const t = b.dominantTarget;
    if (!t) continue;
    const imm = t.defensivesHit.find((d) => d.isImmunity);
    if (!imm) continue;
    out.push({
      id: `burst-immune:${owner.id}:${Math.round(b.fromSeconds)}`,
      type: "burst-into-immunity",
      t: b.fromSeconds,
      unitNames: [owner.name, t.unitName],
      spell: b.spells[0]?.spellName,
      spellId: b.spells[0]?.spellId,
      facts: {
        t: fmt(b.fromSeconds),
        spell: b.spells.map((s) => s.spellName).join(" + "),
        target: t.unitName,
        immunity: imm.spellName,
        overlap: imm.overlapSeconds.toFixed(1),
      },
    });
  }

  // off-target-in-window:kill window 内命中窗口目标的伤害占比过低
  const windows = computeOffensiveWindows(enemies, friends, combat);
  for (const w of auditWindowTargeting(owner, windows, enemies, combat)) {
    if (w.onTargetPct >= ON_TARGET_GOOD_PCT) continue;
    out.push({
      id: `off-target:${owner.id}:${Math.round(w.windowFromSeconds)}`,
      type: "off-target-in-window",
      t: w.windowFromSeconds,
      unitNames: [owner.name, w.windowTargetName],
      facts: {
        t: fmt(w.windowFromSeconds),
        target: w.windowTargetName,
        onTargetPct: String(w.onTargetPct),
        ...(w.topOffTarget ? { offTarget: w.topOffTarget.unitName } : {}),
      },
    });
  }

  // juked-kick:被假读条骗掉的打断
  for (const k of analyzeKickAudit(owner, enemies, combat)) {
    if (k.result !== "juked") continue;
    out.push({
      id: `juked-kick:${owner.id}:${Math.round(k.atSeconds)}`,
      type: "juked-kick",
      t: k.atSeconds,
      unitNames: [owner.name, ...(k.targetName ? [k.targetName] : [])],
      spell: k.kickSpellName,
      spellId: k.kickSpellId,
      facts: {
        t: fmt(k.atSeconds),
        kick: k.kickSpellName,
        fake: k.jukedBySpellName ?? "",
      },
    });
  }

  // dr-clipped-cc:owner 的 CC 落在 25%/Immune DR 上(踩了队友的链)
  for (const chain of analyzeOutgoingCCChains(friends, enemies, combat)) {
    for (const app of chain.applications) {
      if (app.casterName !== owner.name) continue;
      if (!WASTED_DR_LEVELS.has(app.drInfo.level)) continue;
      out.push({
        id: `dr-clipped:${owner.id}:${Math.round(app.atSeconds)}`,
        type: "dr-clipped-cc",
        t: app.atSeconds,
        unitNames: [owner.name, chain.targetName],
        spell: app.spellName,
        spellId: app.spellId,
        facts: {
          t: fmt(app.atSeconds),
          spell: app.spellName,
          target: chain.targetName,
          dr: app.drInfo.level,
          duration: app.durationSeconds.toFixed(1),
        },
      });
    }
  }

  return out;
}
