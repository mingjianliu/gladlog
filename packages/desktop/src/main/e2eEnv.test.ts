import { e2eUserDataDir } from "./e2eEnv";

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
