// 深挖纪律 smoke(审计阶段):读 responder 回复 + 序列化 pack,跑
// auditDeepDives,量化通过率;违规按原因归类。回答:模型拿到深度后守不守规。
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  auditDeepDives,
  type DeepDivePack,
  parseModelJsonArray,
} from "@gladlog/analysis";

const outDir = process.argv[2] ?? "/tmp/deepdive-smoke";
const respDir = join(outDir, "responses");

const packFiles = readdirSync(outDir).filter((f) => f.endsWith(".pack.json"));
let total = 0;
let survived = 0;
let noJson = 0;
const examples: string[] = [];

for (const pf of packFiles.sort()) {
  const tag = pf.replace(".pack.json", "");
  const respPath = join(respDir, `${tag}.txt`);
  if (!existsSync(respPath)) {
    console.warn(`  ${tag}: 无回复文件,跳过`);
    continue;
  }
  total++;
  const { pack } = JSON.parse(readFileSync(join(outDir, pf), "utf8")) as {
    pack: DeepDivePack;
  };
  const raw = readFileSync(respPath, "utf8");
  // 围栏容错走共享谓词(与 desktop 产品路径同源)
  const parsed = parseModelJsonArray(raw);
  if (!parsed) {
    noJson++;
    console.warn(`  ${tag}: JSON 解析失败`);
    continue;
  }
  const dives = auditDeepDives(parsed, [pack]);
  if (dives.length > 0) {
    survived++;
    if (examples.length < 2) examples.push(`[${tag}] ${dives[0]!.text}`);
    console.warn(`  ${tag}: ✓ 通过(chips ${dives[0]!.chips.length})`);
  } else {
    // 诊断为何全丢:重跑各审计门看是哪一关
    const entry = Array.isArray(parsed) ? (parsed[0] as any) : null;
    const why = entry?.deepDive
      ? "审计驳回(占位符/裸数字/因果/citedKeys)"
      : "格式不符(缺 deepDive)";
    console.warn(`  ${tag}: ✗ ${why}`);
  }
}

console.warn("");
console.warn(
  `深挖纪律通过率:${survived}/${total} = ${total ? Math.round((100 * survived) / total) : 0}%(JSON 失败 ${noJson})`,
);
if (examples.length) {
  console.warn("\n通过样例:");
  for (const e of examples) console.warn(`  ${e}`);
}
