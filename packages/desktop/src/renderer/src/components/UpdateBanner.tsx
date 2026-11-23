import { useEffect, useState } from "react";

import type { UpdateState } from "../../../main/updater";
import type { GladlogApi } from "../../../preload/api";
import { getBatchStatus, subscribeBatch } from "../batch/batchAnalysis";
import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";
import {
  dismissVersionNotice,
  fetchUpdateState,
  requestUpdateInstall,
  resolveVersionNotice,
  subscribeUpdateState,
} from "../update/updateBridge";

/** The type-only import of UpdateState is mandatory: main/updater.ts is a
 *  main-process module, and renderer code must never cross that layer
 *  boundary with a value import — regardless of what updater.ts happens to
 *  pull in itself (its own file header notes it stays free of electron and
 *  electron-updater; the point here is the main/renderer architectural split,
 *  not bundle weight). Precedent: preload/api.ts:6 imports RecorderStatus the
 *  same way. */

const RELEASE_TAG_URL = "https://github.com/mingjianliu/gladlog/releases/tag/v";

/** The recorder surface is read defensively for one concrete reason: this
 *  component is the very first renderer-side consumer of recorder.onStatus
 *  (preload/api.ts:319), so every pre-existing bridge stub — fixtureBridge.ts
 *  and the ~40 component tests — lacks it entirely and the property access
 *  itself throws. Update-side access is NOT done here; it lives in
 *  update/updateBridge.ts. */
function recorderSurface(): GladlogApi["recorder"] | undefined {
  try {
    return bridge()?.recorder;
  } catch {
    return undefined;
  }
}

/**
 * Update indicator in the top bar (spec §4.5, the two stages the user signed
 * off on): downloading = one thin non-interactive line; ready = a dismissible
 * banner that degrades into a small always-there button after "稍后".
 * idle / checking / disabled render nothing — a failed check must never nag
 * (network failure is the normal case when pulling 110 MB from GitHub, and it
 * breaks no feature). The one error worth interrupting for is handled further
 * down.
 *
 * Every update-side call goes through update/updateBridge.ts. That module owns
 * the defensive access to `bridge().update` (component tests and the fixture
 * preview routinely lack whole surfaces) and, further down, the §4.7
 * lastSeenVersion predicate. Re-implementing either here would be the
 * hand-copied predicate CLAUDE.md forbids.
 */
export function UpdateBanner() {
  const { t } = useT();
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(() => getBatchStatus().running);

  // CLAUDE.md's single-source rule applied to "is the app busy": both facts
  // are consumed from their existing owners, never re-derived here.
  //   recording  = RecorderStatus.recording (main is the sole owner)
  //   analyzing  = getBatchStatus().running (the batch/auto-analyze driver)
  // Known hole, deliberately left: a single match analysed by hand from the
  // report page goes through bridge().analysis.run directly
  // (report/components/StructuredAnalysisPanel.tsx:687) and never touches the
  // batch driver, so it does not count as busy. Covering it would mean
  // inventing a second "in flight" registry in the renderer — exactly the
  // hand-copied predicate the rule forbids (main only exposes a per-matchId
  // analysis.getState(id).running, no global snapshot). The cost is bounded:
  // the worst case is losing that one analysis round (its cache was never
  // written); no match data is at risk. Switch to a global running snapshot
  // the day main grows one.
  useEffect(() => {
    const rec = recorderSurface();
    if (!rec) return;
    void rec
      .getStatus()
      .then((s) => setRecording(s.recording))
      .catch(() => {});
    return rec.onStatus((s) => setRecording(s.recording));
  }, []);

  useEffect(
    () => subscribeBatch(() => setAnalyzing(getBatchStatus().running)),
    [],
  );

  const busyReason = recording
    ? t("update.busy.recording")
    : analyzing
      ? t("update.busy.analyzing")
      : null;

  const [installRequested, setInstallRequested] = useState(false);
  const [updatedTo, setUpdatedTo] = useState<string | null>(null);

  // §4.7 post-update trace. The predicate ("is there anything to announce, and
  // when is lastSeenVersion written back") lives in
  // updateBridge.resolveVersionNotice — one copy, unit-tested in
  // test/updateBridge.test.ts. This component only renders the answer.
  useEffect(() => {
    let cancelled = false;
    void resolveVersionNotice().then((v) => {
      if (!cancelled) setUpdatedTo(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearUpdatedTo = () => {
    const v = updatedTo;
    setUpdatedTo(null);
    if (v) void dismissVersionNotice(v);
  };

  useEffect(() => {
    void fetchUpdateState().then((s) => {
      if (s) setState(s);
    });
    // Both push and snapshot: mounting later than the event (window reopen /
    // view switch) would otherwise lose the state entirely.
    return subscribeUpdateState((s) => {
      setState(s);
      // A newly arrived "ready" reopens the banner even if an older one was
      // dismissed — a different version is a different piece of news.
      if (s.phase === "ready") setDismissed(false);
    });
  }, []);

  const trace = updatedTo && (
    <span className="upd-trace">
      <button
        className="upd-chip"
        onClick={() => {
          // Pure UI navigation, not a predicate — the only direct bridge call
          // left in this component. try/catch because a stub may ship
          // app.getVersion without app.openExternal.
          try {
            void bridge()
              .app.openExternal(`${RELEASE_TAG_URL}${updatedTo}`)
              .catch(() => {});
          } catch {
            // No app surface: dropping the navigation is the right degradation
          }
          clearUpdatedTo();
        }}
      >
        {t("update.updatedTo", { version: updatedTo })}
      </button>
      <button
        className="upd-x"
        aria-label={t("update.dismissAria")}
        onClick={clearUpdatedTo}
      >
        ✕
      </button>
    </span>
  );

  const live =
    state?.phase === "downloading" ? (
      <span className="upd-line">
        {t("update.downloading", {
          version: state.version,
          percent: Math.round(state.percent),
        })}
      </span>
    ) : state?.phase === "ready" ? (
      dismissed ? (
        <button className="upd-chip" onClick={() => setDismissed(false)}>
          {t("update.ready", { version: state.version })}
        </button>
      ) : (
        <span className="upd-banner" role="status">
          <span>{t("update.ready", { version: state.version })}</span>
          <button
            className="upd-primary"
            // installRequested also disables the button, not just busyReason:
            // main's install() latches `installing` and never releases it
            // (src/main/updater.ts), so once the user has clicked once, a
            // later event that pushes phase back to "ready" (e.g. a periodic
            // autoCheck re-running) must not present a live button that a
            // second click would silently no-op. Real `disabled`, not a style
            // tweak, so screen readers and the mutation test both see it.
            disabled={busyReason != null || installRequested}
            onClick={() => {
              setInstallRequested(true);
              void requestUpdateInstall();
            }}
          >
            {t("update.restartNow")}
          </button>
          <button onClick={() => setDismissed(true)}>
            {t("update.later")}
          </button>
          {installRequested ? (
            <span className="upd-note">{t("update.installing")}</span>
          ) : (
            busyReason && <span className="upd-note">{busyReason}</span>
          )}
        </span>
      )
    ) : state?.phase === "error" && installRequested ? (
      // §4.2 says errors must not nag, and check/download failures indeed
      // render nothing. This is the one exception: after the user pressed
      // 立即重启, quitLifecycle.shutdown() has already stopped the recorder,
      // the worker and the AI child processes, so if the installer never took
      // over (Task 5's watchdog, 10 s) the window is alive but functionally
      // dead. Staying silent there leaves a "looks fine, does nothing" app.
      // The trigger is the local fact "we asked for an install", NOT a
      // string match on the message — that message is produced in
      // src/main/updater.ts, which the renderer may only `import type`, so
      // copying it here would be a hand-written predicate that rots silently
      // the first time main rewords it.
      <span className="upd-note" role="status">
        {state.message}
      </span>
    ) : null;

  // idle / checking / error / disabled with nothing to trace → render nothing
  if (!trace && !live) return null;
  return (
    <div className="upd-slot">
      {trace}
      {live}
    </div>
  );
}
