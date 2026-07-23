/** 视觉回归场景:每个 scene 是一个 URL 可直达的确定状态。
 *  qa/visual/scenes.spec.ts 逐个截图,基线即标准。 */
export const SCENE_NAMES = [
  "report-battle",
  "report-replay",
  "report-ai",
  "report-synth",
  // 时间窗联动(第四阶段①)的选中态:唯一的可见新状态,单独入基线
  "report-window",
  // events 视图(第四阶段②)
  "report-events",
  "dashboard",
  "settings",
  "matchlist",
  // 只用于首渲计时的大号载荷 —— 尺寸随数据规模变化,不做像素基线
  "report-heavy",
] as const;

export type SceneName = (typeof SCENE_NAMES)[number];

export function resolveScene(search: string): SceneName | null {
  const raw = new URLSearchParams(search).get("scene");
  if (!raw) return null;
  return (SCENE_NAMES as readonly string[]).includes(raw)
    ? (raw as SceneName)
    : null;
}
