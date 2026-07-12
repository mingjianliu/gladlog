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
import { PROMPT_VERSION, realClientFactory, type AnthropicLike } from "./ai";

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
  };
  clientFactory?: (key: string) => AnthropicLike;
  matchesDir: string;
  emit: (channel: string, payload: unknown) => void;
}) {
  let generation = 0;

  async function run(input: AnalysisInput): Promise<void> {
    const myGen = ++generation;
    const settings = deps.getSettings();

    const finish = (result: AnalysisResult) => {
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = join(dir, "analysis-v2.json.tmp");
        writeFileSync(
          tmp,
          JSON.stringify({
            schemaVersion: 1,
            promptVersion: PROMPT_VERSION,
            createdAt: Date.now(),
            result,
          }),
          "utf-8",
        );
        renameSync(tmp, join(dir, "analysis-v2.json"));
      } catch {
        /* best-effort */
      }
      deps.emit("gladlog:analysis:done", { matchId: input.matchId, result });
    };

    // deterministic fallback: no narration, just the candidate count as empty findings
    const fallback = () =>
      finish({ findings: [], dropped: 0, hadNarration: false });

    if (!settings.anthropicApiKey || input.candidates.length === 0)
      return fallback();

    try {
      const client = deps.clientFactory
        ? deps.clientFactory(settings.anthropicApiKey)
        : realClientFactory(settings.anthropicApiKey);
      const prompt = buildFindingsPrompt(
        input.candidates,
        input.richContext,
        input.spec,
      );
      let raw = "";
      const stream = client.stream({
        model: settings.anthropicModel ?? "claude-sonnet-5",
        max_tokens: 2048,
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

  return {
    run,
    async cancel(): Promise<void> {
      generation++;
    },
    async getCached(matchId: string): Promise<AnalysisResult | null> {
      const fp = join(deps.matchesDir, matchId, "analysis-v2.json");
      if (!existsSync(fp)) return null;
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
