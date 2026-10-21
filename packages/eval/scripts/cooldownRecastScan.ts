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
 * Usage:
 *   npx tsx packages/eval/scripts/cooldownRecastScan.ts --manifest <m> [--every 1] [--min-cd 8] --out <file.jsonl> > summary.json
 * Output: one JSON line per (round, unit, spell) with ≥ 2 casts, and a
 * per-spell summary on stdout.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { isFormReshiftCast } from "@gladlog/analysis/src/utils/castPress";
import {
  CD_INSTANT_SLACK_S,
  extractMajorCooldowns,
  playerTalentIdSets,
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
    const { ratios: _ratios, ...rest } = a;
    return {
      id,
      ...rest,
      minRatio: Math.round(q(r, 0) * 1000) / 1000,
      p05Ratio: Math.round(q(r, 0.05) * 1000) / 1000,
      medianRatio: Math.round(q(r, 0.5) * 1000) / 1000,
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
      spells: rows,
    },
    null,
    1,
  ),
);
