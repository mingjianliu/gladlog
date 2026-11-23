// §6.9 check 1: no hard-coded CJK text in desktop source. Every user-visible
// string goes through the dictionary (src/shared/i18n/); the only exceptions
// are the permanent ones in CJK_ALLOWLIST (one reason each). The migration's
// pending-file list is gone: every file is migrated (Task 7).
//
// CJK_ALLOWLIST is shrink-only (§6.9 只允许减少), enforced mechanically: every
// entry must appear in FROZEN_CJK_ALLOWLIST, whose sorted
// `file + "\u0000" + snippet` list is pinned by a sha256 below. Removing an
// entry passes; adding one fails until someone appends it to the frozen list
// and updates the hash on purpose.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { CJK_ALLOWLIST, FROZEN_CJK_ALLOWLIST } from "./i18n.cjkAllowlist";

const REPO_ROOT = join(__dirname, "../../..");
const DESKTOP_SRC = "packages/desktop/src";
const SCAN_ROOTS = ["renderer", "main", "shared"].map(
  (d) => `${DESKTOP_SRC}/${d}`,
);

/** Files that are allowed to hold CJK by design (repo-root relative, `/`-separated). */
const EXCLUDED_PREFIXES = [
  // The zh dictionary itself (split per namespace).
  `${DESKTOP_SRC}/shared/i18n/zh/`,
];
const EXCLUDED_FILES = new Set([
  // zh / en term pairs, reviewed by the user (§6.8).
  `${DESKTOP_SRC}/shared/i18n/glossary.ts`,
  // The first-run picker is bilingual by design (§6.7).
  `${DESKTOP_SRC}/renderer/src/i18n/LanguagePicker.tsx`,
]);

const SOURCE_FILE = /\.tsx?$/;
const TEST_FILE = /\.test\.tsx?$/;

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function isExcluded(rel: string): boolean {
  return (
    TEST_FILE.test(rel) ||
    EXCLUDED_FILES.has(rel) ||
    EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))
  );
}

function walk(absDir: string, out: string[]): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (SOURCE_FILE.test(entry.name)) out.push(abs);
  }
}

/** Non-test, non-excluded source files under the scan roots, repo-root relative. */
export function scannedFiles(): string[] {
  const out: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root), out);
  return out
    .map((abs) => toPosix(relative(REPO_ROOT, abs)))
    .filter((rel) => !isExcluded(rel))
    .sort();
}

/**
 * Every string literal, template piece and JSX text node in `file` that
 * contains a CJK character (`CJK_LEAK`, the analysis package's single source).
 * Comments are trivia in the AST and are never visited. `source` replaces the
 * file's contents (used by the mutation tests).
 */
export function findCjkLiterals(
  file: string,
  source?: string,
): Array<{ line: number; text: string }> {
  const text = source ?? readFileSync(join(REPO_ROOT, file), "utf8");
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Array<{ line: number; text: string }> = [];
  const push = (node: ts.Node, hitText: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ line: line + 1, text: hitText });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      // One hit per template (its source text, `${…}` included) when the head
      // or any middle / tail piece holds CJK, so an allowlist snippet can
      // name the whole message; the `${…}` expressions are still visited.
      const pieces = [node.head, ...node.templateSpans.map((s) => s.literal)];
      if (pieces.some((p) => CJK_LEAK.test(p.text))) {
        push(node, node.getText(sf));
      }
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxText(node)) &&
      CJK_LEAK.test(node.text)
    ) {
      push(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function isAllowlisted(file: string, text: string): boolean {
  return CJK_ALLOWLIST.some((a) => a.file === file && text.includes(a.snippet));
}

describe("i18n: 源码里不许写死中文(§6.9 第 1 条)", () => {
  const files = scannedFiles();
  const hitsByFile = new Map<string, Array<{ line: number; text: string }>>();
  for (const f of files) {
    const hits = findCjkLiterals(f);
    if (hits.length > 0) hitsByFile.set(f, hits);
  }

  it("扫描范围非空,排除项都存在", () => {
    expect(files.length).toBeGreaterThan(100);
    const all = new Set<string>();
    for (const root of SCAN_ROOTS) {
      const abs: string[] = [];
      walk(join(REPO_ROOT, root), abs);
      for (const a of abs) all.add(toPosix(relative(REPO_ROOT, a)));
    }
    for (const f of EXCLUDED_FILES) expect(all.has(f), f).toBe(true);
    for (const p of EXCLUDED_PREFIXES) {
      expect(
        [...all].some((f) => f.startsWith(p)),
        p,
      ).toBe(true);
    }
  });

  it("每条中文字面量都在 CJK_ALLOWLIST 里", () => {
    const offenders: string[] = [];
    for (const [file, hits] of hitsByFile) {
      for (const h of hits) {
        if (!isAllowlisted(file, h.text)) {
          offenders.push(`${file}:${h.line} ${JSON.stringify(h.text)}`);
        }
      }
    }
    // Move the text into the dictionary (src/shared/i18n/) and read it via t().
    expect(offenders).toEqual([]);
  });

  it("CJK_ALLOWLIST 只能减少:每条都在冻结清单里", () => {
    const frozen = new Set(
      FROZEN_CJK_ALLOWLIST.map(([file, snippet]) => `${file}\u0000${snippet}`),
    );
    const added = CJK_ALLOWLIST.filter(
      (a) => !frozen.has(`${a.file}\u0000${a.snippet}`),
    ).map((a) => `${a.file} ${a.snippet}`);
    // A new entry needs the frozen list and the hash below updated on purpose.
    expect(added).toEqual([]);
  });

  it("冻结清单本身没被改过(已排序、不重复、哈希固定)", () => {
    const keys = FROZEN_CJK_ALLOWLIST.map(
      ([file, snippet]) => `${file}\u0000${snippet}`,
    );
    expect(keys).toEqual([...new Set(keys)].sort());
    expect(createHash("sha256").update(keys.join("\n")).digest("hex")).toBe(
      "79468eb593d3d9a5c66800934ec1569c562a9ace5490abc52494a986bf7ac504",
    );
  });

  it("CJK_ALLOWLIST 每条都有理由且仍然命中", () => {
    for (const a of CJK_ALLOWLIST) {
      expect(a.reason, `${a.file} ${a.snippet}`).toMatch(/\S/);
      expect(a.snippet, a.file).toMatch(/\S/);
      const hits = hitsByFile.get(a.file) ?? [];
      expect(
        hits.some((h) => h.text.includes(a.snippet)),
        `stale allowlist entry: ${a.file} ${a.snippet}`,
      ).toBe(true);
    }
  });
});

describe("findCjkLiterals 变异测试", () => {
  it("字符串字面量里的中文命中 1 条", () => {
    expect(findCjkLiterals("x.ts", 'const a = "中文";')).toEqual([
      { line: 1, text: "中文" },
    ]);
  });

  it("注释里的中文不算", () => {
    expect(
      findCjkLiterals("x.ts", "// 中文注释\n/* 中文 */\nconst a = 1;"),
    ).toEqual([]);
  });

  it("模板字面量、JSX 文本、JSX 属性都会命中;模板按整条计一次", () => {
    const src = [
      "const n = 1;",
      "const a = `整段`;",
      "const b = `x${n}中${n}y`;",
      "const e = `a${n}b${n}尾`;",
      "const f = `ok ${`内嵌${n}`} ok`;",
      'const c = <div title="属性">文本</div>;',
      "const d = 'ascii only';",
    ].join("\n");
    expect(findCjkLiterals("x.tsx", src)).toEqual([
      { line: 2, text: "整段" },
      { line: 3, text: "`x${n}中${n}y`" },
      { line: 4, text: "`a${n}b${n}尾`" },
      { line: 5, text: "`内嵌${n}`" },
      { line: 6, text: "属性" },
      { line: 6, text: "文本" },
    ]);
  });

  it("类型位置、对象键、throw 里的中文也算", () => {
    const src = [
      'type T = "类型";',
      'const o = { "键": 1 };',
      'throw new Error("错误");',
    ].join("\n");
    expect(findCjkLiterals("x.ts", src).map((h) => h.text)).toEqual([
      "类型",
      "键",
      "错误",
    ]);
  });
});
