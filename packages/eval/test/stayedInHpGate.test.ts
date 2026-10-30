import { gridHpPct } from "@gladlog/analysis/src/utils/cooldowns";
import {
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
  STAYED_IN_NEAR_DEATH_PCT,
} from "@gladlog/analysis/src/utils/positionAnalysis";
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { checkStayedInHpConsistency } from "../src/quality/promptQualityCheck";

/**
 * FT-T03 (user ruling 2026-10-10, D7): the POSITIONING `STAYED IN` line's
 * `your HP A%→B% (min over window)` prints a TROUGH — the true minimum of the
 * log owner's HP inside the span — so no `[STATE]` tick of the owner inside
 * the span may read below B, and the tag must be true of B. The line had no
 * gate before the ruling.
 *
 * 2026-10-11: the window is the one the line prints — its first displayed
 * second included — and A is that second's `[STATE]` tick.
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

describe("checkStayedInHpConsistency — a span that ends on the owner's death second reads 0", () => {
  it("passes 0% under a `dead` tick at the span's last second; fails any other minimum", () => {
    expect(
      run(
        state("0:54", 90),
        state("1:00", 60),
        state("1:04", "dead"),
        stay("90%→0%", COSTLY),
      ),
    ).toEqual([]);
    const out = run(
      state("0:54", 90),
      state("1:00", 60),
      state("1:04", "dead"),
      stay("90%→60%", ABOVE),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("dead");
  });
});

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

  it("only the owner's ticks, and only inside the span", () => {
    expect(
      run(
        // a teammate at 10 %: not the owner's number
        state("0:58", 90, 10),
        // outside the span
        state("0:53", 20),
        state("1:05", 20),
        // dead is not a number
        state("1:02", "dead"),
        stay("98%→70%", ABOVE),
      ),
    ).toEqual([]);
  });

  it("the span's first displayed second is part of the window: its tick is the start reading, and is not below the minimum", () => {
    // the tick of 0:54 IS the line's start
    expect(run(state("0:54", 98), stay("98%→70%", ABOVE))).toEqual([]);
    expect(run(state("0:54", 30), stay("30%→12%", COSTLY))).toEqual([]);
    // a start read at another instant than the tick of its second
    const off = run(state("0:54", 91), stay("96%→70%", ABOVE));
    expect(off).toHaveLength(1);
    expect(off[0]).toContain("起点写 96%,但 0:54 的 [STATE] 报 91%");
    // a minimum above the tick of the start second (the pre-2026-10-11
    // producer: the window read from its fractional start, the gate from the
    // next second) → red on both counts
    const hidden = run(state("0:54", 30), stay("98%→70%", ABOVE));
    expect(hidden).toHaveLength(2);
    expect(hidden.join("\n")).toContain("起点写 98%,但 0:54 的 [STATE] 报 30%");
    expect(hidden.join("\n")).toContain(
      "窗口最低写 70%,但 0:54 的 [STATE] 报 30%",
    );
    // the owner at full HP has no token on the tick: nothing to compare
    expect(
      run(
        "0:54  [STATE]   friends 2(DPriest):80 / enemies 4(UDKnight):80",
        stay("100%→70%", ABOVE),
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

describe("producer → gate: the line `computeOwnerPositionEvents` prints passes on the [STATE] ticks of the same unit (2026-10-11)", () => {
  // The owner stands 3 yd from an enemy through a burst span 10.4 → 20.4; a
  // sample every half second, HP from `hpAt`. The line prints 0:10–0:20.
  const T0 = 1_000_000;
  const mk = (
    id: string,
    name: string,
    x: number,
    hpAt: (s: number) => number,
  ) => {
    const advancedActions = [];
    for (let ms = 0; ms <= 60_000; ms += 500)
      advancedActions.push({
        timestamp: T0 + ms,
        logLine: { timestamp: T0 + ms },
        advancedActorId: id,
        advancedActorCurrentHp: hpAt(ms / 1000),
        advancedActorMaxHp: 100,
        advancedActorPositionX: x,
        advancedActorPositionY: 0,
        advancedActorPowers: [],
      });
    return {
      id,
      name,
      spec: CombatUnitSpec.Paladin_Holy,
      advancedActions,
      deathRecords: [],
      damageOut: [],
      damageIn: [],
    };
  };
  const prompt = (hpAt: (s: number) => number) => {
    const owner = mk("o", "Sax-R-US", 0, hpAt);
    const events = computeOwnerPositionEvents({
      owner: owner as never,
      enemies: [mk("e1", "Dk-R-US", 3, () => 100)] as never,
      combat: { startTime: T0, endTime: T0 + 60_000 } as never,
      burstWindows: [
        {
          fromSeconds: 10.4,
          toSeconds: 20.4,
          activeCDs: [],
          threatScore: 1,
          threatLabel: "High",
          dangerScore: 1,
          dangerLabel: "High",
          dampeningPct: 0,
          damageInWindow: 0,
          damageRatio: 0,
          healerCCed: false,
        },
      ] as never,
      ownerCooldowns: [],
      isHealer: true,
      ownerIsMelee: false,
    }).filter((e) => e.type === "STAYED_IN");
    const line = formatPositionEventsForContext(events).find((l) =>
      l.includes(" burst] "),
    )!;
    // the [STATE] tick of every second 0:08–0:22, from the tick's own sampler
    const ticks = [];
    for (let s = 8; s <= 22; s++) {
      const pct = gridHpPct(owner as never, T0 + s * 1000)!;
      if (pct < 100) ticks.push(state(`0:${String(s).padStart(2, "0")}`, pct));
    }
    return { line, ticks };
  };

  it("review scenario — 5 % on the tick of 0:10, the span opening at 10.4 s: the line's start and minimum are that tick", () => {
    const { line, ticks } = prompt((s) => (s === 10 ? 5 : s >= 15 ? 60 : 90));
    expect(line).toContain("0:10–0:20 [High burst]");
    expect(line).toContain(
      "your HP 5%→5% (min over window) (near-death — the stay was costly)",
    );
    expect(ticks).toContain(state("0:10", 5));
    expect(run(...ticks, line)).toEqual([]);
    // mutation: the line the producer printed until then for these ticks —
    // start read at 10.4 s (90 %), minimum from 0:11 on (60 %)
    const before = line.replace(
      "your HP 5%→5% (min over window) (near-death — the stay was costly)",
      `your HP 90%→60% (min over window)${ABOVE}`,
    );
    const f = run(...ticks, before);
    expect(f.join("\n")).toContain("起点写 90%,但 0:10 的 [STATE] 报 5%");
    expect(f.join("\n")).toContain("窗口最低写 60%,但 0:10 的 [STATE] 报 5%");
  });

  it("a dip between two ticks, and a plain fall: the produced line passes", () => {
    for (const hpAt of [
      (s: number) => (s === 15.5 ? 20 : s >= 15 ? 60 : 90),
      (s: number) => Math.max(10, 95 - Math.floor(s) * 4),
      (s: number) => (s < 10.5 ? 90 : 70),
    ]) {
      const { line, ticks } = prompt(hpAt);
      expect(line).toContain("(min over window)");
      expect(run(...ticks, line)).toEqual([]);
    }
  });
});
