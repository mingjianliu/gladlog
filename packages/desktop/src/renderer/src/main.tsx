import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ExportReportPage, parseExportHash } from "./report/ExportReportPage";
import "./styles.css";

if (import.meta.env.VITE_FIXTURE_MODE) {
  const { installFixtureBridge } = await import("./fixtureBridge");
  installFixtureBridge();
}

// C3 导出图片:离屏窗口带 `#export-report=<id>` 进来 → 只渲染导出页
const exportReq = parseExportHash(window.location.hash);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {exportReq ? (
      <ExportReportPage
        matchId={exportReq.matchId}
        roundSeq={exportReq.roundSeq}
        range={exportReq.range}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
