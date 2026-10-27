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
 *  - deferral shield (`DEFERRAL_SHIELD_DAMAGE_IDS`: Time Dilation, Stretch
 *    Time): what the log records it held back (its own SPELL_ABSORBED rows,
 *    `isDeferralAbsorb`) — the 50 % the mitigation table prices Time
 *    Dilation at (user rulings 2026-07-30, kept 2026-10-20), measured
 *    instead of back-computed from damage that includes its own delayed
 *    ticks (fact1215 retest idx 10: `~20%` read the 361029 ticks as damage
 *    Time Dilation then "blocked");
 *  - absorb aura: the absorbs the log credits to B's spell AND B's caster
 *    (codex R2: dropping the caster credited another player's same-spell
 *    shield to B);
 *  - immunity, positional or off-table: unpriced, said so on the card.
 * Only pairs the OWNER took part in (cast A or B, or is the target) are
 * returned — the card is owner-anchored like every other context line.
 */
import { castKeyOfAura } from "../data/castEffectAuras";
import {
  resolveMitigation,
  strongestComponentPct,
} from "../data/mitigationComponents";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdLists from "../data/spellIdLists";
import { buildAuraIntervals, type IAuraInterval } from "../utils/auraIntervals";
import { isCasterSideLinkAura } from "../utils/brokenRowBreaker";
import { isDeferralAbsorb } from "../utils/incomingPressure";
import { roundEndMs } from "../utils/roundEnd";

/** external ∪ big-personal defensives — the two lists the product already
 * treats as "major"; small cooldowns (Fade, PW:S) are on neither */
export const STACKED_DEFENSIVE_MAJOR_IDS: ReadonlySet<string> = new Set<string>(
  [
    ...spellIdLists.externalDefensiveSpellIds.map(String),
    ...spellIdLists.bigDefensiveSpellIds.map(String),
  ],
);
/** The `STACKED_DEFENSIVE_MAJOR_IDS` key an aura stands for: its own id, or
 * the cast whose own effect it is (fact2 C10, `castKeyOfAura`: Rallying Cry
 * 97462 runs as 97463, Fortifying Brew 115203 as 120954, Spirit Link Totem
 * 98008 as 325174, Greater Invisibility 110959 as 110960 — none was ever
 * "already protected"). Pricing reads the key; the line names the aura. */
export function stackedDefensiveKeyOf(auraSpellId: string): string | undefined {
  return castKeyOfAura(auraSpellId, (id) => STACKED_DEFENSIVE_MAJOR_IDS.has(id));
}
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
  pricing: "pct" | "absorb" | "deferred" | "unpriced";
  unpricedReason: "immunity" | "positional" | "off-table" | null;
  /** B's extra blocked damage during the overlap, integer % of target max HP */
  blockedOverlapPct: number | null;
  /** B's blocked damage over its full run (from the overlap start to B's
   * end), integer % — only for percentage auras and deferral shields */
  blockedFullPct: number | null;
  /** B's full run length in whole seconds */
  secondRunSeconds: number;
}

/**
 * The protection-evidence record (reliability audit A2, 2026-09-24): every
 * MAJOR defensive (`STACKED_DEFENSIVE_MAJOR_IDS`) a friendly put on `target`,
 * as observed aura intervals — who cast it, when it was up. One source for
 * both consumers: the `[STACKED DEFENSIVES]` fact line below and cd-hoarded's
 * "already protected at the crossing → abstain" (user ruling 2026-09-19
 * "该不该救 = 伤情 × 已有保护一起看"). It states protection, never that the
 * protection was ENOUGH (the 2026-09-16 withdrawal).
 */
export function majorWallIntervals(
  target: any,
  combat: any,
  playersById: ReadonlyMap<string, any>,
  friendNames: ReadonlySet<string>,
): IAuraInterval[] {
  // a friendly's summon is the friendly (codex R6C-05 #3: Spirit Link
  // Totem 325174 is sourced by the totem, not the shaman, and fell out): the
  // interval's APPLIED row on the target names the source GUID, its owner
  // decides — and is the caster every reader names (F19 605 diff: the line
  // read "Spirit Link Totem (from Spirit Link Totem)")
  const units = (combat?.units ?? {}) as Record<string, any>;
  const friendlyCasterOf = (iv: IAuraInterval): string | null => {
    if (friendNames.has(iv.srcUnitName)) return iv.srcUnitName;
    const at = (combat?.startTime ?? 0) + iv.fromS * 1000;
    const row = (target.auraEvents ?? []).find(
      (a: any) =>
        a.spellId === iv.spellId &&
        a.logLine?.event === "SPELL_AURA_APPLIED" &&
        Math.abs(a.timestamp - at) <= 5,
    );
    const owner = row?.srcUnitId ? units[row.srcUnitId]?.ownerId : undefined;
    const ownerName: string | undefined = owner
      ? units[owner]?.name
      : undefined;
    return ownerName && friendNames.has(ownerName) ? ownerName : null;
  };
  return buildAuraIntervals(target, combat, playersById)
    .flatMap((iv) => {
      const caster = friendlyCasterOf(iv);
      return caster === null ? [] : [{ ...iv, srcUnitName: caster }];
    })
    .filter(
      (iv) =>
        stackedDefensiveKeyOf(iv.spellId) !== undefined &&
        // a Blessing of Sacrifice's link on its own caster moves damage ONTO
        // them — no protection (fact1215 C4, `isCasterSideLinkAura`)
        !isCasterSideLinkAura(iv.spellId, iv.srcUnitName === target.name),
    )
    .sort((x, y) => x.fromS - y.fromS);
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
  // the round's end (`roundEndMs`): an aura still up at a Solo Shuffle
  // round's deciding death is cut there, and the hits after it are not the
  // round's (codex 62-POSTHOC-13a #1, 402b1816 r3: Scales + Pain
  // Suppression "0:16–0:20 (4s)" and 36 % blocked counted post-death hits;
  // the round ended at 18.3 s)
  const roundEndS = (roundEndMs(combat) - combat.startTime) / 1000;
  const inRound = (iv: IAuraInterval): IAuraInterval => ({
    ...iv,
    toS: Math.min(iv.toS, roundEndS),
  });
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
      ivs = majorWallIntervals(target, combat, byId, friendNames)
        .filter((iv) => iv.fromS < roundEndS)
        .map(inRound);
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
        const res = resolveMitigation(stackedDefensiveKeyOf(second.spellId)!, {
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
        const absorbedBetween = (a: number, b: number) =>
          ((target.absorbsIn ?? []) as any[])
            .filter(
              (e) =>
                e.timestamp >= a &&
                e.timestamp <= b &&
                String(e.spellId) === second.spellId &&
                (e.srcUnitName === second.srcUnitName ||
                  e.srcUnitId === caster2?.id),
            )
            .reduce((n, e) => n + (e.absorbedAmount ?? 0), 0);
        const absorbed = absorbedBetween(fromMs, toMs);
        let pricing: StackedDefensivePair["pricing"] = "unpriced";
        let unpricedReason: StackedDefensivePair["unpricedReason"] = null;
        let blockedOverlapPct: number | null = null;
        let blockedFullPct: number | null = null;
        if (isDeferralAbsorb({ spellId: second.spellId })) {
          pricing = "deferred";
          blockedOverlapPct = Math.round((absorbed / maxHp) * 100);
          blockedFullPct = Math.round(
            (absorbedBetween(fromMs, bEndMs) / maxHp) * 100,
          );
        } else if (res && res.positional) unpricedReason = "positional";
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
