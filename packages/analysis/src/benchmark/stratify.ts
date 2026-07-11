/**
 * Stratified sampling by spec × archetype
 */

export interface SampleMeta {
  id: string;
  spec: string;
  archetype: string;
}

export interface StratificationResult {
  selected: SampleMeta[];
  perSpec: Record<string, { n: number; insufficient: boolean }>;
}

/**
 * Stratified sample by spec × archetype combinations.
 * Each stratum (spec+archetype pair) is capped at perStratumCap samples (deterministic: first N).
 * After sampling, marks any spec with fewer than minN total samples as insufficient.
 */
export function stratifiedSample(
  pool: SampleMeta[],
  opts: { perStratumCap: number; minN: number },
): StratificationResult {
  if (pool.length === 0) {
    return { selected: [], perSpec: {} };
  }

  // Group by spec × archetype stratum
  const strata = new Map<string, SampleMeta[]>();
  for (const meta of pool) {
    const key = `${meta.spec}|${meta.archetype}`;
    if (!strata.has(key)) {
      strata.set(key, []);
    }
    strata.get(key)!.push(meta);
  }

  // Sample from each stratum (deterministic: first N)
  const selected: SampleMeta[] = [];
  for (const samples of strata.values()) {
    selected.push(...samples.slice(0, opts.perStratumCap));
  }

  // Count per spec and mark insufficient
  const perSpec: Record<string, { n: number; insufficient: boolean }> = {};
  for (const meta of selected) {
    if (!perSpec[meta.spec]) {
      perSpec[meta.spec] = { n: 0, insufficient: false };
    }
    perSpec[meta.spec].n++;
  }

  // Mark specs with fewer than minN samples
  for (const spec in perSpec) {
    if (perSpec[spec].n < opts.minN) {
      perSpec[spec].insufficient = true;
    }
  }

  return { selected, perSpec };
}
