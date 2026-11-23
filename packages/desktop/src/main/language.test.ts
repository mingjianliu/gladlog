import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  effectiveLanguage,
  readInstallerLanguage,
  withEffectiveLanguage,
} from "./language";

const tmpDir = () => mkdtempSync(join(tmpdir(), "gl-lang-"));

describe("effectiveLanguage", () => {
  it("未选择时按系统 locale 推断", () => {
    expect(effectiveLanguage({ language: null }, "zh-CN")).toBe("zh");
    expect(effectiveLanguage({ language: null }, "en-US")).toBe("en");
    expect(effectiveLanguage({}, "zh-TW")).toBe("zh");
    expect(effectiveLanguage({ language: null }, "")).toBe("en");
  });

  it("已选择时用设置里的值,不看 locale", () => {
    expect(effectiveLanguage({ language: "en" }, "zh-CN")).toBe("en");
    expect(effectiveLanguage({ language: "zh" }, "en-US")).toBe("zh");
  });
});

describe("withEffectiveLanguage", () => {
  it("只替换 language,其他字段原样保留", () => {
    const out = withEffectiveLanguage(
      { language: null, wowDirectory: "/w" as string | null },
      "zh-CN",
    );
    expect(out).toEqual({ language: "zh", wowDirectory: "/w" });
    expect(
      withEffectiveLanguage({ language: "en", n: 1 }, "zh-CN").language,
    ).toBe("en");
  });
});

describe("readInstallerLanguage", () => {
  it("文件内容 \"en\\r\\n\" → en", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "installer-language.txt"), "en\r\n");
    expect(readInstallerLanguage(dir)).toBe("en");
  });

  it("文件内容 zh → zh", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "installer-language.txt"), " zh ");
    expect(readInstallerLanguage(dir)).toBe("zh");
  });

  it("文件内容 fr → null", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "installer-language.txt"), "fr");
    expect(readInstallerLanguage(dir)).toBeNull();
  });

  it("文件不存在 → null,不抛异常", () => {
    expect(readInstallerLanguage(tmpDir())).toBeNull();
    expect(readInstallerLanguage(join(tmpDir(), "nope"))).toBeNull();
  });
});
