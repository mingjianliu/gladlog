/** acceptanceCapture.ts — 归档日志上的验收采集(常驻,2026-09-02 从 scratchpad 的
 * tmp-capture 转正;同日 GH #44 / #61 / #62 六轮验收都用它)。
 *
 * acceptanceHash.ts 只看本机库、只看治疗 owner、只看 findings prompt;本工具补上
 * 它明说看不见的那半边:**归档 .gz 日志**(新赛季语料)、**每个友方 owner**(治疗 +
 * 每个 DPS 视角,per-type 计数按 healer:/dps: 前缀分开)、**完整 match context**
 * (哈希 + 含关键字的行逐条落盘)。同代码前后各跑一遍,diff 两份输出:findings 哈希
 * 与 context 哈希都不动 = 逐字节不变;动了则逐类计数指认候选层落点,关键字行
 * (如 "[CC BROKEN]" / "[kick]" / "Polymorph")指认上下文层落点 —— 每个非零 delta
 * 都要解释到机制(CLAUDE.md 验证规则)。
 *
 * 两项改动混在一批时的归因法:把其中一项临时禁用再跑一次,三份计数两两相减
 * (GH #61/#62 的隔离对照就是这么做的)。
 *
 * 用法:
 *   npx tsx packages/eval/scripts/acceptanceCapture.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 30] \
 *     --needle "[CC BROKEN]" --lines-out /tmp/before-lines.txt > /tmp/before.txt
 *   manifest 行可以是绝对路径或相对 --archive-dir 的路径;--every 30 ≈ 600 场,单进程约 10 分钟。
 *
 * `--context-dir <dir>`(2026-09-23):把每个 owner 的完整 match context 逐个落盘
 * (`<文件序号>-<回合序号>-<owner 序号>.txt`),前后两次 `diff -r` 就能把一个哈希变化
 * 落到具体行上 —— GH #100 环境伤害修复时 context 哈希动了而 needle 没抓到,靠它定位。
 */
import { createHash } from "node:crypto";

import {
  buildFindingsPrompt,
  ensureAnalysisData,
  extractCandidateFindings,
  isHealerSpec,
} from "@gladlog/analysis";
import { buildMatchContext } from "@gladlog/analysis/src/context/buildMatchContext";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { splitTeams } from "../src/explore/storeAccess";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    manifest: "",
    every: 1,
    archiveDir: "",
    needle: "",
    linesOut: "",
    findingsDir: "",
    contextDir: "",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--archive-dir") out.archiveDir = a[++i] ?? "";
    else if (a[i] === "--needle") out.needle = a[++i] ?? "";
    else if (a[i] === "--lines-out") out.linesOut = a[++i] ?? "";
    else if (a[i] === "--findings-dir") out.findingsDir = a[++i] ?? "";
    else if (a[i] === "--context-dir") out.contextDir = a[++i] ?? "";
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: acceptanceCapture.ts --manifest <path> [--every N] [--archive-dir <dir>] [--needle <text> --lines-out <file>] [--context-dir <dir>] [--findings-dir <dir>]",
    );
    process.exit(1);
  }
  return out;
}

const args = parseArgs();
await ensureAnalysisData();
const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

const typeCounts = new Map<string, number>();
const findingsHash = createHash("sha256");
const contextHash = createHash("sha256");
let rounds = 0;
let owners = 0;
let needleLines = 0;
const out: string[] = [];

let fileNo = 0;
for (const f of files) {
  fileNo++;
  const p = f.startsWith("/") ? f : resolve(args.archiveDir, f);
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(p);
    text = (p.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  let idx = 0;
  for (const m of items) {
    idx++;
    let legacy: ReturnType<typeof toLegacyMatch>;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const { friends, enemies } = splitTeams(legacy);
    for (const owner of friends) {
      owners++;
      let cands: ReturnType<typeof extractCandidateFindings> = [];
      try {
        cands = extractCandidateFindings(legacy, owner.id);
      } catch {
        continue;
      }
      const role = isHealerSpec(owner.spec) ? "healer" : "dps";
      for (const c of cands)
        typeCounts.set(
          `${role}:${c.type}`,
          (typeCounts.get(`${role}:${c.type}`) ?? 0) + 1,
        );
      try {
        const prompt = buildFindingsPrompt(cands, "", owner.spec);
        findingsHash.update(`${f}:${idx}:${owner.id}\n`);
        findingsHash.update(prompt);
        // `--findings-dir` (2026-09-23): per-owner findings prompt, so a
        // candidate-count delta can be pinned to the rounds that moved.
        if (args.findingsDir) {
          mkdirSync(args.findingsDir, { recursive: true });
          writeFileSync(
            resolve(args.findingsDir, `${fileNo}-${idx}-${owners}.txt`),
            `${f}\n${owner.name}\n${prompt}`,
          );
        }
      } catch {
        /* not buildable → excluded on both sides */
      }
      let ctx = "";
      try {
        ctx = buildMatchContext(legacy, friends, enemies, { owner });
      } catch {
        continue;
      }
      contextHash.update(`${f}:${idx}:${owner.id}\n`);
      contextHash.update(ctx);
      if (args.contextDir) {
        mkdirSync(args.contextDir, { recursive: true });
        writeFileSync(
          resolve(args.contextDir, `${fileNo}-${idx}-${owners}.txt`),
          `${f}\n${owner.name}\n${ctx}`,
        );
      }
      // `--needle "a|b"`: several needles in one run (2026-09-22) — a change
      // that touches two line kinds no longer needs two 10-minute captures.
      const needles = args.needle.split("|").filter(Boolean);
      if (needles.length)
        for (const line of ctx.split("\n"))
          if (needles.some((n) => line.includes(n))) {
            needleLines++;
            out.push(`${f} ${owner.name}: ${line.trim()}`);
          }
    }
  }
}

if (args.linesOut) writeFileSync(args.linesOut, out.join("\n") + "\n");
console.log(`files=${files.length} rounds=${rounds} owners=${owners}`);
console.log(`findings-prompt SHA256: ${findingsHash.digest("hex")}`);
console.log(`match-context SHA256: ${contextHash.digest("hex")}`);
if (args.needle)
  console.log(`context lines containing "${args.needle}": ${needleLines}`);
for (const [t, n] of [...typeCounts.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
))
  console.log(`  ${t}: ${n}`);
