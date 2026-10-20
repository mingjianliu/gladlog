import { describe, expect, it } from "vitest";

import { GladLogParser, slimMatchParams } from "../src";
import type { GladMatch } from "../src/l3/model";
import { synthArenaLog } from "../src/testing/synthLog";

function parseSynth(): GladMatch {
  const parser = new GladLogParser();
  let match: GladMatch | null = null;
  parser.on("match", (m) => (match = m));
  for (const line of synthArenaLog().split("\n")) parser.push(line);
  parser.end();
  return match!;
}

describe("doc 瘦身谓词(2026-07-25 内存事故)", () => {
  it("compose 出厂即瘦:params ≤13 位,消费位保留,其余空串", () => {
    const m = parseSynth();
    for (const u of Object.values(m.units)) {
      for (const e of [...u.damageOut, ...u.auraEvents, ...u.casts]) {
        expect(e.params.length).toBeLessThanOrEqual(13);
        // Redundant slots (GUID / name) are cleared
        if (e.params.length > 0) expect(e.params[0]).toBe("");
        if (e.params.length > 5) expect(e.params[5]).toBe("");
      }
      // crit is materialized on damage events
      for (const e of u.damageOut) expect(typeof e.crit).toBe("boolean");
      // An aura's [11] (its type) is preserved
      for (const e of u.auraEvents)
        if (e.params.length > 11)
          expect(["BUFF", "DEBUFF"]).toContain(e.params[11]);
    }
  });

  it("幂等:出厂瘦档重跑零改动", () => {
    const m = parseSynth();
    expect(slimMatchParams(m)).toBe(false);
  });

  it("旧肥档:补 crit 物化后裁位,返回 changed", () => {
    const fat = {
      units: {
        u1: {
          damageOut: [
            {
              eventName: "SPELL_DAMAGE",
              // Simplified fat params: 8 base slots + 3 spell slots + school
              // + the advanced tail
              params: [
                "Player-1-A", "Src-Realm", "0x511", "0x0",
                "Player-1-B", "Dst-Realm", "0x548", "0x0",
                "1234", "Spell", "0x4",
                "Creature-X", "Player-Y", "5", "1", "100", "200", "300",
                "0", "0", "0", "0", "0", "0", "0",
                "1000", "800", "-1", "0", "0", "1", "nil",
              ],
            },
          ],
        },
      },
    };
    expect(slimMatchParams(fat as never)).toBe(true);
    const e = (fat.units.u1.damageOut as { params: string[]; crit?: boolean }[])[0]!;
    expect(e.params.length).toBe(13);
    expect(e.params[2]).toBe("0x511");
    expect(e.params[10]).toBe("0x4");
    expect(e.params[11]).toBe(""); // on a damage event, [11] is the advanced GUID → cleared
    expect(e.params[0]).toBe("");
  });
});
