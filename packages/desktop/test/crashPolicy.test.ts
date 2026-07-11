import { nextCrashRecord } from "../src/main/crashPolicy";

describe("nextCrashRecord", () => {
  it("无归因信息 → count 1,不隔离", () => {
    const r = nextCrashRecord(null, null);
    expect(r.record.count).toBe(1);
    expect(r.quarantine).toBeNull();
  });
  it("同文件近偏移连续 3 次 → 隔离该文件", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 1000 });
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 1500 });
    expect(r.quarantine).toBeNull();
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 2000 });
    expect(r.quarantine).toBe("a.txt");
  });
  it("换文件 → 计数重置", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 0 });
    r = nextCrashRecord(r.record, { fileKey: "b.txt", offset: 0 });
    expect(r.record.count).toBe(1);
    expect(r.quarantine).toBeNull();
  });
  it("同文件远偏移(> tolerance)→ 计数重置(有进展,不是同一毒丸)", () => {
    let r = nextCrashRecord(null, { fileKey: "a.txt", offset: 0 });
    r = nextCrashRecord(r.record, { fileKey: "a.txt", offset: 1_000_000 });
    expect(r.record.count).toBe(1);
  });
});
