/**
 * Outcome facts the timeline did not state (user ruling 2026-09-26, reliability
 * round 3 N10 / N18): a control eaten by a Grounding Totem, a spell reflected,
 * a control removed by Blessing of Sanctuary, and the log owner's own repeated
 * cast rejections outside CC (out of range / moving / line of sight).
 *
 * Every builder is a pure function of the units and returns match-relative
 * seconds; `matchTimeline.ts` renders them.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { abilityProfile } from "../data/abilityProfile";
import { BACKLASH_AURA_CC_TYPE } from "../data/backlashCc";
import { ROOT_SPELL_IDS } from "../data/rootSpells";
import { getEnglishSpellName } from "../data/spellEffectData";
import { getSortedAdvancedActions } from "../utils/advancedActions";
import { dropAuraRebroadcasts } from "../utils/auraIntervals";
import { binarySearchClosest } from "../utils/binarySearch";
import { CAST_INTERRUPTED_REASONS } from "../utils/castCancels";
import { castControlsIn, isControlCast } from "../utils/castMissRows";
import {
  ccRemainingSeconds,
  oppressingRoarOnAt,
} from "../utils/ccBreakAnalysis";
import { ccRecastSplitsResend } from "../utils/drAnalysis";
import { groundingRedirects } from "../utils/groundingRedirects";
import { isDeferralAbsorb } from "../utils/incomingPressure";
import { petCommands } from "../utils/petCommands";
import type { CastFailedEvent } from "../utils/rawStreams";
import { sanctuaryRemovalPairs } from "../utils/sanctuaryRemovals";
import {
  CONTROL_REJECT_WHY,
  controlRejectKindOf,
} from "./controlRejectedPresses";

/** A control: the official hard-CC set or a root ("控制要写"). */
export function isControlSpell(spellId: string): boolean {
  // a press's control under its effect aura's id counts (fact2 C10:
  // `isControlCast`, the one cast→control reading)
  return isControlCast(spellId) || castControlsIn(spellId, ROOT_SPELL_IDS);
}

// ── Grounding ────────────────────────────────────────────────────────────────

export interface IGroundedCc {
  atSeconds: number;
  casterId: string;
  casterName: string;
  spellId: string;
  spellName: string;
  totemId: string;
}

/** Every control that went into a Grounding Totem — a cast aimed at it (the
 *  log's own statement that the server redirected it; 7d1f: a Cyclone and a
 *  Polymorph), or an IMMUNE miss on it with no such cast (a trap has no cast
 *  destination: c2058ed4's Freezing Trap, triage F-E27). One predicate:
 *  `groundingRedirects`, shared with the shaman's `[CC AVOIDED?]` credit.
 *  Whether a redirected cast then landed on the totem is not always logged:
 *  a Hammer of Justice into a totem leaves no SPELL_MISSED and totem deaths
 *  are never logged (0 in 200 files, 2026-09-27) — so the line says
 *  "redirected into", not "eaten" (codex review of batch 13: a projectile can
 *  outlive the totem; requiring the miss line dropped 115 of 504 true
 *  redirects). `skipCasterIds`: the log owner's own targeted casts already
 *  carry "[absorbed: Grounding Totem]" — the miss-only shape carries nothing
 *  there, so it is kept for the owner too. */
export function groundedControls(
  units: readonly ICombatUnit[],
  matchStartMs: number,
  skipCasterIds: ReadonlySet<string>,
): IGroundedCc[] {
  const out: IGroundedCc[] = [];
  for (const u of units) {
    for (const g of groundingRedirects(u)) {
      if (g.via === "cast" && skipCasterIds.has(u.id)) continue;
      if (!isControlSpell(g.spellId)) continue;
      out.push({
        atSeconds: (g.timestampMs - matchStartMs) / 1000,
        casterId: u.id,
        casterName: u.name,
        spellId: g.spellId,
        spellName: getEnglishSpellName(g.spellId, g.spellName),
        totemId: g.totemId,
      });
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

// ── Reflect ──────────────────────────────────────────────────────────────────

/** A reflected damage spell is stated only when what came back reached this
 *  share of the caster's max HP (user: "反射了没什么伤害的法术就不理了").
 *  60-file scan (2026-09-26): 306 reflects, 226 dealt nothing back (pet Fel
 *  Firebolt, Pestilence …); a reflected Shadow Bolt came back for ~300k. */
export const REFLECT_MIN_DAMAGE_PCT = 5;
/** How long after the reflect the spell's damage on its caster is summed
 *  when no reflected copy's aura stands behind it (a channel's caster →
 *  caster ticks). A reflected DoT's copy is summed over its own aura run,
 *  however long (F20 D6, c5ae2200 0:19: a Flame Shock copy up 47 s printed
 *  143k of 255k at a 20 s cap). */
export const REFLECT_DAMAGE_WINDOW_S = 20;

export interface IReflected {
  atSeconds: number;
  casterId: string;
  casterName: string;
  reflectorId: string;
  reflectorName: string;
  spellId: string;
  spellName: string;
  isControl: boolean;
  /** damage the spell then did to its own caster (incl. absorbed) */
  damageBack: number;
  /** how many casts the chain reflected (`reflectCount`) — `×N` on the
   * line when ≥ 2 (user ruling 2026-10-27) */
  reflectCount: number;
}

/** A REFLECT row can be logged just before its own cast's SUCCESS row
 * (47867c33: Holy Word: Chastise's 200200 REFLECT 1 ms ahead of 88625's
 * SUCCESS) — far below two presses of one spell (Fire Blast 943 ms). Two
 * rows no cast covers this close are one effect logged twice. */
export const REFLECT_CAST_LEAD_MS = 100;

/** How long after its cast a row is still that cast's: Touch of Karma's
 * 10 s (its rows run 3.3 s past the press; an Ultimate Penitence's first
 * reflected bolt 5.8 s after its cast). */
export const REFLECT_CAST_COVER_MS = 10_000;

/** How many casts or procs a reflect chain's rows came from. A row with a
 * cast of the spell (id or English name) in the `REFLECT_CAST_COVER_MS`
 * before it (`REFLECT_CAST_LEAD_MS` after) is that cast's: it starts a new
 * one only when a cast lies between it and the previous row — one Penance
 * channel's bolts and one Touch of Karma press's rows are one, two Fire
 * Blasts 943 ms apart are two (codex 20-G3 #2, 20-G4; a projectile still in
 * flight at the next press is not told apart). A row with none is a proc of
 * its own — Astral Smolder's five reflected applications in 2 s are five
 * (codex 20-G5) — unless within `REFLECT_CAST_LEAD_MS` of the previous. */
export function reflectCount(
  caster: ICombatUnit,
  spellId: string,
  rows: readonly number[],
): number {
  const sorted = [...rows].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const name = getEnglishSpellName(spellId, "");
  const casts = (caster.spellCastEvents ?? [])
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!e.spellId &&
        (e.spellId === spellId ||
          (name !== "" && getEnglishSpellName(e.spellId, "") === name)),
    )
    .map((e) => e.logLine.timestamp);
  const covered = (ms: number) =>
    casts.some(
      (t) => t >= ms - REFLECT_CAST_COVER_MS && t <= ms + REFLECT_CAST_LEAD_MS,
    );
  let n = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (
      covered(cur)
        ? casts.some(
            (t) =>
              t > prev + REFLECT_CAST_LEAD_MS &&
              t <= cur + REFLECT_CAST_LEAD_MS,
          )
        : cur - prev > REFLECT_CAST_LEAD_MS
    )
      n++;
  }
  return n;
}

/** The unit's max HP at its advanced row nearest `tMs` (null when that row
 *  is not its own). Exported for corpusFactScan `reflectReturn`'s 5 % floor —
 *  its own nearest-row pick read the first of three rows in one ms (971,080
 *  before Desperate Prayer's +35 %) where this reads the last (1,310,958):
 *  0c2f3878 r1 1:30 Void Volley, 62.1k = 6.4 % vs 4.7 %. */
export function maxHpNear(unit: ICombatUnit, tMs: number): number | null {
  const a = binarySearchClosest(
    getSortedAdvancedActions(unit),
    tMs,
    (x) => x.logLine.timestamp,
  );
  if (!a || a.advancedActorId !== unit.id || a.advancedActorMaxHp <= 0)
    return null;
  return a.advancedActorMaxHp;
}

/** A REFLECT row this reflect reader counts: not one whose target is its own
 * caster. 4eea3cc5 r1 1:11: two warlocks with Nether Ward up; the log wrote
 * `SPELL_MISSED Cybermooke→Cybermooke 445474 REFLECT` in the same ms as the
 * enemy's real reflect of that Wither, the self row's chain took the return
 * and the prompt read "6(DWarlock)'s Wither reflected by 6(DWarlock) (came
 * back for 166k)" while the real 172k reflect printed nothing (F20 wide
 * residual, 4 facts). A unit cannot reflect its own spell at itself; the
 * row is the copy's bounce, not a reflect of a spell it aimed. */
export function isCountedReflectRow(m: {
  missType?: string;
  spellId?: string;
  srcUnitId?: string;
  destUnitId?: string;
}): boolean {
  return (
    m.missType === "REFLECT" &&
    !!m.spellId &&
    !(m.srcUnitId && m.srcUnitId === m.destUnitId)
  );
}

/** Reflects of one caster's spell by one reflector this close together are
 *  one reflect event — a channel's bolts (Penance) each log their own
 *  REFLECT; 0051f0c9-style four identical "came back for 59k" lines. */
export const REFLECT_CHAIN_GAP_MS = 3000;

/** The ids a reflect's damage comes back under when not the reflected
 * spell's own: Spell Reflection 23920. The 29 fact2 logs hold 392 such
 * SPELL_DAMAGE rows; 387 have a REFLECT row of the hit unit's spell on that
 * reflector within 3 s (the other 5 none) — 238 logged after it (up to
 * 2.9 s: the projectile's flight), the rest before it, at most 487 ms
 * (median 7 ms). */
export const REFLECT_OWN_DAMAGE_IDS: ReadonlySet<string> = new Set([
  "23920", // Spell Reflection
  // Nether Ward (F16 retest 2026-10-21, idx 0): 01502819 2:42 — the second
  // reflected Smite landed 51,390 under 212295 and only the absorbed parts
  // (kept under the Smite's id) were counted; at 5:57 a fully landed
  // 58,770 under 212295 left no [REFLECTED] line at all
  "212295",
]);
/** How far ahead of its REFLECT row such a row can be logged (measured max
 * 487 ms, above). */
export const REFLECT_OWN_ID_LEAD_MS = 500;
/** How long after its REFLECT row a reflected hit can land: the projectile's
 * flight (measured up to 2.9 s, above). A hit of the spell the reflector
 * sends later is its own cast or proc — unless it ticks inside the copy the
 * reflect put on the caster (136-1 2:28: a Shadow of Nathreza mirror, the
 * reflecting warlock's own pulses on the caster for 20 s printed 107k of
 * four 5.6k returns; corpusFactScan reflectReturn shares it). */
export const REFLECT_DIRECT_RETURN_MS = 3000;

export function reflectedSpells(
  units: readonly ICombatUnit[],
  matchStartMs: number,
): IReflected[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: IReflected[] = [];
  // fact6 D30's reading: an owner's command to its pet (Command Demon) is the
  // pet's cast — the pet's own REFLECT row states it; a command row no
  // summon row carried out is the pet's, once (`petCommands`)
  type MissRow = NonNullable<ICombatUnit["missesOut"]>[number];
  const commandReflects = new Set<MissRow>();
  const reflectsMovedTo = new Map<string, MissRow[]>();
  for (const u of units) {
    if (!u.info) continue;
    const rows = (u.missesOut ?? []).filter(isCountedReflectRow);
    if (rows.length === 0) continue;
    const cmd = petCommands(u, { units });
    for (const m of rows) {
      const name = getEnglishSpellName(m.spellId!, m.spellName ?? "");
      if (cmd.carriedOutBy(m.logLine.timestamp, name)) {
        commandReflects.add(m);
        continue;
      }
      if (
        !cmd.isCommandRow(m.spellId!, m.logLine.timestamp, REFLECT_CAST_LEAD_MS)
      )
        continue;
      commandReflects.add(m);
      const pet = cmd.commandPet(name);
      if (pet)
        reflectsMovedTo.set(pet.id, [
          ...(reflectsMovedTo.get(pet.id) ?? []),
          m,
        ]);
    }
  }
  for (const caster of units) {
    const reflects = [
      ...(caster.missesOut ?? []).filter((m) => !commandReflects.has(m)),
      ...(reflectsMovedTo.get(caster.id) ?? []),
    ]
      .filter(isCountedReflectRow)
      .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
    // chains: same spell, same reflector, ≤ REFLECT_CHAIN_GAP_MS apart (this
    // also folds one reflect logged once per effect at the same ms)
    const chains: Array<{
      first: (typeof reflects)[number];
      last: number;
      /** every REFLECT row's ms in the chain */
      rows: number[];
      /** every REFLECT row's spell id in the chain (a cast id and its
       *  damage id: Death Coil 47541 / 47632) */
      ids: Set<string>;
    }> = [];
    for (const m of reflects) {
      const c = [...chains].reverse().find(
        (x) =>
          // one spell by id or English name: a reflected Frostbolt logs a
          // REFLECT under its damage id 228597 and, 0.5 s later, under its
          // cast id 116 (111-1 8:15: the two halves of 96k split into two
          // chains and the line printed 47k)
          (x.first.spellId === m.spellId ||
            (!!x.first.spellId &&
              !!m.spellId &&
              getEnglishSpellName(x.first.spellId, "") !== "" &&
              getEnglishSpellName(x.first.spellId, "") ===
                getEnglishSpellName(m.spellId, ""))) &&
          x.first.destUnitId === m.destUnitId,
      );
      if (c && m.logLine.timestamp - c.last <= REFLECT_CHAIN_GAP_MS) {
        c.last = m.logLine.timestamp;
        c.rows.push(m.logLine.timestamp);
        c.ids.add(m.spellId!);
      } else
        chains.push({
          first: m,
          last: m.logLine.timestamp,
          rows: [m.logLine.timestamp],
          ids: new Set([m.spellId!]),
        });
    }
    // Each hit of the spell on its caster goes to ONE chain (codex reviews
    // of batch 13): a hit sourced from a reflector → that reflector's latest
    // chain before it; the caster's own tick → the latest chain of the spell
    // before it; never past REFLECT_DAMAGE_WINDOW_S. A later reflector no
    // longer cuts off an earlier reflector's explicitly attributed damage.
    const back = new Map<(typeof chains)[number], number>();
    // fact3 D15 / D40: a reflector of the caster's own class can have its own
    // copy of the spell on the caster — its ticks are its own damage, not
    // the return (8888b780 0:42: 136k of a reflected Agony's "223k" was the
    // reflecting warlock's own Agony, up on the caster before the reflect).
    // The reflected copy ticks as the caster's own (caster → caster) — or
    // as the reflector's, applied by the reflect itself: only a run of the
    // reflector's that started before the REFLECT row (less
    // `REFLECT_OWN_ID_LEAD_MS`) is its own (70-1 1:11: a Wither Nether Ward
    // sent back, 445474 Scallington → Shadowfist from 147 ms after the row,
    // Scallington's own gone 2 s before and never recast — its ticks were
    // dropped, 75k printed of 139.6k; corpusFactScan reflectReturn)
    const reflectorsOwnAuraUp = (
      spellId: string,
      reflectorId: string,
      ts: number,
      reflectMs: number,
    ): boolean => {
      let since: number | undefined;
      for (const a of caster.auraEvents ?? []) {
        if (a.logLine.timestamp > ts) break;
        if (a.spellId !== spellId || a.srcUnitId !== reflectorId) continue;
        // a tick logged in its run's removal ms is still the run's
        if (a.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
          if (a.logLine.timestamp < ts) since = undefined;
        } else if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED)
          since ??= a.logLine.timestamp;
        else since ??= a.logLine.timestamp; // a REFRESH / dose: up
      }
      return since !== undefined && since < reflectMs - REFLECT_OWN_ID_LEAD_MS;
    };
    // corpusFactScan reflectReturn (2026-10-21): the reflected spell's damage
    // can come back under its damage id, not the cast id the REFLECT row
    // names (Frostfire Bolt: cast 431044, damage 468655 — 112k back with no
    // line), and a hit from the reflector can be logged a few ms before the
    // REFLECT row, as the own-id rows are (`REFLECT_OWN_ID_LEAD_MS`)
    // — the same id or English name (`damagePress`' rule) — but never a
    // dispel backlash of the same name: Unstable Affliction's 196364 is the
    // damage the caster took dispelling the reflected copy off itself, not
    // the copy's own (11-1 0:44: 127.7k of a printed 189k)
    // the copy the reflect itself put on the caster, from the reflector:
    // a run of the hit's aura that started with the reflect (from
    // `REFLECT_OWN_ID_LEAD_MS` before its first row to the projectile's
    // flight after its last) and is up at `ts`
    // F20 D6: the copy can be the caster's own (caster → caster, the
    // reflected Flame Shock of c5ae2200 0:19) as well as the reflector's,
    // and a REMOVED + APPLIED in one ms is the same copy re-applied — it
    // keeps the run it continues (scan1 `reflectReturn`'s join)
    // F20 wide residual: a later reflect of the spell that refreshes the
    // caster's own copy (REFRESH / a dose / a re-APPLIED in its window) stands behind the
    // rest of the run — the run is that reflect's from the refresh on, to its
    // end (d6d8a412 r1 2:07: a Shadow Word: Pain reflected at 2:07 and again
    // at 2:17 into the same copy; the 2:17 line kept only its first 20 s and
    // the copy's last 6 s went back to the 2:07 line). `owning` gives a tick
    // to the latest chain standing behind it.
    const reflectedCopyUp = (
      spellId: string,
      srcId: string,
      ts: number,
      firstMs: number,
      lastMs: number,
    ): boolean => {
      let since: number | undefined;
      /** the run's APPLIED, REFRESH and dose rows */
      let touches: number[] = [];
      let cut: { at: number; since: number; touches: number[] } | undefined;
      let reappliedAt: number | undefined;
      for (const a of caster.auraEvents ?? []) {
        if (a.logLine.timestamp > ts) break;
        if (a.spellId !== spellId || a.srcUnitId !== srcId) continue;
        const at = a.logLine.timestamp;
        const ev = a.logLine.event;
        if (ev === LogEvent.SPELL_AURA_REMOVED) {
          // …in either order: an APPLIED logged first in that ms
          if (reappliedAt === at) continue;
          // the run's last tick can share its removal ms (c5ae2200 1:06.732:
          // a 2,429 Flame Shock tick, then the REMOVED) — it is the run's
          if (at === ts) continue;
          cut = since === undefined ? undefined : { at, since, touches };
          since = undefined;
          touches = [];
          continue;
        }
        if (since === undefined && cut?.at === at) {
          since = cut.since;
          touches = cut.touches;
        } else if (since === undefined) {
          since = at;
          touches = [at];
          continue;
        } else if (ev === LogEvent.SPELL_AURA_APPLIED) reappliedAt = at;
        // only the caster's own copy: no one but a reflect puts the
        // caster's spell on the caster, while the reflector's own copy
        // stacks and refreshes by itself (cb7fe23f r1 0:20: Ilovearýanne's
        // Wither doses on Cybermooke 2.4 s after a reflect claimed her whole
        // run, 167k printed for 5.8k)
        if (
          srcId === caster.id &&
          (ev === LogEvent.SPELL_AURA_APPLIED ||
            ev === LogEvent.SPELL_AURA_REFRESH ||
            ev === LogEvent.SPELL_AURA_APPLIED_DOSE)
        )
          touches.push(at);
      }
      return (
        since !== undefined &&
        touches.some(
          (t) =>
            t >= firstMs - REFLECT_OWN_ID_LEAD_MS &&
            t <= lastMs + REFLECT_DIRECT_RETURN_MS,
        )
      );
    };
    const sameSpell = (reflected: string, hit: string) =>
      reflected === hit ||
      (!BACKLASH_AURA_CC_TYPE.has(hit) &&
        getEnglishSpellName(reflected, "") !== "" &&
        getEnglishSpellName(reflected, "") === getEnglishSpellName(hit, ""));
    const owning = (spellId: string, src: string | undefined, ts: number) => {
      let best: (typeof chains)[number] | undefined;
      for (const c of chains) {
        if (!sameSpell(c.first.spellId ?? "", spellId)) continue;
        const t0 = c.first.logLine.timestamp;
        // either source: the copy that came back can hit the caster as the
        // caster's own (105-3 0:17: a reflected Frostfire Bolt's 106k under
        // 468655, caster → caster, 23 ms before the REFLECT row)
        const lead = REFLECT_OWN_ID_LEAD_MS;
        if (t0 - lead > ts) continue;
        if (src !== caster.id && src !== c.first.destUnitId) continue;
        // the reflected copy's ticks count for as long as its aura runs; the
        // fixed window only for a return no copy stands behind (F20 D6)
        if (
          ts - t0 > REFLECT_DAMAGE_WINDOW_S * 1000 &&
          !(src !== undefined && reflectedCopyUp(spellId, src, ts, t0, c.last))
        )
          continue;
        if (
          src === c.first.destUnitId &&
          src !== caster.id &&
          (reflectorsOwnAuraUp(spellId, src, ts, t0) ||
            (ts > c.last + REFLECT_DIRECT_RETURN_MS &&
              !reflectedCopyUp(spellId, src, ts, t0, c.last)))
        )
          continue;
        if (!best || t0 > best.first.logLine.timestamp) best = c;
      }
      return best;
    };
    const credit = (
      spellId: string | undefined,
      src: string | undefined,
      ts: number,
      amt: number,
    ) => {
      if (!spellId) return;
      const c = owning(spellId, src, ts);
      if (c) back.set(c, (back.get(c) ?? 0) + amt);
    };
    // a return logged under the reflector's own id → the reflector's
    // nearest damaging chain: a reflected control that deals no damage
    // cannot own a damage return (codex 20-F16-03 #3: a Polymorph reflected
    // 190 ms after a Fireball took the Fireball's 100k, and the Fireball's
    // [REFLECTED] line went)
    // deals damage: the official profile says so, or the caster's own hits
    // of it (by id or English name) are in this round — a scripted damage
    // spell the profile misses (Fel Lance 206966: effects 165 + dummy;
    // 55-1 0:40 lost its 133k [REFLECTED] line), never a Spellsteal or a
    // control, which leave no hit of their own
    const dealsDamage = (id: string): boolean => {
      if (abilityProfile(id).dealsDamage) return true;
      const name = getEnglishSpellName(id, "");
      return units.some((t) =>
        (t.damageIn ?? []).some(
          (d) =>
            d.srcUnitId === caster.id &&
            !!d.spellId &&
            (d.spellId === id ||
              (name !== "" && getEnglishSpellName(d.spellId, "") === name)),
        ),
      );
    };
    const creditOwnId = (src: string | undefined, ts: number, amt: number) => {
      let best: (typeof chains)[number] | undefined;
      let bestGap = Infinity;
      for (const c of chains) {
        if (c.first.destUnitId !== src) continue;
        const t0 = c.first.logLine.timestamp;
        if (ts < t0 - REFLECT_OWN_ID_LEAD_MS) continue;
        if (ts - t0 > REFLECT_DAMAGE_WINDOW_S * 1000) continue;
        // the gap to the chain's nearest REFLECT row, not its first: two
        // Wicked Reapings reflected 1.1 s apart are one chain, and the
        // second's 59.5k under Nether Ward in its own row's ms went to a
        // Demonbolt reflected 335 ms before it (50-1 2:17)
        const rowGap = Math.min(
          ...c.rows
            .filter((r) => ts >= r - REFLECT_OWN_ID_LEAD_MS)
            .map((r) => Math.abs(ts - r)),
        );
        // a reflected spell that deals no damage owns no damage return —
        // a control (codex 20-F16-03 #3) or anything else (fact3 D6 / D25:
        // a Spellsteal reflected 0.6 s after a Pyroblast took its 145k)
        // …by any of the chain's ids: a Death Coil reflected as its cast id
        // 47541 (no damage effect of its own) and its damage id 47632 is one
        // damaging chain (F20 wide residual, d59fd620 r1 1:01: a 43.7k
        // Nether Ward row 0.32 s after the Death Coil went to a Pestilence
        // reflected 0.49 s before it — printed 62k for 19k of ticks)
        if (![...c.ids].some(dealsDamage)) continue;
        const gap = rowGap;
        if (gap < bestGap) {
          best = c;
          bestGap = gap;
        }
      }
      if (best) back.set(best, (back.get(best) ?? 0) + amt);
    };
    for (const d of caster.damageIn ?? []) {
      // fact2 (2026-10-20, Spell Reflection): a Warrior's reflect comes back
      // as a damage row of the reflector's own Spell Reflection id, logged a
      // few ms BEFORE the REFLECT row (08acb188 0:32: 67k under 23920, 6 ms
      // ahead; 0c8b1932: 17k landed under 23920 beside 122k absorbed under
      // the Pyroblast) — the reflector's latest chain within
      // `REFLECT_OWN_ID_LEAD_MS` of it owns it
      if (d.spellId && REFLECT_OWN_DAMAGE_IDS.has(d.spellId)) {
        creditOwnId(
          d.srcUnitId,
          d.logLine.timestamp,
          Math.abs(d.effectiveAmount),
        );
        continue;
      }
      credit(
        d.spellId ?? undefined,
        d.srcUnitId,
        d.logLine.timestamp,
        Math.abs(d.effectiveAmount),
      );
    }
    for (const a of caster.absorbsIn ?? [])
      // a deferral shield only delayed the return — its tick lands later as
      // the shield caster's own damage (FT-T02b; codex 20-F16-08 #1)
      if (isDeferralAbsorb(a)) continue;
      else if (a.attackSpellId && REFLECT_OWN_DAMAGE_IDS.has(a.attackSpellId))
        creditOwnId(a.attackerId, a.timestamp, Math.abs(a.absorbedAmount));
      else
        credit(
          a.attackSpellId,
          a.attackerId,
          a.timestamp,
          Math.abs(a.absorbedAmount),
        );
    for (const chain of chains) {
      const m = chain.first;
      const reflector = byId.get(m.destUnitId ?? "");
      if (!reflector) continue;
      const t0 = m.logLine.timestamp;
      const damageBack = back.get(chain) ?? 0;
      const isControl = isControlSpell(m.spellId!);
      if (!isControl) {
        const maxHp = maxHpNear(caster, t0);
        if (
          maxHp === null ||
          (damageBack / maxHp) * 100 < REFLECT_MIN_DAMAGE_PCT
        )
          continue;
      }
      out.push({
        atSeconds: (t0 - matchStartMs) / 1000,
        casterId: caster.id,
        casterName: caster.name,
        reflectorId: reflector.id,
        reflectorName: reflector.name,
        spellId: m.spellId!,
        spellName: getEnglishSpellName(m.spellId!, m.spellName),
        isControl,
        damageBack,
        reflectCount: reflectCount(caster, m.spellId!, chain.rows),
      });
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

// ── Blessing of Sanctuary ────────────────────────────────────────────────────

export { BLESSING_OF_SANCTUARY_ID } from "../utils/sanctuaryRemovals";

export interface ICcRemovedBySanctuary {
  atSeconds: number;
  paladinId: string;
  paladinName: string;
  targetId: string;
  targetName: string;
  ccSpellId: string;
  ccSpellName: string;
  ccSourceName: string;
  /** the CC's caster by GUID — a same-named summon on both teams (Capacitor
   *  Totem) must not resolve by name (agy review, the GH #99 class) */
  ccSourceId?: string;
  /** cc-dr F-CR1: seconds the CC had held when it was removed (from its
   * APPLIED / REFRESH by that source) */
  heldSeconds?: number;
  /** cc-dr F-CR1: seconds of it left (`ccRemainingSeconds`); null when the
   * full duration is unknown */
  leftSeconds?: number | null;
}

/** cc-dr F-CR1: how long the removed CC had held, and how much was left
 * (the `[CC BROKEN]` arithmetic, `ccRemainingSeconds`). The application is
 * the last APPLIED / REFRESH by that source BEFORE `removed` in the stream —
 * a re-application later in log order at the removal's ms is not it. */
function heldAndLeft(
  target: ICombatUnit,
  removed: ICombatUnit["auraEvents"][number],
  units: readonly ICombatUnit[],
  matchStartMs: number,
): { heldSeconds?: number; leftSeconds?: number | null } {
  const spellId = removed.spellId;
  const srcId = removed.srcUnitId;
  const removedMs = removed.logLine.timestamp;
  // fact2 R8 (2026-10-20): the application is read on the same stream every
  // CC reader reads — a same-ms REMOVED → APPLIED re-broadcast is no new
  // control, a recast its source logged is (`dropAuraRebroadcasts` with
  // `ccRecastSplitsResend`, as `analyzeCcBreaks`). 94e93f63 3:53: a server
  // re-apply 0.64 s before Sanctuary read `after 1s (~1s of it left)` for a
  // stun held 2.05 s.
  const unitById = new Map(units.map((u) => [u.id, u]));
  const all = target.auraEvents ?? [];
  const kept = new Set(
    dropAuraRebroadcasts(
      all,
      ccRecastSplitsResend(target.id, all, (id) => unitById.get(id)),
    ),
  );
  // walked on the original order, over the rows the filter keeps (the
  // removal itself may be the REMOVED of a pair it drops — a Sanctuary
  // removal the source re-applied in the same ms)
  const stream = all;
  let applied: (typeof stream)[number] | undefined;
  for (let i = stream.indexOf(removed) - 1; i >= 0; i--) {
    const x = stream[i]!;
    if (!kept.has(x)) continue;
    if (
      x.spellId === spellId &&
      x.srcUnitId === srcId &&
      (x.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        x.logLine.event === LogEvent.SPELL_AURA_REFRESH)
    ) {
      applied = x;
      break;
    }
  }
  if (!spellId || !applied) return {};
  return {
    heldSeconds: (removedMs - applied.timestamp) / 1000,
    leftSeconds: ccRemainingSeconds({
      spellId,
      holder: target,
      caster: units.find((u) => u.id === srcId),
      applyMs: applied.timestamp,
      endMs: removedMs,
      srcUnitId: srcId,
      matchStartMs,
      roarAtApply: oppressingRoarOnAt(target, applied),
      unitById,
    }),
  };
}

/** The controls Blessing of Sanctuary removed (`sanctuaryRemovalPairs`, the
 *  one pairing KILL ATTEMPTS reads too — fact4 D11 / D40), with what the
 *  control had run and had left. */
export function sanctuaryRemovals(
  units: readonly ICombatUnit[],
  matchStartMs: number,
): ICcRemovedBySanctuary[] {
  return sanctuaryRemovalPairs(units).map(
    ({ castMs, paladin, target, removed: a }) => ({
      atSeconds: (castMs - matchStartMs) / 1000,
      paladinId: paladin.id,
      paladinName: paladin.name,
      targetId: target.id,
      targetName: target.name,
      ccSpellId: a.spellId!,
      ccSpellName: getEnglishSpellName(a.spellId!, a.spellName),
      ccSourceName: a.srcUnitName ?? "",
      ...(a.srcUnitId ? { ccSourceId: a.srcUnitId } : {}),
      ...heldAndLeft(target, a, units, matchStartMs),
    }),
  );
}

// ── Owner's rejected presses outside CC ──────────────────────────────────────

export type RejectKind =
  "out of range" | "moving" | "no line of sight" | "vision obscured";

/** SPELL_CAST_FAILED reason texts per kind, for every client locale the
 *  corpus carries. The texts are the client's own strings (wago.tools
 *  GlobalStrings 12.1.0.69587: SPELL_FAILED_OUT_OF_RANGE / _MOVING /
 *  _LINE_OF_SIGHT), not translations. Forward check (Curated-List rule,
 *  triage position F-J1, 2026-10-01): every SPELL_CAST_FAILED reason on the
 *  605-file capture slice — before, the fr / ru / es / zh-TW clients' rejects
 *  were unmapped (out of range 255, moving 226, no line of sight 102 presses)
 *  and never formed a `[REJECTED]` run; after, 0. it-IT has official strings
 *  too but no press in that slice, so it is not listed.
 *
 *  "vision obscured" (B-tier X5, user ruling 2026-10-06) is
 *  SPELL_FAILED_VISION_OBSCURED — a different event from a pillar: DB2 gives
 *  the interfere-targeting aura (322) to Smoke Bomb 212183 and to Shadowy
 *  Duel, which 12.x no longer has, and on the 605 files 288 of its 320
 *  rejects (90.0 %) fall within 5.5 s after a Smoke Bomb cast against 31 of
 *  5,369 (0.6 %) for LINE_OF_SIGHT (tier-C C17). Its strings are the same
 *  GlobalStrings dump's (en 263 presses, zh-CN 49, ko 8; de / es-MX / pt-BR
 *  have none in the slice and are listed from the dump). The German "Die
 *  Sicht auf Euer Ziel ist behindert." sat under "no line of sight" until
 *  then. */
export const REJECT_REASONS: Readonly<Record<RejectKind, readonly string[]>> = {
  "out of range": [
    "Out of range",
    "超出范围",
    "超出範圍",
    "목표가 사정거리를 벗어났습니다.",
    "Außer Reichweite",
    "Fora de alcance",
    "Fuera de alcance",
    "Hors de portée",
    "Вне зоны действия.",
  ],
  moving: [
    "Can't do that while moving",
    "不能在移动中实施该动作",
    "不能在移動中執行該動作",
    "이동 중에는 사용할 수 없습니다.",
    "Das ist während einer Bewegung nicht möglich.",
    "Você não pode fazer isso em movimento",
    "No puedes hacer eso en movimiento",
    "Impossible en cours de déplacement",
    "Невозможно делать это на ходу.",
  ],
  "no line of sight": [
    "Target not in line of sight",
    "目标不在视野中",
    "目標不在視野中",
    "대상이 시야에 없습니다.",
    "Ziel ist nicht im Sichtfeld.",
    "Alvo fora do campo de visão.",
    "No puedes ver al objetivo",
    "Cible hors du champ de vision",
    "Цель вне поля зрения.",
  ],
  "vision obscured": [
    "Your vision of the target is obscured",
    "你的视线被遮挡了",
    "대상이 흐릿해서 포착할 수 없습니다.",
    "Die Sicht auf Euer Ziel ist behindert.",
    "Se ha oscurecido tu visión del objetivo",
    "Sua visão do alvo está obscurecida",
  ],
};

/** What a `[REJECTED]` line says after the dash, per kind. "vision obscured
 *  (Smoke Bomb)" is the user's wording (X5): the reject means the target
 *  stood in a Smoke Bomb, not behind a pillar. */
export const REJECT_WHY: Readonly<Record<RejectKind, string>> = {
  "out of range": "out of range",
  moving: "can't cast while moving",
  "no line of sight": "target not in line of sight",
  "vision obscured": "vision obscured (Smoke Bomb)",
};
const KIND_OF = new Map<string, RejectKind>(
  (Object.entries(REJECT_REASONS) as [RejectKind, readonly string[]][]).flatMap(
    ([k, texts]) => texts.map((t) => [t, k] as [string, RejectKind]),
  ),
);

/** The kind of one SPELL_CAST_FAILED reason text, when it is one of the four
 *  — the wording a `[CAST STOPPED]` line gives a refused cast bar
 *  (`timelineSections/castStopped.ts`) is this table's too. */
export function rejectKindOf(reason: string): RejectKind | undefined {
  return KIND_OF.get(reason);
}

/** What stands for a refusal reason none of the product's kinds words. The
 *  client's own text is not quoted: it is in the client's language, and the
 *  repo has no reading of "this log is in English" to quote it under
 *  (`[CAST STOPPED]`'s `CAST_REFUSED_OTHER_REASON` is this in brackets). */
export const REJECT_WHY_UNWORDED = "client reason not translated";

/** What `refusalWhy` says of a SPELL_CAST_FAILED whose reason is an
 *  interruption (`CAST_INTERRUPTED_REASONS`): the bar had begun — the game
 *  did not refuse the press. */
export const REJECT_WHY_BAR_STOPPED = "its cast bar began and was stopped";

/** SPELL_FAILED_ITEM_NOT_READY ("Item is not ready yet") in every client
 * locale the corpus carries — an item's own cooldown, the Gladiator's
 * Medallion's included. ru and ko added 2026-10-28 (fact6 F20, Curated-List
 * forward check on the reasons of 336126 SPELL_CAST_FAILED rows over the 605
 * + wide captures: ru 7 rows, ko 1, both unworded before). One list: the
 * refusal wording below and the trinket-lock scans
 * (`racialTrinketLockScan.ts`, `scan5/trinketLock.ts`) read it. */
export const ITEM_NOT_READY_REASONS: readonly string[] = [
  "Item is not ready yet",
  "物品还没有准备好",
  "物品還沒有準備好",
  "El objeto aún no está listo",
  "Gegenstand ist noch nicht bereit.",
  "L'objet n'est pas encore prêt",
  "Предмет еще не готов.",
  "아직 사용할 준비가 안 됐습니다.",
];

/**
 * More SPELL_CAST_FAILED reason texts `refusalWhy` words — product wording →
 * the client's texts, every locale the corpus carries them in (work order
 * 2026-10-14b fix 3: "client reason not translated" stood for 没有目标 /
 * 无效的目标 / 你还不能那么做 / 精华不足 / "Target needs to be in front of
 * you." / "Another action is in progress" on 4 of the 43 kick-eaten rows of
 * the PV382 re-eval). Read off the corpus, not translated: every reason text
 * on the 605-file capture and the 60 re-eval logs
 * (eval-private fix-FT/wo2/castfailed-reasons-*.txt, counted by
 * scripts/wo2_castfailed_reasons.py; unworded presses before
 * wo2/unworded-before.txt, after wo2/unworded-after.txt). A text whose meaning
 * is not plain from the string itself (Korean 아직 사용할 수 없습니다 next
 * to the "not ready" family; "You must be in front of your target.") is left
 * out. These words only: no `[REJECTED]` run (`REJECT_REASONS`) and no
 * not-ready classification moves with this table.
 */
export const OTHER_REFUSAL_REASONS: Readonly<
  Record<string, readonly string[]>
> = {
  "no target": [
    "No target",
    "没有目标",
    "No hay objetivo",
    "Pas de cible",
    "Kein Ziel",
    "Não há alvo",
    "Нет цели.",
  ],
  "invalid target": [
    "Invalid target",
    "无效的目标",
    "没有有效的目标。",
    "Objetivo no válido",
    "No hay objetivos válidos.",
    "Cible incorrecte",
    "Ungültiges Ziel",
    "Alvo inválido",
    "잘못된 대상입니다.",
  ],
  "target not in front": [
    "Target needs to be in front of you.",
    "你必须面对目标。",
    "你必須面對目標。",
    "El objetivo debe estar frente a ti.",
    "Les cibles doivent être devant vous.",
    "Ziel muss sich vor Euch befinden.",
    "Цель должна быть перед вами.",
    "대상이 앞에 있어야 합니다.",
  ],
  "target too close": [
    "Target too close",
    "目标过于接近",
    "El objetivo está demasiado cerca",
    "Cible trop proche",
    "Ziel ist zu nah.",
    "대상이 너무 가까이 있습니다.",
  ],
  "another action in progress": [
    "Another action is in progress",
    "另外一个动作正在进行中",
    "另外一個動作正在進行中",
    "Hay otra acción en curso",
    "Une autre action est en cours",
    "Es wird gerade eine andere Aktion ausgeführt.",
    "Outra ação está em andamento",
    "Выполняется другое действие.",
    "다른 행동을 마칠 때까지 기다려야 합니다.",
  ],
  "can't do that yet": [
    "You can't do that yet",
    "你还不能那么做",
    "你还不能那么做。",
    "你還不能這麼做",
    "你還不能這麼做。",
    "Vous ne pouvez pas encore faire cela",
    "Das könnt Ihr noch nicht.",
    "Вы пока не можете этого сделать.",
  ],
  "can't do that right now": [
    "You can't do that right now.",
    "Vous ne pouvez pas faire ça maintenant.",
    "Das könnt Ihr im Moment nicht tun.",
    "지금 당장은 할 수 없습니다.",
  ],
  "in combat": ["You are in combat", "你正处于交战状态"],
  "item not ready yet": ITEM_NOT_READY_REASONS,
  "not enough mana": ["Not enough mana", "法力值不足", "Pas assez de mana"],
  "not enough energy": ["Not enough energy", "能量值不足"],
  "not enough rage": ["Not enough rage", "Pas assez de rage"],
  "not enough focus": ["Not enough focus", "集中值不足"],
  "not enough fury": ["Not enough fury", "狂乱值不足", "恶魔之怒不足"],
  "not enough runes": ["Not enough runes", "符文不足"],
  "not enough runic power": ["Not enough runic power"],
  "not enough holy power": [
    "Not enough holy power",
    "神圣能量不足",
    "No tienes suficiente poder sagrado",
    "Nicht genügend Heilige Kraft",
    "Недостаточно энергии Света",
  ],
  "not enough soul shards": [
    "Not enough soul shards",
    "Pas assez d'éclats d'âme",
    "Nicht genügend Seelensplitter",
  ],
  "not enough essence": ["Not enough essence", "精华不足", "龍能不足"],
  "not enough insanity": ["Not enough insanity", "瘋狂不足"],
  "not enough chi": ["Not enough chi"],
  "not enough maelstrom": ["Not enough maelstrom"],
};
const OTHER_REFUSAL_OF = new Map<string, string>(
  Object.entries(OTHER_REFUSAL_REASONS).flatMap(([why, texts]) =>
    texts.map((t) => [t, why] as [string, string]),
  ),
);

/**
 * The reason the log gives for one SPELL_CAST_FAILED row, in the product's
 * words: the four `REJECT_WHY` kinds, "under crowd control" / "silenced"
 * (`CONTROL_REJECT_REASONS`), a cast bar that was stopped
 * (`CAST_INTERRUPTED_REASONS`), the `OTHER_REFUSAL_REASONS` kinds, else
 * `REJECT_WHY_UNWORDED`. Not for a "not
 * ready" refusal (`NOT_READY_REASONS`: a locked school, the spell's own
 * cooldown and the GCD all answer with it) — the caller sorts those out
 * first. One wording for kick-eaten's `postKick` and its gate
 * (`promptQualityCheck.checkKickEatenRefusedForAnotherReason`).
 */
export function refusalWhy(reason: string): string {
  const kind = rejectKindOf(reason);
  if (kind) return REJECT_WHY[kind];
  const control = controlRejectKindOf(reason);
  if (control) return CONTROL_REJECT_WHY[control];
  if (CAST_INTERRUPTED_REASONS.has(reason)) return REJECT_WHY_BAR_STOPPED;
  return OTHER_REFUSAL_OF.get(reason) ?? REJECT_WHY_UNWORDED;
}
/** Every text `refusalWhy` can return. */
export const REFUSAL_WHY_WORDS: readonly string[] = [
  ...Object.values(REJECT_WHY),
  ...Object.values(CONTROL_REJECT_WHY),
  REJECT_WHY_BAR_STOPPED,
  ...Object.keys(OTHER_REFUSAL_REASONS),
  REJECT_WHY_UNWORDED,
];

/** A run is stated from this many presses (the user's example: 12 Mortal
 *  Coil "Out of range"). */
export const REJECT_RUN_MIN = 3;
/** Presses further apart than this are separate runs. */
export const REJECT_RUN_GAP_S = 2;
/** B-tier B15b (user ruling 2026-10-06): a run that touches the last this
 *  many seconds before a friendly player's death is stated whatever its
 *  count — "you were reaching for him, he was behind the pillar" changes the
 *  reading of the death (9d899d10 2:41: two line-of-sight rejects and one
 *  "moving" 1.3 s before the Fire Mage died, no line). 60 triage rounds: 16
 *  of 47 friendly deaths had such presses, 31 in all. */
export const REJECT_NEAR_DEATH_S = 10;

export interface IRejectRun {
  fromSeconds: number;
  toSeconds: number;
  spellId: string;
  spellName: string;
  kind: RejectKind;
  count: number;
}

/** Runs of the same spell rejected for the same kind of reason (`castFailed`
 *  is match-relative seconds, parseRawStreams' clock). A run is stated from
 *  `REJECT_RUN_MIN` presses — or from one, when it touches the
 *  `REJECT_NEAR_DEATH_S` before one of `friendlyDeathSeconds` (B15b; the
 *  caller passes the owner's TEAMMATES' deaths, match-relative seconds).
 *  Control rejects are not a kind here and never enter (ruling 2026-09-26,
 *  unchanged). */
export function ownerRejectRuns(
  castFailed: readonly CastFailedEvent[],
  ownerId: string,
  friendlyDeathSeconds: readonly number[] = [],
): IRejectRun[] {
  const runs: IRejectRun[] = [];
  // one open run PER SPELL (round-1 retest idx 2 / 37): another spell's
  // refusal between two of this spell's presses is no break in this spell's
  // run — a Sleep Walk "out of range" inside five Echo "out of range"
  // presses cut them to ×4 + a dropped 1, a Dispatch "out of range" split a
  // ×4 Exsanguinate run into a dropped 1 and a ×3
  const open = new Map<string, IRejectRun>();
  const nearDeath = (r: IRejectRun) =>
    friendlyDeathSeconds.some(
      (d) => r.fromSeconds <= d && r.toSeconds >= d - REJECT_NEAR_DEATH_S,
    );
  const flush = (id: string) => {
    const cur = open.get(id);
    if (cur && (cur.count >= REJECT_RUN_MIN || nearDeath(cur))) runs.push(cur);
    open.delete(id);
  };
  // every owner failure takes part — the same spell refused for a reason
  // outside the three kinds ends its run instead of vanishing from between
  // two that match
  // (codex review of batch 13: Out of range / Not yet recovered / Out of
  // range … read as three consecutive out-of-range presses)
  const hits = castFailed
    .filter((h) => h.unitGuid === ownerId)
    .sort((a, b) => a.tSeconds - b.tSeconds);
  for (const h of hits) {
    const kind = KIND_OF.get(h.reason);
    const id = String(h.spellId);
    // a press refused by the global cooldown / an action in progress was
    // refused before the game read range, sight or movement: it neither
    // counts nor ends a run (fact4 D60, bb7e1d9f 0:58–0:59: six Execute
    // "Out of range" with one "You can't do that yet" between them read
    // `×4` and dropped the first two)
    if (!kind && RUN_TRANSPARENT_REASONS.has(h.reason)) continue;
    if (!kind) {
      // the same spell refused for another reason splits its run
      flush(id);
      continue;
    }
    const cur = open.get(id);
    if (
      cur &&
      cur.kind === kind &&
      h.tSeconds - cur.toSeconds <= REJECT_RUN_GAP_S
    ) {
      cur.toSeconds = h.tSeconds;
      cur.count++;
      continue;
    }
    flush(id);
    open.set(id, {
      fromSeconds: h.tSeconds,
      toSeconds: h.tSeconds,
      spellId: id,
      spellName: getEnglishSpellName(id, h.spellName),
      kind,
      count: 1,
    });
  }
  for (const id of [...open.keys()]) flush(id);
  return runs.sort((a, b) => a.fromSeconds - b.fromSeconds);
}

/** Refusal texts a reject run steps over (`ownerRejectRuns`): the global
 *  cooldown's and an action already in progress, every locale of
 *  `OTHER_REFUSAL_REASONS`. */
const RUN_TRANSPARENT_REASONS: ReadonlySet<string> = new Set([
  ...OTHER_REFUSAL_REASONS["another action in progress"]!,
  ...OTHER_REFUSAL_REASONS["can't do that yet"]!,
]);

/** `row` is one of the presses `run` counts: the owner's failure of that
 *  spell, for that kind of reason, inside the run's span. (A run takes every
 *  such press between its first and its last — a same-spell refusal for
 *  another reason ends it — so the span decides.) What a `[REJECTED]` line
 *  states is not said again by a `[CAST STOPPED]` line. */
export function rejectRunStatesRow(
  run: IRejectRun,
  row: CastFailedEvent,
): boolean {
  return (
    String(row.spellId) === run.spellId &&
    KIND_OF.get(row.reason) === run.kind &&
    row.tSeconds >= run.fromSeconds &&
    row.tSeconds <= run.toSeconds
  );
}
