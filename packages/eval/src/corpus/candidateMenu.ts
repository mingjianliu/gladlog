/**
 * Shared candidate-menu extraction: parse a raw combat log's text into
 * matches (incl. shuffle rounds), and for each pick the friendly-healer
 * owner's extractCandidateFindings() output.
 *
 * This is the exact pipeline smokeFindingsPrompt.ts hand-rolled inline
 * (GladLogParser → toLegacyMatch → friendly-healer owner →
 * extractCandidateFindings); pulled out here so a second consumer
 * (hindsightScan.ts, which needs menus from *every* match in a log, not just
 * the first one that satisfies a type-richness filter) doesn't hand-roll a
 * third copy. smokeFindingsPrompt.ts now imports this too.
 */
import { type CandidateEvent, isHealerSpec } from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { CombatUnitReaction, toLegacyMatch } from "@gladlog/parser-compat";

import { candidatesAsTheAppRuns } from "./appCandidates";

interface ParsedCombat {
  /** Raw GladMatch id — buildCorpus.ts uses the same id (incl. for shuffle
   *  rounds, which the parser hands over as GladMatch-shaped) as
   *  IndexEntry.matchId, so this is the join key back to a built corpus. */
  id: string;
  legacy: ReturnType<typeof toLegacyMatch>;
  /** The whole log text — the raw streams are sliced from it per round
   *  (`candidatesAsTheAppRuns`). */
  rawText: string;
}

/** Parse every match / shuffle-round out of one raw combat log's text. */
export function parseLogCombats(text: string): ParsedCombat[] {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  return items.map((m) => ({
    id: m.id,
    legacy: toLegacyMatch({ ...m, rawLines: [] } as GladMatch),
    rawText: text,
  }));
}

/** The friendly-healer owner (smokeFindingsPrompt.ts's original selection
 *  rule) plus their candidate-finding menu; undefined if this combat has no
 *  friendly healer. Player/unit shape is loosely typed at this parser-compat
 *  boundary, matching the original inline code. */
export function healerOwnerMenu(
  legacy: ParsedCombat["legacy"],
  rawText?: string | null,
): { owner: any; candidates: CandidateEvent[] } | undefined {
  const players = (Object.values(legacy.units) as any[]).filter((u) => u.info);
  const owner = players.find(
    (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
  );
  if (!owner) return undefined;
  return {
    owner,
    candidates: candidatesAsTheAppRuns(legacy, owner.id, rawText),
  };
}
