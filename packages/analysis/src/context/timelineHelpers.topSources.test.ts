/**
 * `Top sources:` / `Top damage in final Ns:` labels (2026-09-15): a summon
 * that logs with NPC flags instead of Pet/Guardian (a Death Knight's ghoul,
 * 0xa28) bypassed the B24 `[pet]` relabel and printed its client-locale
 * name — the last CJK leak standing after the KILL ATTEMPTS / [ROOT] fixes
 * (9 of 309 prompts). Same rule as `actorLabel`: not a player, not ASCII →
 * `[pet]`; an ASCII summon keeps its name.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { getTopDamageSourcesInWindow } from "./timelineHelpers";

const T0 = 1_000_000;
/** hostile NPC, straight from a zh-client log line (`"次级食尸鬼",0xa28`) */
const HOSTILE_NPC = 0xa28;
/** hostile player */
const HOSTILE_PLAYER = 0x548;

const hit = (srcUnitName: string, srcUnitFlags: number, amount: number) => ({
  logLine: { timestamp: T0 + 5_000 },
  effectiveAmount: -amount,
  srcUnitName,
  srcUnitFlags,
  spellId: "",
  spellName: "Death Order",
});

const victim = (damageIn: unknown[]) =>
  ({ reaction: CombatUnitReaction.Friendly, damageIn }) as never;

describe("getTopDamageSourcesInWindow — summon labels", () => {
  it("a localized NPC-flagged summon → [pet]; an ASCII one keeps its short name", () => {
    const out = getTopDamageSourcesInWindow(
      victim([
        hit("次级食尸鬼", HOSTILE_NPC, 107_000),
        hit("Earthgrab Totem-Illidan-US", HOSTILE_NPC, 50_000),
      ]),
      T0 + 10_000,
      10_000,
      3,
      new Map(),
      new Map(),
    );
    expect(out[0]).toBe("[pet] — Death Order (107k)");
    expect(out[1]).toBe("Earthgrab Totem — Death Order (50k)");
    expect(out.join("\n")).not.toMatch(/[一-鿿]/);
  });

  it("a player source resolves to its roster id, never the name", () => {
    const out = getTopDamageSourcesInWindow(
      victim([hit("Deathlord-Illidan-US", HOSTILE_PLAYER, 90_000)]),
      T0 + 10_000,
      10_000,
      3,
      new Map(),
      new Map([["Deathlord-Illidan-US", 4]]),
    );
    expect(out[0]).toBe("4 — Death Order (90k)");
  });
});
