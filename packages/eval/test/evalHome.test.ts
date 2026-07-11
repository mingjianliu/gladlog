import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { resolveEvalHome, runDir, abDir } from "../src/evalHome";

describe("resolveEvalHome", () => {
  it("env 指向合法 git 目录 → 返回该路径", () => {
    const d = mkdtempSync(join(tmpdir(), "gl-eval-"));
    execSync("git init -q", { cwd: d });
    expect(resolveEvalHome({ env: { GLADLOG_EVAL_HOME: d } })).toBe(d);
  });
  it("目录缺失 → throw 且 message 含 init 指引", () => {
    expect(() =>
      resolveEvalHome({ env: { GLADLOG_EVAL_HOME: "/nonexistent/x" } }),
    ).toThrow(/gladlog-eval init/);
  });
  it("存在但非 git 仓 → throw", () => {
    const d = mkdtempSync(join(tmpdir(), "gl-eval-"));
    expect(() => resolveEvalHome({ env: { GLADLOG_EVAL_HOME: d } })).toThrow(
      /git/,
    );
  });
  it("runDir / abDir 拼接", () => {
    expect(runDir("/h", "2026-07-11-a")).toBe("/h/runs/2026-07-11-a");
    expect(abDir("/h", "exp1")).toBe("/h/ab/exp1");
  });
});
