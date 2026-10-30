import { describe, expect, it } from "vitest";

import {
  authUnknownHint,
  detectObsWebsocket,
  obsWebsocketConfigCandidates,
  resolveAutoConfigPassword,
} from "./obsAutoConfig";

describe("obsWebsocketConfigCandidates", () => {
  it("win32 走 APPDATA;darwin 走 Application Support;无 APPDATA → 空", () => {
    expect(
      obsWebsocketConfigCandidates({
        platform: "win32",
        appData: "C:\\Users\\me\\AppData\\Roaming",
      })[0],
    ).toContain("obs-websocket");
    expect(
      obsWebsocketConfigCandidates({ platform: "win32", appData: undefined }),
    ).toEqual([]);
    expect(
      obsWebsocketConfigCandidates({
        platform: "darwin",
        home: "/Users/me",
      })[0],
    ).toContain("Application Support");
  });
});

describe("detectObsWebsocket", () => {
  const cfg = (o: object) => JSON.stringify(o);

  it("解析端口/密码/启用位;auth 关闭时密码视为 null", () => {
    const d = detectObsWebsocket(["/fake/config.json"], () =>
      cfg({
        server_enabled: true,
        auth_required: true,
        server_port: 4466,
        server_password: "pw",
      }),
    );
    expect(d).toMatchObject({
      found: true,
      enabled: true,
      authRequired: true,
      port: 4466,
      password: "pw",
    });
    const noAuth = detectObsWebsocket(["/fake/config.json"], () =>
      cfg({ server_enabled: true, auth_required: false, server_port: 4455 }),
    );
    expect(noAuth.authRequired).toBe(false);
  });

  it("文件不存在/损坏 → found:false;服务器未启用如实上报", () => {
    expect(
      detectObsWebsocket(["/nope"], () => {
        throw new Error("ENOENT");
      }).found,
    ).toBe(false);
    expect(detectObsWebsocket(["/bad"], () => "{not json").found).toBe(false);
    expect(
      detectObsWebsocket(["/fake"], () =>
        cfg({ server_enabled: false, server_port: 4455 }),
      ),
    ).toMatchObject({ found: true, enabled: false });
  });

  it("#21 item5(红→绿):auth_required 字段缺失 → 诚实建模为 unknown,不再误判成需要密码", () => {
    const d = detectObsWebsocket(["/fake"], () =>
      cfg({ server_enabled: true, server_port: 4455, server_password: "pw" }),
    );
    expect(d.authRequired).toBe("unknown");
  });

  it("auth_required 是非布尔值(schema 漂移的另一种形态)同样归为 unknown", () => {
    const d = detectObsWebsocket(["/fake"], () =>
      cfg({ server_enabled: true, auth_required: "yes", server_port: 4455 }),
    );
    expect(d.authRequired).toBe("unknown");
  });
});

describe("resolveAutoConfigPassword(#21 item5 三态消费端选择)", () => {
  it("authRequired: false → 显式清空密码(不需要就不带)", () => {
    expect(
      resolveAutoConfigPassword({
        found: true,
        authRequired: false,
        password: "pw",
      }),
    ).toBeNull();
  });
  it("authRequired: true → 带上已读到的密码", () => {
    expect(
      resolveAutoConfigPassword({
        found: true,
        authRequired: true,
        password: "pw",
      }),
    ).toBe("pw");
  });
  it("authRequired: unknown → 照样带上已读到的密码(尝试连接,而非强行留空)", () => {
    expect(
      resolveAutoConfigPassword({
        found: true,
        authRequired: "unknown",
        password: "pw",
      }),
    ).toBe("pw");
  });
  it("unknown 且没读到密码 → null(没有可带的密码)", () => {
    expect(
      resolveAutoConfigPassword({
        found: true,
        authRequired: "unknown",
        password: null,
      }),
    ).toBeNull();
  });
});

describe("authUnknownHint(#21 item5 unknown 态失败提示)", () => {
  it("unknown + 连接失败 → 给出人话提示", () => {
    expect(authUnknownHint("unknown", false)).toMatch(/未知/);
  });
  it("unknown + 连接成功 → 不需要提示", () => {
    expect(authUnknownHint("unknown", true)).toBeUndefined();
  });
  it("true/false 态从不附加提示(鉴权状态本就明确)", () => {
    expect(authUnknownHint(true, false)).toBeUndefined();
    expect(authUnknownHint(false, false)).toBeUndefined();
  });
});
