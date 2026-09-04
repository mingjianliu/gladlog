import { mkdirSync, readFileSync } from "fs";
import { dirname } from "path";

import {
  AI_BACKENDS,
  type AiBackend,
  type AiModelSelection,
  isKnownModel,
} from "../shared/aiModels";
import { atomicWriteFileSync } from "../shared/atomicWrite";
import {
  MANAGED_OBS_PREF_DEFAULTS,
  MANAGED_OBS_PREF_KEYS,
  type ManagedObsPrefs,
} from "../shared/managedObsPrefs";
import { clampUiZoom, UI_ZOOM_DEFAULT } from "../shared/uiZoom";

export type { AiBackend, AiModelSelection };
export type AiLanguage = "zh" | "en";
const AI_LANGUAGES: AiLanguage[] = ["zh", "en"];

export interface GladlogSettings {
  wowDirectory: string | null;
  anthropicApiKey: string | null;
  /** Key for the official DeepSeek API (aiBackend="deepseek"); redaction and
   * sentinel handling are the same as for anthropic. */
  deepseekApiKey: string | null;
  /** Model remembered per backend; always use resolveAiModel to get the
   * currently effective value. */
  aiModels: AiModelSelection;
  // Debug: route LLM calls to a local CLI instead of the Anthropic API.
  aiBackend: AiBackend;
  aiBackendCommand: string | null;
  /** Output language of coach replies (backlog #1); defaults to Chinese, to
   * match the UI. */
  aiLanguage: AiLanguage;
  /** Auto-analyze new matches (2026-08-01): once a live-watched new match is
   * stored, analyze it automatically with the current default model;
   * historical imports do not trigger it (the discriminator is the `live`
   * flag on the matchStored payload). */
  autoAnalyzeNew: boolean;
  // -- OBS externally driven recording (2026-07-28, track C phase 1) --
  recordingEnabled: boolean;
  /** null -> use DEFAULT_OBS_WS_URL for connecting / as the placeholder. */
  obsWebsocketUrl: string | null;
  obsWebsocketPassword: string | null;
  /** Keep the most recent N MATCHES, not recordings/chunks (review Important
   * #5, 2026-08-03: a chunk carrying several matches -- design doc 4.3 --
   * consumes several slots, so "recordings" here was the wrong unit; the UI
   * copy already says "最近 N 场" correctly). Anything beyond is deleted
   * together with its video file; 0 = count gate off -- the byte fuse
   * (recordingMaxBytes) and the orphan cap still apply (a fuse you can switch
   * off is not a fuse; design doc 4.2, behaviour change 2026-08-02). */
  recordingKeepCount: number;
  /** Hard disk fuse for the recordings directory. Deliberately looser than the
   * worst case of recordingKeepCount (15Mbps x 10min ~= 1.1GB/match x 50 ~=
   * 55GB), so the count gate is what normally bites and this only catches
   * unusually large chunks. Design doc 4.2 -- user decision 2026-08-02. */
  recordingMaxBytes: number;
  /** "managed"(默认)| "external"。非 win32 上 UI 禁用 managed 并说明,
   * 解析谓词(isManagedActive)恒判 external 语义 —— 即 mac 用户仍可用一期的
   * 自有 OBS 外控。这与设计 §8 的「非 win32 强制 recordingEnabled=false」是
   * 【有意偏离】:保留 mac 的旁路能力更合理,偏离在此声明(task-6 复核 I15)。
   * 存储默认值始终是 "managed"(即便当前机器是 mac)—— 这样同一份 settings.json
   * 换到 Windows 机器上就自动获得托管录像,不需要用户重新选一次。 */
  recordingMode: "managed" | "external";
  /** 托管 OBS 实例自己的 websocket 密码(与 obsWebsocketPassword ——
   * 用户自己 OBS 的密码 —— 是两个不同字段)。默认 null,首次启用托管录像时
   * 随机生成(index.ts 的 resolveManagedWsPassword)。三件套(复核 I14):
   * SECRET_FIELDS / redactSettings / sanitizeSettingsPatch 三处都要照
   * obsWebsocketPassword 的既有形状处理,一条都不能少 —— 否则明文落盘 /
   * 明文过 IPC 进 renderer / 哨兵被当真密码回写。 */
  managedWsPassword: string | null;
  /** Managed-OBS user prefs (2026-09-04): recording directory + the two
   * audio devices. Shape, defaults and the "needs a restart" predicate live
   * in shared/managedObsPrefs.ts; this interface only extends it so the
   * three keys are ordinary GladlogSettings fields (settings:get/save, the
   * settings page, the sanitizer). */
  recordingDirectory: ManagedObsPrefs["recordingDirectory"];
  managedDesktopAudioDevice: ManagedObsPrefs["managedDesktopAudioDevice"];
  managedMicDevice: ManagedObsPrefs["managedMicDevice"];
  // -- Auto-update (2026-08-02, Windows NSIS installs only) --
  /** Escape hatch for the 30s/4h background check. Turning it off only stops
   * the scheduled polling: the "check for updates" button in settings still
   * works, otherwise this switch would kill the feature outright. */
  autoCheckUpdates: boolean;
  /** Version the user has already been told about. Compared against
   * app.getVersion() on startup so a silent background update can leave a
   * visible trace ("updated to 0.1.20"); null means never shown. The
   * comparison itself lives in exactly one place --
   * renderer/src/update/updateBridge.ts -- never inline in a component. */
  lastSeenVersion: string | null;
  // -- UI scale (界面缩放) --
  /** webFrame.setZoomFactor multiplier; 1 = 100%. The renderer applies it at
   * mount and again the instant the setting changes, so the control previews
   * itself. Never read this field raw: run it through clampUiZoom first (get()
   * below already does), because a settings.json written by hand can hold
   * 0/negative/NaN and a 0 factor collapses the window into something the user
   * cannot click their way out of. */
  uiZoom: number;
}
const DEFAULTS: GladlogSettings = {
  wowDirectory: null,
  anthropicApiKey: null,
  deepseekApiKey: null,
  aiModels: {},
  aiBackend: "anthropic",
  aiBackendCommand: null,
  aiLanguage: "zh",
  autoAnalyzeNew: false,
  recordingEnabled: false,
  obsWebsocketUrl: null,
  obsWebsocketPassword: null,
  recordingKeepCount: 50,
  recordingMaxBytes: 80 * 1024 ** 3,
  recordingMode: "managed",
  managedWsPassword: null,
  ...MANAGED_OBS_PREF_DEFAULTS,
  autoCheckUpdates: true,
  lastSeenVersion: null,
  uiZoom: UI_ZOOM_DEFAULT,
};

/** v0.0.15 and earlier stored a single anthropicModel field; migrate it into
 * aiModels.anthropic on read. */
interface LegacySettings {
  anthropicModel?: string | null;
}
function migrateLegacyModel(raw: Partial<GladlogSettings> & LegacySettings): {
  aiModels?: AiModelSelection;
} {
  const legacy = raw.anthropicModel;
  if (!legacy || raw.aiModels?.anthropic) return {};
  // The old field was free text and could be any string -- migrate only if it
  // is on the whitelist, otherwise drop it and fall back to the default.
  return isKnownModel("anthropic", legacy)
    ? { aiModels: { ...raw.aiModels, anthropic: legacy } }
    : {};
}

// Keys exist only in the main process; at the IPC boundary the real value is
// always replaced by a sentinel (the renderer only needs truthiness).
export {
  API_KEY_REDACTED,
  DEEPSEEK_KEY_REDACTED,
  OBS_PASSWORD_REDACTED,
  MANAGED_WS_PASSWORD_REDACTED,
} from "../shared/protocol";
import {
  API_KEY_REDACTED,
  DEEPSEEK_KEY_REDACTED,
  OBS_PASSWORD_REDACTED,
  MANAGED_WS_PASSWORD_REDACTED,
} from "../shared/protocol";

export function redactSettings(s: GladlogSettings): GladlogSettings {
  return {
    ...s,
    anthropicApiKey: s.anthropicApiKey ? API_KEY_REDACTED : null,
    deepseekApiKey: s.deepseekApiKey ? DEEPSEEK_KEY_REDACTED : null,
    obsWebsocketPassword: s.obsWebsocketPassword ? OBS_PASSWORD_REDACTED : null,
    managedWsPassword: s.managedWsPassword
      ? MANAGED_WS_PASSWORD_REDACTED
      : null,
  };
}

export function sanitizeSettingsPatch(
  partial: Partial<GladlogSettings>,
): Partial<GladlogSettings> {
  let out = partial;
  if (out.anthropicApiKey === API_KEY_REDACTED) {
    const { anthropicApiKey: _redacted, ...rest } = out;
    out = rest;
  }
  if (out.obsWebsocketPassword === OBS_PASSWORD_REDACTED) {
    const { obsWebsocketPassword: _redacted, ...rest } = out;
    out = rest;
  }
  if (out.managedWsPassword === MANAGED_WS_PASSWORD_REDACTED) {
    const { managedWsPassword: _redacted, ...rest } = out;
    out = rest;
  }
  if (out.deepseekApiKey === DEEPSEEK_KEY_REDACTED) {
    const { deepseekApiKey: _redacted, ...rest } = out;
    out = rest;
  }
  if (
    out.recordingKeepCount !== undefined &&
    (!Number.isFinite(out.recordingKeepCount) || out.recordingKeepCount < 0)
  ) {
    const { recordingKeepCount: _bad, ...rest } = out;
    out = rest;
  }
  // <= 0 (not < 0): unlike recordingKeepCount, 0 is not a legal "gate off"
  // value here -- prune() treats a non-positive/non-finite maxBytes as "byte
  // gate off" defensively (fail-safe against a hand-edited settings.json
  // bypassing this sanitizer entirely on read), but the UI/IPC save path must
  // still reject 0 outright so it can never be set through the product.
  if (
    out.recordingMaxBytes !== undefined &&
    (!Number.isFinite(out.recordingMaxBytes) || out.recordingMaxBytes <= 0)
  ) {
    const { recordingMaxBytes: _bad, ...rest } = out;
    out = rest;
  }
  // Managed-OBS prefs: each is `string | null`. A non-string non-null value
  // (hand-edited JSON, an older/newer renderer) is dropped; a blank string
  // is normalised to null so "cleared the box" and "never set" are the same
  // stored fact (resolveRecordingDir treats both as the default anyway, and
  // an empty device_id would be written into the scene collection verbatim
  // — OBS has no such device).
  for (const key of MANAGED_OBS_PREF_KEYS) {
    const v = out[key];
    if (v === undefined) continue;
    if (v === null) continue;
    if (typeof v !== "string") {
      const { [key]: _bad, ...rest } = out;
      out = rest;
    } else if (v.trim() === "") {
      out = { ...out, [key]: null };
    }
  }
  // Reject an unknown aiBackend value rather than persisting garbage.
  if (out.aiBackend !== undefined && !AI_BACKENDS.includes(out.aiBackend)) {
    const { aiBackend: _bad, ...rest } = out;
    out = rest;
  }
  if (out.aiLanguage !== undefined && !AI_LANGUAGES.includes(out.aiLanguage)) {
    const { aiLanguage: _bad, ...rest } = out;
    out = rest;
  }
  // Same treatment as recordingKeepCount: an out-of-range or non-numeric zoom
  // is dropped rather than persisted, so save() keeps the previous good value
  // instead of writing a factor that would make the app unusable. The dropped
  // set is defined by the shared clamp, not by a second hand-written range
  // check -- clampUiZoom(x) !== x is exactly "this value is not legal".
  if (out.uiZoom !== undefined && clampUiZoom(out.uiZoom) !== out.uiZoom) {
    const { uiZoom: _bad, ...rest } = out;
    out = rest;
  }
  // Models: validate each slot against its backend whitelist and drop unknown
  // ids rather than rejecting the whole block -- the dropdown can only produce
  // legal values, so an illegal value reaching here comes from a hand-edited
  // config or leftovers from an older version.
  if (out.aiModels !== undefined) {
    const clean: AiModelSelection = {};
    for (const backend of AI_BACKENDS) {
      const id = out.aiModels?.[backend];
      if (id && isKnownModel(backend, id)) clean[backend] = id;
    }
    out = { ...out, aiModels: clean };
  }
  return out;
}

// -- #21 item7: encrypt secrets at rest (Electron safeStorage, OS keychain) --
//
// settingsStore.ts itself stays electron-free (so it can be unit tested in
// plain node); the real safeStorage is injected by the caller
// (main/index.ts), and tests inject a fake.
//
// On-disk shape: the three secret fields (anthropicApiKey / deepseekApiKey /
// obsWebsocketPassword) are stored encrypted as `{ __enc: "<base64>" }` -- a
// legal plaintext password is necessarily a string in the GladlogSettings
// type and can never become "an object whose only key is __enc", so this tag
// shape cannot collide with a real plaintext value. Plaintext strings written
// by older versions are accepted as-is on read; migration only happens at the
// moment that field itself appears in some save() patch and is overwritten
// encrypted (progressive migration: no forced one-shot migration and no data
// loss from migrating). The reverse direction (a `{__enc}` shape written by a
// new version being read by an old one) is out of scope: the old version sees
// a non-string value it does not recognize, and that out-of-range behaviour
// is not guaranteed -- see BACKLOG #21 item7.
//
// Key invariant (a serious bug found in review, now fixed): when a secret
// field is absent from a save() patch (not present in this patch), the
// representation already on disk must be preserved verbatim and must never be
// run through decrypt->re-encrypt -- because decryptSecret degrades to ""
// (empty string) on failure or unavailability, and encryptSecret("") treats
// that as "cleared" and writes it straight to disk, so a single save() of an
// unrelated field (say, changing wowDirectory) would silently and
// irreversibly wipe the stored key/password. So save() encrypts only the
// secret fields that actually appear in this patch, and copies every other
// field verbatim from the raw on-disk JSON (which may be `{__enc}` or
// old-version plaintext).
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(buffer: Buffer): string;
}

/** Fallback stand-in for when safeStorage is unavailable (e.g. some Linux
 * setups without a keyring): everything is treated as unavailable. */
const NOOP_SAFE_STORAGE: SafeStorageLike = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error("safeStorage unavailable");
  },
  decryptString: () => {
    throw new Error("safeStorage unavailable");
  },
};

const SECRET_FIELDS = [
  "anthropicApiKey",
  "deepseekApiKey",
  "obsWebsocketPassword",
  "managedWsPassword",
] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

interface EncryptedValue {
  __enc: string;
}
/** Shape predicate: the only key is `__enc` and its value is a string. A real
 * password is a bare string and can never satisfy this shape. */
function isEncryptedValue(v: unknown): v is EncryptedValue {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 1 &&
    typeof (v as Record<string, unknown>).__enc === "string"
  );
}

export interface SettingsStoreWarning {
  kind: "encryption-unavailable" | "decrypt-failed" | "encrypt-failed";
  field?: SecretField;
  detail?: string;
}

export class SettingsStore {
  private warnedUnavailable = false;
  constructor(
    private filePath: string,
    private safeStorage: SafeStorageLike = NOOP_SAFE_STORAGE,
    private onWarn?: (warning: SettingsStoreWarning) => void,
  ) {}

  private warnEncryptionUnavailableOnce(): void {
    if (this.warnedUnavailable) return;
    this.warnedUnavailable = true;
    this.onWarn?.({
      kind: "encryption-unavailable",
      detail:
        "safeStorage.isEncryptionAvailable() === false,密钥/密码将以明文存储",
    });
  }

  /** Read side: a string (old-version plaintext) is returned as-is; the
   * `{__enc}` shape is decrypted, and failure/unavailability always degrades
   * to an empty string plus a warning -- it never throws. */
  private decryptSecret(raw: unknown, field: SecretField): string | null {
    if (raw == null) return null;
    if (typeof raw === "string") return raw;
    if (!isEncryptedValue(raw)) return null; // Unknown shape: treat as absent
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.onWarn?.({
        kind: "decrypt-failed",
        field,
        detail: "已加密存储但当前环境 safeStorage 不可用,无法解密",
      });
      return "";
    }
    try {
      return this.safeStorage.decryptString(Buffer.from(raw.__enc, "base64"));
    } catch (err) {
      this.onWarn?.({
        kind: "decrypt-failed",
        field,
        detail: err instanceof Error ? err.message : String(err),
      });
      return "";
    }
  }

  /** Write side: encrypt into `{__enc}` when available; unavailability or a
   * throwing encrypt always degrades to plaintext plus a warning -- it never
   * throws. */
  private encryptSecret(
    value: string | null,
    field: SecretField,
  ): string | null | EncryptedValue {
    if (value == null || value === "") return value ?? null;
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.warnEncryptionUnavailableOnce();
      return value;
    }
    try {
      return {
        __enc: this.safeStorage.encryptString(value).toString("base64"),
      };
    } catch (err) {
      this.onWarn?.({
        kind: "encrypt-failed",
        field,
        detail: err instanceof Error ? err.message : String(err),
      });
      return value;
    }
  }

  /** The raw on-disk JSON, with no decryption and no default filling. A parse
   * failure (missing file / bad JSON) always yields {}. */
  private readRaw(): Partial<Record<keyof GladlogSettings, unknown>> &
    LegacySettings {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<
        Record<keyof GladlogSettings, unknown>
      > &
        LegacySettings;
    } catch {
      return {};
    }
  }

  get(): GladlogSettings {
    const raw = this.readRaw();
    const merged = {
      ...DEFAULTS,
      ...(raw as Partial<GladlogSettings>),
      ...migrateLegacyModel(raw as Partial<GladlogSettings> & LegacySettings),
    } as GladlogSettings;
    for (const field of SECRET_FIELDS) {
      merged[field] = this.decryptSecret(raw[field], field);
    }
    // Clamp on read, not just on write: the spread above copies the raw JSON
    // verbatim, so a hand-edited or older-version value would otherwise reach
    // every consumer unchecked. `...DEFAULTS` only covers the *missing* case;
    // a present-but-dirty 0/-1/NaN needs this line.
    merged.uiZoom = clampUiZoom(merged.uiZoom);
    return merged;
  }
  save(partial: Partial<GladlogSettings>): GladlogSettings {
    const current = this.get();
    const next = { ...current, ...partial };
    const rawOnDisk = this.readRaw();
    const onDisk: Record<string, unknown> = { ...next };
    for (const field of SECRET_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(partial, field)) {
        // This patch really does change the field -- encrypt the new value
        // (or apply the degradation rules).
        onDisk[field] = this.encryptSecret(next[field], field);
      } else {
        // Untouched: keep the on-disk representation verbatim, without going
        // through decrypt->re-encrypt, so a degraded value ("") from a failed
        // or unavailable decrypt is never written back as if it were new.
        onDisk[field] = rawOnDisk[field] ?? null;
      }
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    atomicWriteFileSync(this.filePath, JSON.stringify(onDisk, null, 2));
    return next;
  }
}
