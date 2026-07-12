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
  sampleN: number;
  insufficient: boolean;
  metrics: Record<string, MetricDist>;
  exemplarCrises: string[][];
}
export interface ReferenceCorpus {
  wowPatchVersion: string;
  builtAt: string;
  sourceFloor: number;
  buildGroups: Record<string, BuildGroupDecl>;
  cells: ReferenceCell[];
}
