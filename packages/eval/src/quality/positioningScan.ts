/**
 * positioningScan — geometric grounding scanner (an advance subtask of
 * backlog #3).
 *
 * Extracts geometric claims that carry coordinate-recomputable anchors from
 * the prompt text, independently recomputes them against the raw
 * advanced-logging coordinates, and treats any claim outside tolerance as a
 * violation. Hard gate: a POSITIONING-class feature may only enter A/B at
 * 0 violations over the whole corpus.
 *
 * Claim classes covered:
 *  G1 CC_DISTANCE   — "[CC ON TEAM] … | N.Nyd from caster": recompute the
 *                     caster→target distance.
 *  G2 TRAINED       — "HEALER TRAINED … camped by <name> (closest N.Nyd)":
 *                     recompute the closest distance within the window, which
 *                     must also be ≤ HEALER_TRAINED_YARDS (the definition).
 *  G3 CD_RANGE      — "OFFENSIVE CD OUT OF RANGE … cast Nyd from nearest
 *                     enemy": recompute the distance to the nearest enemy at
 *                     the cast instant.
 *  G4 STAYED/KITED  — "[X burst] A→Byd from <name>": recompute A to that enemy
 *                     at the window start, and B to whoever it names — STAYED:
 *                     "from X→Y" = Y at the span end (else X); KITED: "(peak at
 *                     m:ss[, from Z])" = Z (else X) at the peak; "(X Dyd at the
 *                     end)" = X at the span end (2026-09-26, audits 483f / eb80:
 *                     B used to be another enemy's distance). Rendered times are
 *                     floored; TIME_SLACK_SECONDS (= LOS_SWEEP_SLACK_S) is the
 *                     shared tolerance for the sub-second sampling instant.
 *  G5 LOS_BREAK     — "LoS break ~N.Nyd away (pillar-blocks <name>)": the map
 *                     must have obstacle data, and at that instant the owner
 *                     and that enemy must actually see each other (you can
 *                     only "go break" LoS while it exists); otherwise the
 *                     claim is a hallucination.
 *  G6 IMPOSSIBLE_CC — any G1 claim whose distance >
 *                     CC_MAX_PLAUSIBLE_RANGE_YARDS (the producer's own
 *                     declared credibility cap on recomputed distance, above
 *                     which it suppresses).
 *
 * Tolerance: distance |claim−recomputed| ≤ max(3yd, 25%·claim); for the time
 * anchor, take the best sample within ±2s. A distance that cannot be
 * recomputed (no coordinate samples) is not a violation; it is counted
 * separately as unverifiable and listed in the report.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import {
  arenaObstacles,
  CC_MAX_PLAUSIBLE_RANGE_YARDS,
  ccDistanceClaimWindowS,
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
  HEALER_TRAINED_YARDS,
  isHealerSpec,
  LOS_SWEEP_GAP_MS,
  LOS_SWEEP_SLACK_S,
  positionSampleInstants,
} from "@gladlog/analysis";

type GeoClaimKind =
  "CC_DISTANCE" | "TRAINED" | "CD_RANGE" | "STAYED_OR_KITED" | "LOS_BREAK";

interface GeoClaim {
  kind: GeoClaimKind;
  lineNo: number;
  atSeconds: number;
  toSeconds?: number;
  distanceYards: number;
  /** Full name of the other unit in the claim (caster / camper / nearest
   * enemy / pillar-blocked enemy) */
  unitName?: string;
  /** G1: our unit that got CC'd (the pid label before "←" on the line) */
  targetName?: string;
  /** Subject of the distance (owner by default). In the G2 variant "your
   * healer (X) was camped" the subject is the healer, not the owner — on a DPS
   * corpus, recomputing against the owner yields nothing but false violations
   * (27 of them measured in D2). */
  subjectName?: string;
  /** G4: which distance of "A→B" this claim is (start A, STAYED end B, KITED peak B) */
  endpoint?: "start" | "end" | "end-own" | "peak";
  raw: string;
}

interface GeoViolation {
  claim: GeoClaim;
  code: string;
  detail: string;
}

interface GeoCheckResult {
  checked: number;
  unverifiable: number;
  violations: GeoViolation[];
}

// Single-source gate predicates (CLAUDE.md): the analysis-side LoS sweep must
// use byte-for-byte the same parameters as this gate, or the gate cannot
// reproduce the analysis' conclusion — or, worse, lets a hallucinated claim
// through. The two sides used to declare these privately and were coupled only
// by a comment in healerExposureAnalysis.ts; they are now imported from the
// single source in @gladlog/analysis.
const TIME_SLACK_SECONDS = LOS_SWEEP_SLACK_S;
const POSITION_MAX_GAP_MS = LOS_SWEEP_GAP_MS;
// G6's cap is exactly the producer's own declared "credibility cap on
// recomputed distance" — the gate verifies the producer's contract, it does
// not invent a separate "physically impossible" number. Previously the gate
// had a private 50 while the producer suppressed at 45, so the (45, 50] band
// could never fire and G6 was effectively dead code (over the corpus, 141237
// claims measured max 44.7).
const MAX_CC_CLAIM_YARDS = CC_MAX_PLAUSIBLE_RANGE_YARDS;
// Same for G2's definitional distance: the producer's positionAnalysis judges
// camping by it, and the gate re-checks by it.
const TRAINED_MAX_YARDS = HEALER_TRAINED_YARDS;

function parseTime(t: string): number {
  const [m, s] = t.split(":").map(Number);
  return m * 60 + s;
}

function tolerance(claimYd: number): number {
  return Math.max(3, claimYd * 0.25);
}

interface GeoExtraction {
  claims: GeoClaim[];
  /** The authoritative pid→full-name map carried by the prompt itself
   * (<unit id="N" name="..."/>) */
  unitIdMap: Map<number, string>;
}

/** Extract geometric claims + the unit id map from the prompt text. */
export function extractGeoClaims(promptText: string): GeoExtraction {
  const claims: GeoClaim[] = [];
  const unitIdMap = new Map<number, string>();
  const lines = promptText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const um = line.match(/<unit id="(\d+)" name="([^"]+)"/);
    if (um) {
      unitIdMap.set(Number(um[1]), um[2]);
      continue;
    }

    // G1: 0:08  [CC ON TEAM]   3(HDHunter) ← Paralysis (by 5(WMonk)) | 3s [DR: …] | 23.4yd from caster
    let m = line.match(
      /^(\d+:\d{2}) {2}\[CC ON TEAM\] +(\S+) ← .*\(by (\d+\([^)]*\)|[^)]+)\).*?\| ([\d.]+)yd from caster/,
    );
    if (m) {
      claims.push({
        kind: "CC_DISTANCE",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[4]),
        unitName: m[3],
        targetName: m[2],
        raw: line,
      });
      continue;
    }

    // G2: 1:13–1:21 you were camped by Rockxtv-Illidan-US (closest 1.3yd) — …
    m = line.match(
      /^ +(\d+:\d{2})[–-](\d+:\d{2}) (?:you were|your healer \(([^)]*)\) was) camped by (\S+) \(closest ([\d.]+)yd\)/,
    );
    if (m) {
      claims.push({
        kind: "TRAINED",
        lineNo,
        atSeconds: parseTime(m[1]),
        toSeconds: parseTime(m[2]),
        distanceYards: Number(m[5]),
        unitName: m[4],
        subjectName: m[3] || undefined,
        raw: line,
      });
      continue;
    }

    // G3: 0:40 Chaos Nova cast 32yd from nearest enemy (still >…)
    m = line.match(/^ +(\d+:\d{2}) (.+?) cast ([\d.]+)yd from nearest enemy/);
    if (m) {
      claims.push({
        kind: "CD_RANGE",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[3]),
        raw: line,
      });
      continue;
    }

    // G4: 0:17 [High burst] 5→3yd from Rockxtv-Illidan-US … / opened 4→18yd from …
    // STAYED lines are span-stamped ("2:38–2:48 [High burst] 8→3.3yd from …");
    // the pattern used to require a bare timestamp, so no STAYED line was ever
    // checked (found 2026-09-23, GH #103 A7). The start distance still anchors
    // on the span's first second.
    // Names may carry parentheses (realm "Aggra(Português)"), never spaces.
    m = line.match(
      /^ +(\d+:\d{2})(?:–(\d+:\d{2}))? \[[^\]]+ burst\] (opened )?([\d.]+)→([\d.]+)yd from ([^\s→]+)(?:→(\S+))?(?: \((\S+) ([\d.]+)yd at the end\))?(?:.*? \(peak at (\d+:\d{2})(?:, from (.+?))?\)(?=\s|$))?/,
    );
    if (m) {
      const startName = m[6]!;
      claims.push({
        kind: "STAYED_OR_KITED",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[4]),
        unitName: startName,
        endpoint: "start",
        raw: line,
      });
      if (m[3] && m[10]) {
        // KITED: B is the peak, measured to Z (else the start enemy)
        claims.push({
          kind: "STAYED_OR_KITED",
          lineNo,
          atSeconds: parseTime(m[10]),
          distanceYards: Number(m[5]),
          unitName: m[11] ?? startName,
          endpoint: "peak",
          raw: line,
        });
      } else if (!m[3] && m[2]) {
        // STAYED: B at the span end, measured to Y (else the start enemy)
        claims.push({
          kind: "STAYED_OR_KITED",
          lineNo,
          atSeconds: parseTime(m[2]),
          distanceYards: Number(m[5]),
          unitName: m[7] ?? startName,
          endpoint: "end",
          raw: line,
        });
        // …and the start enemy's own end distance, when another was nearest
        if (m[8] && m[9])
          claims.push({
            kind: "STAYED_OR_KITED",
            lineNo,
            atSeconds: parseTime(m[2]),
            distanceYards: Number(m[9]),
            unitName: m[8],
            endpoint: "end-own",
            raw: line,
          });
      }
      continue;
    }

    // G5: 0:07  [HEALER EXPOSURE] … LoS break ~12.3yd away (pillar-blocks Oldchill-Proudmoore-US) …
    m = line.match(
      /^(\d+:\d{2}) {2}\[HEALER EXPOSURE\].*LoS break ~([\d.]+)yd away \(pillar-blocks ([^)]+)\)/,
    );
    if (m) {
      claims.push({
        kind: "LOS_BREAK",
        lineNo,
        atSeconds: parseTime(m[1]),
        distanceYards: Number(m[2]),
        unitName: m[3],
        raw: line,
      });
      continue;
    }
  }

  return { claims, unitIdMap };
}

interface CheckContext {
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  zoneId: string;
  matchStartMs: number;
  /** The prompt's authoritative pid→full-name map */
  unitIdMap?: Map<number, string>;
}

/** Name resolution: prompt full name (Name-Realm-US) → unit. The pid label
 * form (5(WMonk)) resolves by the id prefix. */
function resolveUnit(name: string, ctx: CheckContext): ICombatUnit | null {
  const all = [...ctx.friends, ...ctx.enemies];
  const exact = all.find((u) => u.name === name);
  if (exact) return exact;
  // pid form "5(WMonk)" / "5" — resolve via the prompt's own authoritative
  // <unit id=.. name=..> map
  const pidMatch = name.match(/^(\d+)/);
  if (pidMatch && ctx.unitIdMap) {
    const full = ctx.unitIdMap.get(Number(pidMatch[1]));
    if (full) {
      const byMap = all.find((u) => u.name === full);
      if (byMap) return byMap;
    }
  }
  const short = name.split("-")[0];
  return all.find((u) => u.name.split("-")[0] === short) ?? null;
}

/**
 * Consistency-check semantics (span): prompt timestamps are floored to the
 * second, the real event lies in [t, t+1), and units are moving; take the
 * distance interval [min, max] over per-second samples within t±slack — a
 * claim inside the interval ±tol is grounded (the true sub-second distance
 * must lie within the span of the units' actual trajectories), and only a
 * claim outside the interval is a violation.
 * (Both taking a single-point min and taking closest-to-claim were falsified
 * by cycle-3 measurements: the former is systematically too low, the latter
 * lets the +15yd mutation escape en masse in fast-movement scenarios.)
 */
function windowDistanceSpan(
  a: ICombatUnit,
  b: ICombatUnit,
  atSeconds: number,
  ctx: CheckContext,
): { min: number; max: number } | null {
  return distanceSpanBetween(
    a,
    b,
    atSeconds - TIME_SLACK_SECONDS,
    atSeconds + TIME_SLACK_SECONDS,
    ctx,
  );
}

/** The [min, max] distance over [fromS, toS] (match seconds) — the body of
 * `windowDistanceSpan`, callable with a claim family's own window. */
function distanceSpanBetween(
  a: ICombatUnit,
  b: ICombatUnit,
  fromS: number,
  toS: number,
  ctx: Pick<CheckContext, "matchStartMs">,
): { min: number; max: number } | null {
  // The set of sampling instants comes from the single source
  // positionSampleInstants (anchors + both units' real advanced sample
  // instants inside the window + a sub-second grid). Checking only whole
  // seconds misses sub-second troughs; checking only sample instants misses
  // the crossing trough when the two units' samples do not coincide — this
  // function and minDistanceInWindow each used to carry their own copy.
  const fromMs = ctx.matchStartMs + fromS * 1000;
  const toMs = ctx.matchStartMs + toS * 1000;
  const instants = positionSampleInstants([a, b], fromMs, toMs, [fromMs, toMs]);
  let min: number | null = null;
  let max: number | null = null;
  for (const ts of instants) {
    const pa = getUnitPositionAtTime(a, ts, POSITION_MAX_GAP_MS);
    const pb = getUnitPositionAtTime(b, ts, POSITION_MAX_GAP_MS);
    if (!pa || !pb) continue;
    const d = distanceBetween(pa, pb);
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  return min === null || max === null ? null : { min, max };
}

function inSpan(
  claim: number,
  span: { min: number; max: number },
  tol: number,
): boolean {
  return claim >= span.min - tol && claim <= span.max + tol;
}

/**
 * Minimum distance between two units within the window — the "closest"
 * semantics of G2 TRAINED.
 *
 * This deliberately does **not** share parameters with the producer
 * (positionAnalysis' HEALER_TRAINED); do not "unify" them: this function's set
 * of sampling instants is a **strict superset** of the producer's whole-second
 * grid, and its gap tolerance (3000ms) is looser than the producer's
 * INTERP_MAX_GAP_MS (1500ms). The gap in getUnitPositionAtTime only decides
 * accept/reject, it does not change the interpolated value, so every instant
 * the producer can sample this function can also sample with the same value
 * ⇒ gateMin ≤ producerMin always holds. The predicate below therefore **must**
 * be one-sided: only "claiming to be closer than physically observed" is
 * fabrication; a claimed value that is too high is just the inherent
 * conservative bias of the whole-second grid.
 *
 * Making the producer consume this function's tolerance instead is **wrong**:
 * INTERP_MAX_GAP_MS is a T3 grounding guard, and loosening it to 3000ms would
 * revive mid-gap interpolation across sampling holes (which demonstrably
 * produced a bogus 0.4yd TRAINED claim). The inverse relationship is pinned by
 * the end-to-end case + negative control in predicateIndex.test.ts.
 */
function minDistanceInWindow(
  a: ICombatUnit,
  b: ICombatUnit,
  fromSeconds: number,
  toSeconds: number,
  ctx: CheckContext,
): number | null {
  const fromMs = ctx.matchStartMs + Math.floor(fromSeconds) * 1000;
  const toMs = ctx.matchStartMs + Math.ceil(toSeconds + 1) * 1000;
  const wholeSeconds: number[] = [];
  for (let t = Math.floor(fromSeconds); t <= Math.ceil(toSeconds); t++)
    wholeSeconds.push(ctx.matchStartMs + t * 1000);
  const instants = positionSampleInstants([a, b], fromMs, toMs, wholeSeconds);
  let min: number | null = null;
  for (const ts of instants) {
    const pa = getUnitPositionAtTime(a, ts, POSITION_MAX_GAP_MS);
    const pb = getUnitPositionAtTime(b, ts, POSITION_MAX_GAP_MS);
    if (!pa || !pb) continue;
    const d = distanceBetween(pa, pb);
    if (min === null || d < min) min = d;
  }
  return min;
}

export function checkGeoClaims(
  claims: GeoClaim[],
  ctx: CheckContext,
): GeoCheckResult {
  const violations: GeoViolation[] = [];
  let unverifiable = 0;
  let checked = 0;

  for (const claim of claims) {
    switch (claim.kind) {
      case "CC_DISTANCE": {
        // Claim: at that moment the caster and the CC'd unit (the "X ←" on the
        // line) were N yd apart.
        const caster = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        const target = claim.targetName
          ? resolveUnit(claim.targetName, ctx)
          : null;
        if (!caster || !target) {
          unverifiable++;
          continue;
        }
        // The producer's own sampling contract: one instant inside the
        // rendered second (ccDistanceClaimWindowS), not the LoS ±2 s.
        const win = ccDistanceClaimWindowS(claim.atSeconds);
        const span = distanceSpanBetween(
          caster,
          target,
          win.fromS,
          win.toS,
          ctx,
        );
        if (span === null) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        if (!inSpan(claim.distanceYards, span, tol)) {
          violations.push({
            claim,
            code: "G1_DISTANCE_MISMATCH",
            detail: `claimed ${claim.distanceYards}yd caster→target; window span [${span.min.toFixed(1)}, ${span.max.toFixed(1)}]yd (tol ${tol.toFixed(1)})`,
          });
        }
        if (claim.distanceYards > MAX_CC_CLAIM_YARDS) {
          violations.push({
            claim,
            code: "G6_IMPOSSIBLE_CC",
            detail: `claimed CC from ${claim.distanceYards}yd > ${MAX_CC_CLAIM_YARDS}yd plausible-range cap (producer suppresses above this)`,
          });
        }
        break;
      }

      case "TRAINED": {
        const camper = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        if (!camper) {
          unverifiable++;
          continue;
        }
        // Distance subject: in "your healer (X) was camped" the subject is X,
        // not the owner
        const subject =
          (claim.subjectName ? resolveUnit(claim.subjectName, ctx) : null) ??
          ctx.owner;
        const min = minDistanceInWindow(
          subject,
          camper,
          claim.atSeconds,
          claim.toSeconds ?? claim.atSeconds,
          ctx,
        );
        if (min === null) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        // One-sided check: only penalize "claiming to be closer than physical
        // fact" (fabricated proximity); a claim above the true sub-second
        // minimum is the inherent conservative bias of whole-second sampling,
        // not a false claim.
        if (claim.distanceYards < min - tol) {
          violations.push({
            claim,
            code: "G2_TRAINED_DISTANCE",
            detail: `claimed closest ${claim.distanceYards}yd is closer than physically observed min ${min.toFixed(1)}yd (tol ${tol.toFixed(1)})`,
          });
        }
        if (claim.distanceYards > TRAINED_MAX_YARDS) {
          violations.push({
            claim,
            code: "G2_TRAINED_DEFINITION",
            detail: `claimed closest ${claim.distanceYards}yd violates trained definition (≤${TRAINED_MAX_YARDS}yd)`,
          });
        }
        break;
      }

      case "CD_RANGE": {
        const spans = ctx.enemies
          .map((e) => windowDistanceSpan(ctx.owner, e, claim.atSeconds, ctx))
          .filter((sp): sp is { min: number; max: number } => sp !== null);
        if (spans.length === 0) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        // "Nearest enemy" semantics: grounded if any enemy's span covers the
        // claim
        if (!spans.some((sp) => inSpan(claim.distanceYards, sp, tol))) {
          const nearest = Math.min(...spans.map((sp) => sp.min));
          violations.push({
            claim,
            code: "G3_RANGE_MISMATCH",
            detail: `claimed ${claim.distanceYards}yd from nearest enemy; no enemy span covers it (nearest span-min ${nearest.toFixed(1)}yd, tol ${tol.toFixed(1)})`,
          });
        }
        break;
      }

      case "STAYED_OR_KITED": {
        const enemy = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        if (!enemy) {
          unverifiable++;
          continue;
        }
        const span = windowDistanceSpan(ctx.owner, enemy, claim.atSeconds, ctx);
        if (span === null) {
          unverifiable++;
          continue;
        }
        checked++;
        const tol = tolerance(claim.distanceYards);
        if (!inSpan(claim.distanceYards, span, tol)) {
          const which = claim.endpoint ?? "start";
          violations.push({
            claim,
            code:
              which === "start"
                ? "G4_START_DISTANCE"
                : which === "peak"
                  ? "G4_PEAK_DISTANCE"
                  : "G4_END_DISTANCE",
            detail: `claimed ${which} ${claim.distanceYards}yd from ${claim.unitName}; span [${span.min.toFixed(1)}, ${span.max.toFixed(1)}]yd (tol ${tol.toFixed(1)})`,
          });
        }
        break;
      }

      case "LOS_BREAK": {
        // Two-step hallucination check: 1) the map must have obstacle data;
        // 2) at this instant the owner and that enemy must see each other
        // (suggesting "go break LoS" when LoS is already broken is a false
        // claim).
        if (
          !arenaObstacles[ctx.zoneId] ||
          arenaObstacles[ctx.zoneId].length === 0
        ) {
          checked++;
          violations.push({
            claim,
            code: "G5_NO_GEOMETRY",
            detail: `pillar-blocks claim on zone ${ctx.zoneId} which has no obstacle data`,
          });
          break;
        }
        const enemy = claim.unitName ? resolveUnit(claim.unitName, ctx) : null;
        if (!enemy) {
          unverifiable++;
          continue;
        }
        // Grounded if any sample within ±slack has LoS (sub-second jitter at a
        // pillar edge is not a false claim)
        let sawAny = false;
        let sawLoS = false;
        // [HEALER EXPOSURE] always takes the friendly healer as its subject
        // (healerExposureAnalysis anchors on healerUnit); when the owner is a
        // DPS, recomputing against the owner is a subject mismatch (measured
        // in D2).
        const exposureSubject =
          ctx.friends.find((u) => isHealerSpec(u.spec)) ?? ctx.owner;
        for (let dt = -TIME_SLACK_SECONDS; dt <= TIME_SLACK_SECONDS; dt++) {
          const ts = ctx.matchStartMs + (claim.atSeconds + dt) * 1000;
          const po = getUnitPositionAtTime(
            exposureSubject,
            ts,
            POSITION_MAX_GAP_MS,
          );
          const pe = getUnitPositionAtTime(enemy, ts, POSITION_MAX_GAP_MS);
          if (!po || !pe) continue;
          sawAny = true;
          if (hasLineOfSight(ctx.zoneId, po, pe) !== false) sawLoS = true;
        }
        if (!sawAny) {
          unverifiable++;
          continue;
        }
        checked++;
        if (!sawLoS) {
          violations.push({
            claim,
            code: "G5_ALREADY_BROKEN",
            detail: `LoS-break suggested vs ${claim.unitName} but LoS is already broken throughout ${claim.atSeconds}±2s`,
          });
        }
        break;
      }
    }
  }

  return { checked, unverifiable, violations };
}

/** Mutation testing: apply a known corruption to a claim and assert the
 * scanner catches it. Returns [mutated, detected]. */
export function mutationDetectionRate(
  claims: GeoClaim[],
  ctx: CheckContext,
): {
  mutated: number;
  detected: number;
  /** per claim kind — which families the diagnostic rate is losing */
  byKind: Record<string, { mutated: number; detected: number }>;
} {
  let mutated = 0;
  let detected = 0;
  const byKind: Record<string, { mutated: number; detected: number }> = {};
  const baseline = checkGeoClaims(claims, ctx);
  const cleanClaims = claims.filter(
    (c) => !baseline.violations.some((v) => v.claim === c),
  );
  for (const c of cleanClaims) {
    if (c.kind === "LOS_BREAK") continue; // distance mutation is meaningless for G5
    // Distance +15yd: tol = max(3, 0.25·claim) < 15 holds for every claim
    // < 45yd, so detection should be 100%
    const m1: GeoClaim = { ...c, distanceYards: c.distanceYards + 15 };
    const r1 = checkGeoClaims([m1], ctx);
    if (r1.checked > 0) {
      mutated++;
      const k = (byKind[c.kind] ??= { mutated: 0, detected: 0 });
      k.mutated++;
      if (r1.violations.length > 0) {
        detected++;
        k.detected++;
      }
    }
  }
  return { mutated, detected, byKind };
}
