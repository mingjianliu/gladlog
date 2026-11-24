import type { Finding } from "@gladlog/analysis";
import { analysisDataReady, ensureAnalysisData } from "@gladlog/analysis";
import {
  habitBadgeText,
  ruleAppliesToFinding,
} from "@gladlog/analysis/src/learning/matchRules";
import type { LearnedRule } from "@gladlog/analysis/src/learning/types";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AI_BACKENDS,
  AI_MODELS,
  type AiBackend,
  BACKEND_CLI_TOOL,
  resolveAiModel,
} from "../../../../shared/aiModels";
import type { AnalysisFallbackReason } from "../../../../shared/analysisFallback";
import type { Language } from "../../../../shared/i18n/index";
import { bridge } from "../../bridge";
import { useT } from "../../i18n/LangProvider";
import { DEMO_ANALYSIS, DEMO_ANALYSIS_EN } from "../data/demoAnalysis";
import { cliWaitHint, fmtElapsed } from "../derive/aiRunStatus";
import { buildDeepenPacks } from "../derive/analysisInput";
import { categoryLabel, severityLabel } from "../derive/findingDisplay";
import { makeRichText } from "../derive/inlineRich";
import { resolveJumpTarget } from "../derive/jumpTarget";
import { deriveKeyMoments } from "../derive/keyMoments";
import { useAnalysisInput } from "../derive/offThread/useAnalysisInput";
import { selfReviewNote, type SelfReviewView } from "../derive/selfReviewNote";
import { backendModelLabel, slotLabel } from "../derive/slotLabel";
import type { ReportSource } from "../derive/types";
import { zeroFindingText } from "../derive/zeroFindingText";
import { ContentLangBadge } from "./ContentLangBadge";
import { ExportButtons } from "./ExportButtons";
import { FindingsList } from "./FindingsList";
import { KeyMomentAxis } from "./KeyMomentAxis";
import { useElapsedSince } from "./useElapsedSince";

type AnalysisResult = {
  findings: Finding[];
  dropped: number;
  hadNarration: boolean;
  fallbackReason?: AnalysisFallbackReason;
  deepened?: boolean;
  selfReview?: SelfReviewView;
  /** Language the result was generated in (main's getCached / done event,
   * spec §6.13). Absent (older stubs) = the current UI language. */
  contentLang?: Language;
};

type State = "idle" | "running" | "done" | "error";

export function StructuredAnalysisPanel({
  source,
  matchId,
  onSeekEvent,
  onInspectEvents,
  onRunAll,
  onFindingsAnchors,
  onFallbackContent,
}: {
  source: ReportSource;
  matchId: string;
  /** Evidence-chain jump: switch to replay and seek to t (seconds since combat start). */
  onSeekEvent?: (tSeconds: number, unitNames: string[]) => void;
  /** B2 provenance: jump to the events view with a preset filter (finding → "raw events"). */
  onInspectEvents?: (tSeconds: number, unitNames: string[]) => void;
  /** Merged button (user feedback): the primary button also triggers the cohort comparison. */
  onRunAll?: () => void;
  /** BACKLOG #13: feed the first-round findings' time anchors to the parent
   * (MatchReport's uncovered-highlights sliding window uses them for dedup).
   * Only findings with time anchors are included — whole-match observations
   * have no specific moment and must not be treated as "covering some span".
   * Any internal panel state change (match switch / new result / slot switch)
   * re-invokes this; an empty array means "no anchors right now" (rather than
   * not calling at all). */
  onFindingsAnchors?: (anchors: number[]) => void;
  /** Spec §6.13 / plan Review Focus 3: true while the card shows a result
   * generated in the other language (read back because the current language
   * has no hit). The parent hides the entry points that act on it (coach
   * chat, span analysis of uncovered highlights); false otherwise. */
  onFallbackContent?: (fallback: boolean) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  // 「看一个演示分析」(UI review #7): component-local only. Never written to
  // the cache, never handed to the coach chat, cleared on analyze / match
  // switch; its findings render with no seek handlers (fake events).
  const [demo, setDemo] = useState(false);
  // Reset on match switch only — NOT in the cache-query effect below. (That
  // effect used to key on a `lang` state that flipped once after mount, when
  // settings.get() resolved, and so wiped a demo opened before settings
  // arrived — CI-only race, 2026-08-22. Since 2026-11-23 `lang` comes from
  // LangProvider, which only renders once the language is known, so it never
  // flips after mount; it changes only on a real user switch.)
  useEffect(() => setDemo(false), [matchId]);
  // matchId the result belongs to: at the instant of a match switch, result is
  // still the old match's data; the deep-dive trigger must verify ownership,
  // otherwise it writes match A's findings into match B's cache (agy review #1)
  const resultForRef = useRef<string | null>(null);
  const [error, setError] = useState<string>("");
  const [, setActiveEventIds] = useState<string[]>([]);
  // Multi-model slots (Task 3): slots/activeKey come from the getState summary;
  // selectedSlotKey === null means "follow activeKey" (default behavior, and
  // the behavior after a new analysis completes).
  const [slots, setSlots] = useState<
    Array<{ key: string; createdAt: number; stale: boolean }>
  >([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Ref mirror of activeKey: handleSelectSlot's getCached resolve callback
  // needs the *current* activeKey to decide whether the slot it just fetched
  // is the active one, but the callback is a closure created in the render at
  // click time — if activeKey state updates during the await (e.g. a concurrent
  // onDone), the closed-over activeKey would be stale. The ref guarantees we
  // read the latest value.
  const activeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  // Review I-2: placeholder state for when the selected slot's cache is missing
  // (e.g. an old slot invalidated by a prompt upgrade). selectedSlotKey flips to
  // the target slot at click time (the highlight tracks instantly), but when
  // getCached resolves null there is nothing to display — doing nothing would
  // leave `result` as the previous slot's content, so the panel would show a
  // torn "old content + new highlight" state (the stale tab highlighted while
  // the content is another model's findings). When this flag is set, the render
  // layer swaps the result area for a placeholder note; `result` itself is not
  // cleared — the previous slot's underlying state is kept so clicking back to
  // that slot doesn't require another IPC round-trip.
  const [displayEmpty, setDisplayEmpty] = useState<"stale" | null>(null);
  // Tab switching is a plain click, not an effect, so there is no cleanup to
  // hang a cancelled flag on; remember "which slot this click requested" and,
  // when getCached resolves, drop the late response if another slot was clicked
  // or the match changed (prevents a stale response from clobbering the newer
  // click when rapidly alternating A/B).
  const slotRequestRef = useRef<string | null>(null);
  // "Is the current result state the active slot's content?" — written
  // synchronously with every setResult (rather than derived from
  // selectedSlotKey/activeKey) to avoid this race (agy flash review F1):
  // after clicking back to the active slot's tab, selectedSlotKey/
  // displayedSlotKey flip immediately, but the result payload only becomes the
  // new slot's content once getCached resolves; if the deep-dive gate only
  // checked displayedSlotKey === activeKey, it would deep-dive the previous
  // slot's result.findings into the active slot during that interim state.
  const resultOwnerRef = useRef<"active" | "other">("active");
  // The shown result is a round whose cache write failed (GH #230: done with
  // `persisted: false`). It belongs to no saved slot, so no tab is
  // highlighted -- otherwise the still-active older slot's tab would sit over
  // this text and clicking it would be a no-op. Any tab click, new result or
  // match/language switch clears it.
  const [unsaved, setUnsaved] = useState(false);
  const displayedSlotKey = unsaved ? null : (selectedSlotKey ?? activeKey);
  // UI language, which is also the coach reply language (spec §6.12): the main
  // side injects it into the system prompt and caches per language key, so the
  // cache query below re-runs when it changes. GH #26 root cause (2026-09-02):
  // the old local `lang` state flipped null → "zh" once after mount (when
  // settings.get() resolved), and keying the query on it re-ran the query on
  // every mount — setResult(null), resultForRef = null, a second getState — so
  // an onDone landing between the first result's commit and that effect's
  // passive flush was swallowed by the match-switch guard while the second
  // getState's cached answer overwrote the done payload. LangProvider renders
  // its children only once the language is known, so this value is stable
  // from the first render and changes only on a real user switch.
  const { lang, t, namesVersion } = useT();
  /** The current language for the event listeners, which subscribe once per
   * match (a completion of another language is not displayed, see onDone). */
  const langRef = useRef(lang);
  langRef.current = lang;
  /** Bumped to re-run the cache query below without a match/language change:
   * a completion of another language arrived, so the panel re-resolves what
   * the current language should show (codex A#7). */
  const [resync, setResync] = useState(0);
  // Settings snapshot for the split-button menu (Task 4): only the sentinel
  // fields (key truthiness) and the current global default backend/model.
  const [aiSettings, setAiSettings] = useState<{
    anthropicApiKey?: string | null;
    deepseekApiKey?: string | null;
    aiBackend?: AiBackend | null;
    aiModels?: Partial<Record<AiBackend, string>> | null;
  } | null>(null);
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState("");
  // 「分析中」状态行(2026-08-05 生产反馈:CLI 后端假流式,分钟级零信号,
  // 用户分不清在跑还是卡死):在跑一轮的起点与实际后端/模型。本地点按钮时
  // 就地填(用户选的 override 或全局默认);重挂载时由 getState 的
  // runningMeta 回填,所以计时是真实已耗时不归零。
  const [runMeta, setRunMeta] = useState<{
    since: number;
    backend: string | null;
    model: string | null;
  } | null>(null);
  // 首轮 bad-json 自动重试中(main 发 gladlog:analysis:retry)——总时长会
  // 翻倍,状态行必须解释这段额外等待。
  const [retrying, setRetrying] = useState(false);
  // 首轮已出结果、正在跑 AI 自查(main 发 gladlog:analysis:reviewing;
  // 重挂载时由 runningMeta.reviewing 回填)——与 retrying 同一套。
  const [reviewing, setReviewing] = useState(false);
  const elapsedS = useElapsedSince(
    state === "running" ? (runMeta?.since ?? null) : null,
  );
  // This match's goals (D3 loop): top categories flagged "still recurring"
  // across matches, used as observation goals for this match.
  const [goals, setGoals] = useState<
    Array<{
      category: string;
      recurring: number;
      lastTitle?: string;
      lastLang?: Language;
    }>
  >([]);
  // Cross-match habit badges (spec §4): rule ledger, matched against audited
  // findings; no AI call.
  const [rules, setRules] = useState<LearnedRule[]>([]);
  useEffect(() => {
    try {
      const api = (
        bridge() as unknown as {
          learning?: { getRules(): Promise<{ rules: LearnedRule[] } | null> };
        }
      ).learning;
      if (!api) return;
      void api
        .getRules()
        .then((doc) => setRules(doc?.rules ?? []))
        .catch(() => {});
    } catch {
      /* test stub lacks this facet */
    }
  }, [matchId]);

  useEffect(() => {
    try {
      const p = bridge().analysis.aggregate?.();
      if (!p) return;
      void p
        .then((cats) =>
          setGoals(
            (cats ?? [])
              .filter((c) => c.recurring > 0)
              .sort((a, b) => b.recurring - a.recurring)
              .slice(0, 3)
              .map((c) => ({
                category: c.category,
                recurring: c.recurring,
                lastTitle: c.recent?.[0]?.title,
                lastLang: c.recent?.[0]?.contentLang,
              })),
          ),
        )
        .catch(() => {});
    } catch {
      /* test stub lacks this facet */
    }
  }, [matchId]);

  useEffect(() => {
    // cancelled guard: flags are **per-match** data; when switching matches
    // quickly, an earlier request may arrive later and overwrite the current
    // match with the previous match's flags (flags render as "still recurring /
    // resolved" on findings, so this would mislabel them). Same pattern as the
    // getState effect above.
    let cancelled = false;
    try {
      void bridge()
        .analysis.getFlags(matchId)
        .then((f) => {
          if (!cancelled) setFlags(f);
        })
        .catch(() => {
          if (!cancelled) setFlags({});
        });
    } catch {
      setFlags({});
    }
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const handleFlag = (key: string, flag: "done" | "recurring" | null) => {
    try {
      void bridge()
        .analysis.setFlag(matchId, key, flag)
        .then(setFlags)
        .catch(() => {});
    } catch {
      /* test stub lacks this facet */
    }
  };

  useEffect(() => {
    // Test stubs / legacy fixture bridges may lack the settings facet — the
    // split menu then just has no settings snapshot.
    try {
      void bridge()
        .settings.get()
        .then((s) => {
          setAiSettings(
            s as {
              anthropicApiKey?: string | null;
              deepseekApiKey?: string | null;
              aiBackend?: AiBackend | null;
              aiModels?: Partial<Record<AiBackend, string>> | null;
            },
          );
        })
        .catch(() => {});
    } catch {
      /* test stub lacks this facet */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    resultForRef.current = null;
    setState("idle");
    setError("");
    setActiveEventIds([]);
    // Match/language switch: back to "follow activeKey"; the slot summary is
    // backfilled by the query below.
    setSelectedSlotKey(null);
    setUnsaved(false);
    setDisplayEmpty(null); // match/language switch: the old match's placeholder state must not carry over
    slotRequestRef.current = null;
    resultOwnerRef.current = "active";
    setSlots([]);
    setActiveKey(null);
    setRunMeta(null);
    setRetrying(false);
    setReviewing(false);
    // The stream preview belongs to the match / language it streamed in
    // (codex F2#9): a running same-language round refills it from its next
    // delta.
    setPreview("");
    void (async () => {
      try {
        // Single atomic query: the cache and the running flag must be read from
        // the main process in one call. Asking twice (getCached → isRunning)
        // can miss a run that completes right between the two awaits — the
        // cache not yet flushed, running already cleared, leaving the panel
        // idle while the result is already on disk.
        const {
          cached,
          running,
          runningMeta,
          slots: slotSummaries,
          activeKey: docActiveKey,
        } = (await bridge().analysis.getState(matchId)) as {
          cached: AnalysisResult | null;
          running: boolean;
          runningMeta?: {
            since: number;
            backend: string;
            model: string;
            retrying?: boolean;
            reviewing?: boolean;
          } | null;
          slots?: Array<{ key: string; createdAt: number; stale: boolean }>;
          activeKey?: string | null;
        };
        if (cancelled) return;
        // A done landed while this query was in flight (it set resultForRef;
        // this effect cleared it on start): the whole snapshot is older than
        // what is on screen -- its result, its slot summary and its running
        // flag alike. Keep the newer state; that done's own getState refresh
        // brings the tab bar up to date. Without this an unsaved round's text
        // (GH #230) was replaced by the older saved result, and a stale
        // `running: true` put a finished round back to "analyzing", or an old
        // summary dropped the new slot's tab (codex re-reviews).
        if (resultForRef.current === matchId) return;
        setSlots(slotSummaries ?? []);
        setActiveKey(docActiveKey ?? null);
        if (cached) {
          resultForRef.current = matchId;
          // getState's cached is always resolveActiveSlot's content (single-
          // source decision on the main side), so this is always "active",
          // independent of docActiveKey's specific value.
          resultOwnerRef.current = "active";
          setResult(cached);
        }
        if (!running) {
          if (cached) setState("done");
        } else {
          // On remount (returning via tab/match switch), if a round is still
          // running in the main process, show "analyzing…" instead of idle —
          // otherwise the user assumes it was lost and clicking again would
          // run it twice. The done event fills in the result. This holds with
          // cached content too (codex B2#3: e.g. the other language's
          // fallback while its re-analysis runs): the content stays visible
          // beneath, exactly as runAnalyze leaves it, but the button stays
          // disabled so a second click cannot supersede the run.
          setState("running");
          // meta 缺席(旧 stub)时退化为从现在起计——比不显示强,且只低估
          setRunMeta(
            runningMeta ?? { since: Date.now(), backend: null, model: null },
          );
          // 重试标注也从 main 回填(agy review #1):重挂载后计时还在涨,
          // 「为什么翻倍」的解释不能丢
          setRetrying(runningMeta?.retrying === true);
          setReviewing(runningMeta?.reviewing === true);
        }
      } catch {
        /* test stub / no bridge facet: stay idle */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, lang, resync]);

  useEffect(() => {
    // After persistent mounting this effect runs in every view; a missing
    // bridge facet (test stub) must not make mounting throw.
    let offDelta: (() => void) | undefined;
    let offRetry: (() => void) | undefined;
    let offReviewing: (() => void) | undefined;
    let offDone: (() => void) | undefined;
    let offError: (() => void) | undefined;
    try {
      const ai = bridge().analysis;
      offDelta = ai.onDelta?.(
        (d: { matchId: string; text: string; contentLang?: Language }) => {
          if (d.matchId !== matchId) return;
          // A round pinned to another language (started before a language
          // switch) streams text in that language: it must not render under
          // this language's result (codex F2#9). Its done is re-resolved
          // through getState (see onDone below).
          if (d.contentLang !== undefined && d.contentLang !== langRef.current)
            return;
          setPreview((p) => (p + d.text).slice(-600));
        },
      );
      offRetry = ai.onRetry?.((d: { matchId: string }) => {
        if (d.matchId !== matchId) return;
        setRetrying(true);
      });
      offReviewing = ai.onReviewing?.((d: { matchId: string }) => {
        if (d.matchId !== matchId) return;
        setReviewing(true);
      });
      offDone = ai.onDone(
        (d: {
          matchId: string;
          result: unknown;
          slotKey?: string;
          contentLang?: Language;
          persisted?: false;
        }) => {
          if (d.matchId !== matchId) return;
          // A round pinned to another language (started before a language
          // switch) finished: it must not replace what this language shows
          // -- a valid current-language result may be on screen (codex A#7,
          // B1#1, B2#2). Re-resolve from getState instead, which returns the
          // current language's result when there is one, else the fallback
          // (now this fresh round, labelled).
          if (
            d.contentLang !== undefined &&
            d.contentLang !== langRef.current
          ) {
            setResync((n) => n + 1);
            return;
          }
          resultForRef.current = matchId;
          // Invariant (Task 4 handover fix -- the original comment assumed
          // "the finished run = the default slot from settings", which the
          // split button's temporary backendOverride broke):
          // whether this run used the global default backend/model or a
          // backendOverride picked ad hoc from the split menu, upsertSlot in
          // the main-side finish()/deepenInner always sets "the slot just
          // written" as the new lastSlotKey (see the comments on analysis.ts
          // run() finish and deepenInner writeMerged) -- i.e. "the result that
          // just finished" and "the new active slot" are always the same slot.
          // Product behavior per spec is "a completed analysis returns to the
          // newest slot", regardless of which model ran it, so owner is
          // constantly "active" here; no branching on d.slotKey.
          resultOwnerRef.current = "active";
          // Except an unsaved round (GH #230): not the active slot's content
          // (that slot is still the older one on disk), so no auto deep dive
          // -- main would refuse it anyway, its findings not being the slot's.
          if (d.persisted === false) resultOwnerRef.current = "other";
          setUnsaved(d.persisted === false);
          // contentLang rides on the event, not inside the stored result: a
          // round started before a language switch finishes in the language
          // it started in (Review Focus 4) and is labelled as such.
          setResult({
            ...(d.result as AnalysisResult),
            ...(d.contentLang ? { contentLang: d.contentLang } : {}),
          });
          setState("done");
          setError("");
          setRunMeta(null);
          setRetrying(false);
          setReviewing(false);
          // New analysis landed: back to "follow activeKey", discarding any
          // in-flight old-slot tab request (otherwise that late getCached
          // response could overwrite the fresh result with the old slot).
          setSelectedSlotKey(null);
          setDisplayEmpty(null); // new result landed; any prior placeholder state is stale
          slotRequestRef.current = null;
          // The slot summary may have changed (new slot / different activeKey /
          // a slot turned stale by a PROMPT_VERSION bump) -- re-query getState
          // so the tab bar stays consistent with disk
          // (agy flash review F2: onDone previously only updated result and
          // never refreshed the tab list).
          void bridge()
            .analysis.getState(matchId)
            .then(
              ({
                slots: s,
                activeKey: ak,
              }: {
                slots?: Array<{
                  key: string;
                  createdAt: number;
                  stale: boolean;
                }>;
                activeKey?: string | null;
              }) => {
                if (resultForRef.current !== matchId) {
                  // GH #26 diagnostic (2026-08-29) — and it delivered: the
                  // 2026-09-02 deterministic reproduction printed
                  // `resultFor=null matchId=m1` here, which named the mover of
                  // the ref: the cache-query effect re-running on the initial
                  // `lang` flip (fixed — see `useT()` above). Kept as the
                  // genuine match-switch trace. console.info, not warn (the
                  // invariant test spies on warn).
                  // eslint-disable-next-line no-console -- match-switch trace; must not be warn (spied by the test)
                  console.info(
                    `[analysis] onDone/getState resolved after a match switch: resultFor=${String(resultForRef.current)} matchId=${matchId} slotKey=${String(d.slotKey)} activeKey=${String(ak)}`,
                  );
                  return; // match-switch race
                }
                // Defensive cross-check (does not change what is displayed):
                // the payload's slotKey must in theory equal the activeKey we
                // just refreshed. If the invariant above is ever violated (say
                // the main side misses one of the disk-write branches), this
                // leaves a trace in the console immediately instead of letting
                // the panel silently show the wrong slot unnoticed. Display
                // still follows ak.
                if (d.slotKey && ak != null && d.slotKey !== ak) {
                  console.warn(
                    `[analysis] onDone slotKey(${d.slotKey}) != 刷新后 activeKey(${ak})—— 违反"完成槽即激活槽"不变式,仍按 activeKey 展示`,
                  );
                }
                setSlots(s ?? []);
                setActiveKey(ak ?? null);
              },
            )
            .catch((e: unknown) => {
              // GH #26 diagnostic: a swallowed getState failure is the other
              // way the mismatch warn can silently never fire.
              // eslint-disable-next-line no-console -- GH #26 diagnostic; must not be warn (spied by the test)
              console.info(
                `[analysis] onDone getState failed: ${e instanceof Error ? e.message : String(e)}`,
              );
            });
        },
      );
      offError = ai.onError((d: { matchId: string; message: string }) => {
        if (d.matchId !== matchId) return;
        setState("error");
        setError(d.message);
        setRunMeta(null);
        setRetrying(false);
        setReviewing(false);
      });
    } catch {
      /* test stub / no bridge facet: skip subscribing, mounting must not throw */
    }
    return () => {
      offDelta?.();
      offRetry?.();
      offReviewing?.();
      offDone?.();
      offError?.();
    };
  }, [matchId]);

  // The big data tables (spell names / talents) load in the background; the
  // prompt is not allowed to degrade (contract in analysis data/ensure.ts), so
  // input construction is gated on readiness. In the normal ordering the tables
  // are ready long before the report opens (analysisDataReady() starts true, so
  // zero extra re-renders).
  const [dataReady, setDataReady] = useState(analysisDataReady);
  useEffect(() => {
    if (dataReady) return;
    let alive = true;
    void ensureAnalysisData().then(() => {
      if (alive) setDataReady(true);
    });
    return () => {
      alive = false;
    };
  }, [dataReady]);

  // Build logic is single-source with the batch driver (analysisInput.ts) --
  // a DPS recorder gets the DPS perspective (D2). Built in the derive worker
  // when it is not cached (a long match's first visit froze the page 6.8 s
  // building it here, Windows field run 2026-11-14); `inputPending` until it
  // lands.
  const { input, pending: inputPending } = useAnalysisInput(
    source,
    matchId,
    dataReady,
  );

  // namesVersion: in en the moment titles read English spell names, which
  // load after first paint (codex B1#4, B2#7).
  const keyMoments = useMemo(
    () => deriveKeyMoments(source, undefined, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, lang, namesVersion],
  );

  // #15 inline icons: built once per match / per language; rebuilt once
  // dataReady flips true (the index goes from null to usable and the display
  // path heals itself -- the ensure contract).
  const rich = useMemo(
    () => makeRichText(source, lang),
    [source, lang, dataReady],
  );

  // Cross-match habit badges: zoneId is unknown on the renderer side -> pass
  // undefined, so zone-conditioned rules conservatively stay dark
  // (matchInCondition treats unknown fields as not satisfied, see Task 1).
  const habitOf = useMemo(() => {
    if (rules.length === 0 || !input) return undefined;
    const meta = { enemySpecs: input.enemySpecs };
    return (f: Finding): string | null => {
      const hit = rules.find((r) =>
        ruleAppliesToFinding(r, f, input.candidates, meta),
      );
      return hit ? habitBadgeText(hit, lang) : null;
    };
  }, [rules, input, lang]);

  // Deep-dive round (automatic follow-up): once the first-round result lands,
  // build deterministic evidence packs for high-severity findings and trigger
  // round two. The deepened flag prevents repeats; even an empty pack set is
  // sent once so the flag gets written.
  useEffect(() => {
    if (!result || !input) return;
    if (resultForRef.current !== matchId) return; // stale result at the instant of a match switch
    // Multi-model slots (Task 3): auto deep-dive only applies to the currently
    // active slot -- it must not fire while viewing an old slot / another
    // model's slot, or deep-dive output gets written into the wrong slot. Use
    // resultOwnerRef (written synchronously with every setResult) rather than
    // displayedSlotKey derived from selectedSlotKey/activeKey: the latter flips
    // the instant a slot tab is clicked, while the result state has not yet
    // been swapped to the new slot's content (getCached has not resolved), so
    // judging on it would deep-dive the old slot's content into the active slot
    // during that interim state (a race found in agy flash review, eliminated
    // by resultOwnerRef).
    if (resultOwnerRef.current !== "active") return;
    // Other-language content (spec §6.13, Review Focus 3): never deep-dive it
    // -- main's deepen writes into the current language's cache, so it would
    // merge the other language's findings into it.
    if ((result.contentLang ?? lang) !== lang) return;
    // Only from a settled result (codex F2#2, F3#2): not while a first round
    // is running (restored `running` on remount -- the deep dive bumps the
    // match's generation in main and would cancel that paid round; main also
    // refuses it), and not on the error path (a failed re-analysis must not
    // deep-dive the previous result and clear the error). The effect re-runs
    // when the round's done lands.
    if (state !== "done") return;
    if (!result.hadNarration || result.deepened) return;
    if (result.findings.length === 0) return;
    try {
      // Pack-building logic is single-source with the batch driver (analysisInput.ts).
      const packs = buildDeepenPacks(
        source,
        result.findings,
        input.candidates,
        input.ownerName,
        result.contentLang ?? lang,
      );
      void bridge()
        .analysis.deepen({
          matchId,
          findings: result.findings,
          packs,
          spec: input.spec,
          ownerName: input.ownerName,
          contentLang: result.contentLang ?? lang,
        })
        .catch(() => {});
    } catch {
      /* test stub lacks this facet / pack build failed: keep the first round */
    }
    // input must stay in the deps: the dataReady gate takes it from null to
    // non-null, and on a cache hit result is ready first, so on the effect's
    // first run input is still null and it returns immediately -- without
    // depending on input the deep-dive would never fire (agy review F1).
    // Re-running is harmless: the main-side idempotency guard plus the
    // deepened flag are a double safeguard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, matchId, input, lang, state]);

  // The split predicate is single-source with buildFindingsPrompt's whole-round
  // decision: a missing facts.t means a whole-match observation (cd-waste etc.)
  // and does not go on the timeline.
  const splitFindings = useMemo(() => {
    const timedIds = new Set(
      (input?.candidates ?? [])
        .filter((c) => c.facts.t !== undefined)
        .map((c) => c.id),
    );
    const timed = (result?.findings ?? []).filter((f) =>
      f.eventIds?.some((id) => timedIds.has(id)),
    );
    const wholeRound = (result?.findings ?? []).filter(
      (f) => !timed.includes(f),
    );
    return { timed, wholeRound };
  }, [input, result]);

  // BACKLOG #13: feed the first-round findings' time anchors to the parent
  // (used for dedup by the uncovered-highlights sliding window).
  // resolveJumpTarget reuses the same candidates as "replay this moment"
  // (handleJump) -- a single-source predicate, no separate time resolution.
  // When input is null (data not ready / owner resolution failed) we report an
  // empty array rather than not calling: the parent uses that to clear anchors
  // left over from the previous match.
  useEffect(() => {
    if (!onFindingsAnchors) return;
    if (!input) {
      onFindingsAnchors([]);
      return;
    }
    const anchors = splitFindings.timed
      .map((f) => resolveJumpTarget(input.candidates, f.eventIds ?? [])?.t)
      .filter((t): t is number => t !== undefined);
    onFindingsAnchors(anchors);
  }, [splitFindings.timed, input, onFindingsAnchors]);

  // A finding's eventIds -> the earliest t among the referenced events plus the
  // units involved (the lookup lives in the derive layer, which has unit tests
  // -- seeded E2E runs never hit real candidate ids, so they cannot cover this
  // path).
  const handleJump = (eventIds: string[]) => {
    if (!onSeekEvent || !input) return;
    const target = resolveJumpTarget(input.candidates, eventIds);
    if (!target) return;
    setActiveEventIds(eventIds);
    onSeekEvent(target.t, target.unitNames);
  };

  // Tab switch (Task 3): clicking a slot other than the displayed one reads
  // that slot's cache and shows it; no run/deepen is issued.
  // Double guard: matchId ownership (reusing resultForRef, the same pattern as
  // the other async backfills) plus slotRequestRef (drops a late response that
  // a subsequent click has superseded).
  const handleSelectSlot = (key: string) => {
    if (key === displayedSlotKey) return;
    const forMatch = matchId;
    // `unsaved` stays set until the slot's content lands (codex re-review):
    // cleared now, the tab would light up over the unsaved text while the
    // read is pending -- and stay so if the read fails, with a repeat click
    // then a no-op.
    setSelectedSlotKey(key);
    slotRequestRef.current = key;
    void bridge()
      .analysis.getCached(matchId, key)
      .then((cached) => {
        if (resultForRef.current !== forMatch) return; // match-switch race
        if (slotRequestRef.current !== key) return; // superseded by a newer click
        if (cached) {
          resultForRef.current = forMatch;
          // Use activeKeyRef (not the activeKey captured in the closure at
          // click time) to decide whether the content just fetched is the
          // active slot -- during the await, activeKey state may have been
          // refreshed by a concurrent onDone; the ref guarantees the latest
          // value.
          resultOwnerRef.current =
            key === activeKeyRef.current ? "active" : "other";
          setResult(cached as AnalysisResult);
          setUnsaved(false);
          setState("done");
          setDisplayEmpty(null);
        } else {
          // Review I-2: this slot's cache is missing (e.g. an old slot judged
          // stale after a prompt version bump). selectedSlotKey already moved
          // to this slot above, so the tab highlight tracks instantly; doing
          // nothing here would leave `result` on the previous slot's content
          // and the panel would show a torn "new highlight + old content"
          // state, looking like the click did nothing. We do not clear result
          // (keeping the previous slot's underlying state so clicking back to
          // it restores instantly without another IPC round-trip) -- we only
          // flip this flag and let the render layer swap the result area for a
          // placeholder note.
          setUnsaved(false);
          setDisplayEmpty("stale");
        }
      })
      .catch(() => {});
  };

  // Split button "analyze with another model" (Task 4).
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  // null = not probed yet; after probing it is a backend->path map (the three
  // local CLI backends only).
  const [cliDetected, setCliDetected] = useState<Partial<
    Record<AiBackend, string | null>
  > | null>(null);
  // The probe fires one concurrent round the first time the menu opens and is
  // cached in component state (never re-probed within a session).
  const cliProbeStartedRef = useRef(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const probeCliOnce = () => {
    if (cliProbeStartedRef.current) return;
    cliProbeStartedRef.current = true;
    const cliBackends = Object.keys(BACKEND_CLI_TOOL) as AiBackend[];
    void Promise.all(
      cliBackends.map(async (b) => {
        try {
          const r = await bridge().ai?.detectCli?.(b);
          return [b, r?.path ?? null] as const;
        } catch {
          return [b, null] as const; // stub / env without the ai facet: treat as not detected
        }
      }),
    ).then((pairs) => setCliDetected(Object.fromEntries(pairs)));
  };

  // Esc / click-outside closes the menu (a11y basics).
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(e.target as Node)
      ) {
        setModelMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [modelMenuOpen]);

  // Backend availability: the three local CLI backends follow the probe result
  // (treated as unavailable until the probe finishes; the async setCliDetected
  // backfill causes one extra render right as the menu opens, which is
  // expected); anthropic/deepseek follow the settings sentinel's truthiness
  // (per the brief: truthy is enough, no comparison against the REDACTED
  // constant -- a real key and a masked string are both non-empty strings).
  const isBackendAvailable = (b: AiBackend): boolean => {
    const cliTool = BACKEND_CLI_TOOL[b];
    if (cliTool) return !!cliDetected && cliDetected[b] != null;
    if (b === "anthropic") return !!aiSettings?.anthropicApiKey;
    if (b === "deepseek") return !!aiSettings?.deepseekApiKey;
    return false;
  };

  // Is *any* backend usable? Drives the demo offer (UI review #7). CLI
  // backends are probed lazily by the split menu; kick the probe once the
  // settings are in so a CLI user is not offered the demo spuriously.
  const anyBackend = AI_BACKENDS.some(isBackendAvailable);
  useEffect(() => {
    if (aiSettings) probeCliOnce();
  }, [aiSettings]);

  const defaultBackend: AiBackend = aiSettings?.aiBackend ?? "anthropic";
  const defaultModel = resolveAiModel({
    aiBackend: aiSettings?.aiBackend,
    aiModels: aiSettings?.aiModels,
  });

  const runAnalyze = async (backendOverride?: {
    backend: AiBackend;
    model: string;
  }) => {
    if (!input) return;
    setDemo(false);
    setError("");
    setPreview("");
    setState("running");
    setRetrying(false);
    setReviewing(false);
    // 与 main 侧 run() 的 backend/model 决策同构(override 优先,否则
    // settings 默认);重挂载后会被 getState 的 runningMeta(单源)覆盖回填
    setRunMeta({
      since: Date.now(),
      backend: backendOverride?.backend ?? defaultBackend,
      model: backendOverride?.model ?? defaultModel,
    });
    onRunAll?.(); // one click also runs the cohort comparison
    await bridge().analysis.run(
      backendOverride ? { ...input, backendOverride } : input,
    );
  };

  // Both entry points close the menu before dispatching (a concurrency hole
  // found in agy flash review): clicking the primary button while the menu is
  // open runs the default analysis, and if the menu is not closed its items
  // remain clickable -- the user can click a menu item after the default
  // analysis has already gone running, and the main-side nextGen lets the
  // later request bump the generation and abort the first one mid-flight
  // (burning a round of tokens for nothing). Close it synchronously here (in
  // the same event-loop turn as setState("running")) rather than relying on
  // the "disable the whole split while running" disabled attribute -- that
  // only blocks "click the arrow to open a new menu", not "the menu is already
  // open and the button has not re-rendered as disabled yet".
  const handleAnalyze = () => {
    setModelMenuOpen(false);
    void runAnalyze();
  };

  const handleSelectModel = (backend: AiBackend, model: string) => {
    setModelMenuOpen(false);
    void runAnalyze({ backend, model });
  };

  // Spec §6.13: the shown result came from the other language's cache (main
  // reads it back only when the current language has no hit). On it the card
  // offers one action -- re-analyze in the current language -- and nothing
  // that acts on the content (deep dive, model picker, slot tabs, export,
  // follow-up flags; the parent hides coach chat and span analysis).
  const contentLang: Language = result?.contentLang ?? lang;
  const fallback = result != null && contentLang !== lang;
  useEffect(() => {
    onFallbackContent?.(fallback);
  }, [fallback, onFallbackContent]);

  const buttonText =
    state === "running"
      ? t("report.common.analyzing")
      : fallback
        ? t("report.contentLang.reanalyze")
        : state === "done"
          ? t("report.ai.reanalyze")
          : t("report.view.ai");

  return (
    <div className="rpt-ai-panel">
      {/* Action row on top (1g): primary button + status text + export at the
          right end (the language toggle moved to Settings, spec §6.12).
          Before any analysis (no result) the primary button is a prominent
          centered CTA; once results exist it falls back to a compact row. */}
      <div
        className={`rpt-ai-actions rpt-ai-actions-top${
          result ? "" : " rpt-ai-actions-hero"
        }`}
      >
        <div className="rpt-ai-split" ref={modelMenuRef}>
          <button
            className="rpt-ai-primary"
            onClick={handleAnalyze}
            disabled={!input || state === "running"}
          >
            {inputPending ? t("report.ai.preparing") : buttonText}
          </button>
          {!fallback && (
            <>
              <button
                className="rpt-ai-split-arrow"
                data-testid="analysis-model-picker"
                aria-label={t("report.ai.pickModel")}
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                // Disabled by run state only (per the brief: "disable the whole
                // split while running"); do not also gate on !input -- browsing
                // "which models are available" does not require input to be ready,
                // and when an analysis is actually dispatched runAnalyze still
                // short-circuits on !input (same guard as the primary button, a
                // double safeguard).
                disabled={state === "running"}
                onClick={() => {
                  if (!modelMenuOpen) probeCliOnce();
                  setModelMenuOpen((o) => !o);
                }}
              >
                ▾
              </button>
              {modelMenuOpen && (
                <div
                  className="rpt-ai-model-menu"
                  data-testid="analysis-model-menu"
                  role="menu"
                >
                  {AI_BACKENDS.filter(isBackendAvailable).map((b) => (
                    <div key={b} className="rpt-ai-model-group" role="group">
                      {AI_MODELS[b].map((m) => {
                        const isDefault =
                          b === defaultBackend && m.id === defaultModel;
                        return (
                          <button
                            key={m.id}
                            role="menuitem"
                            onClick={() => handleSelectModel(b, m.id)}
                          >
                            {slotLabel(`${b}:${m.id}`, lang)}
                            {isDefault ? t("report.ai.default") : ""}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {!result && state === "idle" && !anyBackend && !demo && (
          <button
            type="button"
            className="rpt-btn"
            data-testid="ai-demo-btn"
            title={t("report.ai.demoTitle")}
            onClick={() => setDemo(true)}
          >
            {t("report.ai.demoBtn")}
          </button>
        )}
        {/* Status + Export follow the placeholder state, not the underlying
            `result` (GH #38 residual, archive #10 final-review handoff):
            while an invalidated slot is selected, `result` still holds the
            *previous* slot's content (kept so clicking back is free), so
            reading it here would say "已缓存 · N findings" and export the
            other slot's findings under this slot's tab. */}
        {result && displayEmpty === "stale" && (
          <span className="rpt-ai-status" data-testid="ai-status">
            {t("report.ai.staleSlot")}
          </span>
        )}
        {result && displayEmpty !== "stale" && (
          <span className="rpt-ai-status" data-testid="ai-status">
            {t("report.ai.cached", { n: result.findings.length })}
            {result.findings[0]?.severity
              ? t("report.ai.maxSeverity", {
                  sev: severityLabel(result.findings[0].severity, lang),
                })
              : ""}
          </span>
        )}
        {result && displayEmpty !== "stale" && (
          <ContentLangBadge contentLang={contentLang} />
        )}
        {result && displayEmpty !== "stale" && !fallback && (
          <span className="rpt-ai-export">
            <ExportButtons
              findings={result.findings}
              heroText={t("report.ai.heroFindings", {
                n: result.findings.length,
              })}
            />
          </span>
        )}
      </div>
      {goals.length > 0 && (
        <div className="rpt-ai-goals" data-testid="ai-goals">
          <span className="rpt-ai-goals-title">{t("report.ai.goals")}</span>
          {goals.map((g) => (
            <span
              key={g.category}
              className="rpt-ai-goal"
              data-content-lang={
                g.lastTitle && g.lastLang && g.lastLang !== lang
                  ? g.lastLang
                  : undefined
              }
            >
              ↻{g.recurring} {categoryLabel(g.category, lang)}
              {g.lastTitle
                ? t("report.ai.goalLast", { title: g.lastTitle })
                : ""}
              {g.lastTitle && g.lastLang && (
                <ContentLangBadge contentLang={g.lastLang} />
              )}
            </span>
          ))}
        </div>
      )}
      {error && <div className="rpt-ai-error">{error}</div>}

      {demo && !result && (
        <div className="rpt-ai-body rpt-ai-demo">
          <div
            className="rpt-ai-demo-banner"
            data-testid="ai-demo-banner"
            role="note"
          >
            <span>{t("report.ai.demoBanner")}</span>
            <button
              type="button"
              className="rpt-btn"
              onClick={() => setDemo(false)}
            >
              {t("report.common.close")}
            </button>
          </div>
          {/* No onJump / onJumpT / onInspect: the chips point at events that
              do not exist in this match. */}
          <FindingsList
            findings={
              (lang === "en" ? DEMO_ANALYSIS_EN : DEMO_ANALYSIS).findings
            }
            onSelect={() => {}}
            lang={lang}
            rich={rich}
          />
        </div>
      )}

      {result && (
        <div
          className="rpt-ai-body"
          // Marks the other-language region (spec §6.13): its text is stored
          // AI output, shown as-is under the language label.
          data-content-lang={fallback ? contentLang : undefined}
        >
          {/* Multi-model slot tab bar (Task 3): only appears with >=2 slots, so
              single-model users see no change at all. */}
          {slots.length >= 2 && !fallback && (
            <div className="rpt-slot-tabs" data-testid="analysis-slot-tabs">
              {slots.map((slot) => (
                <button
                  key={slot.key}
                  className={slot.key === displayedSlotKey ? "active" : ""}
                  onClick={() => handleSelectSlot(slot.key)}
                >
                  {slotLabel(slot.key, lang)}
                  {slot.stale && (
                    <span className="rpt-slot-stale">
                      {t("report.ai.staleTag")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {displayEmpty !== "stale" &&
            (() => {
              const note = selfReviewNote(result, lang);
              return note ? (
                <p
                  className="rpt-self-review-note"
                  data-testid="self-review-note"
                >
                  {note}
                </p>
              ) : null;
            })()}
          {displayEmpty === "stale" ? (
            // Review I-2: getCached returned null for the selected slot (e.g.
            // the slot was invalidated by a prompt upgrade) -- say so honestly
            // instead of silently falling back to the previous slot's content
            // (which would look like the click did nothing, or worse, like
            // these are the new slot's own findings). `result` itself is not
            // cleared, it is just not rendered here.
            <p className="rpt-slot-stale-note" data-testid="slot-stale-note">
              {t("report.ai.staleNote")}
            </p>
          ) : result.hadNarration === false ? (
            <div>
              <KeyMomentAxis
                moments={keyMoments}
                findings={[]}
                candidates={input?.candidates ?? []}
                onSeek={onSeekEvent}
                onSelectEvidence={setActiveEventIds}
                lang={lang}
                habitOf={habitOf}
                rich={rich}
              />
              <p
                data-testid="zero-finding-reason"
                style={{
                  color: "var(--mute)",
                  fontSize: "12px",
                  marginBottom: "12px",
                }}
              >
                {zeroFindingText(result, lang)}
              </p>
              <FindingsList
                findings={[]}
                onSelect={setActiveEventIds}
                lang={lang}
                habitOf={habitOf}
                rich={rich}
              />
            </div>
          ) : (
            <>
              <KeyMomentAxis
                moments={keyMoments}
                findings={splitFindings.timed}
                candidates={input?.candidates ?? []}
                onSeek={onSeekEvent}
                onSelectEvidence={setActiveEventIds}
                flags={flags}
                onFlag={fallback ? undefined : handleFlag}
                lang={lang}
                habitOf={habitOf}
                rich={rich}
              />
              {splitFindings.wholeRound.length > 0 && (
                <>
                  <h4 className="rpt-axis-wholeround-label">
                    {t("report.ai.wholeRound")}
                  </h4>
                  <FindingsList
                    findings={splitFindings.wholeRound}
                    onSelect={setActiveEventIds}
                    onJump={onSeekEvent ? handleJump : undefined}
                    onJumpT={onSeekEvent}
                    onInspect={onInspectEvents}
                    candidates={input?.candidates ?? []}
                    flags={flags}
                    onFlag={fallback ? undefined : handleFlag}
                    lang={lang}
                    habitOf={habitOf}
                    rich={rich}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}

      {state === "running" && (
        // 状态行:计时 + 实际后端/模型 + CLI 假流式说明 + 重试标注。CLI 后端
        // 全程无 delta,这一行是用户唯一的「没卡死」证据;API 后端另有下面的
        // preview 流式预览,这行只补计时。
        <p
          className="rpt-ai-none"
          data-testid="analysis-running-status"
          style={{ color: "var(--ink-2)", fontSize: "12px", marginTop: "8px" }}
        >
          {[
            runMeta?.backend && runMeta?.model
              ? t("report.ai.runningWith", {
                  model: backendModelLabel(
                    runMeta.backend,
                    runMeta.model,
                    lang,
                  ),
                })
              : t("report.ai.running"),
            elapsedS != null
              ? t("report.pro.elapsed", { t: fmtElapsed(elapsedS) })
              : null,
            cliWaitHint(runMeta?.backend, lang),
          ]
            .filter(Boolean)
            .join(" · ")}
          {retrying && (
            <>
              <br />
              {t("report.ai.retrying")}
            </>
          )}
          {reviewing && (
            <>
              <br />
              {t("report.ai.reviewing")}
            </>
          )}
        </p>
      )}
      {state === "running" && preview && (
        <pre className="rpt-ai-preview" data-testid="ai-preview">
          {preview}
        </pre>
      )}
    </div>
  );
}
