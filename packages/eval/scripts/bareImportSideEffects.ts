/**
 * bareImportSideEffects.ts — for every bare `import "…";` in a file, decide
 * whether the imported module could have a top-level side effect that the
 * import ORDER protects (GH #116). The timeline split's import pruner keeps a
 * bare import where a named one lost its last binding, because evaluation
 * order can matter (codex 2026-09-28: a registration moved after its consumer
 * flipped a result). A bare import may be deleted only when its module cannot
 * affect any other module while it evaluates. Refactor tooling; nothing here
 * feeds production.
 *
 * A module is PURE here when every top-level statement is one of: an import /
 * export-from declaration, a function / class / interface / type / enum
 * declaration, an `export { … }` list, or a variable statement whose
 * initializers call nothing that is imported (literals, object / array
 * literals, arrow / function expressions, `new Map/Set/WeakMap/WeakSet/RegExp`
 * and calls of globals or of the module's own declarations are fine; any call
 * of an imported binding or of a member of one is not — it could register
 * into another module). Anything else — an expression statement, a top-level
 * loop / if, a call of an import — marks the module IMPURE, and its bare
 * import stays. JSON modules are pure.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/bareImportSideEffects.ts <file.ts>
 */
import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";

const file = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(file)) {
  console.error("usage: bareImportSideEffects.ts <file.ts>");
  process.exit(2);
}

const resolve = (from: string, spec: string): string | undefined => {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ])
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return undefined;
};

/** Standard globals and the members of theirs that cannot change anything
 * outside their own result: `""` = calling / constructing the global itself.
 * Anything else on a global (Object.assign, Object.defineProperty, …) is
 * impure (agy 2026-10-07). */
const SAFE_GLOBAL_MEMBERS = new Map<string, Set<string>>([
  ["Map", new Set([""])],
  ["Set", new Set([""])],
  ["WeakMap", new Set([""])],
  ["WeakSet", new Set([""])],
  ["RegExp", new Set([""])],
  ["Date", new Set([""])],
  ["Error", new Set([""])],
  [
    "Number",
    new Set(["", "isFinite", "isNaN", "isInteger", "parseFloat", "parseInt"]),
  ],
  ["String", new Set(["", "fromCharCode"])],
  ["Boolean", new Set([""])],
  ["Symbol", new Set([""])],
  ["Array", new Set(["", "from", "isArray", "of"])],
  ["Object", new Set(["freeze", "keys", "values", "entries", "fromEntries"])],
  ["JSON", new Set(["parse", "stringify"])],
  [
    "Math",
    new Set([
      "abs",
      "ceil",
      "floor",
      "round",
      "trunc",
      "max",
      "min",
      "pow",
      "sqrt",
      "log",
      "log10",
      "log2",
      "exp",
      "sign",
      "hypot",
    ]),
  ],
]);
/** host objects whose mere reference at evaluation could reach shared state */
const HOST_GLOBALS = new Set([
  "globalThis",
  "window",
  "self",
  "global",
  "document",
  "process",
  "console",
]);

function impurities(modFile: string): string[] {
  if (modFile.endsWith(".json")) return [];
  const sf = ts.createSourceFile(
    modFile,
    fs.readFileSync(modFile, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
  const imported = new Set<string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !s.importClause) continue;
    if (s.importClause.isTypeOnly) continue;
    const c = s.importClause;
    if (c.name) imported.add(c.name.text);
    if (c.namedBindings) {
      if (ts.isNamespaceImport(c.namedBindings))
        imported.add(c.namedBindings.name.text);
      else
        for (const e of c.namedBindings.elements)
          if (!e.isTypeOnly) imported.add(e.name.text);
    }
  }
  const out: string[] = [];
  const line = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const rootName = (e: ts.Expression): string | undefined => {
    let x: ts.Expression = e;
    while (
      ts.isPropertyAccessExpression(x) ||
      ts.isElementAccessExpression(x) ||
      ts.isNonNullExpression(x) ||
      ts.isParenthesizedExpression(x)
    )
      x = x.expression;
    return ts.isIdentifier(x) ? x.text : undefined;
  };
  // Evaluation-time code is scanned WHOLE — nested function bodies included,
  // since a callback can run during evaluation — and is impure on (a) any
  // reference to an imported binding (calls, property reads that may hit a
  // getter / Proxy, a circular import's not-yet-initialised value, `extends
  // importedMixin()`, `(0, f)()` all reduce to this), or (b) any call / new /
  // tagged template other than of a standard global (a call of a local
  // function may reach an import through its body). Sound but conservative
  // (agy review 2026-10-07 found five holes in the first, call-only rule).
  // an identifier (or member of one) declared inside a function nested in the
  // evaluation-time code — writing it cannot reach outside
  const isNestedLocal = (t: ts.Expression): boolean => {
    let x: ts.Expression = t;
    while (
      ts.isPropertyAccessExpression(x) ||
      ts.isElementAccessExpression(x) ||
      ts.isParenthesizedExpression(x) ||
      ts.isNonNullExpression(x)
    )
      x = x.expression;
    if (!ts.isIdentifier(x)) return false;
    const name = x.text;
    for (let f: ts.Node | undefined = x.parent; f; f = f.parent) {
      if (ts.isSourceFile(f)) return false;
      if (ts.isFunctionLike(f) || ts.isBlock(f)) {
        let declared = false;
        const look = (k: ts.Node): void => {
          if (declared || (k !== f && ts.isFunctionLike(k))) return;
          if (
            (ts.isVariableDeclaration(k) || ts.isParameter(k)) &&
            ts.isIdentifier(k.name) &&
            k.name.text === name
          )
            declared = true;
          k.forEachChild(look);
        };
        if (ts.isFunctionLike(f))
          for (const prm of f.parameters)
            if (ts.isIdentifier(prm.name) && prm.name.text === name)
              declared = true;
        f.forEachChild(look);
        if (declared) return true;
      }
    }
    return false;
  };
  const isFreshLiteral = (e: ts.Expression): boolean => {
    let x: ts.Expression = e;
    while (
      ts.isAsExpression(x) ||
      ts.isSatisfiesExpression(x) ||
      ts.isParenthesizedExpression(x)
    )
      x = x.expression;
    return ts.isObjectLiteralExpression(x) || ts.isArrayLiteralExpression(x);
  };
  const scanEval = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && imported.has(n.text)) {
      const p = n.parent;
      const isPropName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n);
      if (!isPropName)
        out.push(
          `L${line(n)}: references imported \`${n.text}\` at evaluation`,
        );
    }
    if (
      ts.isCallExpression(n) ||
      ts.isNewExpression(n) ||
      ts.isTaggedTemplateExpression(n)
    ) {
      const callee = ts.isTaggedTemplateExpression(n) ? n.tag : n.expression;
      const root = rootName(callee);
      const member =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression)
          ? callee.name.text
          : ts.isIdentifier(callee)
            ? ""
            : undefined;
      const allowed =
        root !== undefined &&
        member !== undefined &&
        SAFE_GLOBAL_MEMBERS.get(root)?.has(member);
      // Object.freeze mutates its argument: only a fresh literal (agy)
      const freezesLiteral =
        root === "Object" &&
        member === "freeze" &&
        ts.isCallExpression(n) &&
        n.arguments.length === 1 &&
        isFreshLiteral(n.arguments[0]!);
      if (
        !allowed ||
        (root === "Object" && member === "freeze" && !freezesLiteral)
      )
        out.push(
          `L${line(n)}: calls \`${callee.getText(sf).slice(0, 40)}\` at evaluation`,
        );
    }
    if (ts.isDecorator(n)) out.push(`L${line(n)}: decorator`);
    if (ts.isIdentifier(n) && HOST_GLOBALS.has(n.text)) {
      const p = n.parent;
      if (!(
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n)
      ))
        out.push(
          `L${line(n)}: references host global \`${n.text}\` at evaluation`,
        );
    }
    // writes: an assignment / delete / ++ whose target is not a local of a
    // function nested in the scanned code (agy: `(globalThis.x = true, 0)`)
    const writeTarget =
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ? n.left
        : ts.isDeleteExpression(n)
          ? n.expression
          : (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
              (n.operator === ts.SyntaxKind.PlusPlusToken ||
                n.operator === ts.SyntaxKind.MinusMinusToken)
            ? n.operand
            : undefined;
    if (writeTarget && !isNestedLocal(writeTarget))
      out.push(
        `L${line(n)}: writes \`${writeTarget.getText(sf).slice(0, 40)}\` at evaluation`,
      );
    n.forEachChild(scanEval);
  };
  for (const s of sf.statements) {
    if (
      ts.isImportDeclaration(s) ||
      ts.isFunctionDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      // only an ambient namespace is pure; a real one runs its body
      (ts.isModuleDeclaration(s) &&
        !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword))
    )
      continue;
    if (ts.isEnumDeclaration(s)) {
      for (const m of s.members) if (m.initializer) scanEval(m.initializer);
      continue;
    }
    if (ts.isExportDeclaration(s)) continue; // export { … } / export … from
    if (ts.isClassDeclaration(s)) {
      for (const h of s.heritageClauses ?? []) scanEval(h);
      for (const d of ts.getDecorators(s) ?? []) scanEval(d);
      for (const m of s.members) {
        if (ts.isClassStaticBlockDeclaration(m)) scanEval(m);
        if (
          ts.isPropertyDeclaration(m) &&
          (m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) ||
            ts.isComputedPropertyName(m.name))
        ) {
          if (m.initializer) scanEval(m.initializer);
          if (ts.isComputedPropertyName(m.name)) scanEval(m.name);
        }
      }
      continue;
    }
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        // binding patterns run code too: defaults and computed keys (agy)
        if (!ts.isIdentifier(d.name)) scanEval(d.name);
        if (d.initializer) scanEval(d.initializer);
      }
      continue;
    }
    if (ts.isExportAssignment(s)) {
      scanEval(s.expression);
      continue;
    }
    out.push(`L${line(s)}: top-level ${ts.SyntaxKind[s.kind]}`);
  }
  return out;
}

/** `mod` and every module it reaches through relative imports / re-exports
 * (package imports are other workspaces / node_modules: treated as already
 * loaded by the time matchTimeline's own imports run, which is how their
 * bare-import position never mattered before either). */
const closureCache = new Map<string, Set<string>>();
function closureOf(mod: string): Set<string> {
  const hit = closureCache.get(mod);
  if (hit) return hit;
  const seen = new Set<string>();
  const stack = [mod];
  while (stack.length) {
    const m = stack.pop()!;
    if (seen.has(m)) continue;
    seen.add(m);
    if (m.endsWith(".json")) continue;
    const s = ts.createSourceFile(
      m,
      fs.readFileSync(m, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    for (const st of s.statements) {
      const spec =
        (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) &&
        st.moduleSpecifier &&
        ts.isStringLiteral(st.moduleSpecifier)
          ? st.moduleSpecifier.text
          : undefined;
      // type-only imports are erased
      const typeOnly =
        (ts.isImportDeclaration(st) && st.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(st) && st.isTypeOnly);
      if (!spec || typeOnly || !spec.startsWith(".")) continue;
      const r =
        resolve(m, spec) ??
        (spec.endsWith(".json")
          ? path.resolve(path.dirname(m), spec)
          : undefined);
      if (r && fs.existsSync(r)) stack.push(r);
    }
  }
  closureCache.set(mod, seen);
  return seen;
}

const sf = ts.createSourceFile(
  file,
  fs.readFileSync(file, "utf8"),
  ts.ScriptTarget.ES2022,
  true,
);
let pure = 0;
let impure = 0;
for (const s of sf.statements) {
  if (!ts.isImportDeclaration(s) || s.importClause) continue;
  const spec = (s.moduleSpecifier as ts.StringLiteral).text;
  const target = spec.startsWith(".") ? resolve(file, spec) : undefined;
  if (!target) {
    console.log(`UNRESOLVED  ${spec}`);
    impure++;
    continue;
  }
  // the WHOLE relative import closure must be pure: dropping the bare import
  // of a pure module also moves the evaluation of everything it imports
  const why: string[] = [];
  for (const m of closureOf(target)) {
    const w = impurities(m);
    if (w.length)
      why.push(
        `${path.relative(path.dirname(file), m)} — ${w[0]}${w.length > 1 ? ` (+${w.length - 1})` : ""}`,
      );
  }
  if (why.length === 0) {
    console.log(`PURE        ${spec}`);
    pure++;
  } else {
    console.log(
      `IMPURE      ${spec}\n              ${why.slice(0, 4).join("\n              ")}${why.length > 4 ? `\n              (+${why.length - 4} more)` : ""}`,
    );
    impure++;
  }
}
console.log(`${pure} pure (bare import removable), ${impure} keep`);
