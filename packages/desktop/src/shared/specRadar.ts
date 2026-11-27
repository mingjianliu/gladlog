// Solo Shuffle all-spec timing radar: the wire contract of the server's
// `GET /api/tracker/spec_timing` (handoff: wow-talent-gear-collector
// docs/handoff-spec-timing-radar.md §4). gladlog only renders it — collection,
// dedup, bracketing and scoring all live server-side, so nothing here
// recomputes a score. Shared by main (fetch + validation) and the renderer.

export type RadarRegion = "us" | "eu" | "all";
export type RadarRatingTier = "2600" | "2400" | "2100" | "below_2100" | "all";
export type RadarRole = "healer" | "dps" | "tank";
export type RadarTierKey = "t0" | "t1" | "t2" | "t3" | "avoid" | "none";

export const RADAR_REGIONS: readonly RadarRegion[] = ["us", "eu", "all"];
export const RADAR_RATING_TIERS: readonly RadarRatingTier[] = [
  "2600",
  "2400",
  "2100",
  "below_2100",
  "all",
];

/** The collector's local server (wow_advisor/settings.py SERVER_PORT). The
 * central server replaces it once deployed; `GLADLOG_SPEC_RADAR_URL` or the
 * page's own source field override it meanwhile. */
export const DEFAULT_RADAR_BASE_URL = "http://127.0.0.1:8080";

export interface RadarPool {
  matches: number;
  win_rate: number;
  avg_diff: number;
  big_loss_rate: number;
}

export interface RadarHourPoint {
  hour: number;
  score: number;
  tier_key: RadarTierKey;
  tier: string;
  matches: number;
  low_sample: boolean;
  win_rate: number;
  avg_diff: number;
  dev_avg_diff: number;
  dev_win_rate: number;
}

export interface RadarHourRef {
  hour: number;
  score: number;
  low_sample: boolean;
}

export interface RadarSpec {
  spec_name: string;
  class_name: string;
  role: RadarRole;
  color?: string;
  no_data: boolean;
  timing_score: number;
  timing_tier_key: RadarTierKey;
  timing_tier: string;
  window_matches: number;
  window_low_sample: boolean;
  window_win_rate: number;
  window_avg_diff: number;
  window_big_loss_rate: number;
  dev_win_rate: number;
  dev_avg_diff: number;
  dev_big_loss_rate: number;
  next_timing_score: number;
  next_trend: "up" | "down" | "stable" | string;
  best_hours: RadarHourRef[];
  worst_hours: RadarHourRef[];
  strength_score: number;
  strength_tier_key: RadarTierKey;
  strength_tier: string;
  baseline_role: string;
  baseline_label?: string;
  strength_matches: number;
  strength_low_sample: boolean;
  allday_win_rate: number;
  allday_avg_diff: number;
  allday_big_loss_rate: number;
  excess_win_rate: number;
  excess_avg_diff: number;
  excess_big_loss_rate: number;
  hourly_curve: RadarHourPoint[];
}

export interface SpecTimingResponse {
  region: RadarRegion;
  role: string;
  rating_tier: RadarRatingTier;
  tier_label: string;
  current_hour: number;
  next_hour: number;
  window_label: string;
  server_time_str: string;
  timezone_label: string;
  data_span_days: number;
  pool_allday: RadarPool;
  pools_by_role: Partial<Record<"all" | RadarRole, RadarPool>>;
  activity?: {
    window_records: number;
    mean_window_records: number;
    ratio: number;
    note?: string;
  };
  method: {
    prior_records: number;
    hour_prior_records: number;
    low_sample: number;
    big_loss: number;
    weights: number[];
    strength_scales: number[];
    timing_scales: number[];
  };
  specs: RadarSpec[];
}

export interface SpecTimingQuery {
  region: RadarRegion;
  ratingTier: RadarRatingTier;
  /** null = the server's current hour in the region's clock. */
  hour: number | null;
  /** Overrides the configured server for this request (the page's source
   * field). */
  baseUrl?: string;
}

export type SpecTimingResult =
  | { ok: true; data: SpecTimingResponse; url: string; fetchedAt: number }
  | { ok: false; error: string; url: string };

export interface SpecRadarConfig {
  /** Whether the page's top tab is shown at all (hidden until it ships). */
  enabled: boolean;
  baseUrl: string;
}

/** The request URL for a query — one place, so main's fetch and the page's
 * "source" line cannot disagree. Throws on a non-http(s) base. */
export function specTimingUrl(baseUrl: string, q: SpecTimingQuery): string {
  const u = new URL("/api/tracker/spec_timing", baseUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error(`unsupported protocol ${u.protocol}`);
  u.searchParams.set("region", q.region);
  u.searchParams.set("rating_tier", q.ratingTier);
  if (q.hour !== null) u.searchParams.set("hour", String(q.hour));
  return u.toString();
}

/** Structural check of the fields the page dereferences; returns the first
 * problem, or null. Not a full schema — enough that a wrong server or an
 * older contract shows an error instead of a blank page. */
export function specTimingShapeError(x: unknown): string | null {
  if (!x || typeof x !== "object") return "response is not an object";
  const d = x as Record<string, unknown>;
  if (!Array.isArray(d.specs)) return "missing specs[]";
  if (typeof d.current_hour !== "number") return "missing current_hour";
  for (const s of d.specs as Record<string, unknown>[]) {
    if (typeof s?.spec_name !== "string") return "spec without spec_name";
    if (!Array.isArray(s.hourly_curve) || s.hourly_curve.length !== 24)
      return `${s.spec_name}: hourly_curve is not 24 points`;
    if (
      typeof s.timing_score !== "number" ||
      typeof s.strength_score !== "number"
    )
      return `${s.spec_name}: missing scores`;
  }
  return null;
}
