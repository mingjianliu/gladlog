/** 视觉回归场景:每个 scene 是一个 URL 可直达的确定状态。
 *  qa/visual/scenes.spec.ts 逐个截图,基线即标准。 */
export const SCENE_NAMES = [
  "report-battle",
  "report-replay",
  "report-ai",
  "report-synth",
] as const;

export type SceneName = (typeof SCENE_NAMES)[number];

export function resolveScene(search: string): SceneName | null {
  const raw = new URLSearchParams(search).get("scene");
  if (!raw) return null;
  return (SCENE_NAMES as readonly string[]).includes(raw)
    ? (raw as SceneName)
    : null;
}
