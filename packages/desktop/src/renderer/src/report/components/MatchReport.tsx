import { ensureAnalysisData, type RawStreams } from "@gladlog/analysis";
import { useEffect, useMemo, useRef, useState } from "react";

import { bridge } from "../../bridge";
import { buildWindowAnalysisRequest } from "../derive/analysisInput";
import { deriveAuraUptime } from "../derive/auraUptime";
import { deriveBurstLedger } from "../derive/burstLedger";
import { deriveCastControl } from "../derive/castControl";
import { deriveCcBreakDash } from "../derive/ccBreakDash";
import { deriveCCChainDash } from "../derive/ccChainDash";
import { deriveDampeningSeries } from "../derive/dampeningSeries";
import { type DeathRecap, deriveDeathRecaps } from "../derive/deathRecap";
import { deriveDispelDash } from "../derive/dispelDash";
import { buildReportMarkdown } from "../derive/exportReport";
import { type CurveMetric, deriveFlowSeries } from "../derive/flowSeries";
import { makeRichText } from "../derive/inlineRich";
import { deriveKickDash } from "../derive/kickDash";
import { deriveMatchArc } from "../derive/matchArc";
import type { MeterMode } from "../derive/meterRows";
import { deriveMistakes, timedAnchorsFromMistakes } from "../derive/mistakes";
import { derivePressureLanes } from "../derive/pressureLanes";
import {
  ensureRawStreams,
  getRawStreamsSync,
} from "../derive/rawStreamsCache";
import { deriveStatsTable } from "../derive/statsTable";
import { deriveSummary } from "../derive/summary";
import {
  sideOfUnit,
  teamSideByName,
  teamSidesByUnitId,
} from "../derive/teamSide";
import { deriveTimeline } from "../derive/timeline";
import { rangeDurationS, type TimeRange } from "../derive/timeRange";
import type { ReportSource } from "../derive/types";
import { deriveUncoveredHighlights } from "../derive/uncoveredHighlights";
import { deriveVulnBands } from "../derive/vulnWindows";
import { BurstLedgerCard } from "./BurstLedgerCard";
import { CoachChatCard } from "./CoachChatCard";
import { DeathRecapCard } from "./DeathRecapCard";
import { EngagementPanel } from "./EngagementPanel";
import { EventsPanel } from "./EventsPanel";
import { KpiChips } from "./KpiChips";
import { MatchArcLine } from "./MatchArcLine";
import { Meters } from "./Meters";
import { MistakesCard } from "./MistakesCard";
import { ProComparisonVerified } from "./ProComparisonVerified";
import { ReplayView } from "./ReplayView";
import { ReportHeader } from "./ReportHeader";
import { ReportOverflowMenu } from "./ReportOverflowMenu";
import { StructuredAnalysisPanel } from "./StructuredAnalysisPanel";
import { Timeline } from "./Timeline";
import { TimeRangeBar } from "./TimeRangeBar";
import { UncoveredHighlightsCard } from "./UncoveredHighlightsCard";
import { TeamSideContext } from "./UnitName";
import { VideoTab } from "./VideoTab";
import { WindowAnalysisCard, type WindowCardState } from "./WindowAnalysisCard";
import { WindowList } from "./WindowList";

type View = "report" | "replay" | "events" | "video" | "ai";

/** Friend-or-foe predicate (single source, agy review #2): auto-recap's
 * friendly-pool filter and DeathRecapCard's "kill/death" title must share the
 * same judgment — don't let one place use teamId and another use reaction.
 * Units missing info are treated as non-friendly, consistent with the friendly
 * pool's existing semantics (deriveDeathRecaps only emits players; pets never
 * reach here). */
const isFriendlyUnit = (source: ReportSource, unitId: string): boolean =>
  sideOfUnit(source, unitId) === "friendly";

const VIEW_LABEL: Record<View, string> = {
  report: "战报",
  replay: "回放",
  events: "事件",
  video: "录像",
  ai: "AI 分析",
};

export function MatchReport({
  source,
  roundLabel,
  matchId,
  videoMatchId,
  ratingDelta = null,
  initialView = "report",
  initialTimeRange = null,
  externalSeek = null,
}: {
  source: ReportSource;
  roundLabel?: string;
  matchId?: string;
  /** Storage id used to look up the associated recording. Each shuffle round's
   * matchId is a per-round content hash (analysis cache is per-round), while
   * recordings hang off the lobby storage id (= first round's id) — falls back
   * to matchId when omitted (identical for normal matches). Real-machine
   * gotcha: in solo shuffle only R1 has a recording. */
  videoMatchId?: string;
  /** Rating change (UI redesign 1a): App-level delta between adjacent matches;
   * shuffle passes it only on the final round. The log has no personal rating
   * change (ARENA_MATCH_END only carries team MMR), so it can only be injected
   * from list context — do not try to derive it from source inside the
   * component. */
  ratingDelta?: number | null;
  initialView?: View;
  /** Initial time window (used by the report-window visual scene; interactive
   * entry points are drag-select / the phase dropdown). */
  initialTimeRange?: TimeRange | null;
  /** Controlled seek entry point for the dev-harness review workbench (inert
   * in production — nothing in product code passes this). Consumed via
   * handleSeekEvent below, keyed on nonce so it can re-fire the same
   * (tSeconds, unitNames) pair. */
  externalSeek?: {
    tSeconds: number;
    unitNames: string[];
    nonce: number;
  } | null;
}) {
  // Hoisted to the top: runWindowAi's matchId guard (see matchIdRef below) must
  // be able to read the current value before the closure is created — depends
  // only on props, not on any hook, so computing it early affects nothing else.
  const resolvedMatchId = matchId ?? source.id;
  // Intent guard (BACKLOG #26 Task 2, 意图守护): kick off the raw.txt read +
  // parse as soon as the report opens — well before the user can click
  // "Analyze" — so buildAnalysisInput/buildWindowAnalysisRequest's synchronous
  // cache reads land warm (see rawStreamsCache.ts's doc comment for the full
  // rationale, including why `videoMatchId` — the on-disk storage id, "=
  // first round's id" for a shuffle — must be passed explicitly here rather
  // than left to the source.id default: this is the ONE place in the render
  // tree that actually has that id, since it already resolves it for the
  // recording lookup below).
  // The loaded streams are also state, so the kick dashboard's cast-control
  // strip (deriveCastControl) re-derives once they land.
  const [rawStreams, setRawStreams] = useState<RawStreams | undefined>(() =>
    getRawStreamsSync(source.id),
  );
  useEffect(() => {
    let live = true;
    setRawStreams(getRawStreamsSync(source.id));
    void ensureRawStreams(source, videoMatchId ?? resolvedMatchId).then(
      (rs) => {
        if (live) setRawStreams(rs);
      },
    );
    return () => {
      live = false;
    };
  }, [source, videoMatchId, resolvedMatchId]);
  const [mode, setMode] = useState<MeterMode>("damage");
  // What the main chart plots (血量 by default). Switching to a metric the
  // leaderboard also has takes the leaderboard along — 血量/被治疗 have no
  // matching mode, so those leave it alone. One-way on purpose: driving it from
  // the leaderboard instead would yank the HP curve out from under someone who
  // only wanted to read healing numbers.
  const [curveMetric, setCurveMetric] = useState<CurveMetric>("hp");
  const handleCurveMetric = (m: CurveMetric): void => {
    setCurveMetric(m);
    if (m === "damage" || m === "healing" || m === "taken") setMode(m);
  };
  // Engagement-panel tab lifted up here (agy review #5): switching to "replay"
  // and back should not silently snap back to "kicks" — same treatment as
  // Meters' mode.
  const [engageTab, setEngageTab] = useState<
    "kick" | "dispel" | "aura" | "cc" | "break"
  >("kick");
  // Right side column of the report view (user request 2026-08-04): a second
  // tab hosts the coach chat, so you can ask about the match while looking at
  // the curves — without leaving for the AI view. The chat card in the AI view
  // stays (its top pinning is the user's 2026-08-02 call); the two are never
  // mounted at once (only one view renders), and the transcript lives in main,
  // so both read the same conversation.
  const [sideTab, setSideTab] = useState<"recap" | "chat">("recap");
  const [view, setView] = useState<View>(initialView);
  // Time-window linkage (phase 4 ①): null = whole match. Aggregate panels honor
  // the window; HP curve / window list / death recap / burst ledger / replay
  // stay on whole-match basis (see the basis table in the plan doc).
  const [timeRange, setTimeRange] = useState<TimeRange | null>(
    initialTimeRange,
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Evidence-chain jump request: "replay this moment" in the AI view → switch to
  // replay and seek. The nonce prevents double consumption; the replay clock
  // stays local to ReplayView (lifting that hot state up would re-render all
  // three views on every tick).
  const [seekReq, setSeekReq] = useState<{
    tMs: number;
    unitNames: string[];
    nonce: number;
  } | null>(null);
  // B2 trace-back request: finding → "raw events" → switch to the events view
  // with a preset ±15s range + unit filter
  const [inspectReq, setInspectReq] = useState<{
    fromS: number;
    toS: number;
    unitName: string | null;
    nonce: number;
  } | null>(null);

  const handleInspectEvents = (tSeconds: number, unitNames: string[]) => {
    setInspectReq({
      fromS: Math.max(0, tSeconds - 15),
      toS: tSeconds + 15,
      unitName: unitNames[0]?.split("-")[0] ?? null,
      nonce: Date.now(),
    });
    setView("events");
  };
  const handleSeekEvent = (tSeconds: number, unitNames: string[]) => {
    setSeekReq({
      tMs: source.startTime + tSeconds * 1000,
      unitNames,
      nonce: Date.now(),
    });
    setView("replay");
  };
  // Review-workbench entry point (inert in production): re-fires
  // handleSeekEvent whenever the caller bumps externalSeek.nonce.
  useEffect(() => {
    if (!externalSeek) return;
    handleSeekEvent(externalSeek.tSeconds, externalSeek.unitNames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSeek?.nonce]);
  const summary = useMemo(
    () => deriveSummary(source, timeRange),
    [source, timeRange],
  );
  const timeline = useMemo(() => deriveTimeline(source), [source]);
  // unitId → 我方/敌方, one source for every surface that marks a team.
  const teamSides = useMemo(() => teamSidesByUnitId(source), [source]);
  // Name-keyed twin, for the many surfaces several components deep that only
  // ever hold a display name.
  const teamSidesByShortName = useMemo(() => teamSideByName(source), [source]);
  // Only the selected flow metric is bucketed, and only once the user leaves
  // 血量 — a report nobody switches pays nothing. Whole-match basis (not
  // timeRange), same as the HP curve it replaces.
  const flow = useMemo(
    () => (curveMetric === "hp" ? null : deriveFlowSeries(source, curveMetric)),
    [source, curveMetric],
  );
  const statsRows = useMemo(
    () => deriveStatsTable(source, timeRange),
    [source, timeRange],
  );
  const vulnBands = useMemo(() => deriveVulnBands(source), [source]);
  const pressure = useMemo(() => derivePressureLanes(source), [source]);
  const dampening = useMemo(() => deriveDampeningSeries(source), [source]);
  const ledger = useMemo(() => deriveBurstLedger(source), [source]);
  // Death recaps are derived once per match: the auto-open effect below and
  // every death-mark click read the same list instead of re-running the
  // derive per click.
  const deathRecaps = useMemo(() => deriveDeathRecaps(source), [source]);
  // Compute the whole-match basis first (KPI chips always use it); when
  // timeRange is empty the windowed version just reuses that reference instead
  // of running the same derive twice with identical args (agy review #7).
  const kickFull = useMemo(() => deriveKickDash(source), [source]);
  const kickRows = useMemo(
    () => (timeRange ? deriveKickDash(source, timeRange) : kickFull),
    [source, timeRange, kickFull],
  );
  const castControl = useMemo(
    () => deriveCastControl(source, rawStreams, timeRange),
    [source, rawStreams, timeRange],
  );
  const ccChainDash = useMemo(
    () => deriveCCChainDash(source, timeRange),
    [source, timeRange],
  );
  const dispelFull = useMemo(() => deriveDispelDash(source), [source]);
  // Hero line facts (UI review #1): finisher = the last real player death —
  // the same predicate KpiChips used (timeline.deaths already excludes
  // unconscious states and non-players), moved not duplicated; turning point
  // = the latest phase that has one (mid beats early: first death / burst
  // resolved over first defensive CD). Rounds under 90 s have none.
  const lastDeath = useMemo(() => {
    if (timeline.deaths.length === 0) return null;
    const d = timeline.deaths.reduce((a, b) => (b.t > a.t ? b : a));
    return { name: d.name, tS: (d.t - timeline.start) / 1000 };
  }, [timeline]);
  const dispelDash = useMemo(
    () => (timeRange ? deriveDispelDash(source, timeRange) : dispelFull),
    [source, timeRange, dispelFull],
  );
  // CC-break stats (2026-08-02): the "break" tab of the engagement panel
  const ccBreakDash = useMemo(
    () => deriveCcBreakDash(source, timeRange),
    [source, timeRange],
  );
  const auraUptime = useMemo(
    () => deriveAuraUptime(source, timeRange),
    [source, timeRange],
  );
  // Match-arc header row (#10 T4): whole-match basis, not linked to the time
  // window (same whole-match derive convention as the mistake list — the header
  // row is a "how did this match go" overview and must not shift around as the
  // user drag-selects windows).
  const matchArc = useMemo(() => deriveMatchArc(source), [source]);
  // Hero 转折: the latest phase that has a turning point (mid beats early —
  // first death / burst resolved over first defensive CD). See lastDeath above.
  const heroTurningPoint = useMemo(
    () =>
      [...matchArc].reverse().find((p) => p.turningPoint)?.turningPoint ?? null,
    [matchArc],
  );

  // Mistake list: derived once for the whole match (marks must be drawn across
  // the whole timeline); the card filters by window
  const mistakesAll = useMemo(() => deriveMistakes(source), [source]);
  const mistakes = useMemo(
    () =>
      timeRange
        ? mistakesAll.filter(
            (mk) => mk.tS >= timeRange.fromS && mk.tS <= timeRange.toS,
          )
        : mistakesAll,
    [mistakesAll, timeRange],
  );
  // BACKLOG #13: auto sliding-window over uncovered highlights — the entry
  // point below the findings section of the AI view.
  // aiFindingAnchors comes from StructuredAnalysisPanel (time anchors of the
  // first-round findings, see the onFindingsAnchors prop) and is merged with
  // mistakesAll's real time anchors into a de-duplicated anchor set — the
  // merging of the two bases stays here so the derive layer
  // (deriveUncoveredHighlights) remains pure geometry and does not care where
  // anchors come from. timedAnchorsFromMistakes already filters out sentinel tS
  // values of "whole-match observation" kinds such as cd-waste (review-round
  // fix: folding all of them in previously made the opening window look
  // "already covered").
  const [aiFindingAnchors, setAiFindingAnchors] = useState<number[]>([]);
  const uncoveredAnchors = useMemo(
    () => [...aiFindingAnchors, ...timedAnchorsFromMistakes(mistakesAll)],
    [aiFindingAnchors, mistakesAll],
  );
  // Lazy compute (a judgment call, not a hard requirement): run the sliding
  // window only while the AI view is mounted. The whole-match
  // buildWindowAnalysisRequest loop has a deterministic cost (measured <30ms for
  // 90s / 9 windows, see the perf note in uncoveredHighlights.test.ts) — not
  // heavy, but window count grows linearly with match length, and users on the
  // report/replay/events views should not pay for a card they may never look
  // at — so gate conservatively on view instead of precomputing.
  const uncoveredHighlights = useMemo(
    () =>
      view === "ai"
        ? deriveUncoveredHighlights(
            source,
            rangeDurationS(source),
            uncoveredAnchors,
          )
        : [],
    [source, uncoveredAnchors, view],
  );
  const [recap, setRecap] = useState<DeathRecap | null>(null);
  // P1-3: on entering a report / switching matches, expand the most recent death
  // recap by default (friendly first). The effect runs once per match (memoized
  // by ref), so after the user closes it with ✕ it won't reopen for this match.
  const autoRecapKey = useRef<string | null>(null);
  useEffect(() => {
    const key = `${source.startTime}:${source.endTime}`;
    if (autoRecapKey.current === key) return;
    autoRecapKey.current = key;
    setRecap(null);
    const all = deathRecaps;
    if (all.length === 0) return;
    const friendly = all.filter((r) => isFriendlyUnit(source, r.unitId));
    const pool = friendly.length > 0 ? friendly : all;
    setRecap(pool.reduce((a, b) => (b.deathS > a.deathS ? b : a)));
  }, [deathRecaps, source]);
  // Replay cursor projection (1c): show the last position when switching back
  // from replay to the report
  const [lastReplayT, setLastReplayT] = useState<number | null>(null);
  // Associated recording (the "recording" tab shows only when one exists). Stubs
  // often lack the recorder surface — missing surface means no tab, silently.
  const [videoRec, setVideoRec] = useState<{
    url: string;
    startedAt: number;
  } | null>(null);
  // One-click "run everything": nonce from the main analysis button → cohort
  // comparison (merges the two buttons into one)
  const [aiRunNonce, setAiRunNonce] = useState(0);

  // Bug report (2026-08-02): bundle this match's raw log + AI prompt/response +
  // the user's comment
  const [bugOpen, setBugOpen] = useState(false);
  const [bugComment, setBugComment] = useState("");
  const [bugState, setBugState] = useState<
    | { phase: "idle" }
    | { phase: "sending" }
    | { phase: "done"; dir: string; synced: boolean }
    | { phase: "error" }
  >({ phase: "idle" });
  const submitBugReport = async () => {
    setBugState({ phase: "sending" });
    try {
      const r = await bridge().bugReport.create({
        matchId: resolvedMatchId,
        roundSeq: source.kind === "shuffleRound" ? source.sequenceNumber : null,
        comment: bugComment,
      });
      setBugState({ phase: "done", dir: r.dir, synced: r.synced });
    } catch {
      setBugState({ phase: "error" }); // stub missing the surface / IPC failure
    }
  };

  // Window analysis (#16): one-shot deep dive on the current drag-selected
  // window; the terminal-state card sits below the toolbar.
  const [winAi, setWinAi] = useState<{
    range: TimeRange;
    state: WindowCardState;
  } | null>(null);
  // Any timeRange change (including being cleared) retracts the card: the same
  // window (equal by value) keeps its in-flight/terminal state; switching or
  // clearing the window always collapses it (no automatic re-query — the user
  // has to press the button again).
  useEffect(() => {
    setWinAi((prev) =>
      prev &&
      timeRange &&
      prev.range.fromS === timeRange.fromS &&
      prev.range.toS === timeRange.toS
        ? prev
        : null,
    );
  }, [timeRange]);
  // timeRange may change during runWindowAi's async gaps (the user dragged a new
  // window / cleared it) — the retract effect only clears state, it does not
  // cancel the in-flight promise; without an extra guard a stale response would
  // still call setWinAi unconditionally with the old range and resurrect the
  // already-collapsed card (found in fix round 1 review). The ref tracks
  // timeRange so runWindowAi can check "window unchanged" after every await
  // (same idea as StructuredAnalysisPanel's cancelled guard, except we compare
  // by value rather than a boolean, because the window may change and change
  // back to the same value).
  const timeRangeRef = useRef(timeRange);
  useEffect(() => {
    timeRangeRef.current = timeRange;
  }, [timeRange]);
  // Same guard, matchId flavor (fix for an audit Critical: if a shuffle round
  // switch reuses the component instance, an in-flight response that only
  // compares fromS/toS would land the previous round's analysis on the new
  // round's page whenever the numbers happen to match). ShuffleReport already
  // adds key={round.id} to force a remount per round as the main line of
  // defense; this is defense in depth so any future caller without a key is
  // still safe.
  const matchIdRef = useRef(resolvedMatchId);
  useEffect(() => {
    matchIdRef.current = resolvedMatchId;
  }, [resolvedMatchId]);

  // On match switch (matchId change) manually clear the two pieces of state that
  // genuinely go stale across matches (fix round 2; after review this replaced
  // "add a key on ShuffleReport and remount everything" with the surgical
  // version here — a full remount would also blow away view/videoRec: the
  // "replay" the user is watching would snap back to the default "report", and
  // the <video> for the recording shared by all 6 rounds under the same
  // videoMatchId would be destroyed and rebuilt on every round switch (it should
  // only seek, not reload/flicker).
  // - timeRange: a window from drag-select / the phase dropdown carries the
  //   previous match's time semantics and is void after the switch.
  // - winAi: the window AI result would keep showing the previous match's
  //   content — the actual defect behind this audit's Critical.
  // Use a ref to remember the last matchId and clear only when it truly changes
  // (we cannot clear unconditionally on [resolvedMatchId], or the first mount
  // would run it too and destroy the caller-provided initialTimeRange — see
  // windowAnalysis.test.tsx / report.timerange and other cases that rely on
  // initialTimeRange taking effect at mount).
  // Other state deliberately excluded after case-by-case review:
  // - hidden: which unit is hidden is a user preference that is stable across
  //   matches (the same players recur in every shuffle round), so staying hidden
  //   is intended behavior, not staleness.
  // - lastReplayT: an absolute ms value, but Timeline already has its own range
  //   guard `cursorT >= data.start && cursorT <= data.end` — after a switch it
  //   almost certainly falls outside the new match's interval and simply is not
  //   rendered, so no extra clearing is needed.
  // - recap: already recomputed by a separate effect keyed on
  //   `source.startTime:source.endTime` (see autoRecapKey above); does not
  //   depend on this.
  // - aiLang/aiRunNonce/videoRec: aiLang is a global setting unrelated to the
  //   match; videoRec is queried by resolvedVideoId (videoMatchId, shared across
  //   shuffle rounds, does not change with matchId) so it must not and will not
  //   be cleared; aiRunNonce is just a trigger counter carrying no match
  //   content.
  // - StructuredAnalysisPanel/ProComparisonVerified internal state: both already
  //   verify ownership by matchId themselves (the resultForRef pattern) and do
  //   not rely on a parent remount.
  const prevMatchIdRef = useRef(resolvedMatchId);
  useEffect(() => {
    if (prevMatchIdRef.current === resolvedMatchId) return;
    prevMatchIdRef.current = resolvedMatchId;
    setTimeRange(null);
    setWinAi(null);
    // BACKLOG #13: same as above — aiFindingAnchors would keep the previous
    // match's finding time anchors. StructuredAnalysisPanel re-reports after a
    // match switch, but asynchronously (once its own getState/lang effect has
    // run); clearing eagerly here is defense in depth that removes the transient
    // window where "the new match de-duplicates against the old match's
    // anchors" (same motivation as clearing timeRange/winAi).
    setAiFindingAnchors([]);
  }, [resolvedMatchId]);

  // Coach reply language (same settings.get pattern as ProComparisonVerified):
  // the bridge surface may be missing (fixture stub / test bed), so try/catch
  // falls back to the zh default.
  const [aiLang, setAiLang] = useState<"zh" | "en">("zh");
  useEffect(() => {
    void (async () => {
      try {
        const s = await bridge().settings.get();
        if (s?.aiLanguage === "en" || s?.aiLanguage === "zh")
          setAiLang(s.aiLanguage);
      } catch {
        /* default zh */
      }
    })();
  }, []);
  // The click flow already awaits ensureAnalysisData() (see runWindowAi), so by
  // the time results render the name index is guaranteed ready — no need for
  // StructuredAnalysisPanel's dataReady gate here.
  const rich = useMemo(() => makeRichText(source, aiLang), [source, aiLang]);

  const runWindowAi = async (range: TimeRange, opts?: { force?: boolean }) => {
    // The matchId at request time (captured by the closure, unaffected by later
    // renders) — isCurrent() compares it against matchIdRef.current to keep an
    // in-flight response from landing after a match/round switch.
    const requestMatchId = resolvedMatchId;
    // Whether the current timeRange is still the window this call started with
    // (compared by value, not by reference — the user may drag back to the same
    // window). Must be re-checked after every await: the window can be changed
    // or cleared during any async gap. A differing matchId also counts as stale
    // — if the same component instance were reused across matches (it should not
    // be; ShuffleReport's key prevents it, this is defense in depth), identical
    // fromS/toS must still not let the previous match's result land on the new
    // one.
    const isCurrent = () =>
      !!timeRangeRef.current &&
      timeRangeRef.current.fromS === range.fromS &&
      timeRangeRef.current.toS === range.toS &&
      matchIdRef.current === requestMatchId;
    setWinAi({ range, state: { phase: "loading" } });
    // Pack-building precondition: prompt spell names must never degrade
    await ensureAnalysisData();
    // Window changed/cleared: drop it, don't resurrect the collapsed card
    if (!isCurrent()) return;
    const req = buildWindowAnalysisRequest(source, range.fromS, range.toS);
    if (!req) {
      setWinAi({ range, state: { phase: "none" } }); // gate failed, no IPC sent
      return;
    }
    // Clamped window (req.fromS/toS): both the payload sent to main and the
    // result card's title must use it — the pack is built from the clamped
    // bounds, so reporting the caller's original range.fromS/toS would make an
    // out-of-bounds window's card title disagree with the evidence window that
    // was actually analyzed. isCurrent()'s guard logic is unchanged: it still
    // compares against this call's original range (the closure variable).
    const evidenceRange = { fromS: req.fromS, toS: req.toS };
    try {
      const r = await bridge().analysis.analyzeWindow({
        matchId: resolvedMatchId,
        fromS: evidenceRange.fromS,
        toS: evidenceRange.toS,
        pack: req.pack,
        kind: req.kind,
        spec: req.spec,
        ownerName: req.ownerName,
        // #21 item11 review-round fix: an explicit retry after audit-empty must
        // bypass the cache and hit the model again (the cache only protects
        // "re-selecting the same window"; it must not swallow a user's retry).
        force: opts?.force,
      });
      // As above: the window may have changed while the request was in flight
      if (!isCurrent()) return;
      if (r.status === "ok")
        setWinAi({
          range: evidenceRange,
          state: {
            phase: "result",
            entries: r.entries,
            fromCache: r.fromCache,
          },
        });
      else setWinAi({ range: evidenceRange, state: { phase: r.status } }); // busy/audit-empty/no-client/error are all retryable terminal states
    } catch {
      if (isCurrent())
        setWinAi({ range: evidenceRange, state: { phase: "error" } }); // no bridge / exception: same retryable treatment
    }
  };

  // BACKLOG #13: clicking "analyze this window" on an uncovered-highlight card
  // means "set the window + trigger runWindowAi" within one click. Normally
  // timeRangeRef follows timeRange asynchronously via an effect, but
  // runWindowAi's isCurrent() guard reads it right after the first await — if we
  // reach that point before the effect has run, it would wrongly conclude "the
  // window changed" and discard the very request it just issued. Syncing the ref
  // eagerly here removes that race (the effect will later assign the same value
  // again after setTimeRange — idempotent, no conflict).
  const handleAnalyzeHighlight = (range: TimeRange) => {
    timeRangeRef.current = range;
    setTimeRange(range);
    void runWindowAi(range);
  };

  // Moment deep-dive entry point (SDD 2026-08-05 Task 6): "深挖此刻" in
  // ReplayView reports the current playback clock as a relative second;
  // build a ±10s window around it (clamping to match-start is
  // buildWindowAnalysisRequest's job, see its clampedFromS/clampedToS), then
  // switch to the report view and run the same one-click "set window +
  // trigger runWindowAi" flow as handleAnalyzeHighlight above (same ref-
  // sync-before-effect reasoning: runWindowAi's isCurrent() guard reads
  // timeRangeRef right after its first await, before the timeRange effect
  // has had a chance to run).
  const handleMomentDive = (tSeconds: number) => {
    const range: TimeRange = {
      fromS: Math.max(0, Math.floor(tSeconds) - 10),
      toS: Math.floor(tSeconds) + 10,
    };
    timeRangeRef.current = range;
    setTimeRange(range);
    setView("report");
    // 2026-08-05 弃用决议(N=20 盲配对评测 B 胜率 35.7%,用户判据「B 不赢
    // 就不用」)后按 A 口径走;2026-08-21 管线审查第 3 条用户拍板「全摘删
    // 开关」,快照管线连同 deepDiveSnapshot 设置一并退役,纯提取函数留在
    // momentSnapshot.ts。数字与结论见
    // docs/superpowers/specs/2026-08-05-moment-deep-dive-design.md §6。
    void runWindowAi(range);
  };

  // Death-mark click → find that unit's nearest recap (from the per-match
  // memo). The recap has exactly one home: the persistent right column of the
  // report (2026-07-26 user feedback: the popover duplicated the persistent
  // column) — clicking in from replay/events switches back to the report view
  // instead of opening a popover.
  const openRecap = (unitId: string, tMs: number) => {
    const tS = (tMs - source.startTime) / 1000;
    const hit = deathRecaps
      .filter((r) => r.unitId === unitId)
      .sort((a, b) => Math.abs(a.deathS - tS) - Math.abs(b.deathS - tS))[0];
    if (hit) {
      setRecap(hit);
      setView("report");
      // A recap opened while the sidebar sits on 问教练 would be invisible —
      // the click promised a death review, so the tab follows.
      setSideTab("recap");
    }
  };

  // Legend / meter-name click semantics (user feedback 2026-08-05): from the
  // all-visible default a click means "let me look at just this one" — solo.
  // From any other state a click flips that one unit, building the comparison
  // set up or down. One special case: flipping the last visible unit off would
  // leave a blank chart (zero information), so that click restores all instead
  // — which also makes the natural cycle read 全选 → solo → 全选.
  const toggleUnit = (id: string) =>
    setHidden((prev) => {
      // The hidden set deliberately persists across matches (the same players
      // recur in every shuffle round), so "all visible" / "none visible" are
      // judged against THIS report's roster only, and ids belonging to other
      // matches are never dropped.
      const roster = summary.map((r) => r.unitId);
      const next = new Set(prev);
      if (roster.length > 1 && roster.every((p) => !prev.has(p))) {
        for (const p of roster) if (p !== id) next.add(p);
        return next;
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (roster.every((p) => next.has(p)))
        for (const p of roster) next.delete(p);
      return next;
    });

  const resolvedVideoId = videoMatchId ?? resolvedMatchId;

  useEffect(() => {
    let alive = true;
    setVideoRec(null);
    try {
      void bridge()
        .recorder?.getForMatch(resolvedVideoId)
        .then((r) => {
          if (alive) setVideoRec(r);
        })
        .catch(() => {});
    } catch {
      /* stub missing the surface */
    }
    return () => {
      alive = false;
    };
  }, [resolvedVideoId]);

  return (
    <TeamSideContext.Provider value={teamSidesByShortName}>
      <div className="rpt-match">
        {/* Header row: view tabs on the left (user feedback), result + meta on
          the right */}
        <div className="rpt-head-row">
          <div className="rpt-view-tabs rpt-head-tabs">
            {(Object.keys(VIEW_LABEL) as View[])
              .filter((k) => k !== "video" || videoRec != null)
              .map((k) => (
                <button
                  key={k}
                  className={k === view ? "active" : ""}
                  onClick={() => setView(k)}
                >
                  {VIEW_LABEL[k]}
                </button>
              ))}
          </div>
        </div>
        {/* Hero line (UI review 2026-08-21 #1): result · meta · 终结 · 转折 in
          one line under the tabs, on every view. */}
        <ReportHeader
          source={source}
          roundLabel={roundLabel}
          ratingDelta={ratingDelta}
          finisher={lastDeath}
          turningPoint={heroTurningPoint}
          onSeek={handleSeekEvent}
        />
        {/* Match-arc header row (#10 T4): applies to every report-* scene; sits
          below the header row and above the view switch so it never disappears
          with a tab change. */}
        <MatchArcLine phases={matchArc} onSeek={handleSeekEvent} />
        {view === "report" && (
          <div className="rpt-body">
            {/* KPI chips row (UI redesign 1a): whole-match glance, never linked
              to the time window */}
            <KpiChips
              mistakes={mistakesAll}
              bands={vulnBands}
              kickRows={kickFull}
              dispelDash={dispelFull}
            />
            {/* Two-column workbench (1a): at ≥1440px left = curve/meters/ledger,
              right = death recap/mistakes; narrow viewports fall back to a
              single column (the grid is driven by CSS breakpoints, the
              component tree is unchanged) */}
            <div className="rpt-report-grid">
              <div className="rpt-col-main">
                {/* Main card: HP curve + window list (1c); time-window toolbar
                  (phase 4 ①) */}
                <div>
                  <div className="rpt-toolbar-row">
                    <TimeRangeBar
                      bands={vulnBands}
                      range={timeRange}
                      onChange={setTimeRange}
                    />
                    {timeRange && (
                      <button
                        className="rpt-btn"
                        data-testid="window-ai-btn"
                        title="对当前选段做一次 AI 深挖(无可教信号时不调用模型)"
                        onClick={() => void runWindowAi(timeRange)}
                      >
                        AI 分析此段
                      </button>
                    )}
                    {/* Workflow actions live in the ⋯ menu (UI review #1):
                      they are what you do after reading, not while. */}
                    <ReportOverflowMenu
                      items={[
                        {
                          key: "md",
                          label: "复制 Markdown",
                          title: "导出当前(窗口)口径的战报 Markdown",
                          onClick: () =>
                            void navigator.clipboard.writeText(
                              buildReportMarkdown(source, timeRange),
                            ),
                        },
                        {
                          key: "img",
                          label: "导出图片",
                          title: "导出战报图片(离屏渲染同一页面后整页截图)",
                          onClick: () => {
                            try {
                              void bridge().matches.exportImage({
                                matchId: resolvedMatchId,
                                roundSeq:
                                  source.kind === "shuffleRound"
                                    ? source.sequenceNumber
                                    : null,
                                range: timeRange,
                              });
                            } catch {
                              /* fixture/test bed has no bridge → stay silent */
                            }
                          },
                        },
                        {
                          key: "bug",
                          label: "报告问题",
                          title:
                            "打包本场原始 log + AI 调用记录 + 你的描述,生成报告包",
                          testId: "bug-report-btn",
                          onClick: () => {
                            setBugOpen(true);
                            setBugState({ phase: "idle" });
                          },
                        },
                      ]}
                    />
                  </div>
                  {winAi && (
                    <WindowAnalysisCard
                      state={winAi.state}
                      range={winAi.range}
                      rich={rich}
                      onJumpT={handleSeekEvent}
                      onRetry={() =>
                        void runWindowAi(winAi.range, {
                          // Only an audit-empty retry needs to bypass the cache
                          // (#21 item11 review-round fix): error/busy are never
                          // cached to disk so force is a no-op for them, but pass
                          // it only when actually needed so the semantics aren't
                          // misread on the other branches.
                          force: winAi.state.phase === "audit-empty",
                        })
                      }
                    />
                  )}
                  <Timeline
                    data={timeline}
                    hidden={hidden}
                    onSelectUnit={toggleUnit}
                    // 同一份 hidden,不新开 state:曲线与伤害榜共用可见性是
                    // 有意设计(styles.css 的 .rpt-meter-name 注释写着名字可点
                    // 就是为了过滤生命曲线),拆成两份就会各走各的。
                    onSetHidden={setHidden}
                    onDeathClick={openRecap}
                    bands={vulnBands}
                    onBandClick={(tS) => handleSeekEvent(tS, [])}
                    cursorT={lastReplayT}
                    range={timeRange}
                    onRangeSelect={(fromS, toS) => setTimeRange({ fromS, toS })}
                    marks={mistakesAll}
                    onMarkClick={(tS) =>
                      handleSeekEvent(Math.max(0, tS - 3), [])
                    }
                    pressure={pressure}
                    dampening={dampening}
                    metric={curveMetric}
                    onMetric={handleCurveMetric}
                    flow={flow}
                    teamSides={teamSides}
                  />
                  <WindowList bands={vulnBands} onSeek={handleSeekEvent} />
                </div>
                {/* Left column, two panes: meters | engagement panel (kick /
                  dispel / aura / CC chain merged into tabs) */}
                <div className="rpt-body-cols">
                  <Meters
                    rows={summary}
                    mode={mode}
                    onMode={setMode}
                    hidden={hidden}
                    onToggleUnit={toggleUnit}
                    statsRows={statsRows}
                    durationS={rangeDurationS(source, timeRange)}
                    onSeek={handleSeekEvent}
                    source={source}
                    range={timeRange}
                    teamSides={teamSides}
                  />
                  <EngagementPanel
                    kickRows={kickRows}
                    castControl={castControl}
                    dispelDash={dispelDash}
                    auraUptime={auraUptime}
                    ccRows={ccChainDash.rows}
                    ccBreak={ccBreakDash}
                    onSeek={handleSeekEvent}
                    range={timeRange}
                    tab={engageTab}
                    onTab={setEngageTab}
                    roundish={source.kind === "shuffleRound"}
                  />
                </div>
                <BurstLedgerCard
                  players={ledger.players}
                  targetSelection={ledger.targetSelection}
                  onSeek={handleSeekEvent}
                />
              </div>
              {/* Right column: persistent death recap + mistake list (1a) */}
              <div className="rpt-col-side">
                <div className="rpt-mode-seg rpt-side-seg">
                  {(
                    [
                      ["recap", "回顾"],
                      ["chat", "问教练"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      data-testid={`side-tab-${k}`}
                      className={sideTab === k ? "active" : ""}
                      onClick={() => setSideTab(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* hidden, not unmounted: flipping to 回顾 mid-question must
                    not eat the chat draft. */}
                <div
                  className="rpt-side-pane"
                  hidden={sideTab !== "recap"}
                  data-testid="side-pane-recap"
                >
                  <div className="rpt-recap-col">
                    {recap ? (
                      <DeathRecapCard
                        recap={recap}
                        // Enemy death (fallback when no friendly died, or the
                        // user clicked an enemy ✕): the title switches to
                        // "finish"
                        enemy={!isFriendlyUnit(source, recap.unitId)}
                        onClose={() => setRecap(null)}
                        onJump={(tSeconds, unitNames) => {
                          handleSeekEvent(tSeconds, unitNames);
                        }}
                      />
                    ) : (
                      <div className="rpt-recap-placeholder">
                        点击曲线上的 ✕ 查看死亡回顾
                      </div>
                    )}
                  </div>
                  <MistakesCard mistakes={mistakes} onSeek={handleSeekEvent} />
                </div>
                <div
                  className="rpt-side-pane"
                  hidden={sideTab !== "chat"}
                  data-testid="side-pane-chat"
                >
                  <CoachChatCard source={source} matchId={resolvedMatchId} />
                </div>
              </div>
            </div>
          </div>
        )}
        {view === "events" && (
          <EventsPanel
            source={source}
            bands={vulnBands}
            globalRange={timeRange}
            onSeek={handleSeekEvent}
            inspectReq={inspectReq}
            matchId={resolvedMatchId}
            onOpenRecap={openRecap}
          />
        )}
        {view === "replay" && (
          <ReplayView
            source={source}
            seekReq={seekReq}
            onDeathClick={openRecap}
            onLastT={setLastReplayT}
            matchId={videoMatchId ?? resolvedMatchId}
            onMomentDive={handleMomentDive}
          />
        )}
        {view === "video" && videoRec && (
          <VideoTab
            url={videoRec.url}
            startedAt={videoRec.startedAt}
            source={source}
            matchId={resolvedMatchId}
            timeline={timeline}
            bands={vulnBands}
          />
        )}
        {view === "ai" && (
          <div className="rpt-ai-full">
            <div className="rpt-ai-main">
              {/* Chat card pinned to the top (user's call, 2026-08-02). Its
                position is also part of "the cohort panel sometimes doesn't
                show up": the production shell has a single scroll container
                (.app-main) with no scrollTop compensation, and this card's
                height jumps asynchronously (not rendered while unresolved → 51px
                empty state → ~430px once there is history, capped by
                coach-chat-msgs' max-height:320). Sitting directly above the
                cohort block, that jump shoves the cohort the user is reading
                clean out of the viewport. Pinned to the top, both jumps (the
                chat.getState fetch on mount, and sending a message) happen while
                the user is already looking at the top, so nothing below is
                yanked away. */}
              <CoachChatCard source={source} matchId={resolvedMatchId} />
              <StructuredAnalysisPanel
                source={source}
                matchId={resolvedMatchId}
                onSeekEvent={handleSeekEvent}
                onInspectEvents={handleInspectEvents}
                onRunAll={() => setAiRunNonce((n) => n + 1)}
                onFindingsAnchors={setAiFindingAnchors}
              />
              <UncoveredHighlightsCard
                highlights={uncoveredHighlights}
                onAnalyze={handleAnalyzeHighlight}
              />
              {/* Result card after clicking a highlight: the same winAi
                state/component as the one below the report view's toolbar.
                Clicking a highlight inside the AI view must show the result
                right there without switching to the report tab — otherwise
                "one-click into #16" is effectively not wired up at all. */}
              {winAi && (
                <WindowAnalysisCard
                  state={winAi.state}
                  range={winAi.range}
                  rich={rich}
                  onJumpT={handleSeekEvent}
                  onRetry={() =>
                    void runWindowAi(winAi.range, {
                      force: winAi.state.phase === "audit-empty",
                    })
                  }
                />
              )}
              <div className="rpt-ai-cohort">
                <ProComparisonVerified
                  source={source}
                  matchId={resolvedMatchId}
                  runSignal={aiRunNonce}
                  hideActions
                />
              </div>
            </div>
          </div>
        )}
        {/* Bug-report modal (2026-08-02): comment + one-click bundling; reuses
          the dash-modal shell */}
        {bugOpen && (
          <div
            className="dash-modal-backdrop"
            onClick={() => setBugOpen(false)}
          >
            <div
              className="dash-modal rpt-bug-modal"
              role="dialog"
              aria-label="报告问题"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="dash-card-head">
                <span className="rpt-card-label">报告问题 —— 本场</span>
                <button
                  type="button"
                  className="dash-modal-close"
                  aria-label="关闭"
                  onClick={() => setBugOpen(false)}
                >
                  ✕
                </button>
              </span>
              <p className="rpt-dim rpt-bug-hint">
                会打包:本场原始 log、最近 AI 调用的 prompt 与返回、下面这段
                描述。落在 gladlog-sync 同步盘时会自动上传。
              </p>
              <textarea
                className="rpt-bug-comment"
                data-testid="bug-comment"
                placeholder="哪里不对?比如:教练怪我没驱散龙息,但我当时被变形了"
                value={bugComment}
                onChange={(e) => setBugComment(e.target.value)}
                rows={4}
              />
              <div className="rpt-bug-actions">
                <button
                  className="rpt-btn"
                  data-testid="bug-submit"
                  disabled={bugState.phase === "sending"}
                  onClick={() => void submitBugReport()}
                >
                  {bugState.phase === "sending" ? "打包中…" : "生成报告包"}
                </button>
                {bugState.phase === "done" && (
                  <span className="rpt-bug-result">
                    已生成
                    {bugState.synced
                      ? "(在同步盘,会自动上传)"
                      : "(本地保存,已在文件管理器打开)"}
                    :{bugState.dir}
                  </span>
                )}
                {bugState.phase === "error" && (
                  <span className="rpt-bug-result rpt-bug-error">
                    生成失败 —— 稍后再试
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </TeamSideContext.Provider>
  );
}
