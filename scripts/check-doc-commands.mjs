#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// 1. Parse CLI arguments
const args = process.argv.slice(2);
let rootDir = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root" && i + 1 < args.length) {
    rootDir = path.resolve(args[++i]);
  } else if (args[i].startsWith("--root=")) {
    rootDir = path.resolve(args[i].slice("--root=".length));
  }
}

// 2. Load root package.json and discover workspace packages
let rootPkg = {};
const rootPkgPath = path.join(rootDir, "package.json");
if (fs.existsSync(rootPkgPath)) {
  try {
    rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  } catch {
    rootPkg = {};
  }
}

const rootScripts =
  rootPkg && typeof rootPkg.scripts === "object" && rootPkg.scripts !== null
    ? rootPkg.scripts
    : {};

function matchWorkspaceSegment(segment, name) {
  if (segment === "*") return true;
  if (!segment.includes("*") && !segment.includes("?")) {
    return segment === name;
  }
  const regexStr =
    "^" +
    segment
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".") +
    "$";
  return new RegExp(regexStr).test(name);
}

function findWorkspacePackageJsonPaths(targetRootDir, rawPattern) {
  if (typeof rawPattern !== "string") return [];
  const trimmed = rawPattern.trim();
  if (!trimmed) return [];

  const normalized = trimmed.replace(/\\/g, "/");
  if (
    path.isAbsolute(normalized) ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    return [];
  }

  const pattern = normalized.replace(/^\.\/+/, "");
  if (!pattern || pattern === ".") return [];

  let dirPattern = pattern;
  if (dirPattern.endsWith("/package.json")) {
    dirPattern = dirPattern.slice(0, -"/package.json".length);
  } else if (dirPattern === "package.json") {
    dirPattern = "";
  } else {
    dirPattern = dirPattern.replace(/\/+$/, "");
  }

  let realRootDir = targetRootDir;
  try {
    realRootDir = fs.realpathSync(targetRootDir);
  } catch {
    realRootDir = path.resolve(targetRootDir);
  }

  function isWithinRoot(absPath) {
    const rel = path.relative(targetRootDir, absPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
    try {
      const real = fs.realpathSync(absPath);
      const realRel = path.relative(realRootDir, real);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) return false;
    } catch {
      // Ignored
    }
    return true;
  }

  const segments = dirPattern ? dirPattern.split("/").filter(Boolean) : [];
  const matchedDirs = [];
  const visited = new Set();

  function walk(currentRelDir, segIdx, depth) {
    if (depth > 20) return;

    const currentAbs = path.resolve(targetRootDir, currentRelDir);
    if (!isWithinRoot(currentAbs)) return;

    let currentReal;
    try {
      currentReal = fs.realpathSync(currentAbs);
    } catch {
      return;
    }
    const visitKey = `${currentReal}::${segIdx}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    if (segIdx === segments.length) {
      matchedDirs.push(currentRelDir);
      return;
    }

    const seg = segments[segIdx];

    if (seg === "**") {
      walk(currentRelDir, segIdx + 1, depth);

      let entries;
      try {
        entries = fs.readdirSync(currentAbs, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        if (entry.name.startsWith(".")) continue;

        const childAbs = path.join(currentAbs, entry.name);
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            const st = fs.statSync(childAbs);
            isDir = st.isDirectory();
          } catch {
            isDir = false;
          }
        }
        if (isDir) {
          const childRel = currentRelDir ? `${currentRelDir}/${entry.name}` : entry.name;
          walk(childRel, segIdx, depth + 1);
        }
      }
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.name.startsWith(".") && !seg.startsWith(".")) continue;

      if (!matchWorkspaceSegment(seg, entry.name)) continue;

      const childAbs = path.join(currentAbs, entry.name);
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          const st = fs.statSync(childAbs);
          isDir = st.isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) {
        const childRel = currentRelDir ? `${currentRelDir}/${entry.name}` : entry.name;
        walk(childRel, segIdx + 1, depth + 1);
      }
    }
  }

  walk("", 0, 0);

  const results = [];
  for (const dir of matchedDirs) {
    if (!dir && dirPattern !== "") continue;
    const pkgRel = dir ? `${dir}/package.json` : "package.json";
    const pkgAbs = path.resolve(targetRootDir, pkgRel);
    if (isWithinRoot(pkgAbs)) {
      try {
        const st = fs.statSync(pkgAbs);
        if (st.isFile()) {
          results.push(pkgRel);
        }
      } catch {
        // Ignore missing or inaccessible package.json
      }
    }
  }

  return results;
}

const workspacePackages = [];
const workspaceByName = new Map();
const workspaceByDir = new Map();

const rawWorkspaces = rootPkg.workspaces;
if (rawWorkspaces) {
  const patterns = Array.isArray(rawWorkspaces)
    ? rawWorkspaces
    : Array.isArray(rawWorkspaces.packages)
      ? rawWorkspaces.packages
      : [];

  for (const rawPattern of patterns) {
    try {
      const matches = findWorkspacePackageJsonPaths(rootDir, rawPattern);
      for (const relMatch of matches) {
        const normRelMatch = relMatch.replace(/\\/g, "/");
        const fullPkgPath = path.resolve(rootDir, normRelMatch);
        try {
          const pkgContent = JSON.parse(fs.readFileSync(fullPkgPath, "utf8"));
          const relDir = path
            .dirname(normRelMatch)
            .replace(/^\.\//, "")
            .replace(/\/+$/, "");
          if (workspaceByDir.has(relDir)) {
            continue;
          }
          const pkgInfo = {
            name: pkgContent.name || null,
            relDir,
            absDir: path.dirname(fullPkgPath),
            scripts:
              pkgContent.scripts && typeof pkgContent.scripts === "object"
                ? pkgContent.scripts
                : {},
          };
          workspacePackages.push(pkgInfo);
          if (pkgInfo.name) {
            workspaceByName.set(pkgInfo.name, pkgInfo);
          }
          workspaceByDir.set(relDir, pkgInfo);
        } catch {
          // Ignore unreadable or invalid workspace package.json
        }
      }
    } catch {
      // Ignore invalid glob patterns or traversal errors
    }
  }
}

workspacePackages.sort((a, b) => b.relDir.length - a.relDir.length);

function findWorkspace(selector, effectiveCwd = "") {
  if (!selector) return null;
  if (workspaceByName.has(selector)) {
    return workspaceByName.get(selector);
  }
  const norm = selector
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (workspaceByName.has(norm)) {
    return workspaceByName.get(norm);
  }
  if (workspaceByDir.has(norm)) {
    return workspaceByDir.get(norm);
  }
  if (workspaceByDir.has(selector)) {
    return workspaceByDir.get(selector);
  }
  if (effectiveCwd) {
    const fromCwdRel = path
      .relative(rootDir, path.resolve(rootDir, effectiveCwd, selector))
      .replace(/\\/g, "/");
    if (workspaceByDir.has(fromCwdRel)) {
      return workspaceByDir.get(fromCwdRel);
    }
  }
  return null;
}

function getWorkspaceForPath(relPath) {
  const normPath = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const ws of workspacePackages) {
    if (normPath === ws.relDir || normPath.startsWith(ws.relDir + "/")) {
      return ws;
    }
  }
  return null;
}

function getPackageForDir(effectiveCwd) {
  const norm = (effectiveCwd || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (!norm) {
    return {
      name: rootPkg.name || null,
      relDir: "",
      scripts: rootScripts,
      isRoot: true,
    };
  }
  const ws = getWorkspaceForPath(norm);
  if (ws) {
    return {
      name: ws.name,
      relDir: ws.relDir,
      scripts: ws.scripts,
      isRoot: false,
    };
  }
  const pkgPath = path.resolve(rootDir, norm, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return {
        name: content.name || null,
        relDir: norm,
        scripts:
          content.scripts && typeof content.scripts === "object"
            ? content.scripts
            : {},
        isRoot: false,
      };
    } catch {
      // Ignore unreadable or invalid package.json
    }
  }
  return null;
}

// 3. Helper: detect obvious placeholders (<...> or path/to/...)
function hasPlaceholder(str) {
  return /<[^>]+>|path[/\\]to|\.\.\./i.test(str);
}

// 4. Helper: tokenize shell command respecting single and double quotes
function tokenize(input) {
  const tokens = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "#" && current === "") {
        break; // POSIX shell comment starts here
      }
      if (/\s/.test(char)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// 5. Helper: split chained commands (&&, ||, ;) outside of quotes
function splitChainedCommands(input) {
  const parts = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\" && !inSingle) {
      escapeNext = true;
      current += char;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (
        char === ";" ||
        (char === "&" && input[i + 1] === "&") ||
        (char === "|" && input[i + 1] === "|")
      ) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = "";
        if (char === "&" || char === "|") {
          i++;
        }
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

// 6. Helper: check if target file exists relative to base directory
function targetFileExists(baseDir, targetPath) {
  if (
    path.isAbsolute(targetPath) ||
    targetPath.startsWith("$") ||
    targetPath.startsWith("~")
  ) {
    return true; // External or env-based, ignore
  }
  const fullPath = path.resolve(baseDir, targetPath);
  if (fs.existsSync(fullPath)) return true;
  for (const ext of [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".json"]) {
    if (fs.existsSync(fullPath + ext)) return true;
  }
  return false;
}

// 7. Recursive markdown scanning
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "out",
]);

const SKIPPED_TREE_PREFIXES = [
  ".claude/worktrees",
  ".superpowers",
  "docs/plans",
  "docs/superpowers/plans",
];

function isSkippedPath(relPath) {
  const norm = relPath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
  return SKIPPED_TREE_PREFIXES.some(
    (prefix) => norm === prefix || norm.startsWith(prefix + "/"),
  );
}

function scanMarkdownFiles(dir, fileList = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return fileList;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relFromRoot = path.relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) {
        continue;
      }
      if (isSkippedPath(relFromRoot)) {
        continue;
      }
      scanMarkdownFiles(fullPath, fileList);
    } else if (entry.isFile()) {
      if (isSkippedPath(relFromRoot)) {
        continue;
      }
      if (/\.(md|markdown|mdx)$/i.test(entry.name)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

const markdownFiles = scanMarkdownFiles(rootDir);
const findings = [];

// 8. Process each markdown file
for (const filePath of markdownFiles) {
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  const fileWs = getWorkspaceForPath(relPath);
  const defaultCwd = fileWs ? fileWs.relDir : "";

  const lines = content.split(/\r?\n/);

  let inShellFence = false;
  let fenceChar = "";
  let fenceLength = 0;

  let blockLines = [];
  let blockLineNumbers = [];

  function processBlock() {
    if (blockLines.length === 0) return;

    let cmdBuffer = "";
    let cmdStartLine = null;
    let inContinuation = false;

    const commands = [];

    for (let j = 0; j < blockLines.length; j++) {
      const rawLine = blockLines[j];
      const lineNum = blockLineNumbers[j];

      const isContinuation = /(?:^|[^\\])(?:\\\\)*\\\s*$/.test(rawLine);
      const contentLine = isContinuation
        ? rawLine.replace(/\\\s*$/, "")
        : rawLine;

      if (!inContinuation) {
        if (!contentLine.trim() || contentLine.trim().startsWith("#")) {
          continue;
        }
        cmdStartLine = lineNum;
        cmdBuffer = contentLine.trim();
      } else {
        cmdBuffer += " " + contentLine.trim();
      }

      inContinuation = isContinuation;

      if (!isContinuation) {
        if (cmdStartLine !== null && cmdBuffer.trim().length > 0) {
          commands.push({ line: cmdStartLine, text: cmdBuffer.trim() });
          cmdStartLine = null;
          cmdBuffer = "";
        }
      }
    }

    if (cmdStartLine !== null && cmdBuffer.trim().length > 0) {
      commands.push({ line: cmdStartLine, text: cmdBuffer.trim() });
    }

    let effectiveCwd = defaultCwd;

    for (const cmd of commands) {
      if (hasPlaceholder(cmd.text)) {
        continue;
      }

      const subCommands = splitChainedCommands(cmd.text);
      for (let subCmd of subCommands) {
        subCmd = subCmd.trim();
        if (!subCmd) continue;

        if (hasPlaceholder(subCmd)) {
          continue;
        }

        subCmd = subCmd.replace(/^[$>]\s+/, "");

        const tokens = tokenize(subCmd);
        if (tokens.length === 0) continue;

        let tokenIdx = 0;
        while (
          tokenIdx < tokens.length &&
          /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[tokenIdx])
        ) {
          tokenIdx++;
        }
        if (tokenIdx >= tokens.length) continue;

        if (tokens[tokenIdx] === "cd" || tokens[tokenIdx] === "pushd") {
          let cdTarget = null;
          for (let k = tokenIdx + 1; k < tokens.length; k++) {
            const arg = tokens[k];
            if (arg === "--") {
              if (k + 1 < tokens.length) {
                cdTarget = tokens[k + 1];
              }
              break;
            }
            if (arg.startsWith("-")) {
              continue;
            }
            cdTarget = arg;
            break;
          }

          if (
            cdTarget !== null &&
            !hasPlaceholder(cdTarget) &&
            !cdTarget.startsWith("$") &&
            !cdTarget.startsWith("~") &&
            !path.isAbsolute(cdTarget)
          ) {
            const currentAbs = path.resolve(rootDir, effectiveCwd);
            const targetAbs = path.resolve(currentAbs, cdTarget);
            const relFromRoot = path
              .relative(rootDir, targetAbs)
              .replace(/\\/g, "/");

            if (!relFromRoot.startsWith("..") && !path.isAbsolute(relFromRoot)) {
              try {
                const stat = fs.statSync(targetAbs);
                if (stat.isDirectory()) {
                  effectiveCwd = relFromRoot === "." ? "" : relFromRoot;
                }
              } catch {
                // Ignore missing or inaccessible cd targets conservatively
              }
            }
          }
          continue;
        }

        let exec = tokens[tokenIdx];
        if (
          exec === "npx" &&
          tokenIdx + 1 < tokens.length &&
          (tokens[tokenIdx + 1] === "tsx" || tokens[tokenIdx + 1] === "node")
        ) {
          tokenIdx++;
          exec = tokens[tokenIdx];
        }

        if (exec === "npm") {
          const npmArgs = tokens.slice(tokenIdx + 1);
          let workspace = null;
          let isRun = false;
          let scriptName = null;

          for (let k = 0; k < npmArgs.length; k++) {
            const arg = npmArgs[k];
            if (arg === "--") {
              break;
            }
            if (arg === "-w" || arg === "--workspace") {
              if (k + 1 < npmArgs.length) {
                workspace = npmArgs[++k];
              }
              continue;
            }
            if (arg.startsWith("-w=")) {
              workspace = arg.slice(3);
              continue;
            }
            if (arg.startsWith("--workspace=")) {
              workspace = arg.slice("--workspace=".length);
              continue;
            }
            if (arg === "run" || arg === "run-script") {
              isRun = true;
              continue;
            }
            if (arg.startsWith("-")) {
              continue;
            }
            if (isRun && scriptName === null) {
              scriptName = arg;
              continue;
            }
          }

          if (isRun && scriptName) {
            if (
              hasPlaceholder(scriptName) ||
              (workspace && hasPlaceholder(workspace))
            ) {
              continue;
            }

            if (workspace !== null) {
              const ws = findWorkspace(workspace, effectiveCwd);
              if (!ws) {
                findings.push({
                  file: relPath,
                  line: cmd.line,
                  category: "UNKNOWN_WORKSPACE",
                  message: `Unknown workspace "${workspace}"`,
                });
              } else {
                if (!Object.hasOwn(ws.scripts, scriptName)) {
                  findings.push({
                    file: relPath,
                    line: cmd.line,
                    category: "MISSING_WORKSPACE_SCRIPT",
                    message: `Workspace "${workspace}" does not define script "${scriptName}"`,
                  });
                }
              }
            } else {
              const activePkg = getPackageForDir(effectiveCwd);
              if (!activePkg || activePkg.isRoot) {
                if (!Object.hasOwn(rootScripts, scriptName)) {
                  findings.push({
                    file: relPath,
                    line: cmd.line,
                    category: "MISSING_ROOT_SCRIPT",
                    message: `Root script "${scriptName}" not found in package.json`,
                  });
                }
              } else {
                if (!Object.hasOwn(activePkg.scripts, scriptName)) {
                  findings.push({
                    file: relPath,
                    line: cmd.line,
                    category: "MISSING_WORKSPACE_SCRIPT",
                    message: `Workspace "${activePkg.name || activePkg.relDir}" does not define script "${scriptName}"`,
                  });
                }
              }
            }
          }
        } else if (exec === "node" || exec === "tsx") {
          const nodeArgs = tokens.slice(tokenIdx + 1);
          let scriptTarget = null;

          for (let k = 0; k < nodeArgs.length; k++) {
            const arg = nodeArgs[k];
            if (arg === "--") {
              if (k + 1 < nodeArgs.length && scriptTarget === null) {
                scriptTarget = nodeArgs[++k];
              }
              break;
            }
            if (
              [
                "-r",
                "--require",
                "--loader",
                "--import",
                "--tsconfig",
                "-C",
              ].includes(arg)
            ) {
              k++;
              continue;
            }
            if (["-e", "--eval", "-p", "--print"].includes(arg)) {
              scriptTarget = null;
              break;
            }
            if (arg.startsWith("-")) {
              continue;
            }
            scriptTarget = arg;
            break;
          }

          if (scriptTarget !== null) {
            if (
              hasPlaceholder(scriptTarget) ||
              scriptTarget.startsWith("$") ||
              scriptTarget.startsWith("~") ||
              path.isAbsolute(scriptTarget)
            ) {
              continue;
            }

            const currentCwdAbs = path.resolve(rootDir, effectiveCwd);
            if (!targetFileExists(currentCwdAbs, scriptTarget)) {
              findings.push({
                file: relPath,
                line: cmd.line,
                category: "MISSING_SCRIPT_PATH",
                message: `Script target "${scriptTarget}" not found`,
              });
            }
          }
        }
      }
    }

    blockLines = [];
    blockLineNumbers = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const physicalLineNum = i + 1;

    if (!inShellFence && fenceChar === "") {
      const startMatch = line.match(/^( {0,3})(`{3,}|~{3,})\s*(.*)$/);
      if (startMatch) {
        const char = startMatch[2][0];
        const len = startMatch[2].length;
        const info = startMatch[3].trim();
        const tag = info ? info.split(/\s+/)[0].toLowerCase() : "";

        if (["bash", "sh", "shell"].includes(tag)) {
          inShellFence = true;
        }
        fenceChar = char;
        fenceLength = len;
        continue;
      }
    } else {
      const charPattern = fenceChar === "~" ? "~" : "`";
      const endRegex = new RegExp(`^( {0,3})${charPattern}{${fenceLength},}\\s*$`);
      if (endRegex.test(line)) {
        if (inShellFence) {
          processBlock();
          inShellFence = false;
        }
        fenceChar = "";
        fenceLength = 0;
        continue;
      }

      if (inShellFence) {
        blockLines.push(line);
        blockLineNumbers.push(physicalLineNum);
      }
    }
  }

  if (inShellFence) {
    processBlock();
  }
}

// 9. Output findings
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (findings.length > 0) {
  for (const f of findings) {
    console.error(`${f.file}:${f.line}: [${f.category}] ${f.message}`);
  }
  process.exit(1);
} else {
  process.exit(0);
}
