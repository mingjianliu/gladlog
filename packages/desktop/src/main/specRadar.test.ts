import { response, spec } from "../renderer/src/radar/radarFixtures";
import {
  DEFAULT_RADAR_BASE_URL,
  specTimingShapeError,
  specTimingUrl,
} from "../shared/specRadar";
import { fetchSpecTiming, specRadarConfig } from "./specRadar";

const OK_BODY = response([spec("Discipline Priest", "Priest", "healer")]);

function fakeFetch(
  status: number,
  body: unknown,
): { fn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fn = (async (url: string) => {
    urls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, urls };
}

const config = { enabled: true, baseUrl: "http://radar.test:8080" };

describe("specRadarConfig(隐藏开关)", () => {
  it("打包版 / E2E(无 ELECTRON_RENDERER_URL)默认不显示", () => {
    expect(specRadarConfig({}, false).enabled).toBe(false);
  });
  it("electron-vite dev 下显示;GLADLOG_SPEC_RADAR=0 可关", () => {
    expect(
      specRadarConfig({ ELECTRON_RENDERER_URL: "http://localhost:5173" }, false)
        .enabled,
    ).toBe(true);
    expect(
      specRadarConfig(
        {
          ELECTRON_RENDERER_URL: "http://localhost:5173",
          GLADLOG_SPEC_RADAR: "0",
        },
        false,
      ).enabled,
    ).toBe(false);
  });
  it("漏进来的 ELECTRON_RENDERER_URL 在打包版或 E2E 里不打开", () => {
    const env = { ELECTRON_RENDERER_URL: "http://localhost:5173" };
    expect(specRadarConfig(env, true).enabled).toBe(false);
    expect(specRadarConfig({ ...env, GLADLOG_E2E: "1" }, false).enabled).toBe(
      false,
    );
  });
  it("GLADLOG_SPEC_RADAR=1 在任何构建里都显示", () => {
    expect(specRadarConfig({ GLADLOG_SPEC_RADAR: "1" }, true).enabled).toBe(
      true,
    );
    expect(specRadarConfig({ GLADLOG_SPEC_RADAR: "1" }).enabled).toBe(true);
  });
  it("服务地址:环境变量优先,否则默认本机采集端", () => {
    expect(specRadarConfig({}).baseUrl).toBe(DEFAULT_RADAR_BASE_URL);
    expect(
      specRadarConfig({ GLADLOG_SPEC_RADAR_URL: " https://radar.example " })
        .baseUrl,
    ).toBe("https://radar.example");
  });
});

describe("specTimingUrl", () => {
  it("实时模式不带 hour,模拟时段带 hour", () => {
    expect(
      specTimingUrl("http://h:1", {
        region: "eu",
        ratingTier: "below_2100",
        hour: null,
      }),
    ).toBe(
      "http://h:1/api/tracker/spec_timing?region=eu&rating_tier=below_2100",
    );
    expect(
      specTimingUrl("http://h:1/", {
        region: "us",
        ratingTier: "2600",
        hour: 0,
      }),
    ).toBe(
      "http://h:1/api/tracker/spec_timing?region=us&rating_tier=2600&hour=0",
    );
  });
  it("拒绝非 http(s) 协议", () => {
    expect(() =>
      specTimingUrl("file:///etc", {
        region: "us",
        ratingTier: "2600",
        hour: null,
      }),
    ).toThrow(/protocol/);
  });
});

describe("fetchSpecTiming", () => {
  const q = { region: "us", ratingTier: "2600", hour: null } as const;

  it("成功:返回数据、URL 与拉取时刻", async () => {
    const f = fakeFetch(200, OK_BODY);
    const r = await fetchSpecTiming(q, { fetch: f.fn, config, now: () => 42 });
    expect(r).toMatchObject({ ok: true, fetchedAt: 42 });
    expect(f.urls[0]).toBe(
      "http://radar.test:8080/api/tracker/spec_timing?region=us&rating_tier=2600",
    );
  });

  it("页面给的地址覆盖配置地址", async () => {
    const f = fakeFetch(200, OK_BODY);
    await fetchSpecTiming(
      { ...q, baseUrl: "http://other:9" },
      { fetch: f.fn, config },
    );
    expect(f.urls[0]).toMatch(/^http:\/\/other:9\//);
  });

  it("HTTP 错误 / 形状不对 / 网络异常 / 坏地址都返回错误而不是抛", async () => {
    expect(
      await fetchSpecTiming(q, { fetch: fakeFetch(503, {}).fn, config }),
    ).toMatchObject({
      ok: false,
      error: "HTTP 503",
    });
    expect(
      await fetchSpecTiming(q, {
        fetch: fakeFetch(200, { specs: "x" }).fn,
        config,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/specs/) });
    const boom = (async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      });
    }) as unknown as typeof fetch;
    expect(await fetchSpecTiming(q, { fetch: boom, config })).toMatchObject({
      ok: false,
      error: "fetch failed (ECONNREFUSED)",
    });
    expect(
      await fetchSpecTiming(
        { ...q, baseUrl: "not a url" },
        { fetch: boom, config },
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^bad server URL/),
    });
  });
});

describe("specTimingShapeError", () => {
  it("接受合法形状", () => {
    expect(specTimingShapeError(OK_BODY)).toBeNull();
  });
  it("指出第一处问题(含审查复现的 specs 为空、缺大盘的 200)", () => {
    expect(specTimingShapeError(null)).toMatch(/object/);
    expect(specTimingShapeError({ specs: [] })).toMatch(/current_hour/);
    expect(specTimingShapeError({ specs: [], current_hour: 13 })).toMatch(
      /pool_allday/,
    );
    const { method: _m, ...noMethod } = OK_BODY;
    expect(specTimingShapeError(noMethod)).toMatch(/method/);
    const badPool = {
      ...OK_BODY,
      pools_by_role: { dps: { matches: 1 } },
    };
    expect(specTimingShapeError(badPool)).toMatch(/pools_by_role\.dps/);
    const s0 = OK_BODY.specs[0]!;
    expect(
      specTimingShapeError({
        ...OK_BODY,
        specs: [{ ...s0, hourly_curve: s0.hourly_curve.slice(1) }],
      }),
    ).toMatch(/24 points/);
    expect(
      specTimingShapeError({
        ...OK_BODY,
        specs: [{ ...s0, window_win_rate: null }],
      }),
    ).toMatch(/window_win_rate/);
    expect(
      specTimingShapeError({
        ...OK_BODY,
        specs: [
          {
            ...s0,
            hourly_curve: s0.hourly_curve.map((h, i) =>
              i === 7 ? { ...h, score: undefined } : h,
            ),
          },
        ],
      }),
    ).toMatch(/without score/);
  });
});
