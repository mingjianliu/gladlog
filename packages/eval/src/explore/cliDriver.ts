/**
 * 本地 CLI 后端驱动(claude / agy)—— 给 prompt 逐行探针用。
 *
 * 为什么不继续用 DeepSeek:2026-08-23 的 100 局消融跑到一半,dev sim key 余额耗尽,
 * 3,100 次调用里 2,766 次(89%)返回 `Insufficient Balance`,只有前 334 次有效。
 * 而产品本来就支持 claude / agy / codex 三个本地 CLI 后端,用户手上有额度。
 *
 * **实测单次耗时(同一份 31,876 字符的真实 prompt)**:
 *   · `claude -p --model sonnet` → **115 秒**(代码注释早就写了「agentic overhead,
 *     slow on big prompts (minutes)」);
 *   · `agy --print --sandbox`   → **14 秒**,快 8 倍。
 *
 * 所以分工:agy 跑全量,claude 跑子集做跨模型交叉验证 —— 两个模型对「哪些行有用」
 * 给出的排序对不对得上,比单模型的绝对数字更有说服力。
 *
 * 参数形状**照抄产品** `packages/desktop/src/main/localAiBackends.ts`,不自创:
 * 那边处理过 Windows argv 上限、.cmd 不可直接 spawn 等一堆真机坑。本文件是 eval 侧
 * 的简化版(只跑 macOS/Linux、单轮、无会话),要改参数请先看产品那份。
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * CLI 必须在**中性目录**里跑,不能在仓库里。
 *
 * 2026-08-23 实测,同一份 prompt、同一个模型(claude/haiku),只改工作目录:
 *   · cwd = gladlog 仓库 → **75 秒**,而且回答直接跑题,开头是「我发现你没有提供
 *     eval-baseline 的具体参数」—— 它把仓库的 `CLAUDE.md` 和 skill 定义当成了上下文,
 *     在回答**这个仓库的工作流**,不是在做竞技场教练分析;
 *   · cwd = 空目录     → **25 秒**,正常的教练分析。
 *
 * 后果:在这条修复之前跑的 claude 批次(haiku 628 样本、sonnet 117 样本)全部作废 ——
 * 它们测的不是「模型怎么用 prompt 的每一行」,是「一个被仓库上下文污染的模型怎么用」。
 * haiku 那个异常糟糕的噪声底(0.556,同一份 prompt 两次只有 55.6% 重合)很可能有
 * 一大半来自这里。
 *
 * 这也是**评测环境保真度**的一般教训:被测对象是「产品发给模型的 prompt」,那么除了
 * 这份 prompt,模型不该看到任何别的东西。评测脚本自己所在的仓库尤其危险 —— 它恰好
 * 装满了关于这个产品的说明。
 */
const NEUTRAL_CWD = mkdtempSync(join(tmpdir(), "gladlog-probe-"));

export type CliBackend = "claude" | "agy";

interface CliCallOptions {
  /** 超时(毫秒)。claude 慢,默认给足。 */
  timeoutMs?: number;
  /** 传给后端的模型名;省略则用后端默认。 */
  model?: string;
  /**
   * 失败重试次数(指数退避)。默认 3。
   *
   * 2026-08-23:haiku(并发 8)与 sonnet(并发 5)同时跑,合计 13 路并发 `claude -p`,
   * 两批分别在 628/1500 和 117/600 处因**连续 10 次失败**被熔断中止;而事后手工
   * 单次调用**立刻成功**。也就是说那不是额度耗尽,是**并发过高触发的瞬时限流** ——
   * 熔断器把一个本该退避重试的情况当成了终止条件。
   */
  retries?: number;
}

/** agy 在 `--print` 输出前会带一行自我介绍式的表头,去掉它。 */
function stripAgyHeader(out: string): string {
  return out
    .replace(/^\s*(Loaded cached credentials\.?|Using model.*)\n/gm, "")
    .trim();
}

/**
 * 单轮调用。返回模型输出;失败时抛错(调用方决定重试/熔断)。
 *
 * **不吞错**:2026-08-23 那次余额耗尽之所以空转一小时,正是因为探针把 API 错误
 * 当成一条正常样本记下来继续跑。错误必须冒到调用方,由熔断逻辑处理。
 */
export async function callCli(
  backend: CliBackend,
  prompt: string,
  opts: CliCallOptions = {},
): Promise<string> {
  const timeoutMs =
    opts.timeoutMs ?? (backend === "claude" ? 300_000 : 180_000);
  const args =
    backend === "claude"
      ? [
          "-p",
          "--output-format",
          "text",
          ...(opts.model ? ["--model", opts.model] : []),
        ]
      : [
          "--print",
          prompt,
          ...(opts.model ? ["--model", opts.model] : []),
          "--print-timeout",
          "110s",
          "--sandbox",
        ];
  const attempts = (opts.retries ?? 3) + 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0)
      await new Promise((r) =>
        setTimeout(r, 3000 * 2 ** (i - 1) + Math.floor(i * 500)),
      );
    try {
      return await once();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;

  async function once(): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(backend, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: NEUTRAL_CWD,
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${backend} 超时 ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += String(d)));
      child.stderr.on("data", (d) => (err += String(d)));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          // stderr 常常是空的(CLI 把错误打在 stdout),两边都带上 —— 2026-08-23 那两次
          // 中止的错误信息就是一句空的「退出码 1: 」,完全没法诊断。
          return reject(
            new Error(
              `${backend} 退出码 ${code}: stderr=${err.slice(0, 200) || "(空)"} stdout=${out.slice(0, 200) || "(空)"}`,
            ),
          );
        const text = backend === "agy" ? stripAgyHeader(out) : out.trim();
        if (!text) return reject(new Error(`${backend} 返回空输出`));
        resolve(text);
      });
      // claude 走 stdin;agy 的 prompt 已经在 argv 里
      if (backend === "claude") child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

/**
 * 连续失败熔断器。
 *
 * 存在的理由就是 2026-08-23 那次事故:余额耗尽后探针继续空转了 2,766 次调用、
 * 一个多小时,而日志里的进度条一路走到 3100/3100 看起来一切正常。**批量脚本必须
 * 能自己发现「后端已经不工作了」。**
 */
export class Breaker {
  private consecutive = 0;
  constructor(private readonly limit = 8) {}
  ok(): void {
    this.consecutive = 0;
  }
  fail(e: unknown): void {
    this.consecutive++;
    if (this.consecutive >= this.limit)
      throw new Error(
        `连续 ${this.consecutive} 次调用失败,中止(最后一次:${(e as Error).message.slice(0, 200)})`,
      );
  }
}
