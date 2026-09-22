/**
 * ablationVocabJoin.ts — the deterministic half of a consumption probe: after
 * `promptAblationProbe.ts` has produced `raw.json` (one answer per
 * (match, variant)), count how often each variant's answer QUOTES vocabulary
 * that exists only in the ablated line — zero model calls.
 *
 * Why it exists (GH #91, 2026-09-22, first use on the `[ENEMY DEF] … | during
 * it:` annotation): the probe's own Jaccard-vs-noise-floor verdict says
 * whether the conclusion SET moved; it cannot say whether the model read the
 * line. A fragment such as "of their enemy-player damage" or "longest gap"
 * appears nowhere else in the prompt, so an answer that carries it in the
 * baseline arm and not in the ablated arm was reading the line. The control
 * arm's rate is the false-positive floor (eval-ab.md, Reverse probe §1).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/ablationVocabJoin.ts --raw <dir>/raw.json \
 *     --vocab "of their enemy-player damage|longest gap|absorbed)|during it"
 *   Fragments are matched case-insensitively against the whole answer and
 *   against every structured finding's text fields.
 */
import { readFileSync } from "node:fs";

import { parseFindings } from "../src/explore/promptLineTypes";

interface Row {
  match: string;
  variant: string;
  answer: string;
}

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const rawPath = arg("raw");
const vocab = (arg("vocab") ?? "")
  .split("|")
  .map((s) => s.trim())
  .filter(Boolean);
if (!rawPath || vocab.length === 0) {
  console.error(
    'usage: ablationVocabJoin --raw <raw.json> --vocab "frag1|frag2|…"',
  );
  process.exit(2);
}

const rows = (JSON.parse(readFileSync(rawPath, "utf8")) as Row[]).filter(
  (r) => !r.answer.startsWith("__ERROR__"),
);
const lc = vocab.map((v) => v.toLowerCase());
const hits = (text: string): string[] => {
  const t = text.toLowerCase();
  return lc.filter((v) => t.includes(v));
};

interface Agg {
  answers: number;
  answersQuoting: number;
  findings: number;
  findingsQuoting: number;
  byFragment: Map<string, number>;
}
const byVariant = new Map<string, Agg>();
for (const r of rows) {
  let a = byVariant.get(r.variant);
  if (!a) {
    a = {
      answers: 0,
      answersQuoting: 0,
      findings: 0,
      findingsQuoting: 0,
      byFragment: new Map(),
    };
    byVariant.set(r.variant, a);
  }
  a.answers++;
  const h = hits(r.answer);
  if (h.length) a.answersQuoting++;
  for (const v of h) a.byFragment.set(v, (a.byFragment.get(v) ?? 0) + 1);
  for (const f of parseFindings(r.answer)) {
    a.findings++;
    const text = Object.values(f as unknown as Record<string, unknown>)
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    if (hits(text).length) a.findingsQuoting++;
  }
}

const pct = (a: number, b: number) =>
  b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`;
console.log(`rows=${rows.length}  vocab=${vocab.join(" | ")}`);
for (const [variant, a] of byVariant) {
  console.log(
    `${variant}\tanswers quoting ${a.answersQuoting}/${a.answers} (${pct(a.answersQuoting, a.answers)})\tfindings quoting ${a.findingsQuoting}/${a.findings} (${pct(a.findingsQuoting, a.findings)})\t${[...a.byFragment.entries()].map(([k, n]) => `${k}:${n}`).join(", ")}`,
  );
}
// Per match: baseline answers quoting vs the ablated answer — the pairs where
// the fragment vanishes with the line are the consumption evidence.
const matches = new Map<string, { base: number; baseN: number; abl: number; ablN: number }>();
for (const r of rows) {
  const m = matches.get(r.match) ?? { base: 0, baseN: 0, abl: 0, ablN: 0 };
  const q = hits(r.answer).length > 0 ? 1 : 0;
  if (r.variant.startsWith("baseline")) {
    m.base += q;
    m.baseN++;
  } else {
    m.abl += q;
    m.ablN++;
  }
  matches.set(r.match, m);
}
let quotingBaseOnly = 0;
let quotingBoth = 0;
let quotingNeither = 0;
for (const m of matches.values()) {
  if (m.base > 0 && m.abl === 0) quotingBaseOnly++;
  else if (m.base > 0 && m.abl > 0) quotingBoth++;
  else if (m.base === 0 && m.abl === 0) quotingNeither++;
}
console.log(
  `matches=${matches.size}: quoted in baseline only ${quotingBaseOnly}, in both arms ${quotingBoth} (false-positive floor), in neither ${quotingNeither}`,
);
