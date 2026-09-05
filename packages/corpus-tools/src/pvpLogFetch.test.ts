import { describe, expect, it } from "vitest";

import type { DetailedMatchStub } from "./feedClient";
import {
  ARCHIVED_BRACKETS,
  buildCompQueryString,
  buildGcsMeta,
  checkDecompressedPayload,
  checkRawPayloadBytes,
  dedupeByLogObject,
  expectedByteLength,
  isKnownBracket,
  KNOWN_BRACKETS,
  type ManifestEntry,
  matchesSpecFilter,
  parseSpecArg,
  shouldSleepBeforeDownload,
  shouldSleepBeforePage,
  stubToManifestEntry,
  upsertManifestEntry,
} from "./pvpLogFetch";

function stub(over: Partial<DetailedMatchStub> = {}): DetailedMatchStub {
  return {
    typename: "ArenaMatchDataStub",
    id: "m1",
    logObjectUrl: "https://storage.googleapis.com/x/m1",
    playerId: "Player-1",
    hasAdvancedLogging: true,
    durationInSeconds: 120,
    bracket: "3v3",
    startTime: 1785365331361,
    result: 1,
    playerTeamRating: 2450,
    winningTeamId: "0",
    playerTeamId: "0",
    team0MMR: 2400,
    team1MMR: 2410,
    units: [
      {
        id: "Player-1",
        name: "Rec-Realm",
        spec: "264",
        reaction: 1,
        info: { specId: "264", personalRating: 2460, teamId: "0" },
      },
      {
        id: "Player-2",
        name: "Mate-Realm",
        spec: "263",
        reaction: 1,
        info: { specId: "263", personalRating: 2440, teamId: "0" },
      },
      {
        id: "Player-3",
        name: "Foe-Realm",
        spec: "105",
        reaction: 2,
        info: { specId: "105", personalRating: 2390, teamId: "1" },
      },
      // Pets/totems: no info, and must never be mixed into players
      {
        id: "Creature-1",
        name: "Healing Stream Totem",
        spec: "0",
        reaction: 1,
      },
    ],
    ...over,
  };
}

describe("parseSpecArg", () => {
  it("accepts numeric ids, enum names, and mixed comma lists", () => {
    expect(parseSpecArg("264")).toEqual(["264"]);
    expect(parseSpecArg("Shaman_Restoration")).toEqual(["264"]);
    expect(parseSpecArg("Druid_Restoration, 263")).toEqual(["105", "263"]);
  });
  it("throws on unknown names instead of silently widening the query", () => {
    expect(() => parseSpecArg("Shaman_Resto")).toThrow(/unknown spec/);
  });
});

describe("buildCompQueryString", () => {
  it("joins specIds in string lexicographic order (server index order)", () => {
    // "1468" < "263" lexicographically -- this is the server index's real
    // ordering; a numeric ordering would query empty
    expect(buildCompQueryString(["263", "1468"])).toBe("1468_263");
    expect(buildCompQueryString(["105", "263"])).toBe("105_263");
  });
});

describe("isKnownBracket", () => {
  it("accepts the three server-recognized brackets", () => {
    for (const b of KNOWN_BRACKETS) {
      expect(isKnownBracket(b)).toBe(true);
    }
  });
  it("rejects a typo'd bracket instead of silently querying empty results", () => {
    // A typo ("Ratad Solo Shuffle" / a case variant / stray whitespace) used
    // to make the server query silently return 0 rows rather than erroring --
    // see BACKLOG #21 item10.
    expect(isKnownBracket("Ratad Solo Shuffle")).toBe(false);
    expect(isKnownBracket("2V2")).toBe(false);
    expect(isKnownBracket("")).toBe(false);
  });
});

describe("ARCHIVED_BRACKETS", () => {
  it("excludes 2v2 (user ruling 2026-09-04: stop archiving it)", () => {
    expect(ARCHIVED_BRACKETS).not.toContain("2v2");
  });
  it("still sweeps 3v3 and Rated Solo Shuffle", () => {
    expect(ARCHIVED_BRACKETS).toContain("3v3");
    expect(ARCHIVED_BRACKETS).toContain("Rated Solo Shuffle");
  });
  it("is a non-empty subset of the server-recognized brackets", () => {
    // Empty would archive nothing while the run still exits 0 -- and the
    // "0 new matches" warning would then read as a feed outage rather than a
    // policy that swept no brackets. Not-a-subset would query a value the feed
    // does not recognize, which returns 0 rows *silently* (the trap
    // isKnownBracket exists for); the `readonly Bracket[]` annotation on the
    // constant is the compile-time half of this, and this is the runtime half.
    expect(ARCHIVED_BRACKETS.length).toBeGreaterThan(0);
    for (const b of ARCHIVED_BRACKETS) expect(isKnownBracket(b)).toBe(true);
  });
});

describe("shouldSleepBeforePage", () => {
  it("does not sleep before the first page", () => {
    expect(shouldSleepBeforePage(0)).toBe(false);
  });
  it("sleeps before every subsequent page", () => {
    expect(shouldSleepBeforePage(1)).toBe(true);
    expect(shouldSleepBeforePage(2)).toBe(true);
    expect(shouldSleepBeforePage(39)).toBe(true);
  });
});

describe("shouldSleepBeforeDownload", () => {
  it("does not sleep before the first download", () => {
    expect(shouldSleepBeforeDownload(0)).toBe(false);
  });
  it("sleeps before every subsequent download", () => {
    expect(shouldSleepBeforeDownload(1)).toBe(true);
    expect(shouldSleepBeforeDownload(19)).toBe(true);
  });
});

describe("matchesSpecFilter", () => {
  it("recorder role matches only the uploader's own spec", () => {
    expect(matchesSpecFilter(stub(), ["264"], "recorder")).toBe(true);
    // 105 is present (on the enemy side) but the recorder is 264
    expect(matchesSpecFilter(stub(), ["105"], "recorder")).toBe(false);
  });
  it("any role matches any unit on either side", () => {
    expect(matchesSpecFilter(stub(), ["105"], "any")).toBe(true);
    expect(matchesSpecFilter(stub(), ["270"], "any")).toBe(false);
  });
  it("empty spec list passes everything", () => {
    expect(matchesSpecFilter(stub(), [], "recorder")).toBe(true);
  });
});

describe("dedupeByLogObject", () => {
  it("keeps one stub per shared shuffle log object", () => {
    const rounds = [
      stub({ id: "r1", logObjectUrl: "u/shared" }),
      stub({ id: "r2", logObjectUrl: "u/shared" }),
      stub({ id: "m2", logObjectUrl: "u/other" }),
    ];
    expect(dedupeByLogObject(rounds).map((s) => s.id)).toEqual(["r1", "m2"]);
  });
});

describe("stubToManifestEntry", () => {
  it("extracts recorder, per-player specs/ratings, and drops non-players", () => {
    const e = stubToManifestEntry(stub(), "m1.txt");
    expect(e.recorder).toEqual({
      name: "Rec-Realm",
      spec: "264",
      teamId: "0",
      personalRating: 2460,
    });
    expect(e.players).toHaveLength(3);
    expect(e.players.map((p) => p.spec).sort()).toEqual(["105", "263", "264"]);
    expect(e.playerTeamRating).toBe(2450);
    expect(e.team1MMR).toBe(2410);
    expect(e.fileName).toBe("m1.txt");
  });
});

// -- Download completeness (audit Critical: a truncated log from an HTTP 200
// whose connection died mid-stream used to enter the manifest and the resume
// dedupe set unimpeded, and once recorded it is skipped forever, while the
// feed stub only lasts ~7 days and can never be recovered after it expires) --
describe("expectedByteLength", () => {
  it("prefers x-goog-stored-content-length over content-length", () => {
    expect(
      expectedByteLength({
        contentLength: "999",
        storedContentLength: "12345",
      }),
    ).toBe(12345);
  });
  it("falls back to content-length when stored-content-length absent", () => {
    expect(expectedByteLength({ contentLength: "4096" })).toBe(4096);
  });
  it("returns undefined when neither header is present (don't misjudge missing as truncated)", () => {
    expect(expectedByteLength({})).toBeUndefined();
  });
  it("returns undefined on garbage/non-numeric header values", () => {
    expect(
      expectedByteLength({ contentLength: "not-a-number" }),
    ).toBeUndefined();
  });
});

// -- gcsMeta empty-header tolerance (audit Important: a missing x-goog-meta-*
// used to be silently written as "", a signal-free landmine for any future
// consumer reconstructing absolute time -- "confirmed empty" and "never
// captured" look identical). --
describe("buildGcsMeta", () => {
  it("keeps all four fields when every header is present", () => {
    const { meta, missingFields } = buildGcsMeta({
      wowVersion: "11.0.5",
      clientTimezone: "-05:00",
      clientYear: "2026",
      startTimeUtc: "1785365331361",
    });
    expect(meta).toEqual({
      wowVersion: "11.0.5",
      clientTimezone: "-05:00",
      clientYear: "2026",
      startTimeUtc: "1785365331361",
    });
    expect(missingFields).toEqual([]);
  });

  it('omits empty-string fields from meta instead of writing them as "" and reports them as missing', () => {
    const { meta, missingFields } = buildGcsMeta({
      wowVersion: "11.0.5",
      clientTimezone: "",
      clientYear: "",
      startTimeUtc: "1785365331361",
    });
    expect(meta).toEqual({
      wowVersion: "11.0.5",
      startTimeUtc: "1785365331361",
    });
    expect("clientTimezone" in meta).toBe(false);
    expect("clientYear" in meta).toBe(false);
    expect(missingFields).toEqual(["clientTimezone", "clientYear"]);
  });

  it("reports all four as missing when every header is absent", () => {
    const { meta, missingFields } = buildGcsMeta({
      wowVersion: "",
      clientTimezone: "",
      clientYear: "",
      startTimeUtc: "",
    });
    expect(meta).toEqual({});
    expect(missingFields).toEqual([
      "wowVersion",
      "clientTimezone",
      "clientYear",
      "startTimeUtc",
    ]);
  });
});

describe("checkRawPayloadBytes(原始压缩字节层)", () => {
  it("实收字节数与 content-length 相等即通过", () => {
    expect(checkRawPayloadBytes(109885, 109885)).toEqual({ ok: true });
  });
  it("实收少于期望 = 截断,必须拒收", () => {
    const r = checkRawPayloadBytes(50000, 109885);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/109885/);
  });
  it("拿不到期望字节数时不做该项校验(仍交给哨兵层)", () => {
    expect(checkRawPayloadBytes(50000, undefined)).toEqual({ ok: true });
  });
});

describe("checkDecompressedPayload(解压文本层)", () => {
  it("两个哨兵齐全即通过", () => {
    const t = "x ARENA_MATCH_START,2373 y ARENA_MATCH_END,1 z";
    expect(checkDecompressedPayload(t)).toEqual({ ok: true });
  });
  it("缺 ARENA_MATCH_START 必须拒收", () => {
    expect(checkDecompressedPayload("ARENA_MATCH_END,1").ok).toBe(false);
  });
  it("缺 ARENA_MATCH_END 必须拒收(SS 整场以唯一一次 END 收尾)", () => {
    expect(checkDecompressedPayload("ARENA_MATCH_START,2373").ok).toBe(false);
  });
  it("不再按解压文本比对压缩字节数 —— 这正是 c9c463e 的 bug", () => {
    // 1.4MB of decompressed text against a compressed content-length of
    // 109885: the old implementation misjudged this as truncated and so
    // skipped every match. The new text layer does not look at byte counts
    // at all.
    const t = "ARENA_MATCH_START," + "x".repeat(1_400_000) + "ARENA_MATCH_END,";
    expect(checkDecompressedPayload(t)).toEqual({ ok: true });
  });
});

describe("upsertManifestEntry", () => {
  const entry = (id: string, fileName: string): ManifestEntry => ({
    ...stubToManifestEntry(stub({ id }), fileName),
  });

  it("appends when the id is new", () => {
    const manifest: ManifestEntry[] = [entry("m1", "m1.txt")];
    upsertManifestEntry(manifest, entry("m2", "m2.txt"));
    expect(manifest.map((e) => e.id)).toEqual(["m1", "m2"]);
  });

  // audit Important: when the file is deleted by hand but the manifest row
  // remains, re-downloading would blind-push a second record with the same
  // id; upsert must replace in place rather than duplicate.
  it("replaces the existing entry instead of duplicating when the id repeats", () => {
    const manifest: ManifestEntry[] = [entry("m1", "m1.txt")];
    upsertManifestEntry(manifest, entry("m1", "m1-redownloaded.txt"));
    expect(manifest).toHaveLength(1);
    expect(manifest[0].fileName).toBe("m1-redownloaded.txt");
  });

  it("mutates the array in place and also returns it", () => {
    const manifest: ManifestEntry[] = [];
    const returned = upsertManifestEntry(manifest, entry("m1", "m1.txt"));
    expect(returned).toBe(manifest);
    expect(manifest).toHaveLength(1);
  });
});
