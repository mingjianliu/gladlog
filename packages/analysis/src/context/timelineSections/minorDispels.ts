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
import { BACKLASH_CC_SPELL_IDS } from "../../data/backlashCc";
import { getEnglishSpellName } from "../../data/spellEffectData";
import type { IDispelEvent } from "../../utils/dispelAnalysis";
import { fmtTime } from "../../utils/renderGrid";
import { dispelActorLabel } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function emitMinorDispelEntries(
  ctx: Pick<
    TimelineCtx,
    | "dispelSummary"
    | "pid"
    | "enemyPid"
    | "enemyDispelSummary"
    | "addEntry"
    | "_allUnits"
  >,
): void {
  const {
    dispelSummary,
    pid,
    enemyPid,
    enemyDispelSummary,
    addEntry,
    _allUnits,
  } = ctx;

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
      // here under their tag instead of vanishing.
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
      // F11: a rider that came with its own cast (a Demonic Circle: Teleport,
      // a Deep Breath, an Incarnation: Tree of Life press shedding a snare)
      // is not passive — the unit pressed that button. Its own part.
      const tag = minorDispelPartTag(e);
      const sourceLabel = dispelActorLabel(e, labelOf, _allUnits);
      const key = `${sourceLabel}|${spellName}|${tag ?? "d"}`;
      const cur = minor.get(key);
      if (cur) {
        cur.events.push(e);
        cur.firstSeconds = Math.min(cur.firstSeconds, e.timeSeconds);
      } else {
        minor.set(key, {
          sourceLabel,
          spellName: tag ? `${spellName} ${tag}` : spellName,
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

/** A fold part of removals nobody pressed for: a proc (Cleanse the Weak), or
 * a rider the log shows no cast of (the snare an Incarnation: Tree of Life
 * sheds when the druid leaves the form). */
export const MINOR_DISPEL_PASSIVE_TAG = "(passive)";
/** A fold part of removals that came with a press of their source — a cast
 * of the spell itself pressed for something else, or (fact2 C5) a talent's
 * removal riding a differently named button, Phantasm on Fade
 * (`IDispelEvent.riderOfOwnCast`). */
export const MINOR_DISPEL_RIDER_TAG = "(side effect of the cast)";

/** The tag a non-deliberate fold part carries; undefined for a deliberate
 * dispel, which lists its casts instead. */
export function minorDispelPartTag(
  e: Pick<IDispelEvent, "dispelKind" | "riderOfOwnCast">,
): string | undefined {
  if (e.dispelKind === "deliberate") return undefined;
  return e.riderOfOwnCast ? MINOR_DISPEL_RIDER_TAG : MINOR_DISPEL_PASSIVE_TAG;
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
 * three buffs and read `x3`). A passive part counts its instants.
 */
export function formatMinorDispelPart(m: {
  spellName: string;
  passive: boolean;
  events: ReadonlyArray<
    Pick<IDispelEvent, "timeSeconds" | "removedSpellId" | "removedSpellName"> &
      Partial<Pick<IDispelEvent, "hasDispelPenalty" | "backlashCcSpellId">>
  >;
}): string {
  if (m.passive) {
    // one instant is one proc / one press it rode (fact3 D61, fe64d179 r1
    // 0:17: one Fade's Phantasm removed two effects in one ms and read `x2`)
    const instants: number[] = [];
    for (const e of [...m.events].sort((a, b) => a.timeSeconds - b.timeSeconds))
      if (
        !instants.some(
          (t) => Math.abs(t - e.timeSeconds) <= MINOR_DISPEL_CAST_MERGE_S,
        )
      )
        instants.push(e.timeSeconds);
    return instants.length > 1
      ? `${m.spellName} x${instants.length}`
      : m.spellName;
  }
  const casts: Array<{ t: number; names: string[]; backlash?: string }> = [];
  for (const e of [...m.events].sort((a, b) => a.timeSeconds - b.timeSeconds)) {
    const name = getEnglishSpellName(e.removedSpellId, e.removedSpellName);
    let c = casts.find(
      (k) => Math.abs(k.t - e.timeSeconds) <= MINOR_DISPEL_CAST_MERGE_S,
    );
    if (c) c.names.push(name);
    else casts.push((c = { t: e.timeSeconds, names: [name] }));
    // WO3 #18 (r1008-150, eb8041ce 2:20): removing a debuff whose dispel
    // puts a CC on the dispeller (`BACKLASH_CC_SPELL_IDS`) says whether that
    // CC landed — a fully absorbed Unstable Affliction silences nobody
    const bl = e.hasDispelPenalty
      ? BACKLASH_CC_SPELL_IDS.get(e.removedSpellId)
      : undefined;
    if (bl)
      c.backlash = e.backlashCcSpellId
        ? `backlash ${bl.ccType} landed`
        : `no backlash ${bl.ccType} landed`;
  }
  // a backlash cast is always listed, never folded into `+N`
  const shown = casts.filter(
    (c, i) => i < MINOR_DISPEL_CASTS_SHOWN || c.backlash !== undefined,
  );
  const more =
    casts.length > shown.length ? `, +${casts.length - shown.length}` : "";
  return `${m.spellName} ×${casts.length} (${shown
    .map(
      (c) =>
        `${fmtTime(c.t)} ${c.names.join("、")}${c.backlash ? ` — ${c.backlash}` : ""}`,
    )
    .join("; ")}${more})`;
}
