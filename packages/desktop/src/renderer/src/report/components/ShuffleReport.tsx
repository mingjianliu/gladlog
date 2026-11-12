import { useEffect, useState } from "react";

import type { StoredShuffle } from "../derive/types";
import { MatchReport } from "./MatchReport";
import { ReportShell } from "./ReportSkeleton";

/** Shuffle report header (P1-4): the W/L pill sequence IS the round switcher
 * (the rpt-round-tabs row has been removed); each pill reads `R{i} · W/L`,
 * with role=tab and left/right keyboard switching. */
export function ShuffleReport({
  shuffle,
  videoMatchId,
  ratingDelta = null,
  roundStats,
  onNeedRound,
  staged = false,
  skeletonTeamSizes,
}: {
  shuffle: StoredShuffle;
  /** The lobby's storage id — the whole recording hangs off it and is shared
   * by all 6 rounds (see the prop of the same name on MatchReport). */
  videoMatchId?: string;
  /** Rating change for the whole lobby (computed at the App layer); shown only
   * in the final round's header — rating settles when the lobby ends, so
   * showing it on an intermediate round would wrongly suggest "this round
   * gained/lost rating". */
  ratingDelta?: number | null;
  /** perf-1: W/L for the pill strip when a round is still a lazy null
   * placeholder (meta.roundStats; old rows without it degrade to a neutral
   * pill until the round loads). */
  roundStats?: Array<{ win: boolean }>;
  /** perf-1: ask the App layer to load a lazily-omitted round. */
  onNeedRound?: (roundIndex: number) => void;
  /** T93: passed through to MatchReport (fill the report in steps). */
  staged?: boolean;
  skeletonTeamSizes?: readonly number[];
}) {
  const [active, setActive] = useState(0);
  const round = shuffle.rounds[active] ?? null;
  // Lazy round placeholder: request it once per switch; when the round lands,
  // the doc object is replaced at the App layer and this re-renders.
  useEffect(() => {
    if (!round) onNeedRound?.(active);
  }, [round, active, onNeedRound]);
  const move = (delta: number) =>
    setActive((cur) =>
      Math.min(shuffle.rounds.length - 1, Math.max(0, cur + delta)),
    );
  // A loaded round, for the facts every round of the lobby shares.
  const known = shuffle.rounds.find((r) => r != null) ?? null;
  const pillWin = (r: StoredShuffle["rounds"][number] | null, i: number) =>
    r ? r.winningTeamId === r.playerTeamId : (roundStats?.[i]?.win ?? null);
  return (
    <div className="rpt-shuffle">
      <ShuffleHead
        roundCount={shuffle.rounds.length}
        result={shuffle.result}
        wins={shuffle.rounds.map((r, i) => pillWin(r, i))}
        active={active}
        onSelect={setActive}
        onMove={move}
      />
      {/* key={round.id} is deliberately omitted (fix round 2, revised after
          review): a full remount would also reset `view` (you finish a round
          in the replay tab and get thrown back to the report tab) and would
          destroy and rebuild the <video> element for the recording shared via
          videoMatchId on every round switch (all 6 rounds share the lobby
          recording, so switching should be a seek, not a reload/flicker). The
          only state that actually goes stale across rounds is timeRange and
          winAi — both moved inside MatchReport and reset individually when
          matchId changes (see the prevMatchIdRef effect in that file), so
          there is no need to blow away the whole subtree via a key change. */}
      {round ? (
        <MatchReport
          source={round}
          roundLabel={`回合 ${active + 1}/${shuffle.rounds.length}`}
          matchId={round.id}
          videoMatchId={videoMatchId}
          staged={staged}
          skeletonTeamSizes={skeletonTeamSizes}
          ratingDelta={
            active === shuffle.rounds.length - 1 ? ratingDelta : null
          }
        />
      ) : (
        <ReportShell
          facts={{
            result:
              roundStats?.[active] == null
                ? ""
                : roundStats[active]!.win
                  ? "Win"
                  : "Loss",
            bracket: known?.bracket ?? "Rated Solo Shuffle",
            zoneId: known?.zoneId ?? "",
            startTime: 0,
            endTime: null,
          }}
          roundLabel={`回合 ${active + 1}/${shuffle.rounds.length}`}
          teamSizes={skeletonTeamSizes ?? [3, 3]}
          status="读取回合…"
        />
      )}
    </div>
  );
}

/** The lobby line: title + the W/L pill strip that is the round switcher.
 * Without onSelect it is the same strip as a still picture - the loading
 * shell draws it from the list row before the match is read (T93). */
export function ShuffleHead({
  roundCount,
  result,
  wins,
  active,
  onSelect,
  onMove,
}: {
  roundCount: number;
  result: string;
  /** Per round: won, lost, or not known yet. */
  wins: Array<boolean | null>;
  active: number;
  onSelect?: (i: number) => void;
  onMove?: (delta: number) => void;
}) {
  return (
    <div className="rpt-shuffle-head">
      <span className="rpt-shuffle-title">
        Solo Shuffle · {roundCount} 回合 · {result}
      </span>
      <span className="rpt-shuffle-seq" role="tablist">
        {wins.map((win, i) => {
          return (
            <i
              key={i}
              role="tab"
              aria-selected={i === active}
              aria-label={`回合 ${i + 1}${
                win == null ? "" : win ? " · 胜" : " · 负"
              }`}
              tabIndex={i === active ? 0 : -1}
              className={[
                "rpt-shuffle-pill",
                win == null ? "" : win ? "w" : "l",
                i === active ? "cur" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={onSelect ? () => onSelect(i) : undefined}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") onMove?.(-1);
                else if (e.key === "ArrowRight") onMove?.(1);
              }}
              title={`回合 ${i + 1}`}
              style={onSelect ? { cursor: "pointer" } : undefined}
            >
              {/* UI review 2026-08-21 #4: under 640px of container width
                  the pills collapse to the round number (CSS swaps the two
                  spans); the full label stays in aria-label/title. */}
              <span className="rpt-shuffle-pill-full">
                R{i + 1}
                {win == null ? "" : ` · ${win ? "W" : "L"}`}
              </span>
              <span className="rpt-shuffle-pill-short" aria-hidden="true">
                {i + 1}
              </span>
            </i>
          );
        })}
      </span>
    </div>
  );
}
