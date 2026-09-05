import { CANDIDATE_TYPE_FLAGS } from "../data/candidateTypeFlags";
import { LEGACY_TOPIC_TYPES } from "./candidateFindings";
import { FINDING_CATEGORIES } from "./findingCategories";
import type { CandidateEvent } from "./types";

/** The category enum rendered into the prompt (the same constant the audit
 * normalizes against -- single-source predicate). */
const CATEGORY_UNION = FINDING_CATEGORIES.map((c) => `"${c}"`).join("|");

/** Rendered into the selection-rule sentence below and shared with
 * auditFindings.ts's deterministic cap on the very same set — single-source
 * (CLAUDE.md shared-predicate rule), see LEGACY_TOPIC_TYPES's doc comment in
 * candidateFindings.ts. */
const LEGACY_TYPES_LIST = [...LEGACY_TOPIC_TYPES]
  .map((t) => `"${t}"`)
  .join(", ");

/** Cost-norm guard-note wording (#25, 2026-08-14 挂账清理 Task D): appended to
 * every legend line whose type can carry a `facts.costNorm` fact
 * (death-unused-defensive / cd-waste), so the two copies stay identical in
 * wording rather than drifting. The fact itself (whether costNorm is present,
 * and its phrase) comes from curatedAbilityFacts.ts's `costNormPhrase` —
 * candidateFindings.ts's cost_norm sign-off book — this string only explains
 * what the field MEANS to the model, same split as ownerCanDispel above. */
const COST_NORM_LEGEND_NOTE = ` When facts.costNorm is present, the named ability (e.g. Divine Shield/Ice Block) is mechanically usable but its real-game cost is too high to recommend as a routine reaction — echo the costNorm caveat and suggest it only as a last-resort/emergency option, never as "you should press this to block/mitigate".`;

/** Intent-guard note (BACKLOG #26 Task 2, 意图守护 — "pressed but rejected ≠
 * never pressed"): appended to the legend lines whose type can carry
 * `facts.attempted` (cd-hoarded / death-unused-defensive). The fact itself
 * (aggregated, verbatim-localized SPELL_CAST_FAILED reasons) is set by
 * candidateFindings.ts's `formatAttemptedFact`; the severity downgrade this
 * implies is enforced mechanically by auditFindings.ts (not left to the
 * model), so this note only has to fix the WORDING, not the score. */
const ATTEMPTED_LEGEND_NOTE = ` When facts.attempted is present, the player DID try to press this ability and the game rejected the cast (facts.attempted names the reason(s), e.g. still on GCD/silenced/stunned/out of range) — never phrase this as hoarding, negligence, or "you should have used it"; phrase it as the attempt being blocked and, if relevant, coach clearing that blocker (positioning/CC break) sooner.`;

const DPS_LEGENDS: Record<string, string> = {
  "unconverted-burst": `- "unconverted-burst": your offensive cooldowns (facts.spell) put facts.damageM M damage on facts.target but it did NOT convert — target survived with HP facts.hpStart% → facts.hpEnd% (facts.defensive names a damage reduction that was up, if any; facts.allyAligned says whether an ally offensive CD overlapped). Coach setup: pair the burst with CC on the healer, align with ally CDs, or pick a target without a defensive ready.`,
  "burst-into-immunity": `- "burst-into-immunity": you opened offensive cooldowns (facts.spell) while the target had a full immunity running (facts.immunity, active facts.overlap seconds of the burst). Coach burst timing or a target swap.`,
  "attempt-into-trinket": `- "attempt-into-trinket": your team opened a stun-anchored kill attempt (facts.stun x facts.stunsN stuns, facts.dmgM M team damage, facts.focusPct% of team damage on the target) on facts.target while their PvP trinket was still available, and facts.primeAlt had neither trinket nor any 20-99% wall in hand at that same moment; facts.failedBy is why it failed. Coach opening on the trinket-less target or forcing the trinket before committing — do NOT claim the attempt on facts.target could never have worked. Corpus reference (n=facts.refN kill attempts): the target died within 15 s facts.refKillTrinketDown% of the time when its trinket was already down at the start vs facts.refKillTrinketUp% when it was up — a descriptive contrast, not causal proof; cite the numbers, do not invent others.`,
  "burst-into-mitigation": `- "burst-into-mitigation": you opened offensive cooldowns (facts.spell) into facts.target while they had facts.mitSpell (facts.mitPct% damage reduction) running, and facts.betterTarget was a softer target available at that same moment. State only that the mitigation was up and the alternative existed — do NOT assert the burst therefore failed or that swapping would certainly have gotten a kill. Coach target selection at the moment of opening.`,
  "off-target-in-window": `- "off-target-in-window": during a kill window on facts.target, only facts.onTargetPct percent of your damage landed on that target (facts.offTarget absorbed the most). Coach target discipline.`,
  "juked-kick": `- "juked-kick": your interrupt (facts.kick) was baited out by a fake cast (facts.fake) — the enemy cancelled and you kicked air. Coach kick patience/holding for the real cast.`,
  "dr-clipped-cc": `- "dr-clipped-cc": your CC (facts.spell) landed on facts.target at facts.dr diminishing returns (only facts.duration seconds). Coach CC sequencing with your team.`,
};

/** Conditional legends common to every owner perspective (emitted only when
 * the menu contains that type; without it the prompt bytes are unchanged). */
const CHAIN_LEGENDS: Record<string, string> = {
  "missed-cleanse": `- "missed-cleanse": a high-value enemy CC (facts.cc, facts.priority) sat on ally facts.target for facts.duration seconds without a friendly dispel while a cleanse was available; the target ate facts.postCcDamageK k damage right after it landed. Coach dispel priority/awareness. When facts.ownerCanDispel is present ("no"): the log owner's own class CANNOT remove this debuff type (facts.eligibleDispellers names the teammates who can, by spec) — phrase the finding only as a call-out/communication suggestion ("call for a dispel"/"ask X to cleanse it"), NEVER as "you should have dispelled it" or "use your cleanse/purify" — the owner has no such ability for this debuff type.`,
  "missed-purge": `- "missed-purge": enemy facts.enemy kept a high-value buff (facts.buff, facts.priority) running facts.duration seconds without being purged while a purge was available (facts.inKillWindow says it overlapped your team's kill window). Coach offensive dispel usage.`,
  // GH #25 MD 特例 (2026-08-21, user-ruled): Mass Dispel is a STRATEGIC
  // ability (the only removal for Ice Block/Divine Shield) — holding it is
  // often correct, so this legend must stay a "window worth considering",
  // never an accusation. The emitting gates already required the strategic
  // reserve to be demonstrably moot (facts.strategicImmunities).
  "md-cyclone-window": `- "md-cyclone-window": an enemy cyclone CHAIN (facts.cycloneHits landings on facts.targets, facts.windowFromT–facts.windowToT s) locked your teammates under real pressure (facts.pressure) while your Mass Dispel sat ready and its strategic targets were moot (facts.strategicImmunities). This is a LOW-severity "window worth considering", NOT a mistake claim: holding Mass Dispel is often correct, and the facts only establish this particular window had no strategic reason left to hold. Phrase as "this was a candidate moment for Mass Dispel on the cyclone chain" — never "you should have"/"this cost you".`,
  "cc-locked": `- "cc-locked": you sat in hard CC (facts.cc from facts.source) for facts.duration seconds taking facts.damageTakenK k damage. facts.trinketState matters: "available_unused" = trinket was in hand the whole time (coach trinket decision); "on_cooldown" = coach positioning/spacing so the chain could not start. Do not coach "use your trinket" when trinketState is on_cooldown.`,
  "kick-eaten": `- "kick-eaten": your hardcast (facts.interrupted) was interrupted by facts.source's facts.kick, locking the school for facts.lockout seconds. Coach fake-casting / juking the kick.`,
  "death-setup": `- "death-setup": a precursor moment tied to a later friendly death at facts.deathT (facts.kind: "healer-locked" = the healer was CC'd through the kill window; "trinket-early" = the victim's trinket was spent at facts.t and still down when they died in CC; "defensive-early" = a major defensive was spent early per the timing audit and unavailable at death). For a chain finding, anchor on the death-setup event id(s) ALONE — their facts already carry both {{t}} (the setup moment) and {{deathT}} (the death); do NOT also reference the death event id, whose own t differs and would make {{t}} ambiguous. Describe the sequence neutrally — "at {{t}}s X happened; at {{deathT}}s the death followed" — and suggest what to do differently at the setup moment. The no-causation hard rule still applies: never write that the setup "led to"/"caused"/"resulted in" the death.`,
  "death-unused-defensive": `- "death-unused-defensive": the player died at facts.t while major defensive(s) facts.walls were OFF cooldown. facts.free explains why pressing was possible: "yes" = not in CC; "trinket_in_hand" = CC'd but trinket was available to break out first; "usable_in_cc" = the listed ability works while CC'd. Coach pressing defensives earlier when taking heavy damage; do not invent which damage killed them.${COST_NORM_LEGEND_NOTE}${ATTEMPTED_LEGEND_NOTE}`,
  "external-unused": `- "external-unused": teammate facts.victim died at facts.t while the player (facts.owner) had external defensive facts.external off cooldown and was free of CC for facts.freeGapS seconds in the final window. Coach external usage priorities; never claim the external would certainly have saved them.`,
  "wasted-trinket": `- "wasted-trinket": the player used their PvP trinket at facts.t in a neutral state (team minimum HP facts.teamMinHpPct%, healer free, no enemy offensive cooldowns active). Coach saving trinket for kill windows or breaking lethal CC.`,
  // Signal-expansion batch 1 (2026-08-06, BACKLOG #18 second batch, design:
  // docs/superpowers/specs/2026-08-07-signal-expansion-batch1-design.md).
  "healing-gap": `- "healing-gap": the healer produced no heals or casts for facts.durationS seconds starting at facts.t (the gap runs facts.t → facts.t+facts.durationS; facts.freeS of that was free of CC — time they COULD have cast), while facts.pressured (facts.pressuredSpec) took real damage and a teammate sat at facts.lowestAllyHp% HP during the gap — that crisis HP is why this gap was reported, not the gap length by itself. Coach healing rotation/triage awareness during that stretch.`,
  "position-mistake": `- "position-mistake": the log owner's own movement (facts.kind). "stayed-in" = stood in a threat and took an HP drop (facts.hpStart% → facts.hpMin%, facts.enemy names the nearest threat when known); "missed-push" = drifted facts.dist yards from facts.enemy when pressure was needed; "cd-out-of-range" = fired facts.spell with no valid target in range. Coach the movement decision, not just cooldown usage.`,
  // No-causation guard (design doc, explicit): "sat available unused" is a
  // FACT about uptime; "and that's why you lost" is the banned inference —
  // do not let this legend, or a finding built from it, cross that line.
  "cc-held": `- "cc-held": the player's control cooldown facts.spell sat AVAILABLE and unused for facts.heldS continuous seconds (facts.t to facts.windowEndT) — this is an uptime fact, not a claim that pressing it would have changed the outcome. Coach whether that stretch had a target worth using it on, or note that holding it may have been the correct call — never assert it "cost" anything.`,
  // DEFENSIVE-001 (2026-08-07, BACKLOG #18 second batch, design:
  // docs/superpowers/specs/2026-08-07-defensive-001-design.md).
  // No-causation guard: "X was available before it landed" is a FACT about
  // the owner's kit at that instant; "using it would have saved you" is the
  // banned inference the wording below is written to avoid — the tool may
  // well have been better saved for later.
  "cc-avoidable": `- "cc-avoidable": the player ate hard CC facts.spell for facts.durationS seconds at full effect, and the enemy was VISIBLY CASTING it beforehand (facts.castBarSeen) — so there was a cast bar to react to. Before it landed, facts.avoidableWith was available — can be used to avoid this kind of control. Coach reacting with one of these tools next time, or note that holding it for a bigger threat may have been the right call — never assert that using it would certainly have prevented what followed.`,
  // DEFENSIVE-003, rewritten 2026-09-01 (GH #60 phase 2, user-approved
  // sentence shape). Same no-causation guard as before — "nobody answered
  // inside 8 s while a tool was ready" is a FACT, "answering would have saved
  // them" is the banned inference — plus the crisis-no-response discipline for
  // the corpus reference: it is a descriptive contrast between two
  // populations, never a prescription, and the numbers must be cited, not
  // invented.
  "slow-defensive-response": `- "slow-defensive-response": at facts.t the enemy opened facts.leadCd (+facts.extras): no friendly answered within 8 s although a tool was ready (wall/external/healing CD/control on the caster/kite); facts.pressured fell to facts.pressuredHpPct% inside the window. Corpus reference (n=facts.refN facts.leadCd burst windows): a friendly died inside the window facts.refDeathResp% of the time when answered within 8 s vs facts.refDeathNoResp% when not — descriptive contrast, not causal proof; cite the numbers, do not invent others.`,
  // crisis-no-response (spec 2026-08-29 §1b, GH #58, Task 10, further
  // amended same-day — "不管分数线", the rating line is out entirely): the
  // reference is OUTCOME-based (death-within-10s for responders vs
  // non-responders in this bracket/damage cell), not rank-based, and `top`
  // (the most common answers) is computed over every responder, no
  // percentile filter. It is a descriptive contrast, not causal proof
  // (responders may have been in easier spots) — the wording below must not
  // cross into "you should have pressed <ability>".
  // Role-neutral wording (spec §1d, GH #59): the reference population is now
  // "players of the same role in this bracket", not "healers" — this same
  // legend entry covers a DPS owner's crossing once the dps reference cells
  // exist (`cellKey` already carries the role, e.g. `3v3|dps|>=20%`).
  "crisis-no-response": `- "crisis-no-response": at facts.t the player's own HP fell to facts.hpPct% while taking facts.dmg2sPct% of max HP in the prior 2 s from facts.attackers attacker(s) (enemy burst cooldown active: facts.burst), and for the next 3 seconds did NOTHING to answer it — no self-heal ≥15%, no personal wall, no external, no CC/root/interrupt on an enemy, no kiting. The player was free (not CC'd, not locked out, alive through the window). Outcome reference for this bracket and damage level (cell facts.cellKey; fellBack=yes means a coarser bracket-wide cell; facts.refOutcome names the outcome that was counted (in Solo Shuffle it is "a teammate (or the healer) died within 15 s", because the kill target is often a teammate; elsewhere "this player died within 10 s") — write that outcome in words, never as a code token). For DPS the counted outcome is always "this player died within 10 s" (DPS are the kill target); for healers in Solo Shuffle it is a teammate's death within 15 s. Players of the same role in this bracket who did NOT respond within 3 s saw that outcome facts.refDeathNoResp% of the time (n=facts.refNNoResp); players of the same role who DID respond saw it facts.refDeathResp% of the time (n=facts.refNResp). Among players of the same role who DID respond here, the most common answers were facts.refTop. These are descriptive contrasts, not causal proof — responding players may have been in easier spots. CITE the numbers; do NOT turn them into "you should have pressed <ability>".`,
};

function legendLines(
  map: Record<string, string>,
  candidates: CandidateEvent[],
): string[] {
  const present = new Set(candidates.map((c) => c.type));
  return Object.entries(map)
    .filter(([type]) => present.has(type))
    .map(([, line]) => line);
}

/** P1/P2 起爆候选(2026-08-15,Task 4 特性开关接线,BACKLOG #26 raw-streams
 * 计划 Task 3 追加 mana-pressure / Task 4 追加 mana-efficiency): legend for
 * each feature-flagged candidate type, gated on the SAME
 * `CANDIDATE_TYPE_FLAGS` field the menu assembly (candidateFindings.ts's
 * `teamPlayEvents`) gates emission on — one source of truth for "is this
 * type live" (CLAUDE.md shared-predicate rule), not a second copy of the
 * flag values re-derived here. Also gated on presence in `candidates`, same
 * as `legendLines` above, so a match where the flag is on but this
 * particular type never fired doesn't pay legend bytes for a type the menu
 * doesn't contain — the wiring already guarantees presence implies the flag
 * is on, so this is a defense-in-depth check, not a second independent gate
 * that could disagree with it. The original four P1/P2 flags default true
 * (Task 9, user-ruled full launch) — each entry's rendering follows its own
 * flag's current value independently, so `newCandidateLegendLines` below is
 * a per-type filter, not an all-or-nothing switch. (The mana-pressure/
 * mana-efficiency entries were decommissioned to primitives 2026-08-21 —
 * BACKLOG #26 declined, successor #33.) */
const NEW_CANDIDATE_LEGENDS: Record<string, string> = {
  "missed-sync-window": `- "missed-sync-window": the enemy healer facts.healer sat in hard CC (facts.cc) for facts.durationS seconds (facts.t–facts.windowEndT) while your team had facts.readyCds ready and none entered the window (a press up to 2 s before the lock counts as entering). Syncing with the lock is the trigger — facts.enemyMinHpPct, when present, is only an accelerator fact; do NOT require low enemy HP before recommending the burst. Corpus reference (n=facts.refN eligible healer-lock windows in this bracket): an enemy died within 15 s of the window opening facts.refKillEntered% of the time when an offensive cooldown entered it vs facts.refKillUnentered% when none did — descriptive contrast, not causal proof; cite the numbers, do not invent others. Coach pressing offensive cooldowns the moment a hard-CC lock on the healer opens.`,
  "unsynced-burst": `- "unsynced-burst": you opened facts.spell at facts.t with zero hard CC on the enemy healer anywhere in its effect window (facts.t–facts.windowEndT) — the healer was free to answer. Same rule as missed-sync-window: syncing with a healer lock is the trigger, never a low-HP threshold. Coach lining the cooldown up with CC on the healer next time.`,
  // cd-hoarded (2026-08-30 rewrite, GH #34, decision-point shaped): facts
  // changed from the retired window-shaped predicate (facts.lateS/facts.
  // crisisT/facts.castT/facts.unresolved are gone) to a crisis-decision-point
  // shape with a corpus outcome reference, same discipline crisis-no-response
  // already established (descriptive contrast, never a causal claim, never
  // "you should have pressed <ability>").
  "cd-hoarded": `- "cd-hoarded": at facts.t facts.crisisUnit fell to facts.crisisHpPct% while taking facts.dmg2sPct% of max HP in the prior 2 s (facts.own="yes" means it was the player's own HP crossing; "no" means a teammate's) — the player had a usable major defensive cooldown ready (facts.readyCds) and spent none of them within 5 seconds. Corpus reference (n=facts.refN friendly crises with a ready defensive): the crisis unit died within 10 s facts.refDeathHeld% of the time when the ready cooldown was held vs facts.refDeathSpent% when it was spent within 5 s. This is a descriptive contrast, not causal proof, and it does not identify WHICH cooldown mattered — cite the numbers, do not prescribe a specific button.${ATTEMPTED_LEGEND_NOTE}`,
  "cd-spent-idle": `- "cd-spent-idle": facts.spell was cast at facts.t with no active enemy threat at that instant — spent into dead air instead of held for the next real window. This type only ever appears in matches with at least medium overall threat, so idle time in an otherwise-calm match is never flagged here. Coach holding survival cooldowns for genuine pressure.${COST_NORM_LEGEND_NOTE}`,
};

/** Maps a `NEW_CANDIDATE_LEGENDS` key to the `CANDIDATE_TYPE_FLAGS` field that
 * must be on for it to render — the type-string ↔ camelCase-flag spelling
 * differs (kebab-case event type vs. camelCase flag field), so this is the
 * one place that correspondence is written down. */
const NEW_CANDIDATE_TYPE_FLAG_KEY: Record<
  string,
  keyof typeof CANDIDATE_TYPE_FLAGS
> = {
  "attempt-into-trinket": "attemptIntoTrinket",
  "missed-sync-window": "missedSyncWindow",
  "unsynced-burst": "unsyncedBurst",
  "cd-hoarded": "cdHoarded",
  "cd-spent-idle": "cdSpentIdle",
};

function newCandidateLegendLines(candidates: CandidateEvent[]): string[] {
  const present = new Set(candidates.map((c) => c.type));
  return Object.entries(NEW_CANDIDATE_LEGENDS)
    .filter(
      ([type]) =>
        CANDIDATE_TYPE_FLAGS[NEW_CANDIDATE_TYPE_FLAG_KEY[type]] &&
        present.has(type),
    )
    .map(([, line]) => line);
}

// ACCURACY NOTE (2026-07-15 A/B evidence): the HARD RULES below — event-id
// menu, placeholder-only numbers, causation ban — are this prompt's version
// of the responder ACCURACY DISCIPLINE that a blind A/B measured at
// accuracy +0.71 [0.43, 1.00] (p=0.004, 42/42 claims verified) for the
// free-text eval coach. Do not weaken these constraints without an A/B.
export function buildFindingsPrompt(
  candidates: CandidateEvent[],
  richContext: string,
  specName: string,
): string {
  const menu = candidates
    .map((c) => {
      // Events with a time-specific fact show it; whole-round observations
      // (e.g. cd-waste) have no `t` fact — showing "t=0s" would tempt the model
      // to write {{t}}, which then resolves to nothing and gets discarded.
      const when =
        c.facts.t !== undefined ? `t=${c.facts.t}s` : `t=whole-round`;
      return (
        `  - id=${c.id} type=${c.type} ${when} units=${c.unitNames.join("/")}` +
        ` facts={${Object.entries(c.facts)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}}`
      );
    })
    .join("\n");
  return [
    `You are a World of Warcraft arena coach reviewing a ${specName}'s match. Produce 4-8 coaching findings as JSON — as many as the event menu genuinely supports; never fabricate, but prefer covering MORE distinct menu events over polishing few. Spread coverage across the whole match: when the menu has early/mid-game events (missed-cleanse, missed-purge, kick-eaten, bursts, kicks, targeting), do not spend every finding on the final seconds, and cover at least two non-death event types when present. At most 2 findings may be anchored solely on death events; when a death has "death-setup" events, pair them into one chain finding instead of adding another death-only item. Prioritize covering DIFFERENT event types over repeating the same one: of ${LEGACY_TYPES_LIST}, at most 3 findings TOTAL (combined across both, not 3 each) may draw from that group even when the menu offers more of them — spend your remaining picks on other types instead.`,
    ``,
    `Match context (for reasoning about the arc — do NOT cite anything not in the event menu):`,
    richContext,
    ``,
    `Event menu (the ONLY things that provably happened — every finding must reference these ids):`,
    menu || "  (none)",
    ``,
    `Event legend:`,
    `- "death": a player died. facts.side=friendly means it was one of YOUR team's deaths (a loss to coach around); facts.side=enemy means your team scored the kill (reinforce what worked).`,
    `- "cd-waste": a major defensive cooldown the player never pressed the entire match (facts.spell names it). This is a whole-round observation with no timestamp.${COST_NORM_LEGEND_NOTE}`,
    // Legends for DPS-owner event types are emitted only when the menu
    // contains that type -- a healer menu has none of them, so the healer
    // prompt stays byte-identical (D2).
    ...legendLines(CHAIN_LEGENDS, candidates),
    ...legendLines(DPS_LEGENDS, candidates),
    ...newCandidateLegendLines(candidates),
    ``,
    `HARD RULES:`,
    `- Reference only event ids from the menu (in "eventIds"). Never invent an event.`,
    `- Write NO digits at all in "explanation". Every number must be a {{key}} placeholder drawn from the referenced events' facts (e.g. {{t}}). For counts or durations you have no placeholder for, use words ("twice", "briefly", "early", "a few globals") — never a raw number. An explanation containing any bare digit will be discarded.
- When ONE finding cites MULTIPLE events, indexed placeholders are always available, numbered by your eventIds order: {{t1}} = first event's t, {{t2}} = second event's, {{duration2}}, {{cc1}}, ... Use them whenever the events share a fact key — a bare {{t}} across events with DIFFERING t values is ambiguous and gets the finding discarded.`,
    `- Do NOT assert causation. No "because … you lost", "cost you the game", "that's why", "led to the loss". State observations and suggestions only.`,
    ``,
    `Example explanation: "You went down at {{t}}s; consider holding the trinket for the first swap and using your wall a beat earlier." (numbers only via placeholders; no causation)`,
    ``,
    `Output ONLY a JSON array: [{ "eventIds": string[], "severity": "high"|"med"|"low", "category": ${CATEGORY_UNION}, "title": string, "explanation": string }]`,
    `"category" must be EXACTLY one of those slugs (lowercase, English) regardless of the reply language — it is a stable aggregation key, not display text.`,
  ].join("\n");
}
