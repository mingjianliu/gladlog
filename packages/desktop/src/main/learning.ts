/**
 * Cross-match learning service (spec §3/§5): ledger → deterministic
 * patternScan filtering → AI distillation (with placeholder-discipline audit)
 * → rules.json. The deterministic part of consolidation (stats/status) is
 * ALWAYS persisted; a failure in the AI text only affects description/advice,
 * which is lazily filled in on a later round — learning state never rolls back
 * because the model misbehaved.
 */
import { normalizeFindingCategory } from "@gladlog/analysis/src/analysis/findingCategories";
import { parseModelJsonArray } from "@gladlog/analysis/src/analysis/parseModelJson";
import type {
  CandidateEvent,
  Finding,
} from "@gladlog/analysis/src/analysis/types";
import {
  auditDistilledRules,
  buildDistillPrompt,
} from "@gladlog/analysis/src/learning/distillRules";
import {
  measureGroup,
  nextRuleStatus,
  PATTERN_MIN_HITS,
  scanPatterns,
} from "@gladlog/analysis/src/learning/patternScan";
import type {
  LearnedRule,
  LedgerRun,
  RulesDoc,
  StablePattern,
} from "@gladlog/analysis/src/learning/types";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { join } from "path";

import { type AiModelSelection,resolveAiModel } from "../shared/aiModels";
import { resolveActiveSlot, toSlottedDoc } from "../shared/analysisCache";
import {
  type AiBackend,
  type AiLanguage,
  type AnthropicLike,
  buildCoachSystemPrompt,
  PROMPT_VERSION,
  resolveAiClient,
} from "./ai";
import { API_MAX_TOKENS } from "./aiBudgets";
import { recordAiDebug } from "./aiDebugLog";
import { createLearningLedger } from "./learningLedger";

/** Auto-consolidate once the ledger has grown by at least this many matches
 * since the last consolidation (spec §5). */
export const CONSOLIDATE_EVERY_MATCHES = 10;

export interface LearningState {
  backfill: { running: boolean; scanned: number; total: number } | null;
  consolidating: boolean;
  ledgerMatches: number;
  badLines: number;
  lastConsolidatedAt: number | null;
}

export function createLearningService(deps: {
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
  learningDir: string;
  emit: (channel: string, payload: unknown) => void;
}) {
  const ledger = createLearningLedger(deps.learningDir);
  const rulesPath = join(deps.learningDir, "rules.json");
  const backfillMarker = join(deps.learningDir, "backfill-done.json");

  let consolidating = false;
  let backfill: { running: boolean; scanned: number; total: number } | null =
    null;

  const readRulesDoc = (): RulesDoc | null => {
    try {
      const doc = JSON.parse(readFileSync(rulesPath, "utf-8")) as RulesDoc;
      return doc.schemaVersion === 1 ? doc : null;
    } catch {
      return null;
    }
  };
  const writeRulesDoc = (doc: RulesDoc): void => {
    mkdirSync(deps.learningDir, { recursive: true });
    const tmp = `${rulesPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc), "utf-8");
    renameSync(tmp, rulesPath);
  };

  /** Mint a ledger row from meta.json + findings/candidates. Returns null when
   * meta is missing (without startTime the row cannot be ordered into a
   * window; better to omit it than to record it wrong). */
  const buildRun = (
    matchId: string,
    findings: Array<Pick<Finding, "category" | "severity" | "eventIds">>,
    typeOf: (eventId: string) => string | undefined,
    createdAt: number,
    promptVersion: number,
  ): LedgerRun | null => {
    let meta: {
      id?: string;
      startTime?: number;
      result?: string;
      zoneId?: string;
      bracket?: string;
      teams?: Array<Array<{ specId: number }>>;
    };
    try {
      meta = JSON.parse(
        readFileSync(join(deps.matchesDir, matchId, "meta.json"), "utf-8"),
      );
    } catch {
      return null;
    }
    if (typeof meta.startTime !== "number") return null;
    return {
      v: 1,
      matchId: meta.id ?? matchId,
      startTime: meta.startTime,
      win: String(meta.result ?? "")
        .toLowerCase()
        .startsWith("win"),
      zoneId: meta.zoneId,
      bracket: meta.bracket,
      enemySpecs: (meta.teams?.[1] ?? [])
        .map((t) => t.specId)
        .filter((s) => typeof s === "number" && s > 0),
      promptVersion,
      createdAt,
      findings: findings.map((f) => ({
        category: normalizeFindingCategory(f.category),
        severity: f.severity,
        eventTypes: [
          ...new Set(
            (f.eventIds ?? []).map(typeOf).filter((t): t is string => !!t),
          ),
        ].sort(),
      })),
    };
  };

  const maybeAutoConsolidate = (): void => {
    const { matches } = ledger.read();
    const prev = readRulesDoc();
    const due = prev
      ? matches.length - prev.ledgerMatches >= CONSOLIDATE_EVERY_MATCHES
      : matches.length >= PATTERN_MIN_HITS && existsSync(backfillMarker);
    if (due) void consolidate();
  };

  /** Distillation examples: pull explanation texts for that category out of
   * the analysis cache of the evidence matches (<=3 of them). */
  const collectExamples = (
    rules: LearnedRule[],
    lang: AiLanguage,
  ): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const r of rules) {
      const texts: string[] = [];
      for (const matchId of r.evidence) {
        if (texts.length >= 3) break;
        const base = join(deps.matchesDir, matchId);
        const file = [
          `analysis-v2.${lang}.json`,
          `analysis-v2.${lang === "zh" ? "en" : "zh"}.json`,
          "analysis-v2.json",
        ].find((f) => existsSync(join(base, f)));
        if (!file) continue;
        try {
          const raw = JSON.parse(readFileSync(join(base, file), "utf-8"));
          // Preserve the original version-gate semantics: collectExamples
          // never checked promptVersion to begin with; only the read path
          // changes (doc.result → the result of the lastSlotKey slot under
          // slotted reads).
          const doc2 = toSlottedDoc<{
            findings?: Array<{ category: string; explanation?: string }>;
          }>(raw, "legacy:unknown");
          const slot = resolveActiveSlot(doc2);
          const findings: Array<{ category: string; explanation?: string }> =
            slot?.result?.findings ?? [];
          for (const f of findings) {
            if (texts.length >= 3) break;
            if (
              normalizeFindingCategory(f.category) === r.category &&
              f.explanation
            )
              texts.push(f.explanation);
          }
        } catch {
          /* skip bad caches: examples are a bonus, not a hard dependency */
        }
      }
      out[r.ruleId] = texts;
    }
    return out;
  };

  async function consolidate(): Promise<void> {
    if (consolidating) return;
    consolidating = true;
    try {
      const { matches } = ledger.read();
      const patterns = scanPatterns(matches);
      const prev = readRulesDoc();
      const byId = new Map<string, LearnedRule>(
        (prev?.rules ?? []).map((r) => [r.ruleId, r]),
      );
      for (const p of patterns) {
        if (!byId.has(p.patternId))
          byId.set(p.patternId, {
            ruleId: p.patternId,
            status: "active",
            category: p.category,
            eventTypes: p.eventTypes,
            condition: p.condition,
            stats: {
              windowMatches: p.windowMatches,
              hits: p.hits,
              firstSeen: p.firstSeen,
              lastSeen: p.lastSeen,
              trend: p.trend,
            },
            description: {},
            advice: {},
            evidence: p.exampleMatchIds,
            distilledAt: 0,
            distillModel: "",
          });
      }
      // Deterministic part: recompute stats for every rule (including old
      // ones) against the current ledger, plus retire/revive
      for (const r of byId.values()) {
        const g = measureGroup(matches, r.category, r.eventTypes, r.condition);
        r.stats = {
          windowMatches: g.windowMatches,
          hits: g.hits,
          firstSeen: g.firstSeen,
          lastSeen: g.lastSeen,
          trend: g.trend,
        };
        r.evidence = g.exampleMatchIds.length ? g.exampleMatchIds : r.evidence;
        r.status = nextRuleStatus(r.status, g.hits);
      }
      const rules = [...byId.values()].sort(
        (a, b) => b.stats.hits - a.stats.hits,
      );

      // AI distillation: rules missing text in the current language (both
      // active AND improved are filled — improved rules are shown on the
      // report page too and need text. Restricting this to active once left a
      // blind spot: a rule persisted as active with empty text on the round
      // distillation failed would, once its hit count fell back to improved,
      // no longer satisfy the old filter and stay stuck forever on
      // "(description pending the next consolidation)". Lazy re-translation on
      // a language switch takes this same path.)
      // Isolated in its own try/catch — client.stream() can throw (401/429/
      // timeout), but the deterministic part (the stats/status recompute
      // above) is already done and must never be dragged into the outer catch
      // by a misbehaving model, leaving the whole round unpersisted (the
      // spec's core invariant).
      const settings = deps.getSettings();
      const lang: AiLanguage = settings.aiLanguage ?? "zh";
      const need = rules.filter((r) => !r.description[lang]);
      let distilled = 0;
      let droppedByAudit = 0;
      let distillError: string | undefined;
      try {
        const client = resolveAiClient(settings, deps.clientFactory);
        if (need.length > 0 && client) {
          const pats: StablePattern[] = need.map((r) => ({
            patternId: r.ruleId,
            category: r.category,
            eventTypes: r.eventTypes,
            condition: r.condition,
            windowMatches: r.stats.windowMatches,
            hits: r.stats.hits,
            firstSeen: r.stats.firstSeen,
            lastSeen: r.stats.lastSeen,
            trend: r.stats.trend,
            exampleMatchIds: r.evidence,
          }));
          const prompt = buildDistillPrompt(
            pats,
            collectExamples(need, lang),
            lang,
          );
          let raw = "";
          const stream = client.stream({
            model: resolveAiModel(settings),
            max_tokens: API_MAX_TOKENS.learning,
            system: buildCoachSystemPrompt(lang),
            messages: [{ role: "user", content: prompt }],
          });
          for await (const ev of stream) if (ev.delta) raw += ev.delta;
          recordAiDebug({
            kind: "analysis",
            matchId: "learning#consolidate",
            at: Date.now(),
            model: resolveAiModel(settings),
            prompt,
            raw,
          });
          const audit = auditDistilledRules(parseModelJsonArray(raw), pats);
          droppedByAudit = audit.dropped.length;
          for (const t of audit.texts) {
            const r = byId.get(t.patternId)!;
            r.description[lang] = t.description;
            r.advice[lang] = t.advice;
            r.distilledAt = Date.now();
            r.distillModel = resolveAiModel(settings);
            distilled++;
          }
        }
      } catch (err) {
        // A failed distillation only costs text: the rules are still there,
        // stats/status are already current, and the next consolidation lazily
        // fills in description/advice.
        distillError = err instanceof Error ? err.message : String(err);
      }

      writeRulesDoc({
        schemaVersion: 1,
        updatedAt: Date.now(),
        ledgerMatches: matches.length,
        rules,
      });
      ledger.compact();
      deps.emit("gladlog:learning:done", {
        rules: rules.length,
        distilled,
        dropped: droppedByAudit,
        ...(distillError ? { distillError } : {}),
      });
    } catch (err) {
      deps.emit("gladlog:learning:error", {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      consolidating = false;
    }
  }

  /** Backfill (spec §1): scan every analysis-v2 cache into the ledger. Key
   * difference from aggregate(): promptVersion is deliberately NOT checked —
   * matches from older versions are learning memory too. */
  async function runBackfill(): Promise<void> {
    const { readdirSync } = await import("fs");
    let dirs: string[] = [];
    try {
      dirs = readdirSync(deps.matchesDir).filter(
        (d) => !d.startsWith(".") && !d.startsWith("_"),
      );
    } catch {
      dirs = [];
    }
    backfill = { running: true, scanned: 0, total: dirs.length };
    let batch: LedgerRun[] = [];
    for (const dir of dirs) {
      backfill.scanned++;
      const base = join(deps.matchesDir, dir);
      const file = [
        "analysis-v2.zh.json",
        "analysis-v2.en.json",
        "analysis-v2.json",
      ].find((f) => existsSync(join(base, f)));
      if (!file) continue;
      try {
        const raw = JSON.parse(readFileSync(join(base, file), "utf-8"));
        // Preserve the original version-gate semantics (see the function's
        // header comment: backfill ignores promptVersion, old-version matches
        // are learning memory too) — only the read path changes here, to the
        // lastSlotKey slot under slotted reads.
        const doc2 = toSlottedDoc<{
          findings?: Array<Pick<Finding, "category" | "severity" | "eventIds">>;
        }>(raw, "legacy:unknown");
        const slot = resolveActiveSlot(doc2);
        const findings: Array<
          Pick<Finding, "category" | "severity" | "eventIds">
        > = slot?.result?.findings ?? [];
        // Backfill has no candidates → eventTypes are all [] (type-level
        // patterns accumulate from live data)
        const run = buildRun(
          dir,
          findings,
          () => undefined,
          slot?.createdAt ?? 0,
          slot?.promptVersion ?? 0,
        );
        if (run) batch.push(run);
      } catch {
        /* skip bad caches */
      }
      if (batch.length >= 50) {
        ledger.append(batch);
        batch = [];
        deps.emit("gladlog:learning:progress", {
          scanned: backfill.scanned,
          total: backfill.total,
        });
        // Yield to other IPC (same idea as the App's background backfill)
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    ledger.append(batch);
    writeFileSync(
      backfillMarker,
      JSON.stringify({ at: Date.now(), scanned: backfill.scanned }),
      "utf-8",
    );
    backfill = { ...backfill, running: false };
    deps.emit("gladlog:learning:progress", {
      scanned: backfill.scanned,
      total: backfill.total,
    });
    maybeAutoConsolidate(); // backfill finished → first consolidation
  }

  return {
    init(): void {
      if (!existsSync(backfillMarker)) {
        mkdirSync(deps.learningDir, { recursive: true });
        void runBackfill().catch((err) =>
          deps.emit("gladlog:learning:error", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    /** analysis write hook (spec §1): called after the first round's run is
     * persisted. Fails silently — a ledger write must never disturb the main
     * analysis flow. */
    recordAnalysis(e: {
      matchId: string;
      findings: Finding[];
      candidates: CandidateEvent[];
    }): void {
      try {
        const byId = new Map(e.candidates.map((c) => [c.id, c.type]));
        const run = buildRun(
          e.matchId,
          e.findings,
          (id) => byId.get(id),
          Date.now(),
          PROMPT_VERSION,
        );
        if (!run) return;
        ledger.append([run]);
        maybeAutoConsolidate();
      } catch {
        /* best-effort */
      }
    },
    consolidate,
    async getRules(): Promise<RulesDoc | null> {
      return readRulesDoc();
    },
    async getState(): Promise<LearningState> {
      const { matches, badLines } = ledger.read();
      return {
        backfill,
        consolidating,
        ledgerMatches: matches.length,
        badLines,
        lastConsolidatedAt: readRulesDoc()?.updatedAt ?? null,
      };
    },
  };
}
export type LearningService = ReturnType<typeof createLearningService>;
