import { describe, expect, it, vi } from "vitest";

// Confirmed by agy review of #10 T4: ownerCds/ownerCcSummary are captured
// opportunistically inside the `for (const u of friends)` loops of the
// defensive and cc blocks — so if a teammate ordered before the owner in
// friends makes that block throw early, the loop aborts before ever reaching
// the owner and both variables stay stuck at undefined/[]. The position block
// must therefore compute them itself as a fallback, and must not assume an
// earlier block got as far as the owner.
//
// Reproduction: use deriveKeyMoments' ownerId override to pin the owner to the
// SECOND friendly unit in the fixture (Player-57-0DFFA9C4), then make the
// first friendly (Player-57-0DA725E3) throw inside extractMajorCooldowns /
// analyzePlayerCCAndTrinket — the real implementation never throws for the
// owner itself, so only the fallback path can produce non-empty values.

const boomState = vi.hoisted(() => ({ armed: false }));

vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return {
    ...actual,
    extractMajorCooldowns: vi.fn((u: { id: string }, l: unknown) => {
      if (boomState.armed && u.id === "Player-57-0DA725E3") {
        throw new Error("boom-cds");
      }
      return actual.extractMajorCooldowns(
        u as Parameters<typeof actual.extractMajorCooldowns>[0],
        l as Parameters<typeof actual.extractMajorCooldowns>[1],
      );
    }),
    analyzePlayerCCAndTrinket: vi.fn(
      (u: { id: string }, e: unknown, l: unknown, p: unknown) => {
        if (boomState.armed && u.id === "Player-57-0DA725E3") {
          throw new Error("boom-cc");
        }
        return actual.analyzePlayerCCAndTrinket(
          u as Parameters<typeof actual.analyzePlayerCCAndTrinket>[0],
          e as Parameters<typeof actual.analyzePlayerCCAndTrinket>[1],
          l as Parameters<typeof actual.analyzePlayerCCAndTrinket>[2],
          p as Parameters<typeof actual.analyzePlayerCCAndTrinket>[3],
        );
      },
    ),
    computeOwnerPositionEvents: vi.fn(() => []),
  };
});

import {
  analyzePlayerCCAndTrinket,
  computeOwnerPositionEvents,
} from "@gladlog/analysis";

import fixture from "../../../../../test/fixtures/report-match.json";
import { deriveKeyMoments } from "./keyMoments";
import type { ReportSource } from "./types";

const source = fixture as unknown as ReportSource;

describe("deriveKeyMoments — position 块 owner CD/CC 兜底(#10 T4 agy 复核)", () => {
  it("排第一的友方在 defensive/cc 块抛错,position 仍拿到 owner 自己的 CD/CC(不因中途 throw 退化成 []/undefined)", () => {
    boomState.armed = true;
    try {
      deriveKeyMoments(source, "Player-57-0DFFA9C4");
    } finally {
      boomState.armed = false;
    }
    const posMock = vi.mocked(computeOwnerPositionEvents);
    expect(posMock).toHaveBeenCalledTimes(1);
    const call = posMock.mock.calls[0]![0];
    // The fallback really did call analyzePlayerCCAndTrinket(owner, ...) — not
    // the value opportunistically captured in the loop (which was never
    // written, because friendly #1 threw first).
    expect(vi.mocked(analyzePlayerCCAndTrinket)).toHaveBeenCalledWith(
      expect.objectContaining({ id: "Player-57-0DFFA9C4" }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(call.ownerCCSummary).toBeDefined();
    expect(call.ownerCooldowns).toBeDefined();
  });
});
