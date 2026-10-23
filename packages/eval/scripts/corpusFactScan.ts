/* eslint-disable @typescript-eslint/no-explicit-any -- the scan walks the untyped legacy parse objects (match.units, auraEvents, absorbsIn) by the hundred */
/**
 * corpusFactScan.ts — corpus-wide deterministic fact checks, batch 1
 * (round1+2, 2026-10-21: "不只是抽样 还在更多的对局做general的全量搜索").
 * The fact classes the sampled model audits kept finding (round 3,
 * `runs/fact3-2026-10-21/REPORT.md`, single-audit recall 62–74 %), searched
 * over a whole acceptanceCapture `--context-dir` capture so a class is found
 * completely. The same harness as `fact2Scan.ts` (file loop, parse cache,
 * unit / pid mapping, `unmapped` → exit 1, `--examples N`). Every check
 * derives its fact from the log events directly — never through the
 * analysis predicate it audits. Data tables read here are lookups only:
 * English names, `castsOfEffectAura` (cast ↔ own aura), the official
 * `durationSeconds`, the control id sets.
 *
 *  - `hiddenPressUnused` (round 3 D35: Evasion pressed inside Mass
 *    Invisibility, logged as aura only, kit printed `[UNUSED]`). A kit
 *    cooldown N of unit U whose aura (English name N) U APPLIED on itself
 *    inside the round with no SPELL_CAST_SUCCESS of U's of it (same id, same
 *    name, or a cast `castsOfEffectAura` lists for the aura) within
 *    [−1 s, +0.5 s], the aura not already up (an earlier APPLIED of the same
 *    id / source / dest with no REMOVED after it — a re-listing when the unit
 *    becomes visible again) and no REMOVED of it in the 50 ms before (a
 *    server re-apply). Not a press: a copy shorter than 60 % of the pressed
 *    length (the corpus median of the aura's clean runs that DO have an own
 *    cast row in that window, ≥ 5 of them, else the official duration) that
 *    did not run into the round's end; an aura with an own press of another
 *    spell 0–100 ms before it, or an own DEBUFF in the same ms (a talent's
 *    marker: Well-Honed Instincts beside Frenzied Regeneration; Swiftmend →
 *    Incarnation: Tree of Life) — unless ≥ 4 other own auras are listed in
 *    that ms (the unit came back into view: a press hidden before it); an
 *    aura id that goes up castless in > 15 % of its fresh applications
 *    corpus-wide (a mechanic: Summon Infernal, Malevolence). Violation (a)
 *    `kit`: U's kit line still tags N `[UNUSED]`; (b) `noLine`: no timeline
 *    line at the aura's second names N — judged only for a re-listing (a
 *    press the unit's being out of view hid) and only for a side|name whose
 *    logged presses get such a line (≥ 10, ≥ 80 %): elsewhere a delayed own
 *    buff (Kingsbane 394095, 1.4 s after its cast row) or a talent copy
 *    whose trigger is > 100 ms away (Avatar after Thunder Blast) reads the
 *    same.
 *  - `auraCastGap` — measurement: every self-applied aura of a player
 *    followed by that player's own cast row of it (same id, or a cast
 *    `castsOfEffectAura` lists) within 0–300 ms, with no such cast in the
 *    1 s before the aura: the gap histogram, per spell, > 50 ms, p99 / max.
 *    Violations: (a) `noPress`: an `[ENEMY DEF] … [no press logged]` /
 *    `[ENEMY CD] … (no press)` line whose aura (APPLIED by that unit in the
 *    line's second, by name) has the unit's own cast row of it logged within
 *    300 ms after the aura (round 3 D32, Vanish 53 ms); (b) `trinketOutOf`: a
 *    PvP-trinket effect aura (Gladiator's Medallion 336126, Will to Survive
 *    59752, Will of the Forsaken 7744) APPLIED on a unit in the same ms as a
 *    hard-control aura (DEBUFF, `ccSpellIds` minus `ROOT_SPELL_IDS`: the
 *    line's `out of` never names a root, by design) REMOVED on it, and the
 *    unit's trinket line at that second — `[ENEMY TRINKET]` — has no `out of
 *    …` (round 3 D23 / D39 / D41: the cast row lags the aura 45–85 ms). For
 *    the owner's side the binding lives on the control's own `[CC ON TEAM]`
 *    line (`… broke this CC` / `ended by their …`; the `[TRINKET]` line
 *    prints `out of` only for a disarm), so there the check reads the last
 *    such line at or before the trinket's second (one that says the control
 *    outlived the round is not judged). Not judged either (fix-F16,
 *    2026-10-21): a control whose line says the round ended on it, and one
 *    that ran its full official length × DR share — it expired in the
 *    trinket's ms.
 *  - `fullRunEndedEarly` — measurement: per aura id, the clean runs (APPLIED
 *    → REMOVED, same source and dest, no REFRESH / re-APPLIED between, both
 *    inside the round). Ids with ≥ 20 runs of which ≥ 80 % end within ±0.1 s
 *    of one value V that differs from the official duration
 *    (`spellEffectGenerated.json` `durationSeconds`) by > 0.5 s are listed.
 *    Violations: an early-end claim — `[BUFF FADED] X (ended early …)`,
 *    `[ENEMY DEF] … (…, N.Ns — removed early)`, `[CC ON …] … | ended early
 *    …` — on a clean run that lasted ≥ V − 0.1 s of a listed id (`atV`), or
 *    ≥ its official duration − 0.1 s for any id (`fullOfficial`) except one
 *    whose V lies above the official duration (a talent extends it there);
 *    since codex 21-R12-a #5 (2026-10-23) the bar is the caster's own full
 *    length when its talents make it longer (`buffFullDurationForCaster`): a
 *    talented Rallying Cry cancelled at 12 s did end early.
 *  - `reflectReturn` — every REFLECT miss row (spell S, caster C, reflector
 *    R), rows of the same S / C / R within 3 s folded into one reflect. What
 *    came back: damage (landed + absorbed) on C under S (matched by English
 *    name: one spell logs its cast and its hit under two ids) — from R, R's
 *    pet or C itself (the log often writes the reflected hit C → C) within
 *    [−0.5 s, +3 s] of the reflect, or a periodic row of an S aura on C
 *    applied at or after it (a reflected DoT is logged as C's own aura on
 *    itself, ticking C → C; a same-ms REMOVED + APPLIED continues it); R's
 *    own earlier DoT of S on C is excluded (round 3 D15 / D40) — plus rows
 *    under the
 *    reflector's own ids (Spell Reflection 23920, Nether Ward 212295) within
 *    [−0.5 s, +3 s] (the brief's ±0.5 s; the product's own measurement saw
 *    these up to 2.9 s after the REFLECT row — projectile flight), each to
 *    the nearest damaging reflect of R's, only when S deals damage (the
 *    corpus logs a damage or absorb row under S somewhere).
 *    Violations: (a) `amount`: a `[REFLECTED] … (came back for Nk)` that
 *    differs from the recomputed figure by > max(2k, 10 %); (b)
 *    `nonDamaging`: such a line for an S that deals no damage (Spellsteal, a
 *    control — round 3 D6 / D25); (c) `noLine`: a damaging S whose return is
 *    ≥ 5 % of C's max HP (the line's own floor) with no line.
 *
 *   npx tsx packages/eval/scripts/corpusFactScan.ts <captureDir> [--examples N]
 *     [--archive-dir <dir>] [--json <violations.json>]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import {
  REFLECT_CHAIN_GAP_MS,
  REFLECT_DIRECT_RETURN_MS,
  REFLECT_OWN_ID_LEAD_MS,
} from "@gladlog/analysis/src/context/spellOutcomeLines";
import { BACKLASH_AURA_CC_TYPE } from "@gladlog/analysis/src/data/backlashCc";
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { ROOT_SPELL_IDS } from "@gladlog/analysis/src/data/rootSpells";
import {
  ccFullDurationSeconds,
  getEnglishSpellName,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellEffectGenerated from "@gladlog/analysis/src/data/spellEffectGenerated.json";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { HERALD_PROC_BUNDLE_IDS } from "@gladlog/analysis/src/utils/hiddenPress";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: corpusFactScan.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>]",
  );
  process.exit(2);
}
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ARCHIVE_DIR = argOf("--archive-dir") ?? "";
const EXAMPLES = Number(argOf("--examples") ?? 5);
const JSON_OUT = argOf("--json");
const unmapped: string[] = [];

const CHECKS = [
  "hiddenPressUnused",
  "auraCastGap",
  "fullRunEndedEarly",
  "reflectReturn",
] as const;
type Check = (typeof CHECKS)[number];
interface IViolation {
  check: Check;
  kind: string;
  where: string;
  archive: string;
  round: number;
  /** ms since the epoch of the fact's log row (for the raw-line lookup) */
  atMs: number;
  /** atMs − the round's start (the raw-line lookup offset) */
  offMs: number;
  detail: string;
}
const checked = new Map<string, number>();
const violations: IViolation[] = [];
const bump = (c: string) => checked.set(c, (checked.get(c) ?? 0) + 1);

const official = spellEffectGenerated as Record<
  string,
  { durationSeconds?: number }
>;
const officialS = (id: string): number | undefined => {
  const d = official[id]?.durationSeconds;
  return typeof d === "number" && d > 0 ? d : undefined;
};
const nameOf = (id: string | undefined, fallback = ""): string =>
  id ? getEnglishSpellName(id, fallback) : fallback;
const fmtS = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const secOf = (mss: string): number => {
  const [m, s] = mss.split(":");
  return Number(m) * 60 + Number(s);
};
const ev = (a: any): string => a.logLine.event;
const tsOf = (a: any): number => a.logLine?.timestamp ?? a.timestamp;
const APPLIED = LogEvent.SPELL_AURA_APPLIED as string;
const REMOVED = LogEvent.SPELL_AURA_REMOVED as string;
const REFRESH = LogEvent.SPELL_AURA_REFRESH as string;
const SUCCESS = LogEvent.SPELL_CAST_SUCCESS as string;
const PERIODIC = LogEvent.SPELL_PERIODIC_DAMAGE as string;

const TRINKET_AURAS = new Map([
  ["336126", "PvP trinket"],
  ["59752", "Will to Survive"],
  ["7744", "Will of the Forsaken"],
]);
const REFLECT_OWN_IDS = new Set(["23920", "212295"]);
/** deferral shields: what they held lands later as the shield caster's own
 * damage, not the reflector's */
const DEFERRAL_SHIELDS = new Set(["357170", "410355"]);

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

// ── round-level measurements (each round once, whatever its owner count) ──
const measuredRounds = new Set<string>();
/** auraCastGap: spell id → gaps (ms) */
const gapBySpell = new Map<string, number[]>();
/** fullRunEndedEarly: aura id → clean run lengths (s) */
const runsById = new Map<string, number[]>();
/** spell ids the corpus logs a damage or absorb row under */
const damagingIds = new Set<string>();

// ── deferred checks (need the corpus-wide measurement first) ──
interface IEarlyClaim {
  where: string;
  archive: string;
  round: number;
  startMs: number;
  atMs: number;
  auraId: string;
  runS: number;
  /** the caster's own full length, talents included (undefined: unknown) */
  talentedS?: number;
  line: string;
}
const earlyClaims: IEarlyClaim[] = [];
interface IHiddenCand {
  where: string;
  archive: string;
  round: number;
  startMs: number;
  ta: number;
  auraId: string;
  name: string;
  runS: number | null;
  endsWithRound: boolean;
  side: "owner" | "team" | "enemy";
  unused: boolean;
  hasLine: boolean;
  relisting: boolean;
  what: string;
}
const hiddenCands: IHiddenCand[] = [];
/** `side|name` → logged presses of a kit cooldown, and how many got a line */
const pressLineRate = new Map<string, { n: number; lined: number }>();
/** aura id → fresh self-APPLIED by a player, and how many had no own cast */
const castlessById = new Map<string, { n: number; castless: number }>();
/** hiddenPressUnused: aura id → clean run lengths (s) of a self-aura whose
 * own cast row is logged within [−1 s, +0.5 s] (the pressed length) */
const pressedRunsById = new Map<string, number[]>();
interface IReflectGroup {
  where: string;
  archive: string;
  round: number;
  startMs: number;
  t0: number;
  casterPid: string;
  reflectorPid: string;
  casterName: string;
  reflectorName: string;
  spellId: string;
  spellName: string;
  direct: number;
  maxHp: number;
  line?: { text: string; back: number | null };
  own: number; // resolved later
}
interface IOwnRow {
  ts: number;
  amt: number;
  groups: IReflectGroup[];
}
const reflectGroups: IReflectGroup[] = [];
const ownRows: IOwnRow[] = [];

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
  const byId = new Map(units.map((u) => [u.id as string, u]));
  const pidName = new Map<string, string>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
    if (u) pidName.set(u[1]!, u[2]!);
  }
  const pidOf = new Map<string, string>();
  for (const [pid, name] of pidName) pidOf.set(name, pid);
  const unitOfPid = (pid: string | undefined): any =>
    pid ? byName.get(pidName.get(pid) ?? "") : undefined;
  const owner = byName.get(ownerName);
  if (!owner) continue;
  const start: number = legacy.startTime;
  const end: number = legacy.endTime;
  const inRound = (ms: number) => ms >= start && ms <= end;
  const where = `${f.shard}/${f.name}`;
  const roundKey = `${archive}#${f.round}`;
  const players = units.filter((u) => u.type === 1 || u.info);
  const petsOf = (id: string) =>
    new Set(units.filter((u) => u.ownerId === id).map((u) => u.id as string));
  /** the rows of aura events whose dest is the unit, in log order */
  const auraIn = (u: any): any[] =>
    ((u.auraEvents ?? []) as any[]).filter((a) => a.destUnitId === u.id);
  const successes = (u: any): any[] =>
    ((u.spellCastEvents ?? []) as any[]).filter((c) => ev(c) === SUCCESS);
  /** the unit's own cast of aura `aid` (named `name`) */
  const isOwnCast = (c: any, aid: string, name: string) =>
    c.spellId === aid ||
    castsOfEffectAura(aid).includes(c.spellId) ||
    (name !== "" && nameOf(c.spellId, c.spellName) === name);
  const violate = (check: Check, kind: string, atMs: number, detail: string) =>
    violations.push({
      check,
      kind,
      where,
      archive,
      round: f.round,
      atMs,
      offMs: atMs - start,
      detail,
    });
  const linesAt = (sec: number) => {
    const p = `${fmtS(sec)}  `;
    return lines.filter((l) => l.startsWith(p));
  };
  /** a clean run's [applied, removed] around an aura row: the APPLIED of the
   * same id / source / dest it belongs to and its REMOVED, with no REFRESH
   * or re-APPLIED between (undefined when not clean) */
  const runOf = (
    rows: any[],
    idx: number,
  ): { from: number; to: number } | undefined => {
    const a = rows[idx];
    const same = (b: any) =>
      b.spellId === a.spellId && b.srcUnitId === a.srcUnitId;
    if (ev(a) === REMOVED) {
      for (let j = idx - 1; j >= 0; j--) {
        const b = rows[j];
        if (!same(b)) continue;
        if (ev(b) === REFRESH || ev(b) === REMOVED) return undefined;
        if (ev(b) === APPLIED) return { from: tsOf(b), to: tsOf(a) };
      }
      return undefined;
    }
    if (ev(a) !== APPLIED) return undefined;
    for (let j = idx + 1; j < rows.length; j++) {
      const b = rows[j];
      if (!same(b)) continue;
      if (ev(b) === REFRESH || ev(b) === APPLIED) return undefined;
      if (ev(b) === REMOVED) return { from: tsOf(a), to: tsOf(b) };
    }
    return undefined;
  };

  // ── round-level measurements ──
  if (!measuredRounds.has(roundKey)) {
    measuredRounds.add(roundKey);
    for (const u of units) {
      for (const d of (u.damageIn ?? []) as any[])
        if (d.spellId) damagingIds.add(d.spellId);
      for (const a of (u.absorbsIn ?? []) as any[])
        if (a.attackSpellId) damagingIds.add(a.attackSpellId);
      // clean runs per aura id
      const rows = auraIn(u);
      for (let i = 0; i < rows.length; i++) {
        if (ev(rows[i]) !== APPLIED) continue;
        const r = runOf(rows, i);
        if (!r || !inRound(r.from) || !inRound(r.to)) continue;
        const l = runsById.get(rows[i].spellId) ?? [];
        l.push((r.to - r.from) / 1000);
        runsById.set(rows[i].spellId, l);
        // a pressed self-aura's length
        const a = rows[i];
        if (a.srcUnitId === u.id) {
          const name = nameOf(a.spellId, a.spellName);
          const pressed = successes(u).some(
            (c) =>
              isOwnCast(c, a.spellId, name) &&
              tsOf(c) >= r.from - 1000 &&
              tsOf(c) <= r.from + 500,
          );
          if (pressed) {
            const pl = pressedRunsById.get(a.spellId) ?? [];
            pl.push((r.to - r.from) / 1000);
            pressedRunsById.set(a.spellId, pl);
          }
        }
      }
    }
    // per aura id: a player's fresh self-APPLIED (not already up, not a
    // server re-apply) and how many of them carry no own cast row within
    // [−1 s, +0.5 s] — an aura that is castless much of the time is a
    // talent / proc mechanic, not a press the log hid
    for (const u of players) {
      const rows = auraIn(u).filter((a) => a.srcUnitId === u.id);
      const casts = successes(u);
      const upNow = new Map<string, boolean>();
      const lastRemoved = new Map<string, number>();
      for (const a of rows) {
        const id = a.spellId as string;
        if (ev(a) === REMOVED) {
          upNow.set(id, false);
          lastRemoved.set(id, tsOf(a));
          continue;
        }
        if (ev(a) !== APPLIED) continue;
        const wasUp = upNow.get(id) === true;
        upNow.set(id, true);
        const ta = tsOf(a);
        if (wasUp || !inRound(ta) || ta - (lastRemoved.get(id) ?? -1e15) <= 50)
          continue;
        const name = nameOf(id, a.spellName);
        const t = castlessById.get(id) ?? { n: 0, castless: 0 };
        t.n++;
        if (
          !casts.some(
            (c) =>
              isOwnCast(c, id, name) &&
              tsOf(c) >= ta - 1000 &&
              tsOf(c) <= ta + 500,
          )
        )
          t.castless++;
        castlessById.set(id, t);
      }
    }
    // self-aura → own cast gaps
    for (const u of players) {
      const casts = successes(u);
      for (const a of auraIn(u)) {
        if (ev(a) !== APPLIED || a.srcUnitId !== u.id) continue;
        const ta = tsOf(a);
        if (!inRound(ta)) continue;
        const own = casts.filter((c) => isOwnCast(c, a.spellId, ""));
        if (own.some((c) => tsOf(c) < ta && tsOf(c) >= ta - 1000)) continue;
        const after = own.find((c) => tsOf(c) >= ta && tsOf(c) <= ta + 300);
        if (!after) continue;
        const l = gapBySpell.get(a.spellId) ?? [];
        l.push(tsOf(after) - ta);
        gapBySpell.set(a.spellId, l);
      }
    }
  }

  // ── 1. hiddenPressUnused ──
  for (let i = 0; i < lines.length; i++) {
    const um = /<unit id="(\d+)" name="([^"]+)"/.exec(lines[i]!);
    const kit = lines[i + 1];
    if (!um || !kit?.includes("<cooldowns>")) continue;
    const u = byName.get(um[2]!);
    if (!u) continue;
    const rows = auraIn(u).filter((a) => a.srcUnitId === u.id);
    const casts = successes(u);
    for (const m of kit.matchAll(
      /(?:<cooldowns>|, )([^,<[]+?) \[([^\]]*)\]((?: \[[^\]]*\])*)/g,
    )) {
      const name = m[1]!.trim();
      const unused = m[3]!.includes("[UNUSED]");
      for (let k = 0; k < rows.length; k++) {
        const a = rows[k];
        if (ev(a) !== APPLIED) continue;
        if (nameOf(a.spellId, a.spellName) !== name) continue;
        const ta = tsOf(a);
        if (!inRound(ta)) continue;
        const side =
          u.id === owner.id
            ? "owner"
            : u.reaction === owner.reaction
              ? "team"
              : "enemy";
        const press = casts.find(
          (c) =>
            isOwnCast(c, a.spellId, name) &&
            tsOf(c) >= ta - 1000 &&
            tsOf(c) <= ta + 500,
        );
        if (press) {
          // the calibration for `noLine`: does a logged press of this
          // cooldown get a line naming it at the press's (or aura's) second?
          const key = `${side}|${name}`;
          const r = pressLineRate.get(key) ?? { n: 0, lined: 0 };
          r.n++;
          if (
            [
              ...linesAt((ta - start) / 1000),
              ...linesAt((tsOf(press) - start) / 1000),
            ].some((l) => l.includes(name))
          )
            r.lined++;
          pressLineRate.set(key, r);
          continue;
        }
        // already up (a re-listing) / a server re-apply
        let up = false;
        let reapply = false;
        for (let j = 0; j < k; j++) {
          const b = rows[j];
          if (b.spellId !== a.spellId) continue;
          if (ev(b) === APPLIED) up = true;
          else if (ev(b) === REMOVED) {
            up = false;
            if (ta - tsOf(b) <= 50) reapply = true;
          }
        }
        if (up || reapply) continue;
        // the copy's length (judged at the end against the pressed runs: a
        // talent / proc copy runs its own shorter one)
        const rm = rows.find(
          (b, j) => j > k && b.spellId === a.spellId && ev(b) === REMOVED,
        );
        const sec = (ta - start) / 1000;
        const pid = pidOf.get(u.name) ?? "?";
        // what else the unit did at that instant (a proc's trigger)
        const beside = [
          ...casts
            .filter((c) => Math.abs(tsOf(c) - ta) <= 100)
            .map((c) => `cast ${nameOf(c.spellId, c.spellName)}`),
          ...rows
            .filter(
              (b) =>
                b !== a &&
                b.spellId !== a.spellId &&
                ev(b) === APPLIED &&
                Math.abs(tsOf(b) - ta) <= 5,
            )
            .map((b) => `aura ${nameOf(b.spellId, b.spellName)}`),
        ];
        // a re-listing (the unit came back into view: ≥ 4 of its other own
        // auras listed in the same ms) keeps a press hidden before it; else
        // an own press of another spell 0–100 ms before, or an own DEBUFF in
        // the same ms (a talent's internal-cooldown marker: Well-Honed
        // Instincts 382912 beside Frenzied Regeneration), is the trigger
        // of a talent / proc copy (Swiftmend → Incarnation: Tree of Life)
        const sameMs = rows.filter(
          (b) =>
            b !== a &&
            b.spellId !== a.spellId &&
            ev(b) === APPLIED &&
            Math.abs(tsOf(b) - ta) <= 5,
        );
        // fix-F16 (2026-10-21): Herald of the Sun's proc Avenging Wrath comes
        // with its own bundle in the same ms — Blessing of An'she 445206,
        // Hammer of Wrath 1241410, Born in Sunlight — four auras that are the
        // proc, not a re-listing (`AURA_ONLY_ACTIVATION_IDS` note in
        // cooldowns.ts; 155-5 1:07, 149-6 3:19: 6 s runs, 17 rows)
        const heraldProc =
          (a.spellId === "31884" || a.spellId === "454351") &&
          sameMs.some((b) => HERALD_PROC_BUNDLE_IDS.has(b.spellId));
        if (heraldProc) {
          bump("hiddenPressUnused:heraldProcSkipped");
          continue;
        }
        const relisting = sameMs.length >= 4;
        const trigger =
          casts.find(
            (c) =>
              !isOwnCast(c, a.spellId, name) &&
              tsOf(c) <= ta + 5 &&
              tsOf(c) >= ta - 100,
          ) ?? sameMs.find((b) => b.auraType === "DEBUFF");
        if (trigger && !relisting) {
          bump("hiddenPressUnused:procCopySkipped");
          continue;
        }
        hiddenCands.push({
          where,
          archive,
          round: f.round,
          startMs: start,
          ta,
          auraId: a.spellId,
          name,
          runS: rm ? (tsOf(rm) - ta) / 1000 : null,
          endsWithRound: !rm || tsOf(rm) >= end - 50,
          side,
          unused,
          hasLine: linesAt(sec).some((l) => l.includes(name)),
          relisting,
          what: `${fmtS(sec)} ${pid}(${u.name}) ${name} ${a.spellId} aura-only, ran ${rm ? ((tsOf(rm) - ta) / 1000).toFixed(1) : "to end"}s${beside.length ? ` [beside: ${[...new Set(beside)].join(", ")}]` : ""}`,
        });
      }
    }
  }

  // ── 2a. [no press logged] with a press row right after the aura ──
  for (const l of lines) {
    const dm =
      /^(\d+:\d\d) {2}\[ENEMY (DEF|CD)\] {3}(\d+)\([^)]*\) \([^)]*\): (.+?)(?: → (\d+)\(| \()/.exec(
        l,
      );
    if (!dm) continue;
    const tag = dm[2] === "DEF" ? "[no press logged]" : "(no press)";
    if (!l.includes(tag)) continue;
    const u = unitOfPid(dm[3]);
    if (!u) continue;
    const name = dm[4]!.trim();
    const dest = dm[5] ? unitOfPid(dm[5]) : u;
    if (!dest) continue;
    const sec = secOf(dm[1]!);
    const from = start + sec * 1000;
    const auras = auraIn(dest).filter(
      (a) =>
        ev(a) === APPLIED &&
        a.srcUnitId === u.id &&
        nameOf(a.spellId, a.spellName) === name &&
        tsOf(a) >= from &&
        tsOf(a) < from + 1000,
    );
    if (auras.length === 0) continue;
    bump("auraCastGap");
    bump("auraCastGap:noPress lines");
    const casts = successes(u);
    for (const a of auras) {
      const ta = tsOf(a);
      const after = casts.find(
        (c) =>
          isOwnCast(c, a.spellId, name) && tsOf(c) > ta && tsOf(c) <= ta + 300,
      );
      if (after) {
        violate(
          "auraCastGap",
          "noPress",
          ta,
          `${dm[1]} ${dm[3]}(${u.name}) ${name}: ${tag} while its cast row ${after.spellId} is logged ${tsOf(after) - ta} ms after the aura`,
        );
        break;
      }
    }
  }

  // ── 2b. a trinket that ended a control in the same ms ──
  for (const u of players) {
    const rows = auraIn(u);
    const pid = pidOf.get(u.name);
    if (!pid) continue;
    for (const a of rows) {
      if (ev(a) !== APPLIED || a.srcUnitId !== u.id) continue;
      const label = TRINKET_AURAS.get(a.spellId);
      if (!label) continue;
      const ta = tsOf(a);
      if (!inRound(ta)) continue;
      const ended = rows.filter(
        (b) =>
          ev(b) === REMOVED &&
          tsOf(b) === ta &&
          b.auraType === "DEBUFF" &&
          // a hard control: the trinket line's `out of` never names a root
          // (corpus: 0 of 11,713 lines name Frost Nova / Entangling Roots /
          // Earthgrab / Mass Entanglement) — by design, not a miss
          ccSpellIds.has(b.spellId) &&
          !ROOT_SPELL_IDS.has(b.spellId),
      );
      if (ended.length === 0) continue;
      const sec = (ta - start) / 1000;
      const ccNames = [
        ...new Set(ended.map((b) => nameOf(b.spellId, b.spellName))),
      ];
      const enemy = u.reaction !== owner.reaction;
      /** the control's own `[CC ON …]` line: the one for the landing (the
       * APPLIED this REMOVED closes) at its second ± 1 — not a later
       * re-application of the same control (154-1-863 5:03 / 5:04) */
      const ccLineOf = (b: any): string | undefined => {
        const k = rows.indexOf(b);
        let landed: number | undefined;
        for (let j = k - 1; j >= 0; j--)
          if (
            rows[j].spellId === b.spellId &&
            rows[j].srcUnitId === b.srcUnitId &&
            ev(rows[j]) === APPLIED
          ) {
            landed = tsOf(rows[j]);
            break;
          }
        if (landed === undefined) return undefined;
        const ls = Math.floor((landed - start) / 1000);
        const nm = nameOf(b.spellId, b.spellName);
        return lines
          .map((l) => ({
            l,
            m: /^(\d+:\d\d) {2}\[CC ON (?:TEAM|ENEMY)\] {3}(\d+)\(/.exec(l),
          }))
          .filter(
            ({ l, m }) =>
              !!m &&
              m[2] === pid &&
              l.includes(`← ${nm} (`) &&
              Math.abs(secOf(m[1]!) - ls) <= 1,
          )
          .sort(
            (x, y) =>
              Math.abs(secOf(x.m![1]!) - ls) - Math.abs(secOf(y.m![1]!) - ls),
          )[0]?.l;
      };
      // the log names another breaker (SPELL_AURA_BROKEN_SPELL a few ms
      // before — 173-1-1057 0:14: Howl of Terror broken by the mage's own
      // reflected Pyroblast 3 ms ahead of the trinket) and the control's
      // line says so: that is a reading of the log, not a miss
      const otherBreaker = (b: any) => /\| broken by /.test(ccLineOf(b) ?? "");
      if (ended.every(otherBreaker)) {
        bump("auraCastGap:trinket skipped (log names another breaker)");
        continue;
      }
      // Excluded shapes (fix-F16, 2026-10-21 — the batch-1 residue, read by
      // hand): (1) the round was over — the control's line says it outlived
      // or was cut by the round's end (a press after the deciding death,
      // 84-4 2:12 / 1-5 2:20); (2) the control ran its full length — its
      // removal is at or past landing + official length × the line's DR
      // share (−100 ms): it expired in the trinket's ms and no press broke
      // it (93-1 0:42: a 6 s Full-DR Polymorph removed at 6.0 s)
      const DR_SHARE: Record<string, number> = {
        Full: 1,
        "50%": 0.5,
        "25%": 0.25,
      };
      const ranFull = (b: any): boolean => {
        const line = ccLineOf(b) ?? "";
        const full = ccFullDurationSeconds(b.spellId);
        const share =
          DR_SHARE[/\[DR: [^\]]* (Full|50%|25%)\]/.exec(line)?.[1] ?? "Full"];
        const k = rows.indexOf(b);
        let landed: number | undefined;
        for (let j = k - 1; j >= 0; j--)
          if (
            rows[j].spellId === b.spellId &&
            rows[j].srcUnitId === b.srcUnitId &&
            ev(rows[j]) === APPLIED
          ) {
            landed = tsOf(rows[j]);
            break;
          }
        return (
          full !== undefined &&
          landed !== undefined &&
          share !== undefined &&
          tsOf(b) - landed >= full * share * 1000 - 100
        );
      };
      const roundOver = (b: any) =>
        (ccLineOf(b) ?? "").includes("when the round ended");
      if (ended.every((b) => otherBreaker(b) || roundOver(b) || ranFull(b))) {
        bump(
          "auraCastGap:trinket skipped (round over / control ran its length)",
        );
        continue;
      }
      if (enemy) {
        // the line sits at the press's second: the aura's, or the next
        // when the cast row crosses it
        const tl = [sec, sec + 1]
          .flatMap((s) => linesAt(s))
          .find(
            (l) =>
              l.includes(`[ENEMY TRINKET]   ${pid}(`) &&
              l.includes(`used ${label}`),
          );
        if (!tl) continue;
        bump("auraCastGap");
        bump("auraCastGap:trinket enemy lines");
        if (!tl.includes(" out of "))
          violate(
            "auraCastGap",
            "trinketOutOf",
            ta,
            `${fmtS(sec)} ${pid}(${u.name}) ${label} aura in the same ms as ${ccNames.join("/")} REMOVED; line has no "out of": ${tl.slice(0, 120)}`,
          );
      } else {
        // the owner's side: the control's own [CC ON TEAM] line
        for (const b of ended) {
          if (otherBreaker(b) || roundOver(b) || ranFull(b)) continue;
          const cc = nameOf(b.spellId, b.spellName);
          const last = ccLineOf(b);
          // a control the line says outlived the round (the trinket came
          // after the round's first death) is not judged
          if (!last || last.includes("when the round ended")) continue;
          bump("auraCastGap");
          bump("auraCastGap:trinket team CC lines");
          if (!/broke this CC|ended by their /.test(last))
            violate(
              "auraCastGap",
              "trinketOutOf",
              ta,
              `${fmtS(sec)} ${pid}(${u.name}) ${label} aura in the same ms as ${cc} REMOVED; its [CC ON TEAM] line does not say the trinket ended it: ${last.slice(0, 140)}`,
            );
        }
      }
    }
  }

  // ── 3. early-end claims (judged after the corpus-wide measurement) ──
  for (const l of lines) {
    const tm = /^(\d+:\d\d) {2}/.exec(l);
    if (!tm) continue;
    const sec = secOf(tm[1]!);
    const from = start + sec * 1000;
    let dest: any;
    let src: any;
    let name = "";
    let removedInSecond = false;
    const bf = /^\d+:\d\d {2}\[BUFF FADED\] {3}(.+?) \(ended early/.exec(l);
    const ed =
      /^\d+:\d\d {2}\[ENEMY DEF\] {3}(\d+)\([^)]*\) \([^)]*\): (.+?)(?: → (\d+)\([^)]*\))? \([^)]*— removed early\)/.exec(
        l,
      );
    const cc =
      /^\d+:\d\d {2}\[CC ON (?:ENEMY|TEAM)\] {3}(\d+)\([^)]*\) ← (.+?) \(by (\d+)\([^)]*\)('s \w+)?\).*\| ended early/.exec(
        l,
      );
    if (bf) {
      dest = owner;
      name = bf[1]!;
      removedInSecond = true;
    } else if (ed) {
      src = unitOfPid(ed[1]);
      dest = ed[3] ? unitOfPid(ed[3]) : src;
      name = ed[2]!.trim();
    } else if (cc) {
      dest = unitOfPid(cc[1]);
      src = cc[4] ? undefined : unitOfPid(cc[3]);
      name = cc[2]!;
    } else continue;
    if (!dest) continue;
    let rows = auraIn(dest);
    const named = (a: any) =>
      nameOf(a.spellId, a.spellName) === name &&
      (!src || a.srcUnitId === src.id);
    let idx = -1;
    if (removedInSecond) {
      // the owner's buff: on itself, else one it put on another unit (its
      // Intervene on a teammate fades as the owner's [BUFF FADED])
      if (
        !rows.some(
          (a) =>
            ev(a) === REMOVED &&
            named(a) &&
            tsOf(a) >= from &&
            tsOf(a) < from + 1000,
        )
      ) {
        const other = units.find(
          (x) =>
            x.id !== owner.id &&
            auraIn(x).some(
              (a) =>
                ev(a) === REMOVED &&
                a.srcUnitId === owner.id &&
                nameOf(a.spellId, a.spellName) === name &&
                tsOf(a) >= from &&
                tsOf(a) < from + 1000,
            ),
        );
        if (other) {
          dest = other;
          src = owner;
          rows = auraIn(other);
        }
      }
      idx = rows.findIndex(
        (a) =>
          ev(a) === REMOVED &&
          named(a) &&
          tsOf(a) >= from &&
          tsOf(a) < from + 1000,
      );
    } else {
      // the line sits at the press (or landing) second: the APPLIED there,
      // else the nearest within a second either side
      const cands = rows
        .map((a, k) => ({ a, k }))
        .filter(
          ({ a }) =>
            ev(a) === APPLIED &&
            named(a) &&
            tsOf(a) >= from - 1000 &&
            tsOf(a) < from + 2000,
        )
        .sort(
          (x, y) =>
            Math.abs(tsOf(x.a) - from - 500) - Math.abs(tsOf(y.a) - from - 500),
        );
      idx = cands[0]?.k ?? -1;
    }
    if (idx < 0) continue;
    const r = runOf(rows, idx);
    if (!r) continue;
    bump("fullRunEndedEarly");
    earlyClaims.push({
      where,
      archive,
      round: f.round,
      startMs: start,
      atMs: r.to,
      auraId: rows[idx].spellId,
      runS: (r.to - r.from) / 1000,
      // the caster's own full length — its talents included (codex 21-R12-a
      // #5: a talented Rallying Cry cancelled at 12 s did end early)
      talentedS: (() => {
        const caster = byId.get(rows[idx].srcUnitId);
        return caster
          ? buffFullDurationForCaster(rows[idx].spellId, caster, r.from)
          : undefined;
      })(),
      line: l.slice(0, 160),
    });
  }

  // ── 4. reflect returns (resolved after the corpus-wide damaging set) ──
  const reflectLines: Array<{
    sec: number;
    cp: string;
    rp: string;
    spell: string;
    back: number | null;
    text: string;
    used: boolean;
  }> = [];
  for (const l of lines) {
    const rm =
      /^(\d+:\d\d) {2}\[REFLECTED\] {3}(\d+)\([^)]*\)'s (.+?) reflected by (\d+)\([^)]*\)(?: \(came back for (\d+)k\))?/.exec(
        l,
      );
    if (rm)
      reflectLines.push({
        sec: secOf(rm[1]!),
        cp: rm[2]!,
        rp: rm[4]!,
        spell: rm[3]!,
        back: rm[5] !== undefined ? Number(rm[5]) : null,
        text: l.slice(0, 160),
        used: false,
      });
  }
  for (const caster of units) {
    const cp = pidOf.get(caster.name);
    if (!cp) continue;
    const reflects = ((caster.missesOut ?? []) as any[])
      .filter((m) => m.missType === "REFLECT" && m.spellId)
      .sort((x, y) => tsOf(x) - tsOf(y));
    const groups: Array<{
      first: any;
      last: number;
      rows: number[];
      g?: IReflectGroup;
    }> = [];
    for (const m of reflects) {
      const g = [...groups]
        .reverse()
        .find(
          (x) =>
            nameOf(x.first.spellId, x.first.spellName) ===
              nameOf(m.spellId, m.spellName) &&
            x.first.destUnitId === m.destUnitId,
        );
      if (g && tsOf(m) - g.last <= REFLECT_CHAIN_GAP_MS) {
        g.last = tsOf(m);
        g.rows.push(tsOf(m));
      } else groups.push({ first: m, last: tsOf(m), rows: [tsOf(m)] });
    }
    const myGroups: IReflectGroup[] = [];
    for (const g of groups) {
      const t0 = tsOf(g.first);
      if (!inRound(t0)) continue;
      const reflector = byId.get(g.first.destUnitId);
      const rp = reflector && pidOf.get(reflector.name);
      if (!reflector || !rp) continue;
      const S = g.first.spellId as string;
      // by English name: one spell logs its cast and its hit under two ids
      // (Death Coil 47541 / 47632, Pyroblast 11366 / 460475, Cull 1245453 /
      // 1245455) — the product's line names the spell, not the id
      const sName = nameOf(S, g.first.spellName);
      // a dispel backlash of the same name is no return (Unstable
      // Affliction's 196364 — codex 20-F16-14 #3: the product's own rule,
      // `BACKLASH_AURA_CC_TYPE`, which the scan's name match did not read)
      const isS = (id: string | undefined, fallback?: string) =>
        !!id &&
        (id === S ||
          (!BACKLASH_AURA_CC_TYPE.has(id) &&
            nameOf(id, fallback ?? "") === sName));
      const srcs = new Set([reflector.id as string, ...petsOf(reflector.id)]);
      // S auras on C: [applied, removed, source]. A reflected DoT is logged
      // as the CASTER's own aura on itself (c5b55e06 r2 0:17: Flame Shock
      // 188389 APPLIED Jarona → Jarona 5 ms after the REFLECT row, its ticks
      // Jarona → Jarona); R's own earlier DoT of S is R's
      const sAuras: Array<[number, number, string]> = [];
      const cRows = auraIn(caster);
      for (let k = 0; k < cRows.length; k++) {
        const a = cRows[k];
        if (!isS(a.spellId, a.spellName) || ev(a) !== APPLIED) continue;
        if (!srcs.has(a.srcUnitId) && a.srcUnitId !== caster.id) continue;
        const rmv = cRows.find(
          (b, j) =>
            j > k &&
            b.spellId === a.spellId &&
            b.srcUnitId === a.srcUnitId &&
            ev(b) === REMOVED,
        );
        // a REMOVED + APPLIED in the same ms is one aura re-applied (a
        // refresh of the reflected Vampiric Touch on its caster keeps
        // ticking — 26-4-156 0:20): join it to the run it continues
        const prev = sAuras.find(
          ([, to, src]) => to === tsOf(a) && src === a.srcUnitId,
        );
        if (prev) prev[1] = rmv ? tsOf(rmv) : Infinity;
        else sAuras.push([tsOf(a), rmv ? tsOf(rmv) : Infinity, a.srcUnitId]);
      }
      const ownDot = (ts: number) =>
        sAuras.some(
          ([a, b, src]) =>
            src !== caster.id &&
            a < t0 - REFLECT_OWN_ID_LEAD_MS &&
            ts >= a &&
            ts <= b,
        );
      const reflectedDot = (ts: number) =>
        sAuras.some(
          ([a, b]) =>
            a >= t0 - REFLECT_OWN_ID_LEAD_MS &&
            a <= g.last + REFLECT_DIRECT_RETURN_MS &&
            ts >= a &&
            ts <= b,
        );
      /** a row of S on C from `src` at `ts` that is the reflect's return */
      const counts = (src: string, ts: number, periodic: boolean | null) => {
        if (ts < t0 - REFLECT_OWN_ID_LEAD_MS || ts > g.last + 20_000)
          return false;
        if (srcs.has(src) && ownDot(ts)) return false;
        const inDot = reflectedDot(ts);
        // the caster's own row of S on itself: a reflected DoT's ticks, or
        // the reflected hit itself logged caster → caster (111-1-621 8:15:
        // a Frostbolt row Pholipholi → Pholipholi 28 ms after the REFLECT)
        // within [−0.5 s, +3 s]
        // (a channel's ticks carry no aura on the caster: Disintegrate
        // 356995 C → C periodic rows 175-1-946 0:15 — inside the 3 s too)
        if (src === caster.id)
          return inDot || ts <= g.last + REFLECT_DIRECT_RETURN_MS;
        if (!srcs.has(src)) return false;
        if (periodic === true) return inDot;
        // a direct hit (an absorb row carries no periodic flag: either)
        return (
          ts <= g.last + REFLECT_DIRECT_RETURN_MS ||
          (periodic === null && inDot)
        );
      };
      let direct = 0;
      for (const d of (caster.damageIn ?? []) as any[])
        if (
          isS(d.spellId, d.spellName) &&
          counts(d.srcUnitId, tsOf(d), ev(d) === PERIODIC)
        )
          direct += Math.abs(d.effectiveAmount);
      for (const a of (caster.absorbsIn ?? []) as any[])
        if (
          isS(a.attackSpellId, a.attackSpellName) &&
          !DEFERRAL_SHIELDS.has(String(a.spellId)) &&
          counts(a.attackerId, tsOf(a), null)
        )
          direct += Math.abs(a.absorbedAmount);
      const acts = ((caster.advancedActions ?? []) as any[]).filter(
        (x) => x.advancedActorId === caster.id && x.advancedActorMaxHp > 0,
      );
      const near = acts.reduce(
        (best: any, x: any) =>
          !best || Math.abs(tsOf(x) - t0) < Math.abs(tsOf(best) - t0)
            ? x
            : best,
        undefined,
      );
      const rg: IReflectGroup = {
        where,
        archive,
        round: f.round,
        startMs: start,
        t0,
        casterPid: cp,
        reflectorPid: rp,
        casterName: caster.name,
        reflectorName: reflector.name,
        spellId: S,
        spellName: sName,
        direct,
        maxHp: near?.advancedActorMaxHp ?? 0,
        own: 0,
      };
      g.g = rg;
      myGroups.push(rg);
      const sec = Math.floor((t0 - start) / 1000);
      const line = reflectLines.find(
        (x) =>
          !x.used &&
          x.cp === cp &&
          x.rp === rp &&
          x.spell === rg.spellName &&
          Math.abs(x.sec - sec) <= 1,
      );
      if (line) {
        line.used = true;
        rg.line = { text: line.text, back: line.back };
      }
      reflectGroups.push(rg);
    }
    // the reflector's own-id rows on C → candidate reflects (nearest damaging
    // one decided at the end)
    // by the gap to the group's nearest REFLECT row (the product's
    // `creditOwnId`: 50-1 2:17, two Wicked Reapings around a Demonbolt)
    const rowGap = (g: (typeof groups)[number], ts: number) =>
      Math.min(
        ...g.rows
          .filter((r) => ts >= r - REFLECT_OWN_ID_LEAD_MS)
          .map((r) => Math.abs(ts - r)),
      );
    const ownCands = (src: string, ts: number) =>
      groups
        .filter(
          (g) =>
            g.g &&
            g.first.destUnitId === src &&
            ts >= tsOf(g.first) - REFLECT_OWN_ID_LEAD_MS &&
            ts <= g.last + REFLECT_DIRECT_RETURN_MS,
        )
        .sort((x, y) => rowGap(x, ts) - rowGap(y, ts))
        .map((g) => g.g!);
    for (const d of (caster.damageIn ?? []) as any[]) {
      if (!REFLECT_OWN_IDS.has(d.spellId)) continue;
      const gs = ownCands(d.srcUnitId, tsOf(d));
      if (gs.length > 0)
        ownRows.push({
          ts: tsOf(d),
          amt: Math.abs(d.effectiveAmount),
          groups: gs,
        });
    }
    for (const a of (caster.absorbsIn ?? []) as any[]) {
      if (!REFLECT_OWN_IDS.has(a.attackSpellId)) continue;
      const gs = ownCands(a.attackerId, tsOf(a));
      if (gs.length > 0)
        ownRows.push({
          ts: tsOf(a),
          amt: Math.abs(a.absorbedAmount),
          groups: gs,
        });
    }
    void myGroups;
  }
  // a [REFLECTED] line no reflect row explains
  for (const x of reflectLines)
    if (!x.used) {
      bump("reflectReturn:lineUnmatched");
    }
}

// ── corpus-wide resolution ──
// 3. the runs that end at one value V ≠ official
interface IVRow {
  id: string;
  name: string;
  n: number;
  v: number;
  share: number;
  official: number;
}
const vList: IVRow[] = [];
for (const [id, runs] of runsById) {
  if (runs.length < 20) continue;
  const off = officialS(id);
  if (off === undefined) continue;
  const s = [...runs].sort((a, b) => a - b);
  let best = 0;
  let bi = 0;
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    while (s[j]! < s[i]! - 0.2) j++;
    if (i - j + 1 > best) {
      best = i - j + 1;
      bi = j;
    }
  }
  const win = s.slice(bi, bi + best);
  const v = win[Math.floor(win.length / 2)]!;
  const inV = s.filter((x) => Math.abs(x - v) <= 0.1).length;
  if (inV / s.length < 0.8 || Math.abs(v - off) <= 0.5) continue;
  vList.push({
    id,
    name: nameOf(id),
    n: s.length,
    v,
    share: inV / s.length,
    official: off,
  });
}
vList.sort((a, b) => b.n - a.n);
const vOf = new Map(vList.map((r) => [r.id, r.v]));
for (const c of earlyClaims) {
  const v = vOf.get(c.auraId);
  const off = officialS(c.auraId);
  const base = {
    where: c.where,
    archive: c.archive,
    round: c.round,
    atMs: c.atMs,
    offMs: c.atMs - c.startMs,
  };
  if (v !== undefined && c.runS >= v - 0.1)
    violations.push({
      check: "fullRunEndedEarly",
      kind: "atV",
      ...base,
      detail: `${nameOf(c.auraId)} ${c.auraId} ran ${c.runS.toFixed(2)}s (corpus V ${v.toFixed(2)}s, official ${off}s): ${c.line}`,
    });
  // an id whose runs settle ABOVE the official duration (a talent extends
  // it: Avenging Wrath 12 s vs 8 s) is judged at V only — a run past the
  // official length but short of V did end early
  // …and against the caster's own talented length when it differs from
  // the official one (codex 21-R12-a #5): Rallying Cry 10 s official, a
  // talented 15.6 s cancelled at 12 s ended early
  else if (
    off !== undefined &&
    !(v !== undefined && v > off) &&
    c.runS >= Math.max(off, c.talentedS ?? off) - 0.1
  )
    violations.push({
      check: "fullRunEndedEarly",
      kind: "fullOfficial",
      ...base,
      detail: `${nameOf(c.auraId)} ${c.auraId} ran ${c.runS.toFixed(2)}s ≥ official ${off}s: ${c.line}`,
    });
}
// 1. hidden presses: a copy shorter than 60 % of the pressed length (the
// corpus median of the aura's pressed clean runs, ≥ 5 of them; else the
// official duration) is a talent / proc copy, not a press
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
for (const c of hiddenCands) {
  const pr = pressedRunsById.get(c.auraId) ?? [];
  const ref = pr.length >= 5 ? median(pr) : officialS(c.auraId);
  if (!c.endsWithRound && ref !== undefined && (c.runS ?? 0) < 0.6 * ref)
    continue;
  // an aura that goes up castless in > 15 % of its fresh applications
  // corpus-wide is a mechanic (Summon Infernal, Malevolence, a talent's
  // Recklessness): its castless copy proves no press
  const cl = castlessById.get(c.auraId);
  if (cl && cl.n >= 10 && cl.castless > 0.15 * cl.n) {
    bump("hiddenPressUnused:castlessAuraSkipped");
    continue;
  }
  bump("hiddenPressUnused");
  const base = {
    check: "hiddenPressUnused" as const,
    where: c.where,
    archive: c.archive,
    round: c.round,
    atMs: c.ta,
    offMs: c.ta - c.startMs,
  };
  const clS = cl ? ` castless ${cl.castless}/${cl.n}` : "";
  const refS =
    ref === undefined
      ? "?"
      : `${ref.toFixed(1)}s${pr.length >= 5 ? " pressed median" : " official"}${clS}`;
  if (c.unused)
    violations.push({
      ...base,
      kind: `kit:${c.side}`,
      detail: `${c.what} (ref ${refS}): kit tags it [UNUSED]`,
    });
  // `noLine` only where the product prints this cooldown for this side
  // when its press IS logged (≥ 10 such presses, ≥ 80 % with a line)
  const rate = pressLineRate.get(`${c.side}|${c.name}`);
  // — and only for a press hidden by the unit being out of view (its auras
  // re-listed in that ms): an aura-only copy that is not a re-listing is
  // too often a delayed own buff or a talent's copy whose trigger is more
  // than 100 ms away (Kingsbane 394095 1.4 s after its cast row 385627;
  // Avatar 264 ms after Thunder Blast) for a missing line to prove a miss
  if (
    c.relisting &&
    !c.hasLine &&
    rate &&
    rate.n >= 10 &&
    rate.lined >= 0.8 * rate.n
  )
    violations.push({
      ...base,
      kind: `noLine:${c.side}`,
      detail: `${c.what} (ref ${refS}): no line at its second names it (logged presses of it lined ${rate.lined}/${rate.n})`,
    });
}
// 4. own-id rows → the nearest damaging reflect
const damagingNames = new Set([...damagingIds].map((id) => nameOf(id)));
const isDamaging = (g: IReflectGroup) =>
  damagingIds.has(g.spellId) || damagingNames.has(g.spellName);
for (const r of ownRows) {
  const g = r.groups.find(isDamaging);
  if (g) g.own += r.amt;
}
for (const g of reflectGroups) {
  const damaging = isDamaging(g);
  const total = damaging ? g.direct + g.own : 0;
  const base = {
    where: g.where,
    archive: g.archive,
    round: g.round,
    atMs: g.t0,
    offMs: g.t0 - g.startMs,
  };
  const who = `${g.casterPid}(${g.casterName})'s ${g.spellName} ${g.spellId} by ${g.reflectorPid}(${g.reflectorName})`;
  if (g.line && g.line.back !== null) {
    bump("reflectReturn");
    if (!damaging)
      violations.push({
        check: "reflectReturn",
        kind: "nonDamaging",
        ...base,
        detail: `${who}: the corpus logs no damage under it; line says ${g.line.back}k`,
      });
    else if (Math.abs(g.line.back * 1000 - total) > Math.max(2000, 0.1 * total))
      violations.push({
        check: "reflectReturn",
        kind: "amount",
        ...base,
        detail: `${who}: printed ${g.line.back}k, recomputed ${(total / 1000).toFixed(1)}k (direct ${(g.direct / 1000).toFixed(1)}k + own-id ${(g.own / 1000).toFixed(1)}k)`,
      });
  } else if (damaging && g.maxHp > 0 && total >= 0.05 * g.maxHp) {
    bump("reflectReturn");
    if (!g.line)
      violations.push({
        check: "reflectReturn",
        kind: "noLine",
        ...base,
        detail: `${who}: ${(total / 1000).toFixed(1)}k back (${((total / g.maxHp) * 100).toFixed(1)}% of max HP ${g.maxHp}), no [REFLECTED] line`,
      });
  }
}

// ── report ──
const out: string[] = [];
const say = (s: string) => {
  out.push(s);
  console.log(s);
};
say(`contexts: ${contexts}  rounds measured: ${measuredRounds.size}`);
for (const c of CHECKS) {
  const vs = violations.filter((v) => v.check === c);
  const rounds = new Set(vs.map((v) => `${v.archive}#${v.round}#${v.detail}`));
  say(
    `${c}: checked ${checked.get(c) ?? 0} / violations ${vs.length} (distinct by round+fact ${rounds.size})`,
  );
  const kinds = [...new Set(vs.map((v) => v.kind))];
  for (const k of kinds) {
    const ks = vs.filter((v) => v.kind === k);
    say(`  ${k}: ${ks.length}`);
    for (const v of ks.slice(0, EXAMPLES))
      say(`    ${v.where} r${v.round} +${v.offMs}ms ${v.detail}`);
  }
}
for (const [k, n] of checked) if (k.includes(":")) say(`(${k}: ${n})`);

// 2. measurement
say("");
say(
  "auraCastGap measurement — self-applied aura → own cast row within 0–300 ms (no own cast in the 1 s before)",
);
const allGaps = [...gapBySpell.values()].flat().sort((a, b) => a - b);
const pct = (s: number[], p: number) =>
  s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
const buckets: Array<[string, number, number]> = [
  ["0", 0, 0],
  ["1–10", 1, 10],
  ["11–25", 11, 25],
  ["26–50", 26, 50],
  ["51–100", 51, 100],
  ["101–200", 101, 200],
  ["201–300", 201, 300],
];
say(
  `  pairs ${allGaps.length}; > 50 ms ${allGaps.filter((g) => g > 50).length}; p50 ${pct(allGaps, 0.5)} p99 ${pct(allGaps, 0.99)} max ${allGaps.at(-1) ?? 0} ms`,
);
for (const [label, lo, hi] of buckets)
  say(
    `  ${label.padStart(8)} ms: ${allGaps.filter((g) => g >= lo && g <= hi).length}`,
  );
say("  per spell (n ≥ 20, or any pair > 50 ms), by n:");
const spellRows = [...gapBySpell]
  .map(([id, g]) => {
    const s = [...g].sort((a, b) => a - b);
    return {
      id,
      n: s.length,
      over: s.filter((x) => x > 50).length,
      p99: pct(s, 0.99),
      max: s.at(-1) ?? 0,
    };
  })
  .filter((r) => r.n >= 20 || r.over > 0)
  .sort((a, b) => b.n - a.n);
for (const r of spellRows.slice(0, 60))
  say(
    `    ${r.id.padStart(7)} ${nameOf(r.id).padEnd(28)} n ${String(r.n).padStart(5)}  >50ms ${String(r.over).padStart(4)}  p99 ${String(r.p99).padStart(3)}  max ${r.max}`,
  );

// 3. measurement
say("");
say(
  "fullRunEndedEarly measurement — ids with ≥ 20 clean runs, ≥ 80 % within ±0.1 s of V, |V − official| > 0.5 s",
);
for (const r of vList)
  say(
    `  ${r.id.padStart(7)} ${r.name.padEnd(30)} n ${String(r.n).padStart(5)}  V ${r.v.toFixed(2)}s (${(r.share * 100).toFixed(0)}%)  official ${r.official}s`,
  );

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        capture: resolve(dir),
        contexts,
        checked: Object.fromEntries(checked),
        vList,
        gapBySpell: spellRows,
        violations,
      },
      null,
      1,
    ),
  );
  say(`wrote ${JSON_OUT}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
