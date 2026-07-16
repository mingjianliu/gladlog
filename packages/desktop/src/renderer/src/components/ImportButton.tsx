import { useEffect, useState } from "react";

import { bridge } from "../bridge";

/**
 * 历史日志导入按钮(phase3 #2c):文件对话框 → 进度 → 汇总。
 * 入库的对局经 matchStored 事件实时进列表,无需刷新。
 */
export function ImportButton() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  useEffect(() => {
    try {
      return bridge().logs.onImportProgress((p) =>
        setProgress(
          `解析 ${p.i}/${p.n}:${p.file}(新入库 ${p.stored}${p.dup ? `,重复 ${p.dup}` : ""})`,
        ),
      );
    } catch {
      return undefined;
    }
  }, []);

  const run = async () => {
    setBusy(true);
    setProgress("");
    try {
      const r = await bridge().logs.importFiles();
      if (r === null) {
        setProgress("");
      } else {
        setProgress(
          `完成:${r.files} 个文件,新入库 ${r.stored} 场,重复跳过 ${r.dup}${r.failed ? `,失败 ${r.failed} 个文件` : ""}`,
        );
      }
    } catch (e) {
      setProgress(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="import-btn">
      <button disabled={busy} onClick={() => void run()}>
        {busy ? "导入中…" : "导入历史日志…"}
      </button>
      {progress && <span className="import-progress">{progress}</span>}
    </span>
  );
}
