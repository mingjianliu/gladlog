#!/usr/bin/env node

/**
 * @file check-markdown-links.mjs
 * Reusable dependency-free Markdown link and anchor checker for gladlog.
 *
 * Supported Markdown subset & features:
 * - Standard inline links: `[text](destination)` and `[text](<destination>)`
 * - Titles in destinations: `[text](destination "title")`, `'title'`, or `(title)`
 * - URL decoding (%20, %23, etc.) and balanced parentheses in destinations
 * - Reference link definitions: `[label]: destination "optional title"`
 * - Reference link uses: `[text][label]`, `[label][]`, and shortcut `[label]`
 * - Skips fenced code blocks (3+ backticks or tildes)
 * - Skips inline code spans (`...` or ``...``)
 * - Skips external schemes: http://, https://, mailto:, ftp:, irc:
 * - Resolves relative local filesystem paths and directory targets
 * - Validates Markdown heading anchors via GitHub slug generation:
 *   - Lowercased, Markdown syntax/HTML stripped, punctuation removed
 *   - Unicode (e.g. Chinese characters) preserved
 *   - Duplicate heading suffixes (-1, -2, etc.) tracked per file
 * - Validates explicit HTML element anchors: `<... id="anchor">` or `<a name="anchor">`
 * - Validates non-Markdown line number anchors (e.g. `file.ts#L10` or `#L10-L20`)
 * - Paired bilingual docs verification (English .md <-> Chinese .zh-CN.md):
 *   - Language-bar links immediately below H1 are exempt
 *   - Flags CROSS_LANGUAGE when a translated counterpart target exists
 *   - Separately reports UNTRANSLATED_REF when no translation exists (no false failures)
 * - Scoped file arguments and machine-readable JSON output (--json)
 * - Exit code: nonzero (1) if genuine broken path or anchor exists, else 0
 *
 * Honesty on parsing limitations:
 * - Indented 4-space code blocks without fences are not skipped unless in code fences.
 * - Multi-line link definitions where title is on a separate line are not parsed.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Strips formatting and generates a GitHub-compatible slug from heading text.
 * @param {string} rawHeading
 * @returns {string}
 */
export function slugify(rawHeading) {
  return rawHeading
    .replace(/^#+\s+/, "")
    .replace(/<[^>]+>/g, "") // strip HTML tags
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // link text only
    .replace(/[`*~]/g, "") // strip code and formatting
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}\- ]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * Finds all code spans `...` on a single line.
 * @param {string} line
 * @returns {Array<{start: number, end: number}>}
 */
export function extractCodeSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      let run = 1;
      while (i + run < line.length && line[i + run] === "`") run++;
      let closeIdx = -1;
      let j = i + run;
      while (j < line.length) {
        if (line[j] === "`") {
          let closeRun = 1;
          while (j + closeRun < line.length && line[j + closeRun] === "`") closeRun++;
          if (closeRun === run) {
            closeIdx = j;
            break;
          }
          j += closeRun;
        } else {
          j++;
        }
      }
      if (closeIdx !== -1) {
        spans.push({ start: i, end: closeIdx + run - 1 });
        i = closeIdx + run;
      } else {
        i += run;
      }
    } else {
      i++;
    }
  }
  return spans;
}

/**
 * Checks if an index falls within any code span.
 * @param {number} idx
 * @param {Array<{start: number, end: number}>} spans
 * @returns {boolean}
 */
export function isInsideSpan(idx, spans) {
  return spans.some((s) => idx >= s.start && idx <= s.end);
}

/**
 * Extracts heading anchors and explicit HTML anchors from markdown content.
 * @param {string} content
 * @returns {Set<string>}
 */
export function extractAnchors(content) {
  const anchors = new Set();
  const slugCounts = new Map();
  const lines = content.split("\n");
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})(?:\s*.*)?$/);
    if (!inFence && fenceMatch) {
      inFence = true;
      fenceChar = fenceMatch[1][0];
      fenceLen = fenceMatch[1].length;
      continue;
    }
    if (inFence) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen) {
        inFence = false;
      }
      continue;
    }

    // ATX headings
    const hMatch = line.match(/^[ ]{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/);
    if (hMatch) {
      const headingText = hMatch[2];
      const baseSlug = slugify(headingText);
      const count = slugCounts.get(baseSlug) || 0;
      slugCounts.set(baseSlug, count + 1);
      const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
      anchors.add(slug);
    }

    // Explicit HTML anchors: id="..." or name="..."
    const idMatches = line.matchAll(/<[^>]+\s(?:id|name)=["']([^"']+)["'][^>]*>/gi);
    for (const m of idMatches) {
      anchors.add(m[1]);
    }
  }

  return anchors;
}

/**
 * Extracts links from markdown content.
 * @param {string} content
 * @param {string} filePath
 * @param {object} bilingualInfo
 * @returns {Array<{file: string, line: number, text: string, dest: string, isLangBar: boolean, isRef: boolean}>}
 */
export function extractLinks(content, filePath, bilingualInfo) {
  const lines = content.split("\n");
  const links = [];
  const refDefs = new Map(); // label -> { target, line }
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  // Pass 1: Reference definitions
  lines.forEach((line, lineIdx) => {
    const fenceMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})(?:\s*.*)?$/);
    if (!inFence && fenceMatch) {
      inFence = true;
      fenceChar = fenceMatch[1][0];
      fenceLen = fenceMatch[1].length;
      return;
    }
    if (inFence) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen) {
        inFence = false;
      }
      return;
    }

    const refMatch = line.match(/^[ ]{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+(?:["'(](.*?)["')]))?\s*$/);
    if (refMatch) {
      const label = refMatch[1].trim().toLowerCase();
      const target = (refMatch[2] || refMatch[3]).trim();
      refDefs.set(label, { target, line: lineIdx + 1 });
    }
  });

  // Also validate destinations of reference definitions themselves
  for (const [label, def] of refDefs.entries()) {
    links.push({
      file: filePath,
      line: def.line,
      text: label,
      dest: def.target,
      isLangBar: false,
      isRef: true,
    });
  }

  // Pass 2: Inline links and reference uses
  inFence = false;
  fenceChar = "";
  fenceLen = 0;

  lines.forEach((line, lineIdx) => {
    const fenceMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})(?:\s*.*)?$/);
    if (!inFence && fenceMatch) {
      inFence = true;
      fenceChar = fenceMatch[1][0];
      fenceLen = fenceMatch[1].length;
      return;
    }
    if (inFence) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen) {
        inFence = false;
      }
      return;
    }

    // Skip reference definition lines in pass 2
    if (/^[ ]{0,3}\[[^\]]+\]:\s*(?:<[^>]+>|\S+)/.test(line)) {
      return;
    }

    const spans = extractCodeSpans(line);

    let i = 0;
    while (i < line.length) {
      if (line[i] === "[" && (i === 0 || line[i - 1] !== "\\")) {
        if (isInsideSpan(i, spans)) {
          i++;
          continue;
        }

        // Find closing ]
        let depth = 1;
        let j = i + 1;
        while (j < line.length && depth > 0) {
          if (line[j] === "\\" && j + 1 < line.length) {
            j += 2;
            continue;
          }
          if (line[j] === "[") depth++;
          else if (line[j] === "]") depth--;
          if (depth === 0) break;
          j++;
        }

        if (depth === 0 && j < line.length && !isInsideSpan(j, spans)) {
          const linkText = line.slice(i + 1, j);

          // Case A: Inline link [text](dest)
          if (j + 1 < line.length && line[j + 1] === "(") {
            let k = j + 2;
            while (k < line.length && /\s/.test(line[k])) k++;

            let dest = "";
            let endParen = -1;

            if (line[k] === "<") {
              const closeAngle = line.indexOf(">", k);
              if (closeAngle !== -1) {
                dest = line.slice(k + 1, closeAngle).trim();
                endParen = line.indexOf(")", closeAngle);
              }
            } else {
              let parenDepth = 1;
              const startDest = k;
              let endDest = -1;
              while (k < line.length) {
                if (line[k] === "(") {
                  parenDepth++;
                } else if (line[k] === ")") {
                  parenDepth--;
                  if (parenDepth === 0) {
                    if (endDest === -1) endDest = k;
                    endParen = k;
                    break;
                  }
                } else if (/\s/.test(line[k]) && parenDepth === 1 && endDest === -1) {
                  endDest = k;
                }
                k++;
              }
              if (endDest !== -1) {
                dest = line.slice(startDest, endDest).trim();
              }
            }

            if (endParen !== -1 && dest) {
              // Check language bar exemption
              let isLangBar = false;
              if (bilingualInfo?.isBilingual && bilingualInfo.counterpart) {
                const targetPath = dest.split("#")[0];
                const normalizedDest = path.normalize(path.join(path.dirname(filePath), targetPath));
                if (
                  normalizedDest === bilingualInfo.counterpart &&
                  (lineIdx <= 4 || /^(English|Chinese|中文|简体中文)$/i.test(linkText.trim()))
                ) {
                  isLangBar = true;
                }
              }

              links.push({
                file: filePath,
                line: lineIdx + 1,
                text: linkText,
                dest,
                isLangBar,
                isRef: false,
              });

              i = endParen + 1;
              continue;
            }
          }

          // Case B: Reference link [text][label] or [label][]
          if (j + 1 < line.length && line[j + 1] === "[") {
            const closeBracket = line.indexOf("]", j + 2);
            if (closeBracket !== -1 && !isInsideSpan(closeBracket, spans)) {
              let label = line.slice(j + 2, closeBracket).trim().toLowerCase();
              if (!label) {
                // Collapsed: [label][]
                label = linkText.trim().toLowerCase();
              }
              const def = refDefs.get(label);
              if (def) {
                links.push({
                  file: filePath,
                  line: lineIdx + 1,
                  text: linkText,
                  dest: def.target,
                  isLangBar: false,
                  isRef: true,
                });
                i = closeBracket + 1;
                continue;
              }
            }
          }

          // Case C: Shortcut reference link [label]
          const shortcutLabel = linkText.trim().toLowerCase();
          const shortcutDef = refDefs.get(shortcutLabel);
          if (shortcutDef) {
            links.push({
              file: filePath,
              line: lineIdx + 1,
              text: linkText,
              dest: shortcutDef.target,
              isLangBar: false,
              isRef: true,
            });
          }
        }
      }
      i++;
    }
  });

  return links;
}

/**
 * Discovers markdown files using git.
 * @param {string} rootDir
 * @param {string[]} [explicitFiles=[]]
 * @returns {string[]}
 */
export function discoverMarkdownFiles(rootDir, explicitFiles = []) {
  if (explicitFiles.length > 0) {
    return explicitFiles
      .map((f) => path.relative(rootDir, path.resolve(rootDir, f)))
      .filter((f) => fs.existsSync(path.join(rootDir, f)));
  }

  try {
    const tracked = execSync('git ls-files "*.md"', { cwd: rootDir, encoding: "utf8", stdio: "pipe" })
      .trim()
      .split("\n")
      .filter(Boolean);

    let untracked = [];
    try {
      untracked = execSync('git ls-files --others --exclude-standard "*.md"', { cwd: rootDir, encoding: "utf8", stdio: "pipe" })
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch {
      // untracked optional
    }

    return Array.from(new Set([...tracked, ...untracked]))
      .filter((f) => !f.includes("node_modules/") && !f.startsWith(".git/"))
      .sort();
  } catch {
    // Fallback if not inside a git repo (e.g. unit test fixtures in temporary directories)
    const results = [];
    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          results.push(path.relative(rootDir, full));
        }
      }
    }
    walk(rootDir);
    return results.sort();
  }
}

/**
 * Checks bilingual status for a given file.
 * @param {string} relPath
 * @param {Set<string>} allFilesSet
 * @returns {{isBilingual: boolean, lang: "en" | "zh" | null, counterpart: string | null}}
 */
export function getBilingualInfo(relPath, allFilesSet) {
  if (relPath.endsWith(".zh-CN.md")) {
    const en = relPath.replace(/\.zh-CN\.md$/, ".md");
    if (allFilesSet.has(en)) {
      return { isBilingual: true, lang: "zh", counterpart: en };
    }
  } else if (relPath.endsWith(".md")) {
    const zh = relPath.replace(/\.md$/, ".zh-CN.md");
    if (allFilesSet.has(zh)) {
      return { isBilingual: true, lang: "en", counterpart: zh };
    }
  }
  return { isBilingual: false, lang: null, counterpart: null };
}

/**
 * Main auditing function.
 * @param {string} rootDir
 * @param {string[]} [targetFiles=[]]
 * @returns {{summary: object, findings: Array<object>}}
 */
export function auditMarkdownLinks(rootDir, targetFiles = []) {
  const allWorkspaceFiles = discoverMarkdownFiles(rootDir);
  const allFilesSet = new Set(allWorkspaceFiles);
  const filesToCheck = targetFiles.length > 0 ? discoverMarkdownFiles(rootDir, targetFiles) : allWorkspaceFiles;

  // Pass 1: Extract all anchors across workspace markdown files
  const fileAnchors = new Map();
  for (const relFile of allWorkspaceFiles) {
    const fullPath = path.join(rootDir, relFile);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf8");
      fileAnchors.set(relFile, extractAnchors(content));
    }
  }

  // Pass 2: Check links in filesToCheck
  const findings = [];
  let totalLinks = 0;

  for (const relFile of filesToCheck) {
    const fullPath = path.join(rootDir, relFile);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    const bilingualInfo = getBilingualInfo(relFile, allFilesSet);
    const links = extractLinks(content, relFile, bilingualInfo);
    totalLinks += links.length;

    for (const link of links) {
      // 1. Language bar exemption
      if (link.isLangBar) {
        continue;
      }

      // 2. Skip external schemes
      if (/^(https?|mailto|ftp|irc):/i.test(link.dest)) {
        continue;
      }

      // Parse destination
      let target = link.dest;
      try {
        target = decodeURIComponent(target);
      } catch {
        // use raw if malformed uri
      }

      let targetPath = "";
      let targetAnchor = "";
      const hashIdx = target.indexOf("#");
      if (hashIdx !== -1) {
        targetPath = target.slice(0, hashIdx).trim();
        targetAnchor = target.slice(hashIdx + 1).trim();
      } else {
        targetPath = target.trim();
      }

      const resolvedRelPath = targetPath
        ? path.normalize(path.join(path.dirname(relFile), targetPath))
        : relFile;
      const resolvedFullPath = path.join(rootDir, resolvedRelPath);

      // Check existence
      if (!fs.existsSync(resolvedFullPath)) {
        findings.push({
          file: link.file,
          line: link.line,
          target: link.dest,
          category: "BROKEN_PATH",
          summary: `Target file or path does not exist: ${resolvedRelPath}`,
        });
        continue;
      }

      const stat = fs.statSync(resolvedFullPath);
      if (stat.isDirectory()) {
        // Directory exists, ok
        continue;
      }

      // Check anchors
      if (targetAnchor) {
        if (resolvedRelPath.endsWith(".md")) {
          const anchors = fileAnchors.get(resolvedRelPath);
          if (!anchors || !anchors.has(targetAnchor)) {
            findings.push({
              file: link.file,
              line: link.line,
              target: link.dest,
              category: "BROKEN_ANCHOR",
              summary: `Anchor #${targetAnchor} not found in ${resolvedRelPath}`,
            });
            continue;
          }
        } else {
          // Non-markdown file line anchor (e.g. #L10 or #L10-L20)
          if (!/^L\d+(-L\d+)?$/.test(targetAnchor)) {
            findings.push({
              file: link.file,
              line: link.line,
              target: link.dest,
              category: "BROKEN_ANCHOR",
              summary: `Unsupported non-markdown anchor #${targetAnchor} in ${resolvedRelPath}`,
            });
            continue;
          }
        }
      }

      // Check bilingual doc cross-language consistency
      if (bilingualInfo.isBilingual && targetPath) {
        const targetIsZh = resolvedRelPath.endsWith(".zh-CN.md");
        const targetIsEn = resolvedRelPath.endsWith(".md") && !targetIsZh;

        let counterpartRelPath = null;
        if (targetIsEn) {
          counterpartRelPath = resolvedRelPath.replace(/\.md$/, ".zh-CN.md");
        } else if (targetIsZh) {
          counterpartRelPath = resolvedRelPath.replace(/\.zh-CN\.md$/, ".md");
        }

        const counterpartExists = counterpartRelPath && fs.existsSync(path.join(rootDir, counterpartRelPath));

        if (bilingualInfo.lang === "zh" && targetIsEn) {
          if (counterpartExists) {
            findings.push({
              file: link.file,
              line: link.line,
              target: link.dest,
              category: "CROSS_LANGUAGE",
              summary: `Chinese document links to English target when Chinese translation exists (${counterpartRelPath})`,
            });
          } else {
            findings.push({
              file: link.file,
              line: link.line,
              target: link.dest,
              category: "UNTRANSLATED_REF",
              summary: `Intentionally untranslated reference: Chinese counterpart does not exist for ${resolvedRelPath}`,
            });
          }
        } else if (bilingualInfo.lang === "en" && targetIsZh) {
          if (counterpartExists) {
            findings.push({
              file: link.file,
              line: link.line,
              target: link.dest,
              category: "CROSS_LANGUAGE",
              summary: `English document links to Chinese target when English original exists (${counterpartRelPath})`,
            });
          } else {
            findings.push({
              file: link.file,
              line: link.line,
              target: link.dest,
              category: "UNTRANSLATED_REF",
              summary: `Reference to Chinese doc with no English counterpart: ${resolvedRelPath}`,
            });
          }
        }
      }
    }
  }

  const brokenPaths = findings.filter((f) => f.category === "BROKEN_PATH").length;
  const brokenAnchors = findings.filter((f) => f.category === "BROKEN_ANCHOR").length;
  const crossLanguage = findings.filter((f) => f.category === "CROSS_LANGUAGE").length;
  const untranslatedRefs = findings.filter((f) => f.category === "UNTRANSLATED_REF").length;

  const summary = {
    totalFiles: filesToCheck.length,
    totalLinks,
    brokenPaths,
    brokenAnchors,
    crossLanguage,
    untranslatedRefs,
    totalFindings: findings.length,
    clean: brokenPaths === 0 && brokenAnchors === 0 && crossLanguage === 0,
  };

  return { summary, findings };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  let jsonOutput = false;
  const targetFiles = [];

  for (const arg of args) {
    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/check-markdown-links.mjs [--json] [files...]`);
      console.log(`Scans markdown files for broken paths, broken anchors, and bilingual link issues.`);
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      targetFiles.push(arg);
    }
  }

  const rootDir = process.cwd();
  const result = auditMarkdownLinks(rootDir, targetFiles);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Scanned ${result.summary.totalFiles} files, found ${result.summary.totalLinks} links.`);
    console.log(
      `Broken Paths: ${result.summary.brokenPaths} | Broken Anchors: ${result.summary.brokenAnchors} | Cross-Language: ${result.summary.crossLanguage} | Untranslated Refs: ${result.summary.untranslatedRefs}\n`,
    );

    if (result.findings.length > 0) {
      for (const f of result.findings) {
        console.log(`${f.file}:${f.line} | ${f.target} | [${f.category}] ${f.summary}`);
      }
    } else {
      console.log("No broken links or anchor issues found.");
    }
  }

  if (result.summary.brokenPaths > 0 || result.summary.brokenAnchors > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
