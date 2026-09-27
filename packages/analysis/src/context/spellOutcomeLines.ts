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

import { BREAK_RACIAL_SPELL_IDS } from "../data/racialAbilities";
import { ROOT_SPELL_IDS } from "../data/rootSpells";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import { getSortedAdvancedActions } from "../utils/advancedActions";
import { binarySearchClosest } from "../utils/binarySearch";
import { PVP_TRINKET_SPELL_IDS } from "../utils/killWindowTargetSelection";
import type { CastFailedEvent } from "../utils/rawStreams";
import { GROUNDING_TOTEM_NPC_ID, getNpcIdFromGuid } from "./timelineHelpers";

/** A control: the official hard-CC set or a root ("控制要写"). */
export function isControlSpell(spellId: string): boolean {
  return ccSpellIds.has(spellId) || ROOT_SPELL_IDS.has(spellId);
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

/** Every control cast whose destination was a Grounding Totem — the log's
 *  own statement that the server redirected it (7d1f: a Cyclone and a
 *  Polymorph). Whether it then landed on the totem is not always logged: a
 *  Hammer of Justice into a totem leaves no SPELL_MISSED and totem deaths are
 *  never logged (0 in 200 files, 2026-09-27) — so the line says "redirected
 *  into", not "eaten" (codex review of batch 13: a projectile can outlive the
 *  totem; requiring the miss line dropped 115 of 504 true redirects).
 *  `skipCasterIds`: the log owner's own casts already carry "[absorbed:
 *  Grounding Totem]". */
export function groundedControls(
  units: readonly ICombatUnit[],
  matchStartMs: number,
  skipCasterIds: ReadonlySet<string>,
): IGroundedCc[] {
  const out: IGroundedCc[] = [];
  for (const u of units) {
    if (skipCasterIds.has(u.id)) continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (!c.spellId || !isControlSpell(c.spellId)) continue;
      if (getNpcIdFromGuid(c.destUnitId ?? "") !== GROUNDING_TOTEM_NPC_ID)
        continue;
      out.push({
        atSeconds: (c.logLine.timestamp - matchStartMs) / 1000,
        casterId: u.id,
        casterName: u.name,
        spellId: c.spellId,
        spellName: getEnglishSpellName(c.spellId, c.spellName),
        totemId: c.destUnitId!,
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
 *  (a reflected DoT ticks on the caster). */
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
}

function maxHpNear(unit: ICombatUnit, tMs: number): number | null {
  const a = binarySearchClosest(
    getSortedAdvancedActions(unit),
    tMs,
    (x) => x.logLine.timestamp,
  );
  if (!a || a.advancedActorId !== unit.id || a.advancedActorMaxHp <= 0)
    return null;
  return a.advancedActorMaxHp;
}

/** Reflects of one caster's spell by one reflector this close together are
 *  one reflect event — a channel's bolts (Penance) each log their own
 *  REFLECT; 0051f0c9-style four identical "came back for 59k" lines. */
export const REFLECT_CHAIN_GAP_MS = 3000;

export function reflectedSpells(
  units: readonly ICombatUnit[],
  matchStartMs: number,
): IReflected[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: IReflected[] = [];
  for (const caster of units) {
    const reflects = (caster.missesOut ?? [])
      .filter((m) => m.missType === "REFLECT" && !!m.spellId)
      .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
    // chains: same spell, same reflector, ≤ REFLECT_CHAIN_GAP_MS apart (this
    // also folds one reflect logged once per effect at the same ms)
    const chains: Array<{ first: (typeof reflects)[number]; last: number }> =
      [];
    for (const m of reflects) {
      const c = [...chains]
        .reverse()
        .find(
          (x) =>
            x.first.spellId === m.spellId &&
            x.first.destUnitId === m.destUnitId,
        );
      if (c && m.logLine.timestamp - c.last <= REFLECT_CHAIN_GAP_MS)
        c.last = m.logLine.timestamp;
      else chains.push({ first: m, last: m.logLine.timestamp });
    }
    for (const { first: m } of chains) {
      const reflector = byId.get(m.destUnitId ?? "");
      if (!reflector) continue;
      const t0 = m.logLine.timestamp;
      // a hit belongs to the latest reflect event of the spell before it —
      // never to two (codex review of batch 13: two warriors' reflects of one
      // priest's Shadow Word: Pain both claimed the same 100k); within the
      // window only what the reflect sent back: the reflector, or the
      // caster's own DoT ticking on itself — not another enemy casting the
      // same spell at the caster (agy review of batch 13)
      const next = chains
        .map((c) => c.first)
        .filter((x) => x.spellId === m.spellId && x.logLine.timestamp > t0)
        .reduce((lo, x) => Math.min(lo, x.logLine.timestamp), Infinity);
      const t1 = Math.min(t0 + REFLECT_DAMAGE_WINDOW_S * 1000, next - 1);
      const fromReflect = (src: string | undefined) =>
        src === reflector.id || src === caster.id;
      let back = 0;
      for (const d of caster.damageIn ?? [])
        if (
          d.spellId === m.spellId &&
          fromReflect(d.srcUnitId) &&
          d.logLine.timestamp >= t0 &&
          d.logLine.timestamp <= t1
        )
          back += Math.abs(d.effectiveAmount);
      for (const a of caster.absorbsIn ?? [])
        if (
          a.attackSpellId === m.spellId &&
          fromReflect(a.attackerId) &&
          a.timestamp >= t0 &&
          a.timestamp <= t1
        )
          back += Math.abs(a.absorbedAmount);
      const isControl = isControlSpell(m.spellId!);
      if (!isControl) {
        const maxHp = maxHpNear(caster, t0);
        if (maxHp === null || (back / maxHp) * 100 < REFLECT_MIN_DAMAGE_PCT)
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
        damageBack: back,
      });
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

// ── Blessing of Sanctuary ────────────────────────────────────────────────────

export const BLESSING_OF_SANCTUARY_ID = "210256";
/** Same-instant pairing, the TRINKET_BREAK_AFTER_REMOVAL_MS scale. */
const SANCTUARY_PAIR_MS = 50;

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
}

/** A control that left its target within 50 ms AFTER Blessing of Sanctuary
 *  landed on it (0035285c: Kidney Shot removed at the Sanctuary's ms), with
 *  no competing cause: a removal before the landing, or at an instant the
 *  target itself pressed a PvP trinket / break racial, is not the
 *  Sanctuary's (codex review of batch 13 — a trinket at 10.000 s credited to
 *  a Sanctuary at 10.030 s). */
export function sanctuaryRemovals(
  units: readonly ICombatUnit[],
  matchStartMs: number,
): ICcRemovedBySanctuary[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: ICcRemovedBySanctuary[] = [];
  for (const pal of units) {
    for (const c of pal.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (c.spellId !== BLESSING_OF_SANCTUARY_ID) continue;
      const target = byId.get(c.destUnitId ?? "");
      if (!target) continue;
      const t = c.logLine.timestamp;
      for (const a of target.auraEvents ?? []) {
        if (a.logLine.event !== LogEvent.SPELL_AURA_REMOVED) continue;
        if (!a.spellId || !isControlSpell(a.spellId)) continue;
        const rm = a.logLine.timestamp;
        if (rm < t || rm - t > SANCTUARY_PAIR_MS) continue;
        const selfBreak = (target.spellCastEvents ?? []).some(
          (s) =>
            s.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
            !!s.spellId &&
            (PVP_TRINKET_SPELL_IDS.has(s.spellId) ||
              BREAK_RACIAL_SPELL_IDS.has(s.spellId)) &&
            Math.abs(s.logLine.timestamp - rm) <= SANCTUARY_PAIR_MS,
        );
        if (selfBreak) continue;
        out.push({
          atSeconds: (t - matchStartMs) / 1000,
          paladinId: pal.id,
          paladinName: pal.name,
          targetId: target.id,
          targetName: target.name,
          ccSpellId: a.spellId,
          ccSpellName: getEnglishSpellName(a.spellId, a.spellName),
          ccSourceName: a.srcUnitName ?? "",
          ...(a.srcUnitId ? { ccSourceId: a.srcUnitId } : {}),
        });
      }
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

// ── Owner's rejected presses outside CC ──────────────────────────────────────

export type RejectKind = "out of range" | "moving" | "no line of sight";

/** SPELL_CAST_FAILED reason texts per kind, every client locale the corpus
 *  carries (60-file scan, 2026-09-26). */
export const REJECT_REASONS: Readonly<Record<RejectKind, readonly string[]>> = {
  "out of range": [
    "Out of range",
    "超出范围",
    "목표가 사정거리를 벗어났습니다.",
    "Außer Reichweite",
    "Fora de alcance",
  ],
  moving: [
    "Can't do that while moving",
    "不能在移动中实施该动作",
    "이동 중에는 사용할 수 없습니다.",
    "Das ist während einer Bewegung nicht möglich.",
    "Você não pode fazer isso em movimento",
  ],
  "no line of sight": [
    "Target not in line of sight",
    "目标不在视野中",
    "대상이 시야에 없습니다.",
    "Ziel ist nicht im Sichtfeld.",
    "Die Sicht auf Euer Ziel ist behindert.",
    "Alvo fora do campo de visão.",
  ],
};
const KIND_OF = new Map<string, RejectKind>(
  (Object.entries(REJECT_REASONS) as [RejectKind, readonly string[]][]).flatMap(
    ([k, texts]) => texts.map((t) => [t, k] as [string, RejectKind]),
  ),
);

/** A run is stated from this many presses (the user's example: 12 Mortal
 *  Coil "Out of range"). */
export const REJECT_RUN_MIN = 3;
/** Presses further apart than this are separate runs. */
export const REJECT_RUN_GAP_S = 2;

export interface IRejectRun {
  fromSeconds: number;
  toSeconds: number;
  spellId: string;
  spellName: string;
  kind: RejectKind;
  count: number;
}

/** Runs of the same spell rejected for the same kind of reason (`castFailed`
 *  is match-relative seconds, parseRawStreams' clock). */
export function ownerRejectRuns(
  castFailed: readonly CastFailedEvent[],
  ownerId: string,
): IRejectRun[] {
  const runs: IRejectRun[] = [];
  let cur: IRejectRun | null = null;
  const flush = () => {
    if (cur && cur.count >= REJECT_RUN_MIN) runs.push(cur);
    cur = null;
  };
  // every owner failure takes part — the same spell refused for a reason
  // outside the three kinds ends the run instead of vanishing from between
  // two that match
  // (codex review of batch 13: Out of range / Not yet recovered / Out of
  // range … read as three consecutive out-of-range presses)
  const hits = castFailed
    .filter((h) => h.unitGuid === ownerId)
    .sort((a, b) => a.tSeconds - b.tSeconds);
  for (const h of hits) {
    const kind = KIND_OF.get(h.reason);
    if (!kind) {
      // the same spell refused for another reason splits its run; another
      // spell's not-ready press does not (it never did for a matching kind
      // either — only a different spell/kind WITH a kind flushed)
      if (cur && cur.spellId === String(h.spellId)) flush();
      continue;
    }
    const id = String(h.spellId);
    if (
      cur &&
      cur.spellId === id &&
      cur.kind === kind &&
      h.tSeconds - cur.toSeconds <= REJECT_RUN_GAP_S
    ) {
      cur.toSeconds = h.tSeconds;
      cur.count++;
      continue;
    }
    flush();
    cur = {
      fromSeconds: h.tSeconds,
      toSeconds: h.tSeconds,
      spellId: id,
      spellName: getEnglishSpellName(id, h.spellName),
      kind,
      count: 1,
    };
  }
  flush();
  return runs;
}
