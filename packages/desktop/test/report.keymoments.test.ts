import { describe, expect, it } from "vitest";

import { deriveKeyMoments } from "../src/renderer/src/report/derive/keyMoments";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

// fixture 为 native 格式(deaths/casts),注入走 report.deathrecap.test 同款先例。
type NativeUnit = {
  id: string;
  name: string;
  kind: string;
  reaction: string;
  deaths: Array<Record<string, unknown>>;
  casts: Array<Record<string, unknown>>;
};

function friendlyPlayer(m: typeof base): NativeUnit {
  const u = Object.values(m.units).find(
    (u) =>
      (u as { kind?: string }).kind === "Player" &&
      (u as { reaction?: string }).reaction === "Friendly",
  );
  if (!u) throw new Error("fixture 无友方玩家");
  return u as unknown as NativeUnit;
}

describe("deriveKeyMoments", () => {
  it("裁剪 fixture 不抛,输出按 t 升序", () => {
    const ms = deriveKeyMoments(base as unknown as ReportSource);
    expect(Array.isArray(ms)).toBe(true);
    for (let i = 1; i < ms.length; i++) {
      expect(ms[i]!.t).toBeGreaterThanOrEqual(ms[i - 1]!.t);
    }
  });

  it("注入死亡 → 产出 death 节点(side=friendly,t≈42)", () => {
    const clone = JSON.parse(JSON.stringify(base)) as typeof base;
    const victim = friendlyPlayer(clone);
    victim.deaths.push({
      timestamp: clone.startTime + 42_000,
      eventName: "UNIT_DIED",
      spellId: 0,
      spellName: "",
      srcId: "",
      srcName: "",
      destId: victim.id,
      destName: victim.name,
      unconscious: false,
    });
    const ms = deriveKeyMoments(clone as unknown as ReportSource);
    const death = ms.find((m) => m.kind === "death" && m.side === "friendly");
    expect(death).toBeTruthy();
    expect(Math.round(death!.t)).toBe(42);
    expect(death!.unitNames[0]).toBe(victim.name);
  });

  it("注入饰品施法 → 产出 defensive 节点(交饰品)", () => {
    const clone = JSON.parse(JSON.stringify(base)) as typeof base;
    const u = friendlyPlayer(clone);
    u.casts.push({
      spellId: 336126,
      spellName: "Gladiator's Medallion",
      timestamp: clone.startTime + 30_000,
      eventName: "SPELL_CAST_SUCCESS",
      srcId: u.id,
      srcName: u.name,
      destId: u.id,
      destName: u.name,
    });
    const ms = deriveKeyMoments(clone as unknown as ReportSource);
    const trinket = ms.find(
      (m) => m.kind === "defensive" && m.title === "交饰品",
    );
    expect(trinket).toBeTruthy();
    expect(Math.round(trinket!.t)).toBe(30);
    expect(trinket!.unitNames[0]).toBe(u.name);
  });
});
