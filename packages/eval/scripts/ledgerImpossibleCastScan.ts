/**
 * ledgerImpossibleCastScan.ts — every cooldown ledger entry, every press:
 * did the product believe the spell was unavailable at the moment the player
 * pressed it? (2026-09-26 talent impact audit, forward check.)
 *
 * The generalisation of ledgerImpossibleCastProbe.ts (one spell) to the whole
 * ledger. For each unit, each `extractMajorCooldowns` entry, each cast c:
 * `cdAvailableAt` (the product's own availability predicate, charges and
 * shared pools included) evaluated at c on the presses strictly before c.
 * `false` = an impossible cast: the modelled cooldown is too long or the
 * modelled charge count too low for this player — an unmodelled talent,
 * reset, proc or dynamic reduction. It NOMINATES; attribution is offline
 * (the per-unit talent sets are dumped with every record, so the reading
 * pass's claims can be split holders vs non-holders).
 *
 * A cast the static model calls impossible but the dynamic floor
 * (`earliestCooldownSeconds`, GH #106 step 3) allows is counted separately
 * as `floorExplained`.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/ledgerImpossibleCastScan.ts --manifest <m> [--every 30] --out <file.jsonl>
 * Output: one JSON line per (round, unit, ledger entry) with ≥ 1 cast, and a
 * per-spell summary on stdout.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  playerTalentIdSets,
} from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "30"));
const out = arg("--out", "");
if (!manifest || !out) {
  console.error("usage: --manifest <m> --out <file.jsonl> [--every 30]");
  process.exit(1);
}

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);
writeFileSync(out, "");

interface Agg {
  name: string;
  entries: number;
  casts: number;
  impossible: number;
  floorExplained: number;
  unitsWithImpossible: number;
  specs: Record<string, number>;
  cooldowns: Record<string, number>;
}
const agg = new Map<string, Agg>();
let rounds = 0;
let fileNo = 0;

for (const f of files) {
  fileNo++;
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  const lines: string[] = [];
  for (const m of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of Object.values(legacy.units ?? {}) as any[]) {
      if (!u.info) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let ledger: any[];
      try {
        ledger = extractMajorCooldowns(u, legacy);
      } catch {
        continue;
      }
      if (!ledger.length) continue;
      const sets = playerTalentIdSets(u);
      const talents = [
        ...(sets.talentedSpellIds ?? []),
        ...sets.pvpTalentIds,
      ].sort();
      for (const cd of ledger) {
        if (cd.isProcOnly || !cd.casts?.length) continue;
        const times = cd.casts
          .map((c: { timeSeconds: number }) => c.timeSeconds)
          .sort((a: number, b: number) => a - b);
        const impossibleAt: number[] = [];
        let floorExplained = 0;
        for (const c of times) {
          const before = {
            ...cd,
            casts: cd.casts.filter(
              (x: { timeSeconds: number }) => x.timeSeconds < c,
            ),
            sharedCasts: (cd.sharedCasts ?? []).filter(
              (x: { timeSeconds: number }) => x.timeSeconds < c,
            ),
          };
          if (!before.casts.length && !before.sharedCasts.length) continue;
          if (cdAvailableAt(before, c)) continue;
          if (
            cd.earliestCooldownSeconds !== undefined &&
            cdAvailableAt(
              { ...before, cooldownSeconds: cd.earliestCooldownSeconds },
              c,
            )
          ) {
            floorExplained++;
            continue;
          }
          impossibleAt.push(Math.round(c * 10) / 10);
        }
        const key = String(cd.spellId);
        const a: Agg = agg.get(key) ?? {
          name: cd.spellName,
          entries: 0,
          casts: 0,
          impossible: 0,
          floorExplained: 0,
          unitsWithImpossible: 0,
          specs: {},
          cooldowns: {},
        };
        a.entries++;
        a.casts += times.length;
        a.impossible += impossibleAt.length;
        a.floorExplained += floorExplained;
        if (impossibleAt.length) a.unitsWithImpossible++;
        a.specs[u.spec] = (a.specs[u.spec] ?? 0) + 1;
        const ck = `${cd.cooldownSeconds}s×${cd.charges ?? 1}`;
        a.cooldowns[ck] = (a.cooldowns[ck] ?? 0) + 1;
        agg.set(key, a);
        lines.push(
          JSON.stringify({
            file: f,
            round: rounds,
            unit: u.id,
            spec: u.spec,
            spellId: key,
            cooldownSeconds: cd.cooldownSeconds,
            charges: cd.charges ?? 1,
            earliest: cd.earliestCooldownSeconds,
            casts: times.map((t: number) => Math.round(t * 10) / 10),
            impossibleAt,
            floorExplained,
            talentsKnown: sets.talentedSpellIds !== null,
            // purchased rank ≥ 2 only (multi-rank per-rank vs total split,
            // Game-Behaviour Rule 4 — ranks read from COMBATANT_INFO)
            ranks2: Object.fromEntries(
              [...(sets.talentRanks ?? new Map<string, number>())].filter(
                ([, r]) => r >= 2,
              ),
            ),
            talents,
          }),
        );
      }
    }
  }
  if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
  if (fileNo % 50 === 0)
    console.error(`[${fileNo}/${files.length}] rounds=${rounds}`);
}

const rows = [...agg.entries()]
  .map(([id, a]) => ({ id, ...a }))
  .sort((x, y) => y.impossible - x.impossible);
console.log(
  JSON.stringify(
    {
      files: files.length,
      rounds,
      totalCasts: rows.reduce((s, r) => s + r.casts, 0),
      totalImpossible: rows.reduce((s, r) => s + r.impossible, 0),
      spells: rows,
    },
    null,
    1,
  ),
);
