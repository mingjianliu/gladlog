import {
  analyzeBurstLedger,
  analyzePlayerCCAndTrinket,
  DEFENSIVE_TAGS,
  extractMajorCooldowns,
  isBurstConverted,
  isHealerSpec,
  reconstructDispelSummary,
  reconstructEnemyCDTimeline,
  trinketSpellIds,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

export type KeyMomentKind =
  "death" | "burst-band" | "defensive" | "dispel" | "cc";

export interface KeyMoment {
  /** 相对秒(自 combat start)。 */
  t: number;
  /** burst-band 专用:带状区间终点。 */
  toT?: number;
  kind: KeyMomentKind;
  side: "friendly" | "enemy";
  title: string;
  detail?: string;
  unitNames: string[];
  /** 跳转秒(= t),回放 seek 契约。 */
  jumpT: number;
}

const TRINKETS = new Set<string>(trinketSpellIds);
const CC_MIN_S = 3;

const shortName = (n: string): string => n.split("-")[0] ?? n;

/**
 * 关键时刻轴数据(spec: 2026-07-18-ai-analysis-key-moment-axis-design)。
 * 五类事件,谓词全部复用 analysis;每类独立 try/catch,单类失败不拖垮。
 */
export function deriveKeyMoments(
  source: ReportSource,
  ownerId?: string,
): KeyMoment[] {
  const out: KeyMoment[] = [];
  let legacy: ReturnType<typeof toLegacySafe>;
  try {
    legacy = toLegacySafe(source);
  } catch {
    return out;
  }
  const start = legacy.startTime;
  const rel = (ms: number) => (ms - start) / 1000;
  const units = Object.values(legacy.units);
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  const petsOf = (side: typeof friends) => {
    const ids = new Set(side.map((u) => u.id));
    return units.filter((u) => u.ownerId && ids.has(u.ownerId));
  };
  const friendlyPets = petsOf(friends);
  const enemyPets = petsOf(enemies);
  const owner =
    (ownerId ? players.find((u) => u.id === ownerId) : undefined) ??
    players.find((u) => u.id === legacy.playerId) ??
    friends[0];

  // death
  try {
    for (const u of players) {
      for (const d of u.deathRecords ?? []) {
        const side =
          u.reaction === CombatUnitReaction.Friendly ? "friendly" : "enemy";
        out.push({
          t: rel(d.timestamp),
          kind: "death",
          side,
          title: side === "friendly" ? "阵亡" : "击杀",
          unitNames: [u.name],
          jumpT: rel(d.timestamp),
        });
      }
    }
  } catch {
    /* 单类失败不拖垮 */
  }

  // burst-band:我方 = owner 爆发账本(isBurstConverted 单源标转化)
  try {
    if (owner && !isHealerSpec(owner.spec)) {
      const allies = friends.filter((u) => u.id !== owner.id);
      for (const b of analyzeBurstLedger(owner, allies, enemies, legacy)) {
        const t = b.dominantTarget;
        const converted = t !== null && isBurstConverted(t);
        out.push({
          t: b.fromSeconds,
          toT: b.toSeconds,
          kind: "burst-band",
          side: "friendly",
          title: converted ? "爆发(已转化)" : "爆发(未转化)",
          detail: t
            ? `${(t.damage / 1_000_000).toFixed(2)}M → ${shortName(t.unitName)}`
            : undefined,
          unitNames: [owner.name, ...(t ? [t.unitName] : [])],
          jumpT: b.fromSeconds,
        });
      }
    }
  } catch {
    /* 同上 */
  }
  // burst-band:敌方 = aligned burst windows(同 [OFFENSIVE WINDOW] 谓词)
  try {
    const tl = reconstructEnemyCDTimeline(enemies, legacy, owner, friends);
    for (const w of tl.alignedBurstWindows) {
      out.push({
        t: w.fromSeconds,
        toT: w.toSeconds,
        kind: "burst-band",
        side: "enemy",
        title: "敌方爆发",
        detail: w.activeCDs.map((c) => c.spellName).join(" + "),
        unitNames: [...new Set(w.activeCDs.map((c) => c.playerName))],
        jumpT: w.fromSeconds,
      });
    }
  } catch {
    /* 同上 */
  }

  // defensive:我方大防御 CD 施放(Defensive/External 且非 throughput)+ 饰品
  try {
    for (const u of friends) {
      for (const cd of extractMajorCooldowns(u, legacy)) {
        if (!DEFENSIVE_TAGS.has(cd.tag) || cd.isThroughput) continue;
        for (const cast of cd.casts) {
          out.push({
            t: cast.timeSeconds,
            kind: "defensive",
            side: "friendly",
            title: cd.spellName,
            detail: cast.timingLabel,
            unitNames: [u.name],
            jumpT: cast.timeSeconds,
          });
        }
      }
      for (const c of u.spellCastEvents ?? []) {
        if (!c.spellId || !TRINKETS.has(c.spellId)) continue;
        out.push({
          t: rel(c.timestamp),
          kind: "defensive",
          side: "friendly",
          title: "交饰品",
          unitNames: [u.name],
          jumpT: rel(c.timestamp),
        });
      }
    }
  } catch {
    /* 同上 */
  }

  // dispel:Critical/High(F163 同源口径)
  try {
    const ds = reconstructDispelSummary(
      friends,
      enemies,
      legacy,
      friendlyPets,
      enemyPets,
    );
    for (const e of [...ds.allyCleanse, ...ds.ourPurges]) {
      if (e.priority !== "Critical" && e.priority !== "High") continue;
      out.push({
        t: e.timeSeconds,
        kind: "dispel",
        side: "friendly",
        title: `${e.dispelSpellName}(${e.priority})`,
        detail: `解掉 ${e.removedSpellName}`,
        unitNames: [e.sourceName, e.targetName],
        jumpT: e.timeSeconds,
      });
    }
  } catch {
    /* 同上 */
  }

  // cc:我方被控(≥3s 或触发饰品);控制成功(≥3s 或目标为治疗)
  try {
    for (const u of friends) {
      const s = analyzePlayerCCAndTrinket(u, enemies, legacy, enemyPets);
      for (const cc of s.ccInstances) {
        if (cc.durationSeconds < CC_MIN_S && cc.trinketState !== "used")
          continue;
        out.push({
          t: cc.atSeconds,
          kind: "cc",
          side: "enemy",
          title: `被控:${cc.spellName}`,
          detail: `${cc.durationSeconds.toFixed(0)}s${
            cc.trinketState === "used" ? " · 交饰品解" : ""
          }`,
          unitNames: [u.name],
          jumpT: cc.atSeconds,
        });
      }
    }
    for (const e of enemies) {
      const s = analyzePlayerCCAndTrinket(e, friends, legacy, friendlyPets);
      for (const cc of s.ccInstances) {
        if (cc.durationSeconds < CC_MIN_S && !isHealerSpec(e.spec)) continue;
        out.push({
          t: cc.atSeconds,
          kind: "cc",
          side: "friendly",
          title: `控制成功:${cc.spellName}`,
          detail: `${cc.durationSeconds.toFixed(0)}s → ${shortName(e.name)}`,
          unitNames: [cc.sourceName, e.name],
          jumpT: cc.atSeconds,
        });
      }
    }
  } catch {
    /* 同上 */
  }

  return out.sort((a, b) => a.t - b.t);
}
