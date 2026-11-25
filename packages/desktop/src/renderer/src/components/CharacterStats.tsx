import { useEffect, useRef, useState } from "react";

import type { StoredMatchMeta } from "../../../main/matchStore";
import type { TFn } from "../../../shared/i18n";
import { useT } from "../i18n/LangProvider";
import { useIconDataUrl } from "../report/components/useIconDataUrl";
import {
  classColor,
  specIconName,
  specName,
} from "../report/data/gameConstants";
import { shortUnitName } from "../report/derive/teamSide";
import {
  bracketLabel,
  type BracketLine,
  CHAR_CARD_MIN_GAMES,
  type CharacterCard,
  type DashPeriod,
  deriveBracketLines,
  deriveCharacterBracket,
  RATE_MIN_N_ROW,
  rateDisplay,
  type RatedSession,
} from "./dashboard";

/**
 * 战绩页改版(2026-11,设计稿已确认):总览一张卡一个角色、一行一个赛制;
 * 点卡片进单角色页,按赛制分标签看分数走势、每次上线和分地图。
 * 数字全部来自 dashboard.ts 的纯函数,这里只画。
 */

const realmOf = (name: string): string => name.split("-")[1] ?? "";

/** The character's most recent spec (`playerSpecId` on its index rows). */
export function latestSpecOf(
  metas: StoredMatchMeta[],
  name: string,
): { specId?: number; classId?: number } {
  let latest: StoredMatchMeta | undefined;
  for (const m of metas)
    if (
      m.playerName === name &&
      m.playerSpecId &&
      (!latest || m.startTime > latest.startTime)
    )
      latest = m;
  return latest
    ? { specId: latest.playerSpecId, classId: latest.playerClassId }
    : {};
}

/**
 * Round spec icon with a class-coloured ring (the record page's character
 * avatar). The icon comes through the same main-process icon cache as the
 * match list's SpecDot; without a spec (an index built before playerSpecId)
 * or without the icon it falls back to the name's initial.
 */
export function SpecAvatar({
  name,
  specId,
  classId,
  size = "md",
}: {
  name: string;
  specId?: number;
  classId?: number;
  size?: "sm" | "md" | "lg";
}) {
  const { dataUrl } = useIconDataUrl(specId ? specIconName(specId) : null);
  const ring = classId ? classColor(classId) : undefined;
  const cls = `cs-avatar cs-avatar-${size}`;
  if (dataUrl && specId)
    return (
      <img
        className={`${cls} cs-avatar-icon`}
        src={dataUrl}
        alt=""
        title={specName(specId)}
        style={ring ? { borderColor: ring } : undefined}
      />
    );
  return (
    <span
      className={cls}
      aria-hidden="true"
      style={ring ? { borderColor: ring, color: ring } : undefined}
    >
      {shortUnitName(name).slice(0, 1)}
    </span>
  );
}

const fmtDay = (t: TFn, ms: number): string => {
  const d = new Date(ms);
  return t("common.monthDay", { month: d.getMonth() + 1, day: d.getDate() });
};
const fmtDayTime = (t: TFn, ms: number): string => {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDay(t, ms)} ${hh}:${mm}`;
};

function Delta({ value, from }: { value: number | null; from?: number | null }) {
  const { t } = useT();
  if (value == null)
    return <span className="cs-delta cs-delta-none">{t("stats.cs.noDelta")}</span>;
  const cls =
    value > 0 ? "cs-delta-up" : value < 0 ? "cs-delta-down" : "cs-delta-flat";
  return (
    <span className={`cs-delta ${cls}`}>
      {value > 0 ? "▲ " : value < 0 ? "▼ " : "± "}
      {Math.abs(value)}
      {from != null && (
        <span className="cs-delta-from">{t("stats.cs.deltaFrom", { from })}</span>
      )}
    </span>
  );
}

function RateBar({ wins, games }: { wins: number; games: number }) {
  const pct = games > 0 ? (100 * wins) / games : 0;
  const below = games < RATE_MIN_N_ROW;
  return (
    <span className="cs-bar" aria-hidden="true">
      <span
        className={`cs-bar-fill ${below ? "cs-bar-thin" : pct >= 50 ? "cs-bar-win" : "cs-bar-loss"}`}
        style={{ width: `${pct}%` }}
      />
      <span className="cs-bar-mid" />
    </span>
  );
}

function MiniSpark({ line }: { line: BracketLine }) {
  const pts = line.points;
  if (pts.length < 2) return <span className="cs-spark" />;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.rating);
    hi = Math.max(hi, p.rating);
  }
  const span = hi - lo || 1;
  // Stretched to the cell's width (non-scaling stroke keeps the line weight);
  // the dashed line is the first rating, so the rise or fall reads at a glance.
  const W = 400;
  const y = (r: number) => 32 - ((r - lo) * 28) / span;
  const d = pts
    .map(
      (p, i) =>
        `${((i * W) / (pts.length - 1)).toFixed(1)},${y(p.rating).toFixed(1)}`,
    )
    .join(" ");
  const up = (line.delta ?? 0) >= 0;
  const baseY = y(pts[0]!.rating).toFixed(1);
  return (
    <svg
      className="cs-spark"
      viewBox={`0 0 ${W} 36`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="cs-spark"
    >
      <line
        x1={0}
        x2={W}
        y1={baseY}
        y2={baseY}
        stroke="var(--mute)"
        strokeOpacity={0.5}
        strokeWidth={1}
        strokeDasharray="3 4"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={d}
        fill="none"
        stroke={up ? "var(--win)" : "var(--loss)"}
        strokeWidth={1.8}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function recordText(t: TFn, wins: number, games: number, perRound: boolean) {
  const r = rateDisplay(wins, games, RATE_MIN_N_ROW);
  const unit = t(perRound ? "stats.cs.unitRounds" : "stats.cs.unitMatches");
  return {
    primary: r.primary,
    secondary: r.belowFloor
      ? `${r.secondary ?? ""} · ${t("stats.cs.smallSample")}`
      : `${r.secondary} ${unit}`,
  };
}

export function BracketRow({ line }: { line: BracketLine }) {
  const { t } = useT();
  const rec = recordText(t, line.rateWins, line.rateGames, line.perRound);
  return (
    <div className="cs-line" data-testid="cs-line">
      <span className="cs-line-bracket">{bracketLabel(line.bracket)}</span>
      <span className="cs-line-rating">
        <span className="cs-line-num">{line.rating ?? "—"}</span>
        <Delta value={line.delta} from={line.baseline} />
      </span>
      <span className="cs-line-rec">
        <span className="cs-rec-text" title={`${rec.primary} ${rec.secondary}`}>
          <b>{rec.primary}</b> <span className="cs-dim">{rec.secondary}</span>
        </span>
        <RateBar wins={line.rateWins} games={line.rateGames} />
      </span>
      <MiniSpark line={line} />
    </div>
  );
}

export function CharacterOverview({
  cards,
  minor,
  unnamed,
  totals,
  brackets,
  bracket,
  onBracket,
  onPick,
  onShowAll,
  onRebuild,
  rebuilding,
}: {
  /** Rebuild the index (backfills playerSpecId for the avatars). */
  onRebuild?: () => void;
  rebuilding?: boolean;
  /** Offered on the empty state when a shorter period hides older matches. */
  onShowAll?: () => void;
  cards: CharacterCard[];
  minor: CharacterCard[];
  unnamed: number;
  totals: { games: number; rateWins: number; rateGames: number };
  brackets: string[];
  bracket: string | undefined;
  onBracket: (b: string | undefined) => void;
  onPick: (name: string) => void;
}) {
  const { t } = useT();
  const peak = cards
    .concat(minor)
    .flatMap((c) => c.lines.map((l) => ({ c, l })))
    .filter((x) => x.l.peak != null)
    .sort((a, b) => b.l.peak! - a.l.peak!)[0];
  const rate = rateDisplay(totals.rateWins, totals.rateGames, 20);
  return (
    <div className="cs" data-testid="cs-overview">
      {brackets.length > 1 && (
      <div className="cs-toolbar">
        <div className="rpt-mode-seg cs-seg" role="group" aria-label={t("stats.cs.bracketAria")}>
          <button
            className={bracket === undefined ? "active" : ""}
            aria-pressed={bracket === undefined}
            onClick={() => onBracket(undefined)}
          >
            {t("stats.cs.allBrackets")}
          </button>
          {brackets.map((b) => (
            <button
              key={b}
              className={bracket === b ? "active" : ""}
              aria-pressed={bracket === b}
              onClick={() => onBracket(b)}
            >
              {bracketLabel(b)}
            </button>
          ))}
        </div>
      </div>
      )}

      <div className="cs-summary">
        <div>
          <span className="cs-k">{t("stats.cs.characters")}</span>
          <span className="cs-v">{cards.length + minor.length}</span>
        </div>
        <div>
          <span className="cs-k">{t("stats.cs.matches")}</span>
          <span className="cs-v">{totals.games}</span>
        </div>
        <div>
          <span className="cs-k">{t("stats.cs.winRate")}</span>
          <span className="cs-v">
            {rate.primary}{" "}
            {rate.secondary && <span className="cs-sub">{rate.secondary}</span>}
          </span>
        </div>
        <div>
          <span className="cs-k">{t("stats.cs.peakRating")}</span>
          <span className="cs-v">
            {peak ? peak.l.peak : "—"}{" "}
            {peak && (
              <span className="cs-sub">
                {shortUnitName(peak.c.name)} · {bracketLabel(peak.l.bracket)}
              </span>
            )}
          </span>
        </div>
      </div>

      {cards.length === 0 && minor.length === 0 ? (
        <p className="cs-empty" data-testid="cs-empty">
          {t("stats.cs.emptyPeriod")}
          {onShowAll && (
            <button className="rpt-btn" onClick={onShowAll}>
              {t("stats.cs.showAll")}
            </button>
          )}
        </p>
      ) : (
        <div className="cs-grid">
          {cards.map((c) => (
            <button
              key={c.name}
              className="cs-card"
              data-testid="cs-card"
              onClick={() => onPick(c.name)}
              aria-label={t("stats.cs.openCharacter", {
                name: shortUnitName(c.name),
              })}
            >
              <span className="cs-card-head">
                <SpecAvatar
                  name={c.name}
                  specId={c.specId}
                  classId={c.classId}
                />
                <span className="cs-card-title">
                  <span className="cs-card-name">
                    {shortUnitName(c.name)}{" "}
                    <span className="cs-dim">{realmOf(c.name)}</span>
                  </span>
                  <span className="cs-dim cs-small">
                    {t("stats.cs.cardMeta", {
                      n: c.games,
                      day: fmtDay(t, c.lastPlayed),
                    })}
                  </span>
                </span>
                <span className="cs-chev" aria-hidden="true">
                  ›
                </span>
              </span>
              <span className="cs-lines">
                {c.lines.map((l) => (
                  <BracketRow key={l.bracket} line={l} />
                ))}
              </span>
            </button>
          ))}
        </div>
      )}

      {onRebuild &&
        cards.concat(minor).some((c) => c.specId === undefined) && (
          <div className="cs-minor">
            <span className="cs-dim">{t("stats.cs.noSpecIcons")}</span>
            <button
              className="cs-chip"
              disabled={rebuilding}
              onClick={onRebuild}
              data-testid="cs-rebuild"
            >
              {rebuilding ? t("stats.cs.rebuilding") : t("stats.cs.rebuild")}
            </button>
          </div>
        )}

      {(minor.length > 0 || unnamed > 0) && (
        <div className="cs-minor">
          {minor.length > 0 && (
            <span className="cs-dim">
              {t("stats.cs.minor", { n: minor.length, min: CHAR_CARD_MIN_GAMES })}
            </span>
          )}
          {minor.map((c) => (
            <button
              key={c.name}
              className="cs-chip"
              onClick={() => onPick(c.name)}
            >
              <SpecAvatar
                name={c.name}
                size="sm"
                specId={c.specId}
                classId={c.classId}
              />
              {shortUnitName(c.name)} ·{" "}
              {c.lines.map((l) => bracketLabel(l.bracket)).join("/")}{" "}
              {t("common.matchCountPlural", { n: c.games })}
            </button>
          ))}
          {unnamed > 0 && (
            <span className="cs-dim">
              {t("stats.cs.unnamed", { n: unnamed })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function RatingChart({
  matches,
}: {
  matches: ReturnType<typeof deriveCharacterBracket>["matches"];
}) {
  const { t } = useT();
  // Drawn at the container's real width so labels and dots stay their size
  // on a wide window (a fixed viewBox scaled the 11px axis text to ~20px).
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rated = matches.filter((m) => m.rating != null) as Array<
    (typeof matches)[number] & { rating: number }
  >;
  if (rated.length < 2)
    return (
      <div ref={boxRef}>
        <p className="dash-empty">{t("stats.curve.notEnough")}</p>
      </div>
    );
  const H = 240;
  const L = 48;
  const R = 8;
  const T = 14;
  const B = 28;
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of rated) {
    lo = Math.min(lo, m.rating);
    hi = Math.max(hi, m.rating);
  }
  const step = hi - lo > 300 ? 100 : hi - lo > 60 ? 50 : 10;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const n = rated.length;
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks: number[] = [];
  const every = (hi - lo) / step > 4 ? 2 : 1;
  for (let v = lo, k = 0; v <= hi; v += step, k++) if (k % every === 0) ticks.push(v);
  const breaks: Array<{ x: number; label: string }> = [
    { x: L, label: `${new Date(rated[0]!.t).getMonth() + 1}/${new Date(rated[0]!.t).getDate()}` },
  ];
  for (let i = 1; i < n; i++) {
    if (rated[i]!.session !== rated[i - 1]!.session) {
      const d = new Date(rated[i]!.t);
      breaks.push({ x: (x(i) + x(i - 1)) / 2, label: `${d.getMonth() + 1}/${d.getDate()}` });
    }
  }
  return (
    <div ref={boxRef}>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="cs-chart"
      data-testid="cs-chart"
      role="img"
      aria-label={t("stats.cs.chartTitle")}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="rpt-tl-grid" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="rpt-tl-axis">
            {v}
          </text>
        </g>
      ))}
      {breaks.map((b, i) => (
        <g key={i}>
          {i > 0 && (
            <line
              x1={b.x}
              x2={b.x}
              y1={T - 4}
              y2={H - B + 4}
              className="cs-chart-break"
            />
          )}
          <text x={b.x + (i > 0 ? 4 : 0)} y={H - 8} className="rpt-tl-axis">
            {b.label}
          </text>
        </g>
      ))}
      <polyline
        points={rated.map((m, i) => `${x(i).toFixed(1)},${y(m.rating).toFixed(1)}`).join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {rated.map((m, i) => (
        <circle
          key={m.id}
          cx={x(i)}
          cy={y(m.rating)}
          r={4.5}
          className={
            m.outcome > 0 ? "cs-pt-win" : m.outcome < 0 ? "cs-pt-loss" : "cs-pt-even"
          }
        />
      ))}
    </svg>
    </div>
  );
}

function SessionsTable({
  sessions,
  perRound,
}: {
  sessions: RatedSession[];
  perRound: boolean;
}) {
  const { t } = useT();
  const unit = t(perRound ? "stats.cs.unitRounds" : "stats.cs.unitMatches");
  return (
    <div className="cs-table-wrap">
      <table className="cs-table" data-testid="cs-sessions">
        <thead>
          <tr>
            <th scope="col">{t("stats.cs.session.start")}</th>
            <th scope="col">{t("stats.cs.session.games")}</th>
            <th scope="col">{t("stats.cs.record", { unit })}</th>
            <th scope="col">{t("stats.cs.session.rating")}</th>
            <th scope="col" className="cs-num">
              {t("stats.cs.session.change")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const d = s.from != null && s.to != null ? s.to - s.from : null;
            return (
              <tr key={s.start}>
                <td>{fmtDayTime(t, s.start)}</td>
                <td className="cs-dim">
                  {perRound
                    ? t("stats.cs.lobbies", { n: s.games })
                    : t("common.matchCountPlural", { n: s.games })}
                </td>
                <td>
                  {s.rateWins}-{s.rateGames - s.rateWins}
                </td>
                <td className="cs-dim">
                  {s.from ?? "—"} → {s.to ?? "—"}
                  {!s.settled && s.to != null && (
                    <span title={t("stats.cs.unsettled")}>*</span>
                  )}
                </td>
                <td
                  className={`cs-num ${d == null ? "" : d >= 0 ? "cs-delta-up" : "cs-delta-down"}`}
                >
                  {d == null ? "—" : `${d >= 0 ? "+" : "−"}${Math.abs(d)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CharacterDetail({
  metas,
  period,
  character,
  characters,
  bracket,
  onBracket,
  onBack,
  onPick,
  children,
}: {
  metas: StoredMatchMeta[];
  period: DashPeriod;
  character: string;
  /** Switcher list (the overview's order). */
  characters: string[];
  bracket: string | undefined;
  onBracket: (b: string) => void;
  onBack: () => void;
  onPick: (name: string) => void;
  /** The comp / map / recent cards, already filtered to this character and
   * bracket by the caller. */
  children?: React.ReactNode;
}) {
  const { t } = useT();
  const now = Date.now();
  const lines = deriveBracketLines(metas, period, now, character);
  const line = lines.find((l) => l.bracket === bracket) ?? lines[0];
  const detail = line
    ? deriveCharacterBracket(metas, period, now, character, line.bracket)
    : null;
  const total = lines.reduce((a, l) => a + l.games, 0);
  const heroSpec = latestSpecOf(metas, character);
  return (
    <div className="cs" data-testid="cs-detail">
      <div className="cs-crumbs">
        <button className="cs-back" onClick={onBack}>
          ‹ {t("stats.allCharacters")}
        </button>
        <span className="cs-dim">{t("stats.cs.switch")}</span>
        {characters.map((n) => (
          <button
            key={n}
            className={n === character ? "cs-chip cs-chip-on" : "cs-chip"}
            aria-pressed={n === character}
            onClick={() => onPick(n)}
          >
            <SpecAvatar name={n} size="sm" {...latestSpecOf(metas, n)} />
            {shortUnitName(n)}
          </button>
        ))}
      </div>

      <div className="cs-hero">
        <SpecAvatar name={character} size="lg" {...heroSpec} />
        <span className="cs-card-title">
          <span className="cs-hero-name">
            {shortUnitName(character)}{" "}
            <span className="cs-dim">{character.split("-").slice(1).join("-")}</span>
          </span>
          <span className="cs-dim cs-small">
            {t("stats.cs.periodGames", { n: total })}
          </span>
        </span>
      </div>

      {!line || !detail ? (
        <p className="cs-empty">{t("stats.cs.emptyCharacter")}</p>
      ) : (
        <>
          <div
            className="cs-tabs"
            role="tablist"
            aria-label={t("stats.cs.bracketAria")}
          >
            {lines.map((l) => (
              <button
                key={l.bracket}
                role="tab"
                aria-selected={l === line}
                className={l === line ? "cs-tab cs-tab-on" : "cs-tab"}
                onClick={() => onBracket(l.bracket)}
              >
                {bracketLabel(l.bracket)}{" "}
                <span className="cs-dim">
                  {l.perRound
                    ? t("stats.cs.lobbies", { n: l.games })
                    : t("common.matchCountPlural", { n: l.games })}
                </span>
              </button>
            ))}
          </div>

          <div className="cs-kpis">
            <div>
              <span className="cs-k">{t("stats.cs.kpi.current")}</span>
              <span className="cs-v cs-v-lg">{line.rating ?? "—"}</span>
            </div>
            <div>
              <span className="cs-k">{t("stats.cs.kpi.change")}</span>
              <span className="cs-v cs-v-lg">
                <Delta value={line.delta} />
              </span>
              {line.baseline != null && line.rating != null && (
                <span className="cs-dim cs-small">
                  {line.baseline} → {line.rating}
                </span>
              )}
            </div>
            <div>
              <span className="cs-k">{t("stats.cs.kpi.peak")}</span>
              <span className="cs-v cs-v-lg">{line.peak ?? "—"}</span>
            </div>
            <div>
              <span className="cs-k">
                {t("stats.cs.record", {
                  unit: t(
                    line.perRound ? "stats.cs.unitRounds" : "stats.cs.unitMatches",
                  ),
                })}
              </span>
              <span className="cs-v cs-v-lg">
                {line.rateWins}-{line.rateGames - line.rateWins}{" "}
                <span className="cs-sub">
                  {line.rateGames > 0
                    ? `${Math.round((100 * line.rateWins) / line.rateGames)}%`
                    : ""}
                </span>
              </span>
            </div>
          </div>

          <div className="dash-card">
            <span className="dash-card-head">
              <span className="rpt-card-label">{t("stats.cs.chartTitle")}</span>
              <span className="cs-dim cs-small">{t("stats.cs.chartLegend")}</span>
            </span>
            <RatingChart matches={detail.matches} />
            <p className="cs-dim cs-small cs-note">{t("stats.cs.chartNote")}</p>
          </div>

          <div className="dash-card">
            <span className="rpt-card-label">{t("stats.cs.sessions")}</span>
            <SessionsTable sessions={detail.sessions} perRound={line.perRound} />
          </div>

          {children}
        </>
      )}
    </div>
  );
}
