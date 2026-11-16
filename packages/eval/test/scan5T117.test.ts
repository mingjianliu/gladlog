/**
 * scan5 `rejectRunUndercount` (T117, codex 85-tk-L-T117-1 #2): two lines of
 * one spell and reason are two runs, so a second line is judged against its
 * own run, never the first one again.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t117";

const f = (tSeconds: number, reason: string, spellId = 6789) => ({
  tSeconds,
  unitGuid: "Player-O",
  spellId,
  spellName: "Mortal Coil",
  reason,
});

function scan(lines: string[], rows: ReturnType<typeof f>[]): string[] {
  const out: string[] = [];
  run({
    owner: { id: "Player-O", reaction: 1 },
    players: [],
    lines,
    start: 0,
    rawStreams: () => ({ castFailed: rows }),
    bump: () => {},
    violate: (_c: string, _k: string, _t: number, id: string) => out.push(id),
  } as never);
  return out;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 rejectRunUndercount", () => {
  const R = "Out of range";
  // five range refusals, the spell not ready, three more: ×5 and ×3
  const rows = [10, 10.1, 10.2, 10.3, 10.4]
    .map((t) => f(t, R))
    .concat(
      [f(10.5, "Not yet recovered")],
      [10.6, 10.7, 10.8].map((t) => f(t, R)),
    );
  const line = (n: number) =>
    `0:10  [REJECTED] your Mortal Coil ×${n} — out of range`;

  it("judges each line against its own run", () => {
    expect(scan([line(5), line(3)], rows)).toEqual([]);
  });

  it("still flags a line below its run", () => {
    expect(scan([line(4), line(3)], rows)).toEqual(["Mortal Coil:0:10"]);
  });

  // codex 85-tk-L-T117-1b #2: a range row stepped over inside an open LoS
  // run starts no range run — the line's ×3 is right
  it("walks every reason together", () => {
    const L = "Target not in line of sight";
    const mixed = [
      f(10, L),
      f(10.1, R),
      f(10.2, L),
      f(10.3, R),
      f(10.4, R),
      f(10.5, R),
    ];
    expect(scan([line(3)], mixed)).toEqual([]);
  });

  // #3: an unprinted singleton takes no line — a ×3 for a ×4 run is caught
  it("matches printed runs only", () => {
    const rows2 = [f(10, R), f(10.1, "Not yet recovered")].concat(
      [10.2, 10.3, 10.4, 10.5].map((t) => f(t, R)),
    );
    expect(scan([line(4)], rows2)).toEqual([]);
    expect(scan([line(3)], rows2)).toEqual(["Mortal Coil:0:10"]);
  });

  // codex 85-tk-L-T117-1c: two ids of one name interleaved are two runs
  it("builds runs per spell id", () => {
    const two = [10, 10.2, 10.4]
      .map((t) => f(t, R, 9_990_001))
      .concat([10.1, 10.3, 10.5].map((t) => f(t, R, 9_990_002)));
    expect(scan([line(3), line(3)], two)).toEqual([]);
  });

  // codex 85-tk-L-T117-1d: runs of two ids in one second keep their exact
  // start order (×3, ×4, ×5)
  it("orders runs by their exact start", () => {
    const rows3 = [10, 10.01, 10.02]
      .map((t) => f(t, R, 9_990_001))
      .concat(
        [f(10.03, "Not yet recovered", 9_990_001)],
        [10.2, 10.21, 10.22, 10.23, 10.24].map((t) => f(t, R, 9_990_001)),
        [10.1, 10.11, 10.12, 10.13].map((t) => f(t, R, 9_990_002)),
      )
      .sort((a, b) => a.tSeconds - b.tSeconds);
    expect(scan([line(3), line(4), line(5)], rows3)).toEqual([]);
  });

  // codex 85-tk-L-T117-1e: two runs starting together, printed in the
  // product's flush order
  it("matches runs that start together whatever their order", () => {
    const A = 9_990_001;
    const B = 9_990_002;
    const tie = [10, 10.1, 10.2]
      .map((t) => f(t, R, A))
      .concat(
        [10, 10.1, 10.2, 10.3].map((t) => f(t, R, B)),
        [f(10.4, "Not yet recovered", B)],
      )
      .sort((a, b) => a.tSeconds - b.tSeconds);
    expect(scan([line(4), line(3)], tie)).toEqual([]);
    expect(scan([line(3), line(2)], tie)).toEqual(["Mortal Coil:0:10"]);
  });
});
