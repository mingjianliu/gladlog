import { logLineInstantMs } from "../src/l1/statedInstant";
import { parseTimestamp } from "../src/l1/timestamp";

// Real date parts of the 12.1 archive (2026-10-11 scan; the grammar and its
// counts are in statedInstant.ts's header).
const US_EASTERN = "8/18/2026 18:56:32.167-4";
const OCEANIC = "8/18/2026 18:56:32.16710"; // file 097c4ae3: .167 and +10
const CENTRAL_EUROPE = "8/17/2026 21:29:36.8332"; // file 61fc7e40: .833 and +2
const KOREA = "8/17/2026 23:58:29.2909"; // file c67114fb: .290 and +9
const NEW_ZEALAND = "8/17/2026 17:53:15.74712"; // file f0a10402: .747 and +12
const HAWAII = "8/20/2026 09:14:03.512-10";

describe("logLineInstantMs: the instant a line states for itself", () => {
  it("a signed offset (west of UTC) is the wall clock minus it — parseTimestamp's own reading, whatever zone the parser is given", () => {
    expect(logLineInstantMs(US_EASTERN)).toBe(
      Date.UTC(2026, 7, 18, 22, 56, 32, 167),
    );
    expect(logLineInstantMs(HAWAII)).toBe(
      Date.UTC(2026, 7, 20, 19, 14, 3, 512),
    );
    for (const timezone of ["UTC", "Australia/Sydney", "America/New_York"]) {
      expect(logLineInstantMs(US_EASTERN)).toBe(
        parseTimestamp(US_EASTERN, { timezone }),
      );
      expect(logLineInstantMs(HAWAII)).toBe(
        parseTimestamp(HAWAII, { timezone }),
      );
    }
  });

  it("an offset written without a sign is EAST of UTC: three millisecond digits, then one or two digits of hours", () => {
    // local 18:56:32 on 8/18 at +10 is 08:56:32 UTC
    expect(logLineInstantMs(OCEANIC)).toBe(
      Date.UTC(2026, 7, 18, 8, 56, 32, 167),
    );
    expect(logLineInstantMs(CENTRAL_EUROPE)).toBe(
      Date.UTC(2026, 7, 17, 19, 29, 36, 833),
    );
    expect(logLineInstantMs(KOREA)).toBe(
      Date.UTC(2026, 7, 17, 14, 58, 29, 290),
    );
    expect(logLineInstantMs(NEW_ZEALAND)).toBe(
      Date.UTC(2026, 7, 17, 5, 53, 15, 747),
    );
    // +0 was never seen in the archive; written the same way it is UTC
    expect(logLineInstantMs("8/18/2026 18:56:32.1670")).toBe(
      Date.UTC(2026, 7, 18, 18, 56, 32, 167),
    );
    // the largest offset a zone has
    expect(logLineInstantMs("8/18/2026 18:56:32.16714")).toBe(
      Date.UTC(2026, 7, 18, 4, 56, 32, 167),
    );
  });

  it("the unsigned reading is the signed branch with the sign written in — one reader, no second date grammar", () => {
    for (const timezone of ["UTC", "America/New_York"]) {
      expect(logLineInstantMs(OCEANIC)).toBe(
        parseTimestamp("8/18/2026 18:56:32.167+10", { timezone }),
      );
      expect(logLineInstantMs(CENTRAL_EUROPE)).toBe(
        parseTimestamp("8/17/2026 21:29:36.833+2", { timezone }),
      );
    }
  });

  it("a line that states no offset has no stated instant", () => {
    expect(logLineInstantMs("8/18/2026 18:56:32.167")).toBeNull();
    expect(logLineInstantMs("8/18/2026 18:56:32.16")).toBeNull();
    expect(logLineInstantMs("8/18/2026 18:56:32.1")).toBeNull();
  });

  it("a half hour: a signed one is parseTimestamp's reading; an unsigned one is not a shape the game writes (Adelaide, +9:30, is written `9`)", () => {
    expect(logLineInstantMs("6/30/2026 12:00:00.000+5.5")).toBe(
      Date.UTC(2026, 5, 30, 6, 30, 0, 0),
    );
    expect(logLineInstantMs("6/30/2026 12:00:00.000-3.5")).toBe(
      Date.UTC(2026, 5, 30, 15, 30, 0, 0),
    );
    expect(logLineInstantMs("6/30/2026 12:00:00.0005.5")).toBeNull();
    // an Adelaide line: the stated instant is 9 h behind the wall clock —
    // half an hour later than the machine that recorded it reads it
    const adelaide = "8/18/2026 23:06:19.1569";
    expect(logLineInstantMs(adelaide)).toBe(
      Date.UTC(2026, 7, 18, 14, 6, 19, 156),
    );
    expect(
      logLineInstantMs(adelaide)! -
        parseTimestamp(adelaide, { timezone: "Australia/Adelaide" })!,
    ).toBe(30 * 60_000);
  });

  it("what follows the milliseconds and is not an offset, or a malformed date, is null", () => {
    expect(logLineInstantMs("8/18/2026 18:56:32.167105")).toBeNull(); // 3 digits
    expect(logLineInstantMs("8/18/2026 18:56:32.16715")).toBeNull(); // +15
    expect(logLineInstantMs("8/18/2026 18:56:32.16799")).toBeNull();
    expect(logLineInstantMs("8/18/2026 18:56:32.167-")).toBeNull();
    expect(logLineInstantMs("8/18/2026 18:56:32")).toBeNull();
    expect(logLineInstantMs("13/45/2026 99:99:99.1672")).toBeNull();
    expect(logLineInstantMs("8/18 18:56:32.1672")).toBeNull(); // no year
    expect(logLineInstantMs("not a date")).toBeNull();
    expect(logLineInstantMs("")).toBeNull();
  });
});

describe("parseTimestamp is NOT that reading, and stays what it was", () => {
  it("an unsigned offset is read as more fraction digits and the wall clock in the zone given — the stored documents' reading", () => {
    // a US Eastern machine reading the Oceanic line: 14 hours after the
    // instant the line states
    expect(parseTimestamp(OCEANIC, { timezone: "America/New_York" })).toBe(
      Date.UTC(2026, 7, 18, 22, 56, 32, 167),
    );
    expect(
      parseTimestamp(OCEANIC, { timezone: "America/New_York" })! -
        logLineInstantMs(OCEANIC)!,
    ).toBe(14 * 3_600_000);
  });

  it("on the machine that recorded the log the two readings are one instant (a whole-hour zone)", () => {
    expect(parseTimestamp(OCEANIC, { timezone: "Australia/Sydney" })).toBe(
      logLineInstantMs(OCEANIC),
    );
    expect(parseTimestamp(CENTRAL_EUROPE, { timezone: "Europe/Berlin" })).toBe(
      logLineInstantMs(CENTRAL_EUROPE),
    );
    expect(parseTimestamp(KOREA, { timezone: "Asia/Seoul" })).toBe(
      logLineInstantMs(KOREA),
    );
  });
});
