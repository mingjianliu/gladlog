/**
 * ledgerGapScan — which cooldowns do players press that the major-cooldown
 * ledger (`extractMajorCooldowns`) never admits for them? Forward direction
 * of the Curated-List Completeness Rule for the ledger's roster
 * (classMetadata + racials + dynamic talent discovery + healer save roster).
 *
 * Per round, per player: every SPELL_CAST_SUCCESS id with an official
 * cooldown ≥ MIN_CD_SECONDS whose canonical id is not in that player's
 * ledger. Aggregated per id with its official ability profile, so a survival
 * wall (mitigation / absorb / immunity) the ledger misses stands out from a
 * utility press nobody needs listed.
 *
 *   npx tsx packages/eval/scripts/ledgerGapScan.ts --manifest <m> [--every 30] [--min-rounds 5]
 */
import { ensureAnalysisData, extractMajorCooldowns } from "@gladlog/analysis";
import {
  abilityProfile,
  isSurvivalWall,
} from "@gladlog/analysis/src/data/abilityProfile";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  canonicalSpellId,
  MIN_CD_SECONDS,
  SPEC_EXCLUSIVE_SPELLS,
} from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser } from "@gladlog/parser";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { arg, argOf } from "./lib/cli";

interface Row {
  name: string;
  rounds: number;
  casts: number;
  specs: Map<string, number>;
}

async function main(): Promise<void> {
  const manifest = arg("--manifest", "");
  if (!manifest) {
    console.error("usage: --manifest <file> [--every N] [--min-rounds N]");
    process.exit(2);
  }
  const every = argOf("--every", 30);
  const minRounds = argOf("--min-rounds", 5);
  await ensureAnalysisData();
  const files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0);
  const rows = new Map<string, Row>();
  const excludedCasts = new Map<string, number>();
  let rounds = 0;
  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    for (const combat of combats) {
      rounds++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const u of Object.values(combat?.units ?? {}) as any[]) {
        if (!u.info) continue;
        let ledger: Set<string>;
        try {
          ledger = new Set(
            extractMajorCooldowns(u, combat).map((c) =>
              canonicalSpellId(c.spellId),
            ),
          );
        } catch {
          continue;
        }
        const castCounts = new Map<string, number>();
        for (const e of u.spellCastEvents ?? []) {
          if (e.logLine?.event !== "SPELL_CAST_SUCCESS" || !e.spellId) continue;
          castCounts.set(e.spellId, (castCounts.get(e.spellId) ?? 0) + 1);
        }
        // Reverse check on SPEC_EXCLUSIVE_SPELLS: a cast by a spec the table
        // excludes disproves the row for that spec.
        for (const id of castCounts.keys()) {
          const allowed = SPEC_EXCLUSIVE_SPELLS[id];
          if (!allowed || allowed.includes(u.spec)) continue;
          const k = `${id}\t${String(u.spec)}`;
          excludedCasts.set(k, (excludedCasts.get(k) ?? 0) + 1);
        }
        for (const [id, n] of castCounts) {
          if ((effectiveCooldownSeconds(id) ?? 0) < MIN_CD_SECONDS) continue;
          if (ledger.has(canonicalSpellId(id))) continue;
          let r = rows.get(id);
          if (!r) {
            const name =
              u.spellCastEvents.find(
                (e: { spellId: string }) => e.spellId === id,
              )?.spellName ?? "?";
            r = { name, rounds: 0, casts: 0, specs: new Map() };
            rows.set(id, r);
          }
          r.rounds++;
          r.casts += n;
          r.specs.set(String(u.spec), (r.specs.get(String(u.spec)) ?? 0) + 1);
        }
      }
    }
  }
  console.log(`files ${files.length} rounds ${rounds}`);
  console.log(
    "id\tname\trounds\tcasts\tcd\twall\tmit\tabs\timmS\timmM\theal\tally\tenemy\tspecs",
  );
  const sorted = [...rows.entries()]
    .filter(([, r]) => r.rounds >= minRounds)
    .sort((a, b) => b[1].rounds - a[1].rounds);
  for (const [id, r] of sorted) {
    const p = abilityProfile(id);
    const specs = [...r.specs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, n]) => `${s}:${n}`)
      .join(",");
    console.log(
      [
        id,
        r.name,
        r.rounds,
        r.casts,
        effectiveCooldownSeconds(id),
        isSurvivalWall(id) ? "WALL" : "",
        p.mitigationPct ?? "",
        p.absorbs ? "abs" : "",
        p.immuneSchools ?? "",
        (p.immuneMechanics ?? []).join("/"),
        p.healsSelf ? "hs" : "",
        p.reachesAlly ? "ally" : "",
        p.hitsEnemy ? "enemy" : "",
        specs,
      ].join("\t"),
    );
  }
  console.log(
    "\nSPEC_EXCLUSIVE_SPELLS rows contradicted by a cast (id, spec, rounds):",
  );
  for (const [k, n] of [...excludedCasts.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`${k}\t${n}`);
}

void main();
