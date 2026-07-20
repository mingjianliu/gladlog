import { isE2EOnlyRun } from "../qa/argv";

describe("isE2EOnlyRun", () => {
  it("没点名 project → false(跑全部,要起测试台服务器)", () => {
    expect(isE2EOnlyRun(["node", "playwright", "test"])).toBe(false);
  });

  it("等号式 --project=e2e → true", () => {
    expect(isE2EOnlyRun(["--project=e2e"])).toBe(true);
  });

  it("空格式 --project e2e → true(原实现漏掉的形式)", () => {
    expect(isE2EOnlyRun(["--project", "e2e"])).toBe(true);
  });

  it("只跑 visual → false", () => {
    expect(isE2EOnlyRun(["--project=visual"])).toBe(false);
    expect(isE2EOnlyRun(["--project", "visual"])).toBe(false);
  });

  it("同时点名 e2e 与 visual → false(visual 需要服务器)", () => {
    expect(isE2EOnlyRun(["--project=e2e", "--project=visual"])).toBe(false);
    expect(isE2EOnlyRun(["--project", "e2e", "--project", "visual"])).toBe(
      false,
    );
  });

  it("--project 后面跟的是另一个 flag → 不当作值", () => {
    expect(isE2EOnlyRun(["--project", "--headed"])).toBe(false);
  });
});
