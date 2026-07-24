import type { CandidateEvent } from "./types";

const DPS_LEGENDS: Record<string, string> = {
  "unconverted-burst": `- "unconverted-burst": your offensive cooldowns (facts.spell) put facts.damageM M damage on facts.target but it did NOT convert — target survived with HP facts.hpStart% → facts.hpEnd% (facts.defensive names a damage reduction that was up, if any; facts.allyAligned says whether an ally offensive CD overlapped). Coach setup: pair the burst with CC on the healer, align with ally CDs, or pick a target without a defensive ready.`,
  "burst-into-immunity": `- "burst-into-immunity": you opened offensive cooldowns (facts.spell) while the target had a full immunity running (facts.immunity, active facts.overlap seconds of the burst). Coach burst timing or a target swap.`,
  "off-target-in-window": `- "off-target-in-window": during a kill window on facts.target, only facts.onTargetPct percent of your damage landed on that target (facts.offTarget absorbed the most). Coach target discipline.`,
  "juked-kick": `- "juked-kick": your interrupt (facts.kick) was baited out by a fake cast (facts.fake) — the enemy cancelled and you kicked air. Coach kick patience/holding for the real cast.`,
  "dr-clipped-cc": `- "dr-clipped-cc": your CC (facts.spell) landed on facts.target at facts.dr diminishing returns (only facts.duration seconds). Coach CC sequencing with your team.`,
};

/** 所有 owner 视角通用的条件图例(菜单出现该类型才输出;无该类型时 prompt 字节不变)。 */
const CHAIN_LEGENDS: Record<string, string> = {
  "missed-cleanse": `- "missed-cleanse": a high-value enemy CC (facts.cc, facts.priority) sat on ally facts.target for facts.duration seconds without a friendly dispel while a cleanse was available; the target ate facts.postCcDamageK k damage right after it landed. Coach dispel priority/awareness.`,
  "missed-purge": `- "missed-purge": enemy facts.enemy kept a high-value buff (facts.buff, facts.priority) running facts.duration seconds without being purged while a purge was available (facts.inKillWindow says it overlapped your team's kill window). Coach offensive dispel usage.`,
  "cc-locked": `- "cc-locked": you sat in hard CC (facts.cc from facts.source) for facts.duration seconds taking facts.damageTakenK k damage. facts.trinketState matters: "available_unused" = trinket was in hand the whole time (coach trinket decision); "on_cooldown" = coach positioning/spacing so the chain could not start. Do not coach "use your trinket" when trinketState is on_cooldown.`,
  "kick-eaten": `- "kick-eaten": your hardcast (facts.interrupted) was interrupted by facts.source's facts.kick, locking the school for facts.lockout seconds. Coach fake-casting / juking the kick.`,
  "death-setup": `- "death-setup": a precursor moment tied to a later friendly death at facts.deathT (facts.kind: "healer-locked" = the healer was CC'd through the kill window; "trinket-early" = the victim's trinket was spent at facts.t and still down when they died in CC; "defensive-early" = a major defensive was spent early per the timing audit and unavailable at death). For a chain finding, anchor on the death-setup event id(s) ALONE — their facts already carry both {{t}} (the setup moment) and {{deathT}} (the death); do NOT also reference the death event id, whose own t differs and would make {{t}} ambiguous. Describe the sequence neutrally — "at {{t}}s X happened; at {{deathT}}s the death followed" — and suggest what to do differently at the setup moment. The no-causation hard rule still applies: never write that the setup "led to"/"caused"/"resulted in" the death.`,
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
    `You are a World of Warcraft arena coach reviewing a ${specName}'s match. Produce 4-8 coaching findings as JSON — as many as the event menu genuinely supports; never fabricate, but prefer covering MORE distinct menu events over polishing few. Spread coverage across the whole match: when the menu has early/mid-game events (missed-cleanse, missed-purge, cc-locked, kick-eaten, bursts, kicks, targeting), do not spend every finding on the final seconds, and cover at least two non-death event types when present. At most 2 findings may be anchored solely on death events; when a death has "death-setup" events, pair them into one chain finding instead of adding another death-only item.`,
    ``,
    `Match context (for reasoning about the arc — do NOT cite anything not in the event menu):`,
    richContext,
    ``,
    `Event menu (the ONLY things that provably happened — every finding must reference these ids):`,
    menu || "  (none)",
    ``,
    `Event legend:`,
    `- "death": a player died. facts.side=friendly means it was one of YOUR team's deaths (a loss to coach around); facts.side=enemy means your team scored the kill (reinforce what worked).`,
    `- "cd-waste": a major defensive cooldown the player never pressed the entire match (facts.spell names it). This is a whole-round observation with no timestamp.`,
    // DPS-owner 事件类型的 legend 只在菜单里出现该类型时输出 —— 治疗菜单无
    // 这些类型,治疗 prompt 保持字节不变(D2)。
    ...legendLines(CHAIN_LEGENDS, candidates),
    ...legendLines(DPS_LEGENDS, candidates),
    ``,
    `HARD RULES:`,
    `- Reference only event ids from the menu (in "eventIds"). Never invent an event.`,
    `- Write NO digits at all in "explanation". Every number must be a {{key}} placeholder drawn from the referenced events' facts (e.g. {{t}}). For counts or durations you have no placeholder for, use words ("twice", "briefly", "early", "a few globals") — never a raw number. An explanation containing any bare digit will be discarded.`,
    `- Do NOT assert causation. No "because … you lost", "cost you the game", "that's why", "led to the loss". State observations and suggestions only.`,
    ``,
    `Example explanation: "You went down at {{t}}s; consider holding the trinket for the first swap and using your wall a beat earlier." (numbers only via placeholders; no causation)`,
    ``,
    `Output ONLY a JSON array: [{ "eventIds": string[], "severity": "high"|"med"|"low", "category": string, "title": string, "explanation": string }]`,
  ].join("\n");
}
