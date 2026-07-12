# Match-List Pagination + Fast Startup Index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop match list load fast with a huge WoW-log history by paginating the sidebar (initial 100, infinite-scroll older) and replacing N synchronous startup meta reads with a single append-only NDJSON index.

**Architecture:** Add `MatchStore.page({before,limit})` (a pure slice of the in-memory index) + a `matches:page` IPC + an infinite-scroll `App.tsx`. Separately, back the in-memory index with an append-only `_index.ndjson` (one read at startup, O(1) append per store, cheap `readdir` reconciliation, one-time migration from legacy per-dir `meta.json`). Ingestion/parsing untouched.

**Tech Stack:** Electron + electron-vite + React, TypeScript ESM, vitest, Node fs.

## Global Constraints

- **Typecheck:** `npm run typecheck` (`tsc --noEmit`). NEVER `tsc -b`.
- **ESM**, tests are vitest (`import { describe, expect, it } from "vitest"`).
- **Do not touch ingestion/parsing** (log watcher, worker, checkpoints) — it's already checkpointed.
- **Index is append-only NDJSON** `_index.ndjson`; `store()` appends one line, never rewrites the whole file. Match dir write stays tmp→rename atomic and happens BEFORE the index append.
- **Page size 100**; `page` limit clamped to [1, 500]; `before` strict `<`.
- Keep existing `list()` and `matches:list`/`matches:get` (DevPanel/tests use them).

---

### Task 1: `MatchStore.page()` — paginated slice

**Files:**

- Modify: `packages/desktop/src/main/matchStore.ts`
- Test: `packages/desktop/src/main/matchStore.test.ts`

**Interfaces:**

- Produces: `page(opts: { before?: number; limit: number }): StoredMatchMeta[]` — most-recent-first; returns up to `limit` metas with `startTime < before` (most recent `limit` when `before` omitted).

- [ ] **Step 1: Write the failing test**

Add to `packages/desktop/src/main/matchStore.test.ts` (create it if absent, with the imports below):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MatchStore } from "./matchStore";
import type { GladMatch } from "@gladlog/parser";

function tmpStore() {
  return new MatchStore(mkdtempSync(join(tmpdir(), "ms-")));
}
function mkMatch(id: string, startTime: number): GladMatch {
  return {
    kind: "match",
    id,
    bracket: "2v2",
    zoneId: "0",
    startTime,
    endTime: startTime + 1,
    result: 0,
    rawLines: [],
  } as unknown as GladMatch;
}

describe("MatchStore.page", () => {
  it("returns the most-recent `limit` matches, newest first", () => {
    const s = tmpStore();
    for (const t of [100, 300, 200]) s.store(mkMatch(`m${t}`, t));
    const p = s.page({ limit: 2 });
    expect(p.map((m) => m.startTime)).toEqual([300, 200]);
  });
  it("pages older via `before` (strict <)", () => {
    const s = tmpStore();
    for (const t of [100, 200, 300]) s.store(mkMatch(`m${t}`, t));
    expect(s.page({ before: 300, limit: 10 }).map((m) => m.startTime)).toEqual([
      200, 100,
    ]);
    expect(s.page({ before: 100, limit: 10 })).toEqual([]);
  });
  it("clamps limit to [1,500]", () => {
    const s = tmpStore();
    for (const t of [1, 2, 3]) s.store(mkMatch(`m${t}`, t));
    expect(s.page({ limit: 0 })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/desktop && npx vitest run src/main/matchStore.test.ts`
Expected: FAIL (`page` is not a function).

- [ ] **Step 3: Implement `page`**

In `packages/desktop/src/main/matchStore.ts`, add this method to the `MatchStore` class (after `list()`):

```ts
  page(opts: { before?: number; limit: number }): StoredMatchMeta[] {
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit || 0)));
    const before = Number.isFinite(opts.before as number)
      ? (opts.before as number)
      : Infinity;
    return this.list()
      .filter((m) => m.startTime < before)
      .slice(0, limit);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/matchStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/matchStore.ts packages/desktop/src/main/matchStore.test.ts
git commit -m "feat(desktop): MatchStore.page() paginated slice"
```

---

### Task 2: `matches:page` IPC + preload bridge

**Files:**

- Modify: `packages/desktop/src/main/ipc.ts` (add handler after the `matches:get` handler)
- Modify: `packages/desktop/src/preload/api.ts` (add `page` to the `matches` type)
- Modify: `packages/desktop/src/preload/index.ts` (add `page` impl)
- Test: `packages/desktop/src/main/ipc.test.ts` (if present; else skip — covered by the store test + a manual smoke)

**Interfaces:**

- Consumes: `store.page({before,limit})` (Task 1).
- Produces: renderer `bridge().matches.page(opts: { before?: number; limit: number }): Promise<StoredMatchMeta[]>`.

- [ ] **Step 1: Add the IPC handler**

In `packages/desktop/src/main/ipc.ts`, directly below the existing `gladlog:matches:get` line, add:

```ts
ipcMain.handle(
  "gladlog:matches:page",
  (_e, opts: { before?: number; limit: number }) => deps.store.page(opts),
);
```

- [ ] **Step 2: Extend the preload type**

In `packages/desktop/src/preload/api.ts`, inside the `matches: {` block (which already declares `list()`), add:

```ts
    page(opts: {
      before?: number;
      limit: number;
    }): Promise<StoredMatchMeta[]>;
```

- [ ] **Step 3: Add the preload implementation**

In `packages/desktop/src/preload/index.ts`, inside the `matches: {` object (next to `list`/`get`), add:

```ts
    page: (opts) => ipcRenderer.invoke("gladlog:matches:page", opts),
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/desktop && npm run typecheck`
Expected: clean (0 errors).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/ipc.ts packages/desktop/src/preload/api.ts packages/desktop/src/preload/index.ts
git commit -m "feat(desktop): matches:page IPC + preload bridge"
```

---

### Task 3: Infinite-scroll sidebar (renderer)

**Files:**

- Modify: `packages/desktop/src/renderer/src/App.tsx`
- Test: `packages/desktop/test/report.app.test.tsx` (add a case) OR a new `packages/desktop/src/renderer/src/App.pagination.test.tsx`

**Interfaces:**

- Consumes: `bridge().matches.page({before,limit})` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/renderer/src/App.pagination.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import App from "./App";
import { bridge } from "./bridge";

vi.mock("./bridge");

const meta = (id: string, startTime: number) => ({
  id,
  kind: "match",
  bracket: "2v2",
  zoneId: "0",
  startTime,
  endTime: startTime + 1,
  result: "0",
  storedAt: 0,
});

beforeEach(() => {
  const page = vi.fn(async (opts: { before?: number; limit: number }) => {
    // 250 synthetic matches, startTime 250..1 (newest first)
    const all = Array.from({ length: 250 }, (_, i) =>
      meta(`m${250 - i}`, 250 - i),
    );
    const before = opts.before ?? Infinity;
    return all.filter((m) => m.startTime < before).slice(0, opts.limit);
  });
  (bridge as unknown as vi.Mock).mockReturnValue({
    matches: { page, get: vi.fn().mockResolvedValue(null), list: vi.fn() },
    logs: { onMatchStored: () => () => {} },
  });
});

describe("App pagination", () => {
  it("loads the first 100 on mount and appends older on scroll-to-bottom", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(100),
    );
    const list = screen.getByTestId("match-list");
    // simulate reaching the bottom
    Object.defineProperty(list, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(list, "clientHeight", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(list, "scrollTop", {
      value: 700,
      configurable: true,
    });
    fireEvent.scroll(list);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(200),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/desktop && npx vitest run src/renderer/src/App.pagination.test.tsx`
Expected: FAIL (App still calls `list()`; no `data-testid="match-list"`; no scroll handler).

- [ ] **Step 3: Rewrite the list load + render in `App.tsx`**

Replace the first `useEffect` (the `matches.list()` one) and the sidebar `<ul>` in `packages/desktop/src/renderer/src/App.tsx`.

Replace the mount effect:

```tsx
const [hasMore, setHasMore] = useState(true);
const loadingRef = useRef(false);
const PAGE = 100;

useEffect(() => {
  void bridge()
    .matches.page({ limit: PAGE })
    .then((list) => {
      setMetas(list);
      setHasMore(list.length === PAGE);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    });
  const unMatchStored = bridge().logs.onMatchStored((m) =>
    setMetas((prev) => [m, ...prev]),
  );
  return () => {
    unMatchStored();
  };
}, []);

const loadOlder = () => {
  if (loadingRef.current || !hasMore) return;
  const oldest = metas[metas.length - 1];
  if (!oldest) return;
  loadingRef.current = true;
  void bridge()
    .matches.page({ before: oldest.startTime, limit: PAGE })
    .then((older) => {
      setMetas((prev) => [...prev, ...older]);
      setHasMore(older.length === PAGE);
    })
    .finally(() => {
      loadingRef.current = false;
    });
};

const onScroll = (e: React.UIEvent<HTMLUListElement>) => {
  const el = e.currentTarget;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadOlder();
};
```

Add `useRef` to the React import: `import { useEffect, useRef, useState } from "react";`.

Replace the sidebar `<ul>...</ul>` with:

```tsx
<ul data-testid="match-list" className="match-list" onScroll={onScroll}>
  {metas.map((m) => (
    <li
      key={m.id}
      className={m.id === selectedId ? "sel" : ""}
      onClick={() => setSelectedId(m.id)}
    >
      <span className={`badge badge-${m.kind}`}>[{m.kind}]</span> {m.bracket} ·{" "}
      {fmt(m.startTime)} · {m.result}
    </li>
  ))}
  {hasMore && <li className="loading-more">加载更早…</li>}
</ul>
```

- [ ] **Step 4: Ensure the sidebar list scrolls**

In `packages/desktop/src/renderer/src/styles.css`, ensure the list can scroll (add if not present):

```css
.match-list {
  overflow-y: auto;
  max-height: calc(100vh - 60px);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/renderer/src/App.pagination.test.tsx`
Expected: PASS (100 on mount, 200 after scroll).

- [ ] **Step 6: Full desktop suite + typecheck**

Run: `cd packages/desktop && npx vitest run && npm run typecheck`
Expected: all green (the existing `report.app.test.tsx` must still pass — if it stubbed `matches.list`, update its stub to also provide `matches.page` returning the same metas).

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/src/App.tsx packages/desktop/src/renderer/src/App.pagination.test.tsx packages/desktop/src/renderer/src/styles.css
git commit -m "feat(desktop): infinite-scroll match sidebar (initial 100, load older on scroll)"
```

---

### Task 4: Append-only NDJSON startup index

**Files:**

- Modify: `packages/desktop/src/main/matchStore.ts`
- Test: `packages/desktop/src/main/matchStore.test.ts`

**Interfaces:**

- Consumes: existing `store()`, `init()`, `StoredMatchMeta`.
- Produces: `_index.ndjson` under `rootDir`; `init()` reads it once + reconciles; `store()` appends one line.

- [ ] **Step 1: Write the failing tests**

Add to `packages/desktop/src/main/matchStore.test.ts`:

```ts
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";

describe("MatchStore NDJSON index", () => {
  it("store appends one line to _index.ndjson (no full rewrite)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("a", 1));
    s.store(mkMatch("b", 2));
    const lines = readFileSync(join(dir, "_index.ndjson"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("a");
  });
  it("init() reads the NDJSON in one shot (dedups by id, last wins)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    new MatchStore(dir).store(mkMatch("a", 5));
    const s2 = new MatchStore(dir); // fresh instance
    expect(s2.init().map((m) => m.id)).toEqual(["a"]);
  });
  it("migrates: rebuilds _index.ndjson from legacy per-dir meta.json when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("a", 3));
    rmSync(join(dir, "_index.ndjson")); // simulate a legacy install
    const s2 = new MatchStore(dir);
    expect(s2.init().map((m) => m.id)).toEqual(["a"]);
    expect(existsSync(join(dir, "_index.ndjson"))).toBe(true);
  });
  it("reconciles a dir present but missing from the index", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-idx-"));
    const s = new MatchStore(dir);
    s.store(mkMatch("a", 1));
    s.store(mkMatch("b", 2));
    // drop b's index line but keep its dir (simulate crash after dir write, before append)
    writeFileSync(
      join(dir, "_index.ndjson"),
      JSON.stringify({
        id: "a",
        kind: "match",
        bracket: "2v2",
        zoneId: "0",
        startTime: 1,
        endTime: 2,
        result: "0",
        storedAt: 0,
      }) + "\n",
    );
    const s2 = new MatchStore(dir);
    expect(
      s2
        .init()
        .map((m) => m.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/desktop && npx vitest run src/main/matchStore.test.ts`
Expected: FAIL (no `_index.ndjson` written; init reads per-dir metas).

- [ ] **Step 3: Rework `init()` and `store()` for the NDJSON index**

In `packages/desktop/src/main/matchStore.ts`:

Add near the top of the class:

```ts
  private indexPath = () => join(this.rootDir, "_index.ndjson");
```

Replace `init()` with:

```ts
  init(): StoredMatchMeta[] {
    this.index.clear();
    // 1) Fast path: one read of the append-only index (dedup by id, last wins).
    try {
      const raw = readFileSync(this.indexPath(), "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const meta = JSON.parse(line) as StoredMatchMeta;
          if (typeof meta.id === "string") this.index.set(meta.id, meta);
        } catch {
          /* skip a corrupt line */
        }
      }
    } catch {
      /* no index yet → migrate below */
    }
    // 2) Reconcile with the per-dir source of truth (cheap: dir NAMES only).
    //    Use Sets so reconciliation is O(N), not O(N^2).
    let names: string[] = [];
    try {
      names = readdirSync(this.rootDir);
    } catch {
      /* empty */
    }
    const nameSet = new Set(
      names.filter((n) => !n.startsWith(".") && !n.startsWith("_")),
    );
    const indexedDirs = new Set(
      [...this.index.values()].map((m) => safeName(m.id)),
    );
    let repaired = false;
    // Recover dirs present on disk but missing from the index (crash between
    // dir write and index append).
    for (const name of nameSet) {
      if (indexedDirs.has(name)) continue;
      try {
        const meta = JSON.parse(
          readFileSync(join(this.rootDir, name, "meta.json"), "utf-8"),
        ) as StoredMatchMeta;
        if (typeof meta.id === "string") {
          this.index.set(meta.id, meta);
          this.appendIndexLine(meta);
          repaired = true;
        }
      } catch {
        /* corrupt dir → skip */
      }
    }
    // Drop index entries whose dir is gone.
    for (const [id] of [...this.index]) {
      if (!nameSet.has(safeName(id))) {
        this.index.delete(id);
        repaired = true;
      }
    }
    // No index file at all → write one from what we have (migration); or repair.
    if (!existsSync(this.indexPath()) || repaired) this.rewriteIndex();
    return this.list();
  }

  private appendIndexLine(meta: StoredMatchMeta): void {
    appendFileSync(this.indexPath(), JSON.stringify(meta) + "\n");
  }

  private rewriteIndex(): void {
    const tmp = this.indexPath() + ".tmp";
    writeFileSync(
      tmp,
      [...this.index.values()].map((m) => JSON.stringify(m)).join("\n") +
        (this.index.size ? "\n" : ""),
    );
    renameSync(tmp, this.indexPath());
  }
```

In `store()`, after `this.index.set(id, meta);` (right before `return { stored: true, meta };`), add:

```ts
this.appendIndexLine(meta);
```

Add `appendFileSync` and `existsSync` to the `fs` import at the top of the file:

```ts
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/main/matchStore.test.ts`
Expected: PASS (all page + NDJSON tests).

- [ ] **Step 5: Full desktop suite + typecheck**

Run: `cd packages/desktop && npx vitest run && npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/matchStore.ts packages/desktop/src/main/matchStore.test.ts
git commit -m "perf(desktop): append-only NDJSON match index — one-read startup + O(1) store"
```

---

## Self-Review

**Spec coverage:**

- `page({before,limit})` slice → Task 1. ✓
- `matches:page` IPC + bridge → Task 2. ✓
- Renderer infinite scroll (initial 100, older on scroll, hasMore) → Task 3. ✓
- Append-only NDJSON index, one-read init, O(1) append, migration, readdir reconciliation → Task 4. ✓
- Ingestion untouched → nothing in the plan touches the watcher/worker. ✓
- Keep `list()`/`matches:list`/`get` → unchanged. ✓

**Type consistency:** `page(opts: { before?: number; limit: number }): StoredMatchMeta[]` identical in Task 1 (impl), Task 2 (IPC/preload type), Task 3 (renderer call). `StoredMatchMeta` is the existing exported interface. `appendIndexLine`/`rewriteIndex`/`indexPath` are private helpers defined and used within Task 4.

**Placeholder scan:** none — every code step is complete.

**Ordering note:** Tasks 1–3 deliver the full render fix (the dominant cost) and are independently shippable; Task 4 adds the startup-index optimization and does not change `page()`'s behavior (it only changes how the in-memory index is populated), so the Task 1/3 tests keep passing.

**Known accepted risks (from the spec's agy debate):** `safeName` id collision (pre-existing; WoW GUIDs don't collide) and out-of-band `meta.json` edits (app-private `userData`) — not handled here by design.
