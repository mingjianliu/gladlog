import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeBareImports } from "../scripts/bareImportSideEffects";

// Each case: a consumer with one bare import of `./mod`, whose module text is
// given. The five impure cases are codex's 2026-10-08 reproductions (GH #116
// batch 11 post-hoc review) — every one was reported PURE before.
let dir = "";
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const verdict = (files: Record<string, string>): boolean => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bare-import-"));
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, "consumer.ts"), `import "./mod";\n`);
  const [v] = analyzeBareImports(path.join(dir, "consumer.ts"));
  return v!.pure;
};

describe("bareImportSideEffects", () => {
  it("a module of constants, literals and plain functions is pure", () => {
    expect(
      verdict({
        "mod.ts": [
          `export const A = Object.freeze({ x: 1 });`,
          `export const B = new Map([["a", 1]]);`,
          `export function f(p: { y: number }) { let y = p.y; y = y + 1; return { y }; }`,
          // rebinding a callback's own local stays local
          `export const C = Array.from([1, 2], (n) => { let s = 0; s = s + n; return s; });`,
          `export class K { static z = 3; m() { return 1; } }`,
        ].join("\n"),
      }),
    ).toBe(true);
  });

  it("a computed method name runs at definition", () => {
    expect(
      verdict({
        "mod.ts": `export class C { [((globalThis as any).registered = true, "m")]() {} }`,
      }),
    ).toBe(false);
  });

  it("a member decorator runs at definition", () => {
    expect(
      verdict({
        "mod.ts": `const dec = (..._a: unknown[]) => {};\nexport class C { @dec m() {} }`,
      }),
    ).toBe(false);
  });

  it("a write through a parameter may reach shared state (Object.prototype)", () => {
    expect(
      verdict({
        "mod.ts": `export const v = Array.from([Object.prototype], (p: any) => ((p.registered = true), p));`,
      }),
    ).toBe(false);
  });

  it("a write through a local alias is not local", () => {
    expect(
      verdict({
        "mod.ts": `export const v = Array.from([1], () => { const a: any = Object.prototype; a.registered = true; return 1; });`,
      }),
    ).toBe(false);
  });

  it("a shadowed standard global is not the global", () => {
    expect(
      verdict({
        "mod.ts": `function Number() { (globalThis as any).registered = true; return 1; }\nexport const value = Number();`,
      }),
    ).toBe(false);
  });

  it("./x.js resolves to x.ts, and its impurity counts", () => {
    expect(
      verdict({
        "mod.ts": `import "./register.js";\nexport const a = 1;`,
        "register.ts": `(globalThis as any).registered = true;`,
      }),
    ).toBe(false);
  });

  it("an unresolved relative runtime import is impure", () => {
    expect(
      verdict({ "mod.ts": `import "./missing";\nexport const a = 1;` }),
    ).toBe(false);
  });

  it("a throw in a static block runs at evaluation", () => {
    expect(
      verdict({
        "mod.ts": `export class C { static { throw new Error("init failed"); } }`,
      }),
    ).toBe(false);
  });

  // codex re-review 2026-10-08: four more false PUREs
  it("a fresh local's field may still be shared state", () => {
    expect(
      verdict({
        "mod.ts": `export const v = Array.from([1], () => { const p: any = { shared: Object.prototype }; p.shared.registered = true; return p; });`,
      }),
    ).toBe(false);
  });

  it("a destructured parameter shadows an outer local", () => {
    expect(
      verdict({
        "mod.ts": `export const v = Array.from([1], () => { const p = {}; return Array.from([{ p: Object.prototype as any }], ({ p }) => ((p.registered = true), p)); });`,
      }),
    ).toBe(false);
  });

  it("a type-asserted callback handed to a call runs now", () => {
    expect(
      verdict({
        "mod.ts": `export const v = Array.from([1], (() => { throw new Error("init failed"); }) as (n: number) => never);`,
      }),
    ).toBe(false);
  });

  it("an object-literal method a constructor drives runs now", () => {
    expect(
      verdict({
        "mod.ts": `export const v = new Set({ [Symbol.iterator]() { throw new Error("init failed"); } } as any);`,
      }),
    ).toBe(false);
  });

  it("./dir/index.js prefers index.ts over a sibling index.js", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bare-import-"));
    fs.mkdirSync(path.join(dir, "dir"));
    fs.writeFileSync(path.join(dir, "mod.ts"), `import "./dir/index.js";\n`);
    fs.writeFileSync(path.join(dir, "dir/index.js"), `export const x = 1;\n`);
    fs.writeFileSync(
      path.join(dir, "dir/index.ts"),
      `(globalThis as any).registered = true;\n`,
    );
    fs.writeFileSync(path.join(dir, "consumer.ts"), `import "./mod";\n`);
    expect(analyzeBareImports(path.join(dir, "consumer.ts"))[0]!.pure).toBe(
      false,
    );
  });

  // agy second re-review 2026-10-08: declared functions and methods were not
  // scanned, a "deferred" throw could be run by an allowed call, and an
  // unlisted global could be handed to one
  it("a declared function a coercion hook runs is scanned", () => {
    expect(
      verdict({
        "mod.ts": `function foo() { (globalThis as any).registered = true; return 1; }\nexport const v = 1 + ({ valueOf: foo } as any);`,
      }),
    ).toBe(false);
  });

  it("a throwing function handed to an allowed call is impure", () => {
    expect(
      verdict({
        "mod.ts": `const f = () => { throw new Error("boom"); };\nexport const v = Array.from([1], f);`,
      }),
    ).toBe(false);
  });

  it("an unlisted global handed to an allowed call is impure", () => {
    expect(
      verdict({
        "mod.ts": `export const v = Array.from(["0"], eval);`,
      }),
    ).toBe(false);
  });
});

describe("bareImportSideEffects — evaluation order", () => {
  const orderSame = (consumer: string): boolean => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bare-import-"));
    fs.writeFileSync(
      path.join(dir, "mod.ts"),
      `(globalThis as any).registered = true;\nexport const x = 1;\n`,
    );
    fs.writeFileSync(path.join(dir, "other.ts"), `export const y = 2;\n`);
    fs.writeFileSync(path.join(dir, "consumer.ts"), consumer);
    return analyzeBareImports(path.join(dir, "consumer.ts")).find(
      (v) => v.spec === "./mod",
    )!.orderUnchanged;
  };

  it("an impure module already evaluated by an earlier import: removal changes nothing", () => {
    expect(
      orderSame(
        `import { x } from "./mod";\nimport "./other";\nimport "./mod";\nexport const z = x;\n`,
      ),
    ).toBe(true);
  });

  it("a module first reached later: removal moves it", () => {
    expect(
      orderSame(
        `import "./mod";\nimport "./other";\nimport { x } from "./mod";\nexport const z = x;\n`,
      ),
    ).toBe(false);
  });

  it("an earlier import used only as a type is elided and does not count", () => {
    expect(
      orderSame(
        `import { x } from "./mod";\nimport "./mod";\nexport type Z = typeof x;\n`,
      ),
    ).toBe(false);
  });

  it("an earlier import only re-exported as a type is elided", () => {
    expect(
      orderSame(
        `import { x } from "./mod";\nimport "./mod";\nexport type { x };\n`,
      ),
    ).toBe(false);
    expect(
      orderSame(
        `import { x } from "./mod";\nimport "./mod";\nexport { type x };\n`,
      ),
    ).toBe(false);
  });

  it("an earlier import used only inside an ambient declaration is elided", () => {
    expect(
      orderSame(
        `import { x } from "./mod";\nimport "./mod";\ndeclare const c: number;\ndeclare class C extends (x as any) {}\n`,
      ),
    ).toBe(false);
  });

  it("type parameters, abstract members, overloads and `export as namespace` keep nothing alive", () => {
    for (const body of [
      `export class C<x> {}\n`,
      `export abstract class C { abstract [x](): void; }\n`,
      `export class C { [x](a: string): void; m(a: unknown) { return a; } }\n`,
      `export as namespace x;\n`,
    ])
      expect(
        orderSame(`import { x } from "./mod";\nimport "./mod";\n${body}`),
      ).toBe(false);
  });

  it("an earlier import never used is elided and does not count", () => {
    expect(orderSame(`import { x } from "./mod";\nimport "./mod";\n`)).toBe(
      false,
    );
  });
});
