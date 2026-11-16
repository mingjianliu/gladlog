/**
 * scan5 `ledgerPressedNoPress` (T49; T114 batch review 80-PIPE-94-B82): the
 * ledger's `pressed Zs before the burst opened` places the press Z seconds
 * ahead of the burst's start, `after` Z seconds into it.
 */
import { describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t49";

const START = 1_000_000;
const target = { id: "T", name: "Tgt" };
const dk = { id: "D", name: "Dk" };

function scan(noPressAt: string, phrase: string) {
  let checked = 0;
  const kinds: string[] = [];
  run({
    lines: [
      `${noPressAt}  [ENEMY DEF]   5(Dk) (Unholy Death Knight): Anti-Magic Zone → 6(Tgt) (5s) [no press logged]`,
      "  Burst #1 — 0:10 (8s)",
      "  Target: Tgt 90% → 40%",
      `  Target had a major defensive up: Anti-Magic Zone active ON THE TARGET 2.0s of this burst (pressed ${phrase} the burst opened)`,
    ],
    start: START,
    units: [target, dk],
    unitOfPid: (pid: string | undefined) =>
      pid === "6" ? target : pid === "5" ? dk : undefined,
    bump: () => checked++,
    violate: (_c: string, k: string) => kinds.push(k),
  } as unknown as Parameters<typeof run>[0]);
  return { checked, kinds };
}

describe("ledgerPressedNoPress — the press's direction", () => {
  it("`1.0s before` (press 0:09): a [no press logged] row at 0:09 is a violation, one at 0:11 is not", () => {
    expect(scan("0:09", "1.0s before")).toEqual({
      checked: 1,
      kinds: ["Anti-Magic Zone"],
    });
    expect(scan("0:11", "1.0s before")).toEqual({ checked: 1, kinds: [] });
  });
  it("`1.0s after` (press 0:11): the row at 0:11 is a violation, 0:09 is not", () => {
    expect(scan("0:11", "1.0s after")).toEqual({
      checked: 1,
      kinds: ["Anti-Magic Zone"],
    });
    expect(scan("0:09", "1.0s after")).toEqual({ checked: 1, kinds: [] });
  });
});
