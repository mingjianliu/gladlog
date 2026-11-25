import {
  assertColumns,
  assertMinRows,
  latestLiveBuild,
  parseCsv,
} from "../../scripts/datagen/lib/wagoCsv";

describe("parseCsv (RFC4180)", () => {
  it("引号内嵌逗号", () => {
    const r = parseCsv('a,b\n1,"x,y"\n');
    expect(r.header).toEqual(["a", "b"]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].a).toBe("1");
    expect(r.rows[0].b).toBe("x,y");
  });

  it("引号内嵌换行与转义引号", () => {
    const r = parseCsv('a,b\n1,"line1\nline2"\n2,"say ""hi"""\n');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].b).toBe("line1\nline2");
    expect(r.rows[1].b).toBe('say "hi"');
  });

  it("空文件 → 空 rows", () => {
    expect(parseCsv("").rows).toEqual([]);
    expect(parseCsv("a,b\n").rows).toEqual([]);
  });
});

describe("emit 断言", () => {
  it("assertColumns 缺列 throw,message 含表名与缺列", () => {
    expect(() =>
      assertColumns(["ID", "Name_lang"], ["ID", "SpellID"], "SpellCooldowns"),
    ).toThrow(/SpellCooldowns.*SpellID/);
    expect(() =>
      assertColumns(["ID", "SpellID"], ["ID", "SpellID"], "T"),
    ).not.toThrow();
  });

  it("assertMinRows 不足 throw", () => {
    expect(() => assertMinRows([{}, {}], 5, "SpellName")).toThrow(/SpellName/);
    expect(() => assertMinRows([{}, {}], 2, "T")).not.toThrow();
  });
});

describe("latestLiveBuild (pipeline T250)", () => {
  // The shape wago.tools answers with: one list per product, whatever the
  // query string asks for. 2026-11-22: the test realm was on 12.1.7 while
  // live was 12.1.5.
  const answer = {
    wowt: [
      { product: "wowt", version: "12.1.7.71087" },
      { product: "wowt", version: "12.1.5.70961" },
    ],
    wow: [
      { product: "wow", version: "12.1.5.70783" },
      { product: "wow", version: "12.1.5.70961" },
      { product: "wow", version: "12.1.0.69587" },
    ],
    wowxptr: [{ product: "wowxptr", version: "12.1.5.70340" }],
    wow_classic: [{ product: "wow_classic", version: "5.5.4.71089" }],
  };

  it("reads the live product only, never the highest of every product", () => {
    expect(latestLiveBuild(answer)).toBe("12.1.5.70961");
  });

  it("a flat list counts the entries whose product is live", () => {
    expect(
      latestLiveBuild([
        { product: "wowt", version: "12.1.7.71087" },
        { product: "wow", version: "12.1.5.70961" },
        { product: "wow", version: "12.1.5.70391" },
      ]),
    ).toBe("12.1.5.70961");
  });

  it("compares the parts as numbers", () => {
    expect(
      latestLiveBuild({
        wow: [{ version: "12.1.5.9999" }, { version: "12.1.5.70391" }],
      }),
    ).toBe("12.1.5.70391");
  });

  it("no live entry is an error, not a fallback to another product", () => {
    expect(() => latestLiveBuild({ wowt: answer.wowt })).toThrow(/live/);
    expect(() =>
      latestLiveBuild([{ product: "wowt", version: "12.1.7.71087" }]),
    ).toThrow(/live/);
    expect(() => latestLiveBuild({ wow: [] })).toThrow(/live/);
    expect(() => latestLiveBuild(null)).toThrow(/live/);
  });

  it("an entry filed under the live key but tagged another product does not count", () => {
    expect(
      latestLiveBuild({
        wow: [
          { product: "wowt", version: "12.1.7.71087" },
          { product: "wow", version: "12.1.5.70961" },
        ],
      }),
    ).toBe("12.1.5.70961");
  });

  it("a malformed live version throws", () => {
    expect(() =>
      latestLiveBuild({ wow: [{ version: "12.1.5.70961/../x" }] }),
    ).toThrow(/format/);
    expect(() => latestLiveBuild({ wow: [{}] })).toThrow(/format/);
  });
});
