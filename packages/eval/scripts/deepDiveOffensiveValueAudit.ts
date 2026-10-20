// Offensive deep-dive value A/B — parse + audit + emit a blind-judging bundle.
// The pack facts are reconstructed from the prompt (the prompt's EVIDENCE PACK
// listing IS the facts); each response is run through the same
// auditDeepDives as production (placeholder parsing + bare-number / causal /
// cited ⊆ pack checks), and survivors are interpolated into prose. The judge
// scores blind; unblinding goes through key.json (bucket + subtype).
import { auditDeepDives, type DeepDivePack } from "@gladlog/analysis";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

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

// Reconstruct the pack from the prompt: each line
// `  - key=pN kind=K facts={a=b, c=d}` → one item + its facts.
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

// Blind-judging bundle: hand over only spec + the parsed text, never
// bucket/subtype; survivors are shuffled and renumbered jN.
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
