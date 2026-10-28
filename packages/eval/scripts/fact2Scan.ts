/* eslint-disable @typescript-eslint/no-explicit-any -- the scan walks the untyped legacy parse objects (match.units, auraEvents, absorbsIn) by the hundred */
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
 *    Since 2026-10-21 the tag is read at the press instant (GH #91, user
 *    call): only a run covering the whole second owes it.
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
 *  - `killAnchorInto` (new: kill-attempt anchor): a KILL ATTEMPTS `[a–b] on
 *    X — <Spell> burst (no stun)` line. Some friendly cast of <Spell> in
 *    [a, b + 1) went into X (its cast row's dest, or a damage row of that
 *    spell on X); a line that names where the opener went
 *    (`(cast into …)`) is not checked.
 *  - `killTargetInside` (new): the same lines' X took the most of the team's
 *    damage (landed + absorbed, friendly `damageOut`) inside the printed
 *    bracket [a, b + 1) when that most is at least 30k.
 *
 *  - `reflectedLine` (new: Spell Reflection): a REFLECT miss of a damage
 *    spell whose reflector then hit the caster with Spell Reflection 23920
 *    rows (−0.5 s … +3 s around it) worth ≥ 5 % of the caster's max HP. A
 *    `[REFLECTED] <caster pid>'s … reflected by <reflector pid>` line at its
 *    second must say it.
 *  - `reflectSchool` (new): a `Top damage` entry `— Spell Reflection
 *    [Physical]` while every 23920 row on that unit in its last 10 s carries
 *    another damage school in its tail.
 *
 *  - `stateTick` (new: the [STATE] sampler — the gate shares the product's
 *    sampler, so this is the independent reading): every `pid:N` of a
 *    `[STATE]` line equals the unit's last advanced reading at or before
 *    m:ss.0 within 3 s (the first after it when there is none), rounded.
 *
 *  - `resOpener` (new: [RES] first 5 s): the round's first [RES] row, when
 *    it sits under a line of 0:00–0:05, says `rdy:` with something on it
 *    unless every tracked cooldown of the team was pressed by then — read as
 *    the next delta row adding nothing it calls `+`… back: a `rdy:—` first
 *    row followed by a `rdy:Δ +` row is wrong.
 *
 *  - `riderAsCleanse` (new: rider dispels): an `[ENEMY CLEANSE]` / `[PURGE]`
 *    / `[ENEMY PURGE]` line whose `(via)` is a form / movement / defensive
 *    rider (`MOVEMENT_ROOT_BREAK_DISPEL_IDS`, by English name) is wrong.
 *
 *  - `sorImmune` (ruling 5): an enemy's pressed Spirit of Redemption (aura
 *    215769 APPLIED on itself) needs an `[ENEMY DEF] … Spirit of Redemption
 *    (immune…` line at its second; a KILL ATTEMPTS line on that unit whose
 *    bracket + 5 s holds the form's start must not end `not enough damage`.
 *
 *  - `areaWallPopped` (new: Darkness): a KILL ATTEMPTS line on X whose
 *    bracket holds X's own Darkness 196718 press, with a SPELL_ABSORBED row
 *    of its 209426 on X in the bracket + 5 s, must not end `healed through` /
 *    `not enough damage`.
 *  - `effectProvesUse` (new: cast row missing): a loadout `X [..] [UNUSED]`
 *    of a unit that (or whose pet) applied X's own effect aura this round
 *    (castEffectAuraGenerated, same name, ≥ 50 % of casts) while the round
 *    has no cast row of X.
 *
 *  - `exposureOnCd` (new: healer exposure): a `[HEALER EXPOSURE]` line's `IN
 *    LoS: <enemy>: <control> <DR>` entry. When that enemy pressed the
 *    control (a SPELL_CAST_SUCCESS whose English name is the control's, or
 *    whose own-effect aura's is) before the line's second, and its
 *    talent-resolved single-charge cooldown (`unitCooldownOf`, the shared
 *    cooldown fact) has not run out by then, the entry is wrong.
 *  - `lockedShare` (new: dispel feasibility): a missed-purge / uncleansed
 *    exemption `CC'd/locked out` (line or folded note) must state the
 *    measured share, `for N.Ns of it` — the gate is "free time < the
 *    reaction bar", which a 2.2 s Sleep Walk in a 5 s window meets.
 *  - `friendlyBacklash` (new: friendly-sourced control): a dispel backlash
 *    (Sin and Punishment 87204 / 196364) APPLIED on a player of the owner's
 *    side by a unit of the owner's side needs a `[CC ON TEAM]   <pid> ←
 *    <name>` line at its second (`[SILENCE]` for the silence 196364 since
 *    fact3 D30).
 *  - `aoeMissAvoided` (new: untargeted area control): a failed-control miss
 *    (`CONTROL_FAILED_MISS_TYPES`) of a control (`isControlCast`) on a
 *    player of the owner's side, from an enemy cast of it with no
 *    destination within 1 s before, while that player had an avoidance buff
 *    up that `applicableCCAvoidanceIds` admits for it, needs a `[CC
 *    AVOIDED?]   <pid>: <name>` line at its second.
 *  - `hardCastLanded` (new: hard-cast outcome): an `[ENEMY HARD CAST]` line
 *    says `landed` iff the completed cast (the caster's SUCCESS of that
 *    spell after the line's second) has a damage row of it on its target,
 *    or a SPELL_ABSORBED row of it on that target, inside 2.5 s.
 *  - `periodicImmune` (new: DoT ticks): a `[YOU]` / `[TEAM]` press line
 *    tagged `[IMMUNE…` whose spell's IMMUNE rows inside 3 s of the press are
 *    all SPELL_PERIODIC_MISSED (later ticks) is wrong.
 *  - `hotPressHp` (new: press HP): a `[YOU] [CD]   <Spell> (self: N% HP`
 *    line whose press has its own heal row on the owner (a direct heal within
 *    PRESS_EFFECT_LEAD_MS of the cast row, a first HoT tick on its own fresh
 *    aura within AURA_BEFORE_CAST_ROW_MAX_MS; up to 50 ms after): N is the
 *    owner's last reading strictly before that heal (± 1).
 *  - `fadedDebuff` (new: reflected control): a `[BUFF FADED]   X` line while
 *    the owner's only X rows that round are DEBUFFs it put on itself.
 *  - `nonControlCount` (new: CC USE): a `Counts:` entry whose spell, when the
 *    owner pressed it, put auras only on the owner's side (BUFFs) and none
 *    on an enemy, is no control.
 *  - `kickedHeldNote` (new: loadout NOTE): a cooldown the NOTE calls
 *    `correctly HELD` must have no SPELL_CAST_START of the owner's.
 *  - `kitRange` (new: kit cooldown): a loadout `Name [Ns` single value of a
 *    unit whose [RES] rows print that cooldown as a range (`Name(a–bs)`,
 *    the ledger's earliest–official reading) is wrong — the kit must print
 *    the same range.
 *  - `allyRefused` (round-1 retest idx 103): a `[YOU] [CD]   X → <pid>(` /
 *    `[TEAM] [CD]   <pid>(…): X → <pid>(` press on an ally whose caster
 *    logged an IMMUNE miss of X on that ally within 1 s of the press must
 *    carry an `[IMMUNE` tag.
 *  - `repressLength` (round-1 retest idx 55): an `[ENEMY DEF]   <pid>(…):
 *    X (…, N.Ns` self line whose caster REFRESHed X on itself inside (press
 *    + 1.5 s, press + N) beside its own cast of X (± 1.5 s) joins two
 *    presses into one length.
 *  - `invisAfterAction` (round-1 retest 62fdbf2e): a burst ledger `Target
 *    had a major defensive up: <unseen-end aura> active ON THE TARGET Ns`
 *    (Greater Invisibility, Vanish, Mass Invisibility, Burrow — the
 *    auras whose end the log does not show). N may not exceed the time from
 *    the aura's APPLIED (inside the burst, or the last before it) to the
 *    target's first damage after it, clipped to the burst (± 1 s).
 *
 *   npx tsx packages/eval/scripts/fact2Scan.ts <captureDir> [--examples N] [--archive-dir <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import {
  KW_IN_HAND_ONLY_DEFENSIVE_IDS,
  KW_MAJOR_DEFENSIVE_IDS,
  unpressedKitDefensiveInHand,
} from "@gladlog/analysis/src/data/abilityProfile";
import castEffectAuraGenerated from "@gladlog/analysis/src/data/castEffectAuraGenerated.json";
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import talentDurationTooltips from "@gladlog/analysis/src/data/talentDurationTooltipsGenerated.json";
import {
  CONTROL_FAILED_MISS_TYPES,
  isControlCast,
} from "@gladlog/analysis/src/utils/castMissRows";
import { AURA_BEFORE_CAST_ROW_MAX_MS } from "@gladlog/analysis/src/utils/castRowLag";
import {
  applicableCCAvoidanceIds,
  CC_AVOIDANCE_BUFF_SPELLS,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  cdAvailableAt,
  earliestCooldownSecondsFor,
  extractMajorCooldowns,
  isEnemyCdWindowSpell,
  PRESS_EFFECT_LEAD_MS,
  specToString,
  unitCooldownOf,
} from "@gladlog/analysis/src/utils/cooldowns";
import { MOVEMENT_ROOT_BREAK_DISPEL_IDS } from "@gladlog/analysis/src/utils/dispelKind";
import {
  isExternalSaveId,
  SELF_SAVE_IDS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { isDeferralAbsorb } from "@gladlog/analysis/src/utils/incomingPressure";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { talentRankOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { isDeadAt } from "@gladlog/analysis/src/utils/unitDeath";
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
  "killAnchorInto",
  "killTargetInside",
  "reflectedLine",
  "reflectSchool",
  "stateTick",
  "resOpener",
  "riderAsCleanse",
  "sorImmune",
  "areaWallPopped",
  "effectProvesUse",
  "exposureOnCd",
  "lockedShare",
  "friendlyBacklash",
  "aoeMissAvoided",
  "hardCastLanded",
  "periodicImmune",
  "hotPressHp",
  "fadedDebuff",
  "nonControlCount",
  "kickedHeldNote",
  "kitRange",
  "allyRefused",
  "repressLength",
  "invisAfterAction",
  "inHandRewind",
  "stackedDeferral",
  "racialPressedInside",
  "kitInHand",
  "riderShieldLine",
  "kitTooltipLasts",
  "ledgerRosterUp",
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
/** the names a kit line can print for a kill-window in-hand defensive
 * (user rulings 2026-10-20: the roster, Alter Time, unpressed kit rows) */
/** GH #155: the tooltip-stated extensions the 605 verification confirmed,
 * by the aura's English name (the loadout prints it) — read off the
 * GENERATED tooltip table, not the product's copy of it */
const TOOLTIP_CONFIRMED: Array<[string, string]> = [
  ["1215245", "200183"],
  ["1244460", "80240"],
  ["1272308", "453113"],
  ["238135", "17"],
  ["388832", "157736"],
  ["391370", "1249625"],
  ["440671", "139"],
  ["440671", "194384"],
  ["444099", "1233152"],
  ["450514", "450342"],
  ["457022", "31224"],
  ["458431", "119611"],
  ["458718", "19236"],
  ["468625", "197209"],
  ["443425", "79206"],
];
const tooltipLasts = new Map<
  string,
  Array<{ talent: string; specs: string[]; min: number; max: number }>
>();
for (const [talent, aura] of TOOLTIP_CONFIRMED) {
  for (const e of (talentDurationTooltips as { entries: any[] }).entries) {
    if (e.talentSpellId !== talent) continue;
    const t = e.targets.find((x: any) => x.spellIds.includes(aura));
    if (!t) continue;
    const base = t.baseSeconds[aura] as number;
    const min =
      e.kind === "per-event"
        ? base
        : e.unit === "pct"
          ? base * (1 + e.amount / 100)
          : base + e.amount;
    const max = e.kind === "per-event" ? base + (e.cap ?? 0) : min;
    const name = getEnglishSpellName(aura, "");
    const l = tooltipLasts.get(name) ?? [];
    l.push({ talent, specs: e.specs, min, max });
    tooltipLasts.set(name, l);
  }
}
const KW_IN_HAND_NAMES = new Set<string>();
for (const id of [
  ...KW_MAJOR_DEFENSIVE_IDS,
  ...KW_IN_HAND_ONLY_DEFENSIVE_IDS,
]) {
  if (!unpressedKitDefensiveInHand(id)) continue;
  const official = getEnglishSpellName(id, "");
  if (official) KW_IN_HAND_NAMES.add(official);
  for (const cls of classMetadata)
    for (const a of cls.abilities)
      if (a.spellId === id) KW_IN_HAND_NAMES.add(a.name);
}
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
  // a summon whose own reaction flag is unset (a Death Knight's Lesser Ghoul
  // logs 0) is its owner's
  for (const u of units)
    if (u.ownerId && ourSide.has(u.ownerId)) ourSide.add(u.id as string);
  const start = legacy.startTime;
  const where = `${f.shard}/${f.name}`;
  /** team-absorbed on the target over [fromS, toS) seconds */
  const absorbedOn = (target: any, fromS: number, toS: number): number =>
    ((target.absorbsIn ?? []) as any[])
      .filter((a) => a.attackerId && ourSide.has(a.attackerId))
      // a deferral shield's row is no absorb (FT-T02b) — the product's rule
      .filter((a) => !isDeferralAbsorb(a))
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
        (a) =>
          a.spellId === aura && a.srcUnitId === src && a.destUnitId === u.id,
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
    // fix-F16 (2026-10-21, user call on GH #91: the tag is read at the
    // press instant, legend and code agree): the line's second only bounds
    // the press, so a run must cover the whole second for the tag to be
    // owed
    if (!offensiveRuns.some(([a, b]) => a <= ms && ms + 1000 <= b)) continue;
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
    const target = byName.get(m[3]!) ?? byName.get(pidName.get(m[3]!) ?? "");
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
      if (
        !/healed through|not enough damage/.test(m[4]!) &&
        !m[4]!.includes(name)
      )
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
        .filter(
          (cd) => cd.responseOnly && OFFENSIVE_CD_SPELL_IDS.has(cd.spellId),
        )
        .map((cd) => ({ cd, f }));
    } catch {
      return [];
    }
  });
  for (const l of lines) {
    const m =
      /^ {2}\[(?:KILL WINDOW|VULNERABLE)\] .*team offensive CDs ready at (\d+:\d\d): ([^(;]*)/.exec(
        l,
      );
    if (!m) continue;
    const sec = secOf(m[1]!);
    for (const { cd, f } of pressOnly) {
      if (isDeadAt(f, start + sec * 1000)) continue;
      if (!cdAvailableAt(cd, sec)) continue;
      bump("pressOnlyReady");
      if (!m[2]!.includes(cd.spellName))
        miss(
          "pressOnlyReady",
          `${where} ${m[1]} ${f.name} ${cd.spellName}: "${m[2]!.trim().slice(0, 60)}"`,
        );
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
    if (!deathOf || !/^ +Mitigation audit: Blessing of Sacrifice /.test(l))
      continue;
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
      miss(
        "linkAuraAudit",
        `${where} ${unit.name} death ${fmtS(sec)}: audit lists its own Blessing link`,
      );
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
        if (
          !lines.some(
            (l) =>
              l.startsWith(`${t}  [ENEMY HEAL CD]`) &&
              l.includes(`${me}(`) &&
              l.includes("Ascendance"),
          )
        )
          miss(
            "rosterMajor",
            `${where} ${t} ${u.name} Ascendance: no [ENEMY HEAL CD]`,
          );
      }
      if (c.spellId === "88625" && u.name === ownerName) {
        bump("rosterMajor");
        if (
          !lines.some(
            (l) => l.includes("Counts:") && l.includes("Holy Word: Chastise"),
          )
        )
          miss(
            "rosterMajor",
            `${where} ${t} ${u.name} Chastise: not in CC USE`,
          );
      }
    }
  }
  // R2: Command Demon presses
  {
    const summons = units.filter(
      (x) => x.ownerId === owner.id && String(x.id).startsWith("Pet-"),
    );
    const nameOf = (e: any) =>
      getEnglishSpellName(e.spellId ?? "", e.spellName);
    const petRows = summons.flatMap((p: any) =>
      [...(p.castStartEvents ?? []), ...(p.spellCastEvents ?? [])].map(
        (e: any) => ({ p, e }),
      ),
    );
    const commanded = new Map<string, number>();
    for (const e of (owner.spellCastEvents ?? []) as any[]) {
      if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const n = nameOf(e);
      if (
        petRows.some(
          ({ e: r }) =>
            nameOf(r) === n &&
            Math.abs(r.logLine.timestamp - e.logLine.timestamp) <= 500,
        )
      )
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
      const m = new RegExp(
        `${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?:cast (\\d+)×|cast bar started \\d+×, went off (\\d+)×)`,
      ).exec(cl);
      if (!m) continue;
      bump("petCommandCount");
      const printed = Number(m[1] ?? m[2]);
      if (printed !== petOk)
        miss(
          "petCommandCount",
          `${where} ${n}: printed ${printed} (the owner's command rows ${ownerCount}), the pet's successes ${petOk}`,
        );
    }
  }
  // R6: a delayed control whose summon died before its window
  for (const u of players) {
    if (u.reaction === owner.reaction) continue;
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const opensS =
        c.spellId === "192058" ? 1.5 : c.spellId === "207684" ? 0.5 : null;
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
      if (bad)
        miss(
          "deadSummonAvoid",
          `${where} ${castT} ${u.name} ${name}: ${bad.slice(0, 120)}`,
        );
    }
  }
  // R8a: [BUFF FADED] estimated while the owner's copy is up
  for (const l of lines) {
    const fm =
      /^(\d+:\d\d) {2}\[BUFF FADED\] {3}(.+?) \(expired, estimated\)/.exec(l);
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
      miss(
        "fadedWhileUp",
        `${where} ${fm[1]} ${fm[2]}: owner's copy up until ${fmtS((nextOff.logLine.timestamp - start) / 1000)}`,
      );
  }
  // R8b: [CC REMOVED] held seconds across a server re-apply
  for (const l of lines) {
    const rm =
      /^(\d+:\d\d) {2}\[CC REMOVED\] .* removed (\d+)\([^)]*\)'s (.+?) from (\d+)\([^)]*\) after (\d+)s/.exec(
        l,
      );
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
      miss(
        "ccHeldRebroadcast",
        `${where} ${rm[1]} ${rm[3]}: printed after ${rm[5]}s, log ${held.toFixed(2)}s`,
      );
  }
  // R3: what the Medallion broke
  const trinketChecked = new Set<string>();
  for (const l of lines) {
    const em =
      /^(\d+:\d\d) {2}\[ENEMY TRINKET\] {3}(\d+)\([^)]*\) used PvP trinket out of (.+?) \(by /.exec(
        l,
      );
    const fm =
      /^\d+:\d\d {2}\[CC ON TEAM\] {3}(\d+)\(.*last used (\d+:\d\d) on (.+?)\)/.exec(
        l,
      );
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
    const ended = removals.some((r) =>
      presses.some((p) => Math.abs(r - p) <= 300),
    );
    const ranOn = removals.some(
      (r) => presses.every((p) => r > p + 1000) && r < presses[0]! + 60_000,
    );
    if (!ended && ranOn)
      miss(
        "trinketOutOf",
        `${where} ${at} ${unit.name}: bound to ${x}, which ran on past the press`,
      );
  }
  for (const l of lines) {
    const bm =
      /\[CC ON (?:TEAM|ENEMY)\] {3}(\d+)\(.*broken by (\d+)\([^)]*\)'s Time Dilation/.exec(
        l,
      );
    if (!bm) continue;
    bump("deferredBreaker");
    if (bm[1] === bm[2]) miss("deferredBreaker", `${where} ${l.slice(0, 120)}`);
  }
  for (const l of lines) {
    const mm =
      /^\d+:\d\d {2}\[MINOR DISPELS\] {3}(\d+)\([^)]*\)(?:'s \w+)?: (.*)$/.exec(
        l,
      );
    if (!mm || /'s (?:pet|guardian|totem)/.test(l.slice(0, 40))) continue;
    const unit = byName.get(pidName.get(mm[1]!) ?? "");
    if (!unit) continue;
    for (const pm of mm[2]!.matchAll(
      /(?:^|, )([^,(]+?) (?:×\d+ )?\(passive\)/g,
    )) {
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
      if (
        rows.every((r) =>
          presses.some((p) => Math.abs(p - r.logLine.timestamp) <= 50),
        )
      )
        miss(
          "riderPassive",
          `${where} ${unit.name} ${name} (passive), every removal with a press`,
        );
    }
  }
  for (const l of lines) {
    const km =
      /^ {2}\[(\d+:\d\d)–(\d+:\d\d)\] on (\S+) — (.+?) burst \(no stun\)/.exec(
        l,
      );
    if (!km) continue;
    const target = byName.get(km[3]!);
    if (!target) continue;
    const a = start + secOf(km[1]!) * 1000;
    const b = start + (secOf(km[2]!) + 1) * 1000;
    if (!km[4]!.includes("(cast into")) {
      const name = km[4]!;
      const hostile = (id: string | undefined) =>
        !!id && units.some((u) => u.id === id && u.reaction !== owner.reaction);
      // a buff / self cooldown (Power Infusion, Avatar …) goes into nobody:
      // only an opener whose cast row names a hostile unit is checked
      const castsOfName = ours.flatMap((f) =>
        ((f.spellCastEvents ?? []) as any[]).filter(
          (c) =>
            c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
            getEnglishSpellName(c.spellId ?? "", c.spellName) === name &&
            c.logLine.timestamp >= a - 1000 &&
            c.logLine.timestamp < b,
        ),
      );
      // (an aura-only occurrence — Demonic's Metamorphosis — has no cast row)
      if (!castsOfName.some((c) => hostile(c.destUnitId))) continue;
      bump("killAnchorInto");
      const into = ours.some(
        (f) =>
          ((f.spellCastEvents ?? []) as any[]).some(
            (c) =>
              c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              getEnglishSpellName(c.spellId ?? "", c.spellName) === name &&
              c.logLine.timestamp >= a - 1000 &&
              c.logLine.timestamp < b &&
              c.destUnitId === target.id,
          ) ||
          ((f.damageOut ?? []) as any[]).some(
            (d) =>
              d.destUnitId === target.id &&
              getEnglishSpellName(d.spellId ?? "", d.spellName) === name &&
              d.logLine.timestamp >= a - 1000 &&
              d.logLine.timestamp < b + 5000,
          ),
      );
      if (!into)
        miss(
          "killAnchorInto",
          `${where} ${km[1]} on ${target.name}: ${name} never went into it`,
        );
    }
    const byEnemy = new Map<string, number>();
    for (const f of ours)
      for (const d of (f.damageOut ?? []) as any[]) {
        const ts = d.logLine.timestamp;
        if (ts < a || ts >= b) continue;
        byEnemy.set(
          d.destUnitId,
          (byEnemy.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
        );
      }
    const top = [...byEnemy]
      .filter(([id]) =>
        units.find(
          (u) => u.id === id && u.reaction !== owner.reaction && u.info,
        ),
      )
      .sort((x, y) => y[1] - x[1])[0];
    if (!top || top[1] < 30_000) continue;
    // a one-second bracket (`[m:ss–m:ss]`, one press) holds no span to
    // measure on the grid: the line itself says `0.00M on target inside
    // it` and the target is the 5 s slack's
    if (km[1] === km[2]) continue;
    bump("killTargetInside");
    if (top[0] !== target.id && (byEnemy.get(target.id) ?? 0) < 0.8 * top[1])
      miss(
        "killTargetInside",
        `${where} ${km[1]}–${km[2]} on ${target.name}: inside the bracket ${Math.round((byEnemy.get(target.id) ?? 0) / 1000)}k vs ${byName.size ? units.find((u) => u.id === top[0])?.name : ""} ${Math.round(top[1] / 1000)}k`,
      );
  }
  // Spell Reflection 23920 returns
  for (const caster of players) {
    const cp = pidOf.get(caster.name);
    if (!cp) continue;
    for (const m of (caster.missesOut ?? []) as any[]) {
      if (m.missType !== "REFLECT" || !m.spellId) continue;
      const t0 = m.logLine.timestamp;
      if (t0 < start || t0 > legacy.endTime) continue;
      const reflector = units.find((u) => u.id === m.destUnitId);
      const rp = reflector && pidOf.get(reflector.name);
      if (!rp) continue;
      const back = ((caster.damageIn ?? []) as any[])
        .filter(
          (d) =>
            d.spellId === "23920" &&
            d.srcUnitId === reflector.id &&
            d.logLine.timestamp >= t0 - 500 &&
            d.logLine.timestamp <= t0 + 3000,
        )
        .reduce((x, d) => x + Math.abs(d.effectiveAmount), 0);
      const maxHp = Math.max(
        0,
        ...((caster.advancedActions ?? []) as any[]).map(
          (a) => a.advancedActorMaxHp ?? 0,
        ),
      );
      if (maxHp <= 0 || back < 0.05 * maxHp) continue;
      bump("reflectedLine");
      const t = fmtS((t0 - start) / 1000);
      // one reflector's returns can belong to a sibling reflect of the same
      // caster logged up to a few seconds later (a Searing Light and a
      // Penance 0.34 s apart, the return 1.5 s after both): a line for
      // either covers it
      // (or 1 s before: the line sits at the cast's second, the miss row
      // can be logged in the next — 145-5 1:10 / 1:11)
      const near = [-1, 0, 1, 2, 3].map((k) => fmtS((t0 - start) / 1000 + k));
      if (
        !lines.some(
          (l) =>
            near.some((nt) => l.startsWith(`${nt}  [REFLECTED]`)) &&
            l.includes(`${cp}(`) &&
            new RegExp(`reflected(?: ×\\d+)? by ${rp}\\(`).test(l),
        )
      )
        miss(
          "reflectedLine",
          `${where} ${t} ${caster.name}'s ${getEnglishSpellName(m.spellId, m.spellName)} by ${reflector.name}: ${Math.round(back / 1000)}k back, no line`,
        );
    }
  }
  {
    let deathUnit: any;
    let deathSec = 0;
    for (const l of lines) {
      const dm = /^(\d+:\d\d) {2}\[DEATH\] {2}(\d+)\(/.exec(l);
      if (dm) {
        deathUnit = byName.get(pidName.get(dm[2]!) ?? "");
        deathSec = secOf(dm[1]!);
        continue;
      }
      if (
        !deathUnit ||
        !/Top damage in final 10s:.*Spell Reflection \[Physical\]/.test(l)
      )
        continue;
      const rows = ((deathUnit.damageIn ?? []) as any[]).filter(
        (d) =>
          d.spellId === "23920" &&
          d.logLine.timestamp >= start + (deathSec - 10) * 1000 &&
          d.logLine.timestamp <= start + (deathSec + 1) * 1000,
      );
      if (rows.length === 0) continue;
      bump("reflectSchool");
      if (rows.every((d) => d.damageSchoolId && d.damageSchoolId !== "0x1"))
        miss(
          "reflectSchool",
          `${where} death ${fmtS(deathSec)} ${deathUnit.name}: Spell Reflection [Physical], tail schools ${[...new Set(rows.map((d) => d.damageSchoolId))].join("/")}`,
        );
    }
  }
  for (const l of lines) {
    const sm = /^(\d+:\d\d) {2}\[STATE\] {3}(.*)$/.exec(l);
    if (!sm) continue;
    const tMs = start + secOf(sm[1]!) * 1000;
    for (const pm of sm[2]!.matchAll(/(\d+)\([^)]*\):(\d+)/g)) {
      const unit = byName.get(pidName.get(pm[1]!) ?? "");
      if (!unit) continue;
      const acts = ((unit.advancedActions ?? []) as any[])
        .filter(
          (a) => a.advancedActorId === unit.id && a.advancedActorMaxHp > 0,
        )
        .sort((x, y) => x.logLine.timestamp - y.logLine.timestamp);
      let pick: any;
      for (const a of acts) if (a.logLine.timestamp <= tMs) pick = a;
      if (pick && tMs - pick.logLine.timestamp > 3000) pick = undefined;
      if (!pick)
        pick = acts.find(
          (a) => a.logLine.timestamp > tMs && a.logLine.timestamp - tMs <= 3000,
        );
      if (!pick) continue;
      bump("stateTick");
      const want = Math.min(
        100,
        Math.round(
          (pick.advancedActorCurrentHp / pick.advancedActorMaxHp) * 100,
        ),
      );
      if (Number(pm[2]) !== want)
        miss(
          "stateTick",
          `${where} ${sm[1]} ${unit.name}: printed ${pm[2]}, last reading at/before ${want}`,
        );
    }
  }
  {
    let lastT = "";
    const resRows: Array<{ t: string; row: string }> = [];
    for (const l of lines) {
      const tm = /^(\d+:\d\d) {2}/.exec(l);
      if (tm) lastT = tm[1]!;
      // a timeline row (under a `m:ss` line), not the legend's own `[RES]`
      const rm = /^ {6}\[RES\] (rdy:.*)$/.exec(l);
      if (rm && lastT) resRows.push({ t: lastT, row: rm[1]! });
    }
    const first = resRows[0];
    if (first && secOf(first.t || "9:59") <= 5) {
      bump("resOpener");
      if (
        /^rdy:— /.test(first.row) &&
        resRows[1] &&
        /^rdy:Δ \+/.test(resRows[1].row)
      )
        miss(
          "resOpener",
          `${where} ${first.t} ${first.row.slice(0, 60)} → ${resRows[1].t} ${resRows[1].row.slice(0, 50)}`,
        );
    }
  }
  {
    const riderNames = new Set(
      [...MOVEMENT_ROOT_BREAK_DISPEL_IDS].map((id) =>
        getEnglishSpellName(id, ""),
      ),
    );
    for (const l of lines) {
      const dm =
        /^\d+:\d\d {2}\[(?:ENEMY CLEANSE|PURGE|ENEMY PURGE)\] .* \(([^()]+)\)$/.exec(
          l,
        );
      if (!dm) continue;
      bump("riderAsCleanse");
      if (riderNames.has(dm[1]!))
        miss("riderAsCleanse", `${where} ${l.slice(0, 110)}`);
    }
  }
  for (const u of players) {
    if (u.reaction === owner.reaction) continue;
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (a.spellId !== "215769" || a.destUnitId !== u.id) continue;
      if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
      const ts = a.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const t = fmtS((ts - start) / 1000);
      bump("sorImmune");
      if (
        !lines.some(
          (l) =>
            l.startsWith(`${t}  [ENEMY DEF]   ${me}(`) &&
            /Spirit of Redemption \(immune/.test(l),
        )
      )
        miss(
          "sorImmune",
          `${where} ${t} ${u.name}: no [ENEMY DEF] immune line`,
        );
      for (const l of lines) {
        const km =
          /^ {2}\[(\d+:\d\d)–(\d+:\d\d)\] on (\S+) — .*not enough damage/.exec(
            l,
          );
        if (!km || km[3] !== u.name) continue;
        const from = start + secOf(km[1]!) * 1000;
        const to = start + (secOf(km[2]!) + 1 + 5) * 1000;
        if (ts >= from && ts < to) {
          bump("sorImmune");
          miss(
            "sorImmune",
            `${where} ${km[1]}–${km[2]} on ${u.name}: not enough damage, form at ${t}`,
          );
        }
      }
    }
  }
  // Darkness pressed by the attempt's own target
  for (const l of lines) {
    const km =
      /^ {2}\[(\d+:\d\d)–(\d+:\d\d)\] on (\S+) — .*\| (?:FAILED: )?(.*)$/.exec(
        l,
      );
    if (!km) continue;
    const target = byName.get(km[3]!);
    if (!target) continue;
    const from = start + secOf(km[1]!) * 1000;
    const to = start + (secOf(km[2]!) + 1) * 1000;
    const press = ((target.spellCastEvents ?? []) as any[]).find(
      (c) =>
        c.spellId === "196718" &&
        c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        c.logLine.timestamp >= from &&
        c.logLine.timestamp < to,
    );
    if (!press) continue;
    const ate = ((target.absorbsIn ?? []) as any[]).some(
      (a) =>
        a.spellId === "209426" &&
        a.logLine.timestamp >= press.logLine.timestamp &&
        a.logLine.timestamp <= to + 5000,
    );
    if (!ate) continue;
    bump("areaWallPopped");
    if (/^(healed through|not enough damage)/.test(km[4]!))
      miss(
        "areaWallPopped",
        `${where} ${km[1]}–${km[2]} on ${target.name}: ${km[4]!.slice(0, 40)} with its own Darkness`,
      );
  }
  // a cooldown whose own effect proves a press the round has no row of
  {
    const casts = (castEffectAuraGenerated as any).casts as Record<
      string,
      any[]
    >;
    let cur: any;
    for (const l of lines) {
      const um = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
      if (um) cur = byName.get(um[2]!);
      if (!cur || !l.includes("<cooldowns>")) continue;
      for (const m of l.matchAll(
        /(?:<cooldowns>|, )([^,<[]+?) \[[^\]]*\](?: \[[^\]]*\])* ?\[UNUSED\]/g,
      )) {
        const name = m[1]!.trim();
        for (const [cast, rows] of Object.entries(casts)) {
          if (getEnglishSpellName(cast, "") !== name) continue;
          if (
            ((cur.spellCastEvents ?? []) as any[]).some(
              (c) =>
                c.spellId === cast &&
                c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
                c.logLine.timestamp >= start &&
                c.logLine.timestamp <= legacy.endTime,
            )
          )
            continue;
          const effects = rows
            .filter(
              (r) =>
                r.aura !== cast &&
                r.via?.includes("name") &&
                r.hits >= 0.5 * r.casts,
            )
            .map((r) => r.aura);
          if (effects.length === 0) continue;
          // the unit's own applications only: a summon can cast the same
          // spell itself (a Rider of the Apocalypse's Anti-Magic Shell on
          // its Death Knight is no press of the Death Knight's)
          const src = new Set([cur.id]);
          const seen = units.some((u) =>
            ((u.auraEvents ?? []) as any[]).some(
              (a) =>
                a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
                effects.includes(a.spellId) &&
                src.has(a.srcUnitId) &&
                a.logLine.timestamp >= start &&
                a.logLine.timestamp <= legacy.endTime,
            ),
          );
          bump("effectProvesUse");
          if (seen)
            miss(
              "effectProvesUse",
              `${where} ${cur.name} ${name} [UNUSED] but its effect went out`,
            );
        }
      }
    }
  }
  // enemy controls the exposure list names while they are on cooldown
  {
    const enemies = units.filter(
      (u) => u.type === 1 && u.reaction !== owner.reaction,
    );
    const enemyOfRef = (ref: string): any => {
      const named = /^(.*) \(([^)]+)\)$/.exec(ref);
      if (named)
        return (
          byName.get(named[2]!) ?? byName.get(pidName.get(named[2]!) ?? "")
        );
      const bySpec = enemies.filter((u) => specToString(u.spec) === ref);
      return bySpec.length === 1 ? bySpec[0] : undefined;
    };
    for (const l of lines) {
      const em =
        /^(\d+:\d\d) {2}\[HEALER EXPOSURE\] .*? \| IN LoS: (.*?)(?: \| |$)/.exec(
          l,
        );
      if (!em) continue;
      const tMs = start + secOf(em[1]!) * 1000;
      for (const group of em[2]!.split("; ")) {
        const gi = group.indexOf(": ");
        const enemy = enemyOfRef(group.slice(0, gi));
        if (!enemy) continue;
        for (const item of group.slice(gi + 2).split(", ")) {
          const name = item.replace(/ (?:Full|50%) DR$/, "");
          const presses = ((enemy.spellCastEvents ?? []) as any[]).filter(
            (c) =>
              c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              c.logLine.timestamp < tMs &&
              (getEnglishSpellName(c.spellId, "") === name ||
                (OWN_SPLIT.get(c.spellId) ?? []).some(
                  (a) => getEnglishSpellName(a, "") === name,
                )),
          );
          const last = presses.at(-1);
          if (!last) continue;
          const cd = unitCooldownOf(enemy, last.spellId);
          if (
            !cd ||
            !cd.talentsKnown ||
            cd.charges !== 1 ||
            !(cd.cooldownSeconds > 0)
          )
            continue;
          // the press is matched by name: a different id of the same name
          // (Chastise's cast and its stun) reads the press's own cooldown
          bump("exposureOnCd");
          const certainS =
            earliestCooldownSecondsFor(
              last.spellId,
              enemy.spec,
              cd.cooldownSeconds,
            ) ?? cd.cooldownSeconds;
          if (last.logLine.timestamp + certainS * 1000 > tMs)
            miss(
              "exposureOnCd",
              `${where} ${em[1]} ${enemy.name} ${name}: pressed ${fmtS((last.logLine.timestamp - start) / 1000)}, cd ${cd.cooldownSeconds}s`,
            );
        }
      }
    }
  }
  for (const u of units) {
    if (u.reaction !== owner.reaction || u.type !== 1) continue;
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (a.spellId !== "87204" && a.spellId !== "196364") continue;
      if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
      if (!ourSide.has(a.srcUnitId) || a.srcUnitId === u.id) continue;
      const ts = a.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const t = fmtS((ts - start) / 1000);
      const name = getEnglishSpellName(a.spellId, "");
      bump("friendlyBacklash");
      // a silence backlash (196364) is a [SILENCE] line since fact3 D30
      // (2026-10-21); the horror (87204) stays [CC ON TEAM]
      const tag = a.spellId === "196364" ? "[SILENCE]" : "[CC ON TEAM]";
      if (
        !lines.some(
          (l) =>
            l.startsWith(`${t}  ${tag}   ${me}(`) && l.includes(`← ${name} `),
        )
      )
        miss(
          "friendlyBacklash",
          `${where} ${t} ${u.name}: ${name} from a teammate, no ${tag}`,
        );
    }
  }
  for (const u of units) {
    if (u.reaction !== owner.reaction || u.type !== 1) continue;
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const m of (u.missesIn ?? []) as any[]) {
      if (!m.spellId || !CONTROL_FAILED_MISS_TYPES.has(m.missType)) continue;
      if (!isControlCast(m.spellId)) continue;
      const src = units.find((x) => x.id === m.srcUnitId);
      if (!src || src.reaction === owner.reaction) continue;
      const cast = ((src.spellCastEvents ?? []) as any[]).find(
        (c) =>
          c.spellId === m.spellId &&
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.logLine.timestamp <= m.timestamp &&
          c.logLine.timestamp >= m.timestamp - 1000,
      );
      if (!cast || (cast.destUnitId && cast.destUnitId !== "0000000000000000"))
        continue;
      if (m.timestamp < start || m.timestamp > legacy.endTime) continue;
      const name = getEnglishSpellName(m.spellId, "");
      // a buff-kind avoidance (the miss row proves the control reached the
      // player, so a reposition explains nothing — Spirit Walk pressed 7 s
      // earlier is no immunity to a Shadowfury)
      const ok = new Set(
        [...applicableCCAvoidanceIds(m.spellId, name)].filter((id) =>
          CC_AVOIDANCE_BUFF_SPELLS.has(id),
        ),
      );
      const up = ((u.auraEvents ?? []) as any[]).some((a) => {
        if (
          !ok.has(a.spellId) ||
          a.logLine.event !== LogEvent.SPELL_AURA_APPLIED
        )
          return false;
        if (a.logLine.timestamp > m.timestamp) return false;
        return !((u.auraEvents ?? []) as any[]).some(
          (r) =>
            r.spellId === a.spellId &&
            r.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
            r.logLine.timestamp >= a.logLine.timestamp &&
            r.logLine.timestamp < m.timestamp,
        );
      });
      if (!up) continue;
      const t = fmtS((m.timestamp - start) / 1000);
      bump("aoeMissAvoided");
      if (
        !lines.some(
          (l) =>
            l.startsWith(`${t}  [CC AVOIDED?]   ${me}(`) &&
            l.includes(`: ${name} (by `),
        )
      )
        miss(
          "aoeMissAvoided",
          `${where} ${t} ${u.name}: ${name} ${m.missType}, no [CC AVOIDED?]`,
        );
    }
  }
  {
    const nameOf = (id: string) => getEnglishSpellName(id, "");
    const isOf = (id: string, name: string) =>
      nameOf(id) === name ||
      (OWN_SPLIT.get(id) ?? []).some((a) => nameOf(a) === name);
    const succOf = (u: any, name: string, fromMs: number, toMs: number) =>
      ((u.spellCastEvents ?? []) as any[]).find(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.logLine.timestamp >= fromMs &&
          c.logLine.timestamp < toMs &&
          nameOf(c.spellId) === name,
      );
    for (const l of lines) {
      // [ENEMY HARD CAST]
      const hm =
        /^(\d+:\d\d) {2}\[ENEMY HARD CAST\] {3}(\d+)\([^)]*\): (.+?)(?: → [^ ]+)? \((\d+\.\d)s cast, (landed|went off[^)]*)\)/.exec(
          l,
        );
      if (hm) {
        const caster = byName.get(pidName.get(hm[2]!) ?? "");
        const t = start + secOf(hm[1]!) * 1000;
        // the bar started inside the line's second and ran the printed
        // length: its SUCCESS sits in [t + cast, t + 1 + cast] (± rounding)
        const castMs = Number(hm[4]) * 1000;
        const succ =
          caster &&
          succOf(caster, hm[3]!, t + castMs - 100, t + 1000 + castMs + 100);
        if (succ) {
          const sMs = succ.logLine.timestamp;
          const dest = succ.destUnitId;
          // only an unambiguous completion is judged: another completion of
          // the spell at that target within 2.5 s either side makes the
          // pairing of hits to throws a choice, not a reading
          const crowded = ((caster.spellCastEvents ?? []) as any[]).some(
            (c) =>
              c !== succ &&
              c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              c.spellId === succ.spellId &&
              c.destUnitId === dest &&
              Math.abs(c.logLine.timestamp - sMs) <= 2500,
          );
          const inR = (ms: number) => ms >= sMs && ms <= sMs + 2500;
          const hit =
            ((caster.damageOut ?? []) as any[]).some(
              (d) =>
                d.spellId === succ.spellId &&
                d.destUnitId === dest &&
                inR(d.logLine.timestamp),
            ) ||
            ((units.find((u) => u.id === dest)?.absorbsIn ?? []) as any[]).some(
              (a) =>
                a.attackerId === caster.id &&
                a.attackSpellId === succ.spellId &&
                inR(a.timestamp),
            );
          if (crowded) continue;
          bump("hardCastLanded");
          if (hit !== (hm[5] === "landed"))
            miss(
              "hardCastLanded",
              `${where} ${hm[1]} ${caster.name} ${hm[3]}: printed ${hm[5]}, log ${hit ? "hit" : "no hit"}`,
            );
        }
      }
      // [IMMUNE on a press line
      const im =
        /^(\d+:\d\d) {2}\[(YOU|TEAM)\] \[[A-Z]+\] {3}(?:(\d+)\([^)]*\)(?: \([^)]*\))?: )?(.+?)(?: →| \(| \[)[^\n]*\[IMMUNE/.exec(
          l,
        );
      if (im) {
        const caster =
          im[2] === "YOU" ? owner : byName.get(pidName.get(im[3] ?? "") ?? "");
        const t = start + secOf(im[1]!) * 1000;
        const succ = caster && succOf(caster, im[4]!, t, t + 1000);
        if (succ) {
          const rows = ((caster.missesOut ?? []) as any[]).filter(
            (m) =>
              m.missType === "IMMUNE" &&
              m.spellId &&
              isOf(m.spellId, im[4]!) &&
              m.timestamp >= succ.logLine.timestamp - 100 &&
              m.timestamp <= succ.logLine.timestamp + 3000,
          );
          if (rows.length > 0) {
            bump("periodicImmune");
            if (
              rows.every(
                (m) => m.logLine?.event === LogEvent.SPELL_PERIODIC_MISSED,
              )
            )
              miss(
                "periodicImmune",
                `${where} ${im[1]} ${caster.name} ${im[4]}: only DoT ticks were IMMUNE`,
              );
          }
        }
      }
      // press HP under the press's own first heal
      const pm =
        /^(\d+:\d\d) {2}\[YOU\] \[CD\] {3}(.+?) \(self: (\d+)% HP/.exec(l);
      if (pm) {
        const t = start + secOf(pm[1]!) * 1000;
        const succ = succOf(owner, pm[2]!, t, t + 1000);
        if (succ) {
          const sMs = succ.logLine.timestamp;
          // the product's lead (`hpAtPress`): a direct heal within
          // PRESS_EFFECT_LEAD_MS of the cast row; a HoT's first tick riding
          // its own fresh APPLIED / REFRESH up to AURA_BEFORE_CAST_ROW_MAX_MS
          // ahead of it (fact2-retest idx 6: 55 ms)
          const freshAuraBy = (h: any) =>
            ((owner.auraEvents ?? []) as any[]).some(
              (a) =>
                a.spellId === h.spellId &&
                a.srcUnitId === owner.id &&
                (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
                  a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
                a.logLine.timestamp <= h.logLine.timestamp &&
                a.logLine.timestamp >= sMs - AURA_BEFORE_CAST_ROW_MAX_MS,
            );
          const heals = ((owner.healIn ?? []) as any[]).filter((h) => {
            if (h.srcUnitId !== owner.id || !h.spellId) return false;
            if (!isOf(h.spellId, pm[2]!)) return false;
            const d = h.logLine.timestamp - sMs;
            if (d > 50) return false;
            return h.logLine.event === LogEvent.SPELL_PERIODIC_HEAL
              ? d >= -AURA_BEFORE_CAST_ROW_MAX_MS && freshAuraBy(h)
              : d >= -PRESS_EFFECT_LEAD_MS;
          });
          if (heals.length > 0) {
            const hMs = Math.min(...heals.map((h) => h.logLine.timestamp));
            const acts = ((owner.advancedActions ?? []) as any[])
              .filter(
                (a) =>
                  a.advancedActorId === owner.id &&
                  a.advancedActorMaxHp > 0 &&
                  a.logLine.timestamp < hMs,
              )
              .sort((x, y) => x.logLine.timestamp - y.logLine.timestamp);
            const before = acts.at(-1);
            if (before) {
              const want =
                (before.advancedActorCurrentHp / before.advancedActorMaxHp) *
                100;
              bump("hotPressHp");
              if (Math.abs(Number(pm[3]) - want) > 1.5)
                miss(
                  "hotPressHp",
                  `${where} ${pm[1]} ${pm[2]}: printed ${pm[3]}%, before its heal ${want.toFixed(1)}%`,
                );
            }
          }
        }
      }
      // [BUFF FADED] of a reflected control
      const fm = /^(\d+:\d\d) {2}\[BUFF FADED\] {3}(.+?) \(/.exec(l);
      if (fm) {
        const rows = ((owner.auraEvents ?? []) as any[]).filter(
          (a) =>
            a.srcUnitId === owner.id && a.spellId && isOf(a.spellId, fm[2]!),
        );
        if (rows.some((a) => a.auraType === "DEBUFF")) {
          bump("fadedDebuff");
          if (rows.every((a) => a.auraType === "DEBUFF"))
            miss(
              "fadedDebuff",
              `${where} ${fm[1]} ${fm[2]}: the owner's only rows are its own DEBUFF`,
            );
        }
      }
      // CC USE Counts
      const cm = /^\s*Counts: (.*)$/.exec(l);
      if (cm) {
        for (const part of cm[1]!.split(" · ")) {
          const name = /^(.+?) cast /.exec(part)?.[1];
          if (!name) continue;
          const presses = ((owner.spellCastEvents ?? []) as any[]).filter(
            (c) =>
              c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              nameOf(c.spellId) === name,
          );
          if (presses.length === 0) continue;
          const ids = new Set(
            presses.flatMap((c) => [
              c.spellId,
              ...(OWN_SPLIT.get(c.spellId) ?? []),
            ]),
          );
          let ours = 0;
          let theirs = 0;
          for (const u of units)
            for (const a of (u.auraEvents ?? []) as any[]) {
              if (a.srcUnitId !== owner.id || !ids.has(a.spellId)) continue;
              if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
              if (u.reaction === owner.reaction) ours++;
              else theirs++;
            }
          if (ours + theirs === 0) continue;
          bump("nonControlCount");
          if (theirs === 0)
            miss(
              "nonControlCount",
              `${where} ${name}: ${ours} applications, all on the owner's side`,
            );
        }
      }
      // the low-pressure NOTE
      const nm =
        /never-used self-only defensive cooldowns \((.+?)\) were correctly HELD/.exec(
          l,
        );
      if (nm) {
        for (const name of nm[1]!.split(", ")) {
          bump("kickedHeldNote");
          const started = ((owner.castStartEvents ?? []) as any[]).some(
            (c) =>
              nameOf(c.spellId) === name &&
              c.logLine.timestamp >= start &&
              c.logLine.timestamp <= legacy.endTime,
          );
          if (started)
            miss("kickedHeldNote", `${where} ${name}: a cast bar was started`);
        }
      }
    }
    for (const l of lines) {
      const am =
        /^(\d+:\d\d) {2}\[(YOU|TEAM)\] \[CD\] {3}(?:(\d+)\([^)]*\) \([^)]*\): )?(.+?) → (\d+)\(/.exec(
          l,
        );
      if (!am) continue;
      const caster =
        am[2] === "YOU" ? owner : byName.get(pidName.get(am[3] ?? "") ?? "");
      const ally = byName.get(pidName.get(am[5]!) ?? "");
      if (!caster || !ally || ally.reaction !== owner.reaction) continue;
      const t = start + secOf(am[1]!) * 1000;
      const succ = succOf(caster, am[4]!, t, t + 1000);
      if (!succ) continue;
      const refused = ((caster.missesOut ?? []) as any[]).some(
        (m) =>
          m.missType === "IMMUNE" &&
          m.destUnitId === ally.id &&
          m.spellId &&
          isOf(m.spellId, am[4]!) &&
          m.timestamp >= succ.logLine.timestamp - 100 &&
          m.timestamp <= succ.logLine.timestamp + 1000,
      );
      if (!refused) continue;
      bump("allyRefused");
      if (!l.includes("[IMMUNE"))
        miss(
          "allyRefused",
          `${where} ${am[1]} ${caster.name} ${am[4]} → ${ally.name}: IMMUNE row, no tag`,
        );
    }
    for (const l of lines) {
      const dm =
        /^(\d+:\d\d) {2}\[ENEMY DEF\] {3}(\d+)\([^)]*\) \([^)]*\): ([^(→]+?) \([^)]*?(\d+\.\d)s/.exec(
          l,
        );
      if (!dm) continue;
      const caster = byName.get(pidName.get(dm[2]!) ?? "");
      if (!caster) continue;
      const t = start + secOf(dm[1]!) * 1000;
      // the press in the line's own second first (an aura line sits at the
      // aura's second; a press 1.5 s earlier is another line's — 129-5 1:31
      // and 1:33 are two Ice Barrier presses)
      const succ =
        succOf(caster, dm[3]!.trim(), t, t + 1000) ??
        succOf(caster, dm[3]!.trim(), t - 1500, t);
      if (!succ) continue;
      const pMs = succ.logLine.timestamp;
      const endMs = pMs + Number(dm[4]) * 1000;
      const refreshed = ((caster.auraEvents ?? []) as any[]).some(
        (a) =>
          a.srcUnitId === caster.id &&
          a.destUnitId === caster.id &&
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH &&
          a.spellId &&
          isOf(a.spellId, dm[3]!.trim()) &&
          a.timestamp > pMs + 1500 &&
          a.timestamp < endMs - 100 &&
          ((caster.spellCastEvents ?? []) as any[]).some(
            (c) =>
              c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              c.spellId === succ.spellId &&
              Math.abs(c.logLine.timestamp - a.timestamp) <= 1500,
          ),
      );
      bump("repressLength");
      if (refreshed)
        miss(
          "repressLength",
          `${where} ${dm[1]} ${caster.name} ${dm[3]!.trim()} ${dm[4]}s spans a re-press`,
        );
    }
    {
      let bFrom = 0;
      let bTo = 0;
      let tgt: any;
      for (const l of lines) {
        const bm = /^ {2}Burst #\d+ — (\d+:\d\d)–(\d+:\d\d)/.exec(l);
        if (bm) {
          bFrom = start + secOf(bm[1]!) * 1000;
          bTo = start + (secOf(bm[2]!) + 1) * 1000;
        }
        const tm = /^ {4}Target: (\S+) /.exec(l);
        if (tm) tgt = byName.get(tm[1]!);
        const im =
          /Target had a major defensive up: (Greater Invisibility|Vanish|Mass Invisibility|Burrow) active ON THE TARGET (\d+\.\d)s of this burst \((already up|pressed (\d+\.\d)s after)/.exec(
            l,
          );
        if (!im || !tgt) continue;
        const applies = ((tgt.auraEvents ?? []) as any[])
          .filter(
            (a) =>
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
              getEnglishSpellName(a.spellId, "") === im[1],
          )
          .map((a) => a.timestamp as number);
        const apply =
          im[3] === "already up"
            ? applies.filter((t) => t <= bFrom).at(-1)
            : applies.find(
                (t) => Math.abs(t - (bFrom + Number(im[4]) * 1000)) <= 1500,
              );
        if (apply === undefined) continue;
        const firstHit = ((tgt.damageOut ?? []) as any[])
          .map((d) => d.logLine.timestamp as number)
          .filter((t) => t > apply)
          .sort((a, b) => a - b)[0];
        const end = Math.min(firstHit ?? Infinity, bTo);
        const maxS = Math.max(0, (end - Math.max(apply, bFrom)) / 1000);
        bump("invisAfterAction");
        if (Number(im[2]) > maxS + 1)
          miss(
            "invisAfterAction",
            `${where} ${tgt.name} ${im[1]} ${im[2]}s, holder acted after ${maxS.toFixed(1)}s`,
          );
      }
    }
    // loadout single-value cooldowns vs the [RES] rows' own range for them
    const ranged = new Set<string>();
    for (const l of lines) {
      if (!/^ {6}\[RES\]/.test(l)) continue;
      const cdPart = / cd:(\S+)/.exec(l)?.[1];
      if (!cdPart) continue;
      for (const e of cdPart.split(",")) {
        const rm = /^(?:(\d+):)?(.+?)\(\d+–\d+s\)/.exec(e);
        if (rm) ranged.add(`${rm[1] ?? "1"}|${rm[2]}`);
      }
    }
    let curPid = "";
    for (const l of lines) {
      const um = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
      if (um) curPid = um[1]!;
      if (!curPid || !l.includes("<cooldowns>")) continue;
      for (const m of l.matchAll(
        /(?:<cooldowns>|, )([^,<[]+?) \[(\d+(?:–\d+)?)s/g,
      )) {
        const name = m[1]!.trim();
        if (!ranged.has(`${curPid}|${name}`)) continue;
        bump("kitRange");
        if (!m[2]!.includes("–"))
          miss(
            "kitRange",
            `${where} ${curPid}:${name} [${m[2]}s] while [RES] prints a range`,
          );
      }
    }
  }
  for (const l of lines) {
    for (const m of l.matchAll(/CC'd\/locked out([^—;|)]*)/g)) {
      bump("lockedShare");
      if (!/^ for \d+\.\ds of it\s*$/.test(m[1]!))
        miss("lockedShare", `${where} ${l.trim().slice(0, 100)}`);
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
    if (
      !ledgerTarget ||
      ["1467", "1468", "1473"].includes(String(ledgerTarget.spec))
    )
      continue;
    bump("ledgerCopyLabel");
    if (l.includes("Target had a major defensive up"))
      miss(
        "ledgerCopyLabel",
        `${where} ${ledgerTarget.name}: ${l.trim().slice(0, 90)}`,
      );
  }
  // user ruling 2026-10-20: a ready Alter Time is a major defensive in hand.
  // The target's press inside a `defenseless` span (not at its opening
  // second, not at its closing one) proves it was in hand inside the span.
  for (const l of lines) {
    const head =
      /^ {2}\[(?:KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+\(([^)]+)\)/.exec(
        l,
      );
    if (!head) continue;
    const target =
      byName.get(head[3]!) ?? byName.get(pidName.get(head[3]!) ?? "");
    if (!target || !/Mage/.test(l)) continue;
    const span = /\bdefenseless (\d+:\d\d)–(\d+:\d\d)/.exec(l) ?? head;
    const a = secOf(span[1]!);
    const b = secOf(span[2]!);
    bump("inHandRewind");
    const press = ((target.spellCastEvents ?? []) as any[]).find((c) => {
      if (
        c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS ||
        c.spellId !== "342245"
      )
        return false;
      const s = Math.floor((c.logLine.timestamp - start) / 1000);
      return s > a && s < b;
    });
    if (press)
      miss(
        "inHandRewind",
        `${where} ${span[1]}–${span[2]} ${target.name}: Alter Time pressed at ${Math.floor((press.logLine.timestamp - start) / 1000)}s inside`,
      );
  }
  // user ruling 2026-10-20: racial damage buffs and Ultimate Penitence are
  // offensive cooldowns — a friendly press strictly inside a [KILL WINDOW]
  // (not its first or last second) is named under `pressed inside`
  const RULED_OFFENSIVE = new Map([
    ["20572", "Blood Fury"],
    ["33697", "Blood Fury"],
    ["33702", "Blood Fury"],
    ["26297", "Berserking"],
    ["274738", "Ancestral Call"],
    ["421453", "Ultimate Penitence"],
  ]);
  for (const l of lines) {
    const m = /^ {2}\[KILL WINDOW\] (\d+:\d\d)–(\d+:\d\d) on /.exec(l);
    if (!m) continue;
    const a = secOf(m[1]!);
    const b = secOf(m[2]!);
    for (const p of ours)
      for (const c of (p.spellCastEvents ?? []) as any[]) {
        const name = RULED_OFFENSIVE.get(c.spellId);
        if (!name || c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
        const sec = Math.floor((c.logLine.timestamp - start) / 1000);
        if (sec <= a || sec >= b) continue;
        bump("racialPressedInside");
        const inside = /pressed inside: ([^)]*)\)/.exec(l)?.[1] ?? "";
        if (!inside.includes(name))
          miss(
            "racialPressedInside",
            `${where} ${m[1]}–${m[2]}: ${p.name} ${name} at ${sec}s not under pressed inside`,
          );
      }
  }
  // user ruling 2026-10-20 (idx 60): a roster defensive the kit tags
  // [UNUSED] is in hand all round — no `defenseless` span on that unit
  const kitOf = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const u = /<unit id="\d+" name="([^"]+)"/.exec(lines[i]!);
    if (u && lines[i + 1]?.includes("<cooldowns>"))
      kitOf.set(u[1]!, lines[i + 1]!);
  }
  for (const l of lines) {
    const m =
      /^ {2}\[(?:KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+\(([^)]+)\)/.exec(
        l,
      );
    if (!m) continue;
    const name = pidName.get(m[3]!) ?? m[3]!;
    const kit = kitOf.get(name);
    if (!kit) continue;
    bump("kitInHand");
    const held = [
      ...kit.matchAll(
        /(?:<cooldowns>|, )([^,[<]+?) \[[^\]]*\](?: \[[^\]]*\])* \[UNUSED\]/g,
      ),
    ]
      .map((x) => x[1]!.trim())
      .filter((n) => KW_IN_HAND_NAMES.has(n));
    if (held.length > 0)
      miss(
        "kitInHand",
        `${where} ${m[1]}–${m[2]} ${name}: kit holds ${held.join("/")} [UNUSED]`,
      );
  }
  // GH #155: a loadout's `lasts Ns` for a holder of a tooltip-stated,
  // corpus-confirmed duration talent is what the tooltip says
  for (let i = 0; i < lines.length; i++) {
    const u = /<unit id="\d+" name="([^"]+)"/.exec(lines[i]!);
    const kit = lines[i + 1];
    if (!u || !kit?.includes("<cooldowns>")) continue;
    const unit = byName.get(u[1]!);
    if (!unit) continue;
    for (const m of kit.matchAll(
      /(?:<cooldowns>|, )([^,[<]+?) \[[^\]]*?lasts ([\d.]+)(?:–([\d.]+))?s\]/g,
    )) {
      for (const r of tooltipLasts.get(m[1]!.trim()) ?? []) {
        if (!r.specs.includes(String(unit.spec))) continue;
        if (talentRankOf(unit, r.talent) <= 0) continue;
        bump("kitTooltipLasts");
        const lo = Number(m[2]);
        const hi = m[3] ? Number(m[3]) : lo;
        if (Math.abs(lo - r.min) > 0.05 || Math.abs(hi - r.max) > 0.05)
          miss(
            "kitTooltipLasts",
            `${where} ${u[1]} ${m[1]!.trim()}: printed lasts ${m[2]}${m[3] ? `–${m[3]}` : ""}s, the tooltip ${r.min}${r.max > r.min ? `–${r.max}` : ""}s (${r.talent})`,
          );
      }
    }
  }
  // user ruling 2026-10-20 (idx 22): every Shield of Vengeance on an enemy
  // gets its own [ENEMY DEF] line at its second
  for (const u of players) {
    if (ourSide.has(u.id)) continue;
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (
        a.spellId !== "184662" ||
        a.logLine.event !== LogEvent.SPELL_AURA_APPLIED
      )
        continue;
      const sec = Math.floor((a.logLine.timestamp - start) / 1000);
      if (sec < 0 || a.logLine.timestamp >= (legacy as any).endTime) continue;
      bump("riderShieldLine");
      const stamp = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      // a re-application inside a printed one is that line's (the aura
      // join, `joinReappliedIntervals`): `(absorb Nk, T.Ts` covers it
      const covered = lines.some((l) => {
        const m =
          /^(\d+):(\d\d) {2}\[ENEMY DEF\].*Shield of Vengeance \(absorb[^,]*, (\d+(?:\.\d)?)s/.exec(
            l,
          );
        if (!m) return false;
        const at = Number(m[1]) * 60 + Number(m[2]);
        return at === sec || (at <= sec && sec <= at + Number(m[3]));
      });
      if (!covered)
        miss(
          "riderShieldLine",
          `${where} ${stamp} ${u.name}: no [ENEMY DEF] Shield of Vengeance line`,
        );
    }
  }
  // user ruling 2026-10-20 (idx 45 / 48): the burst ledger names Retribution's
  // Divine Protection, Survival of the Fittest and Dark Pact when they were
  // up on the burst target for at least 0.5 s of the burst
  {
    const ROSTER_UP = new Map([
      ["403876", "Divine Protection"],
      ["264735", "Survival of the Fittest"],
      ["108416", "Dark Pact"],
    ]);
    let burst: [number, number] | undefined;
    let tgt: any;
    let named = "";
    const flush = () => {
      if (!burst || !tgt) return;
      for (const [id, nm] of ROSTER_UP) {
        const evs = ((tgt.auraEvents ?? []) as any[]).filter(
          (a) => a.spellId === id,
        );
        let overlap = 0;
        for (const a of evs) {
          if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
          const rm = evs.find(
            (r) =>
              r.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
              r.logLine.timestamp >= a.logLine.timestamp,
          );
          const from = (a.logLine.timestamp - start) / 1000;
          const to = rm ? (rm.logLine.timestamp - start) / 1000 : from;
          overlap += Math.max(
            0,
            Math.min(to, burst[1] + 1) - Math.max(from, burst[0] + 1),
          );
        }
        if (overlap < 1.5) continue; // well clear of the 0.5 s floor on the grid
        bump("ledgerRosterUp");
        if (!named.includes(nm))
          miss(
            "ledgerRosterUp",
            `${where} burst ${burst[0]}–${burst[1]} ${tgt.name}: ${nm} up ${overlap.toFixed(1)}s, not named`,
          );
      }
    };
    for (const l of lines) {
      const b = /^ {2}Burst #\d+ — (\d+:\d\d)–(\d+:\d\d)/.exec(l);
      if (b) {
        flush();
        burst = [secOf(b[1]!), secOf(b[2]!)];
        tgt = undefined;
        named = "";
        continue;
      }
      const t = /^ {4}Target: (\S+) /.exec(l);
      if (t && burst && !tgt) tgt = byName.get(t[1]!);
      if (/^ {4}Target had /.test(l)) named += l;
      if (/^\S/.test(l)) {
        flush();
        burst = undefined;
      }
    }
    flush();
  }
  // [STACKED DEFENSIVES] whose later aura is a deferral shield: the printed
  // overlap share is what the log records it held back (its own absorb rows)
  for (const l of lines) {
    const m =
      /\[STACKED DEFENSIVES\] +(.+?) (?:\(you\) )?had .* up together (\d+:\d\d)–(\d+:\d\d).*the later one, (Time Dilation|Stretch Time), (?:blocked|held back) ~(\d+)%/.exec(
        l,
      );
    if (!m) continue;
    const who = m[1]!.replace(/ \(you\)$/, "");
    const pid = /^(\d+)\(/.exec(who)?.[1];
    const target = byName.get(pid ? (pidName.get(pid) ?? "") : who);
    if (!target) continue;
    const a = secOf(m[2]!);
    const b = secOf(m[3]!);
    const shield = m[4] === "Time Dilation" ? "357170" : "410355";
    const maxHp = Math.max(
      1,
      ...((target.advancedActions ?? []) as any[]).map(
        (x) => x.advancedActorMaxHp ?? 0,
      ),
    );
    const held = (from: number, to: number) =>
      ((target.absorbsIn ?? []) as any[])
        .filter(
          (e) =>
            String(e.spellId) === shield &&
            e.timestamp >= start + from * 1000 &&
            e.timestamp < start + to * 1000,
        )
        .reduce((n, e) => n + (e.absorbedAmount ?? 0), 0);
    bump("stackedDeferral");
    const lo = Math.round((held(a + 1, b) / maxHp) * 100);
    const hi = Math.round((held(a, b + 1) / maxHp) * 100);
    const p = Number(m[5]);
    if (p < lo - 1 || p > hi + 1)
      miss(
        "stackedDeferral",
        `${where} ${m[2]}–${m[3]} ${target.name}: printed ${p}%, log ${lo}–${hi}%`,
      );
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
