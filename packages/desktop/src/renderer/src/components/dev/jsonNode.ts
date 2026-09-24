/**
 * Pure logic layer of the dev page's JSON inspector (plan 5a, item 3.7).
 *
 * The one hard constraint: **serialize only expanded nodes**. Library
 * match.json averages ≈62MB (794 matches / 49GB); the old implementation
 * did `JSON.stringify(the whole doc)` and dumped it into a <pre>, which
 * froze the renderer process outright (measured 2026-07-26: 30s
 * unresponsive). Every function here works one level at a time: listing
 * children only touches the direct child values of the current level, and
 * container children only get a size summary (`.length` / `Object.keys`)
 * — never descending further. Tests pin this contract down with an access
 * counter (Proxy).
 */

export type JsonNodeKind =
  "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonChild {
  /** Object key name, or the decimal string of an array index */
  key: string;
  /** Full key path from the root; can be fed back to resolvePath */
  path: string;
  value: unknown;
  kind: JsonNodeKind;
  /** Inline display text for leaves (already capped); null for containers */
  preview: string | null;
  /** Size summary for containers (`[1000]` / `{12}`); null for leaves */
  summary: string | null;
}

interface ChildPage {
  children: JsonChild[];
  /** Total child count of this container (unaffected by paging) */
  total: number;
  /** Total page count; always 1 for objects */
  pages: number;
  /** The page number actually in effect (out-of-range input is clamped
   * to the last page) */
  page: number;
}

/**
 * Array entries per page: laying 50k casts into the DOM at once is just
 * another way to freeze.
 */
export const ARRAY_PAGE_SIZE = 500;

/** Character cap for a leaf's inline preview. */
const LEAF_PREVIEW_CAP = 200;

/**
 * Node budget for key-name search: a full-graph walk of a 62MB doc is a
 * seconds-long task, so it must have a ceiling.
 */
export const SEARCH_NODE_BUDGET = 200_000;

/** Maximum number of hits reported by a single search. */
const SEARCH_HIT_CAP = 50;

export function kindOf(v: unknown): JsonNodeKind {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") return "object";
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  // undefined / function / symbol never appear in JSON.parse output; show
  // them as null
  return "null";
}

export function isContainer(kind: JsonNodeKind): boolean {
  return kind === "object" || kind === "array";
}

/**
 * Inline text for a leaf. Over-long strings are truncated and annotated
 * with their original length — a single raw field can be tens of KB.
 */
export function leafPreview(v: unknown, cap = LEAF_PREVIEW_CAP): string {
  if (typeof v === "string" && v.length > cap) {
    return `${JSON.stringify(v.slice(0, cap))}… (${v.length} 字符)`;
  }
  const s = JSON.stringify(v);
  return s === undefined ? "null" : s;
}

/** Size summary of a container. Reads only length / keys, never elements. */
function containerSummary(v: unknown, kind: JsonNodeKind): string {
  if (kind === "array") return `[${(v as unknown[]).length}]`;
  return `{${Object.keys(v as object).length}}`;
}

function joinPath(base: string, key: string, parentIsArray: boolean): string {
  if (parentIsArray) return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

function toChild(
  key: string,
  value: unknown,
  base: string,
  parentIsArray: boolean,
): JsonChild {
  const kind = kindOf(value);
  const container = isContainer(kind);
  return {
    key,
    path: joinPath(base, key, parentIsArray),
    value,
    kind,
    preview: container ? null : leafPreview(value),
    summary: container ? containerSummary(value, kind) : null,
  };
}

/**
 * List the children at the `value` level. Arrays are paged
 * (ARRAY_PAGE_SIZE per page), objects are not. Non-containers return an
 * empty page.
 */
export function childrenOf(
  value: unknown,
  basePath: string,
  page = 0,
): ChildPage {
  const kind = kindOf(value);
  if (kind === "array") {
    const arr = value as unknown[];
    const total = arr.length;
    const pages = Math.max(1, Math.ceil(total / ARRAY_PAGE_SIZE));
    const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
    const from = p * ARRAY_PAGE_SIZE;
    const to = Math.min(total, from + ARRAY_PAGE_SIZE);
    const children: JsonChild[] = [];
    for (let i = from; i < to; i++) {
      children.push(toChild(String(i), arr[i], basePath, true));
    }
    return { children, total, pages, page: p };
  }
  if (kind === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      children: entries.map(([k, v]) => toChild(k, v, basePath, false)),
      total: entries.length,
      pages: 1,
      page: 0,
    };
  }
  return { children: [], total: 0, pages: 1, page: 0 };
}

/** `a.b[2].c` → ["a","b","2","c"]; empty string → []. */
function splitPath(path: string): string[] {
  const out: string[] = [];
  const re = /([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) out.push(m[1]!);
  return out;
}

/**
 * Resolve a key path segment by segment. Any missing segment → ok:false
 * (an out-of-range index counts as missing).
 */
export function resolvePath(
  root: unknown,
  path: string,
): { ok: boolean; value: unknown } {
  let cur = root;
  for (const seg of splitPath(path)) {
    const kind = kindOf(cur);
    if (kind === "array") {
      const i = Number(seg);
      const arr = cur as unknown[];
      if (!Number.isInteger(i) || i < 0 || i >= arr.length) {
        return { ok: false, value: undefined };
      }
      cur = arr[i];
    } else if (kind === "object") {
      const obj = cur as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(obj, seg)) {
        return { ok: false, value: undefined };
      }
      cur = obj[seg];
    } else {
      return { ok: false, value: undefined };
    }
  }
  return { ok: true, value: cur };
}

/**
 * All ancestors of a hit path (excluding itself), ordered shallow to deep
 * — the tree uses this to expand level by level down to the hit.
 * `rounds[0].deaths` → ["rounds", "rounds[0]"].
 */
export function ancestorPaths(path: string): string[] {
  const out: string[] = [];
  const re = /(\.[^.[\]]+|\[[0-9]+\]|^[^.[\]]+)/g;
  let m: RegExpExecArray | null;
  let acc = "";
  const parts: string[] = [];
  while ((m = re.exec(path)) !== null) parts.push(m[1]!);
  for (let i = 0; i < parts.length - 1; i++) {
    acc += parts[i];
    out.push(acc);
  }
  return out;
}

interface KeySearchResult {
  paths: string[];
  /** Number of nodes actually visited */
  scanned: number;
  /** Scan was incomplete due to the node budget or the hit cap */
  truncated: boolean;
}

/**
 * Search by key-name substring; returns the full paths of matching nodes.
 *
 * The budget is hard: walking every node of a 62MB doc is a seconds-long
 * task that ties up the renderer's main thread — exactly the disease this
 * rework exists to cure. Stop on reaching SEARCH_NODE_BUDGET and report
 * the truncation honestly.
 */
export function searchKeyPaths(
  root: unknown,
  query: string,
  budget = SEARCH_NODE_BUDGET,
  hitCap = SEARCH_HIT_CAP,
): KeySearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return { paths: [], scanned: 0, truncated: false };

  const paths: string[] = [];
  let scanned = 0;
  let overflowed = false;

  const walk = (node: unknown, base: string): void => {
    if (scanned >= budget) return;
    const kind = kindOf(node);
    if (!isContainer(kind)) return;
    const isArr = kind === "array";
    const entries: Array<[string, unknown]> = isArr
      ? (node as unknown[]).map((v, i) => [String(i), v])
      : Object.entries(node as Record<string, unknown>);
    for (const [k, v] of entries) {
      if (scanned >= budget) return;
      scanned++;
      const path = joinPath(base, k, isArr);
      // Array indices don't take part in key matching: searching "0" and
      // hitting every array's first element is meaningless
      if (!isArr && k.toLowerCase().includes(q)) {
        if (paths.length < hitCap) paths.push(path);
        else overflowed = true;
      }
      walk(v, path);
    }
  };

  walk(root, "");
  return { paths, scanned, truncated: overflowed || scanned >= budget };
}

/**
 * For "copy current node": pretty JSON of a single node. The call site is
 * responsible for the size (pass only expanded nodes).
 */
export function stringifyNode(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? "null";
}
