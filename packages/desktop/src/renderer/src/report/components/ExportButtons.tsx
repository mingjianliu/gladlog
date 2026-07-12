import React from "react";
import type { Finding } from "@gladlog/analysis";

interface ExportButtonsProps {
  findings: Finding[];
  heroText: string;
}

export function ExportButtons({ findings, heroText }: ExportButtonsProps) {
  const handleCopyMarkdown = () => {
    const lines = [heroText];
    if (findings.length > 0) {
      lines.push("");
    }
    for (const f of findings) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.title} — ${f.explanation}`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
  };

  const handleExportImage = () => {
    // TODO: implement image export
  };

  return (
    <div className="flex gap-2 mt-4">
      <button className="rpt-btn" onClick={handleCopyMarkdown}>
        Copy Markdown
      </button>
      <button className="rpt-btn" onClick={handleExportImage}>
        Export Image
      </button>
    </div>
  );
}
