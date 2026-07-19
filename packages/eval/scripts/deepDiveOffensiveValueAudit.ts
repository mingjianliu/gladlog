// 进攻深挖价值 A/B —— 解析 + 审计 + 出盲评包。从 prompt 回构 pack facts(prompt 的
// EVIDENCE PACK 清单即 facts),对每份 resp 跑生产同款 auditDeepDives(占位符解析 +
// 裸数字/因果/cited⊆pack),存活者插值成文。judge 盲评,揭盲经 key.json(bucket+subtype)。
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { auditDeepDives, type DeepDivePack } from "@gladlog/analysis";

const dir = process.argv[2]!;
const promptsDir = join(dir, "prompts");
const respDir = join(dir, "resp");
const key: Array<{
  ord: number;
  bucket: string;
  subtype: string;
  spec: string;
  match: string;
}> = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
const metaOf = new Map(key.map((k) => [k.ord, k]));

// 从 prompt 回构 pack:每行 `  - key=pN kind=K facts={a=b, c=d}` → item + facts。
function packFromPrompt(text: string): DeepDivePack {
  const items: DeepDivePack["items"] = [];
  const facts: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/key=(\S+) kind=(\S+) facts=\{(.*)\}\s*$/);
    if (!m) continue;
    const [, k, kind, body] = m;
    const f: Record<string, string> = {};
    for (const pair of body!.split(", ")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      f[pair.slice(0, eq)] = pair.slice(eq + 1);
      facts[`${k}.${pair.slice(0, eq)}`] = pair.slice(eq + 1);
    }
    items.push({
      key: k!,
      kind: kind as DeepDivePack["items"][number]["kind"],
      t: Number(f.t),
      label: "",
      unitNames: f.unit ? [f.unit] : [],
      facts: f,
    });
  }
  return { findingIndex: 0, anchorFrom: 0, anchorTo: 0, items, facts };
}

const results: Array<{
  ord: number;
  bucket: string;
  subtype: string;
  spec: string;
  empty: boolean;
  dropped: boolean;
  text: string;
}> = [];

for (const file of readdirSync(promptsDir).filter((f) => f.endsWith(".txt"))) {
  const ord = Number(file.replace(".txt", ""));
  const meta = metaOf.get(ord)!;
  const base = {
    ord,
    bucket: meta.bucket,
    subtype: meta.subtype,
    spec: meta.spec,
  };
  const pack = packFromPrompt(readFileSync(join(promptsDir, file), "utf8"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(join(respDir, `${file.replace(".txt", "")}.json`), "utf8"),
    );
  } catch {
    results.push({ ...base, empty: true, dropped: false, text: "" });
    continue;
  }
  const arr = Array.isArray(parsed) ? parsed : [];
  if (arr.length === 0) {
    results.push({ ...base, empty: true, dropped: false, text: "" });
    continue;
  }
  const audited = auditDeepDives(parsed, [pack]);
  if (audited.length === 0) {
    results.push({ ...base, empty: false, dropped: true, text: "" });
    continue;
  }
  results.push({
    ...base,
    empty: false,
    dropped: false,
    text: audited[0]!.text,
  });
}

// 盲评包:只给 spec + 解析后文本,不给 bucket/subtype;survivor 洗牌后重编号 jN。
const survivors = results.filter((r) => !r.empty && !r.dropped);
for (let i = survivors.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [survivors[i], survivors[j]] = [survivors[j]!, survivors[i]!];
}
writeFileSync(
  join(dir, "judge-input.json"),
  JSON.stringify(
    survivors.map((r, i) => ({
      id: `j${i + 1}`,
      spec: r.spec,
      deepDive: r.text,
    })),
    null,
    1,
  ),
);
writeFileSync(
  join(dir, "unblind.json"),
  JSON.stringify(
    survivors.map((r, i) => ({
      id: `j${i + 1}`,
      ord: r.ord,
      bucket: r.bucket,
      subtype: r.subtype,
      spec: r.spec,
    })),
    null,
    1,
  ),
);

const tally = (pred: (r: (typeof results)[number]) => boolean) => {
  const g = results.filter(pred);
  return {
    total: g.length,
    produced: g.filter((r) => !r.empty && !r.dropped).length,
    empty: g.filter((r) => r.empty).length,
    dropped: g.filter((r) => r.dropped).length,
  };
};
for (const b of ["offensive", "survival"]) {
  const t = tally((r) => r.bucket === b);
  console.warn(
    `${b.padEnd(10)} 共${t.total} · 产出${t.produced} · 诚实留白${t.empty} · 审计毙${t.dropped}`,
  );
}
console.warn("── offensive 逐类型 ──");
for (const st of [
  "unconverted-burst",
  "burst-into-immunity",
  "off-target-in-window",
  "dr-clipped-cc",
]) {
  const t = tally((r) => r.subtype === st);
  if (t.total)
    console.warn(
      `  ${st.padEnd(22)} 共${t.total} · 产出${t.produced} · 留白${t.empty} · 毙${t.dropped}`,
    );
}
console.warn(`盲评包 ${survivors.length} 条 → judge-input.json`);
