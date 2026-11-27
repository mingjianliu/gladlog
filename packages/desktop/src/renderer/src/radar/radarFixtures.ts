// Test-only builders for radar specs / responses (shared by the view and
// component tests).
import type { RadarSpec, SpecTimingResponse } from "../../../shared/specRadar";

export function spec(
  spec_name: string,
  class_name: string,
  role: RadarSpec["role"],
  over: Partial<RadarSpec> = {},
  matchesByHour: (h: number) => number = () => 10,
): RadarSpec {
  return {
    spec_name,
    class_name,
    role,
    color: "#fff",
    no_data: false,
    timing_score: 50,
    timing_tier_key: "t2",
    timing_tier: "",
    window_matches: 10,
    window_low_sample: true,
    window_win_rate: 50,
    window_avg_diff: 0,
    window_big_loss_rate: 20,
    dev_win_rate: 0,
    dev_avg_diff: 0,
    dev_big_loss_rate: 0,
    next_timing_score: 50,
    next_trend: "stable",
    best_hours: [],
    worst_hours: [],
    strength_score: 50,
    strength_tier_key: "t2",
    strength_tier: "",
    baseline_role: role,
    strength_matches: 100,
    strength_low_sample: false,
    allday_win_rate: 50,
    allday_avg_diff: 0,
    allday_big_loss_rate: 20,
    excess_win_rate: 0,
    excess_avg_diff: 0,
    excess_big_loss_rate: 0,
    hourly_curve: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      score: 50,
      tier_key: "t2" as const,
      tier: "",
      matches: matchesByHour(hour),
      low_sample: false,
      win_rate: 50,
      avg_diff: 0,
      dev_avg_diff: 0,
      dev_win_rate: 0,
    })),
    ...over,
  };
}

const POOL = { matches: 100, win_rate: 50, avg_diff: 10, big_loss_rate: 24 };

export function response(
  specs: RadarSpec[],
  over: Partial<SpecTimingResponse> = {},
): SpecTimingResponse {
  return {
    region: "us",
    role: "all",
    rating_tier: "2600",
    tier_label: "",
    current_hour: 5,
    next_hour: 6,
    window_label: "",
    server_time_str: "2026-11-26 05:00:00",
    timezone_label: "",
    data_span_days: 14,
    pool_allday: POOL,
    pools_by_role: { all: POOL, healer: POOL, dps: POOL, tank: POOL },
    method: {
      prior_records: 30,
      hour_prior_records: 60,
      low_sample: 30,
      big_loss: -30,
      weights: [0.4, 0.4, 0.2],
      strength_scales: [1.2, 5.5, 2.6],
      timing_scales: [0.85, 3.7, 2.2],
    },
    specs,
    ...over,
  };
}
