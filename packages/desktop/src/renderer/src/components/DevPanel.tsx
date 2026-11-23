import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StoredMatchMeta } from "../../../main/matchStore";
import type { DiagnosticEntry, LogsStatusSnapshot } from "../../../preload/api";
import type { MessageKey } from "../../../shared/i18n";
import { anonymizeMatchDoc } from "../../../shared/anonymizeFixture";
import {
  type DiagnosticLevel,
  diagnosticLevel,
} from "../../../shared/diagnosticLevel";
import { bridge } from "../bridge";
import { formatDateTime, formatTime } from "../i18n/format";
import { useT } from "../i18n/LangProvider";
import {
  ancestorPaths,
  resolvePath,
  searchKeyPaths,
  stringifyNode,
} from "./dev/jsonNode";
import { JsonTree } from "./dev/JsonTree";

type DevZone = "watch" | "inspect" | "ai" | "diag";

const ZONE_KEY: Record<DevZone, MessageKey> = {
  watch: "dev.zone.watch",
  inspect: "dev.zone.inspect",
  ai: "dev.zone.ai",
  diag: "dev.zone.diag",
};

interface AiCall {
  kind: "analysis" | "compare";
  matchId: string;
  at: number;
  model: string;
  prompt: string;
  raw: string;
}

interface RebuildState {
  running: boolean;
  i: number;
  n: number;
  done: { updated: number; failed: number } | null;
}

/** Stubs are often missing surfaces (see desktop-dev skill), so every
 *  bridge access gets a fallback. */
function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return fn().catch(() => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}
function safeSub(fn: () => () => void): () => void {
  try {
    return fn();
  } catch {
    return () => {};
  }
}

export function DevPanel({
  initialZone = "watch",
}: {
  /** Jump straight to one zone for visual-regression scenarios (same pattern
   *  as App.initialAppView / MatchReport.initialView). */
  initialZone?: DevZone;
} = {}) {
  const [zone, setZone] = useState<DevZone>(initialZone);
  const [status, setStatus] = useState<LogsStatusSnapshot | null>(null);
  const [metas, setMetas] = useState<StoredMatchMeta[]>([]);
  const [diags, setDiags] = useState<DiagnosticEntry[]>([]);
  const [aiCalls, setAiCalls] = useState<AiCall[]>([]);
  const [wowDir, setWowDir] = useState<string | null>(null);

  useEffect(() => {
    void safe(() => bridge().logs.getStatus(), null).then(setStatus);
    void safe(() => bridge().matches.list(), []).then(setMetas);
    void safe(
      () => bridge().settings.get(),
      null as unknown as { wowDirectory: string | null },
    ).then((s) => setWowDir(s?.wowDirectory ?? null));
    void safe(() => bridge().debug.aiCalls(), [] as AiCall[]).then(setAiCalls);

    const unsubs = [
      safeSub(() => bridge().logs.onStatusChanged(setStatus)),
      safeSub(() =>
        bridge().logs.onMatchStored((m) => setMetas((prev) => [m, ...prev])),
      ),
      safeSub(() =>
        bridge().logs.onDiagnostic((d) =>
          setDiags((prev) => [d, ...prev].slice(0, 500)),
        ),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  return (
    <div className="dev-wb">
      <DevRail
        zone={zone}
        setZone={setZone}
        aiCount={aiCalls.length}
        diagCount={diags.length}
      />
      <main className="dev-area">
        {zone === "watch" && (
          <WatchZone status={status} wowDir={wowDir} setWowDir={setWowDir} />
        )}
        {zone === "inspect" && <InspectZone metas={metas} />}
        {zone === "ai" && (
          <AiZone
            calls={aiCalls}
            refresh={() =>
              void safe(() => bridge().debug.aiCalls(), [] as AiCall[]).then(
                setAiCalls,
              )
            }
          />
        )}
        {zone === "diag" && (
          <DiagZone diags={diags} clear={() => setDiags([])} />
        )}
      </main>
      <StatusBar status={status} onClick={() => setZone("watch")} />
    </div>
  );
}

/* ────────────────────────── Nav rail ────────────────────────── */

function DevRail({
  zone,
  setZone,
  aiCount,
  diagCount,
}: {
  zone: DevZone;
  setZone(z: DevZone): void;
  aiCount: number;
  diagCount: number;
}) {
  const { t } = useT();
  const badge: Partial<Record<DevZone, number>> = {
    ai: aiCount,
    diag: diagCount,
  };
  return (
    <nav
      className="dev-rail"
      data-testid="dev-rail"
      aria-label={t("dev.railAria")}
    >
      <ul>
        {(Object.keys(ZONE_KEY) as DevZone[]).map((z) => (
          <li key={z}>
            <button
              type="button"
              data-testid={`dev-nav-${z}`}
              className={z === zone ? "active" : ""}
              aria-current={z === zone ? "page" : undefined}
              onClick={() => setZone(z)}
            >
              <span className="dev-nav-label">{t(ZONE_KEY[z])}</span>
              {badge[z] ? <span className="dev-badge">{badge[z]}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <RebuildButton />
    </nav>
  );
}

/**
 * Whole-library rebuild. Progress arrives over the emit channel and is shown
 * inline — the old implementation popped an alert only when it finished, so
 * for several minutes the UI gave no feedback and no sense of where it was.
 */
function RebuildButton() {
  const { t } = useT();
  const [st, setSt] = useState<RebuildState>({
    running: false,
    i: 0,
    n: 0,
    done: null,
  });

  useEffect(
    () =>
      safeSub(() =>
        bridge().matches.onRebuildProgress((p) =>
          setSt((prev) => ({ ...prev, i: p.i, n: p.n })),
        ),
      ),
    [],
  );

  const run = () => {
    setSt({ running: true, i: 0, n: 0, done: null });
    void safe(() => bridge().matches.rebuildIndex(), {
      updated: 0,
      failed: 0,
    }).then((r) => setSt((prev) => ({ ...prev, running: false, done: r })));
  };

  return (
    <div className="dev-rail-foot">
      <button
        type="button"
        data-testid="dev-rebuild"
        disabled={st.running}
        onClick={run}
      >
        {t("dev.rebuild.button")}
      </button>
      {(st.running || st.done) && (
        <p className="dev-rebuild-progress" data-testid="dev-rebuild-progress">
          {st.running
            ? st.n > 0
              ? `${st.i}/${st.n}`
              : t("dev.rebuild.preparing")
            : t("dev.rebuild.done", {
                updated: st.done!.updated,
                failed: st.done!.failed,
              })}
        </p>
      )}
    </div>
  );
}

/* ────────────────────────── Bottom status bar ────────────────────────── */

function StatusBar({
  status,
  onClick,
}: {
  status: LogsStatusSnapshot | null;
  onClick(): void;
}) {
  const { t } = useT();
  const files = status?.files ?? [];
  const quarantined = files.some((f) => f.quarantined);
  // "Current tail file" = the last non-quarantined file: the worker advances
  // through file names in ascending order, so the last one is today's log.
  const tail = [...files].reverse().find((f) => !f.quarantined) ?? files[0];

  return (
    <button
      type="button"
      className={`dev-statusbar${quarantined ? " warn" : ""}`}
      data-testid="dev-statusbar"
      onClick={onClick}
    >
      <span className="dev-sb-dot">
        {status?.watching
          ? t("dev.status.watching")
          : t("dev.status.notWatching")}
      </span>
      {tail && (
        <>
          <span className="dev-sb-file">{tail.fileKey}</span>
          <span className="dev-sb-off">
            {tail.offset}/{tail.size}B
          </span>
        </>
      )}
      {quarantined && (
        <span className="dev-sb-q">{t("dev.status.quarantined")}</span>
      )}
    </button>
  );
}

/* ────────────────────────── Watch-status zone ────────────────────────── */

function WatchZone({
  status,
  wowDir,
  setWowDir,
}: {
  status: LogsStatusSnapshot | null;
  wowDir: string | null;
  setWowDir(d: string): void;
}) {
  const { t } = useT();
  const pick = async () => {
    const dir = await safe(() => bridge().app.selectDirectory(), null);
    if (dir) setWowDir(dir);
  };
  const files = status?.files ?? [];

  return (
    <section className="dev-zone" data-testid="dev-zone-watch">
      <h2>{t(ZONE_KEY.watch)}</h2>
      <div className="dev-kv">
        <span>{t("dev.watch.wowDir")}</span>
        <span className="dev-mono">{wowDir ?? t("dev.watch.notSet")}</span>
        <button type="button" onClick={() => void pick()}>
          {t("dev.watch.pickDir")}
        </button>
      </div>
      <div className="dev-kv">
        <span>{t("dev.watch.watching")}</span>
        <span className="dev-mono">
          {status
            ? status.watching
              ? `✅ ${status.logsDir}`
              : t("dev.watch.notWatching", {
                  dir: status.logsDir || t("dev.watch.noDir"),
                })
            : t("dev.watch.noWorker")}
        </span>
      </div>
      <table className="dev-table">
        <thead>
          <tr>
            <th>{t("dev.watch.colFile")}</th>
            <th>offset</th>
            <th>size</th>
            <th>{t("dev.watch.colProgress")}</th>
            <th>{t("dev.watch.colStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.fileKey}>
              <td className="dev-mono">{f.fileKey}</td>
              <td className="dev-num">{f.offset}</td>
              <td className="dev-num">{f.size}</td>
              <td className="dev-num">
                {f.size > 0 ? `${Math.round((f.offset / f.size) * 100)}%` : "—"}
              </td>
              <td>{f.quarantined ? t("dev.watch.quarantined") : ""}</td>
            </tr>
          ))}
          {files.length === 0 && (
            <tr>
              <td colSpan={5} className="rpt-dim">
                {t("dev.watch.noFiles")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="rpt-dim">{t("dev.watch.aiHint")}</p>
    </section>
  );
}

/* ────────────────────────── Match inspector ────────────────────────── */

function matchHaystack(m: StoredMatchMeta): string {
  return [m.kind, m.bracket, m.zoneId, m.result, m.id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function InspectZone({ metas }: { metas: StoredMatchMeta[] }) {
  const { lang, t } = useT();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [nodePath, setNodePath] = useState("");
  const [nodeValue, setNodeValue] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly string[]>([]);
  const [autoExpand, setAutoExpand] = useState<readonly string[]>([]);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const reqId = useRef(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return metas;
    return metas.filter((m) => matchHaystack(m).includes(q));
  }, [metas, filter]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const my = ++reqId.current;
    setLoading(true);
    setDetail(null);
    setNodePath("");
    setNodeValue(null);
    setHits([]);
    setAutoExpand([]);
    setSearchNote(null);
    const t0 = performance.now();
    void safe(() => bridge().matches.get(selected), null).then((d) => {
      if (reqId.current !== my) return; // match-switch race: drop stale results
      setLoadMs(Math.round(performance.now() - t0));
      setDetail(d);
      setNodeValue(d);
      setLoading(false);
    });
  }, [selected]);

  const runSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q || detail == null) return;
      // Try it as an exact key path first (the spec's own example is
      // rounds[5].deaths); if that fails to resolve, fall back to the
      // budgeted key-name search.
      const exact = resolvePath(detail, q);
      if (exact.ok) {
        setHits([q]);
        setAutoExpand([...ancestorPaths(q), q]);
        setSearchNote(null);
        return;
      }
      const r = searchKeyPaths(detail, q);
      setHits(r.paths);
      setAutoExpand(r.paths.flatMap((p) => [...ancestorPaths(p), p]));
      setSearchNote(
        r.paths.length === 0
          ? t("dev.inspect.noHits", {
              scanned: r.scanned,
              capped: r.truncated ? t("dev.inspect.capped") : "",
            })
          : r.truncated
            ? t("dev.inspect.hitsTruncated", {
                n: r.paths.length,
                scanned: r.scanned,
              })
            : t("dev.inspect.hits", { n: r.paths.length }),
      );
    },
    [query, detail, t],
  );

  const meta = metas.find((m) => m.id === selected) ?? null;

  const copyNode = async () => {
    try {
      await navigator.clipboard.writeText(stringifyNode(nodeValue));
      setAction(t("dev.inspect.copied"));
    } catch {
      setAction(t("dev.inspect.copyFailed"));
    }
  };

  const exportFixture = async () => {
    if (detail == null || !selected) return;
    setAction(t("dev.inspect.anonymizing"));
    const { text, players } = anonymizeMatchDoc(detail);
    const saved = await safe(
      () =>
        bridge().app.saveTextFile({
          defaultName: `${selected}-fixture.json`,
          text,
        }),
      null,
    );
    setAction(
      saved
        ? t("dev.inspect.exported", { players, path: saved })
        : t("dev.inspect.cancelled"),
    );
  };

  return (
    <section className="dev-zone dev-inspect" data-testid="dev-zone-inspect">
      <div className="dev-col dev-col-list" data-testid="dev-match-list">
        <input
          type="search"
          className="dev-input"
          data-testid="dev-match-filter"
          placeholder={t("dev.inspect.filterPlaceholder")}
          aria-label={t("dev.inspect.filterAria")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul className="dev-match-rows">
          {filtered.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                data-testid="dev-match-row"
                className={m.id === selected ? "sel" : ""}
                onClick={() => setSelected(m.id)}
              >
                <span className="dev-mr-1">
                  [{m.kind}] {m.bracket} · zone {m.zoneId}
                </span>
                <span className="dev-mr-2">
                  {formatDateTime(m.startTime, lang)} · {m.result}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="dev-match-count" data-testid="dev-match-count">
          {t("dev.inspect.count", {
            total: metas.length,
            shown: filtered.length,
          })}
        </p>
      </div>

      <div className="dev-col dev-col-tree">
        <form
          className="dev-json-searchbar"
          data-testid="dev-json-search-form"
          onSubmit={runSearch}
        >
          <input
            type="search"
            className="dev-input"
            data-testid="dev-json-search"
            placeholder={t("dev.inspect.searchPlaceholder")}
            aria-label={t("dev.inspect.searchAria")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">{t("dev.inspect.search")}</button>
        </form>
        {searchNote && <p className="rpt-dim dev-search-note">{searchNote}</p>}
        {loading && <p className="rpt-dim">{t("dev.inspect.loading")}</p>}
        {!loading && detail == null && (
          <p className="rpt-dim">{t("dev.inspect.pickMatch")}</p>
        )}
        {!loading && detail != null && (
          <JsonTree
            root={detail}
            selectedPath={nodePath}
            onSelect={(p, v) => {
              setNodePath(p);
              setNodeValue(v);
            }}
            hits={hits}
            autoExpand={autoExpand}
          />
        )}
      </div>

      <div className="dev-col dev-col-actions">
        {selected ? (
          <div data-testid="dev-node-actions">
            <h3>{selected}</h3>
            <button
              type="button"
              data-testid="dev-open-dir"
              onClick={() => {
                void safe(() => bridge().matches.openDir(selected), false).then(
                  (ok) =>
                    setAction(
                      ok
                        ? t("dev.inspect.dirOpened")
                        : t("dev.inspect.openFailed"),
                    ),
                );
              }}
            >
              {t("dev.inspect.openDir")}
            </button>
            <button
              type="button"
              data-testid="dev-copy-node"
              disabled={nodeValue == null && nodePath === ""}
              onClick={() => void copyNode()}
            >
              {t("dev.inspect.copyNode")}
            </button>
            <button
              type="button"
              data-testid="dev-reparse"
              onClick={() => {
                setAction(t("dev.inspect.reparsing"));
                void safe(() => bridge().matches.reparse(selected), {
                  ok: false,
                }).then((r) =>
                  setAction(
                    r.ok
                      ? t("dev.inspect.reparsed")
                      : t("dev.inspect.reparseFailed"),
                  ),
                );
              }}
            >
              {t("dev.inspect.reparse")}
            </button>
            <button
              type="button"
              data-testid="dev-export-fixture"
              disabled={detail == null}
              onClick={() => void exportFixture()}
            >
              {t("dev.inspect.exportFixture")}
            </button>
            {action && (
              <p
                className="rpt-dim dev-action-note"
                data-testid="dev-action-note"
              >
                {action}
              </p>
            )}
            <DocFacts
              meta={meta}
              detail={detail}
              loadMs={loadMs}
              nodePath={nodePath}
            />
          </div>
        ) : (
          <p className="rpt-dim">{t("dev.inspect.noSelection")}</p>
        )}
      </div>
    </section>
  );
}

/**
 * Small card at the bottom of the right column. It carries only facts that
 * are **obtainable without walking the document** — things like the total
 * event count need a full walk, exactly the long task this rework avoids.
 */
function DocFacts({
  meta,
  detail,
  loadMs,
  nodePath,
}: {
  meta: StoredMatchMeta | null;
  detail: unknown;
  loadMs: number | null;
  nodePath: string;
}) {
  const { t } = useT();
  const facts = useMemo(() => {
    const d = (detail ?? {}) as Record<string, unknown>;
    // On-disk shape is {schemaVersion, kind, data}; shuffle fields live in
    // data.rounds[0]. Read it the same way matchStore.rebuiltMeta does — the
    // one question "where do this match's facts live" must not have two
    // different answers.
    const inner = (d["data"] ?? d) as Record<string, unknown>;
    const rounds = inner["rounds"];
    const src =
      Array.isArray(rounds) && rounds.length > 0
        ? ((rounds as Record<string, unknown>[])[0] ?? {})
        : inner;
    return {
      topKeys: detail == null ? 0 : Object.keys(d).length,
      linesTotal: src["linesTotal"],
      linesDropped: src["linesDropped"],
      advanced: src["hasAdvancedLogging"],
      schemaVersion: d["schemaVersion"],
    };
  }, [detail]);

  return (
    <dl className="dev-facts" data-testid="dev-doc-facts">
      <dt>{t("dev.facts.loadTime")}</dt>
      <dd>{loadMs == null ? "—" : `${loadMs}ms`}</dd>
      <dt>{t("dev.facts.topKeys")}</dt>
      <dd>{facts.topKeys}</dd>
      <dt>{t("dev.facts.lines")}</dt>
      <dd>
        {String(facts.linesTotal ?? "—")}/{String(facts.linesDropped ?? "—")}
      </dd>
      {/* Event count comes from meta, never computed from the doc on the fly —
          computing it would walk the whole 62MB, exactly the long task the
          lazy tree exists to kill. A missing field means an old row that was
          never counted; do not render it as 0. */}
      <dt>{t("dev.facts.events")}</dt>
      <dd data-testid="dev-fact-events">
        {meta?.eventCount == null
          ? t("dev.facts.eventsMissing")
          : meta.eventCount}
      </dd>
      <dt>{t("dev.facts.advanced")}</dt>
      <dd>{facts.advanced === undefined ? "—" : String(facts.advanced)}</dd>
      {/* Storage shape. The spec's "parser version" is deliberately skipped:
          the on-disk doc has no such field, and the parser package version has
          sat at 0.0.1 forever without bumping on changes, so showing it would
          be a constant masquerading as provenance. These two items are what
          actually answer "how was this document stored". */}
      <dt>{t("dev.facts.storage")}</dt>
      <dd>
        schema {String(facts.schemaVersion ?? "—")} ·{" "}
        {meta?.slimmed ? "slim" : t("dev.facts.notSlim")}
      </dd>
      <dt>{t("dev.facts.duration")}</dt>
      <dd>{meta?.durationS == null ? "—" : `${meta.durationS}s`}</dd>
      <dt>{t("dev.facts.node")}</dt>
      <dd className="dev-mono">{nodePath || t("dev.facts.root")}</dd>
    </dl>
  );
}

/* ────────────────────────── AI call zone ────────────────────────── */

function AiZone({ calls, refresh }: { calls: AiCall[]; refresh(): void }) {
  const { lang, t } = useT();
  const [open, setOpen] = useState<number | null>(null);
  const copy = (text: string) => {
    try {
      void navigator.clipboard.writeText(text);
    } catch {
      /* Stay silent when the clipboard is unavailable — this is a debugging
         aid and must not interrupt anything */
    }
  };
  return (
    <section className="dev-zone" data-testid="dev-zone-ai">
      <h2>
        {t(ZONE_KEY.ai)}({calls.length}){" "}
        <button type="button" onClick={refresh}>
          {t("dev.ai.refresh")}
        </button>
      </h2>
      {calls.length === 0 && <p className="rpt-dim">{t("dev.ai.empty")}</p>}
      <ul className="dev-ai-rows" data-testid="dev-ai-list">
        {calls.map((c, i) => (
          <li key={i} data-testid="dev-ai-row">
            <div className="dev-ai-head">
              <span className="dev-ai-t">{formatTime(c.at, lang)}</span>
              <span className="dev-ai-kind">[{c.kind}]</span>
              <span className="dev-mono">{c.matchId}</span>
              <span className="dev-ai-model">{c.model}</span>
              <span className="dev-ai-size">
                {t("dev.ai.size", {
                  prompt: c.prompt.length,
                  raw: c.raw.length,
                })}
              </span>
              <span className="dev-ai-ops">
                <button
                  type="button"
                  onClick={() => setOpen(open === i ? null : i)}
                >
                  {open === i ? t("dev.ai.collapse") : t("dev.ai.view")}
                </button>
                <button type="button" onClick={() => copy(c.prompt)}>
                  {t("dev.ai.copyPrompt")}
                </button>
                <button type="button" onClick={() => copy(c.raw)}>
                  {t("dev.ai.copyReply")}
                </button>
              </span>
            </div>
            {open === i && (
              <div className="dev-ai-body">
                <h4>Prompt</h4>
                <pre>{c.prompt}</pre>
                <h4>{t("dev.ai.replyText")}</h4>
                <pre>{c.raw}</pre>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ────────────────────────── Diagnostics zone ────────────────────────── */

// "warn" / "error" are the diagnostic level names themselves, not copy.
const LEVEL_FILTERS: Array<{
  key: "all" | DiagnosticLevel;
  label: MessageKey | null;
}> = [
  { key: "all", label: "dev.diag.all" },
  { key: "warn", label: null },
  { key: "error", label: null },
];

function DiagZone({
  diags,
  clear,
}: {
  diags: DiagnosticEntry[];
  clear(): void;
}) {
  const { lang, t } = useT();
  const [level, setLevel] = useState<"all" | DiagnosticLevel>("all");
  const [text, setText] = useState("");
  const [paused, setPaused] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    return diags.filter((d) => {
      if (level !== "all" && diagnosticLevel(d.code) !== level) return false;
      if (!q) return true;
      return `${d.code} ${d.fileKey ?? ""} ${d.detail ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [diags, level, text]);

  useEffect(() => {
    if (paused || !listRef.current) return;
    // New rows are prepended (reverse order), so scrolling back to the top is
    // "follow latest". Use scrollTop, not scrollTo: the latter does not exist
    // in jsdom and would turn the whole component test suite red.
    listRef.current.scrollTop = 0;
  }, [rows, paused]);

  const counts = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const d of diags) {
      if (diagnosticLevel(d.code) === "warn") warn++;
      else error++;
    }
    return { all: diags.length, warn, error };
  }, [diags]);

  return (
    <section className="dev-zone dev-diag" data-testid="dev-zone-diag">
      <h2>{t(ZONE_KEY.diag)}</h2>
      <div className="dev-diag-bar">
        {LEVEL_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            data-testid={`dev-diag-level-${f.key}`}
            className={level === f.key ? "active" : ""}
            aria-pressed={level === f.key}
            onClick={() => setLevel(f.key)}
          >
            {f.label ? t(f.label) : f.key} {counts[f.key]}
          </button>
        ))}
        <input
          type="search"
          className="dev-input"
          data-testid="dev-diag-filter"
          placeholder={t("dev.diag.filterPlaceholder")}
          aria-label={t("dev.diag.filterAria")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          data-testid="dev-diag-pause"
          aria-pressed={paused}
          className={paused ? "active" : ""}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? t("dev.diag.resume") : t("dev.diag.pause")}
        </button>
        <button type="button" data-testid="dev-diag-clear" onClick={clear}>
          {t("dev.diag.clear")}
        </button>
      </div>
      <ul className="dev-diag-rows" data-testid="dev-diag-list" ref={listRef}>
        {rows.map((d, i) => {
          const lv = diagnosticLevel(d.code);
          return (
            <li key={i} data-testid="dev-diag-row" className={`lv-${lv}`}>
              <span className="dev-diag-t">{formatTime(d.at, lang)}</span>
              <span className={`dev-diag-lv lv-${lv}`}>{lv}</span>
              <span className="dev-diag-code">{d.code}</span>
              <span className="dev-mono">{d.fileKey ?? ""}</span>
              {/* The PARSE_FAIL context action the spec mentions is not
                  implemented: searching the whole repo, the codes actually
                  emitted are only BUILD_FAILED / LOGS_DIR_UNREADABLE plus the
                  parser's invariant codes — there is no PARSE_FAIL, so the
                  branch would never run. Add it once that code really
                  exists. */}
              <span className="dev-diag-detail">{d.detail ?? ""}</span>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="rpt-dim">
            {t("dev.diag.empty")}
            {diags.length > 0 ? t("dev.diag.filteredOut") : ""}
          </li>
        )}
      </ul>
    </section>
  );
}
