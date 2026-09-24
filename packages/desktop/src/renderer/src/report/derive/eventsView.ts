import { fmtTime } from "@gladlog/analysis";
import { displaySpellName } from "./spellDisplay";
import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";
import { shortUnitName } from "./teamSide";

/**
 * Events view (phase four ②, a structured-filter take on WCL Events — no
 * expression DSL): flattens each unit's event arrays into uniform rows,
 * filterable along five dimensions (kind / source / target / spell / time
 * window). It doubles as the landing container for B2 provenance: every row is
 * at "source log event" granularity, and ▶ jumps into the replay.
 */

export type EventKind =
  "damage" | "heal" | "cast" | "aura" | "dispel" | "interrupt" | "death";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  damage: "伤害",
  heal: "治疗",
  cast: "施放",
  aura: "光环",
  dispel: "驱散",
  interrupt: "打断",
  death: "死亡",
};

export interface EventRow {
  tS: number;
  kind: EventKind;
  srcName: string;
  destName: string;
  spellId: string;
  spellName: string;
  /** The amount (damage/heal) or a supplementary note (what was interrupted,
   * what was dispelled, aura gained/lost). */
  detail: string;
  /** Numeric amount (damage/heal rows; used by the amount micro-bar and by the
   * tick-group sum). */
  amount?: number;
  /** Unit id for a death row (so the death review can be opened directly);
   * absent on all other rows. */
  destId?: string;
  /** Index of the source line within the match's rawLines (B2 provenance);
   * undefined when parsed from an older archive that lacks the field. */
  lineIndex?: number;
}

/** Death aura-clear folding: a consecutive run of aura-removed rows on the
 * same target spanning ≤1.5s with ≥5 rows collapses into one group row. */
export const AURA_FLOOD_SPAN_S = 1.5;
export const AURA_FLOOD_MIN = 5;
/** A death row for that target within ±1.5s of the group marks it as a
 * death-triggered aura clear. */
export const AURA_FLOOD_DEATH_SLACK_S = 1.5;
/** Periodic tick grouping: adjacent rows with the same (kind, src, dest,
 * spell) at ≤2s spacing, with ≥3 rows. */
export const TICK_GAP_S = 2;
export const TICK_MIN = 3;

export interface AuraFloodRow {
  kind: "aura-flood";
  tS: number;
  destName: string;
  count: number;
  deathClear: boolean;
  children: EventRow[];
}

export interface TickGroupRow {
  kind: "tick-group";
  tS: number;
  /** The original kind of the grouped rows (damage | heal). */
  rowKind: EventKind;
  srcName: string;
  destName: string;
  spellId: string;
  spellName: string;
  count: number;
  /** Sum of the amounts. */
  amount: number;
  children: EventRow[];
}

/** A display row is either a raw row or a group row. When a group is expanded
 * its children render as ordinary rows (flat-list design: constant row height,
 * leaving the door open for windowing in phase two). */
export type DisplayRow = EventRow | AuraFloodRow | TickGroupRow;

export const isGroupRow = (r: DisplayRow): r is AuraFloodRow | TickGroupRow =>
  r.kind === "aura-flood" || r.kind === "tick-group";

export interface EventsFilter {
  kinds: EventKind[]; // empty = all
  /** Exact short name, per column. Both set = "only A hitting B". */
  srcName: string | null;
  destName: string | null;
  /** Matches source **or** target. No column owns it — it is how B2 provenance
   * ("raw events behind this finding") scopes to a unit, where restricting to
   * one side would hide half the story. The panel surfaces it as a dismissible
   * chip rather than a dropdown, so it can never be an invisible filter. */
  unitName: string | null;
  spellQuery: string; // substring of the spell name (case-insensitive)
  /** Amount floor. Rows that carry no amount at all (cast / aura / death) drop
   * out as soon as this is set — asking for "≥ 20k" is asking for the rows that
   * have a number. */
  minAmount: number | null;
  range: TimeRange | null; // time window (shares the type with the global one)
}

/** UI review 2026-08-21 #5: the fresh-open preset. Heal (56 %) and aura
 * (23 %) rows are the flood on a real match; these four are what a reader
 * scans for. `[]` still means "all" inside the filter predicate — the preset
 * is state in EventsPanel, and the panel treats THIS set (not `[]`) as the
 * baseline that does not count as an active filter. */
export const DEFAULT_EVENT_KINDS: EventKind[] = [
  "damage",
  "interrupt",
  "dispel",
  "death",
];

/** Order-insensitive set equality for kind lists. */
export const sameKinds = (a: EventKind[], b: EventKind[]): boolean =>
  a.length === b.length && a.every((k) => b.includes(k));

export const EMPTY_EVENTS_FILTER: EventsFilter = {
  kinds: [],
  srcName: null,
  destName: null,
  unitName: null,
  spellQuery: "",
  minAmount: null,
  range: null,
};

/** Which column the table is ordered by. */
export type EventSortKey =
  "time" | "kind" | "src" | "dest" | "spell" | "amount";
export interface EventSort {
  key: EventSortKey;
  dir: "asc" | "desc";
}
export const DEFAULT_EVENT_SORT: EventSort = { key: "time", dir: "asc" };

interface RawEvent {
  timestamp: number;
  eventName?: string;
  spellId?: number | string;
  spellName?: string;
  srcName?: string;
  destName?: string;
  amount?: number;
  effectiveAmount?: number;
  extraSpellName?: string;
  params?: string[];
  unconscious?: boolean;
  lineIndex?: number;
}

interface UnitLike {
  id: string;
  name: string;
  kind?: string;
  info?: unknown;
  ownerId?: string;
  damageOut?: RawEvent[];
  healOut?: RawEvent[];
  casts?: RawEvent[];
  auraEvents?: RawEvent[];
  actionsOut?: RawEvent[];
  deaths?: RawEvent[];
}

const fmtAmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

/** Amount formatting (reused by UI such as tick-group rows, under the same
 * convention as the inline detail column). */
export const fmtEventAmt = fmtAmt;

const spellNameOf = (e: RawEvent): string =>
  displaySpellName(String(e.spellId ?? ""), e.spellName);

/** Flatten + sort (done once, expensive); filtering happens in
 * filterEventRows (cheap, safe to run at high frequency). */
export function deriveEventRows(source: ReportSource): EventRow[] {
  try {
    const startMs = source.startTime;
    const rel = (ts: number) => Math.round(((ts - startMs) / 1000) * 10) / 10;
    const rows: EventRow[] = [];
    const push = (
      e: RawEvent,
      kind: EventKind,
      detail: string,
      extra?: { destOverride?: string; amount?: number; destId?: string },
    ) =>
      rows.push({
        tS: rel(e.timestamp),
        kind,
        srcName: shortUnitName(e.srcName),
        destName: shortUnitName(extra?.destOverride ?? e.destName),
        spellId: String(e.spellId ?? ""),
        spellName: spellNameOf(e),
        detail,
        amount: extra?.amount,
        destId: extra?.destId,
        lineIndex: e.lineIndex,
      });

    for (const u of Object.values(source.units) as unknown as UnitLike[]) {
      // Players and pets both go in (pet events already carry their own src
      // name)
      for (const e of u.damageOut ?? []) {
        const amt = Math.abs(e.effectiveAmount ?? e.amount ?? 0);
        push(e, "damage", fmtAmt(amt), { amount: amt });
      }
      for (const e of u.healOut ?? []) {
        const amt = Math.abs(e.effectiveAmount ?? e.amount ?? 0);
        push(e, "heal", fmtAmt(amt), { amount: amt });
      }
      for (const e of u.casts ?? []) {
        if (e.eventName === "SPELL_CAST_SUCCESS") push(e, "cast", "");
      }
      for (const e of u.auraEvents ?? []) {
        const ev = e.eventName ?? "";
        if (ev === "SPELL_AURA_APPLIED") push(e, "aura", "+获得");
        else if (ev === "SPELL_AURA_REMOVED") push(e, "aura", "−失去");
      }
      for (const e of u.actionsOut ?? []) {
        const ev = e.eventName ?? "";
        const extra = e.extraSpellName ?? e.params?.[12] ?? "";
        if (ev === "SPELL_DISPEL" || ev === "SPELL_STOLEN")
          push(e, "dispel", `驱掉 ${extra}`);
        else if (ev === "SPELL_INTERRUPT")
          push(e, "interrupt", `打断 ${extra}`);
      }
      for (const e of u.deaths ?? []) {
        if (!e.unconscious)
          push(e, "death", "死亡", {
            destOverride: shortUnitName(u.name),
            destId: u.id,
          });
      }
    }
    return rows.sort((a, b) => a.tS - b.tS);
  } catch {
    return [];
  }
}

const rowMatches = (r: EventRow, f: EventsFilter, q: string): boolean => {
  if (f.kinds.length > 0 && !f.kinds.includes(r.kind)) return false;
  if (f.srcName && r.srcName !== f.srcName) return false;
  if (f.destName && r.destName !== f.destName) return false;
  if (f.unitName && r.srcName !== f.unitName && r.destName !== f.unitName)
    return false;
  if (q && !r.spellName.toLowerCase().includes(q)) return false;
  if (f.minAmount != null && !(r.amount != null && r.amount >= f.minAmount))
    return false;
  if (!tInRange(r.tS, f.range)) return false;
  return true;
};

/** Every distinct name that actually appears in a column, sorted. Built from
 * the rows rather than from the unit table on purpose: pets, totems and NPCs
 * deal and take damage, and a dropdown listing only players cannot express
 * "what did the felhunter do". */
export function eventNameOptions(rows: EventRow[]): {
  src: string[];
  dest: string[];
} {
  const src = new Set<string>();
  const dest = new Set<string>();
  for (const r of rows) {
    if (r.srcName) src.add(r.srcName);
    if (r.destName) dest.add(r.destName);
  }
  const sorted = (s: Set<string>): string[] =>
    [...s].sort((a, b) => a.localeCompare(b));
  return { src: sorted(src), dest: sorted(dest) };
}

export function filterEventRows(rows: EventRow[], f: EventsFilter): EventRow[] {
  const q = f.spellQuery.trim().toLowerCase();
  return rows.filter((r) => rowMatches(r, f, q));
}

/** Grouping post-pass: death aura-clear folding + periodic tick grouping. Only
 * **consecutive** rows in the table count (matching the flood a human actually
 * sees); it runs over the full row set, and the filter semantics live in
 * filterDisplayRows. */
export function groupEventRows(rows: EventRow[]): DisplayRow[] {
  const deaths = rows.filter((r) => r.kind === "death");
  const out: DisplayRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i]!;
    if (r.kind === "aura" && r.detail === "−失去") {
      let j = i + 1;
      while (
        j < rows.length &&
        rows[j]!.kind === "aura" &&
        rows[j]!.detail === "−失去" &&
        rows[j]!.destName === r.destName &&
        rows[j]!.tS - r.tS <= AURA_FLOOD_SPAN_S
      )
        j++;
      if (j - i >= AURA_FLOOD_MIN) {
        const children = rows.slice(i, j);
        const lastT = children[children.length - 1]!.tS;
        const deathClear = deaths.some(
          (d) =>
            d.destName === r.destName &&
            d.tS >= r.tS - AURA_FLOOD_DEATH_SLACK_S &&
            d.tS <= lastT + AURA_FLOOD_DEATH_SLACK_S,
        );
        out.push({
          kind: "aura-flood",
          tS: r.tS,
          destName: r.destName,
          count: children.length,
          deathClear,
          children,
        });
        i = j;
        continue;
      }
    }
    if (r.kind === "damage" || r.kind === "heal") {
      let j = i + 1;
      while (
        j < rows.length &&
        rows[j]!.kind === r.kind &&
        rows[j]!.srcName === r.srcName &&
        rows[j]!.destName === r.destName &&
        rows[j]!.spellName === r.spellName &&
        rows[j]!.tS - rows[j - 1]!.tS <= TICK_GAP_S
      )
        j++;
      if (j - i >= TICK_MIN) {
        const children = rows.slice(i, j);
        out.push({
          kind: "tick-group",
          tS: r.tS,
          rowKind: r.kind,
          srcName: r.srcName,
          destName: r.destName,
          spellId: r.spellId,
          spellName: r.spellName,
          count: children.length,
          amount: children.reduce((s, c) => s + (c.amount ?? 0), 0),
          children,
        });
        i = j;
        continue;
      }
    }
    out.push(r);
    i++;
  }
  return out;
}

/**
 * A tick group seen as the single row it renders as: the 详情 cell shows the
 * summed amount, and the amount sort ranks it by that sum.
 *
 * The filter has to be able to see that same number. Testing only the children
 * makes one row mean two different things — a 3×2000 group displays "6000",
 * sorts as 6000, and then vanishes under "≥ 5000" (agy review, finding 2).
 */
const tickGroupAsRow = (d: TickGroupRow): EventRow => ({
  tS: d.tS,
  kind: d.rowKind,
  srcName: d.srcName,
  destName: d.destName,
  spellId: d.spellId,
  spellName: d.spellName,
  detail: "",
  amount: d.amount,
});

/** Filter semantics: a group is shown whole as soon as any child matches, or —
 * for a tick group — as soon as the aggregate it displays matches; `matched`
 * counts matching **raw** rows (the convention behind the count label:
 * {raw rows after filtering} / {all raw rows}). */
export function filterDisplayRows(
  display: DisplayRow[],
  f: EventsFilter,
): { rows: DisplayRow[]; matched: number } {
  const q = f.spellQuery.trim().toLowerCase();
  const rows: DisplayRow[] = [];
  let matched = 0;
  for (const d of display) {
    if (isGroupRow(d)) {
      const hit = d.children.reduce(
        (s, c) => s + (rowMatches(c, f, q) ? 1 : 0),
        0,
      );
      if (hit > 0) {
        rows.push(d);
        matched += hit;
      } else if (
        d.kind === "tick-group" &&
        rowMatches(tickGroupAsRow(d), f, q)
      ) {
        // It qualified on the total rather than on any single tick, so the
        // whole group is what matched and every row in it counts.
        rows.push(d);
        matched += d.children.length;
      }
    } else if (rowMatches(d, f, q)) {
      rows.push(d);
      matched++;
    }
  }
  return { rows, matched };
}

/** Kind ordering for the 类型 sort: the declaration order of
 * EVENT_KIND_LABEL (damage → heal → cast → …), not alphabetical — sorting
 * combat rows into 光环/驱散/打断/施放 order tells you nothing. */
const KIND_RANK = new Map<EventKind, number>(
  (Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k, i) => [k, i]),
);

/** A group row sorts by its own aggregate: a tick group by its summed amount,
 * its own source/target/spell. That is the user's call (2026-08-04) and it has
 * one consequence worth remembering: under an amount sort a "×5 = 62k" group
 * ranks above a single 48k hit, so the column is comparing a sum against a
 * single hit. The ×N badge on the row is what tells them apart.
 *
 * An aura-flood group has no source and no single spell (it is "N auras fell
 * off this unit at once"), so those keys read as empty and it sorts to the
 * empty end rather than pretending to a value it does not have. */
function sortValue(d: DisplayRow, key: EventSortKey): number | string {
  if (key === "time") return d.tS;
  if (isGroupRow(d)) {
    if (d.kind === "tick-group") {
      return key === "kind"
        ? (KIND_RANK.get(d.rowKind) ?? 99)
        : key === "src"
          ? d.srcName
          : key === "dest"
            ? d.destName
            : key === "spell"
              ? d.spellName
              : d.amount;
    }
    // aura-flood
    return key === "kind"
      ? (KIND_RANK.get("aura") ?? 99)
      : key === "dest"
        ? d.destName
        : key === "amount"
          ? -1
          : "";
  }
  return key === "kind"
    ? (KIND_RANK.get(d.kind) ?? 99)
    : key === "src"
      ? d.srcName
      : key === "dest"
        ? d.destName
        : key === "spell"
          ? d.spellName
          : // Rows with no amount at all (cast / aura / death) get -1 so they
            // clump at one end instead of scattering through the numbers.
            (d.amount ?? -1);
}

/**
 * Order the display rows. Always returns a new array; the input is untouched.
 *
 * Ties break on time and then on the row's original position, so the order is
 * total and deterministic — two 12.4k hits in the same second never swap places
 * between renders (which, under a virtualized list keyed by index, would look
 * like rows flickering).
 */
export function sortDisplayRows(
  rows: DisplayRow[],
  sort: EventSort,
): DisplayRow[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  return rows
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const va = sortValue(a.d, sort.key);
      const vb = sortValue(b.d, sort.key);
      let c = 0;
      if (typeof va === "number" && typeof vb === "number") c = va - vb;
      else c = String(va).localeCompare(String(vb));
      if (c !== 0) return sign * c;
      // Tiebreak is NOT signed: time-ascending within an equal key stays
      // ascending in both directions, which is how a log reads.
      return a.d.tS - b.d.tS || a.i - b.i;
    })
    .map((x) => x.d);
}

/** `M:SS` for one endpoint of the time-window input. */

/** What the 时间 column's input shows for the current window. */
export function formatRangeInput(r: TimeRange | null): string {
  return r ? `${fmtTime(r.fromS)}-${fmtTime(r.toS)}` : "";
}

/**
 * Parse the 时间 column's input. Accepts `0:30-1:10`, `30-70`, spaces around
 * the dash, and reversed endpoints (swapped rather than rejected).
 *
 * Returns a discriminated result because "empty" and "not valid yet" must not
 * be confused: empty clears the window, half-typed input leaves the current one
 * alone instead of blanking the table under the user's fingers.
 */
export function parseRangeInput(
  text: string,
): { ok: true; range: TimeRange | null } | { ok: false } {
  const s = text.trim();
  if (s === "") return { ok: true, range: null };
  const m = /^(\d+(?::\d{1,2})?)\s*[-–~]\s*(\d+(?::\d{1,2})?)$/.exec(s);
  if (!m) return { ok: false };
  const secs = (part: string): number => {
    const [a, b] = part.split(":");
    return b === undefined ? Number(a) : Number(a) * 60 + Number(b);
  };
  const a = secs(m[1]!);
  const b = secs(m[2]!);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false };
  return { ok: true, range: { fromS: Math.min(a, b), toS: Math.max(a, b) } };
}
