/* eslint-disable simple-import-sort/imports -- styles.css loads after the components it overrides (the sorter would hoist this side-effect import and change the CSS cascade) */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ExportReportPage, parseExportHash } from "./report/ExportReportPage";
import "./styles.css";

if (import.meta.env.VITE_FIXTURE_MODE) {
  const { installFixtureBridge } = await import("./fixtureBridge");
  installFixtureBridge();
}

// C3 image export: an offscreen window arrives with `#export-report=<id>` →
// render only the export page
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
