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
