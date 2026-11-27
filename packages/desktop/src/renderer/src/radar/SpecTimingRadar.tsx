// Solo Shuffle all-spec timing radar (全专精择时雷达). Renders the radar
// server's /api/tracker/spec_timing response; the page computes no score of
// its own (see radarView.ts). Hidden top tab — App shows it only when
// main/specRadar.ts says enabled.

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { MessageKey } from "../../../shared/i18n";
import {
  RADAR_RATING_TIERS,
  RADAR_REGIONS,
  type RadarHourRef,
  type RadarPool,
  type RadarRatingTier,
  type RadarRegion,
  type RadarSpec,
  type RadarTierKey,
  type SpecTimingResult,
} from "../../../shared/specRadar";
import { bridge } from "../bridge";
import { useT } from "../i18n/LangProvider";
import { SpellIcon } from "../report/components/SpellIcon";
import {
  classDisplayName,
  classEntries,
  EMPTY_RADAR_FILTER,
  filterSpecs,
  fmtHour,
  fmtSigned,
  hasActiveFilter,
  loadRoster,
  matchesSearch,
  RADAR_ROSTER_KEY,
  RADAR_SOURCE_KEY,
  type RadarFilter,
  type RadarRoleFilter,
  type RadarSortKey,
  radarSpecIcon,
  roleCounts,
  sameSet,
  sortSpecs,
  specDisplayName,
  tierClass,
  toggleAll,
  toggled,
  topPick,
  windowActivity,
} from "./radarView";

const AUTO_REFRESH_MS = 5 * 60_000;

/** Bracket buttons: numbers read the same in both languages; only "all"
 * goes through the dictionary. */
const TIER_TEXT: Record<Exclude<RadarRatingTier, "all">, string> = {
  "2600": "2600+",
  "2400": "2400–2599",
  "2100": "2100–2399",
  below_2100: "< 2100",
};
const REGION_KEY: Record<RadarRegion, MessageKey> = {
  us: "radar.region.us",
  eu: "radar.region.eu",
  all: "radar.region.all",
};
const ROLE_KEY: Record<RadarRoleFilter, MessageKey> = {
  all: "radar.role.all",
  healer: "radar.role.healer",
  dps: "radar.role.dps",
  tank: "radar.role.tank",
};
const TIMING_TIER_KEY: Record<RadarTierKey, MessageKey> = {
  t0: "radar.timingTier.t0",
  t1: "radar.timingTier.t1",
  t2: "radar.timingTier.t2",
  t3: "radar.timingTier.t3",
  avoid: "radar.timingTier.avoid",
  none: "radar.noData",
};
const STRENGTH_TIER_KEY: Record<RadarTierKey, MessageKey> = {
  t0: "radar.strengthTier.t0",
  t1: "radar.strengthTier.t1",
  t2: "radar.strengthTier.t2",
  t3: "radar.strengthTier.t3",
  avoid: "radar.strengthTier.avoid",
  none: "radar.noData",
};
const POOL_KEY: Record<string, MessageKey> = {
  healer: "radar.pool.healer",
  dps: "radar.pool.dps",
  tank: "radar.pool.tank",
  all: "radar.pool.all",
};
const SORT_KEY: Record<RadarSortKey, MessageKey> = {
  timing: "radar.sort.timing",
  strength: "radar.sort.strength",
  matches: "radar.sort.matches",
};

type Tagged<T> = T & { key: string };

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function SpecTimingRadar() {
  const { t, lang } = useT();
  const [region, setRegion] = useState<RadarRegion>("us");
  const [ratingTier, setRatingTier] = useState<RadarRatingTier>("2600");
  const [hour, setHour] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<RadarSortKey>("timing");
  const [filter, setFilter] = useState<RadarFilter>(EMPTY_RADAR_FILTER);
  // Every response is tagged with the selection it was fetched for and only
  // shown under that selection: a refresh of the same selection keeps the
  // last good table (error above it), but switching bracket / region / hour
  // / source never leaves the old selection's scores on screen.
  const [result, setResult] = useState<Tagged<SpecTimingResult> | null>(null);
  const [good, setGood] = useState<Tagged<
    SpecTimingResult & { ok: true }
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [defaultBase, setDefaultBase] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>(
    () => safeStorage()?.getItem(RADAR_SOURCE_KEY) ?? "",
  );
  const [baseDraft, setBaseDraft] = useState(baseUrl);
  const [roster, setRoster] = useState<string[]>(() =>
    loadRoster(safeStorage()),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const reqSeq = useRef(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      void bridge()
        .specRadar.getConfig()
        .then((c) => setDefaultBase(c.baseUrl))
        .catch(() => {});
    } catch {
      /* fixture without this surface */
    }
  }, []);

  const queryKey = `${region}|${ratingTier}|${hour ?? "live"}|${baseUrl}`;

  useEffect(() => {
    const seq = ++reqSeq.current;
    const key = `${region}|${ratingTier}|${hour ?? "live"}|${baseUrl}`;
    setLoading(true);
    let p: Promise<SpecTimingResult>;
    try {
      p = bridge().specRadar.fetch({
        region,
        ratingTier,
        hour,
        baseUrl: baseUrl || undefined,
      });
    } catch (e) {
      p = Promise.resolve({ ok: false, error: String(e), url: "" });
    }
    void p
      .catch((e: unknown): SpecTimingResult => ({
        ok: false,
        error: String(e),
        url: "",
      }))
      .then((r) => {
        if (seq !== reqSeq.current) return;
        setResult({ ...r, key });
        if (r.ok) setGood({ ...r, key });
        setLoading(false);
      });
  }, [region, ratingTier, hour, baseUrl, refreshTick]);

  // Live mode follows the clock: refetch periodically so the window rolls
  // over on the hour without a click.
  useEffect(() => {
    if (hour !== null) return;
    const id = setInterval(() => setRefreshTick((n) => n + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [hour]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const shownGood = good?.key === queryKey ? good : null;
  const data = shownGood?.data ?? null;
  const allSpecs = useMemo(() => data?.specs ?? [], [data]);

  const { visible, hiddenEmptyCount } = useMemo(
    () => filterSpecs(allSpecs, filter),
    [allSpecs, filter],
  );
  const specs = useMemo(() => sortSpecs(visible, sortKey), [visible, sortKey]);
  const top = useMemo(() => topPick(specs, sortKey), [specs, sortKey]);
  const activity = useMemo(
    () => windowActivity(visible, data?.current_hour ?? 0),
    [visible, data],
  );
  const counts = useMemo(() => roleCounts(allSpecs), [allSpecs]);
  const classes = useMemo(() => classEntries(allSpecs, lang), [allSpecs, lang]);
  const byName = useMemo(
    () => new Map(allSpecs.map((s) => [s.spec_name, s])),
    [allSpecs],
  );

  const name = useCallback(
    (s: RadarSpec) => specDisplayName(s.spec_name, lang),
    [lang],
  );
  const timingTier = (k: RadarTierKey) =>
    t(TIMING_TIER_KEY[k] ?? "radar.timingTier.t2");
  const strengthTier = (k: RadarTierKey) =>
    t(STRENGTH_TIER_KEY[k] ?? "radar.strengthTier.t2");
  const poolLabel = (role: string) => t(POOL_KEY[role] ?? "radar.pool.all");

  const patchFilter = (p: Partial<RadarFilter>) =>
    setFilter((f) => ({ ...f, ...p }));
  const toggleSpec = (spec: string) =>
    setFilter((f) => ({ ...f, specs: toggled(f.specs, spec) }));
  const resetFilters = () =>
    setFilter((f) => ({ ...EMPTY_RADAR_FILTER, hideEmpty: f.hideEmpty }));

  const saveRoster = () => {
    setRoster(filter.specs);
    try {
      safeStorage()?.setItem(RADAR_ROSTER_KEY, JSON.stringify(filter.specs));
    } catch {
      /* storage full / unavailable */
    }
  };
  const clearRoster = () => {
    setRoster([]);
    try {
      safeStorage()?.removeItem(RADAR_ROSTER_KEY);
    } catch {
      /* noop */
    }
  };
  const applySource = () => {
    const v = baseDraft.trim();
    setBaseUrl(v);
    try {
      if (v) safeStorage()?.setItem(RADAR_SOURCE_KEY, v);
      else safeStorage()?.removeItem(RADAR_SOURCE_KEY);
    } catch {
      /* noop */
    }
  };

  const tzLabel = data
    ? t(data.region === "eu" ? "radar.tz.eu" : "radar.tz.us")
    : "";
  const windowLabel = data
    ? `${fmtHour(data.current_hour)}:00 – ${fmtHour((data.current_hour + 2) % 24)}:00`
    : "";

  const hourList = (list: RadarHourRef[], noData: boolean) =>
    noData || list.length === 0 ? (
      <span className="radar-dim">–</span>
    ) : (
      list.map((w, i) => (
        <span key={w.hour}>
          {i > 0 && <span className="radar-dim"> · </span>}
          <button
            type="button"
            className={`radar-hour-link${w.low_sample ? " radar-low" : ""}`}
            title={t("radar.hourLinkTip", {
              score: w.score.toFixed(1),
              low: w.low_sample ? t("radar.lowSampleSuffix") : "",
            })}
            onClick={() => setHour(w.hour)}
          >
            {fmtHour(w.hour)}
          </button>
        </span>
      ))
    );

  const scoreCell = (
    score: number,
    key: RadarTierKey,
    label: string,
    noData: boolean,
  ) =>
    noData ? (
      <>
        <span className="radar-pill radar-tier-none">–</span>
        <div className="radar-cell-sub radar-dim">{t("radar.noData")}</div>
      </>
    ) : (
      <>
        <div className="radar-score-row">
          <span className={`radar-pill ${tierClass(key)}`}>
            {score.toFixed(1)}
          </span>
          <span className="radar-score-track">
            <span
              className={`radar-score-fill ${tierClass(key)}`}
              style={{ width: `${Math.min(100, Math.max(3, score))}%` }}
            />
          </span>
        </div>
        <div className={`radar-cell-sub radar-tier-text ${tierClass(key)}`}>
          {label}
        </div>
      </>
    );

  const signed = (v: number, invert = false) => {
    const good = invert ? v < 0 : v > 0;
    const cls =
      Math.abs(v) < 0.05 ? "radar-dim" : good ? "radar-pos" : "radar-neg";
    return <span className={cls}>{fmtSigned(v)}</span>;
  };

  const hourTip = (s: RadarSpec, h: RadarSpec["hourly_curve"][number]) =>
    t("radar.hourTip", {
      spec: name(s),
      hour: fmtHour(h.hour),
      score: h.score.toFixed(1),
      tier: timingTier(h.tier_key),
      wr: h.win_rate.toFixed(1),
      dwr: fmtSigned(h.dev_win_rate),
      diff: fmtSigned(h.avg_diff),
      ddiff: fmtSigned(h.dev_avg_diff),
      n: h.matches,
      low: h.low_sample ? t("radar.lowSampleSuffix") : "",
    });

  const pool = (label: string, p: RadarPool | undefined) =>
    p ? (
      <span key={label}>
        {t("radar.banner.pool", {
          label,
          wr: p.win_rate.toFixed(1),
          diff: fmtSigned(p.avg_diff),
          bl: p.big_loss_rate.toFixed(1),
          n: p.matches,
        })}
      </span>
    ) : null;

  const menuGroups = useMemo(
    () =>
      classes
        .map((c) => ({
          ...c,
          specs: c.specs.filter((s) => matchesSearch(s, menuQuery)),
        }))
        .filter((c) => c.specs.length > 0),
    [classes, menuQuery],
  );

  const error = result && !result.ok && result.key === queryKey ? result : null;
  const activeFilter = hasActiveFilter(filter);
  const rosterLoaded = roster.length > 0 && sameSet(roster, filter.specs);

  return (
    <div className="radar-page" data-testid="spec-radar">
      <header className="radar-head">
        <div>
          <h2>{t("radar.title")}</h2>
          <p className="radar-dim">{t("radar.subtitle")}</p>
        </div>
        <div className="radar-source">
          <label>
            <span className="radar-dim">{t("radar.source")}</span>
            <input
              type="text"
              value={baseDraft}
              placeholder={defaultBase}
              onChange={(e) => setBaseDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySource()}
              spellCheck={false}
            />
          </label>
          <button type="button" onClick={applySource}>
            {t("radar.source.apply")}
          </button>
          <button
            type="button"
            onClick={() => setRefreshTick((n) => n + 1)}
            disabled={loading}
          >
            {loading ? t("radar.loading") : t("radar.refresh")}
          </button>
        </div>
      </header>

      <section className="radar-controls">
        <div className="radar-row">
          <div className="radar-group">
            <span className="radar-label">{t("radar.label.tier")}</span>
            <div className="radar-seg">
              {RADAR_RATING_TIERS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={k === ratingTier ? "active" : ""}
                  onClick={() => setRatingTier(k)}
                >
                  {k === "all" ? t("radar.tier.all") : TIER_TEXT[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="radar-group">
            <span className="radar-label">{t("radar.label.region")}</span>
            <div className="radar-seg">
              {RADAR_REGIONS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={k === region ? "active" : ""}
                  onClick={() => setRegion(k)}
                >
                  {t(REGION_KEY[k])}
                </button>
              ))}
            </div>
          </div>
          <div className="radar-group">
            <span className="radar-label">{t("radar.label.hour")}</span>
            <select
              value={hour === null ? "" : String(hour)}
              onChange={(e) =>
                setHour(e.target.value === "" ? null : Number(e.target.value))
              }
            >
              <option value="">{t("radar.hour.live")}</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {`${fmtHour(h)}:00 – ${fmtHour((h + 2) % 24)}:00`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="radar-row">
          <div className="radar-group">
            <span className="radar-label">{t("radar.label.role")}</span>
            <div className="radar-seg">
              {(["all", "healer", "dps", "tank"] as RadarRoleFilter[]).map(
                (r) => (
                  <button
                    key={r}
                    type="button"
                    className={r === filter.role ? "active" : ""}
                    onClick={() => patchFilter({ role: r })}
                  >
                    {t(ROLE_KEY[r])} ({counts[r]})
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="radar-group radar-grow" ref={menuRef}>
            <span className="radar-label">{t("radar.label.specs")}</span>
            <div className="radar-dropdown">
              <button
                type="button"
                className="radar-drop-trigger"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                {filter.specs.length === 0 ? (
                  <span className="radar-dim">{t("radar.specs.none")}</span>
                ) : (
                  <span>
                    {filter.specs.slice(0, 3).map((sn, i) => (
                      <span key={sn}>
                        {i > 0 && <span className="radar-dim">, </span>}
                        <span style={{ color: byName.get(sn)?.color }}>
                          {specDisplayName(sn, lang)}
                        </span>
                      </span>
                    ))}
                    <span className="radar-dim">
                      {" "}
                      {filter.specs.length > 3
                        ? t("radar.specs.more", { n: filter.specs.length })
                        : `(${filter.specs.length})`}
                    </span>
                  </span>
                )}
                <span className="radar-dim">▾</span>
              </button>
              {menuOpen && (
                <div className="radar-drop-menu">
                  <div className="radar-drop-search">
                    <input
                      type="text"
                      autoFocus
                      value={menuQuery}
                      placeholder={t("radar.search.placeholder")}
                      onChange={(e) => setMenuQuery(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => patchFilter({ specs: [] })}
                    >
                      {t("radar.clear")}
                    </button>
                  </div>
                  <div className="radar-drop-list">
                    {menuGroups.length === 0 && (
                      <div className="radar-empty">{t("radar.noMatch")}</div>
                    )}
                    {menuGroups.map((c) => {
                      // the whole class, not only the specs the search shows
                      const names = (
                        classes.find((k) => k.className === c.className)
                          ?.specs ?? c.specs
                      ).map((s) => s.spec_name);
                      const allSel = names.every((n) =>
                        filter.specs.includes(n),
                      );
                      return (
                        <div key={c.className}>
                          <button
                            type="button"
                            className="radar-drop-class"
                            onClick={() =>
                              patchFilter({
                                specs: toggleAll(filter.specs, names),
                              })
                            }
                          >
                            <span style={{ color: c.color }}>
                              {classDisplayName(c.className, lang)}
                            </span>
                            <span className="radar-dim">
                              {allSel
                                ? t("radar.specs.unselectClass")
                                : t("radar.specs.selectClass")}
                            </span>
                          </button>
                          {c.specs.map((s) => {
                            const on = filter.specs.includes(s.spec_name);
                            return (
                              <button
                                key={s.spec_name}
                                type="button"
                                className={`radar-drop-item${on ? " active" : ""}`}
                                onClick={() => toggleSpec(s.spec_name)}
                              >
                                <span className="radar-check">
                                  {on ? "☑" : "☐"}
                                </span>
                                <SpellIcon
                                  icon={radarSpecIcon(s.spec_name)}
                                  label={name(s)}
                                  size={16}
                                />
                                <span style={{ color: s.color }}>
                                  {name(s)}
                                </span>
                                <span className="radar-dim radar-push">
                                  {t("radar.records", {
                                    n: s.strength_matches,
                                  })}{" "}
                                  · {t(ROLE_KEY[s.role])}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="radar-group">
            <span className="radar-label">{t("radar.label.search")}</span>
            <input
              type="search"
              className="radar-search"
              value={filter.search}
              placeholder={t("radar.search.placeholder")}
              onChange={(e) => patchFilter({ search: e.target.value })}
            />
          </div>

          <div className="radar-group">
            <span className="radar-label">{t("radar.label.empty")}</span>
            <button
              type="button"
              className={filter.hideEmpty ? "active" : ""}
              onClick={() => patchFilter({ hideEmpty: !filter.hideEmpty })}
            >
              {filter.hideEmpty
                ? t("radar.empty.hidden")
                : t("radar.empty.shown")}
            </button>
          </div>
        </div>

        <div className="radar-pills">
          <span className="radar-dim">{t("radar.label.classes")}</span>
          <button
            type="button"
            className={`radar-pill-btn${filter.classes.length === 0 ? " active" : ""}`}
            onClick={() => patchFilter({ classes: [] })}
          >
            {t("radar.classes.all")}
          </button>
          {classes.map((c) => {
            const on = filter.classes.includes(c.className);
            return (
              <button
                key={c.className}
                type="button"
                className={`radar-pill-btn${on ? " active" : ""}`}
                onClick={() =>
                  patchFilter({ classes: toggled(filter.classes, c.className) })
                }
              >
                <span
                  className="radar-class-dot"
                  style={{ background: c.color }}
                />
                {classDisplayName(c.className, lang)}
              </button>
            );
          })}
        </div>

        {(activeFilter || roster.length > 0) && (
          <div className="radar-pills">
            {filter.specs.length > 0 && (
              <>
                <span className="radar-dim">{t("radar.chips.picked")}</span>
                {filter.specs.map((sn) => (
                  <button
                    key={sn}
                    type="button"
                    className="radar-chip"
                    onClick={() => toggleSpec(sn)}
                  >
                    <span style={{ color: byName.get(sn)?.color }}>
                      {specDisplayName(sn, lang)}
                    </span>{" "}
                    <span className="radar-dim">✕</span>
                  </button>
                ))}
                {!rosterLoaded && (
                  <button
                    type="button"
                    className="radar-pill-btn"
                    onClick={saveRoster}
                  >
                    {t("radar.roster.save")}
                  </button>
                )}
              </>
            )}
            {roster.length > 0 &&
              (rosterLoaded ? (
                <span className="radar-pos">
                  {t("radar.roster.loaded", { n: roster.length })}{" "}
                  <button
                    type="button"
                    className="radar-link"
                    onClick={clearRoster}
                  >
                    {t("radar.roster.forget")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="radar-pill-btn radar-gold"
                  onClick={() => patchFilter({ specs: [...roster] })}
                >
                  {t("radar.roster.load", { n: roster.length })}
                </button>
              ))}
            {activeFilter && (
              <button
                type="button"
                className="radar-pill-btn radar-push"
                onClick={resetFilters}
              >
                {t("radar.resetFilters")}
              </button>
            )}
          </div>
        )}
      </section>

      {error && (
        <div className="radar-error" role="alert">
          {t("radar.error", { error: error.error })}
          {error.url && <code>{error.url}</code>}
          {!data && <div className="radar-dim">{t("radar.error.hint")}</div>}
        </div>
      )}
      {!data && !error && (
        <div className="radar-empty">{t("radar.loading")}</div>
      )}

      {data && (
        <>
          <section className="radar-banner">
            <div className="radar-banner-main">
              <strong>{t("radar.banner.window", { w: windowLabel })}</strong>
              <span className="radar-dim">
                {t("radar.banner.clock", {
                  tz: tzLabel,
                  now: data.server_time_str,
                })}
                {hour !== null && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="radar-link"
                      onClick={() => setHour(null)}
                    >
                      {t("radar.banner.backToLive")}
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="radar-banner-stats">
              {filter.role === "all"
                ? [
                    pool(poolLabel("healer"), data.pools_by_role.healer),
                    pool(poolLabel("dps"), data.pools_by_role.dps),
                  ]
                : pool(
                    poolLabel(filter.role),
                    data.pools_by_role[filter.role] ?? data.pool_allday,
                  )}
              <span title={t("radar.banner.activityTip")}>
                {t("radar.banner.activity", {
                  cur: activity.current,
                  mean: activity.mean.toFixed(1),
                })}{" "}
                <span
                  className={
                    activity.ratio >= 1.15
                      ? "radar-pos"
                      : activity.ratio <= 0.85
                        ? "radar-warn"
                        : "radar-dim"
                  }
                >
                  ×{activity.ratio.toFixed(2)}
                </span>
                )
              </span>
              <span>{t("radar.banner.span", { d: data.data_span_days })}</span>
            </div>
            <p className="radar-note">{t("radar.banner.note")}</p>
          </section>

          {top && (
            <section className="radar-top">
              <div className="radar-top-left">
                <SpellIcon
                  icon={radarSpecIcon(top.spec_name)}
                  label={name(top)}
                  size={40}
                />
                <div>
                  <div className="radar-top-badges">
                    <span className="radar-badge-gold">
                      {sortKey === "strength"
                        ? t("radar.top.byStrength")
                        : t("radar.top.byTiming")}
                    </span>
                    <span className="radar-dim">{t(ROLE_KEY[top.role])}</span>
                    <span
                      className={`radar-pill ${tierClass(top.timing_tier_key)}`}
                    >
                      {t("radar.top.timing", {
                        s: top.timing_score.toFixed(1),
                        tier: timingTier(top.timing_tier_key),
                      })}
                    </span>
                    <span
                      className={`radar-pill ${tierClass(top.strength_tier_key)}`}
                      title={t("radar.vsPool", {
                        pool: poolLabel(top.baseline_role),
                      })}
                    >
                      {t("radar.top.strength", {
                        s: top.strength_score.toFixed(1),
                        tier: strengthTier(top.strength_tier_key),
                      })}
                    </span>
                    {top.window_low_sample && (
                      <span className="radar-warn-tag">
                        {t("radar.lowSample")}
                      </span>
                    )}
                  </div>
                  <h3 style={{ color: top.color }}>
                    {name(top)}
                    {lang === "zh" && (
                      <small className="radar-dim">{top.spec_name}</small>
                    )}
                  </h3>
                  <div className="radar-dim">
                    {t("radar.top.best")} {hourList(top.best_hours, false)}
                    {"  |  "}
                    {t("radar.top.worst")} {hourList(top.worst_hours, false)}
                  </div>
                </div>
              </div>
              <div className="radar-top-stats">
                <Stat label={t("radar.top.wr")}>
                  {top.window_win_rate.toFixed(1)}%{" "}
                  <small>({signed(top.dev_win_rate)})</small>
                </Stat>
                <Stat label={t("radar.top.diff")}>
                  {fmtSigned(top.window_avg_diff)}{" "}
                  <small>({signed(top.dev_avg_diff)})</small>
                </Stat>
                <Stat label={t("radar.top.bl")}>
                  {top.window_big_loss_rate.toFixed(1)}%{" "}
                  <small>({signed(top.dev_big_loss_rate, true)})</small>
                </Stat>
                <Stat label={t("radar.top.samples")}>
                  {top.window_matches} <small>/ {top.strength_matches}</small>
                </Stat>
              </div>
            </section>
          )}

          <section className="radar-card">
            <div className="radar-card-head">
              <div>
                <h3>{t("radar.table.title")}</h3>
                <span className="radar-dim">{t("radar.table.sub")}</span>
              </div>
              <div className="radar-sort">
                <span className="radar-dim">{t("radar.sort")}</span>
                {(["timing", "strength", "matches"] as RadarSortKey[]).map(
                  (k) => (
                    <button
                      key={k}
                      type="button"
                      className={k === sortKey ? "active" : ""}
                      onClick={() => setSortKey(k)}
                    >
                      {t(SORT_KEY[k])}
                    </button>
                  ),
                )}
                <span className="radar-dim radar-push">
                  {t("radar.table.showing", {
                    n: specs.length,
                    total: allSpecs.length,
                  })}
                  {hiddenEmptyCount > 0 && (
                    <>
                      {" "}
                      {t("radar.table.hiddenEmpty", {
                        n: hiddenEmptyCount,
                      })}{" "}
                      <button
                        type="button"
                        className="radar-link"
                        onClick={() => patchFilter({ hideEmpty: false })}
                      >
                        {t("radar.table.showEmpty")}
                      </button>
                    </>
                  )}
                </span>
              </div>
            </div>
            {specs.length === 0 ? (
              <div className="radar-empty">
                <div>{t("radar.noMatch")}</div>
                <button type="button" onClick={resetFilters}>
                  {t("radar.resetFilters")}
                </button>
              </div>
            ) : (
              <div className="radar-scroll">
                <table className="radar-table">
                  <thead>
                    <tr>
                      <th className="radar-num">#</th>
                      <th>{t("radar.col.spec")}</th>
                      <th
                        className="radar-sep-timing"
                        title={t("radar.col.timingTip")}
                      >
                        {t("radar.col.timing")}
                      </th>
                      <th title={t("radar.col.windowTip")}>
                        {t("radar.col.window")}
                      </th>
                      <th title={t("radar.col.nextTip")}>
                        {t("radar.col.next")}
                      </th>
                      <th title={t("radar.col.hoursTip")}>
                        {t("radar.col.hours")}
                      </th>
                      <th title={t("radar.col.sparkTip")}>24h</th>
                      <th
                        className="radar-sep-strength"
                        title={t("radar.col.strengthTip")}
                      >
                        {t("radar.col.strength")}
                      </th>
                      <th title={t("radar.col.alldayTip")}>
                        {t("radar.col.allday")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {specs.map((s, idx) => {
                      const picked = filter.specs.includes(s.spec_name);
                      const first = idx === 0 && !s.no_data;
                      const delta = s.next_timing_score - s.timing_score;
                      return (
                        <tr
                          key={s.spec_name}
                          className={
                            first
                              ? "radar-first"
                              : s.no_data
                                ? "radar-nodata"
                                : ""
                          }
                        >
                          <td
                            className={`radar-num${first ? " radar-gold" : " radar-dim"}`}
                          >
                            {idx + 1}
                          </td>
                          <td>
                            <div className="radar-spec">
                              <SpellIcon
                                icon={radarSpecIcon(s.spec_name)}
                                label={name(s)}
                                size={22}
                              />
                              <div>
                                <div className="radar-spec-line">
                                  <span
                                    className="radar-spec-name"
                                    style={{ color: s.color }}
                                  >
                                    {name(s)}
                                  </span>
                                  <span className="radar-dim">
                                    {t(ROLE_KEY[s.role])}
                                  </span>
                                  <button
                                    type="button"
                                    className={`radar-link${picked ? " radar-picked" : ""}`}
                                    onClick={() => toggleSpec(s.spec_name)}
                                    title={
                                      picked
                                        ? t("radar.compare.removeTip")
                                        : t("radar.compare.addTip")
                                    }
                                  >
                                    {picked
                                      ? t("radar.compare.picked")
                                      : t("radar.compare.add")}
                                  </button>
                                </div>
                                {lang === "zh" && (
                                  <div className="radar-cell-sub radar-dim">
                                    {s.spec_name}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="radar-sep-timing radar-score-col">
                            {scoreCell(
                              s.timing_score,
                              s.timing_tier_key,
                              timingTier(s.timing_tier_key),
                              s.no_data,
                            )}
                          </td>
                          <td className="radar-detail">
                            {s.no_data ? (
                              <span className="radar-dim">
                                {t("radar.records", { n: 0 })}
                              </span>
                            ) : (
                              <>
                                {t("radar.wr")} {s.window_win_rate.toFixed(1)}%
                                ({signed(s.dev_win_rate)})
                                <br />
                                {t("radar.diff")} {fmtSigned(s.window_avg_diff)}{" "}
                                ({signed(s.dev_avg_diff)})
                                <br />
                                <span
                                  className={
                                    s.window_low_sample
                                      ? "radar-warn"
                                      : "radar-dim"
                                  }
                                >
                                  {t("radar.records", { n: s.window_matches })}
                                  {s.window_low_sample &&
                                    ` · ${t("radar.lowSample")}`}
                                </span>
                              </>
                            )}
                          </td>
                          <td>
                            {s.no_data ? (
                              <span className="radar-dim">–</span>
                            ) : (
                              <span
                                className={`radar-trend radar-trend-${s.next_trend === "up" ? "up" : s.next_trend === "down" ? "down" : "flat"}`}
                                title={t("radar.nextTip", {
                                  s: s.next_timing_score.toFixed(1),
                                })}
                              >
                                {s.next_trend === "up"
                                  ? "↗"
                                  : s.next_trend === "down"
                                    ? "↘"
                                    : "→"}{" "}
                                {fmtSigned(delta)}
                              </span>
                            )}
                          </td>
                          <td className="radar-detail">
                            <span className="radar-pos">{t("radar.good")}</span>{" "}
                            {hourList(s.best_hours, s.no_data)}
                            <br />
                            <span className="radar-neg">
                              {t("radar.bad")}
                            </span>{" "}
                            {hourList(s.worst_hours, s.no_data)}
                          </td>
                          <td>
                            <div className="radar-spark">
                              {s.hourly_curve.map((h) => (
                                <button
                                  type="button"
                                  key={h.hour}
                                  aria-label={fmtHour(h.hour)}
                                  className={`radar-spark-bar ${s.no_data ? "radar-tier-none" : tierClass(h.tier_key)}${h.hour === data.current_hour ? " current" : ""}${h.low_sample ? " radar-low" : ""}`}
                                  style={{
                                    height: s.no_data
                                      ? 4
                                      : Math.max(
                                          3,
                                          Math.round((h.score / 100) * 18),
                                        ),
                                  }}
                                  title={
                                    s.no_data
                                      ? t("radar.noData")
                                      : hourTip(s, h)
                                  }
                                  onClick={() => setHour(h.hour)}
                                />
                              ))}
                            </div>
                          </td>
                          <td
                            className="radar-sep-strength radar-score-col"
                            title={t("radar.vsPool", {
                              pool: poolLabel(s.baseline_role),
                            })}
                          >
                            {scoreCell(
                              s.strength_score,
                              s.strength_tier_key,
                              strengthTier(s.strength_tier_key),
                              s.no_data,
                            )}
                            {!s.no_data && s.baseline_role !== s.role && (
                              <div className="radar-cell-sub radar-warn">
                                {t("radar.baselineFallback", {
                                  pool: poolLabel(s.baseline_role),
                                })}
                              </div>
                            )}
                          </td>
                          <td className="radar-detail">
                            {s.no_data ? (
                              <span className="radar-dim">
                                {t("radar.noData")}
                              </span>
                            ) : (
                              <>
                                {t("radar.wr")} {s.allday_win_rate.toFixed(1)}%
                                ({signed(s.excess_win_rate)})
                                <br />
                                {t("radar.diff")} {fmtSigned(s.allday_avg_diff)}{" "}
                                ({signed(s.excess_avg_diff)})
                                <br />
                                {t("radar.bl")}{" "}
                                {s.allday_big_loss_rate.toFixed(1)}% (
                                {signed(s.excess_big_loss_rate, true)}) ·{" "}
                                <span className="radar-dim">
                                  {t("radar.records", {
                                    n: s.strength_matches,
                                  })}
                                </span>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="radar-note">
              {t("radar.method", {
                k: data.method.prior_records,
                kh: data.method.hour_prior_records,
                ss: data.method.strength_scales.join(" / "),
                ts: data.method.timing_scales.join(" / "),
                w: data.method.weights.join(" / "),
              })}
            </p>
          </section>

          {specs.length > 0 && (
            <section className="radar-card">
              <div className="radar-card-head">
                <div>
                  <h3>{t("radar.matrix.title")}</h3>
                  <span className="radar-dim">{t("radar.matrix.sub")}</span>
                </div>
                <div className="radar-legend">
                  {(["t0", "t1", "t2", "t3", "avoid"] as RadarTierKey[]).map(
                    (k) => (
                      <span key={k}>
                        <span
                          className={`radar-legend-swatch ${tierClass(k)}`}
                        />
                        {timingTier(k)}
                      </span>
                    ),
                  )}
                </div>
              </div>
              <div className="radar-scroll">
                <table className="radar-matrix">
                  <thead>
                    <tr>
                      <th className="radar-matrix-spec">
                        {t("radar.matrix.corner")}
                      </th>
                      {Array.from({ length: 24 }, (_, h) => (
                        <th
                          key={h}
                          className={h === data.current_hour ? "current" : ""}
                        >
                          {fmtHour(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {specs.map((s) => (
                      <tr key={s.spec_name}>
                        <td className="radar-matrix-spec">
                          <SpellIcon
                            icon={radarSpecIcon(s.spec_name)}
                            label={name(s)}
                            size={16}
                          />
                          <span style={{ color: s.color }}>{name(s)}</span>
                        </td>
                        {s.hourly_curve.map((h) =>
                          s.no_data ? (
                            <td
                              key={h.hour}
                              className={`radar-cell radar-tier-none${h.hour === data.current_hour ? " current" : ""}`}
                            >
                              –
                            </td>
                          ) : (
                            <td
                              key={h.hour}
                              className={`radar-cell ${tierClass(h.tier_key)}${h.hour === data.current_hour ? " current" : ""}${h.low_sample ? " radar-low" : ""}`}
                              title={hourTip(s, h)}
                              onClick={() => setHour(h.hour)}
                            >
                              {h.score.toFixed(0)}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="radar-note radar-dim">
            {t("radar.fetchedFrom", {
              url: shownGood?.url ?? "",
              at: new Date(shownGood?.fetchedAt ?? 0).toLocaleTimeString(),
            })}
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="radar-stat">
      <div className="radar-dim">{label}</div>
      <div className="radar-stat-val">{children}</div>
    </div>
  );
}
