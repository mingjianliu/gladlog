import { recordAiDebug } from "./aiDebugLog";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import {
  assignBuildGroup,
  lookupCell,
  verifiedComparison,
  buildExemplarLedPrompt,
  interpolate,
  claimChecker,
  verdictLabel,
  type ReferenceCorpus,
  type VerifiedComparison,
} from "@gladlog/analysis";
import {
  buildCoachSystemPrompt,
  PROMPT_VERSION,
  resolveAiClient,
  type AiBackend,
  type AiLanguage,
  type AnthropicLike,
} from "./ai";

const N_FLOOR = 30;

export type CompareInput = {
  matchId: string;
  healerMetrics: Record<string, number | null>;
  /** P2:敌方阵容签名(enemyCompSignature);命中 comp cell 时对比更情境化。 */
  enemyComp?: string;
  spec: string;
  talents: number[];
  bracket: string;
  archetype: string;
  wowBuild: string;
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

const major = (v: string) => v.split(".").slice(0, 2).join(".");

export type CompareService = ReturnType<typeof createCompareService>;

export function createCompareService(deps: {
  getSettings: () => {
    anthropicApiKey: string | null;
    anthropicModel: string | null;
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
  let generation = 0;

  async function run(input: CompareInput): Promise<void> {
    const myGen = ++generation;
    const corpus = deps.loadCorpus();
    if (!corpus) {
      deps.emit("gladlog:compare:error", {
        matchId: input.matchId,
        message: "NO_CORPUS",
      });
      return;
    }

    // fail-open build-group assignment
    const decl = corpus.buildGroups[input.spec];
    const staleCorpus =
      major(corpus.wowPatchVersion) !== major(deps.gameBuild());
    let buildGroup = "*";
    if (decl && !staleCorpus)
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
      N_FLOOR,
    );
    if (!cell) {
      const result: CompareResult = {
        verifiedComparison: { dims: [], facts: {} },
        report: null,
        droppedReason: "NO_COHORT",
        cellMeta: null,
      };
      deps.emit("gladlog:compare:done", { matchId: input.matchId, result });
      return;
    }

    const vc = verifiedComparison(input.healerMetrics, cell);
    // P2 comp cell:附时长中位与先杀分布(facts 供 LLM 引用,cellMeta 供 UI)
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
    const settings = deps.getSettings();
    const lang: AiLanguage = settings.aiLanguage ?? "zh";

    const finish = (report: string | null, droppedReason: string | null) => {
      const result: CompareResult = {
        verifiedComparison: vc,
        report,
        droppedReason,
        cellMeta,
      };
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, "compare.json.tmp");
        writeFileSync(
          tmp,
          JSON.stringify({
            schemaVersion: 1,
            corpusVersion: corpus.wowPatchVersion,
            promptVersion: PROMPT_VERSION,
            language: lang,
            createdAt: Date.now(),
            result,
          }),
          "utf-8",
        );
        renameSync(tmp, join(dir, "compare.json"));
      } catch {
        /* cache write best-effort */
      }
      deps.emit("gladlog:compare:done", { matchId: input.matchId, result });
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

    try {
      const prompt = buildExemplarLedPrompt(vc, cell, input.spec);
      let raw = "";
      const stream = client.stream({
        model: settings.anthropicModel ?? "claude-sonnet-5",
        max_tokens: 1500,
        // 解说语言跟随教练回复语言设置(此前漏了 system,永远英文)
        system: buildCoachSystemPrompt(lang),
        messages: [{ role: "user", content: prompt }],
      });
      for await (const ev of stream) {
        if (myGen !== generation) return;
        if (ev.delta) {
          raw += ev.delta;
          deps.emit("gladlog:compare:delta", {
            matchId: input.matchId,
            text: interpolate(ev.delta, vc.facts),
          });
        }
      }
      if (myGen !== generation) return;
      recordAiDebug({
        kind: "compare",
        matchId: input.matchId,
        at: Date.now(),
        model: settings.anthropicModel ?? "claude-sonnet-5",
        prompt,
        raw,
      });
      // 中文解说时:判词占位符替换为中文(占位解析仍按英文 facts 校验)
      const displayFacts =
        lang === "zh"
          ? Object.fromEntries(
              Object.entries(vc.facts).map(([k, v]) => [
                k,
                k.endsWith(".verdict") ? verdictLabel(v, "zh") : v,
              ]),
            )
          : vc.facts;
      const check = claimChecker(raw, vc.facts);
      if (!check.ok)
        finish(null, `claimChecker: ${check.violations.join("; ")}`);
      else finish(interpolate(raw, displayFacts), null);
    } catch (err) {
      if (myGen !== generation) return;
      deps.emit("gladlog:compare:error", {
        matchId: input.matchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    run,
    async cancel(): Promise<void> {
      generation++;
    },
    async getCached(matchId: string): Promise<CompareResult | null> {
      const fp = join(deps.matchesDir, matchId, "compare.json");
      if (!existsSync(fp)) return null;
      try {
        const doc = JSON.parse(readFileSync(fp, "utf-8"));
        // Cache key includes corpus version + PROMPT_VERSION: a rebuilt corpus
        // (new patch, new distributions) or a prompt bump invalidates the stored
        // report so we never serve numbers built against old distributions.
        const corpus = deps.loadCorpus();
        if (corpus && doc.corpusVersion !== corpus.wowPatchVersion) return null;
        if (doc.promptVersion !== PROMPT_VERSION) return null;
        // 语言分键:解说语言换了就重新生成(旧缓存无 language 字段 → 失效)
        const lang = deps.getSettings().aiLanguage ?? "zh";
        if (doc.language !== lang) return null;
        return doc.result as CompareResult;
      } catch {
        return null;
      }
    },
  };
}
