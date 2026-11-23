import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { INSTALLER_LANGUAGE_FILE } from "../src/main/language";

/**
 * Release-side config gate for auto-update.
 *
 * None of the settings checked here have a runtime test that could catch a
 * regression: if `build.publish` disappears, or the NSIS artifact name gets a
 * space back, or the workflow stops uploading latest.yml, every installed
 * client keeps working normally and simply never finds an update again — no
 * crash, no error, nothing in any log we can see. The failure mode is
 * invisible in production, so this file is the only place it can be caught.
 *
 * Reads the real files off disk (same cross-file gate style as
 * diagnosticLevel.test.ts) instead of importing them, so what is checked is
 * the file that actually ships.
 */

const desktopDir = join(__dirname, "..");
const repoRoot = join(__dirname, "../../..");
const workflowPath = join(repoRoot, ".github/workflows/build.yml");

interface DesktopPackageJson {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  build: {
    publish?: { provider?: string; owner?: string; repo?: string };
    nsis?: {
      artifactName?: string;
      multiLanguageInstaller?: boolean;
      installerLanguages?: string[];
      displayLanguageSelector?: boolean;
      include?: string;
    };
  };
}

function readPkg(): DesktopPackageJson {
  return JSON.parse(
    readFileSync(join(desktopDir, "package.json"), "utf-8"),
  ) as DesktopPackageJson;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("发布端配置门规(自动更新的地基)", () => {
  it("build.publish 指向正式仓库 —— 没有它就没有 app-update.yml,客户端不知道去哪查", () => {
    expect(readPkg().build.publish).toEqual({
      provider: "github",
      owner: "mingjianliu",
      repo: "gladlog",
    });
  });

  it("package:win / package:mac 都带 --publish never —— 否则 tag 构建在 CI 上没有 GH_TOKEN 会 EXIT=1,writeUpdateInfoFiles 排在 awaitTasks() 之后,latest*.yml 连写都没写出来", () => {
    // 2026-08-03 复核轮实测(env -u GH_TOKEN -u GITHUB_TOKEN CI=true
    // GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v0.1.20 npx electron-builder --mac
    // zip): 没有 --publish never 时 EXIT=1「GitHub Personal Access Token is
    // not set」,dist-app 里连 latest-mac.yml 都没有;加上之后 EXIT=0 且
    // latest-mac.yml 正常产出(version/path/sha512 俱全)。
    const scripts = readPkg().scripts;
    expect(scripts["package:win"]).toContain("--publish never");
    expect(scripts["package:mac"]).toContain("--publish never");
    // Not GH_TOKEN: that would make electron-builder create its own release
    // and race the workflow's softprops step for the same tag.
    expect(scripts["package:win"]).not.toContain("GH_TOKEN");
    expect(scripts["package:mac"]).not.toContain("GH_TOKEN");
  });

  it("NSIS artifactName 无空格且过 isSafeGithubName —— latest.yml 的 path 必须与 Release 资产名逐字节相同", () => {
    const artifactName = readPkg().build.nsis?.artifactName ?? "";
    // Keep the pattern verbatim: electron-builder expands ${...} itself.
    expect(artifactName).toBe("${productName}.Setup.${version}.${ext}");
    expect(artifactName).not.toMatch(/\s/);
    // Same predicate as electron-builder's isSafeGithubName
    // (app-builder-lib/out/platformPackager.js:687-689). If the expanded name
    // fails it, computeSafeArtifactNameIfNeeded rewrites the name written into
    // latest.yml while the uploaded asset keeps another one → download 404.
    const expanded = artifactName
      .replace("${productName}", "gladlog")
      .replace("${version}", "0.1.20")
      .replace("${ext}", "exe");
    expect(expanded).toBe("gladlog.Setup.0.1.20.exe");
    expect(expanded).toMatch(/^[0-9A-Za-z._-]+$/);
  });

  it("electron-updater 在 dependencies 而不是 devDependencies", () => {
    // What actually matters is which list it is in, not the exact patch level:
    // externalizeDepsPlugin externalizes `dependencies` only, and
    // electron-builder only ships `dependencies` into the packaged node_modules.
    // The major is still pinned — a 6→7 breaking change should go red.
    const pkg = readPkg();
    expect(pkg.dependencies["electron-updater"]).toMatch(/^\^6\./);
    expect(pkg.devDependencies["electron-updater"]).toBeUndefined();
  });

  it("死配置 electron-builder.yml 已删除", () => {
    // package.json's `build` field wins; a stray electron-builder.yml is never
    // read, so anything written into it silently does nothing.
    expect(existsSync(join(desktopDir, "electron-builder.yml"))).toBe(false);
  });

  it("build.yml 两处 glob 都收窄成 latest*.yml 与 .blockmap(upload-artifact + release 各一)", () => {
    // Narrowed from the bare "*.yml" (see the next test for why): a bare glob
    // also matches builder-debug.yml, which every build produces (DebugLogger
    // defaults to enabled — app-builder-lib/out/packager.js:122 passes
    // log.isDebugEnabled, which is undefined, into a constructor whose default
    // parameter is `isEnabled = true`). Two matrix jobs (win + mac) would then
    // both try to upload a file with the exact same name to the same tag —
    // every other asset (exe/zip/dmg/blockmap) is disambiguated by platform
    // and version, only this one collides.
    const wf = readFileSync(workflowPath, "utf-8");
    expect(
      countOccurrences(wf, "packages/desktop/dist-app/latest*.yml"),
    ).toBeGreaterThanOrEqual(2);
    expect(
      countOccurrences(wf, "packages/desktop/dist-app/*.blockmap"),
    ).toBeGreaterThanOrEqual(2);
  });

  it("build.yml 不许出现裸 *.yml 或 .yaml 形态的宽 glob —— 前者会连 builder-debug.yml 一起传上 Release,后者会传含本机绝对路径的 builder-effective-config.yaml", () => {
    const wf = readFileSync(workflowPath, "utf-8");
    // Bare "dist-app/*.yml" (no "latest" prefix) is the one that actually
    // catches builder-debug.yml in this electron-builder version — assert it
    // is gone, not just that the narrowed form is present twice above.
    expect(wf).not.toContain("dist-app/*.yml");
    expect(wf).not.toContain(".y*ml");
    expect(wf).not.toContain(".yaml");
  });
});

describe("Windows 安装器语言(spec 2026-11-23 §6.6)", () => {
  const nshPath = join(desktopDir, "build/installer.nsh");
  // Comments stripped so a commented-out line cannot satisfy an assertion.
  const nshCode = (): string =>
    readFileSync(nshPath, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[;#].*$/, ""))
      .join("\n");

  it("build.nsis 开多语言安装器、只带 en_US / zh_CN、启动时让用户选语言、引入 installer.nsh", () => {
    // Option names checked against app-builder-lib 26.15.3
    // (out/targets/nsis/nsisOptions.d.ts: include / displayLanguageSelector /
    // installerLanguages / multiLanguageInstaller; nsisLang.js LangConfigurator).
    const nsis = readPkg().build.nsis;
    expect(nsis?.multiLanguageInstaller).toBe(true);
    expect(nsis?.installerLanguages).toEqual(["en_US", "zh_CN"]);
    // Without it NSIS silently picks the OS language and never asks
    // (installer.nsi only runs MUI_LANGDLL_DISPLAY under DISPLAY_LANG_SELECTOR).
    expect(nsis?.displayLanguageSelector).toBe(true);
    expect(nsis?.include).toBe("build/installer.nsh");
    expect(existsSync(nshPath)).toBe(true);
  });

  it("installer.nsh 在 customInstall 宏里把语言写进 $INSTDIR 下 main 读取的那个文件名", () => {
    const code = nshCode();
    expect(code).toMatch(/!macro\s+customInstall\b/);
    expect(code).toMatch(/!macroend/);
    // Same file name main reads (readInstallerLanguage) -- one source.
    expect(code).toContain(`"$INSTDIR\\${INSTALLER_LANGUAGE_FILE}"`);
    // 2052 = zh-CN LCID → "zh"; everything else → "en".
    expect(code).toMatch(/\$LANGUAGE\s*==?\s*2052/);
    expect(code).toMatch(/"zh"/);
    expect(code).toMatch(/"en"/);
  });

  /** True when every File* line (FileOpen / FileWrite / FileClose) sits
   * inside the `${IfNot} ${Silent}` … matching `${EndIf}` block, matched by
   * LogicLib nesting depth (`${If}` / `${IfNot}` / `${Unless}` open,
   * `${EndIf}` closes; `${Else}` / `${ElseIf}` keep the depth). Order alone is
   * not enough: a write after the guard's `${EndIf}` still runs on /S. */
  const fileOpsInsideSilentGuard = (code: string): boolean => {
    const lines = code.split("\n").map((l) => l.trim());
    const start = lines.findIndex((l) =>
      /^\$\{IfNot\}\s+\$\{Silent\}$/.test(l),
    );
    if (start < 0) return false;
    let depth = 0;
    let end = -1;
    for (let i = start; i < lines.length; i++) {
      if (/^\$\{(If|IfNot|Unless)\}/.test(lines[i]!)) depth++;
      else if (/^\$\{EndIf\}/.test(lines[i]!)) depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) return false;
    const ops = lines.flatMap((l, i) =>
      /^File(Open|Write|Close)\b/.test(l) ? [i] : [],
    );
    return ops.length > 0 && ops.every((i) => i > start && i < end);
  };

  it("静默安装(自动更新)不写文件 —— 静默时 $LANGUAGE 是没人选过的默认值", () => {
    expect(fileOpsInsideSilentGuard(nshCode())).toBe(true);
  });

  it("静默守卫判据的变异自检:写文件挪到 ${EndIf} 之后 / 没有守卫 / 守卫没闭合 都判不过", () => {
    const ok = [
      "${IfNot} ${Silent}",
      "  ${If} $LANGUAGE == 2052",
      '    StrCpy $0 "zh"',
      "  ${Else}",
      '    StrCpy $0 "en"',
      "  ${EndIf}",
      '  FileOpen $1 "$INSTDIR\\x.txt" w',
      "  ${IfNot} ${Errors}",
      "    FileWrite $1 $0",
      "    FileClose $1",
      "  ${EndIf}",
      "${EndIf}",
    ];
    expect(fileOpsInsideSilentGuard(ok.join("\n"))).toBe(true);
    // FileOpen moved below the guard's closing ${EndIf}: still after the
    // guard in text order (the old check passed this), but it runs on /S.
    const movedOut = [...ok.slice(0, 6), ...ok.slice(7), ok[6]!];
    expect(fileOpsInsideSilentGuard(movedOut.join("\n"))).toBe(false);
    // The whole write block after the guard closes early.
    const closedEarly = [...ok.slice(0, 6), "${EndIf}", ...ok.slice(6, 11)];
    expect(fileOpsInsideSilentGuard(closedEarly.join("\n"))).toBe(false);
    // No guard at all.
    expect(fileOpsInsideSilentGuard(ok.slice(1, 11).join("\n"))).toBe(false);
    // Guard never closed.
    expect(fileOpsInsideSilentGuard(ok.slice(0, 11).join("\n"))).toBe(false);
  });
});
