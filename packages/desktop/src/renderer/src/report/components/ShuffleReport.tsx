import { useState } from "react";
import type { StoredShuffle } from "../derive/types";
import { MatchReport } from "./MatchReport";

export function ShuffleReport({ shuffle }: { shuffle: StoredShuffle }) {
  const [active, setActive] = useState(0);
  const round = shuffle.rounds[active] ?? shuffle.rounds[0]!;
  return (
    <div className="rpt-shuffle">
      <div className="rpt-shuffle-head">
        <span className="rpt-shuffle-title">
          Solo Shuffle · {shuffle.rounds.length} 回合 · {shuffle.result}
        </span>
        <span className="rpt-shuffle-seq">
          {shuffle.rounds.map((r, i) => (
            <i
              key={i}
              className={r.winningTeamId === r.playerTeamId ? "w" : "l"}
            >
              {r.winningTeamId === r.playerTeamId ? "W" : "L"}
            </i>
          ))}
        </span>
      </div>
      <div className="rpt-round-tabs">
        {shuffle.rounds.map((_, i) => (
          <button
            key={i}
            className={i === active ? "active" : ""}
            onClick={() => setActive(i)}
          >
            Round {i + 1}
          </button>
        ))}
      </div>
      <MatchReport source={round} roundLabel={`Round ${active + 1}`} />
    </div>
  );
}
