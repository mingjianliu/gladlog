import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { findingKey } from "../shared/findingKey";
import { join } from "path";
import {
  buildFindingsPrompt,
  auditFindings,
  type CandidateEvent,
  type Finding,
  type RawFinding,
} from "@gladlog/analysis";
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
};
export type AnalysisResult = {
  findings: Finding[];
  dropped: number;
  hadNarration: boolean;
  /** 确定性回退的原因(hadNarration=false 时);旧缓存无此字段。 */
  fallbackReason?: "no-candidates" | "no-client" | "bad-json";
};

export function createAnalysisService(deps: {
  getSettings: () => {
    anthropicApiKey: string | null;
    anthropicModel: string | null;
    wowDirectory: string | null;
    aiBackend?: AiBackend;
    aiBackendCommand?: string | null;
    aiLanguage?: AiLanguage;
  };
  clientFactory?: (key: string) => AnthropicLike;
  matchesDir: string;
  emit: (channel: string, payload: unknown) => void;
}) {
  let generation = 0;

  async function run(input: AnalysisInput): Promise<void> {
    const myGen = ++generation;
    const settings = deps.getSettings();
    const lang: AiLanguage = settings.aiLanguage ?? "zh";

    const finish = (result: AnalysisResult) => {
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        // 语言分键缓存(backlog #1 推荐项):两种语言的结果可同时保留
        const tmp = join(dir, `analysis-v2.${lang}.json.tmp`);
        writeFileSync(
          tmp,
          JSON.stringify({
            schemaVersion: 1,
            promptVersion: PROMPT_VERSION,
            language: lang,
            createdAt: Date.now(),
            result,
          }),
          "utf-8",
        );
        renameSync(tmp, join(dir, `analysis-v2.${lang}.json`));
      } catch {
        /* best-effort */
      }
      deps.emit("gladlog:analysis:done", { matchId: input.matchId, result });
    };

    // deterministic fallback: no narration;reason 让 UI 分因显示(0 finding 可解释)
    const fallback = (reason: "no-candidates" | "no-client" | "bad-json") =>
      finish({ findings: [], dropped: 0, hadNarration: false, fallbackReason: reason });

    if (input.candidates.length === 0) return fallback("no-candidates");
    const client = resolveAiClient(settings, deps.clientFactory);
    if (!client) return fallback("no-client");

    try {
      const prompt = buildFindingsPrompt(
        input.candidates,
        input.richContext,
        input.spec,
      );
      let raw = "";
      const stream = client.stream({
        model: settings.anthropicModel ?? "claude-sonnet-5",
        max_tokens: 2048,
        system: buildCoachSystemPrompt(lang),
        messages: [{ role: "user", content: prompt }],
      });
      for await (const ev of stream) {
        if (myGen !== generation) return;
        if (ev.delta) {
          raw += ev.delta;
          deps.emit("gladlog:analysis:delta", {
            matchId: input.matchId,
            text: ev.delta,
          });
        }
      }
      if (myGen !== generation) return;

      let parsed: RawFinding[];
      try {
        parsed = JSON.parse(raw.trim());
        if (!Array.isArray(parsed)) throw new Error("not an array");
      } catch {
        return fallback("bad-json"); // invalid JSON → deterministic
      }
      const audit = auditFindings(parsed, input.candidates);
      finish({
        findings: audit.findings,
        dropped: audit.dropped.length,
        hadNarration: audit.findings.length > 0,
      });
    } catch (err) {
      if (myGen !== generation) return;
      deps.emit("gladlog:analysis:error", {
        matchId: input.matchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const flagsPath = (matchId: string) =>
    join(deps.matchesDir, matchId, "findingFlags.json");

  return {
    run,
    async cancel(): Promise<void> {
      generation++;
    },
    /** finding 跟进标记(phase3 #3a)。key = category|sorted(eventIds),语言无关。 */
    async getFlags(matchId: string): Promise<Record<string, string>> {
      try {
        return JSON.parse(readFileSync(flagsPath(matchId), "utf-8"));
      } catch {
        return {};
      }
    },
    /**
     * 跨场聚合(phase3 #3b):扫全部已分析对局的 findings,按 category 计数
     * (双语言缓存按 lang 优先取一份,不重复计),附最近实例与标记统计。
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
          const doc = JSON.parse(readFileSync(join(base, file), "utf-8"));
          if (doc.promptVersion !== PROMPT_VERSION) continue;
          const findings: Array<{
            category: string;
            title: string;
            severity: string;
            eventIds?: string[];
          }> = doc.result?.findings ?? [];
          let flags: Record<string, string> = {};
          try {
            flags = JSON.parse(
              readFileSync(join(base, "findingFlags.json"), "utf-8"),
            );
          } catch {
            /* 无标记 */
          }
          let matchId = dir;
          try {
            matchId = JSON.parse(
              readFileSync(join(base, "..", dir, "meta.json"), "utf-8"),
            ).id;
          } catch {
            /* 目录名兜底 */
          }
          for (const f of findings) {
            const agg = byCategory.get(f.category) ?? {
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
              createdAt: doc.createdAt ?? 0,
            });
            byCategory.set(f.category, agg);
          }
        } catch {
          /* 坏文件跳过 */
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
    async getCached(matchId: string): Promise<AnalysisResult | null> {
      const lang: AiLanguage = deps.getSettings().aiLanguage ?? "zh";
      let fp = join(deps.matchesDir, matchId, `analysis-v2.${lang}.json`);
      if (!existsSync(fp)) {
        // 兼容:语言分键前的旧缓存没有 system prompt,输出实际是英文 ——
        // 只在请求英文时兜底读取,请求中文时视为未命中(重新生成)。
        const legacy = join(deps.matchesDir, matchId, "analysis-v2.json");
        if (lang !== "en" || !existsSync(legacy)) return null;
        fp = legacy;
      }
      try {
        const doc = JSON.parse(readFileSync(fp, "utf-8"));
        if (doc.promptVersion !== PROMPT_VERSION) return null;
        return doc.result as AnalysisResult;
      } catch {
        return null;
      }
    },
  };
}
export type AnalysisService = ReturnType<typeof createAnalysisService>;
