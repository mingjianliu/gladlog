/**
 * breakFactScan.ts — F15 (fact1215 R2 + R3, 2026-10-16): re-derive "who
 * dispelled" and "what a PvP trinket press removed" from the parsed log and
 * check the rendered lines, over an acceptanceCapture `--context-dir`
 * capture (`<dir>/s<k>/context/`, layout as `pressFactScan.ts`).
 *
 * Read from the log events (the classification sets — `ccSpellIds`,
 * `disarmSpellIds`, `isSilenceOnlyAura` — are the only analysis imports; the
 * binders under audit are not used):
 *
 *  - `petDispel` (R2): a SPELL_DISPEL whose source is a pet of player P (a
 *    unit whose `ownerId` is P). No [PURGE] / [ENEMY PURGE] / [ENEMY
 *    CLEANSE] line at that second, and no [MINOR DISPELS] line, may credit
 *    P's pid with that dispel spell without `'s pet` / `'s guardian` /
 *    `'s totem` (`summonKindOf`'s words; P casting the spell
 *    itself in the round exempts it).
 *  - `enemyTrinketOutOf` (R3): an enemy's Gladiator's Medallion cast at
 *    which one of our CC / disarm / silence auras on that enemy was REMOVED
 *    within −25…+50 ms (the trinket's own removal cluster,
 *    `TRINKET_BREAK_AFTER_REMOVAL_MS`). Its `[ENEMY TRINKET]` line must name
 *    `out of`. Roots are left out (not named — a judgment call); so is a
 *    removal the log gives another cause before the press (BROKEN / dispel)
 *    and a press after the round's end (`roundEndMs`: a Shuffle round's
 *    ending death — its CCs are cut there).
 *  - `trinketAfterCause` (R3): a Medallion cast 1–50 ms after a CC on its
 *    caster was removed with a SPELL_DISPEL of it or a SPELL_AURA_BROKEN /
 *    _BROKEN_SPELL line at that removal. The CC's line (its landing second,
 *    its name) must not say the trinket ended it.
 *
 *  - `brokenByHolder` (R4, 2026-10-18): a SPELL_AURA_BROKEN_SPELL row on a
 *    player whose source is that player, with a hit of the breaking spell on
 *    them from ANOTHER unit 0–100 ms before it (the log writes the holder
 *    for a guardian's Wrath of Nathreza). The control's line (its landing
 *    second, its English name, on that player) must not say `broken by
 *    <the holder>'s <spell>`.
 *  - `brokenBySplitAlly` (C4): a BROKEN_SPELL row whose breaking spell is
 *    Blessing of Sacrifice and whose hit on the holder is a DAMAGE_SPLIT,
 *    while the holder's own 6940 link aura is up (the damage the holder's
 *    Blessing moved onto them; the row names the protected ally). The line
 *    must not say `broken by <that ally>'s Blessing of Sacrifice`.
 *  - `immuneCauseConsumed` (R5, 2026-10-18): an IMMUNE SPELL_MISSED of a
 *    control (`ccSpellIds`) from our side on an enemy player, where a listed
 *    avoidance aura (`CC_AVOIDANCE_BUFF_SPELLS`) applied on that player
 *    before it is REMOVED in the miss's own millisecond, logged after the
 *    miss row (the miss consumed it — Nullifying Shroud). Every `[CC NOT
 *    LANDED]` line of that player at that second, of that caster, that says
 *    `logged IMMUNE` must name a cause (`was up)`).
 *  - `delayedAvoidAtHit` (R6): an enemy's Capacitor Totem / Sigil of Misery
 *    cast whose effect wrote a miss row on one of our players from the
 *    caster or its summon inside the control's landing window, in a later
 *    second than the cast. No unstamped `[CC AVOIDED?]` line of that player,
 *    spell and caster may sit at the CAST second (the avoidance is read at
 *    the hit; a line there stamped `; cast m:ss` is an earlier cast's), unless
 *    another cast's miss renders in that second.
 *  - `casterKickEnd` (R9, 2026-10-18): a channelled control
 *    (`CHANNELED_SPELL_IDS`) on a player whose REMOVED sits within −50…+10 ms
 *    of a SPELL_INTERRUPT on its caster. The control's line (landing second,
 *    name, player) must not say `ended early — cause not logged`.
 *  - `refusedPressMechanic` (R10): the recorder's refused presses
 *    (SPELL_CAST_FAILED, raw stream, `control` reasons) re-assigned to the
 *    controls that have a `[CC ON TEAM]` line — the earliest-started one of
 *    the mechanic the reason names (`CONTROL_REJECT_MECHANIC` ×
 *    `ccMechanicOf`), else the earliest-started — one control per spell and
 *    source, split at a REFRESH its source cast for (`ccRecastBetween`); the
 *    log owner's presses of their printed kit only. Every line's `pressed
 *    during it:` clause must list exactly the re-assignment's counts, a
 *    missing clause included.
 *  - `conditionalControlMiss` (C10, 2026-10-18): a miss row from our side on
 *    an enemy player of a cast id that is no control, whose control effects
 *    each followed under half of its casts (Wake of Ashes' damage id). No
 *    `[CC NOT LANDED]` line of that target and spell at its second, unless
 *    the control's own id missed there too.
 *  - `casterKickEnd` also requires the line to say `… on its caster`,
 *    crediting the kicker, and counts only a kick of that channel
 *    (`extraSpellId` the control or a cast whose effect it is).
 *
 *   npx tsx packages/eval/scripts/breakFactScan.ts <captureDir>
 *     [--examples N] [--archive-dir <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CONTROL_REJECT_MECHANIC,
  CONTROL_REJECT_REASONS,
} from "@gladlog/analysis/src/context/controlRejectedPresses";
import {
  castsOfEffectAura,
  effectAuraHitShare,
  effectAurasOfCast,
} from "@gladlog/analysis/src/data/castEffectAuras";
import { CHANNELED_SPELL_IDS } from "@gladlog/analysis/src/data/channeledGenerated";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ccSpellIds,
  disarmSpellIds,
} from "@gladlog/analysis/src/data/spellTags";
import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraIntervals";
import { isSilenceOnlyAura } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { CC_AVOIDANCE_BUFF_SPELLS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { ccRecastBetween } from "@gladlog/analysis/src/utils/drAnalysis";
import {
  parseRawStreamsAbsolute,
  type RawStreamsAbsolute,
  rawStreamsForRound,
} from "@gladlog/analysis/src/utils/rawStreams";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  type IAuraEvent,
  type IMissEvent,
  type ISpellEvent,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: breakFactScan.ts <captureDir> [--examples N] [--archive-dir <dir>]",
  );
  process.exit(2);
}
const exIdx = process.argv.indexOf("--examples");
const EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 5;
const adIdx = process.argv.indexOf("--archive-dir");
const ARCHIVE_DIR = adIdx > 0 ? (process.argv[adIdx + 1] ?? "") : "";
const MEDALLION = "336126";
const CONTROL_REASONS = new Set<string>(CONTROL_REJECT_REASONS.control);

const fmt = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
type Check =
  | "petDispel"
  | "enemyTrinketOutOf"
  | "trinketAfterCause"
  | "brokenByHolder"
  | "brokenBySplitAlly"
  | "immuneCauseConsumed"
  | "delayedAvoidAtHit"
  | "casterKickEnd"
  | "refusedPressMechanic"
  | "conditionalControlMiss";
const expected = new Map<Check, number>();
const bad = new Map<Check, string[]>();
const unmapped: string[] = [];
const bump = (c: Check) => expected.set(c, (expected.get(c) ?? 0) + 1);
const fail = (c: Check, s: string) => {
  const l = bad.get(c) ?? [];
  l.push(s);
  bad.set(c, l);
};

let cacheRaw: RawStreamsAbsolute | null = null;
function parseFile(path: string): GladMatch[] {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  cacheRaw = parseRawStreamsAbsolute(text);
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
  for (const name of readdirSync(join(dir, shard, "context"))) {
    const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
    if (m) files.push({ shard, name, fileNo: +m[1]!, round: +m[2]! });
  }
}
files.sort((a, b) =>
  a.shard === b.shard ? a.fileNo - b.fileNo : a.shard < b.shard ? -1 : 1,
);

const isRemoved = (a: any) => a.logLine.event === LogEvent.SPELL_AURA_REMOVED;
const isBroken = (a: any) =>
  a.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
  a.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL;

let cacheKey = "";
let cacheItems: GladMatch[] = [];
let contexts = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  const [archive] = text.split("\n", 1);
  if (!archive) continue;
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
  const pidOf = new Map<string, { pid: string; enemy: boolean }>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"[^>]*role="([^"]+)"/.exec(l);
    if (u) pidOf.set(u[2]!, { pid: u[1]!, enemy: u[3] === "enemy" });
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  const friendlyOrSummon = (id: string | undefined): boolean => {
    if (!id) return false;
    const u = byId.get(id);
    const ownerId = u?.ownerId as string | undefined;
    const p = u && pidOf.get(u.name);
    if (p) return !p.enemy;
    const o = ownerId ? byId.get(ownerId) : undefined;
    const op = o && pidOf.get(o.name);
    return !!op && !op.enemy;
  };
  // the roster id a `(by …)` label starts with: the unit's own, else its
  // owner's (`N(Spec)'s pet`)
  const labelPidOf = (id: string | undefined): string | undefined => {
    const u = id ? byId.get(id) : undefined;
    const p = u && pidOf.get(u.name);
    if (p) return p.pid;
    const o = u?.ownerId ? byId.get(u.ownerId) : undefined;
    return (o && pidOf.get(o.name))?.pid;
  };
  const start = legacy.startTime;
  // a Solo Shuffle round ends at its ending death; a press after it breaks
  // nothing inside the round (its CCs are cut there)
  const roundEnd = roundEndMs(legacy as any);
  const at = (ts: number) => fmt((ts - start) / 1000);
  const where = `${f.shard}/${f.name}`;

  // ── petDispel ───────────────────────────────────────────────────────────
  for (const pet of units) {
    const owner = pet.ownerId ? byId.get(pet.ownerId) : undefined;
    const op = owner && pidOf.get(owner.name);
    if (!owner || !op || owner.id === pet.id) continue;
    for (const x of pet.actionOut ?? []) {
      if (x.logLine.event !== LogEvent.SPELL_DISPEL) continue;
      if (x.srcUnitId !== pet.id) continue;
      if (x.logLine.timestamp < start || x.logLine.timestamp > legacy.endTime)
        continue;
      const spell = x.spellName as string;
      const ownerCastsIt = (owner.actionOut ?? []).some(
        (y: any) =>
          y.logLine.event === LogEvent.SPELL_DISPEL &&
          y.srcUnitId === owner.id &&
          y.spellName === spell,
      );
      if (ownerCastsIt) continue;
      bump("petDispel");
      const t = at(x.logLine.timestamp);
      const credited = lines.some(
        (l) =>
          ((l.startsWith(`${t}  `) && /\[(ENEMY )?(PURGE|CLEANSE)\]/.test(l)) ||
            l.includes("[MINOR DISPELS]")) &&
          l.includes(`]   ${op.pid}(`) &&
          !new RegExp(`\\]   ${op.pid}\\([^)]*\\)'s (pet|guardian|totem)`).test(
            l,
          ) &&
          l.includes(spell),
      );
      if (credited)
        fail("petDispel", `${where} ${t} ${owner.name}'s pet ${spell}`);
    }
  }

  // ── who broke a control (R4 / C4) ───────────────────────────────────────
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    const auras = (u.auraEvents ?? []) as any[];
    for (let i = 0; i < auras.length; i++) {
      const b = auras[i];
      if (b.logLine.event !== LogEvent.SPELL_AURA_BROKEN_SPELL) continue;
      if (b.destUnitId && b.destUnitId !== u.id) continue;
      if (!b.spellId || !ccSpellIds.has(b.spellId)) continue;
      const ts = b.logLine.timestamp;
      if (ts < start || ts > roundEnd) continue;
      const breakId = String(b.logLine.parameters?.[11] ?? "");
      if (!breakId) continue;
      const hit = [...((u.damageIn ?? []) as any[])]
        .reverse()
        .find(
          (d) =>
            d.spellId === breakId &&
            ts - d.logLine.timestamp <= 100 &&
            (d.logLine.timestamp < ts ||
              (d.logLine.timestamp === ts &&
                d.logLine.lineIndex !== undefined &&
                b.logLine.lineIndex !== undefined &&
                d.logLine.lineIndex < b.logLine.lineIndex)),
        );
      if (!hit) continue;
      let check: Check | undefined;
      let wrongPid: string | undefined;
      // the pid the line must credit: the hitting unit's — its owner's for
      // a pet / guardian / totem (the line's `N(SPEC)'s guardian's X`)
      let rightPid: string | undefined;
      if (b.srcUnitId === u.id && hit.srcUnitId && hit.srcUnitId !== u.id) {
        check = "brokenByHolder";
        wrongPid = me.pid;
        const hitter = byId.get(hit.srcUnitId);
        const owner =
          hitter?.ownerId && hitter.ownerId !== hitter.id
            ? byId.get(hitter.ownerId)
            : hitter;
        rightPid = owner && pidOf.get(owner.name)?.pid;
      } else if (
        breakId === "6940" &&
        hit.logLine.event === LogEvent.DAMAGE_SPLIT &&
        b.srcUnitId !== u.id
      ) {
        let link = false;
        for (const a of auras.slice(0, i))
          if (a.spellId === "6940" && a.srcUnitId === u.id)
            link =
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH
                ? true
                : a.logLine.event === LogEvent.SPELL_AURA_REMOVED
                  ? false
                  : link;
        const ally = byId.get(b.srcUnitId);
        const allyPid = ally && pidOf.get(ally.name)?.pid;
        if (link && allyPid) {
          check = "brokenBySplitAlly";
          wrongPid = allyPid;
          rightPid = me.pid;
        }
      }
      if (!check || !wrongPid || !rightPid) continue;
      const applied = auras
        .slice(0, i)
        .reverse()
        .find(
          (a) =>
            a.spellId === b.spellId &&
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED,
        );
      if (!applied) continue;
      const t = at(applied.logLine.timestamp);
      const ccName = getEnglishSpellName(b.spellId, b.spellName);
      const breakName = getEnglishSpellName(
        breakId,
        String(b.logLine.parameters?.[12] ?? ""),
      );
      // counted only where the control's line is there to read (codex
      // 20-F15-19: a missing line must not pass as a correction), and right
      // only when it credits the expected unit — not merely "not the wrong
      // one"
      // the holder in the line's TARGET field (codex 20-F15-22: `${pid}(`
      // anywhere also matched the `(by …)` caster, and another target's line
      // masked a wrong one)
      const ccLines = lines.filter(
        (l) =>
          (l.startsWith(`${t}  [CC ON TEAM]   ${me.pid}(`) ||
            l.startsWith(`${t}  [CC ON ENEMY]   ${me.pid}(`)) &&
          l.includes(`← ${ccName} `) &&
          l.includes(` | broken by `) &&
          l.includes(breakName),
      );
      if (ccLines.length === 0) continue;
      bump(check);
      const credits = new RegExp(`broken by ${rightPid}\\([^)]*\\)'s `);
      if (!ccLines.every((l) => credits.test(l)))
        fail(
          check,
          `${where} ${t} ${u.name} ${ccName} broken by ${breakName} (not ${rightPid}; wrong ${wrongPid})`,
        );
    }
  }

  // ── immuneCauseConsumed (R5) ────────────────────────────────────────────
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    const auras = (u.auraEvents ?? []) as IAuraEvent[];
    for (const m of (u.missesIn ?? []) as IMissEvent[]) {
      if (m.missType !== "IMMUNE" || !m.spellId || !ccSpellIds.has(m.spellId))
        continue;
      const ts = m.timestamp;
      if (ts < start || ts > roundEnd) continue;
      // [CC NOT LANDED] is our side's control on the other side
      if (!me.enemy || !friendlyOrSummon(m.srcUnitId)) continue;
      const line = m.logLine?.lineIndex;
      if (line === undefined) continue;
      const consumed = auras.some(
        (r) =>
          r.spellId &&
          CC_AVOIDANCE_BUFF_SPELLS.has(r.spellId) &&
          r.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
          r.logLine.timestamp === ts &&
          (r.logLine.lineIndex ?? -1) > line &&
          (() => {
            let on = false;
            for (const x of auras) {
              if (x.logLine.timestamp > ts) break;
              if ((x.logLine.lineIndex ?? 0) > line) break;
              if (x.spellId !== r.spellId) continue;
              if (
                x.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
                x.logLine.event === LogEvent.SPELL_AURA_REFRESH
              )
                on = true;
              else if (x.logLine.event === LogEvent.SPELL_AURA_REMOVED)
                on = false;
            }
            return on;
          })(),
      );
      if (!consumed) continue;
      const t = at(ts);
      const ccName = getEnglishSpellName(m.spellId, m.spellName);
      // this miss's own line: its caster too (codex 20-F15-21: another
      // mage's DR-immune Polymorph in the same second is not "was up")
      const by = labelPidOf(m.srcUnitId);
      if (!by) continue;
      const notLanded = lines.filter(
        (l) =>
          l.startsWith(`${t}  [CC NOT LANDED]   ${me.pid}(`) &&
          l.includes(`← ${ccName} (by ${by}(`) &&
          l.includes("logged IMMUNE"),
      );
      if (notLanded.length === 0) continue;
      bump("immuneCauseConsumed");
      if (notLanded.some((l) => !l.includes("was up)")))
        fail("immuneCauseConsumed", `${where} ${t} ${u.name} ${m.spellName}`);
    }
  }

  // ── delayedAvoidAtHit (R6) ──────────────────────────────────────────────
  const DELAYED: Record<string, { toMs: number; effect: string }> = {
    "192058": { toMs: 4500, effect: "118905" }, // Capacitor Totem → Static Charge
    "207684": { toMs: 3000, effect: "207685" }, // Sigil of Misery
  };
  for (const e of units) {
    const caster = pidOf.get(e.name);
    if (!caster) continue;
    for (const c of (e.spellCastEvents ?? []) as ISpellEvent[]) {
      const d = c.spellId ? DELAYED[c.spellId] : undefined;
      if (!d || c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const cts = c.logLine.timestamp;
      if (cts < start || cts > roundEnd) continue;
      for (const p of units) {
        const me = pidOf.get(p.name);
        if (!me || me.enemy === caster.enemy) continue;
        const miss = ((p.missesIn ?? []) as IMissEvent[]).find(
          (m) =>
            (m.spellId === d.effect || m.spellId === c.spellId) &&
            m.timestamp >= cts &&
            m.timestamp <= cts + d.toMs &&
            (m.srcUnitId === e.id || byId.get(m.srcUnitId)?.ownerId === e.id),
        );
        if (!miss) continue;
        const tc = at(cts);
        const tm = at(miss.timestamp);
        if (tc === tm) continue;
        // another cast of the spell by this caster whose own miss on this
        // player renders in second tc owns a line there (codex 20-F15-21)
        const otherHitsAtTc = ((e.spellCastEvents ?? []) as ISpellEvent[]).some(
          (o) =>
            o !== c &&
            o.spellId === c.spellId &&
            o.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
            ((p.missesIn ?? []) as IMissEvent[]).some(
              (x) =>
                x !== miss &&
                (x.spellId === d.effect || x.spellId === c.spellId) &&
                x.timestamp >= o.logLine.timestamp &&
                x.timestamp <= o.logLine.timestamp + d.toMs &&
                at(x.timestamp) === tc,
            ),
        );
        if (otherHitsAtTc) continue;
        bump("delayedAvoidAtHit");
        const name = getEnglishSpellName(c.spellId, c.spellName);
        // a line at the cast second for this caster that carries no cast
        // stamp claims the hit there; a stamped one is an earlier cast's
        // delayed hit
        if (
          lines.some(
            (l) =>
              l.startsWith(`${tc}  [CC AVOIDED?]   ${me.pid}(`) &&
              l.includes(`: ${name} (by ${caster.pid}(`) &&
              !/; cast \d+:\d{2}\)/.test(l),
          )
        )
          fail("delayedAvoidAtHit", `${where} ${tc} → ${tm} ${p.name} ${name}`);
      }
    }
  }

  // ── conditionalControlMiss (C10) ────────────────────────────────────────
  // A miss row of a cast id that is no control itself, whose control effects
  // (the cast→effect table) each followed fewer than half of its casts —
  // Wake of Ashes 255937 → 255941 (demons / undead only). No
  // `[CC NOT LANDED]` line of that target and spell may sit at its second,
  // unless the control's own id missed there too.
  for (const c of units) {
    if (!friendlyOrSummon(c.id)) continue;
    for (const m of (c.missesOut ?? []) as IMissEvent[]) {
      const id = m.spellId;
      if (!id || ccSpellIds.has(id)) continue;
      const effects = effectAurasOfCast(id).filter((a) => ccSpellIds.has(a));
      if (effects.length === 0) continue;
      if (effects.some((a) => (effectAuraHitShare(id, a) ?? 0) >= 0.5))
        continue;
      if (m.timestamp < start || m.timestamp > roundEnd) continue;
      const tgt = byId.get(m.destUnitId);
      const tp = tgt && pidOf.get(tgt.name);
      if (!tp || !tp.enemy) continue;
      const t = at(m.timestamp);
      const ownMissThere = ((c.missesOut ?? []) as IMissEvent[]).some(
        (x) =>
          x.destUnitId === m.destUnitId &&
          !!x.spellId &&
          effects.includes(x.spellId) &&
          at(x.timestamp) === t,
      );
      if (ownMissThere) continue;
      bump("conditionalControlMiss");
      const name = getEnglishSpellName(id, m.spellName);
      if (
        lines.some(
          (l) =>
            l.startsWith(`${t}  [CC NOT LANDED]   ${tp.pid}(`) &&
            l.includes(`← ${name} (`),
        )
      )
        fail("conditionalControlMiss", `${where} ${t} ${tgt.name} ${name}`);
    }
  }

  // ── casterKickEnd (R9) ──────────────────────────────────────────────────
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    const auras = (u.auraEvents ?? []) as IAuraEvent[];
    for (const r of auras) {
      if (r.logLine.event !== LogEvent.SPELL_AURA_REMOVED) continue;
      if (!r.spellId || !CHANNELED_SPELL_IDS.has(r.spellId)) continue;
      if (!ccSpellIds.has(r.spellId)) continue;
      const rms = r.logLine.timestamp;
      if (rms < start || rms > roundEnd) continue;
      const caster = byId.get(r.srcUnitId);
      // the kick of THIS channel: its interrupted spell is the control or a
      // cast whose effect it is (codex 20-F15-24: a Counterspell on the
      // priest's Flash Heal is no end of Mind Control)
      const channelIds = new Set([r.spellId, ...castsOfEffectAura(r.spellId)]);
      const kick = ((caster?.actionIn ?? []) as ISpellEvent[]).find(
        (a) =>
          a.logLine?.event === LogEvent.SPELL_INTERRUPT &&
          a.timestamp >= rms - 50 &&
          a.timestamp <= rms + 10 &&
          (a.extraSpellId === undefined || channelIds.has(a.extraSpellId)),
      );
      if (!kick) continue;
      const kicker = labelPidOf(kick.srcUnitId);
      const applied = [...auras]
        .reverse()
        .find(
          (a) =>
            a.spellId === r.spellId &&
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
            a.logLine.timestamp <= rms,
        );
      if (!applied) continue;
      const t = at(applied.logLine.timestamp);
      const name = getEnglishSpellName(r.spellId, r.spellName);
      const ccLines = lines.filter(
        (l) =>
          (l.startsWith(`${t}  [CC ON TEAM]   ${me.pid}(`) ||
            l.startsWith(`${t}  [CC ON ENEMY]   ${me.pid}(`)) &&
          l.includes(`← ${name} `),
      );
      if (ccLines.length === 0) continue;
      bump("casterKickEnd");
      // the line must SAY it (codex 20-F15-24: a bare line with the clause
      // dropped passed), crediting the kicker
      const says = (l: string) =>
        l.includes(" on its caster") &&
        (!kicker || l.includes(`| ended by ${kicker}(`));
      if (!ccLines.every(says))
        fail("casterKickEnd", `${where} ${t} ${u.name} ${name}`);
    }
  }

  // ── refusedPressMechanic (R10) ──────────────────────────────────────────
  // An independent re-assignment: every refused press with a `control`
  // reason, inside the player's controls that have a [CC ON TEAM] line, goes
  // to the earliest-started one of the mechanic its reason names
  // (`CONTROL_REJECT_MECHANIC` × `ccMechanicOf`), else the earliest-started.
  // Only the log owner's presses of their printed `<cooldowns>` kit; each of
  // the owner's lines must list exactly the re-assignment's counts.
  const raw = cacheRaw as RawStreamsAbsolute | null;
  if (raw?.available) {
    const failed = rawStreamsForRound(
      raw,
      start,
      (legacy.endTime - start) / 1000,
    ).castFailed;
    // the log owner's kit as the prompt prints it (`<cooldowns>`, minus the
    // passive entries): the only presses the clause may list, and the only
    // unit whose lines carry it
    const ownerRow = lines.findIndex((l) =>
      /<unit id="\d+" name="[^"]+"[^>]*role="log owner"/.test(l),
    );
    const ownerName = /name="([^"]+)"/.exec(lines[ownerRow] ?? "")?.[1];
    const kit = new Set(
      (/<cooldowns>(.*)<\/cooldowns>/.exec(lines[ownerRow + 1] ?? "")?.[1] ?? "")
        // an entry ends at its last `[…]` tag; a name may hold a comma
        // (`Invoke Chi-Ji, the Red Crane`)
        .split(/(?<=\]), /)
        .filter((c) => !c.includes("[PASSIVE]"))
        .map((c) => c.replace(/ \[.*$/, "")),
    );
    for (const u of units) {
      const me = pidOf.get(u.name);
      if (!me || me.enemy || u.name !== ownerName) continue;
      const presses = failed.filter(
        (x) =>
          x.unitGuid === u.id &&
          CONTROL_REASONS.has(x.reason) &&
          kit.has(getEnglishSpellName(String(x.spellId), x.spellName)),
      );
      const wins: Array<{
        id: string;
        from: number;
        to: number;
        line: string;
      }> = [];
      const open = new Map<string, { id: string; src: string; from: number }>();
      // one aura the game re-broadcast (REMOVED and APPLIED of one spell in
      // one ms) is one control, as the [CC ON TEAM] line reads it
      const own = ((u.auraEvents ?? []) as IAuraEvent[]).filter(
        (a) =>
          !!a.spellId &&
          ccSpellIds.has(a.spellId) &&
          (!a.destUnitId || a.destUnitId === u.id),
      );
      // a REMOVED then APPLIED the game re-sent is one control, as the
      // [CC ON TEAM] line reads it (the producer's own filter)
      const kept = dropAuraRebroadcasts(own);
      const close = (key: string, to: number) => {
        const o = open.get(key)!;
        open.delete(key);
        const line = lines.find(
          (l) =>
            l.startsWith(`${at(o.from)}  [CC ON TEAM]   ${me.pid}(`) &&
            l.includes(`← ${getEnglishSpellName(o.id)} `),
        );
        // cut at the round's end, as the line is (`still on them when the
        // round ended`)
        if (line)
          wins.push({ id: o.id, from: o.from, to: Math.min(to, roundEnd), line });
      };
      // one control per spell and source, as the producer keys it; a
      // REFRESH its source cast for is a new control (ruling A51 — codex
      // 20-F15-24: Polymorph recast at 6 s over one from 3 s is two lines)
      for (const a of kept) {
        if (!a.spellId) continue;
        const key = `${a.spellId}:${a.srcUnitId}`;
        const ts = a.logLine.timestamp;
        if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
          if (!open.has(key))
            open.set(key, { id: a.spellId, src: a.srcUnitId, from: ts });
        } else if (
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH &&
          open.has(key)
        ) {
          const src = byId.get(a.srcUnitId);
          const owner = src?.ownerId ? byId.get(src.ownerId) : undefined;
          if (
            ccRecastBetween([src, owner], a.spellId, u.id, open.get(key)!.from, ts)
          ) {
            close(key, ts);
            open.set(key, { id: a.spellId, src: a.srcUnitId, from: ts });
          }
        } else if (
          (a.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
            a.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
            a.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL) &&
          open.has(key)
        )
          close(key, ts);
      }
      if (wins.length === 0) continue;
      wins.sort((a, b) => a.from - b.from);
      const counts = new Map<string, Map<string, number>>(); // line → name → n
      for (const x of presses) {
        const ms = start + Math.round(x.tSeconds * 1000);
        const holding = wins.filter((w) => w.from <= ms && ms <= w.to);
        if (holding.length === 0) continue;
        const want = CONTROL_REJECT_MECHANIC[x.reason];
        const w =
          (want !== undefined
            ? holding.find((h) => ccMechanicOf(h.id) === want)
            : undefined) ?? holding[0]!;
        const name = getEnglishSpellName(String(x.spellId), x.spellName);
        const m = counts.get(w.line) ?? new Map<string, number>();
        m.set(name, (m.get(name) ?? 0) + 1);
        counts.set(w.line, m);
      }
      // both ways (codex 20-F15-24): every listed count is the re-read's,
      // and every re-read press is listed — a line whose clause went missing
      // fails
      for (const w of new Set(wins.map((x) => x.line))) {
        const k = w.indexOf(" | pressed during it: ");
        const listed = new Map<string, number>();
        if (k >= 0)
          for (const it of w
            .slice(k + " | pressed during it: ".length)
            .matchAll(/(.+?) ×(\d+)(?:, |$)/g))
            listed.set(it[1]!, Number(it[2]));
        const want = counts.get(w) ?? new Map<string, number>();
        if (listed.size === 0 && want.size === 0) continue;
        bump("refusedPressMechanic");
        const bad: string[] = [];
        for (const name of new Set([...listed.keys(), ...want.keys()])) {
          const n = listed.get(name) ?? 0;
          const got = want.get(name) ?? 0;
          if (got !== n) bad.push(`${name} ×${n} (re-read ×${got})`);
        }
        const wid = wins.find((x) => x.line === w)!;
        if (bad.length > 0)
          fail(
            "refusedPressMechanic",
            `${where} ${at(wid.from)} ${u.name} ${getEnglishSpellName(wid.id)}: ${bad.join("; ")}`,
          );
      }
    }
  }

  // ── trinket presses ─────────────────────────────────────────────────────
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (c.spellId !== MEDALLION) continue;
      const ts = c.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const auras = (u.auraEvents ?? []).filter(
        (a: any) => a.destUnitId === u.id,
      );
      const removedNear = (lo: number, hi: number) =>
        auras.filter(
          (a: any) =>
            isRemoved(a) &&
            a.logLine.timestamp - ts >= lo &&
            a.logLine.timestamp - ts <= hi,
        );
      /** the log gives this removal another cause: a BROKEN line of the
       * aura at it, or a SPELL_DISPEL of it within 50 ms */
      const causedAt = (r: any): boolean => {
        const rTs = r.logLine.timestamp;
        return (
          // the BROKEN line can precede the REMOVED it caused by a few ms
          // (65-2 Intimidating Shout: BROKEN_SPELL .428, REMOVED .436)
          auras.some(
            (a: any) =>
              isBroken(a) &&
              a.spellId === r.spellId &&
              a.logLine.timestamp - rTs <= 1 &&
              rTs - a.logLine.timestamp <= 50,
          ) ||
          (u.actionIn ?? []).some(
            (x: any) =>
              x.logLine.event === LogEvent.SPELL_DISPEL &&
              x.extraSpellId === r.spellId &&
              Math.abs(x.logLine.timestamp - rTs) <= 50,
          )
        );
      };
      // enemyTrinketOutOf
      if (me.enemy && ts <= roundEnd) {
        const ours = removedNear(-25, 50).filter(
          (a: any) =>
            !(a.logLine.timestamp < ts && causedAt(a)) &&
            friendlyOrSummon(a.srcUnitId) &&
            a.spellId &&
            (ccSpellIds.has(a.spellId) ||
              disarmSpellIds.has(a.spellId) ||
              isSilenceOnlyAura(a.spellId)),
        );
        if (ours.length > 0) {
          bump("enemyTrinketOutOf");
          const t = at(ts);
          const ok = lines.some(
            (l) =>
              l.startsWith(`${t}  [ENEMY TRINKET]   ${me.pid}(`) &&
              l.includes(" out of "),
          );
          if (!ok)
            fail(
              "enemyTrinketOutOf",
              `${where} ${t} ${u.name} removed ${ours.map((a: any) => a.spellName).join("/")}`,
            );
        }
      }
      // trinketAfterCause
      for (const r of removedNear(-50, -1)) {
        if (!r.spellId || !ccSpellIds.has(r.spellId)) continue;
        const rTs = r.logLine.timestamp;
        if (!causedAt(r)) continue;
        const applied = [...auras]
          .reverse()
          .find(
            (a: any) =>
              a.spellId === r.spellId &&
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
              a.logLine.timestamp <= rTs,
          );
        if (!applied) continue;
        bump("trinketAfterCause");
        const t = at(applied.logLine.timestamp);
        const name = r.spellName as string;
        const credited = lines.some(
          (l) =>
            l.startsWith(`${t}  `) &&
            l.includes(`${me.pid}(`) &&
            l.includes(name) &&
            /trinket broke this CC|ended by their PvP trinket/.test(l),
        );
        if (credited)
          fail("trinketAfterCause", `${where} ${t} ${u.name} ${name}`);
      }
    }
  }
}

console.log(`contexts: ${contexts}`);
for (const c of [
  "petDispel",
  "enemyTrinketOutOf",
  "trinketAfterCause",
  "brokenByHolder",
  "brokenBySplitAlly",
  "immuneCauseConsumed",
  "delayedAvoidAtHit",
  "casterKickEnd",
  "refusedPressMechanic",
  "conditionalControlMiss",
] as Check[]) {
  const b = bad.get(c) ?? [];
  console.log(`${c}: expected ${expected.get(c) ?? 0}, wrong ${b.length}`);
  for (const s of b.slice(0, EXAMPLES)) console.log(`    ${s}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
