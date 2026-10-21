/**
 * cooldownRecastScan.ts — every cooldown the analysis reads OUTSIDE the
 * major-cooldown ledger, checked against the log (GH #124, 2026-10-20).
 *
 * `ledgerImpossibleCastScan.ts` covers the ledger (`extractMajorCooldowns`).
 * Interrupts, CC, dispels, gap closers, enemy cooldowns and the kill-window
 * readers ask `unitCooldownOf` instead — the talent-resolved static number,
 * with none of the ledger's per-press effects. This scan asks that function
 * the same question for every spell a player cast at least twice in a round:
 * for cast i, the cast `charges` presses earlier must be at least one
 * cooldown back (less `CD_INSTANT_SLACK_S`), or the press was impossible
 * under the model — the modelled number is too LONG for that player.
 * The other direction rides along: per (spell, spec, cooldown) the smallest
 * recast ratio over many pairs well above 1 says the modelled number may be
 * too SHORT (a "ready" the game never gave).
 *
 * Ledger spells are NOT skipped: the ledger answers for the log owner's side,
 * but the enemy-side readers (kill windows, enemy cooldown windows, enemy
 * defensives) ask `unitCooldownOf` for the very same spells. Each record
 * says `onLedger`, so the two populations can be told apart.
 * Casts after the round's end (`roundEndMs`) and druid form re-shifts
 * (`isFormReshiftCast`) are not presses.
 *
 * Two readings per record: `impossibleAt` against the static
 * `unitCooldownOf` (the pre-2026-10-20 reader), and `modelImpossibleAt` /
 * `modelFloorExplained` / `modelRatios` against the shared model the readers
 * read since (`unitCooldownEntry`: the ledger's press identification and
 * per-press effects) — the same predicate pair `ledgerImpossibleCastScan`
 * uses (`cdAvailableAt` on the presses before, then `cdMaybeAvailableAt`).
 * A model ratio is a recast gap over that press's realised cooldown
 * (single-charge entries), so its minimum well above 1 over many pairs says
 * the model's number is too short. A charge entry's ratio (`modelCharge…`)
 * runs from the press that spent its last charge: the next press over the
 * model's time to a charge back.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/cooldownRecastScan.ts --manifest <m> [--every 1] [--min-cd 8] --out <file.jsonl> > summary.json
 * Output: one JSON line per (round, unit, spell) with ≥ 2 casts, and a
 * per-spell summary on stdout.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { isFormReshiftCast } from "@gladlog/analysis/src/utils/castPress";
import {
  CD_INSTANT_SLACK_S,
  cdAvailableAt,
  cdMaybeAvailableAt,
  entryAvailabilityTransitions,
  extractMajorCooldowns,
  playerTalentIdSets,
  pressReadyAgainAtSeconds,
  unitCooldownEntry,
  unitCooldownOf,
} from "@gladlog/analysis/src/utils/cooldowns";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "1"));
const minCd = Number(arg("--min-cd", "8"));
const out = arg("--out", "");
if (!manifest || !out) {
  console.error(
    "usage: --manifest <m> --out <file.jsonl> [--every 1] [--min-cd 8]",
  );
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
  records: number;
  pairs: number;
  impossible: number;
  ratios: number[];
  modelImpossible: number;
  modelFloorExplained: number;
  modelRatios: number[];
  modelChargeRatios: number[];
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
    const endMs = roundEndMs(legacy);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of Object.values(legacy.units ?? {}) as any[]) {
      if (!u.info) continue;
      let ledgerIds: Set<string>;
      try {
        ledgerIds = new Set(
          extractMajorCooldowns(u, legacy).map((cd) => String(cd.spellId)),
        );
      } catch {
        continue;
      }
      type Presses = { name: string; t: number[] };
      const bySpell = new Map<string, Presses>();
      for (const e of u.spellCastEvents ?? []) {
        if (e.logLine.event !== "SPELL_CAST_SUCCESS") continue;
        if (e.logLine.timestamp > endMs) continue;
        const id = String(e.spellId);
        if (isFormReshiftCast(u, e)) continue;
        const g: Presses = bySpell.get(id) ?? {
          name: String(e.spellName),
          t: [],
        };
        g.t.push((e.logLine.timestamp - legacy.startTime) / 1000);
        bySpell.set(id, g);
      }
      const sets = playerTalentIdSets(u);
      for (const [id, g] of bySpell) {
        if (g.t.length < 2) continue;
        const own = unitCooldownOf(u, id);
        if (!own || !(own.cooldownSeconds >= minCd)) continue;
        const cd = own.cooldownSeconds;
        const cap = Math.max(1, own.charges);
        const t = g.t.sort((a, b) => a - b);
        const impossibleAt: number[] = [];
        const a: Agg = agg.get(id) ?? {
          name: g.name,
          records: 0,
          pairs: 0,
          impossible: 0,
          ratios: [],
          modelImpossible: 0,
          modelFloorExplained: 0,
          modelRatios: [],
          modelChargeRatios: [],
          specs: {},
          cooldowns: {},
        };
        for (let i = cap; i < t.length; i++) {
          const gap = t[i]! - t[i - cap]!;
          a.pairs++;
          a.ratios.push(gap / cd);
          if (gap < cd - CD_INSTANT_SLACK_S)
            impossibleAt.push(Math.round(t[i]! * 10) / 10);
        }
        // the shared model's reading of the same unit and spell
        const entry = unitCooldownEntry(u, legacy, id);
        const modelImpossibleAt: number[] = [];
        let modelFloorExplained = 0;
        const modelRatios: number[] = [];
        const modelChargeRatios: number[] = [];
        if (entry && !entry.isProcOnly) {
          const presses = entry.casts
            .map((c) => c.timeSeconds)
            .sort((x, y) => x - y);
          for (const pt of presses) {
            const before = {
              ...entry,
              casts: entry.casts.filter((c) => c.timeSeconds < pt),
              sharedCasts: (entry.sharedCasts ?? []).filter(
                (c) => c.timeSeconds < pt,
              ),
            };
            if (!before.casts.length && !before.sharedCasts.length) continue;
            if (cdAvailableAt(before, pt)) continue;
            if (cdMaybeAvailableAt(before, pt)) {
              modelFloorExplained++;
              continue;
            }
            modelImpossibleAt.push(Math.round(pt * 10) / 10);
          }
          if ((entry.charges ?? 1) <= 1)
            for (let i = 1; i < presses.length; i++) {
              const back = pressReadyAgainAtSeconds(entry, presses[i - 1]!);
              const own = back === null ? null : back - presses[i - 1]!;
              if (own && own > 0)
                modelRatios.push((presses[i]! - presses[i - 1]!) / own);
            }
          else {
            // a charge spell: from the press that spent the last charge to
            // the model's next charge back, against the next press. The
            // charge back is read off the presses up to that one only — a
            // next press a hair before it (inside the slack) re-anchors the
            // full history's recharge and would push its flip far later.
            const horizon = entry.cooldownSeconds * (entry.charges ?? 1);
            const outs = entryAvailabilityTransitions(
              entry,
              presses[presses.length - 1]! + horizon,
            ).filter((x) => !x.available);
            for (const o of outs) {
              const next = presses.find((x) => x > o.atSeconds + 0.05);
              if (next === undefined) continue;
              const upTo = (c: { timeSeconds: number }) =>
                c.timeSeconds <= o.atSeconds + 0.05;
              const back = entryAvailabilityTransitions(
                {
                  ...entry,
                  casts: entry.casts.filter(upTo),
                  sharedCasts: (entry.sharedCasts ?? []).filter(upTo),
                },
                o.atSeconds + horizon,
              ).find((x) => x.available && x.atSeconds > o.atSeconds);
              const own = back ? back.atSeconds - o.atSeconds : 0;
              if (own > 0) modelChargeRatios.push((next - o.atSeconds) / own);
            }
          }
        }
        a.modelImpossible += modelImpossibleAt.length;
        a.modelFloorExplained += modelFloorExplained;
        a.modelRatios.push(...modelRatios);
        a.modelChargeRatios.push(...modelChargeRatios);
        a.records++;
        a.impossible += impossibleAt.length;
        a.specs[u.spec] = (a.specs[u.spec] ?? 0) + 1;
        const ck = `${cd}s×${cap}`;
        a.cooldowns[ck] = (a.cooldowns[ck] ?? 0) + 1;
        agg.set(id, a);
        lines.push(
          JSON.stringify({
            file: f,
            round: rounds,
            unit: u.id,
            spec: u.spec,
            spellId: id,
            onLedger: ledgerIds.has(id),
            cooldownSeconds: cd,
            charges: cap,
            talentsKnown: own.talentsKnown,
            casts: t.map((x) => Math.round(x * 10) / 10),
            impossibleAt,
            modelImpossibleAt,
            modelFloorExplained,
            modelMinRatio: modelRatios.length
              ? Math.round(Math.min(...modelRatios) * 1000) / 1000
              : null,
            modelChargeMinRatio: modelChargeRatios.length
              ? Math.round(Math.min(...modelChargeRatios) * 1000) / 1000
              : null,
            talents: [
              ...(sets.talentedSpellIds ?? []),
              ...sets.pvpTalentIds,
            ].sort(),
          }),
        );
      }
    }
  }
  if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
  if (fileNo % 50 === 0)
    console.error(`[${fileNo}/${files.length}] rounds=${rounds}`);
}

const q = (v: number[], p: number) => v[Math.floor((v.length - 1) * p)] ?? 0;
const rows = [...agg.entries()]
  .map(([id, a]) => {
    const r = [...a.ratios].sort((x, y) => x - y);
    const mr = [...a.modelRatios].sort((x, y) => x - y);
    const mc = [...a.modelChargeRatios].sort((x, y) => x - y);
    const {
      ratios: _ratios,
      modelRatios: _modelRatios,
      modelChargeRatios: _modelChargeRatios,
      ...rest
    } = a;
    return {
      id,
      ...rest,
      minRatio: Math.round(q(r, 0) * 1000) / 1000,
      p05Ratio: Math.round(q(r, 0.05) * 1000) / 1000,
      medianRatio: Math.round(q(r, 0.5) * 1000) / 1000,
      modelPairs: mr.length,
      modelMinRatio: mr.length ? Math.round(q(mr, 0) * 1000) / 1000 : null,
      modelP05Ratio: mr.length ? Math.round(q(mr, 0.05) * 1000) / 1000 : null,
      modelChargePairs: mc.length,
      modelChargeMinRatio: mc.length
        ? Math.round(q(mc, 0) * 1000) / 1000
        : null,
      modelChargeP05Ratio: mc.length
        ? Math.round(q(mc, 0.05) * 1000) / 1000
        : null,
    };
  })
  .sort((x, y) => y.impossible - x.impossible);
console.log(
  JSON.stringify(
    {
      files: files.length,
      rounds,
      totalPairs: rows.reduce((s, r) => s + r.pairs, 0),
      totalImpossible: rows.reduce((s, r) => s + r.impossible, 0),
      totalModelImpossible: rows.reduce((s, r) => s + r.modelImpossible, 0),
      totalModelFloorExplained: rows.reduce(
        (s, r) => s + r.modelFloorExplained,
        0,
      ),
      spells: rows,
    },
    null,
    1,
  ),
);
