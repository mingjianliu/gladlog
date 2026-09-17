/**
 * Stacked major defensives (GH #95 "给重了", 2026-09-17) — a FACT, not a
 * verdict.
 *
 * User ruling 2026-09-16: two MAJOR defensives from two different friendlies
 * up on the same target at the same time ("牧师给了痛苦压制,奶僧给了真气之茧").
 * Small cooldowns never count. The user then withdrew the "one would have
 * been enough" claim ("我们甚至有可能算错了") after the probe showed the second
 * aura keeps blocking after the first expires (702 of 7,492 pairs blocked
 * ≥ 20 % max HP after the overlap) — so this module only STATES the stack:
 * who cast A, who cast B, how long they overlapped, and what B blocked where
 * it can be priced. The card leaves the judgement to the reader.
 *
 * Pricing mirrors the product's mitigation arithmetic (`resolveMitigation`,
 * talent- and carrier-aware; multiplicative stacking, measured 2026-09-13):
 *  - percentage aura: D × b / (1 − b) with D = damage the target actually
 *    took while both were up, b = pctMin of B; the same over B's full run;
 *  - absorb aura: the absorbs the log credits to B's spell AND B's caster
 *    (codex R2: dropping the caster credited another player's same-spell
 *    shield to B);
 *  - immunity, positional or off-table: unpriced, said so on the card.
 * Only pairs the OWNER took part in (cast A or B, or is the target) are
 * returned — the card is owner-anchored like every other context line.
 */
import {
  resolveMitigation,
  strongestComponentPct,
} from "../data/mitigationComponents";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdLists from "../data/spellIdLists";
import { buildAuraIntervals } from "../utils/auraIntervals";

/** external ∪ big-personal defensives — the two lists the product already
 * treats as "major"; small cooldowns (Fade, PW:S) are on neither */
export const STACKED_DEFENSIVE_MAJOR_IDS: ReadonlySet<string> = new Set<string>(
  [
    ...spellIdLists.externalDefensiveSpellIds.map(String),
    ...spellIdLists.bigDefensiveSpellIds.map(String),
  ],
);
/** overlaps shorter than this are aura-refresh noise, not a stack */
export const STACKED_DEFENSIVE_MIN_OVERLAP_S = 0.5;

export interface StackedDefensivePair {
  targetId: string;
  targetName: string;
  targetIsOwner: boolean;
  first: {
    spellId: string;
    spellName: string;
    casterName: string;
    casterIsOwner: boolean;
  };
  second: {
    spellId: string;
    spellName: string;
    casterName: string;
    casterIsOwner: boolean;
  };
  /** whole seconds since round start, on `fmtTime`'s grid */
  overlapFromSec: number;
  overlapToSec: number;
  /** rounded to 1 dp */
  overlapSeconds: number;
  /** how B was priced; `unpriced` carries the reason in `unpricedReason` */
  pricing: "pct" | "absorb" | "unpriced";
  unpricedReason: "immunity" | "positional" | "off-table" | null;
  /** B's extra blocked damage during the overlap, integer % of target max HP */
  blockedOverlapPct: number | null;
  /** B's blocked damage over its full run (from the overlap start to B's
   * end), integer % — only for percentage auras */
  blockedFullPct: number | null;
  /** B's full run length in whole seconds */
  secondRunSeconds: number;
}

export function stackedDefensivePairs(
  owner: any,
  combat: any,
): StackedDefensivePair[] {
  if (!owner?.info) return [];
  const players = (Object.values(combat?.units ?? {}) as any[]).filter(
    (u) => u.info,
  );
  const byName = new Map<string, any>(players.map((u) => [u.name, u]));
  const byId = new Map<string, any>(players.map((u) => [u.id, u]));
  const nameOf = (id: string) => getEnglishSpellName(id, "") || id;
  const out: StackedDefensivePair[] = [];
  for (const target of players.filter((u) => u.reaction === owner.reaction)) {
    const friendNames = new Set(
      players.filter((u) => u.reaction === target.reaction).map((u) => u.name),
    );
    const maxHp = Math.max(
      1,
      ...((target.advancedActions ?? []) as any[]).map(
        (x) => x.advancedActorMaxHp ?? 0,
      ),
    );
    let ivs;
    try {
      ivs = buildAuraIntervals(target, combat, byId)
        .filter(
          (iv) =>
            STACKED_DEFENSIVE_MAJOR_IDS.has(iv.spellId) &&
            friendNames.has(iv.srcUnitName),
        )
        .sort((x, y) => x.fromS - y.fromS);
    } catch {
      continue;
    }
    for (let i = 0; i < ivs.length; i++) {
      for (let j = i + 1; j < ivs.length; j++) {
        const first = ivs[i]!;
        const second = ivs[j]!;
        if (second.fromS >= first.toS) break;
        if (second.srcUnitName === first.srcUnitName) continue;
        const oFrom = second.fromS;
        const oTo = Math.min(first.toS, second.toS);
        if (oTo - oFrom < STACKED_DEFENSIVE_MIN_OVERLAP_S) continue;
        const involvesOwner =
          target.id === owner.id ||
          first.srcUnitName === owner.name ||
          second.srcUnitName === owner.name;
        if (!involvesOwner) continue;
        const caster2 = byName.get(second.srcUnitName);
        const res = resolveMitigation(second.spellId, {
          carrierIsCaster: second.srcUnitName === target.name,
          caster: caster2,
        });
        const pct = res
          ? strongestComponentPct(res, { includeImmunity: true })
          : undefined;
        const fromMs = combat.startTime + oFrom * 1000;
        const toMs = combat.startTime + oTo * 1000;
        const bEndMs = combat.startTime + second.toS * 1000;
        const dmgBetween = (a: number, b: number) =>
          ((target.damageIn ?? []) as any[])
            .filter((d) => d.timestamp >= a && d.timestamp <= b)
            .reduce(
              (n, d) => n + Math.abs(d.effectiveAmount ?? d.amount ?? 0),
              0,
            );
        const absorbed = ((target.absorbsIn ?? []) as any[])
          .filter(
            (e) =>
              e.timestamp >= fromMs &&
              e.timestamp <= toMs &&
              String(e.spellId) === second.spellId &&
              (e.srcUnitName === second.srcUnitName ||
                e.srcUnitId === caster2?.id),
          )
          .reduce((n, e) => n + (e.absorbedAmount ?? 0), 0);
        let pricing: StackedDefensivePair["pricing"] = "unpriced";
        let unpricedReason: StackedDefensivePair["unpricedReason"] = null;
        let blockedOverlapPct: number | null = null;
        let blockedFullPct: number | null = null;
        if (res && res.positional) unpricedReason = "positional";
        else if (pct && pct.pctMin >= 100) unpricedReason = "immunity";
        else if (res && pct && pct.pctMin > 0) {
          const b = pct.pctMin / 100;
          pricing = "pct";
          blockedOverlapPct = Math.round(
            ((dmgBetween(fromMs, toMs) * b) / (1 - b) / maxHp) * 100,
          );
          blockedFullPct = Math.round(
            ((dmgBetween(fromMs, bEndMs) * b) / (1 - b) / maxHp) * 100,
          );
        } else if (absorbed > 0) {
          pricing = "absorb";
          blockedOverlapPct = Math.round((absorbed / maxHp) * 100);
        } else if (!res) unpricedReason = "off-table";
        else unpricedReason = "positional";
        out.push({
          targetId: target.id,
          targetName: target.name,
          targetIsOwner: target.id === owner.id,
          first: {
            spellId: first.spellId,
            spellName: nameOf(first.spellId),
            casterName: first.srcUnitName,
            casterIsOwner: first.srcUnitName === owner.name,
          },
          second: {
            spellId: second.spellId,
            spellName: nameOf(second.spellId),
            casterName: second.srcUnitName,
            casterIsOwner: second.srcUnitName === owner.name,
          },
          overlapFromSec: Math.floor(oFrom),
          overlapToSec: Math.floor(oTo),
          overlapSeconds: Math.round((oTo - oFrom) * 10) / 10,
          pricing,
          unpricedReason,
          blockedOverlapPct,
          blockedFullPct,
          secondRunSeconds: Math.round(second.toS - second.fromS),
        });
      }
    }
  }
  return out.sort((a, b) => a.overlapFromSec - b.overlapFromSec);
}
