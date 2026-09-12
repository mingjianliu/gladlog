/**
 * Production verification driver (acceptance for the 2026-07-25 "only 2 findings
 * / malformed output" fix): runs the findings chain byte-for-byte identical to
 * the product against **real matches in this machine's library** —
 *   renderer: toLegacySafe → extractCandidateFindings → buildMatchContext
 *   main:     buildFindingsPrompt → claudeCli against the real model (zh system,
 *             max_tokens 8192) → parseModelJsonArray (one retry on null) →
 *             auditFindings
 * Prints per match: menu size / parse result (which attempt succeeded) / kept
 * count / drop reasons.
 *
 * Usage: tsx verify-production.ts [matchCount=6]
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
  type RawFinding,
} from "@gladlog/analysis";

import { resolveOwner } from "../src/renderer/src/report/derive/analysisInput";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import { buildCoachSystemPrompt } from "../src/main/ai";
import { claudeCliClientFactory } from "../src/main/localAiBackends";
import { AI_DEFAULT_MODEL } from "../src/shared/aiModels";

const MATCH_DIR = join(
  homedir(),
  "Library/Application Support/gladlog/matches",
);

function pickSources(doc: {
  kind?: string;
  data?: { rounds?: unknown[] } & Record<string, unknown>;
}): { label: string; source: unknown }[] {
  if (doc.kind === "shuffle") {
    const rounds = doc.data?.rounds ?? [];
    // The product analyzes every round; here we take only the first round per
    // match (cost control)
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

async function main() {
  const n = Number(process.argv[2] ?? 6);
  const index = readFileSync(join(MATCH_DIR, "_index.ndjson"), "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id: string; kind?: string });
  const recent = index.slice(-n);
  const client = claudeCliClientFactory({ cmd: "claude" });

  let totalKept = 0;
  let totalDropped = 0;
  let badJson = 0;
  let retriesUsed = 0;

  for (const meta of recent) {
    const doc = JSON.parse(
      readFileSync(join(MATCH_DIR, meta.id, "match.json"), "utf-8"),
    );
    for (const { label, source } of pickSources(doc)) {
      const input = buildInput(source);
      if (!input) {
        console.log(`${meta.id.slice(0, 8)}/${label}: 找不到 owner,跳过`);
        continue;
      }
      const prompt = buildFindingsPrompt(
        input.candidates,
        input.richContext,
        input.spec,
      );
      const callOnce = async () => {
        let raw = "";
        for await (const ev of client.stream({
          model: AI_DEFAULT_MODEL.claudeCli,
          max_tokens: 8192,
          system: buildCoachSystemPrompt("zh"),
          messages: [{ role: "user", content: prompt }],
        })) {
          if (ev.delta) raw += ev.delta;
        }
        return { raw, parsed: parseModelJsonArray(raw) as RawFinding[] | null };
      };
      let attempt = 1;
      let call = await callOnce();
      if (!call.parsed) {
        attempt = 2;
        retriesUsed++;
        call = await callOnce();
      }
      if (!call.parsed) {
        badJson++;
        console.log(
          `${meta.id.slice(0, 8)}/${label}: 菜单=${input.candidates.length} → BAD-JSON×2(前80字: ${call.raw.slice(0, 80).replace(/\n/g, " ")})`,
        );
        continue;
      }
      const audit = auditFindings(call.parsed, input.candidates);
      totalKept += audit.findings.length;
      totalDropped += audit.dropped.length;
      const reasons = audit.dropped
        .map((d) => d.reason.split(":")[0])
        .join(",");
      console.log(
        `${meta.id.slice(0, 8)}/${label}: 菜单=${input.candidates.length} 模型=${call.parsed.length} 保留=${audit.findings.length} 丢=${audit.dropped.length}${reasons ? `(${reasons})` : ""} 解析第${attempt}次成功`,
      );
      for (const f of audit.findings)
        console.log(`    [${f.severity}] ${f.title}`);
    }
  }
  console.log(
    `\n汇总:保留 ${totalKept} / 丢弃 ${totalDropped};bad-json 终败 ${badJson};重试触发 ${retriesUsed} 次`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
