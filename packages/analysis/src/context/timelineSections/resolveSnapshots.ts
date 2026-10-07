/**
 * Deferred [RES] snapshots — after every section has added its entries, the
 * snapshot placeholders they requested are resolved in time order (debounced,
 * with a forced full refresh every 60 s and Δ against the previous ready set)
 * and the entries are rewritten IN PLACE with the rendered text.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx` (`entries` is the same array, so
 * the in-place rewrite reaches the caller). Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { toRenderSecond } from "../../utils/renderGrid";
import {
  computeOnCDDisplayNames,
  computeReadyNames,
  positionalOutOfReachNames,
} from "../resourceSnapshot";
import type { TimelineCtx } from "./ctx";
import { type DeferredSnapshot, isDeferredSnapshot } from "./ctx";

export function resolveDeferredSnapshots(
  ctx: Pick<
    TimelineCtx,
    | "entries"
    | "teammateCDs"
    | "playerIdMap"
    | "matchStartMs"
    | "owner"
    | "resOwnerCDs"
    | "snapshotFn"
    | "ownerSpec"
    | "ccTrinketSummaries"
    | "enemyCDTimeline"
    | "rosterSides"
    | "manaFallback"
    | "roundBounds"
  >,
): Pick<TimelineCtx, "resOutOfReachRows"> {
  const {
    entries,
    teammateCDs,
    playerIdMap,
    matchStartMs,
    owner,
    resOwnerCDs,
    snapshotFn,
    ownerSpec,
    ccTrinketSummaries,
    enemyCDTimeline,
    rosterSides,
    manaFallback,
    roundBounds,
  } = ctx;

  const placeholders: DeferredSnapshot[] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (isDeferredSnapshot(line)) {
        placeholders.push(line);
      }
    }
  }

  placeholders.sort((a, b) => {
    if (a.timeSeconds !== b.timeSeconds) {
      return a.timeSeconds - b.timeSeconds;
    }
    if (a.forceFull !== b.forceFull) {
      return (b.forceFull ? 1 : 0) - (a.forceFull ? 1 : 0);
    }
    // B14b: a death row and an offensive-window row at one instant — the
    // death row is kept (it carries the reach cut), the other is the same row
    if (!!a.deathOfUnitId !== !!b.deathOfUnitId)
      return (b.deathOfUnitId ? 1 : 0) - (a.deathOfUnitId ? 1 : 0);
    return a.id - b.id;
  });

  const snapshotResults = new Map<number, string>();
  // B14a: death rows whose `rdy:` lost a positional cooldown (legend count)
  let resOutOfReachRows = 0;
  let prevReadyNamesState: string[] | null = null;
  let prevOnCDNamesState: string[] | null = null;
  let lastSnapshotTime = -100;
  // B14b: the last offensive-window row — a request at the same instant is
  // the same row, but the 2 s debounce does not count from it
  let lastWindowSnapshotTime = -100;
  let lastFullSnapshotTime = -100;
  const FULL_SNAPSHOT_REFRESH_SECONDS = 60;

  for (const req of placeholders) {
    const timeSeconds = req.timeSeconds;
    const forceFull = req.forceFull;

    const isSameTime =
      Math.abs(timeSeconds - lastSnapshotTime) < 0.001 ||
      Math.abs(timeSeconds - lastWindowSnapshotTime) < 0.001;
    const shouldDebounce =
      !req.bypassDebounce && timeSeconds - lastSnapshotTime < 2.0;
    if (isSameTime || shouldDebounce) {
      snapshotResults.set(req.id, "");
      continue;
    }
    if (req.keepFollowing) lastWindowSnapshotTime = timeSeconds;
    else lastSnapshotTime = timeSeconds;

    const teammateCDsWithLabel = teammateCDs.map(({ player, cds, spec }) => ({
      cds,
      spec,
      player,
      playerLabel: playerIdMap
        ? String(playerIdMap.get(player.name) ?? player.name)
        : player.name,
    }));
    // F-C4: the same dead-holder cut the snapshot applies, so the delta state
    // never carries a dead holder's entries forward.
    const resDeaths = { matchStartMs, ownerUnit: owner };
    // The delta state is what the row PRINTS, so it is read at the row's
    // rendered second — the snapshot builder's own anchor (shared-predicate
    // rule). Read at the fractional instant it disagreed with the printed
    // row: a request at 5.7 s printed second 5 (the ledger reports nothing
    // in the first 5 s) while the state already held everything as ready,
    // so no later row ever said so.
    const stateSeconds = toRenderSecond(timeSeconds);
    const currentReadyNames = computeReadyNames(
      stateSeconds,
      resOwnerCDs,
      teammateCDsWithLabel,
      resDeaths,
    );
    const currentOnCDNames = computeOnCDDisplayNames(
      stateSeconds,
      resOwnerCDs,
      teammateCDsWithLabel,
      resDeaths,
    );
    const forceFullRefresh =
      forceFull ||
      timeSeconds - lastFullSnapshotTime >= FULL_SNAPSHOT_REFRESH_SECONDS;
    const prevReadyNames = forceFullRefresh
      ? undefined
      : (prevReadyNamesState ?? undefined);
    const prevOnCDNames = forceFullRefresh
      ? undefined
      : (prevOnCDNamesState ?? undefined);
    const stateBefore: {
      ready: string[] | null;
      onCd: string[] | null;
      full: number;
    } = {
      ready: prevReadyNamesState,
      onCd: prevOnCDNamesState,
      full: lastFullSnapshotTime,
    };
    if (forceFullRefresh) lastFullSnapshotTime = timeSeconds;
    prevReadyNamesState = currentReadyNames;
    prevOnCDNamesState = currentOnCDNames;

    const deathVictim = req.deathOfUnitId
      ? [owner, ...teammateCDs.map((t) => t.player)].find(
          (u) => u.id === req.deathOfUnitId,
        )
      : undefined;
    if (deathVictim && forceFullRefresh) {
      const far = positionalOutOfReachNames(
        owner,
        resOwnerCDs,
        teammateCDsWithLabel,
        { victim: deathVictim, atMs: matchStartMs + timeSeconds * 1000 },
      );
      if (currentReadyNames.some((n) => far.has(n))) resOutOfReachRows++;
    }
    const snapshotStr = snapshotFn({
      timeSeconds,
      ownerCDs: resOwnerCDs,
      ownerName: owner.name,
      ownerSpec,
      teammateCDs,
      ccTrinketSummaries,
      enemyCDTimeline,
      playerIdMap,
      prevReadyNames,
      prevOnCDNames,
      matchStartMs,
      ownerUnit: owner,
      rosterSides,
      manaFallback,
      roundBounds,
      // B14a: the dying friendly this (full) snapshot sits under
      ...(deathVictim
        ? {
            outOfReachOf: {
              victim: deathVictim,
              atMs: matchStartMs + timeSeconds * 1000,
            },
          }
        : {}),
    });
    // A FULL row the builder printed nothing for (the ledger reports nothing
    // in a round's first 5 s) is not a row: the next one is the round's
    // first, and is full — not `rdy:Δ +every cooldown` against an empty
    // state (605-file capture: the first [RES] row of 182 of 3,520 prompts
    // was a delta). The delta state and the full-refresh clock go back; the
    // debounce still counts from it.
    if (snapshotStr === "" && forceFullRefresh) {
      prevReadyNamesState = stateBefore.ready;
      prevOnCDNamesState = stateBefore.onCd;
      lastFullSnapshotTime = stateBefore.full;
    }
    snapshotResults.set(req.id, snapshotStr);
  }

  // Mutate entries in-place to resolve deferred snapshots
  for (const entry of entries) {
    entry.lines = entry.lines
      .map((line) => {
        if (isDeferredSnapshot(line)) {
          return snapshotResults.get(line.id) ?? "";
        }
        return line;
      })
      .filter(Boolean);
  }
  return { resOutOfReachRows };
}
