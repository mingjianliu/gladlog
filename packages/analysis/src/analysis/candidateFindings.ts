import { CombatUnitReaction } from "@gladlog/parser-compat";

import {
  analyzeBurstLedger,
  auditWindowTargeting,
  ON_TARGET_GOOD_PCT,
} from "../utils/burstLedger";
import {
  extractMajorCooldowns,
  type IMajorCooldownInfo,
  isHealerSpec,
} from "../utils/cooldowns";
import { isBurstConverted } from "../utils/dpsMetrics";
import { analyzeOutgoingCCChains } from "../utils/drAnalysis";
import { analyzeKickAudit } from "../utils/kickAudit";
import { computeOffensiveWindows } from "../utils/offensiveWindows";
import type { CandidateEvent } from "./types";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

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
 *  - cd-waste (the owner's — default: the Friendly healer's — never-used
 *    DEFENSIVE major cooldowns)
 *  - DPS owner only (D2; healer menus unchanged): burst-into-immunity /
 *    off-target-in-window / juked-kick / dr-clipped-cc
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

/** 25%/Immune = wasted(镜像 IOutgoingCCChain.hasWastedApplications 的定义)。 */
const WASTED_DR_LEVELS = new Set(["25%", "Immune"]);

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
