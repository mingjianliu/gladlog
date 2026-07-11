import type { Corpus } from "./cellAggregator";

const ASCII = /^[\x00-\x7F]*$/;

export function validateCorpus(corpus: Corpus, nFloor: number): string[] {
  const v: string[] = [];
  if (!corpus.wowPatchVersion || corpus.wowPatchVersion === "unknown")
    v.push("corpus.wowPatchVersion missing/unknown");
  for (const c of corpus.cells) {
    const tag = `${c.spec}|${c.bracket}|${c.archetype}`;
    // N_floor 一致性
    if (c.sampleN < nFloor && !c.insufficient)
      v.push(`${tag}: below floor (${c.sampleN}) but not insufficient`);
    if (c.sampleN >= nFloor && c.insufficient)
      v.push(`${tag}: at/above floor (${c.sampleN}) but marked insufficient`);
    // 1.5 延迟哨兵:n===0 却带非空 reactionLatency 分布(尤其 1.5)
    const rl = c.metrics.reactionLatency;
    if (
      rl &&
      rl.n === 0 &&
      (rl.p50 === 1.5 || rl.p10 === 1.5 || rl.p90 === 1.5)
    )
      v.push(`${tag}: reactionLatency 1.5 sentinel with 0 records`);
    // crisis 英文/ASCII
    for (const crises of c.exemplarCrises)
      for (const line of crises)
        if (!ASCII.test(line))
          v.push(`${tag}: non-ASCII crisis line: ${line.slice(0, 40)}`);
  }
  return v;
}
