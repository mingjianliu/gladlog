import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { spellEffectData } from "../data/spellEffectData";

/** Is `auraId` up on `victim` at `atMs`: its latest APPLIED / REFRESH /
 * REMOVED row at or before that instant (a REMOVED in the instant's own
 * millisecond leaves it up), else the log's start list. Latest by
 * timestamp, not by position — a log's rows can step back in time. An
 * application whose REMOVED the log never shows is over at the aura's DB2
 * length (the rule `oppressingRoarTracker` keeps; an aura with no length,
 * Concentration Aura, stays up). Codex 85-tk-F-T69-1 #1 / #2. */
export function auraRowsUpAt(
  victim: Pick<ICombatUnit, "auraEvents"> & Partial<Pick<ICombatUnit, "info">>,
  auraId: string,
  atMs: number,
): boolean {
  let up = false;
  try {
    const initial: unknown = JSON.parse(
      victim.info?.interestingAurasJSON ?? "[]",
    );
    up = Array.isArray(initial) && initial.some((x) => String(x) === auraId);
  } catch {
    // unreadable start list: nothing up at the start
  }
  let lastMs = -Infinity;
  let appliedMs: number | undefined;
  for (const a of victim.auraEvents ?? []) {
    if (a.spellId !== auraId) continue;
    const t = a.logLine.timestamp;
    if (t > atMs || t < lastMs) continue;
    const ev = a.logLine.event;
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH
    ) {
      up = true;
      appliedMs = t;
      lastMs = t;
    } else if (ev === LogEvent.SPELL_AURA_REMOVED && t < atMs) {
      up = false;
      appliedMs = undefined;
      lastMs = t;
    }
  }
  if (up && appliedMs !== undefined) {
    const dur = spellEffectData[auraId]?.durationSeconds;
    if (dur !== undefined && dur > 0 && atMs > appliedMs + dur * 1000)
      return false;
  }
  return up;
}
