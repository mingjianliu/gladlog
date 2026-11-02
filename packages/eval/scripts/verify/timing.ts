/** where a verification run spent its time, label → ms, summed over the
 * workers; `verify/run.ts` writes it out as `timing.txt` */
export const timing = new Map<string, number>();

export function timed<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    timing.set(label, (timing.get(label) ?? 0) + performance.now() - t0);
  }
}
