import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadCheckpoints, saveCheckpoints } from "../src/worker/checkpoints";

const p = () => join(mkdtempSync(join(tmpdir(), "gl-cp-")), "checkpoints.json");

describe("checkpoints registry", () => {
  it("缺失 → 空 registry", () => {
    expect(loadCheckpoints(p())).toEqual({ files: {} });
  });
  it("save→load 往返", () => {
    const path = p();
    const reg = {
      files: { "WoWCombatLog-1.txt": { offset: 42, firstLineChecksum: "ab" } },
    };
    saveCheckpoints(path, reg);
    expect(loadCheckpoints(path)).toEqual(reg);
  });
  it("损坏 JSON → 空 registry,不抛", () => {
    const path = p();
    writeFileSync(path, "garbage");
    expect(loadCheckpoints(path)).toEqual({ files: {} });
  });
});
