export interface MatchStub {
  id: string;
  bracket: string;
  rating: number;
  logObjectUrl: string;
}

const FEED_ENDPOINT = "https://wowarenalogs.com/api/graphql";
// 真实 query(取自旧 fork CLEAN 的 fetchStubs;go/no-go 冒烟实证)。minRating 为**服务端**变量,
// 返回的 combats 已按评分过滤,客户端无需再按 rating 过滤。`combats` 是接口类型 CombatDataStub,
// 字段必须经 `... on ArenaMatchDataStub` / `... on ShuffleRoundStub` 内联片段选择(直接选字段会 400)。
const STUBS_QUERY = `query GetLatestMatches($wowVersion: String!, $bracket: String, $offset: Int!, $count: Int!, $minRating: Float) {
  latestMatches(wowVersion: $wowVersion, bracket: $bracket, offset: $offset, count: $count, minRating: $minRating) {
    combats {
      ... on ArenaMatchDataStub { id logObjectUrl startInfo { bracket } }
      ... on ShuffleRoundStub { id logObjectUrl startInfo { bracket } }
    }
  }
}`;

type FetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<any>;
  text?: () => Promise<any>;
};
type FetchLike = (url: string, init?: any) => Promise<FetchResponse>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with exponential backoff. A production corpus build makes thousands of
 * feed requests; transient 429/5xx and network blips are expected and must not
 * abort the whole run. Retries only retryable failures (429, 5xx, network
 * errors); 4xx (other than 429) throw immediately. Exposed for unit testing.
 */
export async function fetchWithRetry(
  f: FetchLike,
  url: string,
  init: any,
  label: string,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<FetchResponse> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastErr: Error = new Error(`${label}: no attempt made`);
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: FetchResponse | undefined;
    let netErr: unknown;
    try {
      res = await f(url, init);
    } catch (e) {
      netErr = e;
    }
    if (res && res.ok) return res;
    const status = res?.status;
    const retryable =
      netErr != null || status === 429 || (!!status && status >= 500);
    lastErr =
      netErr instanceof Error
        ? netErr
        : new Error(`${label} HTTP ${status ?? "?"}`);
    if (!retryable || attempt === retries) throw lastErr;
    // exponential backoff with jitter, capped
    await sleep(
      Math.min(baseDelayMs * 2 ** attempt, 15000) + Math.random() * 500,
    );
  }
  throw lastErr;
}

export async function fetchMatchStubs(
  opts: { bracket: string; minRating: number; specId?: number; limit: number },
  fetchImpl?: FetchLike,
): Promise<MatchStub[]> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  const out: MatchStub[] = [];
  let offset = 0;
  const page = 50;
  while (out.length < opts.limit) {
    const res = await fetchWithRetry(
      f,
      FEED_ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: STUBS_QUERY,
          variables: {
            wowVersion: "retail",
            bracket: opts.bracket,
            offset,
            count: page,
            minRating: opts.minRating, // 服务端过滤
          },
        }),
      },
      "feed",
    );
    const combats = (await res.json())?.data?.latestMatches?.combats ?? [];
    if (combats.length === 0) break;
    for (const c of combats) {
      // 服务端已按 minRating 过滤;客户端只做映射。
      out.push({
        id: c.id,
        bracket: opts.bracket,
        rating: opts.minRating,
        logObjectUrl: c.logObjectUrl,
      });
      if (out.length >= opts.limit) break;
    }
    // 短页(少于请求的 count)代表已到 feed 末尾,避免对 mock/真实分页无限重复请求同一页。
    if (combats.length < page) break;
    offset += page;
  }
  return out;
}

export async function downloadLogText(
  stub: MatchStub,
  fetchImpl?: FetchLike,
): Promise<string> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  const res = await fetchWithRetry(
    f,
    stub.logObjectUrl,
    undefined,
    `log download for ${stub.id}`,
  );
  return await (res as any).text();
}

// ── 详细 stubs(fetch-public 语料抓取用)────────────────────────────────────
// 与 STUBS_QUERY 同一端点/同一分页/同一重试;字段超集:识别记录者与高级日志。
// 注意:minRating 是服务端 Firestore 复合索引变量,必须与 bracket 同传
// (bracket:null + minRating → FAILED_PRECONDITION,2026-07-16 实测)。

export interface DetailedStubUnit {
  id: string;
  name: string;
  spec: string;
  reaction: number;
}

export interface DetailedMatchStub {
  typename: string;
  id: string;
  logObjectUrl: string;
  playerId: string;
  hasAdvancedLogging: boolean;
  durationInSeconds: number;
  bracket: string;
  units: DetailedStubUnit[];
}

const DETAILED_STUBS_QUERY = `query GetLatestMatchesDetailed($wowVersion: String!, $bracket: String, $offset: Int!, $count: Int!, $minRating: Float) {
  latestMatches(wowVersion: $wowVersion, bracket: $bracket, offset: $offset, count: $count, minRating: $minRating) {
    combats {
      __typename
      ... on ArenaMatchDataStub {
        id logObjectUrl playerId hasAdvancedLogging durationInSeconds
        startInfo { bracket }
        units { id name spec reaction }
      }
      ... on ShuffleRoundStub {
        id logObjectUrl playerId hasAdvancedLogging durationInSeconds
        startInfo { bracket }
        units { id name spec reaction }
      }
    }
    queryLimitReached
  }
}`;

export async function fetchDetailedStubs(
  opts: {
    bracket?: string;
    minRating?: number;
    offset?: number;
    count?: number;
  },
  fetchImpl?: FetchLike,
): Promise<{ stubs: DetailedMatchStub[]; queryLimitReached: boolean }> {
  const f: FetchLike =
    fetchImpl ?? ((await import("node-fetch")).default as any);
  if (opts.minRating && !opts.bracket) {
    throw new Error(
      "minRating requires bracket (server-side composite index; 2026-07-16 FAILED_PRECONDITION)",
    );
  }
  const res = await fetchWithRetry(
    f,
    FEED_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: DETAILED_STUBS_QUERY,
        variables: {
          wowVersion: "retail",
          bracket: opts.bracket ?? null,
          offset: opts.offset ?? 0,
          count: opts.count ?? 50,
          minRating: opts.minRating && opts.minRating > 0 ? opts.minRating : null,
        },
      }),
    },
    "feed-detailed",
  );
  const data = (await res.json())?.data?.latestMatches;
  if (!data) throw new Error("feed-detailed: empty latestMatches response");
  const stubs: DetailedMatchStub[] = (data.combats ?? []).map((c: any) => ({
    typename: c.__typename ?? "",
    id: c.id,
    logObjectUrl: c.logObjectUrl,
    playerId: c.playerId ?? "",
    hasAdvancedLogging: !!c.hasAdvancedLogging,
    durationInSeconds: c.durationInSeconds ?? 0,
    bracket: c.startInfo?.bracket ?? "",
    units: c.units ?? [],
  }));
  return { stubs, queryLimitReached: !!data.queryLimitReached };
}
