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
 * codex post-hoc review 2026-10-08 (GH #116 batch 11) closed five more holes,
 * each pinned in test/bareImportSideEffects.test.ts: computed names and
 * decorators on EVERY class member; EVERY property write at evaluation is
 * impure (a parameter, an alias or a fresh object's field may be
 * `Object.prototype` — only rebinding a lexically resolved nested local is
 * allowed); a standard global the module shadows loses its allowlist;
 * `./x.js` resolves to `x.ts` first and an unresolved relative dependency is
 * impure; a `throw` is impure unless its function is only defined (a variable
 * initializer or a function declaration).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/bareImportSideEffects.ts <file.ts>
 */
import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";

const resolve = (from: string, spec: string): string | undefined => {
  const base = path.resolve(path.dirname(from), spec);
  // TypeScript's extension substitution: `./x.js` names `x.ts`, and the
  // compiler prefers the TS source over a sibling `.js` (codex)
  const sub = base.replace(/\.(m?)js$/, ".$1ts");
  for (const c of [
    ...(sub !== base ? [sub, sub.replace(/ts$/, "tsx")] : []),
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

/** an identifier in VALUE position (not a property / member / declaration
 * name, a label, an import / export specifier) */
function isValueRef(n: ts.Identifier): boolean {
  const p = n.parent;
  if (
    (ts.isPropertyAccessExpression(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isEnumMember(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p) ||
      ts.isEnumDeclaration(p)) &&
    p.name === n
  )
    return false;
  if (ts.isBindingElement(p) && (p.name === n || p.propertyName === n))
    return false;
  if (
    ts.isLabeledStatement(p) ||
    ts.isBreakStatement(p) ||
    ts.isContinueStatement(p) ||
    ts.isImportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    ts.isExportSpecifier(p) ||
    ts.isMetaProperty(p)
  )
    return false;
  return true;
}

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
  // every name the module declares anywhere: a standard global it shadows
  // (`function Number() {…}`) is not that global (codex)
  const declaredNames = new Set<string>();
  const collectNames = (k: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(k) ||
        ts.isParameter(k) ||
        ts.isBindingElement(k) ||
        ts.isFunctionDeclaration(k) ||
        ts.isFunctionExpression(k) ||
        ts.isClassDeclaration(k) ||
        ts.isClassExpression(k) ||
        ts.isEnumDeclaration(k) ||
        ts.isImportSpecifier(k) ||
        ts.isNamespaceImport(k) ||
        ts.isImportClause(k)) &&
      k.name &&
      ts.isIdentifier(k.name)
    )
      declaredNames.add(k.name.text);
    k.forEachChild(collectNames);
  };
  collectNames(sf);
  const unwrap = (e: ts.Expression): ts.Expression => {
    let x: ts.Expression = e;
    while (
      ts.isAsExpression(x) ||
      ts.isSatisfiesExpression(x) ||
      ts.isParenthesizedExpression(x) ||
      ts.isNonNullExpression(x)
    )
      x = x.expression;
    return x;
  };
  const bindingNames = (b: ts.BindingName, into: Set<string>): void => {
    if (ts.isIdentifier(b)) into.add(b.text);
    else
      for (const e of b.elements)
        if (!ts.isOmittedExpression(e)) bindingNames(e.name, into);
  };
  // `var`s anywhere in a function body, not inside nested functions (hoisting)
  const hoistedVars = (body: ts.Node, into: Set<string>): void => {
    const look = (k: ts.Node): void => {
      if (ts.isFunctionLike(k) || ts.isClassLike(k)) return;
      if (
        ts.isVariableDeclarationList(k) &&
        !(k.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))
      )
        for (const d of k.declarations) bindingNames(d.name, into);
      k.forEachChild(look);
    };
    body.forEachChild(look);
  };
  // the names a scope node declares ITSELF (lexical resolution, not a
  // name search across subtrees — codex: a destructured parameter shadowing
  // an outer fresh local, an unrelated inner block's declaration)
  const scopeNames = (s: ts.Node): Set<string> => {
    const names = new Set<string>();
    if (ts.isFunctionLike(s)) {
      for (const p of s.parameters) bindingNames(p.name, names);
      if ((ts.isFunctionExpression(s) || ts.isFunctionDeclaration(s)) && s.name)
        names.add(s.name.text);
      const body = (s as { body?: ts.Node }).body;
      if (body) hoistedVars(body, names);
    }
    if (ts.isBlock(s) || ts.isCaseClause(s) || ts.isDefaultClause(s))
      for (const st of s.statements) {
        if (ts.isVariableStatement(st))
          for (const d of st.declarationList.declarations)
            bindingNames(d.name, names);
        if (
          (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
          st.name
        )
          names.add(st.name.text);
      }
    if (
      (ts.isForStatement(s) ||
        ts.isForOfStatement(s) ||
        ts.isForInStatement(s)) &&
      s.initializer &&
      ts.isVariableDeclarationList(s.initializer)
    )
      for (const d of s.initializer.declarations) bindingNames(d.name, names);
    if (ts.isCatchClause(s) && s.variableDeclaration)
      bindingNames(s.variableDeclaration.name, names);
    return names;
  };
  // the identifier resolves to a binding of a scope nested in the
  // evaluation-time code, not to a module-level or global one
  const isNestedLocalBinding = (x: ts.Identifier): boolean => {
    for (let s: ts.Node | undefined = x.parent; s; s = s.parent) {
      if (ts.isSourceFile(s)) return false;
      if (scopeNames(s).has(x.text)) return true;
    }
    return false;
  };
  const isFreshLiteral = (e: ts.Expression): boolean => {
    const x = unwrap(e);
    return ts.isObjectLiteralExpression(x) || ts.isArrayLiteralExpression(x);
  };
  // writing `t` cannot reach outside only when it REBINDS a nested local
  // (variable or parameter). Every property write is impure: proving the
  // receiving object is unshared needs alias analysis this tool does not do
  // (codex 2026-10-08: a parameter, an alias, a fresh object's shared field).
  const isLocalWrite = (t: ts.Expression): boolean => {
    const x = unwrap(t);
    return ts.isIdentifier(x) && isNestedLocalBinding(x);
  };
  // the module's own top-level names (its functions, classes, consts, enums,
  // imports): referencing one is not a reference to a global
  const moduleNames = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        bindingNames(d.name, moduleNames);
    if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      st.name
    )
      moduleNames.add(st.name.text);
    if (ts.isImportDeclaration(st) && st.importClause) {
      const c = st.importClause;
      if (c.name) moduleNames.add(c.name.text);
      if (c.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings))
          moduleNames.add(c.namedBindings.name.text);
        else
          for (const e of c.namedBindings.elements)
            moduleNames.add(e.name.text);
      }
    }
  }
  // the only globals evaluation-time code may NAME: the allowlisted standard
  // ones (an unlisted one — `eval`, `setTimeout` — can run code when merely
  // handed to an allowed call, agy 2026-10-08)
  const SAFE_VALUE_GLOBALS = new Set([
    ...SAFE_GLOBAL_MEMBERS.keys(),
    "undefined",
    "NaN",
    "Infinity",
    "arguments",
  ]);
  const scanEval = (n: ts.Node): void => {
    // types are erased — but `extends X` is an expression
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;
    if (ts.isHeritageClause(n) && n.token === ts.SyntaxKind.ImplementsKeyword)
      return;
    if (
      ts.isIdentifier(n) &&
      isValueRef(n) &&
      !moduleNames.has(n.text) &&
      !isNestedLocalBinding(n) &&
      !SAFE_VALUE_GLOBALS.has(n.text)
    )
      out.push(`L${line(n)}: references global \`${n.text}\` at evaluation`);
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
        !declaredNames.has(root) &&
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
    if (writeTarget && !isLocalWrite(writeTarget))
      out.push(
        `L${line(n)}: writes \`${writeTarget.getText(sf).slice(0, 40)}\` at evaluation`,
      );
    // any throw: whether its function runs now (a callback, a coercion hook,
    // an iterator a constructor drives) is not decided here (agy / codex)
    if (ts.isThrowStatement(n)) out.push(`L${line(n)}: throws`);
    n.forEachChild(scanEval);
  };
  const scanTop = scanEval;
  for (const s of sf.statements) {
    // a declared function or class is scanned WHOLE — bodies and methods
    // included: an allowed call (`Array.from(xs, f)`), a coercion hook
    // (`valueOf: f`) or an iterator can run it now (agy 2026-10-08)
    if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) {
      scanTop(s);
      continue;
    }
    if (
      ts.isImportDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      // only an ambient namespace is pure; a real one runs its body
      (ts.isModuleDeclaration(s) &&
        !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword))
    )
      continue;
    if (ts.isEnumDeclaration(s)) {
      for (const m of s.members) if (m.initializer) scanTop(m.initializer);
      continue;
    }
    if (ts.isExportDeclaration(s)) continue; // export { … } / export … from
    if (ts.isClassDeclaration(s)) {
      for (const h of s.heritageClauses ?? []) scanTop(h);
      // any decorator anywhere in the class — on the class, a member or a
      // parameter — runs at class definition (codex: member decorators)
      const findDecorators = (k: ts.Node): void => {
        if (ts.isDecorator(k)) out.push(`L${line(k)}: decorator`);
        k.forEachChild(findDecorators);
      };
      findDecorators(s);
      for (const m of s.members) {
        if (ts.isClassStaticBlockDeclaration(m)) scanTop(m);
        // a computed member name is evaluated at definition for EVERY member
        // kind — methods and accessors too (codex)
        if (m.name && ts.isComputedPropertyName(m.name)) scanTop(m.name);
        if (
          ts.isPropertyDeclaration(m) &&
          m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) &&
          m.initializer
        )
          scanTop(m.initializer);
      }
      continue;
    }
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        // binding patterns run code too: defaults and computed keys (agy)
        if (!ts.isIdentifier(d.name)) scanTop(d.name);
        if (d.initializer) scanTop(d.initializer);
      }
      continue;
    }
    if (ts.isExportAssignment(s)) {
      scanTop(s.expression);
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
/** relative runtime dependencies the resolver could not find, by importer —
 * an unseen module may do anything, so its importer counts as impure (codex) */
const unresolvedDeps = new Map<string, string[]>();
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
      else {
        const u = unresolvedDeps.get(m) ?? [];
        u.push(spec);
        unresolvedDeps.set(m, u);
      }
    }
  }
  closureCache.set(mod, seen);
  return seen;
}

/** The relative runtime dependencies of a module, in the order its import /
 * export-from statements run them — modelling the bundler's elision (no
 * `verbatimModuleSyntax` in this repo, so esbuild drops an import none of
 * whose bindings is used as a value): `import type`, an import whose
 * specifiers are all `type`, and an import whose bindings appear only in
 * types or not at all evaluate nothing. Bare imports and `export … from`
 * always run. `undefined` entry = an unresolved relative dependency. */
function runtimeDeps(mod: string, text: string): (string | undefined)[] {
  const s = ts.createSourceFile(mod, text, ts.ScriptTarget.ES2022, true);
  const used = new Set<string>();
  const walk = (k: ts.Node): void => {
    if (ts.isImportDeclaration(k)) return;
    if (ts.isTypeNode(k) && !ts.isExpressionWithTypeArguments(k)) return;
    if (ts.isHeritageClause(k) && k.token === ts.SyntaxKind.ImplementsKeyword)
      return;
    if (ts.isInterfaceDeclaration(k) || ts.isTypeAliasDeclaration(k)) return;
    // erased whole (agy): ambient `declare …`, `abstract` members, overload
    // signatures (a function / method without a body), type parameters,
    // `export as namespace X`
    if (
      ts.canHaveModifiers(k) &&
      ts
        .getModifiers(k)
        ?.some(
          (m) =>
            m.kind === ts.SyntaxKind.DeclareKeyword ||
            (m.kind === ts.SyntaxKind.AbstractKeyword && !ts.isClassLike(k)),
        )
    )
      return;
    if (
      (ts.isMethodDeclaration(k) ||
        ts.isFunctionDeclaration(k) ||
        ts.isConstructorDeclaration(k)) &&
      !k.body
    )
      return;
    if (ts.isTypeParameterDeclaration(k) || ts.isNamespaceExportDeclaration(k))
      return;
    if (ts.isIdentifier(k) && isValueRef(k)) used.add(k.text);
    // `export { a }` re-exports a local binding: a value use — unless it is
    // `export type { a }` / `export { type a }` (agy)
    if (
      ts.isExportSpecifier(k) &&
      !k.parent.parent.moduleSpecifier &&
      !k.isTypeOnly &&
      !k.parent.parent.isTypeOnly
    )
      used.add((k.propertyName ?? k.name).text);
    k.forEachChild(walk);
  };
  walk(s);
  const out: (string | undefined)[] = [];
  for (const st of s.statements) {
    let spec: string | undefined;
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause;
      if (c) {
        if (c.isTypeOnly) continue;
        const names: string[] = [];
        if (c.name) names.push(c.name.text);
        if (c.namedBindings) {
          if (ts.isNamespaceImport(c.namedBindings))
            names.push(c.namedBindings.name.text);
          else
            for (const e of c.namedBindings.elements)
              if (!e.isTypeOnly) names.push(e.name.text);
        }
        if (!names.some((n) => used.has(n))) continue; // elided
      }
      spec = st.moduleSpecifier.text;
    } else if (
      ts.isExportDeclaration(st) &&
      !st.isTypeOnly &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      if (
        st.exportClause &&
        ts.isNamedExports(st.exportClause) &&
        st.exportClause.elements.every((e) => e.isTypeOnly)
      )
        continue;
      spec = st.moduleSpecifier.text;
    }
    if (!spec || !spec.startsWith(".")) continue;
    out.push(
      resolve(mod, spec) ??
        (spec.endsWith(".json")
          ? path.resolve(path.dirname(mod), spec)
          : undefined),
    );
  }
  return out;
}

/** ESM evaluation order from `entry` (depth-first, a module after its
 * dependencies, each once), `entryText` overriding the entry file's source.
 * Package imports are outside the walk, as in `closureOf`. */
export function evaluationOrder(entry: string, entryText?: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (m: string, text?: string): void => {
    if (seen.has(m)) return;
    seen.add(m);
    // an unresolved dependency is a leaf: it still holds its place in the order
    if (!m.endsWith(".json") && !m.startsWith("<unresolved"))
      for (const d of runtimeDeps(m, text ?? fs.readFileSync(m, "utf8")))
        visit(d ?? `<unresolved from ${m}>`);
    order.push(m);
  };
  visit(entry, entryText);
  return order;
}

export interface BareImportVerdict {
  spec: string;
  pure: boolean;
  /** one line per impure module of the closure (empty when pure) */
  why: string[];
  /** deleting this one bare import leaves the evaluation order from the file
   * exactly as it is — the module and its closure are evaluated earlier
   * through another import anyway. A removal that changes nothing is safe
   * whether or not the module is pure. */
  orderUnchanged: boolean;
}

/** The verdict for every bare `import "…";` in `file`. */
export function analyzeBareImports(file: string): BareImportVerdict[] {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
  const out: BareImportVerdict[] = [];
  const text = sf.getFullText();
  const baseOrder = evaluationOrder(file, text).join("\n");
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || s.importClause) continue;
    const spec = (s.moduleSpecifier as ts.StringLiteral).text;
    const without = text.slice(0, s.getFullStart()) + text.slice(s.getEnd());
    const orderUnchanged =
      evaluationOrder(file, without).join("\n") === baseOrder;
    const target = spec.startsWith(".") ? resolve(file, spec) : undefined;
    if (!target) {
      out.push({ spec, pure: false, why: ["unresolved"], orderUnchanged });
      continue;
    }
    // the WHOLE relative import closure must be pure: dropping the bare import
    // of a pure module also moves the evaluation of everything it imports
    const why: string[] = [];
    for (const m of closureOf(target)) {
      const w = [
        ...impurities(m),
        ...(unresolvedDeps.get(m) ?? []).map(
          (u) => `unresolved runtime import \`${u}\``,
        ),
      ];
      if (w.length)
        why.push(
          `${path.relative(path.dirname(file), m)} — ${w[0]}${w.length > 1 ? ` (+${w.length - 1})` : ""}`,
        );
    }
    out.push({ spec, pure: why.length === 0, why, orderUnchanged });
  }
  return out;
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
) {
  const file = path.resolve(process.argv[2] ?? "");
  if (!fs.existsSync(file)) {
    console.error("usage: bareImportSideEffects.ts <file.ts>");
    process.exit(2);
  }
  const verdicts = analyzeBareImports(file);
  for (const v of verdicts)
    console.log(
      v.orderUnchanged
        ? `ORDER-SAME  ${v.spec}`
        : v.pure
          ? `PURE        ${v.spec}`
          : `KEEP        ${v.spec}\n              ${v.why.slice(0, 4).join("\n              ")}${v.why.length > 4 ? `\n              (+${v.why.length - 4} more)` : ""}`,
    );
  const removable = verdicts.filter((v) => v.orderUnchanged || v.pure).length;
  console.log(
    `${removable} removable (evaluation order unchanged, or the closure is pure), ${verdicts.length - removable} keep`,
  );
}
