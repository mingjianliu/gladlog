import type { Finding } from "@gladlog/analysis";

import { buildFindingsMarkdown } from "../derive/exportReport";

interface ExportButtonsProps {
  findings: Finding[];
  heroText: string;
}

/** findings 导出:字符串组装在 derive/exportReport(C3 保真测试覆盖),
 * 组件只管剪贴板。图片导出未实现(roadmap C3 注明缺口),不摆假按钮。 */
export function ExportButtons({ findings, heroText }: ExportButtonsProps) {
  const handleCopyMarkdown = () => {
    void navigator.clipboard.writeText(
      buildFindingsMarkdown(findings, heroText),
    );
  };

  return (
    <div className="rpt-export-btns">
      <button className="rpt-btn" onClick={handleCopyMarkdown}>
        Copy Markdown
      </button>
    </div>
  );
}
