import { claimChecker, interpolate } from "../compare/claimChecker";
import { ATTEMPTED_GUARD_TYPES, LEGACY_TOPIC_TYPES } from "./candidateFindings";
import { causalLint } from "./causalLint";
import { normalizeFindingCategory } from "./findingCategories";
import { hindsightViolations } from "./hindsightLint";
import { rosterClassViolations } from "./rosterLint";
import { repairSpellNameZh } from "./spellNameZhLint";
import type { AuditResult, CandidateEvent, Finding, RawFinding } from "./types";

/** Single-source severity ordering (high > med > low): shared by audit sorting
 * and deep-dive selection. */
export const SEVERITY_RANK: Record<string, number> = {
  high: 0,
  med: 1,
  low: 2,
};
const RANK = SEVERITY_RANK;

/**
 * Intent-guard severity downgrade (BACKLOG #26 Task 2, 意图守护): a finding
 * that cites a `cd-hoarded`/`death-unused-defensive` candidate (gated on
 * `ATTEMPTED_GUARD_TYPES`, not the bare `facts.attempted` string key —
 * review round 1 Minor finding: a future candidate type reusing that key
 * name for an unrelated fact must not silently inherit this downgrade)
 * carrying `facts.attempted` (candidateFindings.ts's intent guard — the
 * player DID press the button and `SPELL_CAST_FAILED` rejected the cast) is
 * downgraded one severity tier from whatever the model assigned. This is
 * deterministic post-processing, not a prompt instruction the model might
 * ignore — the same "the fact carries the guard, but here the enforcement is
 * mechanical" shape as the diversity cap below, chosen over a
 * buildFindingsPrompt.ts legend note because severity is otherwise entirely
 * model-decided and therefore not independently verifiable. `high` never
 * silently vanishes to `low` in one step — only one tier at a time, same as
 * a human editor softening a verdict rather than reversing it. */
const SEVERITY_DOWNGRADE: Record<
  RawFinding["severity"],
  RawFinding["severity"]
> = {
  high: "med",
  med: "low",
  low: "low",
};

export interface AuditOptions {
  /** Spec ids (CombatUnitSpec strings) of every player on both teams. When
   * given, a finding naming a class nobody plays is dropped (rosterLint);
   * absent = the roster lint is skipped. */
  rosterSpecs?: readonly string[];
}

export function auditFindings(
  raw: RawFinding[],
  candidates: CandidateEvent[],
  options: AuditOptions = {},
): AuditResult {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  // Diversity cap bookkeeping (2026-08-11): carried alongside each survivor
  // through the gate layers below so the post-loop cap (see after the loop)
  // can tell, without re-resolving eventIds, whether a finding belongs to the
  // legacy-type group. `raw` is kept too so an overflowing finding can still
  // be reported via `dropped` in the caller's expected shape (RawFinding, not
  // the post-interpolation Finding).
  const survived: { finding: Finding; raw: RawFinding; isLegacy: boolean }[] =
    [];
  const dropped: AuditResult["dropped"] = [];

  for (const f of raw) {
    // Layer 1: grounding — the finding must anchor to >=1 event, and every
    // eventId must resolve. (Empty eventIds is unanchored → drop.)
    // The model's JSON is untrusted input: a finding that omits `eventIds`
    // (or emits a non-array) is dropped like any other unanchored finding —
    // measured 2026-09-12 in the n=100 A/B, one sonnet reply used its own
    // schema for all 6 findings and `.map` on undefined killed the whole
    // interpolation pass instead of dropping that reply's findings.
    const ids = Array.isArray(f.eventIds)
      ? f.eventIds.filter((id): id is string => typeof id === "string")
      : [];
    const refs = ids.map((id) => byId.get(id));
    if (ids.length === 0 || refs.some((r) => !r)) {
      dropped.push({
        finding: f,
        reason: Array.isArray(f.eventIds)
          ? "grounding: unanchored / unknown eventId"
          : "grounding: missing eventIds",
      });
      continue;
    }
    // Facts the explanation may cite = the union of the referenced events' facts.
    // If two referenced events share a fact key with DIFFERING values (e.g. two
    // deaths, each with its own t), that placeholder is ambiguous — a last-write
    // merge would silently mis-attribute. Refined 2026-07-24: drop only when
    // the explanation **actually uses** a colliding key — the old rule dropped
    // the whole finding whenever a colliding key merely existed, which also
    // killed the multi-event chains the prompt explicitly encourages (death +
    // setup, several missed cleanses); a smoke run measured 3/7 findings dying
    // this way. The mis-attribution guarantee is unchanged: every rendered
    // placeholder must still resolve uniquely.
    const facts: Record<string, string> = {};
    const colliding = new Set<string>();
    for (const r of refs as CandidateEvent[])
      for (const [k, v] of Object.entries(r.facts)) {
        if (k in facts && facts[k] !== v) colliding.add(k);
        facts[k] = v;
      }
    // Indexed variants ({{t1}}/{{t2}}, following eventIds order): the **only
    // legal way** for a multi-event finding to reference each event's own
    // timestamp. Without them, a model writing {{t}} is guaranteed to be
    // dropped — reproduced in production 2026-07-25: 3 of 5 findings in a
    // Chinese reply died this way and the user saw only 2. Generated for
    // **every** key, not just colliding ones: the model cannot see the
    // collision set, so emitting only colliding keys would make {{duration1}}
    // (where both values happen to be equal) and a single-event {{deathT1}}
    // fail to resolve and be wrongly dropped (confirmed by smoke). Build the
    // variants first, then merge the bare keys, with skip-if-present so a real
    // key that happens to end in a digit is not clobbered.
    (refs as CandidateEvent[]).forEach((r, i) => {
      for (const [k, v] of Object.entries(r.facts)) {
        const indexed = `${k}${i + 1}`;
        if (!(indexed in facts)) facts[indexed] = v;
      }
    });
    // Title placeholders resolve through the SAME facts (see the `title:`
    // line below), so the same ambiguity guarantee must cover them — a
    // colliding {{t}} in a title would mis-attribute exactly like one in the
    // explanation. Real-model smoke 2026-08-18 (attempt-into-trinket wiring)
    // caught a literal `{{target1}}` rendered into the UI because titles were
    // never interpolated at all; both halves of the fix land together.
    const usedKeys = [
      ...`${f.title}\n${f.explanation}`.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g),
    ].map((m) => m[1]!);
    const ambiguous = usedKeys.filter((k) => colliding.has(k));
    if (ambiguous.length > 0) {
      dropped.push({
        finding: f,
        reason: `ambiguous: placeholder(s) ${ambiguous.join(",")} collide across referenced events`,
      });
      continue;
    }
    // Layer 2: numeric. claimChecker validates {{key}} resolution + flags raw
    // decimals/percentages. But analysis fabrication is integer-heavy (times,
    // damage, "90k"), and the shared checker allows bare integers — unsafe here.
    // So additionally forbid ANY raw digit outside a placeholder: the prompt
    // mandates every number be a {{placeholder}}, so a bare digit = fabrication
    // or a disobeyed instruction. (Do not fork the shared checker; add the
    // stricter rule at the audit layer.)
    const check = claimChecker(f.explanation, facts);
    if (!check.ok) {
      dropped.push({
        finding: f,
        reason: `numeric: ${check.violations.join("; ")}`,
      });
      continue;
    }
    // Strip placeholders, then bracket/format terms (1v1, 2v2, 3v3 — never a
    // fabricated stat), then flag any remaining raw digit.
    // Stripping uses the same **strict** pattern as claimChecker: a lax
    // [^}]* would also strip illegal placeholders like {{t-1}} — which never
    // pass interpolate and would render verbatim into the UI. Under the strict
    // pattern such text stays put, contains digits, and is dropped by the raw
    // digit rule (agy review F3).
    const prose = f.explanation
      .replace(/\{\{\s*[\w.]+\s*\}\}/g, " ")
      .replace(/\b\d+v\d+\b/gi, " ");
    if (/\d/.test(prose)) {
      dropped.push({
        finding: f,
        reason: "numeric: raw digit outside placeholder",
      });
      continue;
    }
    // Layer 3: zh spell-name auto-repair. Unlike causalLint (drop-on-hit), a
    // translated ability name is deterministically fixable 1:1 — dropping
    // the whole finding over one mistranslated name is too destructive, and
    // repairing also restores #15 inline-icon matching (English-name-only
    // scanner) that the untranslated text would otherwise silently miss.
    // Consumption invariant: repair runs BEFORE causalLint (see
    // spellNameZhLint.ts's header comment) — causalLint below validates the
    // REPAIRED text, the same text that ends up in the finding.
    const { text: repairedExplanation, repairs } = repairSpellNameZh(
      f.explanation,
    );
    if (repairs.length > 0) {
      console.warn(
        `[spellNameZhLint] auditFindings repaired ${repairs.map((r) => `${r.zhName}→${r.enName}`).join(", ")}`,
      );
    }
    // Layer 4: causal-language lint (on the repaired text).
    const causal = causalLint(repairedExplanation);
    if (causal.length > 0) {
      dropped.push({ finding: f, reason: `causal: ${causal.join("; ")}` });
      continue;
    }
    // Layer 5: hindsight — a finding may not silently chain a later,
    // unrelated-type event onto an earlier anchor as if it were foreseeable
    // at the time (spec 2026-08-06-hindsight-predicate). The predicate's
    // returned strings already carry the "hindsight: " prefix.
    const hv = hindsightViolations(ids, byId);
    if (hv.length > 0) {
      dropped.push({ finding: f, reason: hv.join("; ") });
      continue;
    }
    // Layer 6: roster — a finding that names a class nobody on the roster
    // plays is an identity error (2026-09-22 user report: an enemy Holy
    // Priest called a Paladin). Checked on the raw title + explanation, so
    // player names arriving through placeholders never trip it.
    if (options.rosterSpecs) {
      const rv = rosterClassViolations(
        `${f.title ?? ""}\n${f.explanation ?? ""}`,
        options.rosterSpecs,
      );
      if (rv.length > 0) {
        dropped.push({
          finding: f,
          reason: `roster: names ${rv.join(", ")} — not on the roster`,
        });
        continue;
      }
    }
    // Diversity cap classification: ANY referenced candidate whose type is in
    // the legacy group is enough to count the whole finding as legacy — from
    // the strict/severe side (a chain finding pairing a legacy event with a
    // non-legacy one is still "spending" a legacy slot). Candidates that
    // failed to resolve never reach here (Layer 1 already dropped them), so
    // `refs` is a full CandidateEvent[] at this point.
    const isLegacy = (refs as CandidateEvent[]).some((r) =>
      LEGACY_TOPIC_TYPES.has(r.type),
    );
    // Intent guard (BACKLOG #26 Task 2): any referenced candidate whose TYPE
    // is in `ATTEMPTED_GUARD_TYPES` (not just any `facts.attempted`-bearing
    // candidate — review round 1 Minor fix: type-gated, same "any ref is
    // enough" logic as isLegacy above) and that actually carries
    // `facts.attempted` downgrades this finding's severity one tier (a chain
    // finding pairing a guarded event with an unguarded one is still
    // describing an attempted, not negligent, action).
    const attemptedGuard = (refs as CandidateEvent[]).some(
      (r) => ATTEMPTED_GUARD_TYPES.has(r.type) && !!r.facts.attempted,
    );
    const severity = attemptedGuard
      ? (SEVERITY_DOWNGRADE[f.severity] ?? f.severity)
      : f.severity;
    survived.push({
      finding: {
        ...f,
        severity,
        // Normalize category (enum/alias → slug, anything off-vocabulary kept
        // as-is): the stability of aggregation keys and of findingKey is fixed
        // here; the render side only localizes for display
        category: normalizeFindingCategory(f.category),
        title: interpolate(f.title, facts),
        explanation: interpolate(repairedExplanation, facts),
      },
      raw: f,
      isLegacy,
    });
  }

  // Severity sort FIRST (stable — ties keep the original/insertion order),
  // then the diversity cap below reads off that same order, so "highest
  // severity, then original order" falls out of one sort instead of two
  // competing comparators.
  survived.sort(
    (a, b) => (RANK[a.finding.severity] ?? 9) - (RANK[b.finding.severity] ?? 9),
  );

  // Diversity cap (2026-08-11, deterministic backstop for the prompt-level
  // selection instruction in buildFindingsPrompt.ts — same LEGACY_TOPIC_TYPES
  // set, single-source per CLAUDE.md's shared-predicate rule). The four-
  // backend baseline (diversity-baseline-report.md) measured all four
  // generation backends surviving the legacy family (then four types, incl.
  // the since-retired cc-locked — GH #14, 2026-08-19) at +3.4~+7.5pt above
  // their already-throttled menu share —
  // a prompt instruction alone is not enforcement, so this floor makes the
  // cap hold even when a backend ignores or misreads it. Keeps at most 3
  // legacy-type survivors, chosen by the severity+original order already
  // established above; the rest are moved to `dropped`.
  //
  // Relaxed 2→3 (2026-08-15, 约束预算审计 C1, 用户裁决全量上线):
  // constraint-budget-audit.md (n=48 general-population sample) measured
  // this exact 2→3 change producing 55 clean verified-new findings (5
  // environment-polluted matches excluded) against 0 causalLint/hardFailures
  // mechanism-error increment across both arms — this was the largest single
  // contributor of the three constraints tested (C2 severity floor: 3; C3
  // cc-held cap: 0, never triggered at this sample size). See that report
  // for the full methodology/attribution algorithm.
  const findings: Finding[] = [];
  let legacyKept = 0;
  for (const s of survived) {
    if (s.isLegacy) {
      if (legacyKept >= 3) {
        dropped.push({
          finding: s.raw,
          reason:
            "diversity: legacy-type cap (missed-cleanse/missed-purge combined) exceeded, kept the 3 highest-severity",
        });
        continue;
      }
      legacyKept++;
    }
    findings.push(s.finding);
  }
  return { findings, dropped };
}
