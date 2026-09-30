import { afterEach, describe, expect, it } from "vitest";
import {
  cliSpawnEnv,
  detectCliForBackend,
  detectLocalCli,
  parseCliVersionOutput,
  isWindowsBatchFile,
  pickCliPathFromLookupOutput,
  probeCliVersion,
  probeCliVersionCached,
  wellKnownCliCandidates,
} from "./cliDetect";

const WIN = {
  platform: "win32" as const,
  home: "C:\\Users\\u",
  env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
};
const MAC = { platform: "darwin" as const, home: "/Users/u", env: {} };

describe("wellKnownCliCandidates", () => {
  it("win32:原生安装器 .local\\bin\\*.exe 与 npm 全局 *.cmd 都在候选里", () => {
    const c = wellKnownCliCandidates("claude", WIN);
    expect(c).toContain("C:\\Users\\u\\.local\\bin\\claude.exe");
    expect(c).toContain("C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd");
  });
  it("win32:无 APPDATA 时不产出 npm 候选(不拼 undefined 路径)", () => {
    const c = wellKnownCliCandidates("agy", { ...WIN, env: {} });
    expect(c).toEqual(["C:\\Users\\u\\.local\\bin\\agy.exe"]);
  });
  it("mac:~/.local/bin、homebrew、/usr/local/bin 兜底", () => {
    expect(wellKnownCliCandidates("agy", MAC)).toEqual([
      "/Users/u/.local/bin/agy",
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy",
    ]);
  });
});

describe("detectLocalCli", () => {
  it("PATH 命中优先,不再探测目录", async () => {
    const probed: string[] = [];
    const p = await detectLocalCli("claude", {
      ...MAC,
      pathLookup: async () => "/from/path/claude",
      exists: (x) => {
        probed.push(x);
        return true;
      },
    });
    expect(p).toBe("/from/path/claude");
    expect(probed).toEqual([]);
  });
  it("PATH 查不到时按候选顺序探测,返回第一个存在的", async () => {
    const p = await detectLocalCli("agy", {
      ...MAC,
      pathLookup: async () => null,
      exists: (x) => x === "/opt/homebrew/bin/agy",
    });
    expect(p).toBe("/opt/homebrew/bin/agy");
  });
  it("PATH 与目录都没有 → null(由调用方给明确错误)", async () => {
    const p = await detectLocalCli("codex", {
      ...WIN,
      pathLookup: async () => null,
      exists: () => false,
    });
    expect(p).toBeNull();
  });
});

describe("pickCliPathFromLookupOutput(agy flash 复核 #2)", () => {
  it("login shell 横幅/nvm 提示混进 stdout 时仍取到真路径", () => {
    const out = "Welcome to zsh!\nnvm loading…\n/opt/homebrew/bin/claude\n";
    expect(
      pickCliPathFromLookupOutput(out, "claude", {
        platform: "darwin",
        exists: (p) => p === "/opt/homebrew/bin/claude",
      }),
    ).toBe("/opt/homebrew/bin/claude");
  });
  it("横幅行本身是存在的绝对路径(如 direnv 打印目录)也不误取:basename 必须是工具名", () => {
    const out = "/Users/u/projects/foo\n/usr/local/bin/agy\n";
    expect(
      pickCliPathFromLookupOutput(out, "agy", {
        platform: "darwin",
        exists: () => true,
      }),
    ).toBe("/usr/local/bin/agy");
  });
  it("win:where 多行输出取第一个存在的(claude.cmd 命中工具名前缀)", () => {
    const out =
      "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd\r\nC:\\other\\claude.exe\r\n";
    expect(
      pickCliPathFromLookupOutput(out, "claude", {
        platform: "win32",
        exists: (p) => p.endsWith("claude.cmd"),
      }),
    ).toBe("C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd");
  });
  it("整个输出都不是可用路径 → null(转入目录兜底)", () => {
    expect(
      pickCliPathFromLookupOutput("command not found", "codex", {
        platform: "darwin",
        exists: () => true,
      }),
    ).toBeNull();
  });
  it("win:npm 目录无扩展名的 claude(Git Bash sh 脚本)排在前面也不取——真机 spawn ENOENT 回归", () => {
    // where claude 的真实输出形状:无扩展名的 sh shim 在 claude.cmd 之前,
    // 两个文件都存在;必须跳过前者选 .cmd。
    const out =
      "C:\\Users\\User\\AppData\\Roaming\\npm\\claude\r\n" +
      "C:\\Users\\User\\AppData\\Roaming\\npm\\claude.cmd\r\n";
    expect(
      pickCliPathFromLookupOutput(out, "claude", {
        platform: "win32",
        exists: () => true,
      }),
    ).toBe("C:\\Users\\User\\AppData\\Roaming\\npm\\claude.cmd");
  });
  it("win:claude.ps1 也不可 spawn,只认 exe/cmd/bat", () => {
    const out =
      "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.ps1\r\n" +
      "C:\\Users\\u\\.local\\bin\\claude.exe\r\n";
    expect(
      pickCliPathFromLookupOutput(out, "claude", {
        platform: "win32",
        exists: () => true,
      }),
    ).toBe("C:\\Users\\u\\.local\\bin\\claude.exe");
  });
});

describe("isWindowsBatchFile(defaultRun/版本探测共用谓词)", () => {
  it("win32 + .cmd/.bat → true(大小写不敏感)", () => {
    expect(isWindowsBatchFile("C:\\npm\\claude.cmd", "win32")).toBe(true);
    expect(isWindowsBatchFile("C:\\npm\\claude.BAT", "win32")).toBe(true);
  });
  it("win32 的 .exe 与非 win 平台 → false", () => {
    expect(isWindowsBatchFile("C:\\bin\\claude.exe", "win32")).toBe(false);
    expect(isWindowsBatchFile("/usr/local/bin/claude", "darwin")).toBe(false);
  });
});

describe("detectCliForBackend", () => {
  it("非本地后端(anthropic)→ path: null,不做任何检测", async () => {
    expect(await detectCliForBackend("anthropic")).toEqual({ path: null });
  });
  it("未知字符串 → path: null(渲染层传错也不炸)", async () => {
    expect(await detectCliForBackend("nonsense")).toEqual({ path: null });
  });
});

describe("parseCliVersionOutput(#21 item6)", () => {
  it("抠出形如 1.2.3 的版本号,忽略周围文案", () => {
    expect(parseCliVersionOutput("claude-code 1.2.3\n")).toBe("1.2.3");
    expect(parseCliVersionOutput("codex-cli 0.5.0-beta.2")).toBe(
      "0.5.0-beta.2",
    );
  });
  it("抠不出版本号数字 → 退而求其次用整行(截断 40 字符)", () => {
    expect(parseCliVersionOutput("some banner with no digits")).toBe(
      "some banner with no digits",
    );
  });
  it("全空白/空串 → null", () => {
    expect(parseCliVersionOutput("")).toBeNull();
    expect(parseCliVersionOutput("   \n  \n")).toBeNull();
  });
});

describe("probeCliVersion(#21 item6:轻量版本探测,失败不阻断)", () => {
  it("exec 成功且能解析出版本号 → { ok: true, version }", async () => {
    const r = await probeCliVersion("/bin/claude", {
      exec: async () => ({ stdout: "1.2.3\n", stderr: "" }),
    });
    expect(r).toEqual({ ok: true, version: "1.2.3" });
  });
  it("exec 抛出(超时/ENOENT/旧版本不认识 --version)→ { ok: false },不抛出", async () => {
    const r = await probeCliVersion("/bin/claude", {
      exec: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    expect(r).toEqual({ ok: false });
  });
  it("exec 成功但 stdout/stderr 都解析不出版本 → { ok: false }", async () => {
    const r = await probeCliVersion("/bin/claude", {
      exec: async () => ({ stdout: "", stderr: "" }),
    });
    expect(r).toEqual({ ok: false });
  });
  it("stdout 为空但 stderr 有版本号(部分 CLI 把 --version 打到 stderr)→ 仍能解析", async () => {
    const r = await probeCliVersion("/bin/agy", {
      exec: async () => ({ stdout: "", stderr: "agy version 9.9.9" }),
    });
    expect(r).toEqual({ ok: true, version: "9.9.9" });
  });
});

describe("probeCliVersionCached(#21 item6:同一 tool 本进程只探测一次)", () => {
  it("连续两次调用只触发一次底层 exec(缓存命中)", async () => {
    let calls = 0;
    const exec = async () => {
      calls++;
      return { stdout: "4.0.0", stderr: "" };
    };
    const first = await probeCliVersionCached("codex", "/bin/codex", { exec });
    const second = await probeCliVersionCached("codex", "/bin/codex", {
      exec,
    });
    expect(first).toEqual({ ok: true, version: "4.0.0" });
    expect(second).toEqual({ ok: true, version: "4.0.0" });
    expect(calls).toBe(1);
  });
});

describe("cliSpawnEnv(打包 GUI 应用从 Dock 启动时的 PATH 缺口)", () => {
  const savedPath = process.env.PATH;
  const withPath = (p: string) => {
    process.env.PATH = p;
    return cliSpawnEnv("/usr/bin/cbc").PATH ?? "";
  };
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  it("追加 CLI 所在目录:node 能被 shebang 找到", () => {
    const p = withPath("/bin");
    expect(p.split(":")).toContain("/usr/bin");
  });

  it("纯追加:原有 PATH 段落一个都不丢", () => {
    const p = withPath("/bin:/sbin");
    expect(p.startsWith("/bin:/sbin")).toBe(true);
  });

  it("已存在的目录不重复追加", () => {
    const p = withPath("/usr/bin:/bin");
    expect(p.split(":").filter((s) => s === "/usr/bin")).toHaveLength(1);
  });
});
