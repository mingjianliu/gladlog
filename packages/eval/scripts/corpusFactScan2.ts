/* eslint-disable @typescript-eslint/no-explicit-any -- the scan walks the untyped legacy parse objects (match.units, auraEvents, missesIn) by the hundred */
/**
 * corpusFactScan2.ts — corpus-wide deterministic fact checks, batch 2
 * (round1+2, 2026-10-22; brief `runs/corpus-scan-2026-10-21/BRIEF-batch2.md`).
 * The next classes of the round-3 double audit (`runs/fact3-2026-10-21`),
 * searched over a whole acceptanceCapture `--context-dir` capture. The same
 * harness as `corpusFactScan.ts` (file loop, parse cache, unit / pid mapping,
 * `unmapped` → exit 1, `--examples N`, distinct-fact counting). Every check
 * derives its fact from the log events directly — never through the
 * analysis predicate it audits. Data tables read here are lookups only:
 * English names, cast ↔ effect aura (`castEffectAuras`), the DR category of
 * an id (`getDRCategory` / `drCategoryOfCast`), the official control length
 * (`ccFullDurationSeconds`), DB2 mechanic immunities
 * (`spellMechanicsGenerated.json`), and the id sets of the curated
 * avoidance / immunity tables.
 *
 * DR, read from the log (checks 1c, 2, 6): the unit's control applications
 * — DEBUFF APPLIED rows from another unit whose id has a DR family
 * (`getDRCategory`, a lookup), each ending at its REMOVED (capped at the
 * official length + 1 s) — walked back from the instant as a chain: a
 * predecessor joins while it ended less than 18 s (the brief's window) before
 * the chain's earliest start, or still ran then. Every capture log is from
 * 2026-08-13 on, the 12.1 era whose reset is 20 s, so the reading can only
 * under-count. A re-broadcast (REMOVED → APPLIED of the same id / source
 * ≤ 50 ms) and a re-APPLIED of an id / source still inside its official
 * length are one application; a predecessor of the same source ≤ 300 ms
 * before is the same cast. A control whose cast has effect auras in two
 * families (Holy Word: Chastise) is read in each, the longer chain kept. Its
 * own false-positive rate is printed: the share of LANDED controls it calls a
 * 3rd application (12.x: Full → 50 % → Immune, a landed 3rd is impossible).
 *
 * Exclusions (each found as a false positive on the corpus, or a signed
 * ruling):
 *  E1 (1c) the named aura was up and can stop the control: the product names
 *     the aura first by design (`ccImmuneCauseOf`: aura → Cyclone → DR) and
 *     the log cannot tell two true causes apart — `drImmune:auraAlsoExplains`.
 *  E2 (2) a talent that lengthens a control: the base is the larger of the
 *     official length and the corpus p90 of that id's clean Full-DR runs.
 *  E3 (3) signed ruling: the 15 % Flameshaper copy of Obsidian Scales (363916
 *     from another unit) does not end defenseless (C1 floor).
 *  E4 (3) signed ruling: Alter Time's rewind (342246 / 110909) does not count.
 *  E10 (3i, 3iii) an aura must cover a whole interior second: one REMOVED a
 *     few ms into the span's first interior second is the floored bound
 *     (161-6-963: Blessing of Protection purged 10 ms into 1:47 of
 *     `defenseless 1:46–2:05`), not a save inside the span.
 *  E11 (1a) a `did not land` line sits at the control's cast second while a
 *     ground / delayed control resolves later: X up after that second but
 *     within the source's cast + 3 s is `notUp:inResolveWindow`, out of the
 *     total (161-5-960 2:58: Sigil of Misery cast 29.482, Divine Steed
 *     30.333 — before the sigil went off). Round 3 D52 has this shape and was
 *     ruled a defect; it needs a ruling per control.
 *  E12 (1a) `from <pid>'s guardian / pet`: the aura's source is a unit that
 *     pid owns (an Unholy DK's guardian's Anti-Magic Shell).
 *  E5 (5) two lines whose `→` targets differ are two facts (Obsidian Scales
 *     on its caster and its copy on an ally: 2 APPLIED).
 *  E6 (3ii) a passive / proc absorb (Danger Sense, Fel Armor, Soul Leech,
 *     Tempted Fate, …) is no "shield it applied on itself": the shield must
 *     have an own press (a SUCCESS of its id, a cast `castsOfEffectAura`
 *     lists, or one of its name) in the 60 s before the absorb row — except
 *     the two shields the ruling names (Power Word: Shield, Void Shield),
 *     which count pressed or not (a Holy Priest's proc PW:S 1246768 has no
 *     cast row). Passive ones are counted as `ownAbsorb:passive`, out of the
 *     total.
 *  E7 (1a) Grounding Totem is a summon, not an aura on its owner: "up" = the
 *     control's cast went into a Grounding Totem the target owns (± 1.5 s),
 *     or the target summoned one in the 3.5 s before.
 *  E8 (1a) an avoidance consumed by the control is REMOVED in the ms of the
 *     control's CAST, and the miss row follows up to ~0.7 s later (29-5-197
 *     1:08: Kidney Shot SUCCESS 24.460, Nullifying Shroud REMOVED 24.461,
 *     IMMUNE row 24.607): X up at the source's last cast of the control (≤ 3 s
 *     before the row) counts.
 *  E9 (1a) a repositioning the product credits by its press, with no aura
 *     on the unit (Roll, Transcendence: Transfer, Wind Rush Totem; Angel's
 *     Feather's buff is Angelic Feather 121557) — `REPOSITIONING_SPELL_IDS`
 *     as a name → cast-id lookup: a SUCCESS of it by the aura's owner in the
 *     2 s before the instant (or inside its second) counts, as does an
 *     effect aura of that cast.
 *
 *  1. `immuneCause` — a line naming an aura as the cause of an avoided
 *     control: `[CC AVOIDED?] <pid>: S (by …) logged T | did not land; X
 *     (own | from <pid>) active`, `[CC NOT LANDED] <pid> ← S (by …) — logged
 *     T (X was up | <pid>'s X was on the target)`, and the `[IMMUNE[: <pid>]
 *     — …]` / `[MISSED on <pid> — …]` / `[REFLECTED by <pid> — …]` brackets
 *     of `[YOU]` / `[TEAM]` `[CC]` / `[CD]` lines. The miss row it describes:
 *     the target's SPELL_MISSED of S (by English name, through the cast ↔
 *     effect table; else the only such row) of the line's type, from the
 *     line's source (or its pet / totem), at the line's second (± 1 s; a
 *     `[YOU]` / `[TEAM]` line sits at the cast, so up to 20 s after it).
 *     (a) `notUp`: X (by English name; source = the target for `(own)`,
 *     the named unit for `from` / `'s X`) not up on the target at the miss
 *     row — APPLIED before it in log order, no REMOVED between (a REMOVED
 *     in the same ms logged after the miss still counts as up; a REMOVED
 *     with no APPLIED before it = up from the log's start); E7–E9. A `did
 *     not land` line has no row: X must be up somewhere in [s − 1, s + 1)
 *     of the line's second s. Sub-kind `neverOnUnit` when X (aura or press)
 *     is never on the target this round.
 *     (b) `cannotCause`: a reflect-only aura (Spell Reflection 23920, Nether
 *     Ward 212295) for a non-REFLECT row; an aura with no immunity at all
 *     (DB2: no aura-77 mechanic list, no aura-147 mask, no school immunity —
 *     on every id of that name the target carried — and not in a curated
 *     avoidance / immunity table, not a Druid form, not Cyclone): the
 *     movement buffs; an aura whose only immunity is an explicit DB2
 *     mechanic list that lacks the control's mechanic. Not judged for `did
 *     not land` (an area control a movement buff walked out of is a fair
 *     "avoided?").
 *     (c) `drImmune`: an IMMUNE row whose control is at least the 3rd
 *     application of its DR family on the unit (a chain of ≥ 2 before it),
 *     yet the line names an aura — except E1.
 *  2. `ccEndUndiminished` — a control aura (DEBUFF, a DR family) whose
 *     APPLIED is never closed (no later row of that id / source on the unit,
 *     or the next is an APPLIED past the control's length: the round ended or
 *     the unit went out of view), printed on its `[CC ON TEAM|ENEMY]` line
 *     (same unit, name, source, second ± 1) with a length L (`(Ns)` / `| Ns`;
 *     a line that says it was `still on them when the round ended` prints no
 *     length and is not judged). As the 2nd / 3rd application of its family
 *     (from the log), L ≤ base × 0.5 / 0.25 + 0.5 s, where base = max(the
 *     official length, the corpus p90 of that id's clean Full-DR runs when
 *     ≥ 5) — E2.
 *  3. `defenselessSaveUp` — a `[KILL WINDOW] … defenseless a–b` / `[VULNERABLE]
 *     a–b` span. For every whole second certainly inside it (a+1 … b−1: the
 *     printed bounds are floored), from the log: (i) `immunity` — an aura of
 *     the immunity tables (`IMMUNITY_IDS`, `FULL_IMMUNITY_IDS`,
 *     `IMMUNITY_SPELLS`, Phase Shift 408558) on the target, up over that whole
 *     second (E10)
 *     (an APPLIED never closed holds only for its official length + 1 s); (ii)
 *     `ownAbsorb` — a SPELL_ABSORBED row on the target whose shield owner is
 *     the target itself in that second, of a shield it pressed (user ruling
 *     10-21 「算」: its own PW:S / Void Shield count; E6); (iii) `massInvis` —
 *     an ally's Mass Invisibility on it (still being measured by F16:
 *     counted, kept out of the total). Signed rulings E3, E4.
 *  4. `petInterrupt` — every SPELL_INTERRUPT whose source is a pet / guardian
 *     of a player (the parse's `ownerId`) on a player of the prompt. A
 *     `[KICK]` line at that second must name the interrupted spell on that
 *     victim, credited `<owner pid>(…)'s pet interrupted`. `noLine`: no kick
 *     line names that victim's spell; `notCredited`: one does, credited to
 *     someone else (the owner itself, as if it kicked). The players' own kicks
 *     are measured the same way as the control.
 *  5. `duplicateLine` — two lines of one family at the same m:ss for the same
 *     unit pid, spell name and `→` target, after dropping the `(cast m:ss)`
 *     and `(by …)` parts, while the log has one underlying event: ≤ 1 miss
 *     row of it on the unit in that second and ≤ 1 cast of it by the source
 *     in the 3 s before (`[CC AVOIDED?]`); ≤ 1 cast and ≤ 1 APPLIED of it by
 *     the unit on that target in that second (the CD families). Families:
 *     `[CC AVOIDED?]`, `[TEAM] [CD]`, `[YOU] [CD]`, and the three enemy tags
 *     `[ENEMY DEF]` / `[ENEMY UTILITY]` / `[ENEMY CD]` as ONE family (round 3
 *     D32: a Vanish on `[ENEMY DEF]` and again on `[ENEMY UTILITY]`) —
 *     reported as `sameTag` / `crossTag`. E5.
 *  6. `immunityTableForward` — measurement. Every SPELL_MISSED IMMUNE row of a
 *     control (its own id in `ccSpellIds` or a DR family — not through its
 *     cast's effect auras: Wake of Ashes 255937 is a damage spell whose
 *     separate stun aura has the family) on a player, inside the round,
 *     with no aura of the curated tables up on the target (`CC_AVOIDANCE_
 *     BUFF_SPELLS` — talent and mechanic-limited buffs included —
 *     `IMMUNITY_IDS`, `FULL_IMMUNITY_IDS`, the Druid forms, Cyclone) and not
 *     DR-immune by (1c): the auras up on the target there, by id, with the
 *     number of LANDED controls on players under each (rate = immune /
 *     (immune + landed)) — the candidates the tables lack (Curated-List
 *     Completeness Rule). Violations `noLine`: such a row with no line in
 *     the prompt naming that unit's pid and the control at its second (± 1),
 *     nor an `IMMUNE` line of it for that pid in the 20 s before (a `[YOU]` /
 *     `[TEAM]` cast line sits at the press: a trap triggers later).
 *
 *   npx tsx packages/eval/scripts/corpusFactScan2.ts <captureDir> [--examples N]
 *     [--archive-dir <dir>] [--json <violations.json>]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import {
  castsOfEffectAura,
  effectAurasOfCast,
} from "@gladlog/analysis/src/data/castEffectAuras";
import {
  ccFullDurationSeconds,
  getEnglishSpellName,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellEffectGenerated from "@gladlog/analysis/src/data/spellEffectGenerated.json";
import spellMechanicsGenerated from "@gladlog/analysis/src/data/spellMechanicsGenerated.json";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  CC_AVOIDANCE_BUFF_SPELLS,
  DRUID_FORM_BUFFS,
  REPOSITIONING_SPELL_IDS,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { IMMUNITY_SPELLS } from "@gladlog/analysis/src/utils/deathOutcomeAnalysis";
import {
  drCategoryOfCast,
  getDRCategory,
} from "@gladlog/analysis/src/utils/drAnalysis";
import {
  FULL_IMMUNITY_IDS,
  IMMUNITY_IDS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: corpusFactScan2.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>]",
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
  "immuneCause",
  "ccEndUndiminished",
  "defenselessSaveUp",
  "petInterrupt",
  "duplicateLine",
  "immunityTableForward",
] as const;
type Check = (typeof CHECKS)[number];
/** kinds counted but kept out of a check's violation total */
const OUT_OF_TOTAL = new Set([
  "immuneCause|notUp:inResolveWindow",
  "defenselessSaveUp|massInvis",
  "defenselessSaveUp|ownAbsorb:passive",
]);
/** E6: passive own absorbs inside a defenseless span, by shield name */
const passiveAbsorbNames = new Map<string, number>();
const pressedAbsorbNames = new Map<string, number>();
/** user ruling 10-21 「算」 names these two */
const RULED_OWN_SHIELDS = new Set(["Power Word: Shield", "Void Shield"]);
interface IViolation {
  check: Check;
  kind: string;
  where: string;
  archive: string;
  round: number;
  /** ms since the epoch of the fact's log row */
  atMs: number;
  /** atMs − the round's start */
  offMs: number;
  /** owner-independent identity of the fact (distinct counting) */
  fact: string;
  detail: string;
  /** the prompt line(s) judged */
  line?: string;
  /** the raw log row(s) the fact rests on */
  raw?: string[];
}
const checked = new Map<string, number>();
const violations: IViolation[] = [];
const bump = (c: string, n = 1) => checked.set(c, (checked.get(c) ?? 0) + n);

const official = spellEffectGenerated as Record<
  string,
  { durationSeconds?: number }
>;
const officialS = (id: string): number | undefined => {
  const d = official[id]?.durationSeconds;
  return typeof d === "number" && d > 0 ? d : undefined;
};
const MECH = (
  spellMechanicsGenerated as unknown as {
    spells: Record<
      string,
      | {
          immuneMech?: number[];
          immuneMechMask?: number;
          immuneAll?: boolean;
        }
      | undefined
    >;
  }
).spells;
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
const liOf = (a: any): number => a.logLine?.lineIndex ?? -1;
const APPLIED = LogEvent.SPELL_AURA_APPLIED as string;
const REMOVED = LogEvent.SPELL_AURA_REMOVED as string;
const REFRESH = LogEvent.SPELL_AURA_REFRESH as string;
const SUCCESS = LogEvent.SPELL_CAST_SUCCESS as string;
const MISSED = LogEvent.SPELL_MISSED as string;
const INTERRUPT = LogEvent.SPELL_INTERRUPT as string;
const UP_EVENTS = new Set([
  APPLIED,
  REFRESH,
  LogEvent.SPELL_AURA_APPLIED_DOSE as string,
  LogEvent.SPELL_AURA_REMOVED_DOSE as string,
]);

/** the brief's DR window */
const DR_WINDOW_MS = 18_000;
/** controls counted for DR — the DR families of `getDRCategory` (roots are
 * no family there) */
const DR_FAMILIES = new Set([
  "Stun",
  "Incapacitate",
  "Disorient",
  "Silence",
  "Horror",
  "Disarm",
]);
const drCatOf = (id: string | undefined): string | undefined => {
  if (!id) return undefined;
  const c = getDRCategory(id);
  if (DR_FAMILIES.has(c)) return c;
  const c2 = drCategoryOfCast(id);
  return DR_FAMILIES.has(c2) ? c2 : undefined;
};
/** a control row: its own id is a hand-tagged control or has a DR family of
 * its own — not through its cast's effect auras (Wake of Ashes 255937 is a
 * damage spell whose separate stun aura has the family) */
const isControl = (id: string | undefined) =>
  !!id && (ccSpellIds.has(id) || DR_FAMILIES.has(getDRCategory(id)));

// ── lookups: the curated tables (ids) ──
const CYCLONE = "33786";
const REFLECT_ONLY_NAMES = new Set(["Spell Reflection", "Nether Ward"]);
const AVOID_TABLE_IDS = new Set<string>([
  ...CC_AVOIDANCE_BUFF_SPELLS.keys(),
  ...IMMUNITY_IDS,
  ...FULL_IMMUNITY_IDS,
  ...DRUID_FORM_BUFFS.keys(),
  CYCLONE,
]);
const AVOID_TABLE_NAMES = new Set<string>(
  [...AVOID_TABLE_IDS].map((id) => nameOf(id)).filter((n) => n !== ""),
);
/** printed name → the repositioning casts the product credits under it */
const REPOSITION_IDS_BY_NAME = new Map<string, string[]>();
for (const [id, n] of REPOSITIONING_SPELL_IDS)
  REPOSITION_IDS_BY_NAME.set(n, [...(REPOSITION_IDS_BY_NAME.get(n) ?? []), id]);
const ALTER_TIME = new Set(["342246", "110909"]);
const OBSIDIAN_SCALES = "363916";
const IMMUNE_SAVE_IDS = new Set<string>(
  [
    ...IMMUNITY_IDS,
    ...FULL_IMMUNITY_IDS,
    ...Object.keys(IMMUNITY_SPELLS),
    "408558", // Phase Shift (the brief: included)
  ].filter((id) => !ALTER_TIME.has(id) && id !== OBSIDIAN_SCALES),
);

/** every English name a row of `id` may be printed under: its own, its
 * casts', its effect auras' */
const aliasCache = new Map<string, Set<string>>();
const aliasesOf = (id: string, fallback = ""): Set<string> => {
  let s = aliasCache.get(id);
  if (!s) {
    s = new Set([nameOf(id, fallback)]);
    for (const c of castsOfEffectAura(id)) s.add(nameOf(c));
    for (const a of effectAurasOfCast(id)) s.add(nameOf(a));
    s.delete("");
    aliasCache.set(id, s);
  }
  return s;
};

/** DB2: can an aura of this id make its carrier immune to anything? */
const db2Immunity = (id: string): "all" | "mask" | number[] | undefined => {
  const e = MECH[id];
  if (!e) return undefined;
  if (e.immuneAll) return "all";
  if (e.immuneMechMask !== undefined) return "mask";
  if (e.immuneMech && e.immuneMech.length > 0) return e.immuneMech;
  return undefined;
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

// ── round-level measurements (each round once) ──
const measuredRounds = new Set<string>();
/** DR reading's own FP rate: landed controls by prior count */
const landedByPrior = [0, 0, 0];
/** check 2: aura id → clean run lengths (s) at Full DR */
const fullRunsById = new Map<string, number[]>();
/** check 6: aura id → [immune cases with it up, landed controls with it up] */
const fwdAura = new Map<string, { immune: number; landed: number }>();
const fwdSeen = new Set<string>();
let fwdCases = 0;
let fwdImmuneRows = 0;
let fwdTableExplained = 0;
let fwdDrExplained = 0;
const fwdBySpell = new Map<string, number>();

interface IEndCand {
  where: string;
  archive: string;
  round: number;
  startMs: number;
  ts: number;
  auraId: string;
  unitName: string;
  prior: number;
  L: number;
  line: string;
  raw: string[];
}
const endCands: IEndCand[] = [];
/** every judged (diminished) unclosed control, for the record */
const ccEndJudged: Array<Record<string, unknown>> = [];
/** check 4 control: own kicks of players, with / without a line */
const playerKick = { n: 0, lined: 0 };

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
  const rawLines: string[] = ((item as any).rawLines ?? []) as string[];
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
  const playerIds = new Set(players.map((u) => u.id as string));
  const rawOf = (row: any): string => {
    const li = liOf(row);
    return li >= 0 && rawLines[li] !== undefined
      ? `#${li} ${rawLines[li]!.slice(0, 260)}`
      : `#? ${ev(row)} @${tsOf(row)}`;
  };
  /** the unit's own id plus the ids of the units it owns (pets, totems) */
  const familyOf = (u: any): Set<string> =>
    new Set([
      u.id as string,
      ...units.filter((x) => x.ownerId === u.id).map((x) => x.id as string),
    ]);
  const auraIn = (u: any): any[] =>
    ((u.auraEvents ?? []) as any[]).filter((a) => a.destUnitId === u.id);
  const successes = (u: any): any[] =>
    ((u.spellCastEvents ?? []) as any[]).filter((c) => ev(c) === SUCCESS);
  const violate = (
    check: Check,
    kind: string,
    atMs: number,
    factId: string,
    detail: string,
    extra: { line?: string; raw?: string[] } = {},
  ) =>
    violations.push({
      check,
      kind,
      where,
      archive,
      round: f.round,
      atMs,
      offMs: atMs - start,
      fact: `${roundKey}#${check}#${kind}#${factId}`,
      detail,
      ...extra,
    });
  const linesAt = (sec: number) => {
    const p = `${fmtS(sec)}  `;
    return lines.filter((l) => l.startsWith(p));
  };
  /** strictly before the instant (ts, line) in log order */
  const before = (a: any, ts: number, li: number) =>
    tsOf(a) < ts || (tsOf(a) === ts && li >= 0 && liOf(a) < li);

  /**
   * The auras up on `u` at the instant (ts, li) among the rows `pred`
   * accepts: per id / source, the last row before the instant is an
   * APPLIED / REFRESH / dose (up) or a REMOVED (down); no row before and the
   * first after is a REMOVED / REFRESH: listed as up at the log's start.
   * `capS`: an application not closed by then holds only that long.
   */
  const upAt = (
    u: any,
    pred: (a: any) => boolean,
    ts: number,
    li: number,
    capS?: (id: string) => number | undefined,
  ): any[] => {
    const last = new Map<string, any>();
    const firstAfter = new Map<string, any>();
    for (const a of auraIn(u)) {
      if (!pred(a)) continue;
      const k = `${a.spellId}|${a.srcUnitId}`;
      if (before(a, ts, li)) last.set(k, a);
      else if (!firstAfter.has(k)) firstAfter.set(k, a);
    }
    const out: any[] = [];
    for (const [k, a] of last) {
      if (!UP_EVENTS.has(ev(a))) continue;
      const cap = capS?.(a.spellId);
      if (cap !== undefined && ts - tsOf(a) > cap * 1000) continue;
      out.push(a);
      void k;
    }
    for (const [k, a] of firstAfter)
      if (!last.has(k) && (ev(a) === REMOVED || ev(a) === REFRESH)) out.push(a);
    return out;
  };
  /** up at any instant of [from, to) */
  const upDuring = (
    u: any,
    pred: (a: any) => boolean,
    from: number,
    to: number,
    capS?: (id: string) => number | undefined,
  ): any[] => {
    const out = upAt(u, pred, from, -1, capS);
    for (const a of auraIn(u))
      if (
        pred(a) &&
        (ev(a) === APPLIED || ev(a) === REFRESH) &&
        tsOf(a) >= from &&
        tsOf(a) < to
      )
        out.push(a);
    return out;
  };

  /** up over the whole of [from, to): up at its first and its last ms (the
   * same id / source) — a span bound is floored, so an aura that ends a few
   * ms into the span's first interior second is the bound, not a save */
  const upWhole = (
    u: any,
    pred: (a: any) => boolean,
    from: number,
    to: number,
    capS?: (id: string) => number | undefined,
  ): any[] => {
    const end = new Set(
      upAt(u, pred, to - 1, -1, capS).map((a) => `${a.spellId}|${a.srcUnitId}`),
    );
    return upAt(u, pred, from, -1, capS).filter((a) =>
      end.has(`${a.spellId}|${a.srcUnitId}`),
    );
  };

  // ── DR from the log ──
  const appsCache = new Map<string, any[]>();
  /** the unit's control applications (one per application) */
  const ccApps = (u: any): any[] => {
    let apps = appsCache.get(u.id);
    if (apps) return apps;
    apps = [];
    const rows = auraIn(u);
    const lastByKey = new Map<string, any>();
    for (const a of rows) {
      const k = `${a.spellId}|${a.srcUnitId}`;
      const prev = lastByKey.get(k);
      lastByKey.set(k, a);
      if (ev(a) !== APPLIED || a.auraType !== "DEBUFF") continue;
      if (a.srcUnitId === u.id) continue;
      const cat = drCatOf(a.spellId);
      if (!cat) continue;
      if (prev) {
        if (ev(prev) === REMOVED && tsOf(a) - tsOf(prev) <= 50) continue;
        if (
          ev(prev) !== REMOVED &&
          tsOf(a) - tsOf(prev) < (ccFullDurationSeconds(a.spellId) ?? 8) * 1000
        )
          continue;
      }
      // its end: the REMOVED of that id / source not followed within 50 ms
      // by a re-APPLIED (a re-broadcast), capped at the official length + 1 s
      const i = rows.indexOf(a);
      const capMs = tsOf(a) + ((ccFullDurationSeconds(a.spellId) ?? 8) + 1) * 1000;
      let endMs = capMs;
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j];
        if (b.spellId !== a.spellId || b.srcUnitId !== a.srcUnitId) continue;
        if (tsOf(b) > capMs) break;
        if (ev(b) !== REMOVED) continue;
        const again = rows.some(
          (c, q) =>
            q > j &&
            c.spellId === a.spellId &&
            c.srcUnitId === a.srcUnitId &&
            ev(c) === APPLIED &&
            tsOf(c) - tsOf(b) <= 50,
        );
        if (again) continue;
        endMs = tsOf(b);
        break;
      }
      apps.push({
        row: a,
        ts: tsOf(a),
        end: endMs,
        cat,
        src: a.srcUnitId as string,
      });
    }
    appsCache.set(u.id, apps);
    return apps;
  };
  /** the chain of same-family applications on `u` before `ts`, walked back
   * from it: a predecessor joins while it ended less than 18 s before the
   * chain's earliest start (or still ran then) — the brief's 18 s, below
   * the 12.1 era's 20 s reset (every capture log is from 2026-08-13 on), so
   * the reading can only under-count. Not the same cast: a predecessor of
   * the same source ≤ 300 ms before. */
  const drPrior = (u: any, cat: string, ts: number, src?: string): any[] => {
    const prior = ccApps(u)
      .filter(
        (x) =>
          x.cat === cat &&
          x.ts < ts - 50 &&
          !(src !== undefined && x.src === src && ts - x.ts <= 300),
      )
      .sort((a, b) => b.ts - a.ts);
    const chain: any[] = [];
    let head = ts;
    for (const p of prior) {
      if (p.end >= head || head - p.end < DR_WINDOW_MS) {
        chain.push(p);
        head = Math.min(head, p.ts);
      } else break;
    }
    return chain;
  };
  /** the DR families a control row can count in: its own id's, its effect
   * auras' (Holy Word: Chastise 88625 → a stun or an incapacitate) */
  const drPriorAny = (u: any, id: string, ts: number): any[] => {
    const cats = new Set<string>(
      [id, ...effectAurasOfCast(id)]
        .map((x) => drCatOf(x))
        .filter((x): x is string => !!x),
    );
    return [...cats]
      .map((c) => drPrior(u, c, ts))
      .sort((a, b) => b.length - a.length)[0] ?? [];
  };

  // ── round-level measurements ──
  if (!measuredRounds.has(roundKey)) {
    measuredRounds.add(roundKey);
    for (const u of players) {
      const rows = auraIn(u);
      for (const x of ccApps(u)) {
        if (!inRound(x.ts)) continue;
        const k = drPrior(u, x.cat, x.ts, x.src).length;
        landedByPrior[Math.min(2, k)]!++;
        // clean Full-DR run lengths (check 2's base)
        if (k === 0) {
          const i = rows.indexOf(x.row);
          for (let j = i + 1; j < rows.length; j++) {
            const b = rows[j];
            if (b.spellId !== x.row.spellId || b.srcUnitId !== x.src) continue;
            if (ev(b) === REMOVED && inRound(tsOf(b))) {
              const l = fullRunsById.get(x.row.spellId) ?? [];
              l.push((tsOf(b) - x.ts) / 1000);
              fullRunsById.set(x.row.spellId, l);
            }
            break;
          }
        }
        // check 6's baseline: the auras up on a player a control LANDED on
        if (isControl(x.row.spellId)) {
          const ids = new Set(
            upAt(u, () => true, x.ts, liOf(x.row)).map((a) => a.spellId),
          );
          for (const id of ids) {
            const t = fwdAura.get(id) ?? { immune: 0, landed: 0 };
            t.landed++;
            fwdAura.set(id, t);
          }
        }
      }
    }
  }

  // ── 6. immunityTableForward ──
  const roundFirst = !fwdSeen.has(roundKey);
  if (roundFirst) fwdSeen.add(roundKey);
  for (const u of players) {
    const pid = pidOf.get(u.name);
    for (const m of (u.missesIn ?? []) as any[]) {
      if (m.missType !== "IMMUNE" || ev(m) !== MISSED) continue;
      if (!isControl(m.spellId) || !inRound(tsOf(m))) continue;
      if (m.srcUnitId === u.id) continue;
      if (roundFirst) fwdImmuneRows++;
      const ts = tsOf(m);
      const li = liOf(m);
      const upAll = upAt(u, () => true, ts, li);
      if (upAll.some((a) => AVOID_TABLE_IDS.has(a.spellId))) {
        if (roundFirst) fwdTableExplained++;
        continue;
      }
      if (drPriorAny(u, m.spellId, ts).length >= 2) {
        if (roundFirst) fwdDrExplained++;
        continue;
      }
      const ccName = nameOf(m.spellId, m.spellName);
      if (roundFirst) {
        fwdCases++;
        fwdBySpell.set(ccName, (fwdBySpell.get(ccName) ?? 0) + 1);
        for (const id of new Set(upAll.map((a) => a.spellId))) {
          const t = fwdAura.get(id) ?? { immune: 0, landed: 0 };
          t.immune++;
          fwdAura.set(id, t);
        }
      }
      // the prompt's line for it
      if (!pid) continue;
      bump("immunityTableForward");
      const sec = Math.floor((ts - start) / 1000);
      const names = aliasesOf(m.spellId, m.spellName);
      const names2 = [...names];
      const near = [sec - 1, sec, sec + 1].flatMap((s) => linesAt(s));
      const hasNear = near.some(
        (l) => l.includes(`${pid}(`) && names2.some((n) => l.includes(n)),
      );
      const hasEarlier =
        !hasNear &&
        Array.from({ length: 21 }, (_, k) => sec - k)
          .flatMap((s) => linesAt(s))
          .some(
            (l) =>
              l.includes("IMMUNE") &&
              l.includes(`${pid}(`) &&
              names2.some((n) => l.includes(n)),
          );
      if (!hasNear && !hasEarlier) {
        const src = byId.get(m.srcUnitId);
        violate(
          "immunityTableForward",
          "noLine",
          ts,
          `${u.name}|${ccName}|${ts}`,
          `${fmtS(sec)} ${pid}(${u.name}) ← ${ccName} ${m.spellId} (by ${src?.name ?? m.srcUnitName}) logged IMMUNE, no table aura up, not DR-immune; no line names it (auras up: ${[...new Set(upAll.map((a) => nameOf(a.spellId, a.spellName)))].slice(0, 12).join(", ")})`,
          { raw: [rawOf(m)] },
        );
      }
    }
  }

  // ── 1. immuneCause ──
  interface ICause {
    sec: number;
    line: string;
    family: string;
    targetPid: string;
    srcPid?: string;
    spell: string;
    outcome: "IMMUNE" | "MISS" | "REFLECT" | "didNotLand";
    aura?: string;
    auraSrcPid?: string;
    /** `from <pid>'s guardian / pet / totem`: a unit that pid owns */
    auraSrcSummon?: boolean;
    auraOwn?: boolean;
  }
  const causes: ICause[] = [];
  const firstPid = (s: string | undefined) =>
    s ? /(\d+)\(/.exec(s)?.[1] : undefined;
  const outcomeOf = (t: string): ICause["outcome"] =>
    t === "IMMUNE" ? "IMMUNE" : t === "REFLECT" ? "REFLECT" : "MISS";
  for (const l of lines) {
    const av =
      /^(\d+:\d\d) {2}\[CC AVOIDED\?\] {3}(\d+)\([^)]*\): (.+?) \(by (.+?)(?:; cast \d+:\d\d)?\) (?:logged (\w+)|did not land); (.+) \((own|from (.+))\) active$/.exec(
        l,
      );
    if (av) {
      causes.push({
        sec: secOf(av[1]!),
        line: l,
        family: "[CC AVOIDED?]",
        targetPid: av[2]!,
        srcPid: firstPid(av[4]),
        spell: av[3]!,
        outcome: av[5] ? outcomeOf(av[5]) : "didNotLand",
        aura: av[6]!,
        auraOwn: av[7] === "own",
        auraSrcPid: av[8] ? firstPid(av[8]) : undefined,
        auraSrcSummon: !!av[8] && /\)'s (?:guardian|pet|totem)/.test(av[8]),
      });
      continue;
    }
    const nl =
      /^(\d+:\d\d) {2}\[CC NOT LANDED\] {3}(\d+)\([^)]*\) ← (.+?) \(by (.+?)\) — logged (\w+) \((.+)\)$/.exec(
        l,
      );
    if (nl) {
      const c = nl[6]!;
      if (c.startsWith("DR:")) continue;
      const own = /^(\d+)\([^)]*\)'s (.+) was on the target$/.exec(c);
      const up = /^(.+) was up$/.exec(c);
      if (!own && !up) continue;
      causes.push({
        sec: secOf(nl[1]!),
        line: l,
        family: "[CC NOT LANDED]",
        targetPid: nl[2]!,
        srcPid: firstPid(nl[4]),
        spell: nl[3]!,
        outcome: outcomeOf(nl[5]!),
        aura: own ? own[2]! : up![1]!,
        auraSrcPid: own ? own[1] : undefined,
      });
      continue;
    }
    const yt = /^(\d+:\d\d) {2}\[(YOU|TEAM)\] \[(CC|CD)\] {3}(.*)$/.exec(l);
    if (yt) {
      const rest = yt[4]!;
      let srcPid: string | undefined;
      let spell: string | undefined;
      if (yt[2] === "YOU") {
        srcPid = pidOf.get(owner.name);
        spell = /^(.+?)(?: →| \[| \(| \||$)/.exec(rest)?.[1];
      } else if (yt[3] === "CC") {
        const m = /^(\d+)\([^)]*\) \([^)]*\) cast (.+?)(?: →| \[|$)/.exec(rest);
        srcPid = m?.[1];
        spell = m?.[2];
      } else {
        const m = /^(\d+)\([^)]*\) \([^)]*\): (.+?)(?: →| \[| \(|$)/.exec(rest);
        srcPid = m?.[1];
        spell = m?.[2];
      }
      if (!spell) continue;
      const arrows = /→ ((?:\d+\([^)]*\)(?:, )?)+)/.exec(rest);
      const arrowPids = arrows
        ? [...arrows[1]!.matchAll(/(\d+)\(/g)].map((x) => x[1]!)
        : [];
      for (const b of rest.matchAll(
        /\[(IMMUNE|MISSED on (\d+)\([^)]*\)(?!'s)|REFLECTED by (\d+)\([^)]*\))(?:: ((?:\d+\([^)]*\)(?:, )?)+))? — ([^\]]+)\]/g,
      )) {
        const cause = b[5]!;
        if (cause.startsWith("DR:")) continue;
        const own = /^(\d+)\([^)]*\)'s (.+) was on the target$/.exec(cause);
        const up = /^(.+) was up$/.exec(cause);
        if (!own && !up) continue;
        const outcome: ICause["outcome"] = b[1]!.startsWith("IMMUNE")
          ? "IMMUNE"
          : b[1]!.startsWith("MISSED")
            ? "MISS"
            : "REFLECT";
        const targets = b[2]
          ? [b[2]]
          : b[3]
            ? [b[3]]
            : b[4]
              ? [...b[4].matchAll(/(\d+)\(/g)].map((x) => x[1]!)
              : arrowPids.length === 1
                ? arrowPids
                : [];
        if (targets.length === 0) {
          bump("immuneCause:bracketNoTarget");
          continue;
        }
        for (const t of targets)
          causes.push({
            sec: secOf(yt[1]!),
            line: l,
            family: `[${yt[2]}] [${yt[3]}]`,
            targetPid: t,
            srcPid,
            spell: spell.trim(),
            outcome,
            aura: own ? own[2]! : up![1]!,
            auraSrcPid: own ? own[1] : undefined,
          });
      }
    }
  }
  for (const c of causes) {
    const T = unitOfPid(c.targetPid);
    if (!T || !c.aura) continue;
    const S = unitOfPid(c.srcPid);
    const sFam = S ? familyOf(S) : undefined;
    const lineMs = start + c.sec * 1000;
    const atCast =
      c.family.startsWith("[YOU]") || c.family.startsWith("[TEAM]");
    const X = c.aura;
    const auraSrcU = c.auraSrcPid ? unitOfPid(c.auraSrcPid) : undefined;
    const auraFam =
      c.auraSrcSummon && auraSrcU
        ? new Set([...familyOf(auraSrcU)].filter((id) => id !== auraSrcU.id))
        : undefined;
    const auraSrcOk = (id: string) =>
      auraFam ? auraFam.has(id) : id === auraSrc;
    const auraSrc = c.auraOwn
      ? T.id
      : c.auraSrcPid
        ? unitOfPid(c.auraSrcPid)?.id
        : undefined;
    const isX = (a: any) =>
      nameOf(a.spellId, a.spellName) === X &&
      (auraSrc === undefined || auraSrcOk(a.srcUnitId));
    // the miss row it describes
    let miss: any;
    if (c.outcome !== "didNotLand") {
      const typeOk = (m: any) =>
        c.outcome === "IMMUNE"
          ? m.missType === "IMMUNE"
          : c.outcome === "REFLECT"
            ? m.missType === "REFLECT"
            : m.missType !== "IMMUNE" && m.missType !== "REFLECT";
      const lo = lineMs - 1000;
      const hi = atCast ? lineMs + 20_000 : lineMs + 2000;
      const cands = ((T.missesIn ?? []) as any[]).filter(
        (m) =>
          ev(m) === MISSED &&
          typeOk(m) &&
          tsOf(m) >= lo &&
          tsOf(m) < hi &&
          (!sFam || sFam.has(m.srcUnitId)),
      );
      const named = cands.filter((m) =>
        aliasesOf(m.spellId, m.spellName).has(c.spell),
      );
      const pool = named.length > 0 ? named : cands.length === 1 ? cands : [];
      const score = (m: any) => {
        const d = tsOf(m) - lineMs;
        return d >= 0 && d < 1000 ? d - 1e6 : Math.abs(d - 500);
      };
      miss = [...pool].sort((a, b) => score(a) - score(b))[0];
      if (!miss) {
        bump("immuneCause:noMissRow");
        continue;
      }
      if (named.length === 0) bump("immuneCause:matchedByUniqueness");
    }
    bump("immuneCause");
    const ts = miss ? tsOf(miss) : lineMs;
    const factId = `${T.name}|${c.spell}|${miss ? ts : `s${c.sec}`}|${X}`;
    const rawMiss = miss ? [rawOf(miss)] : [];
    // X's ids: the auras of that name on the target, the repositioning
    // casts of that name (a lookup: `REPOSITIONING_SPELL_IDS`) and their
    // effect auras (Angel's Feather 121536 → Angelic Feather 121557)
    const xCastIds = new Set<string>(REPOSITION_IDS_BY_NAME.get(X) ?? []);
    const xEffectIds = new Set<string>(
      [...xCastIds].flatMap((id) => [...effectAurasOfCast(id)]),
    );
    const isXAura = (a: any) =>
      (isX(a) || xEffectIds.has(a.spellId)) &&
      (auraSrc === undefined || auraSrcOk(a.srcUnitId));
    const xRows = auraIn(T).filter(isXAura);
    let xUp = miss
      ? upAt(T, isXAura, ts, liOf(miss))
      : upDuring(T, isXAura, lineMs - 1000, lineMs + 1000);
    // E8: an avoidance consumed by the control is REMOVED in the ms of the
    // control's CAST, and the miss row follows up to ~0.7 s later (29-5-197
    // 1:08: Kidney Shot SUCCESS 24.460, Nullifying Shroud REMOVED 24.461,
    // IMMUNE row 24.607) — X up at the source's last cast of the control
    // (≤ 3 s before the row) counts
    if (miss && xUp.length === 0 && sFam) {
      const cast = [...sFam]
        .flatMap((id) => successes(byId.get(id)))
        .filter(
          (cc) =>
            tsOf(cc) <= ts &&
            tsOf(cc) >= ts - 3000 &&
            (cc.destUnitId === T.id || !cc.destUnitId || cc.destUnitId === "0000000000000000") &&
            [...aliasesOf(cc.spellId, cc.spellName)].some((n) =>
              aliasesOf(miss.spellId, miss.spellName).has(n),
            ),
        )
        .sort((a, b) => tsOf(b) - tsOf(a))[0];
      if (cast && upAt(T, isXAura, tsOf(cast), liOf(cast)).length > 0) {
        xUp = [cast];
        bump("immuneCause:upAtCast");
      }
    }
    // E7: Grounding Totem is a summon, not an aura on its owner: "up" = the
    // control's cast went into a Grounding Totem of the target's (± 1.5 s),
    // or the target summoned one in the 3.5 s before (its life is 3 s)
    if (X === "Grounding Totem" && xUp.length === 0) {
      const totems = new Set(
        units
          .filter((u) => u.ownerId === T.id && u.name === "Grounding Totem")
          .map((u) => u.id as string),
      );
      const redirected = sFam
        ? [...sFam].some((id) =>
            successes(byId.get(id)).some(
              (cc) =>
                totems.has(cc.destUnitId) &&
                tsOf(cc) >= ts - 1500 &&
                tsOf(cc) <= ts + 1500,
            ),
          )
        : false;
      const summoned = successes(T).some(
        (cc) =>
          nameOf(cc.spellId, cc.spellName) === "Grounding Totem" &&
          tsOf(cc) >= ts - 3500 &&
          tsOf(cc) <= ts + 1000,
      );
      if (redirected || summoned) xUp = [{ grounding: true }];
      if (redirected) bump("immuneCause:groundingRedirect");
      else if (summoned) bump("immuneCause:groundingSummoned");
    }
    // E9: a repositioning the product credits by its PRESS (Roll, Transcendence:
    // Transfer, Wind Rush Totem — no aura on the unit): a SUCCESS of it by
    // the aura's owner in the 2 s before the instant (or inside its second)
    if (xUp.length === 0 && xCastIds.size > 0) {
      const who = auraSrc ? byId.get(auraSrc) : T;
      const press = successes(who ?? T).find(
        (cc) =>
          (xCastIds.has(cc.spellId) || nameOf(cc.spellId, cc.spellName) === X) &&
          tsOf(cc) >= (miss ? ts : lineMs) - 2000 &&
          tsOf(cc) < (miss ? ts + 1 : lineMs + 1000),
      );
      if (press) {
        xUp = [press];
        bump("immuneCause:pressedReposition");
      }
    }
    // (a) notUp
    const notUp = xUp.length === 0;
    if (notUp) {
      const who = auraSrc ? byId.get(auraSrc) : T;
      const xCasts = successes(who ?? T).filter(
        (cc) => xCastIds.has(cc.spellId) || nameOf(cc.spellId, cc.spellName) === X,
      );
      const nearest = [...xRows, ...xCasts].sort(
        (a, b) => Math.abs(tsOf(a) - ts) - Math.abs(tsOf(b) - ts),
      )[0];
      // E11: a `did not land` line of a ground / delayed control sits at its
      // CAST second (no `; cast` tag), while the control resolves later
      // (Sigil of Misery: 161-5-960 2:58, cast 29.482, Divine Steed 30.333,
      // the sigil goes off ~2 s after its cast). X up after the line's
      // second but inside the resolve window — the source's cast of it + 3 s
      // — is `notUp:inResolveWindow`, out of the total: round 3 D52 (a
      // feather 1.4 s after a Freezing Trap) has this shape and was ruled a
      // defect, a Sigil / Capacitor Totem dodged on its delay is not; it
      // needs a ruling per control, not a verdict from this check.
      let inResolve = false;
      if (!miss) {
        const cast = sFam
          ? [...sFam]
              .flatMap((id) => successes(byId.get(id)))
              .filter(
                (cc) =>
                  tsOf(cc) >= lineMs - 3000 &&
                  tsOf(cc) < lineMs + 1000 &&
                  aliasesOf(cc.spellId, cc.spellName).has(c.spell),
              )
              .sort((a, b) => tsOf(b) - tsOf(a))[0]
          : undefined;
        const until = Math.max(lineMs + 1000, (cast ? tsOf(cast) : lineMs) + 3000);
        inResolve =
          upDuring(T, isXAura, lineMs + 1000, until).length > 0 ||
          (xCastIds.size > 0 &&
            successes(who ?? T).some(
              (cc) =>
                (xCastIds.has(cc.spellId) ||
                  nameOf(cc.spellId, cc.spellName) === X) &&
                tsOf(cc) >= lineMs + 1000 &&
                tsOf(cc) < until,
            ));
      }
      violate(
        "immuneCause",
        inResolve
          ? "notUp:inResolveWindow"
          : !nearest && X !== "Grounding Totem"
            ? "notUp:neverOnUnit"
            : "notUp",
        ts,
        factId,
        `${fmtS(c.sec)} ${c.targetPid}(${T.name}) ${c.spell} ${miss ? `${miss.missType} row ${miss.spellId}` : "did not land"}: "${X}" not up on the target at ${miss ? "the miss" : "that second"}${nearest ? ` (nearest ${X} row: ${ev(nearest)} ${((tsOf(nearest) - ts) / 1000).toFixed(2)}s from it)` : ""}`,
        {
          line: c.line.slice(0, 240),
          raw: [...rawMiss, ...(nearest ? [rawOf(nearest)] : [])],
        },
      );
    }
    // (b) cannotCause
    let cannot: string | undefined;
    if (c.outcome !== "didNotLand") {
      if (REFLECT_ONLY_NAMES.has(X) && c.outcome !== "REFLECT")
        cannot = "reflectOnly";
      else if (!AVOID_TABLE_NAMES.has(X)) {
        const ids = new Set<string>([
          ...xRows.map((a) => a.spellId as string),
          ...xCastIds,
          ...xEffectIds,
        ]);
        const imm = [...ids].map(db2Immunity);
        const mech =
          ccMechanicOf(miss.spellId) ??
          effectAurasOfCast(miss.spellId)
            .map((a) => ccMechanicOf(a))
            .find((x) => x !== undefined);
        if (ids.size > 0 && imm.every((x) => x === undefined))
          cannot = "noImmunity";
        else if (
          mech !== undefined &&
          imm.length > 0 &&
          imm.every((x) => Array.isArray(x) && !x.includes(mech))
        )
          cannot = "mechanic";
      }
    }
    if (cannot)
      violate(
        "immuneCause",
        `cannotCause:${cannot}`,
        ts,
        factId,
        `${fmtS(c.sec)} ${c.targetPid}(${T.name}) ${c.spell} ${miss.missType} row ${miss.spellId}: "${X}" cannot produce it (${cannot})`,
        { line: c.line.slice(0, 240), raw: rawMiss },
      );
    // (c) drImmune
    if (c.outcome === "IMMUNE" && miss) {
      const prior = drPriorAny(T, miss.spellId, ts);
      const cat = prior[0]?.cat as string | undefined;
      if (cat && prior.length >= 2) {
        if (!notUp && !cannot) bump("immuneCause:drImmune:auraAlsoExplains");
        else
          violate(
            "immuneCause",
            "drImmune",
            ts,
            factId,
            `${fmtS(c.sec)} ${c.targetPid}(${T.name}) ${c.spell} IMMUNE at ${cat} DR immune (before it in 18 s: ${prior.map((x) => `${nameOf(x.row.spellId)} ${((x.ts - ts) / 1000).toFixed(1)}s`).join(", ")}), line names "${X}"`,
            {
              line: c.line.slice(0, 240),
              raw: [...rawMiss, ...prior.map((x) => rawOf(x.row))],
            },
          );
      }
    }
  }

  // ── 2. ccEndUndiminished ──
  const ccLines = lines
    .map((l) => ({
      l,
      m: /^(\d+:\d\d) {2}\[CC ON (?:TEAM|ENEMY)\] {3}(\d+)\([^)]*\) ← (.+?) \(by (.+?)\)( .*)?$/.exec(
        l,
      ),
    }))
    .filter((x) => !!x.m);
  for (const u of players) {
    const pid = pidOf.get(u.name);
    if (!pid) continue;
    const rows = auraIn(u);
    for (const x of ccApps(u)) {
      if (!inRound(x.ts)) continue;
      const i = rows.indexOf(x.row);
      const base = ccFullDurationSeconds(x.row.spellId) ?? 8;
      let next: any;
      for (let j = i + 1; j < rows.length; j++)
        if (rows[j].spellId === x.row.spellId && rows[j].srcUnitId === x.src) {
          next = rows[j];
          break;
        }
      const closed =
        next &&
        (ev(next) !== APPLIED || tsOf(next) - x.ts <= base * 1000 + 500);
      if (closed) continue;
      bump("ccEndUndiminished:unclosed");
      const sec = Math.floor((x.ts - start) / 1000);
      const names = aliasesOf(x.row.spellId, x.row.spellName);
      const srcU = byId.get(x.src);
      const srcOwner = srcU?.ownerId ? byId.get(srcU.ownerId) : undefined;
      const srcPids = new Set(
        [srcU, srcOwner]
          .filter(Boolean)
          .map((s: any) => pidOf.get(s.name))
          .filter(Boolean) as string[],
      );
      const hit = ccLines.find(
        ({ m }) =>
          m![2] === pid &&
          names.has(m![3]!) &&
          Math.abs(secOf(m![1]!) - sec) <= 1 &&
          srcPids.has(firstPid(m![4]) ?? ""),
      );
      if (!hit) {
        bump("ccEndUndiminished:noLine");
        continue;
      }
      const rest = hit.m![5] ?? "";
      if (rest.includes("still on them when the round ended")) {
        bump("ccEndUndiminished:roundEndedNoLength");
        continue;
      }
      const lm = /^ (?:\((\d+)s\)|\| (\d+)s\b)/.exec(rest);
      if (!lm) {
        bump("ccEndUndiminished:noLength");
        continue;
      }
      const L = Number(lm[1] ?? lm[2]);
      const prior = drPrior(u, x.cat, x.ts, x.src);
      bump("ccEndUndiminished");
      if (prior.length === 0) continue;
      endCands.push({
        where,
        archive,
        round: f.round,
        startMs: start,
        ts: x.ts,
        auraId: x.row.spellId,
        unitName: u.name,
        prior: prior.length,
        L,
        line: hit.l.slice(0, 220),
        raw: [rawOf(x.row), ...prior.map((p) => rawOf(p.row))],
      });
    }
  }

  // ── 3. defenselessSaveUp ──
  const spans = new Map<
    string,
    { a: number; b: number; name: string; l: string }
  >();
  for (const l of lines) {
    const kw = /\[KILL WINDOW\] \S+ on [^(]+\(([^)]+)\)/.exec(l);
    const kd = kw ? /defenseless (\d+:\d\d)–(\d+:\d\d)/.exec(l) : null;
    const vu =
      /\[VULNERABLE\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+\(([^)]+)\)/.exec(
        l,
      );
    const s = kd
      ? { a: secOf(kd[1]!), b: secOf(kd[2]!), name: kw![1]!, l }
      : vu
        ? { a: secOf(vu[1]!), b: secOf(vu[2]!), name: vu[3]!, l }
        : undefined;
    if (!s) continue;
    const k = `${s.name}|${s.a}|${s.b}|${kd ? "KW" : "VU"}`;
    if (!spans.has(k)) spans.set(k, s);
  }
  for (const [k, s] of spans) {
    const T = byName.get(s.name);
    if (!T) continue;
    bump("defenselessSaveUp");
    const tag = k.endsWith("KW") ? "KILL WINDOW" : "VULNERABLE";
    const hits: Record<string, string[]> = {};
    const raws: Record<string, string[]> = {};
    const firstMs: Record<string, number> = {};
    const add = (kind: string, s0: number, what: string, row: any) => {
      (hits[kind] ??= []).push(`${fmtS(s0)} ${what}`);
      const r = (raws[kind] ??= []);
      if (r.length < 4) r.push(rawOf(row));
      firstMs[kind] ??= tsOf(row);
    };
    const immPred = (a: any) =>
      IMMUNE_SAVE_IDS.has(a.spellId) &&
      !(a.spellId === OBSIDIAN_SCALES && a.srcUnitId !== T.id);
    const capS = (id: string) => (officialS(id) ?? 10) + 1;
    const miPred = (a: any) =>
      nameOf(a.spellId, a.spellName) === "Mass Invisibility" &&
      a.srcUnitId !== T.id;
    for (let s0 = s.a + 1; s0 <= s.b - 1; s0++) {
      const from = start + s0 * 1000;
      const to = from + 1000;
      if (!inRound(from)) continue;
      const imm = upWhole(T, immPred, from, to, capS);
      if (imm[0])
        add(
          "immunity",
          s0,
          `${nameOf(imm[0].spellId, imm[0].spellName)} ${imm[0].spellId}${imm[0].srcUnitId === T.id ? "" : ` (from ${byId.get(imm[0].srcUnitId)?.name ?? "?"})`}`,
          imm[0],
        );
      const abs = ((T.absorbsIn ?? []) as any[]).filter(
        (a) =>
          a.srcUnitId === T.id &&
          a.destUnitId === T.id &&
          tsOf(a) >= from &&
          tsOf(a) < to &&
          Math.abs(a.absorbedAmount) > 0 &&
          !ALTER_TIME.has(String(a.spellId)) &&
          String(a.spellId) !== OBSIDIAN_SCALES,
      );
      // E6: a shield it APPLIED = one it pressed (an own cast of the shield,
      // by id / cast ↔ effect / name, in the 60 s before the absorb row) — a
      // talent's passive absorb (Danger Sense, First In Last Out, Don't Look
      // Back, Saved by the Light …) is no "shield it applied on itself"
      const pressed = (a: any) => {
        const sid = String(a.spellId);
        const nm = nameOf(sid, a.spellName);
        return successes(T).some(
          (cc) =>
            tsOf(cc) <= tsOf(a) &&
            tsOf(cc) >= tsOf(a) - 60_000 &&
            (cc.spellId === sid ||
              castsOfEffectAura(sid).includes(cc.spellId) ||
              nameOf(cc.spellId, cc.spellName) === nm),
        );
      };
      // the ruling names them: an own PW:S / Void Shield counts pressed or
      // not (a Holy Priest's proc PW:S 1246768 has no cast row)
      const ab = abs.find(
        (a) =>
          RULED_OWN_SHIELDS.has(nameOf(String(a.spellId), a.spellName)) ||
          pressed(a),
      );
      const abP = ab ? undefined : abs[0];
      if (ab) {
        const nm = nameOf(String(ab.spellId), ab.spellName);
        pressedAbsorbNames.set(nm, (pressedAbsorbNames.get(nm) ?? 0) + 1);
      }
      if (ab)
        add(
          "ownAbsorb",
          s0,
          `${nameOf(String(ab.spellId), ab.spellName)} ${ab.spellId} ate ${Math.abs(ab.absorbedAmount)}`,
          ab,
        );
      if (abP) {
        const nm = nameOf(String(abP.spellId), abP.spellName);
        passiveAbsorbNames.set(nm, (passiveAbsorbNames.get(nm) ?? 0) + 1);
        add(
          "ownAbsorb:passive",
          s0,
          `${nm} ${abP.spellId} ate ${Math.abs(abP.absorbedAmount)}`,
          abP,
        );
      }
      const mi = upWhole(T, miPred, from, to, capS);
      if (mi[0])
        add(
          "massInvis",
          s0,
          `Mass Invisibility from ${byId.get(mi[0].srcUnitId)?.name ?? "?"}`,
          mi[0],
        );
    }
    for (const [kind, hs] of Object.entries(hits)) {
      const first = hs[0]!.split(" ").slice(1).join(" ");
      violate(
        "defenselessSaveUp",
        kind,
        firstMs[kind] ?? start + s.a * 1000,
        `${s.name}|${s.a}|${s.b}|${tag}`,
        `[${tag}] ${fmtS(s.a)}–${fmtS(s.b)} on ${s.name}: ${hs.length} interior second(s) with ${kind} — first ${hs[0]!.split(" ")[0]} ${first}${hs.length > 1 ? `; last ${hs.at(-1)}` : ""}`,
        { line: s.l.trim().slice(0, 240), raw: raws[kind] },
      );
    }
  }

  // ── 4. petInterrupt ──
  const kickLines = lines.filter((l) => /^\d+:\d\d {2}\[KICK\] /.test(l));
  for (const u of units) {
    const kicks = ((u.actionOut ?? []) as any[]).filter(
      (a) => ev(a) === INTERRUPT && inRound(tsOf(a)),
    );
    if (kicks.length === 0) continue;
    const isPlayer = playerIds.has(u.id);
    const ownerU = isPlayer ? undefined : byId.get(u.ownerId);
    if (!isPlayer && !(ownerU && playerIds.has(ownerU.id))) continue;
    const creditPid = pidOf.get((isPlayer ? u : ownerU).name);
    if (!creditPid) continue;
    for (const k of kicks) {
      const V = byId.get(k.destUnitId);
      const vPid = V && playerIds.has(V.id) ? pidOf.get(V.name) : undefined;
      if (!vPid) continue;
      const ts = tsOf(k);
      const sec = Math.floor((ts - start) / 1000);
      const spell = nameOf(k.extraSpellId, k.extraSpellName);
      const at = kickLines.filter((l) => {
        const s = secOf(/^(\d+:\d\d)/.exec(l)![1]!);
        return Math.abs(s - sec) <= 1;
      });
      const naming = at.filter(
        (l) =>
          l.includes(`interrupted ${vPid}(`) && l.includes(`'s ${spell} (`),
      );
      const credit = isPlayer
        ? new RegExp(`\\[KICK\\] {3}${creditPid}\\([^)]*\\) interrupted`)
        : new RegExp(`\\[KICK\\] {3}${creditPid}\\([^)]*\\)'s pet interrupted`);
      const ok = naming.some((l) => credit.test(l));
      if (isPlayer) {
        playerKick.n++;
        if (ok) playerKick.lined++;
        continue;
      }
      bump("petInterrupt");
      if (ok) continue;
      violate(
        "petInterrupt",
        naming.length === 0 ? "noLine" : "notCredited",
        ts,
        `${u.name}|${V.name}|${spell}|${ts}`,
        `${fmtS(sec)} ${u.name} (${nameOf(k.spellId, k.spellName)} ${k.spellId}, pet of ${creditPid}(${ownerU.name})) interrupted ${vPid}(${V.name})'s ${spell}${naming.length ? `; the line credits: ${naming[0]!.slice(0, 140)}` : "; no [KICK] line names it"}`,
        { raw: [rawOf(k)], line: naming[0]?.slice(0, 200) },
      );
    }
  }

  // ── 5. duplicateLine ──
  const famRe =
    /^(\d+:\d\d) {2}(\[CC AVOIDED\?\]|\[ENEMY DEF\]|\[ENEMY UTILITY\]|\[ENEMY CD\]|\[TEAM\] \[CD\]|\[YOU\] \[CD\]) {3}(.*)$/;
  const groups = new Map<string, Array<{ tag: string; l: string }>>();
  for (const l of lines) {
    const m = famRe.exec(l);
    if (!m) continue;
    const [, t, tag, rest] = m as unknown as [string, string, string, string];
    let pid: string | undefined;
    let name: string | undefined;
    let dest = "";
    let src = "";
    if (tag === "[YOU] [CD]") {
      pid = pidOf.get(owner.name);
      name = /^(.+?)(?: →| \(| \[| \||$)/.exec(rest)?.[1];
      dest = /^.+? → (\d+)\(/.exec(rest)?.[1] ?? "";
    } else if (tag === "[CC AVOIDED?]") {
      const mm = /^(\d+)\([^)]*\): (.+?) \(by (.+?)(?:; cast \d+:\d\d)?\)/.exec(
        rest,
      );
      pid = mm?.[1];
      name = mm?.[2];
      src = firstPid(mm?.[3]) ?? "";
    } else {
      const mm = /^(\d+)\([^)]*\) \([^)]*\): (.+?)(?: →| \(| \[|$)/.exec(rest);
      pid = mm?.[1];
      name = mm?.[2];
      dest = /^\d+\([^)]*\) \([^)]*\): .+? → (\d+)\(/.exec(rest)?.[1] ?? "";
    }
    if (!pid || !name) continue;
    const famKey = tag.startsWith("[ENEMY") ? "[ENEMY *]" : tag;
    const gk = `${t}|${famKey}|${pid}|${name.trim()}|${dest}|${src}`;
    const g = groups.get(gk) ?? [];
    g.push({ tag, l });
    groups.set(gk, g);
  }
  for (const [gk, g] of groups) {
    if (g.length < 2) continue;
    const [t, famKey, pid, name, dest, src] = gk.split("|") as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const U = unitOfPid(pid);
    if (!U) continue;
    bump("duplicateLine");
    const sec = secOf(t);
    const from = start + sec * 1000;
    const has = (id: string, fb: string) => aliasesOf(id, fb).has(name);
    let single: boolean;
    let what: string;
    let raws: any[];
    if (famKey === "[CC AVOIDED?]") {
      const S = unitOfPid(src);
      const sFam = S ? familyOf(S) : undefined;
      const misses = ((U.missesIn ?? []) as any[]).filter(
        (m) =>
          tsOf(m) >= from &&
          tsOf(m) < from + 1000 &&
          has(m.spellId, m.spellName) &&
          (!sFam || sFam.has(m.srcUnitId)),
      );
      const casts = S
        ? [...sFam!]
            .flatMap((id) => successes(byId.get(id)))
            .filter(
              (c) =>
                tsOf(c) >= from - 3000 &&
                tsOf(c) < from + 1000 &&
                has(c.spellId, c.spellName),
            )
        : [];
      single = misses.length <= 1 && casts.length <= 1;
      what = `${misses.length} miss row(s), ${casts.length} cast(s)`;
      raws = [...misses, ...casts];
    } else {
      const D = dest ? unitOfPid(dest) : U;
      const casts = successes(U).filter(
        (c) =>
          tsOf(c) >= from &&
          tsOf(c) < from + 1000 &&
          has(c.spellId, c.spellName),
      );
      const applied = D
        ? auraIn(D).filter(
            (a) =>
              ev(a) === APPLIED &&
              a.srcUnitId === U.id &&
              tsOf(a) >= from &&
              tsOf(a) < from + 1000 &&
              has(a.spellId, a.spellName),
          )
        : [];
      single = casts.length <= 1 && applied.length <= 1;
      what = `${casts.length} cast(s), ${applied.length} APPLIED`;
      raws = [...casts, ...applied];
    }
    if (!single) {
      bump("duplicateLine:logHasTwo");
      continue;
    }
    const tags = new Set(g.map((x) => x.tag));
    violate(
      "duplicateLine",
      tags.size > 1
        ? `crossTag:${[...tags].sort().join("+")}`
        : `sameTag:${famKey}`,
      raws[0] ? tsOf(raws[0]) : from,
      `${U.name}|${famKey}|${name}|${dest}|${sec}`,
      `${t} ${pid}(${U.name}) ${name}${dest ? ` → ${dest}` : ""}: ${g.length} lines, the log has ${what}`,
      {
        line: g.map((x) => x.l.slice(0, 160)).join(" ‖ "),
        raw: raws.slice(0, 3).map(rawOf),
      },
    );
  }
}

// ── corpus-wide resolution ──
// 2. the printed length of an unclosed control at a diminished step
const p90 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.9 * s.length))]!;
};
for (const c of endCands) {
  const off = ccFullDurationSeconds(c.auraId) ?? officialS(c.auraId);
  const runs = fullRunsById.get(c.auraId) ?? [];
  const base = Math.max(off ?? 0, runs.length >= 5 ? p90(runs) : 0);
  if (!base) {
    bump("ccEndUndiminished:noBase");
    continue;
  }
  const factor = c.prior >= 2 ? 0.25 : 0.5;
  bump("ccEndUndiminished:diminishedJudged");
  ccEndJudged.push({
    where: c.where,
    offMs: c.ts - c.startMs,
    aura: `${nameOf(c.auraId)} ${c.auraId}`,
    prior: c.prior,
    L: c.L,
    bound: base * factor + 0.5,
    line: c.line,
  });
  if (c.L > base * factor + 0.5)
    violations.push({
      check: "ccEndUndiminished",
      kind: c.prior >= 2 ? "third" : "second",
      where: c.where,
      archive: c.archive,
      round: c.round,
      atMs: c.ts,
      offMs: c.ts - c.startMs,
      fact: `${c.archive}#${c.round}#ccEndUndiminished#${c.unitName}|${c.auraId}|${c.ts}`,
      detail: `${nameOf(c.auraId)} ${c.auraId} on ${c.unitName}, never closed, application ${c.prior + 1} of its family in 18 s: printed ${c.L}s > ${base.toFixed(1)}s × ${factor} + 0.5 (official ${off ?? "?"}s, Full-DR p90 ${runs.length >= 5 ? p90(runs).toFixed(1) : "n<5"})`,
      line: c.line,
      raw: c.raw,
    });
}

// ── report ──
const out: string[] = [];
const say = (s: string) => {
  out.push(s);
  console.log(s);
};
say(`capture: ${resolve(dir)}`);
say(`contexts: ${contexts}  rounds measured: ${measuredRounds.size}`);
say(
  `DR reading (18 s, from the log) on LANDED controls: prior 0 → ${landedByPrior[0]}, 1 → ${landedByPrior[1]}, ≥ 2 → ${landedByPrior[2]} (a landed 3rd is impossible in 12.x: ${((landedByPrior[2]! / Math.max(1, landedByPrior[0]! + landedByPrior[1]! + landedByPrior[2]!)) * 100).toFixed(2)} % is the reading's over-count)`,
);
for (const c of CHECKS) {
  const all = violations.filter((v) => v.check === c);
  const vs = all.filter((v) => !OUT_OF_TOTAL.has(`${c}|${v.kind}`));
  const distinct = new Set(vs.map((v) => v.fact));
  const factLines = new Set(
    vs.map((v) => v.fact.replace(/#[^#]*#([^#]*)$/, "#$1")),
  );
  say(
    `${c}: checked ${checked.get(c) ?? 0} / violations ${vs.length} (distinct facts ${distinct.size}, distinct by fact ignoring kind ${factLines.size})`,
  );
  const kinds = [...new Set(all.map((v) => v.kind))].sort();
  for (const k of kinds) {
    const ks = all.filter((v) => v.kind === k);
    const kd = new Set(ks.map((v) => v.fact)).size;
    say(
      `  ${k}: ${ks.length} (distinct ${kd})${OUT_OF_TOTAL.has(`${c}|${k}`) ? "  [not in the total]" : ""}`,
    );
    for (const v of ks.slice(0, EXAMPLES))
      say(`    ${v.where} r${v.round} +${v.offMs}ms ${v.detail}`);
  }
}
for (const [k, n] of [...checked].sort())
  if (k.includes(":")) say(`(${k}: ${n})`);
say(
  `defenselessSaveUp counted own absorbs (span-seconds, by shield): ${[...pressedAbsorbNames].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, k]) => `${n} ${k}`).join(", ")}`,
);
say(
  `defenselessSaveUp E6 passive own absorbs (span-seconds, by shield): ${[...passiveAbsorbNames].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, k]) => `${n} ${k}`).join(", ")}`,
);
say(
  `petInterrupt control — players' own kicks with a crediting [KICK] line: ${playerKick.lined}/${playerKick.n}`,
);

say("");
say(
  `immunityTableForward measurement — IMMUNE rows of a control on a player (per round): ${fwdImmuneRows}; a table aura up ${fwdTableExplained}; DR-immune by the log ${fwdDrExplained}; unexplained ${fwdCases}`,
);
say(
  `  unexplained by control: ${[...fwdBySpell]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([n, k]) => `${n} ${k}`)
    .join(", ")}`,
);
say(
  "  auras up on the target in the unexplained cases (n ≥ 3, top 30 by n; landed = controls that LANDED on a player under it; rate = n / (n + landed)):",
);
const fwdRows = [...fwdAura]
  .filter(([, t]) => t.immune >= 3)
  .map(([id, t]) => ({
    id,
    name: nameOf(id),
    n: t.immune,
    landed: t.landed,
    rate: t.immune / (t.immune + t.landed),
    share: t.immune / Math.max(1, fwdCases),
  }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 30);
for (const r of fwdRows)
  say(
    `    ${r.id.padStart(7)} ${r.name.padEnd(30)} n ${String(r.n).padStart(4)} (${(r.share * 100).toFixed(0).padStart(3)}% of cases)  landed ${String(r.landed).padStart(5)}  rate ${(r.rate * 100).toFixed(1)}%`,
  );
const fwdByRate = [...fwdAura]
  .filter(([, t]) => t.immune >= 3)
  .map(([id, t]) => ({
    id,
    name: nameOf(id),
    n: t.immune,
    landed: t.landed,
    rate: t.immune / (t.immune + t.landed),
  }))
  .sort((a, b) => b.rate - a.rate)
  .slice(0, 30);
say("  the same, n ≥ 3, top 30 by rate:");
for (const r of fwdByRate)
  say(
    `    ${r.id.padStart(7)} ${r.name.padEnd(30)} n ${String(r.n).padStart(4)}  landed ${String(r.landed).padStart(5)}  rate ${(r.rate * 100).toFixed(1)}%`,
  );

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        capture: resolve(dir),
        contexts,
        checked: Object.fromEntries(checked),
        landedByPrior,
        playerKick,
        ccEndJudged,
        immunityTableForward: {
          immuneRows: fwdImmuneRows,
          tableExplained: fwdTableExplained,
          drExplained: fwdDrExplained,
          unexplained: fwdCases,
          byN: fwdRows,
          byRate: fwdByRate,
        },
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
