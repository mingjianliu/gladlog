import { fmtTime } from "@gladlog/analysis";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { MessageKey } from "../../../../shared/i18n";
import { bridge } from "../../bridge";
import { useT } from "../../i18n/LangProvider";
import {
  DEFAULT_EVENT_KINDS,
  DEFAULT_EVENT_SORT,
  deriveEventRows,
  type DisplayRow,
  EMPTY_EVENTS_FILTER,
  EVENT_KIND_LABEL,
  type EventKind,
  eventKindLabel,
  eventNameOptions,
  type EventRow,
  type EventSort,
  type EventSortKey,
  filterDisplayRows,
  fmtEventAmt,
  formatRangeInput,
  groupEventRows,
  isGroupRow,
  parseRangeInput,
  sameKinds,
  sortDisplayRows,
} from "../derive/eventsView";
import { shortUnitName, teamSideByName } from "../derive/teamSide";
import type { TimeRange } from "../derive/timeRange";
import type { ReportSource } from "../derive/types";
import type { VulnBand } from "../derive/vulnWindows";
import { ChipIcon } from "./SpellInline";
import { TeamDot } from "./TeamDot";

/** Spell icon on an event row: if the id is not in the generated table, render
 * nothing (an empty label keeps the fallback initial from duplicating the spell
 * name text beside it, same convention as FindingsList's ChipIcon). The constant
 * 22px row height is a design premise of the virtualization — a 14px icon plus
 * .rpt-events-spell's inline-flex must not stretch the row. */
function EvtSpell({ spellId, name }: { spellId?: string; name: string }) {
  return (
    <span className="rpt-events-spell">
      <ChipIcon spellId={spellId} />
      {name}
    </span>
  );
}

/** The six data columns, in render order. `sort` names the key each header
 * sorts by; the trailing actions column has no header and no filter. */
const COLUMNS: Array<{ sort: EventSortKey; label: MessageKey }> = [
  { sort: "time", label: "report.eventsPanel.col.time" },
  { sort: "kind", label: "report.eventsPanel.col.kind" },
  { sort: "src", label: "report.eventsPanel.col.src" },
  { sort: "dest", label: "report.eventsPanel.col.dest" },
  { sort: "spell", label: "report.eventsPanel.col.spell" },
  { sort: "amount", label: "report.eventsPanel.col.amount" },
];

/** Clickable column header. First click sorts ascending, clicking the active
 * column flips direction — there is deliberately no third "unsorted" state:
 * the table is always in *some* order, and "no order" would just mean the
 * insertion order the user cannot see anyway. */
function SortTh({
  col,
  sort,
  onSort,
}: {
  col: { sort: EventSortKey; label: MessageKey };
  sort: EventSort;
  onSort: (k: EventSortKey) => void;
}) {
  const { t } = useT();
  const label = t(col.label);
  const active = sort.key === col.sort;
  return (
    <th
      // aria-sort is what a screen reader announces; the arrow is the sighted
      // half of the same fact.
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={active ? "rpt-events-th sorted" : "rpt-events-th"}
    >
      <button
        type="button"
        className="rpt-events-sort-btn"
        data-testid={`events-sort-${col.sort}`}
        onClick={() => onSort(col.sort)}
        title={t("report.eventsPanel.sortBy", { col: label })}
      >
        {label}
        <span className="rpt-events-sort-arrow" aria-hidden="true">
          {active ? (sort.dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );
}

/**
 * 类型 column filter. A popover rather than a `<select>` because the filter is
 * multi-select and each option carries its match count — both of which a native
 * select throws away, and the counts are how you notice that the kind you are
 * looking for has zero rows in this match.
 */
function KindFilter({
  kinds,
  counts,
  onToggle,
  onClear,
}: {
  kinds: EventKind[];
  counts: Map<EventKind, number>;
  onToggle: (k: EventKind) => void;
  onClear: () => void;
}) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const label =
    kinds.length === 0
      ? t("report.common.all")
      : sameKinds(kinds, DEFAULT_EVENT_KINDS)
        ? t("report.eventsPanel.key")
        : kinds.length === 1
          ? eventKindLabel(kinds[0]!, lang)
          : `${eventKindLabel(kinds[0]!, lang)}+${kinds.length - 1}`;
  return (
    <div className="rpt-events-kindfilter" ref={ref}>
      <button
        type="button"
        className={kinds.length ? "rpt-events-fbtn active" : "rpt-events-fbtn"}
        data-testid="events-kind-filter"
        aria-expanded={open}
        aria-label={t("report.eventsPanel.kindAria")}
        onClick={() => setOpen((o) => !o)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="rpt-events-kindpop" data-testid="events-kind-pop">
          {(Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k) => {
            const n = counts.get(k) ?? 0;
            return (
              <button
                key={k}
                type="button"
                className={[
                  "rpt-events-kind-chip",
                  kinds.includes(k) ? "active" : "",
                  n === 0 ? "zero" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={kinds.includes(k)}
                onClick={() => onToggle(k)}
              >
                <span className={`rpt-events-kind-dot ${k}`} />
                {eventKindLabel(k, lang)}
                <span className="rpt-events-kind-cnt">{n}</span>
              </button>
            );
          })}
          {kinds.length > 0 && (
            <button
              type="button"
              className="rpt-events-kindpop-clear"
              onClick={onClear}
            >
              {t("report.common.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Virtualized row height (the "constant row height" design premise of
 * eventsView.ts; same source as the old paginated loadMore's 22px assumption).
 * Event counts run into the tens of thousands, and the old "append on scroll,
 * never reclaim" approach reached 100k+ DOM nodes at the bottom (2026-07-26
 * audit); with fixed row height plus top/bottom spacers, the DOM stays at a
 * constant ~200 rows. */
const ROW_H = 22;
/** Window overscan in rows; hysteresis = half an overscan, so scrolling does not re-render every frame. */
const OVERSCAN_ROWS = 40;

/**
 * The events view (phase 4 ②, a structured-filter take on WCL Events):
 * five filter dimensions — kind chips / unit / spell substring / window anchor
 * (whole match · global time range · kill-attempt and vulnerability bands) —
 * plus ▶ per-row jump into the replay. The window anchor covers 90% of the use
 * cases people hand-write `IN RANGE FROM..TO` expressions for in WCL, with the
 * options reusing windows we already compute.
 */
export function EventsPanel({
  source,
  bands,
  globalRange,
  onSeek,
  inspectReq,
  matchId,
  onOpenRecap,
}: {
  source: ReportSource;
  bands: VulnBand[];
  /** The global time range (selected in the report view); one of the anchor options. */
  globalRange: TimeRange | null;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  /** B2 provenance request (finding → "raw events"): presets the filters whenever nonce changes. */
  inspectReq?: {
    fromS: number;
    toS: number;
    unitName: string | null;
    nonce: number;
  } | null;
  /** Storage id (the directory holding raw.txt); when absent the raw-line button is hidden (fixtures / test bed). */
  matchId?: string;
  /** Direct jump from a death row's "▶ death recap" (MatchReport injects the openRecap pipeline). */
  onOpenRecap?: (unitId: string, tMs: number) => void;
}) {
  // For a single shuffle round, lineIndex is an index within that round; the
  // offset into the whole raw.txt is accumulated on the main side from the
  // preceding rounds' linesTotal (matchStore.rawLine), so we only pass
  // sequenceNumber here.
  const { t, lang, namesVersion } = useT();
  const roundSeq =
    source.kind === "shuffleRound" ? source.sequenceNumber : null;
  const [rawView, setRawView] = useState<{
    key: string;
    text: string | null;
    fileLine: number | null;
  } | null>(null);
  // The key includes the render index: one instant can hold several identical-looking
  // rows (AoE), so one click must not expand a whole batch
  const rawKeyOf = (r: { tS: number; lineIndex?: number }, i: string) =>
    `${i}:${r.tS}:${r.lineIndex}`;
  const toggleRaw = async (
    r: { tS: number; lineIndex?: number },
    i: string,
  ) => {
    const key = rawKeyOf(r, i);
    if (rawView?.key === key) {
      setRawView(null);
      return;
    }
    try {
      const res = await bridge().matches.rawLine(matchId!, {
        roundSeq,
        lineIndex: r.lineIndex!,
      });
      setRawView({
        key,
        text: res?.line ?? null,
        fileLine: res?.fileLine ?? null,
      });
    } catch {
      setRawView({ key, text: null, fileLine: null });
    }
  };
  // namesVersion: the English spell names (en) arrive after first paint
  const allRows = useMemo(
    () => deriveEventRows(source, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, lang, namesVersion],
  );
  // Short name → side. These cells only ever hold a display name, and 来源 and
  // 目标 on one row routinely belong to opposite teams — which is exactly why
  // the marker is per-name and not per-row.
  const sides = useMemo(() => teamSideByName(source), [source]);
  const nameCell = (n: string) =>
    n ? (
      <span className="rpt-events-name">
        <TeamDot side={sides.get(n) ?? "unknown"} />
        {n}
      </span>
    ) : null;

  // UI review #5: a fresh open shows the 关键 preset (damage / interrupt /
  // dispel / death); 全部 is one click away. The preset is the baseline —
  // activeFilterCount and 清除筛选 treat it, not `[]`, as "no kind filter".
  const [kinds, setKinds] = useState<EventKind[]>(DEFAULT_EVENT_KINDS);
  // Provenance-only, no dropdown of its own: "source OR target" (see the field
  // doc in eventsView.ts). Surfaced as a dismissible chip so it is never an
  // invisible filter.
  const [unitName, setUnitName] = useState<string | null>(null);
  const [srcName, setSrcName] = useState<string | null>(null);
  const [destName, setDestName] = useState<string | null>(null);
  const [minAmount, setMinAmount] = useState<number | null>(null);
  const [spellQuery, setSpellQuery] = useState("");
  const [sort, setSort] = useState<EventSort>(DEFAULT_EVENT_SORT);
  // Anchor key: 'all' | 'global' | 'custom' | 'band:<i>' — the range is resolved
  // from the key on every render
  const [anchor, setAnchor] = useState<string>(globalRange ? "global" : "all");
  const [customRange, setCustomRange] = useState<TimeRange | null>(null);

  // Applying a provenance request: ±15s window + unit filter, clearing the kind
  // and spell filters (so the target event does not get filtered away)
  useEffect(() => {
    if (!inspectReq) return;
    setCustomRange({ fromS: inspectReq.fromS, toS: inspectReq.toS });
    setAnchor("custom");
    setUnitName(inspectReq.unitName);
    setKinds([]);
    setSpellQuery("");
    // The column filters and the sort are cleared for the same reason the kind
    // and spell filters are: a provenance jump must land on the event it was
    // asked about, and a leftover "来源 = Player3" or an amount sort would hide
    // it or bury it far down the list.
    setSrcName(null);
    setDestName(null);
    setMinAmount(null);
    setSort(DEFAULT_EVENT_SORT);
  }, [inspectReq?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // useMemo is mandatory: if the object literal in the band branch got a new
  // identity every render, `filtered` would be recomputed every render, and the
  // "scroll back to top on filter change" effect depends on [filtered] — so the
  // moment the user scrolls (which re-renders via setScrollAnchor) they get
  // yanked back to the top and the table is stuck on the first screen
  // (agy review, F1).
  const range: TimeRange | null = useMemo(
    () =>
      anchor === "custom"
        ? customRange
        : anchor === "global"
          ? globalRange
          : anchor.startsWith("band:")
            ? (() => {
                const b = bands[Number(anchor.slice(5))];
                return b ? { fromS: b.fromS, toS: b.toS } : null;
              })()
            : null,
    [anchor, customRange, globalRange, bands],
  );

  const displayRows = useMemo(() => groupEventRows(allRows), [allRows]);
  const countsByKind = useMemo(() => {
    const m = new Map<EventKind, number>();
    for (const r of allRows) m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
    return m;
  }, [allRows]);

  const filtered = useMemo(
    () =>
      filterDisplayRows(displayRows, {
        ...EMPTY_EVENTS_FILTER,
        kinds,
        srcName,
        destName,
        unitName,
        spellQuery,
        minAmount,
        range,
      }),
    [
      displayRows,
      kinds,
      srcName,
      destName,
      unitName,
      spellQuery,
      minAmount,
      range,
    ],
  );
  // Sorting is a separate memo from filtering so that changing direction does
  // not re-run the (much more expensive) filter pass over tens of thousands of
  // rows, and so neither runs on the scroll-anchor re-renders.
  const sorted = useMemo(
    () => sortDisplayRows(filtered.rows, sort),
    [filtered, sort],
  );
  const nameOptions = useMemo(() => eventNameOptions(allRows), [allRows]);

  // Baseline for the amount micro-bars: p95 of the current filtered result (not
  // max, so a single huge hit does not flatten everything else)
  const amountP95 = useMemo(() => {
    const amts: number[] = [];
    for (const d of filtered.rows) {
      if (isGroupRow(d)) {
        if (d.kind === "tick-group") amts.push(d.amount);
      } else if (d.amount != null && d.amount > 0) amts.push(d.amount);
    }
    if (amts.length === 0) return 0;
    amts.sort((a, b) => a - b);
    return amts[Math.floor(0.95 * (amts.length - 1))]!;
  }, [filtered]);

  // Expansion state of aggregate groups (keys are filter-independent, so changing
  // filters does not lose it)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const groupKey = (d: DisplayRow): string =>
    `${d.kind}:${d.tS}:${"destName" in d ? d.destName : ""}`;
  const toggleGroup = (key: string) =>
    setExpandedGroups((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Virtualization scroll anchor (with hysteresis: setState only after scrolling
  // past half an overscan, so scrolling does not re-render every frame; it also
  // replaced the old "unconditionally read scrollHeight after render", which
  // forced a layout on every render).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollAnchor, setScrollAnchor] = useState(0);
  const anchorRef = useRef(0);
  const viewHRef = useRef(600);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    viewHRef.current = el.clientHeight || viewHRef.current;
    const st = el.scrollTop;
    if (Math.abs(st - anchorRef.current) > (OVERSCAN_ROWS * ROW_H) / 2) {
      anchorRef.current = st;
      setScrollAnchor(st);
    }
  };
  // Filter or data change: scroll back to top (equivalent to the old pagination
  // semantics — setShown(PAGE) meant returning to page one). useLayoutEffect so
  // the scroll-to-top setState re-renders synchronously before paint; otherwise
  // the new list paints one frame of mid-list content at the old scroll position
  // before jumping to the top (agy review, F6).
  // `sorted` (not `filtered`) is the dependency: re-sorting reorders the whole
  // list, so staying at the old scrollTop would drop the user into an unrelated
  // part of it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    anchorRef.current = 0;
    setScrollAnchor(0);
  }, [sorted]);
  // When the container resizes (toggling the sidebar, resizing the window) the
  // window's upper bound must grow with it, and a ref does not trigger a
  // re-render — force one with an epoch counter (agy review, F5).
  const [, setViewEpoch] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      viewHRef.current = el.clientHeight || viewHRef.current;
      setViewEpoch((e) => e + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleKind = (k: EventKind) => {
    setKinds((cur) =>
      cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
    );
  };

  const onSort = (key: EventSortKey) => {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : // First click on a column picks the direction that column is
          // actually read in: biggest hits first for a number, earliest first
          // for time, A→Z for a name.
          { key, dir: key === "amount" ? "desc" : "asc" },
    );
  };

  // 时间 column input. It edits the same window as the anchor dropdown — one
  // window, two ways in — so the text has to follow the dropdown, without
  // reformatting from under the user while they are still typing ("30-70"
  // must not turn into "0:30-1:10" between two keystrokes).
  const [rangeText, setRangeText] = useState<{ text: string; ok: boolean }>({
    text: "",
    ok: true,
  });
  useEffect(() => {
    // Sync by *comparing what the box already says* rather than by a
    // "skip the next run" flag. A flag gets stranded whenever a keystroke
    // parses to the window that is already active — typing "abc" and deleting
    // it back to empty while on 全场 is enough — and the next anchor change is
    // then swallowed, leaving the box blank next to a live window (agy review,
    // finding 1). Reading the current text through the functional setState
    // keeps it out of the dependency array, so this still runs only when the
    // window actually changes, never on a keystroke.
    setRangeText((cur) => {
      const shown = parseRangeInput(cur.text);
      const same =
        shown.ok &&
        (shown.range === null
          ? range === null
          : range !== null &&
            shown.range.fromS === range.fromS &&
            shown.range.toS === range.toS);
      // Already denotes this window (in whatever spelling the user typed) →
      // leave it alone, so "30-70" is not rewritten to "0:30-1:10" under the
      // cursor.
      return same ? cur : { text: formatRangeInput(range), ok: true };
    });
  }, [range]);
  const onRangeText = (text: string) => {
    const parsed = parseRangeInput(text);
    setRangeText({ text, ok: parsed.ok });
    // Half-typed input leaves the current window alone rather than blanking
    // the table on every keystroke.
    if (!parsed.ok) return;
    setCustomRange(parsed.range);
    setAnchor(parsed.range ? "custom" : "all");
  };

  const activeFilterCount =
    (sameKinds(kinds, DEFAULT_EVENT_KINDS) ? 0 : 1) +
    (srcName ? 1 : 0) +
    (destName ? 1 : 0) +
    (unitName ? 1 : 0) +
    (spellQuery.trim() ? 1 : 0) +
    (minAmount != null ? 1 : 0) +
    (range ? 1 : 0);
  // Filters only — the sort is not one of them; clearing filters should not
  // silently reorder the table too.
  const clearFilters = () => {
    setKinds(DEFAULT_EVENT_KINDS);
    setSrcName(null);
    setDestName(null);
    setUnitName(null);
    setSpellQuery("");
    setMinAmount(null);
    setCustomRange(null);
    setAnchor("all");
  };

  // Flatten into a fixed-row-height sequence (group rows + expanded children);
  // the virtualization slices this sequence. Keys keep the old render-index
  // scheme (g{i}/g{i}:{j}/{i}), so behavior is unchanged.
  // rawView's inline expansion row is not counted in the spacer height: a
  // few dozen px of error on one row, self-healing as soon as you scroll.
  const flat = useMemo(() => {
    const out: Array<
      | {
          t: "group";
          d: Extract<DisplayRow, { children: EventRow[] }>;
          gk: string;
          key: string;
        }
      | { t: "row"; d: EventRow; key: string; child: boolean }
    > = [];
    sorted.forEach((d, i) => {
      if (isGroupRow(d)) {
        const gk = groupKey(d);
        out.push({ t: "group", d, gk, key: `g${i}` });
        if (expandedGroups.has(gk))
          d.children.forEach((c, j) =>
            out.push({ t: "row", d: c, key: `g${i}:${j}`, child: true }),
          );
      } else {
        out.push({ t: "row", d, key: String(i), child: false });
      }
    });
    return out;
  }, [sorted, expandedGroups]);

  const winFrom = Math.max(0, Math.floor(scrollAnchor / ROW_H) - OVERSCAN_ROWS);
  const winTo = Math.min(
    flat.length,
    Math.ceil((scrollAnchor + viewHRef.current) / ROW_H) + OVERSCAN_ROWS,
  );

  // Amount micro-bar: width = amount / p95 (clamped to 100%)
  const amtCell = (
    rowKind: EventKind,
    amount: number | undefined,
    text: string,
  ) =>
    amount != null && amount > 0 && amountP95 > 0 ? (
      <span className={`rpt-events-amt rpt-events-amt-${rowKind}`}>
        <span className="rpt-events-amt-bar">
          <span
            style={{ width: `${Math.min(100, (100 * amount) / amountP95)}%` }}
          />
        </span>
        {text}
      </span>
    ) : (
      text
    );

  const renderEventRow = (r: EventRow, i: string, child = false) => (
    <Fragment key={i}>
      <tr
        className={
          [
            r.kind === "death" ? "rpt-events-death" : "",
            child ? "rpt-events-childrow" : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        <td className="rpt-stats-detail-t">{fmtTime(r.tS)}</td>
        <td>{eventKindLabel(r.kind, lang)}</td>
        <td>
          {nameCell(r.srcName)}
          {r.srcOwner && (
            <span className="rpt-events-owner">
              {t("report.events.petOf", { owner: r.srcOwner })}
            </span>
          )}
        </td>
        <td>{nameCell(r.destName)}</td>
        <td>
          {r.kind === "death" ? (
            t("report.common.died")
          ) : (
            <EvtSpell spellId={r.spellId} name={r.spellName} />
          )}
        </td>
        <td className="rpt-stats-dim">
          {r.kind === "damage" || r.kind === "heal" ? (
            amtCell(r.kind, r.amount, r.detail)
          ) : r.kind === "death" && onOpenRecap && r.destId ? (
            <button
              className="rpt-stats-detail-jump"
              title={t("report.eventsPanel.openRecapTitle")}
              onClick={() =>
                onOpenRecap(r.destId!, source.startTime + r.tS * 1000)
              }
            >
              {t("report.eventsPanel.openRecap")}
            </button>
          ) : (
            r.detail
          )}
        </td>
        <td>
          {matchId && r.lineIndex != null && (
            <button
              className="rpt-stats-detail-jump"
              title={t("report.eventsPanel.rawTitle")}
              onClick={() => void toggleRaw(r, i)}
            >
              ㏒
            </button>
          )}
          {onSeek && (
            <button
              className="rpt-stats-detail-jump"
              title={t("report.common.replayHere")}
              onClick={() =>
                onSeek(
                  Math.max(0, r.tS - 3),
                  [r.destName || r.srcName].filter(Boolean),
                )
              }
            >
              ▶
            </button>
          )}
        </td>
      </tr>
      {rawView?.key === rawKeyOf(r, i) && (
        <tr className="rpt-events-rawline">
          <td colSpan={7}>
            {rawView.text ? (
              <code>
                {rawView.fileLine != null && (
                  <span className="rpt-stats-dim">
                    raw.txt:{rawView.fileLine + 1}{" "}
                  </span>
                )}
                {rawView.text}
              </code>
            ) : (
              <span className="rpt-stats-dim">
                {t("report.eventsPanel.rawUnavailable")}
              </span>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );

  return (
    <div className="rpt-events" data-testid="events-panel">
      <div className="rpt-events-filters">
        {/* Presets (UI review #5): each carries its live row count so nothing
            is hidden silently. 关键 is the baseline; 全部 counts as a filter
            that 清除筛选 undoes. */}
        <span
          className="rpt-events-presets"
          role="group"
          aria-label={t("report.eventsPanel.presetsAria")}
        >
          <button
            type="button"
            className={
              sameKinds(kinds, DEFAULT_EVENT_KINDS)
                ? "rpt-events-fbtn active"
                : "rpt-events-fbtn"
            }
            data-testid="events-preset-key"
            aria-pressed={sameKinds(kinds, DEFAULT_EVENT_KINDS)}
            title={t("report.eventsPanel.keyTitle")}
            onClick={() => setKinds(DEFAULT_EVENT_KINDS)}
          >
            {t("report.eventsPanel.keyN", {
              n: DEFAULT_EVENT_KINDS.reduce(
                (a, k) => a + (countsByKind.get(k) ?? 0),
                0,
              ),
            })}
          </button>
          <button
            type="button"
            className={
              kinds.length === 0 ? "rpt-events-fbtn active" : "rpt-events-fbtn"
            }
            data-testid="events-preset-all"
            aria-pressed={kinds.length === 0}
            onClick={() => setKinds([])}
          >
            {t("report.eventsPanel.allN", { n: allRows.length })}
          </button>
        </span>
        <select
          value={anchor}
          onChange={(e) => {
            setAnchor(e.target.value);
          }}
          title={t("report.eventsPanel.anchorTitle")}
          data-testid="events-anchor"
        >
          <option value="all">{t("report.common.wholeMatch")}</option>
          {customRange && (
            <option value="custom">
              {t("report.eventsPanel.custom", {
                from: fmtTime(customRange.fromS),
                to: fmtTime(customRange.toS),
              })}
            </option>
          )}
          {globalRange && (
            <option value="global">
              {t("report.eventsPanel.global", {
                from: fmtTime(globalRange.fromS),
                to: fmtTime(globalRange.toS),
              })}
            </option>
          )}
          {bands.map((b, i) => (
            <option key={i} value={`band:${i}`}>
              {fmtTime(b.fromS)}–{fmtTime(b.toS)}{" "}
              {t(
                b.kind === "burst"
                  ? "report.common.burstWindow"
                  : "report.common.vulnWindow",
              )}{" "}
              · {shortUnitName(b.targetName)}
            </option>
          ))}
        </select>
        {/* Provenance scope has no column of its own (it is "source OR
            target"), so it shows here as a chip you can see and dismiss. */}
        {unitName && (
          <span className="rpt-trb-chip" data-testid="events-unit-chip">
            {t("report.eventsPanel.trace", { name: unitName })}
            <button
              type="button"
              className="rpt-events-chip-x"
              aria-label={t("report.eventsPanel.traceClear")}
              onClick={() => setUnitName(null)}
            >
              ✕
            </button>
          </span>
        )}
        {activeFilterCount > 0 && (
          <button
            type="button"
            className="rpt-trb-clear"
            data-testid="events-clear-filters"
            onClick={clearFilters}
          >
            {t("report.eventsPanel.clearFilters", { n: activeFilterCount })}
          </button>
        )}
        <span className="rpt-stats-dim">
          {t("report.eventsPanel.count", {
            matched: filtered.matched,
            total: allRows.length,
          })}
        </span>
      </div>
      <div className="rpt-events-scroll" ref={scrollRef} onScroll={onScroll}>
        <table className="rpt-stats rpt-events-table">
          <thead>
            <tr className="rpt-events-hrow">
              {COLUMNS.map((c) => (
                <SortTh key={c.sort} col={c} sort={sort} onSort={onSort} />
              ))}
              <th />
            </tr>
            {/* Filter row: one control per column, so which column a filter
                acts on is a matter of looking rather than remembering. */}
            <tr className="rpt-events-frow">
              <th>
                <input
                  className={rangeText.ok ? "" : "bad"}
                  data-testid="events-f-time"
                  aria-label={t("report.eventsPanel.timeAria")}
                  placeholder="0:30-1:10"
                  value={rangeText.text}
                  onChange={(e) => {
                    onRangeText(e.target.value);
                  }}
                  title={t("report.eventsPanel.timeTitle")}
                />
              </th>
              <th>
                <KindFilter
                  kinds={kinds}
                  counts={countsByKind}
                  onToggle={toggleKind}
                  onClear={() => setKinds([])}
                />
              </th>
              <th>
                <select
                  data-testid="events-f-src"
                  aria-label={t("report.eventsPanel.srcAria")}
                  value={srcName ?? ""}
                  onChange={(e) => {
                    setSrcName(e.target.value || null);
                  }}
                >
                  <option value="">{t("report.common.all")}</option>
                  {nameOptions.src.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </th>
              <th>
                <select
                  data-testid="events-f-dest"
                  aria-label={t("report.eventsPanel.destAria")}
                  value={destName ?? ""}
                  onChange={(e) => {
                    setDestName(e.target.value || null);
                  }}
                >
                  <option value="">{t("report.common.all")}</option>
                  {nameOptions.dest.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </th>
              <th>
                <input
                  type="search"
                  data-testid="events-f-spell"
                  aria-label={t("report.eventsPanel.spellAria")}
                  placeholder={t("report.eventsPanel.spellPlaceholder")}
                  value={spellQuery}
                  onChange={(e) => {
                    setSpellQuery(e.target.value);
                  }}
                />
              </th>
              <th>
                <input
                  type="number"
                  min={0}
                  data-testid="events-f-amount"
                  aria-label={t("report.eventsPanel.amountAria")}
                  placeholder={t("report.eventsPanel.amountPlaceholder")}
                  value={minAmount ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setMinAmount(v === "" ? null : Number(v));
                  }}
                  title={t("report.eventsPanel.amountTitle")}
                />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {/* The spacer must contain a td: a tr with no cells collapses to
                zero height in browser table layout (agy review, F2), which
                breaks virtual scrolling entirely. Queries exclude it with
                tr:not([aria-hidden]) (see the provenance test). */}
            {winFrom > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={7}
                  style={{ height: winFrom * ROW_H, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {flat.slice(winFrom, winTo).map((item) => {
              if (item.t === "row")
                return renderEventRow(item.d, item.key, item.child);
              const d = item.d;
              const gk = item.gk;
              const open = expandedGroups.has(gk);
              const caret = (
                <span className="rpt-events-caret">{open ? "▾" : "▸"}</span>
              );
              if (d.kind === "aura-flood") {
                return (
                  <tr className="rpt-events-group" key={item.key}>
                    <td className="rpt-stats-detail-t">{fmtTime(d.tS)}</td>
                    <td>{eventKindLabel("aura", lang)}</td>
                    <td />
                    <td>{nameCell(d.destName)}</td>
                    <td colSpan={2}>
                      <button
                        className="rpt-events-group-btn"
                        onClick={() => toggleGroup(gk)}
                      >
                        {caret}
                        {t("report.eventsPanel.auraFlood", {
                          name: d.destName,
                          n: d.count,
                        })}
                        {d.deathClear && (
                          <span className="rpt-events-group-chip">
                            {t("report.eventsPanel.deathClear")}
                          </span>
                        )}
                      </button>
                    </td>
                    <td />
                  </tr>
                );
              }
              return (
                <tr className="rpt-events-group" key={item.key}>
                  <td className="rpt-stats-detail-t">{fmtTime(d.tS)}</td>
                  <td>{eventKindLabel(d.rowKind, lang)}</td>
                  <td>{nameCell(d.srcName)}</td>
                  <td>{nameCell(d.destName)}</td>
                  <td>
                    <button
                      className="rpt-events-group-btn"
                      onClick={() => toggleGroup(gk)}
                    >
                      {caret}
                      <EvtSpell spellId={d.spellId} name={d.spellName} />
                      <span className="rpt-events-group-chip">
                        {t("report.eventsPanel.ticks", { n: d.count })}
                      </span>
                    </button>
                  </td>
                  <td className="rpt-stats-dim">
                    {amtCell(d.rowKind, d.amount, fmtEventAmt(d.amount))}
                  </td>
                  <td />
                </tr>
              );
            })}
            {winTo < flat.length && (
              <tr aria-hidden="true">
                <td
                  colSpan={7}
                  style={{
                    height: (flat.length - winTo) * ROW_H,
                    padding: 0,
                    border: 0,
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
