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
import { pvpTrinketUses } from "../utils/pvpTrinketUses";
import type { CastFailedEvent } from "../utils/rawStreams";
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

/** The ids a reflect's damage comes back under when not the reflected
 * spell's own: Spell Reflection 23920. The 29 fact2 logs hold 392 such
 * SPELL_DAMAGE rows; 387 have a REFLECT row of the hit unit's spell on that
 * reflector within 3 s (the other 5 none) — 238 logged after it (up to
 * 2.9 s: the projectile's flight), the rest before it, at most 487 ms
 * (median 7 ms). */
export const REFLECT_OWN_DAMAGE_IDS: ReadonlySet<string> = new Set(["23920"]);
/** How far ahead of its REFLECT row such a row can be logged (measured max
 * 487 ms, above). */
export const REFLECT_OWN_ID_LEAD_MS = 500;

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
    // Each hit of the spell on its caster goes to ONE chain (codex reviews
    // of batch 13): a hit sourced from a reflector → that reflector's latest
    // chain before it; the caster's own tick → the latest chain of the spell
    // before it; never past REFLECT_DAMAGE_WINDOW_S. A later reflector no
    // longer cuts off an earlier reflector's explicitly attributed damage.
    const back = new Map<(typeof chains)[number], number>();
    const owning = (spellId: string, src: string | undefined, ts: number) => {
      let best: (typeof chains)[number] | undefined;
      for (const c of chains) {
        if (c.first.spellId !== spellId) continue;
        const t0 = c.first.logLine.timestamp;
        if (t0 > ts || ts - t0 > REFLECT_DAMAGE_WINDOW_S * 1000) continue;
        if (src !== caster.id && src !== c.first.destUnitId) continue;
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
    for (const d of caster.damageIn ?? []) {
      // fact2 (2026-10-20, Spell Reflection): a Warrior's reflect comes back
      // as a damage row of the reflector's own Spell Reflection id, logged a
      // few ms BEFORE the REFLECT row (08acb188 0:32: 67k under 23920, 6 ms
      // ahead; 0c8b1932: 17k landed under 23920 beside 122k absorbed under
      // the Pyroblast) — the reflector's latest chain within
      // `REFLECT_OWN_ID_LEAD_MS` of it owns it
      if (d.spellId && REFLECT_OWN_DAMAGE_IDS.has(d.spellId)) {
        const ts = d.logLine.timestamp;
        let best: (typeof chains)[number] | undefined;
        for (const c of chains) {
          if (c.first.destUnitId !== d.srcUnitId) continue;
          const t0 = c.first.logLine.timestamp;
          if (ts < t0 - REFLECT_OWN_ID_LEAD_MS) continue;
          if (ts - t0 > REFLECT_DAMAGE_WINDOW_S * 1000) continue;
          if (!best || t0 > best.first.logLine.timestamp) best = c;
        }
        if (best)
          back.set(best, (back.get(best) ?? 0) + Math.abs(d.effectiveAmount));
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
  const opponentIds = new Set(
    units.filter((u) => u.reaction !== target.reaction).map((u) => u.id),
  );
  return {
    heldSeconds: (removedMs - applied.timestamp) / 1000,
    leftSeconds: ccRemainingSeconds({
      spellId,
      holder: target,
      caster: units.find((u) => u.id === srcId),
      applyMs: applied.timestamp,
      endMs: removedMs,
      opponentIds,
      matchStartMs,
      roarAtApply: oppressingRoarOnAt(target, applied),
      unitById,
    }),
  };
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
        const selfBreak =
          pvpTrinketUses(target).some(
            (u) => Math.abs(u.atMs - rm) <= SANCTUARY_PAIR_MS,
          ) ||
          (target.spellCastEvents ?? []).some(
            (s) =>
              s.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              !!s.spellId &&
              BREAK_RACIAL_SPELL_IDS.has(s.spellId) &&
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
          ...heldAndLeft(target, a, units, matchStartMs),
        });
      }
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
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
  "item not ready yet": [
    "Item is not ready yet",
    "物品还没有准备好",
    "物品還沒有準備好",
    "El objeto aún no está listo",
    "Gegenstand ist noch nicht bereit.",
    "L'objet n'est pas encore prêt",
  ],
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
  let cur: IRejectRun | null = null;
  const nearDeath = (r: IRejectRun) =>
    friendlyDeathSeconds.some(
      (d) => r.fromSeconds <= d && r.toSeconds >= d - REJECT_NEAR_DEATH_S,
    );
  const flush = () => {
    if (cur && (cur.count >= REJECT_RUN_MIN || nearDeath(cur))) runs.push(cur);
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
