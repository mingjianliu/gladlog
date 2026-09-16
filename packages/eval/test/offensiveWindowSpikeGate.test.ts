import { describe, expect, it } from "vitest";

import { checkOffensiveWindowSpikeMarker } from "../src/quality/promptQualityCheck";

describe("checkOffensiveWindowSpikeMarker", () => {
  it("passes when the required marker matches placement on the render grid", () => {
    const lines = [
      // inside: no marker
      "0:12  [OFFENSIVE WINDOW]   0:12–0:29 | peak spike 1.75M on 3(BDruid) (Balance Druid) over 0:14–0:24 | CDs: Trueshot@0:12",
      // runs-past: (runs past window)
      "0:42  [OFFENSIVE WINDOW]   0:42–1:03 | peak spike 1.30M on 3(EShaman) (Enhancement Shaman) over 0:44–1:05 (runs past window) | CDs: Avatar@0:42",
      // after: (lands after window)
      "1:15  [OFFENSIVE WINDOW]   1:15–1:35 | peak spike 1.03M on 3(EShaman) (Enhancement Shaman) over 1:37–1:47 (lands after window) | CDs: Avatar@1:15",
    ];
    expect(checkOffensiveWindowSpikeMarker(lines)).toEqual([]);
  });

  it("fails when a marker is missing on a line whose spike ends after the window", () => {
    const lines = [
      "1:15  [OFFENSIVE WINDOW]   1:15–1:35 | peak spike 1.03M on 3(EShaman) (Enhancement Shaman) over 1:37–1:47 | CDs: Avatar@1:15",
    ];
    const fails = checkOffensiveWindowSpikeMarker(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("缺少标注 (lands after window)");
  });

  it("fails when the wrong marker is present", () => {
    const lines = [
      // spike is fully after (1:37 >= 1:35), but marked (runs past window)
      "1:15  [OFFENSIVE WINDOW]   1:15–1:35 | peak spike 1.03M on 3(EShaman) (Enhancement Shaman) over 1:37–1:47 (runs past window) | CDs: Avatar@1:15",
    ];
    const fails = checkOffensiveWindowSpikeMarker(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("标注应为 (lands after window),实为 (runs past window)");
  });

  it("fails when a spurious marker is present on an inside spike", () => {
    const lines = [
      // spike is inside (0:24 <= 0:29), but carries a marker
      "0:12  [OFFENSIVE WINDOW]   0:12–0:29 | peak spike 1.75M on 3(BDruid) (Balance Druid) over 0:14–0:24 (lands after window) | CDs: Trueshot@0:12",
    ];
    const fails = checkOffensiveWindowSpikeMarker(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("line 1");
    expect(fails[0]).toContain("不应有标注 (lands after window)");
  });
});
