/**
 * fact2Scan.ts — F16 (fact2 round-2 audit, 2026-10-20): re-derive facts from
 * the parsed log and hold the rendered lines to them, over an existing
 * acceptanceCapture `--context-dir` capture (cap605: `<dir>/s<k>/context/`).
 * The same harness as `pressFactScan.ts`; one check per fact class, each
 * derived from the log events directly — never through the analysis
 * predicate it audits:
 *
 *  - `vulnAbsorbed` (R7): a `[VULNERABLE] a–b on <spec> (<name>)` line. The
 *    team's hits a shield on that target ate inside the printed span
 *    (SPELL_ABSORBED rows on it whose attacker is a unit of the owner's side
 *    — a player or a summon whose reaction is friendly) must be printed
 *    beside the total — `, +Ak absorbed` — when they reach 1k inside the
 *    span's whole interior seconds; a printed figure must lie between the
 *    interior sum and the sum over the printed seconds (± 1k rounding).
 *  - `burstAbsorbed` (R7): the same for a DPS-view `[KILL WINDOW] a–b …: team
 *    burst Nk` line and its `(+Ak absorbed)`.
 *  - `offensiveTag` (C10): an `[ENEMY DEF]` / `[ENEMY TRINKET]` line at m:ss.
 *    When, at the start of that second, a player of the owner's side had an
 *    offensive cooldown running under an aura id that is not its cast id —
 *    the cast C (an `OFFENSIVE_CD_SPELL_IDS` member on the enemy-CD window
 *    test) logged by that player, then within [−0.5 s, +3 s] an APPLIED of
 *    an aura A ≠ C that `castEffectAuraGenerated.json` lists for C by name
 *    after ≥ 90 % of its casts, A not REMOVED (same source and unit) before
 *    the second — the line must carry `[friendly offensive CD active]`.
 *  - `selfSaveUp` (C10): a KILL ATTEMPTS `[a–b] on <name> — … FAILED: healed
 *    through | not enough damage` line. When the target pressed a self-save
 *    (`SELF_SAVE_IDS`) whose own aura carries another id (same JSON rule),
 *    applied by the target on itself within 1.5 s of the press, up at the
 *    attempt's printed start (applied before it, its REMOVED logged after
 *    the second), the line must name the save instead.
 *
 *   npx tsx packages/eval/scripts/fact2Scan.ts <captureDir> [--examples N] [--archive-dir <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import castEffectAuraGenerated from "@gladlog/analysis/src/data/castEffectAuraGenerated.json";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { isEnemyCdWindowSpell } from "@gladlog/analysis/src/utils/cooldowns";
import { SELF_SAVE_IDS } from "@gladlog/analysis/src/utils/enemyDefensives";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  CombatUnitReaction,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: fact2Scan.ts <captureDir> [--examples N] [--archive-dir <dir>]",
  );
  process.exit(2);
}
const exIdx = process.argv.indexOf("--examples");
const adIdx = process.argv.indexOf("--archive-dir");
const ARCHIVE_DIR = adIdx > 0 ? (process.argv[adIdx + 1] ?? "") : "";
const EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 5;
/** contexts that could not be mapped back to a parsed round — any one fails
 * the run (a silent skip reads as "0 missing") */
const unmapped: string[] = [];

const CHECKS = [
  "vulnAbsorbed",
  "burstAbsorbed",
  "offensiveTag",
  "selfSaveUp",
] as const;

/** cast → the auras that are its own effect under another id (read straight
 * off the generated JSON: same name, after ≥ 90 % of the casts) */
const OWN_SPLIT = new Map<string, string[]>();
for (const [cast, rows] of Object.entries(
  (castEffectAuraGenerated as any).casts as Record<string, any[]>,
))
  for (const r of rows)
    if (r.aura !== cast && r.via?.includes("name") && r.hits >= 0.9 * r.casts)
      OWN_SPLIT.set(cast, [...(OWN_SPLIT.get(cast) ?? []), r.aura]);
type Check = (typeof CHECKS)[number];
const expected = new Map<Check, number>();
const missing = new Map<Check, string[]>();
const bump = (c: Check) => expected.set(c, (expected.get(c) ?? 0) + 1);
const miss = (c: Check, s: string) => {
  const l = missing.get(c) ?? [];
  l.push(s);
  missing.set(c, l);
};

const secOf = (mss: string): number => {
  const [m, s] = mss.split(":");
  return Number(m) * 60 + Number(s);
};

function parseFile(path: string): GladMatch[] {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  return items;
}

await ensureAnalysisData();
const files: Array<{
  shard: string;
  name: string;
  fileNo: number;
  round: number;
}> = [];
for (const shard of readdirSync(dir).filter((d) => /^s\d+$/.test(d))) {
  const cdir = join(dir, shard, "context");
  for (const name of readdirSync(cdir)) {
    const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
    if (m) files.push({ shard, name, fileNo: +m[1]!, round: +m[2]! });
  }
}
files.sort((a, b) =>
  a.shard === b.shard ? a.fileNo - b.fileNo : a.shard < b.shard ? -1 : 1,
);

const VULN =
  /^ {2}\[VULNERABLE\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+\(([^)]+)\): .*?\(team damage (\d+)k total(?:, \+(\d+)k absorbed)?\)/;
const BURST =
  /^ {2}\[KILL WINDOW\] (\d+:\d\d)–(\d+:\d\d) on [^(]+\(([^)]+)\): team burst (\d+)k(?: \(\+(\d+)k absorbed\))?/;

let cacheKey = "";
let cacheItems: GladMatch[] = [];
let contexts = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  const [archive, ownerName] = text.split("\n", 2);
  if (!archive || !ownerName) continue;
  const key = `${f.shard}:${archive}`;
  if (key !== cacheKey) {
    try {
      cacheItems = parseFile(
        archive.startsWith("/") ? archive : resolve(ARCHIVE_DIR, archive),
      );
    } catch {
      cacheItems = [];
    }
    cacheKey = key;
  }
  const item = cacheItems[f.round - 1];
  if (!item) {
    unmapped.push(`${f.shard}/${f.name} (${archive})`);
    continue;
  }
  let legacy: ReturnType<typeof toLegacyMatch>;
  try {
    legacy = toLegacyMatch({ ...item, rawLines: [] } as GladMatch);
  } catch {
    unmapped.push(`${f.shard}/${f.name} (toLegacyMatch threw)`);
    continue;
  }
  contexts++;
  const lines = text.split("\n");
  const units = Object.values(legacy.units ?? {}) as any[];
  const byName = new Map(units.map((u) => [u.name, u]));
  const pidName = new Map<string, string>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
    if (u) pidName.set(u[1]!, u[2]!);
  }
  const owner = byName.get(ownerName);
  if (!owner) continue;
  // the owner's side, by the log's own reaction flags (summons carry theirs)
  const ourSide = new Set(
    units
      .filter((u) => u.reaction === owner.reaction)
      .map((u) => u.id as string),
  );
  const start = legacy.startTime;
  const where = `${f.shard}/${f.name}`;
  /** team-absorbed on the target over [fromS, toS) seconds */
  const absorbedOn = (target: any, fromS: number, toS: number): number =>
    ((target.absorbsIn ?? []) as any[])
      .filter((a) => a.attackerId && ourSide.has(a.attackerId))
      .filter((a) => {
        const t = (a.logLine.timestamp - start) / 1000;
        return t >= fromS && t < toS;
      })
      .reduce((s, a) => s + Math.abs(a.absorbedAmount), 0);

  /** [applied, removed] ms of aura `aura` applied by `src` after the cast at
   * `castMs` (−0.5 s … +3 s), on any unit; removed = the next REMOVED of the
   * same source and unit, Infinity when none is logged */
  const splitIntervals = (
    src: string,
    aura: string,
    castMs: number,
    holders: any[],
  ): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const u of holders) {
      const evs = ((u.auraEvents ?? []) as any[]).filter(
        (a) => a.spellId === aura && a.srcUnitId === src && a.destUnitId === u.id,
      );
      for (const a of evs) {
        if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        const ta = a.logLine.timestamp;
        if (ta < castMs - 500 || ta > castMs + 3000) continue;
        const rm = evs.find(
          (b) =>
            b.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
            b.logLine.timestamp >= ta,
        );
        out.push([ta, rm ? rm.logLine.timestamp : Infinity]);
      }
    }
    return out;
  };
  const players = units.filter((u) => u.type === 1 || u.info);
  const ours = players.filter((u) => u.reaction === owner.reaction && u.info);
  // offensive cooldowns running under a split aura id, as [from, to] ms
  const offensiveRuns: Array<[number, number]> = [];
  for (const p of ours)
    for (const c of p.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const auras = OWN_SPLIT.get(c.spellId);
      if (!auras || !OFFENSIVE_CD_SPELL_IDS.has(c.spellId)) continue;
      if (!isEnemyCdWindowSpell(c.spellId)) continue;
      for (const a of auras)
        offensiveRuns.push(
          ...splitIntervals(p.id, a, c.logLine.timestamp, players).filter(
            ([, to]) => to !== Infinity,
          ),
        );
    }
  for (const l of lines) {
    const m = /^(\d+:\d\d) {2}\[ENEMY (?:DEF|TRINKET)\]/.exec(l);
    if (!m) continue;
    const ms = start + secOf(m[1]!) * 1000;
    if (!offensiveRuns.some(([a, b]) => a <= ms && ms < b)) continue;
    bump("offensiveTag");
    if (!l.includes("[friendly offensive CD active]"))
      miss("offensiveTag", `${where} ${l.slice(0, 110)}`);
  }
  for (const l of lines) {
    const m =
      /^ {2}\[(\d+:\d\d)–(\d+:\d\d)\] on (\S+) — .*\| (?:FAILED: )?(.*)$/.exec(
        l,
      );
    if (!m) continue;
    const target =
      byName.get(m[3]!) ?? byName.get(pidName.get(m[3]!) ?? "");
    if (!target) continue;
    const fromMs = start + secOf(m[1]!) * 1000;
    for (const c of target.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (!SELF_SAVE_IDS.has(c.spellId)) continue;
      if (c.destUnitId && c.destUnitId !== target.id && c.destUnitId !== "0000000000000000")
        continue;
      const auras = OWN_SPLIT.get(c.spellId);
      if (!auras || c.logLine.timestamp >= fromMs) continue;
      const up = auras.some((a) =>
        splitIntervals(target.id, a, c.logLine.timestamp, [target]).some(
          ([ta, tr]) =>
            Math.abs(ta - c.logLine.timestamp) <= 1500 &&
            ta < fromMs &&
            tr !== Infinity &&
            tr >= fromMs + 1000,
        ),
      );
      if (!up) continue;
      // only where the line's own order puts the save first (it outranks
      // `healed through` / `not enough damage`); an attempt that killed, or
      // met a wall, an immunity, a trinket, says that
      const name = getEnglishSpellName(c.spellId, c.spellName);
      if (!/healed through|not enough damage/.test(m[4]!) && !m[4]!.includes(name))
        continue;
      bump("selfSaveUp");
      if (!m[4]!.includes(name))
        miss(
          "selfSaveUp",
          `${where} ${m[1]}–${m[2]} ${target.name}: ${name} up, line says ${m[4]!.slice(0, 80)}`,
        );
    }
  }
  for (const l of lines) {
    for (const [check, re] of [
      ["vulnAbsorbed", VULN],
      ["burstAbsorbed", BURST],
    ] as const) {
      const m = re.exec(l);
      if (!m) continue;
      const nameOrPid = m[3]!;
      const target =
        byName.get(nameOrPid) ?? byName.get(pidName.get(nameOrPid) ?? "");
      if (!target || target.reaction === CombatUnitReaction.Neutral) continue;
      const a = secOf(m[1]!);
      const b = secOf(m[2]!);
      const printed = m[check === "vulnAbsorbed" ? 5 : 5];
      const inner = absorbedOn(target, a + 1, b);
      const outer = absorbedOn(target, a, b + 1);
      if (inner < 1000 && !printed) continue;
      bump(check);
      const p = printed ? Number(printed) * 1000 : 0;
      if (p < inner - 1000 || p > outer + 1000)
        miss(
          check,
          `${where} ${m[1]}–${m[2]} ${target.name}: printed ${printed ?? "none"}k, log ${Math.round(inner / 1000)}–${Math.round(outer / 1000)}k`,
        );
    }
  }
}

console.log(`contexts: ${contexts}`);
for (const c of CHECKS) {
  const m = missing.get(c) ?? [];
  console.log(`${c}: expected ${expected.get(c) ?? 0}, wrong ${m.length}`);
  for (const s of m.slice(0, EXAMPLES)) console.log(`    ${s}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
