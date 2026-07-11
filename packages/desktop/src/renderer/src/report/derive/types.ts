import type { GladMatch, GladShuffle, GladShuffleRound } from "@gladlog/parser";

export type StoredMatch = Omit<GladMatch, "rawLines">;
export type StoredShuffleRound = Omit<GladShuffleRound, "rawLines">;
export type StoredShuffle = Omit<GladShuffle, "rawLines" | "rounds"> & {
  rounds: StoredShuffleRound[];
};
/** 单场战报的输入:普通对局或 shuffle 单回合(同构) */
export type ReportSource = StoredMatch | StoredShuffleRound;
