/**
 * offListPressScan.ts — GH #176 (user ruling 2026-11-02: "把所有天赋的时间、
 * 持续时间、缩短这些东西先算清楚…再去把它打印出来"). Every number a `[PRESS]`
 * line prints, checked against the log before the line is printed: the
 * presses come from the renderer's own `extractOffListPresses`, so the scan
 * reads exactly what the line would say.
 *
 * Per press:
 *  - `back` (`readyAgainAtSeconds`, the shared cooldown model): the unit's
 *    next press of the spell. Pressed again more than `CD_INSTANT_SLACK_S`
 *    before it = the model's cooldown is too LONG for that unit
 *    (`backAfterNextPress`); a row the model does not count as a press of
 *    its entry = `notAPress`.
 *  - `lasts` (`durationSeconds`, `buffFullDurationForCaster`): the APPLIED
 *    row the line read it from (`durationAura` — `pressAuraCandidates`, the
 *    cast's target first) lived until its REMOVED on that unit; a life past the printed value by
 *    more than `LASTS_SLACK_S` = the model's duration is too SHORT
 *    (`lastsBeyond` — an aura cannot outlive its duration, Game-Behaviour
 *    Rule 7). A life cut by another application of it before the REMOVED is
 *    not read. `reached` counts lives within 0.5 s of the printed value: with
 *    many lives and none reached, the printed value may be too long (or the
 *    aura is always consumed early).
 * Aggregated per (spell, spec, model cooldown, charges, model duration).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/offListPressScan.ts --manifest <m> [--every 1] --out <violations.jsonl> > summary.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { CD_INSTANT_SLACK_S } from "@gladlog/analysis/src/utils/cooldowns";
import { extractOffListPresses } from "@gladlog/analysis/src/utils/offListPress";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

import { arg } from "./lib/cli";

/** a logged life this far past the printed duration is beyond it */
const LASTS_SLACK_S = 0.6;
const REACHED_S = 0.5;

const manifest = arg("--manifest", "");
const every = Number(arg("--every", "1"));
const out = arg("--out", "");
if (!manifest || !out) {
  console.error("usage: --manifest <m> --out <file.jsonl> [--every 1]");
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
  spellId: string;
  name: string;
  spec: string;
  cooldownSeconds: number;
  charges: number;
  durationSeconds: number | null;
  presses: number;
  backChecked: number;
  backAfterNextPress: number;
  notAPress: number;
  durChecked: number;
  lastsBeyond: number;
  reached: number;
  maxLife: number;
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
    const units = Object.values(legacy.units ?? {}) as any[];
    const players = units.filter((u) => u.info);
    let presses: ReturnType<typeof extractOffListPresses>;
    try {
      presses = extractOffListPresses(players, legacy, roundEndMs(legacy));
    } catch {
      continue;
    }
    for (const p of presses) {
      const u = p.unit as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const key = [
        p.spellId,
        u.spec,
        p.cooldownSeconds,
        p.charges,
        p.durationSeconds ?? "-",
      ].join("|");
      const a: Agg = agg.get(key) ?? {
        spellId: p.spellId,
        name: getEnglishSpellName(p.spellId, ""),
        spec: String(u.spec),
        cooldownSeconds: p.cooldownSeconds,
        charges: p.charges,
        durationSeconds: p.durationSeconds ?? null,
        presses: 0,
        backChecked: 0,
        backAfterNextPress: 0,
        notAPress: 0,
        durChecked: 0,
        lastsBeyond: 0,
        reached: 0,
        maxLife: 0,
      };
      agg.set(key, a);
      a.presses++;
      const where = { file: f, round: rounds, unit: u.name, spec: u.spec };
      // back: the next press of this spell by this unit
      // a free press needs no readiness (Time Spiral): not the next one
      const next = presses.find(
        (q) =>
          q.unit === p.unit &&
          q.spellId === p.spellId &&
          !q.free &&
          q.timeSeconds > p.timeSeconds + 0.001,
      );
      if (p.readyAgainAtSeconds === null) {
        a.notAPress++;
        lines.push(
          JSON.stringify({
            kind: "notAPress",
            ...where,
            id: p.spellId,
            t: p.timeSeconds,
          }),
        );
      } else if (next) {
        a.backChecked++;
        if (next.timeSeconds < p.readyAgainAtSeconds - CD_INSTANT_SLACK_S) {
          a.backAfterNextPress++;
          lines.push(
            JSON.stringify({
              kind: "backAfterNextPress",
              ...where,
              id: p.spellId,
              t: p.timeSeconds,
              back: p.readyAgainAtSeconds,
              next: next.timeSeconds,
            }),
          );
        }
      }
      // lasts: the aura row the line's duration was read from
      // (`durationAura`, `pressAuraCandidates`), to its REMOVED on that unit
      if (p.durationSeconds === undefined || !p.durationAura) continue;
      const da = p.durationAura;
      const holder = units.find((d) => d.id === da.unitId);
      const rows = (holder?.auraEvents ?? []).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r.srcUnitId === u.id && r.spellId === da.spellId,
      );
      const i = rows.findIndex(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) =>
          r.logLine.event === "SPELL_AURA_APPLIED" &&
          r.logLine.timestamp === da.atMs,
      );
      let life: number | undefined;
      if (i >= 0) {
        const start = rows[i].logLine.timestamp;
        for (let j = i + 1; j < rows.length; j++) {
          const r = rows[j];
          const ev = r.logLine.event;
          if (ev === "SPELL_AURA_REMOVED") {
            life = (r.logLine.timestamp - start) / 1000;
            break;
          }
          // a same-ms REMOVED → APPLIED re-broadcast is the same run
          if (
            (ev === "SPELL_AURA_APPLIED" || ev === "SPELL_AURA_REFRESH") &&
            r.logLine.timestamp > start
          )
            break;
        }
      }
      if (life === undefined) continue;
      a.durChecked++;
      a.maxLife = Math.max(a.maxLife, life);
      if (Math.abs(life - p.durationSeconds) <= REACHED_S) a.reached++;
      // a floor (`lasts 10s+`, Timewalker) holds no life to it
      if (!p.durationIsFloor && life > p.durationSeconds + LASTS_SLACK_S) {
        a.lastsBeyond++;
        lines.push(
          JSON.stringify({
            kind: "lastsBeyond",
            ...where,
            id: p.spellId,
            t: p.timeSeconds,
            printed: p.durationSeconds,
            life,
          }),
        );
      }
    }
  }
  if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
  if (fileNo % 50 === 0)
    console.error(`[${fileNo}/${files.length}] rounds=${rounds}`);
}

const rows = [...agg.values()].sort((a, b) => b.presses - a.presses);
const sum = (k: keyof Agg) =>
  rows.reduce(
    (s, r) => s + (typeof r[k] === "number" ? (r[k] as number) : 0),
    0,
  );
console.log(
  JSON.stringify(
    {
      files: files.length,
      rounds,
      presses: sum("presses"),
      backChecked: sum("backChecked"),
      backAfterNextPress: sum("backAfterNextPress"),
      notAPress: sum("notAPress"),
      durChecked: sum("durChecked"),
      lastsBeyond: sum("lastsBeyond"),
      spells: rows,
    },
    null,
    1,
  ),
);
