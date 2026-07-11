/* eslint-disable no-console */
/**
 * buildJudgeCalibrationSuite.ts
 *
 * Builds a synthetic-defect calibration suite for the LLM judge — the
 * no-human-gold-standard replacement for meta-eval. We take real
 * prompt/response pairs from an existing eval corpus and inject KNOWN defects
 * (a fabricated claim, duplicated noise lines, loaded severity labels,
 * shuffled event order, a deleted death section). Because we created the
 * defect, ground truth is free: a working judge MUST score the perturbed
 * variant lower than the original on the targeted dimension.
 *
 * Blinding: case directories get opaque shuffled ids (case-NN). The mapping
 * from case id to (source ordinal, perturbation, target dimension) lives only
 * in calibration-manifest.json — the scoring agent must never read it; only
 * checkJudgeCalibration.ts does.
 *
 * Usage:
 *   npm run -w @wowarenalogs/tools start:buildJudgeCalibrationSuite
 *   BASE_DIR=… CASE_SOURCE_COUNT=5 SEED=42 npm run -w @wowarenalogs/tools start:buildJudgeCalibrationSuite
 *
 * Requires BASE_DIR to contain prompts/, responses/, index.json (i.e. a
 * completed /eval-healer-prompts run). Output:
 *   BASE_DIR/judge-calibration/cases/case-NN/{prompt.txt,response.txt}
 *   BASE_DIR/judge-calibration/calibration-manifest.json
 *   BASE_DIR/judge-calibration/scores/   (empty — the judge fills it)
 */

import fs from "fs-extra";
import path from "path";

// Deterministic LCG so the suite is reproducible for a given SEED.
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    // 除以 2^32(而非 0xffffffff):保证输出严格 < 1(review 修复,与 abCompareStats 同)
    return state / 0x100000000;
  };
}

interface IndexEntry {
  ordinal: number;
  file: string;
  matchId: string;
  spec: string;
  result: string;
}

type Perturbation =
  | "none"
  | "fabricated-claim"
  | "duplicated-noise"
  | "severity-labels"
  | "shuffled-events"
  | "removed-deaths"
  | "wrong-outcome"
  | "trivia-focus";

export interface CalibrationCase {
  caseId: string;
  sourceOrdinal: number;
  matchId: string;
  perturbation: Perturbation;
  /** Dimension the perturbed variant must score LOWER on than its 'none' sibling. */
  targetDimension: string | null;
  perturbationDetail: string;
}

/** Spells that plausibly exist in arena but are checked to be absent from this
 * prompt+response before being used as a fabricated claim. */
const FABRICATION_SPELL_POOL = [
  "Ring of Frost",
  "Mass Dispel",
  "Power Infusion",
  "Lay on Hands",
  "Dark Pact",
  "Tranquility",
  "Divine Hymn",
];

function fabricateClaim(
  promptText: string,
  responseText: string,
  rng: () => number,
): { text: string; detail: string } | null {
  const candidates = FABRICATION_SPELL_POOL.filter(
    (s) => !promptText.includes(s) && !responseText.includes(s),
  );
  if (candidates.length === 0) return null;
  const spell = candidates[Math.floor(rng() * candidates.length)];
  const fakeMin = 1 + Math.floor(rng() * 3);
  const fakeSec = 10 + Math.floor(rng() * 49);
  const claim = `\n\nA key moment worth repeating: at ${fakeMin}:${fakeSec} your ${spell} completely flipped the exchange — that cast alone bought your team the window it needed, and you should look to recreate it every game.`;
  const paragraphs = responseText.split("\n\n");
  const insertAt = Math.min(
    paragraphs.length,
    1 + Math.floor(rng() * Math.max(1, paragraphs.length - 1)),
  );
  paragraphs.splice(insertAt, 0, claim.trim());
  return {
    text: paragraphs.join("\n\n"),
    detail: `fabricated ${spell} cast at ${fakeMin}:${fakeSec}`,
  };
}

/** Lines that look like timeline events (start with a bracketed or numeric time marker). */
function isEventLine(line: string): boolean {
  return (
    /^\s*(\[?\d+[:.]?\d*s?\]?|\d+:\d{2})/.test(line) && line.trim().length > 10
  );
}

function duplicateNoise(
  promptText: string,
  rng: () => number,
): { text: string; detail: string } | null {
  const lines = promptText.split("\n");
  const eventIdx = lines
    .map((l, i) => (isEventLine(l) ? i : -1))
    .filter((i) => i >= 0);
  const pool =
    eventIdx.length > 0
      ? eventIdx
      : lines.map((_, i) => i).filter((i) => lines[i].trim().length > 10);
  if (pool.length < 5) return null;
  const dupCount = Math.max(5, Math.floor(pool.length * 0.3));
  const chosen = new Set<number>();
  for (let k = 0; k < dupCount * 3 && chosen.size < dupCount; k++) {
    chosen.add(pool[Math.floor(rng() * pool.length)]);
  }
  // Insert duplicates immediately after their source line (descending so indices stay valid).
  const sorted = [...chosen].sort((a, b) => b - a);
  for (const i of sorted) lines.splice(i + 1, 0, lines[i]);
  return {
    text: lines.join("\n"),
    detail: `duplicated ${sorted.length} event lines in place`,
  };
}

function addSeverityLabels(
  promptText: string,
  rng: () => number,
): { text: string; detail: string } | null {
  const lines = promptText.split("\n");
  const eventIdx = lines
    .map((l, i) => (isEventLine(l) ? i : -1))
    .filter((i) => i >= 0);
  const pool =
    eventIdx.length > 0
      ? eventIdx
      : lines.map((_, i) => i).filter((i) => lines[i].trim().length > 10);
  if (pool.length < 5) return null;
  const labelCount = Math.min(10, Math.max(5, Math.floor(pool.length * 0.1)));
  const labels = ["[CRITICAL] ", "[DISASTROUS] ", "[CRITICAL FAILURE] "];
  const chosen = new Set<number>();
  for (let k = 0; k < labelCount * 3 && chosen.size < labelCount; k++) {
    chosen.add(pool[Math.floor(rng() * pool.length)]);
  }
  for (const i of chosen) {
    const label = labels[Math.floor(rng() * labels.length)];
    lines[i] = lines[i].replace(/^(\s*)/, `$1${label}`);
  }
  return {
    text: lines.join("\n"),
    detail: `prefixed ${chosen.size} ordinary event lines with loaded severity labels`,
  };
}

function shuffleEvents(
  promptText: string,
  rng: () => number,
): { text: string; detail: string } | null {
  const lines = promptText.split("\n");
  const eventIdx = lines
    .map((l, i) => (isEventLine(l) ? i : -1))
    .filter((i) => i >= 0);
  if (eventIdx.length < 12) return null;
  // Shuffle the middle half of the event lines among their own positions.
  const start = Math.floor(eventIdx.length / 4);
  const slice = eventIdx.slice(start, start + Math.floor(eventIdx.length / 2));
  const contents = slice.map((i) => lines[i]);
  for (let i = contents.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [contents[i], contents[j]] = [contents[j], contents[i]];
  }
  slice.forEach((lineIdx, k) => {
    lines[lineIdx] = contents[k];
  });
  return {
    text: lines.join("\n"),
    detail: `shuffled ${slice.length} timeline lines out of chronological order`,
  };
}

/** wrong-outcome → outcomeAlignment: frame the coaching around the OPPOSITE
 * result. The body stays untouched (no new factual claims), but the opener and
 * closer now assert a result that contradicts the prompt's match outcome. */
function wrongOutcome(
  responseText: string,
  result: string,
): { text: string; detail: string } | null {
  if (result !== "Win" && result !== "Loss") return null;
  const framing =
    result === "Win"
      ? {
          opener:
            "Tough loss. This one slipped away, and the defeat traces directly back to your healing decisions — the patterns below are what cost your team the match, and fixing them is how you stop losing games exactly like this one.",
          closer:
            "Bottom line: this loss was preventable. Until these leaks are fixed, expect this matchup to keep ending in defeat.",
        }
      : {
          opener:
            "Great win! This victory was carried by your healing — the notes below are polish on what was already a winning performance, and the takeaway is to keep doing exactly what you did here.",
          closer:
            "Bottom line: a well-earned victory. Keep replicating this game plan and this comp will stay a favorable matchup.",
        };
  return {
    text: `${framing.opener}\n\n${responseText.trim()}\n\n${framing.closer}`,
    detail: `reframed a ${result} as a ${result === "Win" ? "loss" : "win"} in the opener and closer`,
  };
}

/** trivia-focus → focusCalibration: make generic low-stakes coaching dominate
 * the response. No fabricated match facts — the injected section is
 * deliberately vacuous boilerplate, and the original analysis is demoted to a
 * "secondary notes" appendix. */
function triviaFocus(responseText: string): { text: string; detail: string } {
  const trivia = [
    "**The single most important area to work on: pre-match preparation and early positioning.**",
    "",
    "Before the gates even opened, there was room to optimize. Think carefully about where you stand in the opening seconds: a healer who begins the match two or three yards closer to a pillar has meaningfully better options later. Review your keybinds before queueing — every re-bound ability saves fractions of a second across a match, and those fractions add up. Consider your camera zoom as well; a wider field of view in the opener helps you see swaps earlier.",
    "",
    "Equally important is your early filler-cast rhythm. In the first ten seconds, prioritize establishing a comfortable cast cadence over reacting to enemy movement. Many healers rush their first few globals; a calm opener sets the tone for the entire match. Practice your opening sequence in skirmishes until it is automatic.",
    "",
    "Finally, spend time on macro hygiene: mouseover macros, focus macros, and a consistent trinket keybind. None of these decided this particular match, but they are the foundation everything else is built on, and they deserve the bulk of your practice time this week.",
    "",
    "---",
    "",
    "Secondary notes from this specific match (lower priority than the fundamentals above):",
    "",
  ].join("\n");
  return {
    text: trivia + responseText.trim(),
    detail:
      "prepended a dominant generic-trivia section and demoted the real analysis to secondary notes",
  };
}

function removeDeaths(
  promptText: string,
): { text: string; detail: string } | null {
  const lines = promptText.split("\n");
  const kept = lines.filter(
    (l) => !/death|died|dies|killed|\[DEATH\]/i.test(l),
  );
  const removed = lines.length - kept.length;
  if (removed === 0) return null;
  return {
    text: kept.join("\n"),
    detail: `removed all ${removed} death-related lines`,
  };
}

export async function buildCalibrationSuite(
  baseDir: string,
  opts: { sourceCount: number; seed: number },
): Promise<CalibrationCase[]> {
  const outDir = path.join(baseDir, "judge-calibration");
  const indexFile = path.join(baseDir, "index.json");
  const responsesDir = path.join(baseDir, "responses");
  if (
    !(await fs.pathExists(indexFile)) ||
    !(await fs.pathExists(responsesDir))
  ) {
    throw new Error(
      `Need ${baseDir}/index.json and ${baseDir}/responses/ — run /eval-healer-prompts first so real prompt/response pairs exist.`,
    );
  }
  const entries = (await fs.readJson(indexFile)) as IndexEntry[];
  const rng = makeRng(opts.seed);

  // Pick source matches that have both a prompt and a non-empty response.
  const sources: { entry: IndexEntry; prompt: string; response: string }[] = [];
  for (const entry of entries) {
    if (sources.length >= opts.sourceCount) break;
    const ordinalStr = String(entry.ordinal).padStart(3, "0");
    const promptPath = path.join(baseDir, entry.file);
    const responsePath = path.join(responsesDir, `${ordinalStr}.txt`);
    if (
      !(await fs.pathExists(promptPath)) ||
      !(await fs.pathExists(responsePath))
    )
      continue;
    const prompt = await fs.readFile(promptPath, "utf8");
    let response = (await fs.readFile(responsePath, "utf8")).trim();
    // Ordinal-integrity guard (same as blindAbPool): a stale responses/ dir
    // left over from an older corpus would silently pair the wrong response
    // with this prompt. Verify the MATCHID header, then strip it.
    const headerMatch = response.match(/^MATCHID:\s*(\S+)\s*\n/);
    if (headerMatch) {
      if (headerMatch[1] !== entry.matchId) {
        console.warn(
          `  ${ordinalStr}: MATCHID header (${headerMatch[1]}) != index (${entry.matchId}) — skipped`,
        );
        continue;
      }
      response = response.slice(headerMatch[0].length).trim();
    }
    if (response.length < 200) continue;
    sources.push({ entry, prompt, response });
  }
  if (sources.length === 0) {
    throw new Error("No usable prompt/response pairs found.");
  }

  await fs.remove(outDir);
  await fs.ensureDir(path.join(outDir, "scores"));

  const cases: CalibrationCase[] = [];
  const pending: { c: CalibrationCase; prompt: string; response: string }[] =
    [];

  for (const { entry, prompt, response } of sources) {
    // Local RNG per case prevents inter-case RNG propagation and ensures single-case reproducibility
    const localRng = makeRng(opts.seed + entry.ordinal);

    const push = (
      perturbation: Perturbation,
      targetDimension: string | null,
      promptText: string,
      responseText: string,
      detail: string,
    ) => {
      const c: CalibrationCase = {
        caseId: "", // assigned after shuffle
        sourceOrdinal: entry.ordinal,
        matchId: entry.matchId,
        perturbation,
        targetDimension,
        perturbationDetail: detail,
      };
      pending.push({ c, prompt: promptText, response: responseText });
    };

    push("none", null, prompt, response, "unmodified original");

    const fab = fabricateClaim(prompt, response, localRng);
    if (fab) push("fabricated-claim", "accuracy", prompt, fab.text, fab.detail);

    const noise = duplicateNoise(prompt, localRng);
    if (noise)
      push("duplicated-noise", "noise", noise.text, response, noise.detail);

    const bias = addSeverityLabels(prompt, localRng);
    if (bias)
      push("severity-labels", "labelBias", bias.text, response, bias.detail);

    const shuffled = shuffleEvents(prompt, localRng);
    if (shuffled)
      push(
        "shuffled-events",
        "inferenceScaffolding",
        shuffled.text,
        response,
        shuffled.detail,
      );

    const noDeaths = removeDeaths(prompt);
    if (noDeaths)
      push(
        "removed-deaths",
        "sufficiency",
        noDeaths.text,
        response,
        noDeaths.detail,
      );

    const outcome = wrongOutcome(response, entry.result);
    if (outcome)
      push(
        "wrong-outcome",
        "outcomeAlignment",
        prompt,
        outcome.text,
        outcome.detail,
      );

    const trivia = triviaFocus(response);
    push(
      "trivia-focus",
      "focusCalibration",
      prompt,
      trivia.text,
      trivia.detail,
    );
  }

  // Shuffle case order and assign opaque ids so the scoring agent cannot infer
  // which cases are siblings or which are perturbed.
  for (let i = pending.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pending[i], pending[j]] = [pending[j], pending[i]];
  }
  for (let i = 0; i < pending.length; i++) {
    const caseId = `case-${String(i + 1).padStart(2, "0")}`;
    pending[i].c.caseId = caseId;
    const caseDir = path.join(outDir, "cases", caseId);
    await fs.ensureDir(caseDir);
    await fs.writeFile(
      path.join(caseDir, "prompt.txt"),
      pending[i].prompt,
      "utf8",
    );
    await fs.writeFile(
      path.join(caseDir, "response.txt"),
      pending[i].response,
      "utf8",
    );
    cases.push(pending[i].c);
  }

  await fs.writeJson(
    path.join(outDir, "calibration-manifest.json"),
    { seed: opts.seed, generatedAt: new Date().toISOString(), cases },
    { spaces: 2 },
  );

  const perturbedCount = cases.filter((c) => c.perturbation !== "none").length;
  console.log(
    `Wrote ${cases.length} cases (${sources.length} originals + ${perturbedCount} perturbed) to ${outDir}/cases/`,
  );
  console.log(
    `Manifest (DO NOT show to the scoring agent): ${path.join(outDir, "calibration-manifest.json")}`,
  );
  console.log(
    "Next: follow docs/commands/calibrate-judge.md — blind-score every case, then run start:checkJudgeCalibration.",
  );

  return cases;
}
