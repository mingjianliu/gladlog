/* eslint-disable no-console */
/**
 * deepDiveCausalProbe.ts — GH #70 tail: align the deep-dive round's causation
 * rule with the findings prompt's (PROMPT_VERSION 109), measured the same
 * way: same rounds, old vs new prompt, every surviving sentence judged blind
 * with both arms mixed.
 *
 * Input is a consequenceProbe run whose arm A holds PROMPT_VERSION ≥ 109
 * first-round responses (e.g. eval-private runs/2026-09-24-gh70-launch-check):
 * those findings, audited by the product's auditFindings, feed the deep dive
 * exactly as desktop/main/analysis.ts does (audited, placeholders not yet
 * interpolated). Packs follow the renderer's buildDeepenPacks: findings by
 * severity, buildDeepDivePack + hasCoachableSignal, up to DEEP_DIVE_MAX.
 * The audit-repair retry is not run (it only fires on an all-dropped round).
 *
 * Subcommands:
 *   build --src RUN --out OUT --arm old|new
 *       run once BEFORE and once AFTER the prompt change (byte-exact arms,
 *       no reconstruction); OUT/<arm>/prompts/NNN.txt, OUT/packs/NNN.json
 *   run --run OUT --arm old|new [--concurrency 4] [--lang zh] [--model M]
 *   audit --run OUT --arm old|new       → OUT/<arm>/dives/NNN.json (+ drops)
 *   judge-prep --run OUT / judge --run OUT / report --run OUT
 */
import {
  auditFindings,
  ensureAnalysisData,
  parseModelJsonArray,
} from "@gladlog/analysis";
import { extractCandidateFindings } from "@gladlog/analysis/src/analysis/candidateFindings";
import {
  type AuditDropInfo,
  auditDeepDives,
  buildDeepDivePack,
  buildDeepDivePrompt,
  DEEP_DIVE_MAX,
  type DeepDivePack,
  hasCoachableSignal,
} from "@gladlog/analysis/src/analysis/deepDive";
import type { Finding, RawFinding } from "@gladlog/analysis/src/analysis/types";
import { SEVERITY_RANK } from "@gladlog/analysis";
import { specToString } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { selectCorpusOwner } from "../src/corpus/buildCorpus";
import {
  callClaude,
  coachSystemPrompt,
  type JudgeItem,
  judgeInstructions,
  sentencesOf,
  shuffled,
} from "../src/explore/sentenceJudge";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string, d?: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : d;
};
const nnnOf = (n: number): string => String(n).padStart(3, "0");

function combatsOf(path: string): any[] {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  const out: any[] = [];
  const parser = new GladLogParser();
  parser.on("match", (m: any) => out.push(toLegacyMatch(m)));
  parser.on("shuffle", (sh: any) => {
    for (const r of toLegacyShuffle(sh).rounds ?? []) out.push(r);
  });
  for (const line of text.split(/\r?\n/)) parser.push(line);
  parser.end();
  return out;
}

async function build(): Promise<void> {
  await ensureAnalysisData();
  const src = flag("--src")!;
  const out = flag("--out")!;
  const arm = flag("--arm")!;
  mkdirSync(join(out, arm, "prompts"), { recursive: true });
  mkdirSync(join(out, "packs"), { recursive: true });
  const index = JSON.parse(
    readFileSync(join(src, "A", "index.json"), "utf8"),
  ) as { ordinal: number; matchId: string; source: string }[];
  let rounds = 0;
  let packsN = 0;
  for (const e of index) {
    const nnn = nnnOf(e.ordinal);
    const respPath = join(src, "A", "responses", `${nnn}.txt`);
    if (!existsSync(respPath)) continue;
    const combat = combatsOf(e.source).find(
      (c) => String(c.id ?? e.source.split("/").pop()) === e.matchId,
    );
    if (!combat) continue;
    const players: any[] = Object.values(combat.units ?? {}).filter(
      (u: any) => u.info,
    );
    const owner: any = selectCorpusOwner(players, combat, "recorder");
    if (!owner) continue;
    const candidates = extractCandidateFindings(combat, owner.id);
    const raw = readFileSync(respPath, "utf8");
    const parsed = parseModelJsonArray(raw.slice(raw.indexOf("\n")));
    if (!parsed) continue;
    const findings: Finding[] = auditFindings(
      parsed as RawFinding[],
      candidates,
    ).findings;
    // renderer buildDeepenPacks: severity order, gate, cap
    const ranked = findings
      .map((f, i) => ({ f, i }))
      .sort(
        (a, b) =>
          (SEVERITY_RANK[a.f.severity] ?? 9) -
            (SEVERITY_RANK[b.f.severity] ?? 9) || a.i - b.i,
      );
    const packs: DeepDivePack[] = [];
    for (const { f, i } of ranked) {
      if (packs.length >= DEEP_DIVE_MAX) break;
      const pack = buildDeepDivePack(combat, f, i, candidates, owner.name);
      if (pack && hasCoachableSignal(pack.items)) packs.push(pack);
    }
    if (packs.length === 0) continue;
    const prompt = buildDeepDivePrompt(
      packs,
      findings,
      specToString(owner.spec) || String(owner.spec),
      owner.name,
    );
    writeFileSync(join(out, arm, "prompts", `${nnn}.txt`), prompt);
    writeFileSync(join(out, "packs", `${nnn}.json`), JSON.stringify(packs));
    rounds++;
    packsN += packs.length;
  }
  console.log(
    `[${arm}] ${rounds} rounds with deep-dive packs, ${packsN} packs`,
  );
}

async function runArm(): Promise<void> {
  const run = flag("--run")!;
  const arm = flag("--arm")!;
  const conc = Number(flag("--concurrency", "4"));
  const lang = (flag("--lang", "zh") as "en" | "zh") ?? "zh";
  const model = flag("--model", "claude-opus-5-5")!;
  const dir = join(run, arm);
  mkdirSync(join(dir, "responses"), { recursive: true });
  const todo = readdirSync(join(dir, "prompts"))
    .filter((f) => f.endsWith(".txt"))
    .filter((f) => !existsSync(join(dir, "responses", f)));
  console.log(`[${arm}] ${todo.length} to run, model=${model}`);
  let next = 0;
  let failures = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const f = todo[next++]!;
      const prompt = `${coachSystemPrompt(lang)}\n${readFileSync(join(dir, "prompts", f), "utf8")}`;
      let r = await callClaude(prompt, model);
      if (!r) r = await callClaude(prompt, model);
      if (!r) {
        failures++;
        console.error(`  ${f} FAILED twice`);
        if (failures >= 4) process.exit(3);
        continue;
      }
      writeFileSync(join(dir, "responses", f), r.text);
      console.log(`  ${f} ok out=${r.env.usage?.output_tokens}`);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
}

function audit(): void {
  const run = flag("--run")!;
  const arm = flag("--arm")!;
  const dir = join(run, arm);
  mkdirSync(join(dir, "dives"), { recursive: true });
  const reasons: Record<string, number> = {};
  let kept = 0;
  let written = 0;
  for (const f of readdirSync(join(dir, "responses"))) {
    const nnn = f.slice(0, 3);
    const packs = JSON.parse(
      readFileSync(join(run, "packs", `${nnn}.json`), "utf8"),
    ) as DeepDivePack[];
    const drops: AuditDropInfo[] = [];
    const dives = auditDeepDives(
      parseModelJsonArray(readFileSync(join(dir, "responses", f), "utf8")),
      packs,
      { onDrop: (d) => drops.push(d) },
    );
    for (const d of drops) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
    kept += dives.length;
    written += dives.length + drops.length;
    writeFileSync(
      join(dir, "dives", `${nnn}.json`),
      JSON.stringify(
        {
          dives,
          drops: drops.map((d) => ({ reason: d.reason, detail: d.detail })),
        },
        null,
        2,
      ),
    );
  }
  const summary = { kept, written, dropReasons: reasons };
  writeFileSync(
    join(dir, "audit-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(`[${arm}] ${JSON.stringify(summary)}`);
}

function judgePrep(): void {
  const run = flag("--run")!;
  mkdirSync(join(run, "judge", "prompts"), { recursive: true });
  let total = 0;
  for (const f of readdirSync(join(run, "new", "prompts"))) {
    const nnn = f.slice(0, 3);
    const items: JudgeItem[] = [];
    for (const arm of ["old", "new"] as const) {
      const p = join(run, arm, "dives", `${nnn}.json`);
      if (!existsSync(p)) continue;
      const { dives } = JSON.parse(readFileSync(p, "utf8")) as {
        dives: { findingIndex: number; text: string }[];
      };
      for (const d of dives)
        for (const s of sentencesOf(d.text))
          items.push({
            id: "",
            arm: arm === "old" ? "B" : "A",
            finding: d.findingIndex,
            part: "sentence",
            text: s,
          });
    }
    if (!items.length) continue;
    const mixed = shuffled(items, Number(nnn) * 7919).map((it, i) => ({
      ...it,
      id: `s${i + 1}`,
    }));
    writeFileSync(
      join(run, "judge", `${nnn}.items.json`),
      JSON.stringify(mixed, null, 2),
    );
    const prompt = readFileSync(join(run, "new", "prompts", f), "utf8");
    const evidence = prompt.slice(0, prompt.indexOf("\nHARD RULES:"));
    writeFileSync(
      join(run, "judge", "prompts", `${nnn}.txt`),
      `${judgeInstructions("the first-round coaching findings and their evidence packs — deterministic facts drawn from the log")}\n\n=== EVIDENCE ===\n${evidence}\n=== SENTENCES ===\n${mixed.map((it) => `${it.id}: ${it.text}`).join("\n")}\n`,
    );
    total += mixed.length;
  }
  console.log(`judge prompts written: ${total} sentences`);
}

async function judgeRun(): Promise<void> {
  const run = flag("--run")!;
  const conc = Number(flag("--concurrency", "4"));
  const model = flag("--model", "claude-opus-5-5")!;
  const dir = join(run, "judge");
  const todo = readdirSync(join(dir, "prompts")).filter(
    (f) => !existsSync(join(dir, f.replace(".txt", ".verdicts.json"))),
  );
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const f = todo[next++]!;
      const prompt = readFileSync(join(dir, "prompts", f), "utf8");
      let parsed: unknown[] | null = null;
      for (let a = 0; a < 2 && !parsed; a++) {
        const r = await callClaude(prompt, model);
        if (r) parsed = parseModelJsonArray(r.text) as unknown[] | null;
      }
      if (!parsed) {
        console.error(`  judge ${f} FAILED`);
        continue;
      }
      writeFileSync(
        join(dir, f.replace(".txt", ".verdicts.json")),
        JSON.stringify(parsed, null, 2),
      );
      console.log(`  judge ${f} ok (${parsed.length})`);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
}

function report(): void {
  const run = flag("--run")!;
  const dir = join(run, "judge");
  type V = { id: string; kind: string; supported: string; note: string };
  const rows: (JudgeItem & V & { nnn: string })[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".items.json"))) {
    const nnn = f.slice(0, 3);
    const vPath = join(dir, `${nnn}.verdicts.json`);
    if (!existsSync(vPath)) continue;
    const vs = new Map(
      (JSON.parse(readFileSync(vPath, "utf8")) as V[]).map((v) => [v.id, v]),
    );
    for (const it of JSON.parse(
      readFileSync(join(dir, f), "utf8"),
    ) as JudgeItem[]) {
      const v = vs.get(it.id);
      if (v) rows.push({ ...it, ...v, nnn });
    }
  }
  const kinds = [
    "observation",
    "consequence",
    "causal-verdict",
    "counterfactual",
    "advice",
    "other",
  ];
  const lines = [
    `# GH #70 deep-dive causation probe — ${run}`,
    "",
    "arm B = old deep-dive rule, arm A = new (aligned with the findings prompt, PROMPT_VERSION ≥ 109); cells n (yes/partly/no)",
    "",
    "| arm | dives kept / written | drops by reason | sentences | " +
      kinds.join(" | ") +
      " | dives with ≥ 1 overreach | unsupported sentences |",
    "|" + "---|".repeat(kinds.length + 6),
  ];
  for (const [arm, name] of [
    ["B", "old"],
    ["A", "new"],
  ] as const) {
    const s = JSON.parse(
      readFileSync(join(run, name, "audit-summary.json"), "utf8"),
    );
    const rs = rows.filter((r) => r.arm === arm);
    const k = (x: string): string => {
      const sub = rs.filter((r) => r.kind === x);
      const c = (v: string): number =>
        sub.filter((r) => r.supported === v).length;
      return `${sub.length} (${c("yes")}/${c("partly")}/${c("no")})`;
    };
    const byDive = new Map<string, typeof rs>();
    for (const r of rs)
      byDive.set(`${r.nnn}#${r.finding}`, [
        ...(byDive.get(`${r.nnn}#${r.finding}`) ?? []),
        r,
      ]);
    const over = [...byDive.values()].filter((d) =>
      d.some(
        (r) =>
          (r.kind === "consequence" && r.supported !== "yes") ||
          r.kind === "causal-verdict" ||
          (r.kind === "counterfactual" && r.supported !== "yes"),
      ),
    ).length;
    lines.push(
      `| ${arm} (${name}) | ${s.kept} / ${s.written} | ${JSON.stringify(s.dropReasons)} | ${rs.length} | ${kinds.map(k).join(" | ")} | ${over}/${byDive.size} (${((100 * over) / Math.max(1, byDive.size)).toFixed(1)} %) | ${rs.filter((r) => r.supported === "no").length} |`,
    );
  }
  lines.push(
    "",
    "## consequence / causal-verdict / counterfactual sentences",
    "",
  );
  for (const r of rows
    .filter((x) =>
      ["consequence", "causal-verdict", "counterfactual"].includes(x.kind),
    )
    .sort((a, b) => (a.nnn + a.arm).localeCompare(b.nnn + b.arm)))
    lines.push(
      `- ${r.nnn} ${r.arm} f${r.finding} **${r.kind} / ${r.supported}** — ${r.text}${r.supported !== "yes" ? `  _(${r.note})_` : ""}`,
    );
  writeFileSync(join(run, "report.md"), lines.join("\n") + "\n");
  writeFileSync(join(run, "judged-rows.json"), JSON.stringify(rows, null, 2));
  console.log(lines.slice(0, 8).join("\n"));
}

const main =
  cmd === "build"
    ? build
    : cmd === "run"
      ? runArm
      : cmd === "audit"
        ? async () => audit()
        : cmd === "judge-prep"
          ? async () => judgePrep()
          : cmd === "judge"
            ? judgeRun
            : cmd === "report"
              ? async () => report()
              : null;
if (!main) {
  console.error(
    "usage: deepDiveCausalProbe.ts build|run|audit|judge-prep|judge|report … (see header)",
  );
  process.exit(2);
}
void main();
