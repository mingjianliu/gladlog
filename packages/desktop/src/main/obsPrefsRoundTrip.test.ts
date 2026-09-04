import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MANAGED_OBS_PREF_DEFAULTS } from "../shared/managedObsPrefs";
import { detectObsRecordingPrefs, importedPrefsPatch } from "./obsAutoConfig";
import { writeObsConfig } from "./obsConfigWriter";

/**
 * Writer ↔ importer round trip (managed-OBS prefs, 2026-09-04). The managed
 * config tree obsConfigWriter produces IS an OBS config tree (user.ini
 * [Basic] → profile basic.ini → scene collection JSON), so the importer must
 * read back exactly the prefs the writer was given. This pins the two sides
 * to the same key names (RecFilePath / DesktopAudioDevice1 / AuxAudioDevice1
 * / settings.device_id) — the shared-predicate rule applied to a file
 * format: if either side ever renames a key, this goes red, not a user's
 * "import from my OBS" button silently importing nothing.
 */
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gladlog-obs-roundtrip-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function roundTrip(prefs: {
  recDir: string;
  desktopAudioDeviceId: string | null;
  micDeviceId: string | null;
}) {
  const obsRoot = join(dir, "obs");
  writeObsConfig({
    obsRoot,
    recDir: prefs.recDir,
    wsPort: 4466,
    wsPassword: "pw",
    bitrateKbps: 8000,
    desktopAudioDeviceId: prefs.desktopAudioDeviceId,
    micDeviceId: prefs.micDeviceId,
  });
  return detectObsRecordingPrefs([join(obsRoot, "config", "obs-studio")]);
}

describe("obsConfigWriter → detectObsRecordingPrefs round trip", () => {
  it("product defaults: desktop default device, no mic, the given recDir", () => {
    const recDir = join(dir, "rec");
    const d = roundTrip({
      recDir,
      desktopAudioDeviceId: MANAGED_OBS_PREF_DEFAULTS.managedDesktopAudioDevice,
      micDeviceId: MANAGED_OBS_PREF_DEFAULTS.managedMicDevice,
    });
    expect(d.found).toBe(true);
    expect(d.sceneRead).toBe(true);
    // The writer normalises to forward slashes; the importer hands back
    // whatever the ini holds, which OBS itself accepts on Windows.
    expect(d.recordingDirectory).toBe(recDir.replace(/\\/g, "/"));
    expect(importedPrefsPatch(d)).toEqual({
      recordingDirectory: recDir.replace(/\\/g, "/"),
      managedDesktopAudioDevice: "default",
      managedMicDevice: null,
    });
  });

  it("specific device ids on both channels survive the round trip verbatim", () => {
    const d = roundTrip({
      recDir: join(dir, "rec"),
      desktopAudioDeviceId: "{0.0.0.00000000}.{out-guid}",
      micDeviceId: "{0.0.1.00000000}.{mic-guid}",
    });
    expect(importedPrefsPatch(d)).toMatchObject({
      managedDesktopAudioDevice: "{0.0.0.00000000}.{out-guid}",
      managedMicDevice: "{0.0.1.00000000}.{mic-guid}",
    });
  });

  it("desktop audio off + mic on: the omitted key reads back as 'don't record', not as an error", () => {
    const d = roundTrip({
      recDir: join(dir, "rec"),
      desktopAudioDeviceId: null,
      micDeviceId: "default",
    });
    expect(d.sceneRead).toBe(true);
    expect(importedPrefsPatch(d)).toMatchObject({
      managedDesktopAudioDevice: null,
      managedMicDevice: "default",
    });
  });
});
