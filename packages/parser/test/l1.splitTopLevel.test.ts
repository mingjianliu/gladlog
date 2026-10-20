import { splitLine,splitTopLevel } from "../src/l1/splitTopLevel";

describe("splitTopLevel", () => {
  it("splits simple comma separated values", () => {
    expect(splitTopLevel("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quotes and ignores commas inside quotes", () => {
    expect(splitTopLevel('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles escaped characters inside quotes", () => {
    expect(splitTopLevel('"a\\"b","c\\\\d","e\\f"')).toEqual(['a"b', 'c\\d', 'e\\f']);
  });

  it("handles unclosed trailing backslash in quotes", () => {
    expect(splitTopLevel('"a\\\\"')).toEqual(['a\\']);
  });

  it("handles square brackets nesting", () => {
    expect(splitTopLevel("a,[b,c],d")).toEqual(["a", "[b,c]", "d"]);
  });

  it("handles parentheses nesting", () => {
    expect(splitTopLevel("a,(b,c),d")).toEqual(["a", "(b,c)", "d"]);
  });

  it("handles nested structures combined", () => {
    expect(splitTopLevel("[(a,b)],c")).toEqual(["[(a,b)]", "c"]);
  });
});

describe("splitLine", () => {
  it("splits a valid line", () => {
    expect(splitLine("5/12 10:20:30.123  SPELL_DAMAGE,a,b,c")).toEqual({
      datePart: "5/12 10:20:30.123",
      eventName: "SPELL_DAMAGE",
      params: ["a", "b", "c"]
    });
  });

  it("returns null if no double space", () => {
    expect(splitLine("5/12 10:20:30.123 SPELL_DAMAGE,a,b,c")).toBeNull();
  });

  it("returns null if date part is empty", () => {
    expect(splitLine("  SPELL_DAMAGE,a,b")).toBeNull();
  });

  it("returns null if no comma in rest", () => {
    expect(splitLine("5/12 10:20:30.123  SPELL_DAMAGE")).toBeNull();
  });

  it("returns null if event name is empty", () => {
    expect(splitLine("5/12 10:20:30.123  ,a,b")).toBeNull();
  });
});
