/* eslint-disable @typescript-eslint/no-explicit-any -- the scan walks the untyped legacy parse objects (match.units, damageIn, absorbsIn) by the hundred */
/**
 * corpusFactScan5.ts — corpus-wide deterministic fact checks, batch 5
 * (fact6 F20, 2026-10-28): one module per recurring fact class of the
 * round-6 double audit (`runs/fact6-2026-10-27`), in `scan5/`. User
 * 2026-10-28 「同意」: each class is counted over the whole capture BEFORE
 * its fix — the log's observed truth against the set the code knows
 * (Curated-List forward check) and every reader's rendered line, not the
 * audited id alone. Same harness as `corpusFactScan4.ts` (file loop, parse
 * cache, pid mapping, `unmapped` → exit 1, `--examples N`, distinct-fact
 * counting); each module documents its own checks.
 *
 *   npx tsx packages/eval/scripts/corpusFactScan5.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>] [--only <check,…>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import { parseRawStreams } from "@gladlog/analysis/src/utils/rawStreams";
import { playableEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

import type { IRoundCtx, IScanModule } from "./scan5/ctx";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: corpusFactScan5.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>] [--only <check,…>]",
  );
  process.exit(2);
}
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ARCHIVE_DIR = argOf("--archive-dir") ?? "";
const EXAMPLES = Number(argOf("--examples") ?? 5);
const JSON_OUT = argOf("--json");
const ONLY = argOf("--only")?.split(",");
const unmapped: string[] = [];

/** the class modules, in report order */
const MODULE_FILES = [
  "absorb",
  "trinketLock",
  "ccLanded",
  "pets",
  "immunity",
  "dr",
  "singles1",
  "singles2",
];
await ensureAnalysisData();
const modules: IScanModule[] = [];
for (const m of MODULE_FILES) {
  const p = join(import.meta.dirname, "scan5", `${m}.ts`);
  if (!existsSync(p)) continue;
  // a module that fails to load is reported (exit 1) without hiding the rest
  try {
    modules.push((await import(p)) as IScanModule);
  } catch (e) {
    unmapped.push(`module ${m} failed to load: ${(e as Error).message}`);
  }
}
const CHECKS = modules
  .flatMap((m) => [...m.CHECKS])
  .filter((c) => !ONLY || ONLY.includes(c));
const OUT_OF_TOTAL = new Set(
  modules.flatMap((m) => [...(m.OUT_OF_TOTAL ?? [])]),
);

interface IViolation {
  check: string;
  kind: string;
  where: string;
  archive: string;
  round: number;
  offMs: number;
  /** owner-independent identity of the fact (distinct counting) */
  fact: string;
  detail: string;
  line?: string;
}
const checked = new Map<string, number>();
const violations: IViolation[] = [];

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
const roundsSeen = new Set<string>();
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  const findingsPath = join(dir, f.shard, "findings", f.name);
  const menu = existsSync(findingsPath)
    ? readFileSync(findingsPath, "utf8")
    : "";
  const [archive, ownerName] = text.split("\n", 2);
  if (!archive || !ownerName) continue;
  const key = `${f.shard}:${archive}`;
  if (key !== cacheKey) {
    try {
      cacheItems = parseFile(
        archive.startsWith("/") ? archive : resolve(ARCHIVE_DIR, archive),
      );
    } catch {
      cacheItems = [];
    }
    cacheKey = key;
  }
  const item = cacheItems[f.round - 1];
  if (!item) {
    unmapped.push(`${f.shard}/${f.name} (${archive})`);
    continue;
  }
  const rawLines: string[] = ((item as any).rawLines ?? []) as string[];
  let legacy: ReturnType<typeof toLegacyMatch>;
  try {
    legacy = toLegacyMatch({ ...item, rawLines: [] } as GladMatch);
  } catch {
    unmapped.push(`${f.shard}/${f.name} (toLegacyMatch threw)`);
    continue;
  }
  contexts++;
  const lines = text.split("\n");
  const units = Object.values(legacy.units ?? {}) as any[];
  const byName = new Map(units.map((u) => [u.name, u]));
  const pidName = new Map<string, string>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
    if (u) pidName.set(u[1]!, u[2]!);
  }
  const pidByName = new Map<string, string>();
  for (const [pid, n] of pidName) pidByName.set(n, pid);
  const owner = byName.get(ownerName);
  if (!owner) continue;
  const start: number = legacy.startTime;
  const end: number = legacy.endTime;
  const where = `${f.shard}/${f.name}`;
  const roundKey = `${archive}#${f.round}`;
  let streams: ReturnType<typeof parseRawStreams> | undefined;
  const firstOwnerOfRound = !roundsSeen.has(roundKey);
  roundsSeen.add(roundKey);
  const ctx: IRoundCtx = {
    where,
    archive,
    round: f.round,
    roundKey,
    lines,
    menu,
    rawLines,
    legacy,
    units,
    players: units.filter((u) => u.info),
    byName,
    unitOfPid: (pid) => (pid ? byName.get(pidName.get(pid) ?? "") : undefined),
    pidOf: (n) => pidByName.get(n),
    owner,
    start,
    end,
    roundEndAt: Math.min(
      end,
      playableEndMs(legacy as never, units as never) ?? Infinity,
    ),
    rawStreams: () =>
      (streams ??= parseRawStreams(
        rawLines.join("\n"),
        start,
        (end - start) / 1000,
      )),
    violate: (check, kind, atMs, factId, detail, line) => {
      if (ONLY && !ONLY.includes(check)) return;
      violations.push({
        check,
        kind,
        where,
        archive,
        round: f.round,
        offMs: atMs - start,
        fact: `${roundKey}#${check}#${kind}#${factId}`,
        detail,
        ...(line ? { line: line.trim().slice(0, 240) } : {}),
      });
    },
    bump: (c, n = 1) => checked.set(c, (checked.get(c) ?? 0) + n),
    firstOwnerOfRound,
  };
  for (const m of modules) m.run(ctx);
}

// ── report ──
const say = (s: string) => console.log(s);
say(`corpusFactScan5 ${resolve(dir)}: ${contexts} contexts`);
for (const c of CHECKS) {
  const all = violations.filter((v) => v.check === c);
  const vs = all.filter((v) => !OUT_OF_TOTAL.has(`${c}|${v.kind}`));
  const distinct = new Set(vs.map((v) => v.fact));
  say(
    `${c}: checked ${checked.get(c) ?? 0} / violations ${vs.length} (distinct facts ${distinct.size})`,
  );
  const kinds = new Map<string, IViolation[]>();
  for (const v of all) kinds.set(v.kind, [...(kinds.get(v.kind) ?? []), v]);
  for (const [k, ks] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
    const kd = new Set(ks.map((v) => v.fact)).size;
    say(
      `  ${k}: ${ks.length} (distinct ${kd})${OUT_OF_TOTAL.has(`${c}|${k}`) ? "  [not in the total]" : ""}`,
    );
    for (const v of ks.slice(0, EXAMPLES))
      say(`    ${v.where} r${v.round} +${v.offMs}ms ${v.detail}`);
  }
}
for (const m of modules) for (const l of m.report?.() ?? []) say(l);
if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        capture: resolve(dir),
        contexts,
        checked: Object.fromEntries(checked),
        violations,
      },
      null,
      1,
    ),
  );
  say(`wrote ${JSON_OUT}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
