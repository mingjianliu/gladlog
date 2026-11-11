/**
 * corpusFactScan5.ts — corpus-wide deterministic fact checks, batch 5
 * (fact6 F20, 2026-10-28): one module per recurring fact class of the
 * round-6 double audit (`runs/fact6-2026-10-27`), in `scan5/`. User
 * 2026-10-28 「同意」: each class is counted over the whole capture BEFORE
 * its fix — the log's observed truth against the set the code knows
 * (Curated-List forward check) and every reader's rendered line, not the
 * audited id alone. Runs on `verify/` like the other scans (`--examples N`,
 * distinct-fact counting); each module documents its own checks.
 *
 *   npx tsx packages/eval/scripts/corpusFactScan5.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>] [--only <check,…>]
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ensureAnalysisData } from "@gladlog/analysis";

import type {
  IRoundCtx,
  IScanModule,
  IViolationRef,
  RecordViolation,
} from "./scan5/ctx";
import { type MergeRule, mergeState } from "./verify/merge";
import {
  type IContext,
  type IScan,
  type IScanOpts,
  isMainScan,
  runScanCli,
} from "./verify/scan";
import { timed } from "./verify/timing";

let dir = "";
let EXAMPLES = 5;
let JSON_OUT: string | undefined;
let ONLY: string[] | undefined;
const loadFailures: string[] = [];

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
  "unseenPress",
  "unseenSelfAura",
  "overheal",
  "controlCooldown",
  "pressEffect",
  "burstTarget",
  "lockoutHeal",
  "effectEnd",
  "silenceKick",
  "damageBasis",
  "pressFiling",
  "listGap",
  "talentWall",
  "wardLeadReturn",
  "overrideVariant",
  "friendlyOffensiveTag",
  "allyShield",
  "friendlyUtilityPress",
  "castThroughStun",
  "killAttemptFacts",
  "spanFacts",
  "singles14b",
  "replacedKit",
  "fact8",
  "kickImmune",
  "kitAimed",
  "offListPress",
  "fact9",
  "fact9b",
  "fact9c",
  "fact9d",
  "fact9e",
  "fact9f",
  "fact9g",
  "fact9h",
  "fact10",
  "fact10b",
  "fact11",
  "fact12",
  "fact12b",
  "fact12c",
  "t05",
  "reannounce",
  "t11",
  "t08",
  "t12",
  "t02",
  "fact12d",
  "t32",
  "t26petLock",
  "t31",
  "t33",
  "t16",
  "t17",
  "t29",
  "t18",
  "t35",
  "t49",
  "t92",
  "t46",
  "t72",
  "t47",
  "t38",
  "t52",
  "t68",
  "t48",
  "t43",
  "t78",
  "t44",
  "t42",
  "t60",
  "t83",
  "t65",
  "t51",
  "t77",
  "t40",
  "t41",
  "t91",
];
await ensureAnalysisData();
const modules: Array<IScanModule & { file: string }> = [];
for (const m of MODULE_FILES) {
  const p = join(import.meta.dirname, "scan5", `${m}.ts`);
  if (!existsSync(p)) continue;
  // a module that fails to load is reported (exit 1) without hiding the rest
  try {
    modules.push({ ...((await import(p)) as IScanModule), file: m });
  } catch (e) {
    loadFailures.push(`module ${m} failed to load: ${(e as Error).message}`);
  }
}
const OUT_OF_TOTAL = new Set(
  modules.flatMap((m) => [...(m.OUT_OF_TOTAL ?? [])]),
);
/** the report's total and the coverage rows read this one predicate */
const inTotal = (check: string, kind: string): boolean =>
  !OUT_OF_TOTAL.has(`${check}|${kind}`);

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
let checked = new Map<string, number>();
let violations: IViolation[] = [];
let contexts = 0;
const roundsSeen = new Set<string>();

const record: RecordViolation = (
  ref,
  check,
  kind,
  atMs,
  factId,
  detail,
  line,
) => {
  if (ONLY && !ONLY.includes(check)) return;
  violations.push({
    check,
    kind,
    where: ref.where,
    archive: ref.archive,
    round: ref.round,
    offMs: atMs - ref.start,
    fact: `${ref.roundKey}#${check}#${kind}#${factId}`,
    detail,
    ...(line ? { line: line.trim().slice(0, 240) } : {}),
  });
};

function runRound(base: IContext): void {
  contexts++;
  if (!base.owner) return;
  const { where, archive, round, roundKey, start } = base;
  const firstOwnerOfRound = !roundsSeen.has(roundKey);
  roundsSeen.add(roundKey);
  const ref: IViolationRef = { where, archive, round, roundKey, start };
  const ctx: IRoundCtx = {
    ...base,
    ref,
    violate: (check, kind, atMs, factId, detail, line) =>
      record(ref, check, kind, atMs, factId, detail, line),
    bump: (c, n = 1) => checked.set(c, (checked.get(c) ?? 0) + n),
    firstOwnerOfRound,
  };
  // `--only`: a module none of whose checks was asked for is not run at all
  for (const m of modules)
    if (!ONLY || m.CHECKS.some((c) => ONLY!.includes(c)))
      timed(`scan5/${m.file}`, () => m.run(ctx));
}

function report(): void {
  for (const m of modules) m.finalize?.(record);
  const CHECKS = modules
    .flatMap((m) => [...m.CHECKS])
    .filter((c) => !ONLY || ONLY.includes(c));
  const say = (s: string) => console.log(s);
  say(`corpusFactScan5 ${resolve(dir)}: ${contexts} contexts`);
  for (const c of CHECKS) {
    const all = violations.filter((v) => v.check === c);
    const vs = all.filter((v) => inTotal(c, v.kind));
    const distinct = new Set(vs.map((v) => v.fact));
    say(
      `${c}: checked ${checked.get(c) ?? 0} / violations ${vs.length} (distinct facts ${distinct.size})`,
    );
    const kinds = new Map<string, IViolation[]>();
    for (const v of all) {
      const ks = kinds.get(v.kind);
      if (ks) ks.push(v);
      else kinds.set(v.kind, [v]);
    }
    for (const [k, ks] of [...kinds].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      const kd = new Set(ks.map((v) => v.fact)).size;
      say(
        `  ${k}: ${ks.length} (distinct ${kd})${inTotal(c, k) ? "" : "  [not in the total]"}`,
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
  for (const u of loadFailures) say(u);
  if (loadFailures.length > 0) process.exitCode = 1;
}

const stateful = modules.filter((m) => m.state);
const state = () => ({
  contexts,
  checked,
  violations,
  // a module one process could not load is a hole in the merged report
  loadFailures,
  modules: Object.fromEntries(stateful.map((m) => [m.file, m.state!()])),
});
const mergeRules: Record<
  string,
  Record<string, MergeRule>
> = Object.fromEntries(
  stateful.filter((m) => m.merge).map((m) => [m.file, m.merge!]),
);
export const scan: IScan<ReturnType<typeof state>> = {
  name: "corpusFactScan5",
  inTotal,
  configure(o: IScanOpts) {
    dir = o.dir;
    EXAMPLES = o.examples;
    JSON_OUT = o.json;
    ONLY = o.only;
  },
  run: runRound,
  report,
  state,
  load(s) {
    ({ contexts, checked, violations } = s);
    loadFailures.splice(0, loadFailures.length, ...s.loadFailures);
    for (const m of stateful) m.load!(s.modules[m.file] as never);
  },
  merge: {
    modules: (a: Record<string, object>, b: Record<string, object>) => {
      for (const k of Object.keys(b))
        a[k] = mergeState(
          a[k] as Record<string, unknown>,
          b[k] as Record<string, unknown>,
          mergeRules[k],
        );
      return a;
    },
  },
};

if (isMainScan(import.meta.url)) await runScanCli(scan);
