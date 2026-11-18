import { join } from "path";

import {
  applyE2eEnv,
  e2eLogFile,
  type E2eTargets,
  e2eUserDataDir,
} from "./e2eEnv";

describe("e2eUserDataDir", () => {
  it("未开启 → null", () => {
    expect(e2eUserDataDir({})).toBeNull();
    expect(e2eUserDataDir({ GLADLOG_E2E_USER_DATA: "/tmp/x" })).toBeNull();
  });

  it("开启且给了绝对路径 → 返回该路径", () => {
    expect(
      e2eUserDataDir({
        GLADLOG_E2E: "1",
        GLADLOG_E2E_USER_DATA: "/tmp/gl-e2e",
      }),
    ).toBe("/tmp/gl-e2e");
  });

  it("开启但路径缺失或非绝对 → 抛错(绝不回落到真实 userData)", () => {
    expect(() => e2eUserDataDir({ GLADLOG_E2E: "1" })).toThrow();
    expect(() =>
      e2eUserDataDir({ GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: "rel/path" }),
    ).toThrow();
  });
});

describe("applyE2eEnv(pipeline T198:E2E 不得写开发者真实的 main.log)", () => {
  const REAL_LOG = "/Users/someone/Library/Logs/gladlog/main.log";
  function targets() {
    const paths: Record<string, string> = {};
    const file = { resolvePathFn: (): string => REAL_LOG };
    const t: E2eTargets = {
      app: { setPath: (name, path) => void (paths[name] = path) },
      log: { transports: { file } },
    };
    return { t, paths, file };
  }

  it("未开启 → 什么都不动,日志仍走默认路径", () => {
    const { t, paths, file } = targets();
    expect(applyE2eEnv({}, t)).toBeNull();
    expect(paths).toEqual({});
    expect(file.resolvePathFn()).toBe(REAL_LOG);
  });

  it("开启 → userData、logs 路径和 main.log 都落在临时目录里", () => {
    const { t, paths, file } = targets();
    const dir = "/tmp/gl-e2e";
    expect(
      applyE2eEnv({ GLADLOG_E2E: "1", GLADLOG_E2E_USER_DATA: dir }, t),
    ).toBe(dir);
    expect(paths).toEqual({ userData: dir, logs: join(dir, "logs") });
    expect(file.resolvePathFn()).toBe(e2eLogFile(dir));
    expect(file.resolvePathFn()).toBe(join(dir, "logs", "main.log"));
    expect(file.resolvePathFn().startsWith(dir)).toBe(true);
  });

  it("开启但路径不合法 → 抛错,且没有改任何路径", () => {
    const { t, paths, file } = targets();
    expect(() => applyE2eEnv({ GLADLOG_E2E: "1" }, t)).toThrow();
    expect(paths).toEqual({});
    expect(file.resolvePathFn()).toBe(REAL_LOG);
  });
});
