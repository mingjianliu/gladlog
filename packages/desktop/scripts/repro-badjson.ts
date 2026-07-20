/**
 * bad-json 复现器。
 *
 * 复刻真实链路,不做任何简化:
 *   renderer(StructuredAnalysisPanel):toLegacySafe → extractCandidateFindings
 *                                      → buildMatchContext → input
 *   main(analysis.ts):client.stream(system=buildCoachSystemPrompt, prompt)
 *                      → JSON.parse(raw.trim()) + Array.isArray 判据
 *
 * 用法:tsx repro-badjson.ts <backend> <轮数>
 *   backend = claudeCli | agy
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildFindingsPrompt,
  parseModelJsonArray,
  buildMatchContext,
  extractCandidateFindings,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";

import { buildCoachSystemPrompt } from "../src/main/ai";
import {
  agyClientFactory,
  claudeCliClientFactory,
} from "../src/main/localAiBackends";

const MATCH_DIR = join(
  homedir(),
  "Library/Application Support/gladlog/matches",
);

function loadInput(matchId: string) {
  const doc = JSON.parse(
    readFileSync(join(MATCH_DIR, matchId, "match.json"), "utf-8"),
  );
  // renderer 侧走的是 toLegacySafe:存盘 doc 的 reaction 是字符串、spec 缺失,
  // 裸吃 doc.data 会找不到 owner(第一次跑就踩到了)。
  const legacy = toLegacySafe(doc.data) as any;
  const players = Object.values(legacy.units ?? {}).filter(
    (u: any) => u.info,
  ) as any[];
  const owner =
    players.find(
      (u) =>
        u.id === legacy.playerId && u.reaction === CombatUnitReaction.Friendly,
    ) ??
    players.find(
      (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
    );
  if (!owner) throw new Error(`${matchId}: 找不到 owner`);

  const candidates = extractCandidateFindings(legacy, owner.id);
  const friends = players.filter((u) => u.reaction === owner.reaction);
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  const richContext = buildMatchContext(legacy, friends, enemies, {
    useTimelinePrompt: true,
    owner,
  });
  return {
    matchId,
    candidates,
    richContext,
    spec: specToString(owner.spec),
  };
}

/** 修前判据:旧 main/analysis.ts 的写法,一字不差。 */
function strictJudge(raw: string): { ok: boolean; why: string } {
  try {
    const p = JSON.parse(raw.trim());
    if (!Array.isArray(p)) return { ok: false, why: "not an array" };
    return { ok: true, why: "" };
  } catch (e) {
    return { ok: false, why: (e as Error).message.slice(0, 60) };
  }
}

function classify(raw: string): string {
  const t = raw.trim();
  if (!t) return "空响应";
  if (t.startsWith("```")) return "markdown 围栏";
  if (t.startsWith("{")) return "对象而非数组";
  if (t.startsWith("[")) return t.endsWith("]") ? "数组但语法错" : "截断";
  return "前置散文";
}

async function main() {
  const backend = (process.argv[2] ?? "claudeCli") as "claudeCli" | "agy";
  const rounds = Number(process.argv[3] ?? 2);
  const model = backend === "agy" ? "flash" : "claude-sonnet-5";
  const client =
    backend === "agy"
      ? agyClientFactory({})
      : claudeCliClientFactory({ cmd: "claude" });

  const matchIds = ["c84e13b5", "d2a90ac4"];
  const results: Array<{
    matchId: string;
    round: number;
    ok: boolean;
    fixedOk: boolean;
    raw: string;
    kind: string;
    why: string;
    len: number;
    head: string;
    tail: string;
  }> = [];

  for (const matchId of matchIds) {
    const input = loadInput(matchId);
    const prompt = buildFindingsPrompt(
      input.candidates,
      input.richContext,
      input.spec,
    );
    console.error(
      `[${matchId}] 候选事件=${input.candidates.length} prompt=${prompt.length} 字符`,
    );
    for (let r = 1; r <= rounds; r++) {
      let raw = "";
      try {
        for await (const ev of client.stream({
          model,
          max_tokens: 4096,
          system: buildCoachSystemPrompt("zh"),
          messages: [{ role: "user", content: prompt }],
        })) {
          if (ev.delta) raw += ev.delta;
        }
      } catch (e) {
        raw = `<<STREAM ERROR>> ${(e as Error).message}`;
      }
      const j = strictJudge(raw);
      const fixedOk = parseModelJsonArray(raw) !== null;
      results.push({
        matchId,
        round: r,
        ok: j.ok,
        kind: j.ok ? "OK" : classify(raw),
        why: j.why,
        len: raw.length,
        fixedOk,
        raw, // 存完整原文,便于离线重放两套判据
        head: raw.trim().slice(0, 120),
        tail: raw.trim().slice(-80),
      });
      console.error(
        `  轮${r}: 修前=${j.ok ? "✅" : "❌ " + classify(raw)} 修后=${fixedOk ? "✅" : "❌"} (${raw.length} 字符)`,
      );
    }
  }

  const outPath = process.env.REPRO_OUT ?? "/tmp/repro-badjson.json";
  writeFileSync(outPath, JSON.stringify({ backend, model, results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  const byKind: Record<string, number> = {};
  for (const b of bad) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
  console.error(
    `\n== ${backend}/${model}: ${results.length} 次调用,失败 ${bad.length} ==\n形态: ${JSON.stringify(byKind)}\n原始输出已存: ${outPath}`,
  );
}

void main();
