import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
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

    // deterministic fallback: no narration, just the candidate count as empty findings
    const fallback = () =>
      finish({ findings: [], dropped: 0, hadNarration: false });

    if (input.candidates.length === 0) return fallback();
    const client = resolveAiClient(settings, deps.clientFactory);
    if (!client) return fallback();

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
        if (ev.delta) raw += ev.delta;
      }
      if (myGen !== generation) return;

      let parsed: RawFinding[];
      try {
        parsed = JSON.parse(raw.trim());
        if (!Array.isArray(parsed)) throw new Error("not an array");
      } catch {
        return fallback(); // invalid JSON → deterministic
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
