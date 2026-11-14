/**
 * What obscured a target when the client refused a cast with
 * SPELL_FAILED_VISION_OBSCURED ("Your vision of the target is obscured").
 *
 * Pipeline T108 (fact13 D24, ec49887a r0 1:12): every such refusal read
 * "vision obscured (Smoke Bomb)" from a fixed wording; the match had no Rogue
 * and the nine refusals sat inside an enemy Shaman's Burrow. The refusal row
 * names no target, so the cause is read off the fight at the refusal's
 * instant, from official data (`visionObscuringAuraGenerated.ts`):
 *
 *  - an aura of DB2 aura 322 (MOD_INTERFERE_TARGETTING) up on a unit other
 *    than the caster — Burrow 409293 is the observed one — through
 *    `buildAuraIntervals`, the one aura pairing (a lost REMOVED is capped at
 *    the official length there);
 *  - else a Smoke Bomb area (the same-name area casts, 212182 / 359053; their
 *    aura 212183 is never logged) whose cast is at most its official length
 *    plus `OBSCURING_AREA_SLACK_S` before the refusal.
 *
 * Neither → no cause, and the readers print the client's reason alone.
 *
 * One predicate for every reader of a refusal's wording: the streams are
 * tagged once (`withVisionObscuredCauses`, at `buildMatchContext` and
 * `extractCandidateFindings`), and `refusalWhy` / `ownerRejectRuns` read the
 * tag.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { spellEffectData } from "../data/spellEffectData";
import {
  VISION_OBSCURING_AREA_CASTS,
  VISION_OBSCURING_AURAS,
} from "../data/visionObscuringAuraGenerated";
import { buildAuraIntervals } from "./auraIntervals";
import type { CastFailedEvent, RawStreams } from "./rawStreams";

/** The SPELL_CAST_FAILED reason texts of SPELL_FAILED_VISION_OBSCURED —
 * `spellOutcomeLines.REJECT_REASONS["vision obscured"]` is this list. */
export const VISION_OBSCURED_REASONS: readonly string[] = [
  "Your vision of the target is obscured",
  "你的视线被遮挡了",
  "대상이 흐릿해서 포착할 수 없습니다.",
  "Die Sicht auf Euer Ziel ist behindert.",
  "Se ha oscurecido tu visión del objetivo",
  "Sua visão do alvo está obscurecida",
];
const VISION_OBSCURED_REASON_SET = new Set(VISION_OBSCURED_REASONS);

const AURA_IDS = new Set(Object.keys(VISION_OBSCURING_AURAS));
const AREA_CAST_IDS = new Set(Object.keys(VISION_OBSCURING_AREA_CASTS));

/** Every name a cause can carry (the generated tables' English names): what
 * the refusal word lists the gates read are built from. */
export const VISION_OBSCURED_CAUSE_NAMES: readonly string[] = [
  ...new Set([
    ...Object.values(VISION_OBSCURING_AURAS),
    ...Object.values(VISION_OBSCURING_AREA_CASTS),
  ]),
].filter((n) => n !== "");

/** Past a Smoke Bomb's official 5 s, how long a refusal still counts as its
 * — the X5 calibration (2026-10-06) read the area's refusals as "within
 * 5.5 s after the cast"; T108's forward check on the 605 files measured the
 * same edge (see the commit). */
export const OBSCURING_AREA_SLACK_S = 0.5;

export interface IObscuringWindow {
  fromS: number;
  toS: number;
  /** the English spell name the line prints */
  name: string;
  /** the aura's holder; absent for an area, which obscures whoever is in it */
  holderId?: string;
  /** an aura on a unit (true) or an area cast (false) */
  onUnit: boolean;
}

interface CombatLike {
  startTime: number;
  endTime: number;
  units?: Readonly<Record<string, ICombatUnit>>;
}

const windowsCache = new WeakMap<object, Map<number, IObscuringWindow[]>>();

/** Every window in the round where something obscured a target (seconds since
 * `combat.startTime`, the rawStreams clock), auras on a unit first. */
export function visionObscuringWindows(combat: CombatLike): IObscuringWindow[] {
  const units = combat.units;
  if (!units) return [];
  let byStart = windowsCache.get(units);
  const hit = byStart?.get(combat.startTime);
  if (hit) return hit;
  const onUnit: IObscuringWindow[] = [];
  const areas: IObscuringWindow[] = [];
  for (const u of Object.values(units)) {
    if ((u.auraEvents ?? []).some((e) => AURA_IDS.has(e.spellId ?? "")))
      for (const iv of buildAuraIntervals(u, combat))
        if (AURA_IDS.has(iv.spellId))
          onUnit.push({
            fromS: iv.fromS,
            toS: iv.toS,
            name: VISION_OBSCURING_AURAS[iv.spellId]!,
            holderId: u.id,
            onUnit: true,
          });
    for (const c of u.spellCastEvents ?? []) {
      const id = c.spellId ?? "";
      if (!AREA_CAST_IDS.has(id)) continue;
      const lengthS = spellEffectData[id]?.durationSeconds;
      if (!lengthS) continue;
      const atS = (c.logLine.timestamp - combat.startTime) / 1000;
      areas.push({
        fromS: atS,
        toS: atS + lengthS + OBSCURING_AREA_SLACK_S,
        name: VISION_OBSCURING_AREA_CASTS[id]!,
        onUnit: false,
      });
    }
  }
  const out = [
    ...onUnit.sort((a, b) => a.fromS - b.fromS),
    ...areas.sort((a, b) => a.fromS - b.fromS),
  ];
  if (!byStart) {
    byStart = new Map();
    windowsCache.set(units, byStart);
  }
  byStart.set(combat.startTime, out);
  return out;
}

/** What obscured the target of `casterId`'s refusal at `tSeconds`: an
 * obscuring aura up on another unit, else a Smoke Bomb area still down;
 * undefined for neither. */
export function visionObscuredCause(
  windows: readonly IObscuringWindow[],
  casterId: string,
  tSeconds: number,
): string | undefined {
  return windows.find(
    (w) => w.holderId !== casterId && w.fromS <= tSeconds && tSeconds <= w.toS,
  )?.name;
}

/** Whether a SPELL_CAST_FAILED reason is the vision-obscured one. */
export function isVisionObscuredReason(reason: string): boolean {
  return VISION_OBSCURED_REASON_SET.has(reason);
}

const tagged = new WeakSet<object>();
const taggedCache = new WeakMap<object, WeakMap<object, RawStreams>>();

/**
 * The round's raw streams with every vision-obscured refusal carrying its
 * cause (`CastFailedEvent.obscuredBy`); the same object when there is none to
 * tag, or when it was tagged already. Rows are copied, never written — the
 * desktop caches the streams it hands over.
 */
export function withVisionObscuredCauses<T extends RawStreams | undefined>(
  rawStreams: T,
  combat: CombatLike | undefined,
): T {
  if (!rawStreams?.available || !combat?.units || tagged.has(rawStreams))
    return rawStreams;
  let byCombat = taggedCache.get(rawStreams);
  const hit = byCombat?.get(combat.units);
  if (hit) return hit as T;
  if (!rawStreams.castFailed.some((h) => isVisionObscuredReason(h.reason)))
    return rawStreams;
  const windows = visionObscuringWindows(combat);
  const castFailed: CastFailedEvent[] = rawStreams.castFailed.map((h) => {
    if (!isVisionObscuredReason(h.reason)) return h;
    const by = visionObscuredCause(windows, h.unitGuid, h.tSeconds);
    return by ? { ...h, obscuredBy: by } : h;
  });
  const out: RawStreams = { ...rawStreams, castFailed };
  tagged.add(out);
  if (!byCombat) {
    byCombat = new WeakMap();
    taggedCache.set(rawStreams, byCombat);
  }
  byCombat.set(combat.units, out);
  return out as T;
}
