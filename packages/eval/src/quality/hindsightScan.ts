/* eslint-disable no-console */
/**
 * hindsightScan.ts — corpus tool for the hindsight-bias predicate
 * (hindsightViolations, packages/analysis/src/analysis/hindsightLint.ts).
 *
 * Two modes:
 *  --synthesize: sample real candidate menus from a built run's corpus (via
 *    candidateMenu.ts — the same GladLogParser → toLegacyMatch →
 *    friendly-healer owner → extractCandidateFindings pipeline
 *    smokeFindingsPrompt.ts hand-rolled), synthesize up to N PLANTED
 *    violations (cross-type pairs >HINDSIGHT_CLUSTER_SLACK_S apart — must all
 *    be caught) and up to N LEGIT references (same-type pairs / clustered
 *    cross-type pairs / single-event refs — must all pass), run the predicate
 *    over each, and report "planted caught X/N, legit passed Y/N".
 *  --check <jsonl>: smoke-recheck arbitrary {eventIds, candidates} lines
 *    (e.g. captured from a real audit run) and report violations by line.
 *
 * The sampling/synthesis/judging core (synthesizePlanted, synthesizeLegit,
 * sampleSynthesis, checkLine) is pure — testable with a hand-built menu, no
 * fs/corpus involved. Only runSynthesize/runCheck touch disk.
 */
import {
  type CandidateEvent,
  HINDSIGHT_CLUSTER_SLACK_S,
  hindsightViolations,
} from "@gladlog/analysis";
import fs from "fs-extra";
import path from "path";

import type { IndexEntry } from "../corpus/buildCorpus";
import { healerOwnerMenu, parseLogCombats } from "../corpus/candidateMenu";

interface CandidateMenu {
  matchId: string;
  ordinal: number;
  candidates: CandidateEvent[];
}

interface SynthesizedItem {
  matchId: string;
  ordinal: number;
  eventIds: string[];
}

function timedEvents(
  menu: CandidateEvent[],
): Array<{ e: CandidateEvent; t: number }> {
  return menu
    .filter((e) => e.facts.t !== undefined)
    .map((e) => ({ e, t: Number(e.facts.t) }))
    .filter(({ t }) => Number.isFinite(t));
}

/**
 * Every cross-type pair in `menu` more than HINDSIGHT_CLUSTER_SLACK_S apart
 * (rendered facts.t) — each is a planted hindsight violation: the predicate
 * must catch every single one.
 */
export function synthesizePlanted(
  menu: CandidateEvent[],
): Array<{ eventIds: [string, string] }> {
  const timed = timedEvents(menu);
  const out: Array<{ eventIds: [string, string] }> = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.e.type === b.e.type) continue;
      if (Math.abs(a.t - b.t) <= HINDSIGHT_CLUSTER_SLACK_S) continue;
      out.push({ eventIds: [a.e.id, b.e.id] });
    }
  }
  return out;
}

/**
 * Legit references the predicate must let through: same-type pairs (any
 * distance — pattern exemption), cross-type pairs within the cluster window,
 * and single-event references (e.g. a death-setup anchor referenced alone —
 * fewer than 2 timed events never trips the predicate).
 */
export function synthesizeLegit(
  menu: CandidateEvent[],
): Array<{ eventIds: string[] }> {
  const timed = timedEvents(menu);
  const out: Array<{ eventIds: string[] }> = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      const sameType = a.e.type === b.e.type;
      const clustered = Math.abs(a.t - b.t) <= HINDSIGHT_CLUSTER_SLACK_S;
      if (sameType || clustered) out.push({ eventIds: [a.e.id, b.e.id] });
    }
  }
  // death-setup-style single-event references — a death anchor referenced
  // alone if this menu has one, then whatever else is on the menu (whole-round
  // events with no facts.t included too, since a single reference is always
  // safe regardless of facts.t presence).
  const singles = [...menu].sort(
    (x, y) => Number(y.type === "death") - Number(x.type === "death"),
  );
  for (const e of singles) out.push({ eventIds: [e.id] });
  return out;
}

/**
 * Fold synthesizePlanted/synthesizeLegit across many real menus, capping each
 * bucket at `limit` — honest about the actual count when the corpus can't
 * fill it (never pads or over-reports).
 */
export function sampleSynthesis(
  menus: CandidateMenu[],
  limit = 20,
): { planted: SynthesizedItem[]; legit: SynthesizedItem[] } {
  const planted: SynthesizedItem[] = [];
  const legit: SynthesizedItem[] = [];
  for (const m of menus) {
    if (planted.length < limit) {
      for (const p of synthesizePlanted(m.candidates)) {
        if (planted.length >= limit) break;
        planted.push({
          matchId: m.matchId,
          ordinal: m.ordinal,
          eventIds: p.eventIds,
        });
      }
    }
    if (legit.length < limit) {
      for (const l of synthesizeLegit(m.candidates)) {
        if (legit.length >= limit) break;
        legit.push({
          matchId: m.matchId,
          ordinal: m.ordinal,
          eventIds: l.eventIds,
        });
      }
    }
    if (planted.length >= limit && legit.length >= limit) break;
  }
  return { planted, legit };
}

interface CheckLineInput {
  eventIds: string[];
  candidates: CandidateEvent[];
}

/**
 * Run the predicate over one self-contained {eventIds, candidates} line (the
 * --check jsonl shape: a smoke-recheck sample, no corpus lookup needed).
 */
export function checkLine(line: CheckLineInput): string[] {
  const byId = new Map(line.candidates.map((c) => [c.id, c] as const));
  return hindsightViolations(line.eventIds, byId);
}

// ── IO: --synthesize ────────────────────────────────────────────────────

async function loadMenusFromRun(
  baseDir: string,
  manifestPath: string,
): Promise<CandidateMenu[]> {
  const indexFile = path.join(baseDir, "index.json");
  if (!(await fs.pathExists(indexFile))) {
    throw new Error(
      `No index.json under ${baseDir} — build a corpus first (buildCorpus.ts).`,
    );
  }
  const entries = (await fs.readJson(indexFile)) as IndexEntry[];
  const entryByMatchId = new Map(entries.map((e) => [e.matchId, e]));

  const logPaths = (await fs.readFile(manifestPath, "utf-8"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const menus: CandidateMenu[] = [];
  for (const logPath of logPaths) {
    let text: string;
    try {
      text = await fs.readFile(logPath, "utf-8");
    } catch (err) {
      console.warn(`WARN: ${logPath}: ${err}`);
      continue;
    }
    for (const { id, legacy, rawText } of parseLogCombats(text)) {
      const entry = entryByMatchId.get(id);
      if (!entry) continue;
      let menu;
      try {
        menu = healerOwnerMenu(legacy, rawText);
      } catch {
        continue;
      }
      if (!menu || menu.candidates.length === 0) continue;
      menus.push({
        matchId: id,
        ordinal: entry.ordinal,
        candidates: menu.candidates,
      });
    }
  }
  return menus;
}

function fmtEvent(byId: Map<string, CandidateEvent>, id: string): string {
  const e = byId.get(id);
  if (!e) return `${id}(?)`;
  return `${id}(t=${e.facts.t ?? "whole-round"},type=${e.type})`;
}

export async function runSynthesize(opts: {
  baseDir: string;
  manifestPath: string;
  limit?: number;
}): Promise<void> {
  const limit = opts.limit ?? 20;
  const menus = await loadMenusFromRun(opts.baseDir, opts.manifestPath);
  const candByMatch = new Map(menus.map((m) => [m.matchId, m.candidates]));
  const { planted, legit } = sampleSynthesis(menus, limit);

  const evaluate = (item: SynthesizedItem) => {
    const candidates = candByMatch.get(item.matchId) ?? [];
    const byId = new Map(candidates.map((c) => [c.id, c] as const));
    return {
      item,
      byId,
      violations: hindsightViolations(item.eventIds, byId),
    };
  };

  const plantedResults = planted.map(evaluate);
  const legitResults = legit.map(evaluate);
  const caught = plantedResults.filter((r) => r.violations.length > 0).length;
  const passed = legitResults.filter((r) => r.violations.length === 0).length;

  console.log(
    `menus scanned: ${menus.length} (from ${new Set(menus.map((m) => m.matchId)).size} match(es), manifest=${opts.manifestPath})`,
  );
  console.log(
    `planted caught ${caught}/${planted.length}, legit passed ${passed}/${legit.length}`,
  );
  if (planted.length < limit)
    console.log(
      `  (only ${planted.length}/${limit} planted samples available in this corpus — not padded)`,
    );
  if (legit.length < limit)
    console.log(
      `  (only ${legit.length}/${limit} legit samples available in this corpus — not padded)`,
    );

  console.log("\nplanted:");
  for (const r of plantedResults) {
    const verdict =
      r.violations.length > 0
        ? "CAUGHT"
        : `MISSED (expected a violation, got none)`;
    console.log(
      `  [${r.item.matchId}/${String(r.item.ordinal).padStart(3, "0")}] ` +
        r.item.eventIds.map((id) => fmtEvent(r.byId, id)).join(" , ") +
        ` -> ${verdict}`,
    );
  }

  console.log("\nlegit:");
  for (const r of legitResults) {
    const verdict =
      r.violations.length === 0
        ? "PASSED"
        : `FALSE-POSITIVE: ${r.violations.join("; ")}`;
    console.log(
      `  [${r.item.matchId}/${String(r.item.ordinal).padStart(3, "0")}] ` +
        r.item.eventIds.map((id) => fmtEvent(r.byId, id)).join(" , ") +
        ` -> ${verdict}`,
    );
  }
}

// ── IO: --check ─────────────────────────────────────────────────────────

export async function runCheck(jsonlPath: string): Promise<void> {
  const lines = (await fs.readFile(jsonlPath, "utf-8"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let violCount = 0;
  lines.forEach((line, idx) => {
    let parsed: CheckLineInput;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      console.error(`line ${idx + 1}: bad JSON (${err})`);
      return;
    }
    const violations = checkLine(parsed);
    if (violations.length > 0) {
      violCount++;
      console.log(`line ${idx + 1}: ${violations.length} violation(s)`);
      for (const v of violations) console.log(`  ${v}`);
    }
  });
  console.log(
    `\n${violCount}/${lines.length} line(s) with hindsight violations`,
  );
}
