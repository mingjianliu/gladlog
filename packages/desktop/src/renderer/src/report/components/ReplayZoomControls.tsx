import { useT } from "../../i18n/LangProvider";

/**
 * Zoom overlay in the bottom-right corner of the map. The class names are a
 * contract with report.replayzoom.test.tsx — do not rename them.
 */
export function ReplayZoomControls(props: {
  zoomLevel: number | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const { t } = useT();
  return (
    <span className="rpt-replay-zoom-group">
      <button
        className="rpt-replay-zoom-btn"
        title={t("report.zoom.inTitle")}
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button
        className="rpt-replay-zoom-btn"
        title={t("report.zoom.outTitle")}
        onClick={props.onZoomOut}
      >
        −
      </button>
      {props.zoomLevel != null && (
        <button
          className="rpt-replay-zoom-reset"
          title={t("report.zoom.resetTitle")}
          onClick={props.onReset}
        >
          {t("report.zoom.reset", { z: props.zoomLevel })}
        </button>
      )}
    </span>
  );
}
