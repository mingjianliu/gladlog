import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { vi } from "vitest";
import { createIconCache } from "../src/main/iconCache";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function fakeFetch(status: number, body?: Buffer) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => {
      const b = body ?? Buffer.alloc(0);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  })) as unknown as typeof fetch;
}

describe("createIconCache", () => {
  it("盘缓存命中:不 fetch,直接 data URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-icon-"));
    writeFileSync(join(dir, "spell_holy_renew.jpg"), PNG_BYTES);
    const f = fakeFetch(200);
    const cache = createIconCache({ cacheDir: dir, fetchImpl: f });
    const url = await cache.get("spell_holy_renew");
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(f).not.toHaveBeenCalled();
  });

  it("未命中:拉取成功 → 落盘 + data URL;二次调用走盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-icon-"));
    const f = fakeFetch(200, PNG_BYTES);
    const cache = createIconCache({ cacheDir: dir, fetchImpl: f });
    const url = await cache.get("ability_rogue_smoke");
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(existsSync(join(dir, "ability_rogue_smoke.jpg"))).toBe(true);
    expect(readFileSync(join(dir, "ability_rogue_smoke.jpg"))).toEqual(
      PNG_BYTES,
    );
    await cache.get("ability_rogue_smoke");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("拉取失败 → null、不落盘、会话内同名不重试;非法名拒绝", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-icon-"));
    const f = fakeFetch(404);
    const cache = createIconCache({ cacheDir: dir, fetchImpl: f });
    expect(await cache.get("no_such_icon")).toBeNull();
    expect(await cache.get("no_such_icon")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, "no_such_icon.jpg"))).toBe(false);
    expect(await cache.get("../etc/passwd")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("会话拉取预算:超限后不再 fetch(防 renderer 滥用)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-icon-"));
    const f = fakeFetch(200, PNG_BYTES);
    const cache = createIconCache({
      cacheDir: dir,
      fetchImpl: f,
      maxFetchesPerSession: 2,
    });
    expect(await cache.get("icon_a")).not.toBeNull();
    expect(await cache.get("icon_b")).not.toBeNull();
    expect(await cache.get("icon_c")).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
});
