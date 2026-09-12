import { heroTreeNames } from "@gladlog/analysis";

import { COMP_CELL_N_FLOOR, type Corpus } from "./cellAggregator";

const ASCII = /^[\x00-\x7F]*$/;

export function validateCorpus(corpus: Corpus, nFloor: number): string[] {
  const v: string[] = [];
  // Requires ensureHeroTalents() to have resolved (buildCorpus awaits it);
  // if not, this set is empty and every hero cell fails loud below.
  const heroNames = heroTreeNames();
  if (!corpus.wowPatchVersion || corpus.wowPatchVersion === "unknown")
    v.push("corpus.wowPatchVersion missing/unknown");
  for (const c of corpus.cells) {
    const tag = `${c.spec}|${c.bracket}|${c.archetype}|${c.buildGroup}`;
    // N_floor consistency
    // P2 comp cells use COMP_CELL_N_FLOOR (the same constant as the aggregator)
    const floor = (c as { enemyComp?: string }).enemyComp
      ? COMP_CELL_N_FLOOR
      : nFloor;
    if (c.sampleN < floor && !c.insufficient)
      v.push(`${tag}: below floor (${c.sampleN}) but not insufficient`);
    if (c.sampleN >= floor && c.insufficient)
      v.push(`${tag}: at/above floor (${c.sampleN}) but marked insufficient`);
    // 1.5 latency sentinel regression: an old fork defaulted a missing
    // reactionLatency to 1.5s. If that comes back, the fake value enters the
    // distribution WITH a real record count (n>0) and the median lands exactly
    // on 1.5. A real queue's interpolated median can never be exactly 1.5, so
    // (n>0 && p50===1.5) is a reliable tripwire.
    // (The old implementation checked n===0 — but an empty distribution returns
    // 0 from percentile(), not 1.5, so it never fired and missed precisely the
    // real failure mode.)
    const rl = c.metrics.reactionLatency;
    if (rl && rl.n > 0 && rl.p50 === 1.5)
      v.push(
        `${tag}: reactionLatency 1.5 sentinel (median 1.5 with ${rl.n} records)`,
      );
    // crisis lines must be English/ASCII
    for (const crises of c.exemplarCrises)
      for (const line of crises)
        if (!ASCII.test(line))
          v.push(`${tag}: non-ASCII crisis line: ${line.slice(0, 40)}`);
    // build-group integrity — two legal shapes (#37, 2026-08-25):
    //   - gate-declared spec: any non-"*" group is covered by the decl checks
    //     below;
    //   - undeclared spec: hero-tree grouping (cellAggregator never puts hero
    //     groups into `buildGroups`; the read side matches them via
    //     CompareInput.heroGroup), so the name must come from the same
    //     talentIdMap the emission side (heroBuildGroupOf) resolves through.
    // 2026-09-11: the test is "is THIS cell's group one the declaration names",
    // not "does the spec have a declaration". Since the hero tree outranks the
    // keystone gate (user ruling), a declared spec — Discipline is the only one
    // — now carries hero-named cells while keeping its declaration in the
    // header. Keying on the declaration's mere existence skipped BOTH checks
    // for exactly those cells, so a misspelled hero name on the one spec that
    // has a gate would have validated clean.
    if (c.buildGroup !== "*") {
      const decl = corpus.buildGroups?.[c.spec];
      const isDeclaredGroup =
        !!decl &&
        (c.buildGroup === decl.groupPresent ||
          c.buildGroup === decl.groupAbsent);
      if (!isDeclaredGroup) {
        if (!heroNames.has(c.buildGroup))
          v.push(
            `${tag}: buildGroup "${c.buildGroup}" is neither gate-declared nor a hero tree name`,
          );
        // Mirror of the gated post-hoc guard assertion: a surviving hero split
        // means the viability guard held, so every build parent meets the floor.
        else if (c.archetype === "*" && c.sampleN < nFloor)
          v.push(`${tag}: hero build-parent below N_floor (${c.sampleN})`);
      }
    }
  }
  for (const [spec, d] of Object.entries(corpus.buildGroups ?? {})) {
    if (!d.keystoneNodeIds || d.keystoneNodeIds.length === 0)
      v.push(`buildGroups[${spec}]: empty keystoneNodeIds`);
    if (d.match !== "any" && d.match !== "all")
      v.push(`buildGroups[${spec}]: invalid match "${d.match}"`);
    if (d.groupPresent === d.groupAbsent)
      v.push(`buildGroups[${spec}]: groupPresent === groupAbsent`);
    // Post-hoc assertion on the guard: for every gate-activated buildGroup, the
    // build parent (spec×bracket×*×group) must genuinely meet the floor. If
    // aggregateCells' guard is broken and emits an under-floor group, this
    // catches it.
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
