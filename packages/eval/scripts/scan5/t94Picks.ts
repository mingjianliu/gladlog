/**
 * Two "which occurrence does this printed item mean" picks of the T94 scan
 * checks, as pure functions (codex 85-tk-I-T94-1 #1, #2) — the checks
 * themselves live in `scan5/damageBasis.ts` (`allyOverlapDeferral`) and
 * `fact2Scan.ts` (`invisAfterAction`).
 */

/**
 * The ledger overlaps a printed `Ally CDs overlapping` item may be: of
 * `alike` items of one line that print the same ally, cooldown, length and
 * target, the `nth` (0-based, print order) is the `nth` such ledger entry.
 * A line and a ledger that do not count alike keep every entry — the
 * reading before the pick, which clears an item any of them explains.
 */
export function ledgerOverlapsOfItem<T>(
  matching: readonly T[],
  nth: number,
  alike: number,
): readonly T[] {
  return matching.length > 1 && matching.length === alike
    ? [matching[nth]!]
    : matching;
}

/**
 * The application an `already up` defensive of a burst refers to. `bFromMs`
 * is the burst's opening second, floored; the burst opens somewhere inside
 * it. An aura still on the target when that second begins is the one
 * already up; with none, the first one applied inside the second (T94:
 * Greater Invisibility at 1:18.448 for a burst opening 1:18.768). Taking
 * the LAST application of the second let a re-application hide the action
 * that ended the first. `endMs` is the application's end as the producer
 * reads it (`buildAuraIntervals`, an unseen holder's cut at its first own
 * action) — without it the press of a minute before, never removed in the
 * log, reads as still up. With neither, the last application before the
 * second: a line that claims an aura long over is still checked, against
 * that application (codex 85-tk-I-T94-1b #2).
 */
export function alreadyUpApplication<
  A extends { timestamp: number; endMs: number },
>(applies: readonly A[], bFromMs: number): A | undefined {
  const upAtSecondStart = applies
    .filter((a) => a.timestamp <= bFromMs && a.endMs > bFromMs)
    .at(-1);
  return (
    upAtSecondStart ??
    applies.find(
      (a) => a.timestamp > bFromMs && a.timestamp < bFromMs + 1000,
    ) ??
    applies.filter((a) => a.timestamp <= bFromMs).at(-1)
  );
}
