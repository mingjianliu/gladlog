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
  type ReferenceCorpus,
  type VerifiedComparison,
} from "@gladlog/analysis";
import {
  PROMPT_VERSION,
  resolveAiClient,
  type AiBackend,
  type AnthropicLike,
} from "./ai";

const N_FLOOR = 30;

export type CompareInput = {
  matchId: string;
  healerMetrics: Record<string, number | null>;
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
    const cellMeta = {
      spec: cell.spec,
      bracket: cell.bracket,
      archetype: cell.archetype,
      buildGroup: cell.buildGroup,
      sampleN: cell.sampleN,
      fellBackTo,
    };
    const settings = deps.getSettings();

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
        max_tokens: 1024,
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
      const check = claimChecker(raw, vc.facts);
      if (!check.ok)
        finish(null, `claimChecker: ${check.violations.join("; ")}`);
      else finish(interpolate(raw, vc.facts), null);
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
        return doc.result as CompareResult;
      } catch {
        return null;
      }
    },
  };
}
