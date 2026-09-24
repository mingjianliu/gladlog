import { PROMPT_VERSION } from "./promptVersion";

/**
 * Pure slot logic (multi-model comparison): the types plus toSlottedDoc/
 * resolveActiveSlot/upsertSlot/slotKeyOf/splitSlotKey. Deliberately split off
 * from `analysisCache.ts` — this file has zero `fs`/`path` dependencies, so
 * both main and renderer can import it safely.
 *
 * Hard-won lesson (caught by the final-review presubmit): the renderer's
 * `slotLabel.ts` once imported `splitSlotKey` straight from `analysisCache.ts`,
 * and that file has `import { join } from "path"` at the top (for
 * `analysisCachePath`) — a Node builtin. electron-vite's renderer build targets
 * the browser, so Rollup dragged the whole module, `path` included, into the
 * browser bundle, and the built artifact failed with
 * `"join" is not exported by "__vite-browser-external"`. Local vitest/tsc
 * cannot catch it (neither performs the browser bundling step); only
 * `electron-vite build` blows up. So: any pure function the renderer needs must
 * live in this zero-Node-dependency file, never in a module shared with
 * filesystem predicates like `analysisCachePath`.
 */

/** On-disk envelope for the analysis cache. Written by main, read by main, and
 * seeded by E2E — all three share this one shape. */
interface AnalysisCacheDoc<T> {
  schemaVersion: 1;
  promptVersion: number;
  language: string;
  createdAt: number;
  result: T;
}

/** One model analysis result's on-disk slot: which prompt version, when it was
 * generated, and the result itself. */
export interface AnalysisSlot<T> {
  promptVersion: number;
  createdAt: number;
  result: T;
}

/**
 * v2 envelope for the analysis cache: for one match, several models' results
 * are stored in slots keyed by `slotKeyOf(backend, model)`, and `lastSlotKey`
 * points at the slot that should currently be displayed/consumed.
 */
export interface AnalysisCacheDocV2<T> {
  schemaVersion: 2;
  language: string;
  slots: Record<string, AnalysisSlot<T>>;
  lastSlotKey: string;
}

/**
 * Single entry point on the read side: v2 passes through unchanged; a v1 or
 * unversioned legacy single result is lazily wrapped into one slot (in memory
 * only, never written back). Garbage input (no slots, no result) returns null.
 * null in, null out.
 */
export function toSlottedDoc<T>(
  raw: unknown,
  legacySlotKey: string,
): AnalysisCacheDocV2<T> | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion === 2 && obj.slots && obj.lastSlotKey) {
    return raw as AnalysisCacheDocV2<T>;
  }
  if ("result" in obj) {
    const legacy = obj as Partial<AnalysisCacheDoc<T>>;
    return {
      schemaVersion: 2,
      language: typeof legacy.language === "string" ? legacy.language : "",
      slots: {
        [legacySlotKey]: {
          promptVersion: legacy.promptVersion ?? 0,
          createdAt: legacy.createdAt ?? 0,
          result: legacy.result as T,
        },
      },
      lastSlotKey: legacySlotKey,
    };
  }
  return null;
}

/** Single-source consumption rule: the slot `lastSlotKey` points at; returns
 * null when that slot is missing (corrupt file, etc.). */
export function resolveActiveSlot<T>(
  doc: AnalysisCacheDocV2<T> | null,
): AnalysisSlot<T> | null {
  if (!doc) return null;
  return doc.slots[doc.lastSlotKey] ?? null;
}

/** Write side: upsert a slot into the existing doc (which may be null) and set
 * `lastSlotKey`. */
export function upsertSlot<T>(
  existing: AnalysisCacheDocV2<T> | null,
  lang: string,
  slotKey: string,
  result: T,
  createdAt: number = Date.now(),
): AnalysisCacheDocV2<T> {
  return {
    schemaVersion: 2,
    language: lang,
    slots: {
      ...(existing?.slots ?? {}),
      [slotKey]: { promptVersion: PROMPT_VERSION, createdAt, result },
    },
    lastSlotKey: slotKey,
  };
}

/** Single-source slot key: assembled in this one place; nowhere else may build
 * the string again. */
export function slotKeyOf(backend: string, model: string): string {
  return `${backend}:${model}`;
}

/**
 * Inverse of the single-source slot key: split out backend/model. Kept in the
 * same place as `slotKeyOf` for symmetry — deepenInner (main/analysis.ts) and
 * the renderer's slotLabel both need to recover backend/model from a slot key,
 * and each hand-writing `indexOf(":")` was a duplicated predicate that could
 * diverge into two different splits when the model itself contains a colon
 * (never in theory, but nothing in the types guarantees it).
 *
 * Splits on the **first** colon only: the model segment may contain colons,
 * the backend segment may not. A malformed key (no colon — the empty string,
 * or anything without ":") returns null, so the caller takes its fallback
 * branch instead of guessing a possibly wrong backend.
 */
export function splitSlotKey(
  key: string,
): { backend: string; model: string } | null {
  const idx = key.indexOf(":");
  if (idx === -1) return null;
  return { backend: key.slice(0, idx), model: key.slice(idx + 1) };
}
