import { useEffect, useState } from "react";

import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";

/**
 * Historical log import button (phase3 #2c): file dialog → progress → summary.
 * Stored matches enter the list live via the matchStored event; no refresh
 * needed.
 */
type ImportStatus =
  | {
      kind: "progress";
      i: number;
      n: number;
      file: string;
      stored: number;
      dup: number;
    }
  | { kind: "done"; files: number; stored: number; dup: number; failed: number }
  // `error` is the raw message (from main, already in its language).
  | { kind: "failed"; error: string }
  | null;

export function ImportButton() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  // The outcome, not its text: rendered with the current language so a
  // language switch re-words a summary already on screen.
  const [status, setStatus] = useState<ImportStatus>(null);

  useEffect(() => {
    try {
      return bridge().logs.onImportProgress((p) =>
        setStatus({
          kind: "progress",
          i: p.i,
          n: p.n,
          file: p.file,
          stored: p.stored,
          dup: p.dup,
        }),
      );
    } catch {
      return undefined;
    }
  }, []);

  const run = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await bridge().logs.importFiles();
      setStatus(
        r === null
          ? null
          : {
              kind: "done",
              files: r.files,
              stored: r.stored,
              dup: r.dup,
              failed: r.failed,
            },
      );
    } catch (e) {
      setStatus({
        kind: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const progress =
    status === null
      ? ""
      : status.kind === "progress"
        ? t("matchList.import.progress", {
            i: status.i,
            n: status.n,
            file: status.file,
            stored: status.stored,
            dupPart: status.dup
              ? t("matchList.import.progressDup", { dup: status.dup })
              : "",
          })
        : status.kind === "done"
          ? t("matchList.import.done", {
              files: status.files,
              stored: status.stored,
              dup: status.dup,
              failedPart: status.failed
                ? t("matchList.import.doneFailed", { failed: status.failed })
                : "",
            })
          : t("matchList.import.failed", { error: status.error });

  return (
    <span className="import-btn">
      <button disabled={busy} onClick={() => void run()}>
        {busy ? t("matchList.import.busy") : t("matchList.import.button")}
      </button>
      {progress && <span className="import-progress">{progress}</span>}
    </span>
  );
}
