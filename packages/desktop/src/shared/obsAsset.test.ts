import { describe, expect, it } from "vitest";

import {
  MANAGED_WS_PORT,
  OBS_VERSION,
  OBS_ZIP_BYTES,
  OBS_ZIP_SHA256,
  OBS_ZIP_URL,
  shouldExtract,
} from "./obsAsset";

describe("obsAsset constants", () => {
  it("pins the verified release identity", () => {
    expect(OBS_VERSION).toBe("32.2.1");
    expect(OBS_ZIP_URL).toBe(
      "https://github.com/obsproject/obs-studio/releases/download/32.2.1/OBS-Studio-32.2.1-Windows-x64.zip",
    );
    expect(OBS_ZIP_SHA256).toBe(
      "db64a2934f8261f85b1410b84be011207a0afda5400d008289f1f1e211bcc7de",
    );
    expect(OBS_ZIP_BYTES).toBe(187_817_017);
    expect(MANAGED_WS_PORT).toBe(4466);
  });
});

describe("shouldExtract", () => {
  const extracted = [
    "bin/64bit/obs64.exe",
    "obs-plugins/64bit/win-capture.dll",
    "data/obs-plugins/win-capture/graphics-hook64.dll",
    "bin/64bit/obs-ffmpeg-mux.exe",
    "data/obs-studio/locale/zh-CN.ini",
  ];
  const skipped = [
    "bin/64bit/obs64.pdb",
    "obs-plugins/64bit/libcef.dll",
    "obs-plugins/64bit/locales/af.pak",
    "data/obs-scripting/obslua.dll",
    "data/obs-studio/locale/fr-FR.ini",
  ];

  it.each(extracted)("extracts %s", (p) => {
    expect(shouldExtract(p)).toBe(true);
  });

  it.each(skipped)("skips %s", (p) => {
    expect(shouldExtract(p)).toBe(false);
  });

  it("normalizes backslash paths from a win32 directory walk before matching", () => {
    expect(shouldExtract("bin\\64bit\\obs64.exe")).toBe(true);
    expect(shouldExtract("obs-plugins\\64bit\\libcef.dll")).toBe(false);
  });
});
