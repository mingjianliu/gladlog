/**
 * `[RES]` ledger pruning — which `rdy:Δ  cd:—` ("nothing changed") rows may be
 * dropped from the rendered timeline with zero information loss (GH #99 item 5,
 * user ruling 2026-09-22: drop only the zero-loss rows, never the class).
 *
 * The criterion is text-level and is THE shared predicate: the renderer
 * (`buildMatchTimeline`) applies it to its own output, the eval gate
 * `checkResNoChangeRowsPruned` re-applies it to the rendered prompt and fails
 * on any droppable row still present, and `resRowFactScan.ts` reports with it.
 * It was measured before it was shipped: on the 82-prompt local rebuild of
 * the 2026-09-15 baseline corpus, 954 of 3,033 `[RES]` rows were no-change
 * rows and 717 of them (75.2 %) carried nothing that the surviving text does
 * not already state; the other 237 carry 146 focus episodes and 103 CC
 * states that exist nowhere else. Deleting the whole class would have
 * dropped ≥1 fact in 71/82 prompts. (The 2026-09-16 scan reported 773 / 45 /
 * 64: its `\S+` field capture stopped at the first space of a multi-word
 * spell name, so those CC states never counted — fixed here, see FIELD_SEP.)
 * Two model-side ablations (Gemini z = −0.1, Opus 5 z = −1.1 on n=12) could
 * not show the rows matter, which is exactly why the decision rests on this
 * deterministic criterion instead.
 *
 * A no-change row is droppable iff every fact on it can be reconstructed
 * from the surviving text:
 *   · `focus:` — the nearest `[RES]` rows on either side that are NOT
 *     no-change rows show the same target (the neighbour set is the
 *     "class deleted" one on purpose: it is what was measured, and it is
 *     order-independent — a row's verdict never depends on another
 *     no-change row's verdict);
 *   · `cc:` — every entry is covered by a same-named `[CC ON …]` landing
 *     line whose own rendered duration spans this second (the landing line
 *     states its duration, so the reader can derive the state); a kick
 *     lockout in `cc:` has no `[CC ON …]` line and therefore keeps its row;
 *   · `enemy:` — every entry has a same-named `[ENEMY CD]` line at or
 *     before this second (remaining seconds = cast time + cooldown, one
 *     step of arithmetic).
 * A `[RES]` row carries no timestamp of its own; it belongs to the nearest
 * timestamped line above it.
 */

/** Any `[RES]` ledger row. */
export const RES_ROW_RE = /\[RES\]\s+rdy:/;
/** A ledger row whose ready set and cooldown set are both unchanged. */
export const RES_NO_CHANGE_RE = /\[RES\]\s+rdy:Δ\s+cd:—/;

export function isResRow(line: string): boolean {
  return RES_ROW_RE.test(line);
}
export function isNoChangeResLine(line: string): boolean {
  return RES_NO_CHANGE_RE.test(line);
}

/** Duration assumed for a `[CC ON …]` line that renders none. */
export const RES_PRUNE_CC_FALLBACK_S = 3;
/** Render-grid slack on the landing-line coverage test (whole seconds). */
export const RES_PRUNE_CC_SLACK_S = 1;

const TIME_AT_START = /^\s*(\d{1,2}):([0-5]\d)/;
/**
 * `resourceSnapshot.ts` appends each ledger field as `  <name>:<value>` (two
 * spaces before the name; entries inside a value are comma-joined and may
 * contain single spaces — `cc:3/Wind Shear-1s[kick]`,
 * `enemy:Incarnation: Chosen of Elune/Balance Druid(2s left)`), and the
 * Disc-priest count as ` | Atonements: N`. A `\S+` capture would stop at the
 * first space inside a spell name: the 2026-09-16 scan did exactly that and so
 * never counted a multi-word CC or enemy CD as a fact worth keeping.
 */
const FIELD_SEP = /\s{2,}/;
const fieldOf = (line: string, name: string): string | undefined => {
  for (const tok of line.split(FIELD_SEP)) {
    if (tok.startsWith(`${name}:`)) return tok.slice(name.length + 1);
  }
  return undefined;
};
/** `3/Wind Shear-1s[kick]` → spell name. */
const CC_ENTRY = /^\d+\/(.+?)-\d/;
/** `Trueshot/Marksmanship Hunter(6s left)` → spell name. */
const CD_ENTRY = /^(.+?)\//;
/** `… ← Polymorph (by 6(RShaman)) | 6s [DR: …]` → duration seconds. */
const CC_LINE_DUR = /\|\s*(\d+(?:\.\d+)?)s\b/;
const CC_LANDING = /\[CC ON /;
const ENEMY_CD = /\[ENEMY CD\]/;

const secondsOf = (line: string): number | null => {
  const m = line.match(TIME_AT_START);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export type ResRowFact = "focus" | "cc" | "enemy";

export interface NoChangeResRowVerdict {
  /** Index of the row in the input `lines`. */
  index: number;
  /** Facts on this row that the surviving text cannot reconstruct. Empty ⇒ droppable. */
  uniqueFacts: ResRowFact[];
}

/**
 * Classify every no-change `[RES]` row of a rendered text. Pure; the same
 * input always yields the same verdicts, and a row's verdict does not depend
 * on any other no-change row being kept or dropped.
 */
export function classifyNoChangeResRows(
  lines: readonly string[],
): NoChangeResRowVerdict[] {
  // Each line inherits the nearest timestamp above it.
  const at: Array<number | null> = new Array(lines.length);
  let last: number | null = null;
  lines.forEach((l, i) => {
    const s = secondsOf(l);
    if (s !== null) last = s;
    at[i] = last;
  });

  const ccLines: Array<{ t: number; text: string }> = [];
  const cdLines: Array<{ t: number; text: string }> = [];
  lines.forEach((l, i) => {
    const t = at[i];
    if (t === null || t === undefined) return;
    if (CC_LANDING.test(l)) ccLines.push({ t, text: l });
    if (ENEMY_CD.test(l)) cdLines.push({ t, text: l });
  });

  const rows: number[] = [];
  lines.forEach((l, i) => {
    if (RES_ROW_RE.test(l)) rows.push(i);
  });

  const verdicts: NoChangeResRowVerdict[] = [];
  rows.forEach((lineIdx, k) => {
    const line = lines[lineIdx]!;
    if (!RES_NO_CHANGE_RE.test(line)) return;
    const unique: ResRowFact[] = [];

    const focus = fieldOf(line, "focus");
    if (focus) {
      const survivingNeighbour = (dir: -1 | 1): string | undefined => {
        for (let j = k + dir; j >= 0 && j < rows.length; j += dir) {
          const cand = lines[rows[j]!]!;
          if (!RES_NO_CHANGE_RE.test(cand)) return fieldOf(cand, "focus");
        }
        return undefined;
      };
      if (survivingNeighbour(-1) !== focus && survivingNeighbour(1) !== focus)
        unique.push("focus");
    }

    const t = at[lineIdx];
    const cc = fieldOf(line, "cc");
    if (cc && t !== null && t !== undefined) {
      let lost = false;
      for (const entry of cc.split(",")) {
        const spell = entry.match(CC_ENTRY)?.[1];
        if (!spell) continue;
        const covered = ccLines.some((c) => {
          if (!c.text.includes(spell)) return false;
          const dur = Number(
            c.text.match(CC_LINE_DUR)?.[1] ?? RES_PRUNE_CC_FALLBACK_S,
          );
          return (
            t >= c.t - RES_PRUNE_CC_SLACK_S &&
            t <= c.t + dur + RES_PRUNE_CC_SLACK_S
          );
        });
        if (!covered) lost = true;
      }
      if (lost) unique.push("cc");
    }

    const en = fieldOf(line, "enemy");
    if (en && t !== null && t !== undefined) {
      let lost = false;
      for (const entry of en.split(",")) {
        const spell = entry.match(CD_ENTRY)?.[1];
        if (!spell) continue;
        if (!cdLines.some((c) => c.t <= t && c.text.includes(spell)))
          lost = true;
      }
      if (lost) unique.push("enemy");
    }

    verdicts.push({ index: lineIdx, uniqueFacts: unique });
  });
  return verdicts;
}

/** Indices of the no-change rows that may be dropped with zero information loss. */
export function droppableNoChangeResRows(lines: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const v of classifyNoChangeResRows(lines))
    if (v.uniqueFacts.length === 0) out.add(v.index);
  return out;
}

/** The rendered lines minus the droppable no-change `[RES]` rows. */
export function pruneZeroLossResRows(lines: readonly string[]): string[] {
  const drop = droppableNoChangeResRows(lines);
  if (drop.size === 0) return [...lines];
  return lines.filter((_, i) => !drop.has(i));
}
