# 子项目 2:桌面壳(Electron + Vite)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron + Vite + React 桌面壳:worker 内监控/读取/解析 WoW 日志 → 主进程落盘 → 调试级实时界面,可打包。

**Architecture:** 单包 `packages/desktop`(electron-vite 三段构建 + worker 入口)。utilityProcess worker 拥有 fs.watch + tail 读取 + `GladLogParser`,只向主进程发轻量 match/diagnostic/status 事件;checkpoint 仅在"parser 无进行中段"的安全边界推进;主进程负责落盘(meta/match/raw 三文件)、settings、IPC bridge(`window.gladlog`)。Spec:`docs/specs/2026-07-10-desktop-shell-design.md`。

**Tech Stack:** TypeScript(ESM)、electron、electron-vite、vite、react 19、vitest(globals)、electron-builder、electron-log、`@gladlog/parser`(workspace)。

## Global Constraints

- **合规(硬性)**:实现者不得读取 `/Users/mingjianliu/code/wowarenalogs` 下任何上游源码。本计划已内嵌所有需要移植的自有代码(watcher/checkpoint/detect 语义),实现时以计划中的代码为准,不回旧 fork 查。gladlog 本仓库内的代码(parser 等)随便读。
- 零上游代码;零运行时云端依赖;`@gladlog/parser-compat` 不进壳。
- ESM(`"type": "module"`)、TS strict、vitest `globals: true`、测试放包内 `test/`——与 parser 包惯例一致。
- 测试命令:`npm test -w @gladlog/desktop`;typecheck:`npm run typecheck -w @gladlog/desktop`。根命令 `npm test --workspaces --if-present` 必须始终全绿。
- TDD、每任务一 commit,commit message 用 conventional commits。
- retail-only;无自动更新;无签名/公证。
- 事件通道名统一前缀 `gladlog:`;对外全局对象名 `window.gladlog`。

## 文件结构总览

```
packages/desktop/
  package.json  tsconfig.json  tsconfig.node.json  vitest.config.ts
  electron.vite.config.ts  electron-builder.yml
  src/shared/protocol.ts          # main↔worker 消息类型 + FileCheckpoint(Task 3)
  src/main/index.ts               # 生命周期+窗口+组装(Task 12)
  src/main/workerHost.ts          # utilityProcess spawn/重启/quarantine(Task 10)
  src/main/crashPolicy.ts         # 崩溃归因纯函数(Task 10)
  src/main/matchStore.ts          # 落盘/索引/去重(Task 11)
  src/main/settingsStore.ts       # settings.json(Task 3)
  src/main/detectWowDir.ts        # WoW 目录探测 + resolveLogsDir(Task 4)
  src/main/ipc.ts                 # ipcMain 注册(Task 12)
  src/worker/index.ts             # utilityProcess 入口(Task 9)
  src/worker/runtime.ts           # configure→scan→watch 组装,transport 可注入(Task 9)
  src/worker/watcher.ts           # 目录监控(Task 6)
  src/worker/tailReader.ts        # 增量读+轮转/截断检测(Task 7)
  src/worker/checkpoints.ts       # checkpoint registry(Task 5)
  src/worker/pipeline.ts          # FilePipeline:喂 parser+安全边界(Task 8)
  src/preload/index.ts            # contextBridge(Task 12)
  src/preload/api.ts              # GladlogApi 类型(Task 12)
  src/renderer/index.html  src/renderer/src/main.tsx  src/renderer/src/App.tsx
  src/renderer/src/styles.css     # 调试页(Task 2 骨架,Task 13 完整)
  scripts/replay-log.mjs          # e2e 追加回放(Task 14)
  test/*.test.ts                  # 各任务对应测试
packages/parser/src/l2/segmenter.ts + src/api.ts   # Task 1 加只读访问器
```

---

### Task 1: parser 只读访问器 `hasOpenSegment()`

**Files:**

- Modify: `packages/parser/src/l2/segmenter.ts`(类内加一个方法)
- Modify: `packages/parser/src/api.ts`(`GladLogParser` 加委托方法)
- Test: `packages/parser/test/l2.openSegment.test.ts`

**Interfaces:**

- Consumes: `Segmenter` 已有私有字段 `state: "IDLE" | "IN_MATCH" | "IN_SHUFFLE"`(`segmenter.ts:9`)。
- Produces: `Segmenter.hasOpenSegment(): boolean`、`GladLogParser.hasOpenSegment(): boolean`——`state !== "IDLE"` 时为 true(shuffle 回合间隙也算 open,因为 shuffle 序列还没闭合)。Task 8 依赖。

- [ ] **Step 1: 写失败测试**

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

  it("shuffle 回合间隙仍为 open(序列未闭合)", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    p.push(line(0, "ARENA_MATCH_START,1825,41,Rated Solo Shuffle,1"));
    p.push(line(1, CAST));
    p.push(line(2, "ARENA_MATCH_END,1,30,1500,1501"));
    // 回合 1 结束但 shuffle 未闭合
    expect(p.hasOpenSegment()).toBe(true);
  });
});
```

注:shuffle 判定依赖 `Segmenter` 对 bracket 的识别;若该 bracket 字符串不触发 IN_SHUFFLE 路径,先读 `packages/parser/src/l2/segmenter.ts` 与 `test/l2.segmenter.synthetic.test.ts` 里 shuffle 场景使用的真实 START 参数,替换成同款(**只允许查本仓库**)。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/l2.openSegment.test.ts`(cwd `packages/parser`)
Expected: FAIL,`hasOpenSegment is not a function`

- [ ] **Step 3: 最小实现**

```ts
// segmenter.ts 类内追加:
public hasOpenSegment(): boolean {
  return this.state !== "IDLE";
}
// api.ts GladLogParser 类内追加:
public hasOpenSegment(): boolean {
  return this.segmenter.hasOpenSegment();
}
```

- [ ] **Step 4: 全量回归**

Run: `npm test -w @gladlog/parser && npm run typecheck -w @gladlog/parser`
Expected: 全 PASS(既有 ~150 测试零回归)

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/l2/segmenter.ts packages/parser/src/api.ts packages/parser/test/l2.openSegment.test.ts
git commit -m "feat(parser): read-only hasOpenSegment() for shell safe-boundary checkpoints"
```

---

### Task 2: desktop 包脚手架(electron-vite 三段 + worker 入口)

**Files:**

- Create: `packages/desktop/package.json`、`tsconfig.json`、`tsconfig.node.json`、`vitest.config.ts`、`electron.vite.config.ts`、`src/main/index.ts`(临时 hello 版)、`src/preload/index.ts`(临时空桥)、`src/worker/index.ts`(临时占位)、`src/renderer/index.html`、`src/renderer/src/main.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`

**Interfaces:**

- Produces: 可 `npm run dev -w @gladlog/desktop` 打开窗口;`npm run build` 产出 `out/main/index.js`、`out/main/worker.js`、`out/preload/index.mjs`、`out/renderer/`。后续任务在此骨架上替换各文件。

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

(版本以 `npm install` 当日实际解析为准;若 electron-vite 主版本与此不符,以其官方模板结构为准调整,但**三段+worker 入口、ESM、目录布局**不变。)

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
// tsconfig.json(src + test,浏览器/共用侧)
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
// tsconfig.node.json 可与主 tsconfig 相同要点,electron-vite 模板若生成双 tsconfig 则沿用模板;
// 只要 typecheck 脚本覆盖全部 src+test 即可,两个 -p 或合一均可接受。
```

- [ ] **Step 3: 最小三段代码**

```ts
// src/main/index.ts(hello 版,Task 12 重写)
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
// src/preload/index.ts(空桥,Task 12 重写)
import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("gladlog", { ping: () => "pong" });
```

```ts
// src/worker/index.ts(占位,Task 9 重写)
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
// src/renderer/src/App.tsx(hello 版,Task 13 重写)
export default function App() {
  return <h1>gladlog shell</h1>;
}
```

`styles.css` 先放一行 `body { font-family: ui-monospace, monospace; }`。

- [ ] **Step 4: 安装并验证**

Run(仓库根): `npm install`
Run: `npm run build -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop && npm test -w @gladlog/desktop`
Expected: build 产出 `out/main/index.js` 与 `out/main/worker.js`;typecheck 过;vitest 报 "no test files"(允许,`--passWithNoTests` 可加进 test script)
Run: `npm run dev -w @gladlog/desktop`(人工/主会话验证窗口出现 "gladlog shell" 后 Ctrl-C)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop package-lock.json
git commit -m "feat(desktop): electron-vite scaffold with main/preload/renderer/worker entries"
```

---

### Task 3: 协议类型 + SettingsStore

**Files:**

- Create: `packages/desktop/src/shared/protocol.ts`、`packages/desktop/src/main/settingsStore.ts`
- Test: `packages/desktop/test/settingsStore.test.ts`

**Interfaces:**

- Produces(全计划的公共契约,后续任务按此签名消费):

```ts
// src/shared/protocol.ts —— 完整文件
import type { GladMatch, GladShuffle } from "@gladlog/parser";

export interface FileCheckpoint {
  offset: number; // 已消费完整行尾的字节偏移(安全边界)
  firstLineChecksum: string | null; // 文件首行 sha1 hex;空文件为 null
}

export interface WorkerConfig {
  logsDir: string;
  checkpointsPath: string; // checkpoint registry JSON 的绝对路径
  quarantined: string[]; // 跳过的 fileKey(basename)
  flushIntervalMs: number; // 默认 2000
  quietPeriodMs: number; // 默认 5000
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
      current?: { fileKey: string; offset: number }; // 正在处理的位置(崩溃归因用)
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
  get(): GladlogSettings; // 缺失/损坏 → 全默认 null
  save(partial: Partial<GladlogSettings>): GladlogSettings; // 合并,原子写 tmp+rename,返回新值
}
```

- [ ] **Step 1: 写失败测试**

```ts
// test/settingsStore.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsStore } from "../src/main/settingsStore";

const dir = () => mkdtempSync(join(tmpdir(), "gl-settings-"));

describe("SettingsStore", () => {
  it("缺失文件 → 默认值", () => {
    const s = new SettingsStore(join(dir(), "settings.json"));
    expect(s.get()).toEqual({
      wowDirectory: null,
      anthropicApiKey: null,
      anthropicModel: null,
    });
  });
  it("save 合并并持久化;文件为合法 JSON", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.save({ wowDirectory: "/tmp/wow" }).wowDirectory).toBe("/tmp/wow");
    expect(new SettingsStore(p).get().wowDirectory).toBe("/tmp/wow");
    expect(JSON.parse(readFileSync(p, "utf-8")).anthropicApiKey).toBeNull();
  });
  it("损坏 JSON → 回退默认,不抛", () => {
    const p = join(dir(), "settings.json");
    writeFileSync(p, "{not json");
    expect(new SettingsStore(p).get().wowDirectory).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/settingsStore.test.ts`(cwd `packages/desktop`)
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**

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

`protocol.ts` 按上方 Interfaces 全文创建(类型文件,由 typecheck 覆盖)。

- [ ] **Step 4: 验证**

Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/shared/protocol.ts packages/desktop/src/main/settingsStore.ts packages/desktop/test/settingsStore.test.ts
git commit -m "feat(desktop): worker protocol types + atomic SettingsStore"
```

---

### Task 4: WoW 目录探测 + resolveLogsDir

**Files:**

- Create: `packages/desktop/src/main/detectWowDir.ts`
- Test: `packages/desktop/test/detectWowDir.test.ts`

**Interfaces:**

- Produces:

```ts
export interface FsProbe {
  exists(p: string): boolean;
}
export function realFsProbe(): FsProbe; // existsSync 包装
export function detectWowDirCandidates(opts: {
  platform: NodeJS.Platform;
  probe: FsProbe;
}): string[];
export function resolveLogsDir(selectedDir: string, probe?: FsProbe): string;
// 选中目录含 Logs 子目录 → 返回 <dir>/Logs;否则返回 selectedDir 本身(mac 测试目录友好)
```

语义移植自自有 `pipeline-app/detect.ts`(CLEAN):win32 探测 `C:\Program Files (x86)\World of Warcraft\_retail_` 与 `C:\Program Files\World of Warcraft\_retail_`,要求目录及其 `\Logs` 存在;非 win32 返回 `[]`。

- [ ] **Step 1: 写失败测试**

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
  it("win32:目录+Logs 都存在才返回", () => {
    const probe = probeOf([
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Logs",
      "C:\\Program Files\\World of Warcraft\\_retail_", // 无 Logs
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
  it("含 Logs 子目录 → 指向 Logs", () => {
    const probe = probeOf(["/x/_retail_/Logs"]);
    expect(resolveLogsDir("/x/_retail_", probe)).toBe("/x/_retail_/Logs");
  });
  it("不含 → 用原目录", () => {
    expect(resolveLogsDir("/y/mylogs", probeOf([]))).toBe("/y/mylogs");
  });
});
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/detectWowDir.test.ts`,Expected: FAIL

- [ ] **Step 3: 实现**

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

- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop`,Expected: PASS
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

- Consumes: `FileCheckpoint`(protocol.ts)
- Produces:

```ts
export interface CheckpointRegistry {
  files: Record<string, FileCheckpoint>;
} // key = fileKey(basename)
export function loadCheckpoints(path: string): CheckpointRegistry; // 缺失/损坏 → { files: {} }
export function saveCheckpoints(path: string, reg: CheckpointRegistry): void; // 原子 tmp+rename
```

语义移植自自有 `windows-agent/state.ts`(CLEAN,Filebeat registry 模式)。

- [ ] **Step 1: 写失败测试**

```ts
// test/checkpoints.test.ts
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadCheckpoints, saveCheckpoints } from "../src/worker/checkpoints";

const p = () => join(mkdtempSync(join(tmpdir(), "gl-cp-")), "checkpoints.json");

describe("checkpoints registry", () => {
  it("缺失 → 空 registry", () => {
    expect(loadCheckpoints(p())).toEqual({ files: {} });
  });
  it("save→load 往返", () => {
    const path = p();
    const reg = {
      files: { "WoWCombatLog-1.txt": { offset: 42, firstLineChecksum: "ab" } },
    };
    saveCheckpoints(path, reg);
    expect(loadCheckpoints(path)).toEqual(reg);
  });
  it("损坏 JSON → 空 registry,不抛", () => {
    const path = p();
    writeFileSync(path, "garbage");
    expect(loadCheckpoints(path)).toEqual({ files: {} });
  });
});
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/checkpoints.test.ts`,Expected: FAIL

- [ ] **Step 3: 实现**

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

- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop`,Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/checkpoints.ts packages/desktop/test/checkpoints.test.ts
git commit -m "feat(desktop): atomic checkpoint registry (ported own state.ts pattern)"
```

---

### Task 6: LogWatcher(自有 watcher 移植)

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

**实现即下方代码**(自有 CLEAN 资产 `windows-agent/watcher.ts` 的移植,行为语义逐条保留:事件驱动零轮询、脏集、flush 失败回插重试、quiet 补刷、空闲停表、丢 rename、过滤 `WoWCombatLog*.txt`;仅改日志前缀):

```ts
// src/worker/watcher.ts —— 完整文件
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
      // flush 失败不能杀 watcher;checkpoint 未推进,回插脏集等下一轮重试同一字节段
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

- [ ] **Step 1: 写失败测试**(fake timers + 注入 watchFn,不碰真 fs)

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

  it("change 事件入脏集,间隔到点 flush 排序后的文件名", async () => {
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

  it("rename 与非 WoWCombatLog*.txt 被忽略", async () => {
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

  it("flush 失败 → 文件回插,下一轮重试", async () => {
    let calls = 0;
    const w = make(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    w.handleEvent("change", "WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(100); // 失败
    await vi.advanceTimersByTimeAsync(100); // 重试成功
    expect(calls).toBe(2);
    w.close();
  });

  it("静默期在最后事件后补一次 flush", async () => {
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

  it("close 后事件被忽略", async () => {
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

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/watcher.test.ts`,Expected: FAIL
- [ ] **Step 3: 落上方实现** — 原样创建 `src/worker/watcher.ts`
- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop`,Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/watcher.ts packages/desktop/test/watcher.test.ts
git commit -m "feat(desktop): event-driven log watcher (ported own windows-agent watcher)"
```

---

### Task 7: TailReader(增量读 + 轮转/截断检测,字节精确)

**Files:**

- Create: `packages/desktop/src/worker/tailReader.ts`
- Test: `packages/desktop/test/tailReader.test.ts`

**Interfaces:**

- Consumes: `FileCheckpoint`
- Produces:

```ts
export interface TailState {
  offset: number; // 已消费完整行尾的字节偏移
  firstLineChecksum: string | null;
  carry: Buffer; // EOF 处的不完整行字节(跨 flush 保留)
}
export function initialTailState(cp?: FileCheckpoint | null): TailState;
export function firstLineChecksumOf(filePath: string): string | null; // 首行(≤4096B)sha1 hex;空文件 null
export function readTail(
  filePath: string,
  state: TailState,
): { lines: string[]; state: TailState; rotated: boolean };
// rotated=true 当 size < state.offset 或首行校验和与 state 不符 —— 此时返回的 lines 已是从 0 重读的内容,state 已重置为新文件口径
```

行为要点:行按 `\n` 字节切分、每行剥尾部 `\r`、UTF-8 按行 decode(carry 是 Buffer,天然避免多字节字符被块边界劈开);`state.offset` 只推进到最后一个完整行尾(含换行符);文件不存在 → `{ lines: [], rotated: false }` 原状返回;分块读(8MB)控制内存。

- [ ] **Step 1: 写失败测试**

```ts
// test/tailReader.test.ts
import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { initialTailState, readTail } from "../src/worker/tailReader";

const dir = () => mkdtempSync(join(tmpdir(), "gl-tail-"));

describe("readTail", () => {
  it("全新文件从 0 读完整行,offset 停在最后完整行尾", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\nline2\npartial");
    const r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["line1", "line2"]);
    expect(r.state.offset).toBe("line1\nline2\n".length);
    expect(r.rotated).toBe(false);
  });

  it("增量:carry 与后续追加拼成完整行", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\npar");
    let r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["line1"]);
    appendFileSync(f, "tial\nline3\n");
    r = readTail(f, r.state);
    expect(r.lines).toEqual(["partial", "line3"]);
  });

  it("CRLF 行剥 \\r;UTF-8 多字节在块边界不劈坏", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "拉格纳罗斯\r\n第二行\r\n");
    const r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["拉格纳罗斯", "第二行"]);
  });

  it("截断(size < offset)→ rotated,从 0 重读", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\ncccc\n");
    let r = readTail(f, initialTailState());
    writeFileSync(f, "new1\n"); // 截断重写
    r = readTail(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["new1"]);
  });

  it("同长换内容(首行校验和变)→ rotated", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\n");
    let r = readTail(f, initialTailState());
    writeFileSync(f, "zzzz\nbbbb\n"); // size 相同,首行变
    r = readTail(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["zzzz", "bbbb"]);
  });

  it("无新内容 → 空 lines,状态不变", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\n");
    const r1 = readTail(f, initialTailState());
    const r2 = readTail(f, r1.state);
    expect(r2.lines).toEqual([]);
    expect(r2.state.offset).toBe(r1.state.offset);
  });

  it("文件不存在 → 空结果不抛", () => {
    const r = readTail(join(dir(), "nope.txt"), initialTailState());
    expect(r.lines).toEqual([]);
    expect(r.rotated).toBe(false);
  });
});
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/tailReader.test.ts`,Expected: FAIL

- [ ] **Step 3: 实现**

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
      offset += start; // 只推进到最后一个完整行尾
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

- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop`,Expected: 全 PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/tailReader.ts packages/desktop/test/tailReader.test.ts
git commit -m "feat(desktop): byte-accurate tail reader with rotation/truncation detection"
```

---

### Task 8: FilePipeline(喂 parser + 安全边界 checkpoint)

**Files:**

- Create: `packages/desktop/src/worker/pipeline.ts`
- Test: `packages/desktop/test/pipeline.test.ts`

**Interfaces:**

- Consumes: `readTail`/`initialTailState`/`TailState`(Task 7)、`GladLogParser.hasOpenSegment()`(Task 1)、`WorkerToMain`/`FileCheckpoint`(Task 3)
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
    checkpoint: FileCheckpoint | null; // null = 新文件
    emit: (msg: WorkerToMain) => void;
    parserFactory?: () => ParserLike; // 默认 () => new GladLogParser()
  });
  processFlush(): void; // 读增量→喂行→按安全边界推进 checkpoint;轮转时重建 parser
  get checkpoint(): FileCheckpoint; // 当前安全边界(供 registry 保存)
  get currentOffset(): number; // 已读到的行尾偏移(status 用)
}
```

checkpoint 语义(spec 核心):`processFlush` 喂完本批行后,`parser.hasOpenSegment() === false` 才把 checkpoint 推进到 `tailState.offset`;open 时 checkpoint 保持不动(重启/崩溃后从上个安全边界重放,matchId 去重吸收)。轮转(`rotated`)→ 重建 parser 实例 + checkpoint 归零口径(新 checksum)。match/shuffle/diagnostic 事件在构造时接线,转成 `WorkerToMain` emit。

- [ ] **Step 1: 写失败测试**(fake parser 控制 hasOpenSegment;另加一个真 parser 集成用例)

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
  it("喂行;无 open segment → checkpoint 推进到行尾", () => {
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

  it("open segment → checkpoint 不动;闭合后下一次 flush 推进", () => {
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
    expect(pipe.checkpoint.offset).toBe(0); // 安全边界没动
    expect(pipe.currentOffset).toBe(10); // 但读进度在前面
    parser.open = false;
    appendFileSync(f, "end\n");
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe(14);
  });

  it("轮转 → 重建 parser(新实例收到新行)", () => {
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
    writeFileSync(f, "new1\n"); // 截断
    pipe.processFlush();
    expect(instances).toHaveLength(2);
    expect(instances[1]!.pushed).toEqual(["new1"]);
  });

  it("parser 事件转成 WorkerToMain emit(带 fileKey)", () => {
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

  it("集成:真 GladLogParser 解析合成对局并产出 match 事件", () => {
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
    expect(pipe.checkpoint.offset).toBeGreaterThan(0); // 对局闭合 → 安全边界已推进
  });
});
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/pipeline.test.ts`,Expected: FAIL

- [ ] **Step 3: 实现**

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

- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`,Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/pipeline.ts packages/desktop/test/pipeline.test.ts
git commit -m "feat(desktop): file pipeline with safe-boundary checkpoints and rotation reset"
```

---

### Task 9: worker runtime + utilityProcess 入口

**Files:**

- Create: `packages/desktop/src/worker/runtime.ts`、重写 `packages/desktop/src/worker/index.ts`
- Test: `packages/desktop/test/workerRuntime.test.ts`

**Interfaces:**

- Consumes: Task 5/6/7/8 全部、`MainToWorker`/`WorkerToMain`/`WorkerConfig`
- Produces:

```ts
export interface WorkerTransport {
  post(msg: WorkerToMain): void;
  onMessage(cb: (msg: MainToWorker) => void): void;
}
export function createWorkerRuntime(opts: {
  transport: WorkerTransport;
  watchFn?: typeof import("fs").watch; // 测试注入
  parserFactory?: () => import("./pipeline").ParserLike;
}): { dispose(): void };
```

行为:收到 `configure` → dispose 旧 watcher/pipelines → `loadCheckpoints(config.checkpointsPath)` → 列出 `logsDir` 下 `WoWCombatLog*.txt`(排除 `quarantined`)→ 每文件建 `FilePipeline`(fileKey=basename)→ **initial scan**(逐文件 `processFlush`)→ `startLogWatcher`(onFlush: 逐 fileName 找/建 pipeline → 发 `status`(含 `current: {fileKey, offset}`,在喂之前发,崩溃归因用)→ `processFlush` → 更新 registry → `saveCheckpoints`)→ 发 watching status。目录不可读 → `diagnostic { code: "LOGS_DIR_UNREADABLE" }` + `status watching:false`,不抛。

```ts
// src/worker/index.ts —— utilityProcess 入口,薄封装
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

- [ ] **Step 1: 写失败测试**

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

  it("configure → initial scan 已有文件并发出 match + status", () => {
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

  it("watcher 事件驱动增量解析新对局", async () => {
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

  it("quarantined 文件被跳过", () => {
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

  it("checkpoint 持久化:重建 runtime 后不重复发已解析对局", () => {
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
    expect(h2.out.some((m) => m.type === "match")).toBe(false); // 从安全边界续读,无新行
    rt2.dispose();
  });

  it("logsDir 不存在 → diagnostic + watching:false,不抛", () => {
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

注:initial-scan 用例里 `saveCheckpoints` 必须在 initial scan 后同步执行(不是只在 watcher flush 里),否则第 4 个用例不成立——实现时注意。

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/workerRuntime.test.ts`,Expected: FAIL

- [ ] **Step 3: 实现**

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

`src/worker/index.ts` 按 Interfaces 节的入口代码重写。

- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop && npm run build -w @gladlog/desktop`,Expected: 全 PASS,build 仍产出 worker.js
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/worker/runtime.ts packages/desktop/src/worker/index.ts packages/desktop/test/workerRuntime.test.ts
git commit -m "feat(desktop): worker runtime — configure/scan/watch loop with checkpoint persistence"
```

---

### Task 10: 崩溃归因 + WorkerHost

**Files:**

- Create: `packages/desktop/src/main/crashPolicy.ts`、`packages/desktop/src/main/workerHost.ts`
- Test: `packages/desktop/test/crashPolicy.test.ts`

**Interfaces:**

- Consumes: `WorkerConfig`/`MainToWorker`/`WorkerToMain`
- Produces:

```ts
// crashPolicy.ts(纯函数,单测覆盖)
export interface CrashRecord {
  fileKey: string | null;
  offset: number | null;
  count: number;
}
export const OFFSET_TOLERANCE = 65536;
export function nextCrashRecord(
  prev: CrashRecord | null,
  current: { fileKey: string; offset: number } | null, // 崩溃时 worker 最近上报的 status.current
): { record: CrashRecord; quarantine: string | null }; // quarantine=连续 3 次同文件近偏移 → 该 fileKey

// workerHost.ts(薄封装,不单测;dev 冒烟验证)
export class WorkerHost {
  constructor(opts: {
    workerModulePath: string; // out/main/worker.js
    onMessage: (msg: WorkerToMain) => void;
    onQuarantine: (fileKey: string) => void;
    log: { info(m: string): void; error(m: string): void };
  });
  start(config: WorkerConfig): void; // spawn utilityProcess + 发 configure
  reconfigure(config: WorkerConfig): void; // 更新配置(logsDir 变更)
  stop(): void;
}
```

WorkerHost 行为:`utilityProcess.fork(workerModulePath)`;缓存最近 `status.current`;`exit` 且非主动 stop → `nextCrashRecord` 归因,若 quarantine → 加入 quarantined 集 + `onQuarantine`,1s 后用(更新过 quarantined 的)config 重启;收到任意 match/shuffle 消息 → 崩溃记录清零(说明有进展)。

- [ ] **Step 1: 写失败测试**

```ts
// test/crashPolicy.test.ts
import { nextCrashRecord } from "../src/main/crashPolicy";

describe("nextCrashRecord", () => {
  it("无归因信息 → count 1,不隔离", () => {
    const r = nextCrashRecord(null, null);
    expect(r.record.count).toBe(1);
    expect(r.quarantine).toBeNull();
  });
  it("同文件近偏移连续 3 次 → 隔离该文件", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 1000 });
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 1500 });
    expect(r.quarantine).toBeNull();
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 2000 });
    expect(r.quarantine).toBe("a.txt");
  });
  it("换文件 → 计数重置", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 0 });
    r = nextCrashRecord(r.record, { fileKey: "b.txt", offset: 0 });
    expect(r.record.count).toBe(1);
    expect(r.quarantine).toBeNull();
  });
  it("同文件远偏移(> tolerance)→ 计数重置(有进展,不是同一毒丸)", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 0 });
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 1_000_000 });
    expect(r.record.count).toBe(1);
  });
});
```

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/crashPolicy.test.ts`,Expected: FAIL

- [ ] **Step 3: 实现**

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
      if (msg.type === "match" || msg.type === "shuffle") this.crash = null; // 有进展,清计数
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

- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`,Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/crashPolicy.ts packages/desktop/src/main/workerHost.ts packages/desktop/test/crashPolicy.test.ts
git commit -m "feat(desktop): worker host with crash attribution and per-file quarantine"
```

---

### Task 11: MatchStore(meta/match/raw 三文件落盘)

**Files:**

- Create: `packages/desktop/src/main/matchStore.ts`
- Test: `packages/desktop/test/matchStore.test.ts`

**Interfaces:**

- Consumes: `GladMatch`/`GladShuffle`(`@gladlog/parser`;`GladMatch` 有 `id/bracket/zoneId/startTime/endTime/result/rawLines`;`GladShuffle` 有 `rounds/startTime/endTime/rawLines/result`,**无自身 id**)
- Produces:

```ts
export interface StoredMatchMeta {
  id: string;
  kind: "match" | "shuffle";
  bracket: string; // shuffle 取 rounds[0].bracket
  zoneId: string; // shuffle 取 rounds[0].zoneId
  startTime: number;
  endTime: number;
  result: string; // MatchResult 序列化
  storedAt: number;
}
export class MatchStore {
  constructor(rootDir: string, opts?: { now?: () => number });
  init(): StoredMatchMeta[]; // 扫 rootDir/*/meta.json 建索引(损坏条目跳过)
  store(item: GladMatch | GladShuffle): {
    stored: boolean;
    meta: StoredMatchMeta | null;
  };
  // stored=false: 已存在(幂等)或 shuffle rounds 为空(meta=null)
  list(): StoredMatchMeta[]; // 按 startTime 降序
  get(id: string): unknown | null; // match.json 的完整内容(信封+data)
}
```

落盘规则:目录 `rootDir/<id>/`,先写 `rootDir/.tmp-<id>/` 再 `renameSync` 到位(原子);三文件:

- `meta.json` = `StoredMatchMeta`(启动索引只读它,避免读大文件)
- `match.json` = `{ schemaVersion: 1, storedAt, kind, data }`,`data` 为**剥掉 rawLines** 的 payload(shuffle 还要剥每个 round 的 rawLines)
- `raw.txt` = `payload.rawLines.join("\n") + "\n"`

shuffle 的 id = `rounds[0].id`(内容哈希,重放确定)。id 用作目录名——`GladMatch.id` 是内容哈希 hex,天然文件名安全;实现时仍做一次 `/[^A-Za-z0-9._-]/g → "_"` 防御性清洗。

- [ ] **Step 1: 写失败测试**

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
  it("store match → 三文件落盘,match.json 剥 rawLines,raw.txt 保留", () => {
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

  it("重复 id → stored:false,不覆盖", () => {
    const s = new MatchStore(dir());
    s.store(fakeMatch("dup"));
    expect(s.store(fakeMatch("dup")).stored).toBe(false);
    expect(s.list()).toHaveLength(1);
  });

  it("shuffle:id 取 rounds[0].id;round 的 rawLines 也剥掉", () => {
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

  it("rounds 为空的 shuffle → stored:false, meta:null", () => {
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

  it("init 重扫恢复索引,list 按 startTime 降序", () => {
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

- [ ] **Step 2: 确认失败** — Run: `npx vitest run test/matchStore.test.ts`,Expected: FAIL

- [ ] **Step 3: 实现**

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
      /* 保持空索引 */
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      try {
        const meta = JSON.parse(
          readFileSync(join(this.rootDir, name, "meta.json"), "utf-8"),
        ) as StoredMatchMeta;
        if (typeof meta.id === "string") this.index.set(meta.id, meta);
      } catch {
        /* 损坏条目跳过 */
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

- [ ] **Step 4: 验证** — Run: `npm test -w @gladlog/desktop && npm run typecheck -w @gladlog/desktop`,Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/matchStore.ts packages/desktop/test/matchStore.test.ts
git commit -m "feat(desktop): match store — atomic meta/match/raw persistence with idempotent dedupe"
```

---

### Task 12: 主进程组装 + IPC + preload bridge

**Files:**

- Rewrite: `packages/desktop/src/main/index.ts`、`packages/desktop/src/preload/index.ts`
- Create: `packages/desktop/src/main/ipc.ts`、`packages/desktop/src/preload/api.ts`
- Test: 无新单测(全是 Electron 接线);验证 = typecheck + build + dev 冒烟

**Interfaces:**

- Consumes: Task 3/4/10/11 全部
- Produces(renderer 消费的完整 bridge,Task 13 依赖):

```ts
// src/preload/api.ts —— 完整文件
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
    selectDirectory(): Promise<string | null>; // 返回选中目录;取消 → null。选中即自动 save wowDirectory 并重启监控
    openExternal(url: string): Promise<void>;
  };
}
declare global {
  interface Window {
    gladlog: GladlogApi;
  }
}
```

IPC 通道名(唯一注册点 `ipc.ts`):`gladlog:logs:getStatus`、`gladlog:matches:list`、`gladlog:matches:get`、`gladlog:settings:get`、`gladlog:settings:save`、`gladlog:app:getVersion`、`gladlog:app:selectDirectory`、`gladlog:app:openExternal`(仅放行 `https?://`);推送事件:`gladlog:logs:statusChanged`、`gladlog:logs:matchStored`、`gladlog:logs:diagnostic`。

- [ ] **Step 1: preload 实现**

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
// src/main/index.ts —— 完整重写
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
  if (!dir) return; // 等用户手选
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
Expected: 全 PASS(注意 worker bundle 文件名:electron-vite 对 `input.worker` 的产物名需与 `workerModulePath` 的 `worker.js` 一致,不一致则调 `rollupOptions.output.entryFileNames`)

- [ ] **Step 4: dev 冒烟(主会话执行,不是 subagent)**

准备:`mkdir -p /tmp/gl-smoke/Logs && cp <语料样本一个中等日志> /tmp/gl-smoke/Logs/WoWCombatLog-smoke.txt`
Run: `npm run dev -w @gladlog/desktop`
在窗口 DevTools console 验证:`await window.gladlog.settings.save({ wowDirectory: '/tmp/gl-smoke' })` → `await window.gladlog.matches.list()` 数秒后返回非空数组;`~/Library/Application Support/gladlog-desktop/matches/` 出现对局目录。
Expected: 上述全部成立

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main packages/desktop/src/preload
git commit -m "feat(desktop): main-process assembly, typed IPC bridge, preload api"
```

---

### Task 13: 调试级 renderer UI

**Files:**

- Rewrite: `packages/desktop/src/renderer/src/App.tsx`、`packages/desktop/src/renderer/src/styles.css`

**Interfaces:**

- Consumes: `window.gladlog`(Task 12 的 `GladlogApi`)
- Produces: 四栏调试页——状态栏(watching/logsDir/files+offset/quarantine + 选目录按钮)、对局列表(实时前插)、详情(`<pre>` JSON)、诊断流(最近 100 条)。shuffle 只显示场级(未决事项已定:回合明细留子项目 3)。

- [ ] **Step 1: 实现 App.tsx**

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
        <h2>监控状态</h2>
        <p>
          WoW 目录:{wowDir ?? "未设置"}{" "}
          <button onClick={() => void pickDir()}>选择目录…</button>
        </p>
        <p>
          {status
            ? status.watching
              ? `✅ watching ${status.logsDir}`
              : `⛔ 未监控(${status.logsDir || "无目录"})`
            : "worker 未启动"}
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
        <h2>对局({matches.length})</h2>
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
        <h2>详情</h2>
        <pre>{detail ? JSON.stringify(detail, null, 2) : "选择一场对局"}</pre>
      </section>
      <section className="panel">
        <h2>诊断({diags.length})</h2>
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

- [ ] **Step 2: 验证** — Run: `npm run typecheck -w @gladlog/desktop && npm run build -w @gladlog/desktop`,Expected: PASS;dev 冒烟同 Task 12 Step 4,此时界面上应能看到状态/列表/详情/诊断四栏并随回放实时更新(主会话执行)。
- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer
git commit -m "feat(desktop): debug-grade live UI — status, match list, detail, diagnostics"
```

---

### Task 14: e2e 回放脚本 + 验收清单

**Files:**

- Create: `packages/desktop/scripts/replay-log.mjs`

**Interfaces:**

- Produces: `node scripts/replay-log.mjs --source <真实日志> --dest <logsDir>/WoWCombatLog-replay.txt [--chunk 500] [--interval 300]` —— 把源日志按 chunk 行、每 interval 毫秒追加到 dest,模拟游戏实时写入。

- [ ] **Step 1: 实现**

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

- [ ] **Step 2: 验收执行(主会话跑,不派 subagent;需要 `GLADLOG_FIXTURES` 语料或本地 104GB 语料中的样本)**

验收清单(全部通过才算过):

1. **实时**:`npm run dev` + `settings.save({wowDirectory:'/tmp/gl-e2e'})`(目录含空 Logs/)→ 起回放脚本写 `/tmp/gl-e2e/Logs/WoWCombatLog-replay.txt` → 界面对局列表随回放增长;每场 `~/Library/Application Support/gladlog-desktop/matches/<id>/` 三文件齐且 `raw.txt` 行数≈该场 rawLines。
2. **重启恢复**:回放中途 Ctrl-C 杀 app → 重启 dev → 列表恢复(索引从磁盘重建),回放继续后新对局继续入列,**无重复 id**(matches 目录数=列表数)。
3. **轮转**:回放完成后 `rm dest` 并用另一样本再跑同名 dest → 新对局照常出现(rotated 路径)。
4. **诊断**:把 wowDirectory 指到不存在的路径 → 诊断流出现 `LOGS_DIR_UNREADABLE`,状态显示未监控;改回 → 恢复。

Expected: 4/4 通过;任一不过 → 修复后重跑该项。

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/scripts/replay-log.mjs
git commit -m "feat(desktop): log replay script for e2e acceptance"
```

---

### Task 15: electron-builder 打包

**Files:**

- Create: `packages/desktop/electron-builder.yml`
- Modify: `packages/desktop/package.json`(如需补 `productName`/`build` 字段引用)

- [ ] **Step 1: 配置**

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
  identity: null # 不签名
win:
  target: nsis
nsis:
  oneClick: true
npmRebuild: false
```

- [ ] **Step 2: mac 包验证(本机)**

Run: `npm run package:mac -w @gladlog/desktop`
Expected: `dist-app/gladlog-0.0.1.dmg` 产出;挂载安装后启动,窗口出现且选目录→回放→出对局(同 Task 14 清单第 1 项,用打包版跑一遍)
注:Windows NSIS 包在用户 Windows 机上构建验收(`npm run package:win`),不阻塞本任务 commit;结果记入 progress.md。

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/electron-builder.yml packages/desktop/package.json
git commit -m "build(desktop): electron-builder config — mac dmg + win nsis, unsigned v1"
```

---

### Task 16: 收官——账本与文档

**Files:**

- Modify: `.superpowers/progress.md`(追加子项目 2 完成行:各任务 commit、验收结果、遗留)
- Modify: `README.md`(路线图勾选子项目 2,若有该清单)
- Modify: `HANDOFF-2026-07-10.md` 不动(历史文档);如需新 handoff 由主会话决定

- [ ] **Step 1: 更新 progress.md**(格式沿用现有账本:一行一里程碑 + "下一步")
- [ ] **Step 2: 全仓验证**

Run: `npm test --workspaces --if-present && npm run typecheck --workspaces --if-present`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add .superpowers/progress.md README.md
git commit -m "docs: sub-project 2 (desktop shell) complete — ledger + roadmap"
```

---

## Self-Review(计划自查记录)

- **Spec 覆盖**:监控(T6/T9)、解析 worker(T8/T9)、落盘(T11)、bridge(T12)、调试 UI(T13)、settings(T3)、探测(T4)、打包(T15)、安全边界 checkpoint(T1/T8)、quarantine(T10)、e2e(T14)——spec 全节有对应任务。spec"错误处理"节的磁盘满场景由 store 写失败向上抛→ main uncaught handler 记日志兜底,未单列任务(接受:v1 兜底语义)。
- **占位符**:无 TBD/TODO;所有测试与实现均给全码。
- **类型一致性**:`FileCheckpoint`/`WorkerToMain`/`GladlogApi`/`StoredMatchMeta` 在 T3 定义、T5/8/9/10/11/12/13 消费,签名逐一核对一致;`hasOpenSegment()` T1 定义、T8 消费。
- **已知风险**:electron-vite 的 worker 产物文件名(T12 Step 3 有对策);Task 1 shuffle 合成行的 bracket 字符串需对照本仓库 segmenter 实测(任务内已写明查法)。
