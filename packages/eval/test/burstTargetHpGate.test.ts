import { describe, expect, it } from "vitest";

import { checkBurstTargetHpConsistency } from "../src/quality/promptQualityCheck";

/**
 * Triage 2026-09-29, group G15 (hp-state F-B1, sync-burst F-L5 / F-L5b,
 * hp-state F-N5): the burst ledger's `Target: X A% → B% (low L% at m:ss)`
 * line reads the `[STATE]` tick's sampler, so the rendered text must agree
 * with the ticks of the seconds its `Burst #` header prints.
 */

const ROSTER = [
  '  <unit id="1" name="Sangreene-ShadowCouncil-US" spec="Shadow Priest" role="log owner">',
  '  <unit id="4" name="Cloudz-LaughingSkull-US" spec="Marksmanship Hunter" role="enemy">',
];
const head = "  Burst #1 — 0:27–0:48 | Power Infusion + Voidform";
const target = (hp: string) =>
  `    Target: Cloudz-LaughingSkull-US ${hp} | your damage 0.52M`;
const state = (t: string, hp: number | "dead") =>
  `${t}  [STATE]   friends 1(SPriest):99 / enemies 4(MHunter):${hp}`;
const run = (...lines: string[]) =>
  checkBurstTargetHpConsistency([...ROSTER, ...lines]);

describe("checkBurstTargetHpConsistency", () => {
  it("endpoints equal the [STATE] ticks of the header's seconds → passes", () => {
    expect(
      run(head, target("95% → 69%"), state("0:27", 95), state("0:48", 69)),
    ).toEqual([]);
  });

  it("**regression** 537209d8: `95% → 62%` beside a [STATE] 69% at 0:48 → red", () => {
    const fails = run(head, target("95% → 62%"), state("0:48", 69));
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("终点 62% 而 0:48 [STATE] 报 69%");
  });

  it("a start value off the grid → red; a tick at another second is not compared", () => {
    expect(
      run(head, target("89% → 79%"), state("0:27", 35), state("0:48", 79))[0],
    ).toContain("起点 89% 而 0:27 [STATE] 报 35%");
    expect(run(head, target("95% → 69%"), state("0:26", 50))).toEqual([]);
  });

  it("a target dead at the end second prints 0", () => {
    expect(run(head, target("47% → 0%"), state("0:48", "dead"))).toEqual([]);
    expect(run(head, target("47% → 12%"), state("0:48", "dead"))[0]).toContain(
      "[STATE] 报 dead",
    );
  });

  it("a printed low must be a trough, sit inside the span, and be the lowest tick", () => {
    const ok = target("100% → 98% (low 37% at 0:34)");
    expect(run(head, ok, state("0:34", 37), state("0:40", 60))).toEqual([]);
    expect(
      run(head, target("100% → 98% (low 92% at 0:34)")).some((f) =>
        f.includes("不满足低谷判据"),
      ),
    ).toBe(true);
    expect(
      run(head, target("100% → 98% (low 37% at 0:50)")).some((f) =>
        f.includes("之外"),
      ),
    ).toBe(true);
    expect(run(head, ok, state("0:40", 30))[0]).toContain(
      "标注 low 37% 但 0:40 [STATE] 报 30%",
    );
  });

  it("no low printed: a tick 10+ points under both endpoints inside the span → red; 9 under passes", () => {
    expect(run(head, target("100% → 100%"), state("0:34", 37))[0]).toContain(
      "未标注低谷,但 0:34 [STATE] 报 37%",
    );
    expect(run(head, target("100% → 70%"), state("0:34", 61))).toEqual([]);
    // outside the span is not this burst's business
    expect(run(head, target("100% → 100%"), state("0:50", 37))).toEqual([]);
  });

  it("a start reading other than 0 at a second the target's tick reads dead fails", () => {
    const out = run(head, target("95% → 0%"), state("0:27", "dead"));
    expect(
      out.some((f) => f.includes("起点 95% 而 0:27 [STATE] 报 dead")),
    ).toBe(true);
    expect(run(head, target("0% → 0%"), state("0:27", "dead"))).toEqual([]);
  });

  it("a low printed at a second the target's tick reads dead fails", () => {
    const out = run(
      head,
      target("100% → 98% (low 37% at 0:34)"),
      state("0:34", "dead"),
    );
    expect(out.some((f) => f.includes("该秒 [STATE] 报 dead"))).toBe(true);
  });

  it("a low printed at the wrong second fails even when no tick reads below it", () => {
    const out = run(
      head,
      target("100% → 98% (low 37% at 0:34)"),
      state("0:27", 100),
      state("0:34", 60),
      state("0:40", 37),
      state("0:48", 98),
    );
    expect(out.some((f) => f.includes("该秒 [STATE] 报 60%"))).toBe(true);
  });

  it("finds the burst's Target line past a line in between, and never borrows the next burst's", () => {
    const between = "    (a context line some later change puts here)";
    expect(
      run(head, between, target("95% → 62%"), state("0:48", 69))[0],
    ).toContain("终点 62% 而 0:48 [STATE] 报 69%");
    // burst #1 has no Target line: burst #2's line is judged on #2's seconds
    const head2 = "  Burst #2 — 1:10–1:20 | Voidform";
    expect(run(head, head2, target("95% → 62%"), state("0:48", 69))).toEqual(
      [],
    );
    expect(
      run(head, head2, target("95% → 62%"), state("1:20", 69))[0],
    ).toContain("终点 62% 而 1:20 [STATE] 报 69%");
  });

  it("a target the roster does not name, or a Target line without HP, is not checked", () => {
    expect(
      checkBurstTargetHpConsistency([
        head,
        target("95% → 62%"),
        state("0:48", 69),
      ]),
    ).toEqual([]);
    expect(
      run(
        head,
        "    Target: Cloudz-LaughingSkull-US | your damage 0.52M",
        state("0:48", 69),
      ),
    ).toEqual([]);
  });
});
