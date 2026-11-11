/**
 * scan5/t52: the owner's kick the log refused while its target's cast bar
 * was running must not read `hit nothing`. The shape is bd7f386f 0:43 —
 * Polymorph begun 42.58, Mind Freeze 43.39 logged IMMUNE, the Polymorph off
 * at 43.74.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t52";

const START = 1_000_000;
const at = (s: number) => START + s * 1000;
const MIND_FREEZE = "47528";
const POLYMORPH = "118";

type Ctx = Parameters<typeof run>[0];

function scan(
  lines: string[],
  polymorphOffS: number | number[] | null,
  order: { startLine: number; firstOffLine: number } | null = null,
): { checked: Record<string, number>; seen: string[] } {
  const seen: string[] = [];
  const checked: Record<string, number> = {};
  const owner = makeUnit("p1", {
    name: "Knight",
    info: {},
    spellCastEvents: [
      makeSpellCastEvent(
        MIND_FREEZE,
        at(43.391),
        "e1",
        "Mage",
        "p1",
        "Knight",
        0,
        "Mind Freeze",
      ),
    ],
  } as never);
  const begun = makeSpellCastEvent(
    POLYMORPH,
    at(42.581),
    "p9",
    "Healer",
    "e1",
    "Mage",
    0,
    "Polymorph",
  );
  begun.logLine.event = LogEvent.SPELL_CAST_START;
  if (order) begun.logLine.lineIndex = order.startLine;
  const mage = makeUnit("e1", {
    name: "Mage",
    info: {},
    castStartEvents: [begun],
    spellCastEvents: (polymorphOffS === null ? [] : [polymorphOffS].flat()).map(
      (offS, i) => {
        const e = makeSpellCastEvent(
          POLYMORPH,
          at(offS),
          "p9",
          "Healer",
          "e1",
          "Mage",
          0,
          "Polymorph",
        );
        if (order && i === 0) e.logLine.lineIndex = order.firstOffLine;
        return e;
      },
    ),
  } as never);
  run({
    owner,
    units: [owner, mage],
    start: START,
    lines,
    text: lines.join("\n"),
    unitOfPid: (pid: string | undefined) => (pid === "5" ? mage : undefined),
    violate: (check: string, kind: string, _t: number, _f: string, d: string) =>
      seen.push(`${check}|${kind}: ${d}`),
    bump: (c: string, n = 1) => {
      checked[c] = (checked[c] ?? 0) + n;
    },
  } as unknown as Ctx);
  return { checked, seen };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t52 — a kick refused at a live cast", () => {
  const OLD =
    "0:43  [KICK]   your Mind Freeze on 5(FMage) — hit nothing [IMMUNE: 5(FMage)]";
  const NEW =
    "0:43  [KICK]   your Mind Freeze on 5(FMage) — [IMMUNE: 5(FMage)]";

  it("the old line is a violation, with the ledger's row when it says the same", () => {
    const r = scan(
      ["  Kicks: 0:43 Mind Freeze → hit nothing [IMMUNE: Mage]", OLD],
      43.744,
    );
    expect(r.checked).toEqual({ refusedKickLiveCast: 1 });
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toContain("refusedKickLiveCast|IMMUNE +ledger: ");
    expect(r.seen[0]).toContain("Polymorph begun 42.58");
    expect(scan([OLD], 43.744).seen[0]).toContain("|IMMUNE: ");
  });

  it("the tag-only line is counted and passes", () => {
    expect(scan([NEW], 43.744)).toEqual({
      checked: { refusedKickLiveCast: 1 },
      seen: [],
    });
  });

  it("`hit nothing` stays right when the bar had gone off before the kick, or never went off", () => {
    expect(scan([OLD], 43.2).seen).toEqual([]);
    expect(scan([OLD], null).seen).toEqual([]);
  });

  it("an instant-made cast (START and SUCCESS in one ms) was over before the kick, whatever went off later", () => {
    expect(scan([OLD], [42.581, 43.744]).seen).toEqual([]);
  });

  it("codex #7: the ledger's row is checked on its own — a right timeline line beside a wrong Kicks: row", () => {
    const r = scan(
      ["  Kicks: 0:43 Mind Freeze → hit nothing [IMMUNE: Mage]", NEW],
      43.744,
    );
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toContain("refusedKickLiveCast|IMMUNE ledger only: ");
  });

  it("codex #6: a SUCCESS of the START's millisecond logged before it is the previous cast's, not this bar's end", () => {
    // chained casts: Polymorph off 42.581 (line 999), the next one begun
    // 42.581 (line 1000) and off 43.744 — running at the kick
    const r = scan([OLD], [42.581, 43.744], {
      startLine: 1000,
      firstOffLine: 999,
    });
    expect(r.seen).toHaveLength(1);
  });

  it("a line with no miss tag is not this check's", () => {
    expect(
      scan(
        ["0:43  [KICK]   your Mind Freeze on 5(FMage) — hit nothing"],
        43.744,
      ),
    ).toEqual({ checked: {}, seen: [] });
  });
});
