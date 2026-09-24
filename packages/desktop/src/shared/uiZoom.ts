/** Single source of truth for the UI scale setting (界面缩放).
 *
 * Mechanism note, so nobody "improves" this into a rem migration later: the
 * scale is applied with Electron's webFrame.setZoomFactor, deliberately NOT
 * with `:root { font-size }` + rem. styles.css carries 1219 absolute px
 * declarations and most of them are layout rather than type (292px sidebar,
 * 206px GCD columns, 140px health frames) -- scaling only the text bursts
 * every box that was not migrated, while the zoom factor scales text and
 * layout by the same ratio and leaves every pixel relationship intact.
 *
 * Three consumers need the exact same clamp, which is why it lives here
 * instead of next to any one of them:
 *   - main/settingsStore.ts clamps on read (a hand-edited settings.json) and
 *     drops an out-of-range value out of a save() patch.
 *   - preload/index.ts clamps again immediately before webFrame.setZoomFactor.
 *   - the renderer clamps the value it reads back out of the settings object,
 *     both to apply it and to decide which segment is active.
 *
 * This module must stay a pure leaf: no electron import, nothing from main/*.
 * The renderer *value*-imports it, and renderer code must never cross into a
 * main-process module -- the same architecture-boundary constraint that put
 * shared/updateSchedule.ts here (see its header). */

/** Floor. Below 1 the app only gets harder to read, so the settings page never
 * offers it, but a user who hand-edits settings.json is allowed under 100%.
 * The floor exists so a stray 0 or a negative number can never reach
 * setZoomFactor: a zoom of 0 collapses the whole window into unclickable
 * slivers and the user cannot find their way back to the settings page to undo
 * it. The clamp is what makes a dirty config recoverable instead of a
 * reinstall. */
const UI_ZOOM_MIN = 0.5;
/** Ceiling. Above the 150% the UI offers, but not by much: past ~3x a 4K
 * window shows less content than a 1080p one and the report layout has nowhere
 * left to reflow. */
const UI_ZOOM_MAX = 3;
export const UI_ZOOM_DEFAULT = 1;

/** The steps the settings page offers. Percentages in the UI are rendered from
 * these numbers (Math.round(z * 100)) rather than written out a second time --
 * one fact, one copy. */
export const UI_ZOOM_LEVELS = [1, 1.15, 1.3, 1.5] as const;

/** Clamp into [UI_ZOOM_MIN, UI_ZOOM_MAX]; anything that is not a finite number
 * -- a settings.json written before this field existed, null, NaN, a string
 * typed into the file by hand -- falls back to the default.
 *
 * Same defensive posture as useReplayLayout.ts's clampSplitRatio for dirty
 * localStorage, with one difference: the input type is `unknown` rather than
 * `number`, because this value also arrives across the IPC boundary where the
 * declared type is a promise the sender can break. */
export function clampUiZoom(desired: unknown): number {
  if (typeof desired !== "number" || !Number.isFinite(desired)) {
    return UI_ZOOM_DEFAULT;
  }
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, desired));
}
