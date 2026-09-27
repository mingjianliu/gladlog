import { describe, expect, it } from "vitest";

import {
  analyzeRange,
  findFunction,
  programFor,
  pruneImports,
  sameStatements,
} from "../src/explore/closureBindings";

// A big function with outer bindings, and a marked range that uses them.
function analyse(rangeBody: string, after = "") {
  const lines = [
    "import { imported, type ImportedType } from './somewhere';",
    "const MODULE_CONST = 1;",
    "export function big(params: { n: number }): number {",
    "  let a = 0, b = 0, x = 0;",
    "  const obj = { x: 0, nested: [] as number[], list: [] as number[] };",
    "  const set = new Set<number>();",
    "  function helper(): number { return a; }",
    "  // RANGE START",
    ...rangeBody.split("\n").map((l) => `  ${l}`),
    "  // RANGE END",
    `  ${after}`,
    "  return a + b + x;",
    "}",
  ];
  const text = lines.join("\n");
  const start = lines.indexOf("  // RANGE START") + 2;
  const end = lines.indexOf("  // RANGE END");
  const { sf, checker } = programFor("/virtual/big.ts", text);
  const r = analyzeRange(sf, checker, findFunction(sf, "big"), start, end);
  const classes = (name: string) =>
    [...(r.outer.find((o) => o.name === name)?.classes ?? [])].sort();
  return { r, classes };
}

describe("analyzeRange: writes to outer bindings", () => {
  it.each([
    ["a++;", "a"],
    ["--a;", "a"],
    ["a = 1;", "a"],
    ["a += 2;", "a"],
    ["[a, b] = [1, 2];", "a"],
    ["[a, b] = [1, 2];", "b"],
    ["({ a } = { a: 1 });", "a"],
    ["({ x: a } = { x: 1 });", "a"],
    ["[a = 5] = [];", "a"],
    ["[...a as unknown as number[]] = [];", "a"],
    ["for (a of [1, 2]) { void 0; }", "a"],
    ["for (x in obj) { void 0; }", "x"],
    ["const v = [a = 5];\nvoid v;", "a"],
    ["const v = { value: a = 5 };\nvoid v;", "a"],
    ["void (a = 5);", "a"],
  ])("%s -> %s is WRITE", (stmt, name) => {
    const { classes } = analyse(stmt);
    expect(classes(name)).toContain("WRITE");
  });

  it("reading in a literal is not a write", () => {
    const { classes } = analyse("console.log([a, b], { a }, { y: x });");
    expect(classes("a")).toEqual(["READ"]);
    expect(classes("b")).toEqual(["READ"]);
    expect(classes("x")).toEqual(["READ"]);
  });
});

describe("analyzeRange: member mutation, calls, types", () => {
  it("a parameter of the enclosing function is an outer binding", () => {
    const { classes } = analyse("void params.n;");
    expect(classes("params")).toEqual(["READ"]);
  });

  it.each([
    "obj.x++;",
    "obj.x = 3;",
    "obj['x'] += 1;",
    "obj.nested.push(1);",
    "delete (obj as { x?: number }).x;",
    "({ q: obj.x } = { q: 1 });",
  ])("%s mutates obj", (stmt) => {
    const { classes } = analyse(stmt);
    expect(classes("obj")).toContain("MEMBER-MUTATE");
  });

  it("set.add is a member mutation, set.has a read", () => {
    expect(analyse("set.add(1);").classes("set")).toEqual(["MEMBER-MUTATE"]);
    expect(analyse("void set.has(1);").classes("set")).toEqual(["READ"]);
  });

  it("a closure outside the range that references a binding is reported", () => {
    const { r } = analyse("a++;\nb++;");
    const refs = (n: string) =>
      r.outer.find((o) => o.name === n)!.closureRefsOutside;
    expect(refs("a")).toHaveLength(1); // helper() returns a
    expect(refs("b")).toEqual([]);
  });

  it("closure calls are CALL", () => {
    expect(analyse("void helper();").classes("helper")).toEqual(["CALL"]);
  });

  it("imports are collected, type-only where every use is a type", () => {
    const { r } = analyse("const v: ImportedType = imported();\nvoid v;");
    const e = r.imports.get("./somewhere")!;
    expect(e.names.get("imported")).toBe(false);
    expect(e.names.get("ImportedType")).toBe(true);
  });

  it("module-scope declarations of the same file are reported", () => {
    const { r } = analyse("void MODULE_CONST;");
    expect(r.moduleLocal.map((m) => m.name)).toEqual(["MODULE_CONST"]);
  });

  it("a return from the enclosing function is reported, a nested one is not", () => {
    expect(analyse("if (a) return 1;").r.escapingReturns).toHaveLength(1);
    expect(
      analyse("const f = () => { return 1; };\nvoid f;").r.escapingReturns,
    ).toHaveLength(0);
  });

  it("a declaration in the range used after it is reported", () => {
    const { r } = analyse("const made = 1;", "void made;");
    expect(r.declaredInsideUsedAfter.map((d) => d.name)).toEqual(["made"]);
  });
});

describe("sameStatements", () => {
  const base = [
    "const parts = [a, b].map((k) => k.toString());",
    "addEntry(",
    "  t,",
    "  `${fmtTime(t)}  [YOU] [HEALS]   ${parts.join(', ')}`,",
    ");",
    "let n = 0;",
    "n++;",
    "const r = obj?.x ?? /a b/g.test('x y');",
  ].join("\n");

  it("formatting, comments and trailing commas do not matter", () => {
    const reflowed = [
      "// a comment",
      "const parts = [a, b].map((k) => k.toString(),);",
      "addEntry(t, `${fmtTime(t)}  [YOU] [HEALS]   ${parts.join(', ')}`);",
      "let n = 0; n++;",
      "const r =",
      "  obj?.x ??",
      "  /a b/g.test('x y');",
    ].join("\n");
    expect(sameStatements(base, reflowed).equal).toBe(true);
  });

  it.each([
    ["whitespace inside a template literal", "[YOU] [HEALS]", "[YOU][HEALS]"],
    ["whitespace inside a string", "', '", "','"],
    ["whitespace inside a regex", "/a b/g", "/ab/g"],
    ["let -> const", "let n = 0;", "const n = 0;"],
    ["++ -> --", "n++;", "n--;"],
    ["optional chain dropped", "obj?.x", "obj.x"],
    ["?? -> ||", "obj?.x ??", "obj?.x ||"],
    ["identifier renamed", "parts.join", "part.join"],
  ])("%s is a difference", (_label, from, to) => {
    expect(base.includes(from)).toBe(true);
    expect(sameStatements(base, base.replace(from, to)).equal).toBe(false);
  });
});

describe("pruneImports", () => {
  const file = [
    'import { a, b, c } from "./one";',
    "import {",
    "  d,",
    "  e,",
    "  f,",
    '} from "./two";',
    'import { g } from "./three";',
    'import type { T } from "./types";',
    'import { unusedBefore } from "./four";',
    "",
    "export const x: T = a + d + f;",
    "",
  ].join("\n");
  const prune = (names: string[]) =>
    pruneImports("/virtual/p.ts", file, new Set(names));

  it("drops only candidates that are no longer referenced", () => {
    const r = prune(["b", "c", "e", "g", "a", "T"]);
    expect(r.removed.sort()).toEqual(["b", "c", "e", "g"]);
    expect(r.text).toBe(
      [
        'import { a } from "./one";',
        "import {",
        "  d,",
        "  f,",
        '} from "./two";',
        'import type { T } from "./types";',
        'import { unusedBefore } from "./four";',
        "",
        "export const x: T = a + d + f;",
        "",
      ].join("\n"),
    );
  });

  it("an already-unused import that is not a candidate stays", () => {
    expect(prune(["b"]).text).toContain("unusedBefore");
  });

  it("a multi-line list left with one name is joined onto one line", () => {
    const r = pruneImports(
      "/virtual/q.ts",
      ["import {", "  d,", "  e,", '} from "./two";', "void d;", ""].join("\n"),
      new Set(["e"]),
    );
    expect(r.text).toBe(
      ['import { d } from "./two";', "void d;", ""].join("\n"),
    );
  });
});
