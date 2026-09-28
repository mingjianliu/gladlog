/**
 * closureBindings.ts — what a line range inside a big function needs from the
 * function around it, and whether a moved copy of the code is the same code
 * (GH #116: splitting buildMatchTimeline into per-section emitters with
 * byte-identical output). Refactor tooling for `closureBindingAudit.ts`,
 * `extractTimelineSection.ts` and `extractedBodyCheck.ts`; nothing here feeds
 * production.
 *
 * History (codex astra reviews, 2026-09-27): the first audit found writes with
 * a regex for `name =` and missed `silenceLineCount++`; the second looked only
 * at an identifier's immediate parent and missed destructuring assignment
 * (`[a, b] = …`, `({ a } = …)`, `({ x: a } = …)`), loop targets
 * (`for (a of …)`) and member mutation (`obj.x++`, `obj.nested.push(1)`); the
 * first body check squashed whitespace INSIDE string / template literals and
 * accepted `[YOU] [HEALS]` → `[YOU][HEALS]`. Each is a case in
 * test/closureBindings.test.ts.
 */
import ts from "typescript";

export type UseClass = "WRITE" | "MEMBER-MUTATE" | "CALL" | "READ" | "TYPE";

export interface OuterBinding {
  name: string;
  declLine: number;
  classes: Set<UseClass>;
  lines: number[];
  /** lines where a nested function (a closure of the enclosing function)
   * references this binding — outside the range (it could run during the
   * range and observe the binding mid-update) or inside it (a closure created
   * in the range can escape it and would capture a moved copy's local, which
   * stops tracking the caller's binding: codex review 2026-09-27) */
  closureRefs: number[];
}

export interface ImportUse {
  /** `name` or `imported as local`, with whether every use is type-only */
  names: Map<string, boolean>;
  defaultName?: string;
  namespaceName?: string;
}

export interface RangeAnalysis {
  /** bindings declared in the function but outside the range, used in it */
  outer: OuterBinding[];
  /** declared inside the range and referenced after it (inside the function) */
  declaredInsideUsedAfter: Array<{ name: string; declLine: number }>;
  /** module-scope declarations of the same file (not imports) used in the range */
  moduleLocal: Array<{ name: string; declLine: number }>;
  /** `return`s in the range that return from the enclosing function itself */
  escapingReturns: number[];
  /** imports of the file used in the range, keyed by module specifier */
  imports: Map<string, ImportUse>;
}

const MUTATORS = new Set([
  "add",
  "push",
  "set",
  "delete",
  "clear",
  "splice",
  "sort",
  "unshift",
  "pop",
  "shift",
  "fill",
  "reverse",
  "copyWithin",
]);

const isAssignOp = (k: ts.SyntaxKind) =>
  k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;

/** Wrappers that do not change what is written: `(x)`, `x!`, `x as T`,
 * `<T>x`, `x satisfies T`. */
const isTransparent = (n: ts.Node) =>
  ts.isParenthesizedExpression(n) ||
  ts.isNonNullExpression(n) ||
  ts.isAsExpression(n) ||
  ts.isTypeAssertionExpression(n) ||
  ts.isSatisfiesExpression(n);

/** Is `node` (an identifier, or the top of an access chain) something that is
 * written: the left side of an assignment — also nested inside a destructuring
 * pattern — the operand of `++` / `--`, or a `for … of / in` target? */
export function isAssignmentTarget(node: ts.Node): boolean {
  let n: ts.Node = node;
  for (;;) {
    const p = n.parent;
    if (!p) return false;
    if (isTransparent(p)) {
      n = p;
      continue;
    }
    if (
      (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
      (p.operator === ts.SyntaxKind.PlusPlusToken ||
        p.operator === ts.SyntaxKind.MinusMinusToken)
    )
      return true;
    if (
      (ts.isForOfStatement(p) || ts.isForInStatement(p)) &&
      p.initializer === n
    )
      return true;
    // the left side of ANY assignment is written — a destructuring default
    // (`[a = 5] = []`) and an assignment inside an ordinary literal
    // (`const v = [a = 5]`, `{ value: a = 5 }`) alike
    if (ts.isBinaryExpression(p))
      return p.left === n && isAssignOp(p.operatorToken.kind);
    // climb out of a destructuring pattern; whether it IS one is decided by
    // reaching the left side of an assignment / a loop target above
    if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
      n = p;
      continue;
    }
    if (ts.isPropertyAssignment(p) && p.initializer === n) {
      n = p;
      continue;
    }
    if (ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) {
      n = p;
      continue;
    }
    if (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p)) {
      n = p;
      continue;
    }
    return false;
  }
}

/** Is `id` the root object of something mutated: `id.x = …`, `id[k]++`,
 * `delete id.x`, `id.list.push(…)`? (Mutation through a returned reference —
 * `id.get(k).push(v)` — reads as READ; harmless for extraction, since objects
 * are passed by reference.) */
export function isMemberMutation(id: ts.Identifier): boolean {
  let n: ts.Node = id;
  while (
    n.parent &&
    ((ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) ||
      (ts.isElementAccessExpression(n.parent) && n.parent.expression === n) ||
      isTransparent(n.parent))
  )
    n = n.parent;
  if (n === id) return false;
  if (isAssignmentTarget(n)) return true;
  if (ts.isDeleteExpression(n.parent)) return true;
  return (
    ts.isPropertyAccessExpression(n) &&
    MUTATORS.has(n.name.text) &&
    ts.isCallExpression(n.parent) &&
    n.parent.expression === n
  );
}

/** A name, not a reference (property names, declaration names, keys). */
function isNameNotReference(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    (ts.isQualifiedName(p) && p.right === id) ||
    ((ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isBindingElement(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isImportSpecifier(p) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p)) &&
      p.name === id) ||
    (ts.isBindingElement(p) && p.propertyName === id)
  );
}

function isTypePosition(id: ts.Identifier): boolean {
  for (let n: ts.Node = id; n.parent; n = n.parent) {
    if (ts.isTypeNode(n.parent) && !ts.isExpressionWithTypeArguments(n.parent))
      return true;
    if (ts.isExpression(n.parent) || ts.isStatement(n.parent)) return false;
  }
  return false;
}

export function classifyUse(id: ts.Identifier): UseClass {
  if (isTypePosition(id)) return "TYPE";
  if (isAssignmentTarget(id)) return "WRITE";
  if (isMemberMutation(id)) return "MEMBER-MUTATE";
  if (ts.isCallExpression(id.parent) && id.parent.expression === id)
    return "CALL";
  return "READ";
}

/** A checker-backed program over one file (imports unresolved — only the
 * file's own scopes matter). `text` overrides the file's content (tests). */
export function programFor(
  fileName: string,
  text?: string,
): { sf: ts.SourceFile; checker: ts.TypeChecker } {
  const options: ts.CompilerOptions = {
    noResolve: true,
    noEmit: true,
    noLib: text !== undefined,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(options);
  if (text !== undefined) {
    const orig = host.getSourceFile.bind(host);
    host.getSourceFile = (f, lang, ...rest) =>
      f === fileName
        ? ts.createSourceFile(f, text, lang, true)
        : orig(f, lang, ...rest);
    host.fileExists = (f) => f === fileName || ts.sys.fileExists(f);
    host.readFile = (f) => (f === fileName ? text : ts.sys.readFile(f));
  }
  const program = ts.createProgram([fileName], options, host);
  const sf = program.getSourceFile(fileName);
  if (!sf) throw new Error(`cannot load ${fileName}`);
  return { sf, checker: program.getTypeChecker() };
}

export function findFunction(
  sf: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration {
  let fn: ts.FunctionDeclaration | undefined;
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) fn = n;
  });
  if (!fn?.body) throw new Error(`function ${name} not found`);
  return fn;
}

/** Analyse lines [startLine, endLine] (1-based, inclusive) inside `fn`. */
export function analyzeRange(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  fn: ts.FunctionDeclaration,
  startLine: number,
  endLine: number,
): RangeAnalysis {
  const body = fn.body!;
  const lineOf = (pos: number) =>
    sf.getLineAndCharacterOfPosition(pos).line + 1;
  const rStart = sf.getPositionOfLineAndCharacter(startLine - 1, 0);
  const rEnd =
    endLine >= sf.getLineStarts().length
      ? sf.end
      : sf.getPositionOfLineAndCharacter(endLine, 0);
  const inRange = (p: number) => p >= rStart && p < rEnd;
  const inBody = (p: number) => p >= body.pos && p < body.end;
  const inFn = (p: number) => p >= fn.pos && p < fn.end;
  // parameters are the function's bindings too (`params.ccBreakEvents`)
  const inParams = (p: number) =>
    p >= fn.parameters.pos && p < fn.parameters.end;

  const outer = new Map<ts.Symbol, OuterBinding>();
  const usedAfter = new Map<ts.Symbol, { name: string; declLine: number }>();
  const moduleLocal = new Map<ts.Symbol, { name: string; declLine: number }>();
  const escapingReturns: number[] = [];
  const imports = new Map<string, ImportUse>();

  const nearestFunction = (n: ts.Node) => {
    for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p;
    return undefined;
  };
  const symbolFor = (id: ts.Identifier) =>
    ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
      ? checker.getShorthandAssignmentValueSymbol(id.parent)
      : checker.getSymbolAtLocation(id);

  const visit = (n: ts.Node): void => {
    if (
      ts.isReturnStatement(n) &&
      inRange(n.getStart(sf)) &&
      nearestFunction(n) === fn
    )
      escapingReturns.push(lineOf(n.getStart(sf)));
    if (ts.isIdentifier(n) && !isNameNotReference(n)) {
      const sym = symbolFor(n);
      const decl = sym?.declarations?.[0];
      if (sym && decl && decl.getSourceFile() === sf) {
        const dp = decl.getStart(sf);
        const pos = n.getStart(sf);
        if (inRange(pos) && (inBody(dp) || inParams(dp)) && !inRange(dp)) {
          let u = outer.get(sym);
          if (!u) {
            u = {
              name: n.text,
              declLine: lineOf(dp),
              classes: new Set(),
              lines: [],
              closureRefs: [],
            };
            outer.set(sym, u);
          }
          u.classes.add(classifyUse(n));
          const l = lineOf(pos);
          if (!u.lines.includes(l)) u.lines.push(l);
        }
        if (inRange(dp) && pos >= rEnd && inBody(pos))
          usedAfter.set(sym, { name: n.text, declLine: lineOf(dp) });
        if (inRange(pos) && !inBody(dp)) {
          if (
            ts.isImportSpecifier(decl) ||
            ts.isImportClause(decl) ||
            ts.isNamespaceImport(decl)
          ) {
            const importDecl = ts.findAncestor(decl, ts.isImportDeclaration)!;
            const spec = (importDecl.moduleSpecifier as ts.StringLiteral).text;
            let e = imports.get(spec);
            if (!e) imports.set(spec, (e = { names: new Map() }));
            if (ts.isImportSpecifier(decl)) {
              const key = decl.propertyName
                ? `${decl.propertyName.text} as ${decl.name.text}`
                : decl.name.text;
              const typeOnly =
                !!importDecl.importClause?.isTypeOnly ||
                decl.isTypeOnly ||
                isTypePosition(n);
              const prev = e.names.get(key);
              e.names.set(key, prev === false ? false : typeOnly);
            } else if (ts.isImportClause(decl)) e.defaultName = decl.name!.text;
            else e.namespaceName = decl.name.text;
          } else if (!inFn(dp)) {
            moduleLocal.set(sym, { name: n.text, declLine: lineOf(dp) });
          }
        }
      }
    }
    n.forEachChild(visit);
  };
  sf.forEachChild(visit);

  // second pass: references to the outer bindings from any nested function of
  // the enclosing function, inside the range or out
  const closureScan = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && !isNameNotReference(n)) {
      const pos = n.getStart(sf);
      const sym = symbolFor(n);
      const u = sym ? outer.get(sym) : undefined;
      if (u && inFn(pos) && nearestFunction(n) !== fn) {
        const l = lineOf(pos);
        if (!u.closureRefs.includes(l)) u.closureRefs.push(l);
      }
    }
    n.forEachChild(closureScan);
  };
  fn.forEachChild(closureScan);

  return {
    outer: [...outer.values()],
    declaredInsideUsedAfter: [...usedAfter.values()],
    moduleLocal: [...moduleLocal.values()],
    escapingReturns,
    imports,
  };
}

// ── moved-code equivalence ───────────────────────────────────────────────────

const TEXT_LEAVES = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);
const DECL_FLAGS =
  ts.NodeFlags.Let |
  ts.NodeFlags.Const |
  ts.NodeFlags.Using |
  ts.NodeFlags.AwaitUsing;

export interface Equivalence {
  equal: boolean;
  /** first differing node, as `line: text` on each side */
  diff?: { a: string; b: string };
}

/** Are two statement lists the same code? Compared as syntax trees: every
 * node kind, every operator, let/const, and the exact source text of every
 * identifier and literal (string / template / regex / number contents are
 * byte-compared). Formatting, comments and trailing commas are ignored. */
export function sameStatements(aText: string, bText: string): Equivalence {
  const parse = (t: string) =>
    ts.createSourceFile(
      "x.ts",
      `function __moved() {\n${t}\n}`,
      ts.ScriptTarget.ES2022,
      true,
    );
  const sa = parse(aText);
  const sb = parse(bText);
  const describe = (sf: ts.SourceFile, n: ts.Node) =>
    `${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line}: ${n.getText(sf).slice(0, 120)}`;
  const children = (n: ts.Node) => {
    const out: ts.Node[] = [];
    n.forEachChild((c) => {
      out.push(c);
    });
    return out;
  };
  const cmp = (a: ts.Node, b: ts.Node): Equivalence => {
    const bad = (): Equivalence => ({
      equal: false,
      diff: { a: describe(sa, a), b: describe(sb, b) },
    });
    if (a.kind !== b.kind) return bad();
    if (TEXT_LEAVES.has(a.kind) && a.getText(sa) !== b.getText(sb))
      return bad();
    const ao = (a as { operator?: unknown }).operator;
    const bo = (b as { operator?: unknown }).operator;
    if (ao !== bo) return bad();
    if ((a.flags & DECL_FLAGS) !== (b.flags & DECL_FLAGS)) return bad();
    const ca = children(a);
    const cb = children(b);
    if (ca.length !== cb.length) return bad();
    for (let i = 0; i < ca.length; i++) {
      const r = cmp(ca[i]!, cb[i]!);
      if (!r.equal) return r;
    }
    return { equal: true };
  };
  return cmp(sa, sb);
}

// ── imports left unused by a cut ─────────────────────────────────────────────

/** Remove the import bindings named in `candidates` that `text` no longer
 * references (a cut moved their only uses away). Only candidates are touched,
 * so an import that was already unused stays as it was. A specifier is removed
 * with its comma; an import left with no bindings becomes a bare
 * `import "…";` (a type-only one is deleted); a multi-line named list left
 * with one name is joined onto one line when the declaration then fits in 80
 * columns (prettier's shape). */
export function pruneImports(
  fileName: string,
  text: string,
  candidates: ReadonlySet<string>,
): { text: string; removed: string[] } {
  const { sf, checker } = programFor(fileName, text);
  const refCount = new Map<ts.Symbol, number>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && !ts.findAncestor(n, ts.isImportDeclaration)) {
      // `export { imported }` re-exports the import: resolve the specifier to
      // its LOCAL target, or the import looks unused (batch 4's first run
      // pruned PEAK_SPIKE_MARKERS / peakSpikePlacement this way)
      const sym =
        ts.isExportSpecifier(n.parent) &&
        !n.parent.parent.parent.moduleSpecifier &&
        (n.parent.propertyName ?? n.parent.name) === n
          ? checker.getExportSpecifierLocalTargetSymbol(n.parent)
          : ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n
            ? checker.getShorthandAssignmentValueSymbol(n.parent)
            : checker.getSymbolAtLocation(n);
      if (sym) refCount.set(sym, (refCount.get(sym) ?? 0) + 1);
    }
    n.forEachChild(visit);
  };
  sf.forEachChild(visit);
  const unused = (name: ts.Identifier) => {
    if (!candidates.has(name.text)) return false;
    const sym = checker.getSymbolAtLocation(name);
    return !sym || !refCount.get(sym);
  };

  const edits: Array<{ start: number; end: number; insert: string }> = [];
  const removed: string[] = [];
  for (const decl of sf.statements.filter(ts.isImportDeclaration)) {
    const clause = decl.importClause;
    if (!clause) continue;
    const named =
      clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings
        : undefined;
    const ns =
      clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)
        ? clause.namedBindings
        : undefined;
    const dropDefault = !!clause.name && unused(clause.name);
    const dropNs = !!ns && unused(ns.name);
    const elements = named ? [...named.elements] : [];
    const keep = elements.filter((e) => !unused(e.name));
    const dropped = elements.filter((e) => unused(e.name));
    if (!dropDefault && !dropNs && dropped.length === 0) continue;
    removed.push(
      ...(dropDefault ? [clause.name!.text] : []),
      ...(dropNs ? [ns!.name.text] : []),
      ...dropped.map((e) => e.name.text),
    );
    const keepsDefault = !!clause.name && !dropDefault;
    const keepsNs = !!ns && !dropNs;
    if (!keepsDefault && !keepsNs && keep.length === 0) {
      // Nothing left to bind. A type-only declaration is erased at runtime:
      // delete it with its line. A value import still LOADS its module here,
      // and module initialisation order can matter (codex 2026-09-28: deleting
      // one moved a registration after its consumer, true -> false) — keep a
      // bare `import "…";` in its place.
      const typeOnly =
        clause.isTypeOnly ||
        (!clause.name && !ns && elements.every((e) => e.isTypeOnly));
      if (typeOnly) {
        let end = decl.getEnd();
        if (text[end] === "\n") end++;
        edits.push({ start: decl.getStart(sf), end, insert: "" });
      } else {
        // everything after the specifier is kept verbatim — import attributes
        // (`with { type: "json" }`) are required to load the module (codex:
        // dropping them throws ERR_IMPORT_ATTRIBUTE_MISSING)
        const afterSpecifier = text.slice(
          decl.moduleSpecifier.getEnd(),
          decl.getEnd(),
        );
        edits.push({
          start: decl.getStart(sf),
          end: decl.getEnd(),
          insert: `import ${decl.moduleSpecifier.getText(sf)}${afterSpecifier}`,
        });
      }
      continue;
    }
    if (dropDefault || dropNs)
      throw new Error(
        `pruneImports: partial default/namespace removal not supported (${decl.getText(sf)})`,
      );
    const multiLine = named!.getText(sf).includes("\n");
    if (multiLine && keep.length === 1) {
      // join onto one line by rewriting ONLY the `{ … }` span — the default
      // binding, `type` keyword and specifier stay as they are (codex: the
      // first version rebuilt the whole declaration and dropped `def,`)
      const oneList = `{ ${keep[0]!.getText(sf)} }`;
      const declStart = decl.getStart(sf);
      const declText = decl.getText(sf);
      const joined =
        declText.slice(0, named!.getStart(sf) - declStart) +
        oneList +
        declText.slice(named!.getEnd() - declStart);
      if (!joined.includes("\n") && joined.length <= 80) {
        edits.push({
          start: named!.getStart(sf),
          end: named!.getEnd(),
          insert: oneList,
        });
        continue;
      }
    }
    // rebuild the `{ … }` list from the kept names, in the list's own layout
    let rebuilt: string;
    if (multiLine) {
      // indentation from whitespace only (codex: an element sharing the `{`
      // line made the "indent" `import { ` and injected code into the list)
      const indentOf = (e: ts.ImportSpecifier) => {
        const lineStart = text.lastIndexOf("\n", e.getStart(sf)) + 1;
        const pre = text.slice(lineStart, e.getStart(sf));
        return /^[ \t]*$/.test(pre) ? pre : undefined;
      };
      const indent =
        elements.map(indentOf).find((x) => x !== undefined) ?? "  ";
      rebuilt = `{\n${keep.map((e) => `${indent}${e.getText(sf)},`).join("\n")}\n}`;
    } else {
      rebuilt = `{ ${keep.map((e) => e.getText(sf)).join(", ")} }`;
    }
    edits.push({
      start: named!.getStart(sf),
      end: named!.getEnd(),
      insert: rebuilt,
    });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits)
    out = out.slice(0, e.start) + e.insert + out.slice(e.end);
  return { text: out, removed };
}
