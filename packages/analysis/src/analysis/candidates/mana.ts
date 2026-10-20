/**
 * Resource (mana) candidate producers — `mana-pressure` and `mana-efficiency`.
 *
 * Split out of `candidateFindings.ts` on 2026-08-16 (mechanical split by
 * theme); logic moved verbatim. Both types are gated off by
 * `CANDIDATE_TYPE_FLAGS` and are the successors' raw material (BACKLOG #33),
 * so keeping them in one file is also what makes them cheap to decommission
 * from the menu/legend/calibration paths without deleting the extraction.
 */
import { SPELL_MANA_COST_TABLE } from "../../data/spellManaCost";
import {
  type CastFailedEvent,
  castFailedInWindow,
  manaAt,
  manaPct,
  oomWindows,
  type RawStreams,
} from "../../utils/rawStreams";
import { toRenderSecond } from "../../utils/renderGrid";
import { fmtFactNum as fmt } from "../factFormat";
import { CandidateEvent } from "../types";
import { aggregateReasonCounts } from "./shared";

/** mana-pressure (BACKLOG #26 Task 3, 2026-08-15, feature-flagged off by
 * default): the friendly healer's mana% floor a contiguous run of
 * `oomWindows` samples must stay below to count as an OOM window at all —
 * the same predicate/shape `CD_HOARD_CRISIS_HP_PCT` etc. use, just against
 * `manaAt`'s manaMax-relative percent instead of HP%. <标定定稿
 * 2026-08-15,报告 raw-streams-calibration.md>: loosened 10%→15% — full-corpus
 * (n=1028 matches/3434 rounds) sweep found mana-pressure structurally rare
 * even at the loosest grid corner tested (LOW_PCT∈{5,10,15}); 15% is that
 * loosest corner and is the corpus-supported ceiling, not an arbitrary push
 * past the tested grid. Tightening-vs-loosening: LOOSENED (more permissive)
 * — trades a small amount of "how low is low" specificity for occurrence,
 * with no corpus evidence it hurt precision (the 60ab1e8f anchor's own
 * bottom, 0.2%, is unaffected either way). */
export const MANA_PRESSURE_LOW_PCT = 15; // <标定定稿 2026-08-15,报告 raw-streams-calibration.md>

/** mana-pressure: minimum window duration (render-grid seconds, post
 * tail-extension — see `extendOomTailWithFailedCasts` below) for a low-mana
 * run to be worth surfacing as a resource crisis rather than a brief dip
 * that self-resolved. <标定定稿 2026-08-15,报告 raw-streams-calibration.md>:
 * loosened 8s→5s, same "loosest tested grid corner, still below the 0.5-2/
 * round target band" finding as `MANA_PRESSURE_LOW_PCT` above (grid:
 * MIN_WINDOW_S∈{5,8,12}). Tightening-vs-loosening: LOOSENED. */
export const MANA_PRESSURE_MIN_WINDOW_S = 5; // <标定定稿 2026-08-15,报告 raw-streams-calibration.md>

/** mana-pressure: minimum rejected-cast count inside the (tail-extended)
 * window for the crisis to have actually cost the healer real casts, not
 * just idled at low mana without ever being blocked. <标定定稿
 * 2026-08-15,报告 raw-streams-calibration.md>: KEPT at the placeholder value
 * — swept {2,3,5} at the chosen LOW_PCT/MIN_WINDOW_S center on both a 200-
 * match subsample and (spot-checked) the full corpus and found it NON-
 * BINDING (identical mean occurrence at all three tiers): once a window
 * clears the length/depth gates above, it already has well over 5 rejected
 * casts in every observed instance, so this constant currently costs nothing
 * in occurrence. Left at 3 (a defensible "not just one unlucky cast" floor)
 * rather than raised — the corpus doesn't distinguish 2 vs 3 vs 5 either
 * way, so there is no data-driven reason to move it. Tightening-vs-loosening:
 * NEITHER (unchanged; would-be tightening has zero measured cost). See the
 * report's reason-mix finding below on what this gate actually counts. */
export const MANA_PRESSURE_MIN_FAILED = 3; // <标定定稿 2026-08-15,报告 raw-streams-calibration.md>

/** mana-pressure: max gap (seconds) between consecutive trailing
 * still-low-mana `CastFailedEvent`s that `extendOomTailWithFailedCasts` will
 * bridge when extending a window's `toS` past the last below-threshold mana
 * SAMPLE. Not one of the plan's three named grid constants (out of this
 * task's swept grid scope) — sanity-checked qualitatively instead via the
 * 60ab1e8f anchor (bridged window duration grew from 22s→32s under the new
 * LOW_PCT/MIN_WINDOW_S above, a proportionate extension, not a runaway one).
 * <标定定稿 2026-08-15,报告 raw-streams-calibration.md>: KEPT at the
 * placeholder value — not swept, no corpus evidence either way.
 * Tightening-vs-loosening: NEITHER (unchanged, unswept). */
export const MANA_PRESSURE_TAIL_MAX_GAP_S = 10; // <标定定稿 2026-08-15,报告 raw-streams-calibration.md>

/** Per-healer cap for mana-pressure. <标定定稿 2026-08-15,报告
 * raw-streams-calibration.md>: KEPT at 2 (this task's brief's own
 * instruction — "per-owner cap 2") — occurrence is structurally below the
 * cap almost everywhere (场均 0.257/round at final constants), so the cap
 * essentially never binds; not swept. Tightening-vs-loosening: NEITHER. */
const MANA_PRESSURE_CAP = 2; // <标定定稿 2026-08-15,报告 raw-streams-calibration.md>

/**
 * REVIEW PRESCRIPTION (Task 1 review round 0, binding — task-3-brief.md item
 * 2 / progress.md), fixed round 1 (Task 3 review, Important finding —
 * locale-string ruling): `oomWindows`' `toS` truncates at the last
 * BELOW-threshold mana SAMPLE, but samples come only from successful casts
 * (`SPELL_CAST_SUCCESS`'s advanced block) — during severe/terminal OOM those
 * go sparse while `SPELL_CAST_FAILED` keeps firing, so the sample-based
 * `toS` systematically undershoots the true end of the OOM period. Verified
 * on 60ab1e8f: `oomWindows` gives `toS=504.806` but death (the true end of
 * the crisis) is at `508.687` — a ~3.9s tail the sample-based window misses
 * entirely.
 *
 * This walks the window's own trailing `CastFailedEvent` timestamps forward
 * from `sampleToS`, extending `toS` to the last one reachable through a
 * chain of gaps each <= `MANA_PRESSURE_TAIL_MAX_GAP_S` — the same "keep the
 * window open while there is still *something* happening, close it on real
 * silence" shape `oomWindows` itself already uses for its own mana-sample
 * stream (see that function's doc comment), just applied to the failure
 * stream instead. Never shrinks `toS` — a unit with no qualifying trailing
 * failures returns `sampleToS` unchanged, byte-identical to not having this
 * extension at all.
 *
 * **Locale-independent gate (round 1 fix).** The original implementation
 * only bridged `CastFailedEvent`s whose `reason` field string-matched the
 * literal Chinese text `"法力值不足"` — `reason` is WoW's client-localized
 * combat-log text (rawStreams.ts's own module comment), so that check
 * silently never matched on any non-Chinese-client log (an English client
 * emits a different string entirely), making the whole tail-extension a
 * silent no-op for those logs with no signal that it had degraded. Fixed by
 * dropping reason-text matching entirely: a trailing `CastFailedEvent`
 * bridges the window (regardless of its `reason`) iff `manaAt(s, unitGuid,
 * c.tSeconds)` — the SAME single-source mana-lookup predicate `oomWindows`
 * itself is built on — shows the healer's mana still below `lowPct`% at
 * that failure's own instant. `manaAt` is nearest-sample-<=t, so across the
 * sparse-sample stretch this function exists to bridge it naturally holds
 * the last known (low) reading — exactly the "was the crisis still ongoing
 * when this cast was rejected" semantics wanted here, with no separate
 * hold-last-value logic needed. No sample yet at/before a failure (`manaAt`
 * returns `null`) cannot confirm the crisis was still active, so it does NOT
 * bridge (conservative: never extends on missing data). A failure whose
 * mana had already recovered above `lowPct`% (e.g. a Line-of-Sight
 * rejection moments after mana topped back up) also does not bridge — and
 * per this same reasoning, if the crisis had truly recovered, `oomWindows`
 * itself would already have closed the window at that recovery's own
 * SAMPLE (see that function's contiguous-run rule), so a genuinely-recovered
 * instant reachable from this walk can only arise from a stale hold-over —
 * i.e. this check is a correctness backstop for an edge shape, not a
 * load-bearing gate on the common path.
 *
 * Deliberately does NOT reach for `_HEAL`/`_DAMAGE` advanced-block sample
 * densification (flagged as an option in the Task 1 review, explicitly ruled
 * out of scope for this task by the review's own OOM-sparsity ruling) —
 * `castFailedInWindow`'s existing timestamps are already sufficient signal
 * for this window-boundary purpose without adding a second sample source.
 */
function extendOomTailWithFailedCasts(
  s: RawStreams,
  unitGuid: string,
  sampleToS: number,
  tailGapS: number,
  lowPct: number,
): number {
  const trailing = s.castFailed
    .filter((c) => c.unitGuid === unitGuid && c.tSeconds > sampleToS)
    .sort((a, b) => a.tSeconds - b.tSeconds);
  let extendedToS = sampleToS;
  for (const c of trailing) {
    if (c.tSeconds - extendedToS > tailGapS) break;
    const mana = manaAt(s, unitGuid, c.tSeconds);
    if (mana === null) break; // no sample yet — cannot confirm still-low, no bridge
    const pct = manaPct(mana); // shared with oomWindows itself (rawStreams.ts)
    if (pct >= lowPct) break; // mana no longer below threshold — crisis ended, stop bridging
    extendedToS = c.tSeconds;
  }
  return extendedToS;
}

/**
 * mana-pressure (BACKLOG #26 Task 3, 2026-08-15, deep-dive-derived
 * definition, feature-flagged OFF by default): the FRIENDLY healer's own
 * team, not owner-scoped — a healer OOM window is the player's team's
 * resource crisis regardless of whose perspective the report is written
 * from, same "team-play" scope `missedCleanseEvents`/`missedPurgeEvents`
 * above use. Fires when `oomWindows` (tail-extended per
 * `extendOomTailWithFailedCasts` above, THEN render-grid floored) finds a
 * below-`MANA_PRESSURE_LOW_PCT`% run at least `MANA_PRESSURE_MIN_WINDOW_S`
 * seconds long, AND at least `MANA_PRESSURE_MIN_FAILED` of the healer's own
 * casts were rejected somewhere inside that same window — the OOM sample
 * alone is not enough; the crisis has to have actually cost real, blocked
 * cast attempts (60ab1e8f anchor shape: healer mana bottoms at 545/273000,
 * Holy Shock rejected 15× on "法力值不足" in the final ~10s before death).
 *
 * Render-grid anchoring (CLAUDE.md): `oomWindows`' raw fractional
 * `fromS`/(tail-extended)`toS` are floored via `toRenderSecond` FIRST;
 * `durationS` and every window-bounded query below (the rejected-cast scan,
 * the threat-contact sample) all run on those SAME floored endpoints — never
 * on the raw fractional window — so the window shown in facts can never
 * disagree with what gated or populated it.
 *
 * Facts are state-what-happened only (CLAUDE.md fact/suggestion split): the
 * OOM window's start/end/duration, the lowest mana reading in the window
 * (`facts.mana`, e.g. "545/273000"), the rejected-cast count aggregated by
 * reason (`facts.rejectedCount`/`facts.rejected` — reuses
 * `aggregateReasonCounts`, the exact aggregation convention Task 2's
 * `formatAttemptedFact` established, not a second copy of it), and whether
 * there was active enemy threat/contact anywhere in the window
 * (`facts.threat`, sampled every rendered second via the injected
 * `threatActiveAt` probe — `threatAssessment.ts`'s single-source predicate,
 * not re-derived here). This candidate carries no severity judgment either
 * way about the threat context — it is context for the prompt to reason
 * with, not a second gate (a healer can go OOM from pure attrition with no
 * single "threat" instant, and that is still a real resource crisis worth
 * surfacing).
 *
 * Severity/cap: sorted by rejected-cast count descending (the more casts the
 * crisis actually blocked, the bigger the miss), capped at
 * `MANA_PRESSURE_CAP` per healer.
 */
export function manaPressureEvents(
  rawStreams: RawStreams | undefined,
  healer: { id: string; name: string },
  probes: {
    /** Wired to threatAssessment.ts's threatActiveAt in production. */
    threatActiveAt: (tSeconds: number) => boolean;
  },
  // Calibration-only override (Task 6, packages/eval/src/explore/
  // candidateCalibration.ts): every field defaults to its module constant, so
  // every production call site (which passes no 4th arg) is byte-identical to
  // before this was added — same rationale as cdHoardedEvents'/
  // cdSpentIdleEvents' own override params.
  overrides?: {
    lowPct?: number;
    minWindowS?: number;
    minFailed?: number;
    tailGapS?: number;
    cap?: number;
  },
): CandidateEvent[] {
  // Global Constraint: raw absence degrades silently, never throws. `oomWindows`
  // itself already returns [] for `available:false`, but `rawStreams` being
  // fully `undefined` (the caller has no raw.txt at all) would crash accessing
  // `.available` inside it — guarded here before any rawStreams field access.
  if (!rawStreams) return [];
  const lowPct = overrides?.lowPct ?? MANA_PRESSURE_LOW_PCT;
  const minWindowS = overrides?.minWindowS ?? MANA_PRESSURE_MIN_WINDOW_S;
  const minFailed = overrides?.minFailed ?? MANA_PRESSURE_MIN_FAILED;
  const tailGapS = overrides?.tailGapS ?? MANA_PRESSURE_TAIL_MAX_GAP_S;
  const cap = overrides?.cap ?? MANA_PRESSURE_CAP;

  const windows = oomWindows(rawStreams, healer.id, lowPct);
  const candidates: Array<{
    fromR: number;
    toR: number;
    durationS: number;
    minMana: number;
    manaMax: number | null;
    rejected: CastFailedEvent[];
    threat: boolean;
  }> = [];
  for (const w of windows) {
    const extendedToS = extendOomTailWithFailedCasts(
      rawStreams,
      healer.id,
      w.toS,
      tailGapS,
      lowPct,
    );
    const fromR = toRenderSecond(w.fromS);
    const toR = toRenderSecond(extendedToS);
    const durationS = toR - fromR;
    if (durationS < minWindowS) continue;
    const rejected = castFailedInWindow(rawStreams, healer.id, fromR, toR);
    if (rejected.length < minFailed) continue;
    let threat = false;
    for (let t = fromR; t <= toR; t++) {
      if (probes.threatActiveAt(t)) {
        threat = true;
        break;
      }
    }
    candidates.push({
      fromR,
      toR,
      durationS,
      minMana: w.minMana,
      manaMax: manaAt(rawStreams, healer.id, fromR)?.manaMax ?? null,
      rejected,
      threat,
    });
  }
  return candidates
    .sort((a, b) => b.rejected.length - a.rejected.length)
    .slice(0, cap)
    .map(({ fromR, toR, durationS, minMana, manaMax, rejected, threat }) => ({
      id: `mana-pressure:${healer.name}:${fromR}`,
      type: "mana-pressure",
      t: fromR,
      unitNames: [healer.name],
      facts: {
        t: String(fromR),
        toT: String(toR),
        durationS: fmt(durationS),
        mana:
          manaMax === null ? fmt(minMana) : `${fmt(minMana)}/${fmt(manaMax)}`,
        rejectedCount: String(rejected.length),
        rejected: aggregateReasonCounts(rejected) ?? "",
        threat: threat ? "yes" : "no",
      },
    }));
}

/** mana-efficiency: ratio (effective-healing share ÷ mana-spent share) below
 * which the match's worst-scoring healing spell counts as inefficient enough
 * to surface. <标定定稿 2026-08-15,报告 raw-streams-calibration.md>: KEPT at
 * the brief's own placeholder (0.5) — swept {0.4,0.5,0.6}×MIN_CASTS on a
 * 200-match subsample; 0.5 already lands the full-corpus (n=1028/3434
 * rounds) 场均条数 in the 0.5-2 target band once `MANA_EFF_MIN_CASTS` (below)
 * is loosened, so no floor change was needed. A spell at exactly the floor
 * (ratio===floor) is NOT flagged (`>=` gate below), matching this file's
 * other floor/threshold conventions (e.g. `MANA_PRESSURE_LOW_PCT`'s `pct <
 * thresholdPct`) of treating the boundary value as "not yet a crisis".
 * Tightening-vs-loosening: NEITHER (unchanged). */
export const MANA_EFF_FLOOR = 0.5; // <标定定稿 2026-08-15,报告 raw-streams-calibration.md>
/** mana-efficiency: minimum successful casts of a spell before its
 * mana/healing ratio is trusted — a spell cast twice can show an arbitrarily
 * bad or good ratio from pure sample noise (an emergency single Flash Heal
 * that gets fully overhealed by a simultaneous ally cast, say). <标定定稿
 * 2026-08-15,报告 raw-streams-calibration.md>: loosened 10→8 — at 10, the
 * FULL-corpus (n=1028/3434 rounds) 场均条数 was 0.476, just under the 0.5-2
 * target band's floor (the 200-match subsample used for the initial grid
 * had suggested 0.5/10 was already in-band at 0.608, which did not hold at
 * full-corpus scale — see the report's explicit note on this discrepancy);
 * at 8 (still inside the swept {8,10,15} grid, not a value invented outside
 * it) the full-corpus mean is 0.588, in-band. Tightening-vs-loosening:
 * LOOSENED — trades a small amount of small-sample-noise protection (a
 * spell cast only 8-9 times has a less-trusted ratio than one cast 10+
 * times) for landing in the target band; no corpus evidence of a precision
 * cost, but this trade is real and worth naming. */
export const MANA_EFF_MIN_CASTS = 8; // <标定定稿 2026-08-15,报告 raw-streams-calibration.md>
/** Fact-table row cap for the per-spell breakdown — a display cap, not a
 * calibrated threshold (unlike the two constants above). */
const MANA_EFF_TABLE_TOP_N = 5;

interface IManaEfficiencySpellAgg {
  spellId: string;
  spellName: string;
  casts: number;
  /** Sum, across this spell's successful casts, of each cast's cost as a %
   * of the healer's max mana (`SPELL_MANA_COST_TABLE`'s `pct` field IS
   * already "% of max mana per cast" — summing it directly across casts
   * needs no `manaMax`/rawStreams lookup at all, see `manaEfficiencyEvents`'
   * own doc comment for why this type does not consume rawStreams). */
  manaPctSpent: number;
  /** Effective healing this spell bought: `healOut.effectiveAmount` (already
   * overheal-subtracted by parser-compat — CLAUDE.md 门规谓词即规范: reused,
   * not recomputed) plus `absorbsOut.absorbedAmount`, resolved back to this
   * spell via `resolveAgg` (exact spellId match first, `idByName` fallback
   * for the cast-id/heal-tick-id drift documented on `manaEfficiencyEvents`
   * itself), so a shield-heavy kit (e.g. Power Word: Shield) is not
   * misjudged as "0% effective healing" for its own mana spend. */
  effectiveHealing: number;
  /** Earliest render-second this spell was cast at — used as the worst
   * spell's `t` if it becomes the finding's anchor. */
  firstT: number;
}

/**
 * mana-efficiency (BACKLOG #26 Task 4, 2026-08-15, feature-flagged OFF by
 * default): a per-MATCH aggregate (not per-window like mana-pressure above)
 * — for every healing spell the healer successfully cast at least
 * `MANA_EFF_MIN_CASTS` times, compares that spell's SHARE of the healer's
 * total mana spend against its SHARE of the healer's total effective
 * healing. A spell whose healing-share is less than `MANA_EFF_FLOOR` times
 * its mana-share (e.g. the brief's own worked example: 29% of mana spent
 * buying only 11% of effective healing, ratio 0.379 < 0.5) is a real
 * resource-operations problem — the healer is systematically over-relying on
 * a spell that converts mana into healing worse than their kit as a whole
 * does. At most ONE candidate per match per healer (the worst-ratio spell
 * only) — this is a single aggregate verdict about the healer's spell
 * choices, not a per-cast or per-window event, so there is nothing to cap
 * beyond "one".
 *
 * **Deliberately does NOT consume `rawStreams`** (unlike mana-pressure
 * above): `SPELL_MANA_COST_TABLE`'s `pct` field is already "% of max mana
 * per cast", so summing it across a spell's casts directly gives that
 * spell's share of total mana spend — no absolute `manaMax` value, and
 * therefore no raw.txt mana-sample stream, is ever needed. This also means
 * the degradation shape for this type is NOT "raw unavailable → 0" (there is
 * no raw dependency to degrade); it is "a cast's spellId has no resolvable
 * entry in `SPELL_MANA_COST_TABLE` (unknown spell, or a spec-conditional
 * spell cast by a spec the generated table has no row for) → that cast
 * contributes to neither mana-share nor healing-share, silently, same as any
 * other missing-data skip in this file — never throws, never guesses a
 * cost" (see the generator's own module header for why guessing would be
 * worse than skipping).
 *
 * Facts are state-what-happened only (CLAUDE.md fact/suggestion split): the
 * worst spell's name/mana-share/healing-share/cast-count
 * (`facts.worstSpell`/`worstManaPct`/`worstHealPct`/`worstCasts`), its ratio
 * (`facts.worstRatio`), and a per-spell breakdown table
 * (`facts.table`, top `MANA_EFF_TABLE_TOP_N` spells by mana-share
 * descending) so the prompt can see the worst spell in the context of the
 * healer's whole kit rather than an isolated number. No severity judgment
 * about WHY the ratio is low is made here (a legitimate emergency-heal spell
 * used sparingly under pressure can still look inefficient in isolation) —
 * that reasoning is left to the prompt.
 */
export function manaEfficiencyEvents(
  healer: { id: string; name: string; spec: string },
  healerUnit: {
    spellCastEvents: Array<{
      spellId?: string;
      spellName?: string;
      logLine: { event: string; timestamp: number };
    }>;
    healOut: Array<{
      spellId?: string;
      spellName?: string;
      effectiveAmount: number;
    }>;
    absorbsOut: Array<{
      spellId?: string;
      spellName?: string;
      absorbedAmount: number;
    }>;
  },
  matchStartMs: number,
  // Calibration-only override (Task 6), same rationale as this file's other
  // builders' override params — every production call site passes no 5th
  // arg, so production is byte-identical to before this was added.
  overrides?: { floor?: number; minCasts?: number },
): CandidateEvent[] {
  const floor = overrides?.floor ?? MANA_EFF_FLOOR;
  const minCasts = overrides?.minCasts ?? MANA_EFF_MIN_CASTS;

  const bySpell = new Map<string, IManaEfficiencySpellAgg>();
  // Cast-id → heal-tick-id drift (found via this builder's OWN Task 4
  // real-match sanity check, match 60ab1e8f): a spell's SPELL_CAST_SUCCESS
  // and the SPELL_HEAL/SPELL_ABSORBED events it produces do not always share
  // one spellId — Holy Shock casts as `20473` but its heal ticks log under
  // `25914` (195 heal events / 4,002,189 effective healing in that one
  // match, ALL of it silently dropped before this fix); Prayer of Mending
  // casts as `33076` but heals as `33110`. Both pairs share the EXACT same
  // `spellName` on both the cast and the heal event (verified against real
  // data, not assumed) — `idByName` below lets `healOut`/`absorbsOut`
  // resolve to the correct aggregate by name when the id doesn't match
  // directly. Within one player's own cast list a name collision across two
  // DIFFERENT abilities is not a realistic risk (a modern-retail character
  // has exactly one castable ability per display name in their own kit), so
  // first-seen-wins is an acceptable, simple resolution — see
  // task-4-report.md for the full before/after numbers this fix produced.
  const idByName = new Map<string, string>();
  for (const e of healerUnit.spellCastEvents) {
    if (e.logLine.event !== "SPELL_CAST_SUCCESS") continue;
    const spellId = e.spellId;
    if (!spellId) continue;
    const row = SPELL_MANA_COST_TABLE[spellId];
    const raw =
      row?.bySpec?.[healer.spec] ??
      (row && row.pct !== undefined ? row : undefined);
    // Unknown spell, a flat-cost row (no healing-relevant spell in the
    // generated table uses `flat` — see genSpellManaCost.ts's module header;
    // `pct === undefined` here in practice only reaches a `bySpec`-only
    // entry whose spec didn't match), or a spec-conditional spell with no
    // row for this healer's own spec — skipped, never guessed.
    if (!raw || raw.pct === undefined) continue;
    const t = toRenderSecond((e.logLine.timestamp - matchStartMs) / 1000);
    const agg = bySpell.get(spellId) ?? {
      spellId,
      spellName: e.spellName ?? spellId,
      casts: 0,
      manaPctSpent: 0,
      effectiveHealing: 0,
      firstT: t,
    };
    agg.casts += 1;
    agg.manaPctSpent += raw.pct;
    agg.firstT = Math.min(agg.firstT, t);
    bySpell.set(spellId, agg);
    if (e.spellName && !idByName.has(e.spellName)) {
      idByName.set(e.spellName, spellId);
    }
  }
  if (bySpell.size === 0) return [];

  const resolveAgg = (
    spellId: string | undefined,
    spellName: string | undefined,
  ): IManaEfficiencySpellAgg | undefined => {
    if (spellId) {
      const byId = bySpell.get(spellId);
      if (byId) return byId;
    }
    if (spellName) {
      const canonicalId = idByName.get(spellName);
      if (canonicalId) return bySpell.get(canonicalId);
    }
    return undefined;
  };

  const healingCapable = new Set<string>();
  for (const h of healerUnit.healOut) {
    const agg = resolveAgg(h.spellId, h.spellName);
    if (agg) {
      agg.effectiveHealing += Math.abs(h.effectiveAmount);
      healingCapable.add(agg.spellId);
    }
  }
  for (const a of healerUnit.absorbsOut) {
    const agg = resolveAgg(a.spellId, a.spellName);
    if (agg) {
      agg.effectiveHealing += Math.abs(a.absorbedAmount);
      healingCapable.add(agg.spellId);
    }
  }
  // Scope to healing-capable spells only (real-match sanity finding, match
  // 60ab1e8f, task-4-report.md): a spell that never once produced a
  // healOut/absorbsOut event for this unit — PRESENCE, not amount, is the
  // signal — is not a healing spell at all, just something that happens to
  // cost mana (a dispel like Purify, a filler like Judgment). The brief's
  // own scope ("healing-SPELL mana spent") excludes these; without this
  // filter, both this builder's own real-match anchors (60ab1e8f) picked a
  // non-healing utility spell as "worst" ahead of any actual healing spell,
  // which is not an actionable mana-efficiency finding. A genuinely healing
  // spell that gets 100%-overhealed on EVERY cast still emits healOut events
  // (effectiveAmount=0 each) and stays eligible — that "spammed a heal that
  // never lands" shape is this candidate type's headline case, not something
  // this filter should catch.
  for (const spellId of [...bySpell.keys()]) {
    if (!healingCapable.has(spellId)) bySpell.delete(spellId);
  }
  if (bySpell.size === 0) return [];

  const totalManaPct = [...bySpell.values()].reduce(
    (s, a) => s + a.manaPctSpent,
    0,
  );
  const totalEffectiveHealing = [...bySpell.values()].reduce(
    (s, a) => s + a.effectiveHealing,
    0,
  );
  // No mana spent (shouldn't happen — bySpell is non-empty only via costed
  // casts) or no effective healing at all (a healer who cast healing spells
  // that ALL fully overhealed/were absorbed-away — a real but degenerate
  // case with no meaningful per-spell ratio to compare) — nothing to score.
  if (totalManaPct <= 0 || totalEffectiveHealing <= 0) return [];

  const scored = [...bySpell.values()].map((agg) => {
    const manaShare = agg.manaPctSpent / totalManaPct;
    const healShare = agg.effectiveHealing / totalEffectiveHealing;
    // manaShare > 0 always holds here: every bySpell entry accumulated at
    // least one cast with raw.pct > 0 (costEntry in the generator only ever
    // sets `pct` when it is > 0), so no divide-by-zero guard is needed.
    return { agg, manaShare, healShare, ratio: healShare / manaShare };
  });

  const eligible = scored.filter((s) => s.agg.casts >= minCasts);
  if (eligible.length === 0) return [];
  const worst = eligible.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  if (worst.ratio >= floor) return [];

  const tableRows = [...scored]
    .sort((a, b) => b.manaShare - a.manaShare)
    .slice(0, MANA_EFF_TABLE_TOP_N);

  const t = worst.agg.firstT;
  return [
    {
      id: `mana-efficiency:${healer.name}:${t}`,
      type: "mana-efficiency",
      t,
      unitNames: [healer.name],
      spell: worst.agg.spellName,
      spellId: worst.agg.spellId,
      facts: {
        t: String(t),
        worstSpell: worst.agg.spellName,
        worstManaPct: fmt(worst.manaShare * 100),
        worstHealPct: fmt(worst.healShare * 100),
        worstCasts: String(worst.agg.casts),
        worstRatio: fmt(worst.ratio),
        table: tableRows
          .map(
            (r) =>
              `${r.agg.spellName} 蓝耗${fmt(r.manaShare * 100)}%/有效治疗${fmt(r.healShare * 100)}%(${r.agg.casts}次)`,
          )
          .join("; "),
      },
    },
  ];
}