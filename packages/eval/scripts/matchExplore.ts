/**
 * matchExplore.ts CLI — dumb shell over `../src/explore/{storeAccess,matchExplore}.ts`
 * for the deep-dive review agent to drive interactively. Per the plan's
 * global constraint, this file writes ZERO new logic (it is not covered by
 * `npm run typecheck`, so any logic here would be untested logic) — it only
 * parses `argv`, wires the two calls, and prints their string arrays.
 *
 *   npx tsx packages/eval/scripts/matchExplore.ts pick [--min-duration 120] [--store <dir>]
 *   npx tsx packages/eval/scripts/matchExplore.ts <matchId> [--round N] [--store <dir>] <sub> [--t X | --from A --to B [--step S]]
 *
 * `pick` lists local-library rows (id / kind / 时长 / playerName / result /
 * bracket, tab-separated, header on line 1) via `loadIndex` + `pickRows`. The
 * second form loads one round (`loadLegacyRound`, `--round` is an ARRAY INDEX
 * into `doc.data.rounds`, not `sequenceNumber` — see storeAccess.ts's own
 * header) and hands the trailing `<sub> [flags…]` slice straight to the
 * shared `runQuery` dispatch untouched — this script never re-derives how a
 * subcommand's own flags (`--t`/`--from`/`--to`/`--step`) are parsed.
 *
 * Locating that trailing slice robustly (across `parseArgs`'s `strict:
 * false` misclassifying an unrecognized flag like `--t` as a valueless
 * option rather than a positional — verified interactively) is done via
 * `tokens: true`: the subcommand's *raw* index into the original `args`
 * array is read off its positional token, and everything from that index
 * onward is passed to `runQuery` byte-for-byte.
 *
 * `mana`/`drink` (BACKLOG #26 Task 5) are the only two subcommands that
 * touch raw.txt: this shell loads it through `storeAccess.ts`'s
 * `rawStreamsForRound` (the same loader `buildSession`'s prescreen uses —
 * `readRawText` + `parseRawStreams`, baseMs = the loaded round's OWN `startTime`, clamped to
 * that round's OWN `(endTime-startTime)/1000` duration — BACKLOG #32,
 * see `matchExplore.ts`'s module header for why that base and no other) ONLY
 * when the trailing subcommand is one of those two, so the other eight
 * query kinds never pay for a raw.txt read they don't need. The duration arg
 * is what keeps a Solo Shuffle round's `mana`/`drink` output from silently
 * describing another round of the same lobby's raw.txt.
 */
import { parseArgs } from "node:util";

import { ensureAnalysisData, fmtTime } from "@gladlog/analysis";

import { runQuery } from "../src/explore/matchExplore.js";
import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  RAW_STREAM_SUBCOMMANDS,
  rawStreamsForRound,
} from "../src/explore/storeAccess.js";

const USAGE = `usage:
  matchExplore.ts pick [--min-duration N] [--store <dir>]
  matchExplore.ts <matchId> [--round N] [--store <dir>] <sub> [--t S | --from S --to S [--step S] | --unit X]`;

await ensureAnalysisData();

const args = process.argv.slice(2);
const { values, tokens } = parseArgs({
  args,
  options: {
    store: { type: "string" },
    round: { type: "string" },
    "min-duration": { type: "string" },
  },
  allowPositionals: true,
  strict: false,
  tokens: true,
});

const positionalTokens = tokens.filter((t) => t.kind === "positional");
// `strict: false` widens parseArgs's `values` type to `string | boolean`
// (unknown flags can parse as booleans); `store` is declared `type:
// "string"` above, so it is only ever a string or absent — narrow here
// rather than trust the loosened inference.
const matchesDir =
  typeof values.store === "string" ? values.store : DEFAULT_MATCH_DIR;

try {
  const first = positionalTokens[0]?.value;
  if (first === undefined) throw new Error(USAGE);

  if (first === "pick") {
    const minDurationS = Number(values["min-duration"] ?? 0);
    const rows = pickRows(loadIndex(matchesDir), { minDurationS });
    const lines = [
      ["id", "kind", "时长", "playerName", "result", "bracket"].join("\t"),
      ...rows.map((r) =>
        [
          r.id,
          r.kind ?? "",
          r.durationS !== undefined ? fmtTime(r.durationS) : "",
          r.playerName ?? "",
          r.result ?? "",
          r.bracket ?? "",
        ].join("\t"),
      ),
    ];
    console.log(lines.join("\n"));
  } else {
    const matchId = first;
    const roundSeq =
      values.round !== undefined ? Number(values.round) : undefined;
    const subToken = positionalTokens[1];
    if (!subToken) throw new Error(USAGE);

    const { legacy } = loadLegacyRound(matchesDir, matchId, roundSeq);
    const rawStreams = RAW_STREAM_SUBCOMMANDS.has(subToken.value)
      ? rawStreamsForRound(matchesDir, matchId, legacy)
      : undefined;
    const queryArgv = args.slice(subToken.index);
    console.log(runQuery(legacy, queryArgv, rawStreams).join("\n"));
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error(USAGE);
  process.exit(1);
}
