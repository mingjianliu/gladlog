import { describe, expect, it } from "vitest";
import { buildRcloneCopyArgs, parseListRemotes } from "./driveSync";

describe("buildRcloneCopyArgs", () => {
  it("裸 copy(不带 --ignore-existing,manifest 要能重传);DRY_RUN 追加 --dry-run", () => {
    const base = buildRcloneCopyArgs({
      src: "/x/downloads",
      remote: "gdrive",
      dest: "gladlog-pvp-logs",
      dryRun: false,
    });
    expect(base.slice(0, 3)).toEqual([
      "copy",
      "/x/downloads",
      "gdrive:gladlog-pvp-logs",
    ]);
    expect(base).not.toContain("--ignore-existing");
    expect(base).not.toContain("--dry-run");
    expect(
      buildRcloneCopyArgs({
        src: "/x",
        remote: "g",
        dest: "d",
        dryRun: true,
      }),
    ).toContain("--dry-run");
  });

  it("progress 缺省开(交互);无人值守显式 false 才去掉 --progress", () => {
    const cfg = { src: "/x", remote: "g", dest: "d", dryRun: false };
    expect(buildRcloneCopyArgs(cfg)).toContain("--progress");
    expect(buildRcloneCopyArgs({ ...cfg, progress: true })).toContain(
      "--progress",
    );
    expect(buildRcloneCopyArgs({ ...cfg, progress: false })).not.toContain(
      "--progress",
    );
  });
});

describe("parseListRemotes", () => {
  it("剥行尾冒号;空输出/杂行容错", () => {
    expect(parseListRemotes("gdrive:\nbackup:\n")).toEqual([
      "gdrive",
      "backup",
    ]);
    expect(parseListRemotes("")).toEqual([]);
    expect(parseListRemotes("warning: something\n")).toEqual([]);
  });
});
