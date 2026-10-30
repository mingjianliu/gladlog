/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy round objects are untyped, as in buildCorpus */
/**
 * The rounds `buildCorpus` must write for one log and one owner view, counted
 * straight from the parser (a match is one round, a shuffle one per round)
 * and kept only where the shared `selectCorpusOwner` finds an owner — the one
 * skip buildCorpus is allowed. A gate run compares its entries against this,
 * so no swallowed error can shrink the set it checks (codex 30-RV-01 #3).
 */
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "fs";

import { selectCorpusOwner } from "../../src/corpus/buildCorpus";

export function expectedCorpusRoundIds(
  logPath: string,
  ownerFilter: "healer" | "dps" | "recorder",
): string[] {
  const rounds: { id: string; combat: any }[] = [];
  const parser = new GladLogParser();
  parser.on("match", (m: any) =>
    rounds.push({ id: m.id, combat: toLegacyMatch(m) }),
  );
  parser.on("shuffle", (sh: any) =>
    (toLegacyShuffle(sh).rounds ?? []).forEach((combat: any, i: number) =>
      rounds.push({
        id: sh.rounds[i]?.id ?? `${sh.rounds[0]?.id}-r${i}`,
        combat,
      }),
    ),
  );
  for (const line of readFileSync(logPath, "utf-8").split("\n"))
    parser.push(line);
  parser.end();
  return rounds
    .filter(({ combat }) => {
      const players = Object.values(combat.units as object).filter(
        (u: any) => u.info,
      );
      return selectCorpusOwner(players, combat, ownerFilter) !== null;
    })
    .map((r) => r.id);
}
