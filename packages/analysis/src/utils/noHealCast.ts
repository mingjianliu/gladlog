/**
 * noHealCast.ts — the stretch before the round's first death in which the
 * recording healer pressed no heal although nothing the log shows stopped
 * them (T88, user ruling R27 2026-11-11: a fact line, never a candidate).
 *
 * Only when the round's first death is a teammate of the healer's (the 3v3
 * first-death rule: nothing after it is reviewed), and only inside that
 * death's window (`DEATH_WINDOW_S`, the window whose casts the timeline
 * already prints one by one). A stretch is a run of time in which ALL of
 * these hold, the dispel family's feasibility doors:
 *
 *  1. the healer is not stopped from healing: no control or silence, no kick
 *     lockout that shuts every heal they pressed this round
 *     (`cannotCastIntervalsForSpells` over `pressedHeals`), no cast bar of
 *     their own running (`castBarOutcomesOf`) and no other commitment the
 *     missed-cleanse occupancy reader counts (`occupancyIntervalsWithin`);
 *  2. a heal is usable: one of the heals they pressed this round has no
 *     cooldown (so only the global cooldown stands between two presses —
 *     which is why a stretch has a minimum length, `NO_HEAL_MIN_STRETCH_MS`);
 *  3. the teammate who dies is within that heal's reach and line of sight is
 *     not disproven, at every whole second of the stretch
 *     (`pairInReachAt`, the dispel sweep's own test). A second with no
 *     position pair is not known to be in reach and ends the stretch.
 *
 * A heal press ends a stretch — every SUCCESS row of a spell that healed or
 * shielded anyone this round, the healer included (`healNamesOf` plus the
 * self-only heals), triggered rows included
 * — and so does a heal the client refused (SPELL_CAST_FAILED of one of them:
 * a try is not idle time). A stretch that begins or ends at a refused heal
 * while the healer's mana reads under `lowManaPct` is dropped: the log shows
 * the press and the empty bar, which is not "free to cast".
 *
 * A Holy Priest who went into Spirit of Redemption before the teammate died
 * has died first: no line for that round.
 *
 * A stretch is a line only when the dying teammate's HP went DOWN across it
 * (the grid reading of its printed end second under the one of its printed
 * start second, both known):
 * with no HP lost, "no heal pressed" says nothing (user ruling R30).
 *
 * NOT known here, stated rather than papered over: a low mana bar with no
 * refused press (reads as free — the line prints the reading, R30), a heal that heals only through damage
 * (Atonement: the damage press is no heal press here), and the healer's own
 * movement.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { DRUID_FORM_AURA_IDS } from "../data/druidForms";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
} from "../data/spellEffectData";
import { DEATH_WINDOW_S } from "../data/timelineLineFlags";
import {
  cannotCastIntervalsForSpells,
  enemySourceIds,
  healNamesOf,
  pressedHeals,
} from "./cannotCastIntervals";
import { castBarOutcomesOf, JUKE_LOOKBACK_MS } from "./castBarOutcomes";
import { PRESS_LANDED_SAME_INSTANT_MS } from "./castMissRows";
import {
  PRESSED_SPIRIT_OF_REDEMPTION_AURA_IDS,
  SPIRIT_OF_REDEMPTION_AURA_IDS,
} from "./combatStates";
import { gridHpPct } from "./cooldowns";
import { occupancyIntervalsWithin, pairInReachAt } from "./dispelAnalysis";
import { CC_MAX_CAST_RANGE_YARDS } from "./positionSampling";
import { foldSamePressRows, isNoPlayerPressRow } from "./pressRow";
import { manaPct, type RawStreams } from "./rawStreams";
import { toRenderSecond } from "./renderGrid";
import { spellReachForCaster } from "./spellRange";

/**
 * The shortest stretch that is a line. Editorial, read off the 605 corpus
 * (see the T88 preview): two global cooldowns — one press not made can be
 * the global cooldown of another button; two in a row cannot.
 */
export const NO_HEAL_MIN_STRETCH_MS = 3000;

/** The Tree of Life is a healing form: being in it explains no gap. */
const NON_HEALING_FORM_IDS = [...DRUID_FORM_AURA_IDS].filter(
  (id) => id !== "33891",
);

export interface INoHealStretch {
  fromMs: number;
  toMs: number;
  /** the teammate whose death is the round's first */
  targetName: string;
  /** the grid HP of that teammate at the stretch's two ends */
  hpFromPct: number | null;
  hpToPct: number | null;
  /** a form the healer was in for at least half of the stretch; `fromMs`
   * null when the log holds no APPLIED row of it */
  form?: { name: string; fromMs: number | null };
  /** what the healer pressed inside the stretch instead, English names in
   * press order (a spell pressed twice is there twice): every SUCCESS row
   * that is a press of its own (no passive proc, no companion row) */
  pressed: string[];
  /** the healer's mana at the stretch's start, percent; null when the log
   * holds no reading */
  manaPct: number | null;
}

type Span = { from: number; to: number };

function subtract(free: Span[], blocked: readonly Span[]): Span[] {
  let out = free;
  for (const b of blocked) {
    const next: Span[] = [];
    for (const f of out) {
      if (b.to <= f.from || b.from >= f.to) {
        next.push(f);
        continue;
      }
      if (b.from > f.from) next.push({ from: f.from, to: b.from });
      if (b.to < f.to) next.push({ from: b.to, to: f.to });
    }
    out = next;
  }
  return out;
}

function formSpans(
  owner: Pick<ICombatUnit, "auraEvents">,
  endMs: number,
): Array<Span & { name: string; applied: boolean }> {
  const out: Array<Span & { name: string; applied: boolean }> = [];
  for (const id of NON_HEALING_FORM_IDS) {
    let open: number | null = null;
    let seen = false;
    for (const a of owner.auraEvents ?? []) {
      if (a.spellId !== id) continue;
      const name = getEnglishSpellName(id, a.spellName ?? "");
      const ev = a.logLine.event as string;
      if (ev === "SPELL_AURA_APPLIED") {
        open = a.logLine.timestamp;
        seen = true;
      } else if (ev === "SPELL_AURA_REMOVED") {
        // a REMOVED with no APPLIED before it: in the form since before the log
        out.push({
          from: open ?? -Infinity,
          to: a.logLine.timestamp,
          name,
          applied: open !== null,
        });
        open = null;
        seen = true;
      }
    }
    if (open !== null && seen)
      out.push({
        from: open,
        to: endMs,
        name: getEnglishSpellName(id, ""),
        applied: true,
      });
  }
  return out;
}

export function noHealStretchesBeforeFirstDeath(params: {
  owner: ICombatUnit;
  friends: readonly ICombatUnit[];
  enemies: readonly ICombatUnit[];
  /** every unit of the round (pets, totems): the sources of a control */
  allUnits: readonly ICombatUnit[];
  /** the round's start, epoch ms */
  startMs: number;
  friendlyDeaths: ReadonlyArray<{ name: string; atSeconds: number }>;
  enemyDeaths: ReadonlyArray<{ name: string; atSeconds: number }>;
  zoneId: string | undefined;
  rawStreams?: RawStreams;
  /** the shortest stretch kept */
  minMs?: number;
  /** the mana reading under which a refused heal is read as "no mana"
   * (`MANA_PRESSURE_LOW_PCT`, handed in by the caller: the constant lives
   * above this module) */
  lowManaPct?: number;
}): INoHealStretch[] {
  const { owner, startMs, friendlyDeaths, enemyDeaths, zoneId } = params;
  const minMs = params.minMs ?? NO_HEAL_MIN_STRETCH_MS;
  if (friendlyDeaths.length === 0) return [];
  const first = friendlyDeaths.reduce((a, b) =>
    b.atSeconds < a.atSeconds ? b : a,
  );
  if (first.name === owner.name) return [];
  if (enemyDeaths.some((d) => d.atSeconds <= first.atSeconds)) return [];
  const target = params.friends.find((f) => f.name === first.name);
  if (!target) return [];

  // door 2: a heal with no cooldown among the heals pressed this round
  const heals = pressedHeals(owner);
  const healIds = [...heals.keys()];
  const spammable = healIds.filter(
    (id) => effectiveCooldownSeconds(id) === undefined,
  );
  if (spammable.length === 0) return [];
  const reachYd = Math.max(
    ...spammable.map(
      (id) => spellReachForCaster(owner, id) ?? CC_MAX_CAST_RANGE_YARDS,
    ),
  );

  const deathMs = startMs + first.atSeconds * 1000;
  const fromMs = Math.max(startMs, deathMs - DEATH_WINDOW_S * 1000);
  if (deathMs <= fromMs) return [];
  // in Spirit of Redemption before that death: the healer died first — the
  // on-death form only; the pressed one leaves the priest alive after it
  if (
    (owner.auraEvents ?? []).some(
      (a) =>
        SPIRIT_OF_REDEMPTION_AURA_IDS.has(a.spellId ?? "") &&
        !PRESSED_SPIRIT_OF_REDEMPTION_AURA_IDS.has(a.spellId ?? "") &&
        (a.logLine.event as string) === "SPELL_AURA_APPLIED" &&
        a.logLine.timestamp >= startMs &&
        a.logLine.timestamp <= deathMs,
    )
  )
    return [];

  const blocked: Span[] = [];
  // door 1: control, silence, a lockout that shuts every heal door 2 found
  // usable — a heal with a cooldown in another school is not known to be
  // off it, and opens no lockout (codex 85-tk-J-T88-2 #1)
  const enemyIds = enemySourceIds(params.enemies, params.allUnits);
  for (const iv of cannotCastIntervalsForSpells(
    owner,
    enemyIds,
    spammable,
    params.allUnits,
  ))
    blocked.push({ from: iv.from, to: iv.to });
  // … a cast bar of the healer's own, whatever it was
  const failed = (params.rawStreams?.castFailed ?? []).filter(
    (e) => e.unitGuid === owner.id,
  );
  const bars = castBarOutcomesOf({ unit: owner, startMs, failed });
  bars.forEach((b, i) => {
    const from = startMs + b.t * 1000;
    const endS =
      "atS" in b.end
        ? b.end.atS
        : Math.min(bars[i + 1]?.t ?? Infinity, b.t + JUKE_LOOKBACK_MS / 1000);
    blocked.push({ from, to: Math.max(from, startMs + endS * 1000) });
  });
  // … and every other commitment the missed-cleanse occupancy reader counts
  // (`occupancyIntervalsWithin`: channels by their aura or their last tick,
  // an empower being held, drinking)
  for (const o of occupancyIntervalsWithin(
    owner,
    enemyIds,
    fromMs,
    deathMs,
    failed.map((f) => ({
      spellId: String(f.spellId),
      ms: startMs + f.tSeconds * 1000,
    })),
  ) ?? [])
    blocked.push({ from: o.from, to: o.to });
  // door 3: reach, on the whole seconds of the render grid
  for (
    let t = startMs + Math.floor((fromMs - startMs) / 1000) * 1000;
    t < deathMs;
    t += 1000
  )
    if (pairInReachAt(owner, target, t, zoneId, reachYd) !== true)
      blocked.push({ from: t, to: t + 1000 });

  // a heal press, or a refused one, ends a stretch
  // … on anyone, the healer included: a heal pressed on oneself is a heal
  // pressed (the line says "no heal pressed", and names every other press)
  const healNames = healNamesOf(owner);
  for (const r of [...(owner.healOut ?? []), ...(owner.absorbsOut ?? [])]) {
    const n = getEnglishSpellName(r.spellId ?? "", "");
    if (n !== "") healNames.add(n);
  }
  // (a shield that absorbed nothing all round has no row to know it by and
  // is listed as a press: DB2's absorb flag is no test for it — it also
  // marks Fortifying Brew, Blessing of Sacrifice and 90 more; codex
  // 85-tk-J-T88-2 #2, synthetic, not on 605)
  const isHeal = (id: string, name: string) =>
    heals.has(id) || healNames.has(getEnglishSpellName(id, name));
  // what the healer pressed, one row a press: the shared press-row reader
  // (`isNoPlayerPressRow`), then `foldSamePressRows` — a Power Infusion logs
  // one row on its target and one on the priest 1 ms later, and read
  // "Power Infusion ×2" off the raw rows (codex 80-PIPE-49-B49-v1-T88). Not
  // `filterRealPresses`: it folds presses a global cooldown apart.
  const casts = owner.spellCastEvents ?? [];
  const presses = foldSamePressRows(
    casts.filter(
      (e) =>
        (e.logLine.event as string) === "SPELL_CAST_SUCCESS" &&
        !isNoPlayerPressRow(e, casts),
    ),
  );
  // …and a press whose heal the log writes under another name is a heal
  // press too (user ruling 2026-11-13, R38: Divine Toll on a teammate heals
  // as Holy Shock): a direct heal row of the healer's on the TEAMMATE the
  // press was cast on, in the press's own instant
  // (`PRESS_LANDED_SAME_INSTANT_MS`, the bound main reads a press's heal row
  // on a unit by; Divine Toll's Holy Shock lands 40–90 ms after its cast row
  // in 299 of 341 presses on a teammate, 605 archives — inside 50 ms, 77).
  // A heal that only reached the healer does not
  // count, nor does a periodic tick — nor a heal row on somebody the press
  // was not cast on (user ruling 2026-11-13, R39): with any teammate's row
  // counting, 21,077 presses of the 605 archives' healers matched, most of
  // them next to a heal that was not theirs (Fade beside a Prayer of Mending
  // bounce); on the pressed teammate, 4,669.
  const mateIds = new Set(
    params.friends.map((f) => f.id).filter((id) => id !== owner.id),
  );
  const mateHeals = (owner.healOut ?? []).filter(
    (h) =>
      h.srcUnitId === owner.id &&
      mateIds.has(h.destUnitId) &&
      (h.logLine.event as string) !== "SPELL_PERIODIC_HEAL",
  );
  const healsByEffect = presses.filter(
    (e) =>
      !isHeal(e.spellId ?? "", e.spellName ?? "") &&
      mateHeals.some(
        (h) =>
          h.destUnitId === e.destUnitId &&
          Math.abs(h.logLine.timestamp - e.logLine.timestamp) <=
            PRESS_LANDED_SAME_INSTANT_MS,
      ),
  );
  const refusedAt = failed
    .filter((e) => isHeal(String(e.spellId), e.spellName))
    .map((e) => startMs + e.tSeconds * 1000);
  const cuts = [
    ...(owner.spellCastEvents ?? [])
      .filter(
        (e) =>
          (e.logLine.event as string) === "SPELL_CAST_SUCCESS" &&
          isHeal(e.spellId ?? "", e.spellName ?? ""),
      )
      .map((e) => e.logLine.timestamp),
    ...healsByEffect.map((e) => e.logLine.timestamp),
    ...refusedAt,
  ];
  for (const t of cuts) blocked.push({ from: t, to: t });

  let free = subtract([{ from: fromMs, to: deathMs }], blocked);
  // a zero-length cut splits the run it sits strictly inside
  for (const t of cuts)
    free = free.flatMap((f) =>
      t > f.from && t < f.to
        ? [
            { from: f.from, to: t },
            { from: t, to: f.to },
          ]
        : [f],
    );

  // a refused heal at either end with the mana bar low: no mana, not idle
  const manaAt = (tMs: number): number | null => {
    const tS = (tMs - startMs) / 1000;
    let last: number | null = null;
    for (const m of params.rawStreams?.manaSamples ?? []) {
      if (m.unitGuid !== owner.id) continue;
      if (m.tSeconds > tS) break;
      last = manaPct(m);
    }
    return last;
  };
  const outOfMana = (f: Span) =>
    params.lowManaPct !== undefined &&
    refusedAt.some((t) => {
      if (t !== f.from && t !== f.to) return false;
      const pct = manaAt(t);
      return pct !== null && pct < params.lowManaPct!;
    });

  const gridMs = (t: number) =>
    startMs + toRenderSecond((t - startMs) / 1000) * 1000;
  const forms = formSpans(owner, deathMs);
  return (
    free
      .filter((f) => f.to - f.from >= minMs && !outOfMana(f))
      .sort((a, b) => a.from - b.from)
      .map((f) => {
        const form = forms
          .map((s) => ({
            s,
            overlap: Math.min(s.to, f.to) - Math.max(s.from, f.from),
          }))
          .filter((x) => x.overlap * 2 >= f.to - f.from)
          .sort((a, b) => b.overlap - a.overlap)[0]?.s;
        return {
          fromMs: f.from,
          toMs: f.to,
          targetName: target.name,
          // the HP of the seconds the line prints (`fmtTime` floors)
          hpFromPct: gridHpPct(target, gridMs(f.from)),
          hpToPct: gridHpPct(target, gridMs(f.to)),
          ...(form
            ? {
                form: {
                  name: form.name,
                  fromMs: form.applied ? form.from : null,
                },
              }
            : {}),
          pressed: presses
            .filter(
              (e) => e.logLine.timestamp > f.from && e.logLine.timestamp < f.to,
            )
            .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp)
            .map((e) => getEnglishSpellName(e.spellId ?? "", e.spellName ?? ""))
            .filter((n) => n !== ""),
          manaPct: manaAt(f.from),
        };
      })
      // R30: only a stretch across which the teammate lost HP
      .filter(
        (s) =>
          s.hpFromPct !== null &&
          s.hpToPct !== null &&
          Math.round(s.hpToPct) < Math.round(s.hpFromPct),
      )
  );
}
