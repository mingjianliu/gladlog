import { resolveScene, SCENE_NAMES } from "./scenes";

describe("resolveScene", () => {
  it("无 scene 参数 → null(走原交互式试验台)", () => {
    expect(resolveScene("")).toBeNull();
    expect(resolveScene("?foo=1")).toBeNull();
  });

  it("合法 scene 名 → 原样返回", () => {
    expect(resolveScene("?scene=report-battle")).toBe("report-battle");
    expect(resolveScene("?scene=report-ai&other=x")).toBe("report-ai");
  });

  it("非法 scene 名 → null(不静默渲染错场景)", () => {
    expect(resolveScene("?scene=nope")).toBeNull();
  });

  it("场景名清单唯一且非空", () => {
    expect(SCENE_NAMES.length).toBeGreaterThan(0);
    expect(new Set(SCENE_NAMES).size).toBe(SCENE_NAMES.length);
  });

  it("app-shell 场景也可直达", () => {
    expect(resolveScene("?scene=dashboard")).toBe("dashboard");
    expect(resolveScene("?scene=settings")).toBe("settings");
    expect(resolveScene("?scene=matchlist")).toBe("matchlist");
  });
});
