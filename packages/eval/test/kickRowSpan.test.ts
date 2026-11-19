/**
 * troughFactScan's kick window is the product's (`kickPressureSpanMs`), found
 * from the row's printed `t` — not a span rebuilt from the row's rounded
 * numbers (pipeline B139 review, 28-2-171: lock end 56.083 s, the rebuilt
 * span read a 34 % at 56.119 s).
 */
import { kickPressureSpanMs } from "@gladlog/analysis/src/analysis/kickPressure";
import { describe, expect, it } from "vitest";

import { kickRowSpanMs } from "../scripts/lib/kickRowSpan";

const START = 1_000_000;
const combat = { startTime: START, endTime: START + 300_000 };

describe("kickRowSpanMs", () => {
  // the shape of 28-2-171: the row prints t=50 and lockout=6.0
  const kick = { atSeconds: 50.083, lockoutDurationSeconds: 6 };

  it("ends at the lock's own millisecond: a sample 36 ms later is outside", () => {
    const span = kickRowSpanMs([kick], combat, "50")!;
    expect(span).toEqual({ fromMs: START + 50_083, toMs: START + 56_083 });
    const sampleMs = START + 56_119;
    expect(sampleMs > span.toMs).toBe(true);
    // what the scan rebuilt from the row: kick row + (lockout + 0.05) s
    const rebuiltEnd = START + 50_083 + 6_050;
    expect(sampleMs <= rebuiltEnd).toBe(true);
  });

  it("is the product's span, early end and round end included", () => {
    const early = { ...kick, lockEndedBySuccessS: 2.5 };
    expect(kickRowSpanMs([early], combat, "50")).toEqual(
      kickPressureSpanMs(early, combat),
    );
    expect(kickRowSpanMs([early], combat, "50")!.toMs).toBe(START + 52_583);
    const short = { startTime: START, endTime: START + 53_000 };
    expect(kickRowSpanMs([kick], short, "50")!.toMs).toBe(START + 53_000);
  });

  it("finds the instance by the row's own rendering of t, and refuses a row it cannot place", () => {
    const other = { atSeconds: 163.27, lockoutDurationSeconds: 3 };
    expect(kickRowSpanMs([kick, other], combat, "163.2")!.fromMs).toBe(
      START + 163_270,
    );
    expect(kickRowSpanMs([kick], combat, "163.2")).toBeUndefined();
    // two kicks printing one t with different spans: the row cannot say which
    expect(
      kickRowSpanMs(
        [kick, { atSeconds: 50.01, lockoutDurationSeconds: 4 }],
        combat,
        "50",
      ),
    ).toBeUndefined();
  });
});
