// @vitest-environment jsdom
import { ensureAnalysisData } from "@gladlog/analysis";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { resetSourceMemoForTest } from "../src/renderer/src/report/derive/sourceMemo";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// T93 (codex 85-tk-G-T93-1 #1): a round switch restarts the staged fill;
// the recording's player must stay mounted through it — playback, mute and
// the loaded recording are its own state.

const life = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("../src/renderer/src/report/components/VideoTab", () => ({
  VideoTab: () => {
    useEffect(() => {
      life.mounts++;
      return () => {
        life.unmounts++;
      };
    }, []);
    return <div data-testid="video-stub" />;
  },
}));

const fresh = (): ReportSource =>
  structuredClone(loadRealMatchFixture()) as unknown as ReportSource;

beforeAll(async () => {
  await ensureAnalysisData();
});
beforeEach(() => {
  life.mounts = 0;
  life.unmounts = 0;
  resetSourceMemoForTest(true);
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
    settings: { get: vi.fn().mockResolvedValue({ aiLanguage: "zh" }) },
    recorder: {
      getForMatch: vi
        .fn()
        .mockResolvedValue({ url: "file:///rec.mp4", startedAt: 0 }),
    },
  };
});
afterEach(cleanup);

const root = (c: HTMLElement) => c.querySelector(".rpt-match") as HTMLElement;
const filled = (c: HTMLElement) =>
  waitFor(() => expect(root(c).dataset["fill"]).toBe("done"), {
    timeout: 20_000,
    interval: 1,
  });

describe("MatchReport staged fill — the recording tab", () => {
  it("换到一个还没分步填过的回合,播放器不重新挂载", async () => {
    const props = { matchId: "m", videoMatchId: "v", staged: true } as const;
    const view = render(
      <MatchReport source={fresh()} initialView="video" {...props} />,
    );
    await filled(view.container);
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=video-stub]"),
      ).toBeTruthy(),
    );
    expect(life).toEqual({ mounts: 1, unmounts: 0 });

    // another round of the same match: the fill starts over at level 0
    view.rerender(
      <MatchReport source={fresh()} initialView="video" {...props} />,
    );
    expect(root(view.container).dataset["fill"]).toBe("0");
    expect(
      view.container.querySelector("[data-testid=video-stub]"),
    ).toBeTruthy();
    await filled(view.container);
    expect(life).toEqual({ mounts: 1, unmounts: 0 });
  });
});
