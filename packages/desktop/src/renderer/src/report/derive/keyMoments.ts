import {
  analyzeBurstLedger,
  analyzePlayerCCAndTrinket,
  computeOwnerPositionEvents,
  DEFENSIVE_TAGS,
  detectHealingGaps,
  detectPanicDefensives,
  DR_LEVEL_LABEL,
  extractMajorCooldowns,
  type IDRInfo,
  isBurstConverted,
  isHealerSpec,
  isMeleeSpec,
  POSITION_MISTAKES,
  reconstructDispelSummary,
  reconstructEnemyCDTimeline,
  stayedInHadRealCost,
  trinketSpellIds,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { resolveOwner } from "./analysisInput";
import { toLegacySafe } from "./legacySource";
import { shortUnitName } from "./teamSide";
import type { ReportSource } from "./types";

export type KeyMomentKind =
  | "death"
  | "burst-band"
  | "defensive"
  | "dispel"
  | "cc"
  | "heal-gap"
  | "position";

export interface KeyMoment {
  /** Relative seconds (from combat start). */
  t: number;
  /** burst-band only: end of the band interval. */
  toT?: number;
  kind: KeyMomentKind;
  /** Two moment levels (P0-2): major = deaths / burst bands (full pill),
   * minor = defensives / dispels / CC (small text rows, consecutive same-kind
   * entries can fold). Finding cards are always major. */
  weight: "major" | "minor";
  side: "friendly" | "enemy";
  title: string;
  detail?: string;
  /** defensive only (#10 T5): raw spell id, used to join with panic detection;
   * left unset for non-defensive kinds. */
  spellId?: string;
  unitNames: string[];
  /** Seek target in seconds (= t), the replay seek contract. */
  jumpT: number;
}

const MAJOR_KINDS: ReadonlySet<KeyMomentKind> = new Set([
  "death",
  "burst-band",
]);

const TRINKETS = new Set<string>(trinketSpellIds);
const CC_MIN_S = 3;

/** DR-level suffix for cc details (#10 T2). Single-source predicate: use
 * analysis's DR_LEVEL_LABEL wording directly, do not invent a second set of
 * phrasings here. "Full" (not yet diminished) gets no suffix — it holds for the
 * vast majority of first CC applications, so labelling each one "full duration"
 * is noise. */
const drSuffix = (drInfo: IDRInfo | null): string =>
  drInfo && drInfo.level !== "Full"
    ? ` · DR:${DR_LEVEL_LABEL[drInfo.level]}`
    : "";

/**
 * Key-moment axis data (spec: 2026-07-18-ai-analysis-key-moment-axis-design).
 * Six event kinds (heal-gap added by #10 T3); every predicate is reused from
 * analysis. Each kind has its own try/catch so one failing kind does not take
 * the rest down.
 */
export function deriveKeyMoments(
  source: ReportSource,
  ownerId?: string,
): KeyMoment[] {
  const out: Array<Omit<KeyMoment, "weight">> = [];
  let legacy: ReturnType<typeof toLegacySafe>;
  try {
    legacy = toLegacySafe(source);
  } catch {
    return [];
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
  // Owner: the explicit POV override first, then the SAME predicate the AI
  // panel and the pro comparison use (`resolveOwner`: playerId matched
  // against a Friendly unit, falling back to the friendly healer), then the
  // first friendly as the last resort. Used to be an inline chain (#10
  // residual, consolidated 2026-09-02; S2 605-file parity probe: the two
  // chains picked the same unit on all 1,270 rounds — every archive round
  // resolves its playerId to a Friendly unit with COMBATANT_INFO, so the
  // healer fallback and friends[0] never had to decide).
  const owner =
    (ownerId ? players.find((u) => u.id === ownerId) : undefined) ??
    resolveOwner(legacy) ??
    friends[0];
  // The positioning block (below) reuses these three — the same
  // "capture opportunistically, do not recompute" pattern as deepDive.ts:411.
  let enemyTl: ReturnType<typeof reconstructEnemyCDTimeline> | null = null;
  let ownerCds: ReturnType<typeof extractMajorCooldowns> | undefined;
  let ownerCcSummary: ReturnType<typeof analyzePlayerCCAndTrinket> | undefined;

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
    /* one failing kind must not take the rest down */
  }

  // burst-band: our side = the owner's burst ledger (isBurstConverted is the
  // single source for the "converted" flag)
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
            ? `${(t.damage / 1_000_000).toFixed(2)}M → ${shortUnitName(t.unitName)}`
            : undefined,
          unitNames: [owner.name, ...(t ? [t.unitName] : [])],
          jumpT: b.fromSeconds,
        });
      }
    }
  } catch {
    /* as above */
  }
  // burst-band: enemy side = aligned burst windows (same predicate as
  // [OFFENSIVE WINDOW])
  try {
    enemyTl = reconstructEnemyCDTimeline(enemies, legacy, owner, friends);
    for (const w of enemyTl.alignedBurstWindows) {
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
    /* as above */
  }

  // defensive: our big defensive CD casts (Defensive/External and not
  // throughput) + trinket uses.
  // Panic usage (#10 T5): gate predicates are the spec — consume analysis's
  // detectPanicDefensives directly (the same judgement as the def_used rows in
  // the death review), align it entry by entry with the cd.casts that function
  // already computed, keyed on (spellId, ~cast second, caster name), and append
  // the hint to detail.
  try {
    const panics = detectPanicDefensives(friends, enemies, legacy);
    for (const u of friends) {
      const cds = extractMajorCooldowns(u, legacy);
      if (u === owner) ownerCds = cds;
      for (const cd of cds) {
        if (!DEFENSIVE_TAGS.has(cd.tag) || cd.isThroughput) continue;
        for (const cast of cd.casts) {
          const isPanic = panics.some(
            (p) =>
              p.spellId === cd.spellId &&
              p.casterName === u.name &&
              Math.abs(p.timeSeconds - cast.timeSeconds) < 1,
          );
          out.push({
            t: cast.timeSeconds,
            kind: "defensive",
            side: "friendly",
            title: cd.spellName,
            detail:
              [cast.timingLabel, isPanic ? "恐慌性使用" : undefined]
                .filter(Boolean)
                .join(" · ") || undefined,
            spellId: cd.spellId,
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
          spellId: c.spellId,
          unitNames: [u.name],
          jumpT: rel(c.timestamp),
        });
      }
    }
  } catch {
    /* as above */
  }

  // dispel: Critical/High (same measure as F163)
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
    /* as above */
  }

  // cc: CC on our side (≥3s or it forced a trinket); successful CC we landed
  // (≥3s or the target was a healer)
  try {
    for (const u of friends) {
      const s = analyzePlayerCCAndTrinket(u, enemies, legacy, enemyPets);
      if (u === owner) ownerCcSummary = s;
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
          }${drSuffix(cc.drInfo)}`,
          // Both caster and victim go into unitNames so the replay can
          // highlight the enemy caster too
          unitNames: [cc.sourceName, u.name],
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
          detail: `${cc.durationSeconds.toFixed(0)}s → ${shortUnitName(e.name)}${drSuffix(cc.drInfo)}`,
          unitNames: [cc.sourceName, e.name],
          jumpT: cc.atSeconds,
        });
      }
    }
  } catch {
    /* as above */
  }

  // heal-gap: healing gaps (when the owner is a healer) — same gate predicate
  // detectHealingGaps, sharing one detector with healerMetrics's
  // healingGapSeconds/Count (#10 T3).
  try {
    if (owner && isHealerSpec(owner.spec)) {
      for (const g of detectHealingGaps(owner, friends, enemies, legacy)) {
        out.push({
          t: g.fromSeconds,
          toT: g.toSeconds,
          kind: "heal-gap",
          side: "friendly",
          title: `治疗空窗 ${g.durationSeconds.toFixed(1)}s`,
          detail: `${g.mostDamagedSpec}(${shortUnitName(g.mostDamagedName)})承受 ${Math.round(g.mostDamagedAmount / 1000)}k`,
          unitNames: [owner.name],
          jumpT: g.fromSeconds,
        });
      }
    }
  } catch {
    /* as above */
  }

  // position: positioning mistakes (#10 T4) — only the three genuine mistake
  // types reach the axis, sharing the predicate with hasCoachableSignal in
  // deepDive.ts: KITED/SPLIT_PUSH/HEALER_TRAINED are not mistakes (they may be
  // correct calls or unsalvageable), and STAYED_IN only reaches the axis when
  // stayedInHadRealCost proves a real HP cost was paid — not the "HP 100%→98%
  // also counts as a mistake" noise.
  if (owner && enemyTl) {
    try {
      // Confirmed by an agy review: ownerCds/ownerCcSummary are captured
      // opportunistically, not guaranteed — if a teammate ordered before the
      // owner in `friends` makes the defensive/cc block throw, the loop aborts
      // before reaching the owner and both variables stay undefined forever.
      // Fall back to computing the owner's own copy here rather than depending
      // on whether the earlier blocks got as far as the owner.
      const posEvents = computeOwnerPositionEvents({
        owner,
        enemies,
        combat: legacy,
        burstWindows: enemyTl.alignedBurstWindows,
        ownerCooldowns: ownerCds ?? extractMajorCooldowns(owner, legacy),
        ownerCCSummary:
          ownerCcSummary ??
          analyzePlayerCCAndTrinket(owner, enemies, legacy, enemyPets),
        isHealer: isHealerSpec(owner.spec),
        ownerIsMelee: isMeleeSpec(owner.spec),
        friends,
      });
      for (const e of posEvents) {
        // Single-source whitelist (analysis's POSITION_MISTAKES, the same one
        // deepDive.ts uses) — KITED/SPLIT_PUSH/HEALER_TRAINED are not
        // "mistakes" and never reach the axis. STAYED_IN adds one further gate
        // on top: stayedInHadRealCost (only counts if a real HP cost was paid).
        if (!POSITION_MISTAKES.has(e.type)) continue;
        if (
          e.type === "STAYED_IN" &&
          !stayedInHadRealCost(e.ownerHpMinPct, e.ownerHpStartPct)
        ) {
          continue;
        }
        const title =
          e.type === "STAYED_IN"
            ? "顶着爆发硬扛"
            : e.type === "MISSED_PUSH"
              ? "该压没压"
              : "CD 距离外";
        const detail =
          e.type === "STAYED_IN"
            ? `${e.startDistanceYards}→${e.endDistanceYards}yd 贴 ${shortUnitName(e.nearestEnemyName ?? "")}${
                e.dangerLabel ? ` · ${e.dangerLabel}爆发` : ""
              }${
                e.ownerHpStartPct != null && e.ownerHpMinPct != null
                  ? ` · HP ${e.ownerHpStartPct}%→${e.ownerHpMinPct}%`
                  : ""
              }`
            : e.type === "MISSED_PUSH"
              ? `>${e.startDistanceYards}yd 脱节`
              : `${e.spellName ?? ""} · ${e.startDistanceYards}yd 外`;
        out.push({
          t: e.atSeconds,
          toT: e.toSeconds,
          kind: "position",
          side: "friendly",
          title,
          detail,
          unitNames: [owner.name],
          jumpT: e.atSeconds,
        });
      }
    } catch {
      /* positioning analysis needs advanced logging / geometry; without it this
         kind is simply absent */
    }
  }

  return out
    .map((m): KeyMoment => ({
      ...m,
      weight: MAJOR_KINDS.has(m.kind) ? "major" : "minor",
    }))
    .sort((a, b) => a.t - b.t);
}
