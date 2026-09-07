/**
 * md-cyclone-window (GH #25 MD 特例, user-ruled 2026-08-21): a Mass Dispel
 * window worth considering — an enemy cyclone CHAIN locked friendlies while
 * the priest owner's MD sat ready and the strategic reasons to hold it were
 * demonstrably absent.
 *
 * Domain red line (user ruling 2026-08-20, verbatim constraint): MD is a
 * STRATEGIC ability — long CD, and the only removal for Ice Block / Divine
 * Shield. Holding it while the enemy's key abilities are unspent is often
 * CORRECT. Therefore this candidate defaults to silence and fires only when
 * all FOUR gates hold (user signed the four-gate criterion and the 15s grace
 * number on GH #25, 2026-08-21):
 *
 *  1. CHAIN gate — ≥2 enemy cyclone landings on friendlies inside one chain,
 *     where "one chain" is the DR-reset walk (`drResetMsAt`-derived gap, the
 *     exact grouping `extractKillAttempts` uses for stun chains — zero new
 *     numbers). Corpus grounding: all 4 real MD-on-cyclone uses in the S2
 *     corpus (161 matches) were chain breaks, none were single-hit saves.
 *  2. PRESSURE gate — an enemy kill attempt overlaps the chain window, OR a
 *     friendly dipped below `CD_HOARD_CRISIS_HP_PCT` inside it (shared crisis
 *     predicate — user ruled alignment over a new constant).
 *  3. STRATEGIC-RESERVE gate (the red line made executable) — the enemy comp
 *     has no mage and no paladin, OR every Ice Block / Divine Shield the comp
 *     carries was already spent before the window and stays on cooldown past
 *     its end (official charge/cooldown seconds). An unspent one anywhere →
 *     silent: holding MD for it is presumed correct.
 *  4. AVAILABLE gate — the owner is a priest whose MD was ready at the window
 *     start (no MD cast in the preceding official CD — talent-shortened CDs
 *     only make this MORE conservative, i.e. under-report, never accuse), was
 *     NOT cast during the window or within `MD_FOLLOWUP_GRACE_S` after it
 *     (either they did the thing, or they were saving it for an imminent
 *     better use), and the owner was not themselves cycloned at the moment
 *     the chain became a chain (cannot press while cycloned).
 *
 * Wording contract: the legend renders this as "a window worth considering",
 * minor tier, never "should have" — and the type is excluded from the
 * mistakes card (desktop `IGNORED_CANDIDATE_TYPES`), menu-only.
 */
import { CombatUnitClass } from "@gladlog/parser-compat";

import {
  ccFullDurationSeconds,
  spellEffectData,
} from "../../data/spellEffectData";
import { toRenderSecond } from "../../utils/renderGrid";
import { CandidateEvent } from "../types";
import { CD_HOARD_CRISIS_HP_PCT, type ICrisisMoment } from "./cooldownTiming";

export const MD_SPELL_ID = "32375";
export const CYCLONE_SPELL_ID = "33786";
export const ICE_BLOCK_SPELL_ID = "45438";
export const DIVINE_SHIELD_SPELL_ID = "642";

/** User-ruled on GH #25 (2026-08-21) as part of the four-gate sign-off: an MD
 * cast this soon after the window means it was being held for an imminent use,
 * not hoarded — the candidate stays silent. */
export const MD_FOLLOWUP_GRACE_S = 15;

/** One per round: this is a strategic-level nudge on a rare pattern (4 real
 * uses in 161 S2 matches); two in one round would be noise by construction. */
const MD_CYCLONE_CAP = 1;

/** Official seconds, single-sourced from spellEffectGenerated. The `?? n`
 * fallbacks restate the same official values in case a data refresh drops a
 * field — they must never be edited independently of the data. */
const MD_COOLDOWN_S = spellEffectData[MD_SPELL_ID]?.cooldownSeconds ?? 120;
// 2026-09-06: 龙卷风是控制,该走 CC 那条谓词(`ccFullDurationSeconds`,识别
// PvPDurationIndex + 叠加 spellEffectOverrides / CORPUS_DURATION_PATCHES),
// 而不是直读 spellEffectData —— 当前两者对龙卷风同值,接过去是零差改动,
// 但以后 CC 侧的订正会自动到达这里。
const CYCLONE_DURATION_S = ccFullDurationSeconds(CYCLONE_SPELL_ID) ?? 5;
const ICE_BLOCK_CD_S =
  spellEffectData[ICE_BLOCK_SPELL_ID]?.charges?.chargeCooldownSeconds ?? 240;
const DIVINE_SHIELD_CD_S =
  spellEffectData[DIVINE_SHIELD_SPELL_ID]?.cooldownSeconds ?? 300;

/** One enemy cyclone landing on a friendly (interval start from
 * `buildAuraIntervals`, seconds from combat start). */
export interface ICycloneHit {
  atS: number;
  targetName: string;
}

/** One enemy who carries a strategic immunity (mage → Ice Block, paladin →
 * Divine Shield) and when they cast it (seconds; empty = never observed). */
export interface IStrategicHolder {
  unitName: string;
  spellId: typeof ICE_BLOCK_SPELL_ID | typeof DIVINE_SHIELD_SPELL_ID;
  castSeconds: number[];
}

const STRATEGIC_CD_S: Record<string, number> = {
  [ICE_BLOCK_SPELL_ID]: ICE_BLOCK_CD_S,
  [DIVINE_SHIELD_SPELL_ID]: DIVINE_SHIELD_CD_S,
};

/** Gate 3: every strategic immunity in the enemy comp was spent before
 * `fromS` and stays down past `toS`. Vacuously true on an empty list (comp
 * carries none). A holder with zero observed casts fails — they may be
 * holding it, and per the red line holding MD for it is presumed correct. */
function allStrategicsSpent(
  holders: IStrategicHolder[],
  fromS: number,
  toS: number,
): boolean {
  return holders.every((h) => {
    const cd = STRATEGIC_CD_S[h.spellId];
    return h.castSeconds.some((c) => c <= fromS && c + cd > toS);
  });
}

export function mdCycloneWindowEvents(opts: {
  owner: { id: string; name: string; class: CombatUnitClass };
  /** Cyclone landings on friendlies (owner included — see the self-cycloned
   * exclusion in gate 4), any order. */
  cycloneHits: ICycloneHit[];
  /** The owner's own MD cast instants (seconds). */
  ownerMdCastSeconds: number[];
  /** Every strategic-immunity holder in the ENEMY comp (one entry per
   * mage/paladin), with their observed casts. */
  enemyStrategics: IStrategicHolder[];
  /** DR-reset chain gap in seconds — pass `drResetMsAt(combat.startTime) /
   * 1000`, the same era-aware walk `extractKillAttempts` groups stuns with. */
  chainGapS: number;
  probes: {
    /** Wired to `friendlyCrisisMomentInWindow` in production (the shared
     * cd-hoarded crisis predicate). A real gate, not an annotation. */
    crisisMomentAt: (fromS: number, toS: number) => ICrisisMoment | null;
    /** Wired to an overlap lookup over `extractKillAttempts(enemies,
     * friends, combat)` — enemy attempts on the owner's team. Returns a
     * citable label ("kill attempt on X at Ns") or null. */
    enemyAttemptOverlapping: (fromS: number, toS: number) => string | null;
  };
}): CandidateEvent[] {
  const { owner, cycloneHits, ownerMdCastSeconds, enemyStrategics, chainGapS } =
    opts;
  if (owner.class !== CombatUnitClass.Priest) return [];
  if (cycloneHits.length < 2) return [];

  // Gate 1: group hits into DR chains (team-wide — the S2 examples chain
  // across different targets).
  const hits = [...cycloneHits].sort((a, b) => a.atS - b.atS);
  const chains: ICycloneHit[][] = [];
  let current: ICycloneHit[] = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].atS - current[current.length - 1].atS <= chainGapS) {
      current.push(hits[i]);
    } else {
      chains.push(current);
      current = [hits[i]];
    }
  }
  chains.push(current);

  const out: CandidateEvent[] = [];
  for (const chain of chains) {
    if (chain.length < 2) continue;

    // Render-grid anchoring (CLAUDE.md): endpoints floored FIRST; every
    // downstream number derives from the floored values.
    const fromS = toRenderSecond(chain[0].atS);
    const toS = toRenderSecond(
      chain[chain.length - 1].atS + CYCLONE_DURATION_S,
    );
    // The candidate's moment: when the chain became a chain (second landing).
    const tS = toRenderSecond(chain[1].atS);

    // Gate 4: MD ready at window start…
    const mdReady = !ownerMdCastSeconds.some(
      (c) => c > fromS - MD_COOLDOWN_S && c <= fromS,
    );
    if (!mdReady) continue;
    // …not pressed during the window or the follow-up grace…
    const mdUsedNearby = ownerMdCastSeconds.some(
      (c) => c > fromS && c <= toS + MD_FOLLOWUP_GRACE_S,
    );
    if (mdUsedNearby) continue;
    // …and the owner not themselves cycloned at the chain moment…
    const ownerCycloned = chain.some(
      (h) =>
        h.targetName === owner.name &&
        h.atS <= tS &&
        tS < h.atS + CYCLONE_DURATION_S,
    );
    if (ownerCycloned) continue;
    // …and at least one landing is on a TEAMMATE (S2 acceptance scan
    // 2026-08-21 caught this: a chain entirely on the priest themself emitted
    // a candidate, but a cycloned priest cannot press MD to free themself and
    // no dispellable teammate exists — nonsense by construction).
    if (!chain.some((h) => h.targetName !== owner.name)) continue;

    // Gate 3: strategic reserve demonstrably moot.
    if (!allStrategicsSpent(enemyStrategics, fromS, toS)) continue;

    // Gate 2: real pressure inside the window.
    const attempt = opts.probes.enemyAttemptOverlapping(fromS, toS);
    let pressure: string | null = attempt;
    if (!pressure) {
      const crisis = opts.probes.crisisMomentAt(fromS, toS);
      if (crisis && crisis.hpPct < CD_HOARD_CRISIS_HP_PCT) {
        pressure = `ally ${crisis.unitName} at ${Math.round(crisis.hpPct)}% at ${crisis.t}s`;
      }
    }
    if (!pressure) continue;

    const targets = [...new Set(chain.map((h) => h.targetName))];
    out.push({
      id: `md-cyclone-${tS}`,
      type: "md-cyclone-window",
      t: tS,
      unitNames: [owner.name, ...targets.filter((n) => n !== owner.name)],
      spell: "Mass Dispel",
      spellId: MD_SPELL_ID,
      facts: {
        t: String(tS),
        windowFromT: String(fromS),
        windowToT: String(toS),
        cycloneHits: String(chain.length),
        targets: targets.join(", "),
        pressure,
        strategicImmunities:
          enemyStrategics.length === 0
            ? "none in enemy comp"
            : enemyStrategics
                .map((h) => {
                  const name =
                    spellEffectData[h.spellId]?.name ??
                    (h.spellId === ICE_BLOCK_SPELL_ID
                      ? "Ice Block"
                      : "Divine Shield");
                  const last = [...h.castSeconds]
                    .filter((c) => c <= fromS)
                    .pop();
                  return `${h.unitName}'s ${name} spent at ${toRenderSecond(last ?? 0)}s, still down`;
                })
                .join("; "),
      },
    });
  }

  // Cap: keep the strongest chain (most landings, then earliest).
  out.sort(
    (a, b) =>
      Number(b.facts.cycloneHits) - Number(a.facts.cycloneHits) || a.t - b.t,
  );
  return out.slice(0, MD_CYCLONE_CAP);
}
