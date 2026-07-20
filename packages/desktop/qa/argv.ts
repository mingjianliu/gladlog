/**
 * 这次运行是否**只**跑 e2e project。
 *
 * playwright.config 用它决定要不要起 dev:ui 测试台服务器:e2e 驱动的是打包好
 * 的 Electron,起服务器纯属白等一次构建,本机还会撞端口。
 *
 * 单独成文件是为了能被单测覆盖 —— 原先直接在 config 里写
 * `process.argv.includes("--project=e2e")`,只认等号式;写成
 * `--project e2e`(空格式,Playwright 同样接受)就会静默失效。
 * 这类「条件写错了不报错、只是白跑」的判断,必须有测试钉住。
 */
export function isE2EOnlyRun(argv: readonly string[]): boolean {
  const projects: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--project") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) projects.push(next);
    } else if (arg.startsWith("--project=")) {
      projects.push(arg.slice("--project=".length));
    }
  }
  // 没点名 project = 跑全部,要起服务器;点名了就得全都是 e2e 才跳过。
  return projects.length > 0 && projects.every((p) => p === "e2e");
}
