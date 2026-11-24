import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  adoptInstallerLanguage,
  effectiveLanguage,
  INSTALLER_LANGUAGE_FILE,
  installerLanguageToAdopt,
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
  it('文件内容 "en\\r\\n" → en', () => {
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

describe("installerLanguageToAdopt", () => {
  const dirWith = (content: string) => {
    const dir = tmpDir();
    writeFileSync(join(dir, INSTALLER_LANGUAGE_FILE), content);
    return dir;
  };

  it("win32 且设置里还没选语言时,采用安装器写的值", () => {
    const dir = dirWith("zh");
    expect(installerLanguageToAdopt("win32", null, () => dir)).toBe("zh");
  });

  it("已经选过语言时不看安装器文件(覆盖安装不改设置)", () => {
    const dir = dirWith("zh");
    let asked = false;
    const exeDir = () => {
      asked = true;
      return dir;
    };
    expect(installerLanguageToAdopt("win32", "en", exeDir)).toBeNull();
    expect(asked).toBe(false);
  });

  it("非 win32 平台不读", () => {
    const dir = dirWith("zh");
    expect(installerLanguageToAdopt("darwin", null, () => dir)).toBeNull();
    expect(installerLanguageToAdopt("linux", null, () => dir)).toBeNull();
  });

  it("文件缺失或内容无效时当作不存在", () => {
    expect(installerLanguageToAdopt("win32", null, tmpDir)).toBeNull();
    const bad = dirWith("fr");
    expect(installerLanguageToAdopt("win32", null, () => bad)).toBeNull();
  });
});

describe("adoptInstallerLanguage(启动时采用安装器语言)", () => {
  const dirWith = (content: string) => {
    const dir = tmpDir();
    writeFileSync(join(dir, INSTALLER_LANGUAGE_FILE), content);
    return dir;
  };

  it("保存成功:写入安装器语言", () => {
    const dir = dirWith("en");
    const saved: unknown[] = [];
    adoptInstallerLanguage({
      platform: "win32",
      current: null,
      exeDir: () => dir,
      save: (p) => saved.push(p),
      logError: () => {},
    });
    expect(saved).toEqual([{ language: "en" }]);
  });

  it("保存抛异常(settings.json 被锁):不抛出,记日志,让启动继续(codex A#2)", () => {
    const dir = dirWith("zh");
    const logged: string[] = [];
    expect(() =>
      adoptInstallerLanguage({
        platform: "win32",
        current: null,
        exeDir: () => dir,
        save: () => {
          throw new Error("EPERM settings.json");
        },
        logError: (m) => logged.push(m),
      }),
    ).not.toThrow();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("EPERM settings.json");
  });

  it("exeDir 抛异常也不抛出", () => {
    expect(() =>
      adoptInstallerLanguage({
        platform: "win32",
        current: null,
        exeDir: () => {
          throw new Error("no exe path");
        },
        save: () => {},
        logError: () => {},
      }),
    ).not.toThrow();
  });
});
