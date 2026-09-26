# Subproject 2: Desktop Shell (Electron + Vite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron + Vite + React desktop shell: monitor/read/parse WoW logs in worker → persist to disk in main process → debug-grade real-time UI, packagable.

**Architecture:** Single package `packages/desktop` (electron-vite three-part build + worker entry). utilityProcess worker owns fs.watch + tail reading + `GladLogParser`, emitting only lightweight match/diagnostic/status events to main process; checkpoints advance only at safe boundaries where "parser has no open segment"; main process handles persistence (meta/match/raw three files), settings, and IPC bridge (`window.gladlog`). Spec: `docs/specs/2026-07-10-desktop-shell-design.md`.

**Tech Stack:** TypeScript (ESM), electron, electron-vite, vite, react 19, vitest (globals), electron-builder, electron-log, `@gladlog/parser` (workspace).

## Global Constraints

- **Compliance (Hard requirement)**: The implementer must NOT read any upstream source code under `/Users/mingjianliu/code/wowarenalogs`. This plan embeds all proprietary code to port (watcher/checkpoint/detect semantics); implement against the code in this plan without referencing the old fork. Code within the gladlog repository itself (parser, etc.) may be referenced freely.
- Zero upstream code; zero runtime cloud dependencies; `@gladlog/parser-compat` does not enter the shell.
- ESM (`"type": "module"`), TS strict, vitest `globals: true`, tests placed in package `test/` — consistent with parser package conventions.
- Test command: `npm test -w @gladlog/desktop`; typecheck: `npm run typecheck -w @gladlog/desktop`. Root command `npm test --workspaces --if-present` must always remain all green.
- TDD, one commit per task, conventional commits for commit messages.
- retail-only; no auto-updates; no code signing / notarization.
- Event channels uniformly prefixed with `gladlog:`; external global object named `window.gladlog`.

## File Structure Overview

```
packages/desktop/
  package.json  tsconfig.json  tsconfig.node.json  vitest.config.ts
  electron.vite.config.ts  electron-builder.yml
  src/shared/protocol.ts          # main↔worker message types + FileCheckpoint (Task 3)
  src/main/index.ts               # Lifecycle + window + assembly (Task 12)
  src/main/workerHost.ts          # utilityProcess spawn/restart/quarantine (Task 10)
  src/main/crashPolicy.ts         # Crash attribution pure function (Task 10)
  src/main/matchStore.ts          # Persistence/indexing/dedup (Task 11)
  src/main/settingsStore.ts       # settings.json (Task 3)
  src/main/detectWowDir.ts        # WoW directory detection + resolveLogsDir (Task 4)
  src/main/ipc.ts                 # ipcMain registration (Task 12)
  src/worker/index.ts             # utilityProcess entry (Task 9)
  src/worker/runtime.ts           # configure→scan→watch assembly, injectable transport (Task 9)
  src/worker/watcher.ts           # Directory watching (Task 6)
  src/worker/tailReader.ts        # Incremental read + rotation/truncation detection (Task 7)
  src/worker/checkpoints.ts       # checkpoint registry (Task 5)
  src/worker/pipeline.ts          # FilePipeline: feed parser + safe boundary (Task 8)
  src/preload/index.ts            # contextBridge (Task 12)
  src/preload/api.ts              # GladlogApi types (Task 12)
  src/renderer/index.html  src/renderer/src/main.tsx  src/renderer/src/App.tsx
  src/renderer/src/styles.css     # Debug page (Task 2 scaffold, Task 13 complete)
  scripts/replay-log.mjs          # e2e append replay (Task 14)
  test/*.test.ts                  # Tests corresponding to each task
packages/parser/src/l2/segmenter.ts + src/api.ts   # Task 1 add read-only accessor
```

---

### Task 1: parser read-only accessor `hasOpenSegment()`

**Files:**

- Modify: `packages/parser/src/l2/segmenter.ts` (add a method inside the class)
- Modify: `packages/parser/src/api.ts` (add delegation method to `GladLogParser`)
- Test: `packages/parser/test/l2.openSegment.test.ts`

**Interfaces:**

- Consumes: `Segmenter` existing private field `state: "IDLE" | "IN_MATCH" | "IN_SHUFFLE"` (`segmenter.ts:9`).
- Produces: `Segmenter.hasOpenSegment(): boolean`, `GladLogParser.hasOpenSegment(): boolean` — true when `state !== "IDLE"` (intermissions between shuffle rounds also count as open because the shuffle sequence has not closed yet). Depended upon by Task 8.

- [ ] **Step 1: Write failing test**

```ts
// packages/parser/test/l2.openSegment.test.ts
import { GladLogParser } from "../src/api";

function line(i: number, s: string): string {
  return `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`;
}
const CAST =
  'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70';

describe("hasOpenSegment", () => {
  it("IDLE→false, in match→true, after END→false", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    expect(p.hasOpenSegment()).toBe(false);
    p.push(line(0, "ARENA_MATCH_START,1825,41,3v3,1"));
    expect(p.hasOpenSegment()).toBe(true);
    p.push(line(1, CAST));
    expect(p.hasOpenSegment()).toBe(true);
    p.push(line(2, "ARENA_MATCH_END,1,30,1500,1501"));
    expect(p.hasOpenSegment()).toBe(false);
  });

  it("shuffle round intermission remains open (sequence unclosed)", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    p.push(line(0, "ARENA_MATCH_START,1825,41,Rated Solo Shuffle,1"));
    p.push(line(1, CAST));
    p.push(line(2, "ARENA_MATCH_END,1,30,1500,1501"));
    // Round 1 ended but shuffle is not closed
    expect(p.hasOpenSegment()).toBe(true);
  });
});
```

Note: shuffle determination depends on `Segmenter`'s bracket recognition; if that bracket string doesn't trigger the IN_SHUFFLE path, first read `packages/parser/src/l2/segmenter.ts` and `test/l2.segmenter.synthetic.test.ts` for actual START parameters used in shuffle scenarios and replace with the same (**only check within this repository**).

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run test/l2.openSegment.test.ts` (cwd `packages/parser`)
Expected: FAIL, `hasOpenSegment is not a function`

- [ ] **Step 3: Minimal implementation**

```ts
// In segmenter.ts class:
public hasOpenSegment(): boolean {
  return this.state !== "IDLE";
}
// In api.ts GladLogParser class:
public hasOpenSegment(): boolean {
  return this.segmenter.hasOpenSegment();
}
```

- [ ] **Step 4: Full regression test**

Run: `npm test -w @gladlog/parser && npm run typecheck -w @gladlog/parser`
Expected: All PASS (zero regressions across ~150 existing tests)

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/l2/segmenter.ts packages/parser/src/api.ts packages/parser/test/l2.openSegment.test.ts
git commit -m "feat(parser): read-only hasOpenSegment() for shell safe-boundary checkpoints"
```

---

### Task 2: desktop package scaffolding (electron-vite three parts + worker entry)

**Files:**

- Create: `packages/desktop/package.json`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `electron.vite.config.ts`, `src/main/index.ts` (temporary hello version), `src/preload/index.ts` (temporary empty bridge), `src/worker/index.ts` (temporary placeholder), `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`

**Interfaces:**

- Produces: Capable of opening window via `npm run dev -w @gladlog/desktop`; `npm run build` outputs `out/main/index.js`, `out/main/worker.js`, `out/preload/index.mjs`, `out/renderer/`. Subsequent tasks replace files on this scaffold.

- [ ] **Step 1: package.json**

```json
{
  "name": "@gladlog/desktop",
  "version": "0.0.1",
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "package:mac": "electron-vite build && electron-builder --mac",
    "package:win": "electron-vite build && electron-builder --win"
  },
  "dependencies": {
    "@gladlog/parser": "0.0.1",
    "electron-log": "^5.2.0"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^38.0.0",
    "electron-builder": "^26.0.0",
    "electron-vite": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

(Versions subject to actual resolution upon `npm install`; if electron-vite major versions differ, adjust based on official template structure while keeping **three-part + worker entry, ESM, and directory layout** invariant.)

- [ ] **Step 2: electron.vite.config.ts + vitest.config.ts + tsconfig**

```ts
// electron.vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@gladlog/parser"] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          worker: resolve(__dirname, "src/worker/index.ts"),
        },
      },
    },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()], root: "src/renderer" },
});
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { globals: true } });
```

```jsonc
// tsconfig.json (src + test, browser/shared side)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "node"],
  },
  "include": ["src", "test"],
}
// tsconfig.node.json can follow main tsconfig essentials; if electron-vite template generates dual tsconfigs, follow template;
// as long as typecheck script covers all src+test, dual -p or merged is acceptable.
```

- [ ] **Step 3: Minimal three-part code**

```ts
// src/main/index.ts (hello version, rewritten in Task 12)
import { app, BrowserWindow } from "electron";
import { join } from "path";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env["ELECTRON_RENDERER_URL"])
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return win;
}
app.whenReady().then(() => createWindow());
app.on("window-all-closed", () => app.quit());
```

```ts
// src/preload/index.ts (empty bridge, rewritten in Task 12)
import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("gladlog", { ping: () => "pong" });
```

```ts
// src/worker/index.ts (placeholder, rewritten in Task 9)
process.parentPort?.on("message", () => {});
```

```html
<!-- src/renderer/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>gladlog</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/renderer/src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

```tsx
// src/renderer/src/App.tsx (hello version, rewritten in Task 13)
export default function App() {
  return <h1>gladlog shell</h1>;
}
```

`styles.css` starts with one line: `body { font-family: ui-monospace, monospace; }`.

- [ ] **Step 4: Install and verify**

Run (repo root): `npm install`
Run: `npm run build -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop && npm test -w @gladlog/desktop`
Expected: build outputs `out/main/index.js` and `out/main/worker.js`; typecheck passes; vitest reports "no test files" (acceptable, `--passWithNoTests` can be added to test script)
Run: `npm run dev -w @gladlog/desktop` (manual/main session verification: verify window shows "gladlog shell", then Ctrl-C)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop package-lock.json
git commit -m "feat(desktop): electron-vite scaffold with main/preload/renderer/worker entries"
```

---

### Task 3: Protocol types + SettingsStore

**Files:**

- Create: `packages/desktop/src/shared/protocol.ts`, `packages/desktop/src/main/settingsStore.ts`
- Test: `packages/desktop/test/settingsStore.test.ts`

**Interfaces:**

- Produces (public contracts across plan, consumed by subsequent tasks with matching signatures):

```ts
// src/shared/protocol.ts —— Full file
import type { GladMatch, GladShuffle } from "@gladlog/parser";

export interface FileCheckpoint {
  offset: number; // Consumed byte offset of complete line end (safe boundary)
  firstLineChecksum: string | null; // sha1 hex of first line; null for empty file
}

export interface WorkerConfig {
  logsDir: string;
  checkpointsPath: string; // Absolute path to checkpoint registry JSON
  quarantined: string[]; // Skipped fileKey (basename)
  flushIntervalMs: number; // Default 2000
  quietPeriodMs: number; // Default 5000
}

export type MainToWorker = { type: "configure"; config: WorkerConfig };

export interface FileStatus {
  fileKey: string;
  offset: number;
  size: number;
  quarantined: boolean;
}

export type WorkerToMain =
  | { type: "match"; fileKey: string; payload: GladMatch }
  | { type: "shuffle"; fileKey: string; payload: GladShuffle }
  | { type: "diagnostic"; fileKey?: string; code: string; detail?: string }
  | {
      type: "status";
      watching: boolean;
      logsDir: string;
      files: FileStatus[];
      current?: { fileKey: string; offset: number }; // Current processing location (for crash attribution)
    };
```

```ts
// settingsStore.ts
export interface GladlogSettings {
  wowDirectory: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string | null;
}
export class SettingsStore {
  constructor(filePath: string);
  get(): GladlogSettings; // Missing/corrupted → all default null
  save(partial: Partial<GladlogSettings>): GladlogSettings; // Merge, atomic write tmp+rename, return new value
}
```

- [ ] **Step 1: Write failing test**

```ts
// test/settingsStore.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsStore } from "../src/main/settingsStore";

const dir = () => mkdtempSync(join(tmpdir(), "gl-settings-"));

describe("SettingsStore", () => {
  it("missing file → defaults", () => {
    const s = new SettingsStore(join(dir(), "settings.json"));
    expect(s.get()).toEqual({
      wowDirectory: null,
      anthropicApiKey: null,
      anthropicModel: null,
    });
  });
  it("save merges and persists; file is valid JSON", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.save({ wowDirectory: "/tmp/wow" }).wowDirectory).toBe("/tmp/wow");
    expect(new SettingsStore(p).get().wowDirectory).toBe("/tmp/wow");
    expect(JSON.parse(readFileSync(p, "utf-8")).anthropicApiKey).toBeNull();
  });
  it("corrupted JSON → fallback to defaults without throwing", () => {
    const p = join(dir(), "settings.json");
    writeFileSync(p, "{not json");
    expect(new SettingsStore(p).get().wowDirectory).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run test/settingsStore.test.ts` (cwd `packages/desktop`)
Expected: FAIL (module does not exist)

- [ ] **Step 3: Implementation**

```ts
// src/main/settingsStore.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface GladlogSettings {
  wowDirectory: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string | null;
}
const DEFAULTS: GladlogSettings = {
  wowDirectory: null,
  anthropicApiKey: null,
  anthropicModel: null,
};

export class SettingsStore {
  constructor(private filePath: string) {}
  get(): GladlogSettings {
    try {
      return {
        ...DEFAULTS,
        ...(JSON.parse(
          readFileSync(this.filePath, "utf-8"),
        ) as Partial<GladlogSettings>),
      };
    } catch {
      return { ...DEFAULTS };
    }
  }
  save(partial: Partial<GladlogSettings>): GladlogSettings {
    const next = { ...this.get(), ...partial };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, this.filePath);
    return next;
  }
}
```

Create `protocol.ts` matching Interfaces section above (type file, covered by typecheck).

- [ ] **Step 4: Verify**

Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/shared/protocol.ts packages/desktop/src/main/settingsStore.ts packages/desktop/test/settingsStore.test.ts
git commit -m "feat(desktop): worker protocol types + atomic SettingsStore"
```

---

### Task 4: WoW directory detection + resolveLogsDir

**Files:**

- Create: `packages/desktop/src/main/detectWowDir.ts`
- Test: `packages/desktop/test/detectWowDir.test.ts`

**Interfaces:**

- Produces:

```ts
export interface FsProbe {
  exists(p: string): boolean;
}
export function realFsProbe(): FsProbe; // existsSync wrapper
export function detectWowDirCandidates(opts: {
  platform: NodeJS.Platform;
  probe: FsProbe;
}): string[];
export function resolveLogsDir(selectedDir: string, probe?: FsProbe): string;
// Selected dir contains Logs subdir → return <dir>/Logs; otherwise return selectedDir itself (mac test dir friendly)
```

Semantics ported from own `pipeline-app/detect.ts` (CLEAN): win32 detects `C:\Program Files (x86)\World of Warcraft\_retail_` and `C:\Program Files\World of Warcraft\_retail_`, requiring directory and its `\Logs` to exist; non-win32 returns `[]`.

- [ ] **Step 1: Write failing test**

```ts
// test/detectWowDir.test.ts
import {
  detectWowDirCandidates,
  resolveLogsDir,
  type FsProbe,
} from "../src/main/detectWowDir";

const probeOf = (existing: string[]): FsProbe => ({
  exists: (p) => existing.includes(p),
});

describe("detectWowDirCandidates", () => {
  it("win32: returns only when both directory + Logs exist", () => {
    const probe = probeOf([
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Logs",
      "C:\\Program Files\\World of Warcraft\\_retail_", // Missing Logs
    ]);
    expect(detectWowDirCandidates({ platform: "win32", probe })).toEqual([
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
    ]);
  });
  it("darwin → []", () => {
    expect(
      detectWowDirCandidates({ platform: "darwin", probe: probeOf([]) }),
    ).toEqual([]);
  });
});

describe("resolveLogsDir", () => {
  it("contains Logs subdir → points to Logs", () => {
    const probe = probeOf(["/x/_retail_/Logs"]);
    expect(resolveLogsDir("/x/_retail_", probe)).toBe("/x/_retail_/Logs");
  });
  it("does not contain Logs → uses original dir", () => {
    expect(resolveLogsDir("/y/mylogs", probeOf([]))).toBe("/y/mylogs");
  });
});
```

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/detectWowDir.test.ts`, Expected: FAIL

- [ ] **Step 3: Implementation**

```ts
// src/main/detectWowDir.ts
import { existsSync } from "fs";
import { join } from "path";

export interface FsProbe {
  exists(p: string): boolean;
}
export function realFsProbe(): FsProbe {
  return { exists: (p) => existsSync(p) };
}

export function detectWowDirCandidates(opts: {
  platform: NodeJS.Platform;
  probe: FsProbe;
}): string[] {
  if (opts.platform !== "win32") return [];
  return [
    "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
    "C:\\Program Files\\World of Warcraft\\_retail_",
  ].filter(
    (dir) => opts.probe.exists(dir) && opts.probe.exists(`${dir}\\Logs`),
  );
}

export function resolveLogsDir(
  selectedDir: string,
  probe: FsProbe = realFsProbe(),
): string {
  const logs = join(selectedDir, "Logs");
  return probe.exists(logs) ? logs : selectedDir;
}
```

- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop`, Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/detectWowDir.ts packages/desktop/test/detectWowDir.test.ts
git commit -m "feat(desktop): WoW dir detection + logs dir resolution (ported own detect.ts semantics)"
```

---

### Task 5: checkpoint registry

**Files:**

- Create: `packages/desktop/src/worker/checkpoints.ts`
- Test: `packages/desktop/test/checkpoints.test.ts`

**Interfaces:**

- Consumes: `FileCheckpoint` (protocol.ts)
- Produces:

```ts
export interface CheckpointRegistry {
  files: Record<string, FileCheckpoint>;
} // key = fileKey (basename)
export function loadCheckpoints(path: string): CheckpointRegistry; // Missing/corrupted → { files: {} }
export function saveCheckpoints(path: string, reg: CheckpointRegistry): void; // Atomic tmp+rename
```

Semantics ported from own `windows-agent/state.ts` (CLEAN, Filebeat registry pattern).

- [ ] **Step 1: Write failing test**

```ts
// test/checkpoints.test.ts
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadCheckpoints, saveCheckpoints } from "../src/worker/checkpoints";

const p = () => join(mkdtempSync(join(tmpdir(), "gl-cp-")), "checkpoints.json");

describe("checkpoints registry", () => {
  it("missing → empty registry", () => {
    expect(loadCheckpoints(p())).toEqual({ files: {} });
  });
  it("save→load roundtrip", () => {
    const path = p();
    const reg = {
      files: { "WoWCombatLog-1.txt": { offset: 42, firstLineChecksum: "ab" } },
    };
    saveCheckpoints(path, reg);
    expect(loadCheckpoints(path)).toEqual(reg);
  });
  it("corrupted JSON → empty registry without throwing", () => {
    const path = p();
    writeFileSync(path, "garbage");
    expect(loadCheckpoints(path)).toEqual({ files: {} });
  });
});
```

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/checkpoints.test.ts`, Expected: FAIL

- [ ] **Step 3: Implementation**

```ts
// src/worker/checkpoints.ts
import { readFileSync, renameSync, writeFileSync } from "fs";
import type { FileCheckpoint } from "../shared/protocol";

export interface CheckpointRegistry {
  files: Record<string, FileCheckpoint>;
}

export function loadCheckpoints(path: string): CheckpointRegistry {
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf-8"),
    ) as CheckpointRegistry;
    return parsed && typeof parsed.files === "object" && parsed.files !== null
      ? parsed
      : { files: {} };
  } catch {
    return { files: {} };
  }
}

export function saveCheckpoints(path: string, reg: CheckpointRegistry): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2));
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop`, Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/checkpoints.ts packages/desktop/test/checkpoints.test.ts
git commit -m "feat(desktop): atomic checkpoint registry (ported own state.ts pattern)"
```

---

### Task 6: LogWatcher (Port own watcher)

**Files:**

- Create: `packages/desktop/src/worker/watcher.ts`
- Test: `packages/desktop/test/watcher.test.ts`

**Interfaces:**

- Produces:

```ts
export interface LogWatcher {
  close(): void;
  handleEvent(eventType: string, fileName: string | Buffer | null): void;
}
export function startLogWatcher(opts: {
  logsDir: string;
  flushIntervalMs: number;
  quietPeriodMs: number;
  onFlush: (fileNames: string[]) => Promise<void>;
  watchFn?: typeof import("fs").watch;
}): LogWatcher;
```

**Implementation is the code below** (Port of own CLEAN asset `windows-agent/watcher.ts`, retaining behavioral semantics item-by-item: event-driven zero polling, dirty set, re-insert on flush failure for retry, quiet supplemental flush, stop timers on idle, ignore rename, filter `WoWCombatLog*.txt`; only log prefix changed):

```ts
// src/worker/watcher.ts —— Full file
import { watch } from "fs";

export interface LogWatcher {
  close(): void;
  /** Exposed for tests; production events arrive via fs.watch. */
  handleEvent(eventType: string, fileName: string | Buffer | null): void;
}

export function startLogWatcher(opts: {
  logsDir: string;
  flushIntervalMs: number;
  quietPeriodMs: number;
  onFlush: (fileNames: string[]) => Promise<void>;
  watchFn?: typeof watch;
}): LogWatcher {
  const dirty = new Set<string>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let closed = false;

  const drain = async (): Promise<void> => {
    if (flushing) {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        void drain();
      }, 5000);
      return;
    }
    if (dirty.size === 0) return;
    const files = [...dirty].sort();
    dirty.clear();
    flushing = true;
    try {
      await opts.onFlush(files);
    } catch (e) {
      // Flush failure must not kill watcher; checkpoint unadvanced, re-add dirty set to retry same byte range next round
      for (const f of files) dirty.add(f);
      console.error(
        `[gladlog-worker] flush failed: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      flushing = false;
    }
  };

  const stopTimers = () => {
    if (interval) clearInterval(interval);
    interval = null;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
  };

  const handleEvent = (
    eventType: string,
    fileName: string | Buffer | null,
  ): void => {
    if (closed || eventType === "rename") return;
    if (
      typeof fileName !== "string" ||
      !fileName.includes("WoWCombatLog") ||
      !fileName.endsWith(".txt")
    )
      return;
    dirty.add(fileName);

    if (!interval) {
      interval = setInterval(() => {
        void drain();
        if (dirty.size === 0 && !flushing) stopTimers();
      }, opts.flushIntervalMs);
    }
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      void drain();
    }, opts.quietPeriodMs);
  };

  const watcher = (opts.watchFn ?? watch)(opts.logsDir, handleEvent);

  return {
    handleEvent,
    close(): void {
      closed = true;
      stopTimers();
      watcher.close();
    },
  };
}
```

- [ ] **Step 1: Write failing test** (fake timers + injected watchFn, no touching real fs)

```ts
// test/watcher.test.ts
import { startLogWatcher, type LogWatcher } from "../src/worker/watcher";

const noopWatch = (() => ({
  close() {},
})) as unknown as typeof import("fs").watch;

function make(onFlush: (f: string[]) => Promise<void>): LogWatcher {
  return startLogWatcher({
    logsDir: "/dev/null",
    flushIntervalMs: 100,
    quietPeriodMs: 300,
    onFlush,
    watchFn: noopWatch,
  });
}

describe("startLogWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("change events enter dirty set, interval triggers flush with sorted file names", async () => {
    const seen: string[][] = [];
    const w = make(async (f) => {
      seen.push(f);
    });
    w.handleEvent("change", "WoWCombatLog-2.txt");
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([["WoWCombatLog-1.txt", "WoWCombatLog-2.txt"]]);
    w.close();
  });

  it("rename and non-WoWCombatLog*.txt are ignored", async () => {
    const seen: string[][] = [];
    const w = make(async (f) => {
      seen.push(f);
    });
    w.handleEvent("rename", "WoWCombatLog-1.txt");
    w.handleEvent("change", "other.txt");
    w.handleEvent("change", "WoWCombatLog-1.log");
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([]);
    w.close();
  });

  it("flush failure → re-inserts files for next round retry", async () => {
    let calls = 0;
    const w = make(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(100); // Fail
    await vi.advanceTimersByTimeAsync(100); // Retry success
    expect(calls).toBe(2);
    w.close();
  });

  it("quiet period triggers an extra flush after last event", async () => {
    const seen: string[][] = [];
    const w = startLogWatcher({
      logsDir: "/dev/null",
      flushIntervalMs: 10_000,
      quietPeriodMs: 300,
      onFlush: async (f) => {
        seen.push(f);
      },
      watchFn: noopWatch,
    });
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(300);
    expect(seen).toHaveLength(1);
    w.close();
  });

  it("events after close are ignored", async () => {
    const seen: string[][] = [];
    const w = make(async (f) => {
      seen.push(f);
    });
    w.close();
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/watcher.test.ts`, Expected: FAIL
- [ ] **Step 3: Implement matching above** — Create `src/worker/watcher.ts`
- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop`, Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/watcher.ts packages/desktop/test/watcher.test.ts
git commit -m "feat(desktop): event-driven log watcher (ported own windows-agent watcher)"
```

---

### Task 7: TailReader (Incremental read + rotation/truncation detection, byte-accurate)

**Files:**

- Create: `packages/desktop/src/worker/tailReader.ts`
- Test: `packages/desktop/test/tailReader.test.ts`

**Interfaces:**

- Consumes: `FileCheckpoint`
- Produces:

```ts
export interface TailState {
  offset: number; // Consumed byte offset of complete line end
  firstLineChecksum: string | null;
  carry: Buffer; // Incomplete line bytes at EOF (preserved across flushes)
}
export function initialTailState(cp?: FileCheckpoint | null): TailState;
export function firstLineChecksumOf(filePath: string): string | null; // First line (≤4096B) sha1 hex; null for empty file
export function readTail(
  filePath: string,
  state: TailState,
): { lines: string[]; state: TailState; rotated: boolean };
// rotated=true when size < state.offset or first line checksum mismatches state — returned lines are reread from 0, state reset to new file baseline
```

Behavioral essentials: Split lines by `\n` bytes, strip trailing `\r`, decode UTF-8 per line (carry is Buffer, naturally preventing multi-byte chars from being split across chunk boundaries); `state.offset` only advances to the end of the last complete line (including newline); file not found → return `{ lines: [], rotated: false }` unchanged; chunked reads (8MB) to control memory.

- [ ] **Step 1: Write failing test**

```ts
// test/tailReader.test.ts
import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { initialTailState, readTail } from "../src/worker/tailReader";

const dir = () => mkdtempSync(join(tmpdir(), "gl-tail-"));

describe("readTail", () => {
  it("fresh file reads complete lines from 0, offset stops at last complete line end", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\nline2\npartial");
    const r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["line1", "line2"]);
    expect(r.state.offset).toBe("line1\nline2\n".length);
    expect(r.rotated).toBe(false);
  });

  it("incremental: carry and subsequent append combine into complete line", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\npar");
    let r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["line1"]);
    appendFileSync(f, "tial\nline3\n");
    r = readTail(f, r.state);
    expect(r.lines).toEqual(["partial", "line3"]);
  });

  it("CRLF lines strip \\r; multi-byte UTF-8 does not break across chunks", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "Ragnaros\r\nSecond Line\r\n");
    const r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["Ragnaros", "Second Line"]);
  });

  it("truncation (size < offset) → rotated, reread from 0", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\ncccc\n");
    let r = readTail(f, initialTailState());
    writeFileSync(f, "new1\n"); // Truncated rewrite
    r = readTail(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["new1"]);
  });

  it("same size with changed content (first line checksum changed) → rotated", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\n");
    let r = readTail(f, initialTailState());
    writeFileSync(f, "zzzz\nbbbb\n"); // Same size, first line changed
    r = readTail(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["zzzz", "bbbb"]);
  });

  it("no new content → empty lines, state unchanged", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\n");
    const r1 = readTail(f, initialTailState());
    const r2 = readTail(f, r1.state);
    expect(r2.lines).toEqual([]);
    expect(r2.state.offset).toBe(r1.state.offset);
  });

  it("file does not exist → empty result without throwing", () => {
    const r = readTail(join(dir(), "nope.txt"), initialTailState());
    expect(r.lines).toEqual([]);
    expect(r.rotated).toBe(false);
  });
});
```

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/tailReader.test.ts`, Expected: FAIL

- [ ] **Step 3: Implementation**

```ts
// src/worker/tailReader.ts
import { createHash } from "crypto";
import { closeSync, openSync, readSync, statSync } from "fs";
import type { FileCheckpoint } from "../shared/protocol";

export interface TailState {
  offset: number;
  firstLineChecksum: string | null;
  carry: Buffer;
}

const CHUNK = 8 * 1024 * 1024;

export function initialTailState(cp?: FileCheckpoint | null): TailState {
  return {
    offset: cp?.offset ?? 0,
    firstLineChecksum: cp?.firstLineChecksum ?? null,
    carry: Buffer.alloc(0),
  };
}

export function firstLineChecksumOf(filePath: string): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    if (n <= 0) return null;
    const nl = buf.subarray(0, n).indexOf(0x0a);
    const head = buf.subarray(0, nl === -1 ? n : nl);
    return createHash("sha1").update(head).digest("hex");
  } finally {
    closeSync(fd);
  }
}

export function readTail(
  filePath: string,
  state: TailState,
): { lines: string[]; state: TailState; rotated: boolean } {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return { lines: [], state, rotated: false };
  }

  const checksum = firstLineChecksumOf(filePath);
  const rotated =
    size < state.offset ||
    (state.firstLineChecksum !== null &&
      checksum !== null &&
      checksum !== state.firstLineChecksum);

  let cur: TailState = rotated
    ? { offset: 0, firstLineChecksum: checksum, carry: Buffer.alloc(0) }
    : { ...state, firstLineChecksum: state.firstLineChecksum ?? checksum };

  const lines: string[] = [];
  let readFrom = cur.offset + cur.carry.length;
  if (readFrom >= size) return { lines, state: cur, rotated };

  const fd = openSync(filePath, "r");
  try {
    let carry = cur.carry;
    let offset = cur.offset;
    while (readFrom < size) {
      const want = Math.min(CHUNK, size - readFrom);
      const buf = Buffer.alloc(want);
      const n = readSync(fd, buf, 0, want, readFrom);
      if (n <= 0) break;
      readFrom += n;
      let data = Buffer.concat([carry, buf.subarray(0, n)]);
      let start = 0;
      for (;;) {
        const nl = data.indexOf(0x0a, start);
        if (nl === -1) break;
        let end = nl;
        if (end > start && data[end - 1] === 0x0d) end--;
        lines.push(data.subarray(start, end).toString("utf-8"));
        start = nl + 1;
      }
      offset += start; // Only advance to last complete line end
      carry = data.subarray(start);
    }
    cur = {
      offset,
      firstLineChecksum: cur.firstLineChecksum,
      carry: Buffer.from(carry),
    };
  } finally {
    closeSync(fd);
  }
  return { lines, state: cur, rotated };
}
```

- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop`, Expected: All PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/tailReader.ts packages/desktop/test/tailReader.test.ts
git commit -m "feat(desktop): byte-accurate tail reader with rotation/truncation detection"
```

---

### Task 8: FilePipeline (Feed parser + safe-boundary checkpoints)

**Files:**

- Create: `packages/desktop/src/worker/pipeline.ts`
- Test: `packages/desktop/test/pipeline.test.ts`

**Interfaces:**

- Consumes: `readTail`/`initialTailState`/`TailState` (Task 7), `GladLogParser.hasOpenSegment()` (Task 1), `WorkerToMain`/`FileCheckpoint` (Task 3)
- Produces:

```ts
export interface ParserLike {
  push(line: string): void;
  end(): void;
  hasOpenSegment(): boolean;
  on(
    event: "match" | "shuffle" | "diagnostic",
    cb: (payload: never) => void,
  ): unknown;
}
export class FilePipeline {
  constructor(opts: {
    fileKey: string;
    filePath: string;
    checkpoint: FileCheckpoint | null; // null = new file
    emit: (msg: WorkerToMain) => void;
    parserFactory?: () => ParserLike; // Default () => new GladLogParser()
  });
  processFlush(): void; // Read delta → feed lines → advance checkpoint on safe boundary; recreate parser on rotation
  get checkpoint(): FileCheckpoint; // Current safe boundary (for registry persistence)
  get currentOffset(): number; // Read line-end offset (for status)
}
```

Checkpoint semantics (spec core): After `processFlush` finishes feeding the current batch, only if `parser.hasOpenSegment() === false` does checkpoint advance to `tailState.offset`; while open, checkpoint stays in place (replaying from last safe boundary upon restart/crash, absorbed by matchId dedup). Rotation (`rotated`) → recreate parser instance + reset checkpoint baseline (new checksum). match/shuffle/diagnostic events wired at construction and converted to `WorkerToMain` emit.

- [ ] **Step 1: Write failing test** (fake parser controlling hasOpenSegment; plus a real parser integration test case)

```ts
// test/pipeline.test.ts
import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { WorkerToMain } from "../src/shared/protocol";
import { FilePipeline, type ParserLike } from "../src/worker/pipeline";

const dir = () => mkdtempSync(join(tmpdir(), "gl-pipe-"));

function fakeParser(): ParserLike & {
  pushed: string[];
  open: boolean;
  fire: (ev: string, p: unknown) => void;
} {
  const cbs: Record<string, ((p: unknown) => void)[]> = {};
  return {
    pushed: [] as string[],
    open: false,
    push(l: string) {
      this.pushed.push(l);
    },
    end() {},
    hasOpenSegment() {
      return this.open;
    },
    on(ev: string, cb: (p: never) => void) {
      (cbs[ev] ??= []).push(cb as (p: unknown) => void);
      return this;
    },
    fire(ev: string, p: unknown) {
      for (const cb of cbs[ev] ?? []) cb(p);
    },
  };
}

describe("FilePipeline", () => {
  it("feeds lines; no open segment → checkpoint advances to line end", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "a\nb\n");
    const parser = fakeParser();
    const pipe = new FilePipeline({
      fileKey: "WoWCombatLog-1.txt",
      filePath: f,
      checkpoint: null,
      emit: () => {},
      parserFactory: () => parser,
    });
    pipe.processFlush();
    expect(parser.pushed).toEqual(["a", "b"]);
    expect(pipe.checkpoint.offset).toBe(4);
  });

  it("open segment → checkpoint does not advance; advances on next flush after close", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "start\nmid\n");
    const parser = fakeParser();
    parser.open = true;
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: () => {},
      parserFactory: () => parser,
    });
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe(0); // Safe boundary stayed in place
    expect(pipe.currentOffset).toBe(10); // But read offset advanced
    parser.open = false;
    appendFileSync(f, "end\n");
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe(14);
  });

  it("rotation → recreates parser (new instance receives new lines)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\n");
    const instances: ReturnType<typeof fakeParser>[] = [];
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: () => {},
      parserFactory: () => {
        const p = fakeParser();
        instances.push(p);
        return p;
      },
    });
    pipe.processFlush();
    writeFileSync(f, "new1\n"); // Truncated
    pipe.processFlush();
    expect(instances).toHaveLength(2);
    expect(instances[1]!.pushed).toEqual(["new1"]);
  });

  it("parser events converted to WorkerToMain emit (with fileKey)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "x\n");
    const parser = fakeParser();
    const out: WorkerToMain[] = [];
    new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: (m) => out.push(m),
      parserFactory: () => parser,
    });
    parser.fire("match", { id: "m1" });
    parser.fire("diagnostic", { code: "X" });
    expect(out[0]).toMatchObject({
      type: "match",
      fileKey: "k",
      payload: { id: "m1" },
    });
    expect(out[1]).toMatchObject({
      type: "diagnostic",
      fileKey: "k",
      code: "X",
    });
  });

  it("integration: real GladLogParser parses synthetic match and emits match event", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const CAST =
      'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70';
    const lines = [
      "6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1",
      `6/30/2026 12:00:01.000  ${CAST}`,
      "6/30/2026 12:00:02.000  ARENA_MATCH_END,1,30,1500,1501",
    ];
    writeFileSync(f, lines.join("\n") + "\n");
    const out: WorkerToMain[] = [];
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: (m) => out.push(m),
    });
    pipe.processFlush();
    const match = out.find((m) => m.type === "match");
    expect(match).toBeDefined();
    expect(pipe.checkpoint.offset).toBeGreaterThan(0); // Match closed → safe boundary advanced
  });
});
```

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/pipeline.test.ts`, Expected: FAIL

- [ ] **Step 3: Implementation**

```ts
// src/worker/pipeline.ts
import { GladLogParser } from "@gladlog/parser";
import type { FileCheckpoint, WorkerToMain } from "../shared/protocol";
import { initialTailState, readTail, type TailState } from "./tailReader";

export interface ParserLike {
  push(line: string): void;
  end(): void;
  hasOpenSegment(): boolean;
  on(
    event: "match" | "shuffle" | "diagnostic",
    cb: (payload: never) => void,
  ): unknown;
}

export class FilePipeline {
  private parser!: ParserLike;
  private tail: TailState;
  private cp: FileCheckpoint;
  private readonly fileKey: string;
  private readonly filePath: string;
  private readonly emit: (msg: WorkerToMain) => void;
  private readonly parserFactory: () => ParserLike;

  constructor(opts: {
    fileKey: string;
    filePath: string;
    checkpoint: FileCheckpoint | null;
    emit: (msg: WorkerToMain) => void;
    parserFactory?: () => ParserLike;
  }) {
    this.fileKey = opts.fileKey;
    this.filePath = opts.filePath;
    this.emit = opts.emit;
    this.parserFactory =
      opts.parserFactory ??
      (() => new GladLogParser() as unknown as ParserLike);
    this.cp = opts.checkpoint ?? { offset: 0, firstLineChecksum: null };
    this.tail = initialTailState(this.cp);
    this.createParser();
  }

  private createParser(): void {
    this.parser = this.parserFactory();
    this.parser.on("match", (payload) =>
      this.emit({
        type: "match",
        fileKey: this.fileKey,
        payload: payload as never,
      }),
    );
    this.parser.on("shuffle", (payload) =>
      this.emit({
        type: "shuffle",
        fileKey: this.fileKey,
        payload: payload as never,
      }),
    );
    this.parser.on("diagnostic", (payload) => {
      const d = payload as { code: string; lineRef?: string };
      this.emit({
        type: "diagnostic",
        fileKey: this.fileKey,
        code: d.code,
        detail: d.lineRef,
      });
    });
  }

  processFlush(): void {
    const r = readTail(this.filePath, this.tail);
    if (r.rotated) {
      this.createParser();
      this.cp = { offset: 0, firstLineChecksum: r.state.firstLineChecksum };
    }
    this.tail = r.state;
    for (const line of r.lines) this.parser.push(line);
    if (!this.parser.hasOpenSegment()) {
      this.cp = {
        offset: this.tail.offset,
        firstLineChecksum: this.tail.firstLineChecksum,
      };
    }
  }

  get checkpoint(): FileCheckpoint {
    return this.cp;
  }
  get currentOffset(): number {
    return this.tail.offset;
  }
}
```

- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`, Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/pipeline.ts packages/desktop/test/pipeline.test.ts
git commit -m "feat(desktop): file pipeline with safe-boundary checkpoints and rotation reset"
```

---

### Task 9: worker runtime + utilityProcess entry

**Files:**

- Create: `packages/desktop/src/worker/runtime.ts`, rewrite `packages/desktop/src/worker/index.ts`
- Test: `packages/desktop/test/workerRuntime.test.ts`

**Interfaces:**

- Consumes: All of Tasks 5/6/7/8, `MainToWorker`/`WorkerToMain`/`WorkerConfig`
- Produces:

```ts
export interface WorkerTransport {
  post(msg: WorkerToMain): void;
  onMessage(cb: (msg: MainToWorker) => void): void;
}
export function createWorkerRuntime(opts: {
  transport: WorkerTransport;
  watchFn?: typeof import("fs").watch; // Injected for tests
  parserFactory?: () => import("./pipeline").ParserLike;
}): { dispose(): void };
```

Behavior: Upon receiving `configure` → dispose old watcher/pipelines → `loadCheckpoints(config.checkpointsPath)` → list `WoWCombatLog*.txt` under `logsDir` (excluding `quarantined`) → build `FilePipeline` per file (fileKey=basename) → **initial scan** (call `processFlush` per file) → `startLogWatcher` (onFlush: find/create pipeline per fileName → emit `status` (containing `current: {fileKey, offset}`, emitted before feeding lines for crash attribution) → `processFlush` → update registry → `saveCheckpoints`) → emit watching status. Directory unreadable → `diagnostic { code: "LOGS_DIR_UNREADABLE" }` + `status watching:false` without throwing.

```ts
// src/worker/index.ts —— utilityProcess entry, thin wrapper
import type { MainToWorker, WorkerToMain } from "../shared/protocol";
import { createWorkerRuntime } from "./runtime";

const port = process.parentPort;
if (port) {
  createWorkerRuntime({
    transport: {
      post: (msg: WorkerToMain) => port.postMessage(msg),
      onMessage: (cb) =>
        port.on("message", (e: { data: MainToWorker }) => cb(e.data)),
    },
  });
}
```

- [ ] **Step 1: Write failing test**

```ts
// test/workerRuntime.test.ts
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { MainToWorker, WorkerToMain } from "../src/shared/protocol";
import {
  createWorkerRuntime,
  type WorkerTransport,
} from "../src/worker/runtime";

function harness() {
  const out: WorkerToMain[] = [];
  let deliver: ((m: MainToWorker) => void) | null = null;
  let fsWatchCb: ((ev: string, f: string) => void) | null = null;
  const transport: WorkerTransport = {
    post: (m) => out.push(m),
    onMessage: (cb) => {
      deliver = cb;
    },
  };
  const watchFn = ((_dir: string, cb: (ev: string, f: string) => void) => {
    fsWatchCb = cb;
    return { close() {} };
  }) as unknown as typeof import("fs").watch;
  return {
    out,
    transport,
    watchFn,
    send: (m: MainToWorker) => deliver!(m),
    fileEvent: (f: string) => fsWatchCb!("change", f),
  };
}

const CAST =
  'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70';
const MATCH =
  [
    "6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1",
    `6/30/2026 12:00:01.000  ${CAST}`,
    "6/30/2026 12:00:02.000  ARENA_MATCH_END,1,30,1500,1501",
  ].join("\n") + "\n";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "gl-rt-"));
  const logsDir = join(root, "Logs");
  mkdirSync(logsDir);
  const config = {
    logsDir,
    checkpointsPath: join(root, "cp.json"),
    quarantined: [],
    flushIntervalMs: 50,
    quietPeriodMs: 100,
  };
  return { root, logsDir, config };
}

describe("createWorkerRuntime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("configure → initial scan parses existing files and emits match + status", () => {
    const { logsDir, config } = setup();
    writeFileSync(join(logsDir, "WoWCombatLog-1.txt"), MATCH);
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({ type: "configure", config });
    expect(h.out.some((m) => m.type === "match")).toBe(true);
    const status = h.out.filter((m) => m.type === "status").at(-1)!;
    expect(status.type === "status" && status.watching).toBe(true);
    rt.dispose();
  });

  it("watcher event-driven incremental parsing of new matches", async () => {
    const { logsDir, config } = setup();
    const f = join(logsDir, "WoWCombatLog-1.txt");
    writeFileSync(f, "");
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({ type: "configure", config });
    appendFileSync(f, MATCH);
    h.fileEvent("WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(50);
    expect(h.out.some((m) => m.type === "match")).toBe(true);
    rt.dispose();
  });

  it("quarantined files are skipped", () => {
    const { logsDir, config } = setup();
    writeFileSync(join(logsDir, "WoWCombatLog-1.txt"), MATCH);
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({
      type: "configure",
      config: { ...config, quarantined: ["WoWCombatLog-1.txt"] },
    });
    expect(h.out.some((m) => m.type === "match")).toBe(false);
    const status = h.out.filter((m) => m.type === "status").at(-1)!;
    expect(
      status.type === "status" && status.files.some((x) => x.quarantined),
    ).toBe(true);
    rt.dispose();
  });

  it("checkpoint persistence: does not re-emit parsed matches after runtime recreation", () => {
    const { logsDir, config } = setup();
    writeFileSync(join(logsDir, "WoWCombatLog-1.txt"), MATCH);
    const h1 = harness();
    const rt1 = createWorkerRuntime({
      transport: h1.transport,
      watchFn: h1.watchFn,
    });
    h1.send({ type: "configure", config });
    rt1.dispose();
    const h2 = harness();
    const rt2 = createWorkerRuntime({
      transport: h2.transport,
      watchFn: h2.watchFn,
    });
    h2.send({ type: "configure", config });
    expect(h2.out.some((m) => m.type === "match")).toBe(false); // Resumed from safe boundary, no new lines
    rt2.dispose();
  });

  it("logsDir does not exist → diagnostic + watching:false without throwing", () => {
    const { config } = setup();
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({
      type: "configure",
      config: { ...config, logsDir: "/nonexistent-gl" },
    });
    expect(
      h.out.some(
        (m) => m.type === "diagnostic" && m.code === "LOGS_DIR_UNREADABLE",
      ),
    ).toBe(true);
    const status = h.out.filter((m) => m.type === "status").at(-1)!;
    expect(status.type === "status" && status.watching).toBe(false);
    rt.dispose();
  });
});
```

Note: In initial-scan test case, `saveCheckpoints` must execute synchronously after initial scan (not only in watcher flush), otherwise test case 4 will not hold — account for this during implementation.

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/workerRuntime.test.ts`, Expected: FAIL

- [ ] **Step 3: Implementation**

```ts
// src/worker/runtime.ts
import { readdirSync, statSync } from "fs";
import { basename, join } from "path";
import type {
  FileStatus,
  MainToWorker,
  WorkerConfig,
  WorkerToMain,
} from "../shared/protocol";
import {
  loadCheckpoints,
  saveCheckpoints,
  type CheckpointRegistry,
} from "./checkpoints";
import { FilePipeline, type ParserLike } from "./pipeline";
import { startLogWatcher, type LogWatcher } from "./watcher";

export interface WorkerTransport {
  post(msg: WorkerToMain): void;
  onMessage(cb: (msg: MainToWorker) => void): void;
}

export function createWorkerRuntime(opts: {
  transport: WorkerTransport;
  watchFn?: typeof import("fs").watch;
  parserFactory?: () => ParserLike;
}): { dispose(): void } {
  let watcher: LogWatcher | null = null;
  let pipelines = new Map<string, FilePipeline>();
  let registry: CheckpointRegistry = { files: {} };
  let config: WorkerConfig | null = null;

  const post = opts.transport.post;

  const fileStatuses = (): FileStatus[] => {
    if (!config) return [];
    const out: FileStatus[] = [];
    for (const [key, p] of pipelines) {
      let size = 0;
      try {
        size = statSync(join(config.logsDir, key)).size;
      } catch {
        /* gone */
      }
      out.push({
        fileKey: key,
        offset: p.currentOffset,
        size,
        quarantined: false,
      });
    }
    for (const q of config.quarantined)
      out.push({ fileKey: q, offset: 0, size: 0, quarantined: true });
    return out;
  };

  const postStatus = (
    watching: boolean,
    current?: { fileKey: string; offset: number },
  ) => {
    post({
      type: "status",
      watching,
      logsDir: config?.logsDir ?? "",
      files: fileStatuses(),
      current,
    });
  };

  const pipelineFor = (fileKey: string): FilePipeline | null => {
    if (!config || config.quarantined.includes(fileKey)) return null;
    let p = pipelines.get(fileKey);
    if (!p) {
      p = new FilePipeline({
        fileKey,
        filePath: join(config.logsDir, fileKey),
        checkpoint: registry.files[fileKey] ?? null,
        emit: post,
        parserFactory: opts.parserFactory,
      });
      pipelines.set(fileKey, p);
    }
    return p;
  };

  const flushFile = (fileKey: string): void => {
    const p = pipelineFor(fileKey);
    if (!p) return;
    postStatus(true, { fileKey, offset: p.currentOffset });
    p.processFlush();
    registry.files[fileKey] = p.checkpoint;
  };

  const teardown = () => {
    watcher?.close();
    watcher = null;
    pipelines = new Map();
  };

  const configure = (next: WorkerConfig): void => {
    teardown();
    config = next;
    registry = loadCheckpoints(next.checkpointsPath);
    let names: string[];
    try {
      names = readdirSync(next.logsDir).filter(
        (n) => n.includes("WoWCombatLog") && n.endsWith(".txt"),
      );
    } catch {
      post({
        type: "diagnostic",
        code: "LOGS_DIR_UNREADABLE",
        detail: next.logsDir,
      });
      postStatus(false);
      return;
    }
    for (const name of names.sort()) flushFile(basename(name));
    saveCheckpoints(next.checkpointsPath, registry);
    watcher = startLogWatcher({
      logsDir: next.logsDir,
      flushIntervalMs: next.flushIntervalMs,
      quietPeriodMs: next.quietPeriodMs,
      watchFn: opts.watchFn,
      onFlush: async (fileNames) => {
        for (const name of fileNames) flushFile(basename(name));
        if (config) saveCheckpoints(config.checkpointsPath, registry);
        postStatus(true);
      },
    });
    postStatus(true);
  };

  opts.transport.onMessage((msg) => {
    if (msg.type === "configure") configure(msg.config);
  });

  return { dispose: teardown };
}
```

Rewrite `src/worker/index.ts` matching entry code in Interfaces section.

- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop && npm run build -w @gladlog/desktop`, Expected: All PASS, build still outputs worker.js
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/runtime.ts packages/desktop/src/worker/index.ts packages/desktop/test/workerRuntime.test.ts
git commit -m "feat(desktop): worker runtime — configure/scan/watch loop with checkpoint persistence"
```

---

### Task 10: Crash attribution + WorkerHost

**Files:**

- Create: `packages/desktop/src/main/crashPolicy.ts`, `packages/desktop/src/main/workerHost.ts`
- Test: `packages/desktop/test/crashPolicy.test.ts`

**Interfaces:**

- Consumes: `WorkerConfig`/`MainToWorker`/`WorkerToMain`
- Produces:

```ts
// crashPolicy.ts (Pure function, covered by unit tests)
export interface CrashRecord {
  fileKey: string | null;
  offset: number | null;
  count: number;
}
export const OFFSET_TOLERANCE = 65536;
export function nextCrashRecord(
  prev: CrashRecord | null,
  current: { fileKey: string; offset: number } | null, // Most recent status.current reported by worker at crash time
): { record: CrashRecord; quarantine: string | null }; // quarantine = 3 consecutive crashes on same file and nearby offset → that fileKey

// workerHost.ts (Thin wrapper, no unit tests; verified via dev smoke test)
export class WorkerHost {
  constructor(opts: {
    workerModulePath: string; // out/main/worker.js
    onMessage: (msg: WorkerToMain) => void;
    onQuarantine: (fileKey: string) => void;
    log: { info(m: string): void; error(m: string): void };
  });
  start(config: WorkerConfig): void; // spawn utilityProcess + send configure
  reconfigure(config: WorkerConfig): void; // Update config (logsDir change)
  stop(): void;
}
```

WorkerHost behavior: `utilityProcess.fork(workerModulePath)`; caches latest `status.current`; upon `exit` not caused by active stop → `nextCrashRecord` attribution, if quarantine → add to quarantined set + call `onQuarantine`, restart after 1s with (updated quarantined) config; upon receiving any match/shuffle message → clear crash records (indicating progress).

- [ ] **Step 1: Write failing test**

```ts
// test/crashPolicy.test.ts
import { nextCrashRecord } from "../src/main/crashPolicy";

describe("nextCrashRecord", () => {
  it("no attribution info → count 1, no quarantine", () => {
    const r = nextCrashRecord(null, null);
    expect(r.record.count).toBe(1);
    expect(r.quarantine).toBeNull();
  });
  it("same file and nearby offset 3 consecutive times → quarantines file", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 1000 });
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 1500 });
    expect(r.quarantine).toBeNull();
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 2000 });
    expect(r.quarantine).toBe("a.txt");
  });
  it("different file → count resets", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 0 });
    r = nextCrashRecord(r.record, { fileKey: "b.txt", offset: 0 });
    expect(r.record.count).toBe(1);
    expect(r.quarantine).toBeNull();
  });
  it("same file far offset (> tolerance) → count resets (progress made, not same poison pill)", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 0 });
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 1_000_000 });
    expect(r.record.count).toBe(1);
  });
});
```

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/crashPolicy.test.ts`, Expected: FAIL

- [ ] **Step 3: Implementation**

```ts
// src/main/crashPolicy.ts
export interface CrashRecord {
  fileKey: string | null;
  offset: number | null;
  count: number;
}
export const OFFSET_TOLERANCE = 65536;
const LIMIT = 3;

export function nextCrashRecord(
  prev: CrashRecord | null,
  current: { fileKey: string; offset: number } | null,
): { record: CrashRecord; quarantine: string | null } {
  if (!current)
    return {
      record: { fileKey: null, offset: null, count: 1 },
      quarantine: null,
    };
  const sameSpot =
    prev !== null &&
    prev.fileKey === current.fileKey &&
    prev.offset !== null &&
    Math.abs(current.offset - prev.offset) <= OFFSET_TOLERANCE;
  const count = sameSpot ? prev.count + 1 : 1;
  return {
    record: { fileKey: current.fileKey, offset: current.offset, count },
    quarantine: count >= LIMIT ? current.fileKey : null,
  };
}
```

```ts
// src/main/workerHost.ts
import { utilityProcess, type UtilityProcess } from "electron";
import type {
  MainToWorker,
  WorkerConfig,
  WorkerToMain,
} from "../shared/protocol";
import { nextCrashRecord, type CrashRecord } from "./crashPolicy";

export class WorkerHost {
  private child: UtilityProcess | null = null;
  private config: WorkerConfig | null = null;
  private crash: CrashRecord | null = null;
  private lastCurrent: { fileKey: string; offset: number } | null = null;
  private stopping = false;

  constructor(
    private opts: {
      workerModulePath: string;
      onMessage: (msg: WorkerToMain) => void;
      onQuarantine: (fileKey: string) => void;
      log: { info(m: string): void; error(m: string): void };
    },
  ) {}

  start(config: WorkerConfig): void {
    this.config = config;
    this.spawn();
  }

  reconfigure(config: WorkerConfig): void {
    this.config = config;
    this.send({ type: "configure", config });
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }

  private send(msg: MainToWorker): void {
    this.child?.postMessage(msg);
  }

  private spawn(): void {
    if (!this.config) return;
    const child = utilityProcess.fork(this.opts.workerModulePath, [], {
      stdio: "pipe",
    });
    this.child = child;
    child.stdout?.on("data", (d: Buffer) =>
      this.opts.log.info(`[worker] ${d.toString().trim()}`),
    );
    child.stderr?.on("data", (d: Buffer) =>
      this.opts.log.error(`[worker] ${d.toString().trim()}`),
    );
    child.on("message", (msg: WorkerToMain) => {
      if (msg.type === "status" && msg.current) this.lastCurrent = msg.current;
      if (msg.type === "match" || msg.type === "shuffle") this.crash = null; // Progress made, clear count
      this.opts.onMessage(msg);
    });
    child.on("exit", (code) => {
      if (this.stopping) return;
      this.opts.log.error(`worker exited code=${code}, restarting in 1s`);
      const { record, quarantine } = nextCrashRecord(
        this.crash,
        this.lastCurrent,
      );
      this.crash = record;
      if (
        quarantine &&
        this.config &&
        !this.config.quarantined.includes(quarantine)
      ) {
        this.config = {
          ...this.config,
          quarantined: [...this.config.quarantined, quarantine],
        };
        this.opts.onQuarantine(quarantine);
      }
      setTimeout(() => this.spawn(), 1000);
    });
    child.once("spawn", () => {
      if (this.config) this.send({ type: "configure", config: this.config });
    });
  }
}
```

- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`, Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/crashPolicy.ts packages/desktop/src/main/workerHost.ts packages/desktop/test/crashPolicy.test.ts
git commit -m "feat(desktop): worker host with crash attribution and per-file quarantine"
```

---

### Task 11: MatchStore (Persist meta/match/raw three files)

**Files:**

- Create: `packages/desktop/src/main/matchStore.ts`
- Test: `packages/desktop/test/matchStore.test.ts`

**Interfaces:**

- Consumes: `GladMatch`/`GladShuffle` (`@gladlog/parser`; `GladMatch` has `id/bracket/zoneId/startTime/endTime/result/rawLines`; `GladShuffle` has `rounds/startTime/endTime/rawLines/result`, **no ID of its own**)
- Produces:

```ts
export interface StoredMatchMeta {
  id: string;
  kind: "match" | "shuffle";
  bracket: string; // shuffle takes rounds[0].bracket
  zoneId: string; // shuffle takes rounds[0].zoneId
  startTime: number;
  endTime: number;
  result: string; // MatchResult serialized
  storedAt: number;
}
export class MatchStore {
  constructor(rootDir: string, opts?: { now?: () => number });
  init(): StoredMatchMeta[]; // Scan rootDir/*/meta.json to build index (skip corrupted entries)
  store(item: GladMatch | GladShuffle): {
    stored: boolean;
    meta: StoredMatchMeta | null;
  };
  // stored=false: Already exists (idempotent) or shuffle rounds empty (meta=null)
  list(): StoredMatchMeta[]; // Descending order by startTime
  get(id: string): unknown | null; // Full content of match.json (envelope + data)
}
```

Persistence rules: Directory `rootDir/<id>/`, write to `rootDir/.tmp-<id>/` first then `renameSync` to final location (atomic); three files:

- `meta.json` = `StoredMatchMeta` (startup index only reads this to avoid loading large files)
- `match.json` = `{ schemaVersion: 1, storedAt, kind, data }`, where `data` is payload with **rawLines stripped** (shuffle also strips rawLines from each round)
- `raw.txt` = `payload.rawLines.join("\n") + "\n"`

shuffle id = `rounds[0].id` (content hash, deterministic across replays). id used as directory name — `GladMatch.id` is content hash hex, naturally filename safe; still sanitize with `/[^A-Za-z0-9._-]/g → "_"` defensively.

- [ ] **Step 1: Write failing test**

```ts
// test/matchStore.test.ts
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { GladMatch, GladShuffle } from "@gladlog/parser";
import { MatchStore } from "../src/main/matchStore";

const dir = () => mkdtempSync(join(tmpdir(), "gl-store-"));

function fakeMatch(id: string): GladMatch {
  return {
    kind: "match",
    id,
    bracket: "3v3",
    zoneId: "1825",
    startTime: 100,
    endTime: 200,
    units: {},
    playerId: "p",
    playerTeamId: 0,
    winningTeamId: 1,
    result: "loss",
    linesTotal: 3,
    linesDropped: 0,
    rawLines: ["l1", "l2"],
    hasAdvancedLogging: true,
    timezone: "UTC",
  } as unknown as GladMatch;
}
function fakeShuffle(roundId: string): GladShuffle {
  const round = {
    ...(fakeMatch(roundId) as unknown as Record<string, unknown>),
    kind: "shuffleRound",
    sequenceNumber: 1,
  };
  return {
    kind: "shuffle",
    rounds: [round],
    startTime: 100,
    endTime: 500,
    rawLines: ["r1"],
    result: "win",
  } as unknown as GladShuffle;
}

describe("MatchStore", () => {
  it("store match → persists three files, match.json strips rawLines, raw.txt retains them", () => {
    const root = dir();
    const s = new MatchStore(root);
    const r = s.store(fakeMatch("abc123"));
    expect(r.stored).toBe(true);
    expect(existsSync(join(root, "abc123", "meta.json"))).toBe(true);
    const doc = JSON.parse(
      readFileSync(join(root, "abc123", "match.json"), "utf-8"),
    );
    expect(doc.schemaVersion).toBe(1);
    expect(doc.data.rawLines).toBeUndefined();
    expect(readFileSync(join(root, "abc123", "raw.txt"), "utf-8")).toBe(
      "l1\nl2\n",
    );
  });

  it("duplicate id → stored:false, does not overwrite", () => {
    const s = new MatchStore(dir());
    s.store(fakeMatch("dup"));
    expect(s.store(fakeMatch("dup")).stored).toBe(false);
    expect(s.list()).toHaveLength(1);
  });

  it("shuffle: id takes rounds[0].id; round rawLines also stripped", () => {
    const root = dir();
    const s = new MatchStore(root);
    const r = s.store(fakeShuffle("shufid"));
    expect(r.meta!.id).toBe("shufid");
    expect(r.meta!.kind).toBe("shuffle");
    const doc = JSON.parse(
      readFileSync(join(root, "shufid", "match.json"), "utf-8"),
    );
    expect(doc.data.rawLines).toBeUndefined();
    expect(doc.data.rounds[0].rawLines).toBeUndefined();
  });

  it("shuffle with empty rounds → stored:false, meta:null", () => {
    const s = new MatchStore(dir());
    const empty = {
      kind: "shuffle",
      rounds: [],
      startTime: 0,
      endTime: 0,
      rawLines: [],
      result: "unknown",
    } as unknown as GladShuffle;
    expect(s.store(empty)).toEqual({ stored: false, meta: null });
  });

  it("init rescans to restore index, list sorted descending by startTime", () => {
    const root = dir();
    const s1 = new MatchStore(root);
    s1.store({ ...fakeMatch("m1"), startTime: 100 } as GladMatch);
    s1.store({ ...fakeMatch("m2"), startTime: 300 } as GladMatch);
    const s2 = new MatchStore(root);
    const metas = s2.init();
    expect(metas.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(s2.get("m1")).not.toBeNull();
    expect(s2.get("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm failure** — Run: `npx vitest run test/matchStore.test.ts`, Expected: FAIL

- [ ] **Step 3: Implementation**

```ts
// src/main/matchStore.ts
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { GladMatch, GladShuffle } from "@gladlog/parser";

export interface StoredMatchMeta {
  id: string;
  kind: "match" | "shuffle";
  bracket: string;
  zoneId: string;
  startTime: number;
  endTime: number;
  result: string;
  storedAt: number;
}

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, "_");

export class MatchStore {
  private index = new Map<string, StoredMatchMeta>();
  private now: () => number;

  constructor(
    private rootDir: string,
    opts?: { now?: () => number },
  ) {
    this.now = opts?.now ?? Date.now;
    mkdirSync(rootDir, { recursive: true });
  }

  init(): StoredMatchMeta[] {
    this.index.clear();
    let names: string[] = [];
    try {
      names = readdirSync(this.rootDir);
    } catch {
      /* Keep empty index */
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      try {
        const meta = JSON.parse(
          readFileSync(join(this.rootDir, name, "meta.json"), "utf-8"),
        ) as StoredMatchMeta;
        if (typeof meta.id === "string") this.index.set(meta.id, meta);
      } catch {
        /* Skip corrupted entries */
      }
    }
    return this.list();
  }

  store(item: GladMatch | GladShuffle): {
    stored: boolean;
    meta: StoredMatchMeta | null;
  } {
    let id: string;
    let meta: StoredMatchMeta;
    let data: unknown;
    if (item.kind === "shuffle") {
      const first = item.rounds[0];
      if (!first) return { stored: false, meta: null };
      id = first.id;
      meta = {
        id,
        kind: "shuffle",
        bracket: first.bracket,
        zoneId: first.zoneId,
        startTime: item.startTime,
        endTime: item.endTime,
        result: String(item.result),
        storedAt: this.now(),
      };
      data = {
        ...item,
        rawLines: undefined,
        rounds: item.rounds.map((r) => ({ ...r, rawLines: undefined })),
      };
    } else {
      id = item.id;
      meta = {
        id,
        kind: "match",
        bracket: item.bracket,
        zoneId: item.zoneId,
        startTime: item.startTime,
        endTime: item.endTime,
        result: String(item.result),
        storedAt: this.now(),
      };
      data = { ...item, rawLines: undefined };
    }
    if (this.index.has(id)) return { stored: false, meta: this.index.get(id)! };

    const dirName = safeName(id);
    const finalDir = join(this.rootDir, dirName);
    const tmpDir = join(this.rootDir, `.tmp-${dirName}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "meta.json"), JSON.stringify(meta, null, 2));
    writeFileSync(
      join(tmpDir, "match.json"),
      JSON.stringify({
        schemaVersion: 1,
        storedAt: meta.storedAt,
        kind: meta.kind,
        data,
      }),
    );
    writeFileSync(join(tmpDir, "raw.txt"), item.rawLines.join("\n") + "\n");
    renameSync(tmpDir, finalDir);
    this.index.set(id, meta);
    return { stored: true, meta };
  }

  list(): StoredMatchMeta[] {
    return [...this.index.values()].sort((a, b) => b.startTime - a.startTime);
  }

  get(id: string): unknown | null {
    if (!this.index.has(id)) return null;
    try {
      return JSON.parse(
        readFileSync(join(this.rootDir, safeName(id), "match.json"), "utf-8"),
      ) as unknown;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Verify** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`, Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/matchStore.ts packages/desktop/test/matchStore.test.ts
git commit -m "feat(desktop): match store — atomic meta/match/raw persistence with idempotent dedupe"
```

---

### Task 12: Main process assembly + IPC + preload bridge

**Files:**

- Rewrite: `packages/desktop/src/main/index.ts`, `packages/desktop/src/preload/index.ts`
- Create: `packages/desktop/src/main/ipc.ts`, `packages/desktop/src/preload/api.ts`
- Test: No new unit tests (purely Electron wiring); verification = typecheck + build + dev smoke

**Interfaces:**

- Consumes: All of Tasks 3/4/10/11
- Produces (full bridge consumed by renderer, depended upon by Task 13):

```ts
// src/preload/api.ts —— Full file
import type { FileStatus } from "../shared/protocol";
import type { GladlogSettings } from "../main/settingsStore";
import type { StoredMatchMeta } from "../main/matchStore";

export interface LogsStatusSnapshot {
  watching: boolean;
  logsDir: string;
  files: FileStatus[];
}
export interface DiagnosticEntry {
  fileKey?: string;
  code: string;
  detail?: string;
  at: number;
}

export interface GladlogApi {
  logs: {
    getStatus(): Promise<LogsStatusSnapshot | null>;
    onStatusChanged(cb: (s: LogsStatusSnapshot) => void): () => void;
    onMatchStored(cb: (meta: StoredMatchMeta) => void): () => void;
    onDiagnostic(cb: (d: DiagnosticEntry) => void): () => void;
  };
  matches: {
    list(): Promise<StoredMatchMeta[]>;
    get(id: string): Promise<unknown | null>;
  };
  settings: {
    get(): Promise<GladlogSettings>;
    save(partial: Partial<GladlogSettings>): Promise<GladlogSettings>;
  };
  app: {
    getVersion(): Promise<string>;
    selectDirectory(): Promise<string | null>; // Returns selected dir; cancel → null. Selection automatically saves wowDirectory and restarts monitoring
    openExternal(url: string): Promise<void>;
  };
}
declare global {
  interface Window {
    gladlog: GladlogApi;
  }
}
```

IPC channels (sole registration in `ipc.ts`): `gladlog:logs:getStatus`, `gladlog:matches:list`, `gladlog:matches:get`, `gladlog:settings:get`, `gladlog:settings:save`, `gladlog:app:getVersion`, `gladlog:app:selectDirectory`, `gladlog:app:openExternal` (only allows `https?://`); push events: `gladlog:logs:statusChanged`, `gladlog:logs:matchStored`, `gladlog:logs:diagnostic`.

- [ ] **Step 1: preload implementation**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import type { GladlogApi } from "./api";

function sub<T>(channel: string) {
  return (cb: (payload: T) => void): (() => void) => {
    const listener = (_e: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api: GladlogApi = {
  logs: {
    getStatus: () => ipcRenderer.invoke("gladlog:logs:getStatus"),
    onStatusChanged: sub("gladlog:logs:statusChanged"),
    onMatchStored: sub("gladlog:logs:matchStored"),
    onDiagnostic: sub("gladlog:logs:diagnostic"),
  },
  matches: {
    list: () => ipcRenderer.invoke("gladlog:matches:list"),
    get: (id) => ipcRenderer.invoke("gladlog:matches:get", id),
  },
  settings: {
    get: () => ipcRenderer.invoke("gladlog:settings:get"),
    save: (partial) => ipcRenderer.invoke("gladlog:settings:save", partial),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("gladlog:app:getVersion"),
    selectDirectory: () => ipcRenderer.invoke("gladlog:app:selectDirectory"),
    openExternal: (url) => ipcRenderer.invoke("gladlog:app:openExternal", url),
  },
};
contextBridge.exposeInMainWorld("gladlog", api);
```

- [ ] **Step 2: ipc.ts + main/index.ts**

```ts
// src/main/ipc.ts
import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import type { GladlogSettings, SettingsStore } from "./settingsStore";
import type { MatchStore } from "./matchStore";
import type { LogsStatusSnapshot } from "../preload/api";

export function registerIpc(deps: {
  store: MatchStore;
  settings: SettingsStore;
  getStatus: () => LogsStatusSnapshot | null;
  getWindow: () => BrowserWindow | null;
  onWowDirectoryChanged: (settings: GladlogSettings) => void;
}): void {
  ipcMain.handle("gladlog:logs:getStatus", () => deps.getStatus());
  ipcMain.handle("gladlog:matches:list", () => deps.store.list());
  ipcMain.handle("gladlog:matches:get", (_e, id: string) => deps.store.get(id));
  ipcMain.handle("gladlog:settings:get", () => deps.settings.get());
  ipcMain.handle(
    "gladlog:settings:save",
    (_e, partial: Partial<GladlogSettings>) => {
      const next = deps.settings.save(partial);
      if ("wowDirectory" in partial) deps.onWowDirectoryChanged(next);
      return next;
    },
  );
  ipcMain.handle("gladlog:app:getVersion", () => app.getVersion());
  ipcMain.handle("gladlog:app:selectDirectory", async () => {
    const win = deps.getWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const dirPath = r.filePaths[0]!;
    deps.onWowDirectoryChanged(deps.settings.save({ wowDirectory: dirPath }));
    return dirPath;
  });
  ipcMain.handle("gladlog:app:openExternal", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
}
```

```ts
// src/main/index.ts —— Full rewrite
import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import { join } from "path";
import type { WorkerConfig, WorkerToMain } from "../shared/protocol";
import type { LogsStatusSnapshot } from "../preload/api";
import {
  detectWowDirCandidates,
  realFsProbe,
  resolveLogsDir,
} from "./detectWowDir";
import { registerIpc } from "./ipc";
import { MatchStore } from "./matchStore";
import { SettingsStore, type GladlogSettings } from "./settingsStore";
import { WorkerHost } from "./workerHost";

log.initialize();
process.on("uncaughtException", (e) => log.error("[main] uncaught:", e));
process.on("unhandledRejection", (e) =>
  log.error("[main] unhandled rejection:", e),
);

let win: BrowserWindow | null = null;
let lastStatus: LogsStatusSnapshot | null = null;
let quarantined: string[] = [];

const userData = () => app.getPath("userData");
const settings = new SettingsStore(
  join(app.getPath("userData"), "settings.json"),
);
let store: MatchStore;
let host: WorkerHost | null = null;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env["ELECTRON_RENDERER_URL"])
    w.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else w.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return w;
}

function workerConfig(wowDirectory: string): WorkerConfig {
  return {
    logsDir: resolveLogsDir(wowDirectory),
    checkpointsPath: join(userData(), "checkpoints.json"),
    quarantined,
    flushIntervalMs: 2000,
    quietPeriodMs: 5000,
  };
}

function onWorkerMessage(msg: WorkerToMain): void {
  if (msg.type === "match" || msg.type === "shuffle") {
    const r = store.store(msg.payload);
    if (r.stored && r.meta)
      win?.webContents.send("gladlog:logs:matchStored", r.meta);
  } else if (msg.type === "status") {
    lastStatus = {
      watching: msg.watching,
      logsDir: msg.logsDir,
      files: msg.files,
    };
    win?.webContents.send("gladlog:logs:statusChanged", lastStatus);
  } else if (msg.type === "diagnostic") {
    const entry = {
      fileKey: msg.fileKey,
      code: msg.code,
      detail: msg.detail,
      at: Date.now(),
    };
    log.warn("[worker diagnostic]", JSON.stringify(entry));
    win?.webContents.send("gladlog:logs:diagnostic", entry);
  }
}

function startMonitoring(s: GladlogSettings): void {
  let dir = s.wowDirectory;
  if (!dir) {
    dir =
      detectWowDirCandidates({
        platform: process.platform,
        probe: realFsProbe(),
      })[0] ?? null;
    if (dir) settings.save({ wowDirectory: dir });
  }
  if (!dir) return; // Wait for manual user selection
  const config = workerConfig(dir);
  if (host) host.reconfigure(config);
  else {
    host = new WorkerHost({
      workerModulePath: join(import.meta.dirname, "worker.js"),
      onMessage: onWorkerMessage,
      onQuarantine: (fileKey) => log.error(`quarantined ${fileKey}`),
      log: { info: (m) => log.info(m), error: (m) => log.error(m) },
    });
    host.start(config);
  }
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.whenReady().then(() => {
    store = new MatchStore(join(userData(), "matches"));
    store.init();
    win = createWindow();
    registerIpc({
      store,
      settings,
      getStatus: () => lastStatus,
      getWindow: () => win,
      onWowDirectoryChanged: (s) => startMonitoring(s),
    });
    startMonitoring(settings.get());
  });
  app.on("window-all-closed", () => {
    host?.stop();
    app.quit();
  });
}
```

- [ ] **Step 3: typecheck + build**

Run: `npm run typecheck -w @gladlog/desktop && npm run build -w @gladlog/desktop && npm test -w @gladlog/desktop`
Expected: All PASS (note worker bundle filename: electron-vite artifact name for `input.worker` must match `worker.js` in `workerModulePath`; adjust `rollupOptions.output.entryFileNames` if mismatched)

- [ ] **Step 4: dev smoke test (executed in main session, not subagent)**

Prepare: `mkdir -p /tmp/gl-smoke/Logs && cp <medium corpus sample log> /tmp/gl-smoke/Logs/WoWCombatLog-smoke.txt`
Run: `npm run dev -w @gladlog/desktop`
Verify in window DevTools console: `await window.gladlog.settings.save({ wowDirectory: '/tmp/gl-smoke' })` → `await window.gladlog.matches.list()` returns non-empty array within a few seconds; match directories appear in `~/Library/Application Support/gladlog-desktop/matches/`.
Expected: All above hold true.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main packages/desktop/src/preload
git commit -m "feat(desktop): main-process assembly, typed IPC bridge, preload api"
```

---

### Task 13: Debug-grade renderer UI

**Files:**

- Rewrite: `packages/desktop/src/renderer/src/App.tsx`, `packages/desktop/src/renderer/src/styles.css`

**Interfaces:**

- Consumes: `window.gladlog` (`GladlogApi` from Task 12)
- Produces: Four-panel debug view — Status bar (watching/logsDir/files+offset/quarantine + directory picker button), Match list (real-time prepend), Details (`<pre>` JSON), Diagnostics stream (last 100 entries). Shuffles only show match-level view (decided open issue: round details deferred to Subproject 3).

- [ ] **Step 1: Implement App.tsx**

```tsx
// src/renderer/src/App.tsx
import { useEffect, useState } from "react";
import type { DiagnosticEntry, LogsStatusSnapshot } from "../../preload/api";
import type { StoredMatchMeta } from "../../main/matchStore";

export default function App() {
  const [status, setStatus] = useState<LogsStatusSnapshot | null>(null);
  const [matches, setMatches] = useState<StoredMatchMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<unknown | null>(null);
  const [diags, setDiags] = useState<DiagnosticEntry[]>([]);
  const [wowDir, setWowDir] = useState<string | null>(null);

  useEffect(() => {
    void window.gladlog.logs.getStatus().then(setStatus);
    void window.gladlog.matches.list().then(setMatches);
    void window.gladlog.settings.get().then((s) => setWowDir(s.wowDirectory));
    const un1 = window.gladlog.logs.onStatusChanged(setStatus);
    const un2 = window.gladlog.logs.onMatchStored((m) =>
      setMatches((prev) => [m, ...prev]),
    );
    const un3 = window.gladlog.logs.onDiagnostic((d) =>
      setDiags((prev) => [d, ...prev].slice(0, 100)),
    );
    return () => {
      un1();
      un2();
      un3();
    };
  }, []);

  useEffect(() => {
    if (selected) void window.gladlog.matches.get(selected).then(setDetail);
    else setDetail(null);
  }, [selected]);

  const pickDir = async () => {
    const dir = await window.gladlog.app.selectDirectory();
    if (dir) setWowDir(dir);
  };

  const fmt = (t: number) => new Date(t).toLocaleString();

  return (
    <div className="grid">
      <section className="panel">
        <h2>Monitoring Status</h2>
        <p>
          WoW Directory: {wowDir ?? "Not configured"}{" "}
          <button onClick={() => void pickDir()}>Choose Directory…</button>
        </p>
        <p>
          {status
            ? status.watching
              ? `✅ watching ${status.logsDir}`
              : `⛔ Not monitoring (${status.logsDir || "No directory"})`
            : "Worker not running"}
        </p>
        <ul>
          {status?.files.map((f) => (
            <li key={f.fileKey}>
              {f.fileKey} — {f.offset}/{f.size}B{" "}
              {f.quarantined ? "🧪 quarantined" : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Matches ({matches.length})</h2>
        <ul className="matches">
          {matches.map((m) => (
            <li
              key={m.id}
              className={m.id === selected ? "sel" : ""}
              onClick={() => setSelected(m.id)}
            >
              [{m.kind}] {m.bracket} · zone {m.zoneId} · {fmt(m.startTime)} ·{" "}
              {m.result}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel detail">
        <h2>Details</h2>
        <pre>{detail ? JSON.stringify(detail, null, 2) : "Select a match"}</pre>
      </section>
      <section className="panel">
        <h2>Diagnostics ({diags.length})</h2>
        <ul>
          {diags.map((d, i) => (
            <li key={i}>
              {new Date(d.at).toLocaleTimeString()} [{d.code}] {d.fileKey ?? ""}{" "}
              {d.detail ?? ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

```css
/* src/renderer/src/styles.css */
* {
  box-sizing: border-box;
}
body {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  margin: 0;
  background: #111;
  color: #ddd;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto 1fr;
  gap: 8px;
  padding: 8px;
  height: 100vh;
}
.panel {
  border: 1px solid #333;
  border-radius: 6px;
  padding: 8px 12px;
  overflow: auto;
  min-height: 0;
}
.panel h2 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #8ab4f8;
}
.detail {
  grid-row: span 2;
}
.matches li {
  cursor: pointer;
  padding: 2px 4px;
  list-style: none;
}
.matches li.sel {
  background: #2a3b55;
}
ul {
  margin: 0;
  padding-left: 16px;
}
pre {
  white-space: pre-wrap;
  word-break: break-all;
}
button {
  background: #2a3b55;
  color: #ddd;
  border: 1px solid #446;
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
}
```

- [ ] **Step 2: Verify** — Run: `npm run typecheck -w @gladlog/desktop && npm run build -w @gladlog/desktop`, Expected: PASS; dev smoke test matches Task 12 Step 4, verifying status/list/detail/diagnostics panels update in real time with replay (run in main session).
- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer
git commit -m "feat(desktop): debug-grade live UI — status, match list, detail, diagnostics"
```

---

### Task 14: e2e replay script + acceptance checklist

**Files:**

- Create: `packages/desktop/scripts/replay-log.mjs`

**Interfaces:**

- Produces: `node scripts/replay-log.mjs --source <real log> --dest <logsDir>/WoWCombatLog-replay.txt [--chunk 500] [--interval 300]` —— Appends source log in chunk lines every interval ms to dest, simulating real-time game writes.

- [ ] **Step 1: Implementation**

```js
// scripts/replay-log.mjs
import { appendFileSync, readFileSync, writeFileSync } from "fs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const source = arg("source", null);
const dest = arg("dest", null);
const chunk = Number(arg("chunk", "500"));
const interval = Number(arg("interval", "300"));
if (!source || !dest) {
  console.error(
    "usage: node replay-log.mjs --source <log> --dest <dest> [--chunk N] [--interval ms]",
  );
  process.exit(1);
}
const lines = readFileSync(source, "utf-8").split("\n");
writeFileSync(dest, "");
let i = 0;
const timer = setInterval(() => {
  if (i >= lines.length) {
    clearInterval(timer);
    console.log(`done: ${lines.length} lines`);
    return;
  }
  appendFileSync(dest, lines.slice(i, i + chunk).join("\n") + "\n");
  i += chunk;
  process.stdout.write(`\r${i}/${lines.length}`);
}, interval);
```

- [ ] **Step 2: Acceptance execution (Run in main session, no subagent dispatch; requires `GLADLOG_FIXTURES` corpus or samples from local 104GB corpus)**

Acceptance checklist (all items must pass):

1. **Real-time**: `npm run dev` + `settings.save({wowDirectory:'/tmp/gl-e2e'})` (dir contains empty Logs/) → run replay script writing to `/tmp/gl-e2e/Logs/WoWCombatLog-replay.txt` → UI match list grows with replay; each match produces complete three files in `~/Library/Application Support/gladlog-desktop/matches/<id>/` with `raw.txt` line count ≈ rawLines for that match.
2. **Restart recovery**: In the middle of replay, kill app with Ctrl-C → restart dev → list restores (index rebuilt from disk), continuing replay appends new matches without **duplicate IDs** (matches directory count = list count).
3. **Rotation**: After replay completes, `rm dest` and run with another sample on the same dest name → new matches appear normally (exercising rotated branch).
4. **Diagnostics**: Point wowDirectory to non-existent path → diagnostics stream shows `LOGS_DIR_UNREADABLE`, status shows not monitoring; revert path → recovers.

Expected: 4/4 passed; if any fail, fix and rerun that check.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/scripts/replay-log.mjs
git commit -m "feat(desktop): log replay script for e2e acceptance"
```

---

### Task 15: electron-builder packaging

**Files:**

- Create: `packages/desktop/electron-builder.yml`
- Modify: `packages/desktop/package.json` (if needed to add `productName`/`build` field references)

- [ ] **Step 1: Configuration**

```yaml
# electron-builder.yml
appId: app.gladlog.desktop
productName: gladlog
directories:
  output: dist-app
  buildResources: build
files:
  - out/**
  - package.json
mac:
  target: dmg
  identity: null # No signing
win:
  target: nsis
nsis:
  oneClick: true
npmRebuild: false
```

- [ ] **Step 2: mac package verification (local)**

Run: `npm run package:mac -w @gladlog/desktop`
Expected: `dist-app/gladlog-0.0.1.dmg` generated; mount and install, launch app, window appears, select directory → replay → matches appear (same as Task 14 Checklist Item 1, run once with packaged app)
Note: Windows NSIS package built and accepted on user's Windows machine (`npm run package:win`), not blocking this task's commit; record results in progress.md.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/electron-builder.yml packages/desktop/package.json
git commit -m "build(desktop): electron-builder config — mac dmg + win nsis, unsigned v1"
```

---

### Task 16: Wrap-up — Ledger and documentation

**Files:**

- Modify: `.superpowers/progress.md` (append Subproject 2 completion row: task commits, acceptance results, leftovers)
- Modify: `README.md` (check off Subproject 2 in roadmap checklist, if present)
- Modify: `HANDOFF-2026-07-10.md` (now `docs/archive/HANDOFF-2026-07-10.md`) left untouched (historical doc); new handoffs decided by main session if needed

- [ ] **Step 1: Update progress.md** (format follows existing ledger: one milestone per row + "Next Steps")
- [ ] **Step 2: Full repo verification**

Run: `npm test --workspaces --if-present && npm run typecheck --workspaces --if-present`
Expected: All green

- [ ] **Step 3: Commit**

```bash
git add .superpowers/progress.md README.md
git commit -m "docs: sub-project 2 (desktop shell) complete — ledger + roadmap"
```

---

## Self-Review (Plan Self-Check Log)

- **Spec Coverage**: Monitoring (T6/T9), parsing worker (T8/T9), persistence (T11), bridge (T12), debug UI (T13), settings (T3), detection (T4), packaging (T15), safe boundary checkpoints (T1/T8), quarantine (T10), e2e (T14) — all spec sections mapped to tasks. The disk-full scenario in spec "Error Handling" section is handled by store write failures bubbling up to main uncaught handler for fallback logging, without a dedicated task (accepted: v1 fallback semantics).
- **Placeholders**: No TBD/TODO; all tests and implementations include complete code.
- **Type Consistency**: `FileCheckpoint`/`WorkerToMain`/`GladlogApi`/`StoredMatchMeta` defined in T3 and consumed in T5/8/9/10/11/12/13, signatures verified consistent across all; `hasOpenSegment()` defined in T1 and consumed in T8.
- **Known Risks**: electron-vite worker bundle output filename (countermeasure in T12 Step 3); Task 1 synthetic shuffle row bracket strings need verification against segmenter in this repo (method documented in task).
