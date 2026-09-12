import { recordAiDebug } from "./aiDebugLog";
import { resolveAiModel, type AiModelSelection } from "../shared/aiModels";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
// Deliberately bypassing the @gladlog/analysis barrel (the rationale is in the
// comment at the top of analysis.ts): the top-level-await data modules would all
// be dragged into main through index.ts, and none of them are used here.
import {
  assignBuildGroup,
  lookupCell,
  REFERENCE_CELL_N_FLOOR,
} from "@gladlog/analysis/src/compare/cellLookup";
import {
  verifiedComparison,
  type VerifiedComparison,
} from "@gladlog/analysis/src/compare/verifiedComparison";
import {
  buildExemplarLedPrompt,
  buildRetryPrompt,
  COMPARE_PROMPT_VERSION,
} from "@gladlog/analysis/src/compare/buildExemplarLedPrompt";
import {
  interpolate,
  claimChecker,
} from "@gladlog/analysis/src/compare/claimChecker";
import { verdictLabel } from "@gladlog/analysis/src/compare/metricLabels";
import type { ReferenceCorpus } from "@gladlog/analysis/src/compare/corpusTypes";
import {
  buildCoachSystemPrompt,
  resolveAiClient,
  type AiBackend,
  type AiLanguage,
  type AnthropicLike,
} from "./ai";

export type CompareInput = {
  matchId: string;
  healerMetrics: Record<string, number | null>;
  /** P2: the enemy comp signature (enemyCompSignature); when it hits a comp
   *  cell the comparison gets more situational. */
  enemyComp?: string;
  spec: string;
  talents: number[];
  /** #37 缺口二: hero-tree group, computed RENDERER-side via heroBuildGroupOf
   * — the 3.2MB talent map must stay out of the main bundle. */
  heroGroup?: string;
  bracket: string;
  archetype: string;
  wowBuild: string;
  /** 本次是「对比自动补跑」触发的(打开有分析、无对比的对局时 renderer 自动
   * 发起),不是用户点按钮。只影响 running 状态的解释文案;住 main 是为了
   * 重挂载后不丢(agy review #2)。 */
  autoTriggered?: boolean;
};
export type CompareResult = {
  verifiedComparison: VerifiedComparison;
  report: string | null;
  droppedReason: string | null;
  cellMeta: {
    spec: string;
    bracket: string;
    archetype: string;
    buildGroup: string;
    sampleN: number;
    fellBackTo: string;
  } | null;
};

/**
 * 哪些对比结论可以进磁盘缓存(`compare.json`)。判据一句话:
 * **结论只取决于(语料 + 本场输入)的才可缓存;取决于设置/环境的一律不缓存。**
 *
 * 生产反馈 GH #27(2026-08-22)里这条判据两侧都做反了:
 * - `NO_COHORT`(语料里没有这场的参照格子)明明只取决于语料+输入,却「故意不
 *   写盘」,只活在进程内存的 `states` Map 里。升级/重启一次内存就没了,而
 *   renderer 的自动补跑(打开「有分析、无对比」的对局就跑一次)于是每次重启
 *   后都再跑一遍 —— 用户看到的就是「升完级已经分析过的对局又被重新分析」。
 * - `NO_API_KEY` 只反映当时的设置,却**会**写盘:写下之后即使把 key 配好,
 *   `getCached` 照样命中这份「没有 key」的结论,面板被永久钉死(renderer 的
 *   自动补跑判据是 `result !== null`,也不会救场)。缓存键(corpusVersion /
 *   COMPARE_PROMPT_VERSION / language)里没有任何一项与 key、后端有关,所以
 *   它只能靠「不进缓存」来修。
 *
 * 读侧也用这个谓词,是为了**自愈存量**:老版本已经写在用户盘上的
 * `NO_API_KEY` 缓存必须判为未命中,否则只修写侧对存量用户等于没修。
 *
 * 留在缓存里的边界情况:`claimChecker:` 开头的解说被拒 —— 它虽然与模型输出
 * 有关,但那是一次**跑完了**的对比(实测表 `verifiedComparison` 完整可用),
 * 不缓存就意味着每次重启后为同一场再烧一次模型调用,代价方向反了。
 */
const UNCACHEABLE_DROPPED_REASONS = new Set(["NO_API_KEY"]);
export function isCacheableCompareResult(result: CompareResult): boolean {
  return !(
    result.droppedReason &&
    UNCACHEABLE_DROPPED_REASONS.has(result.droppedReason)
  );
}

/**
 * Pullable comparison state (added 2026-08-02). Until now compare had exactly
 * two exits — the push events (gladlog:compare:done/error) and the compare.json
 * file cache — and both leak. Unmounting the AI tab (switching to report /
 * replay / events / video, and likewise changing shuffle rounds) leaves nobody
 * listening for `done`, and IPC events are not queued or replayed. Worse, the
 * NO_COHORT and compare:error terminal states are **never written to disk** at
 * all, and even finish()'s write is best-effort. Net result: a comparison that
 * already finished disappears for good once the user switches tabs and comes
 * back — and the renderer's runSignal guard means it will not re-run by itself.
 * This was the only root cause that survived adversarial verification of the
 * user's "the cohort panel sometimes doesn't show up" report.
 * Same shape as the neighbouring analysis.getState: main keeps the terminal
 * state, the renderer pulls it on mount and falls back to the file cache.
 *
 * 2026-08-22 / GH #27 更新:`NO_COHORT` 已按 isCacheableCompareResult 落盘,
 * 所以它不再依赖这个内存态跨重启存活;`compare:error` 仍然只在内存里 ——
 * 报错多是环境/瞬时的(CLI 超时、语料没载到),固化到盘上等于把一次超时变成
 * 永久结论。因此 getState 依旧内存优先、磁盘兜底。
 */
export type CompareState =
  | { phase: "idle" }
  /** startedAt(2026-08-05 生产反馈):CLI 后端整段返回、无中途 delta,跑一次
   * 是分钟级;renderer 靠这个时间戳在重挂载后仍能显示真实已耗时,证明
   * 「在跑」而不是「卡死」。autoTriggered 见 CompareInput。 */
  | { phase: "running"; startedAt: number; autoTriggered: boolean }
  | { phase: "done"; result: CompareResult }
  | { phase: "error"; message: string };

const major = (v: string) => v.split(".").slice(0, 2).join(".");

export type CompareService = ReturnType<typeof createCompareService>;

export function createCompareService(deps: {
  getSettings: () => {
    anthropicApiKey: string | null;
    aiModels?: AiModelSelection | null;
    wowDirectory: string | null;
    aiBackend?: AiBackend;
    aiBackendCommand?: string | null;
    aiLanguage?: AiLanguage;
  };
  clientFactory?: (key: string) => AnthropicLike;
  loadCorpus: () => ReferenceCorpus | null;
  gameBuild: () => string;
  matchesDir: string;
  emit: (channel: string, payload: unknown) => void;
}) {
  /**
   * The generation counter is bucketed **per matchId** (fixed 2026-08-02). It
   * used to be one counter for the whole service, so "match A's comparison is
   * still in flight and the user switches to match B and hits analyze again"
   * made A's run hit a generation mismatch and bail with a bare return — no
   * done, no error, no compare.json — leaving A's cohort panel blank forever
   * with no trace of why. A local CLI backend takes minutes per call
   * (TIMEOUT_MS=300s in localAiBackends), so that overlap window is wide; this
   * is one of the causes behind the user's "sometimes it doesn't show up".
   * Semantics: a re-run of the *same* match still supersedes the previous one
   * (the new result overwrites it, and we must not emit two `done`s); different
   * matches never interfere. Entries are never deleted — the count has to grow
   * monotonically per matchId, otherwise "B finishes and clears it, C starts
   * back at 1" would collide with an A (gen 1) that is still in flight.
   */
  const generations = new Map<string, number>();
  /** Terminal comparison states known to this process (see CompareState). */
  const states = new Map<string, CompareState>();

  /** Record the terminal state + emit, as one exit — miss a spot here and that
   * is one more result that can never be pulled back. */
  const emitDone = (matchId: string, result: CompareResult) => {
    states.set(matchId, { phase: "done", result });
    deps.emit("gladlog:compare:done", { matchId, result });
  };
  const emitError = (matchId: string, message: string) => {
    states.set(matchId, { phase: "error", message });
    deps.emit("gladlog:compare:error", { matchId, message });
  };

  async function run(input: CompareInput): Promise<void> {
    const myGen = (generations.get(input.matchId) ?? 0) + 1;
    generations.set(input.matchId, myGen);
    const superseded = () => generations.get(input.matchId) !== myGen;
    states.set(input.matchId, {
      phase: "running",
      startedAt: Date.now(),
      autoTriggered: input.autoTriggered === true,
    });
    try {
      await runInner(input, superseded);
    } catch (err) {
      // Superseded by a later run of the same match: stay silent (that run
      // emits and records its own state).
      if (superseded()) return;
      emitError(
        input.matchId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * The whole body runs inside the caller's try (fixed 2026-08-02). Only the
   * LLM call used to be guarded; the first half
   * (loadCorpus→lookupCell→verifiedComparison→resolveAiClient) ran bare, so
   * anything thrown there rejected the IPC invoke, leaving the renderer with an
   * unhandled rejection, the panel stuck on "running" and no error copy at all
   * — indistinguishable from "the panel didn't show up".
   */
  async function runInner(
    input: CompareInput,
    superseded: () => boolean,
  ): Promise<void> {
    const corpus = deps.loadCorpus();
    if (!corpus) {
      // 环境缺件(没装/没载到语料),不是这场对局的结论 → 不落盘,重启后重试。
      emitError(input.matchId, "NO_CORPUS");
      return;
    }
    const settings = deps.getSettings();
    const lang: AiLanguage = settings.aiLanguage ?? "zh";
    /** 磁盘缓存的唯一写入口(读侧是 getCached,判据共用
     *  isCacheableCompareResult)。best-effort:写不进去也还有内存终态兜着。 */
    const writeCache = (result: CompareResult) => {
      if (!isCacheableCompareResult(result)) return;
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, "compare.json.tmp");
        writeFileSync(
          tmp,
          JSON.stringify({
            schemaVersion: 1,
            corpusVersion: corpus.wowPatchVersion,
            // The cohort comparison's own prompt version — NOT the findings
            // PROMPT_VERSION (see COMPARE_PROMPT_VERSION's doc comment)
            promptVersion: COMPARE_PROMPT_VERSION,
            language: lang,
            createdAt: Date.now(),
            result,
          }),
          "utf-8",
        );
        renameSync(tmp, join(dir, "compare.json"));
      } catch {
        /* cache write best-effort — the in-memory terminal state still covers us */
      }
    };

    // fail-open build-group assignment
    const decl = corpus.buildGroups[input.spec];
    const staleCorpus =
      major(corpus.wowPatchVersion) !== major(deps.gameBuild());
    let buildGroup = "*";
    // #37 缺口二 + 用户裁定 2026-09-11: hero tree FIRST, keystone gate as the
    // fallback for loadouts whose hero tree cannot be resolved. Precedence must
    // match the corpus builder exactly (perMatchRecord.combatToRecords) — the
    // two sides key the same cell, so a disagreement here is a silent miss.
    if (!staleCorpus && input.heroGroup && input.heroGroup !== "*")
      buildGroup = input.heroGroup;
    if (buildGroup === "*" && decl && !staleCorpus)
      buildGroup = assignBuildGroup(input.talents, decl);

    const { cell, fellBackTo } = lookupCell(
      corpus,
      {
        spec: input.spec,
        bracket: input.bracket,
        archetype: input.archetype,
        buildGroup,
        enemyComp: input.enemyComp,
      },
      REFERENCE_CELL_N_FLOOR,
    );
    if (!cell) {
      const result: CompareResult = {
        verifiedComparison: { dims: [], facts: {} },
        report: null,
        droppedReason: "NO_COHORT",
        cellMeta: null,
      };
      // 结论完全由(语料 + 本场输入)决定 → 可缓存,落盘。
      // 2026-08-22 之前这里「故意不写盘」,理由是重算很便宜;但便宜的是 CPU,
      // 贵的是它把「已经算过、算不出来」这件事只存在内存里:重启一次就退回
      // 未知,renderer 的自动补跑于是每次重启后重跑一遍(GH #27)。
      writeCache(result);
      emitDone(input.matchId, result);
      return;
    }

    const vc = verifiedComparison(input.healerMetrics, cell);
    // P2 comp cell: attach the median duration and the first-kill distribution
    // (facts for the LLM to cite, cellMeta for the UI)
    let firstKillTop: { spec: string; pct: number } | null = null;
    if (cell.firstKill) {
      const entries = Object.entries(cell.firstKill).sort(
        (a, b) => b[1] - a[1],
      );
      const total = entries.reduce((sum, [, n]) => sum + n, 0);
      if (entries.length > 0 && total > 0) {
        firstKillTop = {
          spec: entries[0][0],
          pct: Math.round((100 * entries[0][1]) / total),
        };
      }
    }
    if (cell.enemyComp) {
      vc.facts["cohort.enemyComp"] = cell.enemyComp;
      if (cell.durationS)
        vc.facts["cohort.durationP50"] = String(Math.round(cell.durationS.p50));
      if (firstKillTop)
        vc.facts["cohort.firstKillTop"] =
          `${firstKillTop.spec} (${firstKillTop.pct}%)`;
    }
    const cellMeta = {
      spec: cell.spec,
      bracket: cell.bracket,
      archetype: cell.archetype,
      buildGroup: cell.buildGroup,
      enemyComp: cell.enemyComp ?? null,
      durationP50: cell.durationS ? Math.round(cell.durationS.p50) : null,
      firstKillTop,
      sampleN: cell.sampleN,
      fellBackTo,
    };
    const finish = (report: string | null, droppedReason: string | null) => {
      const result: CompareResult = {
        verifiedComparison: vc,
        report,
        droppedReason,
        cellMeta,
      };
      writeCache(result);
      emitDone(input.matchId, result);
    };

    if (vc.dims.length === 0) {
      finish(null, "NO_DIMS");
      return;
    }
    const client = resolveAiClient(settings, deps.clientFactory);
    if (!client) {
      finish(null, "NO_API_KEY");
      return;
    }

    const prompt = buildExemplarLedPrompt(vc, cell, input.spec);
    /** One attempt: stream, optionally forwarding deltas to the renderer.
     * Returns null when superseded (caller must bail silently). The retry
     * attempt does NOT stream deltas — the renderer has already shown the
     * first draft's text, and interleaving a second stream into the same
     * accumulator would render garbage; `done` replaces the whole text. */
    const attempt = async (
      p: string,
      emitDeltas: boolean,
    ): Promise<string | null> => {
      let raw = "";
      const stream = client.stream({
        model: resolveAiModel(settings),
        max_tokens: 1500,
        // The commentary language follows the coach reply-language setting
        // (the system prompt used to be missed here, so it was always English)
        system: buildCoachSystemPrompt(lang),
        messages: [{ role: "user", content: p }],
      });
      for await (const ev of stream) {
        if (superseded()) return null;
        if (ev.delta) {
          raw += ev.delta;
          if (emitDeltas)
            deps.emit("gladlog:compare:delta", {
              matchId: input.matchId,
              text: interpolate(ev.delta, vc.facts),
            });
        }
      }
      if (superseded()) return null;
      recordAiDebug({
        kind: "compare",
        matchId: input.matchId,
        at: Date.now(),
        model: resolveAiModel(settings),
        prompt: p,
        raw,
      });
      return raw;
    };
    let raw = await attempt(prompt, true);
    if (raw == null) return;
    let check = claimChecker(raw, vc.facts);
    if (!check.ok) {
      // One repair round with the violations fed back (2026-08-12 probe:
      // 27/36 narrations died at this gate; the residual class the scrubbed
      // prompt can't prevent is model-authored numbers, which the retry
      // reliably reaches). Still hard-fail after the second strike — the gate
      // itself is never loosened.
      raw = await attempt(
        buildRetryPrompt(prompt, raw, check.violations),
        false,
      );
      if (raw == null) return;
      check = claimChecker(raw, vc.facts);
    }
    // For Chinese commentary, verdict placeholders are substituted with the
    // Chinese text (placeholder resolution is still validated against the
    // English facts)
    const displayFacts =
      lang === "zh"
        ? Object.fromEntries(
            Object.entries(vc.facts).map(([k, v]) => [
              k,
              k.endsWith(".verdict") ? verdictLabel(v, "zh") : v,
            ]),
          )
        : vc.facts;
    if (!check.ok) finish(null, `claimChecker: ${check.violations.join("; ")}`);
    else finish(interpolate(raw, displayFacts), null);
  }

  return {
    run,
    async cancel(): Promise<void> {
      // Argument-less cancel (that is the preload signature): bump the
      // generation of every known matchId, so each in-flight run bails quietly
      // at its next superseded() checkpoint.
      for (const [id, g] of generations) generations.set(id, g + 1);
    },
    /**
     * The renderer pulls this on mount and falls back to the file cache when
     * it comes back idle — see CompareState's doc comment. In-memory wins over
     * disk on purpose: a NO_COHORT/error that just happened is not on disk at
     * all, while disk may still hold an older successful cache, so reading disk
     * first would paper over what actually just happened.
     */
    async getState(matchId: string): Promise<CompareState> {
      const live = states.get(matchId);
      if (live) return live;
      const cached = await this.getCached(matchId);
      return cached ? { phase: "done", result: cached } : { phase: "idle" };
    },
    async getCached(matchId: string): Promise<CompareResult | null> {
      const fp = join(deps.matchesDir, matchId, "compare.json");
      if (!existsSync(fp)) return null;
      try {
        const doc = JSON.parse(readFileSync(fp, "utf-8"));
        // Cache key includes corpus version + COMPARE_PROMPT_VERSION: a rebuilt
        // corpus (new patch, new distributions) or a change to the *comparison*
        // prompt invalidates the stored report so we never serve numbers built
        // against old distributions. Note this is COMPARE_PROMPT_VERSION and
        // not the findings PROMPT_VERSION — they have no causal relation, and
        // what coupling them cost is documented on COMPARE_PROMPT_VERSION.
        const corpus = deps.loadCorpus();
        if (corpus && doc.corpusVersion !== corpus.wowPatchVersion) return null;
        if (doc.promptVersion !== COMPARE_PROMPT_VERSION) return null;
        // Language is part of the cache key: change the commentary language
        // and it regenerates (older caches have no language field → invalid)
        const lang = deps.getSettings().aiLanguage ?? "zh";
        if (doc.language !== lang) return null;
        const result = doc.result as CompareResult;
        // 读写同谓词:老版本写下的 NO_API_KEY 缓存(结论只反映当时的设置)在
        // 这里判为未命中,面板才能在 key 配好后重新跑 —— 修写侧对存量无效。
        if (!isCacheableCompareResult(result)) return null;
        return result;
      } catch {
        return null;
      }
    },
  };
}
