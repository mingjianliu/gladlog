import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsStore } from "../src/main/settingsStore";

const dir = () => mkdtempSync(join(tmpdir(), "gl-settings-"));

describe("SettingsStore", () => {
  it("缺失文件 → 默认值", () => {
    const s = new SettingsStore(join(dir(), "settings.json"));
    expect(s.get()).toEqual({
      wowDirectory: null,
      anthropicApiKey: null,
      anthropicModel: null,
    });
  });
  it("save 合并并持久化;文件为合法 JSON", () => {
    const p = join(dir(), "settings.json");
    const s = new SettingsStore(p);
    expect(s.save({ wowDirectory: "/tmp/wow" }).wowDirectory).toBe("/tmp/wow");
    expect(new SettingsStore(p).get().wowDirectory).toBe("/tmp/wow");
    expect(JSON.parse(readFileSync(p, "utf-8")).anthropicApiKey).toBeNull();
  });
  it("损坏 JSON → 回退默认,不抛", () => {
    const p = join(dir(), "settings.json");
    writeFileSync(p, "{not json");
    expect(new SettingsStore(p).get().wowDirectory).toBeNull();
  });
});
