/**
 * Constraint-budget audit A/B harness (Task 8, p1p2-distillation plan,
 * 2026-08-15): baseline (today's shipped output-space constraints) vs
 * relaxed (three controller-confirmed LOW-mechanism-risk relaxations bundled
 * into ONE arm, per the plan's "combined arm, per-constraint attribution by
 * tagging" instruction) — quantifies what the constraints cost in missed
 * verified findings vs what they buy in mechanism-error suppression.
 *
 * The three relaxations under test (see task-8-report.md's Phase 1 inventory
 * for full rent receipts) are all module-level `const`s, none exposing an
 * `overrides?` param the way the P1/P2 builders do — so unlike
 * `CANDIDATE_TYPE_FLAGS`'s in-process flag flip, they cannot be toggled at
 * runtime. This harness runs the BASELINE arm against unmodified `main`,
 * then the RELAXED arm against a throwaway local branch carrying ONLY the
 * four relaxation edits (never pushed, reverted before this task's commit —
 * see task-8-report.md's mechanism section for the exact diff and the
 * before/after `git status`/`git log origin/main..HEAD` proof).
 *
 * Reuses the REAL production chain, same as `p1p2Ab.ts` (never a second
 * implementation, CLAUDE.md shared-predicate rule):
 *   toLegacySafe → resolveOwner → extractCandidateFindings → buildMatchContext
 *   → buildFindingsPrompt → claudeCli backend (model=claude-sonnet-5) →
 *   parseModelJsonArray (one retry on null) → auditFindings
 * `pickSource`/`buildInput` are imported directly from `p1p2Ab.ts` (exported
 * there for this reuse) rather than re-derived a third time alongside that
 * file's and `smokeFindingsBackends.ts`'s own copies.
 *
 * Selection is GENERAL POPULATION (not type-triggered): a seeded shuffle of
 * every id in `_index.ndjson`, walked in order, keeping the first n whose
 * production owner resolves — mirrors `p1p2Ab.ts select`'s verify-against-
 * real-wiring discipline but against the whole library instead of a
 * calibration-scan-filtered pool.
 *
 * Subcommands (all resumable via a `processed.txt` id file, foreground-batch
 * discipline — never background-and-wait):
 *   select --seed=<s> [--n=40]
 *     Writes `$EVAL_HOME/constraint-budget-audit/evalset.json`.
 *   run --arm=baseline|relaxed [--offset=0] [--limit=12] [--concurrency=4]
 *     Generates responder output for a slice of PENDING eval-set items,
 *     appends one JSONL row per item to `<arm>/results.jsonl`, and writes
 *     full prompt/response/audit/candidates/context artifacts per item under
 *     `<arm>/items/<matchId>/` so every metric is recomputable without
 *     re-calling the model. Also runs the manifest-independent hardFailure
 *     checks (`promptQualityCheck.ts`, reused not reimplemented) against the
 *     persisted richContext right here, since it's already in hand.
 *   report
 *     Aggregates both arms into the pareto table + per-constraint
 *     attribution used by the Task 8 report. Deterministic, no model calls.
 *
 * Match store: same default as every other library script
 * (`~/Library/Application Support/gladlog/matches`, `$GLADLOG_MATCH_DIR`
 * override).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  auditFindings,
  buildFindingsPrompt,
  LEGACY_TOPIC_TYPES,
  parseModelJsonArray,
  type RawFinding,
} from "@gladlog/analysis";

import { seededShuffle } from "../../eval/src/explore/buildSession";
import { loadIndex } from "../../eval/src/explore/storeAccess";
import {
  checkCooldownLedgerConsistency,
  checkPercentileMonotonicity,
  checkSameSecondHpConsistency,
  checkSnapshotFactsConsistency,
  checkWindowSpanConsistency,
} from "../../eval/src/quality/promptQualityCheck";
import { buildCoachSystemPrompt } from "../src/main/ai";
import { claudeCliClientFactory } from "../src/main/localAiBackends";
import { AI_DEFAULT_MODEL } from "../src/shared/aiModels";
import { findingKey } from "../src/shared/findingKey";
// Reused verbatim (see header comment) — exported from p1p2Ab.ts for this
// purpose, not re-derived.
import {
  buildInput,
  callOnce,
  looksLikeCallFailure,
  parseArgs,
  pickSource,
} from "./p1p2Ab";

const MATCH_DIR =
  process.env.GLADLOG_MATCH_DIR ||
  join(homedir(), "Library/Application Support/gladlog/matches");

const EVAL_HOME =
  process.env.GLADLOG_EVAL_HOME ||
  join(homedir(), "code", "gladlog-eval-private");

const HOME = join(EVAL_HOME, "constraint-budget-audit");
const evalSetPath = () => join(HOME, "evalset.json");
type Arm = "baseline" | "relaxed";
const armDir = (arm: Arm) => join(HOME, arm);
const resultsPath = (arm: Arm) => join(armDir(arm), "results.jsonl");
const processedPath = (arm: Arm) => join(armDir(arm), "processed.txt");
const itemDir = (arm: Arm, matchId: string) =>
  join(armDir(arm), "items", matchId);

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

interface EvalItem {
  matchId: string;
}
interface EvalSet {
  seed: string;
  n: number;
  poolSize: number;
  items: EvalItem[];
  loadErrorSkips: number;
}

function loadItemInput(matchId: string) {
  const doc = JSON.parse(
    readFileSync(join(MATCH_DIR, matchId, "match.json"), "utf8"),
  );
  const source = pickSource(doc, undefined);
  if (source === undefined) return null;
  return buildInput(source);
}

function cmdSelect(args: Record<string, string>): void {
  const seed = args.seed ?? "constraint-budget-audit-2026-08-15";
  const n = args.n ? Number(args.n) : 40;

  // Deduped by id (last occurrence wins; a re-touched match can appear twice).
  const ids = loadIndex(MATCH_DIR).map((r) => r.id);
  const shuffled = seededShuffle(ids, seed);

  const items: EvalItem[] = [];
  let loadErrorSkips = 0;
  for (const matchId of shuffled) {
    if (items.length >= n) break;
    let input: ReturnType<typeof loadItemInput>;
    try {
      input = loadItemInput(matchId);
    } catch {
      loadErrorSkips++;
      continue;
    }
    if (!input) {
      loadErrorSkips++;
      continue;
    }
    items.push({ matchId });
  }

  const evalSet: EvalSet = {
    seed,
    n: items.length,
    poolSize: ids.length,
    items,
    loadErrorSkips,
  };
  mkdirSync(HOME, { recursive: true });
  writeFileSync(evalSetPath(), JSON.stringify(evalSet, null, 2));
  console.log(
    `[select] pool=${ids.length} n=${items.length} seed=${seed} loadErrorSkips=${loadErrorSkips} -> ${evalSetPath()}`,
  );
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

interface AuditedFindingRow {
  key: string; // findingKey (category|sorted eventIds) — single-source predicate, src/shared/findingKey.ts
  category: string;
  severity: string;
  eventIds: string[];
  types: string[]; // candidate types referenced (via eventIds), for attribution
}

interface ResultRow {
  matchId: string;
  arm: Arm;
  menuTotal: number;
  menuByType: Record<string, number>;
  menuIds: string[]; // candidate ids present in this arm's menu (for cross-arm diff)
  modelPicked: number;
  auditedTotal: number;
  auditedFindings: AuditedFindingRow[];
  causalDrops: number;
  numericDrops: number;
  groundingDrops: number;
  hindsightDrops: number;
  diversityDrops: number;
  ambiguousDrops: number;
  hardFailureCount: number;
  hardFailureMsgs: string[];
  callError: boolean;
  badJson: boolean;
  retried: boolean;
}

async function cmdRun(args: Record<string, string>): Promise<void> {
  const arm = args.arm as Arm;
  if (arm !== "baseline" && arm !== "relaxed") {
    throw new Error(`run requires --arm=baseline|relaxed`);
  }
  const offset = args.offset ? Number(args.offset) : 0;
  const limit = args.limit ? Number(args.limit) : 12;
  const concurrency = args.concurrency ? Number(args.concurrency) : 4;

  const evalSet = JSON.parse(readFileSync(evalSetPath(), "utf8")) as EvalSet;

  mkdirSync(join(armDir(arm), "items"), { recursive: true });
  const processedFile = processedPath(arm);
  const already = new Set(
    existsSync(processedFile)
      ? readFileSync(processedFile, "utf8").split("\n").filter(Boolean)
      : [],
  );
  const pending = evalSet.items.filter((it) => !already.has(it.matchId));
  const slice = pending.slice(offset, offset + limit);
  console.log(
    `[run] arm=${arm} total=${evalSet.items.length} already-done=${already.size} pending=${pending.length} this-batch=${slice.length}`,
  );
  if (slice.length === 0) return;

  const client = claudeCliClientFactory({ cmd: "claude" });
  const model = AI_DEFAULT_MODEL.claudeCli;
  const system = buildCoachSystemPrompt("zh");

  async function processItem(item: EvalItem): Promise<void> {
    const matchId = item.matchId;
    const input = loadItemInput(matchId);
    if (!input) {
      console.log(`${matchId}: no owner / no source, skipping`);
      return;
    }
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const menuByType: Record<string, number> = {};
    for (const c of input.candidates)
      menuByType[c.type] = (menuByType[c.type] ?? 0) + 1;

    const prompt = buildFindingsPrompt(
      input.candidates,
      input.richContext,
      input.spec,
    );

    const dir = itemDir(arm, matchId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prompt.txt"), prompt);
    writeFileSync(join(dir, "richContext.txt"), input.richContext);
    writeFileSync(
      join(dir, "candidates.json"),
      JSON.stringify(input.candidates, null, 2),
    );

    // Metric 2 (mechanism error rate) half A: manifest-independent
    // hardFailures, computed directly on richContext (buildMatchContext's
    // output — untouched by all three relaxations, which only ever touch
    // candidate generation / selection, never the context builder). Reused
    // verbatim from promptQualityCheck.ts, not reimplemented.
    const ctxLines = input.richContext.split("\n");
    const hardFailureMsgs = [
      ...checkPercentileMonotonicity(ctxLines),
      ...checkSameSecondHpConsistency(ctxLines),
      ...checkWindowSpanConsistency(ctxLines),
      ...checkCooldownLedgerConsistency(ctxLines),
      ...checkSnapshotFactsConsistency(input.richContext),
    ];

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
    writeFileSync(join(dir, "response.txt"), raw);

    if (callError) {
      console.log(`${matchId}: call-error, skipping (will retry)`);
      return;
    }
    const badJson = !parsed;
    if (badJson) {
      console.log(`${matchId}: bad-json x2, marking processed (excluded)`);
      appendFileSync(processedFile, matchId + "\n");
      return;
    }

    const audit = auditFindings(parsed!, input.candidates);
    writeFileSync(
      join(dir, "audit.json"),
      JSON.stringify({ parsed, audit }, null, 2),
    );

    const auditedFindings: AuditedFindingRow[] = audit.findings.map((f) => ({
      key: findingKey(f),
      category: f.category,
      severity: f.severity,
      eventIds: f.eventIds,
      types: f.eventIds.map((id) => byId.get(id)?.type ?? "unknown"),
    }));

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

    const row: ResultRow = {
      matchId,
      arm,
      menuTotal: input.candidates.length,
      menuByType,
      menuIds: input.candidates.map((c) => c.id),
      modelPicked: parsed!.length,
      auditedTotal: audit.findings.length,
      auditedFindings,
      causalDrops: dropReasonCounts.causal,
      numericDrops: dropReasonCounts.numeric,
      groundingDrops: dropReasonCounts.grounding,
      hindsightDrops: dropReasonCounts.hindsight,
      diversityDrops: dropReasonCounts.diversity,
      ambiguousDrops: dropReasonCounts.ambiguous,
      hardFailureCount: hardFailureMsgs.length,
      hardFailureMsgs,
      callError: false,
      badJson: false,
      retried,
    };
    appendFileSync(resultsPath(arm), JSON.stringify(row) + "\n");
    appendFileSync(processedFile, matchId + "\n");
    console.log(
      `${matchId} [${arm}]: 菜单=${row.menuTotal} 模型=${row.modelPicked} 审计存活=${row.auditedTotal} hardFailures=${row.hardFailureCount}`,
    );
  }

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
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function loadResults(arm: Arm): ResultRow[] {
  const p = resultsPath(arm);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ResultRow);
}

type ConstraintTag =
  | "C1-selection-cap"
  | "C2-dispel-severity-floor"
  | "C3-cc-held-cap"
  | "ambiguous"
  | "unattributed";

/** Attributes ONE new finding (present in relaxed, absent from baseline for
 * the same match) to the relaxation(s) that admitted it. Algorithm (see
 * task-8-report.md's Phase 2 methodology section for the full writeup):
 *  - A referenced candidate id absent from the baseline arm's menu for that
 *    match is "menu-only-relaxed". Classify it by type:
 *      - type === "cc-held" -> C3 (candidate cap raise; the extra slot only
 *        exists because CC_HELD_CAP moved 2->3)
 *      - type in {missed-cleanse, missed-purge} -> C2 (severity-floor
 *        relaxation; a Critical/High-only floor could never have produced
 *        this candidate id)
 *  - If the finding's type is one of LEGACY_TOPIC_TYPES AND every referenced
 *    candidate id IS present in the baseline menu (i.e., not menu-only-
 *    relaxed) -> C1 (the finding only survived because the selection-layer
 *    cap moved from <=2 to <=3; nothing about the candidate itself is new).
 *  - If a finding mixes a C1 signal (legacy type, would need the raised
 *    selection cap) with a C2/C3 menu-only-relaxed reference -> both
 *    relaxations are jointly necessary for that finding to exist; tagged
 *    "ambiguous" rather than guessed at (brief: never guess).
 *  - Anything else (new by findingKey but none of the above triggers,
 *    e.g. pure model-response variance producing a differently-shaped
 *    finding over otherwise-identical menus) -> "unattributed" and reported
 *    as such, not silently folded into one of the three.
 */
function attribute(
  finding: AuditedFindingRow,
  baselineMenuIds: Set<string>,
): ConstraintTag[] {
  const menuOnlyRelaxedTypes = new Set(
    finding.eventIds
      .filter((id) => !baselineMenuIds.has(id))
      .map((id) => finding.types[finding.eventIds.indexOf(id)]),
  );
  const tags = new Set<ConstraintTag>();
  if (menuOnlyRelaxedTypes.has("cc-held")) tags.add("C3-cc-held-cap");
  if (
    menuOnlyRelaxedTypes.has("missed-cleanse") ||
    menuOnlyRelaxedTypes.has("missed-purge")
  )
    tags.add("C2-dispel-severity-floor");
  const isLegacyType = finding.types.some((t) => LEGACY_TOPIC_TYPES.has(t));
  const allReferencedInBaselineMenu = finding.eventIds.every((id) =>
    baselineMenuIds.has(id),
  );
  if (isLegacyType && allReferencedInBaselineMenu) tags.add("C1-selection-cap");

  if (tags.size === 0) return ["unattributed"];
  if (tags.size > 1) return ["ambiguous", ...tags];
  return [...tags];
}

function cmdReport(): void {
  const baseline = loadResults("baseline");
  const relaxed = loadResults("relaxed");
  const baselineByMatch = new Map(baseline.map((r) => [r.matchId, r]));

  const sum = (rows: ResultRow[], f: (r: ResultRow) => number) =>
    rows.reduce((a, r) => a + f(r), 0);

  // Metric 1: 验真新发现率 — new (findingKey absent from baseline's set for
  // the same match) x already-audit-passed (auditedFindings IS the audit-
  // passed set by construction).
  interface NewFindingRow {
    matchId: string;
    key: string;
    category: string;
    severity: string;
    tags: ConstraintTag[];
  }
  const newFindings: NewFindingRow[] = [];
  for (const r of relaxed) {
    const base = baselineByMatch.get(r.matchId);
    const baseKeys = new Set((base?.auditedFindings ?? []).map((f) => f.key));
    const baseMenuIds = new Set(base?.menuIds ?? []);
    for (const f of r.auditedFindings) {
      if (!baseKeys.has(f.key)) {
        newFindings.push({
          matchId: r.matchId,
          key: f.key,
          category: f.category,
          severity: f.severity,
          tags: attribute(f, baseMenuIds),
        });
      }
    }
  }

  const byTag: Record<string, number> = {};
  for (const nf of newFindings)
    for (const t of nf.tags) byTag[t] = (byTag[t] ?? 0) + 1;

  // Metric 2: 机制错误率 — hardFailures + causalLint, both arms, same
  // denominator (modelPicked = total raw findings the model produced).
  const causalRate = (rows: ResultRow[]) => {
    const drops = sum(rows, (r) => r.causalDrops);
    const denom = sum(rows, (r) => r.modelPicked);
    return { drops, denom };
  };
  const hardFailRate = (rows: ResultRow[]) => {
    const count = sum(rows, (r) => r.hardFailureCount);
    const items = rows.length;
    return { count, items };
  };

  const cB = causalRate(baseline);
  const cR = causalRate(relaxed);
  const hB = hardFailRate(baseline);
  const hR = hardFailRate(relaxed);

  // richContext byte-identity spot check (proves the relaxations never
  // touched the mechanism-checked context text, not just that hardFailure
  // COUNTS happen to match).
  let richContextIdentical = 0;
  let richContextChecked = 0;
  for (const r of relaxed) {
    const base = baselineByMatch.get(r.matchId);
    if (!base) continue;
    const rTxt = readSafe(
      join(itemDir("relaxed", r.matchId), "richContext.txt"),
    );
    const bTxt = readSafe(
      join(itemDir("baseline", r.matchId), "richContext.txt"),
    );
    if (rTxt === null || bTxt === null) continue;
    richContextChecked++;
    if (rTxt === bTxt) richContextIdentical++;
  }

  const lines: string[] = [];
  lines.push("# 约束预算审计臂 —— pareto 报告");
  lines.push("");
  lines.push(
    `baseline: n=${baseline.length} items processed / relaxed: n=${relaxed.length} items processed`,
  );
  lines.push("");
  lines.push("## Metric 1: 验真新发现率(新增非重复 finding × 审计通过)");
  lines.push("");
  lines.push(
    `合计新发现(relaxed 有、baseline 同场没有,findingKey 判重): ${newFindings.length}`,
  );
  lines.push("");
  lines.push("按约束归因:");
  for (const [tag, n] of Object.entries(byTag).sort())
    lines.push(`- ${tag}: ${n}`);
  lines.push("");
  lines.push("## Metric 2: 机制错误率(两臂对照,分母口径见下)");
  lines.push("");
  lines.push(
    `causalLint 丢弃(分母=模型产出总条数 modelPicked): baseline ${cB.drops}/${cB.denom} vs relaxed ${cR.drops}/${cR.denom}`,
  );
  lines.push(
    `hardFailures(promptQualityCheck 6 类里 5 类的清单无关子集——缺友方死亡覆盖,该项需要 manifest 而本脚本 manifest-independent,逐场 richContext 计数): baseline ${hB.count}/${hB.items} 场 vs relaxed ${hR.count}/${hR.items} 场`,
  );
  lines.push(
    `richContext 逐字节一致(证明三项放松均未触碰机制门检查的上下文文本): ${richContextIdentical}/${richContextChecked}`,
  );
  lines.push("");
  lines.push("## 新发现明细(前 30 条,完整列表见 raw items)");
  lines.push("");
  for (const nf of newFindings.slice(0, 30)) {
    lines.push(
      `- ${nf.matchId} [${nf.tags.join("+")}] ${nf.category}/${nf.severity} key=${nf.key}`,
    );
  }

  const out = lines.join("\n") + "\n";
  console.log(out);
  mkdirSync(join(EVAL_HOME, "reports"), { recursive: true });
  writeFileSync(
    join(EVAL_HOME, "reports", "constraint-budget-audit-metrics.md"),
    out,
  );
  writeFileSync(
    join(HOME, "new-findings.json"),
    JSON.stringify(newFindings, null, 2),
  );
}

function readSafe(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === "select") return cmdSelect(args);
  if (cmd === "run") return cmdRun(args);
  if (cmd === "report") return cmdReport();
  throw new Error(`usage: constraintBudgetAudit.ts select|run|report ...`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
