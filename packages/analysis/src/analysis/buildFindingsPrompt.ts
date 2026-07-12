import type { CandidateEvent } from "./types";

export function buildFindingsPrompt(
  candidates: CandidateEvent[],
  richContext: string,
  specName: string,
): string {
  const menu = candidates
    .map(
      (c) =>
        `  - id=${c.id} type=${c.type} t=${c.t}s units=${c.unitNames.join("/")}` +
        ` facts={${Object.entries(c.facts)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}}`,
    )
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
