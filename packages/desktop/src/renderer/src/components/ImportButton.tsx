import { useEffect, useState } from "react";

import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";

/**
 * Historical log import button (phase3 #2c): file dialog → progress → summary.
 * Stored matches enter the list live via the matchStored event; no refresh
 * needed.
 */
export function ImportButton() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  useEffect(() => {
    try {
      return bridge().logs.onImportProgress((p) =>
        setProgress(
          t("matchList.import.progress", {
            i: p.i,
            n: p.n,
            file: p.file,
            stored: p.stored,
            dupPart: p.dup
              ? t("matchList.import.progressDup", { dup: p.dup })
              : "",
          }),
        ),
      );
    } catch {
      return undefined;
    }
  }, [t]);

  const run = async () => {
    setBusy(true);
    setProgress("");
    try {
      const r = await bridge().logs.importFiles();
      if (r === null) {
        setProgress("");
      } else {
        setProgress(
          t("matchList.import.done", {
            files: r.files,
            stored: r.stored,
            dup: r.dup,
            failedPart: r.failed
              ? t("matchList.import.doneFailed", { failed: r.failed })
              : "",
          }),
        );
      }
    } catch (e) {
      setProgress(
        t("matchList.import.failed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="import-btn">
      <button disabled={busy} onClick={() => void run()}>
        {busy ? t("matchList.import.busy") : t("matchList.import.button")}
      </button>
      {progress && <span className="import-progress">{progress}</span>}
    </span>
  );
}
