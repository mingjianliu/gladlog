/**
 * [MINOR DISPELS] (T5 dispel coverage) — low / medium-priority dispels that do
 * not get a line each, folded by (source, dispel spell) into one counted line
 * per source, so the dispel workload stays visible at O(distinct spells) tokens.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
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
      count: number;
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
        cur.count++;
        cur.firstSeconds = Math.min(cur.firstSeconds, e.timeSeconds);
      } else {
        minor.set(key, {
          sourceLabel: labelOf(e.sourceName),
          spellName: passive ? `${spellName} (passive)` : spellName,
          count: 1,
          firstSeconds: e.timeSeconds,
        });
      }
    }
  };
  foldMinor(dispelSummary.allyCleanse, pid);
  foldMinor(dispelSummary.ourPurges, pid);
  foldMinor(dispelSummary.hostilePurges, enemyPid);
  if (enemyDispelSummary) foldMinor(enemyDispelSummary.allyCleanse, enemyPid);

  const bySource = new Map<
    string,
    Array<{ spellName: string; count: number; firstSeconds: number }>
  >();
  for (const m of minor.values()) {
    const list = bySource.get(m.sourceLabel) ?? [];
    list.push(m);
    bySource.set(m.sourceLabel, list);
  }
  for (const [sourceLabel, list] of bySource) {
    list.sort((a, b) => a.firstSeconds - b.firstSeconds);
    const firstSeconds = list[0].firstSeconds;
    const parts = list
      .map((m) => (m.count > 1 ? `${m.spellName} x${m.count}` : m.spellName))
      .join(", ");
    addEntry(
      firstSeconds,
      `${fmtTime(firstSeconds)}  [MINOR DISPELS]   ${sourceLabel}: ${parts} (low-priority, folded)`,
    );
  }
}
