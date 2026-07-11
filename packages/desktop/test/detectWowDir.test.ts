import {
  detectWowDirCandidates,
  resolveLogsDir,
  type FsProbe,
} from "../src/main/detectWowDir";

const probeOf = (existing: string[]): FsProbe => ({
  exists: (p) => existing.includes(p),
});

describe("detectWowDirCandidates", () => {
  it("win32:目录+Logs 都存在才返回", () => {
    const probe = probeOf([
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Logs",
      "C:\\Program Files\\World of Warcraft\\_retail_", // 无 Logs
    ]);
    expect(detectWowDirCandidates({ platform: "win32", probe })).toEqual([
      "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
    ]);
  });
  it("darwin → []", () => {
    expect(
      detectWowDirCandidates({ platform: "darwin", probe: probeOf([]) }),
    ).toEqual([]);
  });
});

describe("resolveLogsDir", () => {
  it("含 Logs 子目录 → 指向 Logs", () => {
    const probe = probeOf(["/x/_retail_/Logs"]);
    expect(resolveLogsDir("/x/_retail_", probe)).toBe("/x/_retail_/Logs");
  });
  it("不含 → 用原目录", () => {
    expect(resolveLogsDir("/y/mylogs", probeOf([]))).toBe("/y/mylogs");
  });
});
