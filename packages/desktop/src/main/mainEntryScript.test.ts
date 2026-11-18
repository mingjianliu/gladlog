import { join } from "path";

import { mainEntryScript } from "./mainEntryScript";

// pipeline T220: matchStore is emitted as a shared chunk (out/main/chunks/),
// one level below the worker entries it spawns (out/main/*.js).
describe("mainEntryScript", () => {
  const OUT = join("/app", "out", "main");
  const built = (p: string) =>
    p === join(OUT, "slimWorker.js") || p === join(OUT, "roundsIdxWorker.js");

  it("模块就在 out/main/ 里:取同目录的入口", () => {
    expect(mainEntryScript(OUT, "slimWorker.js", built)).toBe(
      join(OUT, "slimWorker.js"),
    );
  });

  it("模块被打进 out/main/chunks/:入口在上一层", () => {
    const chunks = join(OUT, "chunks");
    expect(mainEntryScript(chunks, "slimWorker.js", built)).toBe(
      join(OUT, "slimWorker.js"),
    );
    expect(mainEntryScript(chunks, "roundsIdxWorker.js", built)).toBe(
      join(OUT, "roundsIdxWorker.js"),
    );
  });

  it("两处都没有(vitest 直接跑 src):回到同目录路径,由调用方的尽力而为兜住", () => {
    const src = join("/app", "src", "main");
    expect(mainEntryScript(src, "slimWorker.js", () => false)).toBe(
      join(src, "slimWorker.js"),
    );
  });
});
