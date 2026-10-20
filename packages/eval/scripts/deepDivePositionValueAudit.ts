// Positioning-value eval — parse + audit + emit a blind-judging pack. The pack
// facts are reconstructed from the prompt files (the prompt's EVIDENCE PACK
// listing *is* the facts); each response is run through the same
// auditDeepDives used in production (placeholder resolution + bare-number /
// causality / cited ⊆ pack checks), and survivors are interpolated into text.
// The judge scores blind; unblinding goes through key.json.
import { auditDeepDives, type DeepDivePack } from "@gladlog/analysis";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const dir = process.argv[2]!;
const promptsDir = join(dir, "prompts");
const respDir = join(dir, "resp");
const key: Array<{ ord: number; bucket: string; spec: string; match: string }> =
  JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
const bucketOf = new Map(key.map((k) => [k.ord, k]));

// Reconstruct the pack from the prompt: each `  - key=pN kind=K facts={a=b,
// c=d}` line becomes one item plus its facts.
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
      const key = pair.slice(0, eq);
      const val = pair.slice(eq + 1);
      f[key] = val;
      facts[`${k}.${key}`] = val;
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
  spec: string;
  empty: boolean;
  dropped: boolean;
  text: string;
}> = [];

for (const file of readdirSync(promptsDir).filter((f) => f.endsWith(".txt"))) {
  const ord = Number(file.replace(".txt", ""));
  const meta = bucketOf.get(ord)!;
  const pack = packFromPrompt(readFileSync(join(promptsDir, file), "utf8"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(join(respDir, `${file.replace(".txt", "")}.json`), "utf8"),
    );
  } catch {
    results.push({
      ord,
      bucket: meta.bucket,
      spec: meta.spec,
      empty: true,
      dropped: false,
      text: "",
    });
    continue;
  }
  const arr = Array.isArray(parsed) ? parsed : [];
  if (arr.length === 0) {
    results.push({
      ord,
      bucket: meta.bucket,
      spec: meta.spec,
      empty: true,
      dropped: false,
      text: "",
    });
    continue;
  }
  const audited = auditDeepDives(parsed, [pack]);
  if (audited.length === 0) {
    // The model produced prose but the audit rejected it (placeholder out of
    // range / bare number / causality / cited)
    results.push({
      ord,
      bucket: meta.bucket,
      spec: meta.spec,
      empty: false,
      dropped: true,
      text: "",
    });
    continue;
  }
  results.push({
    ord,
    bucket: meta.bucket,
    spec: meta.spec,
    empty: false,
    dropped: false,
    text: audited[0]!.text,
  });
}

// Blind-judging pack: hands over only the spec and the resolved text, never
// the bucket; survivors are shuffled and renumbered jN.
const survivors = results.filter((r) => !r.empty && !r.dropped);
for (let i = survivors.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [survivors[i], survivors[j]] = [survivors[j]!, survivors[i]!];
}
const judgeItems = survivors.map((r, i) => ({
  id: `j${i + 1}`,
  spec: r.spec,
  deepDive: r.text,
}));
const unblind = survivors.map((r, i) => ({
  id: `j${i + 1}`,
  ord: r.ord,
  bucket: r.bucket,
  spec: r.spec,
}));
writeFileSync(
  join(dir, "judge-input.json"),
  JSON.stringify(judgeItems, null, 1),
);
writeFileSync(join(dir, "unblind.json"), JSON.stringify(unblind, null, 1));

const tally = (b: string) => {
  const g = results.filter((r) => r.bucket === b);
  return {
    total: g.length,
    produced: g.filter((r) => !r.empty && !r.dropped).length,
    empty: g.filter((r) => r.empty).length,
    dropped: g.filter((r) => r.dropped).length,
  };
};
for (const b of ["recovered", "resource"]) {
  const t = tally(b);
  console.warn(
    `${b.padEnd(10)} 共${t.total} · 产出${t.produced} · 诚实留白${t.empty} · 审计毙${t.dropped}`,
  );
}
console.warn(`盲评包 ${survivors.length} 条 → judge-input.json`);
