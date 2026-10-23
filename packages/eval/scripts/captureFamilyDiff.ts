/**
 * captureFamilyDiff.ts — the whole-prompt regression gate between two 605
 * captures (fact4 F17, user 2026-10-22 「可以交给他一起做」).
 *
 * Round 4's regressions were all side effects outside the fact class being
 * fixed — a table or predicate widened for one class moved a family next
 * door, and the class scans never looked there: Aspect of the Turtle left
 * every `[ENEMY DEF]` line (03a355dcd), a Divine Hymn channel tick answered
 * a burst (c4291be6f), hard-cast results paired to the wrong completion
 * (ef24bfdfe), one IMMUNE row printed twice. This diff looks at EVERY line
 * of every context and menu of both captures (`acceptanceCapture
 * --context-dir / --findings-dir`, laid out `<dir>/s<k>/{context,findings}`
 * by cap605.sh; the two captures must share their manifest — the file names
 * are shard-local) and lists, ranked:
 *
 *  1. `family`: per (line family, spell / aura name) — the family is a line's
 *     leading tag(s) (`[ENEMY DEF]`, `[YOU] [CD]`, `[RES]`, a menu row's
 *     `menu:<type>`) or, for an untagged line, its section header (KILL
 *     ATTEMPTS); the names are the observed spells' official English names
 *     the line contains (longest match first) — a count that drops to 0 from
 *     ≥ `--min` (default 5), or more than doubles / halves with the larger
 *     side ≥ `--min`, or appears from 0 at ≥ `--min`. Also a family's own
 *     line total the same way.
 *  2. `dup`: a body line printed twice in one file where the base printed it
 *     once (same text — its m:ss prefix included, so the same second).
 *  3. `legend`: a literal back-quoted token of a legend line (no `<…>`, no
 *     one-letter placeholder) that no body line of the after capture prints
 *     although the base printed it, or that is new in the legend and never
 *     printed (the Turtle legend's `deflects direct attacks; …` with no
 *     Turtle line anywhere).
 *
 * The list is for review, not a pass/fail: an intended change shows up too.
 * Each flagged item gets a one-line "intended / regression" note in the
 * batch report.
 *
 *   npx tsx packages/eval/scripts/captureFamilyDiff.ts <base> <after> [--min 5] [--top 60] [--json out.json]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import observedIds from "@gladlog/analysis/src/data/observedSpellIdsGenerated.json";
import spellNames from "@gladlog/analysis/src/data/spellNames.json";

const [baseDir, afterDir] = process.argv.slice(2, 4);
if (!baseDir || !afterDir) {
  console.error(
    "usage: captureFamilyDiff.ts <base capture> <after capture> [--min 5] [--top 60] [--json out.json]",
  );
  process.exit(2);
}
const opt = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const MIN = Number(opt("--min") ?? 5);
const TOP = Number(opt("--top") ?? 60);
const jsonOut = opt("--json");

// ── the name dictionary: every observed spell's English name, by first word ─
const names = new Set<string>();
for (const id of observedIds as number[]) {
  const n = (spellNames as Record<string, string>)[String(id)];
  // a one-word name shorter than 4 letters ("Ice", "Hex" stays) is too
  // generic to key a family on; drop test / placeholder rows
  if (!n || n.length < 3 || /\(OLD\)|\(TEST\)|^\d/.test(n)) continue;
  names.add(n);
}
const byFirstWord = new Map<string, string[]>();
for (const n of names) {
  const w = n.split(" ")[0]!;
  const list = byFirstWord.get(w) ?? [];
  list.push(n);
  byFirstWord.set(w, list);
}
for (const list of byFirstWord.values())
  list.sort((a, b) => b.length - a.length);

/** The spell names a line contains, longest match at each word start. */
function namesIn(line: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z][\w'’:-]*/g;
  let m: RegExpExecArray | null;
  let skipTo = 0;
  while ((m = re.exec(line))) {
    if (m.index < skipTo) continue;
    const cands = byFirstWord.get(m[0].replace(/:$/, ""));
    if (!cands) continue;
    for (const n of cands) {
      if (!line.startsWith(n, m.index)) continue;
      const after = line[m.index + n.length];
      if (after !== undefined && /[\w]/.test(after)) continue;
      out.push(n);
      skipTo = m.index + n.length;
      break;
    }
  }
  return out;
}

// ── line classification ─────────────────────────────────────────────────────
const TAG_RE = /\[([A-Z][A-Z0-9 ?!/&'.-]*)\]/g;
const SECTION_RE = /^([A-Z][A-Z0-9 /&'()-]{3,}?)(?: —|:|$)/;
const MENU_RE = /^\s*- id=([a-z-]+):/;

interface Classified {
  legend: boolean;
  family: string;
  /** a line printed at a moment of the round (`m:ss` prefix) */
  timed: boolean;
}

function classify(line: string, section: string): Classified {
  const t = line.trimStart();
  const menu = MENU_RE.exec(line);
  if (menu) return { legend: false, family: `menu:${menu[1]}`, timed: false };
  // a legend line explains a token in back-quotes; a body line never does
  if (line.includes("`"))
    return { legend: true, family: "legend", timed: false };
  const timed = /^\d+:\d\d/.test(t);
  // the leading tags: those before any other text after the time stamp
  const head = t.replace(/^\d+:\d\d(?:[–-]\d+:\d\d)?\s+/, "");
  const tags: string[] = [];
  TAG_RE.lastIndex = 0;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(head)) && head.slice(pos, m.index).trim() === "") {
    tags.push(`[${m[1]}]`);
    pos = m.index + m[0].length;
    if (tags.length === 2) break;
  }
  if (tags.length) return { legend: false, family: tags.join(" "), timed };
  return { legend: false, family: section || "(untagged)", timed };
}

interface Side {
  family: Map<string, number>;
  familyName: Map<string, number>;
  /** per file: body line → count */
  dups: Map<string, Map<string, number>>;
  legendTokens: Map<string, number>;
  /** body text of the whole side, per literal legend token: occurrences */
  bodyLines: number;
  files: number;
}

const LITERAL_TOKEN = (tok: string): boolean =>
  tok.length >= 3 &&
  !tok.includes("<") &&
  !tok.includes("…") &&
  // a placeholder: one capital, alone or with a unit (`N`, `Ns`, `T`, `N%`)
  !/\b[A-Z][a-z]?\b/.test(tok.replace(/[A-Z][a-z]{2,}/g, "")) &&
  /[a-z]/.test(tok);

function readSide(
  dir: string,
  tokensOfInterest?: Set<string>,
): Side & {
  tokenBody: Map<string, number>;
  bodySample: string[];
} {
  const side = {
    family: new Map<string, number>(),
    familyName: new Map<string, number>(),
    dups: new Map<string, Map<string, number>>(),
    legendTokens: new Map<string, number>(),
    tokenBody: new Map<string, number>(),
    bodyLines: 0,
    files: 0,
    bodySample: [] as string[],
  };
  const inc = (m: Map<string, number>, k: string, n = 1) =>
    m.set(k, (m.get(k) ?? 0) + n);
  const shards = readdirSync(dir).filter((d) => /^s\d+$/.test(d));
  for (const shard of shards)
    for (const sub of ["context", "findings"]) {
      const sdir = join(dir, shard, sub);
      if (!existsSync(sdir)) continue;
      for (const f of readdirSync(sdir)) {
        side.files++;
        const key = `${shard}/${sub}/${f}`;
        const text = readFileSync(join(sdir, f), "utf8");
        let section = "";
        const lineCount = new Map<string, number>();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          const sec = SECTION_RE.exec(line);
          if (sec && !line.startsWith(" ") && !/^\d/.test(line))
            section = sec[1]!.trim();
          const c = classify(line, section);
          if (c.legend) {
            for (const tm of line.matchAll(/`([^`]+)`/g)) {
              const tok = tm[1]!;
              if (LITERAL_TOKEN(tok)) inc(side.legendTokens, tok);
            }
            continue;
          }
          side.bodyLines++;
          inc(side.family, c.family);
          for (const n of new Set(namesIn(line)))
            inc(side.familyName, `${c.family}\t${n}`);
          if (c.timed) inc(lineCount, line);
          if (tokensOfInterest)
            for (const tok of tokensOfInterest)
              if (line.includes(tok)) inc(side.tokenBody, tok);
        }
        const dup = new Map<string, number>();
        for (const [l, n] of lineCount) if (n > 1) dup.set(l, n);
        if (dup.size) side.dups.set(key, dup);
      }
    }
  return side;
}

// pass 1 collects each side's legend tokens; pass 2 counts them in bodies
const base0 = readSide(baseDir);
const after0 = readSide(afterDir);
const tokens = new Set([
  ...base0.legendTokens.keys(),
  ...after0.legendTokens.keys(),
]);
const base = readSide(baseDir, tokens);
const after = readSide(afterDir, tokens);
if (base.files !== after.files)
  console.log(
    `WARNING: ${base.files} base files vs ${after.files} after files — not the same manifest?`,
  );

interface Flag {
  kind: "family" | "familyTotal" | "dup" | "legend";
  key: string;
  base: number;
  after: number;
  score: number;
  note: string;
}
const flags: Flag[] = [];

const judge = (kind: Flag["kind"], key: string, b: number, a: number): void => {
  const hi = Math.max(a, b);
  if (hi < MIN) return;
  let note = "";
  if (a === 0) note = "dropped to 0";
  else if (b === 0) note = "new";
  else if (a > 2 * b) note = `×${(a / b).toFixed(1)}`;
  else if (b > 2 * a) note = `÷${(b / a).toFixed(1)}`;
  else return;
  flags.push({
    kind,
    key,
    base: b,
    after: a,
    // a family emptied or newly filled ranks above a ratio; then by size
    score: (a === 0 || b === 0 ? 1e6 : 0) + Math.abs(a - b),
    note,
  });
};
for (const k of new Set([...base.family.keys(), ...after.family.keys()]))
  judge("familyTotal", k, base.family.get(k) ?? 0, after.family.get(k) ?? 0);
for (const k of new Set([
  ...base.familyName.keys(),
  ...after.familyName.keys(),
]))
  judge("family", k, base.familyName.get(k) ?? 0, after.familyName.get(k) ?? 0);

// 2. new same-second exact duplicates, by family
const dupByFamily = new Map<string, { n: number; example: string }>();
for (const [file, dups] of after.dups) {
  const was = base.dups.get(file);
  for (const [line, n] of dups) {
    const extra = n - Math.max(1, was?.get(line) ?? 1);
    if (extra <= 0) continue;
    const fam = classify(line, "").family;
    const cur = dupByFamily.get(fam) ?? {
      n: 0,
      example: `${file}: ${line.trim()}`,
    };
    cur.n += extra;
    dupByFamily.set(fam, cur);
  }
}
for (const [fam, { n, example }] of dupByFamily)
  flags.push({
    kind: "dup",
    key: fam,
    base: 0,
    after: n,
    score: 5e5 + n,
    note: `new duplicate lines, e.g. ${example.slice(0, 200)}`,
  });

// 3. legend tokens no body line prints
for (const tok of after.legendTokens.keys()) {
  const a = after.tokenBody.get(tok) ?? 0;
  if (a > 0) continue;
  const b = base.tokenBody.get(tok) ?? 0;
  const newInLegend = !base.legendTokens.has(tok);
  if (b === 0 && !newInLegend) continue;
  flags.push({
    kind: "legend",
    key: tok,
    base: b,
    after: 0,
    score: 9e5 + b,
    note: newInLegend
      ? "new legend token, printed by no body line"
      : "legend token no body line prints any more",
  });
}

flags.sort((x, y) => y.score - x.score);
console.log(
  `captureFamilyDiff ${baseDir} → ${afterDir}: files ${base.files}/${after.files}, body lines ${base.bodyLines} → ${after.bodyLines}, flags ${flags.length} (min ${MIN})`,
);
for (const f of flags.slice(0, TOP))
  console.log(
    `${f.kind.padEnd(11)} ${String(f.base).padStart(7)} → ${String(f.after).padEnd(7)} ${f.note.padEnd(14)} ${f.key.replace("\t", " :: ")}`,
  );
if (flags.length > TOP) console.log(`… ${flags.length - TOP} more (--top)`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(flags, null, 1));
