/**
 * First-run policy: never blast months of stale logs on install — only files
 * touched within ignoreOlderDays are seeded into the flush queue at startup.
 */
export function selectInitialFiles(
  entries: Array<{ name: string; mtimeMs: number }>,
  nowMs: number,
  ignoreOlderDays: number,
): string[] {
  const cutoff = nowMs - ignoreOlderDays * 86_400_000;
  return entries
    .filter(
      (e) =>
        e.name.includes("WoWCombatLog") &&
        e.name.endsWith(".txt") &&
        e.mtimeMs >= cutoff,
    )
    .map((e) => e.name)
    .sort();
}
