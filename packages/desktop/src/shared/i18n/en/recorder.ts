// English dictionary for the `recorder.*` namespace. Must mirror
// zh/recorder.ts key-for-key (enforced by `satisfies Messages` in en/index.ts).
export const enRecorder = {
  "recorder.notConnectedBanner":
    "Recorder not connected: this match won't be recorded",
  "recorder.status.disabled": "Off",
  "recorder.status.recording": "Recording",
  "recorder.status.notConnected": "Not connected",
  "recorder.status.ready": "Ready",
  "recorder.mode.label": "Recording mode",
  "recorder.mode.managed": "Download and manage OBS for me, no install needed",
  "recorder.mode.external": "Use my own OBS",
  "recorder.mode.managedWindowsOnly": "Managed recording is Windows-only",
  "recorder.mode.managedSaved": "Switched to managed OBS",
  "recorder.mode.externalSaved": "Switched to your own OBS",
  "recorder.autoRecord.label": "Auto-record",
  "recorder.autoRecord.managedNote":
    "gladlog downloads and configures the managed OBS and starts and stops recording with each match; nothing to set up by hand.",
  "recorder.autoRecord.externalNote":
    "Needs OBS 28+ with its WebSocket server enabled (Tools → WebSocket Server Settings); Hybrid MP4 is the recommended recording format. Recording starts when a match begins, stops when it ends, and is linked to the match.",
  "recorder.autoRecord.offSaved": "Auto-record turned off",
  "recorder.autoRecord.onSaved": "Auto-record turned on",
  "recorder.autoConfig.button": "Detect OBS",
  "recorder.autoConfig.hint":
    "Reads this machine's OBS WebSocket config, fills in the address and password, and tries to connect",
  "recorder.autoConfig.notFound":
    "✗ No OBS config found on this machine (is OBS 28+ installed?)",
  "recorder.autoConfig.wsDisabled":
    "Config read and saved, but OBS's WebSocket server is off. In OBS: Tools → WebSocket Server Settings → enable it, then click Test connection",
  "recorder.autoConfig.ok": "✓ Configured and connected",
  "recorder.connectFailed": "Connection failed",
  "recorder.test.button": "Test connection",
  "recorder.test.ok": "✓ Connected",
  "recorder.ws.urlLabel": "WebSocket address",
  "recorder.ws.urlAria": "OBS WebSocket address",
  "recorder.ws.urlSaved": "Address saved",
  "recorder.ws.passwordLabel": "WebSocket password",
  "recorder.ws.passwordUnset":
    "Not set (leave empty if OBS authentication is off)",
  "recorder.ws.passwordSaveAria": "Save OBS password",
  "recorder.ws.passwordSaved": "Password saved",
  "recorder.managed.label": "Managed OBS",
  "recorder.managed.installed":
    "Installed and managed automatically; the status line above shows the recording state.",
  "recorder.managed.downloadBefore":
    "Enabling it the first time downloads OBS Studio (about {mb} MB, from the",
  "recorder.managed.downloadLink": "official obsproject release page",
  "recorder.managed.downloadAfter": ", GPL-2.0).",
  "recorder.install.downloadingButton": "Downloading…",
  "recorder.install.retry": "Retry",
  "recorder.install.downloadAndEnable": "Download and enable",
  "recorder.install.failed": "Install failed",
  "recorder.install.phase.downloading": "Downloading",
  "recorder.install.phase.verifying": "Verifying",
  "recorder.install.phase.extracting": "Extracting",
  "recorder.install.phase.done": "Done",
  "recorder.keep.label": "Keep recordings",
  "recorder.keep.aria": "Number of recordings to keep",
  "recorder.keep.saved": "Retention saved",
  "recorder.keep.note":
    "The most recent N matches. 0 only removes the match-count limit; the total size limit (80 GB by default) still applies, and recordings over it are deleted together with their video files.",
  "recorder.prefs.savedNote":
    "Saved; takes effect when the managed OBS restarts (if it is recording, it restarts automatically after this match)",
  "recorder.prefs.import.label": "Import settings",
  "recorder.prefs.import.note":
    "Copies the recording folder, desktop audio and microphone devices from your own OBS's current profile (read-only; your OBS is not changed).",
  "recorder.prefs.import.button": "Import from my OBS",
  "recorder.prefs.import.busy": "Importing…",
  "recorder.prefs.import.notFound":
    "✗ No OBS config found on this machine (is OBS installed?)",
  "recorder.prefs.import.done": "✓ Imported {items}; {note}",
  "recorder.prefs.import.nothing": "(nothing changed)",
  "recorder.prefs.import.listSeparator": ", ",
  "recorder.prefs.import.part.directory": "recording folder",
  "recorder.prefs.import.part.desktopAudio": "desktop audio",
  "recorder.prefs.import.part.mic": "microphone",
  "recorder.prefs.desktopAudio.label": "Desktop audio",
  "recorder.prefs.desktopAudio.aria": "Desktop audio device",
  "recorder.prefs.mic.label": "Microphone",
  "recorder.prefs.mic.aria": "Microphone device",
  "recorder.prefs.audio.systemDefault": "System default device",
  "recorder.prefs.audio.savedDevice": "Saved device ({id})",
  "recorder.prefs.audio.none": "Don't record",
  "recorder.prefs.directory.label": "Recording folder",
  "recorder.prefs.directory.default":
    "Default (the recordings folder in the app data directory)",
  "recorder.prefs.directory.reset": "Reset to default",
};
