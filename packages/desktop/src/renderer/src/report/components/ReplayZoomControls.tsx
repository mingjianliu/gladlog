/**
 * 地图右下角的缩放浮层。类名是 report.replayzoom.test.tsx 的契约,勿改名。
 */
export function ReplayZoomControls(props: {
  zoomLevel: number | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <span className="rpt-replay-zoom-group">
      <button
        className="rpt-replay-zoom-btn"
        title="放大(也可 ⌘/Ctrl+滚轮;放大后普通滚轮即可继续缩放,拖拽平移)"
        onClick={props.onZoomIn}
      >
        +
      </button>
      <button
        className="rpt-replay-zoom-btn"
        title="缩小"
        onClick={props.onZoomOut}
      >
        −
      </button>
      {props.zoomLevel != null && (
        <button
          className="rpt-replay-zoom-reset"
          title="复位缩放(或双击地图)"
          onClick={props.onReset}
        >
          ⤢ {props.zoomLevel}× 复位
        </button>
      )}
    </span>
  );
}
