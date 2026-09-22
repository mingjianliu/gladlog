import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { randomUUID } from "crypto";
import { recordAiDebug } from "./aiDebugLog";
// Deliberately bypassing the @gladlog/analysis barrel: index.ts drags the
// top-level awaits for spellNames (12MB) / talentIdMap (1.6MB) into main's
// module graph -- top-level await defeats tree-shaking, so main pays 13.6MB
// of disk reads + ~40MB of resident heap for nothing. deepDive is the only
// entry point that genuinely needs those two tables (via
// utils -> spellEffectData/talents), so its value import moved into
// deepenInner as an on-demand `await import`; only the type stays here.
import type {
  AuditDropInfo,
  DeepDivePack,
  DeepDiveResult,
} from "@gladlog/analysis/src/analysis/deepDive";
import { findingKey } from "../shared/findingKey";
import { normalizeFindingCategory } from "@gladlog/analysis/src/analysis/findingCategories";
import { parseModelJsonArray } from "@gladlog/analysis/src/analysis/parseModelJson";
import {
  AI_BACKENDS,
  isCliAiBackend,
  resolveAiModel,
  type AiModelSelection,
} from "../shared/aiModels";
import { join } from "path";
import { buildFindingsPrompt } from "@gladlog/analysis/src/analysis/buildFindingsPrompt";
import { auditFindings } from "@gladlog/analysis/src/analysis/auditFindings";
import type {
  CandidateEvent,
  Finding,
  RawFinding,
} from "@gladlog/analysis/src/analysis/types";
import {
  analysisCachePath,
  resolveActiveSlot,
  slotKeyOf,
  splitSlotKey,
  toSlottedDoc,
  upsertSlot,
  type AnalysisCacheDocV2,
  type AnalysisSlot,
} from "../shared/analysisCache";
import {
  buildCoachSystemPrompt,
  PROMPT_VERSION,
  resolveAiClient,
  type AiBackend,
  type AiLanguage,
  type AnthropicLike,
} from "./ai";

export type AnalysisInput = {
  matchId: string;
  candidates: CandidateEvent[];
  richContext: string;
  spec: string;
  /** Spec ids of every player on both teams (auditFindings roster lint);
   * optional so older callers/scripts keep working without it. */
  rosterSpecs?: string[];
  /** Multi-model comparison (spec 2026-08-01): explicitly pick which
   * backend/model this run uses, ignoring the current selection saved in
   * settings. Persisted into a slot keyed by slotKeyOf(backend, model); it
   * never overwrites an older slot. */
  backendOverride?: { backend: AiBackend; model: string };
};
export type AnalysisResult = {
  findings: Finding[];
  dropped: number;
  hadNarration: boolean;
  /** Reason for the deterministic fallback (when hadNarration=false); older
   * caches lack this field. */
  fallbackReason?: "no-candidates" | "no-client" | "bad-json";
  /** Deep-dive round already ran (regardless of how many it produced);
   * renderer uses it to guard against re-triggering. */
  deepened?: boolean;
  /** coach chat (2026-08-02 spec): session id captured by a CLI-backend
   * analysis call, used to resume the chat. Absent for API backends, for a
   * failed capture, and for deterministic fallback results. */
  sessionId?: string;
};
/**
 * Single-source predicate: "which slot should we be reading", derived from
 * settings. getCached/getState use it as the legacySlotKey when lazily
 * migrating old files; it must be computed the same way as the backend/model
 * that resolveAiClient/resolveAiModel actually use (otherwise the read-side
 * and write-side default slot keys silently diverge).
 */
function currentSlotKey(settings: {
  aiBackend?: AiBackend | null;
  aiModels?: AiModelSelection | null;
}): string {
  return slotKeyOf(settings.aiBackend ?? "anthropic", resolveAiModel(settings));
}

/**
 * Read the named slot, or (when slotKey is omitted) the currently active one.
 * Never indexes doc.slots directly -- it reuses resolveActiveSlot as the
 * single judgment: to read a different slot, temporarily swap lastSlotKey for
 * the target key and feed that in, so the actual field access on doc.slots
 * stays in exactly one place, analysisCache.ts (analysisCache.test.ts already
 * uses this pattern).
 */
function resolveSlot<T>(
  doc: AnalysisCacheDocV2<T> | null,
  slotKey?: string,
): AnalysisSlot<T> | null {
  if (!doc) return null;
  return resolveActiveSlot(slotKey ? { ...doc, lastSlotKey: slotKey } : doc);
}

/**
 * Shared read-side entry point for getCached/getState: locate the file
 * (language-keyed + en-only legacy fallback, same source as the write-side
 * analysisCachePath), parse it, and normalize to the v2 shape via
 * toSlottedDoc. legacySlotKey is currentSlotKey(settings) -- an old v1 file
 * has no record of which backend/model produced it, so the best we can do is
 * book it under "whatever the current settings select".
 */
function readSlottedDoc(
  matchesDir: string,
  matchId: string,
  settings: {
    aiLanguage?: AiLanguage;
    aiBackend?: AiBackend | null;
    aiModels?: AiModelSelection | null;
  },
): AnalysisCacheDocV2<AnalysisResult> | null {
  const lang: AiLanguage = settings.aiLanguage ?? "zh";
  let fp = analysisCachePath(matchesDir, matchId, lang);
  if (!existsSync(fp)) {
    // Compatibility: caches written before the language-keyed filenames had
    // no system prompt, so their output is actually English -- fall back to
    // them only when English is requested; a Chinese request treats them as
    // a miss (regenerate).
    const legacy = join(matchesDir, matchId, "analysis-v2.json");
    if (lang !== "en" || !existsSync(legacy)) return null;
    fp = legacy;
  }
  try {
    const raw = JSON.parse(readFileSync(fp, "utf-8"));
    return toSlottedDoc<AnalysisResult>(raw, currentSlotKey(settings));
  } catch {
    return null;
  }
}

export type DeepenInput = {
  matchId: string;
  findings: Finding[];
  packs: DeepDivePack[];
  spec: string;
  ownerName?: string;
};
export type WindowAnalyzeInput = {
  matchId: string;
  fromS: number;
  toS: number;
  pack: DeepDivePack;
  kind: "survival" | "offensive";
  spec: string;
  ownerName?: string;
  /**
   * Review-round fix (#21 item11 addendum): an explicit retry must bypass
   * the cache and hit the model again -- it must not be swallowed by the
   * "same window" cache read. The cache exists so that re-selecting the same
   * window doesn't cost another model call, not so that it can eat a retry
   * the user deliberately clicked. This only affects the cache read (the hit
   * test); the write still happens, under the same windowKey/promptVersion
   * judgment, and the new result overwrites the old one (whether that was
   * "ok" or "empty").
   */
  force?: boolean;
};
/** One deep-dive entry inside a window-analysis "ok" result (window-multi-finding
 * Task 2): `title` is `null` when the model omitted it or the entry came from a
 * pre-Task-2 code path — window mode's auditDeepDives always sets it for a
 * fresh entry, but the type stays nullable rather than required so the
 * renderer's "null → don't render the heading row" branch has a real case to
 * handle instead of an unreachable one. */
export type WindowAnalyzeEntry = {
  title: string | null;
  text: string;
  chips: DeepDiveResult["chips"];
};
export type WindowAnalyzeResult =
  | {
      status: "ok";
      /** Up to 4 entries (auditDeepDives' window-mode cap), audited and ordered
       * independently — see auditDeepDives' `mode: "window"` doc comment. */
      entries: WindowAnalyzeEntry[];
      fromCache: boolean;
    }
  | { status: "audit-empty" } // nothing in the model output passed the audit (or it was empty) -> UI offers retry
  | { status: "no-client" } // no AI configured -> UI points at settings
  | { status: "busy" } // same match + same window already in flight (idempotency guard)
  | { status: "error" }; // network/stream failure (kept separate from audit-empty: that one is "the model answered but failed the audit", this one is "it never answered")

/** Cap on the window-analysis cache (#16): beyond it, evict the oldest by
 * `at` (write timestamp) to prevent unbounded growth over a long session
 * (a single match can have arbitrarily many windows selected). */
const WINDOW_CACHE_MAX = 20;

type WindowCacheEntry = {
  fromS: number;
  toS: number;
  /**
   * #21 item11: the model honestly returning an empty result (nothing passed
   * the audit) is also a terminal state and is worth caching -- an omitted
   * field means "ok" (backward compatible with entries written before this
   * upgrade). When "empty", `entries` is absent; reopening the same window
   * replays audit-empty straight from the cache instead of paying for another
   * model call.
   */
  status?: "ok" | "empty";
  /** Window-multi-finding Task 2: was a single `text`/`chips` pair, now a list
   * (up to 4, see auditDeepDives' `mode: "window"`). Old on-disk entries never
   * have this field -- they carry the pre-Task-2 `text`/`chips` shape instead
   * -- but PROMPT_VERSION 18 makes every one of them miss on read (see the
   * version-stamp check in analyzeWindow), so no migration code reads that old
   * shape back; it is simply never hit again and ages out via the LRU. */
  entries?: WindowAnalyzeEntry[];
  at: number;
  /** Important audit fix (#16, missing version stamp): stamped at write time so a later
   * PROMPT_VERSION bump doesn't let a stale entry serve forever. Stamped
   * per-entry (not per-file) because one windowAnalysis.<lang>.json holds
   * many independent windows — file-level stamping would nuke every entry
   * in the file on any bump instead of just letting the touched ones churn
   * naturally, which is needlessly destructive for a file that's already
   * an LRU of unrelated windows. `windowKey` already carries `backend:model`
   * (see analyzeWindow), so both cache-invalidation judgments — version drift
   * and backend/model switch — are already covered by the existing key
   * discipline; the empty-terminal-state entry reuses that same windowKey
   * unchanged, no new discipline needed. */
  promptVersion: number;
};

/**
 * Read-modify-write of the window cache (LRU eviction + atomic tmp+rename
 * replace). #21 item11 pulled this out of analyzeWindow's success branch so
 * the audit-empty terminal state can reuse the same logic instead of a copy
 * -- both call sites must "re-read the newest snapshot, then upsert" to avoid
 * cross-window lost updates (see the existing comment inside analyzeWindow
 * below).
 */
function upsertWindowCache(
  matchesDir: string,
  matchId: string,
  path: string,
  windowKey: string,
  entry: WindowCacheEntry,
): void {
  let latest: Record<string, WindowCacheEntry> = {};
  try {
    latest = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    /* first write, or the file was cleared */
  }
  latest[windowKey] = entry;
  const keys = Object.keys(latest);
  if (keys.length > WINDOW_CACHE_MAX) {
    const evict = keys
      .sort((a, b) => latest[a]!.at - latest[b]!.at)
      .slice(0, keys.length - WINDOW_CACHE_MAX);
    for (const k of evict) delete latest[k];
  }
  mkdirSync(join(matchesDir, matchId), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(latest), "utf-8");
  renameSync(tmp, path);
}

export function createAnalysisService(deps: {
  getSettings: () => {
    anthropicApiKey: string | null;
    aiModels?: AiModelSelection | null;
    wowDirectory: string | null;
    aiBackend?: AiBackend;
    aiBackendCommand?: string | null;
    aiLanguage?: AiLanguage;
  };
  clientFactory?: (key: string) => AnthropicLike;
  matchesDir: string;
  emit: (channel: string, payload: unknown) => void;
  /** Learning-ledger write point (spec §1): invoked when the model actually
   * ran, or on a clean match (no-candidates); no-client/bad-json do not count
   * as analyzed. The receiver absorbs failures -- this is fire-and-forget. */
  onFindings?: (e: {
    matchId: string;
    findings: Finding[];
    candidates: CandidateEvent[];
  }) => void;
}) {
  // Generation counters bucketed by matchId: one per match. The old
  // implementation used a single global counter, so any new run/deepen (e.g.
  // opening match B, or deep-diving B) would ++ it, making match A's
  // in-flight analysis judge itself stale, abort, and never write its cache
  // -- that is exactly the root of "looking at another match threw away the
  // previous analysis".
  const generations = new Map<string, number>();
  const nextGen = (matchId: string) => {
    const g = (generations.get(matchId) ?? 0) + 1;
    generations.set(matchId, g);
    return g;
  };
  const isCurrent = (matchId: string, gen: number) =>
    generations.get(matchId) === gen;

  // matchId currently running a first-round analysis -> the run generation
  // that owns it. The renderer queries this on remount (tab switch / coming
  // back to a match); if a run is live it shows "analyzing…" instead of the
  // idle state, so the user doesn't assume it was lost and click again.
  // We store the generation rather than a bare set: cleanup asks "am I the
  // owner of this running entry", not "is my generation the newest" --
  // otherwise deepen would ++ the generation, the run it superseded would
  // judge itself non-newest on abort and skip cleanup, and `running` would
  // leak forever (found in review: switching to a language with no cache got
  // stuck in the analyzing state).
  const running = new Map<string, number>();
  /**
   * 在跑一轮的展示元数据(2026-08-05 生产反馈):CLI 后端整段返回、无中途
   * delta,一次调用分钟级;renderer 重挂载后靠 getState 里的这份 meta 显示
   * 「哪个后端/模型在跑、已跑多久」,证明在跑而非卡死。backend/model 记的是
   * 本轮实际生效值(含 backendOverride),不能让 renderer 用 settings 现值
   * 反推——split 按钮临时换后端时两者会岔开。
   */
  const runningMeta = new Map<
    string,
    // retrying(agy review #1):重试标注若只活在 renderer,本轮重挂载后计时
    // 还在涨、翻倍的解释却没了——所以随 meta 住在 main。
    { since: number; backend: AiBackend; model: string; retrying: boolean }
  >();

  /** matchIds currently deep-diving -- the idempotency guard, see deepen. */
  const deepening = new Set<string>();

  /** In-flight window analyses (#16), keyed `${matchId}:${windowKey}`. A
   * window analysis is a single request/response and never races run/deepen
   * for the analysis-v2 cache, so it needs no generation counter -- this Set
   * alone is the idempotency guard, and a repeat trigger for the same match +
   * window is answered with busy. */
  const windowInFlight = new Set<string>();

  /**
   * Reclaim this match's generation entry. If generations only ever grew, a
   * long session would keep one entry per matchId ever viewed (tiny, but
   * there is no reason to keep them).
   *
   * Only reclaim when the match is fully quiet (no run, no deepen in flight)
   * -- otherwise the in-flight round would see generations.get() become
   * undefined, isCurrent would go false, and it would abort mid-way believing
   * itself stale, throwing away an analysis for nothing.
   */
  const reapGeneration = (matchId: string) => {
    if (!running.has(matchId) && !deepening.has(matchId))
      generations.delete(matchId);
  };

  async function run(input: AnalysisInput): Promise<void> {
    const myGen = nextGen(input.matchId);
    running.set(input.matchId, myGen);
    const clearRunning = () => {
      // Only clear when this running entry is still mine (not taken over by a
      // later run). deepen never touches `running`, so a run superseded by a
      // deepen still finds itself here -> clears normally, no leak.
      if (running.get(input.matchId) === myGen) {
        running.delete(input.matchId);
        // meta 与 running 同生命周期同守卫:被后来轮接管时不能删掉新轮的 meta
        runningMeta.delete(input.matchId);
      }
      reapGeneration(input.matchId);
    };
    const settings = deps.getSettings();
    const lang: AiLanguage = settings.aiLanguage ?? "zh";
    // Multi-model comparison (spec 2026-08-01): when backendOverride is
    // present the whole call chain (client resolution, the model value
    // actually sent, the persisted slot key) must switch with it. All three
    // must come from one source, or the "key says one thing, the run does
    // another" predicate splits again (see the same note at the top of
    // analyzeWindow).
    const backend: AiBackend =
      input.backendOverride?.backend ?? settings.aiBackend ?? "anthropic";
    const model = input.backendOverride?.model ?? resolveAiModel(settings);
    const slotKey = slotKeyOf(backend, model);
    runningMeta.set(input.matchId, {
      since: Date.now(),
      backend,
      model,
      retrying: false,
    });

    const finish = (result: AnalysisResult, record = false) => {
      clearRunning();
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        // Slotted persistence (multi-model comparison): one matchId+lang file
        // holds several slots keyed by slotKeyOf(backend, model), none
        // overwriting another -- this closes the "key doesn't include
        // backend/model" gap left behind by the #16 window-cache fix above.
        //
        // legacySlotKey, review-round fix: it must be the backend:model of the
        // *current settings* (ignoring backendOverride) -- i.e.
        // currentSlotKey(settings) -- not the slotKey we are about to write.
        // Why: with slotKey, overriding to a backend that never ran before
        // would make toSlottedDoc temporarily hang the old v1 analysis under
        // the override key, and the upsertSlot right below would then
        // overwrite that very key with the new result -- the v1 content
        // vanishes into thin air. With currentSlotKey(settings), a normal
        // non-overridden rerun has legacySlotKey identical to slotKey anyway
        // (still the correct "overwrite the same key" semantics); only when
        // overriding to another backend/model do the migration target and the
        // write target diverge, and the result is that the v1 content stays
        // in the settings-default slot while the new result goes into the
        // override slot alone.
        const target = analysisCachePath(deps.matchesDir, input.matchId, lang);
        let raw: unknown = null;
        try {
          raw = JSON.parse(readFileSync(target, "utf-8"));
        } catch {
          /* first write, or corrupt file: treat as "no existing document" */
        }
        const doc = upsertSlot(
          toSlottedDoc<AnalysisResult>(raw, currentSlotKey(settings)),
          lang,
          slotKey,
          result,
        );
        const tmp = `${target}.tmp`;
        writeFileSync(tmp, JSON.stringify(doc), "utf-8");
        renameSync(tmp, target);
      } catch {
        /* best-effort */
      }
      // slotKey rides along on the done event (Task 4 handoff item): the slot
      // this run just wrote is exactly the lastSlotKey upsertSlot has just
      // set -- the renderer's onDone uses it as a defensive cross-check (it
      // should match the activeKey its own getState refresh returns), not as
      // the sole basis for the owner judgment (see the onDone comment in
      // StructuredAnalysisPanel.tsx).
      deps.emit("gladlog:analysis:done", {
        matchId: input.matchId,
        result,
        slotKey,
      });
      if (record) {
        try {
          deps.onFindings?.({
            matchId: input.matchId,
            findings: result.findings,
            candidates: input.candidates,
          });
        } catch {
          /* a failed ledger write must not affect the main analysis flow */
        }
      }
    };

    // deterministic fallback: no narration; `reason` lets the UI explain why
    // (so a 0-finding result is accountable)
    const fallback = (reason: "no-candidates" | "no-client" | "bad-json") =>
      finish(
        {
          findings: [],
          dropped: 0,
          hadNarration: false,
          fallbackReason: reason,
        },
        reason === "no-candidates",
      );

    if (input.candidates.length === 0) return fallback("no-candidates");
    // Fold the override into a single snapshot: resolveAiClient looks only at
    // this synthesized settings object and never re-inspects backendOverride
    // -- that avoids the "client decides one way, model decides another"
    // divergence.
    const client = resolveAiClient(
      {
        ...settings,
        aiBackend: backend,
        aiModels: { ...settings.aiModels, [backend]: model },
      },
      deps.clientFactory,
    );
    if (!client) return fallback("no-client");

    try {
      const prompt = buildFindingsPrompt(
        input.candidates,
        input.richContext,
        input.spec,
      );
      // coach chat (2026-08-02 spec): only CLI backends (claudeCli/agy/codex)
      // capture a session id; API backends (anthropic/deepseek) don't pass
      // these two stream parameters.
      // Single-source predicate (final review F3): the judgment comes from
      // CLI_AI_BACKENDS in shared/aiModels.ts, the same constant coachChat.ts
      // gates on.
      const isCliBackend = isCliAiBackend(backend);
      // One call + parse; `attempt` is stamped into the debug panel so
      // retries are distinguishable
      const callOnce = async (attempt: number) => {
        let raw = "";
        let capturedSession: string | undefined;
        // claudeCli gets a fresh UUID per attempt: seeding the same hint
        // twice collides with an already-existing session, so the bad-json
        // retry round must use a new one and cannot reuse attempt 1's id.
        const sessionIdHint =
          backend === "claudeCli" ? randomUUID() : undefined;
        const stream = client.stream({
          model,
          // 4-8 findings (widened 2026-07-24) plus their explanations; 4096
          // was sized for 3-5 and hit truncation in production -> whole
          // response fell back as bad-json.
          max_tokens: 8192,
          system: buildCoachSystemPrompt(lang),
          messages: [{ role: "user", content: prompt }],
          ...(isCliBackend && backend !== "claudeCli"
            ? { captureSession: true }
            : {}),
          ...(sessionIdHint ? { sessionIdHint } : {}),
        });
        for await (const ev of stream) {
          if (!isCurrent(input.matchId, myGen)) return null;
          if (ev.sessionId) capturedSession = ev.sessionId;
          if (ev.delta) {
            raw += ev.delta;
            // Retry rounds emit no deltas: the renderer preview stream is
            // append-only, so attempt 1's debris concatenated with attempt 2
            // renders as garbage (agy review F4).
            if (attempt === 1)
              deps.emit("gladlog:analysis:delta", {
                matchId: input.matchId,
                text: ev.delta,
              });
          }
        }
        if (!isCurrent(input.matchId, myGen)) return null;
        recordAiDebug({
          kind: "analysis",
          matchId: attempt > 1 ? `${input.matchId}#retry` : input.matchId,
          at: Date.now(),
          model,
          prompt,
          raw,
        });
        // Fence/prose tolerance goes through the shared predicate
        // (parseModelJson): claude -p is observed to wrap perfectly valid
        // content in a ```json fence, and the old zero-tolerance
        // JSON.parse(raw.trim()) misjudged an entire good analysis as
        // bad-json. Truncation and a top-level object still return null ->
        // fail per contract.
        return {
          parsed: parseModelJsonArray(raw) as RawFinding[] | null,
          capturedSession,
        };
      };

      let call = await callOnce(1);
      if (call === null) {
        clearRunning();
        return;
      }
      // One retry on bad-json: model output is stochastic, so one failure is
      // not a stable failure. Production reports of "format error" were
      // mostly sporadic; a retry cuts the failure rate by roughly half an
      // order of magnitude, and the contract (no rescue for truncation or a
      // top-level object) is unchanged.
      if (!call.parsed) {
        // 重试对用户可见(2026-08-05 生产反馈):CLI 后端单发已是分钟级,静默
        // 重试等于总时长翻倍还毫无解释——renderer 收到后在「分析中」旁标注。
        // meta 同步置位(agy review #1):挂着的面板走事件,重挂载的面板走
        // getState,两条路都要拿得到。世代守卫防写花后来轮的 meta。
        if (running.get(input.matchId) === myGen) {
          const m = runningMeta.get(input.matchId);
          if (m) runningMeta.set(input.matchId, { ...m, retrying: true });
        }
        deps.emit("gladlog:analysis:retry", { matchId: input.matchId });
        call = await callOnce(2);
        if (call === null) {
          clearRunning();
          return;
        }
      }
      const parsed = call.parsed;
      if (!parsed) {
        return fallback("bad-json"); // invalid JSON → deterministic
      }
      const audit = auditFindings(
        parsed,
        input.candidates,
        input.rosterSpecs ? { rosterSpecs: input.rosterSpecs } : {},
      );
      finish(
        {
          findings: audit.findings,
          dropped: audit.dropped.length,
          hadNarration: audit.findings.length > 0,
          ...(call.capturedSession ? { sessionId: call.capturedSession } : {}),
        },
        true,
      );
    } catch (err) {
      if (!isCurrent(input.matchId, myGen)) return;
      clearRunning();
      deps.emit("gladlog:analysis:error", {
        matchId: input.matchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const flagsPath = (matchId: string) =>
    join(deps.matchesDir, matchId, "findingFlags.json");

  /**
   * Deep-dive round (automatic follow-up questions): after the first round's
   * done, the renderer builds a deterministic evidence pack for high-severity
   * findings and calls this. This method runs a second LLM pass, audits via
   * auditDeepDives, merges deepDive into both the cache and the result, and
   * emits done once more. If nothing passes the audit -> silently keep the
   * first round.
   *
   * Idempotency guard: while a deep dive for this match is in flight, repeat
   * calls are dropped. The renderer triggers on `deepened` still being false
   * in the cache, and that flag only lands on disk when this round's
   * writeMerged runs -- so if the user navigates away and back during the
   * tens of seconds a deep dive takes, the panel remount would trigger
   * another round and burn tokens for nothing (the old generation does get
   * aborted by nextGen, but the request was already sent and the money
   * already spent). The guard must live in the main process: doing "check
   * isDeepening, then call" in the renderer is TOCTOU -- two remounts can
   * both read false, and it stops nothing.
   */
  async function deepen(input: DeepenInput): Promise<void> {
    if (deepening.has(input.matchId)) return;
    deepening.add(input.matchId);
    try {
      await deepenInner(input);
    } finally {
      deepening.delete(input.matchId);
      reapGeneration(input.matchId);
    }
  }

  async function deepenInner(input: DeepenInput): Promise<void> {
    const myGen = nextGen(input.matchId);
    const settings = deps.getSettings();
    const lang: AiLanguage = settings.aiLanguage ?? "zh";
    // Path converged onto analysisCachePath (single-source predicate; this
    // used to hand-concatenate the string).
    const cachedPath = analysisCachePath(deps.matchesDir, input.matchId, lang);
    // Review I-1: the deep dive must follow the backend/model of the slot
    // `lastSlotKey` points at, not the global default in settings -- after an
    // overridden round (say agy:flash), an automatic deep dive still hitting
    // the global default backend/model would write one model's output into
    // another model's override slot, breaking slot isolation (spec §1:
    // deepDive lives per-model inside its own slot). We read the existing
    // document once with legacySlotKey="legacy:unknown" just to get
    // lastSlotKey -- writeMerged below re-reads independently (it still needs
    // a "newest right before commit" snapshot to avoid cross-round lost
    // updates); this is only borrowing the same data early to decide "which
    // slot do we follow this time", and does not change writeMerged's
    // existing read/write rhythm.
    let preRaw: unknown = null;
    try {
      preRaw = JSON.parse(readFileSync(cachedPath, "utf-8"));
    } catch {
      /* no cache: no slot to follow, use the settings default (same as the
         behavior before this change) */
    }
    const preDoc = toSlottedDoc<AnalysisResult>(preRaw, "legacy:unknown");
    const targetSplit = preDoc ? splitSlotKey(preDoc.lastSlotKey) : null;
    let backend: AiBackend = settings.aiBackend ?? "anthropic";
    let slotModel: string | undefined;
    if (targetSplit) {
      if ((AI_BACKENDS as readonly string[]).includes(targetSplit.backend)) {
        backend = targetSplit.backend as AiBackend;
        slotModel = targetSplit.model;
      } else {
        // The slot key parses, but its backend segment is not a known
        // AiBackend (hand-edited config, the "legacy:unknown" placeholder
        // left by v1 lazy migration, etc.) -- don't push an unknown string
        // into resolveAiClient; fall back to the settings default backend and
        // leave a trace for debugging.
        console.warn(
          `[analysis] deepen: 槽 "${preDoc!.lastSlotKey}" 的后端 "${targetSplit.backend}" 不是已知 AiBackend,回退到 settings 默认后端`,
        );
      }
    }
    // Same technique as run()'s backendOverride snapshot (see the matching
    // comment inside run() above): resolveAiClient and resolveAiModel see
    // only this one synthesized settings object, so the backend the client
    // uses, the model actually sent, and the backend/model the result is
    // written back under all come from one source -- no "client decides one
    // way, model decides another" divergence allowed.
    const mergedSettings = {
      ...settings,
      aiBackend: backend,
      aiModels: {
        ...settings.aiModels,
        [backend]: slotModel ?? settings.aiModels?.[backend],
      },
    };
    const model = resolveAiModel(mergedSettings);
    const client = resolveAiClient(mergedSettings, deps.clientFactory);
    // No client / no pack: mark deepened to prevent re-triggering, content
    // stays at the first round.
    // A deep dive belongs to the most recent analysis (spec decision): it
    // only modifies the slot lastSlotKey points at; other slots (historical
    // results left by multi-model comparison) are untouched. legacySlotKey is
    // "legacy:unknown" -- if what we read is a not-yet-upgraded v1 file we
    // have no idea which backend/model produced it; the value only exists so
    // it can pass through the single read path of
    // toSlottedDoc/resolveActiveSlot, and is otherwise irrelevant.
    const writeMerged = (findings: Finding[]) => {
      let raw: unknown = null;
      try {
        raw = JSON.parse(readFileSync(cachedPath, "utf-8"));
      } catch {
        /* cache missing/corrupt: fall through to the in-memory fallback below */
      }
      const doc = toSlottedDoc<AnalysisResult>(raw, "legacy:unknown");
      const slot = resolveActiveSlot(doc);
      if (!doc || !slot) {
        deps.emit("gladlog:analysis:done", {
          matchId: input.matchId,
          result: { findings, dropped: 0, hadNarration: true, deepened: true },
        });
        return;
      }
      const merged: AnalysisResult = {
        ...slot.result,
        findings,
        deepened: true,
      };
      try {
        const updated = upsertSlot(
          doc,
          doc.language,
          doc.lastSlotKey,
          merged,
          slot.createdAt, // a deep dive is not a new analysis; don't advance this slot's createdAt
        );
        const tmp = cachedPath + ".tmp";
        writeFileSync(tmp, JSON.stringify(updated), "utf-8");
        renameSync(tmp, cachedPath);
        // slotKey = doc.lastSlotKey: the deep dive only modifies this slot,
        // so it *is* "the slot this round wrote", matching the slotKey
        // semantics of run()'s finish() (see the comment inside run() above).
        deps.emit("gladlog:analysis:done", {
          matchId: input.matchId,
          result: merged,
          slotKey: doc.lastSlotKey,
        });
      } catch {
        // Disk write failed: emit the in-memory result only, **without
        // slotKey** (a misjudgment caught by agy flash review) --
        // `doc.lastSlotKey` here is merely the value from "the old file we
        // read"; this deep dive never actually wrote it back to disk. If we
        // still attached it, the activeKey the renderer refreshes (computed
        // via a different read path and a different legacySlotKey
        // placeholder) would very likely disagree and fire a false
        // "invariant violated" warning -- no write happened, so there is no
        // "slot that was written", and we must not fake one.
        deps.emit("gladlog:analysis:done", {
          matchId: input.matchId,
          result: { findings, dropped: 0, hadNarration: true, deepened: true },
        });
      }
    };
    if (!client || input.packs.length === 0) return writeMerged(input.findings);
    try {
      // On-demand loading: deepDive drags in the two big tables
      // (spellNames/talentIdMap), and a static import would make main pay
      // 13.6MB at startup; a deep dive is a user-triggered LLM flow, so the
      // extra ~50ms on first use is imperceptible. The tables now load in the
      // background (no top-level await), so import resolution no longer
      // guarantees they are ready -- spell names in the prompt must not
      // degrade, so we explicitly await ensure (contract in analysis's
      // data/ensure.ts). ensure is dynamically imported too: it statically
      // references the data modules, and a static import would bring
      // "evaluating the module kicks off loading" back onto main's startup
      // path.
      const [
        {
          buildDeepDivePrompt,
          auditDeepDives,
          buildAuditRepairPrompt,
          shouldAttemptAuditRepair,
        },
        { ensureAnalysisData },
      ] = await Promise.all([
        import("@gladlog/analysis/src/analysis/deepDive"),
        import("@gladlog/analysis/src/data/ensure"),
      ]);
      await ensureAnalysisData();
      const prompt = buildDeepDivePrompt(
        input.packs,
        input.findings,
        input.spec,
        input.ownerName,
      );
      let raw = "";
      // `model` is the one resolved above from the target slot's
      // backend/model (review I-1), not the global default from
      // resolveAiModel(settings) -- the two diverge in the override scenario,
      // and that divergence is what caused this bug.
      const stream = client.stream({
        model,
        // Deep-dive output scales with the finding count (up to 8 × text +
        // chips since 2026-07-24); 2048 was sized for ~3 and would certainly
        // truncate -> the deep dive silently disappears.
        max_tokens: 4096,
        system: buildCoachSystemPrompt(lang),
        messages: [{ role: "user", content: prompt }],
      });
      for await (const ev of stream) {
        if (!isCurrent(input.matchId, myGen)) return;
        if (ev.delta) raw += ev.delta;
      }
      if (!isCurrent(input.matchId, myGen)) return;
      recordAiDebug({
        kind: "analysis",
        matchId: `${input.matchId}#deepdive`,
        at: Date.now(),
        model,
        prompt,
        raw,
      });
      // Same as the findings path: with a fenced response the old code got no
      // array and the deep dive silently vanished (auditDeepDives' internal
      // Array.isArray goes false and returns empty). null -> keep the first
      // round.
      const parsed = parseModelJsonArray(raw);
      const drops: AuditDropInfo[] = [];
      let dives = auditDeepDives(parsed, input.packs, {
        onDrop: (d) => drops.push(d),
      });
      // Audit-repair retry (all-wipeout only, SDD 2026-08-06): the first round
      // audited to zero survivors across every finding while the model DID
      // write entries the audit then dropped -- feed the violations back and
      // give it one shot at a compliant rewrite, rather than silently keeping
      // the un-deepened first round. shouldAttemptAuditRepair is the shared
      // predicate with analyzeWindow below and momentDiveAb.ts's --repair
      // flag (CLAUDE.md shared-predicate rule). Best-effort: any failure here
      // (stale generation, stream error, still-empty after repair) must leave
      // `dives` exactly as the first audit left it -- this optional step must
      // never turn an otherwise-handled round into an error, and must never
      // do worse than not retrying at all.
      if (shouldAttemptAuditRepair(dives.length, drops.length)) {
        try {
          const repairPrompt = buildAuditRepairPrompt(prompt, raw, drops);
          let repairRaw = "";
          const repairStream = client.stream({
            model,
            max_tokens: 4096,
            system: buildCoachSystemPrompt(lang),
            messages: [{ role: "user", content: repairPrompt }],
          });
          for await (const ev of repairStream) {
            if (!isCurrent(input.matchId, myGen)) return;
            if (ev.delta) repairRaw += ev.delta;
          }
          if (!isCurrent(input.matchId, myGen)) return;
          recordAiDebug({
            kind: "analysis",
            matchId: `${input.matchId}#audit-repair`,
            at: Date.now(),
            model,
            prompt: repairPrompt,
            raw: repairRaw,
          });
          const repairDives = auditDeepDives(
            parseModelJsonArray(repairRaw),
            input.packs,
          );
          if (repairDives.length > 0) dives = repairDives;
        } catch {
          /* repair is best-effort; keep the original (empty) audit result */
        }
      }
      const merged = input.findings.map((f, i) => {
        const d = dives.find((x) => x.findingIndex === i);
        return d ? { ...f, deepDive: { text: d.text, chips: d.chips } } : f;
      });
      if (!isCurrent(input.matchId, myGen)) return; // safety: recheck the generation before writing/emitting
      writeMerged(merged);
    } catch {
      if (!isCurrent(input.matchId, myGen)) return;
      writeMerged(input.findings); // a failed deep dive is not fatal; keep the first round
    }
  }

  const windowCachePath = (matchId: string, lang: AiLanguage) =>
    join(deps.matchesDir, matchId, `windowAnalysis.${lang}.json`);

  /**
   * Selected-window analysis (#16 Task 3): the user drags a window on the
   * replay, and each window is one request/response (unlike run/deepen, which
   * are whole-match rounds -- so it takes no part in the generation counter
   * and never invalidates the analysis-v2 cache, nor vice versa). The
   * on-disk cache is one file per matchId+lang, one entry per windowKey, and
   * beyond WINDOW_CACHE_MAX the oldest by write timestamp (at) is evicted.
   */
  async function analyzeWindow(
    input: WindowAnalyzeInput,
  ): Promise<WindowAnalyzeResult> {
    // Read settings once and use that snapshot throughout the function (cache
    // key, client resolution, model resolution) -- the key must come from the
    // same source as the backend/model actually passed to client.stream, or
    // the "key says one thing, the run does another" predicate silently
    // splits again.
    const settings = deps.getSettings();
    const lang: AiLanguage = settings.aiLanguage ?? "zh";
    // Important audit fix (#16, second of three): backend + model are part of
    // the cache key. The original key was just fromS-toS, so after switching
    // backend/model, rerunning the same window silently returned the old
    // backend's answer. The judgment uses the very same
    // resolveAiModel(settings) that run() uses when calling client.stream
    // (single-source predicate), and the backend default mirrors
    // resolveAiModel's internal `?? "anthropic"`. The main analysis-v2 cache
    // (run/deepen) has the same design gap, but we are not touching it today
    // -- see the one-line comment in finish().
    const backend: AiBackend = settings.aiBackend ?? "anthropic";
    const model = resolveAiModel(settings);
    // Important audit fix (#16, third of three): key precision changed from
    // whole-second floor to 0.1s rounding, matching the Timeline's drag
    // precision -- flooring to whole seconds crams two visibly different
    // drags (e.g. 30.2s-60.0s and 30.8s-60.0s) into the same entry, where
    // they evict each other.
    const round1 = (s: number) => Math.round(s * 10) / 10;
    const windowKey = `${backend}:${model}:${round1(input.fromS)}-${round1(input.toS)}`;
    const flight = `${input.matchId}:${windowKey}`;
    if (windowInFlight.has(flight)) return { status: "busy" };
    windowInFlight.add(flight);
    // The catch branch needs to record debug info (prompt/raw), but `prompt`
    // isn't assigned until buildDeepDivePrompt -- if we blow up before the
    // dynamic import / ensureAnalysisData it would still be undefined, so
    // declare it outside the try with an empty-string default rather than
    // letting catch touch an uninitialized variable.
    let prompt = "";
    try {
      const path = windowCachePath(input.matchId, lang);
      let cache: Record<string, WindowCacheEntry> = {};
      try {
        cache = JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        /* first time */
      }
      // Review-round fix (#21 item11 addendum): force=true (an explicit
      // retry) bypasses the cache read -- the hit test is treated as a miss
      // and we fall through to hit the model again; writes (the two
      // upsertWindowCache calls below) are unaffected, and the new result
      // overwrites this windowKey as usual.
      const hit = input.force ? undefined : cache[windowKey];
      // Important audit fix (#16, first of three): version-stamp check -- if
      // prompt generation changed (PROMPT_VERSION bump), old entries must be
      // judged a miss and recomputed rather than serving an old version's
      // answer as a hit forever. Old caches (written before the upgrade, no
      // such field) naturally miss because undefined !== a number, so no
      // extra migration logic is needed.
      if (hit && hit.promptVersion === PROMPT_VERSION) {
        // #21 item11: a hit on the honest-empty terminal state -- don't pay
        // for another model call, just replay the same audit-empty shape,
        // which the renderer already understands.
        if (hit.status === "empty") return { status: "audit-empty" };
        return {
          status: "ok",
          entries: hit.entries!,
          fromCache: true,
        };
      }

      const client = resolveAiClient(settings, deps.clientFactory);
      if (!client) return { status: "no-client" };

      // Dynamic import: same reason as deepenInner (keep the 13.6MB tables
      // out of main's startup module graph)
      const [
        {
          buildDeepDivePrompt,
          auditDeepDives,
          buildWindowAnchorFinding,
          buildAuditRepairPrompt,
          shouldAttemptAuditRepair,
        },
        { ensureAnalysisData },
      ] = await Promise.all([
        import("@gladlog/analysis/src/analysis/deepDive"),
        import("@gladlog/analysis/src/data/ensure"),
      ]);
      await ensureAnalysisData();
      const anchor = buildWindowAnchorFinding(
        input.pack,
        input.fromS,
        input.toS,
        input.kind,
      );
      prompt = buildDeepDivePrompt(
        [input.pack],
        [anchor],
        input.spec,
        input.ownerName,
        "window",
      );
      let raw = "";
      const stream = client.stream({
        model: resolveAiModel(settings),
        // one pack, one segment; deepen's 4096 is sized for 8 findings.
        max_tokens: 2048,
        system: buildCoachSystemPrompt(lang),
        messages: [{ role: "user", content: prompt }],
      });
      for await (const ev of stream) if (ev.delta) raw += ev.delta;
      recordAiDebug({
        kind: "analysis",
        matchId: `${input.matchId}#window:${windowKey}`,
        at: Date.now(),
        model: resolveAiModel(settings),
        prompt,
        raw,
      });
      // window-multi-finding Task 2: mode: "window" is the switch that lets
      // auditDeepDives keep up to 4 entries per findingIndex (default "deepen"
      // caps at 1, matching the old dives.find(...)-first behavior) and
      // additionally requires+validates each entry's `title`. Every entry
      // below shares findingIndex 0 (analyzeWindow always passes exactly one
      // pack/anchor), so filter rather than the old find-first.
      const drops: AuditDropInfo[] = [];
      const dives = auditDeepDives(parseModelJsonArray(raw), [input.pack], {
        mode: "window",
        onDrop: (d) => drops.push(d),
      });
      let found = dives.filter((x) => x.findingIndex === 0);
      // Audit-repair retry (all-wipeout only, SDD 2026-08-06): same predicate
      // as deepenInner -- zero survivors but the model DID write entries the
      // audit dropped. Best-effort, one shot: any failure (stream error,
      // still-empty after repair) must leave `found` exactly as the first
      // audit left it, so the audit-empty branch right below keeps its
      // existing meaning ("nothing usable came out of this round") whether or
      // not a repair was attempted.
      if (shouldAttemptAuditRepair(found.length, drops.length)) {
        try {
          const repairPrompt = buildAuditRepairPrompt(prompt, raw, drops);
          let repairRaw = "";
          const repairStream = client.stream({
            model: resolveAiModel(settings),
            max_tokens: 2048,
            system: buildCoachSystemPrompt(lang),
            messages: [{ role: "user", content: repairPrompt }],
          });
          for await (const ev of repairStream)
            if (ev.delta) repairRaw += ev.delta;
          recordAiDebug({
            kind: "analysis",
            matchId: `${input.matchId}#audit-repair`,
            at: Date.now(),
            model: resolveAiModel(settings),
            prompt: repairPrompt,
            raw: repairRaw,
          });
          const repairDives = auditDeepDives(
            parseModelJsonArray(repairRaw),
            [input.pack],
            { mode: "window" },
          );
          const repairFound = repairDives.filter((x) => x.findingIndex === 0);
          if (repairFound.length > 0) found = repairFound;
        } catch {
          /* repair is best-effort; keep the original (empty) result */
        }
      }
      if (found.length === 0) {
        // #21 item11: the model honestly answering "no signal" is also a
        // terminal state and is worth caching -- headless simulation measured
        // ~22% of runnable windows landing on this path, and not caching
        // means reopening the same window (not clicking retry, just
        // reselecting/opening it) pays for another model call every time.
        // Review-round fix (#21 item11 addendum): this cache entry does not
        // swallow a retry the user explicitly clicked -- WindowAnalysisCard's
        // retry button passes force=true on audit-empty, and the hit test
        // above already bypasses the cache read on input.force, so a retry
        // always hits the model again; the entry written here only protects
        // the "reselect the same window without clicking retry" path.
        upsertWindowCache(deps.matchesDir, input.matchId, path, windowKey, {
          fromS: input.fromS,
          toS: input.toS,
          status: "empty",
          at: Date.now(),
          promptVersion: PROMPT_VERSION,
        });
        return { status: "audit-empty" };
      }

      // Cross-window lost-update fix: the idempotency guard keyed
      // `${matchId}:${windowKey}` only serializes concurrency for the *same*
      // window; different windows of the same match can still reach here
      // concurrently. The readFileSync at the top of the function is for the
      // cache-hit test only and must not double as the write-back base --
      // otherwise both sides hold the same stale snapshot and the later
      // writer's whole-file stringify silently erases the earlier writer's
      // entry. upsertWindowCache re-reads the newest file, upserts its own
      // key onto that newest snapshot, then does LRU eviction and
      // tmp+rename.
      const entries: WindowAnalyzeEntry[] = found.map((d) => ({
        title: d.title ?? null,
        text: d.text,
        chips: d.chips,
      }));
      upsertWindowCache(deps.matchesDir, input.matchId, path, windowKey, {
        fromS: input.fromS,
        toS: input.toS,
        status: "ok",
        entries,
        at: Date.now(),
        promptVersion: PROMPT_VERSION,
      });
      return { status: "ok", entries, fromCache: false };
    } catch (err) {
      // Important fix: the catch-all used to swallow the exception silently,
      // leaving neither prompt nor raw when the stream blew up mid-way, so a
      // failure during a real-machine smoke test was undiagnosable. Record an
      // error entry instead (windowKey gets an #error suffix to keep it apart
      // from normal success records); the debug record itself must not throw
      // -- wrap it in try/catch so a failed record still doesn't affect the
      // main flow's return.
      try {
        recordAiDebug({
          kind: "analysis",
          matchId: `${input.matchId}#window:${windowKey}#error`,
          at: Date.now(),
          model: resolveAiModel(deps.getSettings()),
          prompt,
          raw: String(err),
        });
      } catch {
        /* a failed debug record must not affect the main flow */
      }
      return { status: "error" }; // network/stream failure: retryable, not
      // persisted (distinct from audit-empty: that is "the model answered but
      // failed the audit", this is "it never answered")
    } finally {
      windowInFlight.delete(flight);
    }
  }

  return {
    run,
    deepen,
    analyzeWindow,
    async cancel(matchId?: string): Promise<void> {
      // Targeted cancel (used by batch mode): invalidate only this match's
      // in-flight run/deepen -- the global version would also abort another
      // match the user is manually analyzing (agy flash review F1).
      if (matchId !== undefined) {
        const g = generations.get(matchId);
        if (g !== undefined) generations.set(matchId, g + 1);
        running.delete(matchId);
        runningMeta.delete(matchId); // 与 running 同生命周期(agy review #3:漏删则每个取消过的场泄一个对象)
        return;
      }
      // Cancel everything: +1 to every match's generation, so every running
      // run/deepen loop aborts on its next tick.
      for (const [id, g] of generations) generations.set(id, g + 1);
      running.clear();
      runningMeta.clear();
    },
    /** Whether the first-round analysis is running (queried on renderer
     * remount to show "analyzing…" and prevent a duplicate click). */
    async isRunning(matchId: string): Promise<boolean> {
      return running.has(matchId);
    },
    /** Finding follow-up flags (phase3 #3a). key = category|sorted(eventIds),
     * language-independent. */
    async getFlags(matchId: string): Promise<Record<string, string>> {
      try {
        return JSON.parse(readFileSync(flagsPath(matchId), "utf-8"));
      } catch {
        return {};
      }
    },
    /**
     * Cross-match aggregation (phase3 #3b): scan the findings of every
     * analyzed match and count by category (when both language caches exist,
     * take one, preferring the current lang, so nothing is double-counted),
     * attaching recent instances and flag statistics.
     */
    async aggregate(): Promise<
      Array<{
        category: string;
        count: number;
        recurring: number;
        done: number;
        recent: Array<{
          matchId: string;
          title: string;
          severity: string;
          createdAt: number;
        }>;
      }>
    > {
      const lang: AiLanguage = deps.getSettings().aiLanguage ?? "zh";
      let dirs: string[] = [];
      try {
        dirs = readdirSync(deps.matchesDir).filter(
          (d) => !d.startsWith(".") && !d.startsWith("_"),
        );
      } catch {
        return [];
      }
      const byCategory = new Map<
        string,
        {
          count: number;
          recurring: number;
          done: number;
          recent: Array<{
            matchId: string;
            title: string;
            severity: string;
            createdAt: number;
          }>;
        }
      >();
      for (const dir of dirs) {
        const base = join(deps.matchesDir, dir);
        const candidates = [
          `analysis-v2.${lang}.json`,
          `analysis-v2.${lang === "zh" ? "en" : "zh"}.json`,
          "analysis-v2.json",
        ];
        const file = candidates.find((f) => existsSync(join(base, f)));
        if (!file) continue;
        try {
          const raw = JSON.parse(readFileSync(join(base, file), "utf-8"));
          const doc2 = toSlottedDoc<AnalysisResult>(raw, "legacy:unknown");
          const slot = resolveActiveSlot(doc2);
          if (!slot || slot.promptVersion !== PROMPT_VERSION) continue;
          const findings: Array<{
            category: string;
            title: string;
            severity: string;
            eventIds?: string[];
          }> = slot.result?.findings ?? [];
          let flags: Record<string, string> = {};
          try {
            flags = JSON.parse(
              readFileSync(join(base, "findingFlags.json"), "utf-8"),
            );
          } catch {
            /* no flags */
          }
          let matchId = dir;
          try {
            matchId = JSON.parse(
              readFileSync(join(base, "..", dir, "meta.json"), "utf-8"),
            ).id;
          } catch {
            /* fall back to the directory name */
          }
          for (const f of findings) {
            // The aggregation key is normalized (historical caches from
            // before enumeration, e.g. SURVIVAL and its localized variants,
            // merge into the same slug group); flags are still looked up by
            // the findingKey
            // exactly as archived, with no migration
            const cat = normalizeFindingCategory(f.category);
            const agg = byCategory.get(cat) ?? {
              count: 0,
              recurring: 0,
              done: 0,
              recent: [],
            };
            agg.count++;
            const flag = flags[findingKey(f)];
            if (flag === "recurring") agg.recurring++;
            if (flag === "done") agg.done++;
            agg.recent.push({
              matchId,
              title: f.title,
              severity: f.severity,
              createdAt: slot.createdAt,
            });
            byCategory.set(cat, agg);
          }
        } catch {
          /* skip corrupt files */
        }
      }
      return [...byCategory.entries()]
        .map(([category, a]) => ({
          category,
          count: a.count,
          recurring: a.recurring,
          done: a.done,
          recent: a.recent
            .sort((x, y) => y.createdAt - x.createdAt)
            .slice(0, 3),
        }))
        .sort((a, b) => b.count - a.count);
    },
    /**
     * Mistake notebook (cross-match): findings from every analyzed match,
     * grouped by category; each entry carries the match meta (time / map /
     * win-loss) and its follow-up flag, sorted newest-first within a group.
     */
    async notebook(): Promise<
      Array<{
        category: string;
        count: number;
        recurring: number;
        done: number;
        entries: Array<{
          matchId: string;
          flagKey: string;
          flag: string | null;
          title: string;
          explanation: string;
          severity: string;
          startTime: number;
          zoneId?: string;
          result?: string;
          bracket?: string;
        }>;
      }>
    > {
      const lang: AiLanguage = deps.getSettings().aiLanguage ?? "zh";
      let dirs: string[] = [];
      try {
        dirs = readdirSync(deps.matchesDir).filter(
          (d) => !d.startsWith(".") && !d.startsWith("_"),
        );
      } catch {
        return [];
      }
      type Entry = {
        matchId: string;
        flagKey: string;
        flag: string | null;
        title: string;
        explanation: string;
        severity: string;
        startTime: number;
        zoneId?: string;
        result?: string;
        bracket?: string;
      };
      const byCategory = new Map<string, Entry[]>();
      for (const dir of dirs) {
        const base = join(deps.matchesDir, dir);
        const candidates = [
          `analysis-v2.${lang}.json`,
          `analysis-v2.${lang === "zh" ? "en" : "zh"}.json`,
          "analysis-v2.json",
        ];
        const file = candidates.find((f) => existsSync(join(base, f)));
        if (!file) continue;
        try {
          const raw = JSON.parse(readFileSync(join(base, file), "utf-8"));
          const doc2 = toSlottedDoc<AnalysisResult>(raw, "legacy:unknown");
          const slot = resolveActiveSlot(doc2);
          if (!slot || slot.promptVersion !== PROMPT_VERSION) continue;
          const findings: Array<{
            category: string;
            title: string;
            explanation?: string;
            severity: string;
            eventIds?: string[];
          }> = slot.result?.findings ?? [];
          if (findings.length === 0) continue;
          let flags: Record<string, string> = {};
          try {
            flags = JSON.parse(
              readFileSync(join(base, "findingFlags.json"), "utf-8"),
            );
          } catch {
            /* no flags */
          }
          let meta: {
            id?: string;
            startTime?: number;
            zoneId?: string;
            result?: string;
            bracket?: string;
          } = {};
          try {
            meta = JSON.parse(readFileSync(join(base, "meta.json"), "utf-8"));
          } catch {
            /* fall back to the directory name */
          }
          for (const f of findings) {
            const key = findingKey(f);
            const list = byCategory.get(f.category) ?? [];
            list.push({
              matchId: meta.id ?? dir,
              flagKey: key,
              flag: flags[key] ?? null,
              title: f.title,
              explanation: f.explanation ?? "",
              severity: f.severity,
              startTime: meta.startTime ?? slot.createdAt,
              zoneId: meta.zoneId,
              result: meta.result,
              bracket: meta.bracket,
            });
            byCategory.set(f.category, list);
          }
        } catch {
          /* skip corrupt files */
        }
      }
      return [...byCategory.entries()]
        .map(([category, entries]) => ({
          category,
          count: entries.length,
          recurring: entries.filter((e) => e.flag === "recurring").length,
          done: entries.filter((e) => e.flag === "done").length,
          entries: entries.sort((a, b) => b.startTime - a.startTime),
        }))
        .sort((a, b) => b.count - a.count);
    },
    async setFlag(
      matchId: string,
      key: string,
      flag: "done" | "recurring" | null,
    ): Promise<Record<string, string>> {
      const cur = await this.getFlags(matchId);
      if (flag === null) delete cur[key];
      else cur[key] = flag;
      try {
        mkdirSync(join(deps.matchesDir, matchId), { recursive: true });
        const tmp = flagsPath(matchId) + ".tmp";
        writeFileSync(tmp, JSON.stringify(cur, null, 2), "utf-8");
        renameSync(tmp, flagsPath(matchId));
      } catch {
        /* best-effort */
      }
      return cur;
    },
    /**
     * The **single atomic** query used on panel remount (weekly review P2#5).
     *
     * With two separate IPC calls (getCached -> isRunning), a round that
     * happens to finish between the two awaits falls through the crack: the
     * first read finds the cache not yet on disk -> null, the second finds
     * `running` already cleared -> false, so the panel sits in the idle state
     * while the result is in fact already on disk (the user still sees "click
     * to analyze").
     *
     * Merged into one call, there is no await the renderer can slip into. The
     * order is deliberately running first, cached second: if async ever gets
     * introduced here, the later cached read still catches the round that
     * just finished; the other order would still leak.
     */
    /**
     * Test-only: number of entries in the generation table. Reclamation
     * (reapGeneration) is purely internal state with no other observation
     * surface -- a leak only shows up as slow memory growth, so without
     * exposing this the only guarantee would be reading the code.
     */
    __generationCount(): number {
      return generations.size;
    },
    /**
     * For batch analysis: one disk scan returning the ids of matches that
     * already have a valid cache (current language + PROMPT_VERSION). The hit
     * predicate must be exactly the one getCached uses (single-source
     * predicate) -- so this calls getCached per directory instead of writing
     * a second filename/version judgment. The id comes from meta.json's id,
     * falling back to the directory name (cache directories for non-first
     * shuffle rounds have no meta, and the directory name is the round id).
     */
    async listAnalyzed(): Promise<string[]> {
      let dirs: string[] = [];
      try {
        dirs = readdirSync(deps.matchesDir).filter(
          (d) => !d.startsWith(".") && !d.startsWith("_"),
        );
      } catch {
        return [];
      }
      const out: string[] = [];
      for (const dir of dirs) {
        if (!(await this.getCached(dir))) continue;
        let id = dir;
        try {
          id =
            JSON.parse(
              readFileSync(join(deps.matchesDir, dir, "meta.json"), "utf-8"),
            ).id ?? dir;
        } catch {
          /* no meta: fall back to the directory name */
        }
        out.push(id);
      }
      return out;
    },
    async getState(matchId: string): Promise<{
      cached: AnalysisResult | null;
      running: boolean;
      /** 在跑一轮的起跑时间与实际后端/模型(含 backendOverride)+ 是否已进
       * bad-json 重试轮;不在跑时 null。见 runningMeta 的注释。 */
      runningMeta: {
        since: number;
        backend: AiBackend;
        model: string;
        retrying: boolean;
      } | null;
      /** Multi-model comparison: a summary of every slot for this match
       * (without the result body), ascending by createdAt. */
      slots: Array<{ key: string; createdAt: number; stale: boolean }>;
      /** doc.lastSlotKey; null when there is no document. */
      activeKey: string | null;
    }> {
      const runningNow = running.has(matchId);
      const meta = runningNow ? (runningMeta.get(matchId) ?? null) : null;
      const cached = await this.getCached(matchId);
      const settings = deps.getSettings();
      const doc = readSlottedDoc(deps.matchesDir, matchId, settings);
      if (!doc)
        return {
          cached,
          running: runningNow,
          runningMeta: meta,
          slots: [],
          activeKey: null,
        };
      // Enumerating every slot is a need unique to getState
      // (resolveActiveSlot only yields the active one). doc.slots is a public
      // field of the exported AnalysisCacheDocV2 interface, and what we read
      // here is the shape itself, not a second judgment of "which slot to
      // read" -- that judgment still goes entirely through
      // resolveActiveSlot/toSlottedDoc and is not duplicated here.
      const slots = Object.entries(doc.slots)
        .map(([key, slot]) => ({
          key,
          createdAt: slot.createdAt,
          stale: slot.promptVersion !== PROMPT_VERSION,
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
      return {
        cached,
        running: runningNow,
        runningMeta: meta,
        slots,
        activeKey: doc.lastSlotKey,
      };
    },
    async getCached(
      matchId: string,
      slotKey?: string,
    ): Promise<AnalysisResult | null> {
      const settings = deps.getSettings();
      const doc = readSlottedDoc(deps.matchesDir, matchId, settings);
      const slot = resolveSlot(doc, slotKey);
      if (!slot || slot.promptVersion !== PROMPT_VERSION) return null;
      return slot.result;
    },
  };
}
export type AnalysisService = ReturnType<typeof createAnalysisService>;
