export interface StudyRow {
  spec: string;
  archetype: string;
  talents: number[];
  offensiveIndex: number;
  ccDensity: number;
}
export interface NodeCandidate {
  nodeId: number;
  prevalence: number;
  medWith: number;
  medWithout: number;
  diff: number;
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Candidate keystones: nodes whose presence most separates the metric median,
// excluding near-universal (core) and ultra-rare nodes.
export function rankKeystoneCandidates(
  rows: StudyRow[],
  spec: string,
  metric: "offensiveIndex" | "ccDensity",
): NodeCandidate[] {
  const rs = rows.filter((r) => r.spec === spec);
  if (rs.length === 0) return [];
  const nodes = new Set<number>();
  for (const r of rs) for (const n of r.talents) nodes.add(n);
  const out: NodeCandidate[] = [];
  for (const nodeId of nodes) {
    const withN = rs.filter((r) => r.talents.includes(nodeId));
    const woN = rs.filter((r) => !r.talents.includes(nodeId));
    if (withN.length < 15 || woN.length < 15) continue; // ultra-rare / near-universal
    const prevalence = withN.length / rs.length;
    if (prevalence < 0.08 || prevalence > 0.45) continue;
    const medWith = median(withN.map((r) => r[metric]));
    const medWithout = median(woN.map((r) => r[metric]));
    out.push({
      nodeId,
      prevalence,
      medWith,
      medWithout,
      diff: medWith - medWithout,
    });
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
