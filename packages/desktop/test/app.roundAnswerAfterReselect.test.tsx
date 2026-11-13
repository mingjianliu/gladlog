// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { StoredMatchMeta } from "../src/main/matchStore";
import App from "../src/renderer/src/App";

// T93, codex 85-tk-G-T93-1e: a round asked for under one selection of a
// shuffle answers after the match was left and selected again. Its answer
// is not of the doc now open: it must not write over it.

vi.mock("../src/renderer/src/report/components/ShuffleReport", () => ({
  ShuffleReport: ({
    shuffle,
    onNeedRound,
  }: {
    shuffle: { rounds: Array<unknown | null> };
    onNeedRound?: (i: number) => void;
  }) => {
    const missing = shuffle.rounds[1] == null;
    useEffect(() => {
      if (missing) onNeedRound?.(1);
    }, [missing, onNeedRound]);
    return (
      <div data-testid="shuffle">
        {shuffle.rounds.map((r) => (r ? "L" : "-")).join("")}
      </div>
    );
  },
}));
vi.mock("../src/renderer/src/report/components/MatchReport", () => ({
  MatchReport: () => <div data-testid="match" />,
}));

const NOW = Date.now();
const meta = (
  id: string,
  kind: "match" | "shuffle",
  ageH: number,
): StoredMatchMeta =>
  ({
    id,
    kind,
    bracket: kind === "shuffle" ? "Rated Solo Shuffle" : "3v3",
    zoneId: "1505",
    startTime: NOW - ageH * 3600_000,
    endTime: NOW - ageH * 3600_000 + 300_000,
    result: "win",
    storedAt: 1,
    durationS: 300,
    avgRating: 2300 + ageH,
    playerRating: 2300 + ageH,
    teams: [[{ specId: 105, classId: 11 }], [{ specId: 64, classId: 8 }]],
  }) as StoredMatchMeta;

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("App — 回合请求只属于发起它的那次选择", () => {
  it("A → B → A:旧的回合回答晚到,不把新读到的文档写空;新的一次照常载入回合", async () => {
    const metas = [meta("A", "shuffle", 1), meta("B", "match", 2)];
    const docA = () => ({
      kind: "shuffle",
      data: { rounds: [{ id: "r0" }, null] },
    });
    const opens: Array<{
      id: string;
      d: ReturnType<typeof deferred<unknown>>;
    }> = [];
    const rounds: Array<ReturnType<typeof deferred<unknown>>> = [];
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        page: async () => metas,
        list: async () => metas,
        get: async () => null,
        getLazy: (id: string) => {
          const d = deferred<unknown>();
          opens.push({ id, d });
          return d.promise;
        },
        getRound: () => {
          const d = deferred<unknown>();
          rounds.push(d);
          return d.promise;
        },
      },
      logs: { onMatchStored: () => () => {} },
      settings: { get: async () => ({ wowDirectory: null }) },
    };
    render(<App />);
    const list = await screen.findByTestId("match-list");
    const row = (i: number) =>
      list.querySelectorAll("li:not(.loading-more):not(.mlr-group)")[
        i
      ] as HTMLElement;
    // A (the newest) is selected by itself; its doc comes, round 1 is asked
    await waitFor(() => expect(opens).toHaveLength(1));
    await act(async () => opens[0]!.d.resolve(docA()));
    expect(screen.getByTestId("shuffle").textContent).toBe("L-");
    expect(rounds).toHaveLength(1);
    // to B, and back to A
    fireEvent.click(row(1));
    await act(async () =>
      opens.at(-1)!.d.resolve({ kind: "match", data: { id: "b" } }),
    );
    expect(screen.getByTestId("match")).toBeTruthy();
    fireEvent.click(row(0));
    expect(opens.at(-1)!.id).toBe("A");
    // A's fresh doc, then the OLD round answer, before React renders
    await act(async () => {
      opens.at(-1)!.d.resolve(docA());
      // the doc's answer has run (its state update is queued, not rendered)
      for (let i = 0; i < 10; i++) await Promise.resolve();
      rounds[0]!.resolve({ id: "r1-old" });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(screen.getByTestId("shuffle").textContent).toBe("L-");
    // the new selection asked for the round itself
    expect(rounds).toHaveLength(2);
    await act(async () => rounds[1]!.resolve({ id: "r1" }));
    expect(screen.getByTestId("shuffle").textContent).toBe("LL");
  });
});
