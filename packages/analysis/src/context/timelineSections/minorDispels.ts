/**
 * [MINOR DISPELS] (T5 dispel coverage) — low / medium-priority dispels that do
 * not get a line each, folded by (source, dispel spell) into one counted line
 * per source, so the dispel workload stays visible at O(distinct spells) tokens.
 * Since 2026-09-30 (A18) each deliberate part lists its casts and what they
 * removed — see `formatMinorDispelPart`.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { getEnglishSpellName } from "../../data/spellEffectData";
import type { IDispelEvent } from "../../utils/dispelAnalysis";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitMinorDispelEntries(
  ctx: Pick<
    TimelineCtx,
    "dispelSummary" | "pid" | "enemyPid" | "enemyDispelSummary" | "addEntry"
  >,
): void {
  const { dispelSummary, pid, enemyPid, enemyDispelSummary, addEntry } = ctx;

  const minor = new Map<
    string,
    {
      sourceLabel: string;
      spellName: string;
      passive: boolean;
      events: IDispelEvent[];
      firstSeconds: number;
    }
  >();
  const foldMinor = (
    events: IDispelEvent[],
    labelOf: (name: string) => string,
  ) => {
    for (const e of events) {
      // High/Critical riders are NOT on a [CLEANSE] line (D1), so they fold
      // here as "(passive)" instead of vanishing.
      if (
        (e.priority === "Critical" || e.priority === "High") &&
        e.dispelKind !== "rider"
      )
        continue;
      const spellName = e.dispelSpellName || "unknown";
      // UI review 2026-08-21 #3: passive procs / riders fold into their own
      // line with a "(passive)" tag so 92 Cleanse the Weak procs never read
      // as 92 cleanse decisions. Same predicate as the desktop counts.
      const passive = e.dispelKind !== "deliberate";
      const key = `${e.sourceName}|${spellName}|${passive ? "p" : "d"}`;
      const cur = minor.get(key);
      if (cur) {
        cur.events.push(e);
        cur.firstSeconds = Math.min(cur.firstSeconds, e.timeSeconds);
      } else {
        minor.set(key, {
          sourceLabel: labelOf(e.sourceName),
          spellName: passive ? `${spellName} (passive)` : spellName,
          passive,
          events: [e],
          firstSeconds: e.timeSeconds,
        });
      }
    }
  };
  foldMinor(dispelSummary.allyCleanse, pid);
  foldMinor(dispelSummary.ourPurges, pid);
  foldMinor(dispelSummary.hostilePurges, enemyPid);
  if (enemyDispelSummary) foldMinor(enemyDispelSummary.allyCleanse, enemyPid);

  type MinorPart = typeof minor extends Map<string, infer V> ? V : never;
  const bySource = new Map<string, MinorPart[]>();
  for (const m of minor.values()) {
    const list = bySource.get(m.sourceLabel) ?? [];
    list.push(m);
    bySource.set(m.sourceLabel, list);
  }
  for (const [sourceLabel, list] of bySource) {
    list.sort((a, b) => a.firstSeconds - b.firstSeconds);
    const firstSeconds = list[0].firstSeconds;
    const parts = list.map(formatMinorDispelPart).join(", ");
    addEntry(
      firstSeconds,
      `${fmtTime(firstSeconds)}  [MINOR DISPELS]   ${sourceLabel}: ${parts} (low-priority, folded)`,
    );
  }
}

/** Removals of one source + dispel spell this close together are one cast. */
export const MINOR_DISPEL_CAST_MERGE_S = 0.05;
/** Casts listed per part before `+N`. */
export const MINOR_DISPEL_CASTS_SHOWN = 4;

/**
 * One fold part (user ruling A18 = A, 2026-09-30; triage missed-cleanse F-P2 /
 * F-P3). A deliberate part lists its CASTS — `Spell ×N (m:ss removed、names;
 * …)`, at most MINOR_DISPEL_CASTS_SHOWN then `+N` — so a purge inside a kill
 * window no longer reads as happening at the line's first second, and `×N`
 * counts casts, not removed effects (f4647408: two Greater Purges removed
 * three buffs and read `x3`). A passive part keeps the bare count.
 */
export function formatMinorDispelPart(m: {
  spellName: string;
  passive: boolean;
  events: ReadonlyArray<
    Pick<IDispelEvent, "timeSeconds" | "removedSpellId" | "removedSpellName">
  >;
}): string {
  if (m.passive)
    return m.events.length > 1
      ? `${m.spellName} x${m.events.length}`
      : m.spellName;
  const casts: Array<{ t: number; names: string[] }> = [];
  for (const e of [...m.events].sort((a, b) => a.timeSeconds - b.timeSeconds)) {
    const name = getEnglishSpellName(e.removedSpellId, e.removedSpellName);
    const c = casts.find(
      (k) => Math.abs(k.t - e.timeSeconds) <= MINOR_DISPEL_CAST_MERGE_S,
    );
    if (c) c.names.push(name);
    else casts.push({ t: e.timeSeconds, names: [name] });
  }
  const shown = casts
    .slice(0, MINOR_DISPEL_CASTS_SHOWN)
    .map((c) => `${fmtTime(c.t)} ${c.names.join("、")}`);
  const more =
    casts.length > MINOR_DISPEL_CASTS_SHOWN
      ? `, +${casts.length - MINOR_DISPEL_CASTS_SHOWN}`
      : "";
  return `${m.spellName} ×${casts.length} (${shown.join("; ")}${more})`;
}
