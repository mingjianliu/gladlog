// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { loadRealMatchFixture } from "../../../../../test/fixtures/loadFixture";
import { PRE_ROLL_S } from "../../../../shared/videoTime";
import type { ReportSource } from "../derive/types";
import { VideoTab } from "./VideoTab";

const source = loadRealMatchFixture() as unknown as ReportSource;
// startedAt = source.startTime → offsetS = 0, endS = (endTime-startTime)/1000 = 90
const startedAt = source.startTime;
const endS = (source.endTime - startedAt) / 1000;

let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  // jsdom does not implement media playback; <video>.play()/.pause() throw
  // "not implemented" by default.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  playSpy = HTMLMediaElement.prototype.play as unknown as ReturnType<
    typeof vi.fn
  >;
  pauseSpy = HTMLMediaElement.prototype.pause as unknown as ReturnType<
    typeof vi.fn
  >;
  playSpy.mockClear();
  pauseSpy.mockClear();
  (window as any).__gladlogFixture = {
    analysis: {
      getCached: vi.fn().mockResolvedValue(null),
      onDone: () => () => {},
    },
  };
});

/** loadedmetadata triggers one seek(offsetS) plus a duration sample (see
 * VideoTab's seek effect) — jsdom never dispatches it automatically, so the
 * test fires it by hand. */
function fireLoadedMetadata(video: HTMLVideoElement, durationS: number) {
  Object.defineProperty(video, "duration", {
    configurable: true,
    value: durationS,
  });
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: 1,
  });
  fireEvent.loadedMetadata(video);
}

describe("VideoTab 自定义控制条(按轮 clamp)", () => {
  it("不再是原生 controls;渲染播放/静音按钮 + 进度 range(min/max = 本轮范围)", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(".rpt-video-tab video")!;
    expect(video).toBeTruthy();
    expect(video.hasAttribute("controls")).toBe(false);

    fireLoadedMetadata(video as HTMLVideoElement, 200); // recording is longer than this round
    const range = container.querySelector(
      ".rpt-video-ctrl-range",
    ) as HTMLInputElement;
    expect(range).toBeTruthy();
    expect(Number(range.min)).toBeCloseTo(0);
    expect(Number(range.max)).toBeCloseTo(endS);
  });

  it("endS 额外夹到已知的视频 duration(录像比本轮结束得早)", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 30); // shorter than endS (90s)
    const range = container.querySelector(
      ".rpt-video-ctrl-range",
    ) as HTMLInputElement;
    expect(Number(range.max)).toBeCloseTo(30);
  });

  it("timeupdate 越过终点:暂停 + 吸附回 endS", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: endS + 5,
    });
    fireEvent.timeUpdate(video);
    expect(pauseSpy).toHaveBeenCalled();
    expect(video.currentTime).toBeCloseTo(endS);
  });

  it("timeupdate 早于起点(容差外):吸附回 startS", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: -5,
    });
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBeCloseTo(0);
  });

  it("播放/暂停按钮驱动 video.play/pause,label 随 play/pause 事件翻转", () => {
    const { container, getByLabelText } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    const btn = getByLabelText("播放");
    fireEvent.click(btn);
    expect(playSpy).toHaveBeenCalled();
    fireEvent.play(video);
    expect(getByLabelText("暂停")).toBeTruthy();
    fireEvent.click(getByLabelText("暂停"));
    expect(pauseSpy).toHaveBeenCalled();
    fireEvent.pause(video);
    expect(getByLabelText("播放")).toBeTruthy();
  });

  it("静音按钮切换 video.muted + label", () => {
    const { container, getByLabelText } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    const btn = getByLabelText("静音");
    fireEvent.click(btn);
    expect(video.muted).toBe(true);
    expect(getByLabelText("取消静音")).toBeTruthy();
  });
});

describe("VideoTab AI 结果进 feed/strip", () => {
  // A candidate event from the real fixture (derived from
  // test/fixtures/real-match-sample.json): buildAnalysisInput builds candidates
  // from it and facts.t is always present (timed). Was
  // "missed-cleanse:Player6-Test:61" until 2026-09-18: Kingsbane / Volley
  // joined OFFENSIVE_CD_SPELL_IDS, the fixture's enemies press both, and that
  // cleanse is now exempt under the no-calm-second threat gate.
  const TIMED_EVENT_ID = "cd-hoarded:Player-1-00000003:Player-1-00000001:58";
  const TIMED_T = 58;

  it("时间轴 finding(与 splitFindings 同一谓词)映射为 chip,连同 deepDive chips 一起画进标记条", async () => {
    const getCached = vi.fn().mockResolvedValue({
      findings: [
        {
          eventIds: [TIMED_EVENT_ID],
          severity: "med",
          category: "dispel",
          title: "未清除持续伤害",
          explanation: "……",
        },
        {
          // eventIds match no candidate: resolveJumpTarget returns null and it
          // is silently dropped
          eventIds: ["no-such-id"],
          severity: "low",
          category: "x",
          title: "不该出现",
          explanation: "……",
        },
      ],
    });
    (window as any).__gladlogFixture = {
      analysis: { getCached, onDone: () => () => {} },
    };
    const { container } = render(
      <VideoTab
        url="vod://x"
        startedAt={startedAt}
        source={source}
        matchId="m1"
      />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    await vi.waitFor(() => {
      const el = container.querySelector(".rpt-video-strip-ai");
      expect(el).toBeTruthy();
    });
    expect(container.querySelectorAll(".rpt-video-strip-ai")).toHaveLength(1);
    // Converted to video seconds (identical to raw seconds when offsetS = 0);
    // the marker strip narrows its axis to this round's window
    // [offsetS, endS] (= [0, 90]), not the whole recording's duration (200).
    const mark = container.querySelector(".rpt-video-strip-ai") as HTMLElement;
    expect(Number.parseFloat(mark.style.left)).toBeCloseTo(
      (TIMED_T / endS) * 100,
      1,
    );
  });

  it("analysis.onDone(matchId 匹配)触发重新拉取,新结果补进标记条", async () => {
    const getCached = vi.fn().mockResolvedValue(null);
    let doneCb: ((d: { matchId: string; result: unknown }) => void) | null =
      null;
    (window as any).__gladlogFixture = {
      analysis: {
        getCached,
        onDone: (cb: typeof doneCb) => {
          doneCb = cb;
          return () => {
            doneCb = null;
          };
        },
      },
    };
    const { container } = render(
      <VideoTab
        url="vod://x"
        startedAt={startedAt}
        source={source}
        matchId="m1"
      />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    await vi.waitFor(() => expect(getCached).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".rpt-video-strip-ai")).toBeNull();

    getCached.mockResolvedValue({
      findings: [
        {
          eventIds: [TIMED_EVENT_ID],
          severity: "med",
          category: "dispel",
          title: "未清除持续伤害",
          explanation: "……",
        },
      ],
    });
    await act(async () => {
      doneCb!({ matchId: "m1", result: {} });
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".rpt-video-strip-ai")).toBeTruthy();
    });

    // An onDone for a different match must not trigger a refresh (matchId
    // guard).
    getCached.mockClear();
    await act(async () => {
      doneCb!({ matchId: "other-match", result: {} });
    });
    expect(getCached).not.toHaveBeenCalled();
  });
});

describe("VideoTab: 本轮嵌在录像中段(offsetS>0,复核要求的主用例——之前零覆盖)", () => {
  // The recording started 30s before this round (e.g. it was already running
  // through earlier rounds of the same shuffle / the lobby phase): offsetS = 30,
  // the round duration reuses endS from the top of the module (= 90), so the end
  // should be 30 + 90 = 120.
  const OFFSET_S = 30;
  const startedAtMid = startedAt - OFFSET_S * 1000;
  const roundDurationS = endS; // computed at the top with offsetS=0, i.e. the round duration alone

  it("初始 seek 落在 offsetS(不是 0),range 按 [offsetS, offsetS+本轮时长]", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtMid} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200); // recording is long enough to fully cover this round
    expect(video.currentTime).toBeCloseTo(OFFSET_S);
    const range = container.querySelector(
      ".rpt-video-ctrl-range",
    ) as HTMLInputElement;
    expect(range).toBeTruthy();
    // pre-roll: 量程下限比开场早 3s(点某个战斗时刻要回滚 PRE_ROLL_S,量程必须
    // 覆盖落点,否则会被 :237-9 的容差判定当成越界立刻弹回)
    expect(Number(range.min)).toBeCloseTo(OFFSET_S - PRE_ROLL_S);
    expect(Number(range.max)).toBeCloseTo(OFFSET_S + roundDurationS);
  });

  it("timeupdate 早于本轮起点(容差外)→ 吸附回 offsetS,不是 0", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtMid} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: OFFSET_S - 5,
    });
    fireEvent.timeUpdate(video);
    // 回弹下限 = windowStartS(= OFFSET_S - PRE_ROLL_S),不再是 offsetS 本身 ——
    // pre-roll 落点必须站得住,否则等于没做
    expect(video.currentTime).toBeCloseTo(OFFSET_S - PRE_ROLL_S);
  });

  it("timeupdate 越过本轮终点(offsetS+本轮时长)→ 暂停 + 吸附回终点", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtMid} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    const endAbsS = OFFSET_S + roundDurationS;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: endAbsS + 5,
    });
    fireEvent.timeUpdate(video);
    expect(pauseSpy).toHaveBeenCalled();
    expect(video.currentTime).toBeCloseTo(endAbsS);
  });
});

describe("VideoTab 右栏默认 tab(三点五-2)", () => {
  // This jsdom environment has no localStorage (which is why the component
  // wraps it in try/catch) — testing the remembered behaviour requires stubbing
  // one ourselves.
  const KEY = "gladlog.videoSide.tab";
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("无记忆默认「全部时刻」;开始播放自动切「播放 feed」且不写记忆", () => {
    const { container, getByTestId } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    expect(getByTestId("video-side-all").className).toContain("active");
    fireEvent.play(video);
    expect(getByTestId("video-side-feed").className).toContain("active");
    // The automatic switch is default behaviour, not a user choice
    expect(store.has(KEY)).toBe(false);
  });

  it("本次手动切过 tab:写入记忆,之后播放不再抢", () => {
    const { container, getByTestId } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    fireEvent.click(getByTestId("video-side-ai"));
    expect(store.get(KEY)).toBe("ai");
    fireEvent.play(video);
    expect(getByTestId("video-side-ai").className).toContain("active");
  });

  it("localStorage 记忆视为用户选择:初始尊重,播放也不抢", () => {
    store.set(KEY, "ai");
    const { container, getByTestId } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    expect(getByTestId("video-side-ai").className).toContain("active");
    fireEvent.play(video);
    expect(getByTestId("video-side-ai").className).toContain("active");
  });

  it("无 localStorage(渲染器桩环境)也能落默认「全部时刻」", () => {
    vi.unstubAllGlobals(); // restore this environment's no-localStorage state
    const { container, getByTestId } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    expect(getByTestId("video-side-all").className).toContain("active");
  });
});

describe("VideoTab: 录像比这一轮的开始还短(offsetS >= durationS)", () => {
  // OBS stopped recording early / later shuffle rounds were never recorded at
  // all: the recording's duration is far below offsetS. This is review round 1's
  // core scenario — the old code fell into an infinite seek loop here and pinned
  // the CPU (the browser clamps currentTime to duration < offsetS-0.25 → snap →
  // clamped again → …).
  const startedAtFar = startedAt - 1_000_000; // offsetS ≈ 1000s, far beyond the short recording

  it("渲染空态而不是控制条,且从不尝试把 currentTime 设到越界位置(无死循环)", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtFar} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    const currentTimeSet = vi.fn();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 0,
      set: currentTimeSet,
    });

    fireLoadedMetadata(video, 10); // recording is only 10s, far below offsetS

    expect(container.querySelector(".rpt-video-tab-empty")).toBeTruthy();
    expect(container.querySelector(".rpt-video-controls")).toBeNull();
    expect(container.querySelector(".rpt-video-ctrl-range")).toBeNull();
    // Core assertion: once onReady decides we are out of range it detaches the
    // listeners and never seeks — not "it seeked but got clamped", but the
    // currentTime setter is never called at all.
    expect(currentTimeSet).not.toHaveBeenCalled();

    // The listeners are detached: firing timeupdate by hand must not trigger
    // any seek attempt either.
    fireEvent.timeUpdate(video);
    expect(currentTimeSet).not.toHaveBeenCalled();
  });
});

describe("VideoTab:录像晚于开场(缺头,一期生产上的常态)", () => {
  const LAG_S = 12;
  const startedAtLate = startedAt + LAG_S * 1000; // 录像比开场晚 12s

  it("缺头时顶部给出明确提示,而不是静默", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtLate} source={source} />,
    );
    const note = container.querySelector(".rpt-video-note");
    expect(note).toBeTruthy();
    expect(note!.textContent).toMatch(/缺头\s*12\s*秒/);
  });

  it("越界回弹下限是 windowStartS(缺头时为 0),不是负数", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtLate} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: -5,
    });
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBeCloseTo(0);
  });

  it("scrubber 量程从 0 开始(缺头时开场之前没有素材可回滚)", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtLate} source={source} />,
    );
    fireLoadedMetadata(
      container.querySelector(".rpt-video-tab video") as HTMLVideoElement,
      200,
    );
    const range = container.querySelector(
      ".rpt-video-ctrl-range",
    ) as HTMLInputElement;
    expect(Number(range.min)).toBeCloseTo(0);
    // 本场终点 = 本场时长 − 缺头 = endS − LAG_S
    expect(Number(range.max)).toBeCloseTo(endS - LAG_S);
  });

  it("视频解不了时给出可见提示,而不是一块黑屏", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAt} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireEvent.error(video);
    expect(
      container.querySelector(".rpt-video-note--error")?.textContent,
    ).toMatch(/无法播放/);
  });

  // Regression for the phase-1 bug itself (code review finding): none of the
  // tests above click anything — they only check the note/rebound/scrubber
  // range. The bug that actually shipped was in the three onSeek handlers that
  // convert a clicked combat moment into a video position (VideoTab.tsx
  // :516/:574/:593); re-inlining the old
  // `Math.min(Math.max(battleS + offsetS, offsetS), endS)` there (dropping
  // pre-roll and clamping to offsetS instead of startBoundS) would leave every
  // test above green. This asserts the actual click math end to end, against
  // a real, deterministic (non-AI) moment from the fixture — "被控:Psychic
  // Scream · 6s" at combat t=60.703 (a CC keyMoment, verified independently by
  // dumping deriveVideoMoments(source) for this fixture) — so it does not
  // depend on the AI-chip pipeline.
  it("点击「全部时刻」清单某行:seek 落点必须走 seekTargetS(pre-roll + startBoundS 夹取),不是重新内联的旧公式", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtLate} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    const rows = Array.from(
      container.querySelectorAll(".rpt-video-moment-row"),
    );
    const row = rows.find((r) => r.textContent?.includes("Psychic Scream"));
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    // Correct (seekTargetS): 60.703 + offsetS(-12) - PRE_ROLL_S(3) = 45.703.
    // Old inline formula would give Math.min(Math.max(60.703-12, -12), endS-12)
    // = 48.703 -- a full PRE_ROLL_S off, which toBeCloseTo(…, 1) below cannot
    // confuse with 45.703.
    expect(video.currentTime).toBeCloseTo(60.703 - LAG_S - PRE_ROLL_S, 1);
  });

  // Same defect, the other identical call site (VideoTab.tsx:593 — the "AI
  // 发现" tab's VideoMomentList reuses the exact same onSeek body as the "全
  // 部时刻" tab above, just filtered to kind==="ai"). Reuses the AI-chip
  // fixture technique from the "VideoTab AI 结果进 feed/strip" describe block
  // above (TIMED_EVENT_ID/TIMED_T are scoped there, so redeclared here) to
  // reach that tab's rows without depending on it.
  it("点击「AI 发现」tab 某行:同一 onSeek 落点公式(seekTargetS),不是重新内联的旧公式", async () => {
    const TIMED_EVENT_ID = "cd-hoarded:Player-1-00000003:Player-1-00000001:58";
    const TIMED_T = 58;
    const getCached = vi.fn().mockResolvedValue({
      findings: [
        {
          eventIds: [TIMED_EVENT_ID],
          severity: "med",
          category: "dispel",
          title: "未清除持续伤害",
          explanation: "……",
        },
      ],
    });
    (window as any).__gladlogFixture = {
      analysis: { getCached, onDone: () => () => {} },
    };
    const { container, getByTestId } = render(
      <VideoTab
        url="vod://x"
        startedAt={startedAtLate}
        source={source}
        matchId="m1"
      />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    fireEvent.click(getByTestId("video-side-ai"));
    await vi.waitFor(() => {
      const rows = container.querySelectorAll(".rpt-video-moment-row");
      expect(rows.length).toBeGreaterThan(0);
    });
    const row = container.querySelector(".rpt-video-moment-row")!;
    fireEvent.click(row);
    expect(video.currentTime).toBeCloseTo(TIMED_T - LAG_S - PRE_ROLL_S, 1);
  });

  // Regression for review Important #3 (2026-08-03): the strip's onSeek used
  // to be a bare `v.currentTime = videoS`, skipping both pre-roll and
  // clamping -- and this task made unreachable marks clickable in the strip
  // for the first time, so a click there would write a NEGATIVE currentTime
  // (a real browser silently clamps to 0; jsdom does not, so a regression
  // here would otherwise go unnoticed). "保命 CD 整场未用 · Player1" is a
  // deterministic (non-AI) mistake moment at battle t=0 (verified
  // independently by dumping deriveVideoMoments(source, []) for this
  // fixture); with LAG_S=12 its videoS is -12, well before windowStartS
  // (=0 here), so the strip renders it pinned at the left edge with the
  // unreachable class.
  it("标记条点击不可达标记:落点是窗口下限(非负),走 seekTargetS 不是裸赋值", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtLate} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    const mark = container.querySelector(
      ".rpt-video-strip-mark--unreachable",
    ) as HTMLElement;
    expect(mark).toBeTruthy();
    fireEvent.click(mark);
    expect(video.currentTime).toBeGreaterThanOrEqual(0);
    expect(video.currentTime).toBeCloseTo(0);
  });
});

describe("VideoTab:pre-roll(点某个战斗时刻回滚 3 秒)", () => {
  const OFFSET_S = 30;
  const startedAtMid = startedAt - OFFSET_S * 1000;

  it("scrubber 下限比开场早 PRE_ROLL_S 秒(素材够时)", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtMid} source={source} />,
    );
    fireLoadedMetadata(
      container.querySelector(".rpt-video-tab video") as HTMLVideoElement,
      200,
    );
    const range = container.querySelector(
      ".rpt-video-ctrl-range",
    ) as HTMLInputElement;
    expect(Number(range.min)).toBeCloseTo(OFFSET_S - PRE_ROLL_S);
  });

  it("回弹下限同样是 windowStartS,否则 pre-roll 落点会被立刻弹回", () => {
    const { container } = render(
      <VideoTab url="vod://x" startedAt={startedAtMid} source={source} />,
    );
    const video = container.querySelector(
      ".rpt-video-tab video",
    ) as HTMLVideoElement;
    fireLoadedMetadata(video, 200);
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: OFFSET_S - PRE_ROLL_S, // 正好落在 pre-roll 位置
    });
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBeCloseTo(OFFSET_S - PRE_ROLL_S); // 不被弹回
  });
});
