import type { MessageParams } from "../index";

// English dictionary for the `update.*` namespace. Must mirror zh/update.ts
// key-for-key (enforced by `satisfies Messages` in en/index.ts).
const ago = (n: unknown, unit: string): string =>
  `${n} ${unit}${Number(n) === 1 ? "" : "s"} ago`;

export const enUpdate = {
  "update.disabled.platform":
    "Auto-update is only available in the Windows installer build",
  "update.disabled.portable":
    "The portable (zip) build does not auto-update; use the installer build instead",
  "update.disabled.dev": "Update checks are off in development mode",
  "update.checking": "Checking…",
  "update.downloading": "Downloading {version} · {percent}%",
  "update.readyOnQuit": "Version {version} is ready and installs when you quit",
  "update.neverChecked": "Never checked",
  "update.upToDatePrefix": "Up to date · ",
  "update.lastChecked": "Last checked: {when}",
  "update.rel.justNow": "just now",
  "update.rel.minutes": (p: MessageParams) => ago(p.n, "minute"),
  "update.rel.hours": (p: MessageParams) => ago(p.n, "hour"),
  "update.rel.days": (p: MessageParams) => ago(p.n, "day"),
  "update.busy.recording":
    "Recording now; the update installs automatically when you quit",
  "update.busy.analyzing":
    "Analyzing now; the update installs automatically when you quit",
  "update.updatedTo": "Updated to {version} · What's new",
  "update.dismissAria": "Dismiss update notice",
  "update.ready": "Version {version} is ready",
  "update.restartNow": "Restart now",
  "update.later": "Later",
  "update.installing":
    "Installing, please wait. If nothing happens for a long time, quit gladlog and open it again",
};
