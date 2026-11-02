/**
 * The verification runner (`scripts/verify/`): what makes its parallel run equal
 * to a serial one. The whole-corpus equality is measured, not tested — see
 * `docs/developer-guide.md`; here the rules that hold it together, above all the
 * one a new check can break without any error: an accumulator its report reads
 * that `state()` does not carry reads empty after the merge.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { compareRuns, countsOf } from "../scripts/verify/compare";
import { CoverageTracker } from "../scripts/verify/coverage";
import { pickCover } from "../scripts/verify/coverSet";
import { addEach, mergeState, mergeValue } from "../scripts/verify/merge";
import { listContextFiles, splitContexts } from "../scripts/verify/rounds";
import { type IScan, isMainScan } from "../scripts/verify/scan";

const SCRIPTS = join(__dirname, "../scripts");

describe("mergeState", () => {
  it("ends where one process reading the runs in order would", () => {
    const a = {
      n: 2,
      rows: [{ x: 1 }],
      byId: new Map<string, unknown>([
        ["a", { n: 1, name: "first", casts: new Map([["c", 1]]) }],
      ]),
      seen: new Set(["r1"]),
      flag: new Map([["s", false]]),
    };
    const b = {
      n: 3,
      rows: [{ x: 2 }],
      byId: new Map<string, unknown>([
        [
          "a",
          {
            n: 4,
            name: "second",
            casts: new Map([
              ["c", 2],
              ["d", 1],
            ]),
          },
        ],
        ["b", { n: 1, name: "b", casts: new Map() }],
      ]),
      seen: new Set(["r1", "r2"]),
      flag: new Map([["s", true]]),
    };
    expect(mergeState(a, b)).toEqual({
      n: 5,
      rows: [{ x: 1 }, { x: 2 }],
      byId: new Map([
        [
          "a",
          {
            n: 5,
            name: "first",
            casts: new Map([
              ["c", 3],
              ["d", 1],
            ]),
          },
        ],
        ["b", { n: 1, name: "b", casts: new Map() }],
      ]),
      seen: new Set(["r1", "r2"]),
      flag: new Map([["s", true]]),
    });
    expect([...(a.byId as Map<string, unknown>).keys()]).toEqual(["a", "b"]);
  });

  it("lets a field that does not add name its own rule", () => {
    expect(
      mergeState(
        { tally: [1, 2, 3], n: 1 },
        { tally: [1, 0, 1], n: 1 },
        { tally: addEach },
      ),
    ).toEqual({ tally: [2, 2, 4], n: 2 });
  });

  it("keeps a string set only in a later part", () => {
    expect(mergeState({ source: "" }, { source: "DB2" })).toEqual({
      source: "DB2",
    });
    expect(mergeState({ source: "a" }, { source: "b" })).toEqual({
      source: "a",
    });
  });

  it("refuses a pair it has no meaning for", () => {
    expect(() => mergeValue(1, "x")).toThrow(/cannot merge/);
  });
});

describe("splitContexts", () => {
  const capture = () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    for (const s of ["s0", "s1"]) {
      mkdirSync(join(dir, s, "context"), { recursive: true });
      for (let file = 1; file <= 4; file++)
        for (let owner = 0; owner < 3; owner++)
          writeFileSync(
            join(dir, s, "context", `${file}-1-${file * 10 + owner}.txt`),
            `/nowhere/${s}-${file}.txt\nowner\n`,
          );
    }
    return dir;
  };

  it("keeps a round together whatever readdir returns", () => {
    const dir = capture();
    writeFileSync(join(dir, "s0", "context", "1-2-5.txt"), "/a\no\n");
    writeFileSync(join(dir, "s0", "context", "1-1-99.txt"), "/a\no\n");
    const rounds = listContextFiles(dir)
      .filter((f) => f.shard === "s0" && f.fileNo === 1)
      .map((f) => f.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
  });

  it("joined back in order is the serial order, and never cuts an archive", () => {
    const dir = capture();
    const files = listContextFiles(dir);
    const runs = splitContexts(dir, files, 3);
    expect(runs.flat()).toEqual(files);
    const home = new Map<string, number>();
    runs.forEach((run, k) => {
      for (const f of run) {
        const key = `${f.shard}:${f.fileNo}`;
        expect(home.get(key) ?? k).toBe(k);
        home.set(key, k);
      }
    });
    expect(runs.every((r) => r.length > 0)).toBe(true);
  });
});

describe("countsOf", () => {
  it("reads all three report shapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    const scan = join(dir, "corpusFactScan5.txt");
    writeFileSync(
      scan,
      "corpusFactScan5 /x: 3 contexts\na: checked 12 / violations 3 (distinct facts 1)\n  kind: 3 (distinct 1)\nb: expected 4, wrong 1\nc: expected 4, missing 0\n",
    );
    const gates = join(dir, "gates.txt");
    writeFileSync(gates, "gates 2, owner files 3\n  checkOne: 7\n");
    expect([...countsOf(scan)]).toEqual([
      ["a", { checked: 12, failed: 3 }],
      ["b", { checked: 4, failed: 1 }],
      ["c", { checked: 4, failed: 0 }],
    ]);
    expect(countsOf(gates).get("checkOne")).toEqual({ checked: 0, failed: 7 });
  });
});

describe("compareRuns", () => {
  const run = (reports: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    for (const [f, text] of Object.entries(reports))
      writeFileSync(join(dir, f), text);
    return dir;
  };
  const scan = (failed: number) => `a: checked 4 / violations ${failed} (x)\n`;

  it("needs a signature for a rise, with or without a ledger", () => {
    const r = compareRuns(run({ "s.txt": scan(1) }), run({ "s.txt": scan(2) }));
    expect(r.unsigned).toEqual(["s:a"]);
    const signed = compareRuns(
      run({ "s.txt": scan(1) }),
      run({ "s.txt": scan(2) }),
      new Map([["s:a", "lag the check"]]),
    );
    expect(signed.unsigned).toEqual([]);
  });

  it("calls a report missing on either side broken", () => {
    const whole = { "s.txt": scan(0), "t.txt": scan(0) };
    expect(compareRuns(run(whole), run({ "s.txt": scan(0) })).broken).toEqual([
      "t.txt: report on one side only",
    ]);
    expect(compareRuns(run({ "s.txt": scan(0) }), run(whole)).broken).toEqual([
      "t.txt: report on one side only",
    ]);
    expect(compareRuns(run({}), run({})).broken).toHaveLength(1);
  });

  it("does not read a check that vanished as a zero", () => {
    const base = run({ "s.txt": `${scan(3)}b: expected 4, wrong 2\n` });
    expect(compareRuns(base, run({ "s.txt": scan(3) })).broken).toEqual([
      "s:b: dropped",
    ]);
    expect(compareRuns(base, run({ "s.txt": "" })).broken).toContain(
      "s.txt: no checks in the report",
    );
  });

  it("wants a report's structure on both sides", () => {
    const gates = "gates 2, owner files 3\n  checkOne: 7\n";
    expect(
      compareRuns(run({ "gates.txt": gates }), run({ "gates.txt": "" })).broken,
    ).toEqual(["gates.txt: no header"]);
    expect(
      compareRuns(
        run({ "gates.txt": gates }),
        run({ "gates.txt": "gates 2, owner files 2\n" }),
      ).broken,
    ).toEqual(["gates.txt: owners 3 -> 2"]);
    expect(
      compareRuns(run({ "s.txt": "" }), run({ "s.txt": scan(0) })).broken,
    ).toEqual(["s.txt: no checks in the base report"]);
  });

  it("takes a gate class that stopped failing as a zero", () => {
    const r = compareRuns(
      run({ "gates.txt": "gates 2, owner files 3\n  checkOne: 7\n" }),
      run({ "gates.txt": "gates 2, owner files 3\n" }),
    );
    expect(r.broken).toEqual([]);
    expect(r.fell).toBe(1);
  });
});

describe("isMainScan", () => {
  it("sees the entry point through a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    const real = join(dir, "real.ts");
    writeFileSync(real, "");
    const link = join(dir, "link.ts");
    symlinkSync(real, link);
    const url = pathToFileURL(real).href;
    expect(isMainScan(url, link)).toBe(true);
    expect(isMainScan(url, join(dir, "other.ts"))).toBe(false);
    expect(isMainScan(url, undefined)).toBe(false);
  });
});

describe("verify/cycle.ts", () => {
  it("refuses a directory holding an earlier pass", () => {
    const out = mkdtempSync(join(tmpdir(), "verify-"));
    writeFileSync(join(out, "old.txt"), "an earlier pass\n");
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(SCRIPTS, "verify/cycle.ts"),
        "--out",
        out,
        "--from",
        out,
      ],
      { cwd: join(__dirname, ".."), encoding: "utf8" },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cycle refused");
  }, 30_000);
});

describe("verify/run.ts", () => {
  const runner = (cap: string, out: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(SCRIPTS, "verify/run.ts"),
        cap,
        "--out",
        out,
        "--scans",
        "gates",
        "--workers",
        "1",
      ],
      { cwd: join(__dirname, ".."), encoding: "utf8" },
    );

  it("fails on an empty capture and on a context with no owner line, leaving no report", () => {
    const cap = mkdtempSync(join(tmpdir(), "verify-"));
    const context = join(cap, "s0", "context");
    mkdirSync(context, { recursive: true });
    const out = join(cap, "out");
    mkdirSync(out);
    writeFileSync(join(out, "gates.txt"), "the last good run\n");
    expect(runner(cap, out).status).toBe(1);
    expect(existsSync(join(out, "gates.txt"))).toBe(false);

    writeFileSync(join(out, "gates.txt"), "the last good run\n");
    writeFileSync(join(context, "1-1-1.txt"), "/nowhere\n");
    expect(runner(cap, out).status).toBe(1);
    expect(existsSync(join(out, "gates.txt"))).toBe(false);
    expect(readdirSync(cap).filter((f) => f.startsWith(".verify-"))).toEqual(
      [],
    );
  }, 60_000);

  it("publishes a clean text-only run", () => {
    const cap = mkdtempSync(join(tmpdir(), "verify-"));
    const context = join(cap, "s0", "context");
    mkdirSync(context, { recursive: true });
    writeFileSync(join(context, "1-1-1.txt"), "/nowhere\nowner\n");
    const out = join(cap, "out");
    const r = runner(cap, out);
    expect(r.stdout).toContain("1/1 contexts");
    expect(r.status).toBe(0);
    expect(readFileSync(join(out, "gates.txt"), "utf8")).toContain(
      "owner files 1",
    );
    expect(readFileSync(join(out, "gates.json"), "utf8")).toContain('"files"');
  }, 60_000);
});

describe("pickCover", () => {
  it("covers everything, cheapest first, and keeps what it is told to", () => {
    const items = new Map([
      ["big", new Set(["a", "b", "c"])],
      ["small1", new Set(["a", "b"])],
      ["small2", new Set(["c"])],
      ["keep", new Set(["d"])],
    ]);
    const cost = (a: string) => (a === "big" ? 100 : 1);
    expect(pickCover(items, cost, ["keep"]).sort()).toEqual([
      "keep",
      "small1",
      "small2",
    ]);
  });
});

describe("CoverageTracker", () => {
  it("files a kind kept out of the total under its kind, not as a failure of its check", () => {
    const state = {
      checked: new Map([["x", 2]]),
      violations: [
        { check: "x", kind: "info" },
        { check: "x", kind: "real" },
      ],
    };
    const scan = {
      state: () => state,
      inTotal: (_c: string, k: string) => k !== "info",
    } as unknown as IScan;
    const t = new CoverageTracker();
    state.violations.length = 1;
    t.step("a1", [{ name: "s", scan }]);
    state.violations.push({ check: "x", kind: "real" });
    state.checked.set("x", 3);
    t.step("a2", [{ name: "s", scan }]);
    expect(t.rows.map((r) => [r.archive, r.fail])).toEqual([
      ["a1", ["s:x|info"]],
      ["a2", ["s:x", "s:x|real"]],
    ]);
  });

  it("is told the total by every scan that keeps kinds out of it", () => {
    for (const f of readdirSync(SCRIPTS).filter((n) =>
      /^corpusFactScan\d?\.ts$/.test(n),
    )) {
      const src = readFileSync(join(SCRIPTS, f), "utf8");
      if (/OUT_OF_TOTAL|MEASURED_ONLY/.test(src))
        expect(src, f).toMatch(/^ {2,4}inTotal,$/m);
    }
  });
});

/** what a scan's report (and finalize) reads, through the helpers it calls */
function reachableFrom(
  src: ts.SourceFile,
  decls: ts.Statement[],
  roots: string[],
): Set<string> {
  const bodies = new Map<string, ts.Node>();
  for (const st of decls) {
    if (ts.isFunctionDeclaration(st) && st.name) bodies.set(st.name.text, st);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) bodies.set(d.name.text, d);
  }
  const seen = new Set<string>();
  const todo = roots.filter((r) => bodies.has(r));
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && bodies.has(n.text) && !seen.has(n.text)) {
      seen.add(n.text);
      todo.push(n.text);
    }
    ts.forEachChild(n, walk);
  };
  while (todo.length > 0) walk(bodies.get(todo.pop()!)!);
  return seen;
}

/** module-level names written inside a function, not at load */
function writtenLater(decls: ts.Statement[]): Set<string> {
  const names = new Set<string>();
  const MUTATORS = new Set(["push", "set", "add", "delete", "clear"]);
  const base = (e: ts.Expression): string | undefined => {
    while (
      ts.isPropertyAccessExpression(e) ||
      ts.isElementAccessExpression(e) ||
      ts.isNonNullExpression(e)
    )
      e = e.expression;
    return ts.isIdentifier(e) ? e.text : undefined;
  };
  const walk = (n: ts.Node, inFunction: boolean): void => {
    const inFn = inFunction || ts.isFunctionLike(n);
    if (inFn) {
      let target: string | undefined;
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        MUTATORS.has(n.expression.name.text)
      )
        target = base(n.expression.expression);
      else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        target = base(n.left);
      else if (
        (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
        (n.operator === ts.SyntaxKind.PlusPlusToken ||
          n.operator === ts.SyntaxKind.MinusMinusToken)
      )
        target = base(n.operand);
      if (target) names.add(target);
    }
    ts.forEachChild(n, (c) => walk(c, inFn));
  };
  for (const st of decls) walk(st, false);
  return names;
}

/** per-process lookups rebuilt on demand: they hold no finding */
const PER_PROCESS_CACHES = new Set([
  "aliasCache",
  "familyByName",
  "siblingCache",
  "variantTable",
  "castOfAura",
  "silenceIds",
]);
/** set by `configure` in every process */
const OPTIONS = new Set(["dir", "EXAMPLES", "JSON_OUT", "ONLY"]);

describe("every accumulator a report reads crosses the merge", () => {
  const files = [
    ...[
      "corpusFactScan",
      "corpusFactScan2",
      "corpusFactScan3",
      "corpusFactScan4",
      "corpusFactScan5",
      "fact2Scan",
      "pressFactScan",
      "breakFactScan",
    ].map((f) => `${f}.ts`),
    "verify/gates.ts",
    ...readdirSync(join(SCRIPTS, "scan5"))
      .filter((f) => f.endsWith(".ts") && f !== "ctx.ts")
      .map((f) => `scan5/${f}`),
  ];
  it.each(files)("%s", (file) => {
    const text = readFileSync(join(SCRIPTS, file), "utf8");
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const factory = src.statements.find(
      (s) => ts.isFunctionDeclaration(s) && s.name?.text === "createScan",
    ) as ts.FunctionDeclaration | undefined;
    const decls = [
      ...src.statements,
      ...(factory ? factory.body!.statements : []),
    ];
    const read = reachableFrom(src, decls, ["report", "finalize"]);
    const written = writtenLater(decls);
    const stateDecl = decls
      .filter(ts.isVariableStatement)
      .flatMap((s) => [...s.declarationList.declarations])
      .find((d) => d.name.getText(src) === "state");
    const carried = new Set(
      stateDecl ? (stateDecl.getText(src).match(/\b\w+\b/g) ?? []) : [],
    );
    const lost = [...read].filter(
      (n) =>
        written.has(n) &&
        !carried.has(n) &&
        !PER_PROCESS_CACHES.has(n) &&
        !OPTIONS.has(n),
    );
    expect(lost).toEqual([]);
  });
});
