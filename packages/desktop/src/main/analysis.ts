import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { recordAiDebug } from "./aiDebugLog";
import {
  auditDeepDives,
  buildDeepDivePrompt,
  type DeepDivePack,
} from "@gladlog/analysis";
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
  analysisCacheDoc,
  analysisCachePath,
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
};
export type AnalysisResult = {
  findings: Finding[];
  dropped: number;
  hadNarration: boolean;
  /** 确定性回退的原因(hadNarration=false 时);旧缓存无此字段。 */
  fallbackReason?: "no-candidates" | "no-client" | "bad-json";
  /** 深挖轮已跑(无论产出几条),renderer 防重触发。 */
  deepened?: boolean;
};
export type DeepenInput = {
  matchId: string;
  findings: Finding[];
  packs: DeepDivePack[];
  spec: string;
  ownerName?: string;
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
  // 代际计数器按 matchId 分桶:每场独立。旧实现是单个全局计数器,任何新
  // run/deepen(比如开 B 场或深挖 B)都会 ++,让 A 场正在跑的分析被判过期 abort、
  // 永不写缓存 —— 这正是「看别的游戏就丢了之前的分析」的根。
  const generations = new Map<string, number>();
  const nextGen = (matchId: string) => {
    const g = (generations.get(matchId) ?? 0) + 1;
    generations.set(matchId, g);
    return g;
  };
  const isCurrent = (matchId: string, gen: number) =>
    generations.get(matchId) === gen;

  // 当前正在跑首轮分析的 matchId → 拥有它的 run 代际。渲染层重挂(切 tab/切场
  // 回来)时查询,若在跑就显示「分析中…」而非空闲态,省得用户以为丢了又点一次。
  // 存代际而非裸集合:清理时按「我是不是这条 running 的主人」判,而不是按代际是否
  // 最新 —— 否则 deepen 会 ++ 代际、让被它取代的 run abort 时判自己非最新而不清,
  // running 永久残留(复审发现:换语言到无缓存的语言会卡在分析中)。
  const running = new Map<string, number>();

  /** 正在深挖的 matchId —— 幂等守卫用,见 deepen。 */
  const deepening = new Set<string>();

  /**
   * 回收该场的代际条目。generations 只增不删的话,长会话里每个看过的 matchId
   * 都会留一条(量很小,但没有理由留)。
   *
   * 只在该场彻底静默(无 run、无 deepen 在飞)时回收 —— 否则在飞的那一轮
   * 会因为 generations.get() 变 undefined 而 isCurrent 判假,把自己当成过期的
   * 中途 abort,等于凭空丢一次分析。
   */
  const reapGeneration = (matchId: string) => {
    if (!running.has(matchId) && !deepening.has(matchId))
      generations.delete(matchId);
  };

  async function run(input: AnalysisInput): Promise<void> {
    const myGen = nextGen(input.matchId);
    running.set(input.matchId, myGen);
    const clearRunning = () => {
      // 仅当这条 running 仍归我(未被更晚的 run 接管)才清。deepen 不碰 running,
      // 故被 deepen 取代的 run 走到这里 running 仍是自己 → 正常清,不泄漏。
      if (running.get(input.matchId) === myGen) running.delete(input.matchId);
      reapGeneration(input.matchId);
    };
    const settings = deps.getSettings();
    const lang: AiLanguage = settings.aiLanguage ?? "zh";

    const finish = (result: AnalysisResult) => {
      clearRunning();
      const dir = join(deps.matchesDir, input.matchId);
      try {
        mkdirSync(dir, { recursive: true });
        // 语言分键缓存(backlog #1 推荐项):两种语言的结果可同时保留
        const target = analysisCachePath(deps.matchesDir, input.matchId, lang);
        const tmp = `${target}.tmp`;
        writeFileSync(tmp, JSON.stringify(analysisCacheDoc(lang, result)), "utf-8");
        renameSync(tmp, target);
      } catch {
        /* best-effort */
      }
      deps.emit("gladlog:analysis:done", { matchId: input.matchId, result });
    };

    // deterministic fallback: no narration;reason 让 UI 分因显示(0 finding 可解释)
    const fallback = (reason: "no-candidates" | "no-client" | "bad-json") =>
      finish({
        findings: [],
        dropped: 0,
        hadNarration: false,
        fallbackReason: reason,
      });

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
        max_tokens: 4096, // 3-5 条 + death-setup 链条解释;2048 会 JSON 截断→整体回退
        system: buildCoachSystemPrompt(lang),
        messages: [{ role: "user", content: prompt }],
      });
      for await (const ev of stream) {
        if (!isCurrent(input.matchId, myGen)) {
          clearRunning();
          return;
        }
        if (ev.delta) {
          raw += ev.delta;
          deps.emit("gladlog:analysis:delta", {
            matchId: input.matchId,
            text: ev.delta,
          });
        }
      }
      if (!isCurrent(input.matchId, myGen)) {
        clearRunning();
        return;
      }
      recordAiDebug({
        kind: "analysis",
        matchId: input.matchId,
        at: Date.now(),
        model: settings.anthropicModel ?? "claude-sonnet-5",
        prompt,
        raw,
      });

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
   * 深挖轮(自动追问):renderer 在初轮 done 后为高严重度 finding 构建
   * 确定性证据包并调用;本方法跑第二次 LLM、auditDeepDives 审计、把
   * deepDive 合并进缓存与结果,再 emit 一次 done。审不过 → 静默保持初轮。
   *
   * 幂等守卫:同一场深挖在飞时,重复调用直接丢弃。renderer 的触发条件是
   * 缓存里 `deepened` 仍为 false,而该标志要等本轮 writeMerged 才落盘 ——
   * 深挖在飞的那几十秒里用户切走再切回,面板重挂就会再触发一次,白烧一轮
   * token(旧 gen 虽会被 nextGen 判过期 abort,但请求早已发出、钱已经花了)。
   * 守卫必须放主进程:renderer 侧「先查 isDeepening 再调」是 TOCTOU,两次
   * 重挂可能都查到 false,挡不住。
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
    const client = resolveAiClient(settings, deps.clientFactory);
    // 无 client / 无 pack:标记 deepened 防重触发,内容保持初轮
    const cachedPath = join(
      deps.matchesDir,
      input.matchId,
      `analysis-v2.${lang}.json`,
    );
    const writeMerged = (findings: Finding[]) => {
      try {
        const doc = JSON.parse(readFileSync(cachedPath, "utf-8"));
        doc.result = { ...doc.result, findings, deepened: true };
        const tmp = cachedPath + ".tmp";
        writeFileSync(tmp, JSON.stringify(doc), "utf-8");
        renameSync(tmp, cachedPath);
        deps.emit("gladlog:analysis:done", {
          matchId: input.matchId,
          result: doc.result,
        });
      } catch {
        /* 缓存缺失:仅 emit 内存结果 */
        deps.emit("gladlog:analysis:done", {
          matchId: input.matchId,
          result: { findings, dropped: 0, hadNarration: true, deepened: true },
        });
      }
    };
    if (!client || input.packs.length === 0) return writeMerged(input.findings);
    try {
      const prompt = buildDeepDivePrompt(
        input.packs,
        input.findings,
        input.spec,
        input.ownerName,
      );
      let raw = "";
      const stream = client.stream({
        model: settings.anthropicModel ?? "claude-sonnet-5",
        max_tokens: 2048,
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
        model: settings.anthropicModel ?? "claude-sonnet-5",
        prompt,
        raw,
      });
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        /* 坏 JSON → 保持初轮 */
      }
      const dives = auditDeepDives(parsed, input.packs);
      const merged = input.findings.map((f, i) => {
        const d = dives.find((x) => x.findingIndex === i);
        return d ? { ...f, deepDive: { text: d.text, chips: d.chips } } : f;
      });
      if (!isCurrent(input.matchId, myGen)) return; // 保险:写盘/emit 前复查代际
      writeMerged(merged);
    } catch {
      if (!isCurrent(input.matchId, myGen)) return;
      writeMerged(input.findings); // 深挖失败不致命,保持初轮
    }
  }

  return {
    run,
    deepen,
    async cancel(): Promise<void> {
      // 全场取消:每场代际 +1,所有在跑的 run/deepen 循环下一拍即 abort。
      for (const [id, g] of generations) generations.set(id, g + 1);
      running.clear();
    },
    /** 首轮分析是否正在跑(渲染层重挂时查询,显示「分析中…」防重点)。 */
    async isRunning(matchId: string): Promise<boolean> {
      return running.has(matchId);
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
    /**
     * 错题本(跨场):全部已分析对局的 findings 按 category 分组,
     * 每条带对局 meta(时间/地图/胜负)与跟进标记,组内按时间倒序。
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
          const doc = JSON.parse(readFileSync(join(base, file), "utf-8"));
          if (doc.promptVersion !== PROMPT_VERSION) continue;
          const findings: Array<{
            category: string;
            title: string;
            explanation?: string;
            severity: string;
            eventIds?: string[];
          }> = doc.result?.findings ?? [];
          if (findings.length === 0) continue;
          let flags: Record<string, string> = {};
          try {
            flags = JSON.parse(
              readFileSync(join(base, "findingFlags.json"), "utf-8"),
            );
          } catch {
            /* 无标记 */
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
            /* 目录名兜底 */
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
              startTime: meta.startTime ?? doc.createdAt ?? 0,
              zoneId: meta.zoneId,
              result: meta.result,
              bracket: meta.bracket,
            });
            byCategory.set(f.category, list);
          }
        } catch {
          /* 坏文件跳过 */
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
     * 面板重挂时的**单次原子**查询(周度复核 P2#5)。
     *
     * 分两次 IPC(getCached → isRunning)时,两次 await 之间恰好完成的那一轮会
     * 掉进缝里:第一次读缓存还没落盘 → null,第二次查 running 已经清了 → false,
     * 面板于是停在空闲态,而结果其实已经躺在盘上(用户看到的还是「点我分析」)。
     *
     * 合并成一次调用后,renderer 侧不再有可插入的 await。顺序也刻意先 running
     * 后 cached:万一将来这里插入异步,后读的 cached 仍能兜住刚完成的那一轮;
     * 反过来写就还是漏。
     */
    /**
     * 仅测试用:代际表条目数。回收(reapGeneration)是纯内部状态,没有别的
     * 观察面 —— 泄漏只表现为内存缓慢增长,不暴露就只能靠读代码保证。
     */
    __generationCount(): number {
      return generations.size;
    },
    async getState(
      matchId: string,
    ): Promise<{ cached: AnalysisResult | null; running: boolean }> {
      const runningNow = running.has(matchId);
      const cached = await this.getCached(matchId);
      return { cached, running: runningNow };
    },
    async getCached(matchId: string): Promise<AnalysisResult | null> {
      const lang: AiLanguage = deps.getSettings().aiLanguage ?? "zh";
      let fp = analysisCachePath(deps.matchesDir, matchId, lang);
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
