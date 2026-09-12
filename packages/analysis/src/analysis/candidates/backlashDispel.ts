/**
 * backlash-dispel / backlash-dispel-window — GH #80, user approval 2026-09-12
 * after the archive cost/benefit model (`backlashDispelOutcomeProbe.ts`,
 * 180k opportunities; numbers quoted in data/backlashDispelPrior.ts).
 *
 * The decision point is a backlash debuff (Unstable Affliction / Vampiric
 * Touch, `DISPEL_PENALTY_SPELLS`) landing on a friendly while a capable
 * friendly dispeller is off cleanse cooldown. Two producers read the points:
 *
 *   backlash-dispel         the OWNER dispelled it in the stratum the corpus
 *                           measured as net-negative and clean:
 *                             UA: ≤ 2 stacks, target ≥ 60 % HP
 *                             VT: target ≥ 80 % HP
 *                           and nothing Critical/High was co-removed by the
 *                           same cast, and the owner was not immune to the
 *                           backlash. (UA at 4+ stacks is an open tradeoff —
 *                           net −150k but the left-on death rate doubles —
 *                           and is never accused; targets < 40 % HP are never
 *                           judged in either direction.)
 *   backlash-dispel-window  the owner COULD have dispelled and did not, in a
 *                           stratum the corpus measured as net-positive:
 *                             "worth":  VT, target 40–60 % HP, ≥ 3 of the
 *                                       caster's DoTs on them (net +65k,
 *                                       death 4.9 % vs 12.0 %)
 *                             "immune": the owner was under a corpus-mined
 *                                       backlash immunity, target ≥ 60 % HP
 *                                       (the CC half of the cost is gone)
 *                           It is an alternative-line suggestion, not a
 *                           mistake claim.
 *
 * Shared predicates (CLAUDE.md): dispel events + backlash landing + the
 * dispeller's 4 s damage window come from `reconstructDispelSummary`
 * (the same object the [DISPEL] context lines render from); cleanse
 * availability replays that summary's `cleanseWasOnCD` rule
 * (`canDefensiveCleanse` × `DISPEL_COOLDOWNS_BY_SPELL`); HP facts are
 * `gridHpPct` at a whole rendered second; incoming CC with DR level is
 * `analyzeOutgoingCCChains` mirrored; hard-CC membership is
 * `HARD_CC_CATEGORIES`. The archive probe imports `backlashDispelDecisionPoints`
 * — never a second implementation.
 */
import {
  backlashImmunityIds,
  type BacklashPriorRef,
  type BacklashWorthRef,
} from "../../data/backlashDispelPrior";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { gridHpPct, isHealerSpec } from "../../utils/cooldowns";
import {
  canDefensiveCleanse,
  DISPEL_COOLDOWNS_BY_SPELL,
  DISPEL_PENALTY_SPELLS,
  type DispelPriority,
  getDispelType,
  type IDispelEvent,
  reconstructDispelSummary,
} from "../../utils/dispelAnalysis";
import { analyzeOutgoingCCChains, getDRCategory } from "../../utils/drAnalysis";
import { toRenderSecond } from "../../utils/renderGrid";
import { fmtFactNum as fmt, fmtFactTime } from "../factFormat";
import type { CandidateEvent } from "../types";
import { HARD_CC_CATEGORIES } from "./cooldownTiming";

/** Outcome / benefit window after the decision instant. */
export const BACKLASH_WINDOW_S = 15;
/** The dispel cooldown whose exposure is measured (default cleanse cd). */
export const BACKLASH_CD_WINDOW_S = 8;
/** The dispeller's own before/after window (UA silence length). */
export const BACKLASH_SELF_WINDOW_S = 4;
/** Left-on decision instant = application + this (archive: dispelled median
 * latency 5.4 s — both branches must look at the same lag). */
export const BACKLASH_LEFT_ON_LAG_S = 5;
/** DoTs "on the target" = distinct caster DoT spells ticking in this many
 * seconds before the decision instant. */
export const BACKLASH_DOT_LOOKBACK_S = 5;
/** Accusation strata (archive-measured, see the module header). */
export const BACKLASH_UA_MAX_STACKS = 2;
export const BACKLASH_UA_SAFE_HP_PCT = 60;
export const BACKLASH_VT_SAFE_HP_PCT = 80;
/** "Worth dispelling" window (VT): target HP band and DoT floor. */
export const BACKLASH_WORTH_HP_LO = 40;
export const BACKLASH_WORTH_HP_HI = 60;
export const BACKLASH_WORTH_MIN_DOTS = 3;
/** "Immune window": target HP floor under which nobody is judged. */
export const BACKLASH_IMMUNE_WINDOW_HP_PCT = 60;
export const BACKLASH_DISPEL_CAP = 2;
export const BACKLASH_WINDOW_CAP = 2;
/** Backlash aura pairing on the dispeller (the UA evidence window). */
const BACKLASH_PAIR_MS = 3_000;
/** Same-cast co-removal pairing (one cleanse emits one SPELL_DISPEL per aura). */
const CO_REMOVE_PAIR_S = 0.1;

const UA_ID = "1259790";
const VT_ID = "34914";
/** What the backlash does to the dispeller — the aura the probe found on the
 * dispeller (UA 196364 silence 4 s, VT 87204 Sin and Punishment horror 3 s);
 * the prior table carries the same two values and the gate re-checks them. */
export const BACKLASH_KIND: Readonly<
  Record<string, { kind: "silence" | "horror"; seconds: number }>
> = {
  [UA_ID]: { kind: "silence", seconds: 4 },
  [VT_ID]: { kind: "horror", seconds: 3 },
};

export interface BacklashCcHit {
  targetName: string;
  spellName: string;
  atS: number;
  durationS: number;
  drLevel: string;
}

export interface IBacklashDispelPoint {
  spellId: string;
  spellName: string;
  casterId: string;
  targetId: string;
  targetName: string;
  targetHealer: boolean;
  applyS: number;
  auraEndS: number;
  /** ≥ 1 capable friendly dispeller was off cleanse cooldown at application. */
  available: boolean;
  /** ids of the capable dispellers who were off cooldown at application. */
  availableDispellerIds: string[];
  dispelled: boolean;
  dispelS: number | null;
  dispellerId: string | null;
  dispellerName: string | null;
  dispellerHealer: boolean | null;
  dispelSpellName: string | null;
  /** The decision instant: the dispel, or application + BACKLASH_LEFT_ON_LAG_S. */
  t0S: number;
  /** Debuff stacks at t0 (1 when no dose event preceded it; VT never stacks). */
  stacks: number;
  coRemoved: Array<{ spellName: string; priority: DispelPriority }>;
  coRemovedCritical: boolean;
  /** `gridHpPct` of the target at the rendered second of t0. */
  targetHpPct: number | null;
  /** Dispelled: the backlash aura landed on the dispeller within 3 s. */
  backlashLanded: boolean | null;
  /** Dispelled: buff ids from the corpus immunity set active on the dispeller
   * at t0; left on: the same for the first available dispeller. */
  immuneBuffIds: string[];
  /** The reference dispeller (dispeller when dispelled, else the first
   * available healer/dispeller) and EVERY buff id active on them at t0 — the
   * archive probe mines the immunity set from this; the product only reads
   * `immuneBuffIds`. */
  refDispellerId: string | null;
  refDispellerBuffIds: string[];
  /** Dispelled: damage taken by the dispeller 4 s before / after (summary). */
  dispellerDmgBefore: number | null;
  dispellerDmgAfter: number | null;
  /** Healing output of the dispeller (dispelled) / the reference available
   * dispeller (left on), 4 s before / after t0. */
  healerHealBefore: number;
  healerHealAfter: number;
  /** Distinct caster DoT spells ticking on the target in the 5 s before t0. */
  dotCountPre: number;
  /** All damage from the caster on the target in the 15 s after t0. */
  casterDmgAfter: number;
  /** First dispellable hard CC on ANY friendly inside (t0, t0+8] that no
   * capable dispeller could answer (all on cooldown), or null. */
  cdCcHit: BacklashCcHit | null;
}

interface UnitLike {
  id: string;
  name: string;
  ownerId: string;
  info?: unknown;
  spec: number;
  auraEvents: any[];
  damageIn: any[];
  healOut: any[];
}

function sumAbs(
  events: Array<{ logLine: { timestamp: number }; effectiveAmount: number }>,
  fromMs: number,
  toMs: number,
): number {
  let s = 0;
  for (const e of events) {
    const t = e.logLine.timestamp;
    if (t >= fromMs && t <= toMs) s += Math.abs(e.effectiveAmount);
  }
  return s;
}

/**
 * Every backlash-debuff opportunity for ONE team perspective. Pure function of
 * the round; the archive probe and the product menu both consume it.
 */
export function backlashDispelDecisionPoints(
  friends: any[],
  enemies: any[],
  combat: { startTime: number; endTime: number; units?: Record<string, any> },
  friendlyPets: any[] = [],
  enemyPets: any[] = [],
): IBacklashDispelPoint[] {
  const out: IBacklashDispelPoint[] = [];
  const friendPlayers = (friends as UnitLike[]).filter((f) => f.info);
  const enemyPlayers = (enemies as UnitLike[]).filter((e) => e.info);
  if (friendPlayers.length === 0 || enemyPlayers.length === 0) return out;
  const startMs = combat.startTime;
  const rel = (ms: number) => (ms - startMs) / 1000;
  const enemyIds = new Set(enemyPlayers.map((e) => e.id));
  let summary;
  try {
    summary = reconstructDispelSummary(
      friendPlayers as never,
      enemyPlayers as never,
      combat,
      friendlyPets as never,
      enemyPets as never,
    );
  } catch {
    return out;
  }
  const cleanses: IDispelEvent[] = summary.allyCleanse;
  const byName = new Map(friendPlayers.map((f) => [f.name, f]));

  let incoming: Array<{
    targetName: string;
    atSeconds: number;
    durationSeconds: number;
    spellId: string;
    spellName: string;
    drLevel: string;
  }> = [];
  try {
    for (const ch of analyzeOutgoingCCChains(
      enemyPlayers as never,
      friendPlayers as never,
      combat as never,
    ))
      for (const app of ch.applications)
        incoming.push({
          targetName: ch.targetName,
          atSeconds: app.atSeconds,
          durationSeconds: app.durationSeconds,
          spellId: app.spellId,
          spellName: app.spellName,
          drLevel: String(app.drInfo.level),
        });
  } catch {
    incoming = [];
  }
  const capableFor = (dtype: string) =>
    friendPlayers.filter((f) =>
      canDefensiveCleanse(f as never, dtype as never),
    );
  const offCd = (f: UnitLike, atRel: number): boolean => {
    for (const c of cleanses) {
      if (c.sourceName !== f.name || c.timeSeconds >= atRel) continue;
      const cd = DISPEL_COOLDOWNS_BY_SPELL.get(c.dispelSpellId) ?? 8;
      if (cd > 0 && c.timeSeconds + cd > atRel) return false;
    }
    return true;
  };
  const activeBuffIds = (u: UnitLike, atMs: number): Set<string> => {
    const on = new Map<string, boolean>();
    for (const b of u.auraEvents ?? []) {
      if (b.auraType !== "BUFF" || !b.spellId) continue;
      if (b.timestamp > atMs) break;
      const ev = b.logLine.event;
      if (
        ev === "SPELL_AURA_APPLIED" ||
        ev === "SPELL_AURA_REFRESH" ||
        ev === "SPELL_AURA_APPLIED_DOSE"
      )
        on.set(b.spellId, true);
      else if (ev === "SPELL_AURA_REMOVED") on.set(b.spellId, false);
    }
    return new Set([...on].filter(([, v]) => v).map(([id]) => id));
  };

  for (const target of friendPlayers) {
    const auras = target.auraEvents ?? [];
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i];
      if (a.logLine.event !== "SPELL_AURA_APPLIED" || a.auraType !== "DEBUFF")
        continue;
      const sid: string = a.spellId ?? "";
      if (!DISPEL_PENALTY_SPELLS.has(sid)) continue;
      const casterId: string = a.srcUnitId;
      if (!enemyIds.has(casterId)) continue;
      const applyMs: number = a.timestamp;
      const removed = auras
        .slice(i + 1)
        .find(
          (b: any) =>
            b.spellId === sid &&
            (b.logLine.event === "SPELL_AURA_REMOVED" ||
              b.logLine.event === "SPELL_AURA_APPLIED"),
        );
      const endMs: number = removed ? removed.timestamp : combat.endTime;
      const applyRel = rel(applyMs);
      const dtype = getDispelType(sid);
      if (!dtype) continue;
      const capable = capableFor(dtype);
      if (capable.length === 0) continue;
      const available = capable.filter((f) => offCd(f, applyRel));

      const dispel = cleanses.find(
        (c) =>
          c.targetName === target.name &&
          c.removedSpellId === sid &&
          c.timeSeconds >= applyRel - 0.05 &&
          c.timeSeconds <= rel(endMs) + 0.15,
      );
      const dispeller = dispel ? byName.get(dispel.sourceName) : undefined;
      const t0S = dispel
        ? dispel.timeSeconds
        : applyRel + BACKLASH_LEFT_ON_LAG_S;
      const t0Ms = startMs + t0S * 1000;
      const refHealer =
        dispeller ??
        available.find((f) => isHealerSpec(f.spec as never)) ??
        available[0] ??
        capable[0];

      let stacks = 1;
      for (const b of auras.slice(i + 1)) {
        if (b.timestamp > Math.min(endMs, t0Ms)) break;
        if (b.spellId !== sid) continue;
        const ev = b.logLine.event;
        if (
          ev === "SPELL_AURA_APPLIED_DOSE" ||
          ev === "SPELL_AURA_REMOVED_DOSE"
        ) {
          const amt = Number(
            b.amount ?? b.logLine.parameters?.[b.logLine.parameters.length - 1],
          );
          if (Number.isFinite(amt)) stacks = amt;
        }
      }

      const coRemoved = dispel
        ? cleanses
            .filter(
              (c) =>
                c.sourceName === dispel.sourceName &&
                Math.abs(c.timeSeconds - dispel.timeSeconds) <=
                  CO_REMOVE_PAIR_S &&
                !(c.removedSpellId === sid && c.targetName === target.name),
            )
            .map((c) => ({
              spellName: c.removedSpellName,
              priority: c.priority,
            }))
        : [];

      let backlashLanded: boolean | null = null;
      if (dispel && dispeller) {
        const want = BACKLASH_KIND[sid]
          ? sid === UA_ID
            ? "196364"
            : "87204"
          : null;
        backlashLanded =
          Boolean(dispel.backlashCcSpellId) ||
          (want !== null &&
            (dispeller.auraEvents ?? []).some(
              (b: any) =>
                b.spellId === want &&
                b.logLine.event === "SPELL_AURA_APPLIED" &&
                b.timestamp >= t0Ms &&
                b.timestamp <= t0Ms + BACKLASH_PAIR_MS,
            ));
      }

      const immunity = backlashImmunityIds(sid);
      const refBuffs = refHealer ? [...activeBuffIds(refHealer, t0Ms)] : [];
      const immuneBuffIds = refBuffs.filter((id) => immunity.has(id));

      const dotNames = new Set<string>();
      let casterDmgAfter = 0;
      for (const d of target.damageIn ?? []) {
        if (d.srcUnitId !== casterId) continue;
        const t = d.logLine.timestamp;
        if (
          d.logLine.event === "SPELL_PERIODIC_DAMAGE" &&
          t >= t0Ms - BACKLASH_DOT_LOOKBACK_S * 1000 &&
          t < t0Ms
        )
          dotNames.add(String(d.spellId));
        if (t >= t0Ms && t <= t0Ms + BACKLASH_WINDOW_S * 1000)
          casterDmgAfter += Math.abs(d.effectiveAmount);
      }

      let cdCcHit: BacklashCcHit | null = null;
      for (const app of incoming) {
        if (app.atSeconds <= t0S || app.atSeconds > t0S + BACKLASH_CD_WINDOW_S)
          continue;
        if (!HARD_CC_CATEGORIES.has(getDRCategory(app.spellId))) continue;
        const ct = getDispelType(app.spellId);
        if (!ct) continue;
        const cap = capableFor(ct);
        if (cap.length === 0) continue;
        if (cap.some((f) => offCd(f, app.atSeconds))) continue;
        cdCcHit = {
          targetName: app.targetName,
          spellName: getEnglishSpellName(app.spellId, app.spellName),
          atS: app.atSeconds,
          durationS: app.durationSeconds,
          drLevel: app.drLevel,
        };
        break;
      }

      const selfMs = BACKLASH_SELF_WINDOW_S * 1000;
      out.push({
        spellId: sid,
        spellName: getEnglishSpellName(sid, a.spellName ?? sid),
        casterId,
        targetId: target.id,
        targetName: target.name,
        targetHealer: isHealerSpec(target.spec as never),
        applyS: applyRel,
        auraEndS: rel(endMs),
        available: available.length > 0,
        availableDispellerIds: available.map((f) => f.id),
        dispelled: Boolean(dispel),
        dispelS: dispel ? dispel.timeSeconds : null,
        dispellerId: dispeller?.id ?? null,
        dispellerName: dispeller?.name ?? null,
        dispellerHealer: dispeller
          ? isHealerSpec(dispeller.spec as never)
          : null,
        dispelSpellName: dispel?.dispelSpellName ?? null,
        t0S,
        stacks,
        coRemoved,
        coRemovedCritical: coRemoved.some(
          (c) => c.priority === "Critical" || c.priority === "High",
        ),
        targetHpPct: gridHpPct(
          target as never,
          startMs + toRenderSecond(t0S) * 1000,
        ),
        backlashLanded,
        immuneBuffIds,
        refDispellerId: refHealer?.id ?? null,
        refDispellerBuffIds: refBuffs,
        dispellerDmgBefore: dispel?.penaltyDamageBaseline ?? null,
        dispellerDmgAfter: dispel?.penaltyDamageTaken ?? null,
        healerHealBefore: refHealer
          ? sumAbs(refHealer.healOut ?? [], t0Ms - selfMs, t0Ms)
          : 0,
        healerHealAfter: refHealer
          ? sumAbs(refHealer.healOut ?? [], t0Ms, t0Ms + selfMs)
          : 0,
        dotCountPre: dotNames.size,
        casterDmgAfter,
        cdCcHit,
      });
    }
  }
  return out.sort((a, b) => a.t0S - b.t0S);
}

/** The accusation stratum — one predicate, shared by the producer, the probe
 * and the tests. Never reads outcome. */
export function isAccusableBacklashDispel(p: IBacklashDispelPoint): boolean {
  if (!p.dispelled || p.coRemovedCritical || p.immuneBuffIds.length > 0)
    return false;
  // A dispel whose backlash did NOT land, by a dispeller in no mined immunity,
  // is a case we cannot explain (an unmined immunity, a pet dispel, a log
  // gap) — the sentence would list a cost of zero. Never accuse it.
  if (p.backlashLanded !== true) return false;
  if (p.targetHpPct == null) return false;
  if (p.spellId === UA_ID)
    return (
      p.stacks <= BACKLASH_UA_MAX_STACKS &&
      p.targetHpPct >= BACKLASH_UA_SAFE_HP_PCT
    );
  if (p.spellId === VT_ID) return p.targetHpPct >= BACKLASH_VT_SAFE_HP_PCT;
  return false;
}

/** The "worth dispelling" stratum (VT only — the UA cell never went net
 * positive at any stack count). */
export function isWorthWindow(p: IBacklashDispelPoint): boolean {
  return (
    !p.dispelled &&
    p.available &&
    p.spellId === VT_ID &&
    p.targetHpPct != null &&
    p.targetHpPct >= BACKLASH_WORTH_HP_LO &&
    p.targetHpPct < BACKLASH_WORTH_HP_HI &&
    p.dotCountPre >= BACKLASH_WORTH_MIN_DOTS
  );
}

/** The "cheap dispel" stratum: the reference dispeller was immune. */
export function isImmuneWindow(p: IBacklashDispelPoint): boolean {
  return (
    !p.dispelled &&
    p.available &&
    p.immuneBuffIds.length > 0 &&
    p.targetHpPct != null &&
    p.targetHpPct >= BACKLASH_IMMUNE_WINDOW_HP_PCT
  );
}

const joinNames = (xs: string[]) => xs.join("; ");
const k = (x: number) => String(Math.round(x / 1000));

/**
 * backlash-dispel: the owner dispelled a backlash debuff in the net-negative
 * stratum. Facts are the round's own numbers plus the corpus reference.
 */
export function backlashDispelEvents(
  points: IBacklashDispelPoint[],
  owner: { id: string; name: string },
  probes: { lookup: (spellId: string) => BacklashPriorRef | null },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? BACKLASH_DISPEL_CAP;
  const mine = points.filter(
    (p) => p.dispellerId === owner.id && isAccusableBacklashDispel(p),
  );
  const out: CandidateEvent[] = [];
  for (const p of mine) {
    const ref = probes.lookup(p.spellId);
    if (!ref) continue; // no baseline → no accusation
    const kind = BACKLASH_KIND[p.spellId];
    out.push({
      id: `backlash-dispel:${owner.id}:${Math.round(p.t0S)}`,
      type: "backlash-dispel",
      t: p.t0S,
      unitNames: [p.targetName],
      spell: p.spellName,
      spellId: p.spellId,
      facts: {
        t: fmtFactTime(p.t0S),
        target: p.targetName,
        debuff: p.spellName,
        stacks: String(p.stacks),
        targetHpPct: String(p.targetHpPct),
        backlash: kind ? `${kind.kind} ${kind.seconds}s` : "unknown",
        backlashLanded: p.backlashLanded ? "yes" : "no",
        selfDmgBeforeK: k(p.dispellerDmgBefore ?? 0),
        selfDmgAfterK: k(p.dispellerDmgAfter ?? 0),
        healBeforeK: k(p.healerHealBefore),
        healAfterK: k(p.healerHealAfter),
        coRemoved: p.coRemoved.length
          ? joinNames(p.coRemoved.map((c) => c.spellName))
          : "none",
        ...(p.cdCcHit
          ? {
              cdCcTarget: p.cdCcHit.targetName,
              cdCcSpell: p.cdCcHit.spellName,
              cdCcT: fmtFactTime(p.cdCcHit.atS),
              cdCcDurationS: fmt(p.cdCcHit.durationS),
              cdCcDr: p.cdCcHit.drLevel,
            }
          : {}),
        refKey: ref.spellId,
        refN: String(ref.n),
        refRemovedK: String(ref.removedK),
        refHealLostK: String(ref.healLostK),
        refBacklashDmgK: String(ref.backlashDmgK),
        refCcExposureS: fmt(ref.ccExposureS),
      },
    });
  }
  // rank: no co-removal is already required; prefer the higher-HP target
  // (the clearer case), then time. Emit in time order.
  return out
    .sort(
      (a, b) =>
        Number(b.facts.targetHpPct) - Number(a.facts.targetHpPct) || a.t - b.t,
    )
    .slice(0, cap)
    .sort((a, b) => a.t - b.t);
}

/**
 * backlash-dispel-window: the owner could have dispelled and did not, in a
 * stratum the corpus measured as worth it ("worth") or cheap ("immune").
 * An alternative-line suggestion — the legend forbids accusatory phrasing.
 */
export function backlashDispelWindowEvents(
  points: IBacklashDispelPoint[],
  owner: { id: string; name: string },
  probes: {
    lookup: (spellId: string) => BacklashPriorRef | null;
    lookupWorth: (
      spellId: string,
      kind: "worth" | "immune",
    ) => BacklashWorthRef | null;
  },
  overrides?: { cap?: number },
): CandidateEvent[] {
  const cap = overrides?.cap ?? BACKLASH_WINDOW_CAP;
  const out: CandidateEvent[] = [];
  for (const p of points) {
    if (!p.availableDispellerIds.includes(owner.id)) continue;
    const worth = isWorthWindow(p);
    const immune = !worth && isImmuneWindow(p);
    if (!worth && !immune) continue;
    const ref = probes.lookup(p.spellId);
    if (!ref) continue;
    // both forms need their own corpus cell to say "net positive here" —
    // no cell (or a cell the guard rejects) → the window never fires
    const worthRef = probes.lookupWorth(p.spellId, worth ? "worth" : "immune");
    if (!worthRef) continue;
    const kind = BACKLASH_KIND[p.spellId];
    out.push({
      id: `backlash-dispel-window:${owner.id}:${Math.round(p.t0S)}`,
      type: "backlash-dispel-window",
      t: p.t0S,
      unitNames: [p.targetName],
      spell: p.spellName,
      spellId: p.spellId,
      facts: {
        t: fmtFactTime(p.t0S),
        target: p.targetName,
        debuff: p.spellName,
        stacks: String(p.stacks),
        targetHpPct: String(p.targetHpPct),
        dots: String(p.dotCountPre),
        reason: worth ? "worth" : "immune",
        backlash: kind ? `${kind.kind} ${kind.seconds}s` : "unknown",
        ...(immune
          ? {
              immuneBuff: joinNames(
                p.immuneBuffIds.map((id) => getEnglishSpellName(id, id)),
              ),
            }
          : {}),
        casterDmgAfterK: k(p.casterDmgAfter),
        refKey: `${ref.spellId}:${worth ? "worth" : "immune"}`,
        refND: String(worthRef.nD),
        refNL: String(worthRef.nL),
        refDeathDispelled: String(worthRef.deathDPct),
        refDeathLeft: String(worthRef.deathLPct),
        refNetK: String(worthRef.netK),
      },
    });
  }
  return out
    .sort((a, b) => Number(b.facts.dots) - Number(a.facts.dots) || a.t - b.t)
    .slice(0, cap)
    .sort((a, b) => a.t - b.t);
}
