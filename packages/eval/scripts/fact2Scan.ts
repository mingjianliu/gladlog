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
 *  - `allyCopy` (C1): a press of Obsidian Scales 363916 whose copy the log
 *    shows on a unit other than the caster (APPLIED / REFRESH of 363916
 *    from the caster within 0.5 s) — wherever the cast's dest pointed. Its
 *    line at the press's second (`[YOU] [CD]`, `[TEAM] [CD]   <pid>(`,
 *    `[ENEMY DEF]   <pid>(`) must name `Obsidian Scales → <that unit's
 *    pid>(`.
 *  - `ledgerCopyLabel` (C1, ruling 4): a burst ledger `Target had a major
 *    defensive up: Obsidian Scales` under a `Target:` that is not an Evoker
 *    — the only copy such a target can carry is an ally's 15 % one.
 *
 *  - `pressOnlyReady` (C8, ruling 2): a `[KILL WINDOW]` / `[VULNERABLE]` line
 *    `… ready at m:ss: <list>`. Every press-only offensive cooldown of a
 *    living player of the owner's side (`responseOnly` ledger rows) that the
 *    [RES] reading (`cdAvailableAt`) calls ready at that second must be in
 *    the list. The [RES] rows are the reference here, so the check reads
 *    their predicate.
 *
 *  - `linkAuraAudit` (C4): a `[DEATH]` block's `Mitigation audit: Blessing of
 *    Sacrifice …` row. Wrong when the dead unit's only 6940 auras in its
 *    final 10 s were its own (source = the unit: the link of a Blessing it
 *    cast on someone else).
 *
 *  - `rosterMajor` (C6): the two majors no list held — an enemy's Ascendance
 *    114052 press needs an `[ENEMY HEAL CD]` line at its second; the owner's
 *    Holy Word: Chastise 88625 presses need a `Holy Word: Chastise` entry in
 *    CC USE's `Counts:`. (The corpus-wide forward check is ledgerGapScan.)
 *  - `petCommandCount` (R2): an owner press whose same-named spell one of
 *    the owner's summons logged within 0.5 s (Command Demon). The CC USE
 *    entry of that name must count the summon's successes, not the owner's
 *    command rows.
 *
 *  - `deadSummonAvoid` (R6): an enemy Capacitor Totem 192058 / Sigil of
 *    Misery 207684 whose summon (SPELL_SUMMON within the cast's instant)
 *    was killed (overkill hit or UNIT_DIED) before its landing window opened
 *    (1.5 s / 0.5 s) and that logged no miss on anyone. It never went off: no
 *    `[CC AVOIDED?] … <name> (by <pid>…; cast m:ss)` line may name it.
 *
 *  - `fadedWhileUp` (R8): a `[BUFF FADED] X (expired, estimated)` at m:ss
 *    while the owner's own copy of X (applied or refreshed by the owner on
 *    itself before that second) is not REMOVED until a later second.
 *  - `ccHeldRebroadcast` (R8): a `[CC REMOVED] … removed <pid>'s X from
 *    <pid> after Ns` line. The control's start is its last APPLIED by that
 *    source before the removal, skipping an APPLIED that follows a REMOVED of
 *    the same aura and source in the same ms (a server re-apply); N must be
 *    within 1 s of the log's held time.
 *
 *  - `trinketOutOf` (R3): an `[ENEMY TRINKET] <pid> used PvP trinket out of
 *    X` line, or a `[CC ON TEAM]` `last used m:ss on X` (the unit at the
 *    line's head). A Medallion 336126 press of that unit in that second
 *    must have ENDED an X on it: an X aura's logged REMOVED within 300 ms of
 *    the press. An X that ran on more than 1 s past every press of the
 *    second (it landed after the press and ran out) is wrong.
 *
 *  - `deferredBreaker` (R4): a `<pid>(…) ← X … broken by <pid>(…)'s Time
 *    Dilation` line. Time Dilation goes on an ally, never on its caster, so
 *    the breaker named for its delayed damage (361029) cannot be the holder.
 *
 *  - `riderPassive` (C5): a `[MINOR DISPELS]` part `X (passive)` of a unit
 *    every one of whose X SPELL_DISPEL rows this round sits within 50 ms of
 *    a SPELL_CAST_SUCCESS of that same unit (Phantasm on Fade): a press made
 *    them, so the part is not passive.
 *
 *   npx tsx packages/eval/scripts/fact2Scan.ts <captureDir> [--examples N] [--archive-dir <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import castEffectAuraGenerated from "@gladlog/analysis/src/data/castEffectAuraGenerated.json";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  isEnemyCdWindowSpell,
} from "@gladlog/analysis/src/utils/cooldowns";
import { isDeadAt } from "@gladlog/analysis/src/utils/unitDeath";
import {
  isExternalSaveId,
  SELF_SAVE_IDS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
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
  "allyCopy",
  "ledgerCopyLabel",
  "pressOnlyReady",
  "linkAuraAudit",
  "rosterMajor",
  "petCommandCount",
  "deadSummonAvoid",
  "fadedWhileUp",
  "ccHeldRebroadcast",
  "trinketOutOf",
  "deferredBreaker",
  "riderPassive",
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

const fmtS = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
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
    // an area save's line carries no tags at all (ruling A15)
    if (!m || l.endsWith(" (area)")) continue;
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
      // a save that can go to an ally is the target's own only when cast on
      // it (`selfSaveCasts`' rule; an area save — Rallying Cry — has no dest
      // and is out: registered open on GH #153)
      if (isExternalSaveId(c.spellId) && c.destUnitId !== target.id) continue;
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
  // C1: Obsidian Scales copies on any unit
  const pidOf = new Map<string, string>();
  for (const [pid, name] of pidName) pidOf.set(name, pid);
  for (const u of players) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (c.spellId !== "363916") continue;
      const ts = c.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const carriers = players.filter(
        (o) =>
          o.id !== u.id &&
          ((o.auraEvents ?? []) as any[]).some(
            (a) =>
              a.spellId === "363916" &&
              a.srcUnitId === u.id &&
              a.destUnitId === o.id &&
              (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
                a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
              Math.abs(a.logLine.timestamp - ts) <= 500,
          ),
      );
      if (carriers.length === 0) continue;
      bump("allyCopy");
      const t = fmtS((ts - start) / 1000);
      const pids = carriers.map((o) => pidOf.get(o.name)).filter(Boolean);
      const ok = lines.some(
        (l) =>
          l.startsWith(`${t}  `) &&
          (l.includes("[YOU] [CD]") ||
            l.includes(`[TEAM] [CD]   ${me}(`) ||
            l.includes(`[ENEMY DEF]   ${me}(`)) &&
          pids.some((p) => l.includes(`Obsidian Scales → ${p}(`)),
      );
      if (!ok)
        miss(
          "allyCopy",
          `${where} ${t} ${u.name} → ${carriers.map((o) => o.name).join("/")} (dest ${c.destUnitName})`,
        );
    }
  }
  // C8: press-only offensive rows the [RES] reading calls ready
  const pressOnly = ours.flatMap((f) => {
    try {
      return extractMajorCooldowns(f, legacy as any)
        .filter((cd) => cd.responseOnly && OFFENSIVE_CD_SPELL_IDS.has(cd.spellId))
        .map((cd) => ({ cd, f }));
    } catch {
      return [];
    }
  });
  for (const l of lines) {
    const m = /^ {2}\[(?:KILL WINDOW|VULNERABLE)\] .*team offensive CDs ready at (\d+:\d\d): ([^(;]*)/.exec(l);
    if (!m) continue;
    const sec = secOf(m[1]!);
    for (const { cd, f } of pressOnly) {
      if (isDeadAt(f, start + sec * 1000)) continue;
      if (!cdAvailableAt(cd, sec)) continue;
      bump("pressOnlyReady");
      if (!m[2]!.includes(cd.spellName))
        miss("pressOnlyReady", `${where} ${m[1]} ${f.name} ${cd.spellName}: "${m[2]!.trim().slice(0, 60)}"`);
    }
  }
  // C4: the death audit's Blessing of Sacrifice row on its own caster
  let deathOf: { unit: any; sec: number } | undefined;
  for (const l of lines) {
    const dm = /^(\d+:\d\d) {2}\[DEATH\] {2}(\d+)\(/.exec(l);
    if (dm) {
      const u = byName.get(pidName.get(dm[2]!) ?? "");
      deathOf = u ? { unit: u, sec: secOf(dm[1]!) } : undefined;
      continue;
    }
    if (!deathOf || !/^ +Mitigation audit: Blessing of Sacrifice /.test(l)) continue;
    const { unit, sec } = deathOf;
    const fromMs = start + (sec - 10) * 1000;
    const toMs = start + (sec + 1) * 1000;
    const rows = ((unit.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.spellId === "6940" &&
        a.destUnitId === unit.id &&
        a.logLine.timestamp <= toMs &&
        a.logLine.timestamp >= fromMs - 15_000,
    );
    if (rows.length === 0) continue;
    bump("linkAuraAudit");
    if (rows.every((a) => a.srcUnitId === unit.id))
      miss("linkAuraAudit", `${where} ${unit.name} death ${fmtS(sec)}: audit lists its own Blessing link`);
  }
  // C6
  for (const u of players) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const ts = c.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const t = fmtS((ts - start) / 1000);
      if (c.spellId === "114052" && u.reaction !== owner.reaction) {
        bump("rosterMajor");
        if (!lines.some((l) => l.startsWith(`${t}  [ENEMY HEAL CD]`) && l.includes(`${me}(`) && l.includes("Ascendance")))
          miss("rosterMajor", `${where} ${t} ${u.name} Ascendance: no [ENEMY HEAL CD]`);
      }
      if (c.spellId === "88625" && u.name === ownerName) {
        bump("rosterMajor");
        if (!lines.some((l) => l.includes("Counts:") && l.includes("Holy Word: Chastise")))
          miss("rosterMajor", `${where} ${t} ${u.name} Chastise: not in CC USE`);
      }
    }
  }
  // R2: Command Demon presses
  {
    const summons = units.filter(
      (x) => x.ownerId === owner.id && String(x.id).startsWith("Pet-"),
    );
    const nameOf = (e: any) => getEnglishSpellName(e.spellId ?? "", e.spellName);
    const petRows = summons.flatMap((p: any) =>
      [...(p.castStartEvents ?? []), ...(p.spellCastEvents ?? [])].map((e: any) => ({ p, e })),
    );
    const commanded = new Map<string, number>();
    for (const e of (owner.spellCastEvents ?? []) as any[]) {
      if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const n = nameOf(e);
      if (petRows.some(({ e: r }) => nameOf(r) === n && Math.abs(r.logLine.timestamp - e.logLine.timestamp) <= 500))
        commanded.set(n, (commanded.get(n) ?? 0) + 1);
    }
    for (const [n, ownerCount] of commanded) {
      const petOk = petRows.filter(
        ({ e }) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          nameOf(e) === n &&
          e.logLine.timestamp >= start &&
          e.logLine.timestamp <= legacy.endTime,
      ).length;
      const cl = lines.find((l) => l.includes("Counts:"));
      if (!cl) continue;
      const m = new RegExp(`${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?:cast (\\d+)×|cast bar started \\d+×, went off (\\d+)×)`).exec(cl);
      if (!m) continue;
      bump("petCommandCount");
      const printed = Number(m[1] ?? m[2]);
      if (printed !== petOk)
        miss("petCommandCount", `${where} ${n}: printed ${printed} (the owner's command rows ${ownerCount}), the pet's successes ${petOk}`);
    }
  }
  // R6: a delayed control whose summon died before its window
  for (const u of players) {
    if (u.reaction === owner.reaction) continue;
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const opensS = c.spellId === "192058" ? 1.5 : c.spellId === "207684" ? 0.5 : null;
      if (opensS === null) continue;
      const ts = c.logLine.timestamp;
      const summon = units.find(
        (x) =>
          x.ownerId === u.id &&
          ((x.actionIn ?? []) as any[]).some(
            (a) =>
              a.logLine.event === LogEvent.SPELL_SUMMON &&
              a.logLine.timestamp >= ts - 100 &&
              a.logLine.timestamp <= ts + 500,
          ),
      );
      if (!summon) continue;
      const killMs = Math.min(
        ...((summon.damageIn ?? []) as any[])
          .filter((d) => (d.overkill ?? 0) > 0)
          .map((d) => d.timestamp),
        ...((summon.deathRecords ?? []) as any[]).map((d) => d.timestamp),
      );
      if (!(killMs < ts + opensS * 1000)) continue;
      bump("deadSummonAvoid");
      const name = getEnglishSpellName(c.spellId, c.spellName);
      const castT = fmtS((ts - start) / 1000);
      const bad = lines.find(
        (l) =>
          l.includes("[CC AVOIDED?]") &&
          l.includes(`${name} (by ${me}(`) &&
          (l.includes(`cast ${castT})`) || l.startsWith(`${castT}  `)),
      );
      if (bad) miss("deadSummonAvoid", `${where} ${castT} ${u.name} ${name}: ${bad.slice(0, 120)}`);
    }
  }
  // R8a: [BUFF FADED] estimated while the owner's copy is up
  for (const l of lines) {
    const fm = /^(\d+:\d\d) {2}\[BUFF FADED\] {3}(.+?) \(expired, estimated\)/.exec(l);
    if (!fm) continue;
    const tMs = start + secOf(fm[1]!) * 1000;
    const rows = ((owner.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.srcUnitId === owner.id &&
        a.destUnitId === owner.id &&
        getEnglishSpellName(a.spellId ?? "", a.spellName) === fm[2],
    );
    const lastOn = rows
      .filter(
        (a) =>
          (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
            a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
          a.logLine.timestamp < tMs,
      )
      .pop();
    if (!lastOn) continue;
    const nextOff = rows.find(
      (a) =>
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        a.logLine.timestamp >= lastOn.logLine.timestamp,
    );
    if (!nextOff) continue;
    bump("fadedWhileUp");
    if (nextOff.logLine.timestamp >= tMs + 1000)
      miss("fadedWhileUp", `${where} ${fm[1]} ${fm[2]}: owner's copy up until ${fmtS((nextOff.logLine.timestamp - start) / 1000)}`);
  }
  // R8b: [CC REMOVED] held seconds across a server re-apply
  for (const l of lines) {
    const rm = /^(\d+:\d\d) {2}\[CC REMOVED\] .* removed (\d+)\([^)]*\)'s (.+?) from (\d+)\([^)]*\) after (\d+)s/.exec(l);
    if (!rm) continue;
    const caster = byName.get(pidName.get(rm[2]!) ?? "");
    const target = byName.get(pidName.get(rm[4]!) ?? "");
    if (!caster || !target) continue;
    const sec = secOf(rm[1]!);
    const rows = ((target.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.srcUnitId === caster.id &&
        getEnglishSpellName(a.spellId ?? "", a.spellName) === rm[3],
    );
    // the real removal: not a REMOVED an APPLIED of the same ms follows
    const removal = rows.find(
      (a, k) =>
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        a.logLine.timestamp >= start + sec * 1000 &&
        a.logLine.timestamp < start + (sec + 1) * 1000 &&
        !(
          rows[k + 1]?.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          rows[k + 1].logLine.timestamp === a.logLine.timestamp
        ),
    );
    if (!removal) continue;
    const i = rows.indexOf(removal);
    let applyMs: number | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const a = rows[j];
      if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
      const prev = rows[j - 1];
      if (
        prev &&
        prev.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        prev.logLine.timestamp === a.logLine.timestamp
      )
        continue; // a server re-apply
      applyMs = a.logLine.timestamp;
      break;
    }
    if (applyMs === undefined) continue;
    bump("ccHeldRebroadcast");
    const held = (removal.logLine.timestamp - applyMs) / 1000;
    if (Math.abs(Number(rm[5]) - held) >= 1)
      miss("ccHeldRebroadcast", `${where} ${rm[1]} ${rm[3]}: printed after ${rm[5]}s, log ${held.toFixed(2)}s`);
  }
  // R3: what the Medallion broke
  const trinketChecked = new Set<string>();
  for (const l of lines) {
    const em = /^(\d+:\d\d) {2}\[ENEMY TRINKET\] {3}(\d+)\([^)]*\) used PvP trinket out of (.+?) \(by /.exec(l);
    const fm = /^\d+:\d\d {2}\[CC ON TEAM\] {3}(\d+)\(.*last used (\d+:\d\d) on (.+?)\)/.exec(l);
    const at = em ? em[1]! : fm ? fm[2]! : undefined;
    const pid = em ? em[2]! : fm ? fm[1]! : undefined;
    const x = em ? em[3]! : fm ? fm[3]! : undefined;
    if (!at || !pid || !x) continue;
    const key = `${pid}|${at}|${x}`;
    if (trinketChecked.has(key)) continue;
    trinketChecked.add(key);
    const unit = byName.get(pidName.get(pid) ?? "");
    if (!unit) continue;
    const sec = secOf(at);
    const presses = ((unit.spellCastEvents ?? []) as any[])
      .filter(
        (c) =>
          c.spellId === "336126" &&
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.logLine.timestamp >= start + sec * 1000 &&
          c.logLine.timestamp < start + (sec + 1) * 1000,
      )
      .map((c) => c.logLine.timestamp);
    if (presses.length === 0) continue;
    const removals = ((unit.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
          getEnglishSpellName(a.spellId ?? "", a.spellName) === x,
      )
      .map((a) => a.logLine.timestamp);
    bump("trinketOutOf");
    const ended = removals.some((r) => presses.some((p) => Math.abs(r - p) <= 300));
    const ranOn = removals.some((r) => presses.every((p) => r > p + 1000) && r < presses[0]! + 60_000);
    if (!ended && ranOn)
      miss("trinketOutOf", `${where} ${at} ${unit.name}: bound to ${x}, which ran on past the press`);
  }
  for (const l of lines) {
    const bm = /\[CC ON (?:TEAM|ENEMY)\] {3}(\d+)\(.*broken by (\d+)\([^)]*\)'s Time Dilation/.exec(l);
    if (!bm) continue;
    bump("deferredBreaker");
    if (bm[1] === bm[2]) miss("deferredBreaker", `${where} ${l.slice(0, 120)}`);
  }
  for (const l of lines) {
    const mm = /^\d+:\d\d {2}\[MINOR DISPELS\] {3}(\d+)\([^)]*\)(?:'s \w+)?: (.*)$/.exec(l);
    if (!mm || /'s (?:pet|guardian|totem)/.test(l.slice(0, 40))) continue;
    const unit = byName.get(pidName.get(mm[1]!) ?? "");
    if (!unit) continue;
    for (const pm of mm[2]!.matchAll(/(?:^|, )([^,(]+?) (?:×\d+ )?\(passive\)/g)) {
      const name = pm[1]!.trim();
      const rows = ((unit.actionOut ?? []) as any[]).filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_DISPEL &&
          a.srcUnitId === unit.id &&
          getEnglishSpellName(a.spellId ?? "", a.spellName) === name &&
          a.logLine.timestamp >= start &&
          a.logLine.timestamp <= legacy.endTime,
      );
      if (rows.length === 0) continue;
      bump("riderPassive");
      const presses = ((unit.spellCastEvents ?? []) as any[])
        .filter((c) => c.logLine.event === LogEvent.SPELL_CAST_SUCCESS)
        .map((c) => c.logLine.timestamp);
      if (rows.every((r) => presses.some((p) => Math.abs(p - r.logLine.timestamp) <= 50)))
        miss("riderPassive", `${where} ${unit.name} ${name} (passive), every removal with a press`);
    }
  }
  let ledgerTarget: any;
  for (const l of lines) {
    const tm = /^ {4}Target: (\S+) /.exec(l);
    if (tm) ledgerTarget = byName.get(tm[1]!);
    if (!/^ {4}Target had (?:a major defensive|an ally's)/.test(l)) continue;
    if (!l.includes(": Obsidian Scales active ON THE TARGET")) continue;
    // an Evoker carries its own 30 % copy: only a non-Evoker target's copy is
    // necessarily an ally's (spec ids 1467 / 1468 / 1473)
    if (!ledgerTarget || ["1467", "1468", "1473"].includes(String(ledgerTarget.spec)))
      continue;
    bump("ledgerCopyLabel");
    if (l.includes("Target had a major defensive up"))
      miss("ledgerCopyLabel", `${where} ${ledgerTarget.name}: ${l.trim().slice(0, 90)}`);
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
