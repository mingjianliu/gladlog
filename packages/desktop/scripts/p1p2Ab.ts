/**
 * P1/P2/raw-streams candidate-type A/B harness (Task 6 + Task 7,
 * raw-streams plan, 2026-08-15): missedSyncWindow/unsyncedBurst/cdHoarded/
 * cdSpentIdle/manaPressure/manaEfficiency, each vs all-flags-off. Runs the
 * REAL production findings chain end to end — the exact same chain
 * `smokeFindingsBackends.ts` already exercises for its diversity smoke
 * (never a second implementation, CLAUDE.md shared-predicate rule):
 *   toLegacySafe → extractCandidateFindings → buildMatchContext →
 *   buildFindingsPrompt → claudeCli backend (model=claude-sonnet-5, the
 *   AI_DEFAULT_MODEL.claudeCli default — "responder = sonnet" per dispatch)
 *   → parseModelJsonArray (one retry on null) → auditFindings
 *
 * Arms differ ONLY by `CANDIDATE_TYPE_FLAGS[<type>]`, flipped in-process and
 * always restored (mirrors the flag-flip pattern in
 * packages/analysis/src/analysis/candidateFindings.test.ts) — never source
 * edits. Control = every flag forced false for the duration of the arm (the
 * pre-2026-08-15 baseline, NOT today's shipped default — four of the six have
 * been true since then; see docs/predicate-index.md's `Feature flag state`
 * table); treatment = the one flag under test set true for that arm only.
 *
 * **Task 7 addition — rawStreams threading**: `manaPressureEvents` (unlike
 * every P1/P2 builder) consumes raw.txt's parsed mana-sample/cast-failed
 * streams (`RawStreams`, `packages/analysis/src/utils/rawStreams.ts`).
 * Production main reads raw.txt lazily and threads it through
 * (`extractCandidateFindings`'s optional `rawStreams` param, see that
 * function's own doc comment) — this harness runs outside the renderer's
 * `rawStreamsCache.ts`, so `loadItemInput` reads raw.txt itself via
 * `packages/eval/src/explore/storeAccess.ts`'s `readRawText` (the same
 * sync-read contract as desktop's `matchStore.ts#readRawText`, already the
 * precedent `manaCalibrationScan.ts` uses) and parses it with
 * `parseRawStreams` from `@gladlog/analysis` before calling `buildInput`.
 * `manaEfficiencyEvents` deliberately does NOT consume `rawStreams` (see its
 * own doc comment — `SPELL_MANA_COST_TABLE`'s `pct` needs no absolute
 * `manaMax`) — rawStreams is still loaded uniformly for both mana types by
 * `RAW_STREAMS_TYPES` below (harness simplicity, zero effect on
 * manaEfficiency's output), not because production wiring requires it for
 * that type.
 *
 * Subcommands (all resumable via a `processed.txt` id file, same discipline
 * as candidateCalibrationScan.ts — batched foreground, never
 * background-and-wait):
 *   select   --type=<t> [--seed=<s>] [--n=30] [--calib=<jsonl>]
 *     Reads a calibration scan's surviving JSONL — P1/P2 types default to
 *     `candidate-calibration-scan-final.rows.jsonl` (1028 matches/3441
 *     rounds); manaPressure/manaEfficiency default to Task 6's
 *     `mana-calibration-scan-final-casts8.rows.jsonl` (final-constants
 *     corpus, 1028 matches/3434 rounds) — groups to one row per matchId
 *     (first triggering round in file/scan order — deterministic),
 *     `seededShuffle`s (packages/eval/src/explore/buildSession.ts's
 *     mulberry32 shuffle, reused verbatim, not re-derived), takes the first
 *     n. Writes `$EVAL_HOME/p1p2-ab/<type>/evalset.json`.
 *   run      --type=<t> --arm=control|treatment [--offset=0] [--limit=8]
 *     Generates responder output for a slice of the PENDING (not yet in
 *     processed.txt) eval-set items, appends one JSONL row per item to
 *     `results.jsonl`, and writes the full prompt/response/audit artifacts
 *     per item under `items/<matchId>-r<roundSeq|na>/` so metrics are
 *     recomputable without re-calling the model.
 *   report   --type=<t>
 *     Aggregates control vs treatment `results.jsonl` into the markdown
 *     tables used by the Task 6/7 reports.
 *   overlap  (no --type — always both; P1 types only, missedSyncWindow +
 *     unsyncedBurst)
 *     Deterministic, no model calls: on the UNION of both types' eval-set
 *     items, flips BOTH flags true, recomputes candidates via the same
 *     `buildInput` wiring, and measures what fraction of unsynced-burst
 *     candidate windows overlap a missed-sync-window candidate window in the
 *     same round — the two flags are single-flag-per-arm in the A/B itself
 *     (so they cannot collide inside one prompt today), but the user needs
 *     to know the double-report risk before deciding to ship both.
 *
 * Match store: same default as every other library script in this repo
 * (`~/Library/Application Support/gladlog/matches`, `$GLADLOG_MATCH_DIR`
 * override) — see storeAccess.ts's `DEFAULT_MATCH_DIR` doc comment.
 */
import {
  readFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  auditFindings,
  buildFindingsPrompt,
  buildMatchContext,
  CANDIDATE_TYPE_FLAGS,
  extractCandidateFindings,
  parseModelJsonArray,
  parseRawStreams,
  roundDurationSOf,
  specToString,
  type CandidateEvent,
  type RawFinding,
  type RawStreams,
} from "@gladlog/analysis";

import { resolveOwner } from "../src/renderer/src/report/derive/analysisInput";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import { buildCoachSystemPrompt } from "../src/main/ai";
import { claudeCliClientFactory } from "../src/main/localAiBackends";
import { AI_DEFAULT_MODEL } from "../src/shared/aiModels";
import { seededShuffle } from "../../eval/src/explore/buildSession";
import { readRawText } from "../../eval/src/explore/storeAccess";

const MATCH_DIR =
  process.env.GLADLOG_MATCH_DIR ||
  join(homedir(), "Library/Application Support/gladlog/matches");

const EVAL_HOME =
  process.env.GLADLOG_EVAL_HOME ||
  join(homedir(), "code", "gladlog-eval-private");

const DEFAULT_CALIB_ROWS = join(
  EVAL_HOME,
  "reports",
  "candidate-calibration-partial",
  "candidate-calibration-scan-final.rows.jsonl",
);

// Task 6's final-constants full-corpus scan (MANA_EFF_MIN_CASTS=8, the
// number that shipped — see raw-streams-calibration.md) — the mana-type
// equivalent of DEFAULT_CALIB_ROWS above, same round-level shape
// (matchId/roundSeq + <type>Capped-or-count fields), same 1028-match corpus.
const DEFAULT_MANA_CALIB_ROWS = join(
  EVAL_HOME,
  "reports",
  "mana-calibration-partial",
  "mana-calibration-scan-final-casts8.rows.jsonl",
);

type PType =
  | "missedSyncWindow"
  | "unsyncedBurst"
  | "cdHoarded"
  | "cdSpentIdle"
  | "manaPressure"
  | "manaEfficiency";
const ALL_TYPES: PType[] = [
  "missedSyncWindow",
  "unsyncedBurst",
  "cdHoarded",
  "cdSpentIdle",
  "manaPressure",
  "manaEfficiency",
];
const TYPE_STR: Record<PType, string> = {
  missedSyncWindow: "missed-sync-window",
  unsyncedBurst: "unsynced-burst",
  cdHoarded: "cd-hoarded",
  cdSpentIdle: "cd-spent-idle",
  manaPressure: "mana-pressure",
  manaEfficiency: "mana-efficiency",
};
// Field in the calibration scan JSONL rows that `select` checks for
// `> 0` to decide "this round triggered". mana-efficiency's field is a raw
// count, not a "*Capped" name (`manaEfficiencyEvents` caps at 1 per
// round/healer structurally — see its own doc comment — so there is nothing
// to cap), but `> 0` means the same thing either way.
const CAPPED_FIELD: Record<PType, string> = {
  missedSyncWindow: "missedSyncWindowCapped",
  unsyncedBurst: "unsyncedBurstCapped",
  cdHoarded: "cdHoardedCapped",
  cdSpentIdle: "cdSpentIdleCapped",
  manaPressure: "manaPressureCapped",
  manaEfficiency: "manaEfficiencyCount",
};
const DEFAULT_CALIB_ROWS_BY_TYPE: Record<PType, string> = {
  missedSyncWindow: DEFAULT_CALIB_ROWS,
  unsyncedBurst: DEFAULT_CALIB_ROWS,
  cdHoarded: DEFAULT_CALIB_ROWS,
  cdSpentIdle: DEFAULT_CALIB_ROWS,
  manaPressure: DEFAULT_MANA_CALIB_ROWS,
  manaEfficiency: DEFAULT_MANA_CALIB_ROWS,
};
// The two types whose production candidate builder consumes raw.txt's
// parsed streams (see module header) — `loadItemInput` only pays the
// raw.txt read+parse cost for these.
const RAW_STREAMS_TYPES = new Set<PType>(["manaPressure", "manaEfficiency"]);

function resetAllFlags(): void {
  for (const t of ALL_TYPES) CANDIDATE_TYPE_FLAGS[t] = false;
}

interface EvalItem {
  matchId: string;
  roundSeq: number | undefined;
}
interface EvalSet {
  type: PType;
  seed: string;
  n: number;
  eligibleMatches: number;
  items: EvalItem[];
  // P2 contamination quantification (Task 7, CLAUDE.md 修复给前后数字 rule):
  // of the shuffled naive-scan pool items actually WALKED during selection
  // (i.e. up to the point `n` real hits were found or the pool ran out),
  // `naiveTriggeredChecked` = mismatchSkips + items.length (every item the
  // real-wiring check looked at that the calibration scan called "triggered"),
  // `productionVerifiedHits` = items.length, `phantomRate` = mismatchSkips /
  // naiveTriggeredChecked. loadErrorSkips is reported separately — those are
  // match-load failures (missing owner / bad source), not naive-scan false
  // positives, so they are excluded from the phantom-rate denominator.
  naiveTriggeredChecked: number;
  productionVerifiedHits: number;
  mismatchSkips: number;
  loadErrorSkips: number;
  phantomRate: number;
}

function typeDir(type: PType): string {
  return join(EVAL_HOME, "p1p2-ab", type);
}
function evalSetPath(type: PType): string {
  return join(typeDir(type), "evalset.json");
}
function armDir(type: PType, arm: "control" | "treatment"): string {
  return join(typeDir(type), arm);
}
function resultsPath(type: PType, arm: "control" | "treatment"): string {
  return join(armDir(type, arm), "results.jsonl");
}
function processedPath(type: PType, arm: "control" | "treatment"): string {
  return join(armDir(type, arm), "processed.txt");
}
function itemLabel(item: EvalItem): string {
  return `${item.matchId}-r${item.roundSeq ?? "na"}`;
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

function cmdSelect(args: Record<string, string>): void {
  const type = args.type as PType;
  if (!ALL_TYPES.includes(type)) {
    throw new Error(
      `select requires --type=missedSyncWindow|unsyncedBurst|cdHoarded|cdSpentIdle|manaPressure|manaEfficiency`,
    );
  }
  const seed = args.seed ?? `p1p2-ab-${type}-2026-08-15`;
  const n = args.n ? Number(args.n) : 30;
  const calibPath = args.calib ?? DEFAULT_CALIB_ROWS_BY_TYPE[type];

  const rows = readFileSync(calibPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

  const field = CAPPED_FIELD[type];
  const firstTrigger = new Map<string, number | undefined>();
  for (const r of rows) {
    const matchId = r.matchId as string;
    if (firstTrigger.has(matchId)) continue;
    if ((r[field] as number) > 0) {
      firstTrigger.set(matchId, r.roundSeq as number | undefined);
    }
  }
  const pool: EvalItem[] = Array.from(firstTrigger.entries()).map(
    ([matchId, roundSeq]) => ({ matchId, roundSeq }),
  );
  const shuffled = seededShuffle(pool, seed);

  // Verify each candidate against the REAL production wiring before keeping
  // it (CLAUDE.md shared-predicate rule): the calibration scan's
  // `buildRoundContext` (packages/eval/src/explore/candidateCalibration.ts)
  // resolves owner as "friendly healer, else first friendly" and converts
  // legacy via eval's own `toLegacyMatch`, while the real prompt-building
  // path (`buildInput` below, same as smokeFindingsBackends.ts) resolves
  // owner as the log's actual `playerId` (falling back to the friendly
  // healer) via desktop's `toLegacySafe` — for matches logged by a
  // non-healer, or where the two legacy converters diverge, the calibration
  // scan's "triggered" call can be wrong for what the prompt itself will
  // actually contain. Walking the shuffled pool IN ORDER and re-checking
  // with the real builder (flag forced on for this check only) means the
  // selected set is never contaminated by that mismatch — a skip here is
  // exactly the same fact `run`'s own menuNewType===0 guard would otherwise
  // catch per-item, just caught up front so `n` means n REAL triggers.
  const flagKey = type;
  resetAllFlags();
  CANDIDATE_TYPE_FLAGS[flagKey] = true;
  const newTypeStr = TYPE_STR[type];
  const items: EvalItem[] = [];
  let mismatchSkips = 0;
  let loadErrorSkips = 0;
  try {
    for (const item of shuffled) {
      if (items.length >= n) break;
      let input: ReturnType<typeof loadItemInput>;
      try {
        input = loadItemInput(item, type);
      } catch {
        loadErrorSkips++;
        continue;
      }
      if (!input) {
        loadErrorSkips++;
        continue;
      }
      const hit = input.candidates.some((c) => c.type === newTypeStr);
      if (!hit) {
        mismatchSkips++;
        continue;
      }
      items.push(item);
    }
  } finally {
    resetAllFlags();
  }

  // Contamination quantification (Task 7): the real-wiring check above
  // WALKED `items.length + mismatchSkips` naive-scan-triggered items before
  // either filling n or exhausting the pool — that walked subset (not the
  // full pool) is the sample the phantom rate is measured against, same
  // method Task 6 used for missedSyncWindow/unsyncedBurst (28.6%/23.1% on
  // samples of 42/39, not full 928/857 pools).
  const naiveTriggeredChecked = items.length + mismatchSkips;
  const phantomRate =
    naiveTriggeredChecked > 0 ? mismatchSkips / naiveTriggeredChecked : 0;
  const scarce = items.length < n;

  const evalSet: EvalSet = {
    type,
    seed,
    n: items.length,
    eligibleMatches: pool.length,
    items,
    naiveTriggeredChecked,
    productionVerifiedHits: items.length,
    mismatchSkips,
    loadErrorSkips,
    phantomRate,
  };
  mkdirSync(typeDir(type), { recursive: true });
  writeFileSync(evalSetPath(type), JSON.stringify(evalSet, null, 2));
  console.log(
    `[select] type=${type} eligible(calibration scan pool)=${pool.length} naiveTriggeredChecked=${naiveTriggeredChecked} productionVerifiedHits=${items.length} phantomRate=${(phantomRate * 100).toFixed(1)}% seed=${seed} mismatchSkips=${mismatchSkips} loadErrorSkips=${loadErrorSkips}${scarce ? ` SCARCE(target n=${n}, pool exhausted at ${items.length})` : ""} -> ${evalSetPath(type)}`,
  );
}

// ---------------------------------------------------------------------------
// shared: load a round, build the production findings input
// ---------------------------------------------------------------------------

// `pickSource`/`buildInput` are exported (2026-08-15, Task 8 constraint-budget
// audit): `constraintBudgetAudit.ts` reuses them verbatim as its "production
// buildInput path" per the task's own requirement, rather than re-deriving a
// third copy of owner resolution alongside this file's and
// smokeFindingsBackends.ts's (CLAUDE.md shared-predicate rule). Behavior is
// unchanged — this is an export-visibility-only edit.
export function pickSource(doc: any, roundSeq: number | undefined): unknown {
  if (doc.kind === "shuffle") {
    const rounds = doc.data?.rounds ?? [];
    return roundSeq !== undefined ? rounds[roundSeq] : rounds[0];
  }
  return doc.data;
}

export function buildInput(
  source: unknown,
  // Task 7 addition: optional parsed raw.txt streams, threaded straight
  // through to `extractCandidateFindings`'s own optional param (see that
  // function's doc comment) — omitted (as every pre-Task-7 caller including
  // `constraintBudgetAudit.ts` still does) degrades byte-identically to
  // before this param existed (Global Constraint), so this is additive-only.
  rawStreams?: RawStreams,
): { candidates: CandidateEvent[]; richContext: string; spec: string } | null {
  const legacy = toLegacySafe(source) as any;
  // Owner resolution: the real production predicate (fix round 1, review
  // Important #2) — imported from analysisInput.ts, the same function
  // buildAnalysisInput/buildWindowAnalysisRequest (the two real AI-coaching
  // paths) actually call, rather than a hand-rolled 3rd/4th copy. This is the
  // exact predicate whose divergence from candidateCalibration.ts's
  // buildRoundContext Task 6 discovered (CLAUDE.md 门规谓词即规范) — now
  // registered in docs/predicate-index.md instead of re-duplicated again.
  const owner = resolveOwner(legacy);
  if (!owner) return null;
  const players = Object.values(legacy.units ?? {}).filter(
    (u: any) => u.info,
  ) as any[];
  const candidates = extractCandidateFindings(legacy, owner.id, rawStreams);
  const friends = players.filter((u: any) => u.reaction === owner.reaction);
  const enemies = players.filter((u: any) => u.reaction !== owner.reaction);
  const richContext = buildMatchContext(legacy, friends, enemies, {
    owner,
  });
  return { candidates, richContext, spec: specToString(owner.spec) };
}

// `type` is optional and only consulted to decide whether to pay the
// raw.txt read+parse cost (`RAW_STREAMS_TYPES` above) — omitted (every
// pre-Task-7 call site, e.g. `overlap`'s missedSyncWindow/unsyncedBurst
// union scan) keeps today's behavior: no rawStreams loaded, byte-identical.
function loadItemInput(item: EvalItem, type?: PType) {
  const doc = JSON.parse(
    readFileSync(join(MATCH_DIR, item.matchId, "match.json"), "utf8"),
  );
  const source = pickSource(doc, item.roundSeq);
  if (source === undefined) return null;
  let rawStreams: RawStreams | undefined;
  if (type && RAW_STREAMS_TYPES.has(type)) {
    // `parseRawStreams` needs the match's start-of-combat epoch ms as its
    // `baseMs` (same `legacy.startTime` field `manaCalibrationScan.ts`
    // reads) to resolve raw.txt's date-prefixed lines to absolute time —
    // cheap to recompute here (`toLegacySafe` is a pure conversion, same one
    // `buildInput` below runs again on the same `source`); not threaded
    // through as a third `buildInput` param to keep that function's
    // signature stable for `constraintBudgetAudit.ts`'s existing call.
    const legacyForBaseMs = toLegacySafe(source) as any;
    const rawText = readRawText(MATCH_DIR, item.matchId);
    const baseMs = legacyForBaseMs.startTime ?? 0;
    // BACKLOG #32: this item's own round span, mirroring
    // rawStreamsCache.ts's production derivation (both now go through the
    // single-sourced `roundDurationSOf`, BACKLOG #26 final review §2.d.2) —
    // without it, a Solo Shuffle item's mana-pressure candidates can
    // reference another round of the same lobby's raw.txt (measured 87.0%
    // contaminated pre-fix).
    const roundDurationS = roundDurationSOf(baseMs, legacyForBaseMs.endTime);
    rawStreams = parseRawStreams(rawText, baseMs, roundDurationS);
  }
  return buildInput(source, rawStreams);
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export function looksLikeCallFailure(raw: string): boolean {
  const t = raw.trim();
  if (t === "") return true;
  if (t.length > 400) return false;
  return /rate[\s-]?limit|too many requests|quota exceeded|\b429\b/i.test(t);
}

export async function callOnce(
  client: ReturnType<typeof claudeCliClientFactory>,
  model: string,
  system: string,
  prompt: string,
): Promise<string> {
  let raw = "";
  for await (const ev of client.stream({
    model,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: prompt }],
  })) {
    if (ev.delta) raw += ev.delta;
  }
  return raw;
}

interface ResultRow {
  matchId: string;
  roundSeq: number | undefined;
  arm: "control" | "treatment";
  type: PType;
  menuTotal: number;
  menuNewType: number;
  modelPicked: number;
  auditedTotal: number;
  adoptedRaw: number; // model findings referencing >=1 new-type candidate id
  adoptedAudited: number; // ...that survived audit
  newTypeCandidatesReferenced: number; // distinct new-type candidate ids referenced by any raw finding
  causalDrops: number;
  numericDrops: number;
  groundingDrops: number;
  hindsightDrops: number;
  diversityDrops: number;
  ambiguousDrops: number;
  auditedSeverity: { high: number; med: number; low: number };
  callError: boolean;
  badJson: boolean;
  retried: boolean;
}

function bumpSeverity(
  sev: { high: number; med: number; low: number },
  s: string,
) {
  if (s === "high") sev.high++;
  else if (s === "med") sev.med++;
  else if (s === "low") sev.low++;
}

async function cmdRun(args: Record<string, string>): Promise<void> {
  const type = args.type as PType;
  const arm = args.arm as "control" | "treatment";
  if (!ALL_TYPES.includes(type)) {
    throw new Error(
      `run requires --type=missedSyncWindow|unsyncedBurst|cdHoarded|cdSpentIdle|manaPressure|manaEfficiency`,
    );
  }
  if (arm !== "control" && arm !== "treatment") {
    throw new Error(`run requires --arm=control|treatment`);
  }
  const offset = args.offset ? Number(args.offset) : 0;
  const limit = args.limit ? Number(args.limit) : 8;

  const evalSet = JSON.parse(
    readFileSync(evalSetPath(type), "utf8"),
  ) as EvalSet;

  mkdirSync(join(armDir(type, arm), "items"), { recursive: true });
  const processedFile = processedPath(type, arm);
  const already = new Set(
    existsSync(processedFile)
      ? readFileSync(processedFile, "utf8").split("\n").filter(Boolean)
      : [],
  );
  const pending = evalSet.items.filter((it) => !already.has(itemLabel(it)));
  const slice = pending.slice(offset, offset + limit);
  console.log(
    `[run] type=${type} arm=${arm} total=${evalSet.items.length} already-done=${already.size} pending=${pending.length} this-batch=${slice.length}`,
  );
  if (slice.length === 0) return;

  const client = claudeCliClientFactory({ cmd: "claude" });
  const model = AI_DEFAULT_MODEL.claudeCli;
  const system = buildCoachSystemPrompt("zh");
  const concurrency = args.concurrency ? Number(args.concurrency) : 4;

  // Arm flag flip — in-process only, always restored in `finally` below. Set
  // ONCE before the whole batch and never touched again until the batch is
  // done (see `finally`), so running items concurrently below never races on
  // this module-level mutable — every concurrent `loadItemInput` call reads
  // the same, already-settled flag state.
  const flagKey = type;
  const prevFlag = CANDIDATE_TYPE_FLAGS[flagKey];
  resetAllFlags();
  if (arm === "treatment") CANDIDATE_TYPE_FLAGS[flagKey] = true;

  async function processItem(item: EvalItem): Promise<void> {
    const label = itemLabel(item);
    const input = loadItemInput(item, type);
    if (!input) {
      console.log(
        `${label}: no owner / no source, skipping (not marked processed)`,
      );
      return;
    }
    const newTypeStr = TYPE_STR[type];
    const menuNewType = input.candidates.filter(
      (c) => c.type === newTypeStr,
    ).length;
    if (arm === "treatment" && menuNewType === 0) {
      console.log(
        `${label}: WARNING treatment arm but menuNewType=0 (owner-resolution mismatch vs calibration scan?) — recording anyway`,
      );
    }
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const prompt = buildFindingsPrompt(
      input.candidates,
      input.richContext,
      input.spec,
    );

    const itemDir = join(armDir(type, arm), "items", label);
    mkdirSync(itemDir, { recursive: true });
    writeFileSync(join(itemDir, "prompt.txt"), prompt);

    let raw: string;
    let callError = false;
    try {
      raw = await callOnce(client, model, system, prompt);
    } catch (e) {
      callError = true;
      raw = `CALL-ERROR: ${(e as Error).message}`;
    }
    if (!callError && looksLikeCallFailure(raw)) callError = true;

    let retried = false;
    let parsed: RawFinding[] | null = callError
      ? null
      : (parseModelJsonArray(raw) as RawFinding[] | null);
    if (!callError && !parsed) {
      retried = true;
      try {
        const raw2 = await callOnce(client, model, system, prompt);
        if (looksLikeCallFailure(raw2)) {
          callError = true;
          raw = raw2;
        } else {
          raw = raw2;
          parsed = parseModelJsonArray(raw2) as RawFinding[] | null;
        }
      } catch (e) {
        callError = true;
        raw = `RETRY-CALL-ERROR: ${(e as Error).message}`;
      }
    }
    writeFileSync(join(itemDir, "response.txt"), raw);

    if (callError) {
      console.log(
        `${label}: call-error, skipping (not marked processed, will retry)`,
      );
      return;
    }
    const badJson = !parsed;
    if (badJson) {
      console.log(
        `${label}: bad-json x2, marking processed (excluded from metrics)`,
      );
      appendFileSync(processedFile, label + "\n");
      return;
    }

    // Task 7 hardening: `auditFindings` assumes every parsed finding has an
    // `explanation` string (it regexes `f.explanation` for `{{placeholder}}`
    // refs) and throws a raw TypeError if the model omits the field —
    // observed live during this task's own batch (one mana-pressure
    // treatment item, `7f67e778-rna`, index-7 finding had
    // eventIds/severity/category/title but no `explanation`). Production's
    // own call site (`packages/desktop/src/main/analysis.ts`) wraps this
    // entire block in an outer try/catch and degrades to
    // `gladlog:analysis:error` for the user — this harness has no such
    // wrapper by default, so an unguarded throw here would kill the whole
    // concurrent `Promise.all` batch (reproduced: 3 sibling items in the
    // same batch never even started). Mirrored here at the single-item
    // level instead: catch, mark processed (so it isn't retried forever on
    // a stochastic malformed shape), exclude from metrics — same contract
    // as the badJson branch above, distinct log line so this specific
    // failure mode remains visible in the batch output.
    let audit: ReturnType<typeof auditFindings>;
    try {
      audit = auditFindings(parsed!, input.candidates);
    } catch (e) {
      console.log(
        `${label}: auditFindings threw (${(e as Error).message}) — malformed finding shape from the model, marking processed (excluded from metrics)`,
      );
      appendFileSync(processedFile, label + "\n");
      return;
    }
    writeFileSync(
      join(itemDir, "audit.json"),
      JSON.stringify({ parsed, audit }, null, 2),
    );

    const adoptedRawFindings = parsed!.filter((f) =>
      f.eventIds.some((id) => byId.get(id)?.type === newTypeStr),
    );
    const adoptedAuditedFindings = audit.findings.filter((f) =>
      f.eventIds.some((id) => byId.get(id)?.type === newTypeStr),
    );
    const referencedNewTypeIds = new Set<string>();
    for (const f of parsed!) {
      for (const id of f.eventIds) {
        if (byId.get(id)?.type === newTypeStr) referencedNewTypeIds.add(id);
      }
    }
    const dropReasonCounts = {
      causal: 0,
      numeric: 0,
      grounding: 0,
      hindsight: 0,
      diversity: 0,
      ambiguous: 0,
    };
    for (const d of audit.dropped) {
      if (d.reason.startsWith("causal:")) dropReasonCounts.causal++;
      else if (d.reason.startsWith("numeric:")) dropReasonCounts.numeric++;
      else if (d.reason.startsWith("grounding:")) dropReasonCounts.grounding++;
      else if (d.reason.startsWith("hindsight:")) dropReasonCounts.hindsight++;
      else if (d.reason.startsWith("diversity:")) dropReasonCounts.diversity++;
      else if (d.reason.startsWith("ambiguous:")) dropReasonCounts.ambiguous++;
    }
    const auditedSeverity = { high: 0, med: 0, low: 0 };
    for (const f of audit.findings) bumpSeverity(auditedSeverity, f.severity);

    const row: ResultRow = {
      matchId: item.matchId,
      roundSeq: item.roundSeq,
      arm,
      type,
      menuTotal: input.candidates.length,
      menuNewType,
      modelPicked: parsed!.length,
      auditedTotal: audit.findings.length,
      adoptedRaw: adoptedRawFindings.length,
      adoptedAudited: adoptedAuditedFindings.length,
      newTypeCandidatesReferenced: referencedNewTypeIds.size,
      causalDrops: dropReasonCounts.causal,
      numericDrops: dropReasonCounts.numeric,
      groundingDrops: dropReasonCounts.grounding,
      hindsightDrops: dropReasonCounts.hindsight,
      diversityDrops: dropReasonCounts.diversity,
      ambiguousDrops: dropReasonCounts.ambiguous,
      auditedSeverity,
      callError: false,
      badJson: false,
      retried,
    };
    appendFileSync(resultsPath(type, arm), JSON.stringify(row) + "\n");
    appendFileSync(processedFile, label + "\n");
    console.log(
      `${label}: 菜单=${row.menuTotal}(新类型=${row.menuNewType}) 模型=${row.modelPicked} 审计存活=${row.auditedTotal} 采纳(raw/audited)=${row.adoptedRaw}/${row.adoptedAudited}`,
    );
  }

  try {
    // Bounded-concurrency pool (default 4 — items are independent `claude -p`
    // child processes, no shared mutable state during the run beyond the
    // flags fixed above): a shared cursor + N workers pulling the next index,
    // rather than chunking, so a slow item never stalls the other workers'
    // idle capacity.
    let cursor = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const i = cursor++;
        if (i >= slice.length) return;
        await processItem(slice[i]!);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, slice.length) }, worker),
    );
  } finally {
    resetAllFlags();
    void prevFlag;
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function loadResults(type: PType, arm: "control" | "treatment"): ResultRow[] {
  const p = resultsPath(type, arm);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ResultRow);
}

function cmdReport(args: Record<string, string>): void {
  const type = args.type as PType;
  const control = loadResults(type, "control");
  const treatment = loadResults(type, "treatment");

  const sum = (rows: ResultRow[], f: (r: ResultRow) => number) =>
    rows.reduce((a, r) => a + f(r), 0);
  const lowShare = (rows: ResultRow[]) => {
    const low = sum(rows, (r) => r.auditedSeverity.low);
    const total = sum(rows, (r) => r.auditedTotal);
    return { low, total };
  };

  const lines: string[] = [];
  lines.push(`# p1p2-ab report — ${type}`);
  lines.push("");
  lines.push(`control: n=${control.length} items processed`);
  lines.push(`treatment: n=${treatment.length} items processed`);
  lines.push("");

  const modelPickedT = sum(treatment, (r) => r.modelPicked);
  const adoptedRawT = sum(treatment, (r) => r.adoptedRaw);
  const adoptedAuditedT = sum(treatment, (r) => r.adoptedAudited);
  const menuNewTypeT = sum(treatment, (r) => r.menuNewType);
  const referencedT = sum(treatment, (r) => r.newTypeCandidatesReferenced);

  lines.push(
    `采纳率(治疗组新类型 finding / 全部 finding, raw pre-audit): ${adoptedRawT}/${modelPickedT}`,
  );
  lines.push(
    `候选覆盖率(被至少一条 finding 引用的新类型候选 / 菜单里全部新类型候选): ${referencedT}/${menuNewTypeT}`,
  );
  lines.push(
    `门规审计通过率(被采纳 finding 中通过 auditFindings 的比例): ${adoptedAuditedT}/${adoptedRawT}`,
  );
  lines.push("");

  const causalT = sum(treatment, (r) => r.causalDrops);
  const causalC = sum(control, (r) => r.causalDrops);
  lines.push(
    `causalLint 丢弃(治疗/对照,分母=模型产出总条数): ${causalT}/${modelPickedT} vs ${causalC}/${sum(control, (r) => r.modelPicked)}`,
  );
  lines.push("");

  const lowT = lowShare(treatment);
  const lowC = lowShare(control);
  lines.push(
    `低严重度(low severity)占审计存活 finding 比例——代理指标非判官口径的 filler,治疗 ${lowT.low}/${lowT.total} vs 对照 ${lowC.low}/${lowC.total}`,
  );
  lines.push("");
  lines.push(
    `每场平均审计存活条数: 治疗 ${(sum(treatment, (r) => r.auditedTotal) / (treatment.length || 1)).toFixed(2)} vs 对照 ${(sum(control, (r) => r.auditedTotal) / (control.length || 1)).toFixed(2)}`,
  );

  const out = lines.join("\n") + "\n";
  console.log(out);
  writeFileSync(join(typeDir(type), "report-snippet.md"), out);
}

// ---------------------------------------------------------------------------
// overlap
// ---------------------------------------------------------------------------

function cmdOverlap(): void {
  const msw = JSON.parse(
    readFileSync(evalSetPath("missedSyncWindow"), "utf8"),
  ) as EvalSet;
  const usb = JSON.parse(
    readFileSync(evalSetPath("unsyncedBurst"), "utf8"),
  ) as EvalSet;
  const seen = new Map<string, EvalItem>();
  for (const it of [...msw.items, ...usb.items]) seen.set(itemLabel(it), it);
  const union = Array.from(seen.values());

  CANDIDATE_TYPE_FLAGS.missedSyncWindow = true;
  CANDIDATE_TYPE_FLAGS.unsyncedBurst = true;
  let totalUnsynced = 0;
  let overlapping = 0;
  let itemsWithBoth = 0;
  let itemsProcessed = 0;
  let itemsErrored = 0;
  try {
    for (const item of union) {
      let input;
      try {
        input = loadItemInput(item);
      } catch (e) {
        itemsErrored++;
        console.log(
          `${itemLabel(item)}: load error (${(e as Error).message}), skipped`,
        );
        continue;
      }
      if (!input) continue;
      itemsProcessed++;
      const msws = input.candidates.filter(
        (c) => c.type === "missed-sync-window",
      );
      const usbs = input.candidates.filter((c) => c.type === "unsynced-burst");
      if (msws.length > 0 && usbs.length > 0) itemsWithBoth++;
      for (const b of usbs) {
        totalUnsynced++;
        const bEnd = Number(b.facts.windowEndT);
        const hit = msws.some((s) => {
          const sEnd = Number(s.facts.windowEndT);
          return b.t < sEnd && s.t < bEnd;
        });
        if (hit) overlapping++;
      }
    }
  } finally {
    CANDIDATE_TYPE_FLAGS.missedSyncWindow = false;
    CANDIDATE_TYPE_FLAGS.unsyncedBurst = false;
  }
  const out =
    `# p1p2-ab overlap (both flags on, union of both eval sets, n=${union.length} items)\n\n` +
    `items processed: ${itemsProcessed} (load-errors: ${itemsErrored})\n` +
    `items with >=1 candidate of BOTH types: ${itemsWithBoth}\n` +
    `unsynced-burst candidates whose window overlaps a missed-sync-window candidate's window (same round): ${overlapping}/${totalUnsynced}\n`;
  console.log(out);
  mkdirSync(join(EVAL_HOME, "p1p2-ab"), { recursive: true });
  writeFileSync(join(EVAL_HOME, "p1p2-ab", "overlap-report.md"), out);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === "select") return cmdSelect(args);
  if (cmd === "run") return cmdRun(args);
  if (cmd === "report") return cmdReport(args);
  if (cmd === "overlap") return cmdOverlap();
  throw new Error(
    `usage: p1p2Ab.ts select|run|report|overlap --type=missedSyncWindow|unsyncedBurst|cdHoarded|cdSpentIdle|manaPressure|manaEfficiency ...`,
  );
}

// Entrypoint guard (2026-08-15, added alongside the `pickSource`/`buildInput`
// export for Task 8's `constraintBudgetAudit.ts`): without this, importing
// THIS FILE as a library (to reuse those two functions) also re-runs this
// file's own `main()` against the IMPORTING script's argv — reproduced live
// while wiring up the reuse (`constraintBudgetAudit.ts select` tripped
// p1p2Ab.ts's own "select requires --type=..." usage error). Only run main()
// when this file is the actual entrypoint tsx was pointed at.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
