/**
 * pressFactScan.ts — F15 (fact1215, 2026-10-16): re-derive press facts from
 * the parsed log and require the rendered line, over an existing
 * acceptanceCapture `--context-dir` capture (cap605: `<dir>/s<k>/context/`).
 *
 * The LLM fact audit only DISCOVERS a class; this makes it complete across
 * the corpus and keeps it fixed. Each check derives the fact from the log
 * events directly — never through the analysis predicate it audits:
 *
 *  - `allyScales` (C1): a SPELL_CAST_SUCCESS of Obsidian Scales 363916 whose
 *    dest is another unit carrying an APPLIED / REFRESH of 363916 from the
 *    caster within 0.5 s (Flameshaper's ally copy). Required: a line at the
 *    cast's second naming the ally — `[YOU] [CD]` / `[TEAM] [CD]` for a
 *    friendly caster, `[ENEMY DEF]` for an enemy one — `Obsidian Scales →
 *    <ally pid>(`.
 *  - `timeStop` / `treeOfLife` / `havocMeta` (C6): a friendly player's press
 *    — Time Stop 378441; Incarnation: Tree of Life 33891 whose cast applies
 *    the 117679 form buff in the same instant (a shift back into the form is
 *    no press); Metamorphosis' 200166 landing. Required: the owner's
 *    `[YOU] [CD]   <name>` or the teammate's `[TEAM] [CD]   <pid>(…): <name>`
 *    at that second.
 *
 * The context file's first two lines are the archive path and the owner;
 * its name is `<fileNo>-<round>-<owner#>` (acceptanceCapture.ts). Pids are
 * read from the context's own `<unit id="N" name="…">` tags.
 *
 *   npx tsx packages/eval/scripts/pressFactScan.ts <captureDir> [--examples N]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: pressFactScan.ts <captureDir> [--examples N]");
  process.exit(2);
}
const exIdx = process.argv.indexOf("--examples");
const EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 5;
const ALLY_COPY_MS = 500;
const FORM_BUFF_MS = 50;

const fmt = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

type Check = "allyScales" | "timeStop" | "treeOfLife" | "havocMeta";
const expected = new Map<Check, number>();
const missing = new Map<Check, string[]>();
const bump = (c: Check) => expected.set(c, (expected.get(c) ?? 0) + 1);
const miss = (c: Check, s: string) => {
  const l = missing.get(c) ?? [];
  l.push(s);
  missing.set(c, l);
};

function parseFile(path: string): GladMatch[] {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  return items;
}

await ensureAnalysisData();
const files: Array<{
  shard: string;
  name: string;
  fileNo: number;
  round: number;
}> = [];
for (const shard of readdirSync(dir).filter((d) => /^s\d+$/.test(d))) {
  const cdir = join(dir, shard, "context");
  for (const name of readdirSync(cdir)) {
    const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
    if (m) files.push({ shard, name, fileNo: +m[1]!, round: +m[2]! });
  }
}
files.sort((a, b) =>
  a.shard === b.shard ? a.fileNo - b.fileNo : a.shard < b.shard ? -1 : 1,
);

let cacheKey = "";
let cacheItems: GladMatch[] = [];
let contexts = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  const [archive, ownerName] = text.split("\n", 2);
  if (!archive || !ownerName) continue;
  const key = `${f.shard}:${archive}`;
  if (key !== cacheKey) {
    try {
      cacheItems = parseFile(archive);
    } catch {
      cacheItems = [];
    }
    cacheKey = key;
  }
  const item = cacheItems[f.round - 1];
  if (!item) continue;
  let legacy: ReturnType<typeof toLegacyMatch>;
  try {
    legacy = toLegacyMatch({ ...item, rawLines: [] } as GladMatch);
  } catch {
    continue;
  }
  contexts++;
  const lines = text.split("\n");
  const pidOf = new Map<string, { pid: string; role: string }>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"[^>]*role="([^"]+)"/.exec(l);
    if (u) pidOf.set(u[2]!, { pid: u[1]!, role: u[3]! });
  }
  const units = Object.values(legacy.units ?? {}) as any[];
  const byId = new Map(units.map((u) => [u.id, u]));
  const start = legacy.startTime;
  const at = (ts: number) => fmt((ts - start) / 1000);
  const has = (t: string, pred: (l: string) => boolean) =>
    lines.some((l) => l.startsWith(`${t}  `) && pred(l));
  const where = `${f.shard}/${f.name}`;

  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    const friendly = me.role !== "enemy";
    const isOwner = u.name === ownerName;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const ts = c.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const t = at(ts);
      if (c.spellId === "363916" && c.destUnitId && c.destUnitId !== u.id) {
        const d = byId.get(c.destUnitId);
        const copy = (d?.auraEvents ?? []).some(
          (a: any) =>
            a.spellId === "363916" &&
            a.srcUnitId === u.id &&
            a.destUnitId === d.id &&
            (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
            Math.abs(a.logLine.timestamp - ts) <= ALLY_COPY_MS,
        );
        const dp = d && pidOf.get(d.name);
        if (copy && dp) {
          bump("allyScales");
          const tag = friendly
            ? isOwner
              ? "[YOU] [CD]"
              : "[TEAM] [CD]"
            : "[ENEMY DEF]";
          if (
            !has(
              t,
              (l) =>
                l.includes(tag) && l.includes(`Obsidian Scales → ${dp.pid}(`),
            )
          )
            miss("allyScales", `${where} ${t} ${u.name} → ${d.name} (${tag})`);
        }
      }
      if (!friendly) continue;
      const press = (check: Check, name: string) => {
        bump(check);
        const ok = isOwner
          ? has(t, (l) => l.includes(`[YOU] [CD]   ${name}`))
          : has(
              t,
              (l) =>
                l.includes(`[TEAM] [CD]   ${me.pid}(`) &&
                l.includes(`: ${name}`),
            );
        if (!ok) miss(check, `${where} ${t} ${u.name} ${name}`);
      };
      if (c.spellId === "378441") press("timeStop", "Time Stop");
      if (c.spellId === "200166") press("havocMeta", "Metamorphosis");
      if (
        c.spellId === "33891" &&
        (u.auraEvents ?? []).some(
          (a: any) =>
            a.spellId === "117679" &&
            a.destUnitId === u.id &&
            (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
            Math.abs(a.logLine.timestamp - ts) <= FORM_BUFF_MS,
        )
      )
        press("treeOfLife", "Incarnation: Tree of Life");
    }
  }
}

console.log(`contexts: ${contexts}`);
for (const c of [
  "allyScales",
  "timeStop",
  "treeOfLife",
  "havocMeta",
] as Check[]) {
  const m = missing.get(c) ?? [];
  console.log(`${c}: expected ${expected.get(c) ?? 0}, missing ${m.length}`);
  for (const s of m.slice(0, EXAMPLES)) console.log(`    ${s}`);
}
