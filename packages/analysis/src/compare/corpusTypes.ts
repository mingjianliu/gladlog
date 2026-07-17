// packages/analysis/src/compare/corpusTypes.ts
export interface MetricDist {
  p10: number;
  p50: number;
  p90: number;
  n: number;
}
export interface BuildGroupDecl {
  keystoneNodeIds: number[];
  match: "any" | "all";
  groupPresent: string;
  groupAbsent: string;
}
export interface ReferenceCell {
  spec: string;
  bracket: string;
  archetype: string;
  buildGroup: string;
  /** P2 对阵 comp 维度:敌方阵容签名(enemyCompSignature);仅 comp cell 有。 */
  enemyComp?: string;
  sampleN: number;
  insufficient: boolean;
  metrics: Record<string, MetricDist>;
  /** comp cell:对局时长分布(秒)。 */
  durationS?: MetricDist;
  /** comp cell:首个被击杀敌人的 spec 计数(先杀谁)。 */
  firstKill?: Record<string, number>;
  exemplarCrises: string[][];
}

/** 敌方阵容签名 —— builder 与 renderer 共用的单一谓词(spec 名排序拼接)。 */
export function enemyCompSignature(specNames: string[]): string {
  return [...specNames].filter(Boolean).sort().join(" + ");
}
export interface ReferenceCorpus {
  wowPatchVersion: string;
  builtAt: string;
  sourceFloor: number;
  buildGroups: Record<string, BuildGroupDecl>;
  cells: ReferenceCell[];
}
