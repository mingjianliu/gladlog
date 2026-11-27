// Solo Shuffle timing radar — the main-process half. The page only renders
// what the radar server computed; this module fetches it (from main, not the
// renderer: no CSP / CORS surface, and the base URL can come from the
// environment).
//
// Hidden until it ships: the top tab shows only under `electron-vite dev`
// (ELECTRON_RENDERER_URL is set there and nowhere else — packaged builds and
// E2E load the built renderer) or with GLADLOG_SPEC_RADAR=1;
// GLADLOG_SPEC_RADAR=0 hides it in dev too.

import {
  DEFAULT_RADAR_BASE_URL,
  type SpecRadarConfig,
  type SpecTimingQuery,
  type SpecTimingResponse,
  type SpecTimingResult,
  specTimingShapeError,
  specTimingUrl,
} from "../shared/specRadar";

const FETCH_TIMEOUT_MS = 20_000;

export function specRadarConfig(
  env: NodeJS.ProcessEnv = process.env,
): SpecRadarConfig {
  const flag = env["GLADLOG_SPEC_RADAR"];
  const enabled =
    flag === "1" || (flag !== "0" && !!env["ELECTRON_RENDERER_URL"]);
  const baseUrl =
    env["GLADLOG_SPEC_RADAR_URL"]?.trim() || DEFAULT_RADAR_BASE_URL;
  return { enabled, baseUrl };
}

export async function fetchSpecTiming(
  q: SpecTimingQuery,
  deps: {
    fetch?: typeof fetch;
    config?: SpecRadarConfig;
    now?: () => number;
  } = {},
): Promise<SpecTimingResult> {
  const config = deps.config ?? specRadarConfig();
  const doFetch = deps.fetch ?? fetch;
  const base = q.baseUrl?.trim() || config.baseUrl;
  let url: string;
  try {
    url = specTimingUrl(base, q);
  } catch (e) {
    return {
      ok: false,
      error: `bad server URL: ${(e as Error).message}`,
      url: base,
    };
  }
  try {
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url };
    const body: unknown = await res.json();
    const bad = specTimingShapeError(body);
    if (bad) return { ok: false, error: `unexpected response: ${bad}`, url };
    return {
      ok: true,
      data: body as SpecTimingResponse,
      url,
      fetchedAt: (deps.now ?? Date.now)(),
    };
  } catch (e) {
    // undici puts the socket error on `cause`; for a multi-address host it is
    // an AggregateError whose own errors carry the code.
    const err = e as Error & {
      cause?: { code?: string; message?: string; errors?: { code?: string }[] };
    };
    const code =
      err.cause?.code ?? err.cause?.errors?.[0]?.code ?? err.cause?.message;
    return {
      ok: false,
      error: code ? `${err.message} (${code})` : err.message,
      url,
    };
  }
}
