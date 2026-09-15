import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  auditMarkdownLinks,
  extractAnchors,
  extractCodeSpans,
  extractLinks,
  isInsideSpan,
  slugify,
} from "./check-markdown-links.mjs";

describe("Markdown Link Checker", () => {
  describe("slugify", () => {
    it("converts basic headings to lowercase hyphenated slugs", () => {
      assert.strictEqual(slugify("## Hello World"), "hello-world");
      assert.strictEqual(slugify("### Heading with Spaces"), "heading-with-spaces");
    });

    it("strips markdown formatting, links, and code backticks", () => {
      assert.strictEqual(
        slugify("## **Bold** and *Italic* and `code`"),
        "bold-and-italic-and-code",
      );
      assert.strictEqual(slugify("## Read [the docs](docs.md) now"), "read-the-docs-now");
    });

    it("strips HTML tags", () => {
      assert.strictEqual(slugify("## Title <span class='badge'>v1</span>"), "title-v1");
    });

    it("handles complex punctuation, em-dashes, and preserves identifier underscores", () => {
      assert.strictEqual(
        slugify("## 24. `dr` reverse query always empty — `analyzeOutgoingCCChains` target side hardcoded Hostile"),
        "24-dr-reverse-query-always-empty--analyzeoutgoingccchains-target-side-hardcoded-hostile",
      );
      assert.strictEqual(
        slugify("## 26. Two high-value streams discarded by the parsing layer from raw logs: mana values + SPELL_CAST_FAILED"),
        "26-two-high-value-streams-discarded-by-the-parsing-layer-from-raw-logs-mana-values--spell_cast_failed",
      );
      assert.strictEqual(
        slugify("## 27. `aurasActiveAt`'s slice(0,10) truncation can hide critical auras (hard CC pushed out by cosmetic auras)"),
        "27-aurasactiveats-slice010-truncation-can-hide-critical-auras-hard-cc-pushed-out-by-cosmetic-auras",
      );
    });

    it("handles Chinese characters and complex symbols matching BACKLOG items 39 and 40", () => {
      assert.strictEqual(
        slugify("## 39. getPriority 的分档是先验,不看实际后果(logged 2026-08-23,用户拍板单独立项;#34(b2) 顺带发现)"),
        "39-getpriority-的分档是先验不看实际后果logged-2026-08-23用户拍板单独立项34b2-顺带发现",
      );
      assert.strictEqual(
        slugify("## 40. 八类\"从没读过的日志事件\"逐条核对产品侧 + 五条已读进解析层(logged 2026-08-23)"),
        "40-八类从没读过的日志事件逐条核对产品侧--五条已读进解析层logged-2026-08-23",
      );
    });
  });

  describe("extractAnchors", () => {
    it("extracts ATX headings across all levels", () => {
      const doc = `# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6`;
      const anchors = extractAnchors(doc);
      assert.deepStrictEqual(Array.from(anchors), ["h1", "h2", "h3", "h4", "h5", "h6"]);
    });

    it("handles duplicate headings with -1, -2 suffixes", () => {
      const doc = `## Options\n### Details\n## Options\n## Options`;
      const anchors = extractAnchors(doc);
      assert.deepStrictEqual(Array.from(anchors), ["options", "details", "options-1", "options-2"]);
    });

    it("extracts explicit HTML anchors with id or name", () => {
      const doc = `<div id="custom-div"></div>\n<a name="custom-anchor"></a>\n<span id="target"></span>`;
      const anchors = extractAnchors(doc);
      assert.ok(anchors.has("custom-div"));
      assert.ok(anchors.has("custom-anchor"));
      assert.ok(anchors.has("target"));
    });

    it("ignores headings inside fenced code blocks", () => {
      const doc = "## Heading 1\n```markdown\n## Fenced Heading\n```\n## Heading 2";
      const anchors = extractAnchors(doc);
      assert.ok(anchors.has("heading-1"));
      assert.ok(anchors.has("heading-2"));
      assert.strictEqual(anchors.has("fenced-heading"), false);
    });
  });

  describe("extractCodeSpans & isInsideSpan", () => {
    it("identifies code spans and offsets correctly", () => {
      const line = "prefix `code` middle ``double ` code`` suffix";
      const spans = extractCodeSpans(line);
      assert.strictEqual(spans.length, 2);
      assert.strictEqual(isInsideSpan(7, spans), true); // inside `code`
      assert.strictEqual(isInsideSpan(0, spans), false); // prefix
      assert.strictEqual(isInsideSpan(15, spans), false); // middle
    });
  });

  describe("extractLinks", () => {
    it("extracts standard inline links and angle-bracket destinations", () => {
      const content = "[standard](doc.md)\n[with angle](<path with spaces/file.md>)";
      const links = extractLinks(content, "test.md", { isBilingual: false });
      assert.strictEqual(links.length, 2);
      assert.strictEqual(links[0].dest, "doc.md");
      assert.strictEqual(links[1].dest, "path with spaces/file.md");
    });

    it("handles optional titles in quotes or parentheses", () => {
      const content = `[link1](a.md "title one")\n[link2](b.md 'title two')\n[link3](c.md (title three))`;
      const links = extractLinks(content, "test.md", { isBilingual: false });
      assert.strictEqual(links.length, 3);
      assert.strictEqual(links[0].dest, "a.md");
      assert.strictEqual(links[1].dest, "b.md");
      assert.strictEqual(links[2].dest, "c.md");
    });

    it("handles balanced parentheses in URLs", () => {
      const content = `[paren link](path/to/file(1).md)`;
      const links = extractLinks(content, "test.md", { isBilingual: false });
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].dest, "path/to/file(1).md");
    });

    it("skips links inside fenced code blocks and inline code spans", () => {
      const content = `
\`[inline code link](a.md)\`
\`\`\`ts
[fenced code link](b.md)
\`\`\`
[valid link](c.md)
`;
      const links = extractLinks(content, "test.md", { isBilingual: false });
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].dest, "c.md");
    });

    it("extracts links when link text contains inline code", () => {
      const content = `[\`code in text\`](doc.md)`;
      const links = extractLinks(content, "test.md", { isBilingual: false });
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].dest, "doc.md");
    });

    it("extracts reference link definitions and uses", () => {
      const content = `
[ref]: target.md "Ref Title"
[use 1][ref]
[ref][]
[ref]
`;
      const links = extractLinks(content, "test.md", { isBilingual: false });
      // 1 from definition, 3 from uses
      assert.strictEqual(links.length, 4);
      for (const l of links) {
        assert.strictEqual(l.dest, "target.md");
      }
    });

    it("identifies language bar links on top lines", () => {
      const content = `# Title\n\n**English** · [Chinese](README.zh-CN.md)\n\nBody [link](other.md)`;
      const links = extractLinks(content, "README.md", {
        isBilingual: true,
        lang: "en",
        counterpart: "README.zh-CN.md",
      });
      assert.strictEqual(links.length, 2);
      assert.strictEqual(links[0].dest, "README.zh-CN.md");
      assert.strictEqual(links[0].isLangBar, true);
      assert.strictEqual(links[1].dest, "other.md");
      assert.strictEqual(links[1].isLangBar, false);
    });
  });

  describe("auditMarkdownLinks fixture suite", () => {
    let tmpDir;

    function setupFixture(files) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "link-audit-test-"));
      // initialize empty git repo so discoverMarkdownFiles works
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules\n");
      for (const [relPath, content] of Object.entries(files)) {
        const full = path.join(tmpDir, relPath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
      }
      return tmpDir;
    }

    it("detects BROKEN_PATH and BROKEN_ANCHOR accurately", () => {
      const dir = setupFixture({
        "doc1.md": `
# Doc 1
[valid link](doc2.md#section-one)
[broken anchor](doc2.md#missing-section)
[broken file](missing.md)
[self anchor](#doc-1)
[broken self anchor](#missing-anchor)
`,
        "doc2.md": `
# Doc 2
## Section One
Content
`,
      });

      const explicitFiles = ["doc1.md", "doc2.md"];
      const result = auditMarkdownLinks(dir, explicitFiles);

      assert.strictEqual(result.summary.brokenPaths, 1);
      assert.strictEqual(result.summary.brokenAnchors, 2);
      assert.strictEqual(result.summary.clean, false);

      const pathIssue = result.findings.find((f) => f.category === "BROKEN_PATH");
      assert.strictEqual(pathIssue.target, "missing.md");

      const anchorIssues = result.findings.filter((f) => f.category === "BROKEN_ANCHOR");
      assert.strictEqual(anchorIssues.length, 2);
      assert.ok(anchorIssues.some((f) => f.target === "doc2.md#missing-section"));
      assert.ok(anchorIssues.some((f) => f.target === "#missing-anchor"));

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("supports non-markdown file line numbers (#L10, #L10-L20)", () => {
      const dir = setupFixture({
        "doc.md": `
[source line](src/index.ts#L10)
[source range](src/index.ts#L10-L20)
[invalid source anchor](src/index.ts#something-else)
`,
        "src/index.ts": `// code here\n`.repeat(30),
      });

      const result = auditMarkdownLinks(dir, ["doc.md"]);
      assert.strictEqual(result.summary.brokenPaths, 0);
      assert.strictEqual(result.summary.brokenAnchors, 1);
      assert.strictEqual(result.findings[0].target, "src/index.ts#something-else");

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("verifies bilingual pairing: flags CROSS_LANGUAGE when translation exists, UNTRANSLATED_REF when not", () => {
      const dir = setupFixture({
        "guide.md": "# Guide\n**English** · [Chinese](guide.zh-CN.md)\n[Doc with translation](doc-pair.md)",
        "guide.zh-CN.md": "# Guide\n[English](guide.md) · **中文**\n[Links to EN](doc-pair.md)\n[Links to un-translated](single.md)",
        "doc-pair.md": "# Doc Pair\n**English** · [Chinese](doc-pair.zh-CN.md)",
        "doc-pair.zh-CN.md": "# Doc Pair\n[English](doc-pair.md) · **中文**",
        "single.md": "# Single English Doc",
      });

      const result = auditMarkdownLinks(dir, ["guide.md", "guide.zh-CN.md", "doc-pair.md", "doc-pair.zh-CN.md", "single.md"]);

      assert.strictEqual(result.summary.brokenPaths, 0);
      assert.strictEqual(result.summary.brokenAnchors, 0);
      assert.strictEqual(result.summary.crossLanguage, 1);
      assert.strictEqual(result.summary.untranslatedRefs, 1);

      const crossIssue = result.findings.find((f) => f.category === "CROSS_LANGUAGE");
      assert.strictEqual(crossIssue.file, "guide.zh-CN.md");
      assert.strictEqual(crossIssue.target, "doc-pair.md");

      const untranslated = result.findings.find((f) => f.category === "UNTRANSLATED_REF");
      assert.strictEqual(untranslated.file, "guide.zh-CN.md");
      assert.strictEqual(untranslated.target, "single.md");

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("gladlog real regression cases", () => {
    it("validates all 9 migrated BACKLOG anchors against BACKLOG-archive.md", () => {
      const rootDir = process.cwd();
      const result = auditMarkdownLinks(rootDir, ["docs/BACKLOG.md", "docs/BACKLOG-archive.md"]);

      assert.strictEqual(result.summary.brokenPaths, 0);
      assert.strictEqual(result.summary.brokenAnchors, 0);
      assert.strictEqual(result.summary.crossLanguage, 0);
      assert.strictEqual(result.summary.clean, true);
    });

    it("does not parse the escaped confidence interval as a link", () => {
      const rootDir = process.cwd();
      const result = auditMarkdownLinks(rootDir, ["docs/HANDOFF-2026-09-05-skillcapped-coach-corpus.md"]);

      assert.strictEqual(result.summary.brokenPaths, 0);
      assert.strictEqual(result.summary.totalFindings, 0);
      assert.strictEqual(result.summary.clean, true);
    });
  });
});
