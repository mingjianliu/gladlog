import type { CandidateEvent } from "./types";

const DPS_LEGENDS: Record<string, string> = {
  "burst-into-immunity": `- "burst-into-immunity": you opened offensive cooldowns (facts.spell) while the target had a full immunity running (facts.immunity, active facts.overlap seconds of the burst). Coach burst timing or a target swap.`,
  "off-target-in-window": `- "off-target-in-window": during a kill window on facts.target, only facts.onTargetPct percent of your damage landed on that target (facts.offTarget absorbed the most). Coach target discipline.`,
  "juked-kick": `- "juked-kick": your interrupt (facts.kick) was baited out by a fake cast (facts.fake) — the enemy cancelled and you kicked air. Coach kick patience/holding for the real cast.`,
  "dr-clipped-cc": `- "dr-clipped-cc": your CC (facts.spell) landed on facts.target at facts.dr diminishing returns (only facts.duration seconds). Coach CC sequencing with your team.`,
};

function dpsLegendLines(candidates: CandidateEvent[]): string[] {
  const present = new Set(candidates.map((c) => c.type));
  return Object.entries(DPS_LEGENDS)
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
    `You are a World of Warcraft arena coach reviewing a ${specName}'s match. Produce a short list of coaching findings as JSON.`,
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
    ...dpsLegendLines(candidates),
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
