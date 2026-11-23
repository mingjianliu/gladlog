import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/LangProvider";

/**
 * ⋯ overflow for workflow actions (UI review 2026-08-21 #1): copy / export /
 * report-a-bug are things you do after reading, not while — they leave the
 * reading path. Same menu semantics as StructuredAnalysisPanel's model menu:
 * aria-haspopup, role=menu/menuitem, outside-click and Escape close.
 */
export function ReportOverflowMenu({
  items,
}: {
  items: Array<{
    key: string;
    label: string;
    title?: string;
    testId?: string;
    onClick: () => void;
  }>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="rpt-overflow" ref={ref}>
      <button
        type="button"
        className="rpt-btn rpt-overflow-btn"
        data-testid="rpt-overflow-btn"
        aria-label={t("report.overflow.more")}
        title={t("report.overflow.moreTitle")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="rpt-overflow-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              data-testid={it.testId}
              title={it.title}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
