// Pure view logic for the Solo Shuffle timing radar page. Every number the
// page prints comes from the server response untouched; this module only
// filters, orders and sums it (handoff §5: filtering never changes a score).

import { type Language, LANGUAGES, translate } from "../../../shared/i18n";
import type {
  RadarRole,
  RadarSpec,
  RadarTierKey,
} from "../../../shared/specRadar";
import { specIconName } from "../report/data/gameConstants";
import {
  CLASS_NAMES_ZH,
  SPEC_ID_BY_EN,
  SPEC_NAMES_ZH,
} from "../report/data/specNames";

export type RadarRoleFilter = "all" | RadarRole;
export type RadarSortKey = "timing" | "strength" | "matches";

export interface RadarFilter {
  role: RadarRoleFilter;
  /** Class names (English, as the server sends them); empty = all. */
  classes: string[];
  /** Spec names (English); empty = all. */
  specs: string[];
  search: string;
  /** Hide specs with zero all-day records in the bracket (unless picked). */
  hideEmpty: boolean;
}

export const EMPTY_RADAR_FILTER: RadarFilter = {
  role: "all",
  classes: [],
  specs: [],
  search: "",
  hideEmpty: true,
};

/** Role words for search, from both dictionaries (role label + pool label),
 * so either language matches whatever the UI language is. */
const ROLE_WORDS: Record<RadarRole, string> = Object.fromEntries(
  (["healer", "dps", "tank"] as const).map((r) => [
    r,
    [
      r,
      ...LANGUAGES.flatMap((l) => [
        translate(l, `radar.role.${r}`),
        translate(l, `radar.pool.${r}`),
      ]),
    ].join(" "),
  ]),
) as Record<RadarRole, string>;

export function specDisplayName(spec: string, lang: Language): string {
  return lang === "zh" ? (SPEC_NAMES_ZH[spec] ?? spec) : spec;
}

export function classDisplayName(cls: string, lang: Language): string {
  return lang === "zh" ? (CLASS_NAMES_ZH[cls] ?? cls) : cls;
}

/** Spec icon base name for <SpellIcon> (main-process icon cache — the
 * collector's zamimg class icons are not used, see DATA-COMPLIANCE.md). */
export function radarSpecIcon(spec: string): string | undefined {
  const id = SPEC_ID_BY_EN[spec];
  return id === undefined ? undefined : (specIconName(id) ?? undefined);
}

/** Search matches either language whatever the UI language is. */
function haystack(s: RadarSpec): string {
  return [
    s.spec_name,
    s.class_name,
    SPEC_NAMES_ZH[s.spec_name] ?? "",
    CLASS_NAMES_ZH[s.class_name] ?? "",
    ROLE_WORDS[s.role] ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesSearch(s: RadarSpec, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || haystack(s).includes(q);
}

export interface FilteredSpecs {
  visible: RadarSpec[];
  matchedCount: number;
  hiddenEmptyCount: number;
}

export function filterSpecs(all: RadarSpec[], f: RadarFilter): FilteredSpecs {
  const matched = all.filter(
    (s) =>
      (f.role === "all" || s.role === f.role) &&
      (f.classes.length === 0 || f.classes.includes(s.class_name)) &&
      (f.specs.length === 0 || f.specs.includes(s.spec_name)) &&
      matchesSearch(s, f.search),
  );
  if (!f.hideEmpty)
    return {
      visible: matched,
      matchedCount: matched.length,
      hiddenEmptyCount: 0,
    };
  const nonEmpty = matched.filter(
    (s) => !s.no_data || f.specs.includes(s.spec_name),
  );
  // All matched are empty (e.g. Tank at 2600+): show them rather than nothing.
  if (nonEmpty.length === 0)
    return {
      visible: matched,
      matchedCount: matched.length,
      hiddenEmptyCount: 0,
    };
  return {
    visible: nonEmpty,
    matchedCount: matched.length,
    hiddenEmptyCount: matched.length - nonEmpty.length,
  };
}

/** Zero-sample specs always sort after active ones (handoff §3: a 0-sample
 * spec at 50.0 must never outrank an active spec below 50). */
export function sortSpecs(specs: RadarSpec[], key: RadarSortKey): RadarSpec[] {
  return [...specs].sort((a, b) => {
    if (a.no_data !== b.no_data) return a.no_data ? 1 : -1;
    if (key === "strength")
      return (
        b.strength_score - a.strength_score || b.timing_score - a.timing_score
      );
    if (key === "matches")
      return (
        b.window_matches - a.window_matches || b.timing_score - a.timing_score
      );
    return (
      b.timing_score - a.timing_score || b.strength_score - a.strength_score
    );
  });
}

/** The highlighted spec: best timing in the visible set, or best strength
 * when sorting by strength. */
export function topPick(
  sorted: RadarSpec[],
  key: RadarSortKey,
): RadarSpec | null {
  const active = sorted.filter((s) => !s.no_data);
  if (!active.length) return null;
  if (key === "strength") return active[0]!;
  return sortSpecs(active, "timing")[0]!;
}

export interface WindowActivity {
  current: number;
  mean: number;
  ratio: number;
}

/** Snapshot records in the evaluated window vs the 24-window mean, over the
 * visible subset (handoff §5.2). A proxy for activity, not queue data. */
export function windowActivity(
  visible: RadarSpec[],
  currentHour: number,
): WindowActivity {
  const totals = Array.from({ length: 24 }, (_, h) =>
    visible.reduce((acc, s) => acc + (s.hourly_curve[h]?.matches ?? 0), 0),
  );
  const current = totals[currentHour] ?? 0;
  const mean = totals.reduce((a, b) => a + b, 0) / 24;
  return { current, mean, ratio: mean > 0 ? current / mean : 0 };
}

export function roleCounts(all: RadarSpec[]): Record<RadarRoleFilter, number> {
  const c: Record<RadarRoleFilter, number> = {
    all: all.length,
    healer: 0,
    dps: 0,
    tank: 0,
  };
  for (const s of all) if (s.role in c) c[s.role]++;
  return c;
}

export interface RadarClassEntry {
  className: string;
  color: string;
  specs: RadarSpec[];
}

export function classEntries(
  all: RadarSpec[],
  lang: Language,
): RadarClassEntry[] {
  const by = new Map<string, RadarClassEntry>();
  for (const s of all) {
    let e = by.get(s.class_name);
    if (!e) {
      e = { className: s.class_name, color: s.color ?? "#a0aec0", specs: [] };
      by.set(s.class_name, e);
    }
    e.specs.push(s);
  }
  const collator = new Intl.Collator(lang === "zh" ? "zh-CN" : "en");
  return [...by.values()].sort((a, b) =>
    collator.compare(
      classDisplayName(a.className, lang),
      classDisplayName(b.className, lang),
    ),
  );
}

/** Toggle one item in a list (returns a new array). */
export function toggled<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Select every listed spec, or deselect them all when all are selected. */
export function toggleAll(
  selected: readonly string[],
  specs: readonly string[],
): string[] {
  if (specs.every((s) => selected.includes(s)))
    return selected.filter((s) => !specs.includes(s));
  return [...selected, ...specs.filter((s) => !selected.includes(s))];
}

export function hasActiveFilter(f: RadarFilter): boolean {
  return (
    f.role !== "all" ||
    f.classes.length > 0 ||
    f.specs.length > 0 ||
    !!f.search.trim()
  );
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** CSS modifier for a tier key; unknown keys read as the neutral tier. */
export function tierClass(key: RadarTierKey | string | undefined): string {
  switch (key) {
    case "t0":
    case "t1":
    case "t2":
    case "t3":
    case "avoid":
    case "none":
      return `radar-tier-${key}`;
    default:
      return "radar-tier-t2";
  }
}

export function fmtSigned(v: number, digits = 1): string {
  const n = Number(v) || 0;
  return (n > 0 ? "+" : "") + n.toFixed(digits);
}

export function fmtHour(h: number): string {
  return String(h).padStart(2, "0");
}

// ── personal roster preset (localStorage) ──────────────────────────────

export const RADAR_ROSTER_KEY = "gladlog.specRadar.roster";
export const RADAR_SOURCE_KEY = "gladlog.specRadar.baseUrl";

export function loadRoster(
  storage: Pick<Storage, "getItem"> | undefined,
): string[] {
  try {
    const raw = storage?.getItem(RADAR_ROSTER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
