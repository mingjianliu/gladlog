import { describe, expect, it } from "vitest";

import { checkKillAttemptFraming } from "../src/quality/promptQualityCheck";

const line = (opp: string) =>
  `  [0:05–0:08] on Zmx-Lothar-US — Storm Bolt opener (Full DR), 1 stun | opportunity: ${opp} | team focus 58% (0.05M on target) | FAILED: not enough damage`;

describe("checkKillAttemptFraming(第 26 类 hardFailure,用户裁决 2026-09-22)", () => {
  it("v92 措辞:开场晕标成 locked + 汇总统计徽章在手 → 两条失败", () => {
    const f = checkKillAttemptFraming([
      "KILL ATTEMPTS — team kill attempts (…):",
      line("locked (trinket up)"),
      "  Summary: 1 attempts (1 stun-anchored, 0 burst-anchored; 0 on PRIME targets), 0 kills; 1 opened while the target's trinket was still up.",
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("line 2");
    expect(f[1]).toContain("line 3");
  });

  it("v93 措辞:no softer target / 点名更软目标 / gated / PRIME → 零失败", () => {
    expect(
      checkKillAttemptFraming([
        line("trinket up (no softer target)"),
        line("trinket up (softer target then: Chiéfntv-Tichondrius-US — PRIME)"),
        line("gated (Survival Instincts in hand; no softer target)"),
        line("PRIME (no trinket, no 20-99% wall in hand)"),
        "  Summary: 4 attempts (4 stun-anchored, 0 burst-anchored; 1 on PRIME targets), 0 kills; 1 opened while a softer target existed.",
      ]),
    ).toEqual([]);
  });

  it("不是 KILL ATTEMPTS 行的 locked 不管(如 [kill-opportunity: locked — trinket up] 的 Other 行)", () => {
    expect(
      checkKillAttemptFraming([
        "    Other:   Feral Druid (X) — 80% HP, none [kill-opportunity: locked — trinket up]",
      ]),
    ).toEqual([]);
  });
});
