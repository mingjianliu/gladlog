export interface MatchStub {
  id: string;
  bracket: string;
  rating: number;
  logObjectUrl: string;
}

const FEED_ENDPOINT = "https://wowarenalogs.com/api/graphql";
// 真实 query(取自旧 fork CLEAN 的 fetchStubs):minRating 为**服务端**变量,返回的 combats
// 已按评分过滤,故客户端无需再按 rating 过滤。combats 选择集与 MatchStub 字段名以旧 STUBS_QUERY
// 为准(id / logObjectUrl / startTime / endTime 等);bracket 用查询变量回填。
const STUBS_QUERY = `query GetLatestMatches($wowVersion: String!, $bracket: String, $offset: Int!, $count: Int!, $minRating: Float) {
  latestMatches(wowVersion: $wowVersion, bracket: $bracket, offset: $offset, count: $count, minRating: $minRating) {
    combats { id wowVersion logObjectUrl startTime endTime }
  }
}`;

type FetchLike = (
  url: string,
  init?: any,
) => Promise<{ ok: boolean; json: () => Promise<any> }>;

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
    const res = await f(FEED_ENDPOINT, {
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
    });
    if (!res.ok) throw new Error(`feed HTTP ${(res as any).status ?? "?"}`);
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
  const res = await f(stub.logObjectUrl);
  if (!res.ok) throw new Error(`log download HTTP for ${stub.id}`);
  return await (res as any).text();
}
