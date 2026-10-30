import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";

import {
  type SafeStorageLike,
  SettingsStore,
  type SettingsStoreWarning,
} from "./settingsStore";

/** Real encryption is unavailable here; the fake is just a reversible marker
 * transform, which is enough to verify the shape and round-trip logic. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => Buffer.from(`ENC(${plainText})`),
    decryptString: (buf: Buffer) => {
      const s = buf.toString();
      const m = /^ENC\((.*)\)$/.exec(s);
      if (!m) throw new Error("corrupt ciphertext");
      return m[1];
    },
  };
}

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "gl-settings-")), "settings.json");
}

describe("SettingsStore + safeStorage", () => {
  it("encrypt-on-save: 落盘是 {__enc} 形状,不是明文", () => {
    const path = tmpPath();
    const store = new SettingsStore(path, fakeSafeStorage());
    store.save({ anthropicApiKey: "sk-secret" });
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.anthropicApiKey).not.toBe("sk-secret");
    expect(onDisk.anthropicApiKey).toEqual({ __enc: expect.any(String) });
    expect(typeof onDisk.anthropicApiKey.__enc).toBe("string");
  });

  it("load 解密:save 后 get() 拿回明文", () => {
    const path = tmpPath();
    const store = new SettingsStore(path, fakeSafeStorage());
    store.save({
      anthropicApiKey: "sk-secret",
      deepseekApiKey: "ds-secret",
      obsWebsocketPassword: "hunter2",
    });
    const v = store.get();
    expect(v.anthropicApiKey).toBe("sk-secret");
    expect(v.deepseekApiKey).toBe("ds-secret");
    expect(v.obsWebsocketPassword).toBe("hunter2");
  });

  // task-6 三件套之一(复核 I14) —— 这是关闭托管密码明文落盘洞的判据:此前
  // index.ts 用结构性 cast 绕过 SECRET_FIELDS 写 managedWsPassword,落盘就是
  // 裸字符串(跟 #21 item7 之前的 anthropicApiKey 一样)。现在它必须走跟另外
  // 三个密钥字段完全相同的 encrypt-on-save/decrypt-on-read 路径。
  it("encrypt-on-save: managedWsPassword 落盘是 {__enc} 形状,不是明文 —— 关闭托管密码明文落盘的洞", () => {
    const path = tmpPath();
    const store = new SettingsStore(path, fakeSafeStorage());
    store.save({ managedWsPassword: "genpw-32hex" });
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.managedWsPassword).not.toBe("genpw-32hex");
    expect(onDisk.managedWsPassword).toEqual({ __enc: expect.any(String) });
    expect(store.get().managedWsPassword).toBe("genpw-32hex");
  });

  it("旧版明文迁移:明文可以直接读出,该字段本身被 save 时才变成加密", () => {
    const path = tmpPath();
    // Hand-write a legacy plaintext settings.json (never written by this class).
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ anthropicApiKey: "legacy-plain" }));
    const store = new SettingsStore(path, fakeSafeStorage());

    // Before migration: the plaintext reads back directly, losslessly.
    expect(store.get().anthropicApiKey).toBe("legacy-plain");

    // Migration only happens when the field itself appears in the patch (an
    // unchanged value still counts as "appearing").
    store.save({ anthropicApiKey: "legacy-plain" });
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.anthropicApiKey).toEqual({ __enc: expect.any(String) });
    // And it still decrypts to the original value — no data loss.
    expect(store.get().anthropicApiKey).toBe("legacy-plain");
  });

  it("回归(复核 Critical):旧版明文字段未被 patch 触及时,无关 save() 不强制迁移", () => {
    const path = tmpPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ anthropicApiKey: "legacy-plain" }));
    const store = new SettingsStore(path, fakeSafeStorage());

    store.save({ wowDirectory: "/wow" }); // an unrelated field
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    // Not hit by the patch — the plaintext is kept byte-for-byte, neither
    // encrypted in passing nor, ever, cleared.
    expect(onDisk.anthropicApiKey).toBe("legacy-plain");
    expect(store.get().anthropicApiKey).toBe("legacy-plain");
  });

  it("回归(复核 Critical,红→绿 1/2):无关 save() 不清空磁盘上损坏的密文——原样保留,不因解密失败被抹成空串", () => {
    const path = tmpPath();
    mkdirSync(dirname(path), { recursive: true });
    const corrupt = { __enc: "not-valid-ciphertext" };
    writeFileSync(path, JSON.stringify({ anthropicApiKey: corrupt }));
    const store = new SettingsStore(path, fakeSafeStorage(true));

    store.save({ wowDirectory: "/wow" }); // an unrelated field; anthropicApiKey untouched
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.anthropicApiKey).toEqual(corrupt); // kept byte-for-byte
  });

  it("回归(复核 Critical,红→绿 2/2):无关 save() 不清空磁盘上合法的密文,即便当下 safeStorage 暂时不可用(如锁屏钥匙串)", () => {
    const path = tmpPath();
    const writeStore = new SettingsStore(path, fakeSafeStorage(true));
    writeStore.save({ anthropicApiKey: "sk-secret" });
    const before = JSON.parse(readFileSync(path, "utf-8"));
    expect(before.anthropicApiKey).toEqual({ __enc: expect.any(String) });

    // Same file, but do the unrelated save() through a store instance whose
    // safeStorage is currently unavailable.
    const lockedStore = new SettingsStore(path, fakeSafeStorage(false));
    lockedStore.save({ wowDirectory: "/wow" });
    const after = JSON.parse(readFileSync(path, "utf-8"));
    expect(after.anthropicApiKey).toEqual(before.anthropicApiKey); // kept byte-for-byte
  });

  it("回归(复核 Critical):patch 命中的密钥字段仍正常加密新值,其余密钥字段原样保留", () => {
    const path = tmpPath();
    const store = new SettingsStore(path, fakeSafeStorage(true));
    store.save({ anthropicApiKey: "sk-1", deepseekApiKey: "ds-1" });
    const before = JSON.parse(readFileSync(path, "utf-8"));

    store.save({ anthropicApiKey: "sk-2" }); // only anthropic changes
    const after = JSON.parse(readFileSync(path, "utf-8"));
    expect(after.anthropicApiKey).not.toEqual(before.anthropicApiKey);
    expect(store.get().anthropicApiKey).toBe("sk-2");
    // deepseekApiKey, untouched by this patch, is kept as-is (the same
    // ciphertext, not re-encrypted).
    expect(after.deepseekApiKey).toEqual(before.deepseekApiKey);
    expect(store.get().deepseekApiKey).toBe("ds-1");
  });

  it("safeStorage 不可用:保持明文行为 + 恰好一次 warn", () => {
    const path = tmpPath();
    const warns: SettingsStoreWarning[] = [];
    const store = new SettingsStore(path, fakeSafeStorage(false), (w) =>
      warns.push(w),
    );
    store.save({ anthropicApiKey: "sk-secret" });
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.anthropicApiKey).toBe("sk-secret"); // written as plaintext
    expect(store.get().anthropicApiKey).toBe("sk-secret");

    // Saving a secret field again must not warn a second time.
    store.save({ deepseekApiKey: "ds-secret" });
    const unavailableWarnings = warns.filter(
      (w) => w.kind === "encryption-unavailable",
    );
    expect(unavailableWarnings).toHaveLength(1);
  });

  it("解密失败(损坏值/密钥库变更):降级空串 + warn,不抛出", () => {
    const path = tmpPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ anthropicApiKey: { __enc: "not-valid-ciphertext" } }),
    );
    const warns: SettingsStoreWarning[] = [];
    const store = new SettingsStore(path, fakeSafeStorage(true), (w) =>
      warns.push(w),
    );
    let v: ReturnType<typeof store.get> | undefined;
    expect(() => {
      v = store.get();
    }).not.toThrow();
    expect(v?.anthropicApiKey).toBe("");
    expect(warns.some((w) => w.kind === "decrypt-failed")).toBe(true);
  });

  it("哨兵往返在加密存储上依然成立(redact/sanitize 作用于解密后的明文)", async () => {
    const { redactSettings, sanitizeSettingsPatch } =
      await import("./settingsStore");
    const { OBS_PASSWORD_REDACTED } = await import("../shared/protocol");
    const path = tmpPath();
    const store = new SettingsStore(path, fakeSafeStorage());
    store.save({ obsWebsocketPassword: "hunter2" });
    const decrypted = store.get();
    expect(redactSettings(decrypted).obsWebsocketPassword).toBe(
      OBS_PASSWORD_REDACTED,
    );
    // The sentinel value must not be written back as a new password,
    // overwriting the stored encrypted value.
    const patch = sanitizeSettingsPatch({
      obsWebsocketPassword: OBS_PASSWORD_REDACTED,
    });
    expect(patch).not.toHaveProperty("obsWebsocketPassword");
    store.save(patch);
    expect(store.get().obsWebsocketPassword).toBe("hunter2");
  });

  it("未注入 safeStorage 时默认降级为明文(向后兼容既有调用方)", () => {
    const path = tmpPath();
    const store = new SettingsStore(path); // no second argument → the NOOP stand-in
    store.save({ anthropicApiKey: "sk-secret" });
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.anthropicApiKey).toBe("sk-secret");
    expect(store.get().anthropicApiKey).toBe("sk-secret");
  });
});
