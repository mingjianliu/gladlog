import { STAYED_IN_NEAR_DEATH_PCT } from "@gladlog/analysis/src/utils/positionAnalysis";
import { describe, expect, it } from "vitest";

import { checkStayedInHpConsistency } from "../src/quality/promptQualityCheck";

/**
 * FT-T03 (user ruling 2026-10-10, D7): the POSITIONING `STAYED IN` line's
 * `your HP A%→B% (min over window)` prints a TROUGH — the true minimum of the
 * log owner's HP inside the span — so no `[STATE]` tick of the owner inside
 * the span may read below B, and the tag must be true of B. The line had no
 * gate before the ruling.
 */
const ROSTER = [
  '  <unit id="1" name="Sax-R-US" spec="Beast Mastery Hunter" role="log owner">',
  '  <unit id="2" name="Mate-R-US" spec="Discipline Priest" role="teammate">',
  '  <unit id="4" name="Dk-R-US" spec="Unholy Death Knight" role="enemy">',
];
const stay = (hp: string, tag = "") =>
  `    0:54–1:04 [Critical burst] 2.8→5.7yd from Dk-R-US — you moved 21.7 yd yourself (span start→end) — you were the burst target — your HP ${hp} (min over window)${tag} — a defensive CD was available`;
const ABOVE = ` (HP stayed at or above ${STAYED_IN_NEAR_DEATH_PCT}%)`;
const COSTLY = " (near-death — the stay was costly)";
const state = (t: string, owner: number | "dead", mate = 99) =>
  `${t}  [STATE]   friends 1(BMHunter):${owner} 2(DPriest):${mate} / enemies 4(UDKnight):80`;
const run = (...lines: string[]) =>
  checkStayedInHpConsistency([...ROSTER, ...lines]);

describe("checkStayedInHpConsistency (FT-T03 — STAYED IN's window minimum is a trough)", () => {
  it("a minimum below every owner tick of the span → passes", () => {
    expect(
      run(
        state("0:54", 98),
        state("0:58", 72),
        state("1:01", 45),
        state("1:04", 80),
        stay("98%→12%", COSTLY),
      ),
    ).toEqual([]);
  });

  it("an owner tick inside the span below the printed minimum → red", () => {
    const f = run(state("0:58", 40), stay("98%→70%", ABOVE));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("窗口最低写 70%,但 0:58 的 [STATE] 报 40%");
  });

  it("only the owner's ticks, only inside the span, and not its first displayed second", () => {
    expect(
      run(
        // a teammate at 10 %: not the owner's number
        state("0:58", 90, 10),
        // the span's first second: the window opens on a fractional instant
        state("0:54", 30),
        // outside the span
        state("0:50", 20),
        state("1:05", 20),
        // dead is not a number
        state("1:02", "dead"),
        stay("98%→70%", ABOVE),
      ),
    ).toEqual([]);
  });

  it("`(HP stayed at or above N%)` must be true of the printed minimum, with the renderer's own N", () => {
    expect(run(stay("90%→20%", ABOVE))[0]).toContain("但窗口最低 20%");
    expect(run(stay("90%→70%", " (HP stayed at or above 40%)"))[0]).toContain(
      "与判据常量",
    );
    // the ruling's mixed case prints no tag at all: ticks at or above the
    // line, the trough under it
    expect(run(stay("90%→20%"))).toEqual([]);
  });

  it("`near-death` beside a minimum at or above the line → red (the trough is never above the minimum that decided)", () => {
    expect(run(stay("90%→35%", COSTLY))[0]).toContain("near-death");
    expect(run(stay("90%→34%", COSTLY))).toEqual([]);
  });

  it("a minimum above the start reading → red; no `log owner` in the roster → ticks are not judged", () => {
    expect(run(stay("60%→70%", ABOVE))[0]).toContain("高于起点");
    expect(
      checkStayedInHpConsistency([state("0:58", 40), stay("98%→70%", ABOVE)]),
    ).toEqual([]);
  });

  it("a line with no span or no HP clause is out of scope", () => {
    expect(
      run(
        state("0:58", 40),
        "    0:54 [Critical burst] 2.8→5.7yd from Dk-R-US — your HP 98%→70% (min over window)",
        "    0:54–1:04 [Critical burst] 2.8→5.7yd from Dk-R-US (high dampening — staying in may be correct)",
      ),
    ).toEqual([]);
  });
});
