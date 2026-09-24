/**
 * Skill-gradient validation for coaching signals (the corpus experiment behind
 * `scripts/signalSkillGradientScan.ts`).
 *
 * **The question.** Every calibration this project has run measured occurrence
 * rate, model behaviour, or determinism — never whether an accusation is
 * *correct* (docs/coaching-grounding-audit.md §B). The one correctness proxy
 * used so far is within-round win/loss discrimination, and that axis is
 * circular by construction: a stronger opponent causes both more crowd control
 * landing on you and more losses, so a signal can look discriminating while
 * describing nothing you did wrong (`candidateDiagnostics.ts` says so in its
 * own header).
 *
 * **The design.** Use an external ground truth the round's own events cannot
 * cause: the players' rating, which the PvP log archive records per match. A
 * genuinely teachable mistake should get *rarer per opportunity* as rating
 * rises — 2400 players are, by definition, the ones who make fewer of them. So
 * for each signal type we compute
 *
 *     conversion = rounds that triggered ÷ rounds that had the opportunity
 *
 * inside each rating bucket, and look at the gradient across buckets:
 *   - **negative** (high rating converts less) → consistent with a real mistake
 *   - **flat** → the signal describes normal play, not an error
 *   - **positive** (high rating does it MORE) → we are probably scolding good play
 *
 * This can still only falsify: a negative gradient is consistent with a real
 * mistake but does not prove causation, and rating correlates with everything
 * (comp, spec distribution, dampening). It is nonetheless the first axis in
 * this project that is not derived from the same events the signal fires on.
 *
 * **Stratify by bracket, always.** 2026-08-22, first run: `death-unused-defensive`
 * showed a clean −9.6pp gradient across 23,056 rounds — and +0.1pp inside Rated
 * Solo Shuffle. The bracket mix moves with rating (63% Shuffle below 1600, 91%
 * at 2400+) and the signal fires ~3× more in 2v2/3v3, so the "skill effect" was
 * composition. Simpson's paradox is the default hazard of this corpus, not an
 * edge case: `aggregateGradient` therefore takes a stratum and the report is
 * per-bracket. A pooled number is not reported at all.
 *
 * **Opportunity denominators.** Normalising by *rounds* would reproduce the
 * exact failure the 2026-08-19 lesson names (`opportunity-normalized-
 * discrimination`): higher-rated games throw more CC, so a per-round rate rises
 * with skill even when per-opportunity behaviour improves. Each signal family
 * therefore gets an exposure count drawn from the round's own events; a family
 * with no honest denominator is reported as `rounds` and flagged, never
 * silently normalised by the wrong thing.
 *
 * 2026-08-22 second pass: six of the `rounds` rows got real denominators (the
 * first run's `cd-hoarded` +11.3pp was measured against ROUNDS, i.e. against
 * nothing). What each one is normalised by is in DENOMINATOR_OF below; the
 * three that still have none are documented there rather than guessed at.
 */

/** Rating buckets. Boundaries match the feed's own server-side tiers so a
 * bucket is a population the archive can actually be re-sampled at. */
export const RATING_BUCKETS = [
  { key: "<1600", min: 0, max: 1599 },
  { key: "1600-1999", min: 1600, max: 1999 },
  { key: "2000-2399", min: 2000, max: 2399 },
  { key: "2400+", min: 2400, max: Infinity },
] as const;

export type RatingBucket = (typeof RATING_BUCKETS)[number]["key"];

export function bucketOf(
  rating: number | null | undefined,
): RatingBucket | null {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return null;
  return RATING_BUCKETS.find((b) => rating >= b.min && rating <= b.max)!.key;
}

/**
 * Which exposure count is the honest denominator for each signal family.
 * `rounds` means "no defensible opportunity count exists yet" — those rows are
 * reported but marked, never compared across buckets as if normalised.
 */
export const DENOMINATOR_OF: Record<string, keyof RoundExposure> = {
  "cc-locked": "ccOnOwner",
  "cc-avoidable": "ccOnOwner",
  "wasted-trinket": "ccOnOwner",
  "attempt-into-trinket": "enemyCcOnTeam",
  "missed-cleanse": "cleansableOnTeam",
  // 2026-08-22 second correction: "every enemy buff with a dispelType" averaged
  // ~150 per round — routine HoTs and passives the type never looks at — so the
  // first pass's +7.0pp non-monotone gradient was measured against noise. The
  // denominator now mirrors the analysis predicate exactly (enemy-cast BUFF,
  // getDispelType === "Magic", not PURGE_BLOCKLIST, priority Critical/High).
  "missed-purge": "enemyHighValuePurgeables",
  "death-setup": "friendlyDeaths",
  "external-unused": "friendlyDeaths",
  "death-unused-defensive": "friendlyDeaths",
  "kick-eaten": "ownerHardCasts",
  // 2026-09-01 (GH #60 phase 2, decision-point rewrite): the retired predicate
  // fired on unbounded builder windows filtered by `damageRatio`, for which
  // "a friendly took 20% of a health bar in 2 s" was a rough stand-in. The new
  // one fires on BOUNDED burst windows that are feasible for the pressured
  // friendly AND triaged — which is an exactly countable opportunity, so the
  // denominator is now that count instead of a proxy.
  "slow-defensive-response": "burstWindowOpportunities",
  // 2026-08-30 (GH #34, cd-hoarded decision-point rewrite): the producer
  // itself now scans `crisisDecisionPoints` (owner's own crises + every
  // teammate's), the same predicate `crisis-no-response` already uses — so
  // this row switches from `crisisWindows` (the retired HP-floor-window
  // count) to the same `crisisDecisionPoints` denominator that row already
  // computes (see its own doc comment above: "feasible AND dangerous"
  // points from `crisisDecisionPoints(owner, legacy)`). Not an exact
  // opportunity count for the new predicate — that field is owner-only and
  // `feasible`-gated (cd-hoarded deliberately does NOT require `feasible`,
  // see cooldownTiming.ts's `cdHoardedEvents` doc comment — and it also
  // scans every teammate's crises, not just the owner's) — but it is a
  // strictly closer proxy than `crisisWindows` (which counted HP-only
  // windows the retired predicate no longer uses at all). A denominator
  // that actually matches cd-hoarded's multi-source `dangerous && !inCC`
  // scope is the follow-up (docs/BACKLOG.md #34).
  "cd-hoarded": "crisisDecisionPoints",
  "cd-spent-idle": "ownerMajorCdCasts", // you can only spend idly if you spent
  "cd-waste": "ownerMajorCdsInKit", // waste is per cooldown you own — PER-UNIT, see PER_UNIT_TYPES
  "questionable-external": "ownerExternalCasts", // per external actually cast
  "unsynced-burst": "teamOffensiveCdCasts", // per offensive cooldown the team pressed
  "healing-gap": "crisisWindows", // a gap only matters where healing was needed
  "md-cyclone-window": "enemyCyclones", // per Cyclone the enemy actually cast
  // added 2026-08-29 (SDD crisis-no-response): per feasible AND dangerous
  // crisis decision point — the same predicate the candidate itself gates on
  // (a point in CC, locked out, where the friendly died in-window, or below
  // the dmg2s danger floor is not an opportunity).
  "crisis-no-response": "crisisDecisionPoints",
  // added 2026-08-29 (GH #50 (a), user ruling): the cc-held family gets an
  // opportunity denominator — a friendly ALIGNED BURST window (>=2 friendly
  // offensive CDs overlapping) that opens while the owner has a CC major
  // available. `cc-held-burst` counts the opportunities the owner did NOT
  // convert (no own CC landing within 5 s after the burst opens); it is a
  // scan-side signal, not a candidate type. Round 1 ("kill window" = enemy
  // defenseless) was rejected as a denominator: 92 % of held windows carried
  // one (kill windows cover ~118 s per round).
  "cc-held-burst": "ccBurstOpportunities",
  // Still no honest denominator (kept on `rounds` and flagged, not guessed):
  //   cc-held          — the candidate itself (>=90 s idle); see cc-held-burst
  //   position-mistake — needs LoS/positioning opportunities, not events
  //   death            — a timeline marker, not an accusation; never interpret it
};

/** Per-round exposure counts — plain event tallies, no analysis re-entry. */
export interface RoundExposure {
  rounds: 1;
  ccOnOwner: number;
  enemyCcOnTeam: number;
  cleansableOnTeam: number;
  /** enemy-cast BUFFs that the purge predicate would actually consider:
   * Magic-dispellable, not blocklisted, priority Critical/High */
  enemyHighValuePurgeables: number;
  friendlyDeaths: number;
  ownerHardCasts: number;
  friendlyDamageSpikes: number;
  /** non-overlapping windows where a friendly sat at or below CRISIS_HP_PCT */
  crisisWindows: number;
  ownerMajorCdCasts: number;
  ownerMajorCdsInKit: number;
  ownerExternalCasts: number;
  teamOffensiveCdCasts: number;
  enemyCyclones: number;
  /** feasible AND dangerous crisis decision points (`crisisDecisionPoints(owner, legacy).filter((p) => p.feasible && p.dangerous).length`) — the candidate's own opportunity gate */
  crisisDecisionPoints: number;
  /** friendly aligned burst windows opening while the owner had a CC major
   * available (cc-held-burst's denominator, 2026-08-29) */
  ccBurstOpportunities: number;
  /** bounded enemy burst windows that were feasible for the pressured friendly
   * AND triaged — slow-defensive-response's own opportunity gate
   * (`burstWindowDecisionPoints(legacy).filter(p => p.feasible && p.triaged
   * && p.durationSec >= BURST_WINDOW_MIN_JUDGED_S)`),
   * i.e. every window the candidate could have fired on had the team not
   * answered (2026-09-01, GH #60 phase 2) */
  burstWindowOpportunities: number;
}

/** Single-source (spec 2026-08-29): the crisis threshold and merge gap live
 * with the decision-point predicate in analysis; re-exported so existing
 * importers (signalSkillGradientScan.ts, behaviorPriorScan.ts) keep working. */
export {
  CRISIS_HP_PCT,
  CRISIS_WINDOW_GAP_MS,
} from "@gladlog/analysis/src/analysis/crisisDecisionPoints";

/**
 * Types whose rate is "events ÷ units of exposure", not "rounds that fired ÷
 * rounds exposed". `cd-waste` is the case that forced this: its denominator is
 * the cooldowns you OWN, and a per-round boolean cannot express "2 of my 6
 * cooldowns went unused" — every healer owns cooldowns every round, so the
 * round-level version silently degraded to `rounds` (first pass: +5.2pp against
 * a denominator that was nonzero everywhere, i.e. against nothing).
 * NOTE: numerators are capped per round by the builders' own *_CAP constants,
 * so a per-unit rate is a LOWER bound on intensity; it is comparable across
 * buckets (same cap everywhere) but must not be read as an absolute share.
 */
const PER_UNIT_TYPES: ReadonlySet<string> = new Set(["cd-waste"]);

export interface RoundRecord {
  matchId: string;
  seq: number | null;
  bracket: string;
  startTime: number;
  rating: number | null;
  bucket: RatingBucket | null;
  win: boolean | null;
  ownerSpec: string;
  durationS: number;
  /** signal type → did it fire at least once this round */
  fired: string[];
  /** signal type → how many events fired (capped by each builder's own *_CAP);
   * only consumed for PER_UNIT_TYPES, optional for back-compat with the first
   * pass's records. */
  counts?: Record<string, number>;
  exposure: RoundExposure;
}

interface GradientRow {
  type: string;
  denominator: string;
  /** bucket → { triggered, exposed, rate } */
  byBucket: Record<
    string,
    { triggered: number; exposed: number; rate: number | null }
  >;
  /** rate(top populated bucket) − rate(bottom populated bucket), in points */
  gradientPp: number | null;
  totalTriggered: number;
  totalExposed: number;
}

/** Wilson 95% interval — small buckets are the norm here, so a normal
 * approximation would produce impossible bounds and overstate certainty. */
export function wilson95(k: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

/** Aggregate per-round records into one gradient row per signal type. Callers
 * pass ONE stratum (one bracket) — see the header on Simpson's paradox. */
export function aggregateGradient(records: RoundRecord[]): GradientRow[] {
  const types = new Set<string>();
  for (const r of records) for (const t of r.fired) types.add(t);
  for (const t of Object.keys(DENOMINATOR_OF)) types.add(t);

  const rows: GradientRow[] = [];
  for (const type of [...types].sort()) {
    const denomKey = DENOMINATOR_OF[type] ?? "rounds";
    const byBucket: GradientRow["byBucket"] = {};
    let totalTriggered = 0;
    let totalExposed = 0;
    for (const b of RATING_BUCKETS) {
      let triggered = 0;
      let exposed = 0;
      const perUnit = PER_UNIT_TYPES.has(type);
      for (const r of records) {
        if (r.bucket !== b.key) continue;
        // A round with zero opportunities is not evidence either way: it is
        // excluded from BOTH numerator and denominator (this is the whole
        // point of opportunity normalisation).
        const e = denomKey === "rounds" ? 1 : r.exposure[denomKey];
        if (!e) continue;
        if (perUnit) {
          // events ÷ units of exposure (see PER_UNIT_TYPES)
          exposed += e;
          triggered += r.counts?.[type] ?? (r.fired.includes(type) ? 1 : 0);
        } else {
          exposed++;
          if (r.fired.includes(type)) triggered++;
        }
      }
      byBucket[b.key] = {
        triggered,
        exposed,
        rate: exposed ? triggered / exposed : null,
      };
      totalTriggered += triggered;
      totalExposed += exposed;
    }
    const populated = RATING_BUCKETS.map((b) => byBucket[b.key]!).filter(
      (v) => v.exposed >= MIN_BUCKET_N,
    );
    const gradientPp =
      populated.length >= 2
        ? (populated[populated.length - 1]!.rate! - populated[0]!.rate!) * 100
        : null;
    rows.push({
      type,
      denominator: denomKey,
      byBucket,
      gradientPp,
      totalTriggered,
      totalExposed,
    });
  }
  return rows;
}

/** A bucket below this many exposed rounds is not used as a gradient endpoint. */
export const MIN_BUCKET_N = 100;

/** Per-bracket report. Pooling is deliberately not offered: the pooled number
 * for `death-unused-defensive` was −9.6pp against +0.1pp within Shuffle. */
export function formatStratifiedReport(
  records: RoundRecord[],
  meta: string,
  minStratumRounds = 1000,
): string {
  const byBracket = new Map<string, RoundRecord[]>();
  for (const r of records) {
    if (!r.bucket) continue;
    (
      byBracket.get(r.bracket) ?? byBracket.set(r.bracket, []).get(r.bracket)!
    ).push(r);
  }
  const parts: string[] = [
    "# Signal skill-gradient scan (per bracket)",
    "",
    meta,
    "",
    "Pooled numbers are NOT reported: bracket mix moves with rating, and pooling",
    'turned a flat signal into a −9.6pp "skill effect" on the first run.',
    "",
  ];
  for (const [bracket, rows] of [...byBracket].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    if (rows.length < minStratumRounds) {
      parts.push(
        `## ${bracket} — skipped (${rows.length} rounds < ${minStratumRounds})`,
        "",
      );
      continue;
    }
    parts.push(
      formatGradientReport(
        aggregateGradient(rows),
        `## ${bracket} — ${rows.length} rounds`,
      ),
    );
    parts.push("");
  }
  return parts.join("\n");
}

function formatGradientReport(
  rows: GradientRow[],
  meta: string,
): string {
  const out: string[] = [meta, ""];
  out.push(
    "Reading: negative gradient = higher-rated players make it LESS per opportunity (consistent with a real mistake).",
  );
  out.push(
    "`rounds` denominator = no honest opportunity count yet; not comparable across buckets. Buckets below " +
      MIN_BUCKET_N +
      " exposed rounds are not used as endpoints.",
  );
  out.push("");
  out.push(
    "| signal | denominator | " +
      RATING_BUCKETS.map((b) => b.key).join(" | ") +
      " | gradient pp | n exposed |",
  );
  out.push(
    "|---|---|" + RATING_BUCKETS.map(() => "---:").join("|") + "|---:|---:|",
  );
  for (const r of [...rows].sort(
    (a, b) => (a.gradientPp ?? 0) - (b.gradientPp ?? 0),
  )) {
    const cells = RATING_BUCKETS.map((b) => {
      const v = r.byBucket[b.key]!;
      if (!v.exposed) return "—";
      const ci = wilson95(v.triggered, v.exposed)!;
      return `${(v.rate! * 100).toFixed(1)}% [${(ci[0] * 100).toFixed(0)}–${(ci[1] * 100).toFixed(0)}] n=${v.exposed}`;
    });
    out.push(
      `| ${r.type} | ${r.denominator}${r.denominator === "rounds" ? " ⚠" : ""} | ${cells.join(" | ")} | ${r.gradientPp == null ? "—" : r.gradientPp.toFixed(1)} | ${r.totalExposed} |`,
    );
  }
  return out.join("\n") + "\n";
}
