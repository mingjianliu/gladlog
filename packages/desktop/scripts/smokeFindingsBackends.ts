/**
 * Multi-backend findings selection-distribution smoke (常驻测量脚本,
 * 2026-08-11). Motivation: users report coach output "基本不是饰品就是驱散"
 * (almost always trinket/dispel). The candidate menu was already expanded
 * with four new types (healing-gap/position-mistake/cc-held/cc-avoidable —
 * BACKLOG #18 second batch), but the MODEL SELECTION layer has no diversity
 * constraint yet — this script measures what the model actually picks
 * **before** a diversity instruction is added to buildFindingsPrompt, so an
 * eventual A/B has a real "before" number instead of a vibe.
 *
 * Runs the same production chain as verify-production.ts (that script stays
 * unmodified — it is the byte-for-byte claudeCli acceptance check; this one
 * generalizes the SAME chain across backends for a different purpose, hence
 * a sibling script rather than a shared refactor):
 *   renderer: toLegacySafe → extractCandidateFindings → buildMatchContext
 *   main:     buildFindingsPrompt → model (backend-selectable, zh system,
 *             max_tokens 8192) → parseModelJsonArray (one retry on null) →
 *             auditFindings
 *
 * For each match, audited (survived) findings are mapped back to a topic via
 * their eventIds → CandidateEvent.type (the finding's first eventId; audit's
 * grounding layer guarantees every eventId resolves to a real candidate, so
 * this is always defined for a survived finding). Output per backend:
 *   - per match: 挑中条数(model raw parsed length)/ 审计后条数(kept)
 *   - 话题族分布: audited findings grouped by candidate type, with the four
 *     legacy-dominant types (missed-cleanse/missed-purge/cc-locked/
 *     wasted-trinket) summed as one family and reported as a % of all
 *     survived findings
 *   - 新类型出场数: how many survived findings landed on each of the four new
 *     types (healing-gap/position-mistake/cc-held/cc-avoidable)
 *   - 菜单里各类型可选数(分母): candidate counts by type, summed across the
 *     matches actually processed (denominator for the two distributions
 *     above)
 *
 * call-error accounting (lesson from packages/eval/scripts/momentDiveAb.ts):
 * a thrown client.stream() (CLI non-zero exit / timeout / network failure) OR
 * a response that "looks like" a rate-limit/quota message
 * (`looksLikeCallFailure`, same predicate momentDiveAb.ts uses) is recorded
 * as call-error and that match is EXCLUDED from every distribution above —
 * never silently folded into "0 findings" or "menu had nothing".
 *
 * Usage: tsx smokeFindingsBackends.ts --backend=<claudeCli|agy|deepseek|codex> [--matches=6]
 * If the backend's CLI/key is not available on this machine, prints
 * "后端不可用" and exits 0 (not an error) — the caller runs each backend as a
 * separate invocation and moves on to the next one.
 *
 * ---- 基线记录(改前,当前 HEAD,2026-08-11,四后端同批 6 场)----
 * 完整报告: .superpowers/sdd/2026-08-05-window-multi-finding/diversity-baseline-report.md
 * (核心数字栏位由该报告维护,不在此文件内复制以免漂移——本文件头只留指针。)
 *
 * ---- 静音候选率读数(2026-08-11)----
 * 汇总新增一行「静音候选率」= (`numeric:` 前缀丢弃条数) / (审计前模型产出总条数,
 * = `modelPickedTotal`,已有的逐场 `parsed.length` 累加)。这是**代理指标**,不是
 * 共享门规谓词(CLAUDE.md 门规谓词即规范一节明确排除这类脚本仪表)。本脚本走的
 * 审计层是 `auditFindings`(findings 选择,packages/analysis/src/analysis/
 * auditFindings.ts),不是 `packages/eval/scripts/momentDiveAb.ts` 走的
 * `auditDeepDives`——两者的丢弃 reason 词表不同源:`auditDeepDives` 把「claimChecker
 * 校验失败」和「占位符外裸数字」拆成 `claim-check`/`bare-digit` 两个独立枚举值,
 * 而 `auditFindings` 把这两种情况都写成同一个 `numeric:` 前缀(见该文件 L100
 * `numeric: ${check.violations...}` = claimChecker 失败,等价 claim-check;L117
 * `numeric: raw digit outside placeholder` = 裸数字,等价 bare-digit)——因此这里
 * 用 `reason.startsWith("numeric:")` 而非两个独立字符串匹配,是同一族丢弃原因在
 * 不同审计实现下的等价读数,不是新判据。口径互指:momentDiveAb.ts 头部注释。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  auditFindings,
  buildFindingsPrompt,
  buildMatchContext,
  extractCandidateFindings,
  parseModelJsonArray,
  specToString,
  type CandidateEvent,
  type RawFinding,
  ensureAnalysisData,
} from "@gladlog/analysis";

import { resolveOwner } from "../src/renderer/src/report/derive/analysisInput";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import type { AnthropicLike } from "../src/main/ai";
import { buildCoachSystemPrompt } from "../src/main/ai";
import { detectLocalCliCached, type LocalCliTool } from "../src/main/cliDetect";
import { deepseekClientFactory } from "../src/main/deepseekClient";
import {
  agyClientFactory,
  claudeCliClientFactory,
  codexClientFactory,
} from "../src/main/localAiBackends";
import { AI_DEFAULT_MODEL } from "../src/shared/aiModels";

const MATCH_DIR = join(
  homedir(),
  "Library/Application Support/gladlog/matches",
);

type Backend = "claudeCli" | "agy" | "deepseek" | "codex";
const BACKENDS: Backend[] = ["claudeCli", "agy", "deepseek", "codex"];

/** The four legacy-dominant candidate types the user's complaint names
 * ("基本不是饰品就是驱散" — trinket/dispel). Grouped as one family so the
 * baseline reads as a single before/after number, not four separate ones. */
const FOUR_FAMILY_TYPES = [
  "missed-cleanse",
  "missed-purge",
  "cc-locked",
  "wasted-trinket",
] as const;

/** The four newly-added candidate types (BACKLOG #18 second batch) the
 * diversity instruction is meant to surface more often. */
const NEW_TYPES = [
  "healing-gap",
  "position-mistake",
  "cc-held",
  "cc-avoidable",
] as const;

// ---- arg parsing ----

function parseArgs(argv: string[]): { backend: Backend; matches: number } {
  let backend: Backend | undefined;
  let matches = 6;
  for (const a of argv) {
    if (a.startsWith("--backend=")) {
      const v = a.slice("--backend=".length);
      if ((BACKENDS as string[]).includes(v)) backend = v as Backend;
    } else if (a.startsWith("--matches=")) {
      const n = Number(a.slice("--matches=".length));
      if (Number.isFinite(n) && n > 0) matches = n;
    }
  }
  if (!backend) {
    console.error(
      `用法: tsx smokeFindingsBackends.ts --backend=<${BACKENDS.join("|")}> [--matches=6]`,
    );
    process.exit(1);
  }
  return { backend, matches };
}

// ---- backend availability probe + client factory ----

/** DeepSeek key handling per existing convention (packages/eval/src/family/
 * deepseekDriver.ts): ~/.config/gladlog-dev/deepseek.key, read-only, trimmed,
 * NEVER printed or logged — only this function's own error messages may
 * reference the *path*. */
function readDeepseekKey(): string {
  const p = join(homedir(), ".config", "gladlog-dev", "deepseek.key");
  let raw: string;
  try {
    raw = readFileSync(p, "utf-8");
  } catch (e) {
    throw new Error(`DeepSeek key 未找到:${p}(${(e as Error).message})`);
  }
  const key = raw.trim();
  if (!key) throw new Error(`DeepSeek key 文件为空:${p}`);
  return key;
}

async function probeBackend(
  backend: Backend,
): Promise<{ ok: boolean; detail: string }> {
  if (backend === "deepseek") {
    try {
      readDeepseekKey();
      return { ok: true, detail: "key 文件存在" };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
  const tool: LocalCliTool = backend === "claudeCli" ? "claude" : backend;
  const path = await detectLocalCliCached(tool);
  return path
    ? { ok: true, detail: path }
    : {
        ok: false,
        detail: `未检测到 ${tool} 命令(PATH + 常见安装目录均未找到)`,
      };
}

function makeClient(backend: Backend): AnthropicLike {
  switch (backend) {
    case "claudeCli":
      return claudeCliClientFactory({ cmd: "claude" });
    case "agy":
      return agyClientFactory();
    case "codex":
      return codexClientFactory();
    case "deepseek":
      return deepseekClientFactory(readDeepseekKey());
  }
}

/** Inspired by momentDiveAb.ts's looksLikeCallFailure (an empty reply, or one
 * that reads like a rate-limit/quota message, is a call failure even though
 * the process exited 0 — must never be counted as "the model picked
 * nothing"), but NOT a byte-for-byte copy: momentDiveAb's bare
 * `/limit|rate/i` substring match false-positived for real during this
 * script's 2026-08-11 deepseek baseline run — a genuine, well-formed findings
 * JSON array got discarded as "call-error" because its English explanation
 * text used an ordinary word like "generate" (contains "rate" as a
 * substring). Fixed with two changes: (a) phrase-level patterns instead of
 * bare "limit"/"rate" substrings, and (b) a length gate — a real quota/
 * rate-limit banner is short plain-text prose, never a multi-hundred-
 * character findings JSON array, so anything long enough to plausibly be
 * real output is never flagged regardless of phrasing. The same fix was
 * ported into momentDiveAb.ts's own `looksLikeCallFailure` (2026-08-11, see
 * that function's doc comment) so the two scripts don't silently diverge on
 * the same failure mode again. */
function looksLikeCallFailure(raw: string): boolean {
  const t = raw.trim();
  if (t === "") return true;
  if (t.length > 400) return false;
  return /rate[\s-]?limit|too many requests|quota exceeded|\b429\b/i.test(t);
}

// ---- match loading (mirrors verify-production.ts's pickSources/buildInput) ----

function pickSources(doc: {
  kind?: string;
  data?: { rounds?: unknown[] } & Record<string, unknown>;
}): { label: string; source: unknown }[] {
  if (doc.kind === "shuffle") {
    const rounds = doc.data?.rounds ?? [];
    // Same cost-control choice as verify-production.ts: one round per match.
    return rounds.length ? [{ label: "r0", source: rounds[0] }] : [];
  }
  return [{ label: "m", source: doc.data }];
}

function buildInput(source: unknown) {
  const legacy = toLegacySafe(source) as any;
  const players = Object.values(legacy.units ?? {}).filter(
    (u: any) => u.info,
  ) as any[];
  const owner = resolveOwner(legacy);
  if (!owner) return null;
  const candidates = extractCandidateFindings(legacy, owner.id);
  const friends = players.filter((u: any) => u.reaction === owner.reaction);
  const enemies = players.filter((u: any) => u.reaction !== owner.reaction);
  const richContext = buildMatchContext(legacy, friends, enemies, {
    owner,
  });
  return { candidates, richContext, spec: specToString(owner.spec) };
}

// ---- per-backend run ----

function bump(rec: Record<string, number>, key: string, by = 1): void {
  rec[key] = (rec[key] ?? 0) + by;
}

async function callOnce(
  client: AnthropicLike,
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

async function main() {
  await ensureAnalysisData();
  const { backend, matches: n } = parseArgs(process.argv.slice(2));
  const probe = await probeBackend(backend);
  if (!probe.ok) {
    console.log(`后端不可用: ${backend}(${probe.detail})`);
    return;
  }
  console.log(
    `后端 ${backend} 可用(${probe.detail}),模型=${AI_DEFAULT_MODEL[backend]}`,
  );

  const client = makeClient(backend);
  const model = AI_DEFAULT_MODEL[backend];
  const system = buildCoachSystemPrompt("zh");

  const index = readFileSync(join(MATCH_DIR, "_index.ndjson"), "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id: string; kind?: string });
  const recent = index.slice(-n);

  let modelPickedTotal = 0;
  let auditedTotal = 0;
  let callErrors = 0;
  let badJson = 0;
  let retriesUsed = 0;
  let processed = 0;
  // 静音候选率分子(见头部注释):auditFindings 里等价于 momentDiveAb.ts 的
  // bare-digit + claim-check 的丢弃原因,统一以 "numeric:" 前缀识别。
  let numericDropsTotal = 0;
  const menuByType: Record<string, number> = {};
  const survivedByType: Record<string, number> = {};

  for (const meta of recent) {
    const doc = JSON.parse(
      readFileSync(join(MATCH_DIR, meta.id, "match.json"), "utf-8"),
    );
    for (const { label, source } of pickSources(doc)) {
      const matchLabel = `${meta.id.slice(0, 8)}/${label}`;
      const input = buildInput(source);
      if (!input) {
        console.log(`${matchLabel}: 找不到 owner,跳过`);
        continue;
      }
      const byId = new Map<string, CandidateEvent>(
        input.candidates.map((c) => [c.id, c]),
      );
      const prompt = buildFindingsPrompt(
        input.candidates,
        input.richContext,
        input.spec,
      );

      let raw: string;
      try {
        raw = await callOnce(client, model, system, prompt);
      } catch (e) {
        callErrors++;
        console.log(
          `${matchLabel}: call-error(调用失败:${(e as Error).message.slice(0, 200)})`,
        );
        continue;
      }
      if (looksLikeCallFailure(raw)) {
        callErrors++;
        console.log(
          `${matchLabel}: call-error(疑似限额/限流响应:${
            raw.trim() ? raw.trim().slice(0, 200) : "(空输出)"
          })`,
        );
        continue;
      }

      let attempt = 1;
      let parsed = parseModelJsonArray(raw) as RawFinding[] | null;
      if (!parsed) {
        attempt = 2;
        retriesUsed++;
        let raw2: string;
        try {
          raw2 = await callOnce(client, model, system, prompt);
        } catch (e) {
          callErrors++;
          console.log(
            `${matchLabel}: call-error(重试调用失败:${(e as Error).message.slice(0, 200)})`,
          );
          continue;
        }
        if (looksLikeCallFailure(raw2)) {
          callErrors++;
          console.log(
            `${matchLabel}: call-error(重试疑似限额/限流响应:${
              raw2.trim() ? raw2.trim().slice(0, 200) : "(空输出)"
            })`,
          );
          continue;
        }
        raw = raw2;
        parsed = parseModelJsonArray(raw2) as RawFinding[] | null;
      }
      if (!parsed) {
        badJson++;
        console.log(
          `${matchLabel}: 菜单=${input.candidates.length} → BAD-JSON×2(前80字: ${raw.slice(0, 80).replace(/\n/g, " ")})`,
        );
        continue;
      }

      const audit = auditFindings(parsed, input.candidates);
      processed++;
      modelPickedTotal += parsed.length;
      auditedTotal += audit.findings.length;
      numericDropsTotal += audit.dropped.filter((d) =>
        d.reason.startsWith("numeric:"),
      ).length;
      for (const c of input.candidates) bump(menuByType, c.type);
      for (const f of audit.findings) {
        const t = byId.get(f.eventIds[0]!)?.type ?? "unknown";
        bump(survivedByType, t);
      }
      const reasons = audit.dropped
        .map((d) => d.reason.split(":")[0])
        .join(",");
      console.log(
        `${matchLabel}: 菜单=${input.candidates.length} 模型=${parsed.length} 保留=${audit.findings.length} 丢=${audit.dropped.length}${reasons ? `(${reasons})` : ""} 解析第${attempt}次成功`,
      );
      for (const f of audit.findings) {
        const t = byId.get(f.eventIds[0]!)?.type ?? "unknown";
        console.log(`    [${f.severity}] (${t}) ${f.title}`);
      }
    }
  }

  console.log(
    `\n=== ${backend} 汇总(有效场次 ${processed},call-error ${callErrors} 场不计入分布)===`,
  );
  console.log(
    `挑中(模型) ${modelPickedTotal} / 审计后存活 ${auditedTotal} / bad-json 终败 ${badJson} / 重试触发 ${retriesUsed} 次`,
  );
  const silentRatePct =
    modelPickedTotal > 0
      ? ((numericDropsTotal / modelPickedTotal) * 100).toFixed(1)
      : "n/a";
  console.log(
    `静音候选率(代理指标,numeric: 前缀丢弃[≈bare-digit+claim-check] / 审计前模型产出总条数): ${numericDropsTotal}/${modelPickedTotal} = ${silentRatePct}%(代理指标,>15% 提示人工抽查 dropped 原文归因:门太紧 vs 词汇穷)`,
  );

  const allTypes = Array.from(
    new Set([...Object.keys(menuByType), ...Object.keys(survivedByType)]),
  ).sort();
  console.log(`\n类型分布(菜单可选数 / 存活数):`);
  for (const t of allTypes) {
    console.log(
      `  ${t}: 菜单=${menuByType[t] ?? 0} 存活=${survivedByType[t] ?? 0}`,
    );
  }

  const fourFamilyTotal = FOUR_FAMILY_TYPES.reduce(
    (s, t) => s + (survivedByType[t] ?? 0),
    0,
  );
  const fourFamilyPct =
    auditedTotal > 0
      ? ((fourFamilyTotal / auditedTotal) * 100).toFixed(1)
      : "n/a";
  console.log(
    `\n四族(missed-cleanse/missed-purge/cc-locked/wasted-trinket)合计: ${fourFamilyTotal}/${auditedTotal} = ${fourFamilyPct}%`,
  );
  console.log(`新类型出场数(挑中且存活):`);
  for (const t of NEW_TYPES) {
    console.log(
      `  ${t}: ${survivedByType[t] ?? 0}(菜单可选 ${menuByType[t] ?? 0})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
