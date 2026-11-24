import { type Finding, fmtTime } from "@gladlog/analysis";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  computeVideoWindow,
  seekTargetS,
  toBattleSeconds,
  toVideoSeconds,
} from "../../../../shared/videoTime";
import { bridge } from "../../bridge";
import { useT } from "../../i18n/LangProvider";
import type { AnalysisRunInput } from "../derive/analysisInput";
import { resolveJumpTarget } from "../derive/jumpTarget";
import { useAnalysisInput } from "../derive/offThread/useAnalysisInput";
import type { TimelineData } from "../derive/timeline";
import type { ReportSource } from "../derive/types";
import {
  type AiChipLike,
  deriveVideoMoments,
  type VideoMoment,
} from "../derive/videoMoments";
import type { VulnBand } from "../derive/vulnWindows";
import { useMatchPageActive } from "../pageActive";
import { VideoBattleTimeline } from "./VideoBattleTimeline";
import {
  advanceFeed,
  FEED_CAPACITY_FALLBACK,
  FEED_OUT_MS,
  type FeedState,
  initialFeed,
  VideoFeed,
} from "./VideoFeed";
import { VideoMomentList } from "./VideoMomentList";
import { type StripMark, VideoMomentStrip } from "./VideoMomentStrip";

/** Remembered tab of the right-hand card (2a: the feed toggle became three
 * tabs, the old FEED_PREF_KEY is retired). Written only when the user clicks a
 * tab by hand — a stored value means the user chose, so every automatic tab
 * switch below yields to it. */
const SIDE_TAB_KEY = "gladlog.videoSide.tab";
type SideTab = "feed" | "all" | "ai";
const readStoredSideTab = (): SideTab | null => {
  try {
    const v = localStorage.getItem(SIDE_TAB_KEY);
    return v === "feed" || v === "all" || v === "ai" ? v : null;
  } catch {
    return null; // no localStorage in the test environment
  }
};

/** Standalone recording tab (real-machine feedback: the small window on the
 * replay page is too small). Full-width native player + an aligned mark strip
 * below (A) + a playback event feed on the right (C, kill-feed style). Plays
 * on its own; on open it seeks to the start of this match (this round for
 * shuffle). Marks/feed are driven by the video's timeupdate, independent of
 * the replay page clock. */
export function VideoTab({
  url,
  startedAt,
  source,
  matchId,
  timeline,
  bands,
}: {
  url: string;
  /** Wall-clock epoch ms of the recording's start (the playback anchor). */
  startedAt: number;
  source: ReportSource;
  /** Used to look up cached AI deep-dive chips (per round for shuffle,
   * orthogonal to the recording's videoMatchId). */
  matchId?: string;
  /** Battle timeline card data (2a): the same derive MatchReport already
   * memoized — do not recompute it inside this component (at full-match data
   * volume a duplicate derive is a real, measurable stall). If omitted the
   * timeline card is not rendered (graceful degradation for old callers and
   * tests). */
  timeline?: TimelineData;
  bands?: VulnBand[];
}) {
  const { t, lang, namesVersion } = useT();
  const ref = useRef<HTMLVideoElement | null>(null);
  const [durationS, setDurationS] = useState(0);
  const [aiChips, setAiChips] = useState<AiChipLike[]>([]);
  // Default tab (3.5-2): while nothing is playing the feed is always empty, so
  // with no stored preference we land on the "all moments" list; once playback
  // starts we switch back to the playback feed. Both automatic behaviours only
  // happen when the user has never picked a tab by hand (this click or a
  // stored preference) — a manual choice always wins.
  const [storedTab] = useState(readStoredSideTab);
  const [sideTab, setSideTab] = useState<SideTab>(storedTab ?? "all");
  const userPickedRef = useRef(storedTab != null);
  const [feed, setFeed] = useState<FeedState>(() => initialFeed(0));
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [curS, setCurS] = useState(0);
  // The recording can be shorter than this round's start (e.g. OBS stopped
  // early, so later shuffle rounds have no footage): offsetS then falls beyond
  // duration, and endS's Math.min cannot clamp offsetS itself, producing an
  // inverted endS < offsetS window. The decision is left to onReady in the seek
  // effect below (it must be decided there, synchronously, and the listeners
  // detached there — it cannot be inferred from a value derived here: a
  // re-render sits in between, and the mount-seek may already have set
  // currentTime to the out-of-range offsetS; the browser clamps it back to
  // duration, timeupdate then judges it "before the start" and snaps again,
  // clamping back and forth in an infinite loop that pegs the CPU — the exact
  // lesson learned back when the replay page had the small recording window).
  const [noFootage, setNoFootage] = useState(false);
  // Playback failure (e.g. the OBS mux the file was recorded with is not one
  // this browser's <video> can decode): surfaced as a visible note rather than
  // a silent black frame.
  const [playbackFailed, setPlaybackFailed] = useState(false);
  // Feed capacity (derived from the measured container height, written by
  // VideoFeed's ResizeObserver callback). A ref, not state: capacity changes
  // with window size and must not, via a useEffect dependency array, remount
  // the player effect and snap playback back to offsetS (see the main effect
  // below).
  const capacityRef = useRef(FEED_CAPACITY_FALLBACK);
  const momentsRef = useRef<VideoMoment[]>([]);
  // The AI fetch effect's refresh() needs candidates on every call (mount plus
  // each onDone) to resolve the timestamp of a timed finding — and
  // buildAnalysisInput rebuilds richContext/candidates wholesale (not cheap),
  // so memoize it once per [source, matchId] instead of rebuilding on every
  // refresh (review 3). A ref, not state: the AI fetch effect depends only on
  // matchId and must not resubscribe/refetch just because this cache is
  // recomputed.
  // Built in the derive worker when not cached (offThreadDerive.ts); when it
  // lands after the cached findings did, the feed is refreshed once more so
  // the timed chips are not lost.
  const analysisInputRef = useRef<AnalysisRunInput | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const { input: analysisInput } = useAnalysisInput(source, matchId);
  useEffect(() => {
    analysisInputRef.current = analysisInput;
    if (analysisInput) refreshRef.current?.();
  }, [analysisInput]);

  // Single source for all playback-time arithmetic (shared/videoTime.ts) --
  // the phase-1 bug was a divergent inline copy that clamped offsetS to 0.
  const win = computeVideoWindow({
    matchStartMs: source.startTime,
    matchEndMs: source.endTime,
    recordingStartedAtMs: startedAt,
    durationS,
  });
  const offsetS = win.offsetS; // conversion constant only; may be negative
  const endS = win.windowEndS;
  const startBoundS = win.windowStartS; // playback / scrubber lower bound

  const moments: VideoMoment[] = useMemo(
    // Same per-language key-moments slot as the AI panel's axis
    // (deriveKeyMoments(source, undefined, lang)): computed once per language.
    // namesVersion: the titles read English spell names in en, which load
    // after first paint (codex B1#4, B2#7).
    () => deriveVideoMoments(source, aiChips, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, aiChips, lang, namesVersion],
  );
  useEffect(() => {
    momentsRef.current = moments;
  }, [moments]);
  const marks: StripMark[] = useMemo(
    () =>
      moments.map((m) => ({
        videoS: toVideoSeconds(m.tS, offsetS),
        toVideoS: m.toS != null ? toVideoSeconds(m.toS, offsetS) : undefined,
        moment: m,
      })),
    [moments, offsetS],
  );

  useEffect(() => {
    let alive = true;
    setAiChips([]);
    if (!matchId) return;
    const refresh = () => {
      try {
        // Missing bridge surface or missing cache both degrade silently (the
        // feed still has its deterministic moments)
        void bridge()
          .analysis?.getCached(matchId)
          .then((cached) => {
            if (!alive || !cached) return;
            // The other language's result, read back for display only (spec
            // §6.13), carries no label here -- keep it off the recording.
            const contentLang = (cached as { contentLang?: string })
              .contentLang;
            if (contentLang && contentLang !== lang) return;
            const findings =
              (cached as { findings?: Finding[] }).findings ?? [];
            const deepDiveChips = findings.flatMap(
              (f) => f.deepDive?.chips ?? [],
            );
            // Timeline finding → chip: the same predicate as
            // StructuredAnalysisPanel's splitFindings (facts.t present = timed,
            // with candidates built single-source by buildAnalysisInput — do
            // not invent a second timeline test here); the matched timestamp
            // comes from resolveJumpTarget, the same lookup the evidence-chain
            // jump reuses.
            let timedChips: AiChipLike[] = [];
            try {
              const input = analysisInputRef.current;
              if (input) {
                const timedIds = new Set(
                  input.candidates
                    .filter((c) => c.facts.t !== undefined)
                    .map((c) => c.id),
                );
                timedChips = findings
                  .filter((f) => f.eventIds?.some((id) => timedIds.has(id)))
                  .map((f): AiChipLike | null => {
                    const target = resolveJumpTarget(
                      input.candidates,
                      f.eventIds,
                    );
                    return target
                      ? {
                          t: target.t,
                          label: f.title,
                          unitNames: target.unitNames,
                        }
                      : null;
                  })
                  .filter((c): c is AiChipLike => c != null);
              }
            } catch {
              /* a predicate failure must not take down the deepDive chips */
            }
            setAiChips([...deepDiveChips, ...timedChips]);
          })
          .catch(() => {});
      } catch {
        /* stub without this bridge surface */
      }
    };
    refreshRef.current = refresh;
    refresh();
    // An analysis that finishes while this tab is open (auto-analysis or a
    // user rerun) must flow into the feed/strip without waiting for the next
    // mount — the matchId guard keeps other matches' done events out.
    let off: (() => void) | undefined;
    try {
      off = bridge().analysis?.onDone((d: { matchId: string }) => {
        if (!alive || d.matchId !== matchId) return;
        refresh();
      });
    } catch {
      /* stub or missing bridge surface: skip the subscription, the initial
         fetch is unaffected */
    }
    return () => {
      alive = false;
      if (refreshRef.current === refresh) refreshRef.current = null;
      off?.();
    };
  }, [matchId, lang]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // New match/round: assume footage exists, then re-check in onReady against
    // the measured duration
    setNoFootage(false);
    // playbackFailed is deliberately NOT reset here (re-review, 2026-08-03,
    // reverting a same-day "cheap cleanup" fix that rested on a false
    // premise). That fix assumed MatchReport reuses this same VideoTab
    // instance across DIFFERENT matches with no React key -- untrue: App.tsx
    // keys both ShuffleReport and MatchReport by selectedId, so switching
    // matches always remounts this component from scratch (playbackFailed
    // starts fresh regardless). The only case this effect re-runs on a LIVE
    // instance is a shuffle ROUND switch, where every round shares one lobby
    // recording: <video src={url}> keeps the same DOM node and the same url,
    // so nothing reloads and no new `error` event fires. Resetting
    // playbackFailed here would silently clear a still-valid "无法播放该录像"
    // banner, and with no reload to ever refire `error`, it would never come
    // back for the rest of that shuffle session on this tab.
    const onTime = () => {
      // Clamp to the round: anything outside this round's range (scrubbing, or
      // playback spilling over from the previous round) snaps back to the
      // boundary, and passing the end also pauses — the player must not play
      // the next round's footage on the user's behalf. The start side gets
      // 0.25s of slack (timeupdate samples discretely, so sitting a few frames
      // off the boundary is normal jitter).
      if (v.currentTime < startBoundS - 0.25) {
        v.currentTime = startBoundS;
      } else if (v.currentTime >= endS) {
        v.pause();
        v.currentTime = endS;
      }
      setCurS(v.currentTime);
      const battleS = toBattleSeconds(v.currentTime, offsetS);
      setFeed((prev) =>
        advanceFeed(
          prev,
          battleS,
          Date.now(),
          momentsRef.current,
          capacityRef.current,
        ),
      );
    };
    const onPlay = () => {
      setPlaying(true);
      // Auto-switching to the feed does not write localStorage: it is default
      // behaviour, not a user choice
      if (!userPickedRef.current) setSideTab("feed");
    };
    const onPause = () => setPlaying(false);
    const detach = () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
    // Attach timeupdate/play/pause first so onReady has listeners to detach —
    // the order cannot be reversed: if noFootage were decided before the
    // listeners were attached, detach() would remove listeners that do not
    // exist yet (a no-op) and the addEventListener calls below would attach
    // them right back.
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    const onReady = () => {
      const dur = v.duration;
      setDurationS(dur);
      // Decide on the duration we JUST read -- durationS state has not
      // committed yet, so a noFootage computed from the outer `win` (closed
      // over the stale durationS = 0) would be wrong here every time.
      const readyWin = computeVideoWindow({
        matchStartMs: source.startTime,
        matchEndMs: source.endTime,
        recordingStartedAtMs: startedAt,
        durationS: dur,
      });
      if (readyWin.noFootage) {
        // The recording is shorter than this round's start (e.g. OBS stopped
        // early, so this shuffle round was never captured): do not seek to an
        // out-of-range position — the browser clamps currentTime to duration,
        // which is then always > 0.25s away from offsetS, so onTime above
        // judges it "before the start" and snaps again, the clamp fires
        // another timeupdate... an infinite loop that pegs the CPU (the same
        // lesson learned with the old small recording window on the replay
        // page). Detach the listeners, flip the empty-state flag, and let the
        // render layer say this round is outside the recording — no further
        // seek attempts.
        detach();
        setNoFootage(true);
        return;
      }
      v.currentTime = offsetS;
      setCurS(offsetS);
    };
    if (v.readyState >= 1) onReady();
    else v.addEventListener("loadedmetadata", onReady, { once: true });
    setMuted(v.muted);
    return () => {
      v.removeEventListener("loadedmetadata", onReady);
      detach();
    };
    // moments/capacity are deliberately kept out of the deps (they go through
    // refs): they change when aiChips arrive or the feed container resizes,
    // neither of which should remount this effect — a remount re-seeks and
    // snaps playback back to offsetS, and neither input has anything to do
    // with which second the player should be at.
  }, [source, startedAt, offsetS, endS, startBoundS]);

  // Feed eviction heartbeat: an item pushed out is first marked `out` to play
  // the FEED_OUT_MS fade, then actually removed from the array — this step must
  // not depend on timeupdate (even while paused we have to finish off the now
  // invisible placeholder gap, otherwise the blank slot stays stuck in the
  // list). nowS is passed the previous lastS (no advance), and advanceFeed's
  // seeding window is always empty when fromS === nowS, so this tick only
  // settles due evictions and never conjures new entries — this is what
  // VideoFeed's old "weak heartbeat" was meant to do but did not (the old one
  // only forced a re-render without recomputing advanceFeed, so while paused
  // items never finished expiring).
  //
  // Parked behind another top tab (pageActive.ts) the heartbeat stops: the
  // hidden feed measures as zero height, and settling evictions against that
  // stand-in capacity would drop entries that coming back cannot restore
  // (codex review of the parked page, 2026-11-14 #3b: 10 → 6 → 6).
  const pageActive = useMatchPageActive();
  const pageActiveRef = useRef(pageActive);
  pageActiveRef.current = pageActive;
  useEffect(() => {
    if (!pageActive) return;
    const id = setInterval(() => {
      setFeed((prev) =>
        advanceFeed(
          prev,
          prev.lastS,
          Date.now(),
          momentsRef.current,
          capacityRef.current,
        ),
      );
    }, FEED_OUT_MS);
    return () => clearInterval(id);
  }, [pageActive]);

  const togglePlay = () => {
    const v = ref.current;
    if (!v) return;
    // Branch on the `playing` state rather than v.paused: the play()/pause()
    // events are the asynchronous source of truth, but the state is guaranteed
    // to match the label the button currently shows, so the click does exactly
    // what the label says.
    if (playing) v.pause();
    else void v.play();
  };
  const toggleMute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const pickSideTab = (t: SideTab) => {
    userPickedRef.current = true; // playback no longer steals the tab
    setSideTab(t);
    try {
      localStorage.setItem(SIDE_TAB_KEY, t);
    } catch {
      /* same as above */
    }
  };
  // Empty dependency array: an inline arrow would be a new reference on every
  // render, and VideoFeed's ResizeObserver effect lists it as a dependency, so
  // a new reference would make it disconnect and rebuild the observer on every
  // render (review 2) — this callback only writes a ref and captures nothing
  // that changes across renders, so a stable reference is all it needs.
  const handleCapacityChange = useCallback((c: number) => {
    // a parked (display:none) feed measures nothing; keep the real capacity
    // until it is shown again and measured
    if (!pageActiveRef.current) return;
    capacityRef.current = c;
  }, []);

  const clampedCurS = Math.min(Math.max(curS, startBoundS), endS);

  return (
    <div className="rpt-video-tab">
      <div className="rpt-video-tab-row">
        <div className="rpt-video-tab-main">
          {win.missingHeadS > 0.5 && (
            <div className="rpt-video-note">
              {t("report.video.missingHead", {
                s: Math.round(win.missingHeadS),
              })}
            </div>
          )}
          {playbackFailed && (
            <div className="rpt-video-note rpt-video-note--error">
              {t("report.video.playbackFailed")}
            </div>
          )}
          {/* The video element stays mounted across the noFootage state (the
              same ref instance) — it is not unmounted/rebuilt when the empty
              state toggles, which would trigger another load. */}
          <video
            ref={ref}
            src={url}
            playsInline
            style={noFootage ? { display: "none" } : undefined}
            onError={() => setPlaybackFailed(true)}
          />
          {noFootage ? (
            <p className="rpt-dim rpt-video-tab-empty">
              {t("report.video.noFootage")}
            </p>
          ) : (
            <>
              <div
                className="rpt-video-controls"
                role="group"
                aria-label={t("report.video.controlsAria")}
              >
                <button
                  type="button"
                  className="rpt-video-ctrl-play"
                  aria-label={t(
                    playing ? "report.video.pause" : "report.video.play",
                  )}
                  onClick={togglePlay}
                >
                  {playing ? "⏸" : "▶"}
                </button>
                <span className="rpt-video-ctrl-time" aria-hidden="true">
                  {fmtTime(Math.max(0, toBattleSeconds(clampedCurS, offsetS)))}{" "}
                  / {fmtTime(Math.max(0, toBattleSeconds(endS, offsetS)))}
                </span>
                {/* The range input and the mark strip are wrapped in one
                    column (spec 3-1, decided by the user): the gold bands and
                    glyphs share a horizontal axis with the thin scrubber so
                    you can drag to a mark — when they sat on two separate
                    full-width rows the same instant did not line up
                    horizontally. */}
                <span className="rpt-video-ctrl-track">
                  <input
                    type="range"
                    className="rpt-video-ctrl-range"
                    aria-label={t("report.video.progressAria")}
                    min={startBoundS}
                    max={endS}
                    step={0.1}
                    value={clampedCurS}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      const v = ref.current;
                      if (v) v.currentTime = val;
                      setCurS(val);
                    }}
                  />
                  <VideoMomentStrip
                    marks={marks}
                    durationS={durationS}
                    windowStartS={startBoundS}
                    windowEndS={endS}
                    unreachableBeforeBattleS={win.missingHeadS}
                    onSeek={(videoS) => {
                      const v = ref.current;
                      if (!v) return;
                      // Route through seekTargetS, same as the other three
                      // onSeek call sites (review Important #3, 2026-08-03):
                      // a bare `v.currentTime = videoS` skipped both pre-roll
                      // (design doc §4.1) and window clamping. This branch
                      // matters more than it looks -- this task made
                      // unreachable marks clickable for the first time, and an
                      // unreachable mark's videoS is negative; only a real
                      // browser's clamp-to-0 hid a negative currentTime here,
                      // jsdom does not clamp.
                      v.currentTime = seekTargetS(
                        toBattleSeconds(videoS, offsetS),
                        win,
                      );
                    }}
                  />
                </span>
                <button
                  type="button"
                  className="rpt-video-ctrl-mute"
                  aria-label={t(
                    muted ? "report.video.unmute" : "report.video.mute",
                  )}
                  onClick={toggleMute}
                >
                  {muted ? "🔇" : "🔊"}
                </button>
                <button
                  type="button"
                  className="rpt-video-ctrl-mute"
                  aria-label={t("report.video.fullscreen")}
                  title={t("report.video.fullscreen")}
                  onClick={() => {
                    try {
                      void ref.current?.requestFullscreen();
                    } catch {
                      /* jsdom / old engines lack this API */
                    }
                  }}
                >
                  ⛶
                </button>
              </div>
            </>
          )}
          {timeline && (
            <div className="rpt-video-bt" data-testid="video-bt-card">
              <span className="rpt-card-label">
                {t("report.video.battleTimeline")}
              </span>
              <VideoBattleTimeline
                data={timeline}
                bands={bands ?? []}
                playerTeamId={source.playerTeamId ?? null}
                curBattleS={
                  noFootage ? null : toBattleSeconds(clampedCurS, offsetS)
                }
                disabled={noFootage}
                onSeek={(battleS) => {
                  const v = ref.current;
                  if (!v) return;
                  const videoS = seekTargetS(battleS, win);
                  v.currentTime = videoS;
                  setCurS(videoS);
                }}
              />
            </div>
          )}
        </div>
        {/* One card with three tabs on the right (2a): playback feed | all
            moments | AI findings, all sharing the same videoMoments; with no
            footage the feed does not advance but the list tabs still work
            (they come from log data) */}
        <div className="rpt-video-side" data-testid="video-side">
          <div className="rpt-mode-seg rpt-video-side-tabs">
            <button
              data-testid="video-side-feed"
              className={sideTab === "feed" ? "active" : ""}
              onClick={() => pickSideTab("feed")}
            >
              {t("report.video.tab.feed")}
            </button>
            <button
              data-testid="video-side-all"
              className={sideTab === "all" ? "active" : ""}
              onClick={() => pickSideTab("all")}
            >
              {t("report.video.tab.all", { n: moments.length })}
            </button>
            <button
              data-testid="video-side-ai"
              className={sideTab === "ai" ? "active" : ""}
              onClick={() => pickSideTab("ai")}
            >
              {t("report.video.tab.ai", {
                n: moments.filter((m) => m.kind === "ai").length,
              })}
            </button>
          </div>
          {sideTab === "feed" &&
            (noFootage ? (
              <p className="rpt-engage-empty">{t("report.video.feedEmpty")}</p>
            ) : (
              <VideoFeed
                items={feed.items}
                onCapacityChange={handleCapacityChange}
              />
            ))}
          {sideTab === "all" && (
            <VideoMomentList
              moments={moments}
              curBattleS={
                noFootage ? null : toBattleSeconds(clampedCurS, offsetS)
              }
              unreachableBeforeBattleS={win.missingHeadS}
              onSeek={
                noFootage
                  ? undefined
                  : (battleS) => {
                      const v = ref.current;
                      if (!v) return;
                      v.currentTime = seekTargetS(battleS, win);
                    }
              }
              emptyText={
                source.kind === "shuffleRound"
                  ? t("report.common.thisRoundNoRecords")
                  : t("report.common.thisMatchNoRecords")
              }
            />
          )}
          {sideTab === "ai" && (
            <VideoMomentList
              moments={moments.filter((m) => m.kind === "ai")}
              curBattleS={
                noFootage ? null : toBattleSeconds(clampedCurS, offsetS)
              }
              unreachableBeforeBattleS={win.missingHeadS}
              onSeek={
                noFootage
                  ? undefined
                  : (battleS) => {
                      const v = ref.current;
                      if (!v) return;
                      v.currentTime = seekTargetS(battleS, win);
                    }
              }
              emptyText={t("report.video.aiEmpty")}
            />
          )}
        </div>
      </div>
      <p className="rpt-dim rpt-video-tab-hint">{t("report.video.hint")}</p>
    </div>
  );
}
