/* eslint-disable no-console */
/**
 * consequenceProbe.ts — GH #70 two-arm experiment: may the findings prompt
 * state OBSERVABLE consequences (user rulings 2026-09-19 / 2026-09-24)?
 *
 * Arm A = the production findings prompt, byte-for-byte what buildCorpus
 * (GLADLOG_CORPUS_PROMPT=findings, owner = recorder) renders.
 * Arm B = the same prompt with (1) an OBSERVED CONSEQUENCES section appended
 * to the match context (`src/explore/consequenceFacts.ts`) and (2) the
 * causation hard rule swapped for "observable consequences yes, causal
 * verdicts / counterfactuals no". Nothing in the product changes.
 *
 * Subcommands:
 *   build --manifest M --every N --offset K --target 40 --out RUN [--gate 50]
 *       one qualifying round per archive file (recorder owner, non-empty menu,
 *       ≥ 3 consequence lines of ≥ 2 kinds, ≥ 1 enemy wall/trinket inside our
 *       kill attempt); writes RUN/{A,B}/prompts/NNN-id.txt,
 *       RUN/{A,B}/index.json (interpolateResponses.ts layout), RUN/conseq/NNN.txt
 *   dist --manifest M --every N [--offset K] [--limit L]
 *       HP% of enemy walls / externals / trinkets at use inside vs outside our
 *       kill attempts — the distribution the forced-gate value is chosen from
 *   run --run RUN --arm A|B [--concurrency 3] [--lang zh] [--model claude-opus-5-5]
 *       `claude -p` (product isolation args, neutral cwd, product system prompt
 *       prepended as joinPrompt does), resumable; RUN/<arm>/responses/NNN.txt
 *   then: npx tsx packages/eval/scripts/interpolateResponses.ts --arm RUN/<arm>
 *   judge-prep --run RUN / judge --run RUN [--concurrency 4] / report --run RUN
 *       every surviving title + explanation sentence of BOTH arms, shuffled
 *       per round, judged blind (Opus 5.5) against arm B's evidence;
 *       RUN/report.md + RUN/judged-rows.json
 *
 * First run (2026-09-24, PROMPT_VERSION 106, 40 rounds --every 97 --offset 13,
 * zh, Opus 5.5; eval-private runs/2026-09-24-gh70-consequence): consequence
 * sentences A 17 (6 yes / 11 partly / 0 no) vs B 41 (21 / 18 / 2);
 * counterfactuals A 9 vs B 8, all unsupported (a pre-existing leak — the
 * product rule never names them and causalLint misses "这样…就能…");
 * past-tense "forced" claims A 0 vs B 4 (3 yes), none on a NOT-counted line;
 * overall unsupported A 15/891 vs B 16/916. `dist`, 605 files: HP at use
 * inside our attempts — walls p50 63, externals p50 54, trinkets p50 87
 * (96 % of those trinkets broke one of our CCs: an HP gate is the wrong
 * evidence for a trinket).
 */
import { ensureAnalysisData, parseModelJsonArray } from "@gladlog/analysis";
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import { extractCandidateFindings } from "@gladlog/analysis/src/analysis/candidateFindings";
import { buildMatchContext } from "@gladlog/analysis/src/context/buildMatchContext";
import { specToString } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { selectCorpusOwner } from "../src/corpus/buildCorpus";
import {
  buildConsequenceLines,
  CAUSATION_RULE_A,
  CAUSATION_RULE_B,
  FORCED_HP_GATE_PCT_DEFAULT,
  type ForcedSample,
  renderConsequenceSection,
} from "../src/explore/consequenceFacts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string, d?: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : d;
};

function combatsOf(path: string): any[] {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    return [];
  }
  const out: any[] = [];
  try {
    const parser = new GladLogParser();
    parser.on("match", (m: any) => out.push(toLegacyMatch(m)));
    parser.on("shuffle", (sh: any) => {
      for (const r of toLegacyShuffle(sh).rounds ?? []) out.push(r);
    });
    for (const line of text.split(/\r?\n/)) parser.push(line);
    parser.end();
  } catch {
    return [];
  }
  return out;
}

function manifestSlice(): string[] {
  const every = Number(flag("--every", "30"));
  const offset = Number(flag("--offset", "0"));
  return readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === offset % every)
    .slice(0, Number(flag("--limit", "100000")));
}

const MENU_ANCHOR = "\n\nEvent menu (the ONLY things that provably happened";

export function armBPrompt(promptA: string, section: string): string {
  if (!promptA.includes(CAUSATION_RULE_A))
    throw new Error("causation rule text drifted — update consequenceFacts.ts");
  const i = promptA.indexOf(MENU_ANCHOR);
  if (i < 0) throw new Error("menu anchor drifted");
  return (promptA.slice(0, i) + "\n\n" + section + promptA.slice(i)).replace(
    CAUSATION_RULE_A,
    CAUSATION_RULE_B,
  );
}

async function build(): Promise<void> {
  await ensureAnalysisData();
  const run = flag("--out")!;
  const target = Number(flag("--target", "40"));
  const gate = Number(flag("--gate", String(FORCED_HP_GATE_PCT_DEFAULT)));
  for (const arm of ["A", "B"])
    mkdirSync(join(run, arm, "prompts"), { recursive: true });
  mkdirSync(join(run, "conseq"), { recursive: true });
  const index: {
    ordinal: number;
    file: string;
    matchId: string;
    source: string;
  }[] = [];
  const kinds: Record<string, number> = {};
  for (const path of manifestSlice()) {
    if (index.length >= target) break;
    for (const combat of combatsOf(path)) {
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      const owner: any = selectCorpusOwner(players, combat, "recorder");
      if (!owner) continue;
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const ctx = buildMatchContext(combat, friends, enemies, { owner });
      const cands = extractCandidateFindings(combat, owner.id);
      if (cands.length === 0) continue;
      const { lines } = buildConsequenceLines(
        combat,
        friends,
        enemies,
        ctx,
        gate,
      );
      const k = new Set(lines.map((l) => l.kind));
      if (lines.length < 3 || k.size < 2) continue;
      // every round must exercise the evidence-gated "forced" wording
      if (!k.has("forced") && !k.has("used")) continue;
      const promptA = buildFindingsPrompt(
        cands,
        ctx,
        specToString(owner.spec) || String(owner.spec),
      );
      const section = renderConsequenceSection(lines);
      const promptB = armBPrompt(promptA, section);
      const ordinal = index.length + 1;
      const nnn = String(ordinal).padStart(3, "0");
      const matchId = String(combat.id ?? path.split("/").pop());
      const file = `prompts/${nnn}-${matchId.slice(0, 8)}.txt`;
      writeFileSync(join(run, "A", file), promptA);
      writeFileSync(join(run, "B", file), promptB);
      writeFileSync(join(run, "conseq", `${nnn}.txt`), section + "\n");
      index.push({ ordinal, file, matchId, source: path });
      for (const l of lines) kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
      console.log(
        `${nnn} ${matchId.slice(0, 8)} ${specToString(owner.spec)} lines=${lines.length} kinds=${[...k].join(",")} chars A=${promptA.length} B=${promptB.length}`,
      );
      break; // one round per file, for spread
    }
  }
  for (const arm of ["A", "B"])
    writeFileSync(
      join(run, arm, "index.json"),
      JSON.stringify(index, null, 2) + "\n",
    );
  console.log(
    `built ${index.length} rounds; consequence lines by kind: ${JSON.stringify(kinds)}`,
  );
}

async function dist(): Promise<void> {
  await ensureAnalysisData();
  const samples: ForcedSample[] = [];
  let rounds = 0;
  for (const path of manifestSlice()) {
    for (const combat of combatsOf(path)) {
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      const owner: any = selectCorpusOwner(players, combat, "recorder");
      if (!owner) continue;
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      rounds++;
      samples.push(
        ...buildConsequenceLines(combat, friends, enemies, "").forcedSamples,
      );
    }
  }
  const show = (label: string, xs: ForcedSample[]): void => {
    const hp = xs
      .map((s) => s.hpAtUse)
      .filter((h): h is number => h !== null)
      .sort((a, b) => a - b);
    const q = (f: number): string =>
      hp.length ? hp[Math.floor(f * (hp.length - 1))]!.toFixed(0) : "-";
    const le = (g: number): string =>
      hp.length
        ? `${((100 * hp.filter((h) => h <= g).length) / hp.length).toFixed(0)}%`
        : "-";
    const dm = xs
      .map((s) => s.dmg3sPct)
      .filter((h): h is number => h !== null && h !== undefined)
      .sort((a, b) => a - b);
    const dq = (f: number): string =>
      dm.length ? dm[Math.floor(f * (dm.length - 1))]!.toFixed(0) : "-";
    const ge = (g: number): string =>
      dm.length
        ? `${((100 * dm.filter((h) => h >= g).length) / dm.length).toFixed(0)}%`
        : "-";
    console.log(
      `${label.padEnd(34)} n=${String(xs.length).padStart(5)} (HP known ${hp.length})  p10=${q(0.1)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)}  ≤30:${le(30)} ≤40:${le(40)} ≤50:${le(50)} ≤60:${le(60)} ≤70:${le(70)}`,
    );
    console.log(
      `${"".padEnd(34)} dmg taken in the 3 s before, % max HP: p25=${dq(0.25)} p50=${dq(0.5)} p75=${dq(0.75)}  ≥10:${ge(10)} ≥20:${ge(20)} ≥30:${ge(30)} ≥40:${ge(40)}`,
    );
  };
  console.log(`rounds=${rounds}`);
  for (const what of ["defensive", "external", "trinket"] as const)
    show(
      `in attempt: ${what}`,
      samples.filter((s) => s.inAttempt && s.what === what),
    );
  show(
    "in attempt: all",
    samples.filter((s) => s.inAttempt),
  );
  const tr = samples.filter((s) => s.inAttempt && s.what === "trinket");
  console.log(
    `in-attempt trinkets that broke one of our CCs: ${tr.filter((s) => s.brokeCc).length}/${tr.length}`,
  );
  show(
    "in attempt: trinket, broke our CC",
    tr.filter((s) => s.brokeCc),
  );
  show(
    "in attempt: trinket, no CC broken",
    tr.filter((s) => !s.brokeCc),
  );
  show(
    "trinket OUTSIDE any attempt",
    samples.filter((s) => !s.inAttempt && s.what === "trinket"),
  );
  show(
    "wall OUTSIDE any attempt",
    samples.filter((s) => !s.inAttempt && s.what === "defensive"),
  );
}

// Mirror of packages/desktop/src/main/ai.ts buildCoachSystemPrompt (same
// hand copy as outputTokenBudgetProbe.ts — eval cannot import desktop main).
function coachSystemPrompt(lang: "en" | "zh"): string {
  const language =
    lang === "zh"
      ? "Respond entirely in Simplified Chinese (简体中文). Keep spell/ability names in English exactly as written in the data — never translate them into Chinese, even inline; you may explain them in Chinese, but the name token itself must stay English."
      : "Respond in English.";
  return `You are a World of Warcraft arena coach reviewing a player's match. Be direct, specific, and grounded strictly in the provided events. ${language}`;
}
const ISOLATION_ARGS = [
  "--tools=",
  "--strict-mcp-config",
  "--disable-slash-commands",
];

function callClaude(
  prompt: string,
  model: string,
): Promise<{ text: string; env: any } | null> {
  const cwd = mkdtempSync(join(tmpdir(), "gladlog-gh70-"));
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--no-session-persistence",
        ...ISOLATION_ARGS,
      ],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 900_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`claude exit ${code}: ${(err || out).slice(0, 300)}`);
        resolve(null);
        return;
      }
      try {
        const env = JSON.parse(out);
        if (env.is_error) {
          console.error(`claude is_error: ${String(env.result).slice(0, 300)}`);
          resolve(null);
          return;
        }
        resolve({ text: String(env.result ?? ""), env });
      } catch {
        resolve(null);
      }
    });
    child.stdin.end(prompt);
  });
}

async function runArm(): Promise<void> {
  const run = flag("--run")!;
  const arm = flag("--arm")!;
  const conc = Number(flag("--concurrency", "3"));
  const lang = (flag("--lang", "zh") as "en" | "zh") ?? "zh";
  const model = flag("--model", "claude-opus-5-5")!;
  const dir = join(run, arm);
  mkdirSync(join(dir, "responses"), { recursive: true });
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
    ordinal: number;
    file: string;
    matchId: string;
  }[];
  const todo = index.filter(
    (e) =>
      !existsSync(
        join(dir, "responses", `${String(e.ordinal).padStart(3, "0")}.txt`),
      ),
  );
  console.log(
    `[${arm}] ${todo.length}/${index.length} to run, model=${model}, lang=${lang}, concurrency=${conc}`,
  );
  let failures = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const e = todo[next++]!;
      const nnn = String(e.ordinal).padStart(3, "0");
      const user = readFileSync(join(dir, e.file), "utf8");
      const t0 = Date.now();
      let r = await callClaude(`${coachSystemPrompt(lang)}\n${user}`, model);
      if (!r)
        r = await callClaude(`${coachSystemPrompt(lang)}\n${user}`, model);
      if (!r) {
        failures++;
        console.error(`  ${nnn} FAILED twice`);
        if (failures >= 4) {
          console.error("4 failures — stopping (session limit?)");
          process.exit(3);
        }
        continue;
      }
      writeFileSync(
        join(dir, "responses", `${nnn}.txt`),
        `MATCHID: ${e.matchId}\n${r.text}\n`,
      );
      writeFileSync(
        join(dir, "responses", `${nnn}.usage.json`),
        JSON.stringify({
          usage: r.env.usage,
          model: r.env.modelUsage ? Object.keys(r.env.modelUsage) : model,
          durationMs: Date.now() - t0,
        }) + "\n",
      );
      console.log(
        `  ${nnn} ok ${Math.round((Date.now() - t0) / 1000)}s out=${r.env.usage?.output_tokens}`,
      );
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
}

// ---------------------------------------------------------------------------
// Blind sentence judge. Every title + explanation sentence that survived the
// product audit in EITHER arm, shuffled together per round (the judge never
// learns which arm wrote what), judged against the round's evidence = arm B's
// match context + OBSERVED CONSEQUENCES + event menu (a superset of A's).
// ---------------------------------------------------------------------------

interface JudgeItem {
  id: string;
  arm: "A" | "B";
  finding: number;
  part: "title" | "sentence";
  text: string;
}

function findingsOf(file: string): { title: string; expl: string }[] {
  if (!existsSync(file)) return [];
  const out: { title: string; expl: string }[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\d+\. \[(?:high|med|low)\] (.*)$/.exec(lines[i]!);
    if (!m) continue;
    out.push({
      title: m[1]!.replace(/ \([\d.,s ]+\)$/, ""),
      expl: (lines[i + 1] ?? "").trim(),
    });
  }
  return out;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

/** Deterministic shuffle (mulberry32 on the ordinal). */
function shuffled<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const JUDGE_INSTRUCTIONS = `You are auditing coaching sentences written about ONE World of Warcraft arena round, against that round's log evidence. The evidence is below (the match context the coach saw, including an OBSERVED CONSEQUENCES section of deterministic measurements, and the event menu). Then a list of sentences (Chinese or English), each with an id. Different sentences may come from different coaches; judge each on its own.

For EACH sentence return:
- "kind": exactly one of
  "observation" — states what happened, no link to what followed;
  "consequence" — links an event to something the log shows happening because of / right after it (the cast never landed, the victim could not cast until…, a teammate dropped while the healer was CC'd, an enemy defensive / trinket / external was forced / drawn out / baited / pulled);
  "causal-verdict" — pins a death, a loss, a win or the round's outcome on an event ("导致死亡", "cost you the round", "that's why you lost", "decided the game");
  "counterfactual" — what would or could have happened had something else been done ("本可以", "would have survived", "if you had…");
  "advice" — a recommendation with no factual claim beyond the event it cites;
  "other".
- "supported": "yes" / "partly" / "no" / "n/a" — is the sentence's factual content (times, who, which spell, HP, and for "consequence" the claimed link itself) backed by the evidence? A consequence link counts as supported only when the evidence shows it (e.g. a [KICK] or [CONSEQ] line plus the later cast; an enemy defensive inside the team's kill attempt with the HP at use, or a [CONSEQ] line stamped FORCED). Temporal order alone does NOT support "forced", "because", "so", "导致", "逼出". A "causal-verdict" or "counterfactual" is "no" unless the evidence states it outright. "n/a" only for pure advice.
- "evidence": the shortest verbatim quote of the line(s) you relied on, or "none".
- "note": at most 20 words, required when supported is not "yes".

Return ONLY a JSON array [{"id": string, "kind": string, "supported": string, "evidence": string, "note": string}] with one element per id, nothing else.`;

function evidenceOf(promptB: string): string {
  const s = promptB.indexOf("Match context (for reasoning");
  const e = promptB.indexOf("\nEvent legend:");
  return promptB.slice(s < 0 ? 0 : s, e < 0 ? undefined : e);
}

function judgePrep(): void {
  const run = flag("--run")!;
  const index = JSON.parse(
    readFileSync(join(run, "B", "index.json"), "utf8"),
  ) as { ordinal: number; file: string }[];
  mkdirSync(join(run, "judge", "prompts"), { recursive: true });
  let total = 0;
  for (const e of index) {
    const nnn = String(e.ordinal).padStart(3, "0");
    const items: JudgeItem[] = [];
    for (const arm of ["A", "B"] as const) {
      findingsOf(
        join(run, arm, "responses-interpolated", `${nnn}.txt`),
      ).forEach((f, fi) => {
        items.push({
          id: "",
          arm,
          finding: fi + 1,
          part: "title",
          text: f.title,
        });
        for (const s of sentencesOf(f.expl))
          items.push({
            id: "",
            arm,
            finding: fi + 1,
            part: "sentence",
            text: s,
          });
      });
    }
    if (!items.length) continue;
    const mixed = shuffled(items, e.ordinal * 7919).map((it, i) => ({
      ...it,
      id: `s${i + 1}`,
    }));
    writeFileSync(
      join(run, "judge", `${nnn}.items.json`),
      JSON.stringify(mixed, null, 2) + "\n",
    );
    const evidence = evidenceOf(readFileSync(join(run, "B", e.file), "utf8"));
    const list = mixed.map((it) => `${it.id}: ${it.text}`).join("\n");
    writeFileSync(
      join(run, "judge", "prompts", `${nnn}.txt`),
      `${JUDGE_INSTRUCTIONS}\n\n=== EVIDENCE ===\n${evidence}\n=== SENTENCES ===\n${list}\n`,
    );
    total += mixed.length;
  }
  console.log(`judge prompts written: ${total} sentences`);
}

async function judgeRun(): Promise<void> {
  const run = flag("--run")!;
  const conc = Number(flag("--concurrency", "3"));
  const model = flag("--model", "claude-opus-5-5")!;
  const dir = join(run, "judge");
  const todo = readdirSync(join(dir, "prompts"))
    .filter((f) => f.endsWith(".txt"))
    .filter((f) => !existsSync(join(dir, f.replace(".txt", ".verdicts.json"))));
  console.log(`[judge] ${todo.length} rounds to judge, model=${model}`);
  let next = 0;
  let failures = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const f = todo[next++]!;
      const prompt = readFileSync(join(dir, "prompts", f), "utf8");
      let parsed: unknown[] | null = null;
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        const r = await callClaude(prompt, model);
        if (!r) continue;
        parsed = parseModelJsonArray(r.text) as unknown[] | null;
      }
      if (!parsed) {
        failures++;
        console.error(`  judge ${f} FAILED`);
        if (failures >= 4) process.exit(3);
        continue;
      }
      writeFileSync(
        join(dir, f.replace(".txt", ".verdicts.json")),
        JSON.stringify(parsed, null, 2) + "\n",
      );
      console.log(`  judge ${f} ok (${parsed.length})`);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
}

function report(): void {
  const run = flag("--run")!;
  const dir = join(run, "judge");
  type V = {
    id: string;
    kind: string;
    supported: string;
    evidence: string;
    note: string;
  };
  const rows: (JudgeItem & V & { nnn: string })[] = [];
  let missing = 0;
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".items.json"))
    .sort()) {
    const nnn = f.slice(0, 3);
    const vPath = join(dir, `${nnn}.verdicts.json`);
    if (!existsSync(vPath)) continue;
    const items = JSON.parse(readFileSync(join(dir, f), "utf8")) as JudgeItem[];
    const vs = new Map(
      (JSON.parse(readFileSync(vPath, "utf8")) as V[]).map((v) => [v.id, v]),
    );
    for (const it of items) {
      const v = vs.get(it.id);
      if (!v) {
        missing++;
        continue;
      }
      rows.push({ ...it, ...v, nnn });
    }
  }
  const lines: string[] = [
    `# GH #70 consequence probe — ${run}`,
    "",
    `judged sentences: ${rows.length} (missing verdicts ${missing})`,
    "",
  ];
  const kinds = [
    "observation",
    "consequence",
    "causal-verdict",
    "counterfactual",
    "advice",
    "other",
  ];
  lines.push(
    "| arm | rounds w/ findings | findings kept | dropped (causal-lint) | sentences | " +
      kinds.join(" | ") +
      " | unsupported (no) | partly |",
  );
  lines.push("|" + "---|".repeat(9 + kinds.length - 1));
  for (const arm of ["A", "B"] as const) {
    const summary = JSON.parse(
      readFileSync(join(run, arm, "audit-summary.json"), "utf8"),
    ) as Record<
      string,
      {
        kept: number;
        dropped: number;
        dropReasons?: string[];
        badJson?: boolean;
      }
    >;
    const vals = Object.values(summary);
    const kept = vals.reduce((s, v) => s + v.kept, 0);
    const dropped = vals.reduce((s, v) => s + v.dropped, 0);
    const causal = vals.reduce(
      (s, v) =>
        s + (v.dropReasons ?? []).filter((r) => /causal/i.test(r)).length,
      0,
    );
    const rs = rows.filter((r) => r.arm === arm);
    const k = (x: string): string => {
      const sub = rs.filter((r) => r.kind === x);
      const c = (v: string): number =>
        sub.filter((r) => r.supported === v).length;
      return `${sub.length} (${c("yes")}/${c("partly")}/${c("no")})`;
    };
    lines.push(
      `| ${arm} | ${vals.filter((v) => v.kept > 0).length}/${vals.length} | ${kept} | ${dropped} (${causal}) | ${rs.length} | ${kinds.map(k).join(" | ")} | ${rs.filter((r) => r.supported === "no").length} | ${rs.filter((r) => r.supported === "partly").length} |`,
    );
  }
  lines.push("", "cells: n (yes/partly/no)", "");
  // "forced"-family wording — the one consequence the user put behind an
  // evidence gate (2026-09-24), counted on its own.
  const FORCED_RE =
    /逼出|逼掉|逼交|逼他|逼对方|骗出|骗掉|诱出|迫使|forced|baited|pulled out|drew out|extracted/i;
  lines.push(
    "| arm | forced-wording sentences | yes | partly | no |",
    "|---|---|---|---|---|",
  );
  for (const arm of ["A", "B"] as const) {
    const f = rows.filter((r) => r.arm === arm && FORCED_RE.test(r.text));
    const c = (v: string): number => f.filter((r) => r.supported === v).length;
    lines.push(
      `| ${arm} | ${f.length} | ${c("yes")} | ${c("partly")} | ${c("no")} |`,
    );
  }
  lines.push(
    "",
    "## Every consequence / causal-verdict / counterfactual sentence",
    "",
  );
  for (const r of rows
    .filter((x) =>
      ["consequence", "causal-verdict", "counterfactual"].includes(x.kind),
    )
    .sort((a, b) => (a.nnn + a.arm).localeCompare(b.nnn + b.arm))) {
    lines.push(
      `- ${r.nnn} ${r.arm} f${r.finding} **${r.kind} / ${r.supported}** — ${r.text}${r.supported !== "yes" ? `  _(${r.note})_` : ""}`,
    );
  }
  lines.push("", "## Every unsupported sentence (any kind)", "");
  for (const r of rows.filter(
    (x) =>
      x.supported === "no" &&
      !["consequence", "causal-verdict", "counterfactual"].includes(x.kind),
  )) {
    lines.push(
      `- ${r.nnn} ${r.arm} f${r.finding} ${r.kind} — ${r.text}  _(${r.note})_`,
    );
  }
  writeFileSync(join(run, "report.md"), lines.join("\n") + "\n");
  writeFileSync(
    join(run, "judged-rows.json"),
    JSON.stringify(rows, null, 2) + "\n",
  );
  console.log(lines.slice(0, 8).join("\n"));
}

const main =
  cmd === "build"
    ? build
    : cmd === "dist"
      ? dist
      : cmd === "run"
        ? runArm
        : cmd === "judge-prep"
          ? async () => judgePrep()
          : cmd === "judge"
            ? judgeRun
            : cmd === "report"
              ? async () => report()
              : null;
if (!main) {
  console.error("usage: consequenceProbe.ts build|dist|run … (see header)");
  process.exit(2);
}
void main();
