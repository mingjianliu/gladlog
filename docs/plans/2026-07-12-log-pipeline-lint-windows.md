# Cross-Machine Log Pipeline + Lint + Windows Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the user's own windows-agent + wal-pilot into a new `packages/log-pipeline` (streamer on Windows → Google-Drive folder → reconstruct-only collector on Mac), add a root ESLint config, and produce a Windows build of the main desktop app.

**Architecture:** One workspace package with two CLIs (`stream`, `collect`) reusing the user's audit-CLEAN files near-verbatim over the existing `localDir` storage adapter (Drive folder); the segment protocol is hardened to length-encoded keys with overlap-aware, gzip-validated reconstruction. Lint is a single root flat config; the Windows binary is the existing desktop app packaged via electron-builder.

**Tech Stack:** npm workspaces, TypeScript ESM, vitest, tsx, Node zlib/fs, electron-vite + electron-builder 26, ESLint 9 flat config + typescript-eslint.

## Global Constraints

- **Compliance:** windows-agent + pipeline-app are 100% the user's own code (audit-CLEAN) → portable. Upstream (original wowarenalogs authors) code: **one line un-touched**. The **controller** performs old-fork extraction (Task 2); **subagents and agy never read the old fork** — every subagent task in this plan operates only on gladlog-resident files and the code embedded here.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`). **NEVER `tsc -b`** (it emits `.js` into `src/` and shadows the `.ts`).
- **Module system:** ESM (`"type": "module"` where the package uses it); import with explicit paths; tests are vitest, not Jest.
- **No cloud:** GCS adapter + `@google-cloud/storage` are dropped; transport is the `localDir` adapter pointed at a Google Drive folder.
- **Naming:** package `@gladlog/log-pipeline`; CLI bins `gladlog-stream` / `gladlog-collect`; no "WoW Arena Logs" or near-names; app `productName` = `gladlog`, `appId` = `com.gladlog.desktop`.
- **Segment key format (hardened):** `raw/<hostname>/<logFileName>/<gen8>/<startOffset>_<length>.seg`, both numbers zero-padded to `OFFSET_PAD` (12); body is `gzip(delta)`; `length` = uncompressed delta length.
- **Collector:** reconstruct-only (no analysis backend); output complete `.txt` logs to a user-chosen `outputDir`.

## Execution Model

Task 1 (lint) and Tasks 3–9 are **subagent-executable** — full code is embedded. **Task 2 is controller-performed**: only the controller may read the old fork, so the controller copies the CLEAN files into gladlog (with the listed mechanical adaptations) and commits a "raw port" before dispatching Task 3+. Do NOT dispatch a subagent for Task 2.

## File Structure

```
eslint.config.js                                  (Task 1 — root flat config)
packages/log-pipeline/
  package.json                                    (Task 2)
  tsconfig.json                                   (Task 2)
  src/
    protocol/identity.ts                          (Task 2 — verbatim)
    protocol/segments.ts                          (Task 2 stage → Task 3 harden)
    protocol/reconstruct.ts                       (Task 2 stage → Task 4 harden)
    storage/StorageAdapter.ts                     (Task 2 — verbatim)
    storage/adapterContract.ts                    (Task 2 — verbatim)
    storage/LocalDirStorageAdapter.ts             (Task 2 — verbatim)
    storage/MemoryStorageAdapter.ts               (Task 2 — verbatim)
    storage/createAdapter.ts                      (Task 2 — modified: drop gcs)
    config.ts                                     (Task 2 — modified: drop gcs)
    state.ts                                       (Task 2 — verbatim)
    watcher.ts                                     (Task 2 — verbatim)
    flusher.ts                                     (Task 2 stage → Task 5 harden)
    initialScan.ts                                 (Task 2 — verbatim)
    heartbeat.ts                                   (Task 2 — verbatim)
    index.ts                                       (Task 2 — modified: drop gcs; exports flushBatch + main)
    streamCli.ts                                   (Task 2 — from cli.ts)
    collect/collectorConfig.ts                     (Task 2 — modified: outputDir, drop gcs, node:fs)
    collect/statusFile.ts                          (Task 2 — verbatim, node:fs)
    collectLogs.ts                                 (Task 2 stage → Task 6 harden)
    cleanup.ts                                     (Task 2 — modified: node:fs, length cross-check)
    collectCli.ts                                  (Task 7 — new)
    protocol/segments.test.ts                      (Task 3)
    protocol/reconstruct.test.ts                   (Task 4)
    flusher.test.ts                                (Task 5)
    collectLogs.test.ts                            (Task 6)
    roundtrip.test.ts                              (Task 8)
packages/desktop/package.json                      (Task 9 — add build config)
packages/desktop/build/icon.ico                    (Task 9 — new original icon)
```

Deferred (not ported this plan; revisit with a future `gladlog-pilot`): `pilotConfig.ts`, `detect.ts`, `streamerService.ts`, `collectorService.ts` — their reusable logic (`main()` streamer, `runCollection`, `cleanupAppliedSegments`) is ported; the Electron-pilot orchestration shells are not (YAGNI, no pilot GUI this plan).

---

### Task 1: Root ESLint flat config

**Files:**

- Create: `eslint.config.js`
- Modify: `package.json` (root — add devDeps + scripts)

**Interfaces:**

- Produces: root `lint` / `lint:fix` scripts; a flat config applied to all `packages/**`.

- [ ] **Step 1: Add devDependencies**

Run:

```bash
npm install -D -w . eslint@^9 typescript-eslint@^8 eslint-plugin-simple-import-sort@^12 eslint-plugin-react-hooks@^5 eslint-config-prettier@^9 globals@^15
```

Expected: packages added to root `devDependencies`.

- [ ] **Step 2: Create the flat config**

Create `eslint.config.js`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
      "react-hooks": reactHooks,
    },
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  prettier,
);
```

- [ ] **Step 3: Add root scripts**

In root `package.json` `scripts`, add:

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix"
```

- [ ] **Step 4: Run lint and drive to green**

Run: `npm run lint`
Expected: it reports violations in existing code. Fix genuine errors (`no-unused-vars`, rules-of-hooks) and run `npm run lint:fix` for auto-fixable import-sort. Re-run until exit 0. If the error count is large or a fix would touch unrelated logic, STOP and report counts rather than churning.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "build(lint): add root ESLint 9 flat config"
```

---

### Task 2: [CONTROLLER] Stage the log-pipeline package (raw port)

**Performed by the controller, not a subagent** (old-fork read access). Copies the user's CLEAN files into `packages/log-pipeline/src/` with the mechanical adaptations below, gets the package to typecheck + lint clean, and commits the raw port. Tasks 3–8 then harden and test in place.

**Files & adaptations (source → dest):**

- Create `packages/log-pipeline/package.json`:

```json
{
  "name": "@gladlog/log-pipeline",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": {
    "gladlog-stream": "src/streamCli.ts",
    "gladlog-collect": "src/collectCli.ts"
  },
  "scripts": {
    "stream": "tsx src/streamCli.ts",
    "collect": "tsx src/collectCli.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- Create `packages/log-pipeline/tsconfig.json` mirroring `packages/analysis/tsconfig.json` (same `extends`/compilerOptions; ESM, `noEmit`-friendly).
- **Verbatim** (adjust only relative import paths to the new layout): `protocol/identity.ts`, `storage/StorageAdapter.ts`, `storage/adapterContract.ts`, `storage/LocalDirStorageAdapter.ts`, `storage/MemoryStorageAdapter.ts`, `state.ts`, `watcher.ts`, `initialScan.ts`, `heartbeat.ts`, `collect/statusFile.ts`.
- **Staged now, hardened later** (copy as-is; Tasks 3–6 rewrite): `protocol/segments.ts`, `protocol/reconstruct.ts`, `flusher.ts`, `collectLogs.ts`.
- **Modified — drop GCS**: `config.ts` — remove the `gcs` arm of `StorageConfig` and its two validation branches (keep only `localDir`). `storage/createAdapter.ts` — delete the `case 'gcs'` and the `GcsStorageAdapter` import. Do **not** copy `GcsStorageAdapter.ts`; do not add `@google-cloud/storage`.
- **Modified — index.ts**: copy `index.ts` (keeps `flushBatch` + `main`); its `createAdapter` now resolves only `localDir`. `main()` is the streamer entry.
- **Modified — streamCli.ts**: copy `cli.ts` → `streamCli.ts` (it just calls `main()` from `./index`).
- **Modified — collect/collectorConfig.ts**: replace `fs-extra` with `node:fs`/`node:path`; `CollectorConfig` becomes `{ storage: StorageConfig; outputDir: string; pollIntervalMs: number; cleanup: boolean }`; drop the gcs example text; loader reads an explicit `--config` path (see Task 7).
- **Modified — cleanup.ts**: replace `fs-extra` promises usage that isn't in `node:fs/promises` (all of it is); fix the `outputNameFor` import to `./collectLogs`; keep the fail-closed gzip check.

**Controller steps:**

- [ ] Copy + adapt all files above into `packages/log-pipeline/src/`.
- [ ] `npm install` (wires the workspace); ensure `tsx`, `vitest`, `typescript` resolve.
- [ ] `cd packages/log-pipeline && npm run typecheck` → clean.
- [ ] `npm run lint` (root) → clean for the new files (add `/* eslint-disable no-console */`-free console usage only in CLI files; prefer `console.warn`/`error` elsewhere).
- [ ] Commit: `feat(log-pipeline): stage ported streamer/collector (raw port, pre-hardening)`.

---

### Task 3: Harden segment keys — encode length

**Files:**

- Modify: `packages/log-pipeline/src/protocol/segments.ts`
- Test: `packages/log-pipeline/src/protocol/segments.test.ts`

**Interfaces:**

- Produces: `SegmentRef { hostname; logFileName; gen8; startOffset: number; length: number; key: string }`; `buildSegmentKey(hostname, logFileName, gen8, startOffset, length): string`; `parseSegmentKey(key): SegmentRef | null`; `buildHeartbeatKey(hostname): string`; `OFFSET_PAD = 12`.

- [ ] **Step 1: Write the failing test**

Create `packages/log-pipeline/src/protocol/segments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSegmentKey, parseSegmentKey } from "./segments";

describe("segment keys (length-encoded)", () => {
  it("round-trips host/file/gen/offset/length", () => {
    const key = buildSegmentKey("pc", "WoWCombatLog.txt", "abcd1234", 100, 50);
    expect(key).toBe(
      "raw/pc/WoWCombatLog.txt/abcd1234/000000000100_000000000050.seg",
    );
    const ref = parseSegmentKey(key);
    expect(ref).toEqual({
      hostname: "pc",
      logFileName: "WoWCombatLog.txt",
      gen8: "abcd1234",
      startOffset: 100,
      length: 50,
      key,
    });
  });
  it("rejects the old offset-only name and Drive conflict copies", () => {
    expect(parseSegmentKey("raw/pc/f/abcd1234/000000000100.seg")).toBeNull();
    expect(parseSegmentKey("raw/pc/f/abcd1234/100_50 (1).seg")).toBeNull();
    expect(parseSegmentKey("status/pc.json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/log-pipeline && npx vitest run src/protocol/segments.test.ts`
Expected: FAIL (old `buildSegmentKey` takes 4 args / no `length`).

- [ ] **Step 3: Rewrite segments.ts**

```ts
export const OFFSET_PAD = 12;

export interface SegmentRef {
  hostname: string;
  logFileName: string;
  gen8: string;
  startOffset: number;
  length: number;
  key: string;
}

const pad = (n: number) => String(n).padStart(OFFSET_PAD, "0");

export function buildSegmentKey(
  hostname: string,
  logFileName: string,
  gen8: string,
  startOffset: number,
  length: number,
): string {
  return `raw/${hostname}/${logFileName}/${gen8}/${pad(startOffset)}_${pad(length)}.seg`;
}

export function parseSegmentKey(key: string): SegmentRef | null {
  const parts = key.split("/");
  if (parts.length !== 5 || parts[0] !== "raw") return null;
  const [, hostname, logFileName, gen8, last] = parts;
  const m = /^(\d+)_(\d+)\.seg$/.exec(last);
  if (!m) return null;
  return {
    hostname,
    logFileName,
    gen8,
    startOffset: parseInt(m[1], 10),
    length: parseInt(m[2], 10),
    key,
  };
}

export function buildHeartbeatKey(hostname: string): string {
  return `status/${hostname}.json`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/protocol/segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/log-pipeline/src/protocol/segments.ts packages/log-pipeline/src/protocol/segments.test.ts
git commit -m "feat(log-pipeline): encode segment length in the key (harden reconstruction)"
```

---

### Task 4: Harden reconstruction — overlap-aware, advance-by-actual contract

**Files:**

- Modify: `packages/log-pipeline/src/protocol/reconstruct.ts`
- Test: `packages/log-pipeline/src/protocol/reconstruct.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `SegmentSpan { startOffset: number; length: number }`; `NextAction = { type:'append'; startOffset:number; length:number } | { type:'gap'; expected:number; nextAvailable:number } | { type:'done' }`; `nextAction(currentSize: number, segs: SegmentSpan[]): NextAction` — picks the covering span reaching furthest; the caller applies it and advances by **actual** decompressed bytes.

- [ ] **Step 1: Write the failing test**

Create `packages/log-pipeline/src/protocol/reconstruct.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextAction } from "./reconstruct";

describe("nextAction (overlap-aware)", () => {
  it("appends the fresh segment starting at currentSize", () => {
    expect(nextAction(0, [{ startOffset: 0, length: 50 }])).toEqual({
      type: "append",
      startOffset: 0,
      length: 50,
    });
  });
  it("prefers the covering segment reaching furthest (re-flush overlap)", () => {
    // 100_50 and 100_200 both start at 100; at size 150 only 100_200 still covers.
    expect(
      nextAction(150, [
        { startOffset: 100, length: 50 },
        { startOffset: 100, length: 200 },
      ]),
    ).toEqual({ type: "append", startOffset: 100, length: 200 });
  });
  it("treats wholly-applied segments as duplicates (done)", () => {
    expect(nextAction(150, [{ startOffset: 100, length: 50 }])).toEqual({
      type: "done",
    });
  });
  it("reports a gap when the next segment starts beyond currentSize", () => {
    expect(nextAction(150, [{ startOffset: 300, length: 20 }])).toEqual({
      type: "gap",
      expected: 150,
      nextAvailable: 300,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/protocol/reconstruct.test.ts`
Expected: FAIL (old `nextAction(currentSize, number[])` signature).

- [ ] **Step 3: Rewrite reconstruct.ts**

```ts
export interface SegmentSpan {
  startOffset: number;
  length: number;
}

export type NextAction =
  | { type: "append"; startOffset: number; length: number }
  | { type: "gap"; expected: number; nextAvailable: number }
  | { type: "done" };

/**
 * One overlap-aware reconstruction step. Among segments that cover the current
 * size (startOffset <= currentSize < startOffset+length) pick the one reaching
 * furthest, so each step makes maximal progress and re-flush overlaps self-heal.
 * Segments wholly at/below currentSize are duplicates. If none covers but a
 * later segment exists, that is a gap (wait). The caller MUST advance by the
 * ACTUAL decompressed bytes appended, never by this `length` (a partially
 * synced file can be shorter than its name claims).
 */
export function nextAction(
  currentSize: number,
  segs: SegmentSpan[],
): NextAction {
  let best: SegmentSpan | null = null;
  let nextGap = Infinity;
  for (const s of segs) {
    const end = s.startOffset + s.length;
    if (s.startOffset <= currentSize && currentSize < end) {
      if (!best || end > best.startOffset + best.length) best = s;
    } else if (s.startOffset > currentSize && s.startOffset < nextGap) {
      nextGap = s.startOffset;
    }
  }
  if (best)
    return {
      type: "append",
      startOffset: best.startOffset,
      length: best.length,
    };
  if (nextGap !== Infinity)
    return { type: "gap", expected: currentSize, nextAvailable: nextGap };
  return { type: "done" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/protocol/reconstruct.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/log-pipeline/src/protocol/reconstruct.ts packages/log-pipeline/src/protocol/reconstruct.test.ts
git commit -m "feat(log-pipeline): overlap-aware reconstruction step"
```

---

### Task 5: Wire flusher to length-encoded keys

**Files:**

- Modify: `packages/log-pipeline/src/flusher.ts` (the `buildSegmentKey` call, ~line 97)
- Test: `packages/log-pipeline/src/flusher.test.ts`

**Interfaces:**

- Consumes: `buildSegmentKey(hostname, logFileName, gen8, startOffset, length)` (Task 3); `MemoryStorageAdapter` (`put`/`list`/`get`).
- Produces: `flushFile` writing a segment whose key encodes `delta.length` and whose body is `gzip(delta)`.

- [ ] **Step 1: Write the failing test**

Create `packages/log-pipeline/src/flusher.test.ts`:

```ts
import { gunzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flushFile } from "./flusher";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter";
import { parseSegmentKey } from "./protocol/segments";

describe("flushFile", () => {
  it("writes one length-encoded, gzipped segment for the delta", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flush-"));
    const filePath = join(dir, "WoWCombatLog.txt");
    const body = "1/1 line one\n2/2 line two\n";
    writeFileSync(filePath, body);
    const adapter = new MemoryStorageAdapter();
    const out = await flushFile({
      filePath,
      logFileName: "WoWCombatLog.txt",
      hostname: "pc",
      checkpoint: undefined,
      adapter,
    });
    expect(out.flushedBytes).toBe(Buffer.byteLength(body));
    const keys = await adapter.list("raw/");
    expect(keys).toHaveLength(1);
    const ref = parseSegmentKey(keys[0])!;
    expect(ref.startOffset).toBe(0);
    expect(ref.length).toBe(Buffer.byteLength(body));
    expect(gunzipSync(await adapter.get(keys[0])).toString()).toBe(body);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/flusher.test.ts`
Expected: FAIL (old key has no `length` segment; `parseSegmentKey` returns null).

- [ ] **Step 3: Update the flusher call**

In `packages/log-pipeline/src/flusher.ts`, change the segment-key line to pass the delta length:

```ts
const gen8 = gen8Of(checksum);
const segmentKey = buildSegmentKey(
  hostname,
  logFileName,
  gen8,
  startOffset,
  delta.length,
);
await adapter.put(segmentKey, gzipSync(delta));
```

(No other flusher change — it already reads `delta` and gzips it.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/flusher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/log-pipeline/src/flusher.ts packages/log-pipeline/src/flusher.test.ts
git commit -m "feat(log-pipeline): flusher writes length-encoded segments"
```

---

### Task 6: Harden runCollection — overlap apply, gunzip-validate, advance-by-actual, outputDir

**Files:**

- Modify: `packages/log-pipeline/src/collectLogs.ts`
- Test: `packages/log-pipeline/src/collectLogs.test.ts`

**Interfaces:**

- Consumes: `nextAction` (Task 4), `parseSegmentKey`/`SegmentRef` (Task 3), `createAdapter`, `CollectorConfig { storage; outputDir; pollIntervalMs; cleanup }`.
- Produces: `runCollection(config: CollectorConfig, adapter?: StorageAdapter): Promise<CollectStats>` (adapter defaults to `createAdapter(config.storage)`; tests inject a `MemoryStorageAdapter`) writing reconstructed `.txt` to `config.outputDir`, advancing by actual decompressed bytes, deferring un-gunzippable (partial-sync) segments; `outputNameFor(ref): string`; `CollectStats { segmentsFetched; bytesAppended; filesUpdated: string[]; gaps: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `packages/log-pipeline/src/collectLogs.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCollection } from "./collectLogs";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter";
import { buildSegmentKey, parseSegmentKey } from "./protocol/segments";

function cfg(dir: string) {
  return {
    storage: { provider: "localDir" as const, directory: "unused" },
    outputDir: dir,
    pollIntervalMs: 0,
    cleanup: false,
  };
}

describe("runCollection (overlap-aware, advance-by-actual)", () => {
  it("recovers dropped bytes when a longer re-flush overwrites a shorter segment's range", async () => {
    // Craft length-encoded keys directly to simulate a crash-window re-flush.
    const a = new MemoryStorageAdapter();
    const g = "abcd1234";
    // First flush wrote bytes [0,50); crash before checkpoint; re-flush wrote [0,120).
    await a.put(
      buildSegmentKey("pc", "L.txt", g, 0, 50),
      gzipSync(Buffer.alloc(50, 65)),
    ); // 'A'*50
    await a.put(
      buildSegmentKey("pc", "L.txt", g, 0, 120),
      gzipSync(Buffer.concat([Buffer.alloc(50, 65), Buffer.alloc(70, 66)])),
    ); // 'A'*50 + 'B'*70
    const dir = mkdtempSync(join(tmpdir(), "collect-"));
    const stats = await runCollection(cfg(dir), a);
    const outName = stats.filesUpdated[0];
    const out = readFileSync(join(dir, outName));
    expect(out.length).toBe(120); // no bytes lost, no stall
    expect(out.subarray(50).every((b) => b === 66)).toBe(true);
  });

  it("defers a partially-synced (truncated gzip) segment instead of appending garbage", async () => {
    const a = new MemoryStorageAdapter();
    const g = "abcd1234";
    const full = gzipSync(Buffer.alloc(40, 67)); // 'C'*40
    await a.put(
      buildSegmentKey("pc", "L.txt", g, 0, 40),
      full.subarray(0, full.length - 3),
    ); // truncated
    const dir = mkdtempSync(join(tmpdir(), "collect-"));
    const stats = await runCollection(cfg(dir), a);
    expect(stats.bytesAppended).toBe(0); // deferred, nothing applied
  });
});
```

(The tests pass the in-memory adapter as `runCollection`'s optional second argument — Step 3; production calls `runCollection(config)` and resolves `config.storage`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/collectLogs.test.ts`
Expected: FAIL (old loop lacks overlap/seek/gunzip-guard; `CollectStats`/output path differ).

- [ ] **Step 3: Rewrite runCollection**

Replace the body of `packages/log-pipeline/src/collectLogs.ts` with:

```ts
import { Buffer } from "node:buffer";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { nextAction } from "./protocol/reconstruct";
import { parseSegmentKey, SegmentRef } from "./protocol/segments";
import { createAdapter } from "./storage/createAdapter";
import { StorageAdapter } from "./storage/StorageAdapter";
import { CollectorConfig } from "./collect/collectorConfig";

export interface CollectStats {
  segmentsFetched: number;
  bytesAppended: number;
  filesUpdated: string[];
  gaps: string[];
}

/** Stable per-(host, logFile, gen8) output name; gen8 is content-derived. */
export function outputNameFor(ref: SegmentRef): string {
  const base = ref.logFileName.endsWith(".txt")
    ? ref.logFileName.slice(0, -4)
    : ref.logFileName;
  return `${base}.${ref.hostname}.${ref.gen8}.txt`;
}

export async function runCollection(
  config: CollectorConfig,
  adapter: StorageAdapter = createAdapter(config.storage),
): Promise<CollectStats> {
  const outDir = config.outputDir;
  mkdirSync(outDir, { recursive: true });

  const stats: CollectStats = {
    segmentsFetched: 0,
    bytesAppended: 0,
    filesUpdated: [],
    gaps: [],
  };
  const refs = (await adapter.list("raw/"))
    .map(parseSegmentKey)
    .filter((r): r is SegmentRef => r !== null);

  const groups = new Map<string, SegmentRef[]>();
  for (const ref of refs) {
    const k = `${ref.hostname}/${ref.logFileName}/${ref.gen8}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(ref);
  }

  for (const [groupKey, group] of groups) {
    const outPath = path.join(outDir, outputNameFor(group[0]));
    const byId = new Map(group.map((r) => [`${r.startOffset}_${r.length}`, r]));
    const remaining = new Set(byId.keys());
    let updated = false;

    for (;;) {
      const size = existsSync(outPath) ? statSync(outPath).size : 0;
      const spans = [...remaining].map((id) => {
        const r = byId.get(id)!;
        return { startOffset: r.startOffset, length: r.length };
      });
      const action = nextAction(size, spans);
      if (action.type === "done") break;
      if (action.type === "gap") {
        const w = `${groupKey}: gap at ${action.expected}, next ${action.nextAvailable}`;
        console.warn(`[collect] WARN ${w}`);
        stats.gaps.push(w);
        break;
      }
      const ref = byId.get(`${action.startOffset}_${action.length}`)!;
      let body: Buffer;
      try {
        body = zlib.gunzipSync(await adapter.get(ref.key));
      } catch {
        // Partially synced / corrupt: not ready. Drop from this run's set and
        // let nextAction pick a shorter complete segment, else gap out and retry
        // on the next poll — never append truncated bytes.
        console.warn(`[collect] ${ref.key} not fully synced yet — deferring`);
        remaining.delete(`${action.startOffset}_${action.length}`);
        continue;
      }
      const seek = size - ref.startOffset; // >= 0 by nextAction's covering contract
      const tail = body.subarray(seek);
      remaining.delete(`${action.startOffset}_${action.length}`);
      if (tail.length === 0) continue;
      const existing = existsSync(outPath)
        ? readFileSync(outPath)
        : Buffer.alloc(0);
      const tmp = `${outPath}.tmp`;
      writeFileSync(tmp, Buffer.concat([existing, tail]));
      renameSync(tmp, outPath);
      stats.segmentsFetched += 1;
      stats.bytesAppended += tail.length; // advance by ACTUAL bytes, not the key's claim
      updated = true;
    }
    if (updated) stats.filesUpdated.push(path.basename(outPath));
  }

  console.log(
    `[collect] +${stats.bytesAppended}B across ${stats.filesUpdated.length} file(s)` +
      (stats.gaps.length ? `, ${stats.gaps.length} gap warning(s)` : ""),
  );
  return stats;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/collectLogs.test.ts`
Expected: PASS (both cases: overlap recovery to 120 bytes; truncated segment deferred with 0 appended).

- [ ] **Step 5: Commit**

```bash
git add packages/log-pipeline/src/collectLogs.ts packages/log-pipeline/src/collectLogs.test.ts
git commit -m "feat(log-pipeline): overlap-aware, gunzip-validated collection to outputDir"
```

---

### Task 7: CLI entrypoints — stream (reuse) + collect (poll loop)

**Files:**

- Modify: `packages/log-pipeline/src/collect/collectorConfig.ts` (loader shape)
- Create: `packages/log-pipeline/src/collectCli.ts`
- Verify: `packages/log-pipeline/src/streamCli.ts` (already calls `main()` from Task 2)

**Interfaces:**

- Consumes: `runCollection` (Task 6); `cleanupAppliedSegments` (ported cleanup.ts).
- Produces: `loadCollectorConfig(path): CollectorConfig`; `gladlog-collect --config collect.json` poll loop.

- [ ] **Step 1: Replace collectorConfig loader**

`packages/log-pipeline/src/collect/collectorConfig.ts`:

```ts
import { readFileSync } from "node:fs";
import { StorageConfig } from "../config";

export interface CollectorConfig {
  storage: StorageConfig;
  outputDir: string;
  pollIntervalMs: number;
  cleanup: boolean;
}

export function loadCollectorConfig(path: string): CollectorConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Collector config not found or unreadable: ${path}`);
  }
  let json: Partial<CollectorConfig>;
  try {
    json = JSON.parse(raw) as Partial<CollectorConfig>;
  } catch {
    throw new Error(`Collector config error: invalid JSON in ${path}`);
  }
  if (
    !json.storage ||
    json.storage.provider !== "localDir" ||
    !json.storage.directory
  ) {
    throw new Error(
      `Collector config error: "storage" must be { provider:"localDir", directory } in ${path}`,
    );
  }
  if (!json.outputDir || typeof json.outputDir !== "string") {
    throw new Error(
      `Collector config error: "outputDir" (string) is required in ${path}`,
    );
  }
  return {
    storage: json.storage,
    outputDir: json.outputDir,
    pollIntervalMs: json.pollIntervalMs ?? 15000,
    cleanup: json.cleanup ?? false,
  };
}
```

- [ ] **Step 2: Write the collect CLI**

Create `packages/log-pipeline/src/collectCli.ts`:

```ts
import { loadCollectorConfig } from "./collect/collectorConfig";
import { runCollection } from "./collectLogs";
import { cleanupAppliedSegments } from "./cleanup";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const configPath = argValue("--config") ?? "collect.config.json";
  const config = loadCollectorConfig(configPath);
  console.warn(
    `[collect] watching ${config.storage.directory} → ${config.outputDir} every ${config.pollIntervalMs}ms`,
  );
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
  });
  for (;;) {
    try {
      await runCollection(config);
      if (config.cleanup) {
        await cleanupAppliedSegments({
          syncFolderRoot: config.storage.directory,
          logsDir: config.outputDir,
          cleanupAfterDays: 7,
        });
      }
    } catch (e) {
      console.error(
        `[collect] run error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (stop || config.pollIntervalMs <= 0) break;
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

main().catch((e) => {
  console.error("[collect] fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke-run both CLIs against a temp Drive-like folder**

Run:

```bash
cd packages/log-pipeline
printf '1/1 hello\n2/2 world\n' > /tmp/lp-src.txt
# stream one flush into a fake drive dir via a tiny config, then collect once:
mkdir -p /tmp/lp-drive /tmp/lp-out
cat > /tmp/lp-collect.json <<JSON
{ "storage": { "provider": "localDir", "directory": "/tmp/lp-drive" }, "outputDir": "/tmp/lp-out", "pollIntervalMs": 0, "cleanup": false }
JSON
npx tsx src/collectCli.ts --config /tmp/lp-collect.json
```

Expected: exits cleanly (no segments yet → 0 appended). Full round-trip is Task 8.

- [ ] **Step 4: Typecheck + lint**

Run: `cd packages/log-pipeline && npm run typecheck && cd ../.. && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/log-pipeline/src/collect/collectorConfig.ts packages/log-pipeline/src/collectCli.ts
git commit -m "feat(log-pipeline): collect CLI poll loop + outputDir config"
```

---

### Task 8: End-to-end round-trip + crash/partial-sync regression

**Files:**

- Test: `packages/log-pipeline/src/roundtrip.test.ts`

**Interfaces:**

- Consumes: `flushFile` (Task 5), `runCollection` (Task 6), `MemoryStorageAdapter`.

- [ ] **Step 1: Write the test**

Create `packages/log-pipeline/src/roundtrip.test.ts`:

```ts
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flushFile } from "./flusher";
import { runCollection } from "./collectLogs";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter";
import type { FileCheckpoint } from "./state";

function collectCfg(outDir: string) {
  return {
    storage: { provider: "localDir" as const, directory: "x" },
    outputDir: outDir,
    pollIntervalMs: 0,
    cleanup: false,
  };
}

describe("streamer→collector round-trip", () => {
  it("reconstructs the log byte-exactly across multiple flushes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-"));
    const filePath = join(dir, "WoWCombatLog.txt");
    const a = new MemoryStorageAdapter();
    const outDir = mkdtempSync(join(tmpdir(), "rt-out-"));

    writeFileSync(filePath, "1/1 alpha\n");
    let cp: FileCheckpoint | undefined = (
      await flushFile({
        filePath,
        logFileName: "WoWCombatLog.txt",
        hostname: "pc",
        checkpoint: undefined,
        adapter: a,
      })
    ).checkpoint;
    appendFileSync(filePath, "2/2 beta\n3/3 gamma\n");
    cp = (
      await flushFile({
        filePath,
        logFileName: "WoWCombatLog.txt",
        hostname: "pc",
        checkpoint: cp,
        adapter: a,
      })
    ).checkpoint;
    expect(cp?.offset).toBe(readFileSync(filePath).length);

    await runCollection(collectCfg(outDir), a);
    const out = readdirSync(outDir).find((f) => f.endsWith(".txt"))!;
    expect(readFileSync(join(outDir, out)).toString()).toBe(
      readFileSync(filePath).toString(),
    );
  });

  it("survives a crash-window re-flush (same offset, longer delta) with no loss/stall", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt2-"));
    const filePath = join(dir, "WoWCombatLog.txt");
    const a = new MemoryStorageAdapter();
    const outDir = mkdtempSync(join(tmpdir(), "rt2-out-"));

    writeFileSync(filePath, "1/1 short\n");
    // Flush A: checkpoint NOT persisted (simulated crash) — offset stays 0.
    await flushFile({
      filePath,
      logFileName: "WoWCombatLog.txt",
      hostname: "pc",
      checkpoint: undefined,
      adapter: a,
    });
    // Collector consumes the short segment.
    await runCollection(collectCfg(outDir), a);
    // File grew; re-flush from offset 0 (stale checkpoint) writes a longer segment.
    appendFileSync(filePath, "2/2 more bytes here\n");
    await flushFile({
      filePath,
      logFileName: "WoWCombatLog.txt",
      hostname: "pc",
      checkpoint: undefined,
      adapter: a,
    });
    // Collector must recover the extra bytes, not stall.
    await runCollection(collectCfg(outDir), a);

    const out = readdirSync(outDir).find((f) => f.endsWith(".txt"))!;
    expect(readFileSync(join(outDir, out)).toString()).toBe(
      readFileSync(filePath).toString(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `npx vitest run src/roundtrip.test.ts`
Expected: both tests PASS — byte-exact reconstruction across flushes, and crash-window recovery (the longer re-flush's tail is recovered, no stall).

- [ ] **Step 3: Full package suite + typecheck**

Run: `cd packages/log-pipeline && npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/log-pipeline/src/roundtrip.test.ts
git commit -m "test(log-pipeline): byte-exact round-trip + crash-window regression"
```

---

### Task 9: Windows build of the main desktop app

**Files:**

- Modify: `packages/desktop/package.json` (add `build` block)
- Create: `packages/desktop/build/icon.ico` (original 256px icon)

**Interfaces:**

- Consumes: `electron-vite build` output in `packages/desktop/out/`.
- Produces: a Windows `zip` build under `packages/desktop/release/` (installer path documented, gated on Wine/Windows).

- [ ] **Step 1: Create an original app icon**

Generate a simple original 256×256 mark (no upstream/WoW imagery) and write `packages/desktop/build/icon.ico`. Command (uses a generated PNG → ICO; if `iconutil`/`sips` unavailable, create a 256×256 PNG and convert with an installed tool):

```bash
cd packages/desktop && mkdir -p build
# Minimal original mark: a solid rounded square with "gl" — produce PNG then ICO.
# (Use any available converter; the deliverable is build/icon.ico, 256px.)
```

Expected: `packages/desktop/build/icon.ico` exists, 256×256.

- [ ] **Step 2: Add the electron-builder build config**

In `packages/desktop/package.json`, add:

```json
"build": {
  "appId": "com.gladlog.desktop",
  "productName": "gladlog",
  "directories": { "output": "release", "buildResources": "build" },
  "files": ["out/**", "package.json"],
  "win": { "target": ["zip", "nsis"], "icon": "build/icon.ico" },
  "nsis": { "oneClick": false, "perMachine": false, "allowToChangeInstallationDirectory": true }
}
```

- [ ] **Step 3: Build the app bundle**

Run: `cd packages/desktop && npm run build`
Expected: `out/main`, `out/preload`, `out/renderer` populated.

- [ ] **Step 4: Produce the Windows zip from macOS (no Wine needed)**

Run: `cd packages/desktop && npx electron-builder --win zip`
Expected: `release/` contains a `gladlog-<version>-win.zip` with the packaged app + icon. If electron-builder tries NSIS and fails for lack of Wine, that is expected — the `zip` target still succeeds; the NSIS installer is produced later via `brew install --cask wine-stable` here or `npm run package:win` on Windows (documented; user-gated).

- [ ] **Step 5: Verify + commit**

Run: `unzip -l release/*.zip | grep -i gladlog | head`
Expected: the app tree is present.

```bash
git add packages/desktop/package.json packages/desktop/build/icon.ico
git commit -m "build(desktop): electron-builder Windows config + original icon"
```

(Do not commit `release/` — add it to `.gitignore` if not already ignored.)

---

## Self-Review

**Spec coverage:**

- log-pipeline package + reuse/drop → Task 2. ✓
- Protocol hardening (length keys, overlap, gunzip-validate, advance-by-actual) → Tasks 3–6. ✓
- CLI + config surface → Task 7 (stream reuses `main()`; collect poll loop). ✓
- Drive robustness (defer partial gzip, gap wait, conflict-copy reject) → Tasks 4/6 + segments reject test. ✓
- Lint → Task 1. ✓
- Windows build (config, icon, win-zip, installer gate) → Task 9. ✓
- Compliance (controller extraction, subagents don't read old fork) → Execution Model + Task 2. ✓
- Testing (protocol units, round-trip, crash/partial regressions) → Tasks 3–8. ✓

**Type consistency:** `SegmentRef`/`SegmentSpan` carry `length` (Tasks 3/4); `nextAction(currentSize, SegmentSpan[])` used identically in Task 6; `CollectorConfig { storage; outputDir; pollIntervalMs; cleanup }` defined in Task 7's `collectorConfig.ts` and consumed by Task 6's `runCollection` and Task 7's CLI; `buildSegmentKey(...,startOffset,length)` defined Task 3, called Task 5. Consistent.

**Placeholder scan:** Task 9 Step 1 leaves icon _generation_ to available tooling (deliverable is exact: `build/icon.ico`, 256px) — acceptable, as the tool varies by machine. No other vague steps.

**Known deviations from spec:** `pilotConfig`/`detect`/`streamerService`/`collectorService` are deferred (YAGNI — no pilot GUI this plan), which slightly narrows the spec's "keep in tree"; the substantive logic is reused. Flagged in File Structure.
