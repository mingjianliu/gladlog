import {
  DEFAULT_RADAR_BASE_URL,
  specTimingShapeError,
  specTimingUrl,
} from "../shared/specRadar";
import { fetchSpecTiming, specRadarConfig } from "./specRadar";

const curve = Array.from({ length: 24 }, (_, hour) => ({ hour, score: 50 }));
const OK_BODY = {
  current_hour: 22,
  specs: [
    {
      spec_name: "Discipline Priest",
      timing_score: 81.1,
      strength_score: 31.7,
      hourly_curve: curve,
    },
  ],
};

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
    expect(specRadarConfig({}).enabled).toBe(false);
  });
  it("electron-vite dev 下显示;GLADLOG_SPEC_RADAR=0 可关", () => {
    expect(
      specRadarConfig({ ELECTRON_RENDERER_URL: "http://localhost:5173" })
        .enabled,
    ).toBe(true);
    expect(
      specRadarConfig({
        ELECTRON_RENDERER_URL: "http://localhost:5173",
        GLADLOG_SPEC_RADAR: "0",
      }).enabled,
    ).toBe(false);
  });
  it("GLADLOG_SPEC_RADAR=1 在任何构建里都显示", () => {
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
  it("接受合法形状,指出第一处问题", () => {
    expect(specTimingShapeError(OK_BODY)).toBeNull();
    expect(specTimingShapeError(null)).toMatch(/object/);
    expect(specTimingShapeError({ specs: [] })).toMatch(/current_hour/);
    expect(
      specTimingShapeError({
        current_hour: 1,
        specs: [{ ...OK_BODY.specs[0], hourly_curve: curve.slice(1) }],
      }),
    ).toMatch(/24 points/);
  });
});
