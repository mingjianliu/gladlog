/**
 * T141 (round-14 D21; user ruling R57, 2026-11-18): a `[PRESS]` line's
 * `lasts Ns` for a one-holder effect the log shows dispelled, broken or
 * stolen before then says what ended it — `lasts 19s — stolen at 0:30`. A
 * debuff on several units with one copy dispelled is not written.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { emitOffListPressEntries } from "../src/context/timelineSections/offListPress";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  type IOffListPress,
  pressDuration,
  pressEffectCutShort,
} from "../src/utils/offListPress";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const GRACE = "79206"; // Spiritwalker's Grace, 15 s
const { SPELL_AURA_APPLIED: APPLIED, SPELL_AURA_REMOVED: REMOVED } = LogEvent;

/** a dispel / steal row naming `aura`, as it sits in the holder's actionIn */
const took = (event: LogEvent, aura: string, ms: number) =>
  ({
    logLine: { event, timestamp: ms, parameters: [] },
    timestamp: ms,
    spellId: "30449",
    extraSpellId: aura,
    srcUnitId: "foe",
    destUnitId: "sh",
  }) as never;

function shaman(
  removedAt: number,
  actionIn: unknown[] = [],
  extra: unknown[] = [],
) {
  const cast = makeSpellCastEvent(GRACE, T, "sh", "Sh", "sh", "Sh");
  const sh = makeUnit("sh", {
    name: "Sh",
    spellCastEvents: [cast],
    auraEvents: [
      makeAuraEvent(APPLIED, GRACE, T, "sh", "sh", "BUFF"),
      ...(extra as never[]),
      makeAuraEvent(REMOVED, GRACE, T + removedAt, "sh", "sh", "BUFF"),
    ],
    actionIn: actionIn as never,
  });
  const dur = pressDuration(sh, cast as never, [sh], sh.spellCastEvents)!;
  return {
    sh,
    cast,
    dur,
    cut: pressEffectCutShort(dur, sh, cast as never, [sh], sh.spellCastEvents),
  };
}

describe("pressEffectCutShort (T141, ruling R57)", () => {
  it("stolen 9.1 s into 15 s: the steal row names it", () => {
    const r = shaman(9_100, [took(LogEvent.SPELL_STOLEN, GRACE, T + 9_100)]);
    expect(r.dur.durationSeconds).toBe(15);
    expect(r.cut).toEqual({ cause: "stolen", atMs: T + 9_100 });
  });

  it("dispelled: a SPELL_DISPEL naming it within 50 ms of the REMOVED", () => {
    expect(
      shaman(4_000, [took(LogEvent.SPELL_DISPEL, GRACE, T + 4_030)]).cut,
    ).toEqual({ cause: "dispelled", atMs: T + 4_000 });
    // 51 ms away, or naming another aura: no cause row
    expect(
      shaman(4_000, [took(LogEvent.SPELL_DISPEL, GRACE, T + 4_051)]).cut,
    ).toBeUndefined();
    expect(
      shaman(4_000, [took(LogEvent.SPELL_DISPEL, "1", T + 4_000)]).cut,
    ).toBeUndefined();
  });

  it("broken: a BROKEN row of the aura", () => {
    const r = shaman(
      6_000,
      [],
      [
        makeAuraEvent(
          LogEvent.SPELL_AURA_BROKEN_SPELL,
          GRACE,
          T + 6_000,
          "sh",
          "sh",
          "BUFF",
        ),
      ],
    );
    expect(r.cut).toEqual({ cause: "broken", atMs: T + 6_000 });
  });

  it("a plain REMOVED, or one inside the 'ran its length' allowance: nothing", () => {
    expect(shaman(5_000).cut).toBeUndefined();
    expect(
      shaman(14_900, [took(LogEvent.SPELL_DISPEL, GRACE, T + 14_900)]).cut,
    ).toBeUndefined();
  });

  it("past the round's end: nothing", () => {
    const r = shaman(9_100, [took(LogEvent.SPELL_STOLEN, GRACE, T + 9_100)]);
    expect(
      pressEffectCutShort(
        r.dur,
        r.sh,
        r.cast as never,
        [r.sh],
        r.sh.spellCastEvents,
        T + 9_000,
      ),
    ).toBeUndefined();
  });

  it("a copy on a second unit: not a one-holder effect, not written", () => {
    const cast = makeSpellCastEvent(GRACE, T, "sh", "Sh", "sh", "Sh");
    const sh = makeUnit("sh", {
      name: "Sh",
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(APPLIED, GRACE, T, "sh", "sh", "BUFF"),
        makeAuraEvent(REMOVED, GRACE, T + 4_000, "sh", "sh", "BUFF"),
      ],
      actionIn: [took(LogEvent.SPELL_DISPEL, GRACE, T + 4_000)],
    });
    const mate = makeUnit("mate", {
      auraEvents: [makeAuraEvent(APPLIED, GRACE, T, "sh", "mate", "BUFF")],
    });
    const dur = pressDuration(
      sh,
      cast as never,
      [sh, mate],
      sh.spellCastEvents,
    )!;
    expect(
      pressEffectCutShort(
        dur,
        sh,
        cast as never,
        [sh, mate],
        sh.spellCastEvents,
      ),
    ).toBeUndefined();
  });
});

describe("[PRESS] line — the ending clause", () => {
  const owner = makeUnit("sh", { name: "Sh" });
  const line = (p: Partial<IOffListPress>): string => {
    const lines: string[] = [];
    emitOffListPressEntries({
      owner,
      friends: [owner],
      pid: () => "1(EShaman)",
      enemyPid: () => "?",
      addEntry: (_t: number, l: string) => {
        lines.push(l);
        return true;
      },
      entries: [],
      presses: [
        {
          unit: owner,
          spellId: GRACE,
          timeSeconds: 21.2,
          cooldownSeconds: 120,
          charges: 1,
          readyAgainAtSeconds: 141.2,
          durationSeconds: 19,
          ...p,
        } as IOffListPress,
      ],
    } as unknown as Parameters<typeof emitOffListPressEntries>[0]);
    return lines.join("\n");
  };

  it("the ruling's example", () => {
    expect(line({ cutShort: { cause: "stolen", atSeconds: 30.3 } })).toContain(
      "Spiritwalker's Grace (lasts 19s — stolen at 0:30, 120s cd, back 2:21)",
    );
  });
  it("nothing named: the line as before", () => {
    expect(line({})).toContain(
      "Spiritwalker's Grace (lasts 19s, 120s cd, back 2:21)",
    );
  });
});
