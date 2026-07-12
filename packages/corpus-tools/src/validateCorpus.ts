import type { Corpus } from "./cellAggregator";

const ASCII = /^[\x00-\x7F]*$/;

export function validateCorpus(corpus: Corpus, nFloor: number): string[] {
  const v: string[] = [];
  if (!corpus.wowPatchVersion || corpus.wowPatchVersion === "unknown")
    v.push("corpus.wowPatchVersion missing/unknown");
  for (const c of corpus.cells) {
    const tag = `${c.spec}|${c.bracket}|${c.archetype}|${c.buildGroup}`;
    // N_floor 一致性
    if (c.sampleN < nFloor && !c.insufficient)
      v.push(`${tag}: below floor (${c.sampleN}) but not insufficient`);
    if (c.sampleN >= nFloor && c.insufficient)
      v.push(`${tag}: at/above floor (${c.sampleN}) but marked insufficient`);
    // 1.5 延迟哨兵回归:旧 fork 把缺失的 reactionLatency 默认成 1.5s。若重现,
    // 该假值会带着真实 record 计数(n>0)进入分布,中位数正好落在 1.5。真实
    // 队列的插值中位数不可能精确等于 1.5,故 (n>0 && p50===1.5) 是可靠 tripwire。
    // (旧实现查 n===0——但空分布经 percentile() 返 0 而非 1.5,永不触发,且恰好
    // 漏掉真正的失败模式。)
    const rl = c.metrics.reactionLatency;
    if (rl && rl.n > 0 && rl.p50 === 1.5)
      v.push(
        `${tag}: reactionLatency 1.5 sentinel (median 1.5 with ${rl.n} records)`,
      );
    // crisis 英文/ASCII
    for (const crises of c.exemplarCrises)
      for (const line of crises)
        if (!ASCII.test(line))
          v.push(`${tag}: non-ASCII crisis line: ${line.slice(0, 40)}`);
    // build-group integrity: any non-"*" buildGroup cell's spec must be declared
    if (c.buildGroup !== "*" && !corpus.buildGroups?.[c.spec])
      v.push(
        `${tag}: undeclared buildGroup "${c.buildGroup}" (spec not in buildGroups)`,
      );
  }
  for (const [spec, d] of Object.entries(corpus.buildGroups ?? {})) {
    if (!d.keystoneNodeIds || d.keystoneNodeIds.length === 0)
      v.push(`buildGroups[${spec}]: empty keystoneNodeIds`);
    if (d.match !== "any" && d.match !== "all")
      v.push(`buildGroups[${spec}]: invalid match "${d.match}"`);
    if (d.groupPresent === d.groupAbsent)
      v.push(`buildGroups[${spec}]: groupPresent === groupAbsent`);
    // 守卫的事后断言:门激活的每个 buildGroup 的 build 父(spec×bracket×*×group)
    // 必须真的达标。若 aggregateCells 的守卫被改坏而发出未达标的分组,这里兜住。
    for (const g of [d.groupPresent, d.groupAbsent]) {
      const buildParents = corpus.cells.filter(
        (c) => c.spec === spec && c.archetype === "*" && c.buildGroup === g,
      );
      for (const p of buildParents)
        if (p.sampleN < nFloor)
          v.push(
            `buildGroups[${spec}] group "${g}": build-parent ${p.bracket} below N_floor (${p.sampleN})`,
          );
    }
  }
  return v;
}
