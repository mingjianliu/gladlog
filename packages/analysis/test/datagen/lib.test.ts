import {
  parseCsv,
  assertColumns,
  assertMinRows,
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
