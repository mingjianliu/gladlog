import { sourceMemoReady } from "./sourceMemo";
import type { ReportSource } from "./types";

/**
 * Small derive results kept by WHICH stored match a source was read from,
 * not by the source object (sourceMemo.ts keys by object).
 *
 * Every open of a match parses its bytes into a new object, so sourceMemo
 * starts empty for it and the expensive derives run again: Windows field run
 * 2026-11-14 (main 40e2de6e), a 778 s 3v3 re-opened from the list paid its
 * mistakes (~2.1 s) and, on the AI tab, its prompt input (~5.5 s) all over
 * again. The results kept here are small plain data (the mistake list, the
 * prompt input: strings, numbers, candidate records), never references into
 * the source or its legacy copy, so unlike sourceMemo they can outlive the
 * object they came from and the bound can be larger.
 *
 * Only sources read from the match store take part: matchDocLoader.ts
 * registers each one it parses under its storage id, its place in the doc and
 * the byte length it was parsed from (noteLoadedSource), so a re-open of the
 * same file hits and anything else — a rewritten file, an object built or
 * edited in memory (tests build variants of one fixture that differ in
 * content, not in id) — never does. A content fingerprint was not enough
 * (presubmit 2026-11-14: a dispel-reading test's edited fixture hit the
 * unedited one's cached mistakes). Same data gate as sourceMemo: nothing is
 * kept before the analysis tables are loaded.
 */
export const ID_MEMO_MAX = 8;

const identities = new WeakMap<object, string>();

/** Register `source` as read from the store: `storageId` is the id the doc
 * was opened under, `place` where the source sits in it (e.g. "data",
 * "round:2"), `byteLength` the size of the bytes it was parsed from. */
export function noteLoadedSource(
  source: object,
  storageId: string,
  place: string,
  byteLength: number,
): void {
  identities.set(source, `${storageId}\u0000${place}\u0000${byteLength}`);
}

/** What a source's id-keyed results are filed under; undefined = it was not
 * read from the store, and nothing is kept for it. */
export function sourceIdentity(source: ReportSource): string | undefined {
  return identities.get(source);
}

type Entry = { inputs: readonly unknown[]; value: unknown };
const cache = new Map<string, Entry>();

/** The value kept for (source, key) when it was built against `inputs`
 * (element-wise Object.is), else undefined. A hit is a recency touch. */
export function idMemoGet<T>(
  source: ReportSource,
  key: string,
  inputs: readonly unknown[] = [],
): T | undefined {
  const id = sourceIdentity(source);
  if (id === undefined) return undefined;
  const k = `${key}\u0000${id}`;
  const e = cache.get(k);
  if (!e) return undefined;
  const same =
    e.inputs.length === inputs.length &&
    e.inputs.every((v, i) => Object.is(v, inputs[i]));
  if (!same) return undefined;
  cache.delete(k);
  cache.set(k, e);
  return e.value as T;
}

export function idMemoPut<T>(
  source: ReportSource,
  key: string,
  inputs: readonly unknown[],
  value: T,
): void {
  const id = sourceIdentity(source);
  if (!sourceMemoReady() || id === undefined) return;
  const k = `${key}\u0000${id}`;
  cache.delete(k);
  cache.set(k, { inputs, value });
  while (cache.size > ID_MEMO_MAX) cache.delete(cache.keys().next().value!);
}

/** idMemoGet, else compute and keep. */
export function idMemo<T>(
  source: ReportSource,
  key: string,
  inputs: readonly unknown[],
  compute: () => T,
): T {
  const hit = idMemoGet<T>(source, key, inputs);
  if (hit !== undefined) return hit;
  const value = compute();
  idMemoPut(source, key, inputs, value);
  return value;
}

/** Test seam. */
export function resetIdMemoForTest(): void {
  cache.clear();
}
