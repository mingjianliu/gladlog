import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { buffFullDurationForCaster } from "./buffDuration";

/**
 * F15 / fact1215 R4 + C4 (2026-10-18): who broke an aura, read from a
 * `SPELL_AURA_BROKEN_SPELL` row. The row's source is usually the breaker, but
 * not always — 605 files, 17,529 such rows:
 *
 *  - 227 name the HOLDER as the source. 68 of them carry a hit of the
 *    breaking spell on the holder from another unit 0–22 ms before (a
 *    Desperate Soul's Wrath of Nathreza, Mograine's Death and Decay, a
 *    Primal Fire Elemental's Immolate, a pet's Bloodshed) — that unit broke
 *    it (06356dd9: "broken by 6(MMonk)'s Wrath of Nathreza", the warlock's
 *    own guardian breaking his own Howl of Terror). 5 more carry no hit but a
 *    damage-over-time of the breaking spell another unit put on the holder
 *    (the tick logs the holder as its source) — its caster broke it. The
 *    rest are the holder's own mechanics (Stagger, Time Dilation's delayed
 *    damage, Refraction, Ultimate Sacrifice): the holder, as logged.
 *  - 399 are a Blessing of Sacrifice DAMAGE_SPLIT: the row's source is the
 *    PROTECTED ally the damage was moved off, and the damage moved onto the
 *    paladin by the paladin's own Blessing (2abc1934: "broken by
 *    5(BMHunter)'s Blessing of Sacrifice" — Honeyduw's Blessing). When the
 *    holder carries its own link aura of the split spell
 *    (`CASTER_SIDE_LINK_AURA_IDS` is that aura's table), the holder's
 *    spell broke it. Soul Link's 135 rows name the warlock, whose spell it
 *    is: as logged.
 *
 * `undefined` = the row has no source (a priest's own Shadow Word: Death
 * backlash): the readers state the spell alone. Shared by `auraBreakAtRemoval`
 * (the `broken by X's Y` note of the control lines and [BUFF FADED]) and
 * `analyzeCcBreaks` ([CC BROKEN], squander quadrants).
 */
export interface IBrokenRowBreaker {
  unitId: string;
  name: string;
}

/** How far before the BROKEN_SPELL row the breaking hit is looked for on the
 * holder's incoming damage: on 605 files the 68 rows that name the holder
 * while another unit's hit carries the spell sit 0–22 ms after it. */
export const BREAKING_HIT_LOOKBACK_MS = 100;

/** The aura a damage-transfer external leaves on its CASTER — the link the
 * moved damage comes in through, no protection of the caster's own (605
 * files: 948 of Blessing of Sacrifice's 969 caster-on-caster 6940 auras sit
 * in the millisecond of a cast on someone else, 0 with a cast on the caster;
 * every other major defensive's own-aura is the defensive itself — Survival
 * of the Fittest, Touch of Karma, Obsidian Scales included). Read by
 * `isCasterSideLinkAura` and the split rule above. */
export const CASTER_SIDE_LINK_AURA_IDS: ReadonlySet<string> = new Set([
  "6940", // Blessing of Sacrifice
]);

/** A caster-side link aura: the transfer external's aura on its own caster
 * (source = holder). Not a defensive on that unit — [STACKED DEFENSIVES]
 * and the "already protected" readers of `majorWallIntervals` leave it out
 * (0f894aee, 16ad8044: the paladin's own Blessing link stacked with Time
 * Dilation / Obsidian Scales). */
export const isCasterSideLinkAura = (
  spellId: string,
  srcIsHolder: boolean,
): boolean => srcIsHolder && CASTER_SIDE_LINK_AURA_IDS.has(spellId);

type AuraRow = ICombatUnit["auraEvents"][number];

const isNoSource = (id: string | undefined): boolean => !id || /^0+$/.test(id);

export function breakerOfBrokenRow(
  holder: Pick<ICombatUnit, "id" | "name" | "auraEvents" | "damageIn">,
  brk: AuraRow,
): IBrokenRowBreaker | undefined {
  if (isNoSource(brk.srcUnitId)) return undefined;
  const asLogged = { unitId: brk.srcUnitId, name: brk.srcUnitName ?? "" };
  const spellId = String(brk.logLine.parameters?.[11] ?? "");
  if (!spellId) return asLogged;
  const atMs = brk.logLine.timestamp;
  const line = brk.logLine.lineIndex;
  // the latest hit of the breaking spell on the holder before the row: in
  // the row's own millisecond only when both line indexes say it came first
  // (codex 20-F15-19: without them, a hit logged after the row in that ms
  // would be taken for the breaker)
  const hits = (holder.damageIn ?? []).filter(
    (d) =>
      d.spellId === spellId &&
      d.logLine.timestamp >= atMs - BREAKING_HIT_LOOKBACK_MS &&
      (d.logLine.timestamp < atMs ||
        (d.logLine.timestamp === atMs &&
          line !== undefined &&
          d.logLine.lineIndex !== undefined &&
          d.logLine.lineIndex < line)),
  );
  const hit = hits[hits.length - 1];
  const auras = holder.auraEvents ?? [];
  const before = auras.slice(0, Math.max(0, auras.indexOf(brk)));
  // damage moved onto the holder by its own link (Blessing of Sacrifice)
  if (
    hit &&
    (hit.logLine.event as string) === LogEvent.DAMAGE_SPLIT &&
    CASTER_SIDE_LINK_AURA_IDS.has(spellId) &&
    linkUp(before, spellId, holder.id)
  )
    return { unitId: holder.id, name: holder.name };
  if (brk.srcUnitId !== holder.id) return asLogged;
  // the row names the holder: the hit's own source …
  if (hit && !isNoSource(hit.srcUnitId) && hit.srcUnitId !== holder.id)
    return { unitId: hit.srcUnitId, name: hit.srcUnitName ?? "" };
  // … or the caster of the damage-over-time ticking on the holder
  const dot = dotCasterUp(
    before,
    auras.slice(before.length + 1),
    spellId,
    holder.id,
    atMs,
  );
  return dot ?? asLogged;
}

/** The holder's own link aura of `spellId` (source = holder) is up after
 * these rows. */
function linkUp(rows: readonly AuraRow[], spellId: string, holderId: string) {
  let up = false;
  for (const a of rows) {
    if (a.spellId !== spellId || a.srcUnitId !== holderId) continue;
    const ev = a.logLine.event as string;
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH
    )
      up = true;
    else if (ev === LogEvent.SPELL_AURA_REMOVED) up = false;
  }
  return up;
}

/** The latest other unit whose aura of `spellId` is up on the holder at
 * `atMs`, read over the rows before the break. An application the log never
 * closes holds only for its official length (`buffFullDurationForCaster`,
 * the cap the aura readers use; codex 20-F15-19: a Rune of Lingering applied
 * at 1 s with its REMOVED missing named its caster for a break at 180 s);
 * one its own REMOVED closes after the break was up until then. */
function dotCasterUp(
  rows: readonly AuraRow[],
  after: readonly AuraRow[],
  spellId: string,
  holderId: string,
  atMs: number,
): IBrokenRowBreaker | undefined {
  const up = new Map<string, IBrokenRowBreaker & { fromMs: number }>();
  for (const a of rows) {
    if (a.spellId !== spellId || a.srcUnitId === holderId) continue;
    if (isNoSource(a.srcUnitId)) continue;
    const ev = a.logLine.event as string;
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH ||
      ev === LogEvent.SPELL_AURA_APPLIED_DOSE
    ) {
      up.delete(a.srcUnitId);
      up.set(a.srcUnitId, {
        unitId: a.srcUnitId,
        name: a.srcUnitName ?? "",
        fromMs: a.logLine.timestamp,
      });
    } else if (ev === LogEvent.SPELL_AURA_REMOVED) up.delete(a.srcUnitId);
  }
  const closedAfter = (src: string): boolean => {
    for (const a of after)
      if (a.spellId === spellId && a.srcUnitId === src)
        return (a.logLine.event as string) === LogEvent.SPELL_AURA_REMOVED;
    return false;
  };
  const live = [...up.values()].filter((d) => {
    if (closedAfter(d.unitId)) return true;
    const s = buffFullDurationForCaster(spellId, undefined, d.fromMs);
    return s === undefined || atMs <= d.fromMs + s * 1000;
  });
  const last = live.pop();
  return last ? { unitId: last.unitId, name: last.name } : undefined;
}
